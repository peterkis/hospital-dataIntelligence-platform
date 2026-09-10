import type { Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import { ASSIGNMENT_KNOWN_MODES, ASSIGNMENT_PURPOSES } from './assignment-semantics-contracts.js';
import type { AssignmentSemanticCandidate } from './assignment-semantics-policy.js';
import type { DepartmentPlacementReference } from '../department-master/index.js';
import { ASSIGNMENT_TEMPORARY_POLICY, ASSIGNMENT_TEMPORARY_POLICY_DIGEST,
  type TemporaryAssignmentSourceLink, type TemporaryCandidateEvidence, type TemporarySourceWindowEvidence } from './assignment-temporary-contracts.js';

type LinkRow = Selectable<DB['person_master.assignment_temporary_source']>;
const invalid = () => new Error('ASSIGNMENT_TEMPORARY_EVIDENCE_INVALID');
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  assertClosedObject(value, keys);
  if (keys.some(key => !Object.hasOwn(value, key))) throw invalid();
  return value;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 256 || /\p{Cc}/u.test(value)) throw invalid();
  return value;
}
function time(value: unknown): string { const result = text(value); temporalKey(result); return result; }
function optionalTime(value: unknown): string | null { return value === null ? null : time(value); }
function uuid(value: unknown): string { assertPersonUuid(value); return value; }
function hash(value: unknown): string { const result = text(value); if (!/^[a-f0-9]{64}$/u.test(result)) throw invalid(); return result; }
function integerString(value: unknown): string { const result = text(value); if (!/^[1-9]\d{0,17}$/u.test(result)) throw invalid(); return result; }
function purpose(value: unknown) {
  const code = ASSIGNMENT_PURPOSES.find(code => code === value);
  if (!code) throw invalid();
  return code;
}
function candidate(value: unknown): AssignmentSemanticCandidate {
  const row = object(value, ['assignmentId', 'assignmentVersionId', 'businessValidFrom', 'businessValidTo', 'purposeCode', 'modeCode']);
  if (row['modeCode'] !== null && !ASSIGNMENT_KNOWN_MODES.some(mode => mode === row['modeCode'])) throw invalid();
  return { assignmentId: uuid(row['assignmentId']), assignmentVersionId: uuid(row['assignmentVersionId']),
    businessValidFrom: time(row['businessValidFrom']), businessValidTo: optionalTime(row['businessValidTo']),
    purposeCode: row['purposeCode'] === null ? null : purpose(row['purposeCode']),
    modeCode: row['modeCode'] === null ? null : text(row['modeCode']) };
}
function department(value: unknown): DepartmentPlacementReference {
  const r = object(value, ['semanticRole', 'departmentGovernanceObjectId', 'departmentId', 'recordAsOf',
    'departmentVersionId', 'versionNo', 'contentHash', 'recordedFrom', 'recordedTo', 'releaseId',
    'publicationProjectionId', 'publishedAt', 'businessStatus', 'businessValidFrom', 'businessValidTo']);
  if (r['semanticRole'] !== 'PUBLISHED_DEPARTMENT_PLACEMENT_REFERENCE' || r['businessStatus'] !== 'ACTIVE') throw invalid();
  return { semanticRole: 'PUBLISHED_DEPARTMENT_PLACEMENT_REFERENCE', departmentGovernanceObjectId: uuid(r['departmentGovernanceObjectId']),
    departmentId: uuid(r['departmentId']), recordAsOf: time(r['recordAsOf']), departmentVersionId: uuid(r['departmentVersionId']),
    versionNo: integerString(r['versionNo']), contentHash: hash(r['contentHash']), recordedFrom: time(r['recordedFrom']),
    recordedTo: optionalTime(r['recordedTo']), releaseId: uuid(r['releaseId']), publicationProjectionId: uuid(r['publicationProjectionId']),
    publishedAt: time(r['publishedAt']), businessStatus: 'ACTIVE', businessValidFrom: time(r['businessValidFrom']),
    businessValidTo: optionalTime(r['businessValidTo']) };
}
function candidates(value: unknown): TemporaryCandidateEvidence {
  const r = object(value, ['scopeCode', 'purposeCode', 'businessValidFrom', 'businessValidTo', 'recordAsOf', 'candidates', 'result']);
  if (r['scopeCode'] !== 'HOSPITAL_DEPARTMENT_PLACEMENTS' || r['result'] !== 'SATISFIED'
    || !Array.isArray(r['candidates']) || r['candidates'].length > 64) throw invalid();
  return { scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', purposeCode: purpose(r['purposeCode']),
    businessValidFrom: time(r['businessValidFrom']), businessValidTo: time(r['businessValidTo']),
    recordAsOf: time(r['recordAsOf']), candidates: r['candidates'].map(candidate), result: 'SATISFIED' };
}
function window(value: unknown): TemporarySourceWindowEvidence {
  const r = object(value, ['semanticRole', 'requestedFrom', 'requestedTo', 'recordAsOf', 'sourceDepartment',
    'targetAdmissionDependencyFingerprint', 'constraintResult']);
  if (r['semanticRole'] !== 'TEMPORARY_SOURCE_WINDOW_VALIDATION' || r['constraintResult'] !== 'SATISFIED') throw invalid();
  return { semanticRole: 'TEMPORARY_SOURCE_WINDOW_VALIDATION', requestedFrom: time(r['requestedFrom']),
    requestedTo: time(r['requestedTo']), recordAsOf: time(r['recordAsOf']), sourceDepartment: department(r['sourceDepartment']),
    targetAdmissionDependencyFingerprint: hash(r['targetAdmissionDependencyFingerprint']), constraintResult: 'SATISFIED' };
}

