import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import type { TemporaryAssignmentApplication } from '../modules/person-master/index.js';
import { createAssignmentScope } from './create-assignment-application.js';
import { createAuditModule } from '../modules/audit/index.js';

export function createTemporaryAssignmentApplication(database: Kysely<DB>, context: RequestContext): TemporaryAssignmentApplication {
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
            payload: { operation: read ? 'TEMPORARY_READ' : 'TEMPORARY_CREATE', reason: error.message }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
        });
      }
      throw error;
    }
  }
  async function read<T>(governanceObjectId: string, targetAssignmentId: string, view: string,
    work: (scope: Scope) => Promise<T>, describe: (value: T) => {
      readonly versionId: string; readonly query?: { readonly businessAt: string; readonly recordAsOf: string };
    }): Promise<T> {
    const value = await run(governanceObjectId, true, work);
    const selected = describe(value);
    await database.transaction().execute(transaction => createAuditModule(transaction, context).append({
      governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: targetAssignmentId,
      aggregateVersionId: selected.versionId, eventType: 'PERSON_ASSIGNMENT_READ',
      payload: { view, ...selected.query }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
    }));
    return value;
  }
  return {
    async createSourceLinkedTemporaryAssignment(command) {
      if (!command || typeof command !== 'object') throw new Error('ASSIGNMENT_INPUT_INVALID');
      const result = await run(command.governanceObjectId, false, scope => scope.temporary.createSourceLinkedTemporaryAssignment(command));
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
    getTemporaryAssignment: query => read(query.governanceObjectId, query.targetAssignmentId, 'EXACT_TEMPORARY_RECEIPT',
      scope => scope.temporary.getTemporaryAssignment(query), value => ({ versionId: value.targetAdmissionVersionId })),
    getTemporaryAssignmentAsOf: query => read(query.governanceObjectId, query.targetAssignmentId, 'TEMPORARY_AS_OF',
      scope => scope.temporary.getTemporaryAssignmentAsOf(query), value => ({ versionId: value.selectedVersion.assignmentVersionId,
        query: { businessAt: value.declaration.businessAt, recordAsOf: value.declaration.recordAsOf } })),
    async assessTemporaryAssignmentDependencies(query) {
      const value = await run(query.governanceObjectId, true, scope => scope.temporary.assessTemporaryAssignmentDependencies(query));
      // End the consistent RR snapshot before taking the append-only audit lock.
      await database.transaction().execute(transaction => createAuditModule(transaction, context).append({
        governanceObjectId: query.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: query.targetAssignmentId,
        aggregateVersionId: query.assignmentVersionId, eventType: 'PERSON_ASSIGNMENT_TEMPORARY_ASSESSED',
        payload: { assessedRecordAsOf: query.recordAsOf, referenceComparison: value.referenceComparison,
          constraintResult: value.constraintResult, componentResults: value.componentResults, reasons: value.reasons },
        afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
      }));
      return value;
    },
  };
}
