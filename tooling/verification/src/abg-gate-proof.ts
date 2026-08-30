import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  ABG_REFERENCE_KINDS,
  getAbgCoverageEntry,
  type AbgCoverageMatrixEntry,
  type AbgFrozenInputKind,
  type AbgProducerId,
  type AbgReferenceKind,
} from './abg-coverage-matrix.js';
import { canonicalJson, sha256 } from './evidence/recorder.js';
import {
  PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
  PRODUCER_EVIDENCE_STATUSES,
  type JsonValue,
  type ProducerAssertionEvidence,
  type ProducerEvidence,
  type ProducerEvidenceIndex,
  type ProducerEvidenceIndexEntry,
  type ProducerEvidenceStatus,
  type ProducerScenarioEvidence,
} from './evidence/protocol.js';
import {
  assertMeaningful,
  assertSafeRelativePath,
  assertSha256,
  assertStrictJsonPointer,
  parseJsonPointer,
} from './evidence/schema.js';
import { validateProducerEvidence } from './evidence/validate-producer-evidence.js';
import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  GATE_RESULT_SCHEMA_VERSION,
} from './verification-contract-versions.js';

export const ABG_GATE_RESULT_SCHEMA_VERSION = GATE_RESULT_SCHEMA_VERSION;

export interface AbgGateEvidenceRef {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly producerId: AbgProducerId;
  readonly scenarioId: string;
  readonly assertionId: string;
  readonly jsonPointer: string;
  readonly selectedClaimDigest: string;
}

export interface AbgGateResult {
  readonly schemaVersion: typeof ABG_GATE_RESULT_SCHEMA_VERSION;
  readonly gateId: string;
  readonly runId: string;
  readonly runSequence: number;
  readonly status: 'PASSED';
  readonly scenarioIds: readonly string[];
  readonly assertionIds: readonly string[];
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
  readonly frozenInputDigests: readonly string[];
  readonly artifactDigests: readonly string[];
  readonly frozenInputs: Readonly<Partial<Record<AbgFrozenInputKind, string>>>;
  readonly evidenceRefs: readonly AbgGateEvidenceRef[];
  readonly coverageMatrixDigest: string;
  readonly producerEvidenceIndexPath: string;
  readonly producerEvidenceIndexDigest: string;
}

export interface ProduceAbgGateProofInput {
  readonly gateId: string;
  readonly runId: string;
  readonly runSequence: number;
  readonly evidenceRoot: string;
  readonly producerEvidenceIndexRelativePath: string;
}

export interface WriteAbgGateProofInput extends ProduceAbgGateProofInput {
  readonly resultRelativePath: string;
}

export interface ValidateAbgGateResultInput {
  readonly value: unknown;
  readonly evidenceRoot: string;
  readonly expectedGateId: string;
  readonly expectedRunId: string;
  readonly expectedRunSequence: number;
  readonly expectedCoverageMatrixDigest?: string;
}

export const ABG_PRODUCER_PROTOCOL_IDENTITY = CURRENT_EVIDENCE_CONTRACT_IDENTITY;

export function getAbgCoverageMatrixDigest(): string {
  return digestJson(ABG_COVERAGE_MATRIX);
}

export function getAbgProducerProtocolIdentityDigest(): string {
  return digestJson(ABG_PRODUCER_PROTOCOL_IDENTITY);
}

export async function produceAbgGateProof(
  input: ProduceAbgGateProofInput,
): Promise<AbgGateResult> {
  const entry = getAbgCoverageEntry(input.gateId);
  assertMeaningful(input.runId, 'ABG_GATE_RUN_ID_INVALID');
  assertPositiveInteger(input.runSequence, 'ABG_GATE_RUN_SEQUENCE_INVALID');
  const root = await assertSafeRoot(input.evidenceRoot);
  const loadedIndex = await readProducerEvidenceIndex(root, input.producerEvidenceIndexRelativePath);
  if (loadedIndex.index.runId !== input.runId) {
    throw new Error('ABG_GATE_PRODUCER_INDEX_RUN_ID_MISMATCH');
  }
  if (loadedIndex.index.runSequence !== input.runSequence) {
    throw new Error('ABG_GATE_PRODUCER_INDEX_RUN_SEQUENCE_MISMATCH');
  }

  const selected = await selectGateEvidence({
    entry,
    root,
    index: loadedIndex.index,
    indexBaseRelativePath: indexBaseRelativePath(input.producerEvidenceIndexRelativePath),
    runId: input.runId,
    runSequence: input.runSequence,
  });
  const references = collectReferences(entry, selected);
  assertRequiredReferences(entry, references);

  return {
    schemaVersion: ABG_GATE_RESULT_SCHEMA_VERSION,
    gateId: entry.gateId,
    runId: input.runId,
    runSequence: input.runSequence,
    status: 'PASSED',
    scenarioIds: entry.scenarioIds,
    assertionIds: entry.assertionIds,
    requestIds: references.requestIds,
    principalIds: references.principalIds,
    governanceObjectIds: references.governanceObjectIds,
    versionIds: references.versionIds,
    ruleVersions: references.ruleVersions,
    frozenInputDigests: references.frozenInputDigests,
    artifactDigests: references.artifactDigests,
    frozenInputs: references.frozenInputs,
    evidenceRefs: selected.map((item) => item.evidenceRef),
    coverageMatrixDigest: getAbgCoverageMatrixDigest(),
    producerEvidenceIndexPath: input.producerEvidenceIndexRelativePath,
    producerEvidenceIndexDigest: loadedIndex.digest,
  };
}

