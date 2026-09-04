import {
  TypeBoxValidatorCompiler,
  type TypeBoxTypeProvider,
} from '@fastify/type-provider-typebox';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DepartmentContractError,
  departmentDtoLocalDateTime,
  type DepartmentCommand,
  type DepartmentDetailDTO,
  type DepartmentGovernanceApplicationContract,
  type DepartmentGovernanceStatusView,
  type DepartmentHierarchyDTO,
  type DepartmentHistoryDTO,
  type DepartmentQualityDTO,
  type DepartmentReviewQueueItem,
  type DepartmentSourceMappingDTO,
  type DepartmentSummaryDTO,
  type DepartmentVersionDifference,
} from '../../modules/department-master/index.js';
import {
  PROTOTYPE_CSRF_TOKEN,
  createPrototypeAuthentication,
} from '../authentication/prototype-authentication.js';
import type { RequestContext } from '../transaction/transaction-runner.js';
import { mapHttpError } from './map-http-error.js';
import { buildApplication } from '../../composition/build-application.js';
import type { KeycloakAuthentication } from '../authentication/keycloak-authentication.js';
import {
  registerDepartmentGovernanceRoutes,
  type DepartmentGovernanceHttpDependencies,
} from './register-department-governance-routes.js';

const GOVERNANCE_OBJECT_ID = '74000000-0000-7000-8000-000000000001';
const DEPARTMENT_ID = '72000000-0000-7000-8000-000000000001';
const DEPARTMENT_VERSION_ID = '73000000-0000-7000-8000-000000000001';
const GOVERNANCE_REQUEST_ID = '75000000-0000-7000-8000-000000000001';
const MAPPING_ID = '76000000-0000-7000-8000-000000000001';
const CAMPUS_ID = '71000000-0000-7000-8000-000000000001';
const RELEASE_ID = '77000000-0000-7000-8000-000000000001';
const ACTOR_ID = '70000000-0000-7000-8000-000000000001';
const OTHER_ACTOR_ID = '70000000-0000-7000-8000-000000000002';
const NOW = '2026-09-04T10:11:12';
const DIGEST = 'a'.repeat(64);

const CREATE_BODY = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  departmentCode: 'RESP-001',
  content: {
    standardName: 'Respiratory Medicine',
    shortName: 'Respiratory',
    departmentType: 'CLINICAL',
    subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
    lifecycleStatus: 'ACTIVE',
    businessValidFrom: NOW,
    businessValidTo: null,
    campusIds: [CAMPUS_ID],
  },
} as const;

const SUBMIT_BODY = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  expectedContentHash: DIGEST,
  changeReason: 'Initial governed publication',
} as const;

const DECISION_BODY = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  departmentId: DEPARTMENT_ID,
  departmentVersionId: DEPARTMENT_VERSION_ID,
  seenContentHash: DIGEST,
  decision: 'APPROVED',
  reason: 'Reviewed against the frozen content',
} as const;

const PUBLICATION_BODY = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  departmentId: DEPARTMENT_ID,
  departmentVersionId: DEPARTMENT_VERSION_ID,
  approvedContentHash: DIGEST,
} as const;

const STATUS_VIEW: DepartmentGovernanceStatusView = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  departmentId: DEPARTMENT_ID,
  departmentVersionId: DEPARTMENT_VERSION_ID,
  governanceRequestId: GOVERNANCE_REQUEST_ID,
  status: 'PUBLISHED',
  contentHash: DIGEST,
};

const HIERARCHY: DepartmentHierarchyDTO = {
  departmentId: DEPARTMENT_ID,
  viewType: 'ADMINISTRATIVE',
  hierarchyPath: [{ nodeId: DEPARTMENT_ID, displayName: 'Respiratory Medicine' }],
};

const SOURCE_MAPPING: DepartmentSourceMappingDTO = {
  sourceSystem: 'SYNTHETIC_HIS',
  sourceCode: 'RESP',
  sourceName: 'Respiratory',
  mappingStatus: 'CONFIRMED',
};

const QUALITY: DepartmentQualityDTO = {
  departmentId: DEPARTMENT_ID,
  qualityScore: '100.00',
  completenessScore: '100.00',
  uniquenessScore: '100.00',
  standardizationScore: '100.00',
};

const SUMMARY: DepartmentSummaryDTO = {
  departmentId: DEPARTMENT_ID,
  departmentCode: 'RESP-001',
  standardName: 'Respiratory Medicine',
  shortName: 'Respiratory',
  departmentType: 'CLINICAL',
  lifecycleStatus: 'ACTIVE',
  campuses: [{
    campusId: CAMPUS_ID,
    campusCode: 'HQ',
    campusName: 'Synthetic Headquarters Campus',
  }],
  publishedAt: departmentDtoLocalDateTime(NOW),
};

const DETAIL: DepartmentDetailDTO = {
  ...SUMMARY,
  subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
  hierarchyViews: [HIERARCHY],
  sourceMappings: [SOURCE_MAPPING],
  quality: QUALITY,
  publishedReleaseId: RELEASE_ID,
  contentHash: DIGEST,
};

const HISTORY: DepartmentHistoryDTO = {
  departmentId: DEPARTMENT_ID,
  versionNo: '1',
  asOf: departmentDtoLocalDateTime(NOW),
  businessValidFrom: departmentDtoLocalDateTime('2026-09-01T00:00:00'),
  businessValidTo: null,
  department: DETAIL,
};

