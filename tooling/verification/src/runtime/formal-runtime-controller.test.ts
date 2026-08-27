import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORMAL_REQUIRED_SECRET_NAMES,
  createFormalRunSeed,
  formalRuntimeLabels,
  type FormalRunIdentity,
} from './formal-runtime-contract.js';
import {
  FormalRuntimeController,
  runFormalRuntimeLifecycle,
  type FormalRuntimeFileSystem,
  type FormalRuntimeLifecycleCallbacks,
  type FormalRuntimeLifecycleDependencies,
  type FormalRuntimeProcessEvents,
} from './formal-runtime-controller.js';
import type { FormalPreflightReport } from './formal-preflight.js';
import type {
  FormalTeardownAdapter,
  RuntimeResourceRecord,
  RuntimeResourceSnapshot,
} from './formal-teardown.js';

const LOCK_SHA = 'b'.repeat(64);
const GIT_SHA = 'a'.repeat(40);
const RUN = createFormalRunSeed(9, () => '12345678-1234-1234-1234-123456789abc');
const IDENTITY: FormalRunIdentity = { ...RUN, gitCommitSha: GIT_SHA };
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('formal runtime lifecycle', () => {
  it.each([
    'SETUP_COMMAND_FAILED',
    'APPLICATION_START_FAILED',
    'LIVE_VERIFICATION_FAILED',
    'BROWSER_VERIFICATION_FAILED',
    'PRODUCER_FAILED',
  ])('persists %s evidence before cleanup and retains the failed run directory', async (failureCode) => {
    const harness = await createHarness();
    harness.adapter.beforeStop = async () => {
      await access(join(harness.outputDirectory, 'producer', 'failure.txt'));
      await access(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    };

    const result = await run(harness, {
      async execute(context) {
        await mkdir(join(context.outputDirectory, 'producer'), { recursive: true });
        await writeFile(join(context.outputDirectory, 'producer', 'failure.txt'), failureCode, 'utf8');
        return { passed: false, value: { failureCode }, failureCode };
      },
      async persistEvidenceBeforeCleanup() {},
      async writeFinalEvidence() {},
      async sealEvidence() {},
    });

    expect(result.status).toBe('FAILED');
    expect(result.cleanup?.status).toBe('PASSED');
    expect(harness.adapter.calls).toContain('stop-process:501');
    expect(harness.fileSystem.writes.indexOf('runtime/failure-summary.json'))
      .toBeLessThan(harness.fileSystem.writes.indexOf('runtime/cleanup.json'));
    expect(await readFile(join(harness.outputDirectory, 'producer', 'failure.txt'), 'utf8'))
      .toBe(failureCode);
    const summary = await readJson(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    expect(summary['failureCodes']).toContain(failureCode);
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('%s enters the same controlled cleanup path', async (signal) => {
    const processEvents = new TestProcessEvents();
    const controller = new FormalRuntimeController(processEvents);
    const harness = await createHarness({ controller });
    const result = await run(harness, {
      async execute(context) {
        processEvents.emit(signal);
        context.throwIfAborted();
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {},
      async writeFinalEvidence() {},
      async sealEvidence() {},
    });

    expect(result.status).toBe('FAILED');
    expect(result.cleanup?.status).toBe('PASSED');
    expect(harness.adapter.calls).toContain('stop-process:501');
    const summary = await readJson(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    expect(summary['failureCodes']).toContain('FORMAL_RUNTIME_SIGNAL_' + signal);
  });

  it('handles an uncaught-exception signal through controlled cleanup', async () => {
    const processEvents = new TestProcessEvents();
    const controller = new FormalRuntimeController(processEvents);
    const harness = await createHarness({ controller });
    const result = await run(harness, {
      async execute(context) {
        processEvents.emit('uncaughtException', new Error('sensitive detail'));
        context.throwIfAborted();
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {},
      async writeFinalEvidence() {},
      async sealEvidence() {},
    });

    expect(result.status).toBe('FAILED');
    expect(harness.adapter.calls).toContain('stop-process:501');
  });

  it('makes a cleanup failure authoritative', async () => {
    const harness = await createHarness({ stopFailure: true });
    const result = await run(harness, passingCallbacks());

    expect(result.status).toBe('FAILED');
    expect(result.cleanup?.status).toBe('FAILED');
    expect(result.cleanup?.failedItems).not.toHaveLength(0);
  });

  it('makes manifest generation failure authoritative after attempting cleanup', async () => {
    const harness = await createHarness();
    const callbacks = passingCallbacks();
    const result = await run(harness, {
      ...callbacks,
      async sealEvidence() {
        throw new Error('MANIFEST_WRITE_FAILED');
      },
    });

    expect(result.status).toBe('FAILED');
    expect(result.sealFailureCode).toBe('FORMAL_MANIFEST_GENERATION_FAILED');
    expect(harness.adapter.calls).toContain('stop-process:501');
    await access(join(harness.outputDirectory, 'runtime', 'manifest-failure.json'));
    const manifestFailure = await readJson(
      join(harness.outputDirectory, 'runtime', 'manifest-failure.json'),
    );
    expect(manifestFailure['status']).toBe('FAILED');
    expect(manifestFailure['failureCodes']).toContain('FORMAL_MANIFEST_GENERATION_FAILED');
    expect(manifestFailure['supersedesPreSealOutcome']).toBe('runtime/final-outcome.json');
  });

  it('still performs controlled cleanup when the resource snapshot cannot be persisted', async () => {
    const harness = await createHarness({ failWrites: ['runtime/resources-started.json'] });
    const result = await run(harness, passingCallbacks());

    expect(result.status).toBe('FAILED');
    expect(harness.adapter.calls).toContain('stop-process:501');
    const summary = await readJson(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    expect(summary['failureCodes']).toContain('FORMAL_RESOURCE_EVIDENCE_WRITE_FAILED');
    expect(summary['evidencePersistedBeforeCleanup']).toBe(false);
  });

  it('still performs controlled cleanup when the producer evidence callback fails', async () => {
    const harness = await createHarness();
    const callbacks = passingCallbacks();
    const result = await run(harness, {
      ...callbacks,
      async persistEvidenceBeforeCleanup() {
        throw new Error('FORMAL_PRODUCER_EVIDENCE_UNAVAILABLE_BEFORE_CLEANUP');
      },
    });

    expect(result.status).toBe('FAILED');
    expect(harness.adapter.calls).toContain('stop-process:501');
    const summary = await readJson(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    expect(summary['failureCodes']).toContain('FORMAL_PRE_CLEANUP_EVIDENCE_WRITE_FAILED');
    expect(summary['evidencePersistedBeforeCleanup']).toBe(false);
    await access(join(harness.outputDirectory, 'runtime', 'pre-cleanup-evidence-failure.json'));
  });

  it('writes the terminal pre-seal outcome before sealing the evidence package', async () => {
    const harness = await createHarness();
    const callbacks = passingCallbacks();
    const result = await run(harness, {
      ...callbacks,
      async sealEvidence(context) {
        await access(join(context.outputDirectory, 'runtime', 'final-outcome.json'));
      },
    });

    expect(result.status).toBe('PASSED');
    expect(harness.fileSystem.writes.indexOf('runtime/final-outcome.json')).toBeGreaterThan(-1);
  });

  it('fails if package-lock.json changes after preflight', async () => {
    let lockDigest = LOCK_SHA;
    const harness = await createHarness({ sha256: () => lockDigest });
    const callbacks = passingCallbacks(async () => {
      lockDigest = 'c'.repeat(64);
    });
    const result = await run(harness, callbacks);

    expect(result.status).toBe('FAILED');
    const summary = await readJson(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    expect(summary['failureCodes']).toContain('FORMAL_RUNTIME_LOCKFILE_MUTATED');
  });

  it('never reuses or overwrites an existing output directory', async () => {
    const harness = await createHarness({ outputAlreadyExists: true });
    await mkdir(harness.outputDirectory, { recursive: true });
    const marker = join(harness.outputDirectory, 'old-failure-evidence.txt');
    await writeFile(marker, 'retain me', 'utf8');
    const result = await run(harness, passingCallbacks());

    expect(result.status).toBe('FAILED');
    expect(result.outputDirectoryCreated).toBe(false);
    expect(harness.adapter.calls).toEqual([]);
    expect(await readFile(marker, 'utf8')).toBe('retain me');
  });
});

async function createHarness(options: {
  readonly controller?: FormalRuntimeController;
  readonly stopFailure?: boolean;
  readonly outputAlreadyExists?: boolean;
  readonly sha256?: () => string;
  readonly failWrites?: readonly string[];
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hdi-formal-lifecycle-'));
  roots.push(root);
  const outputDirectory = join(root, 'evidence', 'run-9');
  const fileSystem = new RecordingFileSystem(options.failWrites ?? []);
  const adapter = new LifecycleTeardownAdapter(options.stopFailure ?? false);
  const dependencies: FormalRuntimeLifecycleDependencies = {
    fileSystem,
    async preflight() {
      return preflightReport(options.outputAlreadyExists ?? false);
    },
    async sha256() {
      return options.sha256?.() ?? LOCK_SHA;
    },
    teardownDependencies: {
      adapter,
      now: () => '2026-08-27T12:00:00',
    },
    now: () => '2026-08-27T12:00:00',
    createController: () => options.controller ?? new FormalRuntimeController(),
  };
  return { root, outputDirectory, fileSystem, adapter, dependencies };
}

async function run<T>(
  harness: Awaited<ReturnType<typeof createHarness>>,
  callbacks: FormalRuntimeLifecycleCallbacks<T>,
) {
  return runFormalRuntimeLifecycle({
    repositoryRoot: join(harness.root, 'repository'),
    outputDirectory: harness.outputDirectory,
    composeFile: join(harness.root, 'compose.phase-01.yml'),
    run: RUN,
  }, callbacks, harness.dependencies);
}

function passingCallbacks(
  duringExecute: () => Promise<void> | void = () => {},
): FormalRuntimeLifecycleCallbacks<Record<string, never>> {
  return {
    async execute() {
      await duringExecute();
      return { passed: true, value: {} };
    },
    async persistEvidenceBeforeCleanup() {},
    async writeFinalEvidence() {},
    async sealEvidence() {},
  };
}

class RecordingFileSystem implements FormalRuntimeFileSystem {
  readonly writes: string[] = [];

  constructor(private readonly failWrites: readonly string[]) {}

  async reserveOutputDirectory(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await mkdir(path, { recursive: false, mode: 0o700 });
  }

  async writeJsonExclusive(root: string, relativePath: string, value: unknown): Promise<void> {
    this.writes.push(relativePath);
    if (this.failWrites.includes(relativePath)) throw new Error('INJECTED_EVIDENCE_WRITE_FAILURE');
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  }
}

class TestProcessEvents implements FormalRuntimeProcessEvents {
  private readonly listeners = new Map<string, Set<(value?: unknown) => void>>();

  once(event: string, listener: (value?: unknown) => void): void {
    const onceListener = (value?: unknown) => {
      this.removeListener(event, onceListener);
      listener(value);
    };
    const listeners = this.listeners.get(event) ?? new Set<(value?: unknown) => void>();
    listeners.add(onceListener);
    this.listeners.set(event, listeners);
  }

  removeListener(event: string, listener: (value?: unknown) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, value?: unknown): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(value);
  }
}

class LifecycleTeardownAdapter implements FormalTeardownAdapter {
  readonly calls: string[] = [];
  beforeStop: () => Promise<void> = async () => {};
  private currentResource = processResource();

  constructor(private readonly stopFailure: boolean) {}

  async listResources(): Promise<readonly RuntimeResourceRecord[]> {
    return [this.currentResource];
  }

  async stopProcess(candidate: RuntimeResourceRecord): Promise<void> {
    await this.beforeStop();
    this.calls.push('stop-process:' + candidate.id);
    if (this.stopFailure) throw new Error('INJECTED_STOP_FAILURE');
    this.currentResource = { ...this.currentResource, present: false, active: false };
  }

  async removeContainer(): Promise<void> {
    throw new Error('UNEXPECTED_CONTAINER_REMOVAL');
  }

  async composeDown(): Promise<void> {
    throw new Error('UNEXPECTED_COMPOSE_DOWN');
  }

  async removeVolume(): Promise<void> {
    throw new Error('UNEXPECTED_VOLUME_REMOVAL');
  }

  async removeNetwork(): Promise<void> {
    throw new Error('UNEXPECTED_NETWORK_REMOVAL');
  }

  async inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']> {
    return ports.map((port) => ({ port, occupied: false, verificationError: null }));
  }
}

function processResource(): RuntimeResourceRecord {
  return {
    resourceType: 'process',
    id: '501',
    name: 'governance-api',
    labels: { ...formalRuntimeLabels(IDENTITY) },
    source: 'runtime-event',
    present: true,
    active: true,
    state: 'STARTED',
    imageReference: null,
    imageId: null,
    imageDigest: null,
    ports: [],
    startedAt: '2026-08-27T11:59:00',
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
    pid: 501,
    role: 'governance-api',
  };
}

function preflightReport(outputAlreadyExists: boolean): FormalPreflightReport {
  return {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: outputAlreadyExists ? 'FAILED' : 'PASSED',
    runIdentity: IDENTITY,
    startedAt: '2026-08-27T11:58:00',
    completedAt: '2026-08-27T11:58:01',
    timezone: 'Asia/Shanghai',
    checks: [
      {
        id: 'git-output-directory-absent',
        category: 'git',
        status: outputAlreadyExists ? 'FAILED' : 'PASSED',
        errorCode: outputAlreadyExists ? 'FORMAL_PREFLIGHT_OUTPUT_ALREADY_EXISTS' : null,
        observed: { outputDirectoryExists: outputAlreadyExists },
      },
      {
        id: 'npm-lockfile',
        category: 'node-npm',
        status: 'PASSED',
        errorCode: null,
        observed: { present: true, sha256: LOCK_SHA, mutationPolicy: 'READ_ONLY' },
      },
    ],
    secrets: FORMAL_REQUIRED_SECRET_NAMES.map((name) => ({ name, present: true })),
  };
}

async function readJson(path: string): Promise<Readonly<Record<string, unknown>>> {
  return JSON.parse(await readFile(path, 'utf8')) as Readonly<Record<string, unknown>>;
}
