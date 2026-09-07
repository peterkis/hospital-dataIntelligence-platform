import type { Selectable, Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';
import { temporalKey } from './engagement-rule-segments.js';
import { ASSIGNMENT_CLOSURE_POLICY, ASSIGNMENT_CLOSURE_POLICY_DIGEST, ASSIGNMENT_CLOSURE_REASONS,
  type AssignmentClosureEvidence, type AssignmentClosureVersion, type EndAssignment } from './assignment-closure-contracts.js';

type VersionRow = Selectable<DB['person_master.assignment_version']>;
type EvidenceRow = Selectable<DB['person_master.assignment_closure_evidence']>;
type Proof = Omit<AssignmentClosureEvidence, 'closureEvidenceFingerprint'>;

function proof(row: EvidenceRow): Proof {
  const reason = ASSIGNMENT_CLOSURE_REASONS.find(value => value === row.reason_code);
  if (!reason || row.closure_policy_code !== ASSIGNMENT_CLOSURE_POLICY.policyCode || row.closure_policy_version !== 1
    || row.closure_policy_digest.toString('hex') !== ASSIGNMENT_CLOSURE_POLICY_DIGEST
    || row.proof_kind !== 'NON_EXPANSIVE_CLOSURE'
    || (row.semantic_inheritance !== 'CLASSIFIED' && row.semantic_inheritance !== 'UNCLASSIFIED'))
    throw new Error('ASSIGNMENT_CLOSURE_EVIDENCE_INVALID');
  return {
    closureVersionId: row.closure_assignment_version_id, assignmentId: row.assignment_id, governanceObjectId: row.governance_object_id,
    previousAssignmentVersionId: row.previous_assignment_version_id, previousVersionNo: row.previous_version_no,
    previousBusinessValidFrom: row.previous_business_valid_from, previousBusinessValidTo: row.previous_business_valid_to,
    endedAt: row.ended_at, closureRecordedFrom: row.closure_recorded_from, reasonCode: reason,
    policyCode: ASSIGNMENT_CLOSURE_POLICY.policyCode, policyVersion: 1, policyDigest: ASSIGNMENT_CLOSURE_POLICY_DIGEST,
    proofKind: 'NON_EXPANSIVE_CLOSURE', isPeriodPreservingEndConfirmation: row.is_period_preserving_end_confirmation,
    sourceAcceptanceVersionId: row.source_acceptance_version_id,
    sourceAcceptanceDependencyFingerprint: row.source_acceptance_dependency_fingerprint.toString('hex'),
    sourceSemanticsVersionId: row.source_semantics_version_id, sourceSemanticFingerprint: row.source_semantic_fingerprint?.toString('hex') ?? null,
    semanticInheritance: row.semantic_inheritance, createdBy: row.created_by, requestId: row.request_id,
    operationHash: row.operation_hash.toString('hex'),
  };
}

export async function readAssignmentClosureVersion(database: Transaction<DB>, version: VersionRow): Promise<AssignmentClosureVersion> {
  if (version.evidence_kind !== 'CLOSURE' || version.reason_code !== 'LIFECYCLE_END'
    || version.business_valid_to === null || version.supersedes_assignment_version_id === null)
    throw new Error('ASSIGNMENT_NOT_CLOSURE_VERSION');
  const row = await database.selectFrom('person_master.assignment_closure_evidence').selectAll()
    .where('closure_assignment_version_id', '=', version.assignment_version_id).executeTakeFirstOrThrow();
  const evidence = proof(row);
  if (!canonicalSha256(evidence).equals(row.closure_evidence_fingerprint)) throw new Error('ASSIGNMENT_CLOSURE_EVIDENCE_INVALID');
  return {
    recordKind: 'CLOSURE', governanceObjectId: version.governance_object_id, assignmentId: version.assignment_id,
    assignmentVersionId: version.assignment_version_id, versionNo: version.version_no,
    supersedesAssignmentVersionId: version.supersedes_assignment_version_id, reasonCode: 'LIFECYCLE_END',
    businessValidFrom: version.business_valid_from, businessValidTo: version.business_valid_to, recordedFrom: version.recorded_from,
    closureEvidence: { ...evidence, closureEvidenceFingerprint: row.closure_evidence_fingerprint.toString('hex') },
  };
}

/** Private append used only after current authorization, common replay and owner fences. */
export async function appendAssignmentClosure(database: Transaction<DB>, context: RequestContext,
  prior: VersionRow, command: EndAssignment, operationHash: Buffer): Promise<AssignmentClosureVersion> {
  if (prior.evidence_kind !== 'ADMISSION' || prior.dependency_fingerprint === null) throw new Error('ASSIGNMENT_CLOSURE_PREDECESSOR_REQUIRED');
  const semantics = await database.selectFrom('person_master.assignment_version_semantics')
    .select(['assignment_version_id', 'semantic_fingerprint']).where('assignment_version_id', '=', prior.assignment_version_id).executeTakeFirst();
  const version = await database.insertInto('person_master.assignment_version').values({
    evidence_kind: 'CLOSURE', assignment_id: prior.assignment_id, governance_object_id: prior.governance_object_id,
    engagement_id: prior.engagement_id, department_id: prior.department_id, version_no: String(BigInt(prior.version_no) + 1n),
    supersedes_assignment_version_id: prior.assignment_version_id, reason_code: 'LIFECYCLE_END',
    business_valid_from: prior.business_valid_from, business_valid_to: command.endedAt,
    created_by: context.actorPrincipalId, request_id: context.requestId, operation_hash: operationHash,
  }).returningAll().executeTakeFirstOrThrow();
  hitControlledPublicationFault('ASSIGNMENT_CLOSURE_VERSION_WRITTEN');
  if (version.business_valid_to === null) throw new Error('ASSIGNMENT_CLOSURE_PERIOD_INVALID');
  const evidence: Proof = {
    closureVersionId: version.assignment_version_id, assignmentId: prior.assignment_id, governanceObjectId: prior.governance_object_id,
    previousAssignmentVersionId: prior.assignment_version_id, previousVersionNo: prior.version_no,
    previousBusinessValidFrom: prior.business_valid_from, previousBusinessValidTo: prior.business_valid_to,
    endedAt: version.business_valid_to, closureRecordedFrom: version.recorded_from, reasonCode: command.reasonCode,
    policyCode: ASSIGNMENT_CLOSURE_POLICY.policyCode, policyVersion: 1, policyDigest: ASSIGNMENT_CLOSURE_POLICY_DIGEST,
    proofKind: 'NON_EXPANSIVE_CLOSURE', isPeriodPreservingEndConfirmation: prior.business_valid_to !== null
      && temporalKey(prior.business_valid_to) === temporalKey(version.business_valid_to),
    sourceAcceptanceVersionId: prior.assignment_version_id, sourceAcceptanceDependencyFingerprint: prior.dependency_fingerprint.toString('hex'),
    sourceSemanticsVersionId: semantics?.assignment_version_id ?? null,
    sourceSemanticFingerprint: semantics?.semantic_fingerprint.toString('hex') ?? null,
    semanticInheritance: semantics ? 'CLASSIFIED' : 'UNCLASSIFIED', createdBy: context.actorPrincipalId,
    requestId: context.requestId, operationHash: operationHash.toString('hex'),
  };
  await database.insertInto('person_master.assignment_closure_evidence').values({
    closure_assignment_version_id: evidence.closureVersionId, assignment_id: evidence.assignmentId, governance_object_id: evidence.governanceObjectId,
    previous_assignment_version_id: evidence.previousAssignmentVersionId, previous_version_no: evidence.previousVersionNo,
    previous_business_valid_from: evidence.previousBusinessValidFrom, previous_business_valid_to: evidence.previousBusinessValidTo,
    ended_at: evidence.endedAt, closure_recorded_from: evidence.closureRecordedFrom, reason_code: evidence.reasonCode,
    closure_policy_code: evidence.policyCode, closure_policy_version: evidence.policyVersion,
    closure_policy_digest: Buffer.from(evidence.policyDigest, 'hex'), proof_kind: evidence.proofKind,
    is_period_preserving_end_confirmation: evidence.isPeriodPreservingEndConfirmation,
    source_acceptance_version_id: evidence.sourceAcceptanceVersionId,
    source_acceptance_dependency_fingerprint: prior.dependency_fingerprint,
    source_semantics_version_id: evidence.sourceSemanticsVersionId, source_semantic_fingerprint: semantics?.semantic_fingerprint ?? null,
    semantic_inheritance: evidence.semanticInheritance, created_by: context.actorPrincipalId, request_id: context.requestId,
    operation_hash: operationHash, closure_evidence_fingerprint: canonicalSha256(evidence),
  }).execute();
  hitControlledPublicationFault('ASSIGNMENT_CLOSURE_EVIDENCE_WRITTEN');
  return readAssignmentClosureVersion(database, version);
}
