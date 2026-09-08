import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import { parseLocalDateTime } from '../platform/local-datetime/local-datetime.js';
import { createAuditModule } from '../modules/audit/index.js';
import { createAuthorizationModule, type ObjectPermissionCode } from '../modules/authorization/index.js';
import { createDepartmentPlacementReferenceScope, type DepartmentPlacementReferenceReader } from '../modules/department-master/index.js';
import { createAssignmentCoreModule, createEngagementEffectivePeriodScope, createClassifiedAssignmentEngagementPin,
  createAssignmentSemanticDefinitionModule, createAssignmentEngagementIdentityReader, createAssignmentClosureEngagementPin,
  type AssignmentCoreApplication, type AssignmentCoreModule, type EngagementEffectivePeriodReader,
  type AssignmentDependencies, createAssignmentTransferModule, ASSIGNMENT_TRANSFER_CHILD_PREFIX,
} from '../modules/person-master/index.js';

export async function createAssignmentScope(database: Transaction<DB>, context: RequestContext) {
  parseLocalDateTime(context.occurredAt);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(context.actorPrincipalId) ||
    [context.requestId, context.correlationId].some(v => typeof v !== 'string' || !v.trim() || v.length > 128 || /\p{Cc}/u.test(v)))
    throw new Error('ASSIGNMENT_CONTEXT_INVALID');
  if (context.requestId.startsWith(ASSIGNMENT_TRANSFER_CHILD_PREFIX)) throw new Error('ASSIGNMENT_INTERNAL_REQUEST_FORBIDDEN');
  const now = (await sql<{ now: string }>`select platform.local_now() as now`.execute(database)).rows[0]!.now;
  // Replayed requests re-evaluate grants at server time, not their original request clock.
  const authorization = createAuthorizationModule(database, { ...context, occurredAt: now });
  async function requireScope(objectId: string, objectType: 'PERSON_MASTER' | 'DEPARTMENT_MASTER') {
    const object = await database.selectFrom('platform.governance_object').select(['object_type', 'status'])
      .where('governance_object_id', '=', objectId).executeTakeFirst();
    const actor = await database.selectFrom('platform.security_principal').select(['principal_kind', 'status'])
      .where('security_principal_id', '=', context.actorPrincipalId).executeTakeFirst();
    if (actor?.principal_kind !== 'PERSON' || actor.status !== 'ACTIVE') throw new Error('ASSIGNMENT_HUMAN_ACTOR_REQUIRED');
    if (object?.object_type !== objectType || object.status !== 'ACTIVE') throw new Error('ASSIGNMENT_GOVERNANCE_SCOPE_INVALID');
  }
  const engagement = createEngagementEffectivePeriodScope(database, authorization, id => requireScope(id, 'PERSON_MASTER'));
  const department = createDepartmentPlacementReferenceScope(database, authorization, id => requireScope(id, 'DEPARTMENT_MASTER'));
  async function authorizeSemantics(governanceObjectId: string,operation: 'READ'|'WRITE'|'DEFINITION_READ'|'DEFINITION_WRITE') {
    await requireScope(governanceObjectId,'PERSON_MASTER');
    const permissions: Record<typeof operation,ObjectPermissionCode>={
      READ:'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ',WRITE:'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
      DEFINITION_READ:'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_READ',DEFINITION_WRITE:'PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_WRITE',
    };
    await authorization.requireObjectPermission({governanceObjectId,permissionCode:permissions[operation]});
  }
  const dependencies: AssignmentDependencies = {
      engagement, department, pinEngagement: engagement.pinEngagement, pinDepartment: department.pinDepartment,
      pinClassifiedEngagement: createClassifiedAssignmentEngagementPin(database,authorization,id=>requireScope(id,'PERSON_MASTER')),
      readEngagementIdentity: createAssignmentEngagementIdentityReader(database,authorization,id=>requireScope(id,'PERSON_MASTER')),
      pinClosureEngagement: createAssignmentClosureEngagementPin(database),
      authorizeSemantics,
      async authorizeTransfer(governanceObjectId) {
        await requireScope(governanceObjectId, 'PERSON_MASTER');
        await authorization.requireObjectPermission({ governanceObjectId, permissionCode: 'PERSON_MASTER_ASSIGNMENT_TRANSFER' });
      },
      async authorizeTemporaryCreate(governanceObjectId) {
        await requireScope(governanceObjectId, 'PERSON_MASTER');
        await authorization.requireObjectPermission({ governanceObjectId, permissionCode: 'PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE' });
      },
      async authorize(governanceObjectId, operation) {
        await requireScope(governanceObjectId, 'PERSON_MASTER');
        await authorization.requireObjectPermission({ governanceObjectId,
          permissionCode: operation === 'READ' ? 'PERSON_MASTER_ASSIGNMENT_READ' :
            operation === 'END' ? 'PERSON_MASTER_ASSIGNMENT_END' : 'PERSON_MASTER_ASSIGNMENT_WRITE' });
      },
      async authorizeDependencies(governanceObjectId, target) {
        await requireScope(governanceObjectId, 'PERSON_MASTER');
        await requireScope(target.departmentGovernanceObjectId, 'DEPARTMENT_MASTER');
        const permissions: readonly [string, ObjectPermissionCode][] = [
          [governanceObjectId, 'PERSON_MASTER_ENGAGEMENT_READ'],
          [governanceObjectId, 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'],
          [target.departmentGovernanceObjectId, 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'],
        ];
        for (const [objectId, permissionCode] of permissions)
          await authorization.requireObjectPermission({ governanceObjectId: objectId, permissionCode });
      },
  };
  const privateStep = (stepContext: RequestContext) => createAssignmentCoreModule(database, stepContext, createAuditModule(database, stepContext), dependencies);
  const assignment = privateStep(context);
  return {
    engagement, department,
    definitions: createAssignmentSemanticDefinitionModule(database, context, createAuditModule(database, context), authorizeSemantics),
    authorizeSemantics, assignment,
    transfer: createAssignmentTransferModule(database, context, createAuditModule(database, context), dependencies, assignment, privateStep),
    temporary: assignment.temporary,
  };
}

export function createAssignmentApplication(database: Kysely<DB>, context: RequestContext): AssignmentCoreApplication {
  async function run<T>(objectId: string, read: boolean, work: (module: AssignmentCoreModule) => Promise<T>, consistentSnapshot = false): Promise<T> {
    try {
      // Local RR only: assessment's owner SELECTs share one actual MVCC snapshot.
      const transaction = consistentSnapshot ? database.transaction().setIsolationLevel('repeatable read') : database.transaction();
      return await transaction.execute(async tx => work((await createAssignmentScope(tx, context)).assignment));
    } catch (error) {
      if (error instanceof Error && ['OBJECT_PERMISSION_FORBIDDEN', 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED', 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID'].includes(error.message)) {
        // The original transaction has already rolled back, so denial audit cannot self-deadlock.
        await database.transaction().execute(async tx => {
          const scope = await tx.selectFrom('platform.governance_object').select('governance_object_id')
            .where('governance_object_id', '=', objectId).executeTakeFirst();
          if (scope) await createAuditModule(tx, context).append({ governanceObjectId: objectId,
            aggregateType: 'PERSON_ASSIGNMENT', aggregateId: objectId, eventType: 'PERSON_ASSIGNMENT_ACCESS_DENIED',
            payload: { operation: read ? 'READ' : 'WRITE', reason: error.message }, afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL' });
        });
      }
      throw error;
    }
  }
  return {
    async createAssignment(command) {
      if (!command || typeof command !== 'object') throw new Error('ASSIGNMENT_INPUT_INVALID');
      const outcome = await run(command.governanceObjectId, false, module => module.createAssignment(command));
      if (!outcome.ok) throw new Error(outcome.code);
      return outcome.value;
    },
    async reviseAssignment(command) {
      if (!command || typeof command !== 'object') throw new Error('ASSIGNMENT_INPUT_INVALID');
      const outcome = await run(command.governanceObjectId, false, module => module.reviseAssignment(command));
      if (!outcome.ok) throw new Error(outcome.code);
      return outcome.value;
    },
    getAssignment: query => run(query.governanceObjectId, true, module => module.getAssignment(query)),
    getAssignmentVersion: query => run(query.governanceObjectId, true, module => module.getAssignmentVersion(query)),
    listAssignmentVersions: query => run(query.governanceObjectId, true, module => module.listAssignmentVersions(query)),
    async assessAssignmentDependencies(query) {
      const value = await run(query.governanceObjectId, true, module => module.assessAssignmentDependencies(query), true);
      // Close the RR snapshot before appending read audit. Audit's stream lock can
      // then read the latest sequence under READ COMMITTED after any lock wait.
      await database.transaction().execute(tx => createAuditModule(tx, context).append({
        governanceObjectId: query.governanceObjectId, aggregateType: 'PERSON_ASSIGNMENT', aggregateId: query.assignmentId,
        aggregateVersionId: query.assignmentVersionId, eventType: 'PERSON_ASSIGNMENT_DEPENDENCIES_ASSESSED',
        payload: { referenceComparison: value.referenceComparison, constraintResult: value.constraintResult, reasons: value.reasons,
          assessedRecordAsOf: query.recordAsOf, isLatestAssignmentVersionAsOf: value.isLatestAssignmentVersionAsOf },
        afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
      }));
      return value;
    },
  };
}

export function createAssignmentEngagementPeriodReader(database: Kysely<DB>, context: RequestContext): EngagementEffectivePeriodReader {
  return { async getEngagementEffectivePeriodAsOf(query) {
    const value = await database.transaction().setIsolationLevel('repeatable read')
      .execute(async tx => (await createAssignmentScope(tx, context)).engagement.getEngagementEffectivePeriodAsOf(query));
    await database.transaction().execute(tx => createAuditModule(tx, context).append({
      governanceObjectId: query.governanceObjectId, aggregateType: 'PERSON_ENGAGEMENT', aggregateId: query.engagementId,
      aggregateVersionId: value.authorityEngagementVersionId, eventType: 'PERSON_ENGAGEMENT_BUSINESS_STATE_READ',
      payload: { semanticRole: value.semanticRole, requestedFrom: query.requestedFrom, requestedTo: query.requestedTo,
        recordAsOf: query.recordAsOf, stateSegmentCount: value.stateSegments.length },
      afterHash: null, authorityScope: 'PERSON_MASTER:HOSPITAL',
    }));
    return value;
  } };
}
export function createAssignmentDepartmentReferenceReader(database: Kysely<DB>, context: RequestContext): DepartmentPlacementReferenceReader {
  return { getDepartmentPlacementReferenceAsOf: query => database.transaction().setIsolationLevel('repeatable read')
    .execute(async tx => (await createAssignmentScope(tx, context)).department.getDepartmentPlacementReferenceAsOf(query)) };
}
