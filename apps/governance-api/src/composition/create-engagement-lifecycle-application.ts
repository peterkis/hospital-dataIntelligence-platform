import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import { createTransactionRunner, type RequestContext } from '../platform/transaction/transaction-runner.js';
import { createAuditModule } from '../modules/audit/index.js';
import { createAuthorizationModule } from '../modules/authorization/index.js';
import {
  createEngagementLifecycleCoreApplication,
  createEngagementLifecycleModule,
  type EngagementLifecycleApplication, type EngagementEffectiveReader, safeEngagementLifecycleError,
} from '../modules/person-master/index.js';

export function createEngagementLifecycleApplication(
  database: Kysely<DB>, context: RequestContext,
): EngagementLifecycleApplication {
  return createEngagementLifecycleCoreApplication(createRunner(database), context);
}

export function createEngagementEffectiveReader(
  database: Kysely<DB>, context: RequestContext,
): EngagementEffectiveReader {
  const runner = createRunner(database);
  return { async getEngagementEffectiveAsOf(query) {
    try { return await runner.run(context, ({ lifecycle }) => lifecycle.getEngagementEffectiveAsOf(query)); }
    catch (error) { throw safeEngagementLifecycleError(error); }
  } };
}

function createRunner(database: Kysely<DB>) {
  return createTransactionRunner(database, (transaction, requestContext) => ({
    lifecycle: createEngagementLifecycleModule(transaction, requestContext,
      createAuditModule(transaction, requestContext),
      createAuthorizationModule(transaction, requestContext, database),
      async (objectId, operation) => {
        const object = await transaction.selectFrom('platform.governance_object').select(['object_type', 'status'])
          .where('governance_object_id', '=', objectId).executeTakeFirst();
        const actor = await transaction.selectFrom('platform.security_principal').select(['principal_kind', 'status'])
          .where('security_principal_id', '=', requestContext.actorPrincipalId).executeTakeFirst();
        const reason = object?.object_type !== 'PERSON_MASTER' || object.status !== 'ACTIVE'
          ? 'PERSON_GOVERNANCE_SCOPE_INVALID'
          : actor?.principal_kind !== 'PERSON' || actor.status !== 'ACTIVE'
            ? 'PERSON_HUMAN_ACTOR_REQUIRED' : null;
        if (!reason) return;
        const personObject = await transaction.selectFrom('platform.governance_object')
          .select('governance_object_id').where('object_type', '=', 'PERSON_MASTER').executeTakeFirstOrThrow();
        await database.transaction().execute(async (auditTransaction) => {
          await createAuditModule(auditTransaction, requestContext).append({
            governanceObjectId: personObject.governance_object_id,
            eventType: 'PERSON_ENGAGEMENT_ACCESS_DENIED', aggregateType: 'PERSON_ENGAGEMENT',
            aggregateId: objectId, payload: { requestedGovernanceObjectId: objectId,
              operation: `ENGAGEMENT_LIFECYCLE_${operation}`, reason, result: 'DENIED' },
            afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
          });
        });
        throw new Error(reason);
      }),
  }));
}
