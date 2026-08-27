import { ABG_GATES } from '../abg-catalog.js';
import {
  ABG_FROZEN_INPUT_KINDS,
  ABG_REFERENCE_KINDS,
  type AbgFrozenInputKind,
  type AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
  type JsonValue,
  type ProducerCommandIdentity,
  type ProducerEvidence,
  type ProducerEvidenceItem,
  type ProducerEvidenceStatus,
} from './protocol.js';
import { redactSensitiveText } from './recorder.js';
import { findMatrixAssertionsForProducer } from './validate-producer-evidence.js';

export interface ScenarioReferences {
  readonly requestIds?: readonly string[];
  readonly principalIds?: readonly string[];
  readonly governanceObjectIds?: readonly string[];
  readonly versionIds?: readonly string[];
  readonly ruleVersions?: readonly string[];
  readonly artifactDigests?: readonly string[];
}

export interface MatrixAssertionOutcome {
  readonly status: ProducerEvidenceStatus;
  readonly description: string;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
  readonly failureCode?: string;
  readonly evidenceItems?: readonly ProducerEvidenceItem[];
}

export interface ProducerAssertionObservation {
  readonly producerId: AbgProducerId;
  readonly scenarioId: string;
  readonly assertionId: string;
  readonly gateId: string;
  readonly status?: ProducerEvidenceStatus;
  readonly description: string;
  readonly expected?: JsonValue;
  readonly actual?: JsonValue;
  readonly failureCode?: string;
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
}

export interface BuildMatrixProducerEvidenceInput {
  readonly producerId: AbgProducerId;
  readonly runId: string;
  readonly runSequence: number;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly processStatus: 'PASSED' | 'FAILED';
  readonly commandIdentity: ProducerCommandIdentity;
  readonly environmentRefs: Readonly<Record<string, string>>;
  readonly frozenInputRefs: Readonly<Partial<Record<AbgFrozenInputKind, string>>>;
  readonly defaultEvidenceItems: readonly ProducerEvidenceItem[];
  readonly defaultReferences?: ScenarioReferences;
  readonly scenarioReferences?: Readonly<Record<string, ScenarioReferences>>;
  readonly outcomes?: Readonly<Record<string, MatrixAssertionOutcome>>;
}

