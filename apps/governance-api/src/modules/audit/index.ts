import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { ConsumerAuditEvent } from './consumer-events.js';
export * from './consumer-events.js';
import { readConsumerAuditMetricFacts } from './consumer-metric-facts.js';
import type { ConsumerMetricFact } from '../../platform/observability/consumer-metrics.js';

export const AUDIT_MODULE_ID = 'audit' as const;

const ZERO_HASH = Buffer.alloc(32);

export type AuditEventType =
  | PersonAuditEventType
  | 'DRAFT_CREATED'
  | 'DRAFT_READ'
  | 'DRAFT_UPDATED'
  | 'DRAFT_DELETED'
  | 'DRAFT_MUTATION_REJECTED'
  | 'VERSION_CANDIDATE_CREATED'
  | 'VERSION_HISTORY_READ'
  | 'VERSION_AS_OF_READ'
  | 'VERSION_DIFF_READ'
  | 'PRICE_LIST_DRAFT_CREATED'
  | 'PRICE_LIST_DRAFT_READ'
  | 'PRICE_LIST_DRAFT_UPDATED'
  | 'PRICE_LIST_DRAFT_DELETED'
  | 'PRICE_LIST_DRAFT_MUTATION_REJECTED'
  | 'PRICE_LIST_DRAFT_DIFF_READ'
  | 'EMERGENCY_SUSPENDED'
  | 'IMPACT_REVIEWED'
  | 'RECOVERY_LINKED'
  | 'IMPACT_CLOSED'
  | 'IMPORT_CREATED'
  | 'IMPORT_ROW_SUCCEEDED'
  | 'IMPORT_ROW_FAILED'
  | 'IMPORT_RETRIED'
  | 'CHANGE_SUBMITTED'
  | 'APPROVAL_ACTIONED'
  | 'CHANGE_WITHDRAWN'
  | 'SCHEMA_UPGRADE_PUBLISHED'
  | 'DELIVERY_RECEIPT_RECORDED'
  | 'CONSUMER_SUBSCRIPTION_LIFECYCLE_CHANGED'
  | 'CONSUMER_RELEASE_REPLAYED'
  | 'PUBLISHED'
  | 'RESOLVED'
  | DepartmentAuditEventType | ConsumerAuditEvent;

export const DEPARTMENT_AUDIT_EVENT_TYPES = [
  'DEPARTMENT_CREATED',
  'DEPARTMENT_VERSION_CREATED',
  'DEPARTMENT_VERSION_UPDATED',
  'DEPARTMENT_SUBMITTED',
  'DEPARTMENT_REVIEWED',
  'DEPARTMENT_APPROVED',
  'DEPARTMENT_PUBLISHED',
  'DEPARTMENT_HIERARCHY_VIEW_CREATED',
  'DEPARTMENT_HIERARCHY_VERSION_CREATED',
  'DEPARTMENT_HIERARCHY_PUBLISHED',
  'DEPARTMENT_NODE_MOVED',
  'DEPARTMENT_SOURCE_MAPPING_CREATED',
  'DEPARTMENT_SOURCE_MAPPING_CONFIRMED',
  'DEPARTMENT_SOURCE_MAPPING_REJECTED',
  'DEPARTMENT_CAMPUS_ASSIGNED',
  'DEPARTMENT_CAMPUS_CHANGED',
] as const;

export type DepartmentAuditEventType = (typeof DEPARTMENT_AUDIT_EVENT_TYPES)[number];

export type DepartmentAuditAggregateType =
  | 'DEPARTMENT'
  | 'DEPARTMENT_VERSION'
  | 'DEPARTMENT_HIERARCHY_VIEW'
  | 'DEPARTMENT_HIERARCHY_VIEW_VERSION'
  | 'DEPARTMENT_SOURCE_MAPPING'
  | 'DEPARTMENT_CAMPUS_ASSIGNMENT';

export type AuditEventPayload = Readonly<Record<string, unknown>>;

