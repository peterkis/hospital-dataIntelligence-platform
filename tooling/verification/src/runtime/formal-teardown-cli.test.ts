import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { VERIFICATION_SOURCE_FILES } from '../provenance/source-manifest-files.js';
import {
  buildProducerSourceManifest,
  writeProducerSourceManifest,
  type SourceManifestDependencies,
} from '../provenance/source-manifest.js';
import {
  formalRuntimeLabels,
  type FormalRunIdentity,
} from './formal-runtime-contract.js';
import type { FormalPreflightAuthorityIsolationObservation } from './formal-preflight.js';
import {
  runControlledTeardownCli,
  type FormalTeardownAdapter,
  type RuntimeResourceRecord,
  type RuntimeResourceSnapshot,
} from './formal-teardown.js';
import {
  canonicalRuntimeAuthorityJson,
  createFormalRuntimeAuthoritySnapshot,
  loadPodmanRuntimeAuthority,
  parsePodmanRuntimeAuthority,
  RUNTIME_AUTHORITY_RELATIVE_PATH,
} from './podman-runtime-authority.js';
import type { LoadedPodmanRuntimeAuthority } from './podman-runtime-authority-schema.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const AUTHORITY_A = loadPodmanRuntimeAuthority(REPOSITORY_ROOT);
const AUTHORITY_A_BYTES = readFileSync(join(REPOSITORY_ROOT, RUNTIME_AUTHORITY_RELATIVE_PATH));
const PRODUCER_GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
const IDENTITY: FormalRunIdentity = {
  runId: '12345678-1234-1234-1234-123456789abc',
  runSequence: 7,
  runtimeNamespace: 'hdi_phase01_abg_7_123456781234',
  gitCommitSha: PRODUCER_GIT_COMMIT_SHA,
};
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('standalone controlled teardown CLI recovery', () => {
  it.each(['invalid', 'authority-b'] as const)(
    'cleans authority A resources from its frozen snapshot when current disk authority is %s',
    async (currentDiskState) => {
      const harness = await createRecoveryHarness();
      await writePreflightAndSnapshot(harness);
      await writeCurrentDiskAuthority(harness.repositoryRoot, currentDiskState);

      const result = await runControlledTeardownCli({
        evidenceDirectory: harness.evidenceDirectory,
        repositoryRoot: harness.repositoryRoot,
      }, harness.dependencies);

      expect(harness.adapter.calls).toEqual([
        'reinspect:container:runtime-postgres',
        'remove-container:runtime-postgres',
      ]);
      expect(harness.adapter.current.present).toBe(false);
      expect(result.cleanup.runtimeAuthority?.stable).toBe(false);
    },
  );

  it('rejects a missing frozen snapshot before any resource mutation', async () => {
    const harness = await createRecoveryHarness();
    await writePreflightWithProducerManifest(harness);

    await expect(runControlledTeardownCli({
      evidenceDirectory: harness.evidenceDirectory,
      repositoryRoot: harness.repositoryRoot,
    }, harness.dependencies)).rejects.toThrow('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_MISSING');
    expect(harness.adapter.calls).toEqual([]);
    expect(harness.adapter.current.present).toBe(true);
  });

  it('rejects a semantically tampered frozen snapshot before any resource mutation', async () => {
    const harness = await createRecoveryHarness();
    await writePreflightAndSnapshot(harness);
    const snapshotPath = join(
      harness.evidenceDirectory,
      'runtime',
      'runtime-authority-snapshot.json',
    );
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Record<string, unknown>;
    const authority = recordAt(snapshot, 'authority');
    const network = recordAt(authority, 'network');
    const ports = recordAt(network, 'ports');
    ports['governanceApi'] = 6_100;
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

    await expect(runControlledTeardownCli({
      evidenceDirectory: harness.evidenceDirectory,
      repositoryRoot: harness.repositoryRoot,
    }, harness.dependencies)).rejects.toThrow('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_INVALID');
    expect(harness.adapter.calls).toEqual([]);
    expect(harness.adapter.current.present).toBe(true);
  });

  it('rejects a snapshot whose byte digest is not the one recorded by preflight', async () => {
    const harness = await createRecoveryHarness();
    await writePreflightAndSnapshot(harness);
    const snapshotPath = join(
      harness.evidenceDirectory,
      'runtime',
      'runtime-authority-snapshot.json',
    );
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as Record<string, unknown>;
    snapshot['runtimeAuthoritySha256'] = '0'.repeat(64);
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

    await expect(runControlledTeardownCli({
      evidenceDirectory: harness.evidenceDirectory,
      repositoryRoot: harness.repositoryRoot,
    }, harness.dependencies)).rejects.toThrow(
      'FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_PREFLIGHT_MISMATCH',
    );
    expect(harness.adapter.calls).toEqual([]);
    expect(harness.adapter.current.present).toBe(true);
  });

  it('rejects jointly rewritten semantic authority before discovery even when it retains authority A byte digest', async () => {
    const harness = await createRecoveryHarness();
    await writePreflightAndSnapshot(harness, {
      ...fabricateAuthorityB(),
      runtimeAuthoritySha256: AUTHORITY_A.runtimeAuthoritySha256,
    });

    await expect(runControlledTeardownCli({
      evidenceDirectory: harness.evidenceDirectory,
      repositoryRoot: harness.repositoryRoot,
    }, harness.dependencies)).rejects.toThrow(
      'FORMAL_TEARDOWN_RUNTIME_AUTHORITY_SOURCE_BINDING_INVALID',
    );
    expect(harness.adapter.calls).toEqual([]);
    expect(harness.adapter.current.present).toBe(true);
  });
});

