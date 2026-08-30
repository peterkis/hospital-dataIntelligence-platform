import {
  ABG_GATES,
  type AbgGateDefinition,
} from './abg-catalog.js';

export const ABG_PRODUCER_IDS = [
  'static',
  'database',
  'integration',
  'live',
  'browser',
  'fault',
  'consumer',
  'capacity',
  'formal-run',
] as const;

export type AbgProducerId = (typeof ABG_PRODUCER_IDS)[number];

export const ABG_REFERENCE_KINDS = [
  'requestIds',
  'principalIds',
  'governanceObjectIds',
  'versionIds',
  'ruleVersions',
  'frozenInputDigests',
  'artifactDigests',
] as const;

export type AbgReferenceKind = (typeof ABG_REFERENCE_KINDS)[number];

export const ABG_FROZEN_INPUT_KINDS = [
  'gitCommitSha',
  'lockfileSha256',
  'openapiSha256',
  'migrationManifestSha256',
  'fixtureIdentity',
  'nodeVersion',
  'postgresImage',
  'keycloakImage',
  'browserVersion',
  'producerSourceManifestSha256',
] as const;

export type AbgFrozenInputKind = (typeof ABG_FROZEN_INPUT_KINDS)[number];
export type AbgEvidenceClass = AbgGateDefinition['evidenceClass'];
export type AbgEvidenceStatus = 'PASSED' | 'FAILED' | 'NOT_RUN';

export interface AbgFailurePolicy {
  readonly mode: 'FAIL_CLOSED';
  readonly requiredFailureConditions: readonly AbgFailureCondition[];
}

export const ABG_FAILURE_CONDITIONS = [
  'MISSING_SCENARIO',
  'MISSING_ASSERTION',
  'MISSING_EVIDENCE_SELECTOR',
  'MISSING_REFERENCE',
  'MISSING_FROZEN_INPUT',
  'MISSING_ARTIFACT_DIGEST',
  'UNEXPECTED_EVIDENCE_STATUS',
] as const;

export type AbgFailureCondition = (typeof ABG_FAILURE_CONDITIONS)[number];

export const REQUIRED_ABG_FAILURE_POLICY: AbgFailurePolicy = {
  mode: 'FAIL_CLOSED',
  requiredFailureConditions: ABG_FAILURE_CONDITIONS,
};

export interface AbgEvidenceSelector {
  readonly producerId: AbgProducerId;
  readonly artifactId: string;
  readonly scenarioId: string;
  readonly assertionId: string;
  readonly jsonPointer: string;
  readonly expectedStatus: 'PASSED';
  readonly required: boolean;
}

export interface AbgCoverageMatrixEntry {
  readonly gateId: string;
  readonly evidenceClass: AbgEvidenceClass;
  readonly scenarioIds: readonly string[];
  readonly assertionIds: readonly string[];
  readonly producerIds: readonly AbgProducerId[];
  readonly evidenceSelectors: readonly AbgEvidenceSelector[];
  readonly requiredReferenceKinds: readonly AbgReferenceKind[];
  readonly requiredFrozenInputs: readonly AbgFrozenInputKind[];
  readonly failurePolicy: AbgFailurePolicy;
}

interface CoverageDefinition {
  readonly gateId: string;
  readonly assertionSlugs: readonly string[];
  readonly scenarioIds: readonly string[];
  readonly scenarioByProducer: Readonly<Partial<Record<AbgProducerId, string>>>;
  readonly producerIds: readonly AbgProducerId[];
}

