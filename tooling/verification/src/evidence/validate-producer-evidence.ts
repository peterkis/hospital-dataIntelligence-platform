import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_REFERENCE_KINDS,
  getAbgCoverageEntry,
  type AbgCoverageMatrixEntry,
} from '../abg-coverage-matrix.js';
import {
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
  type ProducerAssertionEvidence,
  type ProducerEvidence,
  type ProducerEvidenceItem,
  type ProducerScenarioEvidence,
} from './protocol.js';
import {
  assertEvidenceStatus,
  assertJsonSafe,
  assertKnownFrozenInputKind,
  assertKnownProducerId,
  assertMeaningful,
  assertNoSensitiveData,
  isSensitiveEnvironmentName,
  assertSafeRelativePath,
  assertSha256,
  assertStrictJsonPointer,
} from './schema.js';

export function validateProducerEvidence(evidence: ProducerEvidence): void {
  if (evidence.schemaVersion !== PRODUCER_EVIDENCE_SCHEMA_VERSION) {
    throw new Error('PRODUCER_EVIDENCE_SCHEMA_VERSION_INVALID');
  }
  assertKnownProducerId(evidence.producerId);
  assertMeaningful(evidence.runId, 'PRODUCER_EVIDENCE_RUN_ID_INVALID');
  if (!Number.isSafeInteger(evidence.runSequence) || evidence.runSequence <= 0) {
    throw new Error('PRODUCER_EVIDENCE_RUN_SEQUENCE_INVALID');
  }
  assertEvidenceStatus(evidence.status);
  assertLocalDateTime(evidence.startedAt, 'PRODUCER_EVIDENCE_STARTED_AT_INVALID');
  assertLocalDateTime(evidence.completedAt, 'PRODUCER_EVIDENCE_COMPLETED_AT_INVALID');
  validateCommandIdentity(evidence);
  validateEnvironmentRefs(evidence);
  validateFrozenInputRefs(evidence);

  const scenarioIds = new Set<string>();
  const assertionIds = new Set<string>();
  const scenarioEntries = Object.entries(evidence.scenarios);
  if (evidence.status === 'PASSED' && scenarioEntries.length === 0) {
    throw new Error('PRODUCER_EVIDENCE_SCENARIO_REQUIRED');
  }
  for (const [scenarioKey, scenario] of scenarioEntries) {
    validateScenario(evidence, scenarioKey, scenario, scenarioIds, assertionIds);
  }
  if (
    evidence.status === 'PASSED' &&
    scenarioEntries.some(([, scenario]) => scenario.status !== 'PASSED')
  ) {
    throw new Error('PRODUCER_EVIDENCE_PASSED_WITH_NON_PASSED_SCENARIO');
  }
}

function validateCommandIdentity(evidence: ProducerEvidence): void {
  const command = evidence.commandIdentity;
  assertMeaningful(command.executable, 'PRODUCER_EVIDENCE_COMMAND_EXECUTABLE_INVALID');
  if (command.arguments.some((argument) => typeof argument !== 'string')) {
    throw new Error('PRODUCER_EVIDENCE_COMMAND_ARGUMENT_INVALID');
  }
  assertSafeRelativePath(command.workingDirectory, 'PRODUCER_EVIDENCE_COMMAND_DIRECTORY_INVALID');
  assertSha256(command.commandDigest, 'PRODUCER_EVIDENCE_COMMAND_DIGEST_INVALID');
  assertNoSensitiveData(command, 'PRODUCER_EVIDENCE_COMMAND_SENSITIVE');
}

function validateEnvironmentRefs(evidence: ProducerEvidence): void {
  for (const [name, digest] of Object.entries(evidence.environmentRefs)) {
    if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) {
      throw new Error('PRODUCER_EVIDENCE_ENVIRONMENT_NAME_INVALID:' + name);
    }
    if (isSensitiveEnvironmentName(name)) {
      throw new Error('PRODUCER_EVIDENCE_ENVIRONMENT_SENSITIVE:' + name);
    }
    assertSha256(digest, 'PRODUCER_EVIDENCE_ENVIRONMENT_DIGEST_INVALID:' + name);
  }
}