async function createRecoveryHarness() {
  const root = await mkdtemp(join(tmpdir(), 'hdi-standalone-teardown-'));
  roots.push(root);
  const repositoryRoot = join(root, 'repository');
  const evidenceDirectory = join(root, 'evidence', 'run-7');
  const adapter = new RecoveryTeardownAdapter();
  const sourceManifestDependencies = fixtureSourceManifestDependencies();
  return {
    repositoryRoot,
    evidenceDirectory,
    adapter,
    sourceManifestDependencies,
    dependencies: {
      git: sourceManifestDependencies.git,
      teardown: {
        adapter,
        authorityIsolation: {
          async inspect() {
            return passingIsolationObservation();
          },
        },
        environment: {},
        loadRuntimeAuthority: (rootPath?: string) => loadPodmanRuntimeAuthority(rootPath),
        now: () => '2026-08-30T17:00:00',
      },
    },
  };
}

async function writePreflightAndSnapshot(
  harness: Awaited<ReturnType<typeof createRecoveryHarness>>,
  runtimeAuthority: LoadedPodmanRuntimeAuthority = AUTHORITY_A,
): Promise<void> {
  await writePreflightWithProducerManifest(harness, runtimeAuthority);
  await writeJson(join(harness.evidenceDirectory, 'runtime', 'runtime-authority-snapshot.json'),
    createFormalRuntimeAuthoritySnapshot({
      runIdentity: { ...IDENTITY, gitCommitSha: IDENTITY.gitCommitSha! },
      runtimeAuthority,
    }));
}

async function writePreflightWithProducerManifest(
  harness: Awaited<ReturnType<typeof createRecoveryHarness>>,
  runtimeAuthority: LoadedPodmanRuntimeAuthority = AUTHORITY_A,
): Promise<void> {
  await mkdir(harness.evidenceDirectory, { recursive: true, mode: 0o700 });
  const manifest = await buildProducerSourceManifest(
    harness.repositoryRoot,
    harness.sourceManifestDependencies,
  );
  const persisted = await writeProducerSourceManifest(harness.evidenceDirectory, manifest);
  await writePreflight(harness.evidenceDirectory, persisted.sha256, runtimeAuthority);
}

async function writePreflight(
  evidenceDirectory: string,
  producerSourceManifestSha256: string,
  runtimeAuthority: LoadedPodmanRuntimeAuthority,
): Promise<void> {
  const frozenInputs = {
    gitCommitSha: IDENTITY.gitCommitSha!,
    producerSourceManifestSha256,
    runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
  };
  await writeJson(join(evidenceDirectory, 'runtime', 'preflight.json'), {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: 'PASSED',
    runIdentity: IDENTITY,
    runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
    checks: [{
      id: 'git-frozen-inputs-readable',
      status: 'PASSED',
      observed: {
        readable: true,
        inputNames: Object.keys(frozenInputs).sort(),
        inputs: frozenInputs,
      },
    }, {
      id: 'runtime-authority',
      status: 'PASSED',
      observed: {
        runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
        runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
      },
    }],
  });
}

