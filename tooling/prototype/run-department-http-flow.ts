import { randomUUID } from 'node:crypto';
import { createScopedModules, type ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';
import {
  createTransactionRunner,
  type RequestContext,
} from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

const baseUrl = process.env['PROTOTYPE_API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const runSuffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const departmentCode = `PROTOTYPE-HTTP-DEPARTMENT-${runSuffix}`;
const standardName = `PROTOTYPE SYNTHETIC HTTP DEPARTMENT ${runSuffix}`;
const correlationId = `PROTOTYPE-HTTP-DEPARTMENT-${runSuffix}`;
const baseTime = new Date();
const localDateTimeAtOffsetSeconds = (seconds: number) =>
  asiaShanghaiLocalDateTime(new Date(baseTime.getTime() + seconds * 1_000));

type PrincipalCode = 'prototype-owner' | 'prototype-reviewer' | 'prototype-final-owner';

interface DepartmentStatus {
  readonly governanceObjectId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly governanceRequestId: string | null;
  readonly status: string;
  readonly contentHash: string;
}

interface PublicationArtifactCounts {
  readonly releaseMemberCount: number;
  readonly projectionCount: number;
  readonly publishedAuditCount: number;
}

try {
  const health = await requestJson<{ readonly status?: unknown }>('/health', {
    step: 'HEALTH_CHECK',
  });
  if (health.status !== 'ok') throw new Error('HTTP_DEPARTMENT_HEALTH_UNEXPECTED');

  await requireRejection(
    '/prototype/v1/departments',
    {
      step: 'MISSING_PRINCIPAL_LIST',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
    401,
  );
  await requireRejection(
    '/prototype/v1/department-drafts',
    {
      step: 'WRONG_CSRF_CREATE',
      method: 'POST',
      principal: 'prototype-owner',
      csrfToken: 'prototype-csrf-guard-incorrect-value',
      body: createDraftBody(),
    },
    403,
  );

  const draft = await requestJson<DepartmentStatus>('/prototype/v1/department-drafts', {
    step: 'CREATE_DEPARTMENT_DRAFT',
    method: 'POST',
    principal: 'prototype-owner',
    body: createDraftBody(),
    expectedStatus: 201,
  });
  assertStatus(draft, 'DRAFT', 'CREATE_DEPARTMENT_DRAFT');

  const mappingFixture = await preparePendingDepartmentSourceMappingFixture({
    departmentId: draft.departmentId,
    sourceCode: `PROTOTYPE-HTTP-HIS-${runSuffix}`,
  });

  const draftStatus = await requestJson<DepartmentStatus>(
    `/prototype/v1/departments/${draft.departmentId}/governance-status`,
    {
      step: 'QUERY_DRAFT_STATUS',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  assertStatus(draftStatus, 'DRAFT', 'QUERY_DRAFT_STATUS');

  const submitted = await requestJson<DepartmentStatus>(
    `/prototype/v1/departments/${draft.departmentId}/versions/${draft.departmentVersionId}/submissions`,
    {
      step: 'SUBMIT_DEPARTMENT',
      method: 'POST',
      principal: 'prototype-owner',
      expectedStatus: 201,
      body: {
        governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
        expectedContentHash: draft.contentHash,
        changeReason: 'PROTOTYPE SYNTHETIC HTTP DEPARTMENT INITIAL PUBLICATION',
      },
    },
  );
  assertStatus(submitted, 'SUBMITTED', 'SUBMIT_DEPARTMENT');
  if (!submitted.governanceRequestId) {
    throw new Error('HTTP_DEPARTMENT_GOVERNANCE_REQUEST_MISSING');
  }

  const decisionBody = {
    governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
    departmentId: draft.departmentId,
    departmentVersionId: draft.departmentVersionId,
    seenContentHash: draft.contentHash,
    decision: 'APPROVED',
    reason: 'PROTOTYPE SYNTHETIC HTTP DEPARTMENT REVIEW APPROVED',
  } as const;
  await requireRejection(
    `/prototype/v1/department-governance/${submitted.governanceRequestId}/reviews`,
    {
      step: 'OWNER_REVIEW_FORBIDDEN',
      method: 'POST',
      principal: 'prototype-owner',
      body: decisionBody,
    },
    403,
  );
  const reviewed = await requestJson<DepartmentStatus>(
    `/prototype/v1/department-governance/${submitted.governanceRequestId}/reviews`,
    {
      step: 'REVIEW_DEPARTMENT',
      method: 'POST',
      principal: 'prototype-reviewer',
      body: decisionBody,
    },
  );
  assertStatus(reviewed, 'AWAITING_FINAL', 'REVIEW_DEPARTMENT');

  await requireRejection(
    `/prototype/v1/department-governance/${submitted.governanceRequestId}/approvals`,
    {
      step: 'REVIEWER_APPROVAL_FORBIDDEN',
      method: 'POST',
      principal: 'prototype-reviewer',
      body: { ...decisionBody, reason: 'PROTOTYPE SYNTHETIC WRONG OWNER APPROVAL' },
    },
    403,
  );
  const published = await requestJson<DepartmentStatus>(
    `/prototype/v1/department-governance/${submitted.governanceRequestId}/approvals`,
    {
      step: 'FINAL_APPROVE_DEPARTMENT',
      method: 'POST',
      principal: 'prototype-final-owner',
      body: { ...decisionBody, reason: 'PROTOTYPE SYNTHETIC HTTP OWNER FINAL APPROVAL' },
    },
  );
  assertStatus(published, 'PUBLISHED', 'FINAL_APPROVE_DEPARTMENT');

  const publicationArtifactsBeforeConfirmation =
    await readPublicationArtifactCounts(draft.departmentVersionId);
  requirePublicationArtifactsExactlyOnce(
    publicationArtifactsBeforeConfirmation,
    'BEFORE_CONFIRMATION',
  );

  const confirmationBody = {
    governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
    departmentId: draft.departmentId,
    departmentVersionId: draft.departmentVersionId,
    approvedContentHash: draft.contentHash,
  };
  const confirmation = await requestJson<DepartmentStatus>(
    `/prototype/v1/department-governance/${submitted.governanceRequestId}/publication-confirmations`,
    {
      step: 'CONFIRM_DEPARTMENT_PUBLICATION',
      method: 'POST',
      principal: 'prototype-final-owner',
      body: confirmationBody,
    },
  );
  assertStatus(confirmation, 'PUBLISHED', 'CONFIRM_DEPARTMENT_PUBLICATION');
  const publicationArtifactsAfterFirstConfirmation =
    await readPublicationArtifactCounts(draft.departmentVersionId);
  requirePublicationArtifactsUnchanged(
    publicationArtifactsBeforeConfirmation,
    publicationArtifactsAfterFirstConfirmation,
    'AFTER_FIRST_CONFIRMATION',
  );
  const repeatedConfirmation = await requestJson<DepartmentStatus>(
    `/prototype/v1/department-governance/${submitted.governanceRequestId}/publication-confirmations`,
    {
      step: 'REPEAT_DEPARTMENT_PUBLICATION_CONFIRMATION',
      method: 'POST',
      principal: 'prototype-final-owner',
      body: confirmationBody,
    },
  );
  assertStatus(
    repeatedConfirmation,
    'PUBLISHED',
    'REPEAT_DEPARTMENT_PUBLICATION_CONFIRMATION',
  );
  const publicationArtifactsAfterSecondConfirmation =
    await readPublicationArtifactCounts(draft.departmentVersionId);
  requirePublicationArtifactsUnchanged(
    publicationArtifactsBeforeConfirmation,
    publicationArtifactsAfterSecondConfirmation,
    'AFTER_SECOND_CONFIRMATION',
  );

  await requireListHit('departmentCode', departmentCode, draft.departmentId);
  await requireListHit('standardName', standardName, draft.departmentId);
  await requireListHit('departmentType', 'CLINICAL', draft.departmentId);
  await requireListHit(
    'campusId',
    PROTOTYPE_FIXTURE.departmentHeadquartersCampusId,
    draft.departmentId,
  );

  const detail = await requestJson<Record<string, unknown>>(
    `/prototype/v1/departments/${draft.departmentId}`,
    {
      step: 'QUERY_DEPARTMENT_DETAIL',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  requireDepartmentIdentity(detail, draft.departmentId, 'QUERY_DEPARTMENT_DETAIL');
  if (detail['contentHash'] !== draft.contentHash) {
    throw new Error('HTTP_DEPARTMENT_DETAIL_HASH_UNEXPECTED');
  }

  const history = await requestJson<Record<string, unknown>>(
    `/prototype/v1/departments/${draft.departmentId}/history`,
    {
      step: 'QUERY_DEPARTMENT_HISTORY',
      principal: 'prototype-owner',
      query: {
        governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
        asOf: localDateTimeAtOffsetSeconds(120),
      },
    },
  );
  requireDepartmentIdentity(history, draft.departmentId, 'QUERY_DEPARTMENT_HISTORY');

  const hierarchy = await requestJson<readonly unknown[]>(
    '/prototype/v1/department-hierarchies/ADMINISTRATIVE',
    {
      step: 'QUERY_ADMINISTRATIVE_HIERARCHY',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  if (!Array.isArray(hierarchy)) throw new Error('HTTP_DEPARTMENT_HIERARCHY_INVALID');

  const mappingsBeforeConfirmation = await requestJson<readonly Record<string, unknown>[]>(
    `/prototype/v1/departments/${draft.departmentId}/source-mappings`,
    {
      step: 'QUERY_DEPARTMENT_SOURCE_MAPPINGS',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  if (!mappingsBeforeConfirmation.some((mapping) =>
    mapping['sourceCode'] === mappingFixture.sourceCode && mapping['mappingStatus'] === 'PENDING')) {
    throw new Error('HTTP_DEPARTMENT_PENDING_MAPPING_MISSING');
  }

  const quality = await requestJson<Record<string, unknown>>(
    `/prototype/v1/departments/${draft.departmentId}/quality`,
    {
      step: 'QUERY_DEPARTMENT_QUALITY',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  requireDepartmentIdentity(quality, draft.departmentId, 'QUERY_DEPARTMENT_QUALITY');

  const publishedStatus = await requestJson<DepartmentStatus>(
    `/prototype/v1/departments/${draft.departmentId}/governance-status`,
    {
      step: 'QUERY_PUBLISHED_STATUS',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  assertStatus(publishedStatus, 'PUBLISHED', 'QUERY_PUBLISHED_STATUS');

  const pendingReviews = await requestJson<readonly Record<string, unknown>[]>(
    '/prototype/v1/department-governance/pending-reviews',
    {
      step: 'QUERY_PENDING_REVIEWS',
      principal: 'prototype-reviewer',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  if (pendingReviews.some((item) => item['governanceRequestId'] === submitted.governanceRequestId)) {
    throw new Error('HTTP_DEPARTMENT_REQUEST_STILL_PENDING');
  }

  const difference = await requestJson<Record<string, unknown>>(
    `/prototype/v1/departments/${draft.departmentId}/version-difference`,
    {
      step: 'QUERY_INITIAL_VERSION_DIFFERENCE',
      principal: 'prototype-reviewer',
      query: {
        governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
        toVersionNo: '1',
      },
    },
  );
  if (
    difference['departmentId'] !== draft.departmentId ||
    difference['fromVersionNo'] !== null ||
    difference['toVersionNo'] !== '1' ||
    !Array.isArray(difference['differences'])
  ) {
    throw new Error('HTTP_DEPARTMENT_INITIAL_DIFFERENCE_UNEXPECTED');
  }

  const mappingConfirmation = await requestJson<DepartmentStatus>(
    `/prototype/v1/departments/${draft.departmentId}/source-mappings/${mappingFixture.mappingId}/confirmations`,
    {
      step: 'CONFIRM_DEPARTMENT_SOURCE_MAPPING',
      method: 'POST',
      principal: 'prototype-reviewer',
      body: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  assertStatus(mappingConfirmation, 'PUBLISHED', 'CONFIRM_DEPARTMENT_SOURCE_MAPPING');
  const confirmedMappings = await requestJson<readonly Record<string, unknown>[]>(
    `/prototype/v1/departments/${draft.departmentId}/source-mappings`,
    {
      step: 'VERIFY_DEPARTMENT_SOURCE_MAPPING',
      principal: 'prototype-owner',
      query: { governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId },
    },
  );
  if (!confirmedMappings.some((mapping) =>
    mapping['sourceCode'] === mappingFixture.sourceCode &&
    mapping['mappingStatus'] === 'CONFIRMED')) {
    throw new Error('HTTP_DEPARTMENT_MAPPING_CONFIRMATION_NOT_OBSERVED');
  }

  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    departmentHttpSmokePassed: true,
    authorizationRejectionObserved: true,
    csrfRejectionObserved: true,
    departmentPublished: true,
    publicationArtifactsExactlyOnceBeforeConfirmation: true,
    publicationArtifactsUnchangedAfterConfirmations: true,
    publicationArtifactCounts: {
      beforeConfirmation: publicationArtifactsBeforeConfirmation,
      afterFirstConfirmation: publicationArtifactsAfterFirstConfirmation,
      afterSecondConfirmation: publicationArtifactsAfterSecondConfirmation,
    },
    publicationConfirmationIdempotent: true,
    sourceMappingConfirmed: true,
    departmentCode,
    departmentId: draft.departmentId,
    departmentVersionId: draft.departmentVersionId,
    governanceRequestId: submitted.governanceRequestId,
    correlationId,
    mappingId: mappingFixture.mappingId,
    sourceCode: mappingFixture.sourceCode,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    errorCode: safeErrorCode(error, 'PROTOTYPE_DEPARTMENT_HTTP_FLOW_FAILED'),
  })}\n`);
  process.exitCode = 1;
}

function createDraftBody() {
  return {
    governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
    departmentCode,
    content: {
      standardName,
      shortName: `HTTP-${runSuffix.slice(0, 8)}`,
      departmentType: 'CLINICAL',
      subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
      lifecycleStatus: 'ACTIVE',
      businessValidFrom: localDateTimeAtOffsetSeconds(-60),
      businessValidTo: null,
      campusIds: [
        PROTOTYPE_FIXTURE.departmentHeadquartersCampusId,
        PROTOTYPE_FIXTURE.departmentHighTechCampusId,
      ],
    },
  };
}

async function preparePendingDepartmentSourceMappingFixture(input: {
  readonly departmentId: string;
  readonly sourceCode: string;
}): Promise<{
  readonly departmentId: string;
  readonly mappingId: string;
  readonly sourceCode: string;
}> {
  const databaseHandle = createDatabase({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-prototype-department-http-fixture',
    max: 1,
  });
  try {
    const transactionRunner = createTransactionRunner<ScopedModules>(
      databaseHandle.database,
      (transaction, context) => createScopedModules(transaction, context),
    );
    const context: RequestContext = {
      actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId,
      requestId: `${correlationId}-MAPPING-FIXTURE`,
      correlationId: `${correlationId}-MAPPING-FIXTURE`,
      occurredAt: localDateTimeAtOffsetSeconds(0),
    };
    const mapping = await transactionRunner.run(context, (modules) =>
      modules.departmentMaster.addSourceMapping({
        governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
        departmentId: input.departmentId,
        sourceSystem: 'HIS',
        sourceDepartmentCode: input.sourceCode,
        sourceDepartmentName: 'PROTOTYPE SYNTHETIC HTTP DEPARTMENT SOURCE',
        matchMethod: 'MANUAL',
      }),
    );
    if (mapping.mappingStatus !== 'PENDING') {
      throw new Error('HTTP_DEPARTMENT_MAPPING_FIXTURE_NOT_PENDING');
    }
    return {
      departmentId: input.departmentId,
      mappingId: mapping.id,
      sourceCode: input.sourceCode,
    };
  } finally {
    await databaseHandle.close();
  }
}

async function readPublicationArtifactCounts(
  departmentVersionId: string,
): Promise<PublicationArtifactCounts> {
  const databaseHandle = createDatabase({
    connectionString: requireEnvironment('DATABASE_URL'),
    application_name: 'hdi-prototype-department-http-publication-snapshot',
    max: 1,
  });
  try {
    const database = databaseHandle.database;
    const [releaseMembers, projections, publishedAudits] = await Promise.all([
      database
        .selectFrom('release_distribution.release_member_department')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('department_version_id', '=', departmentVersionId)
        .executeTakeFirstOrThrow(),
      database
        .selectFrom('department_master.department_published_projection')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('department_version_id', '=', departmentVersionId)
        .executeTakeFirstOrThrow(),
      database
        .selectFrom('audit.audit_event')
        .select(({ fn }) => fn.countAll<string>().as('count'))
        .where('stable_entity_id', '=', departmentVersionId)
        .where('action', '=', 'DEPARTMENT_PUBLISHED')
        .executeTakeFirstOrThrow(),
    ]);
    return {
      releaseMemberCount: Number(releaseMembers.count),
      projectionCount: Number(projections.count),
      publishedAuditCount: Number(publishedAudits.count),
    };
  } finally {
    await databaseHandle.close();
  }
}

function requirePublicationArtifactsExactlyOnce(
  counts: PublicationArtifactCounts,
  step: string,
): void {
  if (
    counts.releaseMemberCount !== 1 ||
    counts.projectionCount !== 1 ||
    counts.publishedAuditCount !== 1
  ) {
    throw new Error(`HTTP_DEPARTMENT_PUBLICATION_ARTIFACT_COUNT_INVALID:${step}`);
  }
}

function requirePublicationArtifactsUnchanged(
  before: PublicationArtifactCounts,
  after: PublicationArtifactCounts,
  step: string,
): void {
  requirePublicationArtifactsExactlyOnce(after, step);
  if (
    after.releaseMemberCount !== before.releaseMemberCount ||
    after.projectionCount !== before.projectionCount ||
    after.publishedAuditCount !== before.publishedAuditCount
  ) {
    throw new Error(`HTTP_DEPARTMENT_PUBLICATION_ARTIFACTS_CHANGED:${step}`);
  }
}

async function requireListHit(
  filterName: 'departmentCode' | 'standardName' | 'departmentType' | 'campusId',
  filterValue: string,
  departmentId: string,
): Promise<void> {
  const result = await requestJson<readonly Record<string, unknown>[]>(
    '/prototype/v1/departments',
    {
      step: `LIST_DEPARTMENTS_BY_${filterName.toUpperCase()}`,
      principal: 'prototype-owner',
      query: {
        governanceObjectId: PROTOTYPE_FIXTURE.departmentMasterObjectId,
        [filterName]: filterValue,
      },
    },
  );
  if (!result.some((item) => item['departmentId'] === departmentId)) {
    throw new Error(`HTTP_DEPARTMENT_LIST_FILTER_MISSED:${filterName.toUpperCase()}`);
  }
}

interface RequestOptions {
  readonly step: string;
  readonly method?: 'GET' | 'POST';
  readonly principal?: PrincipalCode;
  readonly csrfToken?: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly expectedStatus?: number;
}

async function requestJson<Result>(path: string, options: RequestOptions): Promise<Result> {
  const response = await sendRequest(path, options);
  const payload = await readJson(response);
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(
      `HTTP_DEPARTMENT_STEP_FAILED:${options.step}:${response.status}:${responseErrorCode(payload)}`,
    );
  }
  return payload as Result;
}

async function requireRejection(
  path: string,
  options: RequestOptions,
  expectedStatus: number,
): Promise<void> {
  const response = await sendRequest(path, options);
  await readJson(response);
  if (response.status !== expectedStatus) {
    throw new Error(
      `HTTP_DEPARTMENT_REJECTION_MISSING:${options.step}:${response.status}`,
    );
  }
}

async function sendRequest(path: string, options: RequestOptions): Promise<Response> {
  const target = new URL(path, baseUrl);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    target.searchParams.set(name, value);
  }
  const headers = new Headers({
    accept: 'application/json',
    'x-correlation-id': correlationId,
    'x-request-id': `${correlationId}-${options.step}`,
  });
  if (options.principal) headers.set('x-prototype-principal-code', options.principal);
  if (options.method === 'POST') {
    headers.set('content-type', 'application/json');
    headers.set('x-csrf-token', options.csrfToken ?? PROTOTYPE_CSRF_TOKEN);
  }
  return fetch(target, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(10_000),
  });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`HTTP_DEPARTMENT_RESPONSE_NOT_JSON:${response.status}`);
  }
}

function responseErrorCode(payload: unknown): string {
  return isRecord(payload) && typeof payload['code'] === 'string'
    ? payload['code']
    : 'NO_ERROR_CODE';
}

function assertStatus(value: DepartmentStatus, expected: string, step: string): void {
  if (value.status !== expected) {
    throw new Error(`HTTP_DEPARTMENT_STATUS_UNEXPECTED:${step}:${String(value.status)}`);
  }
}

function requireDepartmentIdentity(
  value: Readonly<Record<string, unknown>>,
  departmentId: string,
  step: string,
): void {
  if (value['departmentId'] !== departmentId) {
    throw new Error(`HTTP_DEPARTMENT_IDENTITY_UNEXPECTED:${step}`);
  }
}

function asiaShanghaiLocalDateTime(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(value).replace(' ', 'T');
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
