import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ResolvedPrincipal } from '../fastify/request-context.js';
import { PROTOTYPE_PRINCIPALS } from '../../prototype-fixture.js';

export const PROTOTYPE_AUTHENTICATION_MODE = 'PROTOTYPE_SYNTHETIC' as const;
export const PROTOTYPE_CSRF_TOKEN = 'prototype-csrf-guard-phase-01-http';

export interface PrototypeAuthentication {
  readonly authenticationMode: typeof PROTOTYPE_AUTHENTICATION_MODE;
  resolvePrincipal(request: FastifyRequest): Promise<ResolvedPrincipal>;
}

export function createPrototypeAuthentication(options: {
  readonly host: string;
  readonly nodeEnvironment: string | undefined;
  readonly prototypeMode: string | undefined;
}): PrototypeAuthentication {
  assertPrototypeRuntimeConfiguration(options);
  const principals = new Map<string, string>(
    PROTOTYPE_PRINCIPALS.map((principal) => [principal.headerCode, principal.principalId]),
  );

  return {
    authenticationMode: PROTOTYPE_AUTHENTICATION_MODE,
    async resolvePrincipal(request) {
      const principalCode = singleHeader(request.headers['x-prototype-principal-code']);
      const principalId = principalCode ? principals.get(principalCode) : undefined;
      if (!principalId) throw new Error('PROTOTYPE_PRINCIPAL_UNAUTHENTICATED');

      if (isUnsafeMethod(request.method)) {
        const csrfToken = singleHeader(request.headers['x-csrf-token']);
        if (!csrfToken || !safeEqual(csrfToken, PROTOTYPE_CSRF_TOKEN)) {
          throw new Error('PROTOTYPE_CSRF_FORBIDDEN');
        }
      }
      return { principalId, principalKind: 'PERSON' };
    },
  };
}

export function assertPrototypeRuntimeConfiguration(options: {
  readonly host: string;
  readonly nodeEnvironment: string | undefined;
  readonly prototypeMode: string | undefined;
}): void {
  if (options.prototypeMode !== 'true') throw new Error('PROTOTYPE_MODE_REQUIRED');
  if (options.nodeEnvironment?.toLowerCase() === 'production') {
    throw new Error('PROTOTYPE_PRODUCTION_FORBIDDEN');
  }
  if (options.host !== '127.0.0.1') throw new Error('PROTOTYPE_LOOPBACK_BIND_REQUIRED');
}

function singleHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isUnsafeMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
