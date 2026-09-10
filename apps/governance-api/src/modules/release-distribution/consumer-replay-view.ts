import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';

// Caller has locked and authorized the ACTIVE subscription. This read never
// offers a delivery, generates an artifact, or consults current domain tables.
export async function readConsumerReplayView(database: Kysely<DB>, input: {
  subscriptionId: string; releaseId: string; servicePrincipalId: string;
}) {
  const result = await sql<{
    eventId: string; governanceObjectId: string; aggregateVersion: string; releaseId: string; snapshotId: string;
    projectionType: string; projectionSchemaVersion: string; projectionSchemaDigest: string;
    projectionPayloadDigest: string; snapshotArtifactDigest: string;
    subscriptionVersionId: string; versionNo: string; supportDigest: string;
  }>`select event.event_id as "eventId", event.aggregate_id as "governanceObjectId",
    event.aggregate_version::text as "aggregateVersion", event.release_id as "releaseId",
    event.release_snapshot_id as "snapshotId", event.projection_type as "projectionType",
    event.projection_schema_version as "projectionSchemaVersion",
    encode(event.projection_schema_digest, 'hex') as "projectionSchemaDigest",
    encode(event.projection_payload_digest, 'hex') as "projectionPayloadDigest",
    encode(event.snapshot_artifact_digest, 'hex') as "snapshotArtifactDigest",
    version.consumer_subscription_version_id as "subscriptionVersionId", version.version_no::text as "versionNo",
    encode(support.projection_schema_digest, 'hex') as "supportDigest"
    from release_distribution.outbox_delivery delivery
    join release_distribution.outbox_event event on event.event_id = delivery.event_id
    join lateral (select compatibility_id, delivery_status from release_distribution.outbox_delivery_state
      where outbox_delivery_id = delivery.outbox_delivery_id order by state_sequence desc limit 1) state on true
    join release_distribution.release_consumer_compatibility compatibility
      on compatibility.release_consumer_compatibility_id = state.compatibility_id
    join release_distribution.consumer_subscription_version version
      on version.consumer_subscription_version_id = compatibility.consumer_subscription_version_id
      and version.consumer_subscription_id = delivery.consumer_subscription_id
    join release_distribution.consumer_projection_support support
      on support.consumer_subscription_version_id = version.consumer_subscription_version_id
      and support.projection_type = event.projection_type and support.projection_schema_version = event.projection_schema_version
    where delivery.consumer_subscription_id = ${input.subscriptionId} and event.release_id = ${input.releaseId}
      and compatibility.result = 'SUPPORTED'
      and state.delivery_status in ('PENDING', 'LEASED', 'NOTIFIED', 'DELIVERED', 'ATTENTION_REQUIRED')
    limit 1`.execute(database);
  const row = result.rows[0];
  // Identical missing / foreign / incompatible release result: no foreign lookup.
  if (!row) throw new Error('CONSUMER_EVENT_NOT_AVAILABLE');
  const { subscriptionVersionId, versionNo, supportDigest, ...event } = row;
  const receipts = database.selectFrom('release_distribution.consumer_receipt')
    .where('consumer_subscription_id', '=', input.subscriptionId).where('event_id', '=', event.eventId);
  const receiptFields = ['consumer_receipt_id as receiptId', 'receipt_sequence as receiptSequence',
    'receive_result as receiveResult', 'validation_result as validationResult', 'apply_result as applyResult',
    'processing_digest as processingDigest'] as const;
  const latest = await receipts.select(receiptFields).orderBy('receipt_sequence', 'desc').limit(1).executeTakeFirst();
  const applied = await receipts.select(receiptFields).where('apply_result', '=', 'APPLIED')
    .where('receive_result', '=', 'ACCEPTED').where('validation_result', '=', 'VALID')
    .orderBy('receipt_sequence').limit(1).executeTakeFirst();
  const mismatch = await receipts.select('consumer_receipt_id').where('apply_result', '=', 'APPLIED')
    .where('processing_digest', '!=', Buffer.from(event.snapshotArtifactDigest, 'hex')).limit(1).executeTakeFirst();
  const checkpoint = await database.selectFrom('release_distribution.consumer_checkpoint')
    .select(['applied_aggregate_version as appliedAggregateVersion', 'updated_at as recordedAt'])
    .where('consumer_subscription_id', '=', input.subscriptionId).where('governance_object_id', '=', event.governanceObjectId)
    .executeTakeFirst();
  const receipt = (value: typeof latest) => {
    if (!value) return null;
    if ((value.receiveResult !== 'ACCEPTED' && value.receiveResult !== 'REJECTED') ||
        (value.validationResult !== 'VALID' && value.validationResult !== 'INVALID') ||
        (value.applyResult !== 'APPLIED' && value.applyResult !== 'NOT_APPLIED')) throw new Error('CONSUMER_RECEIPT_RESULT_INCOHERENT');
    return { ...value, receiveResult: value.receiveResult, validationResult: value.validationResult,
      applyResult: value.applyResult, processingDigest: value.processingDigest.toString('hex') } as const;
  };
  return { subscriptionId: input.subscriptionId, servicePrincipalId: input.servicePrincipalId, lifecycleStatus: 'ACTIVE' as const,
    subscriptionVersion: { subscriptionVersionId, versionNo, projectionType: event.projectionType,
      projectionSchemaVersion: event.projectionSchemaVersion, projectionSchemaDigest: supportDigest }, event,
    checkpoint: checkpoint ?? { appliedAggregateVersion: '0', recordedAt: null },
    latestReceipt: receipt(latest), appliedReceipt: receipt(applied), processingDigestMismatch: Boolean(mismatch) };
}