export function buildMatrixProducerEvidence(input: BuildMatrixProducerEvidenceInput): ProducerEvidence {
  const scenarios: Record<string, {
    scenarioId: string;
    title: string;
    producerId: AbgProducerId;
    status: ProducerEvidenceStatus;
    requestIds: readonly string[];
    principalIds: readonly string[];
    governanceObjectIds: readonly string[];
    versionIds: readonly string[];
    ruleVersions: readonly string[];
    artifactDigests: readonly string[];
    assertions: Record<string, {
      assertionId: string;
      gateId: string;
      status: ProducerEvidenceStatus;
      description: string;
      expected: JsonValue;
      actual: JsonValue;
      failureCode: string | null;
      evidenceItems: readonly ProducerEvidenceItem[];
    }>;
  }> = {};
  const gatesById = new Map<string, (typeof ABG_GATES)[number]>(
    ABG_GATES.map((gate) => [gate.gateId, gate]),
  );

  for (const planned of findMatrixAssertionsForProducer(input.producerId)) {
    const existing = scenarios[planned.scenarioId];
    const references = {
      ...input.defaultReferences,
      ...input.scenarioReferences?.[planned.scenarioId],
    };
    const gate = gatesById.get(planned.entry.gateId);
    if (!gate) throw new Error('PRODUCER_EVIDENCE_GATE_CATALOG_MISSING:' + planned.entry.gateId);
    const outcome = input.outcomes?.[planned.assertionId];
    const initialStatus = input.processStatus === 'FAILED'
      ? 'FAILED'
      : outcome?.status ?? 'BLOCKED';
    const status = initialStatus === 'PASSED' && !hasRequiredReferences(
      planned.entry,
      input.frozenInputRefs,
      references,
    )
      ? 'BLOCKED'
      : initialStatus;
    const failureCode = status === 'PASSED'
      ? null
      : status === 'FAILED'
        ? outcome?.failureCode ?? 'PRODUCER_COMMAND_FAILED'
        : outcome?.failureCode ?? 'MATRIX_ASSERTION_EVIDENCE_INCOMPLETE';
    const scenario = existing ?? {
      scenarioId: planned.scenarioId,
      title: gate.title,
      producerId: input.producerId,
      status,
      requestIds: references.requestIds ?? [],
      principalIds: references.principalIds ?? [],
      governanceObjectIds: references.governanceObjectIds ?? [],
      versionIds: references.versionIds ?? [],
      ruleVersions: references.ruleVersions ?? [],
      artifactDigests: references.artifactDigests ?? input.defaultEvidenceItems.map((item) => item.sha256),
      assertions: {},
    };
    scenario.assertions[planned.assertionId] = {
      assertionId: planned.assertionId,
      gateId: planned.entry.gateId,
      status,
      description: outcome?.description ?? ('No stable observation was recorded for ' + planned.assertionId),
      expected: outcome?.expected ?? { status: 'PASSED' },
      actual: outcome?.actual ?? { processStatus: input.processStatus },
      failureCode,
      evidenceItems: outcome?.evidenceItems ?? input.defaultEvidenceItems,
    };
    scenario.status = mergeStatus(scenario.status, status);
    scenarios[planned.scenarioId] = scenario;
  }

  const statuses = Object.values(scenarios).map((scenario) => scenario.status);
  return {
    schemaVersion: PRODUCER_EVIDENCE_SCHEMA_VERSION,
    producerId: input.producerId,
    runId: input.runId,
    runSequence: input.runSequence,
    status: mergeStatuses(statuses, input.processStatus === 'FAILED' ? 'FAILED' : 'BLOCKED'),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    commandIdentity: input.commandIdentity,
    environmentRefs: input.environmentRefs,
    frozenInputRefs: input.frozenInputRefs,
    scenarios,
  };
}

export function buildProducerFailureEvidence(
  input: Omit<BuildMatrixProducerEvidenceInput, 'processStatus' | 'outcomes'> & {
    readonly failureCode: string;
    readonly failureMessage: string;
  },
): ProducerEvidence {
  return buildMatrixProducerEvidence({
    ...input,
    processStatus: 'FAILED',
    outcomes: Object.fromEntries(
      findMatrixAssertionsForProducer(input.producerId).map((planned) => [
        planned.assertionId,
        {
          status: 'FAILED' as const,
          description: redactSensitiveText(input.failureMessage),
          expected: { status: 'PASSED' },
          actual: { status: 'FAILED' },
          failureCode: input.failureCode,
        },
      ]),
    ),
  });
}

export function buildObservedProducerEvidence(
  input: Omit<BuildMatrixProducerEvidenceInput, 'outcomes' | 'scenarioReferences'> & {
    readonly observations: readonly ProducerAssertionObservation[];
  },
): ProducerEvidence {
  const outcomes: Record<string, MatrixAssertionOutcome> = {};
  const scenarioReferences: Record<string, ScenarioReferences> = {};
  for (const observation of input.observations) {
    if (observation.producerId !== input.producerId) continue;
    const planned = findMatrixAssertionsForProducer(input.producerId).find((candidate) =>
      candidate.entry.gateId === observation.gateId &&
      candidate.scenarioId === observation.scenarioId &&
      candidate.assertionId === observation.assertionId,
    );
    if (!planned) {
      throw new Error('PRODUCER_EVIDENCE_OBSERVATION_MATRIX_MISMATCH:' + observation.assertionId);
    }
    if (!observation.assertionId.startsWith(observation.gateId + ':')) {
      throw new Error('PRODUCER_EVIDENCE_OBSERVATION_GATE_MISMATCH:' + observation.assertionId);
    }
    if (outcomes[observation.assertionId]) {
      throw new Error('PRODUCER_EVIDENCE_OBSERVATION_DUPLICATE:' + observation.assertionId);
    }
    outcomes[observation.assertionId] = {
      status: observation.status ?? 'PASSED',
      description: observation.description,
      expected: observation.expected ?? { status: 'PASSED' },
      actual: observation.actual ?? { status: observation.status ?? 'PASSED' },
      ...(observation.failureCode === undefined ? {} : { failureCode: observation.failureCode }),
    };
    const existing = scenarioReferences[observation.scenarioId];
    scenarioReferences[observation.scenarioId] = {
      requestIds: mergeReferences(existing?.requestIds, observation.requestIds),
      principalIds: mergeReferences(existing?.principalIds, observation.principalIds),
      governanceObjectIds: mergeReferences(
        existing?.governanceObjectIds,
        observation.governanceObjectIds,
      ),
      versionIds: mergeReferences(existing?.versionIds, observation.versionIds),
      ruleVersions: mergeReferences(existing?.ruleVersions, observation.ruleVersions),
      artifactDigests: input.defaultEvidenceItems.map((item) => item.sha256),
    };
  }
  return buildMatrixProducerEvidence({ ...input, outcomes, scenarioReferences });
}

