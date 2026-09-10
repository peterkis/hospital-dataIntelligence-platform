import type { Kysely } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import type { AssignmentEffectivePeriodReader, AssignmentEffectivePeriodContext } from '../modules/person-master/index.js';
import { validateAssignmentEffectivePeriodQuery } from '../modules/person-master/index.js';
import { createAssignmentScope } from './create-assignment-application.js';
import { createAuditModule } from '../modules/audit/index.js';

export function createAssignmentEffectivePeriodApplication(database: Kysely<DB>, context: RequestContext): AssignmentEffectivePeriodReader {
  return { async getAssignmentEffectivePeriodAsOf(query) {
    const validated = validateAssignmentEffectivePeriodQuery(query);
    let value: AssignmentEffectivePeriodContext;
    try {
      value = await database.transaction().setIsolationLevel('repeatable read').execute(async transaction => {
        // Business reads only. The existing authorization owner records its
        // decisions here; sensitive read audit is appended after RR closes.
        return (await createAssignmentScope(transaction, context)).effectivePeriod.getAssignmentEffectivePeriodAsOf(validated);
      });
    } catch (error) {
      if (error instanceof Error && ['OBJECT_PERMISSION_FORBIDDEN', 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED', 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID',
        'ASSIGNMENT_NOT_KNOWN_AS_OF', 'ASSIGNMENT_NOT_FOUND'].includes(error.message)) {
        await database.transaction().setIsolationLevel('read committed').execute(async transaction => {
          const exists = await transaction.selectFrom('platform.governance_object').select('governance_object_id')
            .where('governance_object_id', '=', validated.governanceObjectId).executeTakeFirst();
          if (exists) await createAuditModule(transaction, context).append({ governanceObjectId: validated.governanceObjectId,
            aggregateType: 'PERSON_ASSIGNMENT', aggregateId: validated.governanceObjectId, eventType: 'PERSON_ASSIGNMENT_ACCESS_DENIED',
            payload: { operation: 'EFFECTIVE_PERIOD_READ', reason: error.message, assignmentId: validated.assignmentId,
              requestedFrom: validated.requestedFrom, requestedTo: validated.requestedTo, recordAsOf: validated.recordAsOf },
            afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
        });
      }
      throw error;
    }
    // Observation is complete before audit obtains its existing stream lock.
    await database.transaction().setIsolationLevel('read committed').execute(transaction => createAuditModule(transaction, context).append({
      governanceObjectId: value.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: value.assignmentId,
      aggregateVersionId: value.selectedAssignmentVersionId, eventType: 'PERSON_ASSIGNMENT_READ',
      payload: { view: 'EFFECTIVE_PERIOD_CONTEXT', semanticRole: value.semanticRole, contractVersion: value.contractVersion,
        requestedFrom: value.requestedFrom, requestedTo: value.requestedTo, recordAsOf: value.recordAsOf,
        selectedAssignmentVersionId: value.selectedAssignmentVersionId, declaredCoverage: value.declaredCoverage,
        structuralDependencyResult: value.structuralDependencies.result, boundedReasons: value.structuralDependencies.boundedReasons,
        contextFingerprint: value.contextFingerprint, originalEvidenceRefs: value.originalEvidenceRefs },
      afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
    }));
    return value;
  } };
}