function validateFrozenInputRefs(evidence: ProducerEvidence): void {
  for (const [kind, value] of Object.entries(evidence.frozenInputRefs)) {
    assertKnownFrozenInputKind(kind);
    assertMeaningful(value, 'PRODUCER_EVIDENCE_FROZEN_INPUT_INVALID:' + kind);
    assertNoSensitiveData(value, 'PRODUCER_EVIDENCE_FROZEN_INPUT_SENSITIVE:' + kind);
    if (
      kind.endsWith('Sha256') ||
      kind === 'fixtureIdentity' ||
      kind === 'runtimeAuthoritySemanticDigest'
    ) {
      assertSha256(value, 'PRODUCER_EVIDENCE_FROZEN_INPUT_DIGEST_INVALID:' + kind);
    }
  }
}

function validateScenario(
  evidence: ProducerEvidence,
  scenarioKey: string,
  scenario: ProducerScenarioEvidence,
  scenarioIds: Set<string>,
  assertionIds: Set<string>,
): void {
  assertMeaningful(scenarioKey, 'PRODUCER_EVIDENCE_SCENARIO_KEY_INVALID');
  assertMeaningful(scenario.scenarioId, 'PRODUCER_EVIDENCE_SCENARIO_ID_INVALID');
  if (scenarioKey !== scenario.scenarioId || scenarioIds.has(scenario.scenarioId)) {
    throw new Error('PRODUCER_EVIDENCE_SCENARIO_DUPLICATE:' + scenario.scenarioId);
  }
  scenarioIds.add(scenario.scenarioId);
  if (scenario.producerId !== evidence.producerId) {
    throw new Error('PRODUCER_EVIDENCE_SCENARIO_PRODUCER_MISMATCH:' + scenario.scenarioId);
  }
  assertEvidenceStatus(scenario.status);
  assertMeaningful(scenario.title, 'PRODUCER_EVIDENCE_SCENARIO_TITLE_INVALID');
  assertReferenceArray(scenario.requestIds, 'requestIds', scenario.scenarioId);
  assertReferenceArray(scenario.principalIds, 'principalIds', scenario.scenarioId);
  assertReferenceArray(scenario.governanceObjectIds, 'governanceObjectIds', scenario.scenarioId);
  assertReferenceArray(scenario.versionIds, 'versionIds', scenario.scenarioId);
  assertReferenceArray(scenario.ruleVersions, 'ruleVersions', scenario.scenarioId);
  assertReferenceArray(scenario.artifactDigests, 'artifactDigests', scenario.scenarioId, true);

  const assertions = Object.entries(scenario.assertions);
  if (scenario.status === 'PASSED' && assertions.length === 0) {
    throw new Error('PRODUCER_EVIDENCE_ASSERTION_REQUIRED:' + scenario.scenarioId);
  }
  for (const [assertionKey, assertion] of assertions) {
    validateAssertion(evidence, scenario, assertionKey, assertion, assertionIds);
  }
  if (
    scenario.status === 'PASSED' &&
    assertions.some(([, assertion]) => assertion.status !== 'PASSED')
  ) {
    throw new Error('PRODUCER_EVIDENCE_SCENARIO_PASSED_WITH_NON_PASSED_ASSERTION');
  }
}

