import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { createAssignmentClosureApplication } from '../../apps/governance-api/src/composition/create-assignment-closure-application.js';
import { createAssignmentSemanticsApplication } from '../../apps/governance-api/src/composition/create-assignment-semantics-application.js';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementLifecycleApplication } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { createAssignmentFixture, assignmentScope, departmentScope, Jan } from './person-assignment-fixture.js';
import type { CreateAssignment, CreateClassifiedAssignment, AssignmentVersion, EndAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';

export type ClosureCheck = (ids: string[], name: string, work: () => Promise<unknown>) => Promise<void>;
export type ClosureFixture = Awaited<ReturnType<typeof createAssignmentClosureFixture>>;

/** Cohort-owned actors and upstream relations under the existing single Person authority. */
export async function createAssignmentClosureFixture(database: Kysely<DB>, runId: string) {
  const base = await createAssignmentFixture(database, runId);
  const scope = assignmentScope;
  const fullGrants = ['PERSON_MASTER_CORE_READ', 'PERSON_MASTER_CORE_WRITE', 'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_WRITE',
    'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_READ', 'PERSON_MASTER_ENGAGEMENT_CLASSIFICATION_WRITE',
    'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_READ', 'PERSON_MASTER_ENGAGEMENT_OVERLAP_RULE_WRITE',
    'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE',
    'PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE', 'PERSON_MASTER_ASSIGNMENT_END',
    'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
    'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_WRITE'];
  async function grant(actor: string, permissions: readonly string[], effect: 'ALLOW' | 'DENY' = 'ALLOW', sequence = '1', objectId = scope.governanceObjectId) {
    await database.transaction().execute(async tx => {
      for (const permission of permissions) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: permission.startsWith('DEPARTMENT') ? departmentScope.governanceObjectId : objectId,
        security_principal_id: actor, permission_code: permission, grant_effect: effect, grant_sequence: sequence,
        granted_by: base.actor, reason: 'SYNTHETIC C0301 TEST POLICY ONLY', valid_from: Jan, valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    });
  }
  await grant(base.actor, fullGrants.filter(permission => !['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE',
    'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'].includes(permission)));
  const semantics = (requestId: string = randomUUID(), actor = base.actor) => createAssignmentSemanticsApplication(database, base.context(actor, requestId));
  for (const [dimension, codes] of [['PURPOSE', ['ORGANIZATIONAL_AFFILIATION', 'CLINICAL_PRACTICE', 'TRAINING_LEARNING']],
    ['MODE', ['PRIMARY_AFFILIATION', 'STANDING_CONCURRENT']]] as const)
    for (const code of codes) {
      const known = await semantics().findAssignmentSemanticTermAsOf({ ...scope, dimension, code, recordAsOf: await base.now() });
      if (!known) await semantics().registerAssignmentSemanticTerm({ ...scope, dimension, code,
        label: `SYNTHETIC C0301 ${code}`, definitionState: 'ENABLED', businessValidFrom: Jan, businessValidTo: null });
    }
  const department = await base.createDepartment('C0301-DEFAULT');
  const command = (engagementId: string, changes: Partial<CreateAssignment> = {}): CreateAssignment => ({ ...scope, engagementId,
    relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT', placement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId,
      departmentId: department.departmentId }, businessValidFrom: Jan, businessValidTo: null, ...changes });
  const classifiedCommand = (engagementId: string, changes: Partial<CreateClassifiedAssignment> = {}): CreateClassifiedAssignment => ({
    ...command(engagementId), purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'PRIMARY_AFFILIATION', ...changes });
  const endCommand = (version: AssignmentVersion, endedAt: string, reasonCode: EndAssignment['reasonCode'] = 'PLACEMENT_ENDED'): EndAssignment => ({
    ...scope, assignmentId: version.assignmentId, expectedCurrentVersionId: version.assignmentVersionId, endedAt, reasonCode });
  return { ...base, scope, department, fullGrants, grant, command, classifiedCommand, endCommand, semantics,
    app: (requestId: string = randomUUID(), actor = base.actor) => createAssignmentApplication(database, base.context(actor, requestId)),
    closure: (requestId: string = randomUUID(), actor = base.actor) => createAssignmentClosureApplication(database, base.context(actor, requestId)),
    core: (requestId: string = randomUUID()) => createEngagementApplication(database, base.context(base.actor, requestId)),
    lifecycle: (requestId: string = randomUUID()) => createEngagementLifecycleApplication(database, base.context(base.actor, requestId)),
    async principal(permissions: readonly string[], kind = 'PERSON', status = 'ACTIVE', objectId = scope.governanceObjectId) {
      const actor = (await sql<{ id: string }>`select uuidv7() as id`.execute(database)).rows[0]!.id;
      await database.insertInto('platform.security_principal').values({ security_principal_id: actor,
        principal_code: `SYNTHETIC-C0301-${actor}`, principal_kind: kind, status }).execute();
      if (permissions.length) await grant(actor, permissions, 'ALLOW', '1', objectId);
      return actor;
    },
  };
}