export type PersonAuditEventType = 'PERSON_SUBJECT_CREATED' | 'PERSON_SUBJECT_VERSION_CREATED' | 'PERSON_SUBJECT_READ' | 'PERSON_CORE_ACCESS_DENIED'
  | 'PERSON_IDENTIFIER_REGISTERED' | 'PERSON_IDENTIFIER_VERSION_CREATED' | 'PERSON_IDENTIFIER_READ'
  | 'PERSON_IDENTIFIER_LOOKUP' | 'PERSON_IDENTIFIER_COLLISION_REJECTED' | 'PERSON_IDENTIFIER_ACCESS_DENIED'
  | 'PERSON_SOURCE_MAPPING_REGISTERED' | 'PERSON_SOURCE_MAPPING_CORRECTED' | 'PERSON_SOURCE_MAPPING_RETRACTED'
  | 'PERSON_SOURCE_MAPPING_READ' | 'PERSON_SOURCE_MAPPING_LOOKUP'
  | 'PERSON_SOURCE_MAPPING_REGISTRATION_REJECTED' | 'PERSON_SOURCE_MAPPING_CORRECTION_REJECTED'
  | 'PERSON_SOURCE_MAPPING_ACCESS_DENIED'
  | 'PERSON_ENGAGEMENT_CREATED' | 'PERSON_ENGAGEMENT_VERSION_CREATED' | 'PERSON_ENGAGEMENT_READ'
  | 'PERSON_ENGAGEMENT_REVISION_REJECTED' | 'PERSON_ENGAGEMENT_ACCESS_DENIED'
  | 'PERSON_ENGAGEMENT_CLASSIFIED' | 'PERSON_ENGAGEMENT_OVERLAP_EVALUATED'
  | 'PERSON_ENGAGEMENT_OVERLAP_REJECTED' | 'ENGAGEMENT_TYPE_VERSION_CREATED'
  | 'ENGAGEMENT_OVERLAP_RULE_VERSION_CREATED'
  | 'PERSON_ENGAGEMENT_SUSPENDED' | 'PERSON_ENGAGEMENT_RESUMED' | 'PERSON_ENGAGEMENT_ENDED'
  | 'PERSON_ENGAGEMENT_BUSINESS_STATE_READ' | 'PERSON_ENGAGEMENT_LIFECYCLE_REJECTED';

export interface AppendAuditEventCommand {
  readonly auditStreamId: string;
  readonly governanceObjectId: string;
  readonly entityType:
    | 'CHARGE_ITEM_VERSION'
    | 'PRICE_LIST_RELEASE'
      | 'PRICE_RESOLUTION'
      | 'DEPARTMENT_VERSION'
      | 'DEPARTMENT_HIERARCHY_VIEW_VERSION'
    | 'IMPORT_JOB'
    | 'CHANGE_REQUEST'
    | 'IMPACT_CASE'
    | 'DELIVERY';
  readonly stableEntityId: string;
  readonly entityVersionId: string | null;
  readonly action: AuditEventType;
  readonly afterHash: Buffer | null;
  readonly authorityScope: string;
}

export interface AppendGovernanceAuditEventCommand {
  readonly auditStreamId?: string;
  readonly governanceObjectId: string;
  readonly eventType: DepartmentAuditEventType | PersonAuditEventType | ConsumerAuditEvent | 'CONSUMER_SUBSCRIPTION_LIFECYCLE_CHANGED' | 'CONSUMER_RELEASE_REPLAYED';
  readonly aggregateType: DepartmentAuditAggregateType | 'PERSON_SUBJECT' | 'PERSON_SUBJECT_VERSION' | 'PERSON_CORE_ACCESS'
    | 'PERSON_IDENTIFIER' | 'PERSON_SOURCE_MAPPING' | 'PERSON_ENGAGEMENT'
    | 'PERSON_ENGAGEMENT_TYPE' | 'PERSON_ENGAGEMENT_OVERLAP_RULE' | 'CONSUMER_SUBSCRIPTION';
  readonly aggregateId: string;
  readonly aggregateVersionId?: string | null;
  readonly payload: AuditEventPayload;
  readonly afterHash: Buffer | null;
  readonly authorityScope: string;
}

export interface RecordedAuditEvent {
  readonly auditEventId: string;
  readonly auditSequence: string;
  readonly currentHash: Buffer;
  readonly eventType: AuditEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly governanceObjectId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly payload: AuditEventPayload;
}

