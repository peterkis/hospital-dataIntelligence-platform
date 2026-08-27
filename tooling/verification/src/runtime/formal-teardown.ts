import { randomUUID } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  FORMAL_RUNTIME_PORTS,
  SpawnRuntimeCommandRunner,
  createFormalRunSeed,
  errorMessage,
  formalRuntimeLabels,
  localNowInAsiaShanghai,
  type FormalRunIdentity,
  type RuntimeCommandRunner,
} from './formal-runtime-contract.ts';
import {
  inspectWslHost,
  wslConfigurationMatchesFrozenEnvelope,
  type WslHostEvidence,
} from './formal-wsl-host.ts';
import { FROZEN_WSL_ENVELOPE } from './formal-wsl-envelope.ts';

export type RuntimeResourceType = 'process' | 'container' | 'volume' | 'network';

export interface RuntimePortBinding {
  readonly containerPort: string;
  readonly hostIp: string | null;
  readonly hostPort: number | null;
}

export interface RuntimeResourceRecord {
  readonly resourceType: RuntimeResourceType;
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly source: 'docker-inspect' | 'runtime-event';
  readonly present: boolean;
  readonly active: boolean;
  readonly state: string | null;
  readonly imageReference: string | null;
  readonly imageId: string | null;
  readonly imageDigest: string | null;
  readonly ports: readonly RuntimePortBinding[];
  readonly startedAt: string | null;
  readonly stoppedAt: string | null;
  readonly exitStatus: number | string | null;
  readonly metrics: Readonly<Record<string, string>> | null;
  readonly pid?: number;
  readonly role?: string;
}

export interface RuntimeResourceSnapshot {
  readonly schemaVersion: 'phase-01.formal-runtime-resources.v1';
  readonly runIdentity: FormalRunIdentity;
  readonly capturedAt: string;
  readonly resources: readonly RuntimeResourceRecord[];
  readonly ports: readonly {
    readonly port: number;
    readonly occupied: boolean;
    readonly verificationError: string | null;
  }[];
  readonly environment?: RuntimeEnvironmentObservation | null;
  readonly environmentCaptureFailure?: string | null;
  readonly captureFailure?: string;
}

export interface RuntimeEnvironmentObservation {
  readonly status: 'PASSED' | 'FAILED';
  readonly failureCodes: readonly string[];
  readonly host: WslHostEvidence;
  readonly guest: {
    readonly distribution: string | null;
    readonly processorCount: number;
    readonly memoryTotalBytes: number;
    readonly swapTotalBytes: number;
    readonly swapDevices: readonly string[];
    readonly rootBlockDevice: string;
    readonly rootBlockDeviceSizeBytes: number;
  };
}

export interface CleanupAction {
  readonly ordinal: number;
  readonly occurredAt: string;
  readonly action: 'STOP_PROCESS' | 'REMOVE_TESTCONTAINER' | 'COMPOSE_DOWN' |
    'REMOVE_CONTAINER' | 'REMOVE_VOLUME' | 'REMOVE_NETWORK' | 'VERIFY_PORT' |
    'VERIFY_ENVIRONMENT';
  readonly resourceType: RuntimeResourceType | 'compose-project' | 'port' | 'runtime';
  readonly resourceId: string;
  readonly resourceName: string;
  readonly status: 'PASSED' | 'FAILED' | 'SKIPPED';
  readonly errorCode: string | null;
}

export interface FormalCleanupReport {
  readonly schemaVersion: 'phase-01.formal-cleanup.v1';
  readonly runIdentity: FormalRunIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: 'PASSED' | 'FAILED';
  readonly actions: readonly CleanupAction[];
  readonly failedItems: readonly {
    readonly resourceType: string;
    readonly resourceId: string;
    readonly resourceName: string;
    readonly errorCode: string;
  }[];
  readonly residualResources: readonly RuntimeResourceRecord[];
  readonly occupiedPorts: readonly number[];
  readonly pruneCommandsInvoked: false;
}

