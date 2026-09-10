import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { ConsumerReferenceReader } from '../../platform/release-consumer/consumer-reference-reader.js';
import { lockSubscription } from './subscription-lifecycle.js';
import {
  hitControlledPublicationFault,
  isControlledFaultActive,
} from '../../platform/fault-injection/controlled-faults.js';

export interface ReleaseNotification {
  readonly subscriptionId: string;
  readonly servicePrincipalId: string;
  readonly eventId: string;
  readonly governanceObjectId: string;
  readonly aggregateVersion: string;
  readonly releaseId: string;
  readonly snapshotId: string;
  readonly eventType: string;
  readonly projectionType: string;
  readonly projectionSchemaVersion: string;
  readonly projectionSchemaDigest: Buffer;
  readonly projectionPayloadDigest: Buffer;
  readonly snapshotArtifactDigest: Buffer;
}

export interface ReleaseNotificationTransport {
  deliver(notification: ReleaseNotification): Promise<{
    readonly responseDigest: Buffer | null;
  }>;
}

export class ReleaseNotificationError extends Error {
  constructor(
    readonly errorCode: string,
    readonly retryable: boolean,
    readonly responseDigest: Buffer | null = null,
  ) {
    super(errorCode);
  }
}

export interface ReleaseDistributionDispatcher {
  dispatchOnce(): Promise<
    | { readonly claimed: false }
    | {
        readonly claimed: true;
        readonly eventId: string;
        readonly result: 'NOTIFICATION_ACCEPTED' | 'RETRYABLE_FAILURE' | 'FATAL_FAILURE';
      }
  >;
  start(): void;
  wake(): void;
  stop(): Promise<void>;
}

interface ClaimedDelivery extends ReleaseNotification {
  readonly compatibilityId: string;
  readonly deliveryId: string;
  readonly leasedStateId: string;
  readonly leasedStateSequence: string;
}

export function createReleaseDistributionDispatcher(
  database: Kysely<DB>,
  transport: ReleaseNotificationTransport,
  options: {
    readonly workerId: string;
    readonly leaseSeconds: number;
    readonly retryDelaySeconds: number;
    readonly maxNotificationAttempts: number;
    readonly pollIntervalMilliseconds: number;
    now(): string;
    references(transaction: Transaction<DB>): ConsumerReferenceReader;
  },
): ReleaseDistributionDispatcher {
  validateOptions(options);
  let stopped = true;
  let running: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let wakeRequested = false;

  async function dispatchOnce(): Promise<
    | { readonly claimed: false }
    | {
        readonly claimed: true;
        readonly eventId: string;
        readonly result: 'NOTIFICATION_ACCEPTED' | 'RETRYABLE_FAILURE' | 'FATAL_FAILURE';
      }
  > {
    const occurredAt = options.now();
    const claimed = await database.transaction().execute((transaction) =>
      claimNextDelivery(transaction, occurredAt, options.workerId, options.leaseSeconds, options.references(transaction)),
    );
    if (!claimed) return { claimed: false };
    hitControlledPublicationFault('OUTBOX_AFTER_CLAIM');

    const eligible = await database.transaction().execute(async (transaction) => {
      const subscription = await lockSubscription(transaction, claimed.subscriptionId);
      return subscription.lifecycle_status === 'ACTIVE'
        && await options.references(transaction).isActiveServicePrincipal(claimed.servicePrincipalId);
    });
    if (!eligible) return { claimed: false };

    let outcome:
      | {
          readonly result: 'NOTIFICATION_ACCEPTED';
          readonly errorCode: null;
          readonly responseDigest: Buffer | null;
        }
      | {
          readonly result: 'RETRYABLE_FAILURE' | 'FATAL_FAILURE';
          readonly errorCode: string;
          readonly responseDigest: Buffer | null;
        };
    try {
      const response = await transport.deliver(claimed);
      outcome = {
        result: 'NOTIFICATION_ACCEPTED',
        errorCode: null,
        responseDigest: response.responseDigest,
      };
    } catch (error) {
      const classified = classifyNotificationError(error);
      outcome = {
        result: classified.retryable ? 'RETRYABLE_FAILURE' : 'FATAL_FAILURE',
        errorCode: classified.errorCode,
        responseDigest: classified.responseDigest,
      };
    }
    hitControlledPublicationFault('OUTBOX_AFTER_NOTIFICATION');

    await database.transaction().execute((transaction) =>
      recordDeliveryOutcome(
        transaction,
        claimed,
        outcome,
        options.now(),
        options.retryDelaySeconds,
        options.maxNotificationAttempts,
        options.workerId,
        options.references(transaction),
      ),
    );
    return { claimed: true, eventId: claimed.eventId, result: outcome.result };
  }

  async function pump(): Promise<void> {
    if (running) return running;
    running = (async () => {
      do {
        wakeRequested = false;
        while (!stopped) {
          const result = await dispatchOnce();
          if (!result.claimed) break;
        }
      } while (!stopped && wakeRequested);
    })().finally(() => {
      running = undefined;
      if (!stopped) {
        timer = setTimeout(() => {
          timer = undefined;
          void pump();
        }, options.pollIntervalMilliseconds);
        timer.unref();
      }
    });
    return running;
  }

  return {
    dispatchOnce,
    start() {
      if (!stopped) return;
      stopped = false;
      void pump();
    },
    wake() {
      if (stopped) return;
      if (isControlledFaultActive('OUTBOX_DROP_WAKE')) return;
      wakeRequested = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      void pump();
    },
    async stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      await running;
    },
  };
}

