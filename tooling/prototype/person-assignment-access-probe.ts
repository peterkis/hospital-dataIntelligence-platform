import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { AssignmentVersion, CreateAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { createEngagementLifecycleApplication } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { assignmentScope, departmentScope, Jan, Aug, type createAssignmentFixture } from './person-assignment-fixture.js';

type Fixture = Awaited<ReturnType<typeof createAssignmentFixture>>;
type Check = (ids: string[], name: string, work: () => Promise<unknown>) => Promise<void>;
export async function runAssignmentAccessProbe(database: Kysely<DB>, f: Fixture,
  command: (engagementId: string, from?: string, to?: string | null, departmentId?: string) => CreateAssignment,
  keep: (v: AssignmentVersion) => AssignmentVersion,
  check: Check) {
  const e = await f.createEngagement(), c = command(e.engagementId), accepted = keep(await f.app().createAssignment(c));
  const permissions = ['PERSON_MASTER_ASSIGNMENT_WRITE', 'PERSON_MASTER_ENGAGEMENT_READ',
    'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'];
  async function principal(grants: readonly string[], kind = 'PERSON', status = 'ACTIVE') {
    const id = (await sql<{ id: string }>`select uuidv7() as id`.execute(database)).rows[0]!.id;
    await database.transaction().execute(async tx => {
      await tx.insertInto('platform.security_principal').values({ security_principal_id: id,
        principal_code: `SYNTHETIC-C01-ACCESS-${id}`, principal_kind: kind, status }).execute();
      for (const permission of grants) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: permission.startsWith('DEPARTMENT') ? departmentScope.governanceObjectId : assignmentScope.governanceObjectId,
        security_principal_id: id, permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1',
        granted_by: f.actor, reason: 'SYNTHETIC NON_PRODUCTION C01 ACCESS MATRIX', valid_from: Jan, valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    });
    return id;
  }
  await check(['SC-05', 'TX-04'], 'all four independent grants, active human actor, and historical read separation', async () => {
    const requestIds: string[] = [];
    for (const missing of permissions) {
      const actor = await principal(permissions.filter(p => p !== missing)), request = randomUUID(); requestIds.push(request);
      await assert.rejects(f.app(request, actor).createAssignment(c), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    }
    const unrelated = await principal(['PERSON_MASTER_CORE_WRITE', 'PERSON_MASTER_IDENTIFIER_WRITE',
      'PERSON_MASTER_SOURCE_MAPPING_WRITE', 'PERSON_MASTER_ENGAGEMENT_WRITE']);
    await assert.rejects(f.app(randomUUID(), unrelated).createAssignment(c), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    const reference = { ...assignmentScope, assignmentId: accepted.assignmentId, assignmentVersionId: accepted.assignmentVersionId };
    const historyOnly = await principal(['PERSON_MASTER_ASSIGNMENT_READ']);
    assert.deepEqual(await f.app(randomUUID(), historyOnly).getAssignmentVersion(reference), accepted);
    await assert.rejects(f.app(randomUUID(), historyOnly).assessAssignmentDependencies({ ...reference, recordAsOf: await f.now() }),
      { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    for (const [kind, status] of [['SERVICE', 'ACTIVE'], ['PERSON', 'DISABLED']] as const) {
      const actor = await principal(permissions, kind, status);
      await assert.rejects(f.app(randomUUID(), actor).createAssignment(c), { message: 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED' });
    }
    await assert.rejects(createEngagementLifecycleApplication(database, f.context()).endEngagement({ ...assignmentScope,
      engagementId: e.engagementId, expectedCurrentEngagementVersionId: e.engagementVersionId,
      businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_NO_UPSTREAM_WRITE' }), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    const denials = await database.selectFrom('audit.audit_event').select(['request_id', 'action'])
      .where('request_id', 'in', requestIds).execute();
    assert.equal(denials.filter(r => r.action === 'PERSON_ASSIGNMENT_ACCESS_DENIED').length, permissions.length);
    assert.equal((await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', 'in', requestIds).execute()).length, 0);
    return { missingGrantRefusals: permissions, historyReadAllowed: true, assessmentReadDenied: true, deniedAuditCount: denials.length };
  });
  await check(['ID-03', 'ID-04', 'ID-07', 'DP-05', 'DP-08', 'SC-06', 'SC-07'], 'closed runtime inputs reject identity substitutes and canaries without logging them', async () => {
    const canary = `SYNTHETIC_SECRET_NAME_SOURCE_CONTRACT_${randomUUID()}`, requestIds: string[] = [];
    for (const key of ['personId', 'recordAsOf', 'snapshot', 'approval', 'validated', 'hash', 'primary', 'mode', 'assignmentPurpose', 'force']) {
      const request = randomUUID(); requestIds.push(request);
      await assert.rejects(f.app(request).createAssignment({ ...c, [key]: canary }), { message: 'PERSON_INPUT_INVALID' });
    }
    for (const scope of ['GROUP', 'HOSPITAL', 'CAMPUS']) {
      const input = JSON.parse(JSON.stringify({ ...c, placement: { ...c.placement, scope } }));
      await assert.rejects(f.app().createAssignment(input), { message: 'ASSIGNMENT_INPUT_INVALID' });
    }
    for (const field of ['nodeId', 'departmentName', 'departmentCode', 'campusId', 'serviceLocation']) {
      await assert.rejects(f.app().createAssignment({ ...c, placement: { ...c.placement, [field]: canary } }), { message: 'PERSON_INPUT_INVALID' });
    }
    await assert.rejects(f.app().createAssignment({ ...c, placement: { ...c.placement, departmentId: canary } }), { message: 'PERSON_ID_INVALID' });
    const group = await database.selectFrom('department_master.department_hierarchy_group').select('department_hierarchy_group_id').limit(1).executeTakeFirstOrThrow();
    await assert.rejects(f.app().createAssignment({ ...c, placement: { ...c.placement,
      departmentId: group.department_hierarchy_group_id } }), { message: 'ASSIGNMENT_PLACEMENT_NOT_FOUND' });
    await assert.rejects(f.app().createAssignment({ ...c, placement: { ...c.placement,
      departmentGovernanceObjectId: assignmentScope.governanceObjectId } }), { message: 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID' });
    for (const key of ['engagementId', 'personId', 'departmentId', 'placement']) {
      await assert.rejects(f.app().reviseAssignment({ ...assignmentScope, assignmentId: accepted.assignmentId,
        expectedCurrentVersionId: accepted.assignmentVersionId, businessValidFrom: Jan, businessValidTo: Aug,
        reasonCode: 'VALIDITY_CORRECTION', [key]: canary }), { message: key === 'placement' ? 'ASSIGNMENT_INPUT_INVALID' : 'PERSON_INPUT_INVALID' });
    }
    const audits = await database.selectFrom('audit.audit_event').select('event_payload').where('request_id', 'in', requestIds).execute();
    assert.equal(JSON.stringify(audits).includes(canary), false);
    assert.equal(JSON.stringify(accepted).includes('SYNTHETIC C01 SAME NAME'), false);
    assert.equal(JSON.stringify(accepted).includes('SYNTHETIC C01 PERSON'), false);
    assert.equal((await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', 'in', requestIds).execute()).length, 0);
    return { canaryAbsent: true, closedMutationRefusals: requestIds.length, nameCopiedToEvidence: false };
  });
  await check(['ID-07', 'TX-02'], 'CREATE and REVISE cannot be selected by supplying the other command shape', async () => {
    const revision = { ...assignmentScope, assignmentId: accepted.assignmentId,
      expectedCurrentVersionId: accepted.assignmentVersionId, businessValidFrom: Jan, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' };
    await assert.rejects(f.app().createAssignment(JSON.parse(JSON.stringify(revision))), { message: 'ASSIGNMENT_INPUT_INVALID' });
    await assert.rejects(f.app().reviseAssignment(JSON.parse(JSON.stringify(c))), { message: 'ASSIGNMENT_INPUT_INVALID' });
    return { crossCommandShapesRejected: 2 };
  });
}
