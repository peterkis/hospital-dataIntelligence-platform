import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { canonicalize } from 'json-canonicalize';
import { buildApplication } from './build-application.js';
import { createDepartmentGovernanceContractDependencies } from './department-governance-contract-dependencies.js';
import { PHASE_01_PROJECTION_CONTRACTS } from './create-scoped-modules.js';
import type { RegisterPublicationCommand } from '../modules/release-distribution/index.js';
import { registerDepartmentGovernanceRoutes } from '../platform/fastify/register-department-governance-routes.js';
import * as schemas from '../platform/fastify/department-governance-schemas.js';

const prefix = '/v1/department-governance';
const routes = [
  ['post', '/department-drafts', 'createDepartmentDraft', schemas.CreateDepartmentDraftBodySchema, schemas.DepartmentGovernanceStatusResponseSchema],
  ['post', '/departments/{departmentId}/versions/{departmentVersionId}/submissions', 'submitDepartmentGovernance', schemas.SubmitDepartmentBodySchema, schemas.DepartmentGovernanceStatusResponseSchema],
  ['post', '/requests/{governanceRequestId}/reviews', 'reviewDepartmentGovernance', schemas.DepartmentDecisionBodySchema, schemas.DepartmentGovernanceStatusResponseSchema],
  ['post', '/requests/{governanceRequestId}/approvals', 'approveDepartmentGovernance', schemas.DepartmentDecisionBodySchema, schemas.DepartmentGovernanceStatusResponseSchema],
  ['post', '/requests/{governanceRequestId}/publication-confirmations', 'confirmDepartmentPublication', schemas.DepartmentPublicationConfirmationBodySchema, schemas.DepartmentGovernanceStatusResponseSchema],
  ['post', '/departments/{departmentId}/source-mappings/{mappingId}/confirmations', 'confirmDepartmentSourceMapping', schemas.DepartmentSourceMappingConfirmationBodySchema, schemas.DepartmentGovernanceStatusResponseSchema],
  ['get', '/departments', 'listPublishedDepartments', null, schemas.DepartmentSummaryListResponseSchema],
  ['get', '/departments/{departmentId}', 'getPublishedDepartment', null, schemas.DepartmentDetailResponseSchema],
  ['get', '/departments/{departmentId}/history', 'getDepartmentHistory', null, schemas.DepartmentHistoryResponseSchema],
  ['get', '/hierarchies/{viewType}', 'getDepartmentHierarchy', null, schemas.DepartmentHierarchyListResponseSchema],
  ['get', '/departments/{departmentId}/source-mappings', 'getDepartmentSourceMappings', null, schemas.DepartmentSourceMappingListResponseSchema],
  ['get', '/departments/{departmentId}/quality', 'getDepartmentQuality', null, schemas.DepartmentQualityResponseSchema],
  ['get', '/departments/{departmentId}/governance-status', 'getDepartmentGovernanceStatus', null, schemas.DepartmentGovernanceStatusResponseSchema],
  ['get', '/pending-reviews', 'listDepartmentPendingReviews', null, schemas.DepartmentReviewQueueListResponseSchema],
  ['get', '/departments/{departmentId}/version-difference', 'getDepartmentVersionDifference', null, schemas.DepartmentVersionDifferenceResponseSchema],
] as const;

let application: FastifyInstance | undefined;
afterEach(async () => { await application?.close(); });

