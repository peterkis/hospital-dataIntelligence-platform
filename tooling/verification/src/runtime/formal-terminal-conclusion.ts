import { FORMAL_RUNTIME_PORTS, type FormalRunIdentity } from './formal-runtime-contract.js';
import type { JsonValue } from '../evidence/protocol.js';
import type {
  FormalCleanupReport,
  RuntimeResourceRecord,
  RuntimeResourceSnapshot,
} from './formal-teardown.js';

export const FORMAL_TERMINAL_CONCLUSION_SCHEMA_VERSION =
  'phase-01.formal-terminal-conclusion.v1' as const;

type TerminalStatus = 'PASSED' | 'FAILED';

export interface FormalTerminalAssertion {
  readonly status: TerminalStatus;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
  readonly failureCodes: readonly string[];
}

export interface FormalTerminalConclusion {
  readonly schemaVersion: typeof FORMAL_TERMINAL_CONCLUSION_SCHEMA_VERSION;
  readonly runIdentity: FormalRunIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: TerminalStatus;
  readonly preflightStatus: TerminalStatus;
  readonly setupStatus: TerminalStatus;
  readonly nonFormalGateCount: number;
  readonly nonFormalPassedCount: number;
  readonly nonFormalFailedCount: number;
  readonly producerEvidencePersistedBeforeCleanup: boolean;
  readonly producerProtocolEvidenceCount: number;
  readonly cleanupStatus: TerminalStatus;
  readonly residualResourceCount: number;
  readonly residualContainerCount: number;
  readonly residualVolumeCount: number;
  readonly residualNetworkCount: number;
  readonly occupiedRequiredPorts: readonly number[];
  readonly requiredPortsObserved: readonly number[];
  readonly pruneCommandsInvoked: boolean;
  readonly frozenInputsStableAfterCleanup: boolean;
  readonly authorityIdentityStableAfterCleanup: boolean;
  readonly outputDirectoryExclusive: boolean;
  readonly failureCodes: readonly string[];
  readonly sealEligible: boolean;
  readonly assertions: {
    readonly terminalLifecycle: FormalTerminalAssertion;
    readonly sealEligibility: FormalTerminalAssertion;
  };
}

export interface BuildFormalTerminalConclusionInput {
  readonly runIdentity: FormalRunIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly preflightStatus: TerminalStatus;
  readonly setupStatus: TerminalStatus;
  readonly nonFormalGateResults: readonly {
    readonly gateId: string;
    readonly status: TerminalStatus;
  }[];
  readonly producerEvidencePersistedBeforeCleanup: boolean;
  readonly producerProtocolEvidenceCount: number;
  readonly cleanup: FormalCleanupReport;
  readonly finalResources: RuntimeResourceSnapshot;
  readonly frozenInputsStableAfterCleanup: boolean;
  readonly authorityIdentityStableAfterCleanup: boolean;
  readonly outputDirectoryExclusive: boolean;
  readonly failureCodes: readonly string[];
}

