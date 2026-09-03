import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  createHttpRequestContext,
  type HttpRequestContextDependencies,
  type ResolvedPrincipal,
} from './request-context.js';

describe('HTTP request context', () => {
  it('prefers x-request-id over the Fastify request id', async () => {
    const request = fakeRequest({
      id: 'fastify-request-id',
      headers: { 'x-request-id': 'caller-request-id' },
    });

    const context = await createHttpRequestContext(
      request,
      {
        resolvePrincipal: async () => ({
          principalId: '70000000-0000-7000-8000-000000000001',
          principalKind: 'PERSON',
        }),
        now: () => '2026-09-04T09:30:00',
      },
      'PERSON',
    );

    expect(context.requestId).toBe('caller-request-id');
  });

  it('uses the Fastify request id when x-request-id is absent', async () => {
    const context = await createHttpRequestContext(
      fakeRequest({ id: 'fastify-request-id' }),
      dependencies(personPrincipal),
      'PERSON',
    );

    expect(context.requestId).toBe('fastify-request-id');
  });

  it('generates a request id when neither caller nor Fastify supplies one', async () => {
    const context = await createHttpRequestContext(
      fakeRequest({}),
      dependencies(personPrincipal),
      'PERSON',
    );

    expect(context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('prefers x-correlation-id over the resolved request id', async () => {
    const context = await createHttpRequestContext(
      fakeRequest({
        id: 'fastify-request-id',
        headers: { 'x-correlation-id': 'caller-correlation-id' },
      }),
      dependencies(personPrincipal),
      'PERSON',
    );

    expect(context.correlationId).toBe('caller-correlation-id');
  });

  it('uses the resolved request id as the correlation id when the header is absent', async () => {
    const context = await createHttpRequestContext(
      fakeRequest({ id: 'fastify-request-id' }),
      dependencies(personPrincipal),
      'PERSON',
    );

    expect(context.correlationId).toBe('fastify-request-id');
  });

  it.each([
    ['PERSON', personPrincipal],
    ['SERVICE', servicePrincipal],
  ] as const)('accepts a trusted %s principal when that kind is required', async (kind, principal) => {
    const context = await createHttpRequestContext(
      fakeRequest({ id: 'request-id' }),
      dependencies(principal),
      kind,
    );

    expect(context.actorPrincipalId).toBe(principal.principalId);
  });

  it.each([
    ['PERSON', servicePrincipal],
    ['SERVICE', personPrincipal],
  ] as const)('rejects a non-%s principal', async (requiredKind, principal) => {
    await expect(
      createHttpRequestContext(
        fakeRequest({ id: 'request-id' }),
        dependencies(principal),
        requiredKind,
      ),
    ).rejects.toThrowError('PRINCIPAL_KIND_FORBIDDEN');
  });

  it('uses the validated Asia/Shanghai local date-time supplied by the server clock', async () => {
    const context = await createHttpRequestContext(
      fakeRequest({ id: 'request-id' }),
      dependencies(personPrincipal, '2026-09-04T09:30:00'),
      'PERSON',
    );

    expect(context.occurredAt).toBe('2026-09-04T09:30:00');
    expect(context.occurredAt).not.toBeInstanceOf(Date);
  });

  it.each([
    '2026-09-04T09:30:00Z',
    '2026-09-04T09:30:00+08:00',
    '2026-09-04T09:30:00-05:00',
    '2026-02-29T09:30:00',
  ])('rejects an invalid server local date-time: %s', async (now) => {
    await expect(
      createHttpRequestContext(
        fakeRequest({ id: 'request-id' }),
        dependencies(personPrincipal, now),
        'PERSON',
      ),
    ).rejects.toThrowError('LOCAL_DATETIME_INVALID');
  });

  it('ignores an actor id forged in the request body', async () => {
    const context = await createHttpRequestContext(
      fakeRequest({
        id: 'request-id',
        body: { actorId: '70000000-0000-7000-8000-000000000099' },
      }),
      dependencies(personPrincipal),
      'PERSON',
    );

    expect(context.actorPrincipalId).toBe(personPrincipal.principalId);
  });
});

const personPrincipal: ResolvedPrincipal = {
  principalId: '70000000-0000-7000-8000-000000000001',
  principalKind: 'PERSON',
};

const servicePrincipal: ResolvedPrincipal = {
  principalId: '70000000-0000-7000-8000-000000000002',
  principalKind: 'SERVICE',
};

function dependencies(
  principal: ResolvedPrincipal,
  now = '2026-09-04T09:30:00',
): HttpRequestContextDependencies {
  return {
    resolvePrincipal: async () => principal,
    now: () => now,
  };
}

function fakeRequest(input: {
  readonly id?: string;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly body?: unknown;
}): FastifyRequest {
  return {
    id: input.id,
    headers: input.headers ?? {},
    body: input.body,
  } as unknown as FastifyRequest;
}
