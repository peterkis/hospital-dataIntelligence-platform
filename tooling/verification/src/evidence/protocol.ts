import type {
  AbgFrozenInputKind,
  AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
} from '../verification-contract-versions.js';

export {
  PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
};

export const PRODUCER_EVIDENCE_STATUSES = ['PASSED', 'FAILED', 'BLOCKED'] as const;
export type ProducerEvidenceStatus = (typeof PRODUCER_EVIDENCE_STATUSES)[number];

export type JsonPrimitive = null | boolean | number | string;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export interface ProducerCommandIdentity {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly workingDirectory: string;
  readonly commandDigest: string;
}

export interface ProducerEvidenceItem {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly jsonPointer: string;
  readonly claimDigest: string;
}

export interface ProducerAssertionEvidence {
  readonly assertionId: string;
  readonly gateId: string;
  readonly status: ProducerEvidenceStatus;
  readonly description: string;
  readonly expected: JsonValue;
  readonly actual: JsonValue;
  readonly failureCode: string | null;
  readonly evidenceItems: readonly ProducerEvidenceItem[];
}

export interface ProducerScenarioEvidence {
  readonly scenarioId: string;
  readonly title: string;
  readonly producerId: AbgProducerId;
  readonly status: ProducerEvidenceStatus;
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
  readonly artifactDigests: readonly string[];
  readonly assertions: Readonly<Record<string, ProducerAssertionEvidence>>;
}

export interface ProducerEvidence {
  readonly schemaVersion: typeof PRODUCER_EVIDENCE_SCHEMA_VERSION;
  readonly producerId: AbgProducerId;
  readonly runId: string;
  readonly runSequence: number;
  readonly status: ProducerEvidenceStatus;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly commandIdentity: ProducerCommandIdentity;
  readonly environmentRefs: Readonly<Record<string, string>>;
  readonly frozenInputRefs: Readonly<Partial<Record<AbgFrozenInputKind, string>>>;
  readonly scenarios: Readonly<Record<string, ProducerScenarioEvidence>>;
}

export interface ProducerEvidenceIndexEntry {
  readonly producerId: AbgProducerId;
  readonly relativePath: string;
  readonly sha256: string;
  readonly status: ProducerEvidenceStatus;
  readonly scenarioCount: number;
  readonly assertionCount: number;
}

export interface ProducerEvidenceIndex {
  readonly schemaVersion: typeof PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION;
  readonly runId: string;
  readonly runSequence: number;
  readonly producers: readonly ProducerEvidenceIndexEntry[];
}

export function countProducerAssertions(evidence: Pick<ProducerEvidence, 'scenarios'>): number {
  return Object.values(evidence.scenarios).reduce(
    (total, scenario) => total + Object.keys(scenario.assertions).length,
    0,
  );
}
