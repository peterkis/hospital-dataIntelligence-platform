import { ABG_GATES } from './abg-catalog.js';
import {
  ABG_COVERAGE_MATRIX,
  type AbgCoverageMatrixEntry,
  type AbgReferenceKind,
} from './abg-coverage-matrix.js';
import { canonicalJson } from './evidence/recorder.js';
import { FORMAL_RUNTIME_PORTS } from './runtime/formal-runtime-contract.js';

export const RUN_SUMMARY_SCHEMA_VERSION = 'phase-01.abg-run.v4';
const GATE_RESULT_SCHEMA_VERSION = 'phase-01.abg-gate-result.v3';
const CONCLUSION_SCOPE = 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;

export interface FormalAbgSummaryValidationExpectations {
  readonly runSequence: number;
  readonly planDigest: string;
  readonly frozenInputs: Readonly<Record<string, string>>;
  readonly frozenInputsDigest: string;
  readonly coverageMatrixDigest: string;
  readonly producerProtocolIdentityDigest: string;
  readonly setupCommandDigests: readonly string[];
}

/**
 * Validates the runner-owned, machine-readable PASSED summary before it can be
 * sealed. This is deliberately pure: filesystem bytes and producer claims are
 * revalidated separately by the independent reviewer.
 */
export function validateFormalAbgSummary(
  value: unknown,
  expected: FormalAbgSummaryValidationExpectations,
): void {
  const summary = requireRecord(value, 'RUN_SUMMARY_INVALID');
  assert(summary['schemaVersion'] === RUN_SUMMARY_SCHEMA_VERSION, 'RUN_SUMMARY_SCHEMA_VERSION_INVALID');
  const runId = requireMeaningfulString(summary['runId'], 'RUN_ID_INVALID');
  assertPositiveInteger(summary['runSequence'], 'RUN_SEQUENCE_INVALID');
  assert(summary['runSequence'] === expected.runSequence, 'RUN_SEQUENCE_MISMATCH');
  assert(summary['planDigest'] === expected.planDigest, 'RUN_PLAN_DIGEST_MISMATCH');
  assert(summary['frozenInputsDigest'] === expected.frozenInputsDigest, 'FROZEN_INPUTS_DIGEST_MISMATCH');
  assert(jsonEqual(summary['frozenInputs'], expected.frozenInputs), 'FROZEN_INPUTS_MISMATCH');
  assert(summary['coverageMatrixDigest'] === expected.coverageMatrixDigest, 'COVERAGE_MATRIX_DIGEST_MISMATCH');
  assert(
    summary['producerProtocolIdentityDigest'] === expected.producerProtocolIdentityDigest,
    'PRODUCER_PROTOCOL_DIGEST_MISMATCH',
  );
  assert(summary['selectorSetsDistinct'] === true, 'SELECTOR_SETS_NOT_DECLARED_DISTINCT');
  assert(summary['timezone'] === 'Asia/Shanghai', 'RUN_TIMEZONE_INVALID');
  assert(summary['conclusionScope'] === CONCLUSION_SCOPE, 'CONCLUSION_SCOPE_INVALID');
  const startedAt = requireString(summary['startedAt'], 'RUN_STARTED_AT_INVALID');
  const completedAt = requireString(summary['completedAt'], 'RUN_COMPLETED_AT_INVALID');
  assert(isLocalDateTime(startedAt), 'RUN_STARTED_AT_INVALID');
  assert(isLocalDateTime(completedAt), 'RUN_COMPLETED_AT_INVALID');
  assert(startedAt <= completedAt, 'RUN_TIME_ORDER_INVALID');

  validateSetupResults(summary['setupResults'], expected.setupCommandDigests);

  const results = requireRecordArray(summary['results'], 'GATE_RESULTS_INVALID');
  assert(results.length === ABG_GATES.length, 'GATE_RESULT_COUNT_INVALID');
  assert(summary['gateCount'] === ABG_GATES.length, 'GATE_COUNT_INVALID');
  const gateIds = results.map((result) => requireString(result['gateId'], 'GATE_ID_INVALID'));
  assert(new Set(gateIds).size === gateIds.length, 'GATE_ID_DUPLICATE');
  for (const [index, gate] of ABG_GATES.entries()) {
    assert(results[index]?.['gateId'] === gate.gateId, 'GATE_ORDER_OR_ID_MISMATCH');
  }

  const statuses = results.map((result) => {
    const status = result['status'];
    assert(status === 'PASSED' || status === 'FAILED', 'GATE_STATUS_INVALID');
    return status;
  });
  const passedCount = statuses.filter((status) => status === 'PASSED').length;
  const failedCount = statuses.filter((status) => status === 'FAILED').length;
  assert(summary['passedCount'] === passedCount, 'PASSED_COUNT_MISMATCH');
  assert(summary['failedCount'] === failedCount, 'FAILED_COUNT_MISMATCH');
  const derivedGateStatus = failedCount === 0 ? 'PASSED' : 'FAILED';
  assert(summary['status'] !== 'PASSED' || derivedGateStatus === 'PASSED', 'RUN_STATUS_MISMATCH');

  const selectorSignatures: string[] = [];
  for (const [index, gate] of ABG_GATES.entries()) {
    const result = results[index]!;
    const entry = ABG_COVERAGE_MATRIX[index]!;
    assert(result['title'] === gate.title, 'GATE_TITLE_MISMATCH');
    assert(result['evidenceClass'] === gate.evidenceClass, 'GATE_EVIDENCE_CLASS_MISMATCH');
    assert(result['ordinal'] === index + 1, 'GATE_ORDINAL_MISMATCH');
    assert(result['runId'] === runId, 'GATE_RUN_ID_MISMATCH');
    assertNonNegativeInteger(result['elapsedMilliseconds'], 'GATE_ELAPSED_INVALID');

    if (result['status'] === 'FAILED') {
      requireMeaningfulString(result['failureCode'], 'GATE_FAILURE_CODE_REQUIRED');
      assert(result['proofPath'] === null, 'GATE_FAILED_WITH_PROOF_PATH');
      assert(result['proof'] === null, 'GATE_FAILED_WITH_PROOF');
      continue;
    }

    assert(result['producerExitCode'] === 0, 'GATE_PRODUCER_EXIT_CODE_INVALID');
    assert(!Object.hasOwn(result, 'failureCode'), 'GATE_PASSED_WITH_FAILURE_CODE');
    const proofPath = requireMeaningfulString(result['proofPath'], 'GATE_PROOF_PATH_INVALID');
    assert(proofPath === `gates/${gate.gateId}/producer/result.json`, 'GATE_PROOF_PATH_INVALID');
    const proof = requireRecord(result['proof'], 'GATE_PROOF_MISSING');
    assert(proof['schemaVersion'] === GATE_RESULT_SCHEMA_VERSION, 'GATE_PROOF_SCHEMA_VERSION_INVALID');
    assert(proof['gateId'] === gate.gateId, 'GATE_PROOF_GATE_ID_MISMATCH');
    assert(proof['runId'] === runId, 'GATE_PROOF_RUN_ID_MISMATCH');
    assert(proof['runSequence'] === expected.runSequence, 'GATE_PROOF_RUN_SEQUENCE_MISMATCH');
    assert(proof['status'] === 'PASSED', 'GATE_PROOF_STATUS_NOT_PASSED');
    assert(proof['coverageMatrixDigest'] === expected.coverageMatrixDigest, 'GATE_PROOF_COVERAGE_DIGEST_MISMATCH');
    assertExactStringArray(proof['scenarioIds'], entry.scenarioIds, 'GATE_SCENARIOS_MISMATCH');
    assertExactStringArray(proof['assertionIds'], entry.assertionIds, 'GATE_ASSERTIONS_MISMATCH');
    validateProofReferenceArrays(proof, entry);

    const refs = requireRecordArray(proof['evidenceRefs'], 'GATE_EVIDENCE_REFS_INVALID');
    assert(refs.length > 0, 'GATE_EVIDENCE_REFS_INVALID');
    assert(refs.length === entry.evidenceSelectors.length, 'GATE_SELECTOR_COUNT_MISMATCH');
    for (const selector of entry.evidenceSelectors) {
      const matching = refs.filter((reference) =>
        reference['producerId'] === selector.producerId &&
        reference['scenarioId'] === selector.scenarioId &&
        reference['assertionId'] === selector.assertionId
      );
      assert(matching.length > 0, 'GATE_SELECTOR_MISSING');
      assert(matching.length === 1, 'GATE_SELECTOR_DUPLICATE');
    }
    for (const reference of refs) {
      validateEvidenceReferenceShape(reference);
      assert(entry.evidenceSelectors.some((selector) =>
        reference['producerId'] === selector.producerId &&
        reference['scenarioId'] === selector.scenarioId &&
        reference['assertionId'] === selector.assertionId
      ), 'GATE_SELECTOR_UNDECLARED');
    }
    selectorSignatures.push(refs.map(selectorSignature).sort().join('|'));
  }
  assert(new Set(selectorSignatures).size === ABG_GATES.length, 'GATE_SELECTOR_SETS_NOT_DISTINCT');

  const nonFormalResults = results.slice(0, 39);
  const derivedNonFormalGateStatus = nonFormalResults.length === 39 &&
    nonFormalResults.every((result) => result['status'] === 'PASSED')
    ? 'PASSED'
    : 'FAILED';
  assert(summary['preflightStatus'] === 'PASSED', 'PREFLIGHT_STATUS_NOT_PASSED');
  assert(summary['setupStatus'] === 'PASSED', 'SETUP_STATUS_NOT_PASSED');
  assert(summary['nonFormalGateStatus'] === derivedNonFormalGateStatus, 'NON_FORMAL_GATE_STATUS_MISMATCH');
  assert(derivedNonFormalGateStatus === 'PASSED', 'NON_FORMAL_GATE_STATUS_NOT_PASSED');

  const producerEvidencePersisted = summary['producerEvidencePersistedBeforeCleanup'] === true;
  const producerProtocolEvidenceCount = summary['producerProtocolEvidenceCount'];
  const derivedProducerEvidenceStatus = producerEvidencePersisted &&
    Number.isSafeInteger(producerProtocolEvidenceCount) && Number(producerProtocolEvidenceCount) > 0
    ? 'PASSED'
    : 'FAILED';
  assert(summary['producerEvidenceStatus'] === derivedProducerEvidenceStatus, 'PRODUCER_EVIDENCE_STATUS_MISMATCH');
  assert(derivedProducerEvidenceStatus === 'PASSED', 'PRODUCER_EVIDENCE_STATUS_NOT_PASSED');

  assert(summary['cleanupStatus'] === 'PASSED', 'CLEANUP_STATUS_NOT_PASSED');
  assert(summary['residualResourceCount'] === 0, 'RESIDUAL_RESOURCES_PRESENT');
  assert(summary['residualContainerCount'] === 0, 'RESIDUAL_CONTAINER_PRESENT');
  assert(summary['residualVolumeCount'] === 0, 'RESIDUAL_VOLUME_PRESENT');
  assert(summary['residualNetworkCount'] === 0, 'RESIDUAL_NETWORK_PRESENT');
  assertExactNumberArray(summary['occupiedRequiredPorts'], [], 'OCCUPIED_REQUIRED_PORTS_PRESENT');
  assertExactNumberArray(
    summary['requiredPortsObserved'],
    FORMAL_RUNTIME_PORTS,
    'REQUIRED_PORT_OBSERVATIONS_INCOMPLETE',
  );
  assert(summary['pruneCommandsInvoked'] === false, 'PRUNE_COMMANDS_INVOKED');
  assert(summary['frozenInputsStableAfterCleanup'] === true, 'FROZEN_INPUTS_NOT_STABLE');
  assert(summary['authorityIdentityStableAfterCleanup'] === true, 'AUTHORITY_IDENTITY_NOT_STABLE');
  assert(summary['outputDirectoryExclusive'] === true, 'OUTPUT_DIRECTORY_NOT_EXCLUSIVE');
  assert(summary['terminalConclusionStatus'] === 'PASSED', 'TERMINAL_CONCLUSION_STATUS_NOT_PASSED');
  assert(summary['sealEligibilityStatus'] === 'PASSED', 'SEAL_ELIGIBILITY_STATUS_NOT_PASSED');

  const derivedLifecycleStatus = summary['preflightStatus'] === 'PASSED' &&
    summary['setupStatus'] === 'PASSED' &&
    derivedNonFormalGateStatus === 'PASSED' &&
    derivedProducerEvidenceStatus === 'PASSED' &&
    summary['cleanupStatus'] === 'PASSED' &&
    summary['residualResourceCount'] === 0 &&
    summary['residualContainerCount'] === 0 &&
    summary['residualVolumeCount'] === 0 &&
    summary['residualNetworkCount'] === 0 &&
    summary['frozenInputsStableAfterCleanup'] === true &&
    summary['authorityIdentityStableAfterCleanup'] === true &&
    summary['outputDirectoryExclusive'] === true &&
    summary['terminalConclusionStatus'] === 'PASSED' &&
    summary['sealEligibilityStatus'] === 'PASSED'
    ? 'PASSED'
    : 'FAILED';
  assert(summary['lifecycleStatus'] === derivedLifecycleStatus, 'LIFECYCLE_STATUS_MISMATCH');
  const derivedStatus = derivedGateStatus === 'PASSED' && derivedLifecycleStatus === 'PASSED'
    ? 'PASSED'
    : 'FAILED';
  assert(summary['status'] === derivedStatus, 'RUN_STATUS_MISMATCH');
  const failureCodes = requireStringArray(summary['failureCodes'], 'RUN_FAILURE_CODES_INVALID');
  assert(failureCodes.length === 0, 'PASSED_RUN_HAS_FAILURE_CODES');
}

