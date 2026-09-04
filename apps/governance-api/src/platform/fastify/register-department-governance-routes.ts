import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BrowserMutationHeadersSchema } from './browser-mutation-headers.js';
import {
  departmentDtoLocalDateTime,
  type DepartmentGovernanceApplicationContract,
} from '../../modules/department-master/index.js';
import type { RequestContext } from '../transaction/transaction-runner.js';
import {
  CreateDepartmentDraftBodySchema,
  DepartmentDecisionBodySchema,
  DepartmentDetailResponseSchema,
  DepartmentErrorResponseSchema,
  DepartmentGovernanceObjectQuerySchema,
  DepartmentGovernanceRequestParamsSchema,
  DepartmentGovernanceStatusResponseSchema,
  DepartmentHierarchyListResponseSchema,
  DepartmentHierarchyParamsSchema,
  DepartmentHistoryQuerySchema,
  DepartmentHistoryResponseSchema,
  DepartmentParamsSchema,
  DepartmentPublicationConfirmationBodySchema,
  DepartmentPublishedListQuerySchema,
  DepartmentQualityResponseSchema,
  DepartmentReviewQueueListResponseSchema,
  DepartmentSourceMappingConfirmationBodySchema,
  DepartmentSourceMappingListResponseSchema,
  DepartmentSourceMappingParamsSchema,
  DepartmentSummaryListResponseSchema,
  DepartmentVersionDifferenceQuerySchema,
  DepartmentVersionDifferenceResponseSchema,
  DepartmentVersionParamsSchema,
  SubmitDepartmentBodySchema,
} from './department-governance-schemas.js';
import {
  createHttpRequestContext,
  type HttpRequestContextDependencies,
} from './request-context.js';

export interface DepartmentGovernanceHttpDependencies
  extends HttpRequestContextDependencies {
  createApplication(context: RequestContext): DepartmentGovernanceApplicationContract;
}

const errorResponses = {
  400: DepartmentErrorResponseSchema,
  401: DepartmentErrorResponseSchema,
  403: DepartmentErrorResponseSchema,
  404: DepartmentErrorResponseSchema,
  409: DepartmentErrorResponseSchema,
  500: DepartmentErrorResponseSchema,
  503: DepartmentErrorResponseSchema,
};

export type DepartmentGovernanceRouteOptions =
  | {
    readonly surface: 'PROTOTYPE';
    readonly prefix: '/prototype/v1';
    readonly security?: undefined;
    readonly hide: true;
  }
  | {
    readonly surface: 'FORMAL_BROWSER';
    readonly prefix: '/v1/department-governance';
    readonly security: [{ browserSession: [] }];
    readonly hide: false;
  };

export async function registerDepartmentGovernanceRoutes(
  instance: FastifyInstance,
  dependencies: DepartmentGovernanceHttpDependencies | undefined,
  options: DepartmentGovernanceRouteOptions,
): Promise<void> {
  // Fail closed even for untyped callers; each surface has a disjoint prefix.
  const formal = options.surface === 'FORMAL_BROWSER';
  if (
    options.prefix !== (formal ? '/v1/department-governance' : '/prototype/v1')
    || options.hide !== !formal
    || (formal
      ? JSON.stringify(options.security) !== '[{"browserSession":[]}]'
      : options.security !== undefined)
  ) {
    throw new Error('DEPARTMENT_SURFACE_CONFIGURATION_INVALID');
  }
  await instance.register(async (scope) => {
    registerSurfaceRoutes(scope, dependencies, options);
  }, { prefix: options.prefix });
}