async function claimNextDelivery(
  transaction: Transaction<DB>,
  occurredAt: string,
  workerId: string,
  leaseSeconds: number,
  references: ConsumerReferenceReader,
  excludedSubscriptions: readonly string[] = [],
): Promise<ClaimedDelivery | undefined> {
  const selected = await sql<{
    aggregate_version: string;
    compatibility_id: string;
    delivery_id: string;
    event_id: string;
    event_type: string;
    governance_object_id: string;
    projection_payload_digest: Buffer;
    projection_schema_digest: Buffer;
    projection_schema_version: string;
    projection_type: string;
    release_id: string;
    service_principal_id: string;
    snapshot_artifact_digest: Buffer;
    snapshot_id: string;
    state_sequence: string;
    subscription_id: string;
  }>`
    select
      event.aggregate_version,
      state.compatibility_id,
      delivery.outbox_delivery_id as delivery_id,
      event.event_id,
      event.event_type,
      event.aggregate_id as governance_object_id,
      event.projection_payload_digest,
      event.projection_schema_digest,
      event.projection_schema_version,
      event.projection_type,
      event.release_id,
      subscription.service_principal_id,
      event.snapshot_artifact_digest,
      event.release_snapshot_id as snapshot_id,
      state.state_sequence,
      subscription.consumer_subscription_id as subscription_id
    from release_distribution.outbox_delivery as delivery
    join release_distribution.consumer_subscription as subscription
      on subscription.consumer_subscription_id = delivery.consumer_subscription_id
    join release_distribution.outbox_event as event
      on event.event_id = delivery.event_id
    join lateral (
      select candidate_state.compatibility_id,
             candidate_state.delivery_status,
             candidate_state.lease_expires_at,
             candidate_state.next_attempt_at,
             candidate_state.state_sequence
      from release_distribution.outbox_delivery_state as candidate_state
      where candidate_state.outbox_delivery_id = delivery.outbox_delivery_id
      order by candidate_state.state_sequence desc
      limit 1
    ) as state on true
    where (
      (
        state.delivery_status = 'PENDING'
        and (state.next_attempt_at is null or state.next_attempt_at <= cast(${occurredAt} as timestamp))
      )
      or
      (
        state.delivery_status = 'LEASED'
        and state.lease_expires_at <= cast(${occurredAt} as timestamp)
      )
    )
    and subscription.lifecycle_status = 'ACTIVE'
    and subscription.consumer_subscription_id != all(${excludedSubscriptions}::uuid[])
    and not exists (
      select 1
      from release_distribution.outbox_delivery as earlier_delivery
      join release_distribution.outbox_event as earlier_event
        on earlier_event.event_id = earlier_delivery.event_id
      join lateral (
        select earlier_state.delivery_status
        from release_distribution.outbox_delivery_state as earlier_state
        where earlier_state.outbox_delivery_id = earlier_delivery.outbox_delivery_id
        order by earlier_state.state_sequence desc
        limit 1
      ) as latest_earlier_state on true
      where earlier_delivery.consumer_subscription_id = delivery.consumer_subscription_id
        and earlier_event.aggregate_id = event.aggregate_id
        and earlier_event.aggregate_version < event.aggregate_version
        and latest_earlier_state.delivery_status not in ('NOTIFIED', 'DELIVERED')
    )
    order by subscription.consumer_subscription_id, event.aggregate_version
    for update of subscription, delivery skip locked
    limit 1
  `.execute(transaction);
  const row = selected.rows[0];
  if (!row) return undefined;
  if (!await references.isActiveServicePrincipal(row.service_principal_id)) {
    return claimNextDelivery(transaction, occurredAt, workerId, leaseSeconds, references,
      [...excludedSubscriptions, row.subscription_id]);
  }

  const leasedStateSequence = (BigInt(row.state_sequence) + 1n).toString();
  const leasedState = await transaction
    .insertInto('release_distribution.outbox_delivery_state')
    .values({
      outbox_delivery_id: row.delivery_id,
      event_id: row.event_id,
      consumer_subscription_id: row.subscription_id,
      compatibility_id: row.compatibility_id,
      state_sequence: leasedStateSequence,
      delivery_status: 'LEASED',
      lease_owner: workerId,
      lease_expires_at: sql<string>`cast(${occurredAt} as timestamp) + make_interval(secs => ${leaseSeconds})`,
      next_attempt_at: null,
    })
    .returning('outbox_delivery_state_id')
    .executeTakeFirstOrThrow();
  return {
    aggregateVersion: row.aggregate_version,
    compatibilityId: row.compatibility_id,
    deliveryId: row.delivery_id,
    eventId: row.event_id,
    eventType: row.event_type,
    governanceObjectId: row.governance_object_id,
    leasedStateId: leasedState.outbox_delivery_state_id,
    leasedStateSequence,
    projectionPayloadDigest: row.projection_payload_digest,
    projectionSchemaDigest: row.projection_schema_digest,
    projectionSchemaVersion: row.projection_schema_version,
    projectionType: row.projection_type,
    releaseId: row.release_id,
    servicePrincipalId: row.service_principal_id,
    snapshotArtifactDigest: row.snapshot_artifact_digest,
    snapshotId: row.snapshot_id,
    subscriptionId: row.subscription_id,
  };
}