const REVIEW_QUEUE_ITEM: DepartmentReviewQueueItem = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  governanceRequestId: GOVERNANCE_REQUEST_ID,
  departmentId: DEPARTMENT_ID,
  departmentVersionId: DEPARTMENT_VERSION_ID,
  departmentCode: 'RESP-001',
  standardName: 'Respiratory Medicine',
  status: 'AWAITING_FINAL',
  submittedAt: departmentDtoLocalDateTime(NOW),
  contentHash: DIGEST,
};

const VERSION_DIFFERENCE: DepartmentVersionDifference = {
  governanceObjectId: GOVERNANCE_OBJECT_ID,
  departmentId: DEPARTMENT_ID,
  fromVersionNo: null,
  toVersionNo: '1',
  differences: [{ field: 'standardName', before: null, after: 'Respiratory Medicine' }],
};

function createFakeContract() {
  return {
    execute: vi.fn(async (_command: DepartmentCommand) => STATUS_VIEW),
    listPublishedDepartments: vi.fn(async () => [SUMMARY] as const),
    getPublishedDepartment: vi.fn(async () => DETAIL),
    getDepartmentHistory: vi.fn(async () => HISTORY),
    getDepartmentHierarchy: vi.fn(async () => [HIERARCHY] as const),
    getDepartmentSourceMappings: vi.fn(async () => [SOURCE_MAPPING] as const),
    getDepartmentQuality: vi.fn(async () => QUALITY),
    getGovernanceStatus: vi.fn(async () => STATUS_VIEW),
    findPendingReviews: vi.fn(async () => [REVIEW_QUEUE_ITEM] as const),
    getVersionDifference: vi.fn(async () => VERSION_DIFFERENCE),
  } satisfies DepartmentGovernanceApplicationContract;
}

type FakeContract = ReturnType<typeof createFakeContract>;

function createDependencies(
  contract: DepartmentGovernanceApplicationContract = createFakeContract(),
  overrides?: Partial<DepartmentGovernanceHttpDependencies>,
) {
  return {
    resolvePrincipal: async () => ({
      principalId: ACTOR_ID,
      principalKind: 'PERSON' as const,
    }),
    now: () => NOW,
    ...overrides,
    createApplication: vi.fn<DepartmentGovernanceHttpDependencies['createApplication']>(
      (_context) => contract,
    ),
  } satisfies DepartmentGovernanceHttpDependencies;
}

interface ObservedRoute {
  readonly method: string;
  readonly url: string;
  readonly hidden: boolean;
}

const applications: FastifyInstance[] = [];

async function buildTestApplication(
  dependencies: DepartmentGovernanceHttpDependencies | null = createDependencies(),
  observedRoutes?: ObservedRoute[],
): Promise<FastifyInstance> {
  const application = Fastify({ logger: false })
    .withTypeProvider<TypeBoxTypeProvider>()
    .setValidatorCompiler(TypeBoxValidatorCompiler);
  applications.push(application);

  application.setErrorHandler((error, request, reply) => {
    const mapped = mapHttpError(error);
    return reply.code(mapped.statusCode).send({
      code: mapped.code,
      requestId: request.id,
    });
  });

  if (observedRoutes) {
    application.addHook('onRoute', (route) => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        if (method !== 'HEAD') {
          observedRoutes.push({
            method,
            url: route.url,
            hidden: route.schema?.hide === true,
          });
        }
      }
    });
  }

  await registerDepartmentGovernanceRoutes(
    application,
    dependencies ?? undefined,
    { surface: 'PROTOTYPE', prefix: '/prototype/v1', hide: true },
  );
  return application;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map(async (application) => application.close()));
  vi.restoreAllMocks();
});

