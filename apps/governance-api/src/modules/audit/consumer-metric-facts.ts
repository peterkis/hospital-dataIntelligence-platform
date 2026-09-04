import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { ConsumerMetricFact } from '../../platform/observability/consumer-metrics.js';

// Audit owns the query. No evidence IDs, raw errors or free text leave this seam.
export async function readConsumerAuditMetricFacts(database: Kysely<DB>): Promise<ConsumerMetricFact[]> {
  const result = await sql<ConsumerMetricFact>`
    with evidence as (
      select action, audit_stream_id, stable_entity_id, event_payload p
      from audit.audit_event where event_payload->>'evidenceKind' = 'CONSUMER_RELEASE'
    ), facts as (
      select distinct 'consumer_apply_total' name, audit_stream_id,
        p->>'releaseId' release, p->>'mode' mode,
        case when p->>'mode' = 'REPLAY' then p->>'operationId' else p->>'releaseId' end identity,
        p->>'projectionType' projection, p->>'projectionSchemaVersion' version,
        jsonb_build_object('mode', case when p->>'mode' = 'REPLAY' then 'replay' else 'normal' end, 'result', 'success') labels
      from evidence where action = 'CONSUMER_RECEIPT_ACCEPTED' and p->>'source' = 'PLATFORM'
        and p->>'receiptApplyResult' = 'APPLIED'
      union all
      select 'consumer_apply_total', audit_stream_id, p->>'releaseId', p->>'mode', stable_entity_id::text,
        p->>'projectionType', p->>'projectionSchemaVersion',
        jsonb_build_object('mode', case when p->>'mode' = 'REPLAY' then 'replay' else 'normal' end, 'result', 'failed')
      from evidence where action = 'CONSUMER_APPLY_FAILED'
      union all
      select 'consumer_digest_failure_total', audit_stream_id, p->>'releaseId', p->>'mode', stable_entity_id::text,
        p->>'projectionType', p->>'projectionSchemaVersion', jsonb_build_object(
          'mode', case when p->>'mode' = 'REPLAY' then 'replay' else 'normal' end,
          'bounded_reason', case p->>'failureCode' when 'DIGEST_MISMATCH' then 'content_digest_mismatch'
            when 'SCHEMA_DIGEST_MISMATCH' then 'schema_digest_mismatch' else 'processing_digest_mismatch' end)
      from evidence where action in ('CONSUMER_SNAPSHOT_VERIFICATION_FAILED', 'CONSUMER_RECEIPT_REJECTED')
        and p->>'failureCode' in ('DIGEST_MISMATCH', 'SCHEMA_DIGEST_MISMATCH', 'PROCESSING_DIGEST_MISMATCH')
      union all
      select distinct 'consumer_replay_total', audit_stream_id, p->>'releaseId', p->>'mode', p->>'attemptId',
        p->>'projectionType', p->>'projectionSchemaVersion', jsonb_build_object('mode', 'replay',
          'result', case when action = 'CONSUMER_REPLAY_COMPLETED' then 'success' else 'failed' end)
      from evidence where action in ('CONSUMER_REPLAY_COMPLETED', 'CONSUMER_REPLAY_FAILED') and p->>'mode' = 'REPLAY'
    ) select name, coalesce(projection, 'unknown') as "projectionType", coalesce(version, 'unknown') as "projectionSchemaVersion",
      labels, count(*)::text value from facts group by name, projection, version, labels
  `.execute(database);
  return result.rows;
}
