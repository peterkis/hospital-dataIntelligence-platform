import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { RequestContext } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

export const PERSON_FIXTURE = {
  classification: 'SYNTHETIC / NON_PRODUCTION', timeZone: 'Asia/Shanghai',
  objectId: '76000000-0000-7000-8000-000000000001',
  ownerId: PROTOTYPE_FIXTURE.approverPrincipalId,
  inactiveActorId: '76010000-0000-7000-8000-000000000001',
} as const;

export function personContext(requestId: string = randomUUID(), actorPrincipalId: string = PERSON_FIXTURE.ownerId): RequestContext {
  return { actorPrincipalId, requestId, correlationId: requestId, occurredAt: '2026-09-04T12:00:00' };
}

export async function seedPersonScope(database: Kysely<DB>): Promise<void> {
  await database.transaction().execute(async (tx) => {
    await tx.insertInto('platform.security_principal').values({ security_principal_id: PERSON_FIXTURE.inactiveActorId,
      principal_code: 'SYNTHETIC-NON-PRODUCTION-PERSON-INACTIVE-ACTOR', principal_kind: 'PERSON', status: 'DISABLED',
    }).onConflict((c) => c.column('security_principal_id').doNothing()).execute();
    await tx.insertInto('platform.governance_object').values({
      governance_object_id: PERSON_FIXTURE.objectId, object_code: 'PROTOTYPE-SYNTHETIC-PERSON-MASTER',
      object_type: 'PERSON_MASTER', display_name: 'SYNTHETIC NON_PRODUCTION PERSON MASTER', created_by: PERSON_FIXTURE.ownerId,
    }).onConflict((c) => c.column('governance_object_id').doNothing()).execute();
    const scope = await tx.selectFrom('platform.governance_object').selectAll().where('governance_object_id', '=', PERSON_FIXTURE.objectId).executeTakeFirstOrThrow();
    assert.equal(scope.object_type, 'PERSON_MASTER');
    assert.equal(scope.object_code, 'PROTOTYPE-SYNTHETIC-PERSON-MASTER');
    for (const permission of ['PERSON_MASTER_CORE_READ', 'PERSON_MASTER_CORE_WRITE']) {
      const exists = await tx.selectFrom('access_control.object_permission_grant').select('object_permission_grant_id')
        .where('governance_object_id', '=', PERSON_FIXTURE.objectId).where('security_principal_id', '=', PERSON_FIXTURE.ownerId)
        .where('permission_code', '=', permission).executeTakeFirst();
      if (!exists) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: PERSON_FIXTURE.objectId, security_principal_id: PERSON_FIXTURE.ownerId,
        permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1', granted_by: PERSON_FIXTURE.ownerId,
        reason: 'SYNTHETIC NON_PRODUCTION A-01 scope', valid_from: '2026-01-01T00:00:00', valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    }
  });
}

export const personCreation = {
  governanceObjectId: PERSON_FIXTURE.objectId,
  subjectEligibility: 'CONFIRMED_HOSPITAL_PERSONNEL' as const,
  facts: { canonicalName: 'SYNTHETIC 合成人员', birthDate: '1980-01-01' },
  businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null,
};