export function parseFrozenInputRefs(
  value: unknown,
): Readonly<Partial<Record<AbgFrozenInputKind, string>>> {
  if (!isRecord(value)) return {};
  const refs: Partial<Record<AbgFrozenInputKind, string>> = {};
  for (const kind of ABG_FROZEN_INPUT_KINDS) {
    const candidate = value[kind];
    if (typeof candidate === 'string' && candidate.length > 0) refs[kind] = candidate;
  }
  return refs;
}

export function buildLiveProducerEvidence(input: Omit<BuildMatrixProducerEvidenceInput, 'outcomes'> & {
  readonly verification: unknown;
}): ProducerEvidence {
  const verification = asRecord(input.verification);
  const authentication = asRecord(verification['authentication']);
  const runtime = asRecord(verification['runtime']);
  const consumption = asRecord(verification['consumption']);
  const databaseVerification = asRecord(verification['databaseVerification']);
  const charge = asRecord(verification['charge']);
  const price = asRecord(verification['price']);
  const resolution = asRecord(verification['resolution']);
  const runId = stringValue(verification['runId']);
  const principalId = stringValue(authentication['principalId']);
  const governanceObjectIds = stringArray(verification['governanceObjectIds']);
  const versionIds = [
    stringValue(charge['chargeItemVersionId']),
    stringValue(price['priceListReleaseId']),
  ].filter((value): value is string => value !== null);
  const requestIds = [
    runId,
    stringValue(resolution['priceResolutionId']),
  ].filter((value): value is string => value !== null);
  const openapiSha256 = stringValue(verification['openapiSha256']);
  const references: ScenarioReferences = {
    requestIds,
    principalIds: principalId === null ? [] : [principalId],
    governanceObjectIds,
    versionIds,
    ruleVersions: openapiSha256 === null ? [] : ['phase-01.openapi.sha256:' + openapiSha256],
    artifactDigests: input.defaultEvidenceItems.map((item) => item.sha256),
  };
  const runPassed = verification['status'] === 'PASSED';
  const outcomes: Record<string, MatrixAssertionOutcome> = {};
  for (const planned of findMatrixAssertionsForProducer('live')) {
    const observed = observeLiveAssertion(
      planned.entry.gateId,
      authentication,
      runtime,
      consumption,
      databaseVerification,
      verification,
    );
    outcomes[planned.assertionId] = {
      status: runPassed && observed ? 'PASSED' : 'BLOCKED',
      description: liveDescription(planned.entry.gateId),
      expected: { status: 'PASSED' },
      actual: { observed, runStatus: stringValue(verification['status']) },
      ...(runPassed && observed ? {} : { failureCode: 'LIVE_ASSERTION_NOT_OBSERVED' }),
    };
  }
  return buildMatrixProducerEvidence({
    ...input,
    defaultReferences: references,
    outcomes,
  });
}

