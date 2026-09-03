import { describe, expect, it } from 'vitest';
import { loadPrototypeDemoDashboard } from './prototype-api.js';
import { formatDemoDecimal } from './prototype-demo-pages.js';

const dashboard = {
  status: 'READY',
  environment: 'Synthetic Prototype',
  identity: 'Prototype Synthetic',
  timeZone: 'Asia/Shanghai',
  currentLocalDateTime: '2026-09-03T10:30:20',
  organization: { organizationId: 'synthetic', displayName: 'HDI Demo Hospital' },
  campuses: [{ campusId: 'one', campusCode: 'PV004-DEMO-ONE', displayName: '总部院区' }],
  counts: {
    organizationCount: 1,
    campusCount: 2,
    chargeItemCount: 5,
    priceListCount: 3,
    publishedVersionCount: 8,
    publishedChargeVersionCount: 5,
    approvalEventCount: 18,
    auditEventCount: 100,
  },
  chargeItems: [],
  priceLists: [],
  auditTimeline: [],
  resolution: {
    objectId: 'resolution',
    digest: 'digest',
    status: 'SUCCEEDED',
    unitPrice: '12.3400',
    quantity: '2.000000',
    finalAmount: '24.6800',
    currencyCode: 'CNY',
    steps: [
      { stepNo: '1', label: '院区专用', decision: '未命中' },
      { stepNo: '2', label: '院区通用', decision: '未命中' },
      { stepNo: '3', label: '全院专用', decision: '未命中' },
      { stepNo: '4', label: '全院通用', decision: '命中' },
    ],
  },
} as const;

describe('prototype demo presentation', () => {
  it('loads a valid Dashboard API response', async () => {
    const fetchImplementation: typeof fetch = async () => new Response(JSON.stringify(dashboard), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    await expect(loadPrototypeDemoDashboard(fetchImplementation)).resolves.toEqual(dashboard);
  });

  it('rejects a Dashboard API timestamp containing Z', async () => {
    const fetchImplementation: typeof fetch = async () => new Response(JSON.stringify({
      ...dashboard,
      currentLocalDateTime: '2026-09-03T02:30:20Z',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
    await expect(loadPrototypeDemoDashboard(fetchImplementation)).rejects.toThrow('PROTOTYPE_DEMO_DASHBOARD_INVALID');
  });

  it('renders the price explanation without floating-point conversion', () => {
    expect(formatDemoDecimal(dashboard.resolution.unitPrice)).toBe('12.34');
    expect(formatDemoDecimal(dashboard.resolution.quantity)).toBe('2');
    expect(formatDemoDecimal(dashboard.resolution.finalAmount)).toBe('24.68');
  });
});
