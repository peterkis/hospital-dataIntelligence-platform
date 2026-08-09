import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';

export const AUDIT_MODULE_ID = 'audit' as const;

const ZERO_HASH = Buffer.alloc(32);

export interface AppendAuditEventCommand {
  readonly auditStreamId: string;
  readonly governanceObjectId: string;
  readonly entityType:
    | 'CHARGE_ITEM_VERSION'
    | 'PRICE_LIST_RELEASE'
    | 'PRICE_RESOLUTION'
    | 'IMPORT_JOB'
    | 'CHANGE_REQUEST'
    | 'IMPACT_CASE'
    | 'DELIVERY';
  readonly stableEntityId: string;
  readonly entityVersionId: string | null;
  readonly action:
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
    | 'PUBLISHED'
    | 'RESOLVED';
  readonly afterHash: Buffer | null;
  readonly authorityScope: string;
}

export interface AuditModule {
  append(command: AppendAuditEventCommand): Promise<{
    readonly auditEventId: string;
    readonly auditSequence: string;
    readonly currentHash: Buffer;
  }>;
  verifyChain(auditStreamId: string): Promise<boolean>;
  verifyChainDetailed(auditStreamId: string): Promise<{
    readonly valid: boolean;
    readonly eventCount: number;
    readonly firstMismatchSequence: string | null;
    readonly errorType: 'SEQUENCE' | 'PAYLOAD_HASH' | 'PREVIOUS_HASH' | 'CURRENT_HASH' | null;
  }>;
  query(command: {
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
    readonly entityType: string;
    readonly stableEntityId: string;
    readonly entityVersionId: string | null;
    readonly action: string;
    readonly actorPrincipalId: string;
    readonly occurredAt: string;
    readonly requestId: string;
    readonly correlationId: string;
    readonly previousHash: Buffer;
    readonly currentHash: Buffer;
  }[]>;
}

export function createAuditModule(
  database: Kysely<DB>,
  context: RequestContext,
): AuditModule {
  return {
    async append(command) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${command.auditStreamId}, 47))`.execute(
        database,
      );
      const previous = await database
        .selectFrom('audit.audit_event')
        .select(['audit_sequence', 'current_hash'])
        .where('audit_stream_id', '=', command.auditStreamId)
        .orderBy('audit_sequence', 'desc')
        .limit(1)
        .executeTakeFirst();
      const auditSequence = (BigInt(previous?.audit_sequence ?? '0') + 1n).toString();
      const previousHash = previous?.current_hash ?? ZERO_HASH;
      const eventPayloadHash = canonicalSha256({
        action: command.action,
        actorPrincipalId: context.actorPrincipalId,
        afterHash: command.afterHash ? digestHex(command.afterHash) : null,
        authorityScope: command.authorityScope,
        correlationId: context.correlationId,
        entityType: command.entityType,
        entityVersionId: command.entityVersionId,
        governanceObjectId: command.governanceObjectId,
        occurredAt: context.occurredAt,
        requestId: context.requestId,
        stableEntityId: command.stableEntityId,
      });
      const currentHash = chainHash(previousHash, auditSequence, eventPayloadHash);
      const event = await database
        .insertInto('audit.audit_event')
        .values({
          audit_stream_id: command.auditStreamId,
          audit_sequence: auditSequence,
          governance_object_id: command.governanceObjectId,
          entity_type: command.entityType,
          stable_entity_id: command.stableEntityId,
          entity_version_id: command.entityVersionId,
          action: command.action,
          after_hash: command.afterHash,
          actor_principal_id: context.actorPrincipalId,
          authority_scope: command.authorityScope,
          occurred_at: context.occurredAt,
          request_id: context.requestId,
          correlation_id: context.correlationId,
          event_payload_hash: eventPayloadHash,
          previous_hash: previousHash,
          current_hash: currentHash,
        })
        .returning('audit_event_id')
        .executeTakeFirstOrThrow();
      hitControlledPublicationFault('AUDIT_EVENT_WRITTEN');
      return {
        auditEventId: event.audit_event_id,
        auditSequence,
        currentHash,
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
          'entity_type as entityType',
          'stable_entity_id as stableEntityId',
          'entity_version_id as entityVersionId',
          'action',
          'actor_principal_id as actorPrincipalId',
          'occurred_at as occurredAt',
          'request_id as requestId',
          'correlation_id as correlationId',
          'previous_hash as previousHash',
          'current_hash as currentHash',
        ])
        .where('governance_object_id', '=', command.governanceObjectId);
      if (command.stableEntityId) query = query.where('stable_entity_id', '=', command.stableEntityId);
      if (command.entityVersionId) query = query.where('entity_version_id', '=', command.entityVersionId);
      if (command.requestId) query = query.where('request_id', '=', command.requestId);
      if (command.action) query = query.where('action', '=', command.action);
      if (command.actorPrincipalId) query = query.where('actor_principal_id', '=', command.actorPrincipalId);
      if (command.sequenceFrom) query = query.where('audit_sequence', '>=', command.sequenceFrom);
      if (command.sequenceTo) query = query.where('audit_sequence', '<=', command.sequenceTo);
      return query.orderBy('audit_stream_id').orderBy('audit_sequence').limit(command.limit).execute();
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

function chainHash(previousHash: Buffer, sequence: string, eventPayloadHash: Buffer): Buffer {
  return canonicalSha256({
    eventPayloadHash: digestHex(eventPayloadHash),
    previousHash: digestHex(previousHash),
    sequence,
  });
}
