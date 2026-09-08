import { sql, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { assignmentPeriodCovered, type AssignmentDependencyEvidence, type AssignmentVersion } from './assignment-contracts.js';
import { assignmentTermResult } from './assignment-semantic-definitions.js';
import { readAssignmentClosureVersion } from './assignment-closure-store.js';
import { ASSIGNMENT_SEMANTIC_POLICY, evaluateAssignmentPrimary, type AssignmentSemanticCandidate } from './assignment-semantics-policy.js';
import type { AssignmentSemanticCodes, AssignmentSemanticEvaluation, AssignmentSemanticOperation,
  AssignmentSemanticTermVersion, AssignmentVersionSemantics, AssignmentAdmissionSemantics, ClassifiedAssignmentSemantics, CorrectAssignmentSemantics } from './assignment-semantics-contracts.js';

/** Person-owner private helpers. There is no caller-supplied approval or public save port. */
export async function assignmentSemanticCandidates(database: Transaction<DB>, governanceObjectId: string,
  engagementId: string, recordAsOf: string, excludeAssignmentId: string | null = null): Promise<AssignmentSemanticCandidate[]> {
  const rows = (await sql<AssignmentSemanticCandidate>`
    select latest.assignment_id as "assignmentId",latest.assignment_version_id as "assignmentVersionId",
      latest.business_valid_from as "businessValidFrom",latest.business_valid_to as "businessValidTo",
      s.purpose_code as "purposeCode",s.mode_code as "modeCode"
    from (select distinct on (v.assignment_id) v.assignment_id,v.assignment_version_id,v.business_valid_from,v.business_valid_to,v.evidence_kind
      from person_master.assignment_version v
      where v.governance_object_id=${governanceObjectId}::uuid and v.engagement_id=${engagementId}::uuid
        and v.recorded_from<=${recordAsOf}::timestamp
        and (${excludeAssignmentId}::uuid is null or v.assignment_id<>${excludeAssignmentId}::uuid)
      order by v.assignment_id,v.version_no desc) latest
    left join person_master.assignment_closure_evidence ce
      on latest.evidence_kind='CLOSURE' and ce.closure_assignment_version_id=latest.assignment_version_id
    left join person_master.assignment_version_semantics s on s.assignment_version_id=
      case when latest.evidence_kind='CLOSURE' then ce.source_semantics_version_id else latest.assignment_version_id end
      and s.semantic_recorded_from<=${recordAsOf}::timestamp
    order by latest.assignment_id limit 65
  `.execute(database)).rows;
  if (rows.length>64) throw new Error('ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT');
  return rows;
}
export async function assignmentSemanticExact(database: Transaction<DB>, assignmentVersionId: string): Promise<AssignmentVersionSemantics> {
  const version = await database.selectFrom('person_master.assignment_version').selectAll()
    .where('assignment_version_id', '=', assignmentVersionId).executeTakeFirstOrThrow();
  if (version.evidence_kind !== 'CLOSURE') return assignmentAdmissionSemanticExact(database, assignmentVersionId);
  const closure = await readAssignmentClosureVersion(database, version);
  if (closure.closureEvidence.semanticInheritance === 'UNCLASSIFIED') return { classification: 'UNCLASSIFIED', assignmentVersionId };
  const source = await assignmentAdmissionSemanticExact(database, closure.supersedesAssignmentVersionId);
  if (source.classification !== 'CLASSIFIED' || source.semanticFingerprint !== closure.closureEvidence.sourceSemanticFingerprint)
    throw new Error('ASSIGNMENT_CLOSURE_EVIDENCE_INVALID');
  return { classification: 'CLASSIFIED', semanticRole: 'INHERITED_FOR_CLOSURE', assignmentVersionId,
    sourceAssignmentVersionId: source.assignmentVersionId, sourceSemanticRecordedFrom: source.semanticRecordedFrom,
    closureKnownFrom: closure.recordedFrom, purpose: source.purpose, mode: source.mode, scopeCode: source.scopeCode,
    sourceSemanticFingerprint: source.semanticFingerprint, primaryEvaluation: 'NOT_REEVALUATED_NON_EXPANSIVE' };
}
export async function assignmentAdmissionSemanticExact(database: Transaction<DB>, assignmentVersionId: string): Promise<AssignmentAdmissionSemantics> {
  const row = await database.selectFrom('person_master.assignment_version_semantics').selectAll()
    .where('assignment_version_id','=',assignmentVersionId).executeTakeFirst();
  if (!row) return { classification: 'UNCLASSIFIED', assignmentVersionId };
  const definitions = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
    .where('term_version_id','in',[row.purpose_term_version_id,row.mode_term_version_id]).execute();
  const purpose = definitions.find(d=>d.term_version_id===row.purpose_term_version_id);
  const mode = definitions.find(d=>d.term_version_id===row.mode_term_version_id);
  const operation = (['CLASSIFIED_CREATE','SEMANTIC_ADOPT','CLASSIFIED_PERIOD_REVISE','SEMANTIC_CORRECT','TEMPORARY_CREATE'] as const)
    .find(op=>op===row.semantic_operation_kind);
  if (!purpose || !mode || !operation || !row.policy_digest.equals(Buffer.from(ASSIGNMENT_SEMANTIC_POLICY.policyDigest,'hex')))
    throw new Error('ASSIGNMENT_SEMANTIC_EVIDENCE_INVALID');
  return { ...ASSIGNMENT_SEMANTIC_POLICY, classification: 'CLASSIFIED', assignmentVersionId,
    purpose: assignmentTermResult(purpose), mode: assignmentTermResult(mode),
    scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', semanticOperationKind: operation,
    semanticRecordedFrom: row.semantic_recorded_from, evaluation: row.evaluation as unknown as AssignmentSemanticEvaluation,
    semanticFingerprint: row.semantic_fingerprint.toString('hex') };
}
export function createAssignmentSemanticStore(database: Transaction<DB>, context: RequestContext) {
  async function definition(governanceObjectId: string, dimension: 'PURPOSE'|'MODE', code: string,
    from: string, to: string|null, recordAsOf: string): Promise<AssignmentSemanticTermVersion> {
    const row = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
      .where('governance_object_id','=',governanceObjectId).where('dimension','=',dimension).where('code','=',code)
      .where('recorded_from','<=',recordAsOf).orderBy('version_no','desc').limit(1).executeTakeFirst();
    if (!row || row.definition_state!=='ENABLED' || !assignmentPeriodCovered(row.business_valid_from,row.business_valid_to,from,to))
      throw new Error('ASSIGNMENT_TERM_NOT_APPLICABLE');
    return assignmentTermResult(row);
  }
  return {
    async pinDefinitions(governanceObjectId: string, codes: AssignmentSemanticCodes) {
      const rows = (await sql<{ term_id: string }>`select term_id from person_master.assignment_semantic_term
        where governance_object_id=${governanceObjectId}::uuid and
          ((dimension='PURPOSE' and code=${codes.purposeCode}) or (dimension='MODE' and code=${codes.modeCode}))
        order by term_id for share`.execute(database)).rows;
      if (rows.length!==2) throw new Error('ASSIGNMENT_TERM_NOT_APPLICABLE');
    },
    async evaluate(governanceObjectId: string, engagementId: string, assignmentId: string|null,
      codes: AssignmentSemanticCodes, dependency: AssignmentDependencyEvidence) {
      const from=dependency.engagement.requestedFrom, to=dependency.engagement.requestedTo, recordAsOf=dependency.evaluationRecordAsOf;
      const purpose = await definition(governanceObjectId,'PURPOSE',codes.purposeCode,from,to,recordAsOf);
      const mode = await definition(governanceObjectId,'MODE',codes.modeCode,from,to,recordAsOf);
      const others=await assignmentSemanticCandidates(database,governanceObjectId,engagementId,recordAsOf,assignmentId);
      const evaluated=evaluateAssignmentPrimary({ ...codes,businessValidFrom: from,businessValidTo: to },others);
      const evaluation={ ...evaluated, bucket: { governanceObjectId, personId: dependency.engagement.personId, engagementId,
        purposeCode: codes.purposeCode, scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS' as const },
        businessValidFrom: from,businessValidTo: to,evaluationRecordAsOf: recordAsOf,
        purposeTermVersionId: purpose.termVersionId,modeTermVersionId: mode.termVersionId,
        dependencyFingerprint: dependency.dependencyFingerprint };
      if (Buffer.byteLength(JSON.stringify(evaluation))>65536) throw new Error('ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT');
      if (evaluation.result!=='SATISFIED' && evaluation.result!=='NOT_APPLICABLE_NON_PRIMARY')
        return { ok: false as const, code: evaluation.result, evaluation };
      const accepted: AssignmentSemanticEvaluation={ ...evaluation,result: evaluation.result };
      return { ok: true as const, purpose,mode,evaluation: accepted };
    },
    async append(version: AssignmentVersion, accepted: { purpose: AssignmentSemanticTermVersion; mode: AssignmentSemanticTermVersion;
      evaluation: AssignmentSemanticEvaluation }, operation: AssignmentSemanticOperation, hash: Buffer,
      correctionReason: CorrectAssignmentSemantics['reasonCode']|null): Promise<ClassifiedAssignmentSemantics> {
      const { purpose,mode,evaluation }=accepted;
      const semanticFingerprint=canonicalSha256({ assignmentVersionId: version.assignmentVersionId,
        ...ASSIGNMENT_SEMANTIC_POLICY, evaluation });
      await database.insertInto('person_master.assignment_version_semantics').values({
        assignment_version_id: version.assignmentVersionId,assignment_id: version.assignmentId,governance_object_id: version.governanceObjectId,
        engagement_id: evaluation.bucket.engagementId,person_id: evaluation.bucket.personId,
        purpose_term_version_id: purpose.termVersionId,purpose_code: purpose.code,mode_term_version_id: mode.termVersionId,mode_code: mode.code,
        constraint_scope_code: 'HOSPITAL_DEPARTMENT_PLACEMENTS', semantic_operation_kind: operation,correction_reason_code: correctionReason,
        business_valid_from: version.businessValidFrom,business_valid_to: version.businessValidTo,
        semantic_recorded_from: version.recordedFrom,evaluation_record_as_of: evaluation.evaluationRecordAsOf,
        policy_code: ASSIGNMENT_SEMANTIC_POLICY.policyCode,policy_version: 1,policy_digest: Buffer.from(ASSIGNMENT_SEMANTIC_POLICY.policyDigest,'hex'),
        evaluation:sql`${JSON.stringify(evaluation)}::jsonb`,semantic_fingerprint: semanticFingerprint,request_id: context.requestId,created_by: context.actorPrincipalId,operation_hash: hash,
      }).execute();
      return { ...ASSIGNMENT_SEMANTIC_POLICY, classification: 'CLASSIFIED', assignmentVersionId: version.assignmentVersionId,
        purpose,mode,scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS',semanticOperationKind: operation,semanticRecordedFrom: version.recordedFrom,
        evaluation,semanticFingerprint: semanticFingerprint.toString('hex') };
    },
  };
}
