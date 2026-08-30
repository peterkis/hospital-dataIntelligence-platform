import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
  writeFormalRuntimeEvent,
  type FormalRuntimeFileSystem,
  type FormalRuntimeLifecycleCallbacks,
  type FormalRuntimeLifecycleDependencies,
  type FormalRuntimeProcessEvents,
} from './formal-runtime-controller.js';
import type {
  FormalPreflightAuthorityIsolationObservation,
  FormalPreflightReport,
} from './formal-preflight.js';
import type {
  FormalTeardownAdapter,
  RuntimeResourceRecord,
  RuntimeResourceSnapshot,
} from './formal-teardown.js';
import {
  loadPodmanRuntimeAuthority,
  parseFormalRuntimeAuthoritySnapshot,
} from './podman-runtime-authority.js';

const LOCK_SHA = 'b'.repeat(64);
const GIT_SHA = 'a'.repeat(40);
const RUN = createFormalRunSeed(9, () => '12345678-1234-1234-1234-123456789abc');
const PRODUCER_SOURCE_MANIFEST_SHA256 = 'd'.repeat(64);
const IDENTITY: FormalRunIdentity = { ...RUN, gitCommitSha: GIT_SHA };
const TEST_LOADED_RUNTIME_AUTHORITY = loadPodmanRuntimeAuthority(
  resolve(import.meta.dirname, '../../../..'),
);
const TEST_RUNTIME_AUTHORITY = TEST_LOADED_RUNTIME_AUTHORITY.authority;
const RUNTIME_AUTHORITY_SHA256 = TEST_LOADED_RUNTIME_AUTHORITY.runtimeAuthoritySha256;
const RUNTIME_AUTHORITY_SEMANTIC_DIGEST =
  TEST_LOADED_RUNTIME_AUTHORITY.runtimeAuthoritySemanticDigest;
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('formal runtime lifecycle', () => {
  it('writes restart-aware, ownership-explicit runtime event evidence without environment values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hdi-formal-event-'));
    roots.push(root);
    await writeFormalRuntimeEvent(root, {
      identity: RUN,
      runtimeAuthority: TEST_RUNTIME_AUTHORITY,
      event: 'STARTED',
      resourceType: 'container',
      id: 'container-id',
      name: `${RUN.runtimeNamespace}_postgres`,
      role: 'postgresql',
      restartPolicy: 'no',
      actualLabels: {
        ...formalRuntimeLabels(RUN, TEST_RUNTIME_AUTHORITY),
        'third-party.sensitive-label': 'must-not-enter-runtime-event-evidence',
      },
    });

    const files = await readdir(root);
    expect(files).toHaveLength(1);
    const event = await readJson(join(root, files[0]!));
    expect(event).toMatchObject({
      schemaVersion: 'phase-01.formal-runtime-event.v1',
      runId: RUN.runId,
      runSequence: RUN.runSequence,
      runtimeNamespace: RUN.runtimeNamespace,
      stage: 'RESOURCE_STARTED',
      status: 'PASSED',
      resourceType: 'container',
      resourceName: `${RUN.runtimeNamespace}_postgres`,
      resourceId: 'container-id',
      restartPolicy: 'no',
      errorCode: null,
      expectedLabels: formalRuntimeLabels(RUN, TEST_RUNTIME_AUTHORITY),
      actualLabels: formalRuntimeLabels(RUN, TEST_RUNTIME_AUTHORITY),
    });
    expect(JSON.stringify(event)).not.toContain('DATABASE_URL');
    expect(JSON.stringify(event)).not.toContain('third-party.sensitive-label');
    expect(JSON.stringify(event)).not.toContain('must-not-enter-runtime-event-evidence');
  });

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
      async executeBeforeCleanup(context) {
        await mkdir(join(context.outputDirectory, 'producer'), { recursive: true });
        await writeFile(join(context.outputDirectory, 'producer', 'failure.txt'), failureCode, 'utf8');
        return { passed: false, value: { failureCode }, failureCode };
      },
      async persistEvidenceBeforeCleanup() {},
      async finalizeAfterCleanup(_context, outcome) {
        return terminalResult(outcome.status, outcome.failureCodes);
      },
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

  it('persists the frozen authority snapshot before invoking any lifecycle callback', async () => {
    const harness = await createHarness();
    const calls: string[] = [];

    const result = await run(harness, {
      async executeBeforeCleanup(context) {
        calls.push('execute');
        expect(context.runtimeAuthority).toBe(harness.runtimeAuthority);
        const snapshot = parseFormalRuntimeAuthoritySnapshot(await readJson(
          join(context.outputDirectory, 'runtime', 'runtime-authority-snapshot.json'),
        ));
        expect(snapshot.runIdentity).toEqual(IDENTITY);
        expect(snapshot.runtimeAuthoritySha256).toBe(context.runtimeAuthority.runtimeAuthoritySha256);
        expect(snapshot.runtimeAuthoritySemanticDigest)
          .toBe(context.runtimeAuthority.runtimeAuthoritySemanticDigest);
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {
        calls.push('persist');
      },
      async finalizeAfterCleanup(_context, outcome) {
        calls.push('finalize');
        return terminalResult(outcome.status, outcome.failureCodes);
      },
      async sealEvidence() {
        calls.push('seal');
      },
    });

    expect(result.status).toBe('PASSED');
    expect(calls).toEqual(['execute', 'persist', 'finalize', 'seal']);
    expect(harness.fileSystem.writes.indexOf('runtime/preflight.json'))
      .toBeLessThan(harness.fileSystem.writes.indexOf('runtime/runtime-authority-snapshot.json'));
  });

  it('does not invoke lifecycle callbacks when the frozen authority snapshot cannot be persisted', async () => {
    const harness = await createHarness({
      failWrites: ['runtime/runtime-authority-snapshot.json'],
    });
    const calls: string[] = [];
    const callbacks = passingCallbacks();

    const result = await run(harness, {
      ...callbacks,
      async executeBeforeCleanup() {
        calls.push('execute');
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {
        calls.push('persist');
      },
      async finalizeAfterCleanup() {
        calls.push('finalize');
        return terminalResult('PASSED', []);
      },
      async sealEvidence() {
        calls.push('seal');
      },
    });

    expect(result.status).toBe('FAILED');
    expect(calls).toEqual([]);
    expect(harness.adapter.calls).toContain('stop-process:501');
    const summary = await readJson(join(harness.outputDirectory, 'runtime', 'failure-summary.json'));
    expect(summary['failureCodes']).toEqual(expect.arrayContaining([
      'FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_WRITE_FAILED',
      'FORMAL_EXECUTION_SKIPPED_AUTHORITY_SNAPSHOT_UNAVAILABLE',
    ]));
  });

  it.each(['SIGINT', 'SIGTERM'] as const)('%s enters the same controlled cleanup path', async (signal) => {
    const processEvents = new TestProcessEvents();
    const controller = new FormalRuntimeController(processEvents);
    const harness = await createHarness({ controller });
    const result = await run(harness, {
      async executeBeforeCleanup(context) {
        processEvents.emit(signal);
        context.throwIfAborted();
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {},
      async finalizeAfterCleanup(_context, outcome) {
        return terminalResult(outcome.status, outcome.failureCodes);
      },
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
      async executeBeforeCleanup(context) {
        processEvents.emit('uncaughtException', new Error('sensitive detail'));
        context.throwIfAborted();
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {},
      async finalizeAfterCleanup(_context, outcome) {
        return terminalResult(outcome.status, outcome.failureCodes);
      },
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
    const finalOutcome = await readJson(join(harness.outputDirectory, 'runtime', 'final-outcome.json'));
    expect(finalOutcome).toMatchObject({
      schemaVersion: 'phase-01.formal-runtime-outcome.v3',
      status: 'PASSED',
      cleanupStatus: 'PASSED',
      terminalConclusionStatus: 'PASSED',
      sealEligibilityStatus: 'PASSED',
      producerSourceManifestSha256: 'd'.repeat(64),
      failureCodes: [],
      sealPendingAtWrite: true,
    });
  });

  it('retains the producer source manifest digest when finalization is unavailable', async () => {
    const harness = await createHarness();
    let sealInvoked = false;

    const result = await run(harness, {
      async executeBeforeCleanup() {
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {},
      async finalizeAfterCleanup() {
        throw new Error('FINALIZATION_UNAVAILABLE');
      },
      async sealEvidence() {
        sealInvoked = true;
      },
    });

    expect(result.status).toBe('FAILED');
    expect(result.finalization).toBeNull();
    expect(sealInvoked).toBe(false);
    const finalOutcome = await readJson(join(harness.outputDirectory, 'runtime', 'final-outcome.json'));
    expect(finalOutcome).toMatchObject({
      status: 'FAILED',
      producerSourceManifestSha256: PRODUCER_SOURCE_MANIFEST_SHA256,
      terminalConclusionStatus: 'FAILED',
      sealEligibilityStatus: 'FAILED',
    });
  });

  it('finalizes only after cleanup and exposes both resource snapshots plus output exclusivity', async () => {
    const harness = await createHarness();
    const calls: string[] = [];

    const result = await run(harness, {
      async executeBeforeCleanup(context) {
        calls.push('execute-before-cleanup');
        expect(context.runtimeAuthority.runtimeAuthoritySha256).toBe(RUNTIME_AUTHORITY_SHA256);
        expect(context.runtimeAuthority.runtimeAuthoritySemanticDigest)
          .toBe(RUNTIME_AUTHORITY_SEMANTIC_DIGEST);
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {
        calls.push('persist-before-cleanup');
      },
      async finalizeAfterCleanup(_context, outcome) {
        calls.push('finalize-after-cleanup');
        expect(outcome.outputDirectoryExclusive).toBe(true);
        expect(outcome.startedResources.resources).toEqual([
          expect.objectContaining({ id: '501', present: true }),
        ]);
        expect(outcome.finalResources.resources).toEqual([
          expect.objectContaining({ id: '501', present: false }),
        ]);
        expect(outcome.producerEvidencePersistedBeforeCleanup).toBe(true);
        return terminalResult(outcome.status, outcome.failureCodes);
      },
      async sealEvidence() {
        calls.push('seal-evidence');
      },
    });

    expect(result.status).toBe('PASSED');
    expect(result.finalResources?.resources).toEqual([
      expect.objectContaining({ id: '501', present: false }),
    ]);
    expect(calls).toEqual([
      'execute-before-cleanup',
      'persist-before-cleanup',
      'finalize-after-cleanup',
      'seal-evidence',
    ]);
    expect(harness.fileSystem.writes.indexOf('runtime/cleanup.json'))
      .toBeLessThan(harness.fileSystem.writes.indexOf('runtime/final-outcome.json'));
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

  it('fails before sealing when the runtime authority changes during cleanup', async () => {
    const harness = await createHarness({ authorityDrift: true });
    let observedStable: boolean | undefined;
    const callbacks = passingCallbacks();
    const result = await run(harness, {
      ...callbacks,
      async finalizeAfterCleanup(_context, outcome) {
        observedStable = outcome.runtimeAuthorityStableAfterCleanup;
        return terminalResult(outcome.status, outcome.failureCodes);
      },
    });

    expect(observedStable).toBe(false);
    expect(result.status).toBe('FAILED');
    const finalOutcome = await readJson(join(harness.outputDirectory, 'runtime', 'final-outcome.json'));
    expect(finalOutcome).toMatchObject({
      runtimeAuthoritySha256: RUNTIME_AUTHORITY_SHA256,
      runtimeAuthoritySemanticDigest: RUNTIME_AUTHORITY_SEMANTIC_DIGEST,
      runtimeAuthorityStableAfterCleanup: false,
    });
    expect(finalOutcome['failureCodes']).toContain('FORMAL_RUNTIME_AUTHORITY_MUTATED');
  });

  it('preserves a stable failed evidence result and never executes callbacks when authority loading fails', async () => {
    const harness = await createHarness({ authorityUnavailable: true });
    const calls: string[] = [];
    const result = await run(harness, {
      async executeBeforeCleanup() {
        calls.push('execute');
        return { passed: true, value: {} };
      },
      async persistEvidenceBeforeCleanup() {
        calls.push('persist');
      },
      async finalizeAfterCleanup() {
        calls.push('finalize');
        return terminalResult('PASSED', []);
      },
      async sealEvidence() {
        calls.push('seal');
      },
    });

    expect(result.status).toBe('FAILED');
    expect(result.runtimeAuthorityFailureCode).toBe('FORMAL_RUNTIME_AUTHORITY_UNAVAILABLE');
    expect(result.runtimeAuthoritySha256).toBeNull();
    expect(result.runtimeAuthoritySemanticDigest).toBeNull();
    expect(result.outputDirectoryCreated).toBe(true);
    expect(result.cleanup).toBeNull();
    expect(calls).toEqual([]);
    expect(harness.adapter.calls).toEqual([]);
    expect(await readJson(join(harness.outputDirectory, 'runtime', 'authority-failure.json')))
      .toMatchObject({
        status: 'FAILED',
        failureCode: 'FORMAL_RUNTIME_AUTHORITY_UNAVAILABLE',
      });
    expect(await readJson(join(harness.outputDirectory, 'runtime', 'final-outcome.json')))
      .toMatchObject({
        status: 'FAILED',
        failureCodes: ['FORMAL_RUNTIME_AUTHORITY_UNAVAILABLE'],
        runtimeAuthoritySha256: null,
        runtimeAuthoritySemanticDigest: null,
        runtimeAuthorityStableAfterCleanup: false,
      });
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
  readonly authorityDrift?: boolean;
  readonly authorityUnavailable?: boolean;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hdi-formal-lifecycle-'));
  roots.push(root);
  const outputDirectory = join(root, 'evidence', 'run-9');
  const fileSystem = new RecordingFileSystem(options.failWrites ?? []);
  const adapter = new LifecycleTeardownAdapter(options.stopFailure ?? false);
  const runtimeAuthority = loadRuntimeAuthorityFixture();
  const dependencies: FormalRuntimeLifecycleDependencies = {
    fileSystem,
    async preflight() {
      return {
        report: preflightReport(
          options.outputAlreadyExists ?? false,
          options.authorityUnavailable ?? false,
        ),
        runtimeAuthority: options.authorityUnavailable ? null : runtimeAuthority,
      };
    },
    async sha256() {
      return options.sha256?.() ?? LOCK_SHA;
    },
    teardownDependencies: {
      adapter,
      authorityIsolation: {
        async inspect() {
          return passingIsolationObservation(runtimeAuthority.authority.podman.socketPath);
        },
      },
      environment: {},
      loadRuntimeAuthority: () => options.authorityDrift
        ? { ...runtimeAuthority, runtimeAuthoritySemanticDigest: '0'.repeat(64) }
        : runtimeAuthority,
      now: () => '2026-08-27T12:00:00',
    },
    now: () => '2026-08-27T12:00:00',
    createController: () => options.controller ?? new FormalRuntimeController(),
  };
  return { root, outputDirectory, fileSystem, adapter, runtimeAuthority, dependencies };
}

async function run<T>(
  harness: Awaited<ReturnType<typeof createHarness>>,
  callbacks: FormalRuntimeLifecycleCallbacks<T>,
) {
  return runFormalRuntimeLifecycle({
    repositoryRoot: join(harness.root, 'repository'),
    outputDirectory: harness.outputDirectory,
    run: RUN,
    producerSourceManifestSha256: PRODUCER_SOURCE_MANIFEST_SHA256,
  }, callbacks, harness.dependencies);
}

function passingCallbacks(
  duringExecute: () => Promise<void> | void = () => {},
): FormalRuntimeLifecycleCallbacks<Record<string, never>> {
  return {
    async executeBeforeCleanup() {
      await duringExecute();
      return { passed: true, value: {} };
    },
    async persistEvidenceBeforeCleanup() {},
    async finalizeAfterCleanup(_context, outcome) {
      return terminalResult(outcome.status, outcome.failureCodes);
    },
    async sealEvidence() {},
  };
}

function terminalResult(status: 'PASSED' | 'FAILED', failureCodes: readonly string[]) {
  return {
    status,
    terminalConclusionStatus: status,
    sealEligibilityStatus: status,
    producerSourceManifestSha256: 'd'.repeat(64),
    failureCodes,
    value: {},
  } as const;
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

  async reinspectResource(): Promise<RuntimeResourceRecord | null> {
    return this.currentResource;
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

  async removeVolume(): Promise<void> {
    throw new Error('UNEXPECTED_VOLUME_REMOVAL');
  }

  async removeNetwork(): Promise<void> {
    throw new Error('UNEXPECTED_NETWORK_REMOVAL');
  }

  async inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']> {
    return ports.map((port) => ({ port, occupied: false, verificationError: null }));
  }

  async inspectTerminalState() {
    return {
      persistenceFindings: [],
      dockerSecondAuthorityFindings: [],
      partialStartupRecoveryFindings: [],
    };
  }
}

function processResource(): RuntimeResourceRecord {
  return {
    resourceType: 'process',
    id: '501',
    name: 'governance-api',
    labels: { ...formalRuntimeLabels(IDENTITY, TEST_RUNTIME_AUTHORITY) },
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

function loadRuntimeAuthorityFixture() {
  return TEST_LOADED_RUNTIME_AUTHORITY;
}

function preflightReport(
  outputAlreadyExists: boolean,
  authorityUnavailable: boolean = false,
): FormalPreflightReport {
  return {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: outputAlreadyExists ? 'FAILED' : 'PASSED',
    runIdentity: IDENTITY,
    startedAt: '2026-08-27T11:58:00',
    completedAt: '2026-08-27T11:58:01',
    timezone: 'Asia/Shanghai',
    runtimeAuthoritySha256: authorityUnavailable ? null : RUNTIME_AUTHORITY_SHA256,
    runtimeAuthoritySemanticDigest: authorityUnavailable ? null : RUNTIME_AUTHORITY_SEMANTIC_DIGEST,
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

function passingIsolationObservation(socketPath: string): FormalPreflightAuthorityIsolationObservation {
  return {
    dockerExecutablePaths: [],
    forbiddenSockets: [],
    systemdUnits: [
      { name: 'docker.service', loadState: 'not-found', activeState: 'inactive', unitFileState: 'disabled', subState: 'dead' },
      { name: 'docker.socket', loadState: 'not-found', activeState: 'inactive', unitFileState: 'disabled', subState: 'dead' },
    ],
    forbiddenProcesses: [],
    forbiddenTcpListeners: [],
    unexpectedContainerApiEndpoints: [],
    podmanConnections: [],
    podmanMachines: [],
    rootlessSocketPaths: [],
    otherWslBackends: [],
    podmanSocket: {
      path: socketPath,
      kind: 'socket',
      symbolicLink: false,
      uid: 0,
      gid: 0,
      mode: '0660',
      systemdActive: true,
      tcpEndpoints: [],
      rootless: false,
    },
    inspectionFailures: [],
  };
}

async function readJson(path: string): Promise<Readonly<Record<string, unknown>>> {
  return JSON.parse(await readFile(path, 'utf8')) as Readonly<Record<string, unknown>>;
}