/** Decode bounded, native-paired evidence without a double assertion over JSON. */
export async function readTemporarySourceLink(database: Transaction<DB>, governanceObjectId: string,
  targetAssignmentId: string): Promise<TemporaryAssignmentSourceLink> {
  const row = await database.selectFrom('person_master.assignment_temporary_source').selectAll()
    .where('governance_object_id', '=', governanceObjectId).where('target_assignment_id', '=', targetAssignmentId).executeTakeFirst();
  if (!row) throw new Error('ASSIGNMENT_TEMPORARY_NOT_FOUND');
  const checked = (await sql<{ valid: boolean }>`select source_link_fingerprint =
    digest(convert_to((to_jsonb(t)-'source_link_fingerprint')::text,'UTF8'),'sha256') as valid
    from person_master.assignment_temporary_source t where target_assignment_id=${targetAssignmentId}::uuid`.execute(database)).rows[0];
  if (!checked?.valid) throw invalid();
  return decode(row);
}
function decode(r: LinkRow): TemporaryAssignmentSourceLink {
  if (r.policy_code !== ASSIGNMENT_TEMPORARY_POLICY.policyCode || r.policy_version !== 1
    || r.policy_digest.toString('hex') !== ASSIGNMENT_TEMPORARY_POLICY_DIGEST || r.temporary_mode_code !== 'SECONDMENT'
    || r.reason_code !== 'TEMPORARY_SECONDMENT_PLACEMENT') throw invalid();
  const sourceWindowValidationEvidence = window(r.source_window_validation_evidence);
  const sourcePrimaryEvaluationEvidence = candidates(r.source_primary_evaluation_evidence);
  const temporaryOverlapEvaluationEvidence = candidates(r.temporary_overlap_evaluation_evidence);
  if (Buffer.byteLength(JSON.stringify([sourceWindowValidationEvidence, sourcePrimaryEvaluationEvidence,
    temporaryOverlapEvaluationEvidence]), 'utf8') > 65536) throw invalid();
  return {
    targetAssignmentId: r.target_assignment_id, targetAdmissionVersionId: r.target_admission_version_id,
    sourceAssignmentId: r.source_assignment_id, sourceAssignmentVersionId: r.source_assignment_version_id,
    personId: r.person_id, engagementId: r.engagement_id, governanceObjectId: r.governance_object_id,
    sourcePlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: r.source_department_governance_object_id,
      departmentId: r.source_department_id },
    targetPlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: r.target_department_governance_object_id,
      departmentId: r.target_department_id },
    preservedPurposeCode: purpose(r.preserved_purpose_code), temporaryModeCode: 'SECONDMENT',
    sourceSemanticVersionId: r.source_semantic_version_id, sourceSemanticFingerprint: r.source_semantic_fingerprint.toString('hex'),
    sourceAcceptanceDependencyFingerprint: r.source_acceptance_dependency_fingerprint.toString('hex'),
    sourceDeclaredFrom: r.source_declared_from, sourceDeclaredTo: r.source_declared_to,
    temporaryFrom: r.temporary_from, temporaryTo: r.temporary_to, evaluationRecordAsOf: r.evaluation_record_as_of,
    recordedFrom: r.recorded_from, sourceWindowValidationEvidence, sourcePrimaryEvaluationEvidence, temporaryOverlapEvaluationEvidence,
    targetAdmissionDependencyFingerprint: r.target_admission_dependency_fingerprint.toString('hex'),
    policyCode: ASSIGNMENT_TEMPORARY_POLICY.policyCode, policyVersion: 1, policyDigest: r.policy_digest.toString('hex'),
    requestId: r.request_id, createdBy: r.created_by, operationHash: r.operation_hash.toString('hex'),
    reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT', sourceLinkFingerprint: r.source_link_fingerprint.toString('hex'),
  };
}
