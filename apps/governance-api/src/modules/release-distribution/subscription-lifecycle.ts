import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import type { Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';

export const ConsumerSubscriptionLifecycleStatusSchema = Type.Union([
  Type.Literal('ACTIVE'), Type.Literal('SUSPENDED'),
  Type.Literal('REVOKED'), Type.Literal('ARCHIVED'),
]);
export type ConsumerSubscriptionLifecycleStatus = Static<typeof ConsumerSubscriptionLifecycleStatusSchema>;

// Reasons are short, single-line governance explanations, never credentials or patient data.
export const ConsumerSubscriptionLifecycleReasonSchema = Type.String({
  minLength: 1, maxLength: 256, pattern: '^[^\\u0000-\\u001f\\u007f<>]+$',
});

const transitions: Readonly<Record<ConsumerSubscriptionLifecycleStatus, readonly ConsumerSubscriptionLifecycleStatus[]>> = {
  ACTIVE: ['SUSPENDED', 'REVOKED'],
  SUSPENDED: ['ACTIVE', 'REVOKED'],
  REVOKED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function lifecycleStatus(value: unknown): ConsumerSubscriptionLifecycleStatus {
  if (!Check(ConsumerSubscriptionLifecycleStatusSchema, value)) {
    throw new Error('CONSUMER_SUBSCRIPTION_LIFECYCLE_STATUS_INVALID');
  }
  return value;
}

export function validateLifecycleTransition(current: unknown, target: unknown, reason?: unknown): boolean {
  const from = lifecycleStatus(current);
  const to = lifecycleStatus(target);
  if (reason !== undefined && !Check(ConsumerSubscriptionLifecycleReasonSchema, reason)) {
    throw new Error('CONSUMER_SUBSCRIPTION_LIFECYCLE_REASON_INVALID');
  }
  if (from === to) return false;
  if (!transitions[from].includes(to)) {
    throw new Error('CONSUMER_SUBSCRIPTION_LIFECYCLE_INVALID_TRANSITION');
  }
  return true;
}

export function requireActiveSubscription(status: unknown): void {
  if (lifecycleStatus(status) !== 'ACTIVE') throw new Error('CONSUMER_SUBSCRIPTION_NOT_ACTIVE');
}

// Every subscription mutation takes this same row lock before reading its state.
// The caller owns the transaction, so lifecycle and consumption cannot interleave.
export async function lockSubscription(database: Kysely<DB>, subscriptionId: string) {
  const subscription = await database.selectFrom('release_distribution.consumer_subscription')
    .selectAll().where('consumer_subscription_id', '=', subscriptionId).forUpdate().executeTakeFirst();
  if (!subscription) throw new Error('CONSUMER_SUBSCRIPTION_NOT_FOUND');
  lifecycleStatus(subscription.lifecycle_status);
  return subscription;
}
