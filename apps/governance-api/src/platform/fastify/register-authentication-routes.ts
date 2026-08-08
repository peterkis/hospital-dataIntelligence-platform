import {
  Type,
  type TypeBoxTypeProvider,
} from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { KeycloakAuthentication } from '../authentication/keycloak-authentication.js';

const LoginQuerySchema = Type.Object(
  {
    returnTo: Type.Optional(Type.String({ pattern: '^/(?!/).*$' })),
  },
  { additionalProperties: false },
);

const CallbackQuerySchema = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 32, maxLength: 256 }),
    iss: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    session_state: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  },
  { additionalProperties: false },
);

const SessionResponseSchema = Type.Object(
  {
    principalId: Type.String({
      pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    }),
    principalKind: Type.Literal('PERSON'),
    csrfToken: Type.String({ minLength: 32 }),
  },
  { additionalProperties: false },
);

const LogoutResponseSchema = Type.Object(
  { loggedOut: Type.Literal(true) },
  { additionalProperties: false },
);
const CsrfHeadersSchema = Type.Object({
  'x-csrf-token': Type.String({ minLength: 32 }),
});

const AuthenticationErrorSchema = Type.Object(
  { code: Type.String(), requestId: Type.String() },
  { additionalProperties: false },
);

export async function registerAuthenticationRoutes(
  application: FastifyInstance,
  authentication?: KeycloakAuthentication,
): Promise<void> {
  const typed = application.withTypeProvider<TypeBoxTypeProvider>();

  typed.get(
    '/auth/login',
    {
      schema: {
        operationId: 'beginBrowserLogin',
        summary: '启动服务端Authorization Code与PKCE S256登录',
        security: [],
        querystring: LoginQuerySchema,
        response: { 302: Type.Null(), 400: AuthenticationErrorSchema, 503: AuthenticationErrorSchema },
      },
    },
    async (request, reply) => {
      if (!authentication) throw new Error('AUTHENTICATION_RUNTIME_NOT_CONFIGURED');
      const result = await authentication.beginLogin({ returnTo: request.query.returnTo ?? '/admin/' });
      return reply.redirect(result.redirectUrl);
    },
  );

  typed.get(
    '/auth/callback',
    {
      schema: {
        operationId: 'completeBrowserLogin',
        summary: '完成服务端OIDC代码交换并建立不透明会话',
        security: [],
        querystring: CallbackQuerySchema,
        response: { 302: Type.Null(), 400: AuthenticationErrorSchema, 503: AuthenticationErrorSchema },
      },
    },
    async (request, reply) => {
      if (!authentication) throw new Error('AUTHENTICATION_RUNTIME_NOT_CONFIGURED');
      const result = await authentication.completeLogin({
        code: request.query.code,
        state: request.query.state,
        ...(request.query.iss
          ? { authorizationResponseIssuer: request.query.iss }
          : {}),
      });
      return reply.header('set-cookie', result.sessionCookie).redirect(result.returnTo);
    },
  );

  typed.get(
    '/auth/session',
    {
      schema: {
        operationId: 'getBrowserSession',
        summary: '读取当前服务端会话和CSRF请求令牌',
        security: [{ browserSession: [] }],
        response: { 200: SessionResponseSchema, 401: AuthenticationErrorSchema, 503: AuthenticationErrorSchema },
      },
    },
    async (request) => {
      if (!authentication) throw new Error('AUTHENTICATION_RUNTIME_NOT_CONFIGURED');
      return authentication.getBrowserSession(request, false);
    },
  );

  typed.post(
    '/auth/logout',
    {
      schema: {
        operationId: 'logoutBrowserSession',
        summary: '撤销当前服务端会话',
        security: [{ browserSession: [] }],
        headers: CsrfHeadersSchema,
        response: {
          200: LogoutResponseSchema,
          401: AuthenticationErrorSchema,
          403: AuthenticationErrorSchema,
          503: AuthenticationErrorSchema,
        },
      },
    },
    async (request, reply) => {
      if (!authentication) throw new Error('AUTHENTICATION_RUNTIME_NOT_CONFIGURED');
      await authentication.logout(request);
      return reply
        .header('set-cookie', authentication.clearSessionCookie())
        .send({ loggedOut: true as const });
    },
  );
}
