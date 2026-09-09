import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { createDepartmentGovernanceApplication, createDepartmentQueryService, departmentDtoLocalDateTime } from '../../apps/governance-api/src/modules/department-master/index.js';
import { createCampusReferenceReader } from '../../apps/governance-api/src/platform/campus/campus-reference-reader.js';
import { createAssignmentEffectivePeriodApplication } from '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import type { ClosureFixture } from './person-assignment-closure-fixture.js';
import type { EffectiveCheck } from './person-assignment-effective-application-probe.js';

export async function runEffectiveScopes(database: Kysely<DB>, f: ClosureFixture, check: EffectiveCheck) {
  await check(['AU-02','AU-04'], 'Independent source and target Department permissions, including uncovered windows and ordinary source-free reads', async () => {
    const object=await database.insertInto('platform.governance_object').values({object_code:`C05-DEPARTMENT-${randomUUID()}`,
      object_type:'DEPARTMENT_MASTER',display_name:'SYNTHETIC C05 SAME HOSPITAL DEPARTMENT NAMESPACE',created_by:PROTOTYPE_FIXTURE.actorPrincipalId}).returningAll().executeTakeFirstOrThrow();
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
      departmentCode:`C05-TARGET-${randomUUID().slice(0,8)}`,content:{standardName:'SYNTHETIC C01 SAME NAME',shortName:null,departmentType:'CLINICAL',
        subjectMappingApplicability:'REQUIRED_CLINICAL_SERVICE',lifecycleStatus:'ACTIVE',businessValidFrom:departmentDtoLocalDateTime(Jan),businessValidTo:null,campusIds:[PROTOTYPE_FIXTURE.campusId]}});
    const submit=await(await app(PROTOTYPE_FIXTURE.actorPrincipalId)).execute({commandName:'SubmitDepartmentGovernance',...scope,...draft,
      expectedContentHash:draft.contentHash,changeReason:'SYNTHETIC C05 PUBLICATION'});assert.ok(submit.governanceRequestId);
    const ref={...scope,departmentId:draft.departmentId,departmentVersionId:draft.departmentVersionId,governanceRequestId:submit.governanceRequestId,
      seenContentHash:draft.contentHash,decision:'APPROVED' as const,reason:'SYNTHETIC C05 PUBLICATION'};
    await(await app(PROTOTYPE_FIXTURE.reviewerPrincipalId)).execute({commandName:'ReviewDepartment',...ref});
    await(await app(PROTOTYPE_FIXTURE.approverPrincipalId)).execute({commandName:'ApproveDepartment',...ref});
    async function grant(actor: string, objectId: string, effect: 'ALLOW' | 'DENY' = 'ALLOW', sequence = '1') {
      await database.insertInto('access_control.object_permission_grant').values({ governance_object_id: objectId, security_principal_id: actor,
        permission_code: 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ', grant_effect: effect, grant_sequence: sequence,
        granted_by: f.actor, reason: 'SYNTHETIC C05 DEPARTMENT READ', valid_from: Jan, valid_to: null, scope_level: 'HOSPITAL', campus_id: null }).execute();
    }
    await grant(f.actor, scope.governanceObjectId);
    const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId,
      { businessValidTo: Dec }))).coreVersion;
    const placement = { scope: 'DEPARTMENT' as const, departmentGovernanceObjectId: scope.governanceObjectId, departmentId: draft.departmentId };
    const child = await createTemporaryAssignmentApplication(database, f.context()).createSourceLinkedTemporaryAssignment({ ...f.scope,
      sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId, targetPlacement: placement,
      businessValidFrom: Jun, businessValidTo: Aug, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' });
    const actor = await f.principal(['PERSON_MASTER_ASSIGNMENT_READ','PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ',
      'PERSON_MASTER_ENGAGEMENT_READ','PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ']);
    await grant(actor, scope.governanceObjectId);
    const read = (assignmentId: string, requestedFrom = Jun, requestedTo = Jul) => createAssignmentEffectivePeriodApplication(database,
      f.context(actor)).getAssignmentEffectivePeriodAsOf({ ...f.scope, assignmentId, requestedFrom, requestedTo, recordAsOf: '2099-01-01T00:00:00' });
    await assert.rejects(read(child.targetAssignmentId), /OBJECT_PERMISSION_FORBIDDEN/u);
    await assert.rejects(read(child.targetAssignmentId, Aug, Dec), /OBJECT_PERMISSION_FORBIDDEN/u);
    await grant(actor, departmentScope.governanceObjectId);
    assert.equal((await read(child.targetAssignmentId)).structuralDependencies.result, 'SATISFIED');
    await grant(actor, departmentScope.governanceObjectId, 'DENY', '2');
    await assert.rejects(read(child.targetAssignmentId), /OBJECT_PERMISSION_FORBIDDEN/u);
    const ordinary = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId, { placement }));
    assert.equal((await read(ordinary.assignmentId)).structuralDependencies.result, 'SATISFIED');
    return { sourceScope: departmentScope.governanceObjectId, targetScope: scope.governanceObjectId, actor,
      target: child.targetAssignmentId, ordinary: ordinary.assignmentId };
  });
}
