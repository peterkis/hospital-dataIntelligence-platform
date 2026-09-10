import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { ConsumerMetricFact } from '../../platform/observability/consumer-metrics.js';
import { evaluateConsumerSla, type ConsumerSla } from './consumer-sla.js';

export function checkpointLagSeconds(latest: string, appliedOrFirstEligible: string): string {
  const difference = BigInt(latest) - BigInt(appliedOrFirstEligible);
  return difference <= 0n ? '0' : `${difference / 1_000_000n}.${(difference % 1_000_000n).toString().padStart(6, '0')}`;
}

export async function readReleaseConsumerMetricFacts(database: Kysely<DB>): Promise<ConsumerMetricFact[]> {
  const releases = await sql<{ projectionType: string; projectionSchemaVersion: string; value: string }>`
    select snapshot.projection_type as "projectionType", snapshot.projection_schema_version as "projectionSchemaVersion", count(distinct release.release_id)::text value
    from release_distribution.governance_release release
    join release_distribution.release_snapshot snapshot on snapshot.release_id = release.release_id
    join release_distribution.outbox_event event on event.release_id = release.release_id
    where event.event_type = 'PUBLISHED'
    group by snapshot.projection_type, snapshot.projection_schema_version`.execute(database);
  const facts: ConsumerMetricFact[] = releases.rows.map(row => ({ ...row, name: 'release_publish_total', labels: {} }));
  // Stream order chooses each endpoint. Absolute microseconds measure the gap.
  // Group equal operational inputs in SQL: IDs stay inside the database.
  const states = await sql<{ projectionType: string; projectionSchemaVersion: string; criticality: ConsumerSla['criticality'];
    expected: number; retry: number | null; latest: string; baseline: string; pending: string | null; now: string; hasApplied: boolean; count: string }>`
    select latest.projection_type as "projectionType", latest.projection_schema_version as "projectionSchemaVersion",
      version.criticality, version.expected_apply_within_seconds expected, version.retry_window_seconds retry,
      (extract(epoch from (latest.created_at at time zone 'Asia/Shanghai')) * 1000000)::bigint::text latest,
      (extract(epoch from (coalesce(applied.created_at, first_event.created_at) at time zone 'Asia/Shanghai')) * 1000000)::bigint::text baseline,
      (extract(epoch from (pending.created_at at time zone 'Asia/Shanghai')) * 1000000)::bigint::text pending,
      (extract(epoch from (platform.local_now() at time zone 'Asia/Shanghai')) * 1000000)::bigint::text now,
      applied.created_at is not null as "hasApplied", count(*)::text count
    from release_distribution.consumer_subscription sub
    join lateral (select * from release_distribution.consumer_subscription_version v
      where v.consumer_subscription_id = sub.consumer_subscription_id order by version_no desc limit 1) version on true
    left join release_distribution.consumer_checkpoint cp on cp.consumer_subscription_id = sub.consumer_subscription_id
      and cp.governance_object_id = sub.governance_object_id
    join lateral (select e.* from release_distribution.outbox_delivery d join release_distribution.outbox_event e using(event_id)
      where d.consumer_subscription_id = sub.consumer_subscription_id and e.aggregate_id = sub.governance_object_id
      order by e.aggregate_version desc limit 1) latest on true
    join lateral (select e.created_at from release_distribution.outbox_delivery d join release_distribution.outbox_event e using(event_id)
      where d.consumer_subscription_id = sub.consumer_subscription_id and e.aggregate_id = sub.governance_object_id
      order by e.aggregate_version limit 1) first_event on true
    left join lateral (select e.created_at from release_distribution.outbox_delivery d join release_distribution.outbox_event e using(event_id)
      where d.consumer_subscription_id = sub.consumer_subscription_id and e.aggregate_id = sub.governance_object_id
        and e.aggregate_version > coalesce(cp.applied_aggregate_version, 0) order by e.aggregate_version limit 1) pending on true
    left join lateral (select e.created_at from release_distribution.outbox_delivery d join release_distribution.outbox_event e using(event_id)
      join release_distribution.consumer_receipt r on r.event_id = e.event_id and r.consumer_subscription_id = d.consumer_subscription_id
      where d.consumer_subscription_id = sub.consumer_subscription_id and e.aggregate_id = sub.governance_object_id
        and e.aggregate_version = cp.applied_aggregate_version and r.receive_result = 'ACCEPTED' and r.validation_result = 'VALID'
        and r.apply_result = 'APPLIED' and r.processing_digest = e.snapshot_artifact_digest order by r.receipt_sequence limit 1) applied on true
    where sub.lifecycle_status = 'ACTIVE' and version.expected_apply_within_seconds is not null
    group by latest.projection_type, latest.projection_schema_version, version.criticality, version.expected_apply_within_seconds,
      version.retry_window_seconds, latest.created_at, applied.created_at, first_event.created_at, pending.created_at
  `.execute(database);
  for (const row of states.rows) {
    const labels = { criticality: row.criticality };
    const pair = { projectionType: row.projectionType, projectionSchemaVersion: row.projectionSchemaVersion, labels };
    const state = evaluateConsumerSla({ lifecycle: 'ACTIVE', sla: { criticality: row.criticality,
      expectedApplyWithinSeconds: row.expected, retryWindowSeconds: row.retry },
      nowEpochMicroseconds: row.now, oldestPendingEpochMicroseconds: row.pending, hasApplied: row.hasApplied });
    facts.push({ ...pair, name: 'consumer_checkpoint_lag_seconds', value: checkpointLagSeconds(row.latest, row.baseline) },
      { ...pair, name: 'consumer_sla_breached', value: state.applyOverdue ? row.count : '0' });
  }
  return facts;
}