export interface AuditEventService {
  append(command: AppendAuditEventCommand | AppendGovernanceAuditEventCommand): Promise<RecordedAuditEvent>;
  verifyChain(auditStreamId: string): Promise<boolean>;
  verifyChainDetailed(auditStreamId: string): Promise<{
    readonly valid: boolean;
    readonly eventCount: number;
    readonly firstMismatchSequence: string | null;
    readonly errorType: 'SEQUENCE' | 'PAYLOAD_HASH' | 'PREVIOUS_HASH' | 'CURRENT_HASH' | null;
  }>;
  query(command: {
    readonly auditStreamId?: string;
    readonly consumerReleaseOnly?: boolean;
    readonly releaseId?: string;
    readonly projectionType?: string;
    readonly result?: string;
    readonly occurredFrom?: string;
    readonly occurredTo?: string;
    readonly afterSequence?: string;
    readonly governanceObjectId: string;
    readonly stableEntityId?: string;
    readonly entityVersionId?: string;
    readonly requestId?: string;
    readonly action?: string;
    readonly actorPrincipalId?: string;
    readonly sequenceFrom?: string;
    readonly sequenceTo?: string;
    readonly limit: number;
  }): Promise<readonly {
    readonly auditEventId: string;
    readonly auditStreamId: string;
    readonly auditSequence: string;
    readonly eventType: AuditEventType;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly governanceObjectId: string;
    readonly entityType: string;
    readonly stableEntityId: string;
    readonly entityVersionId: string | null;
    readonly action: string;
    readonly actorPrincipalId: string;
    readonly actorId: string;
    readonly occurredAt: string;
    readonly recordedAt: string;
    readonly payload: AuditEventPayload;
    readonly requestId: string;
    readonly correlationId: string;
    readonly previousHash: Buffer;
    readonly currentHash: Buffer;
  }[]>;
}

export interface AuditModule extends AuditEventService {
  readConsumerMetricFacts(): Promise<readonly ConsumerMetricFact[]>;
}

