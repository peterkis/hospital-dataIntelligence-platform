import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import type { AssignmentClosureApplication, AssignmentCoreModule } from '../modules/person-master/index.js';
import { createAuditModule } from '../modules/audit/index.js';
import { createAssignmentScope } from './create-assignment-application.js';

export function createAssignmentClosureApplication(database: Kysely<DB>, context: RequestContext): AssignmentClosureApplication {
  async function run<T>(governanceObjectId: string, read: boolean, work: (module: AssignmentCoreModule) => Promise<T>): Promise<T> {
    try {
      return await database.transaction().setIsolationLevel(read ? 'repeatable read' : 'read committed')
        .execute(async tx => work((await createAssignmentScope(tx, context)).assignment));
    } catch (error) {
      if (error instanceof Error && ['OBJECT_PERMISSION_FORBIDDEN', 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED', 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID'].includes(error.message)) {
        await database.transaction().execute(async tx => {
          const exists = await tx.selectFrom('platform.governance_object').select('governance_object_id')
            .where('governance_object_id', '=', governanceObjectId).executeTakeFirst();
          if (exists) await createAuditModule(tx, context).append({ governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: governanceObjectId,
            eventType: 'PERSON_ASSIGNMENT_ACCESS_DENIED', payload: { operation: read ? 'CLOSURE_READ' : 'END', reason: error.message },
            afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
        });
      }
      throw error;
    }
  }
  async function read<T>(governanceObjectId: string, assignmentId: string, payload: Readonly<Record<string, unknown>>,
    work: (module: AssignmentCoreModule) => Promise<T>): Promise<T> {
    const value = await run(governanceObjectId, true, work);
    // Close the RR snapshot before the shared audit stream acquires its fresh sequence.
    await database.transaction().execute(tx => createAuditModule(tx, context).append({ governanceObjectId,
      aggregateType: 'PERSON_ASSIGNMENT', aggregateId: assignmentId, eventType: 'PERSON_ASSIGNMENT_READ',
      payload, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' }));
    return value;
  }
  return {
    async endAssignment(command) {
      if (!command || typeof command !== 'object') throw new Error('ASSIGNMENT_INPUT_INVALID');
      const outcome = await run(command.governanceObjectId, false, module => module.endAssignment(command));
      if (!outcome.ok) throw new Error(outcome.code);
      return outcome.value;
    },
    getAssignmentClosure: query => read(query.governanceObjectId, query.assignmentId, { view: 'CLOSURE', closureVersionId: query.closureVersionId },
      module => module.getAssignmentClosure(query)),
    getAssignmentDeclaredPeriodAsOf: query => read(query.governanceObjectId, query.assignmentId,
      { view: 'DECLARED_PERIOD', businessAt: query.businessAt, recordAsOf: query.recordAsOf }, module => module.getAssignmentDeclaredPeriodAsOf(query)),
  };
}
