import { randomUUID } from 'node:crypto';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import { buildPriceResolutionTimes } from './http-flow-time.js';

const baseUrl = process.env['PROTOTYPE_API_BASE_URL'] ?? 'http://127.0.0.1:3000';
const runSuffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const baseTime = new Date();
const at = (seconds: number) =>
  asiaShanghaiLocalDateTime(new Date(baseTime.getTime() + seconds * 1_000));
const csrfHeaders = { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN } as const;
const owner = prototypeClient('prototype-owner');
const reviewer = prototypeClient('prototype-reviewer');
const finalOwner = prototypeClient('prototype-final-owner');
const missingPrincipal = prototypeClient(undefined);
const wrongCsrf = prototypeClient(
  'prototype-owner',
  'prototype-csrf-guard-incorrect-value',
);

try {
  const health = requireData(
    await owner.GET('/health'),
    'HEALTH_CHECK',
  );
  if (health.status !== 'ok') throw new Error('HTTP_HEALTH_UNEXPECTED');

  await requireRejection(
    missingPrincipal.GET('/v1/phase-01/audit-events', {
      params: { query: { governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId } },
    }),
    401,
    'MISSING_PROTOTYPE_PRINCIPAL',
  );
  await requireRejection(
    wrongCsrf.POST('/v1/phase-01/charge-item-drafts', {
      params: { header: { 'x-csrf-token': 'prototype-csrf-guard-incorrect-value' } },
      body: chargeDraftBody('CSRF-REJECTION'),
    }),
    403,
    'INCORRECT_PROTOTYPE_CSRF',
  );

  const chargeDraft = requireData(
    await owner.POST('/v1/phase-01/charge-item-drafts', {
      params: { header: csrfHeaders },
      body: chargeDraftBody(runSuffix),
    }),
    'CREATE_CHARGE_ITEM_DRAFT',
  );
  const readChargeDraft = requireData(
    await owner.GET('/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}', {
      params: {
        path: {
          chargeItemId: chargeDraft.chargeItemId,
          chargeItemVersionId: chargeDraft.chargeItemVersionId,
        },
        query: { governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId },
      },
    }),
    'READ_CHARGE_ITEM_DRAFT',
  );
  if (readChargeDraft.governanceStatus !== 'DRAFT') {
    throw new Error('HTTP_CHARGE_DRAFT_STATUS_UNEXPECTED');
  }

  const updatedCharge = requireData(
    await owner.PUT('/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}/draft', {
      params: {
        header: csrfHeaders,
        path: {
          chargeItemId: chargeDraft.chargeItemId,
          chargeItemVersionId: chargeDraft.chargeItemVersionId,
        },
      },
      body: {
        governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
        formalName: `PROTOTYPE SYNTHETIC HTTP CHARGE ITEM UPDATED ${runSuffix}`,
        serviceDefinition: 'PROTOTYPE SYNTHETIC SERVICE FOR HTTP GOVERNANCE VALIDATION',
        billingUnitCode: 'TIMES',
        chargingMethodCode: 'COUNT',
        businessValidFrom: at(-60),
        businessValidTo: null,
      },
    }),
    'UPDATE_CHARGE_ITEM_DRAFT',
  );
  if (updatedCharge.contentDigest === chargeDraft.contentDigest) {
    throw new Error('HTTP_CHARGE_UPDATE_NOT_OBSERVED');
  }

  const chargeChange = requireData(
    await owner.POST('/v1/phase-01/change-requests', {
      params: { header: csrfHeaders },
      body: {
        governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
        entityType: 'CHARGE_ITEM_VERSION',
        stableEntityId: updatedCharge.chargeItemId,
        entityVersionId: updatedCharge.chargeItemVersionId,
        changeKind: 'INITIAL_PUBLICATION',
        riskClassification: 'NORMAL',
        submittedContentDigest: updatedCharge.contentDigest,
        changeReason: 'PROTOTYPE SYNTHETIC HTTP CHARGE ITEM INITIAL PUBLICATION',
        campusId: null,
        frozenEvidence: { catalogCode: 'PROTOTYPE-SYNTHETIC-CHARGE-CATALOG' },
      },
    }),
    'SUBMIT_CHARGE_ITEM_CHANGE',
  );

  await requireRejection(
    owner.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: csrfHeaders,
        path: { changeRequestId: chargeChange.changeRequestId },
      },
      body: {
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC WRONG ROLE REJECTION',
        seenContentDigest: updatedCharge.contentDigest,
        campusId: null,
      },
    }),
    403,
    'WRONG_ROLE_APPROVAL',
  );

  requireData(
    await reviewer.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: csrfHeaders,
        path: { changeRequestId: chargeChange.changeRequestId },
      },
      body: {
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC HTTP PROFESSIONAL REVIEW APPROVED',
        seenContentDigest: updatedCharge.contentDigest,
        campusId: null,
      },
    }),
    'REVIEW_CHARGE_ITEM_CHANGE',
  );
  requireData(
    await finalOwner.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: csrfHeaders,
        path: { changeRequestId: chargeChange.changeRequestId },
      },
      body: {
        stageType: 'OWNER_FINAL_APPROVAL',
        actionResult: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC HTTP OWNER FINAL APPROVAL',
        seenContentDigest: updatedCharge.contentDigest,
        campusId: null,
      },
    }),
    'FINAL_APPROVE_CHARGE_ITEM_CHANGE',
  );
  const publishedCharge = requireData(
    await owner.GET('/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}', {
      params: {
        path: {
          chargeItemId: updatedCharge.chargeItemId,
          chargeItemVersionId: updatedCharge.chargeItemVersionId,
        },
        query: { governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId },
      },
    }),
    'QUERY_PUBLISHED_CHARGE_ITEM',
  );
  if (publishedCharge.governanceStatus !== 'PUBLISHED' || !publishedCharge.releaseId) {
    throw new Error('HTTP_CHARGE_PUBLICATION_MISSING');
  }

  const priceDraft = requireData(
    await owner.POST('/v1/phase-01/price-list-drafts', {
      params: { header: csrfHeaders },
      body: {
        governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
        priceListCode: 'PROTOTYPE-SYNTHETIC-PRICE-LIST',
        displayName: `PROTOTYPE SYNTHETIC HTTP PRICE LIST ${runSuffix}`,
        currencyCode: 'CNY',
        businessValidFrom: at(-60),
        businessValidTo: null,
        entries: [{
          chargeItemId: publishedCharge.chargeItemId,
          chargeItemVersionId: publishedCharge.chargeItemVersionId,
          scopeLevel: 'HOSPITAL',
          campusId: null,
          encounterMode: 'GENERAL',
          encounterType: null,
          fixedUnitPrice: '12.34',
          billingUnitCode: 'TIMES',
          businessValidFrom: at(-60),
          businessValidTo: null,
          zeroPriceReason: null,
        }],
      },
    }),
    'CREATE_PRICE_LIST_DRAFT',
  );
  const priceChange = requireData(
    await owner.POST('/v1/phase-01/change-requests', {
      params: { header: csrfHeaders },
      body: {
        governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
        entityType: 'PRICE_LIST_RELEASE',
        stableEntityId: priceDraft.priceListId,
        entityVersionId: priceDraft.priceListReleaseId,
        changeKind: 'INITIAL_PUBLICATION',
        riskClassification: 'HIGH',
        submittedContentDigest: priceDraft.contentDigest,
        changeReason: 'PROTOTYPE SYNTHETIC HTTP PRICE LIST INITIAL PUBLICATION',
        campusId: null,
        frozenEvidence: {},
      },
    }),
    'SUBMIT_PRICE_LIST_CHANGE',
  );
  requireData(
    await reviewer.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: csrfHeaders,
        path: { changeRequestId: priceChange.changeRequestId },
      },
      body: {
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC HTTP PROFESSIONAL REVIEW APPROVED',
        seenContentDigest: priceDraft.contentDigest,
        campusId: null,
      },
    }),
    'REVIEW_PRICE_LIST_CHANGE',
  );
  requireData(
    await finalOwner.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
      params: {
        header: csrfHeaders,
        path: { changeRequestId: priceChange.changeRequestId },
      },
      body: {
        stageType: 'OWNER_FINAL_APPROVAL',
        actionResult: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC HTTP OWNER FINAL APPROVAL',
        seenContentDigest: priceDraft.contentDigest,
        campusId: null,
      },
    }),
    'FINAL_APPROVE_PRICE_LIST_CHANGE',
  );
  const publishedPriceList = requireData(
    await owner.GET('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}', {
      params: {
        path: {
          priceListId: priceDraft.priceListId,
          priceListReleaseId: priceDraft.priceListReleaseId,
        },
        query: { governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId },
      },
    }),
    'QUERY_PUBLISHED_PRICE_LIST',
  );
  if (publishedPriceList.governanceStatus !== 'PUBLISHED' || !publishedPriceList.governanceReleaseId) {
    throw new Error('HTTP_PRICE_LIST_PUBLICATION_MISSING');
  }
  const priceResolutionTimes = buildPriceResolutionTimes(
    baseTime,
    publishedPriceList.recordedFrom,
  );

  const resolution = requireData(
    await owner.POST('/v1/phase-01/price-resolutions', {
      params: { header: csrfHeaders },
      body: {
        governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
        requestId: `PROTOTYPE-SYNTHETIC-HTTP-PRICE-RESOLUTION-${runSuffix}`,
        chargeItemId: publishedCharge.chargeItemId,
        chargeItemVersionId: publishedCharge.chargeItemVersionId,
        priceListId: publishedPriceList.priceListId,
        campusId: PROTOTYPE_FIXTURE.campusId,
        encounterType: 'OUTPATIENT',
        serviceOccurredAt: priceResolutionTimes.serviceOccurredAt,
        recordAsOf: priceResolutionTimes.recordAsOf,
        quantity: '2',
      },
    }),
    'RESOLVE_PRICE',
  );
  if (
    resolution.status !== 'SUCCEEDED' ||
    resolution.finalAmount !== '24.6800' ||
    resolution.currencyCode !== 'CNY'
  ) {
    throw new Error('HTTP_PRICE_RESOLUTION_UNEXPECTED');
  }

  const history = requireData(
    await owner.GET('/v1/phase-01/charge-items/{chargeItemId}/versions', {
      params: {
        path: { chargeItemId: publishedCharge.chargeItemId },
        query: { governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId },
      },
    }),
    'QUERY_CHARGE_ITEM_HISTORY',
  );
  if (!history.versions.some((version) =>
    version.chargeItemVersionId === publishedCharge.chargeItemVersionId &&
    version.governanceStatus === 'PUBLISHED')) {
    throw new Error('HTTP_VERSION_HISTORY_MISSING');
  }

  const audit = requireData(
    await owner.GET('/v1/phase-01/audit-events', {
      params: {
        query: {
          governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
          stableEntityId: publishedCharge.chargeItemId,
          action: 'RESOLVED',
          limit: 10,
        },
      },
    }),
    'QUERY_AUDIT_RECORDS',
  );
  if (!audit.events.some((event) => event.entityVersionId === resolution.priceResolutionId)) {
    throw new Error('HTTP_AUDIT_RECORD_MISSING');
  }

  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    httpApiStarted: true,
    databaseConnected: true,
    chargeItemPublished: true,
    priceListPublished: true,
    priceResolutionSucceeded: true,
    authorizationRejectionObserved: true,
    csrfRejectionObserved: true,
    historyObserved: true,
    auditObserved: true,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    errorCode: safeErrorCode(error, 'PROTOTYPE_HTTP_FLOW_FAILED'),
  })}\n`);
  process.exitCode = 1;
}

function prototypeClient(
  principalCode: 'prototype-owner' | 'prototype-reviewer' | 'prototype-final-owner' | undefined,
  csrfToken: string = PROTOTYPE_CSRF_TOKEN,
) {
  const prototypeFetch: typeof globalThis.fetch = (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    if (principalCode) headers.set('x-prototype-principal-code', principalCode);
    return globalThis.fetch(input, { ...init, headers });
  };
  return createGovernanceApiClient({ baseUrl, csrfToken, fetch: prototypeFetch });
}

function chargeDraftBody(suffix: string) {
  return {
    governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
    internalCode: `PROTOTYPE-SYNTHETIC-HTTP-FEE-${suffix}`,
    formalName: `PROTOTYPE SYNTHETIC HTTP CHARGE ITEM ${suffix}`,
    serviceDefinition: 'PROTOTYPE SYNTHETIC SERVICE FOR HTTP GOVERNANCE VALIDATION',
    billingUnitCode: 'TIMES',
    chargingMethodCode: 'COUNT',
    businessValidFrom: at(-60),
    businessValidTo: null,
  };
}

function requireData<Data>(
  result: { readonly data?: Data; readonly error?: unknown; readonly response: Response },
  step: string,
): Data {
  if (!result.response.ok || result.data === undefined) {
    const errorCode = isRecord(result.error) && typeof result.error['code'] === 'string'
      ? result.error['code']
      : 'NO_ERROR_CODE';
    throw new Error(`HTTP_STEP_FAILED:${step}:${result.response.status}:${errorCode}`);
  }
  return result.data;
}

async function requireRejection(
  resultPromise: Promise<{ readonly response: Response }>,
  expectedStatus: number,
  step: string,
): Promise<void> {
  const result = await resultPromise;
  if (result.response.status !== expectedStatus) {
    throw new Error(`HTTP_REJECTION_MISSING:${step}:${result.response.status}`);
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

function safeErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) {
    return error.message;
  }
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
