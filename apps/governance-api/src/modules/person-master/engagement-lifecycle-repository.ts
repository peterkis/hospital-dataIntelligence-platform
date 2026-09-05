import { sql, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import type { AuditEventService, PersonAuditEventType } from '../audit/index.js';
import type { AuthorizationModule, ObjectPermissionCode } from '../authorization/index.js';
import {
  deriveEngagementBusinessState,
  validateEndEngagement,
  validateEngagementBusinessStateQuery,
  validateResumeEngagement,
  validateSuspendEngagement,
  type EndEngagement,
  type EngagementBusinessStateQuery,
  type EngagementBusinessStateResult,
  type EngagementLifecycleApplication,
  type EngagementLifecycleEvent,
  type EngagementLifecycleEventType,
  type EngagementLifecycleMutation,
  type ResumeEngagement,
  type SuspendEngagement,
} from './engagement-lifecycle-contracts.js';
import { assertEngagementUuid, type EngagementVersion } from './engagement-contracts.js';

type EngagementRow = Selectable<DB['person_master.engagement']>;
type VersionRow = Selectable<DB['person_master.engagement_version']>;
type LifecycleEventRow = Selectable<DB['person_master.engagement_lifecycle_event']>;
type LifecycleFailureCode = 'ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE' | 'ENGAGEMENT_NOT_STARTED' |
  'ENGAGEMENT_ALREADY_SUSPENDED' | 'ENGAGEMENT_NOT_SUSPENDED' | 'ENGAGEMENT_ENDED' |
  'ENGAGEMENT_END_BEFORE_START' | 'ENGAGEMENT_STALE_VERSION' | 'ENGAGEMENT_LIFECYCLE_END_CONFLICT';
type CommandResult<T> = { readonly ok: true; readonly value: T } |
  { readonly ok: false; readonly code: LifecycleFailureCode };

export interface EngagementLifecycleModule extends Omit<EngagementLifecycleApplication,
  'suspendEngagement' | 'resumeEngagement' | 'endEngagement'> {
  suspendEngagement(command: SuspendEngagement): Promise<CommandResult<EngagementLifecycleEvent>>;
  resumeEngagement(command: ResumeEngagement): Promise<CommandResult<EngagementLifecycleEvent>>;
  endEngagement(command: EndEngagement): Promise<CommandResult<EngagementVersion>>;
}

export function createEngagementLifecycleModule(
  database: Transaction<DB>, context: RequestContext, audit: AuditEventService,
  authorization: AuthorizationModule,
  requireScope: (objectId: string, operation: 'READ' | 'WRITE') => Promise<void>,
): EngagementLifecycleModule {
  parseLocalDateTime(context.occurredAt);
  assertEngagementUuid(context.actorPrincipalId, 'ENGAGEMENT_CONTEXT_INVALID');
  for (const id of [context.requestId, context.correlationId]) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128 || /\p{Cc}/u.test(id)) {
      throw new Error('ENGAGEMENT_CONTEXT_INVALID');
    }
  }

  async function authorize(objectId: string, operation: 'READ' | 'WRITE') {
    assertEngagementUuid(objectId, 'ENGAGEMENT_SCOPE_INVALID');
    await requireScope(objectId, operation);
    const permission: ObjectPermissionCode = operation === 'READ'
      ? 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ'
      : 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE';
    await authorization.requireObjectPermission({ governanceObjectId: objectId, permissionCode: permission });
  }

  async function relation(
    query: { readonly governanceObjectId: string; readonly engagementId: string }, lock = false,
  ): Promise<EngagementRow> {
    assertEngagementUuid(query.engagementId, 'ENGAGEMENT_ID_INVALID');
    let select = database.selectFrom('person_master.engagement').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId)
      .where('engagement_id', '=', query.engagementId);
    if (lock) select = select.forUpdate();
    const row = await select.executeTakeFirst();
    if (!row) throw new Error('ENGAGEMENT_NOT_FOUND');
    return row;
  }

  async function latestVersion(engagementId: string): Promise<VersionRow> {
    return database.selectFrom('person_master.engagement_version').selectAll()
      .where('engagement_id', '=', engagementId).orderBy('version_no', 'desc')
      .executeTakeFirstOrThrow();
  }

  async function currentRecordTime(): Promise<string> {
    const result = await sql<{ recorded_at: string }>`
      select platform.local_now() as recorded_at
    `.execute(database);
    return result.rows[0]!.recorded_at;
  }

  async function versionResult(row: VersionRow): Promise<EngagementVersion> {
    const classification = await database
      .selectFrom('person_master.engagement_classification as classification')
      .innerJoin('person_master.engagement_type as definition',
        'definition.engagement_type_id', 'classification.engagement_type_id')
      .innerJoin('person_master.engagement_type_version as type_version',
        'type_version.engagement_type_version_id', 'classification.engagement_type_version_id')
      .select([
        'definition.type_code as engagement_type_code',
        'type_version.category_code as engagement_category_code',
        'type_version.engagement_type_version_id',
        'type_version.version_no as engagement_type_version_no',
        'classification.classified_at as classification_recorded_at',
      ]).where('classification.engagement_id', '=', row.engagement_id)
      .executeTakeFirstOrThrow();
    return { engagementId: row.engagement_id, engagementVersionId: row.engagement_version_id,
      governanceObjectId: row.governance_object_id, personId: row.person_id,
      engagementTypeCode: classification.engagement_type_code,
      engagementCategoryCode: classification.engagement_category_code as EngagementVersion['engagementCategoryCode'],
      engagementTypeVersionId: classification.engagement_type_version_id,
      engagementTypeVersionNo: classification.engagement_type_version_no,
      classificationRecordedAt: classification.classification_recorded_at,
      versionNo: row.version_no, supersedesEngagementVersionId: row.supersedes_engagement_version_id,
      reasonCode: row.revision_reason_code as EngagementVersion['reasonCode'],
      businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to,
      recordedFrom: row.recorded_from };
  }

  async function deriveState(
    query: EngagementBusinessStateQuery,
  ): Promise<EngagementBusinessStateResult> {
    const version = await database.selectFrom('person_master.engagement_version').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId)
      .where('engagement_id', '=', query.engagementId)
      .where('recorded_from', '<=', query.recordAsOf)
      .orderBy('version_no', 'desc').executeTakeFirst();
    if (!version) throw new Error('ENGAGEMENT_NOT_KNOWN_AS_OF');
    const event = await database.selectFrom('person_master.engagement_lifecycle_event').selectAll()
      .where('governance_object_id', '=', query.governanceObjectId)
      .where('engagement_id', '=', query.engagementId)
      .where('recorded_at', '<=', query.recordAsOf)
      .where('business_effective_at', '<=', query.businessAt)
      .orderBy('business_effective_at', 'desc').orderBy('sequence_no', 'desc')
      .executeTakeFirst();
    const recordedSequence = await database.selectFrom('person_master.engagement_lifecycle_event')
      .select('sequence_no').where('governance_object_id', '=', query.governanceObjectId)
      .where('engagement_id', '=', query.engagementId).where('recorded_at', '<=', query.recordAsOf)
      .orderBy('sequence_no', 'desc').executeTakeFirst();
    return {
      ...query,
      businessState: deriveEngagementBusinessState({ businessAt: query.businessAt,
        businessValidFrom: version.business_valid_from, businessValidTo: version.business_valid_to,
        lastApplicableEventType: event?.event_type as EngagementLifecycleEventType | undefined ?? null }),
      engagementVersionId: version.engagement_version_id,
      lastApplicableLifecycleEventId: event?.engagement_lifecycle_event_id ?? null,
      lifecycleSequence: recordedSequence?.sequence_no ?? '0',
    };
  }

  async function record(
    objectId: string, engagementId: string, eventType: PersonAuditEventType,
    payload: Readonly<Record<string, unknown>>, versionId: string | null = null,
  ) {
    await audit.append({ governanceObjectId: objectId, aggregateType: 'PERSON_ENGAGEMENT',
      aggregateId: engagementId, aggregateVersionId: versionId, eventType, payload, afterHash: null,
      authorityScope: 'PERSON_MASTER:HOSPITAL' });
  }

  async function reject(
    objectId: string, engagementId: string, operation: 'SUSPEND' | 'RESUME' | 'END',
    code: LifecycleFailureCode, operationHash: Buffer,
  ): Promise<{ readonly ok: false; readonly code: LifecycleFailureCode }> {
    await database.insertInto('person_master.engagement_lifecycle_rejection').values({
      engagement_id: engagementId, governance_object_id: objectId, operation_type: operation,
      rejection_code: code, created_by: context.actorPrincipalId, request_id: context.requestId,
      operation_hash: operationHash,
    }).execute();
    await record(objectId, engagementId, 'PERSON_ENGAGEMENT_LIFECYCLE_REJECTED', {
      engagementId, operation, result: 'REJECTED', reason: code,
    });
    return { ok: false, code };
  }

  async function appendLifecycleEvent(
    command: EngagementLifecycleMutation, eventType: EngagementLifecycleEventType,
  ): Promise<CommandResult<EngagementLifecycleEvent>> {
    await authorize(command.governanceObjectId, 'WRITE');
    const row = await relation(command, true);
    const operationHash = canonicalSha256({ kind: `${eventType}_ENGAGEMENT`,
      businessEffectiveAt: command.businessEffectiveAt,
      expectedLifecycleSequence: command.expectedLifecycleSequence,
      reasonCode: command.reasonCode });
    const retry = await database.selectFrom('person_master.engagement_lifecycle_event').selectAll()
      .where('engagement_id', '=', row.engagement_id).where('request_id', '=', context.requestId)
      .executeTakeFirst();
    if (retry) {
      if (retry.created_by !== context.actorPrincipalId || retry.event_type !== eventType ||
        !retry.operation_hash.equals(operationHash)) {
        throw new Error('ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT');
      }
      return { ok: true, value: toLifecycleEvent(retry) };
    }
    const versionRequest = await database.selectFrom('person_master.engagement_version')
      .select('engagement_version_id').where('engagement_id', '=', row.engagement_id)
      .where('request_id', '=', context.requestId).executeTakeFirst();
    if (versionRequest) throw new Error('ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT');
    const rejectedRequest = await database.selectFrom('person_master.engagement_lifecycle_rejection')
      .selectAll().where('engagement_id', '=', row.engagement_id)
      .where('request_id', '=', context.requestId).executeTakeFirst();
    if (rejectedRequest) {
      if (rejectedRequest.created_by !== context.actorPrincipalId ||
        rejectedRequest.operation_type !== (eventType === 'SUSPENDED' ? 'SUSPEND' : 'RESUME') ||
        !rejectedRequest.operation_hash.equals(operationHash)) {
        throw new Error('ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT');
      }
      return { ok: false, code: rejectedRequest.rejection_code as LifecycleFailureCode };
    }
    const previous = await database.selectFrom('person_master.engagement_lifecycle_event').selectAll()
      .where('engagement_id', '=', row.engagement_id).orderBy('sequence_no', 'desc')
      .executeTakeFirst();
    const actualSequence = previous?.sequence_no ?? '0';
    if (actualSequence !== command.expectedLifecycleSequence) {
      return reject(row.governance_object_id, row.engagement_id,
        eventType === 'SUSPENDED' ? 'SUSPEND' : 'RESUME',
        'ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE', operationHash);
    }
    const recordAsOf = await currentRecordTime();
    const state = await deriveState({ governanceObjectId: row.governance_object_id,
      engagementId: row.engagement_id, businessAt: command.businessEffectiveAt, recordAsOf });
    let invalid: LifecycleFailureCode | null = null;
    if (eventType === 'SUSPENDED') {
      invalid = state.businessState === 'PLANNED' ? 'ENGAGEMENT_NOT_STARTED'
        : state.businessState === 'SUSPENDED' ? 'ENGAGEMENT_ALREADY_SUSPENDED'
          : state.businessState === 'ENDED' ? 'ENGAGEMENT_ENDED' : null;
    } else {
      invalid = state.businessState === 'ENDED' ? 'ENGAGEMENT_ENDED'
        : state.businessState !== 'SUSPENDED' ? 'ENGAGEMENT_NOT_SUSPENDED' : null;
    }
    if (invalid) return reject(row.governance_object_id, row.engagement_id,
      eventType === 'SUSPENDED' ? 'SUSPEND' : 'RESUME', invalid, operationHash);
    const inserted = await database.insertInto('person_master.engagement_lifecycle_event').values({
      engagement_id: row.engagement_id, governance_object_id: row.governance_object_id,
      event_type: eventType, business_effective_at: command.businessEffectiveAt,
      sequence_no: (BigInt(actualSequence) + 1n).toString(), created_by: context.actorPrincipalId,
      request_id: context.requestId, reason_code: command.reasonCode, operation_hash: operationHash,
    }).returningAll().executeTakeFirstOrThrow();
    await record(row.governance_object_id, row.engagement_id,
      eventType === 'SUSPENDED' ? 'PERSON_ENGAGEMENT_SUSPENDED' : 'PERSON_ENGAGEMENT_RESUMED', {
        engagementId: row.engagement_id,
        engagementLifecycleEventId: inserted.engagement_lifecycle_event_id,
        eventType, businessEffectiveAt: inserted.business_effective_at,
        sequenceNo: inserted.sequence_no, reasonCode: inserted.reason_code, result: 'APPENDED',
      });
    return { ok: true, value: toLifecycleEvent(inserted) };
  }

  return {
    async getEngagementBusinessStateAsOf(query) {
      validateEngagementBusinessStateQuery(query);
      await authorize(query.governanceObjectId, 'READ');
      await relation(query);
      const state = await deriveState(query);
      await record(query.governanceObjectId, query.engagementId,
        'PERSON_ENGAGEMENT_BUSINESS_STATE_READ', {
          engagementId: query.engagementId, businessState: state.businessState,
          engagementVersionId: state.engagementVersionId,
          lastApplicableLifecycleEventId: state.lastApplicableLifecycleEventId,
          lifecycleSequence: state.lifecycleSequence, result: 'DERIVED',
        }, state.engagementVersionId);
      return state;
    },

    async suspendEngagement(command) {
      validateSuspendEngagement(command);
      return appendLifecycleEvent(command, 'SUSPENDED');
    },

    async resumeEngagement(command) {
      validateResumeEngagement(command);
      return appendLifecycleEvent(command, 'RESUMED');
    },

    async endEngagement(command) {
      validateEndEngagement(command);
      await authorize(command.governanceObjectId, 'WRITE');
      const row = await relation(command, true);
      const operationHash = canonicalSha256({ kind: 'END_ENGAGEMENT',
        expectedCurrentEngagementVersionId: command.expectedCurrentEngagementVersionId,
        businessEffectiveAt: command.businessEffectiveAt, reasonCode: command.reasonCode });
      const retry = await database.selectFrom('person_master.engagement_version').selectAll()
        .where('engagement_id', '=', row.engagement_id).where('request_id', '=', context.requestId)
        .executeTakeFirst();
      if (retry) {
        if (retry.created_by !== context.actorPrincipalId || retry.revision_reason_code !== 'LIFECYCLE_END' ||
          !retry.operation_hash.equals(operationHash)) {
          throw new Error('ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT');
        }
        return { ok: true, value: await versionResult(retry) };
      }
      const lifecycleRequest = await database.selectFrom('person_master.engagement_lifecycle_event')
        .select('engagement_lifecycle_event_id').where('engagement_id', '=', row.engagement_id)
        .where('request_id', '=', context.requestId).executeTakeFirst();
      if (lifecycleRequest) throw new Error('ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT');
      const rejectedRequest = await database.selectFrom('person_master.engagement_lifecycle_rejection')
        .selectAll().where('engagement_id', '=', row.engagement_id)
        .where('request_id', '=', context.requestId).executeTakeFirst();
      if (rejectedRequest) {
        if (rejectedRequest.created_by !== context.actorPrincipalId ||
          rejectedRequest.operation_type !== 'END' ||
          !rejectedRequest.operation_hash.equals(operationHash)) {
          throw new Error('ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT');
        }
        return { ok: false, code: rejectedRequest.rejection_code as LifecycleFailureCode };
      }
      const previous = await latestVersion(row.engagement_id);
      if (previous.engagement_version_id !== command.expectedCurrentEngagementVersionId) {
        return reject(row.governance_object_id, row.engagement_id, 'END',
          'ENGAGEMENT_STALE_VERSION', operationHash);
      }
      if (previous.business_valid_to !== null) {
        const ended = await sql<{ already_ended: boolean }>`
          select ${previous.business_valid_to}::timestamp <= platform.local_now() as already_ended
        `.execute(database);
        if (ended.rows[0]!.already_ended) {
          return reject(row.governance_object_id, row.engagement_id, 'END',
            'ENGAGEMENT_ENDED', operationHash);
        }
      }
      const recordAsOf = await currentRecordTime();
      const state = await deriveState({ governanceObjectId: row.governance_object_id,
        engagementId: row.engagement_id, businessAt: command.businessEffectiveAt, recordAsOf });
      if (state.businessState === 'PLANNED') {
        return reject(row.governance_object_id, row.engagement_id, 'END',
          'ENGAGEMENT_END_BEFORE_START', operationHash);
      }
      if (state.businessState === 'ENDED') {
        return reject(row.governance_object_id, row.engagement_id, 'END',
          'ENGAGEMENT_ENDED', operationHash);
      }
      const conflictingEvent = await database.selectFrom('person_master.engagement_lifecycle_event')
        .select('engagement_lifecycle_event_id').where('engagement_id', '=', row.engagement_id)
        .where('business_effective_at', '>=', command.businessEffectiveAt).executeTakeFirst();
      if (conflictingEvent) {
        return reject(row.governance_object_id, row.engagement_id, 'END',
          'ENGAGEMENT_LIFECYCLE_END_CONFLICT', operationHash);
      }
      const version = await database.insertInto('person_master.engagement_version').values({
        engagement_id: row.engagement_id, governance_object_id: row.governance_object_id,
        person_id: row.person_id, version_no: (BigInt(previous.version_no) + 1n).toString(),
        supersedes_engagement_version_id: previous.engagement_version_id,
        revision_reason_code: 'LIFECYCLE_END', business_valid_from: previous.business_valid_from,
        business_valid_to: command.businessEffectiveAt, created_by: context.actorPrincipalId,
        request_id: context.requestId, operation_hash: operationHash,
      }).returningAll().executeTakeFirstOrThrow();
      await record(row.governance_object_id, row.engagement_id, 'PERSON_ENGAGEMENT_ENDED', {
        engagementId: row.engagement_id, engagementVersionId: version.engagement_version_id,
        supersedesEngagementVersionId: previous.engagement_version_id,
        businessEffectiveAt: command.businessEffectiveAt, reasonCode: command.reasonCode,
        versionNo: version.version_no, result: 'ENDED',
      }, version.engagement_version_id);
      return { ok: true, value: await versionResult(version) };
    },
  };
}

function toLifecycleEvent(row: LifecycleEventRow): EngagementLifecycleEvent {
  return { engagementLifecycleEventId: row.engagement_lifecycle_event_id,
    engagementId: row.engagement_id, governanceObjectId: row.governance_object_id,
    eventType: row.event_type as EngagementLifecycleEventType,
    businessEffectiveAt: row.business_effective_at, recordedAt: row.recorded_at,
    sequenceNo: row.sequence_no, createdBy: row.created_by, requestId: row.request_id,
    reasonCode: row.reason_code };
}