function fixtureSourceManifestDependencies(): SourceManifestDependencies {
  const bytesByPath = new Map(VERIFICATION_SOURCE_FILES.map((entry) => [
    entry.path,
    entry.path === RUNTIME_AUTHORITY_RELATIVE_PATH
      ? AUTHORITY_A_BYTES
      : Buffer.from(`source:${entry.path}`, 'utf8'),
  ]));
  return {
    repository: {
      async readState() {
        return {
          repositoryFullName: 'hospital/Hospital-DataIntelligence-Platform',
          gitCommitSha: PRODUCER_GIT_COMMIT_SHA,
          branch: 'phase-01-acceptance-readiness',
          worktreeStatus: 'CLEAN' as const,
        };
      },
    },
    workspace: {
      async readSourceFile(_repositoryRoot, path) {
        const bytes = bytesByPath.get(path);
        return bytes === undefined
          ? { kind: 'MISSING' as const }
          : { kind: 'REGULAR' as const, bytes };
      },
    },
    git: {
      async commitExists(_repositoryRoot, commitSha) {
        return commitSha === PRODUCER_GIT_COMMIT_SHA;
      },
      async readBlob(_repositoryRoot, commitSha, path) {
        const bytes = bytesByPath.get(path);
        if (commitSha !== PRODUCER_GIT_COMMIT_SHA || bytes === undefined) return null;
        return { mode: '100644', oid: gitBlobOid(bytes), bytes };
      },
    },
    clock: () => '2026-08-30T00:00:00.000Z',
  };
}

function fabricateAuthorityB(): LoadedPodmanRuntimeAuthority {
  const document = JSON.parse(AUTHORITY_A_BYTES.toString('utf8')) as Record<string, unknown>;
  const host = recordAt(recordAt(document, 'authority'), 'host');
  host['memoryToleranceBytes'] = Number(host['memoryToleranceBytes']) + 1;
  const parsed = parsePodmanRuntimeAuthority(document);
  const bytes = Buffer.from(JSON.stringify(document, null, 2) + '\n', 'utf8');
  return {
    authority: parsed.authority,
    runtimeAuthoritySha256: sha256(bytes),
    runtimeAuthoritySemanticDigest: sha256(Buffer.from(
      canonicalRuntimeAuthorityJson(parsed.authority),
      'utf8',
    )),
  };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobOid(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

async function writeCurrentDiskAuthority(
  repositoryRoot: string,
  state: 'invalid' | 'authority-b',
): Promise<void> {
  const path = join(repositoryRoot, RUNTIME_AUTHORITY_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  if (state === 'invalid') {
    await writeFile(path, '{broken', 'utf8');
    return;
  }
  const document = JSON.parse(await readFile(
    join(REPOSITORY_ROOT, RUNTIME_AUTHORITY_RELATIVE_PATH),
    'utf8',
  )) as Record<string, unknown>;
  const authority = recordAt(document, 'authority');
  const host = recordAt(authority, 'host');
  host['memoryToleranceBytes'] = Number(host['memoryToleranceBytes']) + 1;
  await writeFile(path, JSON.stringify(document, null, 2) + '\n', 'utf8');
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

class RecoveryTeardownAdapter implements FormalTeardownAdapter {
  readonly calls: string[] = [];
  current: RuntimeResourceRecord = {
    resourceType: 'container',
    id: 'runtime-postgres',
    name: `${IDENTITY.runtimeNamespace}_runtime-postgres`,
    labels: { ...formalRuntimeLabels(IDENTITY, AUTHORITY_A.authority) },
    source: 'podman-inspect',
    present: true,
    active: true,
    state: 'running',
    imageReference: null,
    imageId: null,
    imageDigest: null,
    ports: [],
    startedAt: null,
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
    restartPolicy: 'no',
  };

  async listResources(): Promise<readonly RuntimeResourceRecord[]> {
    return [this.current];
  }

  async reinspectResource(): Promise<RuntimeResourceRecord> {
    this.calls.push('reinspect:container:runtime-postgres');
    return this.current;
  }

  async stopProcess(): Promise<void> {
    throw new Error('UNEXPECTED_PROCESS_STOP');
  }

  async removeContainer(): Promise<void> {
    this.calls.push('remove-container:runtime-postgres');
    this.current = { ...this.current, present: false, active: false, state: 'removed' };
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

function passingIsolationObservation(): FormalPreflightAuthorityIsolationObservation {
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
    podmanMachineInspection: {
      status: 'NOT_APPLICABLE_NATIVE_ROOTFUL',
      applicability: 'NOT_APPLICABLE',
      nativeRuntime: true,
      rootless: false,
      runtimeSocketPath: AUTHORITY_A.authority.podman.socketPath,
      machineCommandSupported: false,
      registeredMachineCount: 0,
      runningMachineCount: 0,
      remoteConnectionCount: 0,
      registeredMachines: [],
      runningMachines: [],
      remoteConnections: [],
      failureCode: null,
      observedAt: '2026-09-01T12:04:15',
    },
    rootlessSocketPaths: [],
    otherWslBackends: [],
    podmanSocket: {
      path: AUTHORITY_A.authority.podman.socketPath,
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

function recordAt(value: unknown, key: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`TEST_RECORD_REQUIRED:${key}`);
  }
  const nested = (value as Record<string, unknown>)[key];
  if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) {
    throw new Error(`TEST_RECORD_REQUIRED:${key}`);
  }
  return nested as Record<string, unknown>;
}