function registerSurfaceRoutes(
  instance: FastifyInstance,
  dependencies: DepartmentGovernanceHttpDependencies | undefined,
  options: DepartmentGovernanceRouteOptions,
): void {
  const fastify = instance.withTypeProvider<TypeBoxTypeProvider>();
  const formal = options.surface === 'FORMAL_BROWSER';
  const path = (formalPath: string, prototypePath = formalPath) =>
    formal ? formalPath : prototypePath;
  const surfaceSchema = (operationId: string, summary: string, mutation = false) => formal
    ? {
      hide: options.hide,
      security: options.security,
      tags: ['Department Governance'],
      operationId,
      summary,
      ...(mutation ? { headers: BrowserMutationHeadersSchema } : {}),
    }
    : { hide: options.hide };

  fastify.post(
    '/department-drafts',
    {
      schema: {
        ...surfaceSchema('createDepartmentDraft', '创建科室草稿', true),
        body: CreateDepartmentDraftBodySchema,
        response: {
          201: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const application = await createRequestApplication(request, dependencies);
      const result = await application.execute({
        commandName: 'CreateDepartmentDraft',
        governanceObjectId: request.body.governanceObjectId,
        departmentCode: request.body.departmentCode,
        content: {
          standardName: request.body.content.standardName,
          shortName: request.body.content.shortName,
          departmentType: request.body.content.departmentType,
          subjectMappingApplicability: request.body.content.subjectMappingApplicability,
          lifecycleStatus: request.body.content.lifecycleStatus,
          businessValidFrom: departmentDtoLocalDateTime(
            request.body.content.businessValidFrom,
          ),
          businessValidTo: request.body.content.businessValidTo === null
            ? null
            : departmentDtoLocalDateTime(request.body.content.businessValidTo),
          campusIds: request.body.content.campusIds,
        },
      });
      return reply.code(201).send(result);
    },
  );

  fastify.post(
    '/departments/:departmentId/versions/:departmentVersionId/submissions',
    {
      schema: {
        ...surfaceSchema('submitDepartmentGovernance', '提交科室治理申请', true),
        params: DepartmentVersionParamsSchema,
        body: SubmitDepartmentBodySchema,
        response: {
          201: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const application = await createRequestApplication(request, dependencies);
      const result = await application.execute({
        commandName: 'SubmitDepartmentGovernance',
        governanceObjectId: request.body.governanceObjectId,
        departmentId: request.params.departmentId,
        departmentVersionId: request.params.departmentVersionId,
        expectedContentHash: request.body.expectedContentHash,
        changeReason: request.body.changeReason,
      });
      return reply.code(201).send(result);
    },
  );

  fastify.post(
    path('/requests/:governanceRequestId/reviews', '/department-governance/:governanceRequestId/reviews'),
    {
      schema: {
        ...surfaceSchema('reviewDepartmentGovernance', '执行科室专业复核', true),
        params: DepartmentGovernanceRequestParamsSchema,
        body: DepartmentDecisionBodySchema,
        response: {
          200: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.execute({
        commandName: 'ReviewDepartment',
        governanceObjectId: request.body.governanceObjectId,
        governanceRequestId: request.params.governanceRequestId,
        departmentId: request.body.departmentId,
        departmentVersionId: request.body.departmentVersionId,
        seenContentHash: request.body.seenContentHash,
        decision: request.body.decision,
        reason: request.body.reason,
      });
    },
  );

  fastify.post(
    path('/requests/:governanceRequestId/approvals', '/department-governance/:governanceRequestId/approvals'),
    {
      schema: {
        ...surfaceSchema('approveDepartmentGovernance', '最终审批并原子发布科室版本', true),
        params: DepartmentGovernanceRequestParamsSchema,
        body: DepartmentDecisionBodySchema,
        response: {
          200: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.execute({
        commandName: 'ApproveDepartment',
        governanceObjectId: request.body.governanceObjectId,
        governanceRequestId: request.params.governanceRequestId,
        departmentId: request.body.departmentId,
        departmentVersionId: request.body.departmentVersionId,
        seenContentHash: request.body.seenContentHash,
        decision: request.body.decision,
        reason: request.body.reason,
      });
    },
  );

  fastify.post(
    path('/requests/:governanceRequestId/publication-confirmations', '/department-governance/:governanceRequestId/publication-confirmations'),
    {
      schema: {
        ...surfaceSchema('confirmDepartmentPublication', '确认既有科室发布后置条件', true),
        params: DepartmentGovernanceRequestParamsSchema,
        body: DepartmentPublicationConfirmationBodySchema,
        response: {
          200: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.execute({
        commandName: 'PublishDepartment',
        governanceObjectId: request.body.governanceObjectId,
        governanceRequestId: request.params.governanceRequestId,
        departmentId: request.body.departmentId,
        departmentVersionId: request.body.departmentVersionId,
        approvedContentHash: request.body.approvedContentHash,
      });
    },
  );

  fastify.post(
    '/departments/:departmentId/source-mappings/:mappingId/confirmations',
    {
      schema: {
        ...surfaceSchema('confirmDepartmentSourceMapping', '确认科室来源映射', true),
        params: DepartmentSourceMappingParamsSchema,
        body: DepartmentSourceMappingConfirmationBodySchema,
        response: {
          200: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.execute({
        commandName: 'ConfirmSourceMapping',
        governanceObjectId: request.body.governanceObjectId,
        departmentId: request.params.departmentId,
        mappingId: request.params.mappingId,
      });
    },
  );

  fastify.get(
    '/departments',
    {
      schema: {
        ...surfaceSchema('listPublishedDepartments', '查询治理工作台已发布科室列表'),
        querystring: DepartmentPublishedListQuerySchema,
        response: {
          200: DepartmentSummaryListResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      const filter = {
        ...(request.query.departmentCode === undefined
          ? {}
          : { departmentCode: request.query.departmentCode }),
        ...(request.query.standardName === undefined
          ? {}
          : { standardName: request.query.standardName }),
        ...(request.query.departmentType === undefined
          ? {}
          : { departmentType: request.query.departmentType }),
        ...(request.query.campusId === undefined
          ? {}
          : { campusId: request.query.campusId }),
      };
      return application.listPublishedDepartments({
        governanceObjectId: request.query.governanceObjectId,
        ...(Object.keys(filter).length === 0 ? {} : { filter }),
      });
    },
  );

  fastify.get(
    '/departments/:departmentId',
    {
      schema: {
        ...surfaceSchema('getPublishedDepartment', '查询治理工作台已发布科室详情'),
        params: DepartmentParamsSchema,
        querystring: DepartmentGovernanceObjectQuerySchema,
        response: {
          200: DepartmentDetailResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getPublishedDepartment({
        governanceObjectId: request.query.governanceObjectId,
        departmentId: request.params.departmentId,
      });
    },
  );

  fastify.get(
    '/departments/:departmentId/history',
    {
      schema: {
        ...surfaceSchema('getDepartmentHistory', '查询科室业务时点历史'),
        params: DepartmentParamsSchema,
        querystring: DepartmentHistoryQuerySchema,
        response: {
          200: DepartmentHistoryResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getDepartmentHistory({
        governanceObjectId: request.query.governanceObjectId,
        departmentId: request.params.departmentId,
        asOf: departmentDtoLocalDateTime(request.query.asOf),
      });
    },
  );

  fastify.get(
    path('/hierarchies/:viewType', '/department-hierarchies/:viewType'),
    {
      schema: {
        ...surfaceSchema('getDepartmentHierarchy', '查询已发布科室层级视图'),
        params: DepartmentHierarchyParamsSchema,
        querystring: DepartmentGovernanceObjectQuerySchema,
        response: {
          200: DepartmentHierarchyListResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getDepartmentHierarchy({
        governanceObjectId: request.query.governanceObjectId,
        viewType: request.params.viewType,
      });
    },
  );

  fastify.get(
    '/departments/:departmentId/source-mappings',
    {
      schema: {
        ...surfaceSchema('getDepartmentSourceMappings', '查询科室来源映射'),
        params: DepartmentParamsSchema,
        querystring: DepartmentGovernanceObjectQuerySchema,
        response: {
          200: DepartmentSourceMappingListResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getDepartmentSourceMappings({
        governanceObjectId: request.query.governanceObjectId,
        departmentId: request.params.departmentId,
      });
    },
  );

  fastify.get(
    '/departments/:departmentId/quality',
    {
      schema: {
        ...surfaceSchema('getDepartmentQuality', '查询科室质量评分'),
        params: DepartmentParamsSchema,
        querystring: DepartmentGovernanceObjectQuerySchema,
        response: {
          200: DepartmentQualityResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getDepartmentQuality({
        governanceObjectId: request.query.governanceObjectId,
        departmentId: request.params.departmentId,
      });
    },
  );

  fastify.get(
    '/departments/:departmentId/governance-status',
    {
      schema: {
        ...surfaceSchema('getDepartmentGovernanceStatus', '查询科室治理状态'),
        params: DepartmentParamsSchema,
        querystring: DepartmentGovernanceObjectQuerySchema,
        response: {
          200: DepartmentGovernanceStatusResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getGovernanceStatus({
        governanceObjectId: request.query.governanceObjectId,
        departmentId: request.params.departmentId,
      });
    },
  );

  fastify.get(
    path('/pending-reviews', '/department-governance/pending-reviews'),
    {
      schema: {
        ...surfaceSchema('listDepartmentPendingReviews', '查询科室待审核事项'),
        querystring: DepartmentGovernanceObjectQuerySchema,
        response: {
          200: DepartmentReviewQueueListResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.findPendingReviews({
        governanceObjectId: request.query.governanceObjectId,
      });
    },
  );

  fastify.get(
    '/departments/:departmentId/version-difference',
    {
      schema: {
        ...surfaceSchema('getDepartmentVersionDifference', '查询科室版本差异'),
        params: DepartmentParamsSchema,
        querystring: DepartmentVersionDifferenceQuerySchema,
        response: {
          200: DepartmentVersionDifferenceResponseSchema,
          ...errorResponses,
        },
      },
    },
    async (request) => {
      const application = await createRequestApplication(request, dependencies);
      return application.getVersionDifference({
        governanceObjectId: request.query.governanceObjectId,
        departmentId: request.params.departmentId,
        fromVersionNo: request.query.fromVersionNo ?? null,
        toVersionNo: request.query.toVersionNo,
      });
    },
  );
}

async function createRequestApplication(
  request: FastifyRequest,
  dependencies: DepartmentGovernanceHttpDependencies | undefined,
): Promise<DepartmentGovernanceApplicationContract> {
  const runtime = requireRuntime(dependencies);
  const context = await createHttpRequestContext(request, runtime, 'PERSON');
  return runtime.createApplication(context);
}

function requireRuntime(
  dependencies: DepartmentGovernanceHttpDependencies | undefined,
): DepartmentGovernanceHttpDependencies {
  if (!dependencies) throw new Error('DEPARTMENT_RUNTIME_NOT_CONFIGURED');
  return dependencies;
}
