import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { evaluateConsumerSla, normalizeConsumerSla } from './consumer-sla.js';
import type { ConsumerSubscriptionLifecycleStatus } from './subscription-lifecycle.js';

// Explicit IANA interpretation of ADR-0074 storage. Only absolute instants enter
// SLA arithmetic; the result is an exact integer string, never a driver Date.
function epochMicroseconds(local: RawBuilder<unknown>) {
  return sql<string>`(extract(epoch from (${local} at time zone 'Asia/Shanghai')) * 1000000)::bigint::text`;
}

export async function readConsumerOperationalView(database: Kysely<DB>, input: {
  subscriptionId: string; subscriptionVersionId?: string; governanceObjectId: string;
  lifecycle: ConsumerSubscriptionLifecycleStatus; evaluatedAt: string;
}) {
  parseLocalDateTime(input.evaluatedAt);
  let query = database.selectFrom('release_distribution.consumer_subscription_version')
    .selectAll().where('consumer_subscription_id', '=', input.subscriptionId);
  if (input.subscriptionVersionId) query = query.where('consumer_subscription_version_id', '=', input.subscriptionVersionId);
  const version = await query.orderBy('version_no', 'desc').limit(1).executeTakeFirst();
  if (!version) throw new Error('CONSUMER_SUBSCRIPTION_VERSION_NOT_FOUND');
  const sla = normalizeConsumerSla({ criticality: version.criticality,
    ...(version.expected_apply_within_seconds === null ? {} : { expectedApplyWithinSeconds: version.expected_apply_within_seconds }),
    ...(version.retry_window_seconds === null ? {} : { retryWindowSeconds: version.retry_window_seconds }),
  });
  const checkpoint = await database.selectFrom('release_distribution.consumer_checkpoint')
    .selectAll().where('consumer_subscription_id', '=', input.subscriptionId)
    .where('governance_object_id', '=', input.governanceObjectId).executeTakeFirst();
  const events = database.selectFrom('release_distribution.outbox_delivery as delivery')
    .innerJoin('release_distribution.outbox_event as event', 'event.event_id', 'delivery.event_id')
    .where('delivery.consumer_subscription_id', '=', input.subscriptionId)
    .where('event.aggregate_id', '=', input.governanceObjectId);
  const columns = ['event.release_id as releaseId', 'event.aggregate_version as releaseNo',
    'event.created_at as publishedAt'] as const;
  const latestRelease = await events.select(columns).orderBy('event.aggregate_version', 'desc').limit(1).executeTakeFirst();
  const pending = await events.select(columns)
    .select(epochMicroseconds(sql.ref('event.created_at')).as('epochMicroseconds'))
    .where('event.aggregate_version', '>', checkpoint?.applied_aggregate_version ?? '0')
    .orderBy('event.aggregate_version').limit(1).executeTakeFirst();
  // Checkpoint identifies the authoritative applied release. For that event use
  // the FIRST valid APPLIED receipt by sequence: retries cannot refresh success.
  const success = checkpoint ? await events
    .innerJoin('release_distribution.consumer_receipt as receipt', (join) => join
      .onRef('receipt.event_id', '=', 'event.event_id')
      .onRef('receipt.consumer_subscription_id', '=', 'delivery.consumer_subscription_id'))
    .select(['event.release_id as releaseId', 'event.aggregate_version as releaseNo',
      'receipt.created_at as recordedAt'])
    .where('event.aggregate_version', '=', checkpoint.applied_aggregate_version)
    .where('receipt.receive_result', '=', 'ACCEPTED').where('receipt.validation_result', '=', 'VALID')
    .where('receipt.apply_result', '=', 'APPLIED')
    .whereRef('receipt.processing_digest', '=', 'event.snapshot_artifact_digest')
    .orderBy('receipt.receipt_sequence').limit(1).executeTakeFirst() : undefined;
  const clock = await database.selectNoFrom(epochMicroseconds(sql`${input.evaluatedAt}::timestamp`).as('now')).executeTakeFirstOrThrow();
  return {
    subscriptionId: input.subscriptionId, subscriptionVersionId: version.consumer_subscription_version_id,
    versionNo: version.version_no, lifecycleStatus: input.lifecycle, sla,
    ...evaluateConsumerSla({ lifecycle: input.lifecycle, sla, nowEpochMicroseconds: clock.now,
      oldestPendingEpochMicroseconds: pending?.epochMicroseconds ?? null, hasApplied: success !== undefined }),
    evaluatedAt: input.evaluatedAt, timezone: 'Asia/Shanghai' as const,
    latestRelease: latestRelease ?? null,
    oldestPendingRelease: pending ? { releaseId: pending.releaseId, releaseNo: pending.releaseNo, publishedAt: pending.publishedAt } : null,
    lastSuccessfulApply: success ?? null,
    latestCheckpoint: checkpoint ? { appliedReleaseNo: checkpoint.applied_aggregate_version, recordedAt: checkpoint.updated_at } : null,
  };
}