export async function writeAbgGateProof(
  input: WriteAbgGateProofInput,
): Promise<AbgGateResult> {
  const result = await produceAbgGateProof(input);
  const root = await assertSafeRoot(input.evidenceRoot);
  await writeJsonExclusive(root, input.resultRelativePath, result);
  return result;
}

export async function validateAbgGateResult(
  input: ValidateAbgGateResultInput,
): Promise<AbgGateResult> {
  const result = parseGateResult(input.value);
  if (result.gateId !== input.expectedGateId) throw new Error('ABG_GATE_RESULT_ID_MISMATCH');
  if (result.runId !== input.expectedRunId) throw new Error('ABG_GATE_RESULT_RUN_ID_MISMATCH');
  if (result.runSequence !== input.expectedRunSequence) {
    throw new Error('ABG_GATE_RESULT_RUN_SEQUENCE_MISMATCH');
  }
  if (result.status !== 'PASSED') throw new Error('ABG_GATE_RESULT_STATUS_NOT_PASSED');
  const expectedMatrixDigest = input.expectedCoverageMatrixDigest ?? getAbgCoverageMatrixDigest();
  if (result.coverageMatrixDigest !== expectedMatrixDigest) {
    throw new Error('ABG_GATE_RESULT_COVERAGE_MATRIX_DIGEST_MISMATCH');
  }

  const entry = getAbgCoverageEntry(result.gateId);
  assertExactStringArray(result.scenarioIds, entry.scenarioIds, 'ABG_GATE_RESULT_SCENARIOS_MISMATCH');
  assertExactStringArray(result.assertionIds, entry.assertionIds, 'ABG_GATE_RESULT_ASSERTIONS_MISMATCH');
  const root = await assertSafeRoot(input.evidenceRoot);
  const loadedIndex = await readProducerEvidenceIndex(root, result.producerEvidenceIndexPath);
  if (loadedIndex.digest !== result.producerEvidenceIndexDigest) {
    throw new Error('ABG_GATE_RESULT_PRODUCER_INDEX_DIGEST_MISMATCH');
  }
  if (loadedIndex.index.runId !== result.runId || loadedIndex.index.runSequence !== result.runSequence) {
    throw new Error('ABG_GATE_RESULT_PRODUCER_INDEX_RUN_MISMATCH');
  }

  const selected = await selectGateEvidence({
    entry,
    root,
    index: loadedIndex.index,
    indexBaseRelativePath: indexBaseRelativePath(result.producerEvidenceIndexPath),
    runId: result.runId,
    runSequence: result.runSequence,
    suppliedEvidenceRefs: result.evidenceRefs,
  });
  const references = collectReferences(entry, selected);
  assertRequiredReferences(entry, references);
  assertExactStringArray(result.requestIds, references.requestIds, 'ABG_GATE_RESULT_REQUEST_IDS_MISMATCH');
  assertExactStringArray(result.principalIds, references.principalIds, 'ABG_GATE_RESULT_PRINCIPAL_IDS_MISMATCH');
  assertExactStringArray(
    result.governanceObjectIds,
    references.governanceObjectIds,
    'ABG_GATE_RESULT_GOVERNANCE_OBJECT_IDS_MISMATCH',
  );
  assertExactStringArray(result.versionIds, references.versionIds, 'ABG_GATE_RESULT_VERSION_IDS_MISMATCH');
  assertExactStringArray(result.ruleVersions, references.ruleVersions, 'ABG_GATE_RESULT_RULE_VERSIONS_MISMATCH');
  assertExactStringArray(
    result.frozenInputDigests,
    references.frozenInputDigests,
    'ABG_GATE_RESULT_FROZEN_INPUT_DIGESTS_MISMATCH',
  );
  assertExactStringArray(
    result.artifactDigests,
    references.artifactDigests,
    'ABG_GATE_RESULT_ARTIFACT_DIGESTS_MISMATCH',
  );
  assertExactFrozenInputs(result.frozenInputs, references.frozenInputs);
  return result;
}

