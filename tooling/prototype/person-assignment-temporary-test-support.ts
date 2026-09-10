import assert from 'node:assert/strict';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { AssignmentAdmissionVersion, TemporaryAssignmentResult } from '../../apps/governance-api/src/modules/person-master/index.js';
import type { TemporaryFixture } from './person-assignment-temporary-fixture.js';
import { Dec } from './person-assignment-fixture.js';

export async function temporarySourceSnapshot(database: Kysely<DB>, assignmentId: string) {
  return (await sql<{ table: string; count: number; digest: string }>`with source_versions as
    (select * from person_master.assignment_version where assignment_id=${assignmentId}::uuid), all_rows as (
    select 'assignment' as kind,to_jsonb(t)::text as row from person_master.assignment t where assignment_id=${assignmentId}::uuid
    union all select 'version',to_jsonb(t)::text from source_versions t
    union all select 'semantic',to_jsonb(t)::text from person_master.assignment_version_semantics t where assignment_id=${assignmentId}::uuid
    union all select 'segment',to_jsonb(t)::text from person_master.assignment_validation_segment t where assignment_version_id in (select assignment_version_id from source_versions)
    union all select 'closure',to_jsonb(t)::text from person_master.assignment_closure_evidence t where assignment_id=${assignmentId}::uuid
    union all select 'temporary_source',to_jsonb(t)::text from person_master.assignment_temporary_source t where target_assignment_id=${assignmentId}::uuid
    union all select 'transfer',to_jsonb(t)::text from person_master.assignment_transfer t where source_assignment_id=${assignmentId}::uuid or target_assignment_id=${assignmentId}::uuid
    union all select 'source_outcome',to_jsonb(t)::text from person_master.assignment_command_outcome t where assignment_version_id in (select assignment_version_id from source_versions))
    select kind as "table",count(*)::int as count,encode(digest(string_agg(row,'' order by row),'sha256'),'hex') as digest
    from all_rows group by kind order by kind`.execute(database)).rows;
}
export async function temporaryRequestCounts(database: Kysely<DB>, requestId: string) {
  return (await sql<{ stable: number; version: number; segments: number; semantic: number; links: number; outcomes: number; success: number }>`select
    (select count(*)::int from person_master.assignment where creation_request_id=${requestId}) as stable,
    (select count(*)::int from person_master.assignment_version where request_id=${requestId}) as version,
    (select count(*)::int from person_master.assignment_validation_segment s join person_master.assignment_version v using(assignment_version_id) where v.request_id=${requestId}) as segments,
    (select count(*)::int from person_master.assignment_version_semantics where request_id=${requestId}) as semantic,
    (select count(*)::int from person_master.assignment_temporary_source where request_id=${requestId}) as links,
    (select count(*)::int from person_master.assignment_command_outcome where request_id=${requestId}) as outcomes,
    (select count(*)::int from audit.audit_event where request_id=${requestId} and action='PERSON_ASSIGNMENT_TEMPORARY_CREATED') as success`.execute(database)).rows[0]!;
}
export async function temporarySource(f: TemporaryFixture, changes: Parameters<TemporaryFixture['classifiedCommand']>[1] = {}) {
  const engagement = await f.createEngagement();
  const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,
    { businessValidTo: Dec, ...changes }))).coreVersion;
  return { engagement, source };
}
export async function assertTemporarySuccess(database: Kysely<DB>, f: TemporaryFixture, source: AssignmentAdmissionVersion,
  requestId: string, result: TemporaryAssignmentResult) {
  assert.equal(result.targetSemantics.mode.code, 'SECONDMENT');
  assert.equal(result.targetSemantics.semanticOperationKind, 'TEMPORARY_CREATE');
  assert.equal(result.targetSemantics.evaluation.result, 'NOT_APPLICABLE_NON_PRIMARY');
  assert.equal(result.targetAdmission.recordedFrom, result.sourceLink.recordedFrom);
  assert.equal(result.targetSemantics.semanticRecordedFrom, result.sourceLink.recordedFrom);
  assert.equal(result.targetAdmission.acceptanceEvidence.evaluationRecordAsOf, result.sourceLink.evaluationRecordAsOf);
  assert.equal(result.sourceLink.sourceAssignmentVersionId, source.assignmentVersionId);
  assert.equal(result.sourceLink.sourceAssignmentId, source.assignmentId);
  assert.equal(result.sourceLink.personId, source.acceptanceEvidence.engagement.personId);
  assert.equal(result.sourceLink.engagementId, source.acceptanceEvidence.engagement.engagementId);
  assert.notEqual(result.sourceLink.sourcePlacement.departmentId, result.sourceLink.targetPlacement.departmentId);
  const primary = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: result.sourceLink.engagementId,
    purposeCode: result.sourceLink.preservedPurposeCode, scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS',
    businessAt: result.sourceLink.temporaryFrom, recordAsOf: result.sourceLink.recordedFrom });
  assert.equal(primary.resolution, 'UNIQUE'); assert.equal(primary.selectedAssignmentVersionId, source.assignmentVersionId);
  const counts = await temporaryRequestCounts(database, requestId);
  assert.deepEqual(counts, { stable: 1, version: 1, segments: 1, semantic: 1, links: 1, outcomes: 1, success: 1 });
  return { counts, primary, sourceVersionId: source.assignmentVersionId, targetAssignmentId: result.targetAssignmentId,
    targetVersionId: result.targetAdmissionVersionId, sourceLinkFingerprint: result.sourceLink.sourceLinkFingerprint };
}
