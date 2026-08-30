import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
  createFormalRuntimeAuthoritySnapshot,
  loadPodmanRuntimeAuthority,
  RUNTIME_AUTHORITY_RELATIVE_PATH,
} from './podman-runtime-authority.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const AUTHORITY_A = loadPodmanRuntimeAuthority(REPOSITORY_ROOT);
const IDENTITY: FormalRunIdentity = {
  runId: '12345678-1234-1234-1234-123456789abc',
  runSequence: 7,
  runtimeNamespace: 'hdi_phase01_abg_7_123456781234',
  gitCommitSha: 'a'.repeat(40),
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
      await writePreflightAndSnapshot(harness.evidenceDirectory);
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
    await writePreflight(harness.evidenceDirectory);

    await expect(runControlledTeardownCli({
      evidenceDirectory: harness.evidenceDirectory,
      repositoryRoot: harness.repositoryRoot,
    }, harness.dependencies)).rejects.toThrow('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_MISSING');
    expect(harness.adapter.calls).toEqual([]);
    expect(harness.adapter.current.present).toBe(true);
  });

  it('rejects a semantically tampered frozen snapshot before any resource mutation', async () => {
    const harness = await createRecoveryHarness();
    await writePreflightAndSnapshot(harness.evidenceDirectory);
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
    await writePreflightAndSnapshot(harness.evidenceDirectory);
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
});

async function createRecoveryHarness() {
  const root = await mkdtemp(join(tmpdir(), 'hdi-standalone-teardown-'));
  roots.push(root);
  const repositoryRoot = join(root, 'repository');
  const evidenceDirectory = join(root, 'evidence', 'run-7');
  const adapter = new RecoveryTeardownAdapter();
  return {
    repositoryRoot,
    evidenceDirectory,
    adapter,
    dependencies: {
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
  };
}

async function writePreflightAndSnapshot(evidenceDirectory: string): Promise<void> {
  await writePreflight(evidenceDirectory);
  await writeJson(join(evidenceDirectory, 'runtime', 'runtime-authority-snapshot.json'),
    createFormalRuntimeAuthoritySnapshot({
      runIdentity: { ...IDENTITY, gitCommitSha: IDENTITY.gitCommitSha! },
      runtimeAuthority: AUTHORITY_A,
    }));
}

async function writePreflight(evidenceDirectory: string): Promise<void> {
  await writeJson(join(evidenceDirectory, 'runtime', 'preflight.json'), {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: 'PASSED',
    runIdentity: IDENTITY,
    runtimeAuthoritySha256: AUTHORITY_A.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: AUTHORITY_A.runtimeAuthoritySemanticDigest,
    checks: [{
      id: 'runtime-authority',
      status: 'PASSED',
      observed: {
        runtimeAuthoritySha256: AUTHORITY_A.runtimeAuthoritySha256,
        runtimeAuthoritySemanticDigest: AUTHORITY_A.runtimeAuthoritySemanticDigest,
      },
    }],
  });
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
    podmanConnections: [],
    podmanMachines: [],
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
