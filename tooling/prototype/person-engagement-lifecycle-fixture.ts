import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { personContext } from './person-subject-fixture.js';
import { ENGAGEMENT_POLICY_FIXTURE, seedSyntheticEngagementPolicy } from './person-engagement-policy-fixture.js';

export const ENGAGEMENT_LIFECYCLE_FIXTURE = {
  ...ENGAGEMENT_POLICY_FIXTURE,
  lifecycleOwnerId: '76040000-0000-7000-8000-000000000003',
  lifecycleServiceId: '76040000-0000-7000-8000-000000000004',
  lifecycleCompositeOwnerId: '76040000-0000-7000-8000-000000000005',
  classification: 'SYNTHETIC / NON_PRODUCTION',
} as const;

export const engagementLifecycleContext = (
  requestId: string,
  actorId: string = ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
) => personContext(requestId, actorId);

export async function seedEngagementLifecycleScope(database: Kysely<DB>): Promise<void> {
  await seedSyntheticEngagementPolicy(database);
  await database.transaction().execute(async (tx) => {
    for (const principal of [
      { security_principal_id: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
        principal_code: 'SYNTHETIC-NON-PRODUCTION-ENGAGEMENT-LIFECYCLE-OWNER',
        principal_kind: 'PERSON' as const, status: 'ACTIVE' as const },
      { security_principal_id: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleServiceId,
        principal_code: 'SYNTHETIC-NON-PRODUCTION-ENGAGEMENT-LIFECYCLE-SERVICE',
        principal_kind: 'SERVICE' as const, status: 'ACTIVE' as const },
      { security_principal_id: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId,
        principal_code: 'SYNTHETIC-NON-PRODUCTION-ENGAGEMENT-LIFECYCLE-COMPOSITE-OWNER',
        principal_kind: 'PERSON' as const, status: 'ACTIVE' as const },
    ]) {
      await tx.insertInto('platform.security_principal').values(principal)
        .onConflict((conflict) => conflict.column('security_principal_id').doNothing()).execute();
    }
    for (const securityPrincipalId of [
      ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
      ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleServiceId,
      ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId,
    ]) {
      for (const permissionCode of [
        'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ',
        'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE',
      ] as const) {
        const prior = await tx.selectFrom('access_control.object_permission_grant')
          .select('object_permission_grant_id')
          .where('governance_object_id', '=', ENGAGEMENT_LIFECYCLE_FIXTURE.objectId)
          .where('security_principal_id', '=', securityPrincipalId)
          .where('permission_code', '=', permissionCode).executeTakeFirst();
        if (!prior) await tx.insertInto('access_control.object_permission_grant').values({
          governance_object_id: ENGAGEMENT_LIFECYCLE_FIXTURE.objectId,
          security_principal_id: securityPrincipalId,
          permission_code: permissionCode, grant_effect: 'ALLOW', grant_sequence: '1',
          granted_by: ENGAGEMENT_LIFECYCLE_FIXTURE.ownerId,
          reason: 'SYNTHETIC NON_PRODUCTION PV-006-B-03 lifecycle boundary',
          valid_from: '2026-01-01T00:00:00', valid_to: null,
          scope_level: 'HOSPITAL', campus_id: null,
        }).execute();
      }
    }
    for (const permissionCode of [
      'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_WRITE',
    ] as const) {
      const prior = await tx.selectFrom('access_control.object_permission_grant')
        .select('object_permission_grant_id')
        .where('governance_object_id', '=', ENGAGEMENT_LIFECYCLE_FIXTURE.objectId)
        .where('security_principal_id', '=', ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId)
        .where('permission_code', '=', permissionCode).executeTakeFirst();
      if (!prior) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: ENGAGEMENT_LIFECYCLE_FIXTURE.objectId,
        security_principal_id: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId,
        permission_code: permissionCode, grant_effect: 'ALLOW', grant_sequence: '1',
        granted_by: ENGAGEMENT_LIFECYCLE_FIXTURE.ownerId,
        reason: 'SYNTHETIC NON_PRODUCTION PV-006-B-03 explicit composite capability',
        valid_from: '2026-01-01T00:00:00', valid_to: null,
        scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    }
  });
}