export interface FormalTeardownAdapter {
  listResources(identity: FormalRunIdentity, runtimeEventDirectory: string): Promise<readonly RuntimeResourceRecord[]>;
  stopProcess(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void>;
  removeContainer(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void>;
  composeDown(identity: FormalRunIdentity, composeFile: string): Promise<void>;
  removeVolume(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void>;
  removeNetwork(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void>;
  inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']>;
  inspectEnvironment?(): Promise<RuntimeEnvironmentObservation>;
}

export interface FormalTeardownDependencies {
  readonly adapter: FormalTeardownAdapter;
  readonly now: () => string;
}

export function createDefaultFormalTeardownDependencies(): FormalTeardownDependencies {
  return {
    adapter: new DockerCliFormalTeardownAdapter(new SpawnRuntimeCommandRunner()),
    now: localNowInAsiaShanghai,
  };
}

export async function captureFormalRuntimeResources(
  input: {
    readonly identity: FormalRunIdentity;
    readonly runtimeEventDirectory: string;
  },
  dependencies: FormalTeardownDependencies = createDefaultFormalTeardownDependencies(),
): Promise<RuntimeResourceSnapshot> {
  const resources = (await dependencies.adapter.listResources(
    input.identity,
    input.runtimeEventDirectory,
  )).filter((resource) => belongsToRun(resource, input.identity));
  let environment: RuntimeEnvironmentObservation | null = null;
  let environmentCaptureFailure: string | null = null;
  if (dependencies.adapter.inspectEnvironment !== undefined) {
    try {
      environment = await dependencies.adapter.inspectEnvironment();
    } catch (error) {
      environmentCaptureFailure = stableError(error);
    }
  }
  return {
    schemaVersion: 'phase-01.formal-runtime-resources.v1',
    runIdentity: input.identity,
    capturedAt: dependencies.now(),
    resources: stableResources(resources),
    ports: await dependencies.adapter.inspectPorts(FORMAL_RUNTIME_PORTS),
    environment,
    environmentCaptureFailure,
  };
}

export async function performFormalTeardown(
  input: {
    readonly identity: FormalRunIdentity;
    readonly runtimeEventDirectory: string;
    readonly composeFile: string;
  },
  dependencies: FormalTeardownDependencies = createDefaultFormalTeardownDependencies(),
): Promise<{ readonly cleanup: FormalCleanupReport; readonly finalResources: RuntimeResourceSnapshot }> {
  const startedAt = dependencies.now();
  const actions: CleanupAction[] = [];
  const addAction = (
    action: Omit<CleanupAction, 'ordinal' | 'occurredAt'>,
  ) => actions.push({ ordinal: actions.length + 1, occurredAt: dependencies.now(), ...action });
  let resources: readonly RuntimeResourceRecord[] = [];
  try {
    resources = await dependencies.adapter.listResources(input.identity, input.runtimeEventDirectory);
  } catch (error) {
    addAction({
      action: 'COMPOSE_DOWN',
      resourceType: 'compose-project',
      resourceId: input.identity.composeProjectName,
      resourceName: input.identity.composeProjectName,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RESOURCE_DISCOVERY_FAILED:' + stableError(error),
    });
  }

  const exactResources = resources.filter((resource) => belongsToRun(resource, input.identity));
  const processOrder = (resource: RuntimeResourceRecord): number => {
    if (resource.role === 'governance-api') return 0;
    if (resource.role?.startsWith('sim-consumer') === true) return 1;
    return 2;
  };
  for (const resource of exactResources.filter((candidate) =>
    candidate.resourceType === 'process' && candidate.active,
  ).sort((left, right) => processOrder(left) - processOrder(right))) {
    await attempt(addAction, {
      action: 'STOP_PROCESS',
      resourceType: resource.resourceType,
      resourceId: resource.id,
      resourceName: resource.name,
    }, () => dependencies.adapter.stopProcess(resource, input.identity));
  }

  for (const resource of exactResources.filter((candidate) =>
    candidate.resourceType === 'container' &&
    candidate.present &&
    candidate.labels['com.docker.compose.project'] !== input.identity.composeProjectName,
  )) {
    await attempt(addAction, {
      action: 'REMOVE_TESTCONTAINER',
      resourceType: resource.resourceType,
      resourceId: resource.id,
      resourceName: resource.name,
    }, () => dependencies.adapter.removeContainer(resource, input.identity));
  }

  const composeProjectResources = resources.filter((resource) =>
    resource.labels['com.docker.compose.project'] === input.identity.composeProjectName,
  );
  if (composeProjectResources.some((resource) => !belongsToRun(resource, input.identity))) {
    addAction({
      action: 'COMPOSE_DOWN',
      resourceType: 'compose-project',
      resourceId: input.identity.composeProjectName,
      resourceName: input.identity.composeProjectName,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_COMPOSE_OWNERSHIP_MISMATCH',
    });
  } else if (composeProjectResources.length > 0) {
    await attempt(addAction, {
      action: 'COMPOSE_DOWN',
      resourceType: 'compose-project',
      resourceId: input.identity.composeProjectName,
      resourceName: input.identity.composeProjectName,
    }, () => dependencies.adapter.composeDown(input.identity, input.composeFile));
  } else {
    addAction({
      action: 'COMPOSE_DOWN',
      resourceType: 'compose-project',
      resourceId: input.identity.composeProjectName,
      resourceName: input.identity.composeProjectName,
      status: 'SKIPPED',
      errorCode: null,
    });
  }

  let afterCompose = resources;
  try {
    afterCompose = await dependencies.adapter.listResources(input.identity, input.runtimeEventDirectory);
  } catch (error) {
    addAction({
      action: 'COMPOSE_DOWN',
      resourceType: 'compose-project',
      resourceId: input.identity.composeProjectName,
      resourceName: input.identity.composeProjectName,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_POST_COMPOSE_DISCOVERY_FAILED:' + stableError(error),
    });
  }
  for (const resource of afterCompose.filter((candidate) =>
    belongsToRun(candidate, input.identity) && candidate.present,
  )) {
    if (resource.resourceType === 'container') {
      await attempt(addAction, {
        action: 'REMOVE_CONTAINER',
        resourceType: resource.resourceType,
        resourceId: resource.id,
        resourceName: resource.name,
      }, () => dependencies.adapter.removeContainer(resource, input.identity));
    } else if (resource.resourceType === 'volume') {
      await attempt(addAction, {
        action: 'REMOVE_VOLUME',
        resourceType: resource.resourceType,
        resourceId: resource.id,
        resourceName: resource.name,
      }, () => dependencies.adapter.removeVolume(resource, input.identity));
    } else if (resource.resourceType === 'network') {
      await attempt(addAction, {
        action: 'REMOVE_NETWORK',
        resourceType: resource.resourceType,
        resourceId: resource.id,
        resourceName: resource.name,
      }, () => dependencies.adapter.removeNetwork(resource, input.identity));
    }
  }

  let finalResources: RuntimeResourceSnapshot;
  try {
    finalResources = await captureFormalRuntimeResources({
      identity: input.identity,
      runtimeEventDirectory: input.runtimeEventDirectory,
    }, dependencies);
  } catch (error) {
    addAction({
      action: 'COMPOSE_DOWN',
      resourceType: 'compose-project',
      resourceId: input.identity.composeProjectName,
      resourceName: input.identity.composeProjectName,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_FINAL_SNAPSHOT_FAILED:' + stableError(error),
    });
    finalResources = {
      schemaVersion: 'phase-01.formal-runtime-resources.v1',
      runIdentity: input.identity,
      capturedAt: dependencies.now(),
      resources: [],
      ports: FORMAL_RUNTIME_PORTS.map((port) => ({
        port,
        occupied: true,
        verificationError: 'FINAL_SNAPSHOT_UNAVAILABLE',
      })),
    };
  }

  for (const port of finalResources.ports) {
    addAction({
      action: 'VERIFY_PORT',
      resourceType: 'port',
      resourceId: String(port.port),
      resourceName: '127.0.0.1:' + port.port,
      status: !port.occupied && port.verificationError === null ? 'PASSED' : 'FAILED',
      errorCode: port.verificationError ?? (port.occupied ? 'FORMAL_CLEANUP_PORT_STILL_OCCUPIED' : null),
    });
  }
  if (
    finalResources.environmentCaptureFailure !== null &&
    finalResources.environmentCaptureFailure !== undefined
  ) {
    addAction({
      action: 'VERIFY_ENVIRONMENT',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: 'WSL-capacity-envelope',
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_ENVIRONMENT_AUDIT_FAILED:' +
        finalResources.environmentCaptureFailure,
    });
  } else if (finalResources.environment !== null && finalResources.environment !== undefined) {
    addAction({
      action: 'VERIFY_ENVIRONMENT',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: 'WSL-capacity-envelope',
      status: finalResources.environment.status,
      errorCode: finalResources.environment.status === 'PASSED'
        ? null
        : 'FORMAL_CLEANUP_ENVIRONMENT_DRIFT:' + finalResources.environment.failureCodes.join(','),
    });
  }

  const residualResources = finalResources.resources.filter((resource) => resource.present);
  const occupiedPorts = finalResources.ports.filter((port) => port.occupied || port.verificationError !== null)
    .map((port) => port.port);
  const failedItems = actions.filter((action) => action.status === 'FAILED').map((action) => ({
    resourceType: action.resourceType,
    resourceId: action.resourceId,
    resourceName: action.resourceName,
    errorCode: action.errorCode ?? 'FORMAL_CLEANUP_ACTION_FAILED',
  }));
  const cleanup: FormalCleanupReport = {
    schemaVersion: 'phase-01.formal-cleanup.v1',
    runIdentity: input.identity,
    startedAt,
    completedAt: dependencies.now(),
    status: failedItems.length === 0 && residualResources.length === 0 && occupiedPorts.length === 0
      ? 'PASSED'
      : 'FAILED',
    actions,
    failedItems,
    residualResources,
    occupiedPorts,
    pruneCommandsInvoked: false,
  };
  return { cleanup, finalResources };
}

export function belongsToRun(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
): boolean {
  const expected = formalRuntimeLabels(identity);
  return Object.entries(expected).every(([name, value]) => resource.labels[name] === value);
}

class DockerCliFormalTeardownAdapter implements FormalTeardownAdapter {
  private readonly runner: RuntimeCommandRunner;

  constructor(runner: RuntimeCommandRunner) {
    this.runner = runner;
  }

  async listResources(
    identity: FormalRunIdentity,
    runtimeEventDirectory: string,
  ): Promise<readonly RuntimeResourceRecord[]> {
    const docker = [
      ...await this.listDockerContainers(),
      ...await this.listDockerVolumes(),
      ...await this.listDockerNetworks(),
    ];
    const events = await readRuntimeEvents(runtimeEventDirectory, identity);
    return mergeDockerAndEventResources(docker, events);
  }

  async stopProcess(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void> {
    if (resource.pid === undefined) throw new Error('FORMAL_CLEANUP_PROCESS_PID_MISSING');
    if (!isProcessAlive(resource.pid)) return;
    const environmentPath = `/proc/${resource.pid}/environ`;
    let owned = false;
    try {
      const environment = await readFile(environmentPath);
      owned = environment.includes(Buffer.from(`ABG_RUN_ID=${identity.runId}\0`, 'utf8'));
    } catch {
      owned = false;
    }
    if (!owned) throw new Error('FORMAL_CLEANUP_PROCESS_OWNERSHIP_UNVERIFIED');
    process.kill(resource.pid, 'SIGTERM');
    for (let attempt = 0; attempt < 50 && isProcessAlive(resource.pid); attempt += 1) {
      await delay(100);
    }
    if (isProcessAlive(resource.pid)) process.kill(resource.pid, 'SIGKILL');
  }

  async removeContainer(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void> {
    await this.assertDockerResourceOwned('container', resource.id, identity);
    await requireSuccess(this.runner, 'docker', ['container', 'rm', '--force', '--volumes', resource.id]);
  }

  async composeDown(identity: FormalRunIdentity, composeFile: string): Promise<void> {
    const currentProjectResources = [
      ...await this.listDockerContainers(),
      ...await this.listDockerVolumes(),
      ...await this.listDockerNetworks(),
    ].filter((resource) =>
      resource.labels['com.docker.compose.project'] === identity.composeProjectName,
    );
    if (
      currentProjectResources.length === 0 ||
      currentProjectResources.some((resource) => !belongsToRun(resource, identity))
    ) throw new Error('FORMAL_CLEANUP_COMPOSE_OWNERSHIP_MISMATCH');
    await requireSuccess(this.runner, 'docker', [
      'compose',
      '--project-name', identity.composeProjectName,
      '--file', composeFile,
      'down',
      '--volumes',
      '--timeout', '10',
    ], {
      ABG_RUN_ID: identity.runId,
      ABG_RUN_SEQUENCE: String(identity.runSequence),
      ABG_COMPOSE_PROJECT_NAME: identity.composeProjectName,
      ABG_MANAGED_BY: 'formal-abg',
      COMPOSE_PROJECT_NAME: identity.composeProjectName,
      HDI_POSTGRES_PASSWORD: 'controlled-cleanup-placeholder',
      HDI_KEYCLOAK_ADMIN_USERNAME: 'controlled-cleanup-placeholder',
      HDI_KEYCLOAK_ADMIN_PASSWORD: 'controlled-cleanup-placeholder',
      HDI_KEYCLOAK_REALM_IMPORT_DIR: resolve('.runtime/controlled-cleanup-placeholder'),
    });
  }

  async removeVolume(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void> {
    await this.assertDockerResourceOwned('volume', resource.name, identity);
    await requireSuccess(this.runner, 'docker', ['volume', 'rm', resource.name]);
  }

  async removeNetwork(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void> {
    await this.assertDockerResourceOwned('network', resource.id, identity);
    await requireSuccess(this.runner, 'docker', ['network', 'rm', resource.id]);
  }

  async inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']> {
    return Promise.all(ports.map((port) => inspectPort(port)));
  }

  async inspectEnvironment(): Promise<RuntimeEnvironmentObservation> {
    const host = await inspectWslHost(this.runner);
    const processorCount = Number.parseInt(await requireText(this.runner, 'nproc', []), 10);
    const memInfo = await readFile('/proc/meminfo', 'utf8');
    const memoryTotalBytes = memInfoBytes(memInfo, 'MemTotal');
    const swapTotalBytes = memInfoBytes(memInfo, 'SwapTotal');
    const swapDevicesText = await requireText(this.runner, 'swapon', [
      '--show', '--noheadings',
    ]);
    const swapDevices = swapDevicesText.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    const rootBlockDevice = await requireText(this.runner, 'findmnt', ['-n', '-o', 'SOURCE', '/']);
    const rootBlockDeviceSizeBytes = Number.parseInt(await requireText(this.runner, 'lsblk', [
      '-b', '-n', '-o', 'SIZE', rootBlockDevice,
    ]), 10);
    const failureCodes: string[] = [];
    if (
      host.runningDistributions.length !== 1 ||
      host.runningDistributions[0] !== FROZEN_WSL_ENVELOPE.distribution
    ) failureCodes.push('FORMAL_RUNTIME_WSL_RUNNING_SET_MISMATCH');
    if (!wslConfigurationMatchesFrozenEnvelope(host.configuration)) {
      failureCodes.push('FORMAL_RUNTIME_WSLCONFIG_MISMATCH');
    }
    if (process.env['WSL_DISTRO_NAME'] !== FROZEN_WSL_ENVELOPE.distribution) {
      failureCodes.push('FORMAL_RUNTIME_WSL_DISTRO_MISMATCH');
    }
    if (processorCount !== FROZEN_WSL_ENVELOPE.processorCount) {
      failureCodes.push('FORMAL_RUNTIME_WSL_CPU_MISMATCH');
    }
    if (
      Math.abs(memoryTotalBytes - FROZEN_WSL_ENVELOPE.memoryBytes) >
      FROZEN_WSL_ENVELOPE.memoryToleranceBytes
    ) {
      failureCodes.push('FORMAL_RUNTIME_WSL_MEMORY_MISMATCH');
    }
    if (swapTotalBytes !== FROZEN_WSL_ENVELOPE.swapBytes || swapDevices.length !== 0) {
      failureCodes.push('FORMAL_RUNTIME_WSL_SWAP_NONZERO');
    }
    if (
      Math.abs(rootBlockDeviceSizeBytes - FROZEN_WSL_ENVELOPE.rootDeviceBytes) >
      FROZEN_WSL_ENVELOPE.rootSizeToleranceBytes
    ) {
      failureCodes.push('FORMAL_RUNTIME_WSL_ROOT_DEVICE_MISMATCH');
    }
    return {
      status: failureCodes.length === 0 ? 'PASSED' : 'FAILED',
      failureCodes,
      host,
      guest: {
        distribution: process.env['WSL_DISTRO_NAME'] ?? null,
        processorCount,
        memoryTotalBytes,
        swapTotalBytes,
        swapDevices,
        rootBlockDevice,
        rootBlockDeviceSizeBytes,
      },
    };
  }

  private async listDockerContainers(): Promise<readonly RuntimeResourceRecord[]> {
    const ids = await listIds(this.runner, ['container', 'ls', '--all', '--quiet']);
    return Promise.all(ids.map(async (id) => {
      const inspected = await inspectOne(this.runner, ['container', 'inspect', id]);
      const config = recordField(inspected, 'Config');
      const state = recordField(inspected, 'State');
      const network = recordField(inspected, 'NetworkSettings');
      const labels = stringRecord(config['Labels']);
      const imageReference = stringOrNull(config['Image']);
      const ports = parsePortBindings(network['Ports']);
      const metrics = state['Running'] === true ? await readDockerStats(this.runner, id) : null;
      return {
        resourceType: 'container' as const,
        id: stringOrEmpty(inspected['Id']),
        name: stringOrEmpty(inspected['Name']).replace(/^\//u, ''),
        labels,
        source: 'docker-inspect' as const,
        present: true,
        active: state['Running'] === true,
        state: stringOrNull(state['Status']),
        imageReference,
        imageId: stringOrNull(inspected['Image']),
        imageDigest: imageReference?.split('@')[1] ?? null,
        ports,
        startedAt: normalizeDockerTimestamp(state['StartedAt']),
        stoppedAt: normalizeDockerTimestamp(state['FinishedAt']),
        exitStatus: typeof state['ExitCode'] === 'number' ? state['ExitCode'] : null,
        metrics,
      };
    }));
  }

  private async listDockerVolumes(): Promise<readonly RuntimeResourceRecord[]> {
    const names = await listIds(this.runner, ['volume', 'ls', '--quiet']);
    return Promise.all(names.map(async (name) => {
      const inspected = await inspectOne(this.runner, ['volume', 'inspect', name]);
      return baseDockerResource('volume', stringOrEmpty(inspected['Name']), stringOrEmpty(inspected['Name']),
        stringRecord(inspected['Labels']), normalizeDockerTimestamp(inspected['CreatedAt']));
    }));
  }

  private async listDockerNetworks(): Promise<readonly RuntimeResourceRecord[]> {
    const ids = await listIds(this.runner, ['network', 'ls', '--quiet']);
    return Promise.all(ids.map(async (id) => {
      const inspected = await inspectOne(this.runner, ['network', 'inspect', id]);
      return baseDockerResource('network', stringOrEmpty(inspected['Id']), stringOrEmpty(inspected['Name']),
        stringRecord(inspected['Labels']), normalizeDockerTimestamp(inspected['Created']));
    }));
  }

  private async assertDockerResourceOwned(
    type: 'container' | 'volume' | 'network',
    id: string,
    identity: FormalRunIdentity,
  ): Promise<void> {
    const inspected = await inspectOne(this.runner, [type, 'inspect', id]);
    const labels = type === 'container'
      ? stringRecord(recordField(inspected, 'Config')['Labels'])
      : stringRecord(inspected['Labels']);
    const resource = baseDockerResource(type, id, id, labels, null);
    if (!belongsToRun(resource, identity)) throw new Error('FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH');
  }
}

async function attempt(
  addAction: (action: Omit<CleanupAction, 'ordinal' | 'occurredAt'>) => void,
  identity: Pick<CleanupAction, 'action' | 'resourceType' | 'resourceId' | 'resourceName'>,
  operation: () => Promise<void>,
): Promise<void> {
  try {
    await operation();
    addAction({ ...identity, status: 'PASSED', errorCode: null });
  } catch (error) {
    addAction({ ...identity, status: 'FAILED', errorCode: stableError(error) });
  }
}

async function readRuntimeEvents(
  directory: string,
  identity: FormalRunIdentity,
): Promise<readonly RuntimeResourceRecord[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const values: unknown[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) throw new Error('FORMAL_RUNTIME_EVENT_SYMLINK_FORBIDDEN');
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      values.push(JSON.parse(await readFile(join(directory, entry.name), 'utf8')) as unknown);
    }
    return mergeEventValues(values, identity);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function mergeEventValues(
  values: readonly unknown[],
  identity: FormalRunIdentity,
): readonly RuntimeResourceRecord[] {
  const resources = new Map<string, RuntimeResourceRecord>();
  for (const value of values) {
    if (!isRecord(value) || value['runId'] !== identity.runId) continue;
    const event = value['event'];
    const resourceType = value['resourceType'];
    const id = value['id'];
    if (
      (event !== 'STARTED' && event !== 'STOPPED') ||
      !['process', 'container'].includes(String(resourceType)) ||
      typeof id !== 'string'
    ) continue;
    const existing = resources.get(String(resourceType) + ':' + id);
    const labels = stringRecord(value['labels']);
    if (event === 'STARTED') {
      const pid = typeof value['pid'] === 'number' ? value['pid'] : undefined;
      const processIsAlive = resourceType === 'process' && pid !== undefined && isProcessAlive(pid);
      resources.set(String(resourceType) + ':' + id, {
        resourceType: resourceType as 'process' | 'container',
        id,
        name: typeof value['name'] === 'string' ? value['name'] : id,
        labels,
        source: 'runtime-event',
        // Docker resources are authoritative for current presence. 事件仅证明资源曾启动；
        // 若当前 inspect 未找到它，则不能把已自行退出的容器伪报为残留。
        present: processIsAlive,
        active: processIsAlive,
        state: 'STARTED',
        imageReference: typeof value['imageReference'] === 'string' ? value['imageReference'] : null,
        imageId: typeof value['imageId'] === 'string' ? value['imageId'] : null,
        imageDigest: typeof value['imageDigest'] === 'string' ? value['imageDigest'] : null,
        ports: parseEventPorts(value['ports']),
        startedAt: typeof value['occurredAt'] === 'string' ? value['occurredAt'] : null,
        stoppedAt: null,
        exitStatus: null,
        metrics: null,
        ...(pid === undefined ? {} : { pid }),
        ...(typeof value['role'] === 'string' ? { role: value['role'] } : {}),
      });
    } else if (existing !== undefined) {
      resources.set(String(resourceType) + ':' + id, {
        ...existing,
        present: false,
        active: false,
        state: 'STOPPED',
        stoppedAt: typeof value['occurredAt'] === 'string' ? value['occurredAt'] : null,
        exitStatus: typeof value['exitStatus'] === 'number' || typeof value['exitStatus'] === 'string'
          ? value['exitStatus']
          : null,
      });
    }
  }
  return [...resources.values()];
}

function mergeDockerAndEventResources(
  docker: readonly RuntimeResourceRecord[],
  events: readonly RuntimeResourceRecord[],
): readonly RuntimeResourceRecord[] {
  const merged = new Map(events.map((resource) => [resource.resourceType + ':' + resource.id, resource]));
  for (const resource of docker) {
    const key = resource.resourceType + ':' + resource.id;
    const event = merged.get(key);
    merged.set(key, event === undefined ? resource : {
      ...resource,
      startedAt: event.startedAt ?? resource.startedAt,
      ...(event.role === undefined ? {} : { role: event.role }),
      ...(event.pid === undefined ? {} : { pid: event.pid }),
    });
  }
  return [...merged.values()];
}

function baseDockerResource(
  resourceType: 'container' | 'volume' | 'network',
  id: string,
  name: string,
  labels: Readonly<Record<string, string>>,
  startedAt: string | null,
): RuntimeResourceRecord {
  return {
    resourceType,
    id,
    name,
    labels,
    source: 'docker-inspect',
    present: true,
    active: true,
    state: 'PRESENT',
    imageReference: null,
    imageId: null,
    imageDigest: null,
    ports: [],
    startedAt,
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
  };
}

function stableResources(resources: readonly RuntimeResourceRecord[]): readonly RuntimeResourceRecord[] {
  return [...resources].sort((left, right) =>
    (left.resourceType + ':' + left.name + ':' + left.id)
      .localeCompare(right.resourceType + ':' + right.name + ':' + right.id),
  );
}

async function listIds(runner: RuntimeCommandRunner, args: readonly string[]): Promise<readonly string[]> {
  const result = await runner.run({ executable: 'docker', args });
  if (result.exitCode !== 0) throw new Error('FORMAL_DOCKER_LIST_FAILED:' + args[0]);
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function inspectOne(
  runner: RuntimeCommandRunner,
  args: readonly string[],
): Promise<Readonly<Record<string, unknown>>> {
  const result = await runner.run({ executable: 'docker', args });
  if (result.exitCode !== 0) throw new Error('FORMAL_DOCKER_INSPECT_FAILED:' + args[0]);
  const value = JSON.parse(result.stdout) as unknown;
  const first = Array.isArray(value) ? value[0] : undefined;
  if (!isRecord(first)) throw new Error('FORMAL_DOCKER_INSPECT_INVALID:' + args[0]);
  return first;
}

async function readDockerStats(
  runner: RuntimeCommandRunner,
  id: string,
): Promise<Readonly<Record<string, string>> | null> {
  try {
    const result = await runner.run({
      executable: 'docker',
      args: ['stats', '--no-stream', '--format', '{{json .}}', id],
    });
    if (result.exitCode !== 0) return null;
    const value = JSON.parse(result.stdout.trim()) as unknown;
    if (!isRecord(value)) return null;
    return Object.fromEntries(Object.entries(value).flatMap(([name, item]) =>
      typeof item === 'string' ? [[name, item]] : [],
    ));
  } catch {
    return null;
  }
}

async function requireSuccess(
  runner: RuntimeCommandRunner,
  executable: string,
  args: readonly string[],
  environment?: Readonly<Record<string, string>>,
): Promise<void> {
  const result = await runner.run({
    executable,
    args,
    ...(environment === undefined ? {} : { environment }),
  });
  if (result.exitCode !== 0) throw new Error('FORMAL_CLEANUP_COMMAND_FAILED:' + args.join(':'));
}

async function requireText(
  runner: RuntimeCommandRunner,
  executable: string,
  args: readonly string[],
): Promise<string> {
  const result = await runner.run({ executable, args });
  if (result.exitCode !== 0) throw new Error('FORMAL_RUNTIME_ENVIRONMENT_COMMAND_FAILED:' + executable);
  return result.stdout.trim();
}

function memInfoBytes(value: string, field: string): number {
  const match = new RegExp('^' + field + ':\\s+(\\d+)\\s+kB$', 'mu').exec(value);
  if (match?.[1] === undefined) throw new Error('FORMAL_RUNTIME_MEMINFO_INVALID:' + field);
  return Number.parseInt(match[1], 10) * 1024;
}

async function inspectPort(port: number): Promise<RuntimeResourceSnapshot['ports'][number]> {
  return new Promise((resolveInspection) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => resolveInspection({
      port,
      occupied: error.code === 'EADDRINUSE' || error.code === 'EACCES',
      verificationError: error.code === 'EADDRINUSE' || error.code === 'EACCES'
        ? null
        : (error.code ?? 'PORT_BIND_ERROR'),
    }));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => resolveInspection({
        port,
        occupied: false,
        verificationError: error === undefined ? null : 'PORT_CLOSE_ERROR',
      }));
    });
  });
}

function recordField(
  value: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const field = value[key];
  return isRecord(field) ? field : {};
}

function stringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([name, item]) =>
    typeof item === 'string' ? [[name, item]] : [],
  ));
}

function parsePortBindings(value: unknown): readonly RuntimePortBinding[] {
  if (!isRecord(value)) return [];
  const bindings: RuntimePortBinding[] = [];
  for (const [containerPort, candidates] of Object.entries(value)) {
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (!isRecord(candidate)) continue;
      const hostPort = Number(candidate['HostPort']);
      bindings.push({
        containerPort,
        hostIp: stringOrNull(candidate['HostIp']),
        hostPort: Number.isSafeInteger(hostPort) ? hostPort : null,
      });
    }
  }
  return bindings;
}