function observeLiveAssertion(
  gateId: string,
  authentication: Readonly<Record<string, unknown>>,
  runtime: Readonly<Record<string, unknown>>,
  consumption: Readonly<Record<string, unknown>>,
  databaseVerification: Readonly<Record<string, unknown>>,
  verification: Readonly<Record<string, unknown>>,
): boolean {
  switch (gateId) {
    case 'ABG-03':
      return runtime['timezone'] === 'Asia/Shanghai' &&
        databaseVerification['timezoneAwareColumnCount'] === 0;
    case 'ABG-04':
      return authentication['authorizationCodeCallbackCompleted'] === true &&
        authentication['principalKind'] === 'PERSON' &&
        authentication['serviceIdentityBindingsVerified'] === true;
    case 'ABG-05':
      return verification['objectAuthorizationAllowDenyVerified'] === true;
    case 'ABG-06':
      return verification['campusScopeAllowDenyVerified'] === true;
    case 'ABG-12':
      return verification['priceResolutionPathVerified'] === true;
    case 'ABG-24':
      return databaseVerification['consumerBCompatibilityIssueStatus'] === 'RESOLVED' &&
        isRecord(verification['replay']);
    case 'ABG-35':
      return consumption['dualConsumerIsolationVerified'] === true;
    case 'ABG-36':
      return consumption['snapshotDownloadAndDigestVerified'] === true &&
        consumption['receiptAndCheckpointVerified'] === true;
    default:
      return false;
  }
}

function liveDescription(gateId: string): string {
  switch (gateId) {
    case 'ABG-03':
      return 'Live verification observes the fixed Asia/Shanghai contract and database timezone scan.';
    case 'ABG-04':
      return 'Live verification observes person sessions and service consumer subscriptions.';
    case 'ABG-05':
      return 'Live verification requires an explicit object authorization allow and deny observation.';
    case 'ABG-06':
      return 'Live verification requires an explicit campus scope allow and deny observation.';
    case 'ABG-12':
      return 'Live verification observes the fixed price resolution request and returned calculation path.';
    case 'ABG-24':
      return 'Live verification observes incompatible consumer isolation, upgrade, and replay.';
    case 'ABG-35':
      return 'Live verification observes independent dual-consumer blocking and recovery checkpoints.';
    case 'ABG-36':
      return 'Live verification observes canonical snapshot bytes, matching digests, receipts, and checkpoints.';
    default:
      return 'Live verification observation.';
  }
}

function hasRequiredReferences(
  entry: {
    readonly requiredReferenceKinds: readonly string[];
    readonly requiredFrozenInputs: readonly AbgFrozenInputKind[];
  },
  frozenInputRefs: Readonly<Partial<Record<AbgFrozenInputKind, string>>>,
  references: ScenarioReferences,
): boolean {
  const values: Readonly<Record<string, readonly string[]>> = {
    requestIds: references.requestIds ?? [],
    principalIds: references.principalIds ?? [],
    governanceObjectIds: references.governanceObjectIds ?? [],
    versionIds: references.versionIds ?? [],
    ruleVersions: references.ruleVersions ?? [],
    frozenInputDigests: Object.values(frozenInputRefs).filter(
      (value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value),
    ),
    artifactDigests: references.artifactDigests ?? [],
  };
  return entry.requiredReferenceKinds.every((kind) =>
    ABG_REFERENCE_KINDS.includes(kind as (typeof ABG_REFERENCE_KINDS)[number]) &&
    (values[kind]?.length ?? 0) > 0,
  ) && entry.requiredFrozenInputs.every((kind) => frozenInputRefs[kind] !== undefined);
}

function mergeStatuses(
  statuses: readonly ProducerEvidenceStatus[],
  emptyStatus: ProducerEvidenceStatus,
): ProducerEvidenceStatus {
  if (statuses.length === 0) return emptyStatus;
  if (statuses.includes('FAILED')) return 'FAILED';
  if (statuses.every((status) => status === 'PASSED')) return 'PASSED';
  return 'BLOCKED';
}

function mergeStatus(
  left: ProducerEvidenceStatus,
  right: ProducerEvidenceStatus,
): ProducerEvidenceStatus {
  return mergeStatuses([left, right], 'BLOCKED');
}

function mergeReferences(
  existing: readonly string[] | undefined,
  incoming: readonly string[],
): readonly string[] {
  return [...new Set([...(existing ?? []), ...incoming])];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
    ? value as readonly string[]
    : [];
}
