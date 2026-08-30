import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  formalRuntimeLabels,
  type FormalRunIdentity,
  type RuntimeCommandRunner,
} from './formal-runtime-contract.js';
import {
  assertSafeFormalCleanupCommand,
  belongsToRun,
  parseFormalRuntimeEventResources,
  performFormalTeardown,
  PodmanCliFormalTeardownAdapter,
  type FormalTeardownAdapter,
  type RuntimeResourceRecord,
  type RuntimeResourceSnapshot,
} from './formal-teardown.js';
import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.js';
import type { FormalPreflightAuthorityIsolationObservation } from './formal-preflight.js';

const IDENTITY: FormalRunIdentity = {
  runId: '12345678-1234-1234-1234-123456789abc',
  runSequence: 7,
  runtimeNamespace: 'hdi_phase01_abg_7_123456781234',
  gitCommitSha: 'a'.repeat(40),
};
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const RUNTIME_AUTHORITY = loadPodmanRuntimeAuthority(REPOSITORY_ROOT);

describe('formal ABG controlled teardown', () => {
  it('stops and removes only resources carrying every current-run label', async () => {
    const unrelated = resource('container', 'unrelated', {
      labels: { ...formalRuntimeLabels(IDENTITY), 'hdi.run-id': 'different-run-id' },
      name: 'other_namespace_unrelated',
    });
    const adapter = new FakeTeardownAdapter([
      resource('process', '101', { role: 'governance-api', pid: 101 }),
      resource('process', '102', { role: 'sim-consumer-a', pid: 102 }),
      resource('process', '103', { role: 'producer-live', pid: 103 }),
      resource('container', 'testcontainer-postgres'),
      resource('container', 'runtime-postgres'),
      resource('volume', 'runtime-postgres-data'),
      resource('network', 'runtime-network'),
      unrelated,
    ]);

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('PASSED');
    expect(adapter.calls).toEqual([
      'reinspect:process:101',
      'stop-process:101',
      'reinspect:process:102',
      'stop-process:102',
      'reinspect:process:103',
      'stop-process:103',
      'reinspect:container:testcontainer-postgres',
      'remove-container:testcontainer-postgres',
      'reinspect:container:runtime-postgres',
      'remove-container:runtime-postgres',
      'reinspect:volume:runtime-postgres-data',
      'remove-volume:runtime-postgres-data',
      'reinspect:network:runtime-network',
      'remove-network:runtime-network',
    ]);
    expect(adapter.current('unrelated')?.present).toBe(true);
    expect(adapter.calls.join(' ')).not.toMatch(/\bprune\b/u);
    expect(result.cleanup.pruneCommandsInvoked).toBe(false);
  });

  it('makes a container cleanup failure authoritative while attempting later exact resources', async () => {
    const adapter = new FakeTeardownAdapter([
      resource('container', 'runtime-postgres'),
      resource('volume', 'runtime-postgres-data'),
      resource('network', 'runtime-network'),
    ], new Set(['remove-container']));

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('FAILED');
    expect(result.cleanup.failedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceType: 'container',
        resourceId: 'runtime-postgres',
      }),
    ]));
    expect(adapter.calls).toEqual([
      'reinspect:container:runtime-postgres',
      'remove-container:runtime-postgres',
      'reinspect:volume:runtime-postgres-data',
      'remove-volume:runtime-postgres-data',
      'reinspect:network:runtime-network',
      'remove-network:runtime-network',
    ]);
  });

  it('rejects partial label matches as unrelated', () => {
    const exact = resource('container', 'exact');
    const partial = resource('container', 'partial', {
      labels: { ...formalRuntimeLabels(IDENTITY), 'hdi.run-sequence': '8' },
    });
    expect(belongsToRun(exact, IDENTITY)).toBe(true);
    expect(belongsToRun(partial, IDENTITY)).toBe(false);
  });

  it('permits only exact Podman removals and rejects prune, reset, bulk, and implicit volume deletion', () => {
    expect(() => assertSafeFormalCleanupCommand('podman', [
      'container', 'rm', '--force', 'exact-container-id',
    ])).not.toThrow();
    expect(() => assertSafeFormalCleanupCommand('podman', [
      'volume', 'rm', 'exact-volume-name',
    ])).not.toThrow();
    expect(() => assertSafeFormalCleanupCommand('podman', [
      'network', 'rm', 'exact-network-id',
    ])).not.toThrow();
    for (const args of [
      ['system', 'prune'],
      ['system', 'reset'],
      ['container', 'rm', '--all'],
      ['container', 'rm', '--force', '--volumes', 'container-id'],
      ['volume', 'rm', '*'],
    ]) expect(() => assertSafeFormalCleanupCommand('podman', args)).toThrow();
  });

  it('re-inspects immediately before deletion and preserves ownership drift', async () => {
    const candidate = resource('container', 'runtime-postgres');
    const adapter = new FakeTeardownAdapter([candidate]);
    adapter.reinspectOverrides.set(candidate.id, {
      ...candidate,
      labels: { ...candidate.labels, 'hdi.run-id': 'different-run' },
    });

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('FAILED');
    expect(adapter.calls).toEqual(['reinspect:container:runtime-postgres']);
    expect(adapter.current(candidate.id)?.present).toBe(true);
    expect(result.cleanup.failedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorCode: 'FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH' }),
    ]));
  });

  it.each([
    ['container', resource('container', 'runtime-postgres'),
      'Error: no such container runtime-postgres\n'],
    ['volume', resource('volume', 'runtime-postgres-data'),
      `Error: no such volume ${IDENTITY.runtimeNamespace}_runtime-postgres-data\n`],
    ['network', resource('network', 'runtime-network'),
      'Error: network runtime-network: network not found\n'],
  ] as const)(
    'treats only an exact Podman %s not-found result as absent during re-inspection',
    async (_resourceType, candidate, stderr) => {
      const adapter = podmanAdapterReturning({ exitCode: 125, stdout: '[]\n', stderr });

      await expect(adapter.reinspectResource(candidate, IDENTITY)).resolves.toBeNull();
    },
  );

  it.each([
    ['permission failure', resource('container', 'runtime-postgres'), 125,
      'Error: permission denied while opening /run/podman/podman.sock\n', 'CONTAINER'],
    ['socket failure', resource('volume', 'runtime-postgres-data'), 125,
      'Error: unable to connect to Podman socket: connection refused\n', 'VOLUME'],
    ['service failure', resource('network', 'runtime-network'), 125,
      'Error: podman service is unavailable\n', 'NETWORK'],
    ['wrong resource', resource('container', 'runtime-postgres'), 125,
      'Error: no such container a-different-container\n', 'CONTAINER'],
    ['wrong exit code', resource('container', 'runtime-postgres'), 1,
      'Error: no such container runtime-postgres\n', 'CONTAINER'],
  ] as const)(
    'fails closed with stable evidence when Podman re-inspection has a %s',
    async (_scenario, candidate, exitCode, stderr, stableResourceType) => {
      const adapter = podmanAdapterReturning({ exitCode, stdout: '[]\n', stderr });

      await expect(adapter.reinspectResource(candidate, IDENTITY))
        .rejects.toThrow('FORMAL_PODMAN_INSPECT_FAILED:' + stableResourceType);
    },
  );

  it('records a stable fail-closed cleanup action for an operational Podman re-inspection error', async () => {
    const candidate = resource('container', 'runtime-postgres');
    const podman = podmanAdapterReturning({
      exitCode: 125,
      stdout: '[]\n',
      stderr: 'Error: permission denied while opening /run/podman/podman.sock\n',
    });
    const adapter = new FakeTeardownAdapter([candidate]);
    adapter.reinspectDelegate = (resource, identity) => podman.reinspectResource(resource, identity);

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('FAILED');
    expect(adapter.calls).toEqual(['reinspect:container:runtime-postgres']);
    expect(result.cleanup.actions).toContainEqual(expect.objectContaining({
      action: 'VERIFY_RESOURCE',
      resourceType: 'container',
      resourceId: 'runtime-postgres',
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RESOURCE_REINSPECTION_FAILED:' +
        'FORMAL_PODMAN_INSPECT_FAILED:CONTAINER',
    }));
  });

  it('preserves exact-label resources whose names are not derived from the runtime namespace', async () => {
    const candidate = resource('volume', 'bad-name', { name: 'global-postgres-data' });
    const adapter = new FakeTeardownAdapter([candidate]);

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('FAILED');
    expect(adapter.calls).toEqual([]);
    expect(adapter.current(candidate.id)?.present).toBe(true);
    expect(result.cleanup.failedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorCode: 'FORMAL_CLEANUP_RESOURCE_NAME_MISMATCH' }),
    ]));
  });

  it('projects resource labels to governed ownership keys before returning evidence', async () => {
    const sensitiveValue = 'runtime-label-secret-that-must-not-enter-evidence';
    const adapter = new FakeTeardownAdapter([
      resource('container', 'runtime-postgres', {
        labels: { 'third-party.sensitive-label': sensitiveValue },
      }),
    ]);

    const result = await execute(adapter);

    expect(result.finalResources.resources[0]?.labels).toEqual(formalRuntimeLabels(IDENTITY));
    expect(JSON.stringify(result)).not.toContain('third-party.sensitive-label');
    expect(JSON.stringify(result)).not.toContain(sensitiveValue);
  });

  it('uses projected actual runtime-event labels instead of expected or arbitrary labels', () => {
    const resources = parseFormalRuntimeEventResources([{
      runId: IDENTITY.runId,
      event: 'STARTED',
      resourceType: 'container',
      id: 'runtime-postgres',
      name: `${IDENTITY.runtimeNamespace}_runtime-postgres`,
      labels: formalRuntimeLabels(IDENTITY),
      actualLabels: {
        ...formalRuntimeLabels(IDENTITY),
        'hdi.run-id': 'different-run',
        'third-party.sensitive-label': 'must-not-enter-event-evidence',
      },
    }], IDENTITY);

    expect(resources[0]?.labels).toEqual({
      ...formalRuntimeLabels(IDENTITY),
      'hdi.run-id': 'different-run',
    });
    expect(belongsToRun(resources[0]!, IDENTITY)).toBe(false);
    expect(JSON.stringify(resources)).not.toContain('third-party.sensitive-label');
    expect(JSON.stringify(resources)).not.toContain('must-not-enter-event-evidence');
  });

  it.each(['unless-stopped', 'always', 'on-failure', 'on-failure:3'])(
    'removes an exactly owned container with restart=%s but fails the cleanup evidence closed',
    async (restartPolicy) => {
      const adapter = new FakeTeardownAdapter([
        resource('container', 'runtime-postgres', { restartPolicy }),
      ]);

      const result = await execute(adapter);

      expect(adapter.calls).toEqual([
        'reinspect:container:runtime-postgres',
        'remove-container:runtime-postgres',
      ]);
      expect(result.cleanup.status).toBe('FAILED');
      expect(result.cleanup.restartPolicyFindings).toContainEqual(expect.objectContaining({
        actual: restartPolicy,
        status: 'FAILED',
      }));
    },
  );

  it('fails cleanup when the runtime authority changes after cleanup', async () => {
    const adapter = new FakeTeardownAdapter([]);
    const result = await execute(adapter, {
      runtimeAuthorityAfter: {
        ...RUNTIME_AUTHORITY,
        runtimeAuthoritySemanticDigest: 'f'.repeat(64),
      },
    });

    expect(result.cleanup.status).toBe('FAILED');
    expect(result.cleanup.runtimeAuthority?.stable).toBe(false);
    expect(result.cleanup.failedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorCode: 'FORMAL_CLEANUP_RUNTIME_AUTHORITY_DRIFT' }),
    ]));
  });

  it('reloads the post-cleanup authority from the same repository root', async () => {
    let observedRoot: string | undefined;
    const adapter = new FakeTeardownAdapter([]);
    const result = await execute(adapter, {
      onReloadRoot(root) { observedRoot = root; },
    });

    expect(result.cleanup.status).toBe('PASSED');
    expect(observedRoot).toBe(REPOSITORY_ROOT);
  });

  it.each([
    ['PATH-only Docker CLI', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, dockerExecutablePaths: ['D:/tools/docker'],
    }), 'FORMAL_PREFLIGHT_DOCKER_CLI_PRESENT'],
    ['broken Docker socket alias', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenSockets: [{
        path: '/run/docker.sock', kind: 'symbolic-link' as const, symbolicLink: true,
        target: '/missing/podman.sock',
      }],
    }), 'FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT'],
    ['Podman socket path drift', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanSocket: { ...value.podmanSocket, path: '/run/user/1000/podman/podman.sock' },
    }), 'FORMAL_PREFLIGHT_PODMAN_SOCKET_PATH_MISMATCH'],
    ['Podman socket regular file', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanSocket: { ...value.podmanSocket, kind: 'file' as const },
    }), 'FORMAL_PREFLIGHT_PODMAN_SOCKET_NOT_UNIX'],
    ['Podman socket symlink', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanSocket: { ...value.podmanSocket, symbolicLink: true },
    }), 'FORMAL_PREFLIGHT_PODMAN_SOCKET_SYMLINK'],
    ['rootless Podman', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanSocket: { ...value.podmanSocket, rootless: true },
    }), 'FORMAL_PREFLIGHT_PODMAN_ROOTFUL_REQUIRED'],
    ['inactive podman.socket', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanSocket: { ...value.podmanSocket, systemdActive: false },
    }), 'FORMAL_PREFLIGHT_PODMAN_SOCKET_INACTIVE'],
    ['Podman TCP service', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanSocket: { ...value.podmanSocket, tcpEndpoints: ['tcp://127.0.0.1:9999'] },
    }), 'FORMAL_PREFLIGHT_PODMAN_SOCKET_TCP_EXPOSED'],
    ['remote Podman connection', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanConnections: ['ssh://remote/run/podman/podman.sock'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_ENDPOINT_PRESENT'],
    ['Podman machine', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, podmanMachines: ['podman-machine-default'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'],
    ['rootless socket', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, rootlessSocketPaths: ['/run/user/1000/podman/podman.sock'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'],
    ['registered WSL backend', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value, otherWslBackends: ['docker-desktop'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'],
  ] as const)('applies the full preflight isolation policy after cleanup: %s', async (
    _name,
    mutate,
    errorCode,
  ) => {
    const adapter = new FakeTeardownAdapter([]);
    const result = await execute(adapter, {
      isolationObservation: mutate(passingIsolationObservation()) as
        FormalPreflightAuthorityIsolationObservation,
    });

    expect(result.cleanup.status).toBe('FAILED');
    expect(result.cleanup.dockerSecondAuthorityFindings).toEqual(expect.arrayContaining([
      expect.stringContaining(errorCode),
    ]));
  });

  it('fails cleanup on generated units, second authorities, or incomplete partial recovery', async () => {
    const adapter = new FakeTeardownAdapter([]);
    adapter.terminalFindings = {
      persistenceFindings: ['quadlet:' + IDENTITY.runtimeNamespace],
      dockerSecondAuthorityFindings: ['tcp://127.0.0.1:2375'],
      partialStartupRecoveryFindings: ['POSTGRES_CONTAINER_REMOVE_FAILED'],
    };

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('FAILED');
    expect(result.cleanup.persistenceFindings).toEqual(adapter.terminalFindings.persistenceFindings);
    expect(result.cleanup.dockerSecondAuthorityFindings)
      .toEqual(adapter.terminalFindings.dockerSecondAuthorityFindings);
    expect(result.cleanup.partialStartupRecoveryFindings)
      .toEqual(adapter.terminalFindings.partialStartupRecoveryFindings);
  });

  it('does not append contradictory PASSED finding actions after terminal inspection fails', async () => {
    const adapter = new FakeTeardownAdapter([]);
    adapter.terminalInspectionFailure = true;

    const result = await execute(adapter);

    expect(result.cleanup.status).toBe('FAILED');
    expect(result.cleanup.actions).toContainEqual(expect.objectContaining({
      action: 'VERIFY_RUNTIME_ISOLATION',
      status: 'FAILED',
    }));
    expect(result.cleanup.actions).not.toContainEqual(expect.objectContaining({
      action: 'VERIFY_RUNTIME_ISOLATION',
      status: 'PASSED',
    }));
    expect(result.cleanup.actions).not.toContainEqual(expect.objectContaining({
      action: 'VERIFY_PERSISTENCE',
      status: 'PASSED',
    }));
    expect(result.cleanup.actions).not.toContainEqual(expect.objectContaining({
      action: 'VERIFY_PARTIAL_RECOVERY',
      status: 'PASSED',
    }));
  });
});

async function execute(
  adapter: FormalTeardownAdapter,
  options: {
    readonly runtimeAuthorityAfter?: typeof RUNTIME_AUTHORITY;
    readonly isolationObservation?: FormalPreflightAuthorityIsolationObservation;
    readonly onReloadRoot?: (repositoryRoot?: string) => void;
  } = {},
) {
  return performFormalTeardown({
    identity: IDENTITY,
    repositoryRoot: REPOSITORY_ROOT,
    runtimeEventDirectory: 'D:/evidence/runtime/events',
    runtimeAuthority: RUNTIME_AUTHORITY,
  }, {
    adapter,
    loadRuntimeAuthority: (repositoryRoot) => {
      options.onReloadRoot?.(repositoryRoot);
      return options.runtimeAuthorityAfter ?? RUNTIME_AUTHORITY;
    },
    authorityIsolation: {
      async inspect() {
        return options.isolationObservation ?? passingIsolationObservation();
      },
    },
    environment: {},
    now: () => '2026-08-27T12:00:00',
  });
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
      path: RUNTIME_AUTHORITY.authority.podman.socketPath,
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

function podmanAdapterReturning(result: {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr: string;
}): PodmanCliFormalTeardownAdapter {
  const runner: RuntimeCommandRunner = {
    async run() {
      return {
        exitCode: result.exitCode,
        signal: null,
        stdout: result.stdout ?? '',
        stderr: result.stderr,
      };
    },
  };
  return new PodmanCliFormalTeardownAdapter(runner);
}

class FakeTeardownAdapter implements FormalTeardownAdapter {
  readonly calls: string[] = [];
  readonly reinspectOverrides = new Map<string, RuntimeResourceRecord | null>();
  reinspectDelegate?: FormalTeardownAdapter['reinspectResource'];
  terminalFindings = {
    persistenceFindings: [] as readonly string[],
    dockerSecondAuthorityFindings: [] as readonly string[],
    partialStartupRecoveryFindings: [] as readonly string[],
  };
  terminalInspectionFailure = false;
  private readonly resources = new Map<string, RuntimeResourceRecord>();

  constructor(
    resources: readonly RuntimeResourceRecord[],
    private readonly failures = new Set<string>(),
  ) {
    for (const candidate of resources) this.resources.set(candidate.id, candidate);
  }

  current(id: string): RuntimeResourceRecord | undefined {
    return this.resources.get(id);
  }

  async listResources(): Promise<readonly RuntimeResourceRecord[]> {
    return [...this.resources.values()];
  }

  async reinspectResource(
    candidate: RuntimeResourceRecord,
    identity: FormalRunIdentity,
  ): Promise<RuntimeResourceRecord | null> {
    this.calls.push(`reinspect:${candidate.resourceType}:${candidate.id}`);
    if (this.reinspectDelegate !== undefined) return this.reinspectDelegate(candidate, identity);
    return this.reinspectOverrides.has(candidate.id)
      ? (this.reinspectOverrides.get(candidate.id) ?? null)
      : (this.resources.get(candidate.id) ?? null);
  }

  async stopProcess(candidate: RuntimeResourceRecord): Promise<void> {
    this.calls.push('stop-process:' + candidate.id);
    this.maybeFail('stop-process');
    this.markAbsent(candidate.id);
  }

  async removeContainer(candidate: RuntimeResourceRecord): Promise<void> {
    this.calls.push('remove-container:' + candidate.id);
    this.maybeFail('remove-container');
    this.markAbsent(candidate.id);
  }

  async removeVolume(candidate: RuntimeResourceRecord): Promise<void> {
    this.calls.push('remove-volume:' + candidate.id);
    this.maybeFail('remove-volume');
    this.markAbsent(candidate.id);
  }

  async removeNetwork(candidate: RuntimeResourceRecord): Promise<void> {
    this.calls.push('remove-network:' + candidate.id);
    this.maybeFail('remove-network');
    this.markAbsent(candidate.id);
  }

  async inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']> {
    return ports.map((port) => ({ port, occupied: false, verificationError: null }));
  }

  async inspectTerminalState() {
    if (this.terminalInspectionFailure) throw new Error('INJECTED_TERMINAL_INSPECTION_FAILURE');
    return this.terminalFindings;
  }

  private maybeFail(operation: string): void {
    if (this.failures.has(operation)) throw new Error('INJECTED_' + operation.toUpperCase());
  }

  private markAbsent(id: string): void {
    const candidate = this.resources.get(id);
    if (candidate === undefined) return;
    this.resources.set(id, { ...candidate, present: false, active: false, state: 'REMOVED' });
  }
}

function resource(
  resourceType: RuntimeResourceRecord['resourceType'],
  id: string,
  options: {
    readonly labels?: Readonly<Record<string, string>>;
    readonly role?: string;
    readonly pid?: number;
    readonly name?: string;
    readonly restartPolicy?: string;
  } = {},
): RuntimeResourceRecord {
  const labels = {
    ...formalRuntimeLabels(IDENTITY),
    ...options.labels,
  };
  return {
    resourceType,
    id,
    name: options.name ?? (resourceType === 'process' ? id : `${IDENTITY.runtimeNamespace}_${id}`),
    labels,
    source: resourceType === 'process' ? 'runtime-event' : 'podman-inspect',
    present: true,
    active: resourceType === 'process' || resourceType === 'container',
    state: 'RUNNING',
    imageReference: resourceType === 'container' ? 'postgres@sha256:' + '1'.repeat(64) : null,
    imageId: resourceType === 'container' ? 'sha256:' + '2'.repeat(64) : null,
    imageDigest: resourceType === 'container' ? 'sha256:' + '1'.repeat(64) : null,
    ports: [],
    startedAt: '2026-08-27T11:59:00',
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
    restartPolicy: resourceType === 'container' ? (options.restartPolicy ?? 'no') : null,
    ...(options.role === undefined ? {} : { role: options.role }),
    ...(options.pid === undefined ? {} : { pid: options.pid }),
  };
}