function validateAssertion(
  evidence: ProducerEvidence,
  scenario: ProducerScenarioEvidence,
  assertionKey: string,
  assertion: ProducerAssertionEvidence,
  assertionIds: Set<string>,
): void {
  assertMeaningful(assertion.assertionId, 'PRODUCER_EVIDENCE_ASSERTION_ID_INVALID');
  if (assertionKey !== assertion.assertionId || assertionIds.has(assertion.assertionId)) {
    throw new Error('PRODUCER_EVIDENCE_ASSERTION_DUPLICATE:' + assertion.assertionId);
  }
  assertionIds.add(assertion.assertionId);
  const entry = resolveMatrixAssertion(assertion);
  if (!entry.producerIds.includes(evidence.producerId)) {
    throw new Error(
      'PRODUCER_EVIDENCE_ASSERTION_PRODUCER_MISMATCH:' +
      assertion.assertionId + ':' + evidence.producerId,
    );
  }
  if (!entry.scenarioIds.includes(scenario.scenarioId)) {
    throw new Error(
      'PRODUCER_EVIDENCE_ASSERTION_SCENARIO_MISMATCH:' +
      assertion.assertionId + ':' + scenario.scenarioId,
    );
  }
  assertEvidenceStatus(assertion.status);
  assertMeaningful(assertion.description, 'PRODUCER_EVIDENCE_ASSERTION_DESCRIPTION_INVALID');
  assertJsonSafe(assertion.expected, 'PRODUCER_EVIDENCE_ASSERTION_EXPECTED_NOT_JSON_SAFE');
  assertJsonSafe(assertion.actual, 'PRODUCER_EVIDENCE_ASSERTION_ACTUAL_NOT_JSON_SAFE');
  assertJsonSafe(assertion.failureCode, 'PRODUCER_EVIDENCE_ASSERTION_FAILURE_CODE_NOT_JSON_SAFE');
  assertNoSensitiveData(assertion, 'PRODUCER_EVIDENCE_ASSERTION_SENSITIVE');
  if (assertion.status === 'PASSED' && assertion.failureCode !== null) {
    throw new Error('PRODUCER_EVIDENCE_ASSERTION_PASSED_WITH_FAILURE:' + assertion.assertionId);
  }
  if (assertion.status !== 'PASSED' && assertion.failureCode === null) {
    throw new Error('PRODUCER_EVIDENCE_ASSERTION_FAILURE_CODE_REQUIRED:' + assertion.assertionId);
  }
  if (assertion.evidenceItems.length === 0) {
    throw new Error('PRODUCER_EVIDENCE_ASSERTION_EVIDENCE_REQUIRED:' + assertion.assertionId);
  }
  const itemKeys = new Set<string>();
  for (const item of assertion.evidenceItems) {
    validateEvidenceItem(item);
    const key = item.artifactId + ':' + item.jsonPointer;
    if (itemKeys.has(key)) {
      throw new Error('PRODUCER_EVIDENCE_ITEM_DUPLICATE:' + assertion.assertionId);
    }
    itemKeys.add(key);
  }
  if (assertion.status === 'PASSED') {
    validateMatrixRequiredReferences(entry, evidence, scenario, assertion);
  }
}

function resolveMatrixAssertion(assertion: ProducerAssertionEvidence): AbgCoverageMatrixEntry {
  const entry = getAbgCoverageEntry(assertion.gateId);
  if (!entry.assertionIds.includes(assertion.assertionId)) {
    throw new Error('PRODUCER_EVIDENCE_ASSERTION_GATE_MISMATCH:' + assertion.assertionId);
  }
  return entry;
}

function validateEvidenceItem(item: ProducerEvidenceItem): void {
  assertMeaningful(item.artifactId, 'PRODUCER_EVIDENCE_ITEM_ARTIFACT_ID_INVALID');
  assertSafeRelativePath(item.relativePath, 'PRODUCER_EVIDENCE_ITEM_PATH_INVALID');
  assertMeaningful(item.mediaType, 'PRODUCER_EVIDENCE_ITEM_MEDIA_TYPE_INVALID');
  if (!Number.isSafeInteger(item.byteLength) || item.byteLength < 0) {
    throw new Error('PRODUCER_EVIDENCE_ITEM_BYTE_LENGTH_INVALID');
  }
  assertSha256(item.sha256, 'PRODUCER_EVIDENCE_ITEM_SHA256_INVALID');
  assertStrictJsonPointer(item.jsonPointer, 'PRODUCER_EVIDENCE_ITEM_POINTER_INVALID');
  assertSha256(item.claimDigest, 'PRODUCER_EVIDENCE_ITEM_CLAIM_DIGEST_INVALID');
}

