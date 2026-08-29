import { describe, expect, it } from 'vitest';
import {
  formalRuntimeLabels,
  type FormalRunIdentity,
} from './formal-runtime-contract.js';
import {
  belongsToRun,
  performFormalTeardown,
  type FormalTeardownAdapter,
  type RuntimeResourceRecord,
  type RuntimeResourceSnapshot,
} from './formal-teardown.js';

const IDENTITY: FormalRunIdentity = {
  runId: '12345678-1234-1234-1234-123456789abc',
  runSequence: 7,
  runtimeNamespace: 'hdi_phase01_abg_7_123456781234',
  gitCommitSha: 'a'.repeat(40),
};

describe('formal ABG controlled teardown', () => {
  it('stops and removes only resources carrying every current-run label', async () => {
    const unrelated = resource('container', 'unrelated', {
      labels: { ...formalRuntimeLabels(IDENTITY), 'hdi.run-id': 'different-run-id' },
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
      'stop-process:101',
      'stop-process:102',
      'stop-process:103',
      'remove-container:testcontainer-postgres',
      'remove-container:runtime-postgres',
      'remove-volume:runtime-postgres-data',
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
      'remove-container:runtime-postgres',
      'remove-volume:runtime-postgres-data',
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
});

async function execute(adapter: FormalTeardownAdapter) {
  return performFormalTeardown({
    identity: IDENTITY,
    runtimeEventDirectory: 'D:/evidence/runtime/events',
  }, {
    adapter,
    now: () => '2026-08-27T12:00:00',
  });
}

class FakeTeardownAdapter implements FormalTeardownAdapter {
  readonly calls: string[] = [];
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
  } = {},
): RuntimeResourceRecord {
  const labels = {
    ...formalRuntimeLabels(IDENTITY),
    ...options.labels,
  };
  return {
    resourceType,
    id,
    name: id,
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
    ...(options.role === undefined ? {} : { role: options.role }),
    ...(options.pid === undefined ? {} : { pid: options.pid }),
  };
}
