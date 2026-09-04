import { describe, expect, it } from 'vitest';
import { Check } from 'typebox/value';
import { ConsumerSlaInputSchema, evaluateConsumerSla, normalizeConsumerSla, SLA_SECONDS_MAX } from './consumer-sla.js';

describe('consumer operational SLA', () => {
  it('defaults to NORMAL with no invented latency or retry', () => {
    expect(normalizeConsumerSla(undefined)).toEqual({ criticality: 'NORMAL', expectedApplyWithinSeconds: null, retryWindowSeconds: null });
  });
  it.each(['LOW', 'NORMAL', 'HIGH', 'CRITICAL'])('accepts %s', (criticality) => {
    expect(normalizeConsumerSla({ criticality, expectedApplyWithinSeconds: 1, retryWindowSeconds: SLA_SECONDS_MAX }).criticality).toBe(criticality);
  });
  it.each([
    { criticality: 'URGENT' }, { criticality: 'normal' }, null,
    { expectedApplyWithinSeconds: 0 }, { expectedApplyWithinSeconds: -1 },
    { expectedApplyWithinSeconds: 1.5 }, { expectedApplyWithinSeconds: '5' },
    { expectedApplyWithinSeconds: SLA_SECONDS_MAX + 1 },
    { retryWindowSeconds: 0 }, { retryWindowSeconds: -1 }, { retryWindowSeconds: SLA_SECONDS_MAX + 1 },
    { lastSuccessAt: '2026-09-04T00:00:00' }, { ownerEmail: 'x' },
  ])('rejects malformed metadata %j', (input) => {
    expect(Check(ConsumerSlaInputSchema, input)).toBe(false);
    expect(() => normalizeConsumerSla(input)).toThrow('CONSUMER_SLA_INVALID');
  });
  it('enforces the latency/retry relationship', () => {
    expect(() => normalizeConsumerSla({ expectedApplyWithinSeconds: 6, retryWindowSeconds: 5 })).toThrow('CONSUMER_SLA_INVALID');
    expect(normalizeConsumerSla({ expectedApplyWithinSeconds: 5, retryWindowSeconds: 5 }).retryWindowSeconds).toBe(5);
  });
  const base = { lifecycle: 'ACTIVE' as const, sla: normalizeConsumerSla({ expectedApplyWithinSeconds: 5 }),
    nowEpochMicroseconds: '1788470405000000', oldestPendingEpochMicroseconds: '1788470400000000', hasApplied: true };
  it('uses exact absolute microseconds at the deadline', () => {
    expect(evaluateConsumerSla(base)).toEqual({ status: 'HEALTHY', applyOverdue: false });
    expect(evaluateConsumerSla({ ...base, nowEpochMicroseconds: '1788470405000001' })).toEqual({ status: 'LATE', applyOverdue: true });
    expect(evaluateConsumerSla({ ...base, oldestPendingEpochMicroseconds: null }).status).toBe('HEALTHY');
  });
  it('distinguishes never applied and overdue', () => {
    expect(evaluateConsumerSla({ ...base, hasApplied: false, nowEpochMicroseconds: '1788470406000000' }))
      .toEqual({ status: 'NEVER_APPLIED', applyOverdue: true });
    expect(evaluateConsumerSla({ ...base, hasApplied: false, oldestPendingEpochMicroseconds: null }).status).toBe('NEVER_APPLIED');
  });
  it.each([undefined, { criticality: 'HIGH' }, { retryWindowSeconds: 5 }])('keeps unconfigured latency unconfigured', (sla) => {
    expect(evaluateConsumerSla({ ...base, sla: normalizeConsumerSla(sla), nowEpochMicroseconds: '999999999999999999' }).status).toBe('NOT_CONFIGURED');
  });
  it.each(['SUSPENDED', 'REVOKED', 'ARCHIVED'] as const)('prioritizes %s', (lifecycle) => {
    for (const sla of [base.sla, normalizeConsumerSla(undefined)]) {
      expect(evaluateConsumerSla({ ...base, lifecycle, sla, nowEpochMicroseconds: '999999999999999999' }))
        .toEqual({ status: lifecycle, applyOverdue: false });
    }
  });
  it('does not depend on process timezone or wall clock', () => {
    const original = process.env['TZ'];
    try {
      for (const timezone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
        process.env['TZ'] = timezone;
        expect(evaluateConsumerSla(base)).toEqual({ status: 'HEALTHY', applyOverdue: false });
      }
    } finally { if (original === undefined) delete process.env['TZ']; else process.env['TZ'] = original; }
  });
});
