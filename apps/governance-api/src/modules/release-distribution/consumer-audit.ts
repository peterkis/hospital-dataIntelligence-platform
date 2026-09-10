import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { createAuditModule, CONSUMER_AUDIT_STAGES, CONSUMER_AUDIT_EVENTS, CONSUMER_FAILURE_CODES, CONSUMER_REPORT_EVENTS,
  type AppendGovernanceAuditEventCommand, type AuditModule, type ConsumerAuditStage, type ConsumerAuditEvent, type ConsumerAuditReport, type ConsumerFailureCode } from '../audit/index.js';

export interface ConsumerAuditQuery {
  subscriptionId: string; afterSequence?: string; limit?: number; releaseId?: string;
  projectionType?: string; eventType?: ConsumerAuditEvent; result?: 'SUCCEEDED' | 'FAILED' | 'REQUESTED';
  occurredFrom?: string; occurredTo?: string;
}
export interface ConsumerReleaseEvidence {
  evidenceKind: 'CONSUMER_RELEASE'; subscriptionId: string; subscriptionVersionId: string | null;
  subscriptionVersion: string | null; servicePrincipalId: string; governanceObjectId: string;
  projectionType: string | null; projectionSchemaVersion: string | null; releaseId: string | null;
  eventId: string | null; result: 'SUCCEEDED' | 'FAILED' | 'REQUESTED'; failureCode: ConsumerFailureCode | null;
  stage?: ConsumerAuditStage; source: 'CONSUMER_REPORTED' | 'PLATFORM'; mode: 'ORIGINAL' | 'REPLAY'; operationId: string | null;
  attemptId: string | null; checkpoint: string; receiptId: string | null; receiptApplyResult: string | null;
  snapshotDigest: string | null; consumerOccurredAt: string | null;
}

