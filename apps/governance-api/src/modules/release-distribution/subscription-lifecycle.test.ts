import { describe, expect, it } from 'vitest';
import { Check } from 'typebox/value';
import { lifecycleStatus, requireActiveSubscription, validateLifecycleTransition } from './subscription-lifecycle.js';
import { ChangeSubscriptionLifecycleBodySchema } from '../../platform/fastify/release-consumer-schemas.js';
import { mapHttpError } from '../../platform/fastify/map-http-error.js';

const states = ['ACTIVE', 'SUSPENDED', 'REVOKED', 'ARCHIVED'] as const;
const legal = new Set(['ACTIVE:SUSPENDED', 'ACTIVE:REVOKED', 'SUSPENDED:ACTIVE', 'SUSPENDED:REVOKED', 'REVOKED:ARCHIVED']);

describe('Consumer subscription lifecycle', () => {
  it.each(states.flatMap((from) => states.map((to) => [from, to] as const)))('%s -> %s', (from, to) => {
    if (from === to) expect(validateLifecycleTransition(from, to)).toBe(false);
    else if (legal.has(`${from}:${to}`)) expect(validateLifecycleTransition(from, to)).toBe(true);
    else expect(() => validateLifecycleTransition(from, to)).toThrow('CONSUMER_SUBSCRIPTION_LIFECYCLE_INVALID_TRANSITION');
  });
  it.each(states)('allows consumption only while ACTIVE (%s)', (state) => {
    if (state === 'ACTIVE') expect(() => requireActiveSubscription(state)).not.toThrow();
    else expect(() => requireActiveSubscription(state)).toThrow('CONSUMER_SUBSCRIPTION_NOT_ACTIVE');
  });
  it.each(['DRAFT', 'active', '', null, 1])('rejects unsupported status %s in module and wire schema', (value) => {
    expect(() => lifecycleStatus(value)).toThrow('CONSUMER_SUBSCRIPTION_LIFECYCLE_STATUS_INVALID');
    expect(Check(ChangeSubscriptionLifecycleBodySchema, {
      governanceObjectId: '10000000-0000-7000-8000-000000000001', targetStatus: value,
    })).toBe(false);
  });
  it.each(['', 'a'.repeat(257), 'line\nbreak', '<markup>', '\u0000'])('rejects unbounded or non-plain reason %j', (reason) => {
    expect(() => validateLifecycleTransition('ACTIVE', 'SUSPENDED', reason)).toThrow('CONSUMER_SUBSCRIPTION_LIFECYCLE_REASON_INVALID');
  });
  it('accepts optional and bounded plain-text reasons', () => {
    expect(validateLifecycleTransition('ACTIVE', 'SUSPENDED', '维护暂停')).toBe(true);
    expect(validateLifecycleTransition('ACTIVE', 'SUSPENDED', 'a'.repeat(256))).toBe(true);
  });
  it.each([
    ['CONSUMER_SUBSCRIPTION_LIFECYCLE_INVALID_TRANSITION', 409],
    ['CONSUMER_SUBSCRIPTION_NOT_ACTIVE', 403],
    ['CONSUMER_SUBSCRIPTION_LIFECYCLE_STATUS_INVALID', 400],
    ['CONSUMER_SUBSCRIPTION_LIFECYCLE_REASON_INVALID', 400],
  ] as const)('maps stable error %s', (code, statusCode) => {
    expect(mapHttpError(new Error(code))).toEqual({ code, statusCode });
  });
});
