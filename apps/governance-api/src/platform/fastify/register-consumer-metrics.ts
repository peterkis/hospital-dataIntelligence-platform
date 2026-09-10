import type { FastifyInstance, FastifyRequest } from 'fastify';
import { assertPrototypeRuntimeConfiguration } from '../authentication/prototype-authentication.js';
import type { ResolvedPrincipal } from './request-context.js';

export function registerConsumerMetrics(application: FastifyInstance, input: {
  host: string; nodeEnvironment: string | undefined; prototypeMode: string | undefined;
  resolvePrincipal(request: FastifyRequest): Promise<ResolvedPrincipal>;
  collect(actorPrincipalId: string): Promise<string>;
}) {
  assertPrototypeRuntimeConfiguration(input);
  let collecting = false;
  application.get('/prototype/observability/metrics', { schema: { hide: true } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    // Trust the socket, never forwarded headers. No global metrics permission is invented.
    if (!['127.0.0.1', '::ffff:127.0.0.1', '::1'].includes(request.socket.remoteAddress ?? '')) {
      return reply.code(403).send({ code: 'METRICS_FORBIDDEN' });
    }
    let actorPrincipalId: string;
    try {
      const principal = await input.resolvePrincipal(request);
      if (principal.principalKind !== 'PERSON') return reply.code(403).send({ code: 'METRICS_FORBIDDEN' });
      actorPrincipalId = principal.principalId;
    } catch { return reply.code(401).send({ code: 'METRICS_UNAUTHENTICATED' }); }
    if (collecting) return reply.code(503).send({ code: 'METRICS_BUSY' });
    collecting = true;
    try {
      const body = await input.collect(actorPrincipalId);
      return reply.type('text/plain; version=0.0.4; charset=utf-8').send(body);
    } catch { return reply.code(503).send({ code: 'METRICS_UNAVAILABLE' }); }
    finally { collecting = false; }
  });
}