export function createConsumerAudit(database: Kysely<DB>, audit: AuditModule, context: RequestContext) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const requestId = uuid.test(context.requestId) ? context.requestId : randomUUID();
  const correlationId = uuid.test(context.correlationId) ? context.correlationId : requestId;
  const evidenceAudit = createAuditModule(database, { ...context, requestId, correlationId });
  async function subscription(subscriptionId: string, enforceOwner = true) {
    const row = await database.selectFrom('release_distribution.consumer_subscription').selectAll()
      .where('consumer_subscription_id', '=', subscriptionId).forUpdate().executeTakeFirst();
    if (!row) throw new Error('CONSUMER_SUBSCRIPTION_NOT_FOUND');
    if (enforceOwner && row.service_principal_id !== context.actorPrincipalId) throw new Error('CONSUMER_SUBSCRIPTION_FORBIDDEN');
    return row;
  }
  async function append(input: { subscriptionId: string; releaseId?: string; eventId?: string; evidenceId: string;
    eventType: ConsumerAuditEvent; source: 'CONSUMER_REPORTED' | 'PLATFORM'; mode: 'ORIGINAL' | 'REPLAY';
    operationId?: string; attemptId?: string; occurredAt?: string; failureCode?: ConsumerFailureCode; failureStage?: ConsumerAuditStage;
    receiptId?: string; receiptApplyResult?: string; denial?: boolean }) {
    const sub = await subscription(input.subscriptionId, !input.denial);
    // Resolve only assigned history, even for failures. Never borrow a foreign release's facts.
    const selected = await sql<{ releaseId: string; eventId: string; subscriptionVersionId: string;
      subscriptionVersion: string; projectionType: string; projectionSchemaVersion: string; snapshotDigest: string }>`
      select event.release_id as "releaseId", event.event_id as "eventId",
        version.consumer_subscription_version_id as "subscriptionVersionId", version.version_no::text as "subscriptionVersion",
        event.projection_type as "projectionType", event.projection_schema_version as "projectionSchemaVersion",
        encode(event.snapshot_artifact_digest, 'hex') as "snapshotDigest"
      from release_distribution.outbox_delivery delivery
      join release_distribution.outbox_event event on event.event_id = delivery.event_id
      join lateral (select compatibility_id from release_distribution.outbox_delivery_state
        where outbox_delivery_id = delivery.outbox_delivery_id order by state_sequence desc limit 1) state on true
      join release_distribution.release_consumer_compatibility compatibility
        on compatibility.release_consumer_compatibility_id = state.compatibility_id
      join release_distribution.consumer_subscription_version version
        on version.consumer_subscription_version_id = compatibility.consumer_subscription_version_id
      where delivery.consumer_subscription_id = ${input.subscriptionId}
        and (${input.releaseId ?? null}::uuid = event.release_id or ${input.eventId ?? null}::uuid = event.event_id)
      limit 1`.execute(database);
    const event = selected.rows[0];
    const failed = input.eventType.endsWith('_FAILED') || input.eventType.endsWith('_REJECTED') || input.eventType.endsWith('_DENIED');
    if (input.source === 'CONSUMER_REPORTED' && !event && !failed && input.eventType !== 'CONSUMER_REPLAY_REQUESTED') {
      throw new Error('CONSUMER_EVENT_NOT_AVAILABLE');
    }
    const checkpoint = await database.selectFrom('release_distribution.consumer_checkpoint').select('applied_aggregate_version')
      .where('consumer_subscription_id', '=', input.subscriptionId).where('governance_object_id', '=', sub.governance_object_id)
      .executeTakeFirst();
    const payload: ConsumerReleaseEvidence = {
      evidenceKind: 'CONSUMER_RELEASE', subscriptionId: input.subscriptionId,
      subscriptionVersionId: event?.subscriptionVersionId ?? null, subscriptionVersion: event?.subscriptionVersion ?? null,
      servicePrincipalId: sub.service_principal_id, governanceObjectId: sub.governance_object_id,
      projectionType: event?.projectionType ?? null, projectionSchemaVersion: event?.projectionSchemaVersion ?? null,
      releaseId: event?.releaseId ?? input.releaseId ?? null, eventId: event?.eventId ?? input.eventId ?? null,
      result: failed ? 'FAILED' : input.eventType === 'CONSUMER_REPLAY_REQUESTED' ? 'REQUESTED' : 'SUCCEEDED',
      stage: input.failureStage ?? (input.eventType.includes('RECEIPT') ? 'RECEIPT' : input.eventType.includes('SNAPSHOT') ? 'VERIFY' : input.eventType.includes('APPLY') ? 'APPLY' : input.eventType.includes('REPLAY') ? 'REPLAY' : 'OBSERVE'),
      failureCode: input.failureCode ?? null, source: input.source, mode: input.mode,
      operationId: input.operationId ?? null, attemptId: input.attemptId ?? null,
      checkpoint: checkpoint?.applied_aggregate_version ?? '0', receiptId: input.receiptId ?? null,
      receiptApplyResult: input.receiptApplyResult ?? null, snapshotDigest: event?.snapshotDigest ?? null, consumerOccurredAt: input.occurredAt ?? null,
    };
    // Subscription lock serializes deduplication and the existing hash-chain append.
    const prior = await audit.query({ auditStreamId: input.subscriptionId, governanceObjectId: sub.governance_object_id,
      stableEntityId: input.evidenceId, action: input.eventType, limit: 1 });
    if (prior[0]) {
      const previous = prior[0].payload;
      if (prior[0].actorId !== context.actorPrincipalId || previous['releaseId'] !== payload.releaseId ||
          previous['operationId'] !== payload.operationId || previous['failureCode'] !== payload.failureCode ||
          previous['source'] !== payload.source || previous['mode'] !== payload.mode ||
          previous['consumerOccurredAt'] !== payload.consumerOccurredAt ||
          (input.eventType !== 'CONSUMER_APPLY_SUCCEEDED' && previous['attemptId'] !== payload.attemptId)) throw new Error('CONSUMER_AUDIT_CONFLICT');
      return { auditEventId: prior[0].auditEventId, auditSequence: prior[0].auditSequence };
    }
    // Platform occurrence/recording time and consumer-reported time remain distinguishable.
    const result = await evidenceAudit.append({ auditStreamId: input.subscriptionId, governanceObjectId: sub.governance_object_id,
      eventType: input.eventType, aggregateType: 'CONSUMER_SUBSCRIPTION', aggregateId: input.evidenceId,
      aggregateVersionId: event?.subscriptionVersionId ?? null, afterHash: null, authorityScope: 'HOSPITAL', payload: { ...payload } }).catch(() => { throw new Error('CONSUMER_AUDIT_UNAVAILABLE'); });
    return { auditEventId: result.auditEventId, auditSequence: result.auditSequence };
  }
  return {
    append,
    appendLegacyReplay(command: AppendGovernanceAuditEventCommand) {
      return evidenceAudit.append(command).catch(() => { throw new Error('CONSUMER_AUDIT_UNAVAILABLE'); });
    },
    async report(subscriptionId: string, report: ConsumerAuditReport) {
      parseLocalDateTime(report.occurredAt);
      const failed = report.eventType.endsWith('_FAILED');
      if (![report.evidenceId, report.releaseId, ...(report.operationId ? [report.operationId] : []),
        ...(report.attemptId ? [report.attemptId] : [])].every(value => uuid.test(value)) ||
          !['ORIGINAL', 'REPLAY'].includes(report.mode) ||
          (report.failureStage && !CONSUMER_AUDIT_STAGES.includes(report.failureStage)) ||
          !CONSUMER_REPORT_EVENTS.includes(report.eventType) || failed !== Boolean(report.failureCode) || (!failed && report.failureStage !== undefined) ||
          (report.failureCode && !CONSUMER_FAILURE_CODES.includes(report.failureCode)) ||
          (report.mode === 'REPLAY' ? !report.operationId || !report.attemptId : report.operationId || report.attemptId) ||
          (report.eventType.startsWith('CONSUMER_REPLAY_') && report.mode !== 'REPLAY')) throw new Error('REQUEST_SCHEMA_INVALID');
      // Do not let an untyped module caller supply internal receipt/denial fields.
      return append({ subscriptionId, source: 'CONSUMER_REPORTED', evidenceId: report.evidenceId,
        releaseId: report.releaseId, eventType: report.eventType, mode: report.mode, occurredAt: report.occurredAt,
        ...(report.operationId ? { operationId: report.operationId } : {}),
        ...(report.attemptId ? { attemptId: report.attemptId } : {}),
        ...(report.failureCode ? { failureCode: report.failureCode } : {}),
        ...(report.failureStage ? { failureStage: report.failureStage } : {}) });
    },
    async query(input: ConsumerAuditQuery) {
      const sub = await subscription(input.subscriptionId);
      const limit = input.limit ?? 50;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 ||
          (input.afterSequence !== undefined && (!/^(?:0|[1-9]\d{0,18})$/u.test(input.afterSequence) || BigInt(input.afterSequence) > 9223372036854775807n)) ||
          (input.eventType && !CONSUMER_AUDIT_EVENTS.includes(input.eventType)) ||
          Boolean(input.occurredFrom) !== Boolean(input.occurredTo)) throw new Error('REQUEST_SCHEMA_INVALID');
      if (input.occurredFrom && input.occurredTo) {
        parseLocalDateTime(input.occurredFrom); parseLocalDateTime(input.occurredTo);
        const span = Date.parse(`${input.occurredTo}+08:00`) - Date.parse(`${input.occurredFrom}+08:00`);
        if (span < 0 || span > 31 * 86_400_000) throw new Error('REQUEST_SCHEMA_INVALID');
      }
      const rows = await audit.query({ ...input, auditStreamId: input.subscriptionId, governanceObjectId: sub.governance_object_id,
        consumerReleaseOnly: true, ...(input.eventType ? { action: input.eventType } : {}), limit: limit + 1 });
      const events = rows.slice(0, limit).map(row => ({ auditEventId: row.auditEventId, auditSequence: row.auditSequence,
        eventType: row.eventType as ConsumerAuditEvent, actorPrincipalId: row.actorPrincipalId,
        occurredAt: row.occurredAt, recordedAt: row.recordedAt, requestId: row.requestId, correlationId: row.correlationId,
        previousHash: row.previousHash.toString('hex'), currentHash: row.currentHash.toString('hex'),
        evidence: row.payload as unknown as ConsumerReleaseEvidence }));
      return { events, nextAfterSequence: rows.length > limit ? events.at(-1)!.auditSequence : null };
    },
  };
}
