import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  PROTOTYPE_CSRF_TOKEN,
  createPrototypeAuthentication,
} from './prototype-authentication.js';

describe('prototype synthetic authentication', () => {
  it('resolves only the fixed synthetic principal codes through an HTTP request', async () => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'development',
      prototypeMode: 'true',
    });
    const application = Fastify();
    application.get('/', async (request) => authentication.resolvePrincipal(request));

    const response = await application.inject({
      method: 'GET',
      url: '/',
      headers: { 'x-prototype-principal-code': 'prototype-reviewer' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      principalId: '70000000-0000-7000-8000-000000000002',
      principalKind: 'PERSON',
    });
    await application.close();
  });

  it.each([
    ['missing', undefined],
    ['unknown', 'prototype-arbitrary-user'],
  ])('rejects a %s prototype principal', async (_case, principalCode) => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'development',
      prototypeMode: 'true',
    });
    const application = Fastify();
    application.get('/', async (request) => authentication.resolvePrincipal(request));

    const response = await application.inject({
      method: 'GET',
      url: '/',
      ...(principalCode
        ? { headers: { 'x-prototype-principal-code': principalCode } }
        : {}),
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe('PROTOTYPE_PRINCIPAL_UNAUTHENTICATED');
    await application.close();
  });

  it.each([
    ['missing', undefined],
    ['incorrect', 'prototype-csrf-guard-incorrect-value'],
  ])('rejects a write request with a %s prototype CSRF value', async (_case, csrfToken) => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'development',
      prototypeMode: 'true',
    });
    const application = Fastify();
    application.post('/', async (request) => authentication.resolvePrincipal(request));

    const response = await application.inject({
      method: 'POST',
      url: '/',
      headers: {
        'x-prototype-principal-code': 'prototype-owner',
        ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toBe('PROTOTYPE_CSRF_FORBIDDEN');
    await application.close();
  });

  it('accepts the fixed non-sensitive prototype CSRF value for writes', async () => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'development',
      prototypeMode: 'true',
    });
    const application = Fastify();
    application.post('/', async (request) => authentication.resolvePrincipal(request));

    const response = await application.inject({
      method: 'POST',
      url: '/',
      headers: {
        'x-prototype-principal-code': 'prototype-final-owner',
        'x-csrf-token': PROTOTYPE_CSRF_TOKEN,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().principalId).toBe('70000000-0000-7000-8000-000000000003');
    await application.close();
  });

  it.each([
    [{ prototypeMode: 'false', nodeEnvironment: 'development' }, 'PROTOTYPE_MODE_REQUIRED'],
    [{ prototypeMode: 'true', nodeEnvironment: 'production' }, 'PROTOTYPE_PRODUCTION_FORBIDDEN'],
    [{ prototypeMode: 'true', nodeEnvironment: 'development', host: '0.0.0.0' }, 'PROTOTYPE_LOOPBACK_BIND_REQUIRED'],
  ])('fails closed for unsafe runtime configuration', (runtime, expected) => {
    expect(() => createPrototypeAuthentication({
      host: 'host' in runtime ? runtime.host : '127.0.0.1',
      nodeEnvironment: runtime.nodeEnvironment,
      prototypeMode: runtime.prototypeMode,
    })).toThrowError(expected);
  });

  it('rejects a non-loopback startup even when the removed approval variable is present', () => {
    process.env['PROTOTYPE_REMOTE_ACCESS_APPROVED'] = 'true';
    try {
      expect(() => createPrototypeAuthentication({
        host: '192.0.2.10',
        nodeEnvironment: 'development',
        prototypeMode: 'true',
      })).toThrowError('PROTOTYPE_LOOPBACK_BIND_REQUIRED');
    } finally {
      delete process.env['PROTOTYPE_REMOTE_ACCESS_APPROVED'];
    }
  });
});
