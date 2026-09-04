import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import { createTransactionRunner, type RequestContext } from '../platform/transaction/transaction-runner.js';
import { createAuditModule } from '../modules/audit/index.js';
import { createAuthorizationModule } from '../modules/authorization/index.js';
import { createPersonCoreApplication, createPersonMasterModule, type PersonCoreApplication } from '../modules/person-master/index.js';

export function createPersonApplication(database: Kysely<DB>, context: RequestContext): PersonCoreApplication {
  const runner = createTransactionRunner(database, (transaction, requestContext) => ({
    personMaster: createPersonMasterModule(transaction, requestContext,
      createAuditModule(transaction, requestContext), createAuthorizationModule(transaction, requestContext, database),
      async (objectId, operation) => {
        const object = await transaction.selectFrom('platform.governance_object').select(['object_type', 'status'])
          .where('governance_object_id', '=', objectId).executeTakeFirst();
        const actor = await transaction.selectFrom('platform.security_principal').select(['principal_kind', 'status'])
          .where('security_principal_id', '=', requestContext.actorPrincipalId).executeTakeFirst();
        const reason = object?.object_type !== 'PERSON_MASTER' || object.status !== 'ACTIVE'
          ? 'PERSON_GOVERNANCE_SCOPE_INVALID'
          : actor?.principal_kind !== 'PERSON' || actor.status !== 'ACTIVE' ? 'PERSON_HUMAN_ACTOR_REQUIRED' : null;
        if (reason) {
          // Rejections survive rollback of the attempted business transaction.
          const personObject = await transaction.selectFrom('platform.governance_object').select('governance_object_id')
            .where('object_type', '=', 'PERSON_MASTER').executeTakeFirstOrThrow();
          await database.transaction().execute(async (auditTransaction) => {
            await createAuditModule(auditTransaction, requestContext).append({
              governanceObjectId: personObject.governance_object_id, eventType: 'PERSON_CORE_ACCESS_DENIED',
              aggregateType: 'PERSON_CORE_ACCESS', aggregateId: objectId,
              payload: { requestedGovernanceObjectId: objectId, operation, reason, result: 'DENIED' },
              afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
            });
          });
          throw new Error(reason);
        }
      }),
  }));
  return createPersonCoreApplication(runner, context);
}
