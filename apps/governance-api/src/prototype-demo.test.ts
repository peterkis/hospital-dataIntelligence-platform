import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_DEMO,
  PROTOTYPE_DEMO_AUDIT_TARGET,
  assertSyntheticPrototypeDemoFixture,
} from './prototype-demo-fixture.js';
import {
  assertPrototypeDemoCounts,
  displayLocalDateTime,
} from './prototype-demo.js';

describe('prototype demo contract', () => {
  it('accepts only the complete deterministic Demo Ready counts', () => {
    expect(assertPrototypeDemoCounts({
      organizationCount: 1,
      campusCount: 2,
      chargeItemCount: 5,
      priceListCount: 3,
      publishedVersionCount: 8,
      auditEventCount: PROTOTYPE_DEMO_AUDIT_TARGET,
    })).toEqual({
      status: 'PASSED',
      organizationCount: 1,
      campusCount: 2,
      chargeItemCount: 5,
      priceListCount: 3,
      publishedVersionCount: 8,
      auditEventCount: 100,
    });
  });

  it('fails closed when repeated preparation would leave duplicate objects', () => {
    expect(() => assertPrototypeDemoCounts({
      organizationCount: 1,
      campusCount: 2,
      chargeItemCount: 6,
      priceListCount: 3,
      publishedVersionCount: 8,
      auditEventCount: 100,
    })).toThrow('PROTOTYPE_DEMO_DATA_INCOMPLETE');
  });

  it('contains only explicit synthetic namespace data', () => {
    expect(assertSyntheticPrototypeDemoFixture).not.toThrow();
    const serialized = JSON.stringify(PROTOTYPE_DEMO);
    expect(serialized).toContain('HDI Demo Hospital');
    expect(serialized).toContain('PV004-DEMO');
    expect(serialized).not.toContain('真实患者');
    expect(serialized).not.toContain('某某市人民医院');
  });

  it('formats Asia/Shanghai local date-time without Z or an offset', () => {
    const formatted = displayLocalDateTime('2026-09-03T10:30:20');
    expect(formatted).toBe('2026-09-03 10:30:20');
    expect(formatted).not.toMatch(/[Zz]/u);
    expect(formatted).not.toMatch(/[+-]\d{2}:\d{2}$/u);
  });

  it('keeps every fixture timestamp as a LocalDateTime string', () => {
    const timestamps = JSON.stringify(PROTOTYPE_DEMO).match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/gu) ?? [];
    expect(timestamps.length).toBeGreaterThan(20);
    for (const timestamp of timestamps) {
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u);
      expect(timestamp).not.toMatch(/[Zz]|[+-]\d{2}:\d{2}$/u);
    }
  });
});
