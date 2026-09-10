import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { PERSON_FIXTURE, personContext, seedPersonScope } from './person-subject-fixture.js';

export const SOURCE_MAPPING_FIXTURE = {
  ...PERSON_FIXTURE,
  sourceMappingOwnerId: '76030000-0000-7000-8000-000000000001',
  sourceSystems: ['SYNTHETIC_HR', 'SYNTHETIC_HIS'],
  sourceEntities: ['PERSON_RECORD', 'STAFF_RECORD', 'USER_RECORD'],
} as const;

export const sourceMappingContext = (
  requestId: string = randomUUID(), actorId: string = SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId,
) => personContext(requestId, actorId);

export async function seedSourceMappingScope(database: Kysely<DB>): Promise<readonly string[]> {
  await seedPersonScope(database);
  await database.transaction().execute(async (tx) => {
    await tx.insertInto('platform.security_principal').values({
      security_principal_id: SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId,
      principal_code: 'SYNTHETIC-NON-PRODUCTION-SOURCE-MAPPING-OWNER',
      principal_kind: 'PERSON', status: 'ACTIVE',
    }).onConflict((conflict) => conflict.column('security_principal_id').doNothing()).execute();
    for (const permission of ['PERSON_MASTER_SOURCE_MAPPING_READ', 'PERSON_MASTER_SOURCE_MAPPING_WRITE',
      'PERSON_MASTER_SOURCE_MAPPING_CORRECT'] as const) {
      const grant = await tx.selectFrom('access_control.object_permission_grant').select('object_permission_grant_id')
        .where('governance_object_id', '=', PERSON_FIXTURE.objectId)
        .where('security_principal_id', '=', SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId)
        .where('permission_code', '=', permission).executeTakeFirst();
      if (!grant) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: PERSON_FIXTURE.objectId,
        security_principal_id: SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId,
        permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1',
        granted_by: PERSON_FIXTURE.ownerId,
        reason: 'SYNTHETIC NON_PRODUCTION A-02B capability',
        valid_from: '2026-01-01T00:00:00', valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    }
  });
  const people = await database.selectFrom('person_master.person_subject').select('person_id')
    .where('governance_object_id', '=', PERSON_FIXTURE.objectId).orderBy('person_id').limit(6).execute();
  assert.equal(people.length, 6, 'SIX_EXISTING_A01_SYNTHETIC_PERSONS_REQUIRED');
  return people.map((row) => row.person_id);
}

export function sourceMappingCreation(personId: string, runId: string, index: number,
  sourceSystem: string = SOURCE_MAPPING_FIXTURE.sourceSystems[0],
  sourceEntity: string = SOURCE_MAPPING_FIXTURE.sourceEntities[0]) {
  return { governanceObjectId: PERSON_FIXTURE.objectId, sourceSystem, sourceEntity,
    sourceRecordKey: `SYN-${runId}-${index.toString().padStart(6, '0')}`, personId,
    businessValidFrom: '2025-01-01T00:00:00', businessValidTo: null };
}
