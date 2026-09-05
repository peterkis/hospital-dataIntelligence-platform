import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { PERSON_FIXTURE, personContext, seedPersonScope } from './person-subject-fixture.js';

export const ENGAGEMENT_FIXTURE = {
  ...PERSON_FIXTURE,
  engagementOwnerId: '76040000-0000-7000-8000-000000000001',
} as const;

export const engagementContext = (
  requestId: string = randomUUID(), actorId: string = ENGAGEMENT_FIXTURE.engagementOwnerId,
) => personContext(requestId, actorId);

export async function seedEngagementScope(database: Kysely<DB>): Promise<readonly string[]> {
  await seedPersonScope(database);
  await database.transaction().execute(async (tx) => {
    await tx.insertInto('platform.security_principal').values({
      security_principal_id: ENGAGEMENT_FIXTURE.engagementOwnerId,
      principal_code: 'SYNTHETIC-NON-PRODUCTION-ENGAGEMENT-OWNER',
      principal_kind: 'PERSON', status: 'ACTIVE',
    }).onConflict((conflict) => conflict.column('security_principal_id').doNothing()).execute();
    for (const permission of ['PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_WRITE'] as const) {
      const grant = await tx.selectFrom('access_control.object_permission_grant').select('object_permission_grant_id')
        .where('governance_object_id', '=', PERSON_FIXTURE.objectId)
        .where('security_principal_id', '=', ENGAGEMENT_FIXTURE.engagementOwnerId)
        .where('permission_code', '=', permission).executeTakeFirst();
      if (!grant) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: PERSON_FIXTURE.objectId,
        security_principal_id: ENGAGEMENT_FIXTURE.engagementOwnerId,
        permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1',
        granted_by: PERSON_FIXTURE.ownerId,
        reason: 'SYNTHETIC NON_PRODUCTION PV-006-B-01 capability',
        valid_from: '2026-01-01T00:00:00', valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    }
  });
  const people = await database.selectFrom('person_master.person_subject').select('person_id')
    .where('governance_object_id', '=', PERSON_FIXTURE.objectId).orderBy('person_id').limit(6).execute();
  assert.equal(people.length, 6, 'SIX_EXISTING_SYNTHETIC_PERSONS_REQUIRED');
  return people.map((row) => row.person_id);
}

export function engagementCreation(personId: string, index: number) {
  return { governanceObjectId: PERSON_FIXTURE.objectId, personId,
    relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS' as const,
    businessValidFrom: `2026-${String((index % 9) + 1).padStart(2, '0')}-01T00:00:00`,
    businessValidTo: '2026-12-31T00:00:00' };
}