export function assertDistinctGateEvidenceSelectorSets(
  results: readonly Pick<AbgGateResult, 'gateId' | 'evidenceRefs'>[],
): void {
  const signatures = new Map<string, string>();
  for (const result of results) {
    const signature = result.evidenceRefs
      .map((reference) => selectorKey(reference))
      .sort((left, right) => left.localeCompare(right))
      .join('|');
    if (signature.length === 0) throw new Error('ABG_GATE_RESULT_EVIDENCE_REQUIRED:' + result.gateId);
    const existingGateId = signatures.get(signature);
    if (existingGateId !== undefined) {
      throw new Error(
        'ABG_GATE_RESULT_EVIDENCE_SELECTOR_SET_SHARED:' + existingGateId + ':' + result.gateId,
      );
    }
    signatures.set(signature, result.gateId);
  }
}

export async function readProducerEvidenceIndex(
  evidenceRoot: string,
  indexRelativePath: string,
): Promise<{ readonly index: ProducerEvidenceIndex; readonly digest: string }> {
  assertSafeRelativePath(indexRelativePath, 'ABG_GATE_PRODUCER_INDEX_PATH_INVALID');
  const root = await assertSafeRoot(evidenceRoot);
  const bytes = await readSafeFile(root, indexRelativePath);
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('ABG_GATE_PRODUCER_INDEX_JSON_INVALID');
  }
  return { index: parseProducerEvidenceIndex(value), digest: sha256(bytes) };
}

interface SelectedEvidence {
  readonly evidenceRef: AbgGateEvidenceRef;
  readonly evidence: ProducerEvidence;
  readonly scenario: ProducerScenarioEvidence;
  readonly assertion: ProducerAssertionEvidence;
}

interface SelectGateEvidenceInput {
  readonly entry: AbgCoverageMatrixEntry;
  readonly root: string;
  readonly index: ProducerEvidenceIndex;
  readonly indexBaseRelativePath: string;
  readonly runId: string;
  readonly runSequence: number;
  readonly suppliedEvidenceRefs?: readonly AbgGateEvidenceRef[];
}

async function selectGateEvidence(input: SelectGateEvidenceInput): Promise<readonly SelectedEvidence[]> {
  assertIndexProducerUniqueness(input.index);
  const evidenceByProducer = new Map<AbgProducerId, Promise<LoadedProducerEvidence>>();
  const supplied = input.suppliedEvidenceRefs === undefined
    ? undefined
    : indexEvidenceReferences(input.suppliedEvidenceRefs);
  if (supplied !== undefined && supplied.size !== input.entry.evidenceSelectors.length) {
    throw new Error('ABG_GATE_RESULT_EVIDENCE_SELECTOR_COUNT_MISMATCH');
  }

  const selected: SelectedEvidence[] = [];
  for (const selector of input.entry.evidenceSelectors) {
    const key = selectorKey(selector);
    const suppliedReference = supplied?.get(key);
    if (input.suppliedEvidenceRefs !== undefined && suppliedReference === undefined) {
      throw new Error('ABG_GATE_RESULT_EVIDENCE_SELECTOR_MISSING:' + input.entry.gateId);
    }
    const loadedPromise = evidenceByProducer.get(selector.producerId) ?? loadProducerEvidence({
      root: input.root,
      index: input.index,
      indexBaseRelativePath: input.indexBaseRelativePath,
      producerId: selector.producerId,
      runId: input.runId,
      runSequence: input.runSequence,
    });
    evidenceByProducer.set(selector.producerId, loadedPromise);
    const loaded = await loadedPromise;
    const scenario = loaded.evidence.scenarios[selector.scenarioId];
    if (scenario === undefined || scenario.producerId !== selector.producerId) {
      throw new Error('ABG_GATE_SCENARIO_MISSING:' + input.entry.gateId + ':' + selector.scenarioId);
    }
    const assertion = scenario.assertions[selector.assertionId];
    if (assertion === undefined) {
      throw new Error('ABG_GATE_ASSERTION_MISSING:' + input.entry.gateId + ':' + selector.assertionId);
    }
    if (assertion.gateId !== input.entry.gateId) {
      throw new Error('ABG_GATE_ASSERTION_CROSS_GATE:' + selector.assertionId);
    }
    if (assertion.assertionId !== selector.assertionId || assertion.status !== selector.expectedStatus) {
      throw new Error('ABG_GATE_ASSERTION_STATUS_INVALID:' + selector.assertionId);
    }
    assertStrictJsonPointer(selector.jsonPointer, 'ABG_GATE_SELECTOR_POINTER_INVALID');
    const resolvedValue = resolveJsonPointer(loaded.evidence, selector.jsonPointer);
    if (resolvedValue !== selector.expectedStatus) {
      throw new Error('ABG_GATE_SELECTOR_POINTER_STATUS_INVALID:' + selector.assertionId);
    }
    const evidenceRef: AbgGateEvidenceRef = {
      artifactId: selector.artifactId,
      relativePath: loaded.relativePath,
      mediaType: mediaTypeFor(loaded.relativePath),
      byteLength: loaded.bytes.byteLength,
      sha256: loaded.digest,
      producerId: selector.producerId,
      scenarioId: selector.scenarioId,
      assertionId: selector.assertionId,
      jsonPointer: selector.jsonPointer,
      selectedClaimDigest: selectedClaimDigest(loaded.evidence, scenario, assertion),
    };
    if (suppliedReference !== undefined) {
      assertEvidenceReferenceExact(suppliedReference, evidenceRef);
    }
    selected.push({ evidenceRef, evidence: loaded.evidence, scenario, assertion });
  }
  return selected;
}