describe('department governance Fastify adapter registration and context', () => {
  it('1. registers exactly the fifteen relative routes under the supplied prefix', async () => {
    const routes: ObservedRoute[] = [];
    await buildTestApplication(createDependencies(), routes);

    expect(routes.map(({ method, url }) => `${method} ${url}`).sort()).toEqual([
      'GET /prototype/v1/department-governance/pending-reviews',
      'GET /prototype/v1/department-hierarchies/:viewType',
      'GET /prototype/v1/departments',
      'GET /prototype/v1/departments/:departmentId',
      'GET /prototype/v1/departments/:departmentId/governance-status',
      'GET /prototype/v1/departments/:departmentId/history',
      'GET /prototype/v1/departments/:departmentId/quality',
      'GET /prototype/v1/departments/:departmentId/source-mappings',
      'GET /prototype/v1/departments/:departmentId/version-difference',
      'POST /prototype/v1/department-drafts',
      'POST /prototype/v1/department-governance/:governanceRequestId/approvals',
      'POST /prototype/v1/department-governance/:governanceRequestId/publication-confirmations',
      'POST /prototype/v1/department-governance/:governanceRequestId/reviews',
      'POST /prototype/v1/departments/:departmentId/source-mappings/:mappingId/confirmations',
      'POST /prototype/v1/departments/:departmentId/versions/:departmentVersionId/submissions',
    ].sort());
  });

  it('2. hides every department prototype route from OpenAPI generation', async () => {
    const routes: ObservedRoute[] = [];
    await buildTestApplication(createDependencies(), routes);

    expect(routes).toHaveLength(15);
    expect(routes.every((route) => route.hidden)).toBe(true);
  });

  it('3. returns the stable 503 response when department runtime is absent', async () => {
    const application = await buildTestApplication(null);

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'DEPARTMENT_RUNTIME_NOT_CONFIGURED',
      requestId: expect.any(String),
    });
  });

  it('4. creates a distinct request-scoped application for every HTTP request', async () => {
    const created: DepartmentGovernanceApplicationContract[] = [];
    const dependencies = createDependencies(createFakeContract());
    dependencies.createApplication.mockImplementation(() => {
      const contract = createFakeContract();
      created.push(contract);
      return contract;
    });
    const application = await buildTestApplication(dependencies);

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });
    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(created).toHaveLength(2);
    expect(created[0]).not.toBe(created[1]);
  });

  it('5. creates the request-scoped application exactly once within one request', async () => {
    const dependencies = createDependencies();
    const application = await buildTestApplication(dependencies);

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(dependencies.createApplication).toHaveBeenCalledTimes(1);
  });

  it('6. binds the trusted resolved PERSON principal to RequestContext', async () => {
    let context: RequestContext | undefined;
    const dependencies = createDependencies(createFakeContract(), {
      resolvePrincipal: async () => ({
        principalId: OTHER_ACTOR_ID,
        principalKind: 'PERSON',
      }),
    });
    dependencies.createApplication.mockImplementation((received) => {
      context = received;
      return createFakeContract();
    });
    const application = await buildTestApplication(dependencies);

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(context?.actorPrincipalId).toBe(OTHER_ACTOR_ID);
  });

  it.each([
    'actorId',
    'actorPrincipalId',
    'reviewerId',
    'approverId',
    'occurredAt',
    'requestId',
    'correlationId',
  ])('7. rejects forged trusted body field %s', async (field) => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: { ...CREATE_BODY, [field]: OTHER_ACTOR_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('8. places x-request-id into the trusted RequestContext', async () => {
    let context: RequestContext | undefined;
    const dependencies = createDependencies();
    dependencies.createApplication.mockImplementation((received) => {
      context = received;
      return createFakeContract();
    });
    const application = await buildTestApplication(dependencies);

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
      headers: { 'x-request-id': 'department-request-1' },
    });

    expect(context?.requestId).toBe('department-request-1');
  });

  it('9. places x-correlation-id into the trusted RequestContext', async () => {
    let context: RequestContext | undefined;
    const dependencies = createDependencies();
    dependencies.createApplication.mockImplementation((received) => {
      context = received;
      return createFakeContract();
    });
    const application = await buildTestApplication(dependencies);

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
      headers: {
        'x-request-id': 'department-request-1',
        'x-correlation-id': 'department-correlation-1',
      },
    });

    expect(context?.correlationId).toBe('department-correlation-1');
  });

  it('10. obtains occurredAt exclusively from the server-side clock', async () => {
    let context: RequestContext | undefined;
    const dependencies = createDependencies(createFakeContract(), {
      now: () => '2026-09-04T23:59:58',
    });
    dependencies.createApplication.mockImplementation((received) => {
      context = received;
      return createFakeContract();
    });
    const application = await buildTestApplication(dependencies);

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(context?.occurredAt).toBe('2026-09-04T23:59:58');
  });
});

