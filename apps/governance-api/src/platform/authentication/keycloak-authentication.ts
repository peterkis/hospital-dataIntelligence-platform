import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { sql, type Kysely } from 'kysely';
import type { ResolvedPrincipal } from '../fastify/register-phase-01-routes.js';
import type { DB } from '../database/database-types.generated.js';

const SESSION_COOKIE_NAME = '__Host-hdi-session';

interface OidcDiscoveryDocument {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}

export interface BrowserSessionView {
  readonly principalId: string;
  readonly principalKind: 'PERSON';
  readonly csrfToken: string;
}

export interface KeycloakAuthentication {
  beginLogin(command: { readonly returnTo: string }): Promise<{ readonly redirectUrl: string }>;
  completeLogin(command: {
    readonly state: string;
    readonly code: string;
    readonly authorizationResponseIssuer?: string;
  }): Promise<{
    readonly returnTo: string;
    readonly sessionCookie: string;
  }>;
  getBrowserSession(request: FastifyRequest, requireCsrf: boolean): Promise<BrowserSessionView>;
  resolvePrincipal(request: FastifyRequest): Promise<ResolvedPrincipal>;
  logout(request: FastifyRequest): Promise<void>;
  clearSessionCookie(): string;
}

export async function createKeycloakAuthentication(
  database: Kysely<DB>,
  options: {
    readonly issuerUrl: string;
    readonly browserClientId: string;
    readonly browserClientSecret: string;
    readonly serviceAudience: string;
    readonly publicOrigin: string;
    readonly csrfSecret: string;
    readonly loginLifetimeSeconds: number;
    readonly sessionLifetimeSeconds: number;
  },
): Promise<KeycloakAuthentication> {
  validateOptions(options);
  const discovery = await loadDiscovery(options.issuerUrl);
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const redirectUri = new URL('/auth/callback', options.publicOrigin).toString();

  async function verifyToken(
    token: string,
    audience: string,
    errorCode: string,
  ): Promise<JWTPayload> {
    try {
      const verified = await jwtVerify(token, jwks, {
        issuer: discovery.issuer,
        audience,
      });
      return verified.payload;
    } catch {
      throw new Error(errorCode);
    }
  }

  async function resolveBoundPrincipal(
    externalSubject: string,
    requiredKind: 'PERSON' | 'SERVICE',
  ): Promise<ResolvedPrincipal> {
    const binding = await database
      .selectFrom('platform.external_identity_binding as binding')
      .innerJoin(
        'platform.security_principal as principal',
        'principal.security_principal_id',
        'binding.security_principal_id',
      )
      .select([
        'binding.binding_kind',
        'binding.status as binding_status',
        'principal.principal_kind',
        'principal.status as principal_status',
        'principal.security_principal_id',
      ])
      .where('binding.issuer_url', '=', discovery.issuer)
      .where('binding.external_subject', '=', externalSubject)
      .orderBy('binding.binding_sequence', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (
      !binding ||
      binding.binding_status !== 'ACTIVE' ||
      binding.principal_status !== 'ACTIVE' ||
      binding.binding_kind !== requiredKind ||
      binding.principal_kind !== requiredKind
    ) {
      throw new Error('EXTERNAL_IDENTITY_UNBOUND');
    }
    return {
      principalId: binding.security_principal_id,
      principalKind: requiredKind,
    };
  }

  async function readBrowserSession(
    request: FastifyRequest,
    requireCsrf: boolean,
  ): Promise<BrowserSessionView> {
    const rawSession = parseCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!rawSession) throw new Error('BROWSER_SESSION_UNAUTHENTICATED');
    const sessionDigest = sha256(rawSession);
    const session = await database
      .selectFrom('platform.browser_session as session')
      .innerJoin(
        'platform.security_principal as principal',
        'principal.security_principal_id',
        'session.security_principal_id',
      )
      .select([
        'session.csrf_digest',
        'session.security_principal_id',
        'principal.principal_kind',
        'principal.status',
      ])
      .where('session.session_digest', '=', sessionDigest)
      .where('session.revoked_at', 'is', null)
      .where('session.expires_at', '>', sql<string>`platform.local_now()`)
      .executeTakeFirst();
    if (!session || session.status !== 'ACTIVE' || session.principal_kind !== 'PERSON') {
      throw new Error('BROWSER_SESSION_UNAUTHENTICATED');
    }
    const csrfToken = createCsrfToken(options.csrfSecret, rawSession);
    if (!timingSafeEqual(session.csrf_digest, sha256(csrfToken))) {
      throw new Error('BROWSER_SESSION_CSRF_STATE_INVALID');
    }
    if (requireCsrf) {
      const supplied = singleHeader(request.headers['x-csrf-token']);
      if (!supplied || !safeEqualUtf8(supplied, csrfToken)) {
        throw new Error('BROWSER_CSRF_FORBIDDEN');
      }
    }
    return {
      principalId: session.security_principal_id,
      principalKind: 'PERSON',
      csrfToken,
    };
  }

  return {
    async beginLogin(command) {
      const returnTo = validateReturnTo(command.returnTo);
      const state = randomBase64Url(32);
      const nonce = randomBase64Url(32);
      const verifier = randomBase64Url(48);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      await database
        .insertInto('platform.oidc_login_transaction')
        .values({
          state_digest: sha256(state),
          code_verifier: verifier,
          nonce,
          redirect_uri: redirectUri,
          return_to: returnTo,
          expires_at: sql<string>`platform.local_now() + make_interval(secs => ${options.loginLifetimeSeconds})`,
        })
        .execute();
      const authorizationUrl = new URL(discovery.authorization_endpoint);
      authorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: options.browserClientId,
        redirect_uri: redirectUri,
        scope: 'openid',
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      return { redirectUrl: authorizationUrl.toString() };
    },

    async completeLogin(command) {
      if (
        command.authorizationResponseIssuer !== undefined &&
        command.authorizationResponseIssuer !== discovery.issuer
      ) {
        throw new Error('OIDC_AUTHORIZATION_RESPONSE_ISSUER_MISMATCH');
      }
      const transaction = await database
        .updateTable('platform.oidc_login_transaction')
        .set({ consumed_at: sql<string>`platform.local_now()` })
        .where('state_digest', '=', sha256(command.state))
        .where('consumed_at', 'is', null)
        .where('expires_at', '>', sql<string>`platform.local_now()`)
        .returning(['code_verifier', 'nonce', 'redirect_uri', 'return_to'])
        .executeTakeFirst();
      if (!transaction) throw new Error('OIDC_LOGIN_TRANSACTION_INVALID');
      const tokenResponse = await fetch(discovery.token_endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Basic ${Buffer.from(`${options.browserClientId}:${options.browserClientSecret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: command.code,
          redirect_uri: transaction.redirect_uri,
          code_verifier: transaction.code_verifier,
        }),
      });
      if (!tokenResponse.ok) throw new Error('OIDC_CODE_EXCHANGE_FAILED');
      const tokenSet = (await tokenResponse.json()) as { readonly id_token?: unknown };
      if (typeof tokenSet.id_token !== 'string') throw new Error('OIDC_ID_TOKEN_REQUIRED');
      const payload = await verifyToken(
        tokenSet.id_token,
        options.browserClientId,
        'OIDC_ID_TOKEN_INVALID',
      );
      if (payload['nonce'] !== transaction.nonce || typeof payload.sub !== 'string') {
        throw new Error('OIDC_ID_TOKEN_INVALID');
      }
      const principal = await resolveBoundPrincipal(payload.sub, 'PERSON');
      const rawSession = randomBase64Url(48);
      const csrfToken = createCsrfToken(options.csrfSecret, rawSession);
      await database.transaction().execute(async (transaction) => {
        await sql`select pg_advisory_xact_lock(hashtextextended(${principal.principalId}, 67))`.execute(
          transaction,
        );
        const latestSession = await transaction
          .selectFrom('platform.browser_session')
          .select((expression) => expression.fn.max('session_sequence').as('last_session_sequence'))
          .where('security_principal_id', '=', principal.principalId)
          .executeTakeFirstOrThrow();
        await transaction
          .insertInto('platform.browser_session')
          .values({
            session_digest: sha256(rawSession),
            security_principal_id: principal.principalId,
            csrf_digest: sha256(csrfToken),
            session_sequence: (
              BigInt(latestSession.last_session_sequence ?? '0') + 1n
            ).toString(),
            expires_at: sql<string>`platform.local_now() + make_interval(secs => ${options.sessionLifetimeSeconds})`,
          })
          .execute();
      });
      return {
        returnTo: transaction.return_to,
        sessionCookie: serializeSessionCookie(rawSession, options.sessionLifetimeSeconds),
      };
    },

    getBrowserSession: readBrowserSession,

    async resolvePrincipal(request) {
      const authorization = singleHeader(request.headers.authorization);
      if (authorization?.startsWith('Bearer ')) {
        const token = authorization.slice('Bearer '.length);
        const payload = await verifyToken(
          token,
          options.serviceAudience,
          'SERVICE_TOKEN_UNAUTHENTICATED',
        );
        if (typeof payload.sub !== 'string') throw new Error('SERVICE_TOKEN_SUBJECT_REQUIRED');
        return resolveBoundPrincipal(payload.sub, 'SERVICE');
      }
      return readBrowserSession(request, isUnsafeMethod(request.method));
    },

    async logout(request) {
      await readBrowserSession(request, true);
      const rawSession = parseCookie(request.headers.cookie, SESSION_COOKIE_NAME);
      if (!rawSession) throw new Error('BROWSER_SESSION_UNAUTHENTICATED');
      await database
        .updateTable('platform.browser_session')
        .set({ revoked_at: sql<string>`platform.local_now()` })
        .where('session_digest', '=', sha256(rawSession))
        .where('revoked_at', 'is', null)
        .execute();
    },

    clearSessionCookie() {
      return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
    },
  };
}

async function loadDiscovery(issuerUrl: string): Promise<OidcDiscoveryDocument> {
  const issuer = issuerUrl.replace(/\/$/u, '');
  const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error('OIDC_DISCOVERY_FAILED');
  const candidate = (await response.json()) as Partial<OidcDiscoveryDocument>;
  if (
    candidate.issuer !== issuer ||
    !isAbsoluteHttpUrl(candidate.authorization_endpoint) ||
    !isAbsoluteHttpUrl(candidate.token_endpoint) ||
    !isAbsoluteHttpUrl(candidate.jwks_uri)
  ) {
    throw new Error('OIDC_DISCOVERY_INVALID');
  }
  return candidate as OidcDiscoveryDocument;
}

function validateOptions(options: {
  readonly issuerUrl: string;
  readonly browserClientId: string;
  readonly browserClientSecret: string;
  readonly serviceAudience: string;
  readonly publicOrigin: string;
  readonly csrfSecret: string;
  readonly loginLifetimeSeconds: number;
  readonly sessionLifetimeSeconds: number;
}): void {
  for (const value of [
    options.issuerUrl,
    options.browserClientId,
    options.browserClientSecret,
    options.serviceAudience,
    options.publicOrigin,
    options.csrfSecret,
  ]) {
    if (value.length === 0) throw new Error('AUTHENTICATION_CONFIGURATION_INVALID');
  }
  if (options.csrfSecret.length < 32) throw new Error('CSRF_SECRET_TOO_SHORT');
  for (const value of [options.loginLifetimeSeconds, options.sessionLifetimeSeconds]) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error('AUTHENTICATION_LIFETIME_INVALID');
    }
  }
}

function createCsrfToken(secret: string, rawSession: string): string {
  return createHmac('sha256', secret).update(rawSession).digest('base64url');
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

function serializeSessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 0) continue;
    const key = segment.slice(0, separator).trim();
    if (key === name) return segment.slice(separator + 1).trim();
  }
  return undefined;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEqualUtf8(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
}

function isUnsafeMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function validateReturnTo(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) throw new Error('RETURN_TO_INVALID');
  return value;
}

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}
