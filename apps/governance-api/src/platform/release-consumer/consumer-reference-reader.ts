import type { Kysely } from 'kysely';
import type { DB } from '../database/database-types.generated.js';

// Platform owns governance objects and security principals. Release Distribution
// owns the subscription decisions made from these transaction-scoped references.
export interface ConsumerReferenceReader {
  getActiveServiceOwner(principalId: string): Promise<{ servicePrincipalId: string; principalCode: string } | null>;
  getGovernanceObjectType(governanceObjectId: string): Promise<string | null>;
  isActiveServicePrincipal(principalId: string): Promise<boolean>;
  isActivePersonPrincipal(principalId: string): Promise<boolean>;
}

export function createConsumerReferenceReader(database: Kysely<DB>): ConsumerReferenceReader {
  async function isActivePrincipal(principalId: string, kind: 'PERSON' | 'SERVICE') {
    const principal = await database.selectFrom('platform.security_principal')
      .select(['principal_kind', 'status']).where('security_principal_id', '=', principalId)
      .forShare().executeTakeFirst();
    return principal?.principal_kind === kind && principal.status === 'ACTIVE';
  }
  return {
    async getActiveServiceOwner(principalId) {
      const principal = await database.selectFrom('platform.security_principal')
        .select(['security_principal_id', 'principal_code', 'principal_kind', 'status'])
        .where('security_principal_id', '=', principalId).forShare().executeTakeFirst();
      return principal?.principal_kind === 'SERVICE' && principal.status === 'ACTIVE'
        ? { servicePrincipalId: principal.security_principal_id, principalCode: principal.principal_code } : null;
    },
    async getGovernanceObjectType(governanceObjectId) {
      const object = await database.selectFrom('platform.governance_object')
        .select('object_type').where('governance_object_id', '=', governanceObjectId)
        .forShare().executeTakeFirst();
      return object?.object_type ?? null;
    },
    isActiveServicePrincipal: (principalId) => isActivePrincipal(principalId, 'SERVICE'),
    isActivePersonPrincipal: (principalId) => isActivePrincipal(principalId, 'PERSON'),
  };
}
