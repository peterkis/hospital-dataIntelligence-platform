import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql,type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { RequestContext } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';
import type { TemporaryAssignmentResult,CreateSourceLinkedTemporaryAssignment,TemporaryAssignmentApplication } from '../../apps/governance-api/src/modules/person-master/index.js';
import { temporaryDatabaseIdentity } from './person-assignment-temporary-fixture-guard.js';
import { temporarySource,temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';
import type { TemporaryFixture } from './person-assignment-temporary-fixture.js';
import { Jun,Jul,Aug,Dec,departmentScope } from './person-assignment-fixture.js';

type ReadSnapshot<Method extends (...args:never[])=>unknown>={query:Parameters<Method>[0];value:Awaited<ReturnType<Method>>};
export interface TemporaryRecoveryReceipt {
  task:'PV-006-C-04';mode:'RECOVERY';runId:string;
  identity:Awaited<ReturnType<typeof temporaryDatabaseIdentity>>;
  postmasterStartedAt:string;
  creates:{kind:string;context:RequestContext;command:CreateSourceLinkedTemporaryAssignment;value:TemporaryAssignmentResult}[];
  refusals:{context:RequestContext;command:CreateSourceLinkedTemporaryAssignment;code:string}[];
  declaredReads:ReadSnapshot<TemporaryAssignmentApplication['getTemporaryAssignmentAsOf']>[];
  assessments:ReadSnapshot<TemporaryAssignmentApplication['assessTemporaryAssignmentDependencies']>[];
  assignmentIds:string[];requestIds:string[];
  fingerprint:Awaited<ReturnType<typeof temporaryRecoveryFingerprint>>;
  contentHash:string;
}
export async function temporaryRecoveryFingerprint(database:Kysely<DB>,assignmentIds:string[],requestIds:string[]) {
  const assignments=[];
  for(const id of assignmentIds) assignments.push({assignmentId:id,rows:await temporarySourceSnapshot(database,id)});
  const roots=(await sql<{count:number;digest:string}>`select count(*)::int as count,
    encode(digest(coalesce(string_agg(j,'' order by kind,j),''),'sha256'),'hex') as digest from (
      select 'outcome' as kind,to_jsonb(t)::text as j from person_master.assignment_command_outcome t where request_id=any(${requestIds}::text[])
      union all select 'audit',to_jsonb(t)::text from audit.audit_event t where request_id=any(${requestIds}::text[])
        and action in ('PERSON_ASSIGNMENT_TEMPORARY_CREATED','PERSON_ASSIGNMENT_TEMPORARY_REJECTED','PERSON_ASSIGNMENT_CREATED','ASSIGNMENT_SEMANTICS_RECORDED')
    ) all_rows`.execute(database)).rows[0]!;
  return {assignments,roots};
}
export async function prepareTemporaryRecovery(database:Kysely<DB>,f:TemporaryFixture,runId:string):Promise<TemporaryRecoveryReceipt> {
  const identity=await temporaryDatabaseIdentity(database);
  assert.equal(identity.database,'hdi_prototype','C04_RECOVERY_RETAINED_REQUIRED');
  const postmasterStartedAt=(await sql<{value:string}>`select to_char(pg_postmaster_start_time() at time zone 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') as value`.execute(database)).rows[0]!.value;
  const creates:TemporaryRecoveryReceipt['creates']=[],refusals:TemporaryRecoveryReceipt['refusals']=[],
    declaredReads:TemporaryRecoveryReceipt['declaredReads']=[],assessments:TemporaryRecoveryReceipt['assessments']=[];
  const assignmentIds:string[]=[],requestIds:string[]=[];
  for(const kind of ['EXPIRY','CHILD_END','SOURCE_END','SOURCE_TRANSFER','LATE_SUSPEND','SOURCE_END_COVERED']) {
    const {source,engagement}=await temporarySource(f),root=randomUUID(),command=f.temporaryCommand(source);
    const value=await f.temporary(root).createSourceLinkedTemporaryAssignment(command);
    creates.push({kind,context:f.context(f.actor,root),command,value});requestIds.push(root);
    assignmentIds.push(source.assignmentId,value.targetAssignmentId);
    let assessmentVersion=value.targetAdmissionVersionId;
    if(kind==='CHILD_END') assessmentVersion=(await f.closure().endAssignment(f.endCommand(value.targetAdmission,'2026-07-15T00:00:00'))).assignmentVersionId;
    if(kind==='SOURCE_END'||kind==='SOURCE_END_COVERED') await f.closure().endAssignment(f.endCommand(source,kind==='SOURCE_END'?Jun:Dec));
    if(kind==='SOURCE_TRANSFER') {
      const target=await f.createDepartment('C04-RECOVERY-SUCCESSOR');
      const moved=await f.transfer().transferAssignment({...f.scope,sourceAssignmentId:source.assignmentId,expectedSourceVersionId:source.assignmentVersionId,
        effectiveAt:Jun,targetPlacement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:target.departmentId},reasonCode:'ORGANIZATIONAL_TRANSFER'});
      assignmentIds.push(moved.targetAssignmentId);
    }
    if(kind==='LATE_SUSPEND') await f.lifecycle().suspendEngagement({...f.scope,engagementId:engagement.engagementId,expectedLifecycleSequence:'0',
      businessEffectiveAt:'2026-07-10T00:00:00',reasonCode:'SYNTHETIC_C04_RECOVERY_SUSPEND'});
    const currentR=await f.now();
    for(const recordAsOf of [value.sourceLink.recordedFrom,currentR]) for(const businessAt of [Jul,'2026-07-20T00:00:00',Aug]) {
      const query={...f.scope,targetAssignmentId:value.targetAssignmentId,businessAt,recordAsOf};
      declaredReads.push({query,value:await f.temporary().getTemporaryAssignmentAsOf(query)});
    }
    for(const [assignmentVersionId,recordAsOf] of [[value.targetAdmissionVersionId,value.sourceLink.recordedFrom],[assessmentVersion,currentR]] as const) {
      const query={...f.scope,targetAssignmentId:value.targetAssignmentId,assignmentVersionId,recordAsOf};
      assessments.push({query,value:await f.temporary().assessTemporaryAssignmentDependencies(query)});
    }
  }
  const denied=await temporarySource(f),target=await f.createDepartment('C04-RECOVERY-UNPUBLISHED',false),root=randomUUID();
  const command=f.temporaryCommand(denied.source,{targetPlacement:{scope:'DEPARTMENT',departmentGovernanceObjectId:departmentScope.governanceObjectId,departmentId:target.departmentId}});
  await assert.rejects(f.temporary(root).createSourceLinkedTemporaryAssignment(command),{message:'ASSIGNMENT_PLACEMENT_UNPUBLISHED'});
  await f.publishDepartment(target);
  refusals.push({context:f.context(f.actor,root),command,code:'ASSIGNMENT_PLACEMENT_UNPUBLISHED'});
  requestIds.push(root);assignmentIds.push(denied.source.assignmentId);
  const body:Omit<TemporaryRecoveryReceipt,'contentHash'>={task:'PV-006-C-04',mode:'RECOVERY',runId,identity,postmasterStartedAt,
    creates,refusals,declaredReads,assessments,assignmentIds,requestIds,fingerprint:await temporaryRecoveryFingerprint(database,assignmentIds,requestIds)};
  return {...body,contentHash:canonicalSha256(body).toString('hex')};
}
