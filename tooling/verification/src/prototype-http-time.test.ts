import { describe, expect, it } from 'vitest';
import { buildPriceResolutionTimes } from '../../prototype/http-flow-time.js';

describe('prototype HTTP price-resolution time boundary', () => {
  it('uses the published record time when approval completes more than eight seconds later', () => {
    const times = buildPriceResolutionTimes(
      new Date('2026-09-03T01:00:00.000Z'),
      '2026-09-03T09:00:09',
    );

    expect(times).toEqual({
      serviceOccurredAt: '2026-09-03T08:59:59',
      recordAsOf: '2026-09-03T09:00:09',
    });
    expect(times.recordAsOf > '2026-09-03T09:00:08').toBe(true);
    expect(times.serviceOccurredAt).not.toMatch(/(?:Z|[+-]\d{2}:\d{2})$/u);
    expect(times.recordAsOf).not.toMatch(/(?:Z|[+-]\d{2}:\d{2})$/u);
  });
});