interface LoadedProducerEvidence {
  readonly evidence: ProducerEvidence;
  readonly relativePath: string;
  readonly bytes: Buffer;
  readonly digest: string;
}

async function loadProducerEvidence(input: {
  readonly root: string;
  readonly index: ProducerEvidenceIndex;
  readonly indexBaseRelativePath: string;
  readonly producerId: AbgProducerId;
  readonly runId: string;
  readonly runSequence: number;
}): Promise<LoadedProducerEvidence> {
  const entry = input.index.producers.find((candidate) => candidate.producerId === input.producerId);
  if (entry === undefined) throw new Error('ABG_GATE_PRODUCER_INDEX_ENTRY_MISSING:' + input.producerId);
  const relativePath = joinRelativePath(input.indexBaseRelativePath, entry.relativePath);
  const bytes = await readSafeFile(input.root, relativePath);
  const digest = sha256(bytes);
  if (digest !== entry.sha256) {
    throw new Error('ABG_GATE_PRODUCER_EVIDENCE_DIGEST_MISMATCH:' + input.producerId);
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('ABG_GATE_PRODUCER_EVIDENCE_JSON_INVALID:' + input.producerId);
  }
  const evidence = value as ProducerEvidence;
  validateProducerEvidence(evidence);
  if (evidence.producerId !== input.producerId || entry.producerId !== input.producerId) {
    throw new Error('ABG_GATE_PRODUCER_ID_MISMATCH:' + input.producerId);
  }
  if (evidence.runId !== input.runId || evidence.runSequence !== input.runSequence) {
    throw new Error('ABG_GATE_PRODUCER_EVIDENCE_RUN_MISMATCH:' + input.producerId);
  }
  return { evidence, relativePath, bytes, digest };
}

interface CollectedReferences {
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
  readonly frozenInputDigests: readonly string[];
  readonly artifactDigests: readonly string[];
  readonly frozenInputs: Readonly<Partial<Record<AbgFrozenInputKind, string>>>;
}

function collectReferences(
  entry: AbgCoverageMatrixEntry,
  selected: readonly SelectedEvidence[],
): CollectedReferences {
  const requestIds: string[] = [];
  const principalIds: string[] = [];
  const governanceObjectIds: string[] = [];
  const versionIds: string[] = [];
  const ruleVersions: string[] = [];
  const artifactDigests: string[] = [];
  const frozenInputs: Partial<Record<AbgFrozenInputKind, string>> = {};
  for (const item of selected) {
    appendUnique(requestIds, item.scenario.requestIds);
    appendUnique(principalIds, item.scenario.principalIds);
    appendUnique(governanceObjectIds, item.scenario.governanceObjectIds);
    appendUnique(versionIds, item.scenario.versionIds);
    appendUnique(ruleVersions, item.scenario.ruleVersions);
    appendUnique(artifactDigests, item.scenario.artifactDigests);
    for (const kind of entry.requiredFrozenInputs) {
      const value = item.evidence.frozenInputRefs[kind];
      if (value === undefined) continue;
      const existing = frozenInputs[kind];
      if (existing !== undefined && existing !== value) {
        throw new Error('ABG_GATE_FROZEN_INPUT_CONFLICT:' + kind);
      }
      frozenInputs[kind] = value;
    }
  }
  const completeFrozenInputs: Partial<Record<AbgFrozenInputKind, string>> = {};
  for (const kind of entry.requiredFrozenInputs) {
    const value = frozenInputs[kind];
    if (value === undefined) throw new Error('ABG_GATE_FROZEN_INPUT_MISSING:' + kind);
    completeFrozenInputs[kind] = value;
  }
  const frozenInputDigests = [...new Set(Object.values(completeFrozenInputs).filter(isSha256))];
  return {
    requestIds,
    principalIds,
    governanceObjectIds,
    versionIds,
    ruleVersions,
    frozenInputDigests,
    artifactDigests,
    frozenInputs: completeFrozenInputs,
  };
}

