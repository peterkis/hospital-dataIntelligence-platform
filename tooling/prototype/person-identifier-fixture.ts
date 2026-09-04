import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { PERSON_FIXTURE, personContext, seedPersonScope } from './person-subject-fixture.js';

export const IDENTIFIER_FIXTURE = {
  ...PERSON_FIXTURE,
  identifierOwnerId: '76020000-0000-7000-8000-000000000001',
  systems: ['urn:hdi:synthetic:personnel-number', 'urn:hdi:synthetic:legacy-personnel-number'],
} as const;
export const identifierContext = (requestId: string = randomUUID(), actorId: string = IDENTIFIER_FIXTURE.identifierOwnerId) => personContext(requestId, actorId);

export async function seedIdentifierScope(database: Kysely<DB>): Promise<readonly string[]> {
  await seedPersonScope(database);
  await database.transaction().execute(async (tx) => {
    await tx.insertInto('platform.security_principal').values({ security_principal_id: IDENTIFIER_FIXTURE.identifierOwnerId,
      principal_code: 'SYNTHETIC-NON-PRODUCTION-IDENTIFIER-OWNER', principal_kind: 'PERSON', status: 'ACTIVE',
    }).onConflict((c) => c.column('security_principal_id').doNothing()).execute();
    for (const permission of ['PERSON_MASTER_IDENTIFIER_READ', 'PERSON_MASTER_IDENTIFIER_WRITE']) {
      const grant = await tx.selectFrom('access_control.object_permission_grant').select('object_permission_grant_id')
        .where('governance_object_id', '=', PERSON_FIXTURE.objectId).where('security_principal_id', '=', IDENTIFIER_FIXTURE.identifierOwnerId)
        .where('permission_code', '=', permission).executeTakeFirst();
      if (!grant) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: PERSON_FIXTURE.objectId, security_principal_id: IDENTIFIER_FIXTURE.identifierOwnerId,
        permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1', granted_by: PERSON_FIXTURE.ownerId,
        reason: 'SYNTHETIC NON_PRODUCTION A-02A capability', valid_from: '2026-01-01T00:00:00', valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    }
  });
  // Reuse the persisted A-01 synthetic cohort. Registry does not create Persons.
  const persons = await database.selectFrom('person_master.person_subject').select('person_id')
    .where('governance_object_id', '=', PERSON_FIXTURE.objectId).orderBy('person_id').limit(6).execute();
  assert.equal(persons.length, 6, 'SIX_EXISTING_A01_SYNTHETIC_PERSONS_REQUIRED');
  return persons.map((row) => row.person_id);
}

export function identifierCreation(personId: string, runId: string, index: number, system: string = IDENTIFIER_FIXTURE.systems[0]) {
  return { governanceObjectId: PERSON_FIXTURE.objectId, personId,
    identifierSystem: system, identifierValue: `SYN-PN-${runId}-${index.toString().padStart(6, '0')}`,
    identifierEligibility: 'CONFIRMED_PERSON_IDENTIFIER' as const,
    businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null,
  };
}