describe('department governance Fastify command mapping', () => {
  it('11. maps draft creation to CreateDepartmentDraft', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: CREATE_BODY,
    });

    expect(contract.execute).toHaveBeenCalledWith(expect.objectContaining({
      commandName: 'CreateDepartmentDraft',
    }));
  });

  it('12. preserves the frozen departmentCode and content body without context fields', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: CREATE_BODY,
    });

    expect(contract.execute).toHaveBeenCalledWith({
      commandName: 'CreateDepartmentDraft',
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentCode: CREATE_BODY.departmentCode,
      content: CREATE_BODY.content,
    });
  });

  it('13. merges submission path identifiers with the frozen body', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/versions/${DEPARTMENT_VERSION_ID}/submissions`,
      payload: SUBMIT_BODY,
    });

    expect(contract.execute).toHaveBeenCalledWith({
      commandName: 'SubmitDepartmentGovernance',
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
      departmentVersionId: DEPARTMENT_VERSION_ID,
      expectedContentHash: DIGEST,
      changeReason: SUBMIT_BODY.changeReason,
    });
  });

  it('14. maps professional review to ReviewDepartment', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/reviews`,
      payload: DECISION_BODY,
    });

    expect(contract.execute).toHaveBeenCalledWith({
      commandName: 'ReviewDepartment',
      governanceRequestId: GOVERNANCE_REQUEST_ID,
      ...DECISION_BODY,
    });
  });

  it('15. maps Owner final approval only to ApproveDepartment', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/approvals`,
      payload: DECISION_BODY,
    });

    expect(contract.execute).toHaveBeenCalledWith({
      commandName: 'ApproveDepartment',
      governanceRequestId: GOVERNANCE_REQUEST_ID,
      ...DECISION_BODY,
    });
  });

  it('16. does not invoke PublishDepartment after Owner approval', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/approvals`,
      payload: DECISION_BODY,
    });

    expect(contract.execute).toHaveBeenCalledTimes(1);
    expect(contract.execute.mock.calls.map(([command]) => command.commandName)).toEqual([
      'ApproveDepartment',
    ]);
  });

  it('17. maps publication confirmation to PublishDepartment', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/publication-confirmations`,
      payload: PUBLICATION_BODY,
    });

    expect(contract.execute).toHaveBeenCalledWith({
      commandName: 'PublishDepartment',
      governanceRequestId: GOVERNANCE_REQUEST_ID,
      ...PUBLICATION_BODY,
    });
  });

  it('18. maps source mapping confirmation to ConfirmSourceMapping', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/source-mappings/${MAPPING_ID}/confirmations`,
      payload: { governanceObjectId: GOVERNANCE_OBJECT_ID },
    });

    expect(contract.execute).toHaveBeenCalledWith({
      commandName: 'ConfirmSourceMapping',
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
      mappingId: MAPPING_ID,
    });
  });

  it('19. exposes no source-mapping creation action while confirming an existing mapping', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'POST',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/source-mappings/${MAPPING_ID}/confirmations`,
      payload: { governanceObjectId: GOVERNANCE_OBJECT_ID },
    });

    expect(contract.execute).toHaveBeenCalledTimes(1);
    expect(contract.execute.mock.calls[0]?.[0].commandName).toBe('ConfirmSourceMapping');
  });

  it.each([
    ['submission departmentId',
      `/prototype/v1/departments/${DEPARTMENT_ID}/versions/${DEPARTMENT_VERSION_ID}/submissions`,
      { ...SUBMIT_BODY, departmentId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    ['review governanceRequestId',
      `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/reviews`,
      { ...DECISION_BODY, governanceRequestId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
    ['mapping mappingId',
      `/prototype/v1/departments/${DEPARTMENT_ID}/source-mappings/${MAPPING_ID}/confirmations`,
      { governanceObjectId: GOVERNANCE_OBJECT_ID, mappingId: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
  ])('20. rejects a body attempt to override the trusted path %s', async (_case, url, payload) => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({ method: 'POST', url, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });
});

describe('department governance Fastify query mapping', () => {
  it('21. constructs an optional list filter from only provided filter fields', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });
    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}&departmentCode=RESP-001&standardName=Respiratory%20Medicine&departmentType=CLINICAL&campusId=${CAMPUS_ID}`,
    });

    expect(contract.listPublishedDepartments.mock.calls).toEqual([
      [{ governanceObjectId: GOVERNANCE_OBJECT_ID }],
      [{
        governanceObjectId: GOVERNANCE_OBJECT_ID,
        filter: {
          departmentCode: 'RESP-001',
          standardName: 'Respiratory Medicine',
          departmentType: 'CLINICAL',
          campusId: CAMPUS_ID,
        },
      }],
    ]);
  });

  it('22. maps published detail query identifiers exactly', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(contract.getPublishedDepartment).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
    });
  });

  it('23. maps history asOf through the whole-second local date-time contract', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/history?governanceObjectId=${GOVERNANCE_OBJECT_ID}&asOf=${NOW}`,
    });

    expect(contract.getDepartmentHistory).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
      asOf: NOW,
    });
  });

  it('24. maps the hierarchy viewType path to the application query', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/department-hierarchies/ADMINISTRATIVE?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(contract.getDepartmentHierarchy).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      viewType: 'ADMINISTRATIVE',
    });
  });

  it('25. maps source-mapping query identifiers exactly', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/source-mappings?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(contract.getDepartmentSourceMappings).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
    });
  });

  it('26. maps quality query identifiers exactly', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/quality?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(contract.getDepartmentQuality).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
    });
  });

  it('27. maps governance-status query identifiers exactly', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/governance-status?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(contract.getGovernanceStatus).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
    });
  });

  it('28. maps pending-review governance scope exactly', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/department-governance/pending-reviews?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(contract.findPendingReviews).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
    });
  });

  it('29. normalizes an absent fromVersionNo to null', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/version-difference?governanceObjectId=${GOVERNANCE_OBJECT_ID}&toVersionNo=1`,
    });

    expect(contract.getVersionDifference).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
      fromVersionNo: null,
      toVersionNo: '1',
    });
  });

  it('30. delegates queries through the application contract without a database seam', async () => {
    const contract = createFakeContract();
    const dependencies = createDependencies(contract) as DepartmentGovernanceHttpDependencies & {
      readonly database?: never;
      readonly workflow?: never;
    };
    Object.defineProperties(dependencies, {
      database: { get: () => { throw new Error('DIRECT_DATABASE_ACCESS'); } },
      workflow: { get: () => { throw new Error('DIRECT_WORKFLOW_ACCESS'); } },
    });
    const application = await buildTestApplication(dependencies);

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/quality?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(contract.getDepartmentQuality).toHaveBeenCalledOnce();
  });
});