function assertRequiredReferences(entry: AbgCoverageMatrixEntry, references: CollectedReferences): void {
  const values: Readonly<Record<AbgReferenceKind, readonly string[]>> = {
    requestIds: references.requestIds,
    principalIds: references.principalIds,
    governanceObjectIds: references.governanceObjectIds,
    versionIds: references.versionIds,
    ruleVersions: references.ruleVersions,
    frozenInputDigests: references.frozenInputDigests,
    artifactDigests: references.artifactDigests,
  };
  for (const kind of entry.requiredReferenceKinds) {
    const current = values[kind];
    if (current.length === 0) {
      throw new Error('ABG_GATE_REFERENCE_MISSING:' + entry.gateId + ':' + kind);
    }
    for (const value of current) {
      assertMeaningful(value, 'ABG_GATE_REFERENCE_INVALID:' + entry.gateId + ':' + kind);
      if (kind === 'frozenInputDigests' || kind === 'artifactDigests') {
        assertSha256(value, 'ABG_GATE_REFERENCE_DIGEST_INVALID:' + entry.gateId + ':' + kind);
      }
    }
  }
  for (const kind of entry.requiredFrozenInputs) {
    const value = references.frozenInputs[kind];
    if (value === undefined) throw new Error('ABG_GATE_FROZEN_INPUT_MISSING:' + kind);
    assertMeaningful(value, 'ABG_GATE_FROZEN_INPUT_INVALID:' + kind);
  }
}

function parseGateResult(value: unknown): AbgGateResult {
  const record = asRecord(value, 'ABG_GATE_RESULT_RECORD_INVALID');
  const schemaVersion = requireString(record, 'schemaVersion', 'ABG_GATE_RESULT_SCHEMA_VERSION_INVALID');
  if (schemaVersion !== ABG_GATE_RESULT_SCHEMA_VERSION) {
    throw new Error('ABG_GATE_RESULT_SCHEMA_VERSION_INVALID');
  }
  const gateId = requireString(record, 'gateId', 'ABG_GATE_RESULT_GATE_ID_INVALID');
  getAbgCoverageEntry(gateId);
  const runId = requireString(record, 'runId', 'ABG_GATE_RESULT_RUN_ID_INVALID');
  const runSequence = requirePositiveInteger(record, 'runSequence', 'ABG_GATE_RESULT_RUN_SEQUENCE_INVALID');
  const status = requireString(record, 'status', 'ABG_GATE_RESULT_STATUS_INVALID');
  if (status !== 'PASSED') throw new Error('ABG_GATE_RESULT_STATUS_NOT_PASSED');
  const frozenInputsRecord = asRecord(record['frozenInputs'], 'ABG_GATE_RESULT_FROZEN_INPUTS_INVALID');
  const frozenInputs: Partial<Record<AbgFrozenInputKind, string>> = {};
  for (const [kind, candidate] of Object.entries(frozenInputsRecord)) {
    if (!ABG_FROZEN_INPUT_KINDS.includes(kind as AbgFrozenInputKind)) {
      throw new Error('ABG_GATE_RESULT_FROZEN_INPUT_KIND_UNKNOWN:' + kind);
    }
    if (typeof candidate !== 'string') throw new Error('ABG_GATE_RESULT_FROZEN_INPUT_INVALID:' + kind);
    assertMeaningful(candidate, 'ABG_GATE_RESULT_FROZEN_INPUT_INVALID:' + kind);
    frozenInputs[kind as AbgFrozenInputKind] = candidate;
  }
  return {
    schemaVersion: ABG_GATE_RESULT_SCHEMA_VERSION,
    gateId,
    runId,
    runSequence,
    status: 'PASSED',
    scenarioIds: parseStringArray(record, 'scenarioIds', 'ABG_GATE_RESULT_SCENARIOS_INVALID'),
    assertionIds: parseStringArray(record, 'assertionIds', 'ABG_GATE_RESULT_ASSERTIONS_INVALID'),
    requestIds: parseStringArray(record, 'requestIds', 'ABG_GATE_RESULT_REQUEST_IDS_INVALID'),
    principalIds: parseStringArray(record, 'principalIds', 'ABG_GATE_RESULT_PRINCIPAL_IDS_INVALID'),
    governanceObjectIds: parseStringArray(
      record,
      'governanceObjectIds',
      'ABG_GATE_RESULT_GOVERNANCE_OBJECT_IDS_INVALID',
    ),
    versionIds: parseStringArray(record, 'versionIds', 'ABG_GATE_RESULT_VERSION_IDS_INVALID'),
    ruleVersions: parseStringArray(record, 'ruleVersions', 'ABG_GATE_RESULT_RULE_VERSIONS_INVALID'),
    frozenInputDigests: parseDigestArray(
      record,
      'frozenInputDigests',
      'ABG_GATE_RESULT_FROZEN_INPUT_DIGESTS_INVALID',
    ),
    artifactDigests: parseDigestArray(record, 'artifactDigests', 'ABG_GATE_RESULT_ARTIFACT_DIGESTS_INVALID'),
    frozenInputs,
    evidenceRefs: parseEvidenceReferences(record['evidenceRefs']),
    coverageMatrixDigest: requireDigest(record, 'coverageMatrixDigest', 'ABG_GATE_RESULT_COVERAGE_MATRIX_DIGEST_INVALID'),
    producerEvidenceIndexPath: requireSafePath(
      record,
      'producerEvidenceIndexPath',
      'ABG_GATE_RESULT_PRODUCER_INDEX_PATH_INVALID',
    ),
    producerEvidenceIndexDigest: requireDigest(
      record,
      'producerEvidenceIndexDigest',
      'ABG_GATE_RESULT_PRODUCER_INDEX_DIGEST_INVALID',
    ),
  };
}