export function buildFormalTerminalConclusion(
  input: BuildFormalTerminalConclusionInput,
): FormalTerminalConclusion {
  const nonFormalGateCount = input.nonFormalGateResults.length;
  const nonFormalPassedCount = input.nonFormalGateResults.filter((gate) => gate.status === 'PASSED').length;
  const nonFormalFailedCount = nonFormalGateCount - nonFormalPassedCount;
  const residualResources = uniqueResidualResources([
    ...input.cleanup.residualResources,
    ...input.finalResources.resources.filter((resource) => resource.present),
  ]);
  const residualContainerCount = countResources(residualResources, 'container');
  const residualVolumeCount = countResources(residualResources, 'volume');
  const residualNetworkCount = countResources(residualResources, 'network');
  const observedPortSet = new Set(input.finalResources.ports.map((observation) => observation.port));
  const requiredPortsObserved = FORMAL_RUNTIME_PORTS.filter((port) => observedPortSet.has(port));
  const occupiedPortSet = new Set([
    ...input.cleanup.occupiedPorts,
    ...input.finalResources.ports
      .filter((observation) => observation.occupied)
      .map((observation) => observation.port),
  ]);
  const occupiedRequiredPorts = FORMAL_RUNTIME_PORTS.filter((port) => occupiedPortSet.has(port));
  const missingRequiredPorts = FORMAL_RUNTIME_PORTS.filter((port) => !requiredPortsObserved.includes(port));
  const unverifiableRequiredPorts = input.finalResources.ports.filter((observation) =>
    FORMAL_RUNTIME_PORTS.some((port) => port === observation.port) &&
      observation.verificationError !== null,
  );
  const pruneCommandsInvoked = Boolean(
    (input.cleanup as FormalCleanupReport & { readonly pruneCommandsInvoked: boolean }).pruneCommandsInvoked,
  );

  const lifecycleFailureCodes = [...input.failureCodes];
  if (input.preflightStatus !== 'PASSED') {
    lifecycleFailureCodes.push('FORMAL_TERMINAL_PREFLIGHT_NOT_PASSED');
  }
  if (input.setupStatus !== 'PASSED') lifecycleFailureCodes.push('FORMAL_TERMINAL_SETUP_NOT_PASSED');
  if (nonFormalGateCount !== 39 || nonFormalPassedCount !== 39 || nonFormalFailedCount !== 0) {
    lifecycleFailureCodes.push('FORMAL_TERMINAL_NON_FORMAL_GATES_INCOMPLETE');
  }
  if (input.cleanup.status !== 'PASSED') lifecycleFailureCodes.push('FORMAL_TERMINAL_CLEANUP_NOT_PASSED');
  if (residualResources.length !== 0) {
    lifecycleFailureCodes.push('FORMAL_TERMINAL_RESIDUAL_RESOURCES_PRESENT');
  }
  if (occupiedRequiredPorts.length !== 0) {
    lifecycleFailureCodes.push('FORMAL_TERMINAL_REQUIRED_PORT_OCCUPIED');
  }
  if (missingRequiredPorts.length !== 0) {
    lifecycleFailureCodes.push('FORMAL_TERMINAL_REQUIRED_PORT_OBSERVATION_MISSING');
  }
  if (unverifiableRequiredPorts.length !== 0) {
    lifecycleFailureCodes.push('FORMAL_TERMINAL_REQUIRED_PORT_VERIFICATION_FAILED');
  }
  if (pruneCommandsInvoked) lifecycleFailureCodes.push('FORMAL_TERMINAL_PRUNE_COMMAND_INVOKED');

  const sealFailureCodes: string[] = [];
  if (!input.producerEvidencePersistedBeforeCleanup) {
    sealFailureCodes.push('FORMAL_TERMINAL_PRODUCER_EVIDENCE_NOT_PERSISTED');
  }
  if (input.producerProtocolEvidenceCount <= 0) {
    sealFailureCodes.push('FORMAL_TERMINAL_PRODUCER_EVIDENCE_EMPTY');
  }
  if (!input.frozenInputsStableAfterCleanup) {
    sealFailureCodes.push('FORMAL_TERMINAL_FROZEN_INPUTS_DRIFT');
  }
  if (!input.authorityIdentityStableAfterCleanup) {
    sealFailureCodes.push('FORMAL_TERMINAL_AUTHORITY_IDENTITY_DRIFT');
  }
  if (!input.outputDirectoryExclusive) {
    sealFailureCodes.push('FORMAL_TERMINAL_OUTPUT_DIRECTORY_NOT_EXCLUSIVE');
  }

  const terminalLifecycle: FormalTerminalAssertion = {
    status: lifecycleFailureCodes.length === 0 ? 'PASSED' : 'FAILED',
    expected: {
      preflightStatus: 'PASSED',
      setupStatus: 'PASSED',
      nonFormalPassedCount: 39,
      cleanupStatus: 'PASSED',
      residualResourceCount: 0,
      occupiedRequiredPorts: [],
      requiredPortsObserved: FORMAL_RUNTIME_PORTS,
      pruneCommandsInvoked: false,
    },
    actual: {
      preflightStatus: input.preflightStatus,
      setupStatus: input.setupStatus,
      nonFormalGateCount,
      nonFormalPassedCount,
      nonFormalFailedCount,
      cleanupStatus: input.cleanup.status,
      residualResourceCount: residualResources.length,
      occupiedRequiredPorts,
      requiredPortsObserved,
      requiredPortObservationFailures: unverifiableRequiredPorts.map((observation) => ({
        port: observation.port,
        verificationError: observation.verificationError,
      })),
      pruneCommandsInvoked,
    },
    failureCodes: unique(lifecycleFailureCodes),
  };
  const sealEligibility: FormalTerminalAssertion = {
    status: sealFailureCodes.length === 0 ? 'PASSED' : 'FAILED',
    expected: {
      producerEvidencePersistedBeforeCleanup: true,
      producerProtocolEvidenceCountMinimum: 1,
      frozenInputsStableAfterCleanup: true,
      authorityIdentityStableAfterCleanup: true,
      outputDirectoryExclusive: true,
    },
    actual: {
      producerEvidencePersistedBeforeCleanup: input.producerEvidencePersistedBeforeCleanup,
      producerProtocolEvidenceCount: input.producerProtocolEvidenceCount,
      frozenInputsStableAfterCleanup: input.frozenInputsStableAfterCleanup,
      authorityIdentityStableAfterCleanup: input.authorityIdentityStableAfterCleanup,
      outputDirectoryExclusive: input.outputDirectoryExclusive,
    },
    failureCodes: unique(sealFailureCodes),
  };
  const sealEligible = terminalLifecycle.status === 'PASSED' && sealEligibility.status === 'PASSED';

  return {
    schemaVersion: FORMAL_TERMINAL_CONCLUSION_SCHEMA_VERSION,
    runIdentity: input.runIdentity,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    status: sealEligible ? 'PASSED' : 'FAILED',
    preflightStatus: input.preflightStatus,
    setupStatus: input.setupStatus,
    nonFormalGateCount,
    nonFormalPassedCount,
    nonFormalFailedCount,
    producerEvidencePersistedBeforeCleanup: input.producerEvidencePersistedBeforeCleanup,
    producerProtocolEvidenceCount: input.producerProtocolEvidenceCount,
    cleanupStatus: input.cleanup.status,
    residualResourceCount: residualResources.length,
    residualContainerCount,
    residualVolumeCount,
    residualNetworkCount,
    occupiedRequiredPorts,
    requiredPortsObserved,
    pruneCommandsInvoked,
    frozenInputsStableAfterCleanup: input.frozenInputsStableAfterCleanup,
    authorityIdentityStableAfterCleanup: input.authorityIdentityStableAfterCleanup,
    outputDirectoryExclusive: input.outputDirectoryExclusive,
    failureCodes: unique([...lifecycleFailureCodes, ...sealFailureCodes]),
    sealEligible,
    assertions: { terminalLifecycle, sealEligibility },
  };
}

function uniqueResidualResources(
  resources: readonly RuntimeResourceRecord[],
): readonly RuntimeResourceRecord[] {
  return [...new Map(resources.map((resource) => [
    `${resource.resourceType}:${resource.id}:${resource.name}`,
    resource,
  ])).values()];
}

function countResources(
  resources: readonly RuntimeResourceRecord[],
  type: RuntimeResourceRecord['resourceType'],
): number {
  return resources.filter((resource) => resource.resourceType === type).length;
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