const FROZEN_INPUTS_BY_PRODUCER: Readonly<Record<AbgProducerId, readonly AbgFrozenInputKind[]>> = {
  static: ['gitCommitSha', 'lockfileSha256', 'nodeVersion'],
  database: ['gitCommitSha', 'lockfileSha256', 'migrationManifestSha256', 'postgresImage'],
  integration: [
    'gitCommitSha',
    'lockfileSha256',
    'openapiSha256',
    'migrationManifestSha256',
    'fixtureIdentity',
    'nodeVersion',
    'postgresImage',
  ],
  live: [
    'gitCommitSha',
    'lockfileSha256',
    'openapiSha256',
    'migrationManifestSha256',
    'fixtureIdentity',
    'nodeVersion',
    'postgresImage',
    'keycloakImage',
  ],
  browser: [
    'gitCommitSha',
    'lockfileSha256',
    'openapiSha256',
    'fixtureIdentity',
    'nodeVersion',
    'keycloakImage',
    'browserVersion',
  ],
  fault: [
    'gitCommitSha',
    'lockfileSha256',
    'migrationManifestSha256',
    'fixtureIdentity',
    'nodeVersion',
    'postgresImage',
  ],
  consumer: [
    'gitCommitSha',
    'lockfileSha256',
    'openapiSha256',
    'migrationManifestSha256',
    'fixtureIdentity',
    'nodeVersion',
    'postgresImage',
    'keycloakImage',
  ],
  capacity: [
    'gitCommitSha',
    'lockfileSha256',
    'migrationManifestSha256',
    'fixtureIdentity',
    'nodeVersion',
    'postgresImage',
  ],
  'formal-run': ABG_FROZEN_INPUT_KINDS,
};