function parseEvidenceReferences(value: unknown): readonly AbgGateEvidenceRef[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('ABG_GATE_RESULT_EVIDENCE_REQUIRED');
  const keys = new Set<string>();
  return value.map((candidate) => {
    const record = asRecord(candidate, 'ABG_GATE_RESULT_EVIDENCE_INVALID');
    const producerId = parseProducerId(record['producerId'], 'ABG_GATE_RESULT_EVIDENCE_PRODUCER_INVALID');
    const reference: AbgGateEvidenceRef = {
      artifactId: requireString(record, 'artifactId', 'ABG_GATE_RESULT_EVIDENCE_ARTIFACT_ID_INVALID'),
      relativePath: requireSafePath(record, 'relativePath', 'ABG_GATE_RESULT_EVIDENCE_PATH_INVALID'),
      mediaType: requireString(record, 'mediaType', 'ABG_GATE_RESULT_EVIDENCE_MEDIA_TYPE_INVALID'),
      byteLength: requireNonNegativeInteger(record, 'byteLength', 'ABG_GATE_RESULT_EVIDENCE_BYTE_LENGTH_INVALID'),
      sha256: requireDigest(record, 'sha256', 'ABG_GATE_RESULT_EVIDENCE_SHA256_INVALID'),
      producerId,
      scenarioId: requireString(record, 'scenarioId', 'ABG_GATE_RESULT_EVIDENCE_SCENARIO_INVALID'),
      assertionId: requireString(record, 'assertionId', 'ABG_GATE_RESULT_EVIDENCE_ASSERTION_INVALID'),
      jsonPointer: requireNonEmptyString(
        record,
        'jsonPointer',
        'ABG_GATE_RESULT_EVIDENCE_POINTER_INVALID',
      ),
      selectedClaimDigest: requireDigest(
        record,
        'selectedClaimDigest',
        'ABG_GATE_RESULT_EVIDENCE_CLAIM_DIGEST_INVALID',
      ),
    };
    assertStrictJsonPointer(reference.jsonPointer, 'ABG_GATE_RESULT_EVIDENCE_POINTER_INVALID');
    const key = selectorKey(reference);
    if (keys.has(key)) throw new Error('ABG_GATE_RESULT_EVIDENCE_DUPLICATE');
    keys.add(key);
    return reference;
  });
}

function parseProducerEvidenceIndex(value: unknown): ProducerEvidenceIndex {
  const record = asRecord(value, 'ABG_GATE_PRODUCER_INDEX_RECORD_INVALID');
  if (record['schemaVersion'] !== PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION) {
    throw new Error('ABG_GATE_PRODUCER_INDEX_SCHEMA_VERSION_INVALID');
  }
  const runId = requireString(record, 'runId', 'ABG_GATE_PRODUCER_INDEX_RUN_ID_INVALID');
  const runSequence = requirePositiveInteger(
    record,
    'runSequence',
    'ABG_GATE_PRODUCER_INDEX_RUN_SEQUENCE_INVALID',
  );
  if (!Array.isArray(record['producers']) || record['producers'].length === 0) {
    throw new Error('ABG_GATE_PRODUCER_INDEX_PRODUCERS_REQUIRED');
  }
  const producerIds = new Set<AbgProducerId>();
  const producers = record['producers'].map((candidate): ProducerEvidenceIndexEntry => {
    const entry = asRecord(candidate, 'ABG_GATE_PRODUCER_INDEX_ENTRY_INVALID');
    const producerId = parseProducerId(entry['producerId'], 'ABG_GATE_PRODUCER_INDEX_PRODUCER_INVALID');
    if (producerIds.has(producerId)) {
      throw new Error('ABG_GATE_PRODUCER_INDEX_PRODUCER_DUPLICATE:' + producerId);
    }
    producerIds.add(producerId);
    const status = requireString(entry, 'status', 'ABG_GATE_PRODUCER_INDEX_STATUS_INVALID');
    if (!PRODUCER_EVIDENCE_STATUSES.includes(status as ProducerEvidenceStatus)) {
      throw new Error('ABG_GATE_PRODUCER_INDEX_STATUS_INVALID');
    }
    return {
      producerId,
      relativePath: requireSafePath(entry, 'relativePath', 'ABG_GATE_PRODUCER_INDEX_ENTRY_PATH_INVALID'),
      sha256: requireDigest(entry, 'sha256', 'ABG_GATE_PRODUCER_INDEX_ENTRY_DIGEST_INVALID'),
      status: status as ProducerEvidenceStatus,
      scenarioCount: requireNonNegativeInteger(
        entry,
        'scenarioCount',
        'ABG_GATE_PRODUCER_INDEX_SCENARIO_COUNT_INVALID',
      ),
      assertionCount: requireNonNegativeInteger(
        entry,
        'assertionCount',
        'ABG_GATE_PRODUCER_INDEX_ASSERTION_COUNT_INVALID',
      ),
    };
  });
  return {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId,
    runSequence,
    producers,
  };
}