function parseEventPorts(value: unknown): readonly RuntimePortBinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): readonly RuntimePortBinding[] => {
    if (!isRecord(item) || typeof item['containerPort'] !== 'string') return [];
    const hostPort = item['hostPort'];
    return [{
      containerPort: item['containerPort'],
      hostIp: typeof item['hostIp'] === 'string' ? item['hostIp'] : null,
      hostPort: typeof hostPort === 'number' ? hostPort : null,
    }];
  });
}

function normalizeDockerTimestamp(value: unknown): string | null {
  return typeof value === 'string' && !value.startsWith('0001-01-01', 0) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function stableError(error: unknown): string {
  const message = errorMessage(error);
  return (/^[A-Z0-9_:-]+$/u.test(message) ? message : 'FORMAL_CLEANUP_OPERATION_FAILED').slice(0, 200);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function runControlledTeardownCli(): Promise<void> {
  const evidenceDirectoryArgument = readCliArgument('--evidence-dir');
  if (evidenceDirectoryArgument === undefined) {
    throw new Error('FORMAL_TEARDOWN_EVIDENCE_DIRECTORY_REQUIRED');
  }
  const evidenceDirectory = resolve(evidenceDirectoryArgument);
  const preflightPath = join(evidenceDirectory, 'runtime', 'preflight.json');
  const parsed = JSON.parse(await readFile(preflightPath, 'utf8')) as unknown;
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 'phase-01.formal-preflight.v1') {
    throw new Error('FORMAL_TEARDOWN_PREFLIGHT_INVALID');
  }
  const rawIdentity = parsed['runIdentity'];
  if (!isRecord(rawIdentity)) throw new Error('FORMAL_TEARDOWN_RUN_IDENTITY_INVALID');
  const runId = rawIdentity['runId'];
  const runSequence = rawIdentity['runSequence'];
  const composeProjectName = rawIdentity['composeProjectName'];
  const gitCommitSha = rawIdentity['gitCommitSha'];
  if (
    typeof runId !== 'string' ||
    typeof runSequence !== 'number' ||
    typeof composeProjectName !== 'string' ||
    typeof gitCommitSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(gitCommitSha)
  ) throw new Error('FORMAL_TEARDOWN_RUN_IDENTITY_INVALID');
  const derived = createFormalRunSeed(runSequence, () => runId);
  if (derived.composeProjectName !== composeProjectName) {
    throw new Error('FORMAL_TEARDOWN_COMPOSE_PROJECT_IDENTITY_MISMATCH');
  }
  const identity: FormalRunIdentity = { ...derived, gitCommitSha };
  const repositoryRoot = resolve(import.meta.dirname, '../../../..');
  const result = await performFormalTeardown({
    identity,
    runtimeEventDirectory: join(evidenceDirectory, 'runtime', 'events'),
    composeFile: join(
      repositoryRoot,
      'phase-plan/environment/anolis-8.9-wsl2/compose.phase-01.yml',
    ),
  });
  const runtimeDirectory = join(evidenceDirectory, 'runtime');
  const followupName = 'cleanup-followup-' +
    localNowInAsiaShanghai().replaceAll(/[^0-9A-Za-z]/gu, '-') + '-' +
    randomUUID().slice(0, 12) + '.json';
  const followupPath = join(runtimeDirectory, followupName);
  let evidenceWriteFailure: string | null = null;
  try {
    await writeFile(followupPath, JSON.stringify({
      schemaVersion: 'phase-01.formal-cleanup-followup.v1',
      runIdentity: identity,
      invokedAt: localNowInAsiaShanghai(),
      cleanup: result.cleanup,
      finalResources: result.finalResources,
    }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeIfAbsent(join(runtimeDirectory, 'cleanup.json'), result.cleanup);
    await writeIfAbsent(join(runtimeDirectory, 'resources-final.json'), result.finalResources);
  } catch (error) {
    evidenceWriteFailure = stableError(error);
  }
  process.stdout.write(JSON.stringify({
    ...result,
    cleanupEvidencePath: evidenceWriteFailure === null ? followupPath : null,
    cleanupEvidenceWriteFailure: evidenceWriteFailure,
  }, null, 2) + '\n');
  if (result.cleanup.status !== 'PASSED' || evidenceWriteFailure !== null) process.exitCode = 1;
}

async function writeIfAbsent(path: string, value: unknown): Promise<void> {
  try {
    await access(path);
  } catch (error) {
    if (!isMissing(error)) throw error;
    try {
      await writeFile(path, JSON.stringify(value, null, 2) + '\n', {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
    } catch (writeError) {
      if (!isAlreadyExists(writeError)) throw writeError;
    }
  }
}

function readCliArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runControlledTeardownCli();
}
