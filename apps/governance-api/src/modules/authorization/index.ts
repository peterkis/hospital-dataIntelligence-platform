import type { Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';

export const AUTHORIZATION_MODULE_ID = 'authorization' as const;

export type ObjectPermissionCode =
  | 'CHARGE_CATALOG_PUBLISH'
  | 'PRICE_LIST_PUBLISH'
  | 'PRICE_RESOLVE'
  | 'CONSUMER_SUBSCRIPTION_MANAGE'
  | 'AUDIT_READ';

export interface AuthorizationModule {
  requireObjectPermission(command: {
    readonly governanceObjectId: string;
    readonly permissionCode: ObjectPermissionCode;
  }): Promise<void>;
}

export function createAuthorizationModule(
  database: Kysely<DB>,
  context: RequestContext,
): AuthorizationModule {
  return {
    async requireObjectPermission(command) {
      const grant = await database
        .selectFrom('access_control.object_permission_grant')
        .select(['grant_effect', 'grant_sequence'])
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('security_principal_id', '=', context.actorPrincipalId)
        .where('permission_code', '=', command.permissionCode)
        .where('valid_from', '<=', context.occurredAt)
        .where((expression) =>
          expression.or([
            expression('valid_to', 'is', null),
            expression('valid_to', '>', context.occurredAt),
          ]),
        )
        .orderBy('grant_sequence', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!grant || grant.grant_effect !== 'ALLOW') {
        throw new Error('OBJECT_PERMISSION_FORBIDDEN');
      }
    },
  };
}