function assertIndexProducerUniqueness(index: ProducerEvidenceIndex): void {
  const producerIds = new Set<string>();
  for (const entry of index.producers) {
    if (producerIds.has(entry.producerId)) {
      throw new Error('ABG_GATE_PRODUCER_INDEX_PRODUCER_DUPLICATE:' + entry.producerId);
    }
    producerIds.add(entry.producerId);
  }
}

function indexEvidenceReferences(
  references: readonly AbgGateEvidenceRef[],
): ReadonlyMap<string, AbgGateEvidenceRef> {
  const values = new Map<string, AbgGateEvidenceRef>();
  for (const reference of references) {
    const key = selectorKey(reference);
    if (values.has(key)) throw new Error('ABG_GATE_RESULT_EVIDENCE_DUPLICATE');
    values.set(key, reference);
  }
  return values;
}

function assertEvidenceReferenceExact(
  actual: AbgGateEvidenceRef,
  expected: AbgGateEvidenceRef,
): void {
  if (
    actual.relativePath !== expected.relativePath ||
    actual.artifactId !== expected.artifactId ||
    actual.mediaType !== expected.mediaType ||
    actual.byteLength !== expected.byteLength ||
    actual.sha256 !== expected.sha256 ||
    actual.selectedClaimDigest !== expected.selectedClaimDigest
  ) {
    throw new Error('ABG_GATE_RESULT_EVIDENCE_REFERENCE_MISMATCH:' + actual.assertionId);
  }
}

function selectorKey(
  selector: Pick<
    AbgGateEvidenceRef,
    'artifactId' | 'producerId' | 'scenarioId' | 'assertionId' | 'jsonPointer'
  >,
): string {
  return [
    selector.artifactId,
    selector.producerId,
    selector.scenarioId,
    selector.assertionId,
    selector.jsonPointer,
  ].join('\u0000');
}

function resolveJsonPointer(value: unknown, pointer: string): unknown {
  let current: unknown = value;
  for (const segment of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) {
        throw new Error('ABG_GATE_SELECTOR_POINTER_PATH_MISSING:' + pointer);
      }
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) {
        throw new Error('ABG_GATE_SELECTOR_POINTER_PATH_MISSING:' + pointer);
      }
      current = current[index];
      continue;
    }
    if (typeof current !== 'object' || current === null || !Object.hasOwn(current, segment)) {
      throw new Error('ABG_GATE_SELECTOR_POINTER_PATH_MISSING:' + pointer);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function selectedClaimDigest(
  evidence: ProducerEvidence,
  scenario: ProducerScenarioEvidence,
  assertion: ProducerAssertionEvidence,
): string {
  return digestJson({
    producerId: evidence.producerId,
    gateId: assertion.gateId,
    scenarioId: scenario.scenarioId,
    assertionId: assertion.assertionId,
    status: assertion.status,
    requestIds: scenario.requestIds,
    principalIds: scenario.principalIds,
    governanceObjectIds: scenario.governanceObjectIds,
    versionIds: scenario.versionIds,
    ruleVersions: scenario.ruleVersions,
    artifactDigests: scenario.artifactDigests,
    frozenInputRefs: evidence.frozenInputRefs,
    evidenceItems: assertion.evidenceItems,
  });
}

function assertExactStringArray(
  actual: readonly string[],
  expected: readonly string[],
  code: string,
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index]) ||
    new Set(actual).size !== actual.length
  ) {
    throw new Error(code);
  }
}

function assertExactFrozenInputs(
  actual: Readonly<Partial<Record<AbgFrozenInputKind, string>>>,
  expected: Readonly<Partial<Record<AbgFrozenInputKind, string>>>,
): void {
  const actualKeys = Object.keys(actual).sort((left, right) => left.localeCompare(right));
  const expectedKeys = Object.keys(expected).sort((left, right) => left.localeCompare(right));
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    actualKeys.some((key) => actual[key as AbgFrozenInputKind] !== expected[key as AbgFrozenInputKind])
  ) {
    throw new Error('ABG_GATE_RESULT_FROZEN_INPUTS_MISMATCH');
  }
}

