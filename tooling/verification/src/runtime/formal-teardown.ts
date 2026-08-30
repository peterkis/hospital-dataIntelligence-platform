import { randomUUID } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import {
  SpawnRuntimeCommandRunner,
  createFormalRunSeed,
  errorMessage,
  formalRuntimeLabels,
  formalRuntimePorts,
  localNowInAsiaShanghai,
  type FormalRunIdentity,
  type RuntimeCommandRunner,
} from './formal-runtime-contract.ts';
import {
  createFormalRuntimeAuthorityIsolationAdapter,
  evaluateFormalRuntimeAuthorityIsolation,
  type FormalPreflightAuthorityIsolationAdapter,
} from './formal-preflight.ts';
import {
  inspectWslHost,
  type WslHostEvidence,
} from './formal-wsl-host.ts';
import {
  loadPodmanRuntimeAuthority,
  parseFormalRuntimeAuthoritySnapshot,
} from './podman-runtime-authority.ts';
import type {
  LoadedPodmanRuntimeAuthority,
  PodmanRuntimeAuthority,
} from './podman-runtime-authority-schema.ts';

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
  readonly source: 'podman-inspect' | 'runtime-event';
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
  readonly restartPolicy?: string | null;
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
  readonly action: 'DISCOVER_RESOURCES' | 'STOP_PROCESS' | 'REMOVE_CONTAINER' |
    'REMOVE_VOLUME' | 'REMOVE_NETWORK' | 'VERIFY_PORT' |
    'VERIFY_ENVIRONMENT' | 'VERIFY_RESOURCE' | 'VERIFY_RUNTIME_AUTHORITY' |
    'VERIFY_RUNTIME_ISOLATION' | 'VERIFY_PERSISTENCE' | 'VERIFY_PARTIAL_RECOVERY';
  readonly resourceType: RuntimeResourceType | 'port' | 'runtime';
  readonly resourceId: string;
  readonly resourceName: string;
  readonly status: 'PASSED' | 'FAILED' | 'SKIPPED';
  readonly errorCode: string | null;
}

export interface RestartPolicyFinding {
  readonly resourceId: string;
  readonly resourceName: string;
  readonly expected: 'no';
  readonly actual: string | null;
  readonly status: 'PASSED' | 'FAILED';
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
  readonly runtimeAuthority?: {
    readonly expectedSha256: string;
    readonly observedAfterSha256: string | null;
    readonly expectedSemanticDigest: string;
    readonly observedAfterSemanticDigest: string | null;
    readonly stable: boolean;
  };
  readonly restartPolicyFindings?: readonly RestartPolicyFinding[];
  readonly dockerSecondAuthorityFindings?: readonly string[];
  readonly partialStartupRecoveryFindings?: readonly string[];
  readonly persistenceFindings?: readonly string[];
  readonly residualCounts?: Readonly<Record<RuntimeResourceType, number>>;
}

export interface FormalTeardownTerminalState {
  readonly persistenceFindings: readonly string[];
  readonly dockerSecondAuthorityFindings: readonly string[];
  readonly partialStartupRecoveryFindings: readonly string[];
}

export interface FormalTeardownAdapter {
  listResources(
    identity: FormalRunIdentity,
    runtimeEventDirectory: string,
    authority: PodmanRuntimeAuthority,
  ): Promise<readonly RuntimeResourceRecord[]>;
  reinspectResource(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
  ): Promise<RuntimeResourceRecord | null>;
  stopProcess(resource: RuntimeResourceRecord, identity: FormalRunIdentity): Promise<void>;
  removeContainer(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
  ): Promise<void>;
  removeVolume(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
  ): Promise<void>;
  removeNetwork(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
  ): Promise<void>;
  inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']>;
  inspectEnvironment?(authority: PodmanRuntimeAuthority): Promise<RuntimeEnvironmentObservation>;
  inspectTerminalState(
    identity: FormalRunIdentity,
    runtimeEventDirectory: string,
    authority: PodmanRuntimeAuthority,
  ): Promise<FormalTeardownTerminalState>;
}

export interface FormalTeardownDependencies {
  readonly adapter: FormalTeardownAdapter;
  readonly authorityIsolation: FormalPreflightAuthorityIsolationAdapter;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly loadRuntimeAuthority: (
    repositoryRoot?: string,
  ) => LoadedPodmanRuntimeAuthority | Promise<LoadedPodmanRuntimeAuthority>;
  readonly now: () => string;
}

export function createDefaultFormalTeardownDependencies(): FormalTeardownDependencies {
  const commandRunner = new SpawnRuntimeCommandRunner();
  return {
    adapter: new PodmanCliFormalTeardownAdapter(commandRunner),
    authorityIsolation: createFormalRuntimeAuthorityIsolationAdapter(commandRunner, process.env),
    environment: process.env,
    loadRuntimeAuthority: (repositoryRoot) => loadPodmanRuntimeAuthority(
      repositoryRoot ?? resolve(import.meta.dirname, '../../../..'),
    ),
    now: localNowInAsiaShanghai,
  };
}

export async function captureFormalRuntimeResources(
  input: {
    readonly identity: FormalRunIdentity;
    readonly runtimeEventDirectory: string;
    readonly runtimeAuthority: LoadedPodmanRuntimeAuthority;
  },
  dependencies: FormalTeardownDependencies = createDefaultFormalTeardownDependencies(),
): Promise<RuntimeResourceSnapshot> {
  const resources = (await dependencies.adapter.listResources(
    input.identity,
    input.runtimeEventDirectory,
    input.runtimeAuthority.authority,
  )).map((resource) => projectRuntimeResourceLabels(
    resource,
    input.identity,
    input.runtimeAuthority.authority,
  )).filter((resource) => isPotentialRunResource(
    resource,
    input.identity,
    input.runtimeAuthority.authority,
  ));
  let environment: RuntimeEnvironmentObservation | null = null;
  let environmentCaptureFailure: string | null = null;
  if (dependencies.adapter.inspectEnvironment !== undefined) {
    try {
      environment = await dependencies.adapter.inspectEnvironment(input.runtimeAuthority.authority);
    } catch (error) {
      environmentCaptureFailure = stableError(error);
    }
  }
  return {
    schemaVersion: 'phase-01.formal-runtime-resources.v1',
    runIdentity: input.identity,
    capturedAt: dependencies.now(),
    resources: stableResources(resources),
    ports: await dependencies.adapter.inspectPorts(runtimeAuthorityPorts(input.runtimeAuthority)),
    environment,
    environmentCaptureFailure,
  };
}

