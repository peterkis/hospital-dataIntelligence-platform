import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { KeycloakAuthentication } from '../platform/authentication/keycloak-authentication.js';
import { createPrototypeAuthentication } from '../platform/authentication/prototype-authentication.js';
import type { Phase01HttpDependencies } from '../platform/fastify/register-phase-01-routes.js';
import { buildApplication } from './build-application.js';

let application: FastifyInstance | undefined;

afterEach(async () => {
  await application?.close();
  application = undefined;
});

describe('governance API composition root', () => {
  it('serves the TypeBox-governed health route', async () => {
    application = await buildApplication();

    const response = await application.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('generates an OpenAPI 3.1 document from registered route schemas', async () => {
    application = await buildApplication();
    await application.ready();

    const document = application.swagger();
    if (!('openapi' in document)) {
      throw new Error('Expected an OpenAPI document, received a Swagger document.');
    }

    expect(document.openapi).toBe('3.1.0');
    expect(document.paths?.['/health']?.get?.operationId).toBe('getHealth');
    expect(
      document.paths?.['/v1/phase-01/change-requests/{changeRequestId}/actions']?.post
        ?.operationId,
    ).toBe('actOnPhase01ChangeRequest');
    expect(
      document.paths?.[
        '/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content'
      ]?.get?.operationId,
    ).toBe('downloadPhase01CanonicalSnapshot');
  });

  it('maps an unauthenticated browser session to the declared 401 contract', async () => {
    const authentication = {
      getBrowserSession: async () => {
        throw new Error('BROWSER_SESSION_UNAUTHENTICATED');
      },
    } as unknown as KeycloakAuthentication;
    application = await buildApplication({ authentication });

    const response = await application.inject({
      method: 'GET',
      url: '/auth/session',
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'BROWSER_SESSION_UNAUTHENTICATED',
      requestId: expect.any(String),
    });
  });

  it('accepts Keycloak issuer and session-state callback parameters', async () => {
    let received:
      | { readonly state: string; readonly code: string; readonly authorizationResponseIssuer?: string }
      | undefined;
    const authentication = {
      completeLogin: async (command: NonNullable<typeof received>) => {
        received = command;
        return {
          returnTo: '/admin/',
          sessionCookie: '__Host-hdi-session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax',
        };
      },
    } as unknown as KeycloakAuthentication;
    application = await buildApplication({ authentication });

    const response = await application.inject({
      method: 'GET',
      url:
        '/auth/callback?code=code-1&state=12345678901234567890123456789012' +
        '&iss=http%3A%2F%2Fkeycloak.example%2Frealms%2Fhdi&session_state=session-1',
    });

    expect(response.statusCode).toBe(302);
    expect(received).toEqual({
      code: 'code-1',
      state: '12345678901234567890123456789012',
      authorizationResponseIssuer: 'http://keycloak.example/realms/hdi',
    });
  });

  it('maps an incorrect prototype CSRF guard to the declared 403 contract', async () => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'development',
      prototypeMode: 'true',
    });
    const phase01 = {
      resolvePrincipal: authentication.resolvePrincipal,
      now: () => '2026-09-03T17:30:00',
    } as unknown as Phase01HttpDependencies;
    application = await buildApplication({ phase01 });

    const response = await application.inject({
      method: 'POST',
      url: '/v1/phase-01/charge-item-drafts',
      headers: {
        'x-prototype-principal-code': 'prototype-owner',
        'x-csrf-token': 'prototype-csrf-guard-incorrect-value',
      },
      payload: {
        governanceObjectId: '70000000-0000-7000-8000-000000000005',
        internalCode: 'PROTOTYPE-SYNTHETIC-HTTP-FEE-CSRF',
        formalName: 'PROTOTYPE SYNTHETIC HTTP CHARGE ITEM CSRF',
        serviceDefinition: 'PROTOTYPE SYNTHETIC HTTP CSRF REJECTION',
        billingUnitCode: 'TIMES',
        chargingMethodCode: 'COUNT',
        businessValidFrom: '2026-09-03T17:29:00',
        businessValidTo: null,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: 'PROTOTYPE_CSRF_FORBIDDEN',
      requestId: expect.any(String),
    });
  });
});