describe('department governance Fastify success and error statuses', () => {
  it('31. returns 201 for successful draft creation', async () => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: CREATE_BODY,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(STATUS_VIEW);
  });

  it('32. returns 201 for successful governance submission', async () => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/versions/${DEPARTMENT_VERSION_ID}/submissions`,
      payload: SUBMIT_BODY,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual(STATUS_VIEW);
  });

  it.each([
    ['review', `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/reviews`, DECISION_BODY],
    ['approval', `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/approvals`, DECISION_BODY],
    ['publication confirmation', `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/publication-confirmations`, PUBLICATION_BODY],
    ['mapping confirmation', `/prototype/v1/departments/${DEPARTMENT_ID}/source-mappings/${MAPPING_ID}/confirmations`, { governanceObjectId: GOVERNANCE_OBJECT_ID }],
  ])('33. returns 200 for successful %s', async (_case, url, payload) => {
    const application = await buildTestApplication();

    const response = await application.inject({ method: 'POST', url, payload });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(STATUS_VIEW);
  });

  it('34. maps a missing prototype principal to 401', async () => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'test',
      prototypeMode: 'true',
    });
    const dependencies = createDependencies(createFakeContract(), {
      resolvePrincipal: authentication.resolvePrincipal,
    });
    const application = await buildTestApplication(dependencies);

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      code: 'PROTOTYPE_PRINCIPAL_UNAUTHENTICATED',
      requestId: expect.any(String),
    });
    expect(dependencies.createApplication).not.toHaveBeenCalled();
  });

  it('35. maps an incorrect prototype CSRF guard to 403', async () => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'test',
      prototypeMode: 'true',
    });
    const dependencies = createDependencies(createFakeContract(), {
      resolvePrincipal: authentication.resolvePrincipal,
    });
    const application = await buildTestApplication(dependencies);

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      headers: {
        'x-prototype-principal-code': 'prototype-owner',
        'x-csrf-token': 'prototype-csrf-guard-incorrect-value',
      },
      payload: CREATE_BODY,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: 'PROTOTYPE_CSRF_FORBIDDEN',
      requestId: expect.any(String),
    });
    expect(dependencies.createApplication).not.toHaveBeenCalled();
  });

  it('36. maps department permission denial to 403', async () => {
    const contract = createFakeContract();
    contract.execute.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_PERMISSION_DENIED'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: CREATE_BODY,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('DEPARTMENT_PERMISSION_DENIED');
  });

  it('37. maps a missing department to 404', async () => {
    const contract = createFakeContract();
    contract.getPublishedDepartment.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_NOT_FOUND'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('DEPARTMENT_NOT_FOUND');
  });

  it('38. maps an invalid department status to 409', async () => {
    const contract = createFakeContract();
    contract.execute.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_STATUS_INVALID'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: CREATE_BODY,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('DEPARTMENT_STATUS_INVALID');
  });

  it('39. maps missing final approval to 409', async () => {
    const contract = createFakeContract();
    contract.execute.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_APPROVAL_REQUIRED'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/publication-confirmations`,
      payload: PUBLICATION_BODY,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('DEPARTMENT_APPROVAL_REQUIRED');
  });

  it('40. maps content drift to 409', async () => {
    const contract = createFakeContract();
    contract.execute.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_CONTENT_CHANGED'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/reviews`,
      payload: DECISION_BODY,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('DEPARTMENT_CONTENT_CHANGED');
  });

  it('41. maps a missing SUPERSEDED evolution relation to 409', async () => {
    const contract = createFakeContract();
    contract.execute.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_EVOLUTION_RELATION_REQUIRED'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        content: { ...CREATE_BODY.content, lifecycleStatus: 'SUPERSEDED' },
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('DEPARTMENT_EVOLUTION_RELATION_REQUIRED');
  });

  it('42. maps an unknown exception to a sanitized 500 response', async () => {
    const contract = createFakeContract();
    contract.getDepartmentQuality.mockRejectedValueOnce(
      new Error('password=secret DATABASE_URL=postgres://private SQLSTATE=XX000'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/quality?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
      headers: { 'x-request-id': 'untrusted-error-request' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      code: 'INTERNAL_ERROR',
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain('password');
    expect(response.body).not.toContain('DATABASE_URL');
    expect(response.body).not.toContain('SQLSTATE');
    expect(response.body).not.toContain('stack');
  });

  it('also maps a missing department version to 404', async () => {
    const contract = createFakeContract();
    contract.getVersionDifference.mockRejectedValueOnce(
      new DepartmentContractError('DEPARTMENT_VERSION_NOT_FOUND'),
    );
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/version-difference?governanceObjectId=${GOVERNANCE_OBJECT_ID}&toVersionNo=999`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().code).toBe('DEPARTMENT_VERSION_NOT_FOUND');
  });

  it('rejects a SERVICE principal before creating a PERSON-scoped application', async () => {
    const dependencies = createDependencies(createFakeContract(), {
      resolvePrincipal: async () => ({
        principalId: OTHER_ACTOR_ID,
        principalKind: 'SERVICE',
      }),
    });
    const application = await buildTestApplication(dependencies);

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('PRINCIPAL_KIND_FORBIDDEN');
    expect(dependencies.createApplication).not.toHaveBeenCalled();
  });

  it('accepts the real fixed prototype principal and CSRF guard for mutation', async () => {
    const authentication = createPrototypeAuthentication({
      host: '127.0.0.1',
      nodeEnvironment: 'test',
      prototypeMode: 'true',
    });
    let context: RequestContext | undefined;
    const dependencies = createDependencies(createFakeContract(), {
      resolvePrincipal: authentication.resolvePrincipal,
    });
    dependencies.createApplication.mockImplementation((received) => {
      context = received;
      return createFakeContract();
    });
    const application = await buildTestApplication(dependencies);

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      headers: {
        'x-prototype-principal-code': 'prototype-owner',
        'x-csrf-token': PROTOTYPE_CSRF_TOKEN,
      },
      payload: CREATE_BODY,
    });

    expect(response.statusCode).toBe(201);
    expect(context?.actorPrincipalId).toBe(ACTOR_ID);
  });
});

describe('department governance Fastify schemas', () => {
  it.each([
    ['top-level body', { ...CREATE_BODY, description: 'not frozen' }, '/prototype/v1/department-drafts'],
    ['nested content', { ...CREATE_BODY, content: { ...CREATE_BODY.content, description: 'not frozen' } }, '/prototype/v1/department-drafts'],
  ])('43. rejects an undeclared %s field', async (_case, payload, url) => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({ method: 'POST', url, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('43. rejects undeclared list query fields', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}&sql=select-all`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.listPublishedDepartments).not.toHaveBeenCalled();
  });

  it.each([
    ['body', { ...CREATE_BODY, governanceObjectId: 'NOT-A-UUID' }, '/prototype/v1/department-drafts'],
    ['path', undefined, '/prototype/v1/departments/NOT-A-UUID/quality?governanceObjectId=' + GOVERNANCE_OBJECT_ID],
    ['query', undefined, `/prototype/v1/departments/${DEPARTMENT_ID}/quality?governanceObjectId=NOT-A-UUID`],
  ])('44. rejects an illegal UUID in the %s', async (_case, payload, url) => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: payload ? 'POST' : 'GET',
      url,
      ...(payload ? { payload } : {}),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
  });

  it.each([
    ['too short', 'a'.repeat(63)],
    ['uppercase', 'A'.repeat(64)],
    ['non-hex', 'g'.repeat(64)],
  ])('45. rejects a %s content digest', async (_case, expectedContentHash) => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/versions/${DEPARTMENT_VERSION_ID}/submissions`,
      payload: { ...SUBMIT_BODY, expectedContentHash },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('46. rejects a Z-suffixed department local date-time', async () => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        content: { ...CREATE_BODY.content, businessValidFrom: `${NOW}Z` },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
  });

  it('47. rejects an offset department local date-time', async () => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        content: { ...CREATE_BODY.content, businessValidFrom: `${NOW}+08:00` },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
  });

  it('48. rejects fractional seconds in a department local date-time', async () => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        content: {
          ...CREATE_BODY.content,
          businessValidFrom: '2026-09-04T10:11:12.123456',
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
  });

  it.each([
    ['department type', { ...CREATE_BODY, content: { ...CREATE_BODY.content, departmentType: 'UNKNOWN' } }, '/prototype/v1/department-drafts'],
    ['subject applicability', { ...CREATE_BODY, content: { ...CREATE_BODY.content, subjectMappingApplicability: 'UNKNOWN' } }, '/prototype/v1/department-drafts'],
    ['lifecycle status', { ...CREATE_BODY, content: { ...CREATE_BODY.content, lifecycleStatus: 'UNKNOWN' } }, '/prototype/v1/department-drafts'],
    ['decision', { ...DECISION_BODY, decision: 'PENDING' }, `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/reviews`],
  ])('49. rejects an illegal %s enum value', async (_case, payload, url) => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({ method: 'POST', url, payload });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('49. rejects an illegal hierarchy view enum value', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/department-hierarchies/UNKNOWN?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.getDepartmentHierarchy).not.toHaveBeenCalled();
  });

  it('50. rejects duplicate campus IDs before invoking the application', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        content: { ...CREATE_BODY.content, campusIds: [CAMPUS_ID, CAMPUS_ID] },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('rejects a lowercase UUID shape with a non-RFC variant', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));
    const invalidVariantUuid = '11111111-1111-1111-0111-111111111111';

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        governanceObjectId: invalidVariantUuid,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('allows an empty campus set in the frozen draft command', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload: {
        ...CREATE_BODY,
        content: { ...CREATE_BODY.content, campusIds: [] },
      },
    });

    expect(response.statusCode).toBe(201);
    expect(contract.execute).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({ campusIds: [] }),
    }));
  });

  it.each([
    ['departmentCode', { ...CREATE_BODY, departmentCode: ' RESP-001' }],
    ['standardName', { ...CREATE_BODY, content: { ...CREATE_BODY.content, standardName: 'Respiratory ' } }],
  ])('rejects untrimmed %s', async (_case, payload) => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: '/prototype/v1/department-drafts',
      payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
  });

  it('rejects an untrimmed reason at the transport boundary', async () => {
    const application = await buildTestApplication();

    const response = await application.inject({
      method: 'POST',
      url: `/prototype/v1/department-governance/${GOVERNANCE_REQUEST_ID}/reviews`,
      payload: { ...DECISION_BODY, reason: ' reviewed' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('REQUEST_SCHEMA_INVALID');
  });

  it('sanitizes internal fields from a published DTO response', async () => {
    const contract = createFakeContract();
    contract.getPublishedDepartment.mockResolvedValueOnce({
      ...DETAIL,
      recorded_to: 'private',
      workflow: { request: 'private' },
      quality: { ...QUALITY, created_at: 'private' },
      campuses: [{ ...DETAIL.campuses[0]!, repository_id: 'private' }],
    } as unknown as DepartmentDetailDTO);
    const application = await buildTestApplication(createDependencies(contract));

    const response = await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(DETAIL);
    expect(response.body).not.toContain('recorded_to');
    expect(response.body).not.toContain('created_at');
    expect(response.body).not.toContain('repository_id');
    expect(response.body).not.toContain('workflow');
  });

  it('preserves an explicitly provided fromVersionNo', async () => {
    const contract = createFakeContract();
    const application = await buildTestApplication(createDependencies(contract));

    await application.inject({
      method: 'GET',
      url: `/prototype/v1/departments/${DEPARTMENT_ID}/version-difference?governanceObjectId=${GOVERNANCE_OBJECT_ID}&fromVersionNo=1&toVersionNo=2`,
    });

    expect(contract.getVersionDifference).toHaveBeenCalledWith({
      governanceObjectId: GOVERNANCE_OBJECT_ID,
      departmentId: DEPARTMENT_ID,
      fromVersionNo: '1',
      toVersionNo: '2',
    });
  });
});


const FORMAL_PREFIX = '/v1/department-governance';
const BROWSER_HEADERS = {
  cookie: '__Host-hdi-session=synthetic-browser-session',
  'x-csrf-token': 'synthetic-browser-csrf-token-for-contract-tests',
};

// A formal browser-session resolver double, never a Prototype header resolver.
async function buildFormalTestApplication(contract = createFakeContract()) {
  const authentication = {
    resolvePrincipal: vi.fn<KeycloakAuthentication['resolvePrincipal']>(async (request) => {
      if (request.headers.authorization?.startsWith('Bearer ')) {
        return { principalId: OTHER_ACTOR_ID, principalKind: 'SERVICE' };
      }
      if (request.headers.cookie !== BROWSER_HEADERS.cookie) {
        throw new Error('BROWSER_SESSION_UNAUTHENTICATED');
      }
      if (request.method === 'POST' && request.headers['x-csrf-token'] !== BROWSER_HEADERS['x-csrf-token']) {
        throw new Error('BROWSER_CSRF_FORBIDDEN');
      }
      return { principalId: OTHER_ACTOR_ID, principalKind: 'PERSON' };
    }),
  } satisfies Pick<KeycloakAuthentication, 'resolvePrincipal'>;
  const dependencies = createDependencies(contract, {
    resolvePrincipal: (request) => authentication.resolvePrincipal(request),
  });
  const application = await buildApplication({ departmentGovernance: dependencies });
  applications.push(application);
  return { application, dependencies, authentication, contract };
}

describe('formal Department browser API Fastify integration', () => {
  it('registers Formal routes through buildApplication and excludes Prototype routes', async () => {
    const { application } = await buildFormalTestApplication();
    const formal = await application.inject({
      method: 'GET', url: `${FORMAL_PREFIX}/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
      headers: BROWSER_HEADERS,
    });
    expect(formal.statusCode).toBe(200);
    const prototype = await application.inject({
      method: 'GET', url: `/prototype/v1/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
      headers: { 'x-prototype-principal-code': 'prototype-owner' },
    });
    expect(prototype.statusCode).toBe(404);
  });

  it.each([
    ['prototype-only identity', { 'x-prototype-principal-code': 'prototype-owner' }, 401, 'BROWSER_SESSION_UNAUTHENTICATED'],
    ['missing session', {}, 401, 'BROWSER_SESSION_UNAUTHENTICATED'],
    ['service bearer', { authorization: 'Bearer synthetic-service' }, 403, 'PRINCIPAL_KIND_FORBIDDEN'],
  ])('rejects %s before creating an application', async (_name, headers, status, code) => {
    const { application, dependencies } = await buildFormalTestApplication();
    const response = await application.inject({
      method: 'GET', url: `${FORMAL_PREFIX}/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
      headers,
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, requestId: expect.any(String) });
    expect(dependencies.createApplication).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', undefined, 400, 'REQUEST_SCHEMA_INVALID'],
    ['short', 'bad', 400, 'REQUEST_SCHEMA_INVALID'],
    ['wrong session token', 'x'.repeat(40), 403, 'BROWSER_CSRF_FORBIDDEN'],
    ['prototype token', PROTOTYPE_CSRF_TOKEN, 403, 'BROWSER_CSRF_FORBIDDEN'],
  ])('reuses browser header validation and session validation for %s CSRF', async (_name, csrf, status, code) => {
    const { application, contract } = await buildFormalTestApplication();
    const response = await application.inject({
      method: 'POST', url: `${FORMAL_PREFIX}/department-drafts`, payload: CREATE_BODY,
      headers: { cookie: BROWSER_HEADERS.cookie, ...(csrf ? { 'x-csrf-token': csrf } : {}) },
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, requestId: expect.any(String) });
    expect(contract.execute).not.toHaveBeenCalled();
  });

  it('binds each request to the formal resolved principal and server clock', async () => {
    const { application, dependencies, authentication } = await buildFormalTestApplication();
    for (const suffix of ['1', '2']) {
      const response = await application.inject({
        method: 'GET', url: `${FORMAL_PREFIX}/departments?governanceObjectId=${GOVERNANCE_OBJECT_ID}`,
        headers: { ...BROWSER_HEADERS, 'x-request-id': `request-${suffix}`,
          'x-correlation-id': `correlation-${suffix}`, 'x-prototype-principal-code': 'prototype-owner' },
      });
      expect(response.statusCode).toBe(200);
    }
    expect(authentication.resolvePrincipal).toHaveBeenCalledTimes(2);
    expect(dependencies.createApplication.mock.calls).toEqual(['1', '2'].map((suffix) => [{
      actorPrincipalId: OTHER_ACTOR_ID, occurredAt: NOW,
      requestId: `request-${suffix}`, correlationId: `correlation-${suffix}`,
    }]));
    expect(dependencies.createApplication.mock.calls[0]![0]).not.toBe(dependencies.createApplication.mock.calls[1]![0]);
  });

  it('maps all six commands unchanged and never publishes again after approval', async () => {
    const { application, contract, dependencies } = await buildFormalTestApplication();
    const commands = [
      ['/department-drafts', CREATE_BODY, { commandName: 'CreateDepartmentDraft', ...CREATE_BODY }, 201],
      [`/departments/${DEPARTMENT_ID}/versions/${DEPARTMENT_VERSION_ID}/submissions`, SUBMIT_BODY,
        { commandName: 'SubmitDepartmentGovernance', departmentId: DEPARTMENT_ID, departmentVersionId: DEPARTMENT_VERSION_ID, ...SUBMIT_BODY }, 201],
      [`/requests/${GOVERNANCE_REQUEST_ID}/reviews`, DECISION_BODY,
        { commandName: 'ReviewDepartment', governanceRequestId: GOVERNANCE_REQUEST_ID, ...DECISION_BODY }, 200],
      [`/requests/${GOVERNANCE_REQUEST_ID}/approvals`, DECISION_BODY,
        { commandName: 'ApproveDepartment', governanceRequestId: GOVERNANCE_REQUEST_ID, ...DECISION_BODY }, 200],
      [`/requests/${GOVERNANCE_REQUEST_ID}/publication-confirmations`, PUBLICATION_BODY,
        { commandName: 'PublishDepartment', governanceRequestId: GOVERNANCE_REQUEST_ID, ...PUBLICATION_BODY }, 200],
      [`/departments/${DEPARTMENT_ID}/source-mappings/${MAPPING_ID}/confirmations`, { governanceObjectId: GOVERNANCE_OBJECT_ID },
        { commandName: 'ConfirmSourceMapping', governanceObjectId: GOVERNANCE_OBJECT_ID, departmentId: DEPARTMENT_ID, mappingId: MAPPING_ID }, 200],
    ] as const;
    for (const [path, body, command, status] of commands) {
      contract.execute.mockClear();
      dependencies.createApplication.mockClear();
      const response = await application.inject({ method: 'POST', url: FORMAL_PREFIX + path, payload: body, headers: BROWSER_HEADERS });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual(STATUS_VIEW);
      expect(contract.execute.mock.calls).toEqual([[command]]);
      expect(dependencies.createApplication).toHaveBeenCalledTimes(1);
    }
  });

  it('repeats publication confirmation through the same frozen command without extra calls', async () => {
    const { application, contract } = await buildFormalTestApplication();
    const results = [];
    for (let i = 0; i < 2; i++) {
      const response = await application.inject({ method: 'POST',
        url: `${FORMAL_PREFIX}/requests/${GOVERNANCE_REQUEST_ID}/publication-confirmations`,
        payload: PUBLICATION_BODY, headers: BROWSER_HEADERS });
      expect(response.statusCode).toBe(200);
      results.push(response.json());
    }
    expect(results).toEqual([STATUS_VIEW, STATUS_VIEW]);
    expect(contract.execute.mock.calls).toEqual([0, 1].map(() => [{
      commandName: 'PublishDepartment', governanceRequestId: GOVERNANCE_REQUEST_ID, ...PUBLICATION_BODY,
    }]));
  });

  it('maps all nine queries to frozen DTOs with the exact application arguments', async () => {
    const { application, contract } = await buildFormalTestApplication();
    const scope = { governanceObjectId: GOVERNANCE_OBJECT_ID };
    const target = { ...scope, departmentId: DEPARTMENT_ID };
    const queries = [
      ['/departments', 'listPublishedDepartments', [SUMMARY], scope, ''],
      [`/departments/${DEPARTMENT_ID}`, 'getPublishedDepartment', DETAIL, target, ''],
      [`/departments/${DEPARTMENT_ID}/history`, 'getDepartmentHistory', HISTORY, { ...target, asOf: NOW }, `&asOf=${NOW}`],
      ['/hierarchies/ADMINISTRATIVE', 'getDepartmentHierarchy', [HIERARCHY], { ...scope, viewType: 'ADMINISTRATIVE' }, ''],
      [`/departments/${DEPARTMENT_ID}/source-mappings`, 'getDepartmentSourceMappings', [SOURCE_MAPPING], target, ''],
      [`/departments/${DEPARTMENT_ID}/quality`, 'getDepartmentQuality', QUALITY, target, ''],
      [`/departments/${DEPARTMENT_ID}/governance-status`, 'getGovernanceStatus', STATUS_VIEW, target, ''],
      ['/pending-reviews', 'findPendingReviews', [REVIEW_QUEUE_ITEM], scope, ''],
      [`/departments/${DEPARTMENT_ID}/version-difference`, 'getVersionDifference', VERSION_DIFFERENCE,
        { ...target, fromVersionNo: null, toVersionNo: '1' }, '&toVersionNo=1'],
    ] as const;
    for (const [path, method, dto, query, extra] of queries) {
      const response = await application.inject({ method: 'GET',
        url: `${FORMAL_PREFIX}${path}?governanceObjectId=${GOVERNANCE_OBJECT_ID}${extra}`, headers: BROWSER_HEADERS });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(dto);
      expect(contract[method]).toHaveBeenCalledExactlyOnceWith(query);
    }
  });

  it.each([
    ['DEPARTMENT_PERMISSION_DENIED', 403], ['DEPARTMENT_NOT_FOUND', 404],
    ['DEPARTMENT_VERSION_NOT_FOUND', 404], ['DEPARTMENT_STATUS_INVALID', 409],
    ['DEPARTMENT_APPROVAL_REQUIRED', 409], ['DEPARTMENT_CONTENT_CHANGED', 409],
    ['DEPARTMENT_EVOLUTION_RELATION_REQUIRED', 409],
  ] as const)('preserves formal error %s', async (code, status) => {
    const { application, contract } = await buildFormalTestApplication();
    contract.execute.mockRejectedValueOnce(new DepartmentContractError(code));
    const response = await application.inject({ method: 'POST', url: `${FORMAL_PREFIX}/department-drafts`,
      payload: CREATE_BODY, headers: BROWSER_HEADERS });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ code, requestId: expect.any(String) });
  });

  it('hides unknown internal error text from the formal client', async () => {
    const { application, contract } = await buildFormalTestApplication();
    contract.execute.mockRejectedValueOnce(new Error('private database SQLSTATE error text'));
    const response = await application.inject({ method: 'POST', url: `${FORMAL_PREFIX}/department-drafts`,
      payload: CREATE_BODY, headers: BROWSER_HEADERS });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR', requestId: expect.any(String) });
  });

  it.each(['actorId', 'actorPrincipalId', 'reviewerId', 'approverId', 'password', 'token'])('rejects undeclared formal body field %s', async (field) => {
    const { application, contract } = await buildFormalTestApplication();
    const response = await application.inject({ method: 'POST', url: `${FORMAL_PREFIX}/department-drafts`,
      payload: { ...CREATE_BODY, [field]: 'synthetic-invalid' }, headers: BROWSER_HEADERS });
    expect(response.statusCode).toBe(400);
    expect(contract.execute).not.toHaveBeenCalled();
  });
});