export async function performFormalTeardown(
  input: {
    readonly identity: FormalRunIdentity;
    readonly repositoryRoot: string;
    readonly runtimeEventDirectory: string;
    readonly runtimeAuthority: LoadedPodmanRuntimeAuthority;
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
    resources = (await dependencies.adapter.listResources(
      input.identity,
      input.runtimeEventDirectory,
      input.runtimeAuthority.authority,
    )).map((resource) => projectRuntimeResourceLabels(
      resource,
      input.identity,
      input.runtimeAuthority.authority,
    ));
  } catch (error) {
    addAction({
      action: 'DISCOVER_RESOURCES',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: input.identity.runtimeNamespace,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RESOURCE_DISCOVERY_FAILED:' + stableError(error),
    });
  }

  const restartPolicyFindings: RestartPolicyFinding[] = [];
  const candidateResources: RuntimeResourceRecord[] = [];
  for (const resource of resources.filter((candidate) => candidate.present || candidate.active)) {
    if (!isPotentialRunResource(resource, input.identity, input.runtimeAuthority.authority)) continue;
    if (!belongsToRun(resource, input.identity, input.runtimeAuthority.authority)) {
      addAction({
        action: 'VERIFY_RESOURCE',
        resourceType: resource.resourceType,
        resourceId: resource.id,
        resourceName: resource.name,
        status: 'FAILED',
        errorCode: 'FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH',
      });
      continue;
    }
    if (!hasCanonicalResourceName(resource, input.identity)) {
      addAction({
        action: 'VERIFY_RESOURCE',
        resourceType: resource.resourceType,
        resourceId: resource.id,
        resourceName: resource.name,
        status: 'FAILED',
        errorCode: 'FORMAL_CLEANUP_RESOURCE_NAME_MISMATCH',
      });
      continue;
    }
    candidateResources.push(resource);
  }
  const processOrder = (resource: RuntimeResourceRecord): number => {
    if (resource.role === 'governance-api') return 0;
    if (resource.role?.startsWith('sim-consumer') === true) return 1;
    return 2;
  };
  for (const resource of candidateResources.filter((candidate) =>
    candidate.resourceType === 'process' && candidate.active,
  ).sort((left, right) => processOrder(left) - processOrder(right))) {
    await verifyAndMutateResource(resource, input.identity, input.runtimeAuthority.authority,
      dependencies.adapter, addAction, restartPolicyFindings, {
      action: 'STOP_PROCESS',
      mutate: (fresh) => dependencies.adapter.stopProcess(fresh, input.identity),
    });
  }

  const containerOrder = (resource: RuntimeResourceRecord): number => {
    if (resource.name.includes('keycloak')) return 0;
    if (resource.name.includes('integration')) return 1;
    return 2;
  };
  for (const resource of candidateResources.filter((candidate) =>
    candidate.resourceType === 'container' && candidate.present,
  ).sort((left, right) => containerOrder(left) - containerOrder(right))) {
    await verifyAndMutateResource(resource, input.identity, input.runtimeAuthority.authority,
      dependencies.adapter, addAction, restartPolicyFindings, {
      action: 'REMOVE_CONTAINER',
      mutate: (fresh) => dependencies.adapter.removeContainer(
        fresh,
        input.identity,
        input.runtimeAuthority.authority,
      ),
    });
  }

  const volumeOrder = (resource: RuntimeResourceRecord): number =>
    resource.name.includes('keycloak') ? 0 : 1;
  for (const resource of candidateResources.filter((candidate) =>
    candidate.present && candidate.resourceType === 'volume',
  ).sort((left, right) => volumeOrder(left) - volumeOrder(right))) {
    await verifyAndMutateResource(resource, input.identity, input.runtimeAuthority.authority,
      dependencies.adapter, addAction, restartPolicyFindings, {
      action: 'REMOVE_VOLUME',
      mutate: (fresh) => dependencies.adapter.removeVolume(
        fresh,
        input.identity,
        input.runtimeAuthority.authority,
      ),
    });
  }
  for (const resource of candidateResources.filter((candidate) =>
    candidate.present && candidate.resourceType === 'network',
  )) {
    await verifyAndMutateResource(resource, input.identity, input.runtimeAuthority.authority,
      dependencies.adapter, addAction, restartPolicyFindings, {
      action: 'REMOVE_NETWORK',
      mutate: (fresh) => dependencies.adapter.removeNetwork(
        fresh,
        input.identity,
        input.runtimeAuthority.authority,
      ),
    });
  }

  let finalResources: RuntimeResourceSnapshot;
  try {
    finalResources = await captureFormalRuntimeResources({
      identity: input.identity,
      runtimeEventDirectory: input.runtimeEventDirectory,
      runtimeAuthority: input.runtimeAuthority,
    }, dependencies);
  } catch (error) {
    addAction({
      action: 'DISCOVER_RESOURCES',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: input.identity.runtimeNamespace,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_FINAL_SNAPSHOT_FAILED:' + stableError(error),
    });
    finalResources = {
      schemaVersion: 'phase-01.formal-runtime-resources.v1',
      runIdentity: input.identity,
      capturedAt: dependencies.now(),
      resources: [],
      ports: runtimeAuthorityPorts(input.runtimeAuthority).map((port) => ({
        port,
        occupied: true,
        verificationError: 'FINAL_SNAPSHOT_UNAVAILABLE',
      })),
    };
  }

  let terminalState: FormalTeardownTerminalState = {
    persistenceFindings: [],
    dockerSecondAuthorityFindings: [],
    partialStartupRecoveryFindings: [],
  };
  let terminalInspectionComplete = false;
  try {
    terminalState = await dependencies.adapter.inspectTerminalState(
      input.identity,
      input.runtimeEventDirectory,
      input.runtimeAuthority.authority,
    );
    terminalInspectionComplete = true;
  } catch (error) {
    addAction({
      action: 'VERIFY_RUNTIME_ISOLATION',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: input.identity.runtimeNamespace,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_TERMINAL_INSPECTION_FAILED:' + stableError(error),
    });
  }
  let sharedIsolationInspectionComplete = false;
  let sharedIsolationFindings: readonly string[] = [];
  try {
    const observation = await dependencies.authorityIsolation.inspect(input.runtimeAuthority.authority);
    sharedIsolationFindings = evaluateFormalRuntimeAuthorityIsolation(
      observation,
      dependencies.environment,
      input.runtimeAuthority.authority,
    ).filter((check) => check.status === 'FAILED').map((check) =>
      `${check.errorCode ?? 'FORMAL_PREFLIGHT_AUTHORITY_ISOLATION_FAILED'}:${check.id}`,
    );
    sharedIsolationInspectionComplete = true;
  } catch (error) {
    sharedIsolationFindings = [
      'FORMAL_PREFLIGHT_AUTHORITY_ISOLATION_UNAVAILABLE:' + stableError(error),
    ];
    addAction({
      action: 'VERIFY_RUNTIME_ISOLATION',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: input.identity.runtimeNamespace,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_AUTHORITY_ISOLATION_INSPECTION_FAILED:' + stableError(error),
    });
  }
  terminalState = {
    ...terminalState,
    dockerSecondAuthorityFindings: [...new Set([
      ...terminalState.dockerSecondAuthorityFindings,
      ...sharedIsolationFindings,
    ])].sort(),
  };
  if (terminalInspectionComplete) {
    addFindingAction(addAction, 'VERIFY_PERSISTENCE', terminalState.persistenceFindings,
      'FORMAL_CLEANUP_PERSISTENT_UNIT_PRESENT', input.identity);
    if (sharedIsolationInspectionComplete) {
      addFindingAction(addAction, 'VERIFY_RUNTIME_ISOLATION', terminalState.dockerSecondAuthorityFindings,
        'FORMAL_CLEANUP_SECOND_RUNTIME_AUTHORITY_PRESENT', input.identity);
    }
    addFindingAction(addAction, 'VERIFY_PARTIAL_RECOVERY', terminalState.partialStartupRecoveryFindings,
      'FORMAL_CLEANUP_PARTIAL_RECOVERY_INCOMPLETE', input.identity);
  }

  let observedAuthority: LoadedPodmanRuntimeAuthority | null = null;
  try {
    observedAuthority = await dependencies.loadRuntimeAuthority(input.repositoryRoot);
  } catch (error) {
    addAction({
      action: 'VERIFY_RUNTIME_AUTHORITY',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: 'runtime-baseline.lock.json',
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RUNTIME_AUTHORITY_UNAVAILABLE:' + stableError(error),
    });
  }
  const runtimeAuthorityStable = observedAuthority !== null &&
    observedAuthority.runtimeAuthoritySha256 === input.runtimeAuthority.runtimeAuthoritySha256 &&
    observedAuthority.runtimeAuthoritySemanticDigest ===
      input.runtimeAuthority.runtimeAuthoritySemanticDigest;
  if (observedAuthority !== null) {
    addAction({
      action: 'VERIFY_RUNTIME_AUTHORITY',
      resourceType: 'runtime',
      resourceId: input.identity.runId,
      resourceName: 'runtime-baseline.lock.json',
      status: runtimeAuthorityStable ? 'PASSED' : 'FAILED',
      errorCode: runtimeAuthorityStable ? null : 'FORMAL_CLEANUP_RUNTIME_AUTHORITY_DRIFT',
    });
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
  const residualCounts = countResidualResources(residualResources);
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
    runtimeAuthority: {
      expectedSha256: input.runtimeAuthority.runtimeAuthoritySha256,
      observedAfterSha256: observedAuthority?.runtimeAuthoritySha256 ?? null,
      expectedSemanticDigest: input.runtimeAuthority.runtimeAuthoritySemanticDigest,
      observedAfterSemanticDigest: observedAuthority?.runtimeAuthoritySemanticDigest ?? null,
      stable: runtimeAuthorityStable,
    },
    restartPolicyFindings,
    dockerSecondAuthorityFindings: terminalState.dockerSecondAuthorityFindings,
    partialStartupRecoveryFindings: terminalState.partialStartupRecoveryFindings,
    persistenceFindings: terminalState.persistenceFindings,
    residualCounts,
  };
  return { cleanup, finalResources };
}