function appendUnique(target: string[], values: readonly string[]): void {
  for (const value of values) {
    if (!target.includes(value)) target.push(value);
  }
}

function digestJson(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value as JsonValue), 'utf8'));
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function mediaTypeFor(relativePath: string): string {
  if (extname(relativePath).toLowerCase() !== '.json') {
    throw new Error('ABG_GATE_EVIDENCE_MEDIA_TYPE_UNSUPPORTED:' + relativePath);
  }
  return 'application/json';
}

function indexBaseRelativePath(indexRelativePath: string): string {
  const index = indexRelativePath.lastIndexOf('/');
  return index === -1 ? '' : indexRelativePath.slice(0, index);
}

function joinRelativePath(base: string, child: string): string {
  const result = base.length === 0 ? child : base + '/' + child;
  assertSafeRelativePath(result, 'ABG_GATE_EVIDENCE_PATH_INVALID');
  return result;
}

async function assertSafeRoot(rootDirectory: string): Promise<string> {
  const root = resolve(rootDirectory);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('ABG_GATE_EVIDENCE_ROOT_UNSAFE:' + root);
  }
  return realpath(root);
}

async function readSafeFile(rootDirectory: string, relativePath: string): Promise<Buffer> {
  assertSafeRelativePath(relativePath, 'ABG_GATE_EVIDENCE_PATH_INVALID');
  const path = resolveInside(rootDirectory, relativePath);
  let current = rootDirectory;
  const parts = relativePath.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('ABG_GATE_EVIDENCE_SYMLINK_ESCAPE:' + relativePath);
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error('ABG_GATE_EVIDENCE_PARENT_UNSAFE:' + relativePath);
    }
    if (index === parts.length - 1 && !stat.isFile()) {
      throw new Error('ABG_GATE_EVIDENCE_NOT_FILE:' + relativePath);
    }
  }
  if (current !== path) throw new Error('ABG_GATE_EVIDENCE_PATH_ESCAPES_ROOT:' + relativePath);
  return readFile(path);
}

async function writeJsonExclusive(
  rootDirectory: string,
  relativePath: string,
  value: unknown,
): Promise<void> {
  assertSafeRelativePath(relativePath, 'ABG_GATE_RESULT_PATH_INVALID');
  const output = resolveInside(rootDirectory, relativePath);
  await ensureSafeParentDirectories(rootDirectory, relativePath);
  try {
    await writeFile(output, JSON.stringify(value, null, 2) + '\n', {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (isAlreadyExists(error)) throw new Error('ABG_GATE_RESULT_ALREADY_EXISTS:' + relativePath);
    throw error;
  }
}

async function ensureSafeParentDirectories(rootDirectory: string, relativePath: string): Promise<void> {
  const parts = relativePath.split('/');
  parts.pop();
  let current = rootDirectory;
  for (const part of parts) {
    current = join(current, part);
    try {
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('ABG_GATE_RESULT_PARENT_UNSAFE:' + relativePath);
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
      await mkdir(current, { recursive: false, mode: 0o700 });
    }
  }
}

function resolveInside(rootDirectory: string, relativePath: string): string {
  const output = resolve(rootDirectory, relativePath);
  const relativeOutput = relative(rootDirectory, output);
  if (
    relativeOutput === '' ||
    relativeOutput === '..' ||
    relativeOutput.startsWith('..' + sep) ||
    isAbsolute(relativeOutput)
  ) {
    throw new Error('ABG_GATE_EVIDENCE_PATH_ESCAPES_ROOT:' + relativePath);
  }
  return output;
}

function asRecord(value: unknown, code: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(code);
  return value as Readonly<Record<string, unknown>>;
}

function requireString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') throw new Error(code);
  assertMeaningful(value, code);
  return value;
}

function requireNonEmptyString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(code);
  return value;
}

function requireSafePath(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): string {
  const value = requireString(record, key, code);
  assertSafeRelativePath(value, code);
  return value;
}

function requireDigest(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): string {
  const value = requireString(record, key, code);
  assertSha256(value, code);
  return value;
}

function requirePositiveInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(code);
  return value as number;
}

function requireNonNegativeInteger(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(code);
  return value as number;
}

function parseStringArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): readonly string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(code);
  const items = value as readonly string[];
  if (new Set(items).size !== items.length) throw new Error(code);
  for (const item of items) assertMeaningful(item, code);
  return items;
}

function parseDigestArray(
  record: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): readonly string[] {
  const items = parseStringArray(record, key, code);
  for (const item of items) assertSha256(item, code);
  return items;
}

function parseProducerId(value: unknown, code: string): AbgProducerId {
  if (typeof value !== 'string' || !ABG_PRODUCER_IDS.includes(value as AbgProducerId)) {
    throw new Error(code);
  }
  return value as AbgProducerId;
}

function assertPositiveInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