const COVERAGE_DEFINITIONS: readonly CoverageDefinition[] = [
  defineCoverage(
    'ABG-01',
    'repository-runtime-lockfile-topology',
    ['STATIC-REPOSITORY-RUNTIME-LOCKFILE-TOPOLOGY'],
    ['static'],
  ),
  defineCoverage(
    'ABG-02',
    'empty-postgres-migration-schema-fingerprint-derived-types',
    ['INTEGRATION-EMPTY-POSTGRES-MIGRATION-CLOSURE'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-03',
    'asia-shanghai-no-timezone-contract',
    ['INTEGRATION-DATABASE-TIMEZONE-TYPE-SCAN', 'LIVE-ASIA-SHANGHAI-TIME-CONTRACT'],
    ['database', 'integration', 'live'],
    {
      database: 'INTEGRATION-DATABASE-TIMEZONE-TYPE-SCAN',
      integration: 'INTEGRATION-DATABASE-TIMEZONE-TYPE-SCAN',
      live: 'LIVE-ASIA-SHANGHAI-TIME-CONTRACT',
    },
  ),
  defineCoverage(
    'ABG-04',
    'keycloak-person-service-local-principal-binding',
    ['LIVE-KEYCLOAK-PERSON-AND-SERVICE-IDENTITY'],
    ['live'],
  ),
  defineCoverage(
    'ABG-05',
    'object-authorization-allow-deny-matrix',
    ['LIVE-OBJECT-AUTHORIZATION-ALLOW-DENY'],
    ['integration', 'live'],
  ),
  defineCoverage(
    'ABG-06',
    'campus-scope-and-hospital-authority-boundary',
    ['INTEGRATION-CAMPUS-SCOPE-AUTHORIZATION'],
    ['integration', 'live'],
  ),
  defineCoverage(
    'ABG-07',
    'charge-item-draft-crud-and-csrf-rejection',
    ['BROWSER-CHARGE-DRAFT-CRUD-AND-CSRF', 'INTEGRATION-VERTICAL-SLICE-PUBLICATION'],
    ['integration', 'browser'],
    {
      integration: 'INTEGRATION-VERTICAL-SLICE-PUBLICATION',
      browser: 'BROWSER-CHARGE-DRAFT-CRUD-AND-CSRF',
    },
  ),
  defineCoverage(
    'ABG-08',
    'charge-item-stable-identity-version-candidate-immutable-publication',
    ['INTEGRATION-CHARGE-CATALOG-VERSION-PUBLICATION'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-09',
    'charge-item-bitemporal-history-and-difference',
    ['INTEGRATION-CHARGE-CATALOG-BITEMPORAL-HISTORY'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-10',
    'price-list-draft-entry-change-complete-snapshot',
    ['BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION', 'INTEGRATION-VERTICAL-SLICE-PUBLICATION'],
    ['integration', 'browser'],
    {
      integration: 'INTEGRATION-VERTICAL-SLICE-PUBLICATION',
      browser: 'BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION',
    },
  ),
  defineCoverage(
    'ABG-11',
    'general-specific-exclusivity-campus-scope-exclusion',
    ['INTEGRATION-PRICE-EXCLUSIVITY-CONSTRAINTS'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-12',
    'two-level-price-resolution-fail-closed-evidence',
    ['INTEGRATION-PRICE-RESOLUTION-FAIL-CLOSED', 'LIVE-PRICE-RESOLUTION-PATH'],
    ['integration', 'live'],
    {
      integration: 'INTEGRATION-PRICE-RESOLUTION-FAIL-CLOSED',
      live: 'LIVE-PRICE-RESOLUTION-PATH',
    },
  ),
  defineCoverage(
    'ABG-13',
    'csv-json-charge-import-equivalence',
    ['INTEGRATION-IMPORT-CSV-JSON-EQUIVALENCE'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-14',
    'batch-duplicate-key-stable-row-identity',
    ['INTEGRATION-IMPORT-DUPLICATE-ROW-IDENTITIES'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-15',
    'row-partial-success-failure-evidence',
    ['INTEGRATION-IMPORT-PARTIAL-SUCCESS'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-16',
    'original-batch-idempotent-retry-success-row-skip',
    ['FAULT-IMPORT-IDEMPOTENT-RETRY'],
    ['fault', 'integration'],
  ),
  defineCoverage(
    'ABG-17',
    'new-batch-same-key-version-candidate',
    ['INTEGRATION-IMPORT-NEW-BATCH-VERSION-CANDIDATE'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-18',
    'price-entry-import-prepublication-conflict',
    ['INTEGRATION-PRICE-ENTRY-IMPORT-CONFLICT'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-19',
    'normal-content-frozen-template-stage-order',
    ['INTEGRATION-WORKFLOW-TEMPLATE-STAGE-ORDER'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-20',
    'duty-separation-content-drift-terminal-block',
    ['INTEGRATION-WORKFLOW-DUTY-SEPARATION-DRIFT'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-21',
    'high-risk-price-review-owner-final-approval',
    ['BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION', 'INTEGRATION-HIGH-RISK-PRICE-APPROVAL'],
    ['integration', 'browser'],
    {
      integration: 'INTEGRATION-HIGH-RISK-PRICE-APPROVAL',
      browser: 'BROWSER-PRICE-DRAFT-APPROVAL-AND-RESOLUTION',
    },
  ),
  defineCoverage(
    'ABG-22',
    'campus-price-preconfirmation-single-owner-authority',
    ['INTEGRATION-CAMPUS-DIFFERENCE-PRECONFIRMATION'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-23',
    'projection-schema-upgrade-self-approval-exception-scope',
    ['INTEGRATION-SCHEMA-UPGRADE-EXCEPTION-SCOPE'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-24',
    'consumer-incompatibility-isolation-subscription-upgrade-replay',
    ['LIVE-CONSUMER-INCOMPATIBILITY-REPLAY'],
    ['consumer', 'live'],
    {
      consumer: 'LIVE-CONSUMER-INCOMPATIBILITY-REPLAY',
      live: 'LIVE-CONSUMER-INCOMPATIBILITY-REPLAY',
    },
  ),
  defineCoverage(
    'ABG-25',
    'emergency-suspension-append-event-future-block',
    ['INTEGRATION-EMERGENCY-SUSPEND'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-26',
    'suspension-history-record-as-of-remains-reproducible',
    ['INTEGRATION-SUSPENSION-HISTORICAL-REPRODUCTION'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-27',
    'impact-issue-and-independent-post-emergency-review',
    ['INTEGRATION-IMPACT-REVIEW-CLOSURE'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-28',
    'compensating-publication-relationship-consumption-recovery',
    ['INTEGRATION-COMPENSATING-PUBLICATION-CONSUMPTION'],
    ['consumer', 'integration'],
  ),
  defineCoverage(
    'ABG-29',
    'audit-dimensional-filter-and-object-read-authorization',
    ['INTEGRATION-AUDIT-READ-AUTHORIZATION'],
    ['integration'],
  ),
  defineCoverage(
    'ABG-30',
    'audit-hash-chain-recompute-first-tamper-position',
    ['INTEGRATION-AUDIT-HASH-CHAIN-TAMPER'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-31',
    'same-local-time-stream-sequence-canonical-order',
    ['INTEGRATION-STREAM-SEQUENCE-SAME-TIMESTAMP'],
    ['database', 'integration'],
  ),
  defineCoverage(
    'ABG-32',
    [
      'publication-workflow-decision-rollback',
      'publication-release-envelope-rollback',
      'publication-snapshot-artifact-rollback',
      'publication-release-member-rollback',
      'publication-outbox-event-rollback',
      'publication-compatibility-precheck-rollback',
      'publication-delivery-registration-rollback',
      'publication-domain-candidate-confirmation-rollback',
      'publication-audit-event-rollback',
    ],
    ['FAULT-PUBLICATION-ATOMIC-WRITE-MATRIX'],
    ['fault', 'integration'],
  ),
  defineCoverage(
    'ABG-33',
    'outbox-lost-wakeup-database-polling-recovery',
    ['FAULT-OUTBOX-LOST-WAKEUP-POLLING'],
    ['fault', 'consumer'],
  ),
  defineCoverage(
    'ABG-34',
    'lease-reclaim-notification-crash-at-least-once-delivery',
    ['FAULT-OUTBOX-LEASE-CRASH-RECOVERY'],
    ['fault', 'consumer'],
  ),
  defineCoverage(
    'ABG-35',
    'two-consumer-isolation-next-version-gap-block',
    [
      'CONSUMER-ISOLATION-GAP-BLOCKING',
      'INTEGRATION-VERTICAL-SLICE-PUBLICATION',
      'LIVE-DUAL-CONSUMER-ISOLATION',
    ],
    ['consumer', 'integration', 'live'],
    {
      consumer: 'CONSUMER-ISOLATION-GAP-BLOCKING',
      integration: 'INTEGRATION-VERTICAL-SLICE-PUBLICATION',
      live: 'LIVE-DUAL-CONSUMER-ISOLATION',
    },
  ),
  defineCoverage(
    'ABG-36',
    'uncompressed-canonical-snapshot-dual-digest-stream-client',
    ['CONSUMER-CANONICAL-SNAPSHOT-DUAL-DIGEST', 'LIVE-CANONICAL-SNAPSHOT-RECEIPT-CHECKPOINT'],
    ['consumer', 'integration', 'live'],
    {
      consumer: 'CONSUMER-CANONICAL-SNAPSHOT-DUAL-DIGEST',
      integration: 'CONSUMER-CANONICAL-SNAPSHOT-DUAL-DIGEST',
      live: 'LIVE-CANONICAL-SNAPSHOT-RECEIPT-CHECKPOINT',
    },
  ),
  defineCoverage(
    'ABG-37',
    [
      'canonical-artifact-16mib-exact-accepted',
      'canonical-artifact-16mib-plus-one-rejected',
    ],
    ['INTEGRATION-SNAPSHOT-16MIB-BOUNDARY'],
    ['capacity', 'integration'],
  ),
  defineCoverage(
    'ABG-38',
    'typebox-openapi-generated-client-single-authority',
    ['STATIC-TYPEBOX-OPENAPI-GENERATED-CLIENT'],
    ['static'],
  ),
  defineCoverage(
    'ABG-39',
    'deep-module-table-ownership-forbidden-bypass',
    ['STATIC-DEEP-MODULE-TABLE-OWNERSHIP'],
    ['static'],
  ),
  defineCoverage(
    'ABG-40',
    [
      'formal-terminal-lifecycle-complete',
      'formal-evidence-seal-eligible',
    ],
    ['RUN-FORMAL-TERMINAL-LIFECYCLE'],
    ['formal-run'],
  ),
];

const definitionsByGateId = new Map(
  COVERAGE_DEFINITIONS.map((definition) => [definition.gateId, definition] as const),
);

export const ABG_COVERAGE_MATRIX: readonly AbgCoverageMatrixEntry[] = Object.freeze(
  ABG_GATES.map((gate) => {
    const definition = definitionsByGateId.get(gate.gateId);
    if (!definition) throw new Error('ABG_COVERAGE_DEFINITION_MISSING:' + gate.gateId);
    const assertionIds = definition.assertionSlugs.map(
      (assertionSlug) => gate.gateId + ':' + assertionSlug,
    );
    return {
      gateId: gate.gateId,
      evidenceClass: gate.evidenceClass,
      scenarioIds: definition.scenarioIds,
      assertionIds,
      producerIds: definition.producerIds,
      evidenceSelectors: definition.producerIds.flatMap((producerId) =>
        assertionIds.map((assertionId) =>
          createEvidenceSelector(
            producerId,
            definition.scenarioByProducer[producerId] ??
              definition.scenarioIds[0] as string,
            assertionId,
          ),
        ),
      ),
      requiredReferenceKinds: requiredReferenceKindsFor(definition.producerIds),
      requiredFrozenInputs: requiredFrozenInputsFor(definition.producerIds),
      failurePolicy: REQUIRED_ABG_FAILURE_POLICY,
    };
  }),
);

export interface AbgEvidenceSelectorResult {
  readonly producerId: AbgProducerId;
  readonly artifactId: string;
  readonly scenarioId: string;
  readonly assertionId: string;
  readonly jsonPointer: string;
  readonly status: AbgEvidenceStatus;
  readonly artifactDigest: string;
}

export interface AbgGateEvidenceEnvelope {
  readonly gateId: string;
  readonly scenarioResults: Readonly<Record<string, AbgEvidenceStatus>>;
  readonly assertionResults: Readonly<Record<string, AbgEvidenceStatus>>;
  readonly evidenceSelectors: readonly AbgEvidenceSelectorResult[];
  readonly references: Readonly<Partial<Record<AbgReferenceKind, readonly string[]>>>;
  readonly frozenInputs: Readonly<Partial<Record<AbgFrozenInputKind, string>>>;
}

export function getAbgCoverageEntry(gateId: string): AbgCoverageMatrixEntry {
  const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === gateId);
  if (!entry) throw new Error('ABG_COVERAGE_GATE_UNKNOWN:' + gateId);
  return entry;
}

export function validateAbgCoverageMatrix(
  matrix: readonly AbgCoverageMatrixEntry[] = ABG_COVERAGE_MATRIX,
  catalog: readonly AbgGateDefinition[] = ABG_GATES,
): void {
  if (matrix.length !== catalog.length) {
    fail('ABG_COVERAGE_GATE_COUNT_MISMATCH');
  }
  const catalogGateIds = catalog.map((gate) => gate.gateId);
  assertUnique(catalogGateIds, 'ABG_CATALOG_GATE_ID_DUPLICATE');
  assertUnique(matrix.map((entry) => entry.gateId), 'ABG_COVERAGE_GATE_ID_DUPLICATE');
  const assertions = new Map<string, string>();

  for (const [index, entry] of matrix.entries()) {
    const catalogGate = catalog[index];
    if (!catalogGate) fail('ABG_COVERAGE_GATE_INDEX_UNKNOWN:' + index);
    if (entry.gateId !== catalogGate.gateId) {
      fail('ABG_COVERAGE_GATE_ORDER_OR_ID_MISMATCH:' + entry.gateId);
    }
    if (entry.evidenceClass !== catalogGate.evidenceClass) {
      fail('ABG_COVERAGE_EVIDENCE_CLASS_MISMATCH:' + entry.gateId);
    }
    validateEntry(entry, assertions);
  }

  for (const gateId of catalogGateIds) {
    if (!matrix.some((entry) => entry.gateId === gateId)) {
      fail('ABG_COVERAGE_GATE_MISSING:' + gateId);
    }
  }
}

export function assertValidAbgGateEvidence(envelope: AbgGateEvidenceEnvelope): void {
  const entry = getAbgCoverageEntry(envelope.gateId);

  for (const scenarioId of entry.scenarioIds) {
    if (envelope.scenarioResults[scenarioId] !== 'PASSED') {
      fail('ABG_EVIDENCE_SCENARIO_REQUIRED:' + entry.gateId + ':' + scenarioId);
    }
  }
  for (const assertionId of entry.assertionIds) {
    if (envelope.assertionResults[assertionId] !== 'PASSED') {
      fail('ABG_EVIDENCE_ASSERTION_REQUIRED:' + entry.gateId + ':' + assertionId);
    }
  }
  for (const selector of entry.evidenceSelectors) {
    const result = envelope.evidenceSelectors.find((candidate) =>
      candidate.producerId === selector.producerId &&
      candidate.artifactId === selector.artifactId &&
      candidate.scenarioId === selector.scenarioId &&
      candidate.assertionId === selector.assertionId &&
      candidate.jsonPointer === selector.jsonPointer,
    );
    if (
      !result ||
      result.status !== selector.expectedStatus ||
      !isDigest(result.artifactDigest)
    ) {
      fail('ABG_EVIDENCE_SELECTOR_REQUIRED:' + entry.gateId + ':' + selector.artifactId);
    }
  }
  for (const referenceKind of entry.requiredReferenceKinds) {
    const values = envelope.references[referenceKind];
    if (!values || values.length === 0) {
      fail('ABG_EVIDENCE_REFERENCE_REQUIRED:' + entry.gateId + ':' + referenceKind);
    }
    for (const value of values) {
      assertMeaningful(value, 'ABG_EVIDENCE_REFERENCE_VALUE_INVALID:' + referenceKind);
      if (
        (referenceKind === 'frozenInputDigests' || referenceKind === 'artifactDigests') &&
        !isDigest(value)
      ) {
        fail('ABG_EVIDENCE_REFERENCE_DIGEST_INVALID:' + entry.gateId + ':' + referenceKind);
      }
    }
  }
  for (const frozenInput of entry.requiredFrozenInputs) {
    const value = envelope.frozenInputs[frozenInput];
    if (value === undefined) {
      fail('ABG_EVIDENCE_FROZEN_INPUT_REQUIRED:' + entry.gateId + ':' + frozenInput);
    }
    assertMeaningful(value, 'ABG_EVIDENCE_FROZEN_INPUT_INVALID:' + frozenInput);
  }
}

function defineCoverage(
  gateId: string,
  assertionSlug: string | readonly string[],
  scenarioIds: readonly string[],
  producerIds: readonly AbgProducerId[],
  scenarioByProducer: Readonly<Partial<Record<AbgProducerId, string>>> = {},
): CoverageDefinition {
  return {
    gateId,
    assertionSlugs: typeof assertionSlug === 'string' ? [assertionSlug] : assertionSlug,
    scenarioIds,
    scenarioByProducer,
    producerIds,
  };
}

function createEvidenceSelector(
  producerId: AbgProducerId,
  scenarioId: string,
  assertionId: string,
): AbgEvidenceSelector {
  return {
    producerId,
    artifactId: 'phase-01-' + producerId + '-evidence',
    scenarioId,
    assertionId,
    jsonPointer: '/scenarios/' + scenarioId + '/assertions/' + assertionId + '/status',
    expectedStatus: 'PASSED',
    required: true,
  };
}

function requiredFrozenInputsFor(
  producerIds: readonly AbgProducerId[],
): readonly AbgFrozenInputKind[] {
  return [...new Set(producerIds.flatMap((producerId) => FROZEN_INPUTS_BY_PRODUCER[producerId]))]
    .sort((left, right) => left.localeCompare(right));
}

function requiredReferenceKindsFor(
  producerIds: readonly AbgProducerId[],
): readonly AbgReferenceKind[] {
  if (producerIds.every((producerId) => producerId === 'static')) {
    return ['requestIds', 'ruleVersions', 'frozenInputDigests', 'artifactDigests'];
  }
  return ABG_REFERENCE_KINDS;
}

function validateEntry(entry: AbgCoverageMatrixEntry, assertions: Map<string, string>): void {
  assertMeaningful(entry.gateId, 'ABG_COVERAGE_GATE_ID_INVALID');
  assertNonEmpty(entry.scenarioIds, 'ABG_COVERAGE_SCENARIO_REQUIRED:' + entry.gateId);
  assertNonEmpty(entry.assertionIds, 'ABG_COVERAGE_ASSERTION_REQUIRED:' + entry.gateId);
  assertNonEmpty(entry.producerIds, 'ABG_COVERAGE_PRODUCER_REQUIRED:' + entry.gateId);
  assertNonEmpty(entry.evidenceSelectors, 'ABG_COVERAGE_SELECTOR_REQUIRED:' + entry.gateId);
  assertNonEmpty(entry.requiredReferenceKinds, 'ABG_COVERAGE_REFERENCE_REQUIRED:' + entry.gateId);
  assertNonEmpty(entry.requiredFrozenInputs, 'ABG_COVERAGE_FROZEN_INPUT_REQUIRED:' + entry.gateId);
  assertFailurePolicy(entry.failurePolicy, entry.gateId);

  assertUnique(entry.scenarioIds, 'ABG_COVERAGE_SCENARIO_DUPLICATE:' + entry.gateId);
  for (const scenarioId of entry.scenarioIds) {
    assertScenarioId(scenarioId, entry.gateId);
    if (!entry.evidenceSelectors.some((selector) => selector.scenarioId === scenarioId)) {
      fail('ABG_COVERAGE_SCENARIO_SELECTOR_MISSING:' + entry.gateId + ':' + scenarioId);
    }
  }
  assertUnique(entry.assertionIds, 'ABG_COVERAGE_ASSERTION_DUPLICATE:' + entry.gateId);
  for (const assertionId of entry.assertionIds) {
    assertMeaningful(assertionId, 'ABG_COVERAGE_ASSERTION_INVALID:' + entry.gateId);
    if (!assertionId.startsWith(entry.gateId + ':')) {
      fail('ABG_COVERAGE_ASSERTION_NOT_GATE_SCOPED:' + assertionId);
    }
    const owner = assertions.get(assertionId);
    if (owner) fail('ABG_COVERAGE_ASSERTION_SHARED:' + assertionId + ':' + owner);
    assertions.set(assertionId, entry.gateId);
  }

  assertUnique(entry.producerIds, 'ABG_COVERAGE_PRODUCER_DUPLICATE:' + entry.gateId);
  for (const producerId of entry.producerIds) {
    if (!ABG_PRODUCER_IDS.includes(producerId)) {
      fail('ABG_COVERAGE_PRODUCER_UNKNOWN:' + entry.gateId + ':' + producerId);
    }
  }
  assertUnique(entry.requiredReferenceKinds, 'ABG_COVERAGE_REFERENCE_DUPLICATE:' + entry.gateId);
  for (const referenceKind of entry.requiredReferenceKinds) {
    if (!ABG_REFERENCE_KINDS.includes(referenceKind)) {
      fail('ABG_COVERAGE_REFERENCE_UNKNOWN:' + entry.gateId + ':' + referenceKind);
    }
  }
  assertUnique(entry.requiredFrozenInputs, 'ABG_COVERAGE_FROZEN_INPUT_DUPLICATE:' + entry.gateId);
  for (const frozenInput of entry.requiredFrozenInputs) {
    if (!ABG_FROZEN_INPUT_KINDS.includes(frozenInput)) {
      fail('ABG_COVERAGE_FROZEN_INPUT_UNKNOWN:' + entry.gateId + ':' + frozenInput);
    }
  }

  for (const selector of entry.evidenceSelectors) {
    if (!entry.producerIds.includes(selector.producerId)) {
      fail('ABG_COVERAGE_SELECTOR_PRODUCER_UNDECLARED:' + entry.gateId + ':' + selector.producerId);
    }
    if (!entry.scenarioIds.includes(selector.scenarioId)) {
      fail('ABG_COVERAGE_SELECTOR_SCENARIO_UNDECLARED:' + entry.gateId + ':' + selector.scenarioId);
    }
    if (!entry.assertionIds.includes(selector.assertionId)) {
      fail('ABG_COVERAGE_SELECTOR_ASSERTION_UNDECLARED:' + entry.gateId + ':' + selector.assertionId);
    }
    assertMeaningful(selector.artifactId, 'ABG_COVERAGE_SELECTOR_ARTIFACT_INVALID:' + entry.gateId);
    if (!isJsonPointer(selector.jsonPointer)) {
      fail('ABG_COVERAGE_SELECTOR_POINTER_INVALID:' + entry.gateId + ':' + selector.jsonPointer);
    }
    if (selector.expectedStatus !== 'PASSED' || selector.required !== true) {
      fail('ABG_COVERAGE_SELECTOR_FAIL_CLOSED_INVALID:' + entry.gateId);
    }
  }
}

function assertFailurePolicy(policy: AbgFailurePolicy, gateId: string): void {
  if (policy.mode !== 'FAIL_CLOSED') fail('ABG_COVERAGE_FAILURE_POLICY_MODE_INVALID:' + gateId);
  assertUnique(
    policy.requiredFailureConditions,
    'ABG_COVERAGE_FAILURE_POLICY_DUPLICATE:' + gateId,
  );
  if (
    policy.requiredFailureConditions.length !== ABG_FAILURE_CONDITIONS.length ||
    ABG_FAILURE_CONDITIONS.some((condition) => !policy.requiredFailureConditions.includes(condition))
  ) {
    fail('ABG_COVERAGE_FAILURE_POLICY_INCOMPLETE:' + gateId);
  }
}

function assertScenarioId(scenarioId: string, gateId: string): void {
  assertMeaningful(scenarioId, 'ABG_COVERAGE_SCENARIO_INVALID:' + gateId);
  if (
    /^PHASE0?1-ABG-\d+$/iu.test(scenarioId) ||
    !/^(STATIC|INTEGRATION|LIVE|BROWSER|FAULT|CONSUMER|CAPACITY|RUN)-[A-Z0-9-]+$/u.test(
      scenarioId,
    )
  ) {
    fail('ABG_COVERAGE_SCENARIO_ID_INVALID:' + gateId + ':' + scenarioId);
  }
}

function assertNonEmpty<T>(values: readonly T[], code: string): void {
  if (values.length === 0) fail(code);
}

function assertUnique(values: readonly string[], code: string): void {
  if (new Set(values).size !== values.length) fail(code);
}

function assertMeaningful(value: string | undefined, code: string): void {
  if (
    value === undefined ||
    value.trim().length === 0 ||
    /(?:placeholder|todo|unknown|fake|n\/a)/iu.test(value)
  ) {
    fail(code);
  }
}

function isJsonPointer(value: string): boolean {
  return /^(?:\/(?:[^~/]|~[01])*)+$/u.test(value) && value.endsWith('/status');
}

function isDigest(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function fail(code: string): never {
  throw new Error(code);
}

validateAbgCoverageMatrix();
