import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { createDepartmentGovernanceApplication, createDepartmentQueryService, departmentDtoLocalDateTime } from '../../apps/governance-api/src/modules/department-master/index.js';
import { createCampusReferenceReader } from '../../apps/governance-api/src/platform/campus/campus-reference-reader.js';
import { Jan, Aug, departmentScope } from './person-assignment-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import type { TransferFixture, TransferCheck } from './person-assignment-transfer-fixture.js';

export async function runAssignmentTransferScope(database: Kysely<DB>, f: TransferFixture, check: TransferCheck) {
  await check(['PE-08', 'CC-09', 'AU-04'], 'A target in another Department governance namespace requires its own grant; source current Department grant is unnecessary', async () => {
    const object = await database.insertInto('platform.governance_object').values({ object_code: `C0302-DEPARTMENT-${randomUUID()}`,
      object_type: 'DEPARTMENT_MASTER', display_name: 'SYNTHETIC C0302 SAME HOSPITAL DEPARTMENT NAMESPACE',
      created_by: PROTOTYPE_FIXTURE.actorPrincipalId }).returningAll().executeTakeFirstOrThrow();
    const grants = await database.selectFrom('access_control.object_permission_grant').selectAll()
      .where('governance_object_id', '=', departmentScope.governanceObjectId)
      .where('security_principal_id', 'in', [PROTOTYPE_FIXTURE.actorPrincipalId, PROTOTYPE_FIXTURE.reviewerPrincipalId, PROTOTYPE_FIXTURE.approverPrincipalId])
      .where('permission_code', 'like', 'DEPARTMENT_MASTER_%').execute();
    assert.ok(grants.length > 0);
    for (const grant of grants) {
      const { object_permission_grant_id, created_at, ...fields } = grant; void object_permission_grant_id; void created_at;
      await database.insertInto('access_control.object_permission_grant').values({ ...fields, governance_object_id: object.governance_object_id }).execute();
    }
    const runner = createTransactionRunner(database, (tx, ctx) => createScopedModules(tx, ctx, database));
    const workflowApplication = createWorkflowApplication(runner);
    const queryService = createDepartmentQueryService(database, createCampusReferenceReader(database));
    const app = async (actor: string) => createDepartmentGovernanceApplication({ context: { ...f.context(actor), occurredAt: (await f.now()).slice(0, 19) },
      transactionRunner: runner, workflowApplication, queryService });
    const scope = { governanceObjectId: object.governance_object_id };
    const draft = await (await app(PROTOTYPE_FIXTURE.actorPrincipalId)).execute({ commandName: 'CreateDepartmentDraft', ...scope,
      departmentCode: `C0302-TARGET-${randomUUID().slice(0, 8)}`, content: { standardName: 'SYNTHETIC C01 SAME NAME', shortName: null,
        departmentType: 'CLINICAL', subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE', lifecycleStatus: 'ACTIVE',
        businessValidFrom: departmentDtoLocalDateTime(Jan), businessValidTo: null, campusIds: [PROTOTYPE_FIXTURE.campusId] } });
    const submit = await (await app(PROTOTYPE_FIXTURE.actorPrincipalId)).execute({ commandName: 'SubmitDepartmentGovernance', ...scope, ...draft,
      expectedContentHash: draft.contentHash, changeReason: 'SYNTHETIC C0302 TEST PUBLICATION' });
    assert.ok(submit.governanceRequestId);
    const ref = { ...scope, departmentId: draft.departmentId, departmentVersionId: draft.departmentVersionId,
      governanceRequestId: submit.governanceRequestId, seenContentHash: draft.contentHash, decision: 'APPROVED' as const, reason: 'SYNTHETIC C0302 TEST PUBLICATION' };
    await (await app(PROTOTYPE_FIXTURE.reviewerPrincipalId)).execute({ commandName: 'ReviewDepartment', ...ref });
    await (await app(PROTOTYPE_FIXTURE.approverPrincipalId)).execute({ commandName: 'ApproveDepartment', ...ref });
    const e = await f.createEngagement(), source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
    const personPermissions = ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_END', 'PERSON_MASTER_ASSIGNMENT_WRITE',
      'PERSON_MASTER_ASSIGNMENT_TRANSFER', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
      'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'];
    const actor = await f.principal(personPermissions);
    const input = f.transferCommand(source.coreVersion, { targetPlacement: { scope: 'DEPARTMENT', departmentId: draft.departmentId,
      departmentGovernanceObjectId: object.governance_object_id } });
    await assert.rejects(f.transfer(randomUUID(), actor).transferAssignment(input), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    await database.insertInto('access_control.object_permission_grant').values({ governance_object_id: object.governance_object_id,
      security_principal_id: actor, permission_code: 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ', grant_effect: 'ALLOW', grant_sequence: '1',
      granted_by: f.actor, reason: 'SYNTHETIC C0302 TARGET ONLY', valid_from: Jan, valid_to: null, scope_level: 'HOSPITAL', campus_id: null }).execute();
    assert.equal((await database.selectFrom('access_control.object_permission_grant').select('object_permission_grant_id')
      .where('security_principal_id', '=', actor).where('governance_object_id', '=', departmentScope.governanceObjectId).execute()).length, 0);
    const result = await f.transfer(randomUUID(), actor).transferAssignment(input);
    assert.equal(result.targetAdmission.acceptanceEvidence.department.departmentGovernanceObjectId, object.governance_object_id);
    const primary = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: e.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION',
      scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt: Aug, recordAsOf: result.transferRecordedFrom });
    assert.equal(primary.selectedAssignmentVersionId, result.targetAdmissionVersionId); assert.equal(primary.resolution, 'UNIQUE');
    return { sourceDepartmentScope: departmentScope.governanceObjectId, targetDepartmentScope: object.governance_object_id,
      actor, sourceDepartmentGrantCount: 0, transferId: result.transferId, sameHospitalBucket: primary.bucket };
  });
  await check(['PE-09'], 'A real GROUP identity cannot be accepted as a Department placement', async () => {
    const group = await database.selectFrom('department_master.department_hierarchy_group').select('department_hierarchy_group_id').limit(1).executeTakeFirstOrThrow();
    const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
    const command = f.transferCommand(source), root = randomUUID();
    await assert.rejects(f.transfer(root).transferAssignment({ ...command, targetPlacement: { ...command.targetPlacement, departmentId: group.department_hierarchy_group_id } }),
      { message: 'ASSIGNMENT_PLACEMENT_NOT_FOUND' });
    return { groupId: group.department_hierarchy_group_id, source: source.assignmentId, root };
  });
}
