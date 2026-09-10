import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { RequestContext } from '../transaction/transaction-runner.js';
import { parseLocalDateTime } from '../local-datetime/local-datetime.js';

export interface ResolvedPrincipal {
  readonly principalId: string;
  readonly principalKind: 'PERSON' | 'SERVICE';
}

export interface HttpRequestContextDependencies {
  resolvePrincipal(request: FastifyRequest): Promise<ResolvedPrincipal>;
  now(): string;
}

export async function createHttpRequestContext(
  request: FastifyRequest,
  dependencies: HttpRequestContextDependencies,
  requiredKind: ResolvedPrincipal['principalKind'],
): Promise<RequestContext> {
  const principal = await dependencies.resolvePrincipal(request);
  if (principal.principalKind !== requiredKind) {
    throw new Error('PRINCIPAL_KIND_FORBIDDEN');
  }
  const occurredAt = parseLocalDateTime(dependencies.now());
  const requestId = headerValue(request, 'x-request-id') ?? request.id ?? randomUUID();
  return {
    actorPrincipalId: principal.principalId,
    requestId,
    correlationId: headerValue(request, 'x-correlation-id') ?? requestId,
    occurredAt,
  };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
