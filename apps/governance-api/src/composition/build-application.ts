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
import { mapHttpError } from '../platform/fastify/map-http-error.js';
import { PHASE_01_PROJECTION_CONTRACTS } from './create-scoped-modules.js';
import {
  registerDepartmentGovernanceRoutes,
  type DepartmentGovernanceHttpDependencies,
} from '../platform/fastify/register-department-governance-routes.js';

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
  readonly departmentGovernance?: DepartmentGovernanceHttpDependencies;
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
      ...(options?.departmentGovernance ? {
        tags: [{
          name: 'Department Governance',
          description: '面向治理工作台人员的科室主数据治理接口，不是第三方系统主数据消费接口。',
        }],
      } : {}),
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
    const mapped = mapHttpError(error);
    void reply.code(mapped.statusCode).send({
      code: mapped.code,
      requestId: request.id,
    });
  });
  for (const contract of PHASE_01_PROJECTION_CONTRACTS) {
    const schemaId = (contract.schema as { readonly $id?: unknown }).$id;
    if (typeof schemaId === 'string' && schemaId.length > 0) {
      application.addSchema(contract.schema);
    }
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
  if (options?.departmentGovernance) {
    await registerDepartmentGovernanceRoutes(application, options.departmentGovernance, {
      surface: 'FORMAL_BROWSER',
      prefix: '/v1/department-governance',
      security: [{ browserSession: [] }],
      hide: false,
    });
  }

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