describe('Department Governance frozen browser OpenAPI', () => {
  it('omits Department routes when no dependencies are supplied', async () => {
    application = await buildApplication();
    const response = await application.inject({ method: 'GET', url: `${prefix}/departments` });
    expect(response.statusCode).toBe(404);
    expect(Object.keys(application.swagger().paths ?? {}).some((path) => path.includes('department'))).toBe(false);
  });

  it('registers both disjoint surfaces but publishes only the 15 browser operations', async () => {
    const dependencies = createDepartmentGovernanceContractDependencies();
    application = await buildApplication({ departmentGovernance: dependencies });
    const prototypeRoutes: { hide: boolean | undefined; operationId: string | undefined }[] = [];
    application.addHook('onRoute', (route) => {
      if (route.method !== 'HEAD') prototypeRoutes.push({ hide: route.schema?.hide, operationId: route.schema?.operationId });
    });
    await registerDepartmentGovernanceRoutes(application, dependencies, {
      surface: 'PROTOTYPE', prefix: '/prototype/v1', hide: true,
    });
    await application.ready();
    expect(prototypeRoutes).toHaveLength(15);
    expect(prototypeRoutes.every((route) => route.hide === true && route.operationId === undefined)).toBe(true);
    const document = application.swagger();
    if (!('openapi' in document)) throw new Error('OPENAPI_REQUIRED');
    expect(Object.keys(document.paths ?? {}).filter((path) => path.startsWith(prefix)).sort())
      .toEqual(routes.map(([, path]) => prefix + path).sort());
    expect(Object.keys(document.paths ?? {}).some((path) => path.startsWith('/prototype'))).toBe(false);
    const operationIds: string[] = [];
    for (const [method, path, operationId, body, response] of routes) {
      const operation = document.paths?.[prefix + path]?.[method];
      expect(operation?.security).toEqual([{ browserSession: [] }]);
      expect(operation?.tags).toEqual(['Department Governance']);
      expect(operation?.operationId).toBe(operationId);
      operationIds.push(operation!.operationId!);
      // Compare emitted wire schemas against the executable, shared TypeBox DTOs.
      const wire = JSON.parse(JSON.stringify(operation));
      if (body) expect(wire.requestBody.content['application/json'].schema).toEqual(openApiSchema(body));
      expect(wire.responses[body && ['createDepartmentDraft', 'submitDepartmentGovernance'].includes(operationId) ? 201 : 200].content['application/json'].schema)
        .toEqual(openApiSchema(response));
      for (const status of [400, 401, 403, 404, 409, 500, 503]) {
        expect(wire.responses[status].content['application/json'].schema)
          .toEqual(JSON.parse(JSON.stringify(schemas.DepartmentErrorResponseSchema)));
      }
      if (method === 'post') {
        expect(wire.parameters).toContainEqual({ in: 'header', name: 'x-csrf-token', required: true,
          schema: { type: 'string', minLength: 32 } });
      }
      assertClosedDtoSchemas(wire.requestBody);
      assertClosedDtoSchemas(wire.responses);
    }
    expect(new Set(operationIds).size).toBe(15);
    const allIds = Object.values(document.paths ?? {}).flatMap((item) => Object.values(item ?? {})
      .flatMap((operation) => operation && typeof operation === 'object' && 'operationId' in operation
        ? [operation.operationId] : []));
    expect(new Set(allIds).size).toBe(allIds.length);
    const frozen = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../contracts/openapi/phase-01.openapi.json'), 'utf8'));
    expect(JSON.parse(canonicalize(document))).toEqual(frozen);
  });

  it('keeps service consumers on Release Distribution and defers Department snapshot HTTP to B-02B', async () => {
    application = await buildApplication({ departmentGovernance: createDepartmentGovernanceContractDependencies() });
    await application.ready();
    const document = application.swagger();
    if (!('openapi' in document)) throw new Error('OPENAPI_REQUIRED');
    for (const path of ['/v1/master-data/departments', '/v1/service/departments']) {
      expect(document.paths?.[path]).toBeUndefined();
    }
    for (const [path, item] of Object.entries(document.paths ?? {})) {
      for (const operation of Object.values(item ?? {})) {
        if (operation && typeof operation === 'object' && 'security' in operation
          && JSON.stringify(operation.security).includes('serviceBearer')) {
          expect(path.toLowerCase()).not.toContain('department');
          expect(JSON.stringify(operation.responses)).not.toContain('DEPARTMENT_MASTER');
          expect(JSON.stringify(operation.responses)).not.toContain('DEPARTMENT_HIERARCHY');
        }
      }
    }
    const aggregates = ['DEPARTMENT_MASTER', 'DEPARTMENT_HIERARCHY'] as const satisfies readonly RegisterPublicationCommand['aggregateType'][];
    expect(aggregates).toHaveLength(2);
    expect(PHASE_01_PROJECTION_CONTRACTS.map((contract) => contract.projectionType))
      .toEqual(expect.arrayContaining(['hdi.department-master', 'hdi.department-hierarchy']));
  });

  it('has contract-only dependencies that fail closed if accidentally executed', async () => {
    const dependencies = createDepartmentGovernanceContractDependencies();
    expect(() => dependencies.createApplication({ actorPrincipalId: 'unused', requestId: 'unused',
      correlationId: 'unused', occurredAt: '2026-09-04T12:00:00' })).toThrow('CONTRACT_RUNTIME_NOT_AVAILABLE');
    application = await buildApplication({ departmentGovernance: dependencies });
    const response = await application.inject({ method: 'GET',
      url: `${prefix}/departments?governanceObjectId=74000000-0000-7000-8000-000000000001` });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ code: 'INTERNAL_ERROR', requestId: expect.any(String) });
  });
});

function assertClosedDtoSchemas(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const node = value as Record<string, unknown>;
  if (node['type'] === 'object') expect(node['additionalProperties']).toBe(false);
  if (node['properties'] && typeof node['properties'] === 'object') {
    for (const key of Object.keys(node['properties'])) {
      expect(key).not.toMatch(/^(actorId|actorPrincipalId|reviewerId|approverId|password|token|database|workflowInstanceId|SQLSTATE)$/u);
      expect(key).not.toContain('_');
    }
  }
  for (const child of Object.values(node)) assertClosedDtoSchemas(child);
}


function openApiSchema(value: unknown): unknown {
  // @fastify/swagger serializes JSON Schema const as an equivalent singleton enum.
  return JSON.parse(JSON.stringify(value, (_key, node: unknown) => {
    if (node && typeof node === 'object' && 'const' in node) {
      const { const: literal, ...rest } = node;
      return { ...rest, enum: [literal] };
    }
    return node;
  }));
}
