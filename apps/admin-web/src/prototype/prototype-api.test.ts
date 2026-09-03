import { describe, expect, it, vi } from 'vitest';
import { createPrototypeApi, type PrototypeContext } from './prototype-api.js';

const context: PrototypeContext = {
  mode: 'PROTOTYPE_SYNTHETIC',
  timeZone: 'Asia/Shanghai',
  localDateTimeFormat: 'YYYY-MM-DDTHH:mm:ss[.ffffff]',
  currentLocalDateTime: '2026-09-03T10:00:00',
  csrfPurpose: 'NON_SECURITY_MISUSE_GUARD',
  csrfToken: 'prototype-csrf',
  roles: [
    { code: 'prototype-owner', label: '数据维护员' },
    { code: 'prototype-reviewer', label: '专业审核员' },
    { code: 'prototype-final-owner', label: '终审负责人' },
  ],
  fixture: {
    chargeCatalogObjectId: 'charge-object',
    priceListObjectId: 'price-object',
    campusId: 'campus',
  },
};

describe('prototype generated client fetch boundary', () => {
  it('rejects a business request until an identity is selected', async () => {
    const api = createPrototypeApi(context, vi.fn());
    await expect(api.fetch('/v1/phase-01/audit-events')).rejects
      .toMatchObject({ status: 401, code: 'PROTOTYPE_PRINCIPAL_UNAUTHENTICATED' });
  });

  it('injects the selected role immediately and CSRF only on writes', async () => {
    const requests: { readonly method: string; readonly headers: Headers }[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      requests.push({
        method: (input instanceof Request ? input.method : init?.method ?? 'GET').toUpperCase(),
        headers: new Headers(init?.headers),
      });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const api = createPrototypeApi(context, fetchMock);
    api.setRole('prototype-owner');
    await api.fetch('/v1/phase-01/audit-events');
    api.setRole('prototype-reviewer');
    await api.fetch('/v1/phase-01/change-requests', { method: 'POST' });

    expect(requests[0]?.headers.get('x-prototype-principal-code')).toBe('prototype-owner');
    expect(requests[0]?.headers.has('x-csrf-token')).toBe(false);
    expect(requests[1]?.headers.get('x-prototype-principal-code')).toBe('prototype-reviewer');
    expect(requests[1]?.headers.get('x-csrf-token')).toBe('prototype-csrf');
  });

  it('preserves generated-client request headers while applying the current role', async () => {
    let observedHeaders = new Headers();
    const fetchMock: typeof fetch = async (input, init) => {
      observedHeaders = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      return new Response(JSON.stringify({ code: 'EXPECTED_TEST_RESPONSE', requestId: 'test' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    };
    const api = createPrototypeApi(context, fetchMock, 'http://127.0.0.1');
    api.setRole('prototype-reviewer');
    await api.client.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: { 'x-csrf-token': 'generated-placeholder' },
        path: { changeRequestId: 'change-request' },
      },
      body: {
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: 'test',
        seenContentDigest: 'digest',
        campusId: null,
      },
    });
    expect(observedHeaders.get('x-prototype-principal-code')).toBe('prototype-reviewer');
    expect(observedHeaders.get('x-csrf-token')).toBe('prototype-csrf');
  });
});