function validateSetupResults(value: unknown, expectedDigests: readonly string[]): void {
  const results = requireRecordArray(value, 'SETUP_RESULTS_INVALID');
  assert(results.length === expectedDigests.length, 'SETUP_RESULT_COUNT_MISMATCH');
  for (const [index, digest] of expectedDigests.entries()) {
    const result = results[index]!;
    assert(result['ordinal'] === index + 1, 'SETUP_RESULT_ORDINAL_MISMATCH');
    assert(result['commandDigest'] === digest, 'SETUP_COMMAND_DIGEST_MISMATCH');
    assert(result['exitCode'] === 0, 'SETUP_EXIT_CODE_INVALID');
    assertNonNegativeInteger(result['elapsedMilliseconds'], 'SETUP_ELAPSED_INVALID');
  }
}

function validateProofReferenceArrays(
  proof: Readonly<Record<string, unknown>>,
  entry: AbgCoverageMatrixEntry,
): void {
  for (const [field, kind, code] of [
    ['requestIds', 'requestIds', 'GATE_REQUEST_IDS_REQUIRED'],
    ['principalIds', 'principalIds', 'GATE_PRINCIPAL_IDS_REQUIRED'],
    ['governanceObjectIds', 'governanceObjectIds', 'GATE_GOVERNANCE_OBJECT_IDS_REQUIRED'],
    ['versionIds', 'versionIds', 'GATE_VERSION_IDS_REQUIRED'],
    ['ruleVersions', 'ruleVersions', 'GATE_RULE_VERSIONS_REQUIRED'],
    ['frozenInputDigests', 'frozenInputDigests', 'GATE_FROZEN_INPUT_DIGESTS_REQUIRED'],
    ['artifactDigests', 'artifactDigests', 'GATE_ARTIFACT_DIGESTS_REQUIRED'],
  ] as const) {
    const values = requireStringArray(proof[field], code);
    assert(
      !entry.requiredReferenceKinds.includes(kind as AbgReferenceKind) || values.length > 0,
      code,
    );
    assert(values.every(isMeaningful), code);
    if (kind === 'frozenInputDigests' || kind === 'artifactDigests') {
      assert(values.every((value) => SHA256_PATTERN.test(value)), code);
    }
  }
}