export function createAuditModule(
  database: Kysely<DB>,
  context: RequestContext,
): AuditModule {
  return {
    readConsumerMetricFacts: () => readConsumerAuditMetricFacts(database),
    async append(command) {
      parseLocalDateTime(context.occurredAt);
      const normalized = normalizeAuditCommand(command);
      assertAuditPayloadSafe(normalized.payload);
      const recordedAt = (await database.selectNoFrom(
        sql<string>`platform.local_now()`.as('recorded_at'),
      ).executeTakeFirstOrThrow()).recorded_at;
      await sql`select pg_advisory_xact_lock(hashtextextended(${normalized.auditStreamId}, 47))`.execute(
        database,
      );
      const previous = await database
        .selectFrom('audit.audit_event')
        .select(['audit_sequence', 'current_hash'])
        .where('audit_stream_id', '=', normalized.auditStreamId)
        .orderBy('audit_sequence', 'desc')
        .limit(1)
        .executeTakeFirst();
      const auditSequence = (BigInt(previous?.audit_sequence ?? '0') + 1n).toString();
      const previousHash = previous?.current_hash ?? ZERO_HASH;
      const eventPayloadHash = canonicalSha256({
        action: normalized.eventType,
        actorPrincipalId: context.actorPrincipalId,
        afterHash: normalized.afterHash ? digestHex(normalized.afterHash) : null,
        authorityScope: normalized.authorityScope,
        correlationId: context.correlationId,
        entityType: normalized.aggregateType,
        entityVersionId: normalized.aggregateVersionId,
        governanceObjectId: normalized.governanceObjectId,
        occurredAt: context.occurredAt,
        requestId: context.requestId,
        stableEntityId: normalized.aggregateId,
        ...(normalized.hasCanonicalPayload ? { payload: normalized.payload, recordedAt } : {}),
      });
      const currentHash = chainHash(previousHash, auditSequence, eventPayloadHash);
      const event = await database
        .insertInto('audit.audit_event')
        .values({
          audit_stream_id: normalized.auditStreamId,
          audit_sequence: auditSequence,
          governance_object_id: normalized.governanceObjectId,
          entity_type: normalized.aggregateType,
          stable_entity_id: normalized.aggregateId,
          entity_version_id: normalized.aggregateVersionId,
          action: normalized.eventType,
          after_hash: normalized.afterHash,
          actor_principal_id: context.actorPrincipalId,
          authority_scope: normalized.authorityScope,
          occurred_at: context.occurredAt,
          recorded_at: recordedAt,
          event_payload: normalized.hasCanonicalPayload
            ? sql`${JSON.stringify(normalized.payload)}::jsonb`
            : null,
          request_id: context.requestId,
          correlation_id: context.correlationId,
          event_payload_hash: eventPayloadHash,
          previous_hash: previousHash,
          current_hash: currentHash,
        })
        .returning(['audit_event_id', 'recorded_at'])
        .executeTakeFirstOrThrow();
      hitControlledPublicationFault('AUDIT_EVENT_WRITTEN');
      return {
        auditEventId: event.audit_event_id,
        auditSequence,
        currentHash,
        eventType: normalized.eventType,
        aggregateType: normalized.aggregateType,
        aggregateId: normalized.aggregateId,
        governanceObjectId: normalized.governanceObjectId,
        actorId: context.actorPrincipalId,
        occurredAt: context.occurredAt,
        recordedAt: event.recorded_at ?? recordedAt,
        payload: normalized.payload,
      };
    },

    async verifyChain(auditStreamId) {
      return (await verifyAuditChain(database, auditStreamId)).valid;
    },

    verifyChainDetailed(auditStreamId) {
      return verifyAuditChain(database, auditStreamId);
    },

    async query(command) {
      let query = database
        .selectFrom('audit.audit_event')
        .select([
          'audit_event_id as auditEventId',
          'audit_stream_id as auditStreamId',
          'audit_sequence as auditSequence',
          'action as eventType',
          'entity_type as aggregateType',
          'stable_entity_id as aggregateId',
          'governance_object_id as governanceObjectId',
          'entity_type as entityType',
          'stable_entity_id as stableEntityId',
          'entity_version_id as entityVersionId',
          'action',
          'actor_principal_id as actorPrincipalId',
          'actor_principal_id as actorId',
          'occurred_at as occurredAt',
          'recorded_at as storedRecordedAt',
          'created_at as createdAt',
          'event_payload as storedPayload',
          'request_id as requestId',
          'correlation_id as correlationId',
          'previous_hash as previousHash',
          'current_hash as currentHash',
        ])
        .where('governance_object_id', '=', command.governanceObjectId);
      if (command.auditStreamId) query = query.where('audit_stream_id', '=', command.auditStreamId);
      if (command.consumerReleaseOnly) query = query.where(sql<string>`event_payload ->> 'evidenceKind'`, '=', 'CONSUMER_RELEASE');
      if (command.releaseId) query = query.where(sql<string>`event_payload ->> 'releaseId'`, '=', command.releaseId);
      if (command.projectionType) query = query.where(sql<string>`event_payload ->> 'projectionType'`, '=', command.projectionType);
      if (command.result) query = query.where(sql<string>`event_payload ->> 'result'`, '=', command.result);
      if (command.occurredFrom) query = query.where('occurred_at', '>=', command.occurredFrom);
      if (command.occurredTo) query = query.where('occurred_at', '<=', command.occurredTo);
      if (command.afterSequence) query = query.where('audit_sequence', '>', command.afterSequence);
      if (command.stableEntityId) query = query.where('stable_entity_id', '=', command.stableEntityId);
      if (command.entityVersionId) query = query.where('entity_version_id', '=', command.entityVersionId);
      if (command.requestId) query = query.where('request_id', '=', command.requestId);
      if (command.action) query = query.where('action', '=', command.action);
      if (command.actorPrincipalId) query = query.where('actor_principal_id', '=', command.actorPrincipalId);
      if (command.sequenceFrom) query = query.where('audit_sequence', '>=', command.sequenceFrom);
      if (command.sequenceTo) query = query.where('audit_sequence', '<=', command.sequenceTo);
      const rows = await query.orderBy('audit_stream_id').orderBy('audit_sequence').limit(command.limit).execute();
      return rows.map(({ storedRecordedAt, createdAt, storedPayload, ...event }) => ({
        ...event,
        eventType: event.eventType as AuditEventType,
        recordedAt: storedRecordedAt ?? createdAt,
        payload: (storedPayload ?? {}) as AuditEventPayload,
      }));
    },
  };
}

