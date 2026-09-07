import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import type { AssignmentTransferApplication } from '../modules/person-master/index.js';
import { createAssignmentScope } from './create-assignment-application.js';
import { createAuditModule } from '../modules/audit/index.js';

export function createAssignmentTransferApplication(database: Kysely<DB>, context: RequestContext): AssignmentTransferApplication {
  type Scope = Awaited<ReturnType<typeof createAssignmentScope>>;
  async function run<T>(governanceObjectId: string, read: boolean, work: (scope: Scope) => Promise<T>): Promise<T> {
    try {
      return await database.transaction().setIsolationLevel(read ? 'repeatable read' : 'read committed')
        .execute(async transaction => work(await createAssignmentScope(transaction, context)));
    } catch (error) {
      if (error instanceof Error && ['OBJECT_PERMISSION_FORBIDDEN', 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED', 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID'].includes(error.message)) {
        await database.transaction().execute(async transaction => {
          const scope = await transaction.selectFrom('platform.governance_object').select('governance_object_id')
            .where('governance_object_id', '=', governanceObjectId).executeTakeFirst();
          if (scope) await createAuditModule(transaction, context).append({ governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT',
            aggregateId: governanceObjectId, eventType: 'PERSON_ASSIGNMENT_ACCESS_DENIED',
            payload: { operation: read ? 'TRANSFER_READ' : 'TRANSFER', reason: error.message }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
        });
      }
      throw error;
    }
  }
  return {
    async transferAssignment(command) {
      if (!command || typeof command !== 'object') throw new Error('ASSIGNMENT_INPUT_INVALID');
      const outcome = await run(command.governanceObjectId, false, scope => scope.transfer.transferAssignment(command));
      if (!outcome.ok) throw new Error(outcome.code);
      return outcome.value;
    },
    async getAssignmentTransfer(query) {
      const value = await run(query.governanceObjectId, true, scope => scope.transfer.getAssignmentTransfer(query));
      // Close RR before taking the shared audit stream lock; audit failure remains visible.
      await database.transaction().execute(transaction => createAuditModule(transaction, context).append({
        governanceObjectId: query.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: query.transferId,
        eventType: 'PERSON_ASSIGNMENT_READ', payload: { view: 'EXACT_TRANSFER', transferId: query.transferId },
        afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
      }));
      return value;
    },
  };
}