function validateEvidenceReferenceShape(reference: Readonly<Record<string, unknown>>): void {
  requireMeaningfulString(reference['artifactId'], 'EVIDENCE_REFERENCE_ARTIFACT_ID_INVALID');
  requireMeaningfulString(reference['relativePath'], 'EVIDENCE_REFERENCE_PATH_INVALID');
  requireMeaningfulString(reference['mediaType'], 'EVIDENCE_REFERENCE_MEDIA_TYPE_INVALID');
  assertNonNegativeInteger(reference['byteLength'], 'EVIDENCE_REFERENCE_BYTE_LENGTH_INVALID');
  assert(typeof reference['sha256'] === 'string' && SHA256_PATTERN.test(reference['sha256']), 'EVIDENCE_REFERENCE_SHA256_INVALID');
  requireMeaningfulString(reference['producerId'], 'EVIDENCE_REFERENCE_PRODUCER_INVALID');
  requireMeaningfulString(reference['scenarioId'], 'EVIDENCE_REFERENCE_SCENARIO_INVALID');
  requireMeaningfulString(reference['assertionId'], 'EVIDENCE_REFERENCE_ASSERTION_INVALID');
  requireMeaningfulString(reference['jsonPointer'], 'EVIDENCE_REFERENCE_POINTER_INVALID');
  assert(
    typeof reference['selectedClaimDigest'] === 'string' && SHA256_PATTERN.test(reference['selectedClaimDigest']),
    'EVIDENCE_REFERENCE_CLAIM_DIGEST_INVALID',
  );
}

