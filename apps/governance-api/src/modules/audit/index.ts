import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';

export const AUDIT_MODULE_ID = 'audit' as const;

const ZERO_HASH = Buffer.alloc(32);

export interface AppendAuditEventCommand {
  readonly auditStreamId: string;
  readonly governanceObjectId: string;
  readonly entityType: 'CHARGE_ITEM_VERSION' | 'PRICE_LIST_RELEASE' | 'PRICE_RESOLUTION';
  readonly stableEntityId: string;
  readonly entityVersionId: string | null;
  readonly action: 'PUBLISHED' | 'RESOLVED';
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
      return {
        auditEventId: event.audit_event_id,
        auditSequence,
        currentHash,
      };
    },

    async verifyChain(auditStreamId) {
      const events = await database
        .selectFrom('audit.audit_event')
        .select(['audit_sequence', 'event_payload_hash', 'previous_hash', 'current_hash'])
        .where('audit_stream_id', '=', auditStreamId)
        .orderBy('audit_sequence', 'asc')
        .execute();
      let previousHash: Buffer<ArrayBufferLike> = ZERO_HASH;
      let expectedSequence = 1n;
      for (const event of events) {
        if (BigInt(event.audit_sequence) !== expectedSequence) return false;
        if (!event.previous_hash.equals(previousHash)) return false;
        const expectedHash = chainHash(previousHash, event.audit_sequence, event.event_payload_hash);
        if (!event.current_hash.equals(expectedHash)) return false;
        previousHash = event.current_hash;
        expectedSequence += 1n;
      }
      return true;
    },
  };
}

function chainHash(previousHash: Buffer, sequence: string, eventPayloadHash: Buffer): Buffer {
  return canonicalSha256({
    eventPayloadHash: digestHex(eventPayloadHash),
    previousHash: digestHex(previousHash),
    sequence,
  });
}
