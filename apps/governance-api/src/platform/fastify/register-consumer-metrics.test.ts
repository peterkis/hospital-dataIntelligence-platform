import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { registerConsumerMetrics } from './register-consumer-metrics.js';

it('restricts metrics to authenticated local prototype requests and sanitizes collection errors', async () => {
  const app = Fastify(); let fail = false;
  registerConsumerMetrics(app, { host: '127.0.0.1', nodeEnvironment: 'test', prototypeMode: 'true',
    async resolvePrincipal(request) {
      if (request.headers['x-test-principal'] === undefined) throw new Error('Bearer private');
      return { principalKind: request.headers['x-test-principal'] === 'service' ? 'SERVICE' : 'PERSON', principalId: 'private' };
    }, async collect() { if (fail) throw new Error('postgres://private password'); return '# Synthetic/non-production only\n'; } });
  try {
    const url = '/prototype/observability/metrics'; const headers = { 'x-test-principal': 'owner' };
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { 'x-test-principal': 'service' } })).statusCode).toBe(403);
    expect((await app.inject({ url, headers: { ...headers, 'x-forwarded-for': '127.0.0.1' }, remoteAddress: '192.0.2.1' })).statusCode).toBe(403);
    const success = await app.inject({ url, headers });
    expect(success.statusCode).toBe(200); expect(success.headers['cache-control']).toBe('no-store');
    expect(success.headers['content-type']).toContain('text/plain');
    fail = true;
    const failure = await app.inject({ url, headers });
    expect(failure.statusCode).toBe(503); expect(failure.json()).toEqual({ code: 'METRICS_UNAVAILABLE' });
    expect(failure.body).not.toMatch(/private|password|postgres|Bearer/);
  } finally { await app.close(); }
});
it.each([{ host: '0.0.0.0', nodeEnvironment: 'test', prototypeMode: 'true' },
  { host: '127.0.0.1', nodeEnvironment: 'production', prototypeMode: 'true' },
  { host: '127.0.0.1', nodeEnvironment: 'test', prototypeMode: 'false' }])('rejects unsafe runtime posture', options => {
  const app = Fastify();
  expect(() => registerConsumerMetrics(app, { ...options, async collect() { return ''; },
    async resolvePrincipal() { return { principalKind: 'PERSON', principalId: '' }; } })).toThrow();
  return app.close();
});