function selectorSignature(reference: Readonly<Record<string, unknown>>): string {
  return [
    reference['producerId'],
    reference['scenarioId'],
    reference['assertionId'],
    reference['relativePath'],
    reference['jsonPointer'],
  ].join('\0');
}

function requireRecord(value: unknown, code: string): Readonly<Record<string, unknown>> {
  assert(typeof value === 'object' && value !== null && !Array.isArray(value), code);
  return value as Readonly<Record<string, unknown>>;
}

function requireRecordArray(value: unknown, code: string): readonly Readonly<Record<string, unknown>>[] {
  assert(Array.isArray(value), code);
  return value.map((item) => requireRecord(item, code));
}

function requireStringArray(value: unknown, code: string): readonly string[] {
  assert(Array.isArray(value) && value.every((item) => typeof item === 'string'), code);
  return value as readonly string[];
}

function assertExactStringArray(value: unknown, expected: readonly string[], code: string): void {
  const actual = requireStringArray(value, code);
  assert(actual.length === expected.length && actual.every((item, index) => item === expected[index]), code);
}

function assertExactNumberArray(value: unknown, expected: readonly number[], code: string): void {
  assert(Array.isArray(value) && value.every((item) => Number.isSafeInteger(item)), code);
  const actual = value as readonly number[];
  assert(actual.length === expected.length && actual.every((item, index) => item === expected[index]), code);
}

function requireString(value: unknown, code: string): string {
  assert(typeof value === 'string', code);
  return value;
}

function requireMeaningfulString(value: unknown, code: string): string {
  const text = requireString(value, code);
  assert(isMeaningful(text), code);
  return text;
}

function isMeaningful(value: string): boolean {
  const normalized = value.trim();
  return normalized.length > 0 && !/^(?:placeholder|unknown|n\/a)$/iu.test(normalized);
}

function assertPositiveInteger(value: unknown, code: string): void {
  assert(Number.isSafeInteger(value) && Number(value) > 0, code);
}

function assertNonNegativeInteger(value: unknown, code: string): void {
  assert(Number.isSafeInteger(value) && Number(value) >= 0, code);
}

function isLocalDateTime(value: string): boolean {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return false;
  const [date, time] = value.split('T');
  if (date === undefined || time === undefined) return false;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  if ([year, month, day, hour, minute, second].some((part) => !Number.isInteger(part))) return false;
  const instant = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  return instant.getUTCFullYear() === year &&
    instant.getUTCMonth() + 1 === month &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left as never) === canonicalJson(right as never);
  } catch {
    return false;
  }
}

function assert(condition: boolean, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
