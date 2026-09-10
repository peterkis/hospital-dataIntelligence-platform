import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import type { ConsumerSubscriptionLifecycleStatus } from './subscription-lifecycle.js';

// Storage/representation safety bound (signed PostgreSQL integer), not a business policy.
export const SLA_SECONDS_MAX = 2_147_483_647;
export const ConsumerCriticalitySchema = Type.Union([
  Type.Literal('LOW'), Type.Literal('NORMAL'), Type.Literal('HIGH'), Type.Literal('CRITICAL'),
]);
export const SlaSecondsSchema = Type.Integer({ minimum: 1, maximum: SLA_SECONDS_MAX });
export const ConsumerSlaInputSchema = Type.Object({
  criticality: Type.Optional(ConsumerCriticalitySchema),
  expectedApplyWithinSeconds: Type.Optional(SlaSecondsSchema),
  retryWindowSeconds: Type.Optional(SlaSecondsSchema),
}, { additionalProperties: false });
export type ConsumerSlaInput = Static<typeof ConsumerSlaInputSchema>;
export const ConsumerSlaSchema = Type.Object({
  criticality: ConsumerCriticalitySchema,
  expectedApplyWithinSeconds: Type.Union([SlaSecondsSchema, Type.Null()]),
  retryWindowSeconds: Type.Union([SlaSecondsSchema, Type.Null()]),
}, { additionalProperties: false });
export type ConsumerSla = Static<typeof ConsumerSlaSchema>;
export const ConsumerOperationalStatusSchema = Type.Union([
  Type.Literal('NOT_CONFIGURED'), Type.Literal('HEALTHY'), Type.Literal('LATE'),
  Type.Literal('NEVER_APPLIED'), Type.Literal('SUSPENDED'), Type.Literal('REVOKED'), Type.Literal('ARCHIVED'),
]);

export function normalizeConsumerSla(value: unknown): ConsumerSla {
  const input = value === undefined ? {} : value;
  if (!Check(ConsumerSlaInputSchema, input)) throw new Error('CONSUMER_SLA_INVALID');
  const { criticality = 'NORMAL', expectedApplyWithinSeconds = null, retryWindowSeconds = null } = input;
  if (expectedApplyWithinSeconds !== null && retryWindowSeconds !== null
    && retryWindowSeconds < expectedApplyWithinSeconds) throw new Error('CONSUMER_SLA_INVALID');
  return { criticality, expectedApplyWithinSeconds, retryWindowSeconds };
}

// Inputs are absolute Unix microseconds from the explicit Asia/Shanghai SQL boundary.
// No host clock, local datetime arithmetic, or floating-point duration calculation.
export function evaluateConsumerSla(input: {
  lifecycle: ConsumerSubscriptionLifecycleStatus;
  sla: ConsumerSla;
  nowEpochMicroseconds: string;
  oldestPendingEpochMicroseconds: string | null;
  hasApplied: boolean;
}): { status: Static<typeof ConsumerOperationalStatusSchema>; applyOverdue: boolean } {
  const applyOverdue = input.sla.expectedApplyWithinSeconds !== null
    && input.oldestPendingEpochMicroseconds !== null
    && BigInt(input.nowEpochMicroseconds) - BigInt(input.oldestPendingEpochMicroseconds)
      > BigInt(input.sla.expectedApplyWithinSeconds) * 1_000_000n;
  if (input.lifecycle !== 'ACTIVE') return { status: input.lifecycle, applyOverdue: false };
  if (input.sla.expectedApplyWithinSeconds === null) return { status: 'NOT_CONFIGURED', applyOverdue: false };
  if (!input.hasApplied) return { status: 'NEVER_APPLIED', applyOverdue };
  return { status: applyOverdue ? 'LATE' : 'HEALTHY', applyOverdue };
}