async function recordDeliveryOutcome(
  transaction: Transaction<DB>,
  claimed: ClaimedDelivery,
  outcome:
    | {
        readonly result: 'NOTIFICATION_ACCEPTED';
        readonly errorCode: null;
        readonly responseDigest: Buffer | null;
      }
    | {
        readonly result: 'RETRYABLE_FAILURE' | 'FATAL_FAILURE';
        readonly errorCode: string;
        readonly responseDigest: Buffer | null;
      },
  occurredAt: string,
  retryDelaySeconds: number,
  maxNotificationAttempts: number,
  workerId: string,
  references: ConsumerReferenceReader,
): Promise<void> {
  const subscription = await lockSubscription(transaction, claimed.subscriptionId);
  // A lifecycle transition may commit while a notification is in flight.
  // Keep the existing lease for recovery; inactive subscriptions gain no new state.
  if (subscription.lifecycle_status !== 'ACTIVE') return;
  if (!await references.isActiveServicePrincipal(claimed.servicePrincipalId)) return;
  await sql`select pg_advisory_xact_lock(hashtextextended(${claimed.deliveryId}, 61))`.execute(
    transaction,
  );
  const latest = await transaction
    .selectFrom('release_distribution.outbox_delivery_state')
    .select(['outbox_delivery_state_id', 'state_sequence', 'delivery_status', 'lease_owner'])
    .where('outbox_delivery_id', '=', claimed.deliveryId)
    .orderBy('state_sequence', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow();
  const leaseStillOwned =
    latest.outbox_delivery_state_id === claimed.leasedStateId &&
    latest.delivery_status === 'LEASED' &&
    latest.lease_owner === workerId;
  const consumerClosedWhileLeased =
    BigInt(latest.state_sequence) > BigInt(claimed.leasedStateSequence) &&
    (latest.delivery_status === 'DELIVERED' || latest.delivery_status === 'ATTENTION_REQUIRED');
  if (!leaseStillOwned && !consumerClosedWhileLeased) {
    throw new Error('OUTBOX_LEASE_LOST');
  }
  const attempts = await transaction
    .selectFrom('release_distribution.outbox_delivery_attempt')
    .select((expression) => [
      expression.fn.max('attempt_no').as('last_attempt_no'),
      expression.fn
        .countAll()
        .filterWhere('result', 'in', [
          'NOTIFICATION_ACCEPTED',
          'RETRYABLE_FAILURE',
          'FATAL_FAILURE',
        ])
        .as('notification_attempt_count'),
    ])
    .where('outbox_delivery_id', '=', claimed.deliveryId)
    .executeTakeFirstOrThrow();
  const attemptNo = (BigInt(attempts.last_attempt_no ?? '0') + 1n).toString();
  const notificationAttemptCount = BigInt(attempts.notification_attempt_count) + 1n;
  const attempt = await transaction
    .insertInto('release_distribution.outbox_delivery_attempt')
    .values({
      outbox_delivery_id: claimed.deliveryId,
      outbox_delivery_state_id: claimed.leasedStateId,
      attempt_no: attemptNo,
      result: outcome.result,
      error_code: outcome.errorCode,
      response_digest: outcome.responseDigest,
      occurred_at: occurredAt,
      correlation_id: `outbox:${workerId}:${claimed.eventId}:${attemptNo}`,
    })
    .returning('outbox_delivery_attempt_id')
    .executeTakeFirstOrThrow();

  // A pull consumer may validate the immutable snapshot and close the
  // delivery while the notification request is still in flight. Its receipt
  // is the stronger terminal fact; keep it and retain this transport outcome
  // only as append-only attempt evidence.
  if (consumerClosedWhileLeased) return;

  const retryExhausted = notificationAttemptCount >= BigInt(maxNotificationAttempts);
  const deliveryStatus =
    outcome.result === 'NOTIFICATION_ACCEPTED'
      ? 'NOTIFIED'
      : outcome.result === 'FATAL_FAILURE' || retryExhausted
        ? 'ATTENTION_REQUIRED'
        : 'PENDING';
  await transaction
    .insertInto('release_distribution.outbox_delivery_state')
    .values({
      outbox_delivery_id: claimed.deliveryId,
      event_id: claimed.eventId,
      consumer_subscription_id: claimed.subscriptionId,
      compatibility_id: claimed.compatibilityId,
      state_sequence: (BigInt(latest.state_sequence) + 1n).toString(),
      delivery_status: deliveryStatus,
      lease_owner: null,
      lease_expires_at: null,
      next_attempt_at:
        deliveryStatus === 'PENDING'
          ? sql<string>`cast(${occurredAt} as timestamp) + make_interval(secs => ${retryDelaySeconds})`
          : null,
    })
    .execute();
  if (deliveryStatus === 'ATTENTION_REQUIRED') {
    const issue = await transaction
      .insertInto('release_distribution.delivery_operational_issue')
      .values({
        issue_code: `DELIVERY-${claimed.deliveryId}`,
        outbox_delivery_id: claimed.deliveryId,
      })
      .returning('delivery_operational_issue_id')
      .executeTakeFirstOrThrow();
    const lastIssueEvent = await transaction
      .selectFrom('release_distribution.delivery_operational_issue_event')
      .select((expression) => expression.fn.max('issue_sequence').as('last_issue_sequence'))
      .where('delivery_operational_issue_id', '=', issue.delivery_operational_issue_id)
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('release_distribution.delivery_operational_issue_event')
      .values({
        delivery_operational_issue_id: issue.delivery_operational_issue_id,
        issue_sequence: (BigInt(lastIssueEvent.last_issue_sequence ?? '0') + 1n).toString(),
        issue_status: 'OPEN',
        outbox_delivery_attempt_id: attempt.outbox_delivery_attempt_id,
        error_code: outcome.errorCode ?? 'NOTIFICATION_RETRY_EXHAUSTED',
        occurred_at: occurredAt,
        correlation_id: `outbox:${workerId}:${claimed.eventId}:${attemptNo}`,
      })
      .execute();
  }
}

function classifyNotificationError(error: unknown): ReleaseNotificationError {
  if (error instanceof ReleaseNotificationError) return error;
  return new ReleaseNotificationError('NOTIFICATION_TRANSPORT_ERROR', true);
}

function validateOptions(options: {
  readonly workerId: string;
  readonly leaseSeconds: number;
  readonly retryDelaySeconds: number;
  readonly maxNotificationAttempts: number;
  readonly pollIntervalMilliseconds: number;
}): void {
  if (options.workerId.length === 0 || options.workerId.length > 128) {
    throw new Error('OUTBOX_WORKER_ID_INVALID');
  }
  for (const [name, value] of [
    ['leaseSeconds', options.leaseSeconds],
    ['maxNotificationAttempts', options.maxNotificationAttempts],
    ['pollIntervalMilliseconds', options.pollIntervalMilliseconds],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`OUTBOX_${name}_INVALID`);
  }
  if (!Number.isSafeInteger(options.retryDelaySeconds) || options.retryDelaySeconds < 0) {
    throw new Error('OUTBOX_retryDelaySeconds_INVALID');
  }
}