async function verifyAndMutateResource(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
  adapter: FormalTeardownAdapter,
  addAction: (action: Omit<CleanupAction, 'ordinal' | 'occurredAt'>) => void,
  restartPolicyFindings: RestartPolicyFinding[],
  operation: {
    readonly action: Extract<CleanupAction['action'],
    'STOP_PROCESS' | 'REMOVE_CONTAINER' | 'REMOVE_VOLUME' | 'REMOVE_NETWORK'>;
    readonly mutate: (fresh: RuntimeResourceRecord) => Promise<void>;
  },
): Promise<void> {
  let fresh: RuntimeResourceRecord | null;
  try {
    fresh = await adapter.reinspectResource(resource, identity);
  } catch (error) {
    addAction({
      action: 'VERIFY_RESOURCE',
      resourceType: resource.resourceType,
      resourceId: resource.id,
      resourceName: resource.name,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RESOURCE_REINSPECTION_FAILED:' + stableError(error),
    });
    return;
  }
  if (fresh !== null) fresh = projectRuntimeResourceLabels(fresh, identity, authority);
  if (fresh === null || (!fresh.present && !fresh.active)) {
    addAction({
      action: 'VERIFY_RESOURCE',
      resourceType: resource.resourceType,
      resourceId: resource.id,
      resourceName: resource.name,
      status: 'SKIPPED',
      errorCode: null,
    });
    return;
  }
  if (!belongsToRun(fresh, identity, authority)) {
    addAction({
      action: 'VERIFY_RESOURCE',
      resourceType: resource.resourceType,
      resourceId: resource.id,
      resourceName: resource.name,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH',
    });
    return;
  }
  if (!hasCanonicalResourceName(fresh, identity) || fresh.name !== resource.name) {
    addAction({
      action: 'VERIFY_RESOURCE',
      resourceType: resource.resourceType,
      resourceId: resource.id,
      resourceName: resource.name,
      status: 'FAILED',
      errorCode: 'FORMAL_CLEANUP_RESOURCE_NAME_MISMATCH',
    });
    return;
  }
  if (fresh.resourceType === 'container') {
    const actual = fresh.restartPolicy ?? null;
    const status = actual === 'no' ? 'PASSED' : 'FAILED';
    restartPolicyFindings.push({
      resourceId: fresh.id,
      resourceName: fresh.name,
      expected: 'no',
      actual,
      status,
    });
    if (status === 'FAILED') {
      addAction({
        action: 'VERIFY_RESOURCE',
        resourceType: fresh.resourceType,
        resourceId: fresh.id,
        resourceName: fresh.name,
        status: 'FAILED',
        errorCode: 'FORMAL_CLEANUP_RESTART_POLICY_MISMATCH',
      });
    }
  }
  await attempt(addAction, {
    action: operation.action,
    resourceType: fresh.resourceType,
    resourceId: fresh.id,
    resourceName: fresh.name,
  }, () => operation.mutate(fresh));
}

