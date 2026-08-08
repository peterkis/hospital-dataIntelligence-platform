import swagger from '@fastify/swagger';
import staticPlugin from '@fastify/static';
import {
  Type,
  TypeBoxValidatorCompiler,
} from '@fastify/type-provider-typebox';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  registerPhase01Routes,
  type Phase01HttpDependencies,
} from '../platform/fastify/register-phase-01-routes.js';
import type { KeycloakAuthentication } from '../platform/authentication/keycloak-authentication.js';
import { registerAuthenticationRoutes } from '../platform/fastify/register-authentication-routes.js';
import { PHASE_01_PROJECTION_CONTRACTS } from './create-scoped-modules.js';

const HealthResponseSchema = Type.Object(
  {
    status: Type.Literal('ok'),
  },
  {
    $id: 'HealthResponse',
    additionalProperties: false,
  },
);

export async function buildApplication(options?: {
  readonly adminStaticRoot?: string;
  readonly authentication?: KeycloakAuthentication;
  readonly phase01?: Phase01HttpDependencies;
}): Promise<FastifyInstance> {
  const application = Fastify({
    logger: false,
  })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler);

  await application.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Hospital Data Intelligence Governance API',
        version: '0.0.0-phase-01',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          browserSession: {
            type: 'apiKey',
            in: 'cookie',
            name: '__Host-hdi-session',
          },
          serviceBearer: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  // Fastify binds the active error handler to a route when that route is
  // registered. Install the platform mapper before any route or child plugin
  // so authentication and governance errors cannot fall through to Fastify's
  // default 500 response.
  application.setErrorHandler((error, request, reply) => {
    const mapped = mapError(error);
    void reply.code(mapped.statusCode).send({
      code: mapped.code,
      requestId: request.id,
    });
  });
  for (const contract of PHASE_01_PROJECTION_CONTRACTS) {
    application.addSchema(contract.schema);
  }

  application.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        summary: '检查治理 API 进程健康状态',
        security: [],
        response: {
          200: HealthResponseSchema,
        },
      },
    },
    async () => ({ status: 'ok' as const }),
  );

  await registerAuthenticationRoutes(application, options?.authentication);
  await registerPhase01Routes(application, options?.phase01);

  if (options?.adminStaticRoot) {
    await application.register(staticPlugin, {
      root: options.adminStaticRoot,
      prefix: '/admin/',
      wildcard: false,
    });
    application.get('/admin', { schema: { hide: true } }, async (_request, reply) =>
      reply.redirect('/admin/'),
    );
    application.get('/admin/*', { schema: { hide: true } }, async (_request, reply) =>
      reply.sendFile('index.html'),
    );
  }

  return application;
}

function mapError(error: unknown): {
  readonly statusCode: 400 | 401 | 403 | 404 | 409 | 500 | 503;
  readonly code: string;
} {
  if (!(error instanceof Error)) return { statusCode: 500, code: 'INTERNAL_ERROR' };
  const candidate = error as Error & { code?: string; validation?: unknown };
  if (candidate.validation) return { statusCode: 400, code: 'REQUEST_SCHEMA_INVALID' };
  if (candidate.message === 'PHASE_01_RUNTIME_NOT_CONFIGURED') {
    return { statusCode: 503, code: candidate.message };
  }
  if (candidate.message === 'AUTHENTICATION_RUNTIME_NOT_CONFIGURED') {
    return { statusCode: 503, code: candidate.message };
  }
  if (
    candidate.message.includes('UNAUTHENTICATED') ||
    candidate.message.includes('TOKEN_') ||
    candidate.message === 'EXTERNAL_IDENTITY_UNBOUND'
  ) {
    return { statusCode: 401, code: candidate.message };
  }
  if (candidate.message.endsWith('_FORBIDDEN')) return { statusCode: 403, code: candidate.message };
  if (candidate.message.includes('NOT_FOUND') || candidate.message.includes('NOT_AVAILABLE')) {
    return { statusCode: 404, code: candidate.message };
  }
  if (
    candidate.code === '23505' ||
    candidate.code === '23P01' ||
    candidate.message.includes('CONFLICT') ||
    candidate.message.includes('GAP') ||
    candidate.message.includes('IMMUTABLE')
  ) {
    return { statusCode: 409, code: candidate.code === '23505' ? 'UNIQUE_CONSTRAINT_CONFLICT' : candidate.message };
  }
  if (
    candidate.code === '23514' ||
    candidate.message.endsWith('_INVALID') ||
    candidate.message.includes('MISMATCH') ||
    candidate.message.includes('REQUIRED')
  ) {
    return { statusCode: 400, code: candidate.message };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR' };
}
