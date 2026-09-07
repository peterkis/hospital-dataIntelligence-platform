import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { RequestContext } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createAssignmentApplication, createAssignmentEngagementPeriodReader,
  createAssignmentDepartmentReferenceReader } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementLifecycleApplication } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { createDepartmentGovernanceApplication, createDepartmentQueryService, departmentDtoLocalDateTime,
  type DepartmentBusinessStatus, type DepartmentVersionContent } from '../../apps/governance-api/src/modules/department-master/index.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { createCampusReferenceReader } from '../../apps/governance-api/src/platform/campus/campus-reference-reader.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import { PERSON_FIXTURE, personCreation, personContext } from './person-subject-fixture.js';
import { engagementContext } from './person-engagement-fixture.js';
import { engagementLifecycleContext } from './person-engagement-lifecycle-fixture.js';

export const assignmentScope = { governanceObjectId: PERSON_FIXTURE.objectId };
export const departmentScope = { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId };
export const Jan = '2026-01-01T00:00:00', Jun = '2026-06-01T00:00:00', Jul = '2026-07-01T00:00:00';
export const Aug = '2026-08-01T00:00:00', Dec = '2026-12-01T00:00:00';

/** Only creates this run's synthetic principals and upstream cohort. */
export async function createAssignmentFixture(database: Kysely<DB>, runId: string, existingActor?: string) {
  const now = async () => (await sql<{ value: string }>`select platform.local_now() as value`.execute(database)).rows[0]!.value;
  const actor = existingActor ?? (await sql<{ id: string }>`select uuidv7() as id`.execute(database)).rows[0]!.id;
  const context = (actorPrincipalId = actor, requestId: string = randomUUID()): RequestContext =>
    ({ actorPrincipalId, requestId, correlationId: requestId, occurredAt: '2026-09-06T12:00:00' });
  if (!existingActor) {
    await database.transaction().execute(async tx => {
      await tx.insertInto('platform.security_principal').values({ security_principal_id: actor,
        principal_code: `SYNTHETIC-C01-${runId}`, principal_kind: 'PERSON', status: 'ACTIVE' }).execute();
      for (const permission of ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE',
        'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ']) {
        await tx.insertInto('access_control.object_permission_grant').values({
          governance_object_id: permission.startsWith('DEPARTMENT') ? departmentScope.governanceObjectId : assignmentScope.governanceObjectId,
          security_principal_id: actor, permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1',
          granted_by: PERSON_FIXTURE.ownerId, reason: 'SYNTHETIC NON_PRODUCTION C01 TEST POLICY ONLY',
          valid_from: Jan, valid_to: null, scope_level: 'HOSPITAL', campus_id: null,
        }).execute();
      }
    });
  }
  const runner = createTransactionRunner(database, (tx, ctx) => createScopedModules(tx, ctx, database));
  const workflow = createWorkflowApplication(runner);
  const queryService = createDepartmentQueryService(database, createCampusReferenceReader(database));
  const deptApp = async (principal: string) => createDepartmentGovernanceApplication({
    context: { ...context(principal), occurredAt: (await now()).slice(0, 19) }, transactionRunner: runner, workflowApplication: workflow, queryService });
  async function createDepartment(label: string, publish = true, end: string | null = null) {
    const app = await deptApp(PROTOTYPE_FIXTURE.actorPrincipalId);
    const draft = await app.execute({ commandName: 'CreateDepartmentDraft', ...departmentScope,
      departmentCode: `C01-${runId.slice(0, 8)}-${label}`, content: {
        standardName: 'SYNTHETIC C01 SAME NAME', shortName: null, departmentType: 'CLINICAL',
        subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE', lifecycleStatus: 'ACTIVE',
        businessValidFrom: departmentDtoLocalDateTime(Jan), businessValidTo: end === null ? null : departmentDtoLocalDateTime(end),
        campusIds: [PROTOTYPE_FIXTURE.campusId],
      } });
    if (publish) await publishDepartment(draft);
    return draft;
  }
  async function publishDepartment(draft: { departmentId: string; departmentVersionId: string; contentHash: string }) {
    const submitted = await (await deptApp(PROTOTYPE_FIXTURE.actorPrincipalId)).execute({
      commandName: 'SubmitDepartmentGovernance', ...departmentScope, ...draft,
      expectedContentHash: draft.contentHash, changeReason: 'SYNTHETIC C01 TEST PUBLICATION' });
    assert.ok(submitted.governanceRequestId);
    const reference = { ...departmentScope, departmentId: draft.departmentId, departmentVersionId: draft.departmentVersionId,
      governanceRequestId: submitted.governanceRequestId, seenContentHash: draft.contentHash,
      decision: 'APPROVED' as const, reason: 'SYNTHETIC C01 TEST PUBLICATION' };
    await (await deptApp(PROTOTYPE_FIXTURE.reviewerPrincipalId)).execute({ commandName: 'ReviewDepartment', ...reference });
    return (await deptApp(PROTOTYPE_FIXTURE.approverPrincipalId)).execute({ commandName: 'ApproveDepartment', ...reference });
  }
  async function reviseDepartment(departmentId: string, status: DepartmentBusinessStatus = 'ACTIVE',
    name = 'SYNTHETIC C01 RENAMED', end: string | null = null, publish = true) {
    const content: DepartmentVersionContent = { standardName: name, shortName: null, departmentType: 'CLINICAL',
      clinicalFlag: true, managementFlag: false, subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
      businessStatus: status, description: null, businessValidFrom: Jan, businessValidTo: end };
    // Existing Department DTO contract is seconds-only. Cross the next real second
    // before drafting a revision, so its record interval starts after prior acceptance.
    const initial = (await now()).slice(0, 19);
    let occurredAt = initial;
    for (let attempts = 0; occurredAt <= initial && attempts < 150; attempts++) {
      await delay(10); occurredAt = (await now()).slice(0, 19);
    }
    assert.ok(occurredAt > initial, 'DEPARTMENT_FIXTURE_CLOCK_DID_NOT_ADVANCE');
    const version = await runner.run({ ...context(PROTOTYPE_FIXTURE.actorPrincipalId), occurredAt }, modules =>
      modules.departmentMaster.createDepartmentVersion({ ...departmentScope, departmentId, ...content,
        recordedFrom: occurredAt, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId }));
    const draft = { departmentId, departmentVersionId: version.id, contentHash: version.contentHash.toString('hex') };
    if (publish) await publishDepartment(draft);
    return draft;
  }
  async function createEngagement(from = Jan, to: string | null = null, personId?: string) {
    const id = personId ?? (await createPersonApplication(database, personContext()).createPersonSubject({ ...personCreation,
      facts: { canonicalName: 'SYNTHETIC C01 PERSON', birthDate: null } })).personId;
    return createEngagementApplication(database, engagementContext()).createEngagement({ ...assignmentScope, personId: id,
      relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS', engagementTypeCode: 'CONTRACT_EMPLOYEE', businessValidFrom: from, businessValidTo: to });
  }
  return { actor, now, context, createDepartment, publishDepartment, reviseDepartment, createEngagement,
    app: (requestId: string = randomUUID(), principal = actor) => createAssignmentApplication(database, context(principal, requestId)),
    periodReader: (requestId: string = randomUUID()) => createAssignmentEngagementPeriodReader(database, context(actor, requestId)),
    departmentReader: () => createAssignmentDepartmentReferenceReader(database, context()),
    core: () => createEngagementApplication(database, engagementContext()),
    lifecycle: () => createEngagementLifecycleApplication(database, engagementLifecycleContext(randomUUID())),
  };
}