function validateMatrixRequiredReferences(
  entry: AbgCoverageMatrixEntry,
  evidence: ProducerEvidence,
  scenario: ProducerScenarioEvidence,
  assertion: ProducerAssertionEvidence,
): void {
  const referenceValues: Readonly<Record<string, readonly string[]>> = {
    requestIds: scenario.requestIds,
    principalIds: scenario.principalIds,
    governanceObjectIds: scenario.governanceObjectIds,
    versionIds: scenario.versionIds,
    ruleVersions: scenario.ruleVersions,
    frozenInputDigests: Object.values(evidence.frozenInputRefs).filter(
      (value) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value),
    ),
    artifactDigests: scenario.artifactDigests,
  };
  for (const kind of entry.requiredReferenceKinds) {
    if (!ABG_REFERENCE_KINDS.includes(kind)) {
      throw new Error('PRODUCER_EVIDENCE_MATRIX_REFERENCE_KIND_UNKNOWN:' + kind);
    }
    const values = referenceValues[kind];
    if (!values || values.length === 0) {
      throw new Error('PRODUCER_EVIDENCE_REFERENCE_REQUIRED:' + assertion.assertionId + ':' + kind);
    }
    for (const value of values) {
      assertMeaningful(value, 'PRODUCER_EVIDENCE_REFERENCE_INVALID:' + assertion.assertionId);
      if (kind === 'frozenInputDigests' || kind === 'artifactDigests') {
        assertSha256(value, 'PRODUCER_EVIDENCE_REFERENCE_DIGEST_INVALID:' + assertion.assertionId);
      }
    }
  }
  for (const frozenInputKind of entry.requiredFrozenInputs) {
    if (!ABG_FROZEN_INPUT_KINDS.includes(frozenInputKind)) {
      throw new Error('PRODUCER_EVIDENCE_MATRIX_FROZEN_INPUT_UNKNOWN:' + frozenInputKind);
    }
    const value = evidence.frozenInputRefs[frozenInputKind];
    if (value === undefined) {
      throw new Error(
        'PRODUCER_EVIDENCE_FROZEN_INPUT_REQUIRED:' + assertion.assertionId + ':' + frozenInputKind,
      );
    }
    assertMeaningful(value, 'PRODUCER_EVIDENCE_FROZEN_INPUT_INVALID:' + frozenInputKind);
  }
}

function assertReferenceArray(
  values: readonly string[],
  kind: string,
  scenarioId: string,
  digest = false,
): void {
  if (new Set(values).size !== values.length) {
    throw new Error('PRODUCER_EVIDENCE_REFERENCE_DUPLICATE:' + scenarioId + ':' + kind);
  }
  for (const value of values) {
    assertMeaningful(value, 'PRODUCER_EVIDENCE_REFERENCE_INVALID:' + scenarioId + ':' + kind);
    assertNoSensitiveData(value, 'PRODUCER_EVIDENCE_REFERENCE_SENSITIVE:' + scenarioId + ':' + kind);
    if (digest) assertSha256(value, 'PRODUCER_EVIDENCE_REFERENCE_DIGEST_INVALID:' + scenarioId);
  }
}

function assertLocalDateTime(value: string, code: string): void {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(value)) throw new Error(code);
}

export function findMatrixAssertionsForProducer(producerId: string): readonly {
  readonly entry: AbgCoverageMatrixEntry;
  readonly assertionId: string;
  readonly scenarioId: string;
}[] {
  assertKnownProducerId(producerId);
  return ABG_COVERAGE_MATRIX.flatMap((entry) =>
    entry.evidenceSelectors
      .filter((selector) => selector.producerId === producerId)
      .map((selector) => ({
        entry,
        assertionId: selector.assertionId,
        scenarioId: selector.scenarioId,
      })),
  );
}
