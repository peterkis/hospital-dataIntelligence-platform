import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { createDepartmentGovernanceApplication,createDepartmentQueryService,departmentDtoLocalDateTime } from '../../apps/governance-api/src/modules/department-master/index.js';
import { createCampusReferenceReader } from '../../apps/governance-api/src/platform/campus/campus-reference-reader.js';
import type { TemporaryFixture,TemporaryCheck } from './person-assignment-temporary-fixture.js';
import { temporarySource,temporaryRequestCounts } from './person-assignment-temporary-test-support.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import { Jan,Jul,departmentScope } from './person-assignment-fixture.js';

export async function runTemporaryScopes(database:Kysely<DB>,f:TemporaryFixture,check:TemporaryCheck) {
  await check(['DW-02','TX-12','SC-03','OV-02'],'Actual distinct Department governance namespaces independently require source and target read grants in the same hospital bucket',async()=>{
    const object=await database.insertInto('platform.governance_object').values({object_code:`C04-DEPARTMENT-${randomUUID()}`,
      object_type:'DEPARTMENT_MASTER',display_name:'SYNTHETIC C04 SAME HOSPITAL DEPARTMENT NAMESPACE',created_by:PROTOTYPE_FIXTURE.actorPrincipalId}).returningAll().executeTakeFirstOrThrow();
    const grants=await database.selectFrom('access_control.object_permission_grant').selectAll().where('governance_object_id','=',departmentScope.governanceObjectId)
      .where('security_principal_id','in',[PROTOTYPE_FIXTURE.actorPrincipalId,PROTOTYPE_FIXTURE.reviewerPrincipalId,PROTOTYPE_FIXTURE.approverPrincipalId])
      .where('permission_code','like','DEPARTMENT_MASTER_%').execute();
    assert.ok(grants.length);
    for(const grant of grants){const {object_permission_grant_id,created_at,...fields}=grant;void object_permission_grant_id;void created_at;
      await database.insertInto('access_control.object_permission_grant').values({...fields,governance_object_id:object.governance_object_id}).execute();}
    const runner=createTransactionRunner(database,(tx,context)=>createScopedModules(tx,context,database));
    const workflowApplication=createWorkflowApplication(runner),queryService=createDepartmentQueryService(database,createCampusReferenceReader(database));
    const app=async(actor:string)=>createDepartmentGovernanceApplication({context:{...f.context(actor),occurredAt:(await f.now()).slice(0,19)},
      transactionRunner:runner,workflowApplication,queryService});
    const scope={governanceObjectId:object.governance_object_id};
    const draft=await(await app(PROTOTYPE_FIXTURE.actorPrincipalId)).execute({commandName:'CreateDepartmentDraft',...scope,
      departmentCode:`C04-TARGET-${randomUUID().slice(0,8)}`,content:{standardName:'SYNTHETIC C01 SAME NAME',shortName:null,departmentType:'CLINICAL',
        subjectMappingApplicability:'REQUIRED_CLINICAL_SERVICE',lifecycleStatus:'ACTIVE',businessValidFrom:departmentDtoLocalDateTime(Jan),businessValidTo:null,campusIds:[PROTOTYPE_FIXTURE.campusId]}});
    const submit=await(await app(PROTOTYPE_FIXTURE.actorPrincipalId)).execute({commandName:'SubmitDepartmentGovernance',...scope,...draft,
      expectedContentHash:draft.contentHash,changeReason:'SYNTHETIC C04 PUBLICATION'});assert.ok(submit.governanceRequestId);
    const ref={...scope,departmentId:draft.departmentId,departmentVersionId:draft.departmentVersionId,governanceRequestId:submit.governanceRequestId,
      seenContentHash:draft.contentHash,decision:'APPROVED' as const,reason:'SYNTHETIC C04 PUBLICATION'};
    await(await app(PROTOTYPE_FIXTURE.reviewerPrincipalId)).execute({commandName:'ReviewDepartment',...ref});
    await(await app(PROTOTYPE_FIXTURE.approverPrincipalId)).execute({commandName:'ApproveDepartment',...ref});
    const {source}=await temporarySource(f),root=randomUUID();
    const actor=await f.principal(['PERSON_MASTER_ASSIGNMENT_READ','PERSON_MASTER_ASSIGNMENT_WRITE','PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE',
      'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ','PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE','PERSON_MASTER_ENGAGEMENT_READ','PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ']);
    async function grant(governanceObjectId:string,effect:'ALLOW'|'DENY'='ALLOW',sequence='1') {
      await database.insertInto('access_control.object_permission_grant').values({governance_object_id:governanceObjectId,security_principal_id:actor,
        permission_code:'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ',grant_effect:effect,grant_sequence:sequence,granted_by:f.actor,
        reason:'SYNTHETIC C04 INDEPENDENT DEPARTMENT READ',valid_from:Jan,valid_to:null,scope_level:'HOSPITAL',campus_id:null}).execute();
    }
    const command=f.temporaryCommand(source,{targetPlacement:{scope:'DEPARTMENT',departmentGovernanceObjectId:object.governance_object_id,departmentId:draft.departmentId}});
    await assert.rejects(f.temporary(root,actor).createSourceLinkedTemporaryAssignment(command),{message:'OBJECT_PERMISSION_FORBIDDEN'});
    await grant(object.governance_object_id);
    await assert.rejects(f.temporary(root,actor).createSourceLinkedTemporaryAssignment(command),{message:'OBJECT_PERMISSION_FORBIDDEN'});
    assert.equal((await temporaryRequestCounts(database,root)).outcomes,0);
    await grant(departmentScope.governanceObjectId);
    const result=await f.temporary(root,actor).createSourceLinkedTemporaryAssignment(command);
    assert.notEqual(result.sourceLink.sourcePlacement.departmentGovernanceObjectId,result.sourceLink.targetPlacement.departmentGovernanceObjectId);
    const primary=await f.semantics().resolvePrimaryAffiliation({...f.scope,engagementId:result.sourceLink.engagementId,purposeCode:'ORGANIZATIONAL_AFFILIATION',
      scopeCode:'HOSPITAL_DEPARTMENT_PLACEMENTS',businessAt:Jul,recordAsOf:result.sourceLink.recordedFrom});
    assert.equal(primary.selectedAssignmentVersionId,source.assignmentVersionId);
    await assert.rejects(f.temporary(undefined,actor).createSourceLinkedTemporaryAssignment(f.temporaryCommand(source)),{message:'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT'});
    await grant(departmentScope.governanceObjectId,'DENY','2');
    await assert.rejects(f.temporary(root,actor).createSourceLinkedTemporaryAssignment(command),{message:'OBJECT_PERMISSION_FORBIDDEN'});
    return {sourceScope:departmentScope.governanceObjectId,targetScope:object.governance_object_id,actor,result,primary,
      targetOnlyRejected:true,bothGrantsRequired:true,sourceReadRevocationDefeatedReplay:true};
  });
  await check(['SC-03','DW-02'],'An actual GROUP identity is rejected as a Department target',async()=>{
    const group=await database.selectFrom('department_master.department_hierarchy_group').select('department_hierarchy_group_id').limit(1).executeTakeFirstOrThrow();
    const {source}=await temporarySource(f),command=f.temporaryCommand(source),root=randomUUID();
    await assert.rejects(f.temporary(root).createSourceLinkedTemporaryAssignment({...command,targetPlacement:{...command.targetPlacement,
      departmentId:group.department_hierarchy_group_id}}),{message:'ASSIGNMENT_PLACEMENT_NOT_FOUND'});
    assert.equal((await temporaryRequestCounts(database,root)).links,0);
    return {groupId:group.department_hierarchy_group_id,root,source:source.assignmentId};
  });
}