async function verifyAuditChain(database: Kysely<DB>, auditStreamId: string): Promise<{
  readonly valid: boolean;
  readonly eventCount: number;
  readonly firstMismatchSequence: string | null;
  readonly errorType: 'SEQUENCE' | 'PAYLOAD_HASH' | 'PREVIOUS_HASH' | 'CURRENT_HASH' | null;
}> {
  const events = await database
    .selectFrom('audit.audit_event')
    .select([
      'audit_sequence',
      'governance_object_id',
      'entity_type',
      'stable_entity_id',
      'entity_version_id',
      'action',
      'after_hash',
      'actor_principal_id',
      'authority_scope',
      'occurred_at',
      'request_id',
      'correlation_id',
      'event_payload_hash',
      'event_payload',
      'recorded_at',
      'previous_hash',
      'current_hash',
    ])
    .where('audit_stream_id', '=', auditStreamId)
    .orderBy('audit_sequence', 'asc')
    .execute();
  let previousHash: Buffer<ArrayBufferLike> = ZERO_HASH;
  let expectedSequence = 1n;
  for (const event of events) {
    if (BigInt(event.audit_sequence) !== expectedSequence) {
      return { valid: false, eventCount: events.length, firstMismatchSequence: event.audit_sequence, errorType: 'SEQUENCE' };
    }
    const expectedPayloadHash = canonicalSha256({
      action: event.action,
      actorPrincipalId: event.actor_principal_id,
      afterHash: event.after_hash ? digestHex(event.after_hash) : null,
      authorityScope: event.authority_scope,
      correlationId: event.correlation_id,
      entityType: event.entity_type,
      entityVersionId: event.entity_version_id,
      governanceObjectId: event.governance_object_id,
      occurredAt: event.occurred_at,
      requestId: event.request_id,
      stableEntityId: event.stable_entity_id,
      ...(event.event_payload === null ? {} : {
        payload: event.event_payload,
        recordedAt: event.recorded_at,
      }),
    });
    if (!event.event_payload_hash.equals(expectedPayloadHash)) {
      return { valid: false, eventCount: events.length, firstMismatchSequence: event.audit_sequence, errorType: 'PAYLOAD_HASH' };
    }
    if (!event.previous_hash.equals(previousHash)) {
      return { valid: false, eventCount: events.length, firstMismatchSequence: event.audit_sequence, errorType: 'PREVIOUS_HASH' };
    }
    const expectedHash = chainHash(previousHash, event.audit_sequence, expectedPayloadHash);
    if (!event.current_hash.equals(expectedHash)) {
      return { valid: false, eventCount: events.length, firstMismatchSequence: event.audit_sequence, errorType: 'CURRENT_HASH' };
    }
    previousHash = event.current_hash;
    expectedSequence += 1n;
  }
  return { valid: true, eventCount: events.length, firstMismatchSequence: null, errorType: null };
}

interface NormalizedAuditCommand {
  readonly auditStreamId: string;
  readonly governanceObjectId: string;
  readonly eventType: AuditEventType;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersionId: string | null;
  readonly payload: AuditEventPayload;
  readonly hasCanonicalPayload: boolean;
  readonly afterHash: Buffer | null;
  readonly authorityScope: string;
}

function normalizeAuditCommand(
  command: AppendAuditEventCommand | AppendGovernanceAuditEventCommand,
): NormalizedAuditCommand {
  if ('eventType' in command) {
    return {
      auditStreamId: command.auditStreamId ?? command.governanceObjectId,
      governanceObjectId: command.governanceObjectId,
      eventType: command.eventType,
      aggregateType: command.aggregateType,
      aggregateId: command.aggregateId,
      aggregateVersionId: command.aggregateVersionId ?? null,
      payload: command.payload,
      hasCanonicalPayload: true,
      afterHash: command.afterHash,
      authorityScope: command.authorityScope,
    };
  }
  return {
    auditStreamId: command.auditStreamId,
    governanceObjectId: command.governanceObjectId,
    eventType: command.action,
    aggregateType: command.entityType,
    aggregateId: command.stableEntityId,
    aggregateVersionId: command.entityVersionId,
    payload: {},
    hasCanonicalPayload: false,
    afterHash: command.afterHash,
    authorityScope: command.authorityScope,
  };
}

const SENSITIVE_AUDIT_KEY = /databaseurl|password|token|cookie|secret|authorization/iu;

export function assertAuditPayloadSafe(payload: AuditEventPayload): void {
  visitAuditPayload(payload, new Set<object>());
}

export function assertAuditLocalDateTime(value: string): void {
  parseLocalDateTime(value);
}

function visitAuditPayload(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('AUDIT_PAYLOAD_CYCLIC');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, '');
    if (SENSITIVE_AUDIT_KEY.test(normalizedKey) || /^(?:body|requestbody|httprequest)$/iu.test(normalizedKey)) {
      throw new Error('AUDIT_PAYLOAD_SENSITIVE_FIELD');
    }
    visitAuditPayload(child, seen);
  }
  seen.delete(value);
}

function chainHash(previousHash: Buffer, sequence: string, eventPayloadHash: Buffer): Buffer {
  return canonicalSha256({
    eventPayloadHash: digestHex(eventPayloadHash),
    previousHash: digestHex(previousHash),
    sequence,
  });
}