function addFindingAction(
  addAction: (action: Omit<CleanupAction, 'ordinal' | 'occurredAt'>) => void,
  action: Extract<CleanupAction['action'],
  'VERIFY_RUNTIME_ISOLATION' | 'VERIFY_PERSISTENCE' | 'VERIFY_PARTIAL_RECOVERY'>,
  findings: readonly string[],
  errorCode: string,
  identity: FormalRunIdentity,
): void {
  addAction({
    action,
    resourceType: 'runtime',
    resourceId: identity.runId,
    resourceName: identity.runtimeNamespace,
    status: findings.length === 0 ? 'PASSED' : 'FAILED',
    errorCode: findings.length === 0 ? null : errorCode,
  });
}

function runtimeAuthorityPorts(authority: LoadedPodmanRuntimeAuthority): readonly number[] {
  return formalRuntimePorts(authority.authority);
}

function hasCanonicalResourceName(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
): boolean {
  return resource.resourceType === 'process' ||
    resource.name.startsWith(identity.runtimeNamespace + '_');
}

function isPotentialRunResource(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
): boolean {
  return belongsToRun(resource, identity, authority) ||
    resource.name.startsWith(identity.runtimeNamespace + '_') ||
    resource.labels['hdi.run-id'] === identity.runId;
}

function countResidualResources(
  resources: readonly RuntimeResourceRecord[],
): Readonly<Record<RuntimeResourceType, number>> {
  return {
    process: resources.filter((resource) => resource.resourceType === 'process').length,
    container: resources.filter((resource) => resource.resourceType === 'container').length,
    volume: resources.filter((resource) => resource.resourceType === 'volume').length,
    network: resources.filter((resource) => resource.resourceType === 'network').length,
  };
}

export function belongsToRun(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
): boolean {
  const expected = formalRuntimeLabels(identity, authority);
  return Object.entries(expected).every(([name, value]) => resource.labels[name] === value);
}

export function assertFormalRuntimeResourceOwned(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
): void {
  if (!belongsToRun(resource, identity, authority)) {
    throw new Error('FORMAL_CLEANUP_RESOURCE_OWNERSHIP_MISMATCH');
  }
}

export function assertSafeFormalCleanupCommand(
  executable: string,
  args: readonly string[],
): void {
  if (executable !== 'podman') throw new Error('FORMAL_CLEANUP_COMMAND_SCOPE_INVALID');
  if (args.some((argument) => argument.toLowerCase() === 'prune')) {
    throw new Error('FORMAL_CLEANUP_PODMAN_PRUNE_FORBIDDEN');
  }
  const containerRemove = args.length === 4 &&
    args[0] === 'container' && args[1] === 'rm' &&
    args[2] === '--force' && meaningfulArgument(args[3]);
  const volumeRemove = args.length === 3 &&
    args[0] === 'volume' && args[1] === 'rm' && meaningfulArgument(args[2]);
  const networkRemove = args.length === 3 &&
    args[0] === 'network' && args[1] === 'rm' && meaningfulArgument(args[2]);
  if (!containerRemove && !volumeRemove && !networkRemove) {
    throw new Error('FORMAL_CLEANUP_COMMAND_SCOPE_INVALID');
  }
}

export class PodmanCliFormalTeardownAdapter implements FormalTeardownAdapter {
  private readonly runner: RuntimeCommandRunner;

  constructor(runner: RuntimeCommandRunner) {
    this.runner = runner;
  }

  async listResources(
    identity: FormalRunIdentity,
    runtimeEventDirectory: string,
    authority: PodmanRuntimeAuthority,
  ): Promise<readonly RuntimeResourceRecord[]> {
    const podman = [
      ...await this.listPodmanContainers(),
      ...await this.listPodmanVolumes(),
      ...await this.listPodmanNetworks(),
    ];
    const events = await readRuntimeEvents(runtimeEventDirectory, identity, authority);
    return mergePodmanAndEventResources(podman, events);
  }

  async reinspectResource(
    resource: RuntimeResourceRecord,
    _identity: FormalRunIdentity,
  ): Promise<RuntimeResourceRecord | null> {
    if (resource.resourceType === 'process') {
      return resource.pid !== undefined && isProcessAlive(resource.pid) ? resource : null;
    }
    const inspected = await tryInspectOne(this.runner, [
      resource.resourceType,
      'inspect',
      resource.resourceType === 'volume' ? resource.name : resource.id,
    ]);
    if (inspected === null) return null;
    if (resource.resourceType === 'container') return containerResourceFromInspect(inspected);
    if (resource.resourceType === 'volume') {
      const name = stringOrEmpty(inspected['Name']);
      return basePodmanResource('volume', name, name, stringRecord(inspected['Labels']),
        normalizePodmanTimestamp(inspected['CreatedAt']));
    }
    return basePodmanResource('network', stringOrEmpty(inspected['id']), stringOrEmpty(inspected['name']),
      stringRecord(inspected['labels']), normalizePodmanTimestamp(inspected['created']));
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

  async removeContainer(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
  ): Promise<void> {
    await this.assertPodmanResourceOwned('container', resource.id, identity, authority, resource);
    await requireSuccess(this.runner, 'podman', ['container', 'rm', '--force', resource.id]);
  }

  async removeVolume(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
  ): Promise<void> {
    await this.assertPodmanResourceOwned('volume', resource.name, identity, authority, resource);
    await requireSuccess(this.runner, 'podman', ['volume', 'rm', resource.name]);
  }

  async removeNetwork(
    resource: RuntimeResourceRecord,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
  ): Promise<void> {
    await this.assertPodmanResourceOwned('network', resource.id, identity, authority, resource);
    await requireSuccess(this.runner, 'podman', ['network', 'rm', resource.id]);
  }

  async inspectPorts(ports: readonly number[]): Promise<RuntimeResourceSnapshot['ports']> {
    return Promise.all(ports.map((port) => inspectPort(port)));
  }

  async inspectEnvironment(authority: PodmanRuntimeAuthority): Promise<RuntimeEnvironmentObservation> {
    const hostAuthority = authority.host;
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
      host.runningDistributions[0] !== hostAuthority.distribution
    ) failureCodes.push('FORMAL_RUNTIME_WSL_RUNNING_SET_MISMATCH');
    if (!wslConfigurationMatchesAuthority(host.configuration, hostAuthority)) {
      failureCodes.push('FORMAL_RUNTIME_WSLCONFIG_MISMATCH');
    }
    if (process.env['WSL_DISTRO_NAME'] !== hostAuthority.distribution) {
      failureCodes.push('FORMAL_RUNTIME_WSL_DISTRO_MISMATCH');
    }
    if (processorCount !== hostAuthority.processorCount) {
      failureCodes.push('FORMAL_RUNTIME_WSL_CPU_MISMATCH');
    }
    if (
      Math.abs(memoryTotalBytes - hostAuthority.memoryBytes) >
      hostAuthority.memoryToleranceBytes
    ) {
      failureCodes.push('FORMAL_RUNTIME_WSL_MEMORY_MISMATCH');
    }
    if (swapTotalBytes !== hostAuthority.swapBytes || swapDevices.length !== 0) {
      failureCodes.push('FORMAL_RUNTIME_WSL_SWAP_NONZERO');
    }
    if (
      Math.abs(rootBlockDeviceSizeBytes - hostAuthority.rootFilesystemBytes) >
      hostAuthority.rootFilesystemToleranceBytes
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

  async inspectTerminalState(
    identity: FormalRunIdentity,
    runtimeEventDirectory: string,
    authority: PodmanRuntimeAuthority,
  ): Promise<FormalTeardownTerminalState> {
    const persistenceFindings: string[] = [];
    for (const args of [
      ['list-units', '--all', '--no-legend'],
      ['list-unit-files', '--no-legend'],
    ] as const) {
      const result = await this.runner.run({ executable: 'systemctl', args });
      if (result.exitCode !== 0) throw new Error('FORMAL_CLEANUP_PERSISTENCE_INSPECTION_FAILED');
      for (const line of result.stdout.split(/\r?\n/u)) {
        if (line.includes(identity.runtimeNamespace)) persistenceFindings.push(line.trim());
      }
    }
    for (const directory of [
      '/etc/containers/systemd',
      '/usr/share/containers/systemd',
      '/root/.config/containers/systemd',
    ]) {
      try {
        const entries = await readdir(directory);
        persistenceFindings.push(...entries.filter((name) => name.includes(identity.runtimeNamespace))
          .map((name) => `${directory}/${name}`));
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    const dockerSecondAuthorityFindings: string[] = [];
    for (const path of ['/usr/bin/docker', '/usr/local/bin/docker', '/usr/sbin/docker', '/bin/docker', '/sbin/docker']) {
      try {
        await access(path);
        dockerSecondAuthorityFindings.push(`executable:${path}`);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    for (const path of ['/run/docker.sock', '/var/run/docker.sock']) {
      try {
        await access(path);
        dockerSecondAuthorityFindings.push(path);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
    }
    for (const unit of authority.dockerExclusion.forbiddenSystemdUnits) {
      const result = await this.runner.run({
        executable: 'systemctl',
        args: ['show', unit, '--property=LoadState,ActiveState,UnitFileState,SubState', '--no-pager'],
      });
      const absent = result.exitCode === 0 &&
        /(?:^|\n)LoadState=not-found(?:\r?$|\n)/u.test(result.stdout) &&
        /(?:^|\n)ActiveState=inactive(?:\r?$|\n)/u.test(result.stdout);
      if (!absent) dockerSecondAuthorityFindings.push(`unit:${unit}`);
    }
    const allowedEndpoint = authority.dockerExclusion.allowedCompatibilityEnvironment.DOCKER_HOST;
    const dockerHost = process.env['DOCKER_HOST'];
    if (dockerHost !== undefined && dockerHost !== allowedEndpoint) {
      dockerSecondAuthorityFindings.push('environment:DOCKER_HOST');
    }
    for (const name of [
      'DOCKER_CONTEXT',
      'DOCKER_TLS_VERIFY',
      'DOCKER_CERT_PATH',
      'CONTAINER_HOST',
      'TESTCONTAINERS_HOST_OVERRIDE',
    ]) {
      if ((process.env[name] ?? '').length > 0) dockerSecondAuthorityFindings.push(`environment:${name}`);
    }
    const processNames = new Set(authority.dockerExclusion.forbiddenProcessNames);
    try {
      const procEntries = await readdir('/proc', { withFileTypes: true });
      const processFindings = await Promise.all(procEntries.flatMap((entry) => /^\d+$/u.test(entry.name)
        ? [readFile(join('/proc', entry.name, 'comm'), 'utf8').catch(() => '')]
        : []));
      dockerSecondAuthorityFindings.push(...processFindings.map((name) => name.trim())
        .filter((name) => processNames.has(name))
        .map((name) => `process:${name}`));
    } catch {
      throw new Error('FORMAL_CLEANUP_PROCESS_INSPECTION_FAILED');
    }
    const listeners = await this.runner.run({ executable: 'ss', args: ['-H', '-ltnp'] });
    if (listeners.exitCode !== 0) throw new Error('FORMAL_CLEANUP_TCP_INSPECTION_FAILED');
    for (const line of listeners.stdout.split(/\r?\n/u)) {
      const endpoint = line.trim().split(/\s+/u)[3];
      const port = Number(/:(\d+)$/u.exec(endpoint ?? '')?.[1]);
      if (
        authority.dockerExclusion.forbiddenTcpPorts.includes(port) ||
        /\b(?:dockerd|docker-proxy|podman)\b/u.test(line)
      ) dockerSecondAuthorityFindings.push(`listener:${endpoint ?? 'unknown'}`);
    }
    const connectionResult = await this.runner.run({
      executable: 'podman',
      args: ['system', 'connection', 'list', '--format', 'json'],
    });
    if (connectionResult.exitCode !== 0) {
      throw new Error('FORMAL_CLEANUP_CONNECTION_INSPECTION_FAILED');
    }
    const connectionValues = JSON.parse(connectionResult.stdout) as unknown;
    if (!Array.isArray(connectionValues)) throw new Error('FORMAL_CLEANUP_CONNECTION_INSPECTION_INVALID');
    for (const value of connectionValues) {
      if (!isRecord(value)) continue;
      const endpoint = value['URI'] ?? value['Uri'] ?? value['uri'];
      if (typeof endpoint === 'string' && endpoint !== allowedEndpoint) {
        dockerSecondAuthorityFindings.push(`connection:${endpoint}`);
      }
    }
    const machineResult = await this.runner.run({
      executable: 'podman',
      args: ['machine', 'list', '--format', 'json'],
    });
    if (machineResult.exitCode !== 0) throw new Error('FORMAL_CLEANUP_MACHINE_INSPECTION_FAILED');
    const machineValues = JSON.parse(machineResult.stdout) as unknown;
    if (!Array.isArray(machineValues)) throw new Error('FORMAL_CLEANUP_MACHINE_INSPECTION_INVALID');
    for (const value of machineValues) {
      if (!isRecord(value)) continue;
      const name = value['Name'] ?? value['name'];
      if (typeof name === 'string' && name.length > 0) {
        dockerSecondAuthorityFindings.push(`machine:${name}`);
      }
    }
    try {
      const users = await readdir('/run/user', { withFileTypes: true });
      for (const user of users.filter((entry) => entry.isDirectory())) {
        const socket = join('/run/user', user.name, 'podman', 'podman.sock');
        try {
          await access(socket);
          dockerSecondAuthorityFindings.push(`rootless-socket:${socket}`);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const partialStartupRecoveryFindings = await failedPartialRecoveryEvents(
      runtimeEventDirectory,
      identity,
    );
    return {
      persistenceFindings: [...new Set(persistenceFindings)].sort(),
      dockerSecondAuthorityFindings: [...new Set(dockerSecondAuthorityFindings)].sort(),
      partialStartupRecoveryFindings,
    };
  }

  private async listPodmanContainers(): Promise<readonly RuntimeResourceRecord[]> {
    const ids = await listIds(this.runner, ['container', 'ls', '--all', '--quiet']);
    return Promise.all(ids.map(async (id) => {
      const inspected = await inspectOne(this.runner, ['container', 'inspect', id]);
      const resource = containerResourceFromInspect(inspected);
      const state = recordField(inspected, 'State');
      return {
        ...resource,
        metrics: state['Running'] === true ? await readPodmanStats(this.runner, id) : null,
      };
    }));
  }

  private async listPodmanVolumes(): Promise<readonly RuntimeResourceRecord[]> {
    const names = await listIds(this.runner, ['volume', 'ls', '--quiet']);
    return Promise.all(names.map(async (name) => {
      const inspected = await inspectOne(this.runner, ['volume', 'inspect', name]);
      return basePodmanResource('volume', stringOrEmpty(inspected['Name']), stringOrEmpty(inspected['Name']),
        stringRecord(inspected['Labels']), normalizePodmanTimestamp(inspected['CreatedAt']));
    }));
  }

  private async listPodmanNetworks(): Promise<readonly RuntimeResourceRecord[]> {
    const ids = await listIds(this.runner, ['network', 'ls', '--quiet']);
    return Promise.all(ids.map(async (id) => {
      const inspected = await inspectOne(this.runner, ['network', 'inspect', id]);
      return basePodmanResource('network', stringOrEmpty(inspected['id']), stringOrEmpty(inspected['name']),
        stringRecord(inspected['labels']), normalizePodmanTimestamp(inspected['created']));
    }));
  }

  private async assertPodmanResourceOwned(
    type: 'container' | 'volume' | 'network',
    id: string,
    identity: FormalRunIdentity,
    authority: PodmanRuntimeAuthority,
    expectedResource: RuntimeResourceRecord,
  ): Promise<void> {
    const inspected = await inspectOne(this.runner, [type, 'inspect', id]);
    const labels = type === 'container'
      ? stringRecord(recordField(inspected, 'Config')['Labels'])
      : stringRecord(inspected[type === 'network' ? 'labels' : 'Labels']);
    const actualName = type === 'container'
      ? stringOrEmpty(inspected['Name']).replace(/^\//u, '')
      : stringOrEmpty(inspected[type === 'network' ? 'name' : 'Name']);
    const resource = basePodmanResource(type, id, actualName, labels, null);
    assertFormalRuntimeResourceOwned(resource, identity, authority);
    if (actualName !== expectedResource.name || !hasCanonicalResourceName(resource, identity)) {
      throw new Error('FORMAL_CLEANUP_RESOURCE_NAME_MISMATCH');
    }
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
  authority: PodmanRuntimeAuthority,
): Promise<readonly RuntimeResourceRecord[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const values: unknown[] = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) throw new Error('FORMAL_RUNTIME_EVENT_SYMLINK_FORBIDDEN');
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      values.push(JSON.parse(await readFile(join(directory, entry.name), 'utf8')) as unknown);
    }
    return parseFormalRuntimeEventResources(values, identity, authority);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export function parseFormalRuntimeEventResources(
  values: readonly unknown[],
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
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
    const labels = projectGovernedRuntimeLabels(
      stringRecord(value['actualLabels'] ?? value['labels']),
      identity,
      authority,
    );
    if (event === 'STARTED') {
      const pid = typeof value['pid'] === 'number' ? value['pid'] : undefined;
      const processIsAlive = resourceType === 'process' && pid !== undefined && isProcessAlive(pid);
      resources.set(String(resourceType) + ':' + id, {
        resourceType: resourceType as 'process' | 'container',
        id,
        name: typeof value['name'] === 'string' ? value['name'] : id,
        labels,
        source: 'runtime-event',
        // Podman resources are authoritative for current presence. 事件仅证明资源曾启动；
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
        restartPolicy: typeof value['restartPolicy'] === 'string' ? value['restartPolicy'] : null,
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

function mergePodmanAndEventResources(
  podman: readonly RuntimeResourceRecord[],
  events: readonly RuntimeResourceRecord[],
): readonly RuntimeResourceRecord[] {
  const merged = new Map(events.map((resource) => [resource.resourceType + ':' + resource.id, resource]));
  for (const resource of podman) {
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

function basePodmanResource(
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
    source: 'podman-inspect',
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
    restartPolicy: null,
  };
}

function containerResourceFromInspect(
  inspected: Readonly<Record<string, unknown>>,
): RuntimeResourceRecord {
  const config = recordField(inspected, 'Config');
  const hostConfig = recordField(inspected, 'HostConfig');
  const restartPolicy = recordField(hostConfig, 'RestartPolicy');
  const state = recordField(inspected, 'State');
  const network = recordField(inspected, 'NetworkSettings');
  const imageReference = stringOrNull(config['Image']);
  return {
    resourceType: 'container',
    id: stringOrEmpty(inspected['Id']),
    name: stringOrEmpty(inspected['Name']).replace(/^\//u, ''),
    labels: stringRecord(config['Labels']),
    source: 'podman-inspect',
    present: true,
    active: state['Running'] === true,
    state: stringOrNull(state['Status']),
    imageReference,
    imageId: stringOrNull(inspected['Image']),
    imageDigest: imageReference?.split('@')[1] ?? null,
    ports: parsePortBindings(network['Ports']),
    startedAt: normalizePodmanTimestamp(state['StartedAt']),
    stoppedAt: normalizePodmanTimestamp(state['FinishedAt']),
    exitStatus: typeof state['ExitCode'] === 'number' ? state['ExitCode'] : null,
    metrics: null,
    restartPolicy: stringOrNull(restartPolicy['Name']),
  };
}

function stableResources(resources: readonly RuntimeResourceRecord[]): readonly RuntimeResourceRecord[] {
  return [...resources].sort((left, right) =>
    (left.resourceType + ':' + left.name + ':' + left.id)
      .localeCompare(right.resourceType + ':' + right.name + ':' + right.id),
  );
}

async function listIds(runner: RuntimeCommandRunner, args: readonly string[]): Promise<readonly string[]> {
  const result = await runner.run({ executable: 'podman', args });
  if (result.exitCode !== 0) throw new Error('FORMAL_PODMAN_LIST_FAILED:' + args[0]);
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function inspectOne(
  runner: RuntimeCommandRunner,
  args: readonly string[],
): Promise<Readonly<Record<string, unknown>>> {
  const result = await runner.run({ executable: 'podman', args });
  if (result.exitCode !== 0) throw new Error('FORMAL_PODMAN_INSPECT_FAILED:' + args[0]);
  const value = JSON.parse(result.stdout) as unknown;
  const first = Array.isArray(value) ? value[0] : undefined;
  if (!isRecord(first)) throw new Error('FORMAL_PODMAN_INSPECT_INVALID:' + args[0]);
  return first;
}

async function tryInspectOne(
  runner: RuntimeCommandRunner,
  args: readonly string[],
): Promise<Readonly<Record<string, unknown>> | null> {
  const result = await runner.run({ executable: 'podman', args });
  if (result.exitCode !== 0) {
    if (isExactPodmanInspectNotFound(result, args[0], args.at(-1))) return null;
    throw new Error('FORMAL_PODMAN_INSPECT_FAILED:' + stablePodmanResourceType(args[0]));
  }
  const value = JSON.parse(result.stdout) as unknown;
  const first = Array.isArray(value) ? value[0] : undefined;
  if (!isRecord(first)) throw new Error('FORMAL_PODMAN_INSPECT_INVALID:' + args[0]);
  return first;
}

function isExactPodmanInspectNotFound(
  result: Awaited<ReturnType<RuntimeCommandRunner['run']>>,
  resourceType: string | undefined,
  target: string | undefined,
): boolean {
  if (
    result.exitCode !== 125 ||
    result.signal !== null ||
    result.stdout.trim() !== '[]' ||
    target === undefined
  ) return false;
  const stderr = result.stderr.trimEnd();
  if (resourceType === 'container') return stderr === `Error: no such container ${target}`;
  if (resourceType === 'volume') return stderr === `Error: no such volume ${target}`;
  if (resourceType === 'network') return stderr === `Error: network ${target}: network not found`;
  return false;
}

function stablePodmanResourceType(resourceType: string | undefined): string {
  if (resourceType === 'container') return 'CONTAINER';
  if (resourceType === 'volume') return 'VOLUME';
  if (resourceType === 'network') return 'NETWORK';
  return 'RESOURCE';
}

async function failedPartialRecoveryEvents(
  directory: string,
  identity: FormalRunIdentity,
): Promise<readonly string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const failures: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const value = JSON.parse(await readFile(join(directory, entry.name), 'utf8')) as unknown;
      if (!isRecord(value) || value['runId'] !== identity.runId) continue;
      if (
        value['status'] === 'FAILED' &&
        typeof value['stage'] === 'string' &&
        value['stage'].includes('PARTIAL_CLEANUP')
      ) {
        failures.push(typeof value['errorCode'] === 'string' ? value['errorCode'] : value['stage']);
      }
    }
    return [...new Set(failures)].sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

async function readPodmanStats(
  runner: RuntimeCommandRunner,
  id: string,
): Promise<Readonly<Record<string, string>> | null> {
  try {
    const result = await runner.run({
      executable: 'podman',
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
  assertSafeFormalCleanupCommand(executable, args);
  const result = await runner.run({
    executable,
    args,
    ...(environment === undefined ? {} : { environment }),
  });
  if (result.exitCode !== 0) throw new Error('FORMAL_CLEANUP_COMMAND_FAILED:' + args.join(':'));
}

function meaningfulArgument(value: string | undefined): value is string {
  return value !== undefined && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(value);
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

function wslConfigurationMatchesAuthority(
  configuration: WslHostEvidence['configuration'],
  authority: PodmanRuntimeAuthority['host'],
): boolean {
  const memory = configuration.memory;
  const swap = configuration.swap;
  return configuration.present &&
    configuration.processors === String(authority.processorCount) &&
    typeof memory === 'string' &&
    authority.wslConfigMemoryValues.some((value) =>
      value.toUpperCase() === memory.toUpperCase(),
    ) &&
    typeof swap === 'string' &&
    authority.wslConfigSwapValues.includes(swap);
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

function projectGovernedRuntimeLabels(
  labels: Readonly<Record<string, string>>,
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.keys(formalRuntimeLabels(identity, authority)).flatMap((name) =>
    typeof labels[name] === 'string' ? [[name, labels[name]]] : [],
  ));
}

function projectRuntimeResourceLabels(
  resource: RuntimeResourceRecord,
  identity: FormalRunIdentity,
  authority: PodmanRuntimeAuthority,
): RuntimeResourceRecord {
  return { ...resource, labels: projectGovernedRuntimeLabels(resource.labels, identity, authority) };
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

function normalizePodmanTimestamp(value: unknown): string | null {
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

export async function runControlledTeardownCli(
  input: {
    readonly evidenceDirectory: string;
    readonly repositoryRoot: string;
  },
  dependencies: FormalTeardownDependencies = createDefaultFormalTeardownDependencies(),
) {
  const evidenceDirectory = resolve(input.evidenceDirectory);
  const preflightPath = join(evidenceDirectory, 'runtime', 'preflight.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(preflightPath, 'utf8')) as unknown;
  } catch (error) {
    if (isMissing(error)) throw new Error('FORMAL_TEARDOWN_PREFLIGHT_MISSING');
    throw new Error('FORMAL_TEARDOWN_PREFLIGHT_INVALID');
  }
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 'phase-01.formal-preflight.v1') {
    throw new Error('FORMAL_TEARDOWN_PREFLIGHT_INVALID');
  }
  const rawIdentity = parsed['runIdentity'];
  if (!isRecord(rawIdentity)) throw new Error('FORMAL_TEARDOWN_RUN_IDENTITY_INVALID');
  const runId = rawIdentity['runId'];
  const runSequence = rawIdentity['runSequence'];
  const runtimeNamespace = rawIdentity['runtimeNamespace'];
  const gitCommitSha = rawIdentity['gitCommitSha'];
  if (
    typeof runId !== 'string' ||
    typeof runSequence !== 'number' ||
    typeof runtimeNamespace !== 'string' ||
    typeof gitCommitSha !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(gitCommitSha)
  ) throw new Error('FORMAL_TEARDOWN_RUN_IDENTITY_INVALID');
  const derived = createFormalRunSeed(runSequence, () => runId);
  if (derived.runtimeNamespace !== runtimeNamespace) {
    throw new Error('FORMAL_TEARDOWN_RUNTIME_NAMESPACE_IDENTITY_MISMATCH');
  }
  const identity: FormalRunIdentity = { ...derived, gitCommitSha };
  const runtimeAuthoritySha256 = parsed['runtimeAuthoritySha256'];
  const runtimeAuthoritySemanticDigest = parsed['runtimeAuthoritySemanticDigest'];
  const authorityCheck = Array.isArray(parsed['checks'])
    ? parsed['checks'].find((candidate) =>
      isRecord(candidate) && candidate['id'] === 'runtime-authority',
    )
    : undefined;
  const authorityCheckObserved = isRecord(authorityCheck)
    ? authorityCheck['observed']
    : undefined;
  if (
    parsed['status'] !== 'PASSED' ||
    typeof runtimeAuthoritySha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(runtimeAuthoritySha256) ||
    typeof runtimeAuthoritySemanticDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(runtimeAuthoritySemanticDigest) ||
    !isRecord(authorityCheck) ||
    authorityCheck['status'] !== 'PASSED' ||
    !isRecord(authorityCheckObserved) ||
    authorityCheckObserved['runtimeAuthoritySha256'] !== runtimeAuthoritySha256 ||
    authorityCheckObserved['runtimeAuthoritySemanticDigest'] !== runtimeAuthoritySemanticDigest
  ) throw new Error('FORMAL_TEARDOWN_PREFLIGHT_RUNTIME_AUTHORITY_INVALID');

  const authoritySnapshotPath = join(
    evidenceDirectory,
    'runtime',
    'runtime-authority-snapshot.json',
  );
  let rawAuthoritySnapshot: unknown;
  try {
    rawAuthoritySnapshot = JSON.parse(await readFile(authoritySnapshotPath, 'utf8')) as unknown;
  } catch (error) {
    if (isMissing(error)) throw new Error('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_MISSING');
    if (error instanceof SyntaxError) {
      throw new Error('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_JSON_INVALID');
    }
    throw new Error('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_READ_FAILED');
  }
  let authoritySnapshot;
  try {
    authoritySnapshot = parseFormalRuntimeAuthoritySnapshot(rawAuthoritySnapshot);
  } catch {
    throw new Error('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_INVALID');
  }
  if (
    authoritySnapshot.runIdentity.runId !== identity.runId ||
    authoritySnapshot.runIdentity.runSequence !== identity.runSequence ||
    authoritySnapshot.runIdentity.runtimeNamespace !== identity.runtimeNamespace ||
    authoritySnapshot.runIdentity.gitCommitSha !== identity.gitCommitSha
  ) throw new Error('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_RUN_IDENTITY_MISMATCH');
  if (
    authoritySnapshot.runtimeAuthoritySha256 !== runtimeAuthoritySha256 ||
    authoritySnapshot.runtimeAuthoritySemanticDigest !== runtimeAuthoritySemanticDigest
  ) throw new Error('FORMAL_TEARDOWN_AUTHORITY_SNAPSHOT_PREFLIGHT_MISMATCH');
  const runtimeAuthority: LoadedPodmanRuntimeAuthority = {
    authority: authoritySnapshot.authority,
    runtimeAuthoritySha256: authoritySnapshot.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: authoritySnapshot.runtimeAuthoritySemanticDigest,
  };
  const result = await performFormalTeardown({
    identity,
    repositoryRoot: resolve(input.repositoryRoot),
    runtimeEventDirectory: join(evidenceDirectory, 'runtime', 'events'),
    runtimeAuthority,
  }, dependencies);
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
  return {
    ...result,
    cleanupEvidencePath: evidenceWriteFailure === null ? followupPath : null,
    cleanupEvidenceWriteFailure: evidenceWriteFailure,
  };
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

async function runControlledTeardownCliEntrypoint(): Promise<void> {
  const evidenceDirectory = readCliArgument('--evidence-dir');
  if (evidenceDirectory === undefined) {
    throw new Error('FORMAL_TEARDOWN_EVIDENCE_DIRECTORY_REQUIRED');
  }
  const result = await runControlledTeardownCli({
    evidenceDirectory,
    repositoryRoot: resolve(import.meta.dirname, '../../../..'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.cleanup.status !== 'PASSED' || result.cleanupEvidenceWriteFailure !== null) {
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runControlledTeardownCliEntrypoint();
}
