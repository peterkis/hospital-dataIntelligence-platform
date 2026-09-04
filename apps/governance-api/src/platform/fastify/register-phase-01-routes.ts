import { consumerFailureCode } from '../../modules/audit/index.js';
import { ConsumerAuditReportSchema, ConsumerAuditQuerySchema, ConsumerAuditAcknowledgementSchema, ConsumerAuditPageSchema } from './consumer-audit-schemas.js';
import {
  Type,
  type TypeBoxTypeProvider,
} from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import type { Static } from 'typebox';
import { BrowserMutationHeadersSchema } from './browser-mutation-headers.js';
import type { TransactionRunner } from '../transaction/transaction-runner.js';
import { LOCAL_DATE_TIME_JSON_PATTERN } from '../local-datetime/local-datetime.js';
import {
  createHttpRequestContext as createRequestContext,
  type HttpRequestContextDependencies,
} from './request-context.js';
import type { ScopedModules } from '../../composition/create-scoped-modules.js';
import type { Phase01VerticalSlice } from '../../composition/phase-01-vertical-slice.js';
import type { ObjectPermissionCode } from '../../modules/authorization/index.js';
import type { ImportJobView } from '../../modules/batch-import/index.js';
import type {
  ChangeRequestView,
  WorkflowApplication,
} from '../../modules/workflow/index.js';
import type { PriceEntryInput } from '../../modules/price-list/index.js';
import {
  CreateSubscriptionBodySchema,
  CreateSubscriptionVersionBodySchema,
  SnapshotBinarySchema,
  ChangeSubscriptionLifecycleBodySchema,
  SubscriptionLifecycleResponseSchema,
  ConsumerOperationalQuerySchema,
  ConsumerOperationalResponseSchema,
} from './release-consumer-schemas.js';

const UuidSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const LocalDateTimeSchema = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
const DigestHexSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });
const PositiveSequenceSchema = Type.String({ pattern: '^(?:0|[1-9]\\d*)$' });
const ServiceHeadersSchema = Type.Object({
  authorization: Type.String({ pattern: '^Bearer .+$' }),
});

const chargeItemContentProperties = {
  formalName: Type.String({ minLength: 1, maxLength: 256 }),
  serviceDefinition: Type.String({ minLength: 1, maxLength: 2000 }),
  billingUnitCode: Type.String({ minLength: 1, maxLength: 64 }),
  chargingMethodCode: Type.String({ minLength: 1, maxLength: 32 }),
  businessValidFrom: LocalDateTimeSchema,
  businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
};

const CreateChargeItemDraftBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    internalCode: Type.String({ minLength: 1, maxLength: 64 }),
    ...chargeItemContentProperties,
  },
  { additionalProperties: false },
);

const UpdateChargeItemDraftBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    ...chargeItemContentProperties,
  },
  { additionalProperties: false },
);

const ChargeItemVersionParamsSchema = Type.Object(
  {
    chargeItemId: UuidSchema,
    chargeItemVersionId: UuidSchema,
  },
  { additionalProperties: false },
);

const GovernanceObjectQuerySchema = Type.Object(
  { governanceObjectId: UuidSchema },
  { additionalProperties: false },
);

const ChargeItemAsOfQuerySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    businessAt: LocalDateTimeSchema,
    recordAsOf: LocalDateTimeSchema,
  },
  { additionalProperties: false },
);

const ChargeItemVersionDiffQuerySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    leftVersionId: UuidSchema,
    rightVersionId: UuidSchema,
  },
  { additionalProperties: false },
);

const ChargeItemVersionResponseSchema = Type.Object(
  {
    chargeItemId: UuidSchema,
    chargeItemVersionId: UuidSchema,
    versionNo: Type.String({ pattern: '^[1-9]\\d*$' }),
    internalCode: Type.String({ minLength: 1, maxLength: 64 }),
    ...chargeItemContentProperties,
    governanceStatus: Type.Union([
      Type.Literal('DRAFT'),
      Type.Literal('IN_REVIEW'),
      Type.Literal('APPROVED'),
      Type.Literal('PUBLISHED'),
    ]),
    businessStatus: Type.Union([
      Type.Literal('PLANNED'),
      Type.Literal('ACTIVE'),
      Type.Literal('SUSPENDED'),
      Type.Literal('ENDED'),
      Type.Literal('SUPERSEDED'),
    ]),
    recordedFrom: LocalDateTimeSchema,
    recordedTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    releaseId: Type.Union([UuidSchema, Type.Null()]),
    contentDigest: DigestHexSchema,
  },
  { additionalProperties: false },
);

const EncounterTypeSchema = Type.Union([
  Type.Literal('OUTPATIENT'),
  Type.Literal('INPATIENT'),
  Type.Literal('EMERGENCY'),
  Type.Literal('CHECKUP'),
]);

const PriceEntryBodySchema = Type.Object(
  {
    chargeItemId: UuidSchema,
    chargeItemVersionId: UuidSchema,
    scopeLevel: Type.Union([Type.Literal('HOSPITAL'), Type.Literal('CAMPUS')]),
    campusId: Type.Union([UuidSchema, Type.Null()]),
    encounterMode: Type.Union([Type.Literal('GENERAL'), Type.Literal('SPECIFIC')]),
    encounterType: Type.Union([EncounterTypeSchema, Type.Null()]),
    fixedUnitPrice: Type.String({ pattern: '^\\d+(?:\\.\\d{1,4})?$' }),
    billingUnitCode: Type.String({ minLength: 1, maxLength: 64 }),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    zeroPriceReason: Type.Union([
      Type.String({ minLength: 1, maxLength: 500 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

const PriceListDraftBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    priceListCode: Type.String({ minLength: 1, maxLength: 64 }),
    displayName: Type.String({ minLength: 1, maxLength: 256 }),
    currencyCode: Type.String({ pattern: '^[A-Z]{3}$' }),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    entries: Type.Array(PriceEntryBodySchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

const PriceListDraftUpdateBodySchema = Type.Omit(PriceListDraftBodySchema, [
  'priceListCode',
]);

const PriceListReleaseParamsSchema = Type.Object(
  { priceListId: UuidSchema, priceListReleaseId: UuidSchema },
  { additionalProperties: false },
);

const PriceListReleaseResponseSchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    priceListId: UuidSchema,
    priceListReleaseId: UuidSchema,
    releaseNo: Type.String({ pattern: '^[1-9]\\d*$' }),
    priceListCode: Type.String(),
    displayName: Type.String(),
    currencyCode: Type.String(),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    recordedFrom: LocalDateTimeSchema,
    recordedTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    governanceStatus: Type.Union([
      Type.Literal('DRAFT'),
      Type.Literal('IN_REVIEW'),
      Type.Literal('APPROVED'),
      Type.Literal('PUBLISHED'),
    ]),
    governanceReleaseId: Type.Union([UuidSchema, Type.Null()]),
    businessStatus: Type.Union([
      Type.Literal('PLANNED'),
      Type.Literal('ACTIVE'),
      Type.Literal('SUSPENDED'),
      Type.Literal('ENDED'),
    ]),
    contentDigest: DigestHexSchema,
    entries: Type.Array(
      Type.Object(
        {
          ...PriceEntryBodySchema.properties,
          entryNo: Type.String(),
          priceEntryId: UuidSchema,
          chargeItemInternalCode: Type.String(),
          priceNature: Type.Union([
            Type.Literal('HOSPITAL_DEFAULT'),
            Type.Literal('CAMPUS_DIFFERENCE'),
          ]),
          contentHash: DigestHexSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const PriceListDifferenceResponseSchema = Type.Array(
  Type.Object(
    {
      kind: Type.Union([
        Type.Literal('ADDED'),
        Type.Literal('REMOVED'),
        Type.Literal('PRICE_CHANGED'),
        Type.Literal('APPLICABILITY_CHANGED'),
      ]),
      businessKey: Type.String(),
      previousEntryId: Type.Union([UuidSchema, Type.Null()]),
      currentEntryId: Type.Union([UuidSchema, Type.Null()]),
    },
    { additionalProperties: false },
  ),
);

const ChangeRequestBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    entityType: Type.Union([
      Type.Literal('CHARGE_ITEM_VERSION'),
      Type.Literal('PRICE_LIST_RELEASE'),
    ]),
    stableEntityId: UuidSchema,
    entityVersionId: UuidSchema,
    changeKind: Type.Union([
      Type.Literal('INITIAL_PUBLICATION'),
      Type.Literal('VERSION_CHANGE'),
      Type.Literal('RETROACTIVE_CORRECTION'),
      Type.Literal('CAMPUS_DIFFERENCE_PRICE'),
      Type.Literal('PROJECTION_SCHEMA_UPGRADE'),
      Type.Literal('RECOVERY_PUBLICATION'),
    ]),
    riskClassification: Type.Union([
      Type.Literal('NORMAL'),
      Type.Literal('HIGH'),
      Type.Literal('PURE_SCHEMA_UPGRADE'),
      Type.Literal('RECOVERY'),
    ]),
    submittedContentDigest: DigestHexSchema,
    changeReason: Type.String({ minLength: 1, maxLength: 1000 }),
    campusId: Type.Union([UuidSchema, Type.Null()]),
    frozenEvidence: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

const ChangeRequestActionBodySchema = Type.Object(
  {
    stageType: Type.Union([
      Type.Literal('CAMPUS_PRE_CONFIRMATION'),
      Type.Literal('PROFESSIONAL_REVIEW'),
      Type.Literal('DOMAIN_SEMANTIC_CONFIRMATION'),
      Type.Literal('OWNER_FINAL_APPROVAL'),
      Type.Literal('CONTRACT_FINAL_APPROVAL'),
    ]),
    actionResult: Type.Union([Type.Literal('APPROVED'), Type.Literal('REJECTED')]),
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
    seenContentDigest: DigestHexSchema,
    campusId: Type.Union([UuidSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

const ChangeRequestResponseSchema = Type.Object(
  {
    changeRequestId: UuidSchema,
    governanceObjectId: UuidSchema,
    stableEntityId: UuidSchema,
    entityVersionId: UuidSchema,
    changeKind: Type.String(),
    riskClassification: Type.String(),
    approvalTemplateVersionId: UuidSchema,
    submittedContentDigest: DigestHexSchema,
    submittedBy: UuidSchema,
    requestStatus: Type.String(),
    requiredStageCount: Type.Integer({ minimum: 1 }),
    nextActionSequence: Type.String({ pattern: '^[1-9]\\d*$' }),
  },
  { additionalProperties: false },
);

const CreateImportJobBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    importType: Type.Union([Type.Literal('CHARGE_ITEM'), Type.Literal('PRICE_ENTRY')]),
    sourceKind: Type.Union([Type.Literal('CSV'), Type.Literal('JSON')]),
    schemaVersion: Type.Literal('phase-01.import.v1'),
    rawContent: Type.String({ minLength: 2, maxLength: 16_777_216 }),
  },
  { additionalProperties: false },
);

const ImportJobResponseSchema = Type.Object(
  {
    importJobId: UuidSchema,
    governanceObjectId: UuidSchema,
    importType: Type.Union([Type.Literal('CHARGE_ITEM'), Type.Literal('PRICE_ENTRY')]),
    sourceKind: Type.Union([Type.Literal('CSV'), Type.Literal('JSON')]),
    schemaVersion: Type.String(),
    rawContentDigest: DigestHexSchema,
    normalizedContentDigest: DigestHexSchema,
    jobStatus: Type.String(),
    rowCount: Type.Integer({ minimum: 1 }),
    succeededCount: Type.Integer({ minimum: 0 }),
    failedCount: Type.Integer({ minimum: 0 }),
    rows: Type.Array(Type.Object({
      importRowId: UuidSchema,
      rowNo: Type.String(),
      sourceRowId: Type.String(),
      businessKey: Type.String(),
      rowStatus: Type.Union([
        Type.Literal('PENDING'), Type.Literal('SUCCEEDED'), Type.Literal('FAILED'),
      ]),
      retryable: Type.Boolean(),
      stableEntityId: Type.Union([UuidSchema, Type.Null()]),
      entityVersionId: Type.Union([UuidSchema, Type.Null()]),
      resultKind: Type.Union([Type.String(), Type.Null()]),
      currentErrorCode: Type.Union([Type.String(), Type.Null()]),
    }, { additionalProperties: false })),
  },
  { additionalProperties: false },
);

const EmergencySuspensionBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    scopeLevel: Type.Union([Type.Literal('HOSPITAL'), Type.Literal('CAMPUS')]),
    campusId: Type.Union([UuidSchema, Type.Null()]),
    effectiveFrom: LocalDateTimeSchema,
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
    evidence: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

const ImpactActionBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    reason: Type.String({ minLength: 1, maxLength: 1000 }),
    evidence: Type.Record(Type.String(), Type.Unknown()),
  },
  { additionalProperties: false },
);

const AuditQuerySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    stableEntityId: Type.Optional(UuidSchema),
    entityVersionId: Type.Optional(UuidSchema),
    requestId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    action: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    actorPrincipalId: Type.Optional(UuidSchema),
    sequenceFrom: Type.Optional(Type.String({ pattern: '^[1-9]\\d*$' })),
    sequenceTo: Type.Optional(Type.String({ pattern: '^[1-9]\\d*$' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
  },
  { additionalProperties: false },
);

const AuditEventResponseSchema = Type.Object(
  {
    auditEventId: UuidSchema,
    auditStreamId: Type.String(),
    auditSequence: Type.String(),
    entityType: Type.String(),
    stableEntityId: UuidSchema,
    entityVersionId: Type.Union([UuidSchema, Type.Null()]),
    action: Type.String(),
    actorPrincipalId: UuidSchema,
    occurredAt: LocalDateTimeSchema,
    requestId: Type.String(),
    correlationId: Type.String(),
    previousDigest: DigestHexSchema,
    currentDigest: DigestHexSchema,
  },
  { additionalProperties: false },
);

const ResolvePriceBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    requestId: Type.String({ minLength: 1, maxLength: 128 }),
    chargeItemId: UuidSchema,
    chargeItemVersionId: UuidSchema,
    priceListId: UuidSchema,
    campusId: UuidSchema,
    encounterType: EncounterTypeSchema,
    serviceOccurredAt: LocalDateTimeSchema,
    recordAsOf: LocalDateTimeSchema,
    quantity: Type.String({ pattern: '^\\d+(?:\\.\\d{1,6})?$' }),
  },
  { additionalProperties: false },
);

const ResolutionResponseSchema = Type.Object(
  {
    priceResolutionId: UuidSchema,
    requestId: Type.String(),
    status: Type.Union([
      Type.Literal('SUCCEEDED'),
      Type.Literal('NO_PRICE'),
      Type.Literal('CONFLICT'),
      Type.Literal('SUSPENDED'),
    ]),
    priceListReleaseId: Type.Union([UuidSchema, Type.Null()]),
    finalAmount: Type.Union([Type.String({ pattern: '^\\d+\\.\\d{4}$' }), Type.Null()]),
    currencyCode: Type.Union([Type.String({ pattern: '^[A-Z]{3}$' }), Type.Null()]),
    resultDigest: Type.Union([DigestHexSchema, Type.Null()]),
    steps: Type.Array(
      Type.Object(
        {
          stepNo: Type.String({ pattern: '^[1-9]\\d*$' }),
          scopeChecked: Type.Union([Type.Literal('CAMPUS'), Type.Literal('HOSPITAL')]),
          encounterModeChecked: Type.Union([
            Type.Literal('SPECIFIC'),
            Type.Literal('GENERAL'),
          ]),
          candidateCount: Type.Integer({ minimum: 0 }),
          decision: Type.Union([
            Type.Literal('MATCHED'),
            Type.Literal('NO_CANDIDATE'),
            Type.Literal('CONFLICT'),
            Type.Literal('SUSPENDED'),
          ]),
          priceEntryId: Type.Union([UuidSchema, Type.Null()]),
          candidateSetDigest: DigestHexSchema,
          explanationCode: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const SubscriptionVersionResponseSchema = Type.Object(
  {
    subscriptionId: UuidSchema,
    subscriptionVersionId: UuidSchema,
    versionNo: Type.String({ pattern: '^[1-9]\\d*$' }),
  },
  { additionalProperties: false },
);

const ReplayBlockedDeliveryBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    eventId: UuidSchema,
  },
  { additionalProperties: false },
);

const ReplayBlockedDeliveryResponseSchema = Type.Object(
  {
    deliveryId: UuidSchema,
    deliveryStateId: UuidSchema,
    stateSequence: Type.String({ pattern: '^[1-9]\\d*$' }),
  },
  { additionalProperties: false },
);

const SubscriptionParamsSchema = Type.Object(
  { subscriptionId: UuidSchema },
  { additionalProperties: false },
);
const SnapshotParamsSchema = Type.Object(
  { subscriptionId: UuidSchema, snapshotId: UuidSchema },
  { additionalProperties: false },
);
const EventQuerySchema = Type.Object(
  { afterAggregateVersion: Type.Optional(PositiveSequenceSchema) },
  { additionalProperties: false },
);

const AvailableEventsResponseSchema = Type.Object(
  {
    events: Type.Array(
      Type.Object(
        {
          eventId: UuidSchema,
          governanceObjectId: UuidSchema,
          aggregateVersion: Type.String({ pattern: '^[1-9]\\d*$' }),
          releaseId: UuidSchema,
          snapshotId: UuidSchema,
          projectionType: Type.String(),
          projectionSchemaVersion: Type.String(),
          projectionSchemaDigest: DigestHexSchema,
          projectionPayloadDigest: DigestHexSchema,
          snapshotArtifactDigest: DigestHexSchema,
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const ReceiptBodySchema = Type.Object(
  {
    eventId: UuidSchema,
    receiveResult: Type.Union([Type.Literal('ACCEPTED'), Type.Literal('REJECTED')]),
    validationResult: Type.Union([Type.Literal('VALID'), Type.Literal('INVALID')]),
    applyResult: Type.Union([Type.Literal('APPLIED'), Type.Literal('NOT_APPLIED')]),
    processingDigest: DigestHexSchema,
    processedAt: LocalDateTimeSchema,
    replay: Type.Optional(Type.Object({ releaseId: UuidSchema, subscriptionVersionId: UuidSchema,
      operationId: UuidSchema, reason: Type.String({ minLength: 1, maxLength: 256, pattern: '^[^\\u0000-\\u001f\\u007f<>]+$' }),
    }, { additionalProperties: false })),
  },
  { additionalProperties: false },
);

const ReceiptResponseSchema = Type.Object(
  { receiptId: UuidSchema, receiptSequence: Type.String({ pattern: '^[1-9]\\d*$' }) },
  { additionalProperties: false },
);

const ReplayContextParamsSchema = Type.Object({ subscriptionId: UuidSchema, releaseId: UuidSchema }, { additionalProperties: false });
const ReplaySequenceSchema = Type.String({ pattern: '^(?:0|[1-9]\\d*)$', maxLength: 19 });
const ReplayReceiptSchema = Type.Union([Type.Object({
  receiptId: UuidSchema, receiptSequence: ReplaySequenceSchema,
  receiveResult: Type.Union([Type.Literal('ACCEPTED'), Type.Literal('REJECTED')]),
  validationResult: Type.Union([Type.Literal('VALID'), Type.Literal('INVALID')]),
  applyResult: Type.Union([Type.Literal('APPLIED'), Type.Literal('NOT_APPLIED')]), processingDigest: DigestHexSchema,
}, { additionalProperties: false }), Type.Null()]);
const ReplayContextResponseSchema = Type.Object({
  subscriptionId: UuidSchema, servicePrincipalId: UuidSchema, lifecycleStatus: Type.Literal('ACTIVE'),
  subscriptionVersion: Type.Object({ subscriptionVersionId: UuidSchema, versionNo: ReplaySequenceSchema,
    projectionType: Type.String({ maxLength: 128 }), projectionSchemaVersion: Type.String({ maxLength: 32 }), projectionSchemaDigest: DigestHexSchema,
  }, { additionalProperties: false }),
  event: Type.Object({ ...AvailableEventsResponseSchema.properties.events.items.properties,
    aggregateVersion: Type.String({ pattern: '^[1-9]\\d*$', maxLength: 19 }),
    projectionType: Type.String({ maxLength: 128 }), projectionSchemaVersion: Type.String({ maxLength: 32 }),
  }, { additionalProperties: false }),
  checkpoint: Type.Object({ appliedAggregateVersion: ReplaySequenceSchema,
    recordedAt: Type.Union([LocalDateTimeSchema, Type.Null()]) }, { additionalProperties: false }),
  latestReceipt: ReplayReceiptSchema, appliedReceipt: ReplayReceiptSchema, processingDigestMismatch: Type.Boolean(),
}, { additionalProperties: false });

const ErrorResponseSchema = Type.Object(
  {
    code: Type.String(),
    requestId: Type.String(),
  },
  { additionalProperties: false },
);

export interface Phase01HttpDependencies extends HttpRequestContextDependencies {
  readonly verticalSlice: Phase01VerticalSlice;
  readonly transactionRunner: TransactionRunner<ScopedModules>;
  readonly workflowApplication: WorkflowApplication;
}

export async function registerPhase01Routes(
  application: FastifyInstance,
  dependencies?: Phase01HttpDependencies,
): Promise<void> {
  const typed = application.withTypeProvider<TypeBoxTypeProvider>();

  typed.post(
    '/v1/phase-01/charge-item-drafts',
    {
      schema: {
        operationId: 'createPhase01ChargeItemDraft',
        summary: '新建收费项目稳定身份及初始草稿版本',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: CreateChargeItemDraftBodySchema,
        response: {
          201: ChargeItemVersionResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const draft = await runtime.verticalSlice.createChargeItemDraft(context, request.body);
      return reply.code(201).send(toChargeItemVersionResponse(draft));
    },
  );

  typed.get(
    '/v1/phase-01/charge-items/:chargeItemId/versions/:chargeItemVersionId',
    {
      schema: {
        operationId: 'getPhase01ChargeItemVersion',
        summary: '查询收费项目草稿或不可变历史版本',
        security: [{ browserSession: [] }],
        params: ChargeItemVersionParamsSchema,
        querystring: GovernanceObjectQuerySchema,
        response: {
          200: ChargeItemVersionResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const version = await runtime.verticalSlice.getChargeItemVersion(context, {
        ...request.params,
        governanceObjectId: request.query.governanceObjectId,
      });
      return toChargeItemVersionResponse(version);
    },
  );

  typed.put(
    '/v1/phase-01/charge-items/:chargeItemId/versions/:chargeItemVersionId/draft',
    {
      schema: {
        operationId: 'updatePhase01ChargeItemDraft',
        summary: '修改尚未提交的收费项目草稿',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: ChargeItemVersionParamsSchema,
        body: UpdateChargeItemDraftBodySchema,
        response: {
          200: ChargeItemVersionResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const draft = await runtime.verticalSlice.updateChargeItemDraft(context, {
        ...request.params,
        ...request.body,
      });
      return toChargeItemVersionResponse(draft);
    },
  );

  typed.delete(
    '/v1/phase-01/charge-items/:chargeItemId/versions/:chargeItemVersionId/draft',
    {
      schema: {
        operationId: 'deletePhase01ChargeItemDraft',
        summary: '物理删除尚未提交的收费项目草稿',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: ChargeItemVersionParamsSchema,
        querystring: GovernanceObjectQuerySchema,
        response: {
          204: Type.Null(),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      await runtime.verticalSlice.deleteChargeItemDraft(context, {
        ...request.params,
        governanceObjectId: request.query.governanceObjectId,
      });
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/v1/phase-01/charge-items/:chargeItemId/version-drafts',
    {
      schema: {
        operationId: 'createPhase01ChargeItemVersionDraft',
        summary: '在收费项目稳定身份下建立下一版本草稿候选',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ chargeItemId: UuidSchema }, { additionalProperties: false }),
        body: UpdateChargeItemDraftBodySchema,
        response: {
          201: ChargeItemVersionResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const draft = await runtime.verticalSlice.createChargeItemVersionDraft(context, {
        chargeItemId: request.params.chargeItemId,
        ...request.body,
      });
      return reply.code(201).send(toChargeItemVersionResponse(draft));
    },
  );

  typed.get(
    '/v1/phase-01/charge-items/:chargeItemId/versions',
    {
      schema: {
        operationId: 'listPhase01ChargeItemVersions',
        summary: '按显式版本序号查询收费项目完整版本历史',
        security: [{ browserSession: [] }],
        params: Type.Object({ chargeItemId: UuidSchema }, { additionalProperties: false }),
        querystring: GovernanceObjectQuerySchema,
        response: {
          200: Type.Object({
            versions: Type.Array(ChargeItemVersionResponseSchema),
          }, { additionalProperties: false }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const versions = await runtime.verticalSlice.listChargeItemVersions(context, {
        chargeItemId: request.params.chargeItemId,
        governanceObjectId: request.query.governanceObjectId,
      });
      return { versions: versions.map(toChargeItemVersionResponse) };
    },
  );

  typed.get(
    '/v1/phase-01/charge-items/:chargeItemId/as-of',
    {
      schema: {
        operationId: 'getPhase01ChargeItemVersionAsOf',
        summary: '按业务时点和平台记录时点查询收费项目版本',
        security: [{ browserSession: [] }],
        params: Type.Object({ chargeItemId: UuidSchema }, { additionalProperties: false }),
        querystring: ChargeItemAsOfQuerySchema,
        response: {
          200: Type.Union([ChargeItemVersionResponseSchema, Type.Null()]),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const version = await runtime.verticalSlice.getChargeItemVersionAsOf(context, {
        chargeItemId: request.params.chargeItemId,
        ...request.query,
      });
      return version ? toChargeItemVersionResponse(version) : null;
    },
  );

  typed.get(
    '/v1/phase-01/charge-items/:chargeItemId/version-diff',
    {
      schema: {
        operationId: 'comparePhase01ChargeItemVersions',
        summary: '比较两个收费项目版本的内容、业务时间和生命周期差异',
        security: [{ browserSession: [] }],
        params: Type.Object({ chargeItemId: UuidSchema }, { additionalProperties: false }),
        querystring: ChargeItemVersionDiffQuerySchema,
        response: {
          200: Type.Object({
            differences: Type.Array(Type.Object({
              field: Type.String(),
              leftValue: Type.Union([Type.String(), Type.Null()]),
              rightValue: Type.Union([Type.String(), Type.Null()]),
            }, { additionalProperties: false })),
          }, { additionalProperties: false }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const differences = await runtime.verticalSlice.compareChargeItemVersions(context, {
        chargeItemId: request.params.chargeItemId,
        ...request.query,
      });
      return { differences: [...differences] };
    },
  );

  typed.post(
    '/v1/phase-01/price-list-drafts',
    {
      schema: {
        operationId: 'createPhase01PriceListDraft',
        summary: '新建完整价表草稿并冻结收费项目版本引用',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: PriceListDraftBodySchema,
        response: {
          201: PriceListReleaseResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const draft = await runtime.verticalSlice.createPriceListDraft(context, request.body);
      return reply.code(201).send(toPriceListReleaseResponse(draft));
    },
  );

  typed.get(
    '/v1/phase-01/price-lists/:priceListId/releases/:priceListReleaseId',
    {
      schema: {
        operationId: 'getPhase01PriceListRelease',
        summary: '查询价表草稿或不可变历史发布版本',
        security: [{ browserSession: [] }],
        params: PriceListReleaseParamsSchema,
        querystring: GovernanceObjectQuerySchema,
        response: {
          200: PriceListReleaseResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const release = await runtime.verticalSlice.getPriceListRelease(context, {
        ...request.params,
        governanceObjectId: request.query.governanceObjectId,
      });
      return toPriceListReleaseResponse(release);
    },
  );

  typed.put(
    '/v1/phase-01/price-lists/:priceListId/releases/:priceListReleaseId/draft',
    {
      schema: {
        operationId: 'updatePhase01PriceListDraft',
        summary: '整体替换尚未提交的完整价表草稿',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: PriceListReleaseParamsSchema,
        body: PriceListDraftUpdateBodySchema,
        response: {
          200: PriceListReleaseResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const draft = await runtime.verticalSlice.updatePriceListDraft(context, {
        ...request.params,
        ...request.body,
      });
      return toPriceListReleaseResponse(draft);
    },
  );

  typed.delete(
    '/v1/phase-01/price-lists/:priceListId/releases/:priceListReleaseId/draft',
    {
      schema: {
        operationId: 'deletePhase01PriceListDraft',
        summary: '物理删除尚未提交的价表草稿',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: PriceListReleaseParamsSchema,
        querystring: GovernanceObjectQuerySchema,
        response: {
          204: Type.Null(),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      await runtime.verticalSlice.deletePriceListDraft(context, {
        ...request.params,
        governanceObjectId: request.query.governanceObjectId,
      });
      return reply.code(204).send(null);
    },
  );

  typed.get(
    '/v1/phase-01/price-lists/:priceListId/releases/:priceListReleaseId/diff',
    {
      schema: {
        operationId: 'diffPhase01PriceListDraft',
        summary: '比较价表草稿与上一已发布完整快照',
        security: [{ browserSession: [] }],
        params: PriceListReleaseParamsSchema,
        querystring: GovernanceObjectQuerySchema,
        response: {
          200: Type.Object(
            { differences: PriceListDifferenceResponseSchema },
            { additionalProperties: false },
          ),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const differences = await runtime.verticalSlice.diffPriceListDraft(context, {
        ...request.params,
        governanceObjectId: request.query.governanceObjectId,
      });
      return {
        differences: differences.map((difference) => ({
          kind: difference.kind,
          businessKey: difference.businessKey,
          previousEntryId: difference.previousEntry?.priceEntryId ?? null,
          currentEntryId: difference.currentEntry?.priceEntryId ?? null,
        })),
      };
    },
  );

  typed.get(
    '/v1/phase-01/audit-events',
    {
      schema: {
        operationId: 'queryPhase01AuditEvents',
        summary: '按对象、身份、版本、请求、动作、主体和显式序号查询审计事件',
        security: [{ browserSession: [] }],
        querystring: AuditQuerySchema,
        response: {
          200: Type.Object({ events: Type.Array(AuditEventResponseSchema) }, { additionalProperties: false }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: request.query.governanceObjectId,
          permissionCode: 'AUDIT_READ',
        });
        const events = await modules.audit.query({ ...request.query, limit: request.query.limit ?? 100 });
        return {
          events: events.map(({ previousHash, currentHash, ...event }) => ({
            ...event,
            previousDigest: previousHash.toString('hex'),
            currentDigest: currentHash.toString('hex'),
          })),
        };
      });
      return result;
    },
  );

  typed.get(
    '/v1/phase-01/audit-streams/:auditStreamId/integrity',
    {
      schema: {
        operationId: 'verifyPhase01AuditStream',
        summary: '只读重算审计哈希链并定位首个不一致序号',
        security: [{ browserSession: [] }],
        params: Type.Object({ auditStreamId: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }),
        querystring: GovernanceObjectQuerySchema,
        response: {
          200: Type.Object({
            valid: Type.Boolean(),
            eventCount: Type.Integer({ minimum: 0 }),
            firstMismatchSequence: Type.Union([Type.String(), Type.Null()]),
            errorType: Type.Union([
              Type.Literal('SEQUENCE'), Type.Literal('PAYLOAD_HASH'), Type.Literal('PREVIOUS_HASH'),
              Type.Literal('CURRENT_HASH'), Type.Null(),
            ]),
          }, { additionalProperties: false }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      return runtime.transactionRunner.run(context, async (modules) => {
        if (request.params.auditStreamId !== request.query.governanceObjectId) {
          throw new Error('AUDIT_STREAM_GOVERNANCE_OBJECT_MISMATCH');
        }
        await modules.authorization.requireObjectPermission({
          governanceObjectId: request.query.governanceObjectId,
          permissionCode: 'AUDIT_READ',
        });
        return modules.audit.verifyChainDetailed(request.params.auditStreamId);
      });
    },
  );

  typed.post(
    '/v1/phase-01/price-lists/:priceListId/releases/:priceListReleaseId/emergency-suspensions',
    {
      schema: {
        operationId: 'suspendPhase01PriceListRelease',
        summary: '以独立紧急权限追加暂停事件并创建影响事项',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: PriceListReleaseParamsSchema,
        body: EmergencySuspensionBodySchema,
        response: {
          201: Type.Object({
            suspensionEventId: UuidSchema,
            impactCaseId: UuidSchema,
            eventSequence: Type.String(),
          }, { additionalProperties: false }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: request.body.governanceObjectId,
          permissionCode: 'EMERGENCY_SUSPEND',
          campusId: request.body.scopeLevel === 'CAMPUS' ? request.body.campusId : null,
        });
        const release = await modules.priceList.getRelease({
          ...request.params,
          governanceObjectId: request.body.governanceObjectId,
        });
        if (!release || release.governanceObjectId !== request.body.governanceObjectId) {
          throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
        }
        if (release.governanceStatus !== 'PUBLISHED') {
          throw new Error('EMERGENCY_SUSPENSION_PUBLISHED_RELEASE_REQUIRED');
        }
        const suspended = await modules.emergencyControl.suspendPriceRelease({
          ...request.params,
          ...request.body,
        });
        await modules.audit.append({
          auditStreamId: request.body.governanceObjectId,
          governanceObjectId: request.body.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: request.params.priceListId,
          entityVersionId: request.params.priceListReleaseId,
          action: 'EMERGENCY_SUSPENDED',
          afterHash: null,
          authorityScope: request.body.scopeLevel === 'CAMPUS'
            ? `CAMPUS:${request.body.campusId}`
            : 'HOSPITAL',
        });
        return suspended;
      });
      return reply.code(201).send(result);
    },
  );

  typed.post(
    '/v1/phase-01/impact-cases/:impactCaseId/post-incident-review',
    {
      schema: {
        operationId: 'reviewPhase01ImpactCase',
        summary: '由非紧急操作者完成高优先级事后复核',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ impactCaseId: UuidSchema }, { additionalProperties: false }),
        body: ImpactActionBodySchema,
        response: {
          204: Type.Null(),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      await runtime.transactionRunner.run(context, async (modules) => {
        const impact = await modules.emergencyControl.getImpactCaseContext(
          request.params.impactCaseId,
        );
        if (impact.governanceObjectId !== request.body.governanceObjectId) {
          throw new Error('IMPACT_CASE_GOVERNANCE_OBJECT_MISMATCH');
        }
        await modules.authorization.requireObjectPermission({
          governanceObjectId: impact.governanceObjectId,
          permissionCode: 'IMPACT_REVIEW',
        });
        await modules.emergencyControl.approvePostIncidentReview({
          impactCaseId: request.params.impactCaseId,
          reason: request.body.reason,
          evidence: request.body.evidence,
        });
      });
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/v1/phase-01/impact-cases/:impactCaseId/closure',
    {
      schema: {
        operationId: 'closePhase01ImpactCase',
        summary: '在补偿发布回执与复核证据完整后关闭影响事项',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ impactCaseId: UuidSchema }, { additionalProperties: false }),
        body: ImpactActionBodySchema,
        response: {
          204: Type.Null(),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      await runtime.transactionRunner.run(context, async (modules) => {
        const impact = await modules.emergencyControl.getImpactCaseContext(
          request.params.impactCaseId,
        );
        if (impact.governanceObjectId !== request.body.governanceObjectId) {
          throw new Error('IMPACT_CASE_GOVERNANCE_OBJECT_MISMATCH');
        }
        await modules.authorization.requireObjectPermission({
          governanceObjectId: impact.governanceObjectId,
          permissionCode: 'IMPACT_REVIEW',
        });
        const recoveryReleaseId = await modules.emergencyControl.getRecoveryReleaseId(
          request.params.impactCaseId,
        );
        await modules.emergencyControl.closeImpactCase({
          impactCaseId: request.params.impactCaseId,
          reason: request.body.reason,
          evidence: request.body.evidence,
          consumerReceiptConfirmed: recoveryReleaseId
            ? await modules.releaseDistribution.hasAppliedReceipt(recoveryReleaseId)
            : false,
        });
      });
      return reply.code(204).send(null);
    },
  );

  typed.post(
    '/v1/phase-01/import-jobs',
    {
      schema: {
        operationId: 'createPhase01ImportJob',
        summary: '冻结UTF-8 CSV或等价JSON导入批次并执行全批次预扫描',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: CreateImportJobBodySchema,
        response: {
          201: ImportJobResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const job = await runtime.transactionRunner.run(context, async (modules) => {
        const permissionCode: ObjectPermissionCode = request.body.importType === 'CHARGE_ITEM'
          ? 'CHARGE_CATALOG_DRAFT_WRITE'
          : 'PRICE_LIST_DRAFT_WRITE';
        const created = await modules.batchImport.createJob(request.body);
        const scopes = request.body.importType === 'PRICE_ENTRY'
          ? new Set(created.rows.map((row) =>
              row.payload['scopeLevel'] === 'CAMPUS' ? payloadNullableText(row.payload, 'campusId') : null,
            ))
          : new Set<string | null>([null]);
        for (const campusId of scopes) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: request.body.governanceObjectId,
            permissionCode,
            campusId,
          });
        }
        await modules.audit.append({
          auditStreamId: request.body.governanceObjectId,
          governanceObjectId: request.body.governanceObjectId,
          entityType: 'IMPORT_JOB',
          stableEntityId: created.importJobId,
          entityVersionId: null,
          action: 'IMPORT_CREATED',
          afterHash: created.normalizedContentDigest,
          authorityScope: 'BATCH_IMPORT',
        });
        return created;
      });
      return reply.code(201).send(toImportJobResponse(job));
    },
  );

  typed.get(
    '/v1/phase-01/import-jobs/:importJobId',
    {
      schema: {
        operationId: 'getPhase01ImportJob',
        summary: '查询导入进度、行级结果和稳定错误',
        security: [{ browserSession: [] }],
        params: Type.Object({ importJobId: UuidSchema }, { additionalProperties: false }),
        response: {
          200: ImportJobResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      return runtime.transactionRunner.run(context, async (modules) => {
        const job = await modules.batchImport.getJob(request.params.importJobId);
        if (!job) throw new Error('IMPORT_JOB_NOT_FOUND');
        await modules.authorization.requireObjectPermission({
          governanceObjectId: job.governanceObjectId,
          permissionCode: job.importType === 'CHARGE_ITEM'
            ? 'CHARGE_CATALOG_DRAFT_READ'
            : 'PRICE_LIST_DRAFT_READ',
        });
        return toImportJobResponse(job);
      });
    },
  );

  typed.post(
    '/v1/phase-01/import-jobs/:importJobId/process-next',
    {
      schema: {
        operationId: 'processNextPhase01ImportRow',
        summary: '在独立行事务边界处理下一待执行导入行',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ importJobId: UuidSchema }, { additionalProperties: false }),
        response: {
          200: ImportJobResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.transactionRunner.run(context, async (modules) => {
        const job = await modules.batchImport.getJob(request.params.importJobId);
        if (!job) throw new Error('IMPORT_JOB_NOT_FOUND');
        const row = await modules.batchImport.lockNextPendingRow(job.importJobId);
        if (!row) return job;
        const campusId = job.importType === 'PRICE_ENTRY' && row.payload['scopeLevel'] === 'CAMPUS'
          ? payloadText(row.payload, 'campusId')
          : null;
        await modules.authorization.requireObjectPermission({
          governanceObjectId: job.governanceObjectId,
          permissionCode: job.importType === 'CHARGE_ITEM'
            ? 'CHARGE_CATALOG_DRAFT_WRITE'
            : 'PRICE_LIST_DRAFT_WRITE',
          campusId,
        });
        const applied = await modules.batchImport.runRowApply(async () => {
          if (job.importType === 'CHARGE_ITEM') {
            const content = chargeItemContentFromImport(row.payload);
            const internalCode = payloadText(row.payload, 'internalCode');
            const existingId = await modules.chargeCatalog.findChargeItemIdByInternalCode({
              governanceObjectId: job.governanceObjectId,
              internalCode,
            });
            const draft = existingId
              ? await modules.chargeCatalog.createVersionDraft({
                  ...content,
                  governanceObjectId: job.governanceObjectId,
                  chargeItemId: existingId,
                  recordedFrom: context.occurredAt,
                  actorPrincipalId: context.actorPrincipalId,
                })
              : await modules.chargeCatalog.createDraft({
                  ...content,
                  governanceObjectId: job.governanceObjectId,
                  internalCode,
                  recordedFrom: context.occurredAt,
                  actorPrincipalId: context.actorPrincipalId,
                });
            return {
              stableEntityId: draft.chargeItemId,
              entityVersionId: draft.chargeItemVersionId,
              resultKind: existingId ? 'VERSION_CANDIDATE' as const : 'NEW_DRAFT' as const,
              evidence: { contentDigest: draft.contentHash.toString('hex') },
            };
          }
          const entry = priceEntryFromImport(row.payload);
          const priceListCode = payloadText(row.payload, 'priceListCode');
          const existingDraft = await modules.priceList.findOpenDraftByCode({
            governanceObjectId: job.governanceObjectId,
            priceListCode,
          });
          const draft = existingDraft
            ? await modules.priceList.appendDraftEntry({
                governanceObjectId: job.governanceObjectId,
                priceListId: existingDraft.priceListId,
                priceListReleaseId: existingDraft.priceListReleaseId,
                entry,
              })
            : await modules.priceList.createDraft({
                governanceObjectId: job.governanceObjectId,
                priceListCode,
                displayName: payloadText(row.payload, 'displayName'),
                currencyCode: payloadText(row.payload, 'currencyCode'),
                businessValidFrom: payloadText(row.payload, 'businessValidFrom'),
                businessValidTo: payloadNullableText(row.payload, 'businessValidTo'),
                recordedFrom: context.occurredAt,
                actorPrincipalId: context.actorPrincipalId,
                entries: [entry],
              });
          return {
            stableEntityId: draft.priceListId,
            entityVersionId: draft.priceListReleaseId,
            resultKind: 'PRICE_ENTRY_APPENDED' as const,
            evidence: {
              contentDigest: draft.contentHash.toString('hex'),
              entryCount: draft.entries.length,
            },
          };
        });
        if (!applied.succeeded) {
          const failed = await modules.batchImport.recordRowFailure({
            importJobId: job.importJobId,
            importRowId: row.importRowId,
            errorCode: stableErrorCode(applied.error),
            retryable: isRetryableImportError(applied.error),
            evidence: { message: applied.error.message },
          });
          await modules.audit.append({
            auditStreamId: job.governanceObjectId,
            governanceObjectId: job.governanceObjectId,
            entityType: 'IMPORT_JOB',
            stableEntityId: job.importJobId,
            entityVersionId: row.importRowId,
            action: 'IMPORT_ROW_FAILED',
            afterHash: null,
            authorityScope: 'BATCH_IMPORT_ROW',
          });
          return failed;
        }
        const succeeded = await modules.batchImport.recordRowSuccess({
          importJobId: job.importJobId,
          importRowId: row.importRowId,
          ...applied.result,
        });
        await modules.audit.append({
          auditStreamId: job.governanceObjectId,
          governanceObjectId: job.governanceObjectId,
          entityType: 'IMPORT_JOB',
          stableEntityId: job.importJobId,
          entityVersionId: row.importRowId,
          action: 'IMPORT_ROW_SUCCEEDED',
          afterHash: null,
          authorityScope: 'BATCH_IMPORT_ROW',
        });
        return succeeded;
      });
      return toImportJobResponse(result);
    },
  );

  typed.post(
    '/v1/phase-01/import-jobs/:importJobId/retry',
    {
      schema: {
        operationId: 'retryPhase01ImportJob',
        summary: '复用冻结输入重试失败行并跳过已成功行',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ importJobId: UuidSchema }, { additionalProperties: false }),
        body: Type.Object({ rawContentDigest: DigestHexSchema }, { additionalProperties: false }),
        response: {
          200: ImportJobResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const job = await runtime.transactionRunner.run(context, async (modules) => {
        const current = await modules.batchImport.getJob(request.params.importJobId);
        if (!current) throw new Error('IMPORT_JOB_NOT_FOUND');
        await modules.authorization.requireObjectPermission({
          governanceObjectId: current.governanceObjectId,
          permissionCode: current.importType === 'CHARGE_ITEM'
            ? 'CHARGE_CATALOG_DRAFT_WRITE'
            : 'PRICE_LIST_DRAFT_WRITE',
        });
        const retried = await modules.batchImport.retryJob({
          importJobId: current.importJobId,
          expectedRawContentDigest: Buffer.from(request.body.rawContentDigest, 'hex'),
        });
        await modules.audit.append({
          auditStreamId: current.governanceObjectId,
          governanceObjectId: current.governanceObjectId,
          entityType: 'IMPORT_JOB',
          stableEntityId: current.importJobId,
          entityVersionId: null,
          action: 'IMPORT_RETRIED',
          afterHash: current.normalizedContentDigest,
          authorityScope: 'BATCH_IMPORT',
        });
        return retried;
      });
      return toImportJobResponse(job);
    },
  );

  typed.post(
    '/v1/phase-01/change-requests',
    {
      schema: {
        operationId: 'submitPhase01ChangeRequest',
        summary: '按冻结审批模板提交领域版本变更',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: ChangeRequestBodySchema,
        response: {
          201: ChangeRequestResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const changeRequest = await runtime.workflowApplication.submit(context, request.body);
      return reply.code(201).send(toChangeRequestResponse(changeRequest));
    },
  );

  typed.get(
    '/v1/phase-01/change-requests/:changeRequestId',
    {
      schema: {
        operationId: 'getPhase01ChangeRequest',
        summary: '查询冻结模板、当前阶段和只追加审批历史',
        security: [{ browserSession: [] }],
        params: Type.Object({ changeRequestId: UuidSchema }, { additionalProperties: false }),
        response: {
          200: Type.Object(
            {
              request: ChangeRequestResponseSchema,
              actions: Type.Array(Type.Object({
                approvalActionId: UuidSchema,
                actionSequence: Type.String(),
                stageType: Type.String(),
                actorPrincipalId: UuidSchema,
                actionResult: Type.String(),
                reason: Type.String(),
                occurredAt: LocalDateTimeSchema,
              }, { additionalProperties: false })),
            },
            { additionalProperties: false },
          ),
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.workflowApplication.get(
        context,
        request.params.changeRequestId,
      );
      return {
        request: toChangeRequestResponse(result.request),
        actions: [...result.actions],
      };
    },
  );

  typed.post(
    '/v1/phase-01/change-requests/:changeRequestId/actions',
    {
      schema: {
        operationId: 'actOnPhase01ChangeRequest',
        summary: '按冻结顺序执行前置确认、复核或终审并在终审后原子发布',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ changeRequestId: UuidSchema }, { additionalProperties: false }),
        body: ChangeRequestActionBodySchema,
        response: {
          200: ChangeRequestResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.workflowApplication.act(context, {
        changeRequestId: request.params.changeRequestId,
        ...request.body,
      });
      return toChangeRequestResponse(result.request);
    },
  );

  typed.post(
    '/v1/phase-01/change-requests/:changeRequestId/withdrawal',
    {
      schema: {
        operationId: 'withdrawPhase01ChangeRequest',
        summary: '由提交人撤回未终结的变更请求并保留历史',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: Type.Object({ changeRequestId: UuidSchema }, { additionalProperties: false }),
        body: Type.Object({ reason: Type.String({ minLength: 1, maxLength: 1000 }) }, { additionalProperties: false }),
        response: {
          200: ChangeRequestResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.workflowApplication.withdraw(context, {
        changeRequestId: request.params.changeRequestId,
        reason: request.body.reason,
      });
      return toChangeRequestResponse(result);
    },
  );

  typed.post(
    '/v1/phase-01/price-resolutions',
    {
      schema: {
        operationId: 'resolvePhase01Price',
        summary: '按服务发生时点执行 Phase 01 价格解析',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: ResolvePriceBodySchema,
        response: {
          200: ResolutionResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const result = await runtime.verticalSlice.resolvePrice(context, request.body);
      return {
        priceResolutionId: result.priceResolutionId,
        requestId: result.requestId,
        status: result.status,
        priceListReleaseId: result.priceListReleaseId,
        finalAmount: result.result?.finalAmount ?? null,
        currencyCode: result.result?.currencyCode ?? null,
        resultDigest: result.result?.resultHash.toString('hex') ?? null,
        steps: result.steps.map(({ candidateSetHash, ...step }) => ({
          ...step,
          candidateSetDigest: candidateSetHash.toString('hex'),
        })),
      };
    },
  );

  typed.post(
    '/v1/phase-01/consumer-subscriptions',
    {
      schema: {
        operationId: 'createPhase01ConsumerSubscription',
        summary: '建立精确投影契约的仿真消费者订阅',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: CreateSubscriptionBodySchema,
        response: {
          201: Type.Object({ subscriptionId: UuidSchema }, { additionalProperties: false }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const subscription = await runtime.transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: request.body.governanceObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.createSubscription(request.body);
      });
      return reply.code(201).send(subscription);
    },
  );

  typed.post(
    '/v1/phase-01/consumer-subscriptions/:subscriptionId/lifecycle-transitions',
    {
      schema: {
        operationId: 'changePhase01ConsumerSubscriptionLifecycle',
        summary: '暂停、恢复、撤销或归档消费者订阅',
        description: '同状态请求幂等，不重复写入生命周期或审计事件。原因仅允许1至256个字符的单行纯文本，不得包含凭据、密钥或患者数据。',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: SubscriptionParamsSchema,
        body: ChangeSubscriptionLifecycleBodySchema,
        response: { 200: SubscriptionLifecycleResponseSchema, 400: ErrorResponseSchema,
          401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema,
          409: ErrorResponseSchema, 503: ErrorResponseSchema },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      return runtime.transactionRunner.run(context, (modules) =>
        modules.releaseDistribution.changeSubscriptionLifecycle({
          subscriptionId: request.params.subscriptionId, ...request.body,
        }));
    },
  );

  typed.post(
    '/v1/phase-01/consumer-subscriptions/:subscriptionId/versions',
    {
      schema: {
        operationId: 'createPhase01ConsumerSubscriptionVersion',
        summary: '以不可变新版本更新消费者精确投影支持声明',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: SubscriptionParamsSchema,
        body: CreateSubscriptionVersionBodySchema,
        response: {
          201: SubscriptionVersionResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const version = await runtime.transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: request.body.governanceObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.createSubscriptionVersion({
          subscriptionId: request.params.subscriptionId,
          ...request.body,
        });
      });
      return reply.code(201).send(version);
    },
  );

  typed.post('/v1/phase-01/consumer-subscriptions/:subscriptionId/audit-reports', {
    schema: { operationId: 'reportPhase01ConsumerReleaseAudit', summary: 'Append consumer-reported evidence without changing receipts or checkpoints',
      security: [{ serviceBearer: [] }], headers: ServiceHeadersSchema, params: SubscriptionParamsSchema,
      body: ConsumerAuditReportSchema, response: { 201: ConsumerAuditAcknowledgementSchema,
        400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema,
        409: ErrorResponseSchema, 503: ErrorResponseSchema } },
  }, async (request, reply) => {
    const runtime = requireRuntime(dependencies);
    const context = await createRequestContext(request, runtime, 'SERVICE');
    const result = await runtime.transactionRunner.run(context, modules =>
      modules.releaseDistribution.reportConsumerAudit(request.params.subscriptionId, request.body));
    return reply.code(201).send(result);
  });
  typed.get('/v1/phase-01/consumer-subscriptions/:subscriptionId/audit-events', {
    schema: { operationId: 'queryPhase01ConsumerReleaseAudit', summary: 'Consumer support evidence: own subscription, sequence pages of at most 100, time ranges of at most 31 days',
      security: [{ serviceBearer: [] }], headers: ServiceHeadersSchema, params: SubscriptionParamsSchema,
      querystring: ConsumerAuditQuerySchema, response: { 200: ConsumerAuditPageSchema,
        400: ErrorResponseSchema, 401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema } },
  }, async request => {
    const runtime = requireRuntime(dependencies);
    const context = await createRequestContext(request, runtime, 'SERVICE');
    return runtime.transactionRunner.run(context, modules =>
      modules.releaseDistribution.queryConsumerAudit({ ...request.params, ...request.query }));
  });

  typed.get('/v1/phase-01/consumer-subscriptions/:subscriptionId/operational-status', {
    schema: {
      operationId: 'getPhase01ConsumerOperationalStatus',
      summary: '读取当前消费事实与不可变订阅版本的运营SLA状态',
      description: '仅本订阅的有效服务主体可读。省略版本时选择最新版本；指定历史版本只改变评估策略，不表示历史时点查询。时间展示为Asia/Shanghai，时限按绝对时刻计算。',
      security: [{ serviceBearer: [] }], headers: ServiceHeadersSchema,
      params: SubscriptionParamsSchema, querystring: ConsumerOperationalQuerySchema,
      response: { 200: ConsumerOperationalResponseSchema, 400: ErrorResponseSchema,
        401: ErrorResponseSchema, 403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema },
    },
  }, async (request) => {
    const runtime = requireRuntime(dependencies);
    const context = await createRequestContext(request, runtime, 'SERVICE');
    return runtime.transactionRunner.run(context, (modules) => modules.releaseDistribution.getConsumerOperationalStatus({
      subscriptionId: request.params.subscriptionId, ...request.query,
    }));
  });

  typed.get('/v1/phase-01/consumer-subscriptions/:subscriptionId/releases/:releaseId/replay-context', {
    schema: { operationId: 'getPhase01ConsumerReplayContext',
      summary: '只读解析精确历史发布、冻结订阅版本和回执；不追加投递尝试',
      security: [{ serviceBearer: [] }], headers: ServiceHeadersSchema, params: ReplayContextParamsSchema,
      response: { 200: ReplayContextResponseSchema, 400: ErrorResponseSchema, 401: ErrorResponseSchema,
        403: ErrorResponseSchema, 404: ErrorResponseSchema, 503: ErrorResponseSchema } },
  }, async (request) => {
    const runtime = requireRuntime(dependencies);
    const context = await createRequestContext(request, runtime, 'SERVICE');
    return runtime.transactionRunner.run(context, (modules) => modules.releaseDistribution.getConsumerReplayContext(request.params));
  });

  typed.post(
    '/v1/phase-01/consumer-subscriptions/:subscriptionId/replays',
    {
      schema: {
        operationId: 'replayPhase01BlockedConsumerDelivery',
        summary: '在新支持版本生效后受控恢复原事件与原快照投递',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        params: SubscriptionParamsSchema,
        body: ReplayBlockedDeliveryBodySchema,
        response: {
          201: ReplayBlockedDeliveryResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'PERSON');
      const replay = await runtime.transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: request.body.governanceObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.replayBlockedDelivery({
          subscriptionId: request.params.subscriptionId,
          ...request.body,
        });
      });
      return reply.code(201).send(replay);
    },
  );

  typed.get(
    '/v1/phase-01/consumer-subscriptions/:subscriptionId/events',
    {
      schema: {
        operationId: 'listPhase01ConsumerEvents',
        summary: '按对象内版本顺序查询可消费发布事件',
        security: [{ serviceBearer: [] }],
        headers: ServiceHeadersSchema,
        params: SubscriptionParamsSchema,
        querystring: EventQuerySchema,
        response: {
          200: AvailableEventsResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'SERVICE');
      const events = await runtime.transactionRunner.run(context, (modules) =>
        modules.releaseDistribution.listAvailableEvents({
          subscriptionId: request.params.subscriptionId,
          servicePrincipalId: context.actorPrincipalId,
          afterAggregateVersion: request.query.afterAggregateVersion ?? '0',
        }),
      );
      return {
        events: events.map((event) => ({
          ...event,
          projectionPayloadDigest: event.projectionPayloadDigest.toString('hex'),
          projectionSchemaDigest: event.projectionSchemaDigest.toString('hex'),
          snapshotArtifactDigest: event.snapshotArtifactDigest.toString('hex'),
        })),
      };
    },
  );

  typed.get(
    '/v1/phase-01/consumer-subscriptions/:subscriptionId/snapshots/:snapshotId/content',
    {
      schema: {
        operationId: 'downloadPhase01CanonicalSnapshot',
        summary: '下载完整且不可分段的规范快照字节',
        description: '正式第三方消费入口。返回完整、未压缩、不可分段的规范制品；16,777,216字节仅是合成Phase 01 POC护栏，不代表全院初始化、生产容量、SLA或采购上限。',
        security: [{ serviceBearer: [] }],
        headers: ServiceHeadersSchema,
        produces: ['application/vnd.hdi.canonical-snapshot+json'],
        params: SnapshotParamsSchema,
        querystring: Type.Object({ replayReleaseId: Type.Optional(UuidSchema) }, { additionalProperties: false }),
        response: {
          200: SnapshotBinarySchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'SERVICE');
      const snapshot = await runtime.transactionRunner.run(context, (modules) =>
        modules.releaseDistribution.getSnapshotForSubscription({
          subscriptionId: request.params.subscriptionId,
          snapshotId: request.params.snapshotId,
          ...request.query,
          servicePrincipalId: context.actorPrincipalId,
        }),
      );
      return reply
        .type(snapshot.mediaType)
        .header('content-length', snapshot.byteLength)
        .header('digest', `sha-256=:${snapshot.digest.toString('base64')}:`)
        .header('x-snapshot-id', snapshot.snapshotId)
        .send(snapshot.bytes);
    },
  );

  typed.post(
    '/v1/phase-01/consumer-subscriptions/:subscriptionId/receipts',
    {
      schema: {
        operationId: 'recordPhase01ConsumerReceipt',
        summary: '记录仿真消费者校验应用回执并推进检查点',
        security: [{ serviceBearer: [] }],
        headers: ServiceHeadersSchema,
        params: SubscriptionParamsSchema,
        body: ReceiptBodySchema,
        response: {
          201: ReceiptResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          409: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const runtime = requireRuntime(dependencies);
      const context = await createRequestContext(request, runtime, 'SERVICE');
      const receipt = await (async () => {
        try {
        return await runtime.transactionRunner.run(context, (modules) =>
        modules.releaseDistribution.recordReceipt({
          subscriptionId: request.params.subscriptionId,
          servicePrincipalId: context.actorPrincipalId,
          eventId: request.body.eventId,
          receiveResult: request.body.receiveResult,
          validationResult: request.body.validationResult,
          applyResult: request.body.applyResult,
          processingDigest: Buffer.from(request.body.processingDigest, 'hex'),
          processedAt: request.body.processedAt,
          ...(request.body.replay ? { replay: request.body.replay } : {}),
        }),
      );
        } catch (error) {
          // Rejection evidence commits only after the business transaction has rolled back.
          if (error instanceof Error && error.message === 'CONSUMER_AUDIT_UNAVAILABLE') throw error;
          try {
            await runtime.transactionRunner.run(context, modules => modules.releaseDistribution.recordConsumerReceiptRejection({
              subscriptionId: request.params.subscriptionId, eventId: request.body.eventId,
              failureCode: consumerFailureCode(error), ...(request.body.replay ? { replay: request.body.replay } : {}),
            }));
          } catch (auditError) {
            if (!(auditError instanceof Error && auditError.message === 'CONSUMER_SUBSCRIPTION_NOT_FOUND')) {
              throw new Error('CONSUMER_AUDIT_UNAVAILABLE');
            }
          }
          throw error;
        }
      })();
      return reply.code(201).send(receipt);
    },
  );
}

function requireRuntime(
  dependencies: Phase01HttpDependencies | undefined,
): Phase01HttpDependencies {
  if (!dependencies) throw new Error('PHASE_01_RUNTIME_NOT_CONFIGURED');
  return dependencies;
}

export type ResolvePriceBody = Static<typeof ResolvePriceBodySchema>;

function toChargeItemVersionResponse(version: Awaited<ReturnType<Phase01VerticalSlice['getChargeItemVersion']>>) {
  const { contentHash, ...response } = version;
  return {
    ...response,
    contentDigest: contentHash.toString('hex'),
  };
}

function toPriceListReleaseResponse(
  release: Awaited<ReturnType<Phase01VerticalSlice['getPriceListRelease']>>,
) {
  const { contentHash, ...response } = release;
  return {
    ...response,
    contentDigest: contentHash.toString('hex'),
  };
}

function toChangeRequestResponse(request: ChangeRequestView) {
  return {
    changeRequestId: request.changeRequestId,
    governanceObjectId: request.governanceObjectId,
    stableEntityId: request.stableEntityId,
    entityVersionId: request.entityVersionId,
    changeKind: request.changeKind,
    riskClassification: request.riskClassification,
    approvalTemplateVersionId: request.approvalTemplateVersionId,
    submittedContentDigest: request.submittedContentHash.toString('hex'),
    submittedBy: request.submittedBy,
    requestStatus: request.requestStatus,
    requiredStageCount: request.requiredStageCount,
    nextActionSequence: request.nextActionSequence,
  };
}

function toImportJobResponse(job: ImportJobView) {
  return {
    importJobId: job.importJobId,
    governanceObjectId: job.governanceObjectId,
    importType: job.importType,
    sourceKind: job.sourceKind,
    schemaVersion: job.schemaVersion,
    rawContentDigest: job.rawContentDigest.toString('hex'),
    normalizedContentDigest: job.normalizedContentDigest.toString('hex'),
    jobStatus: job.jobStatus,
    rowCount: job.rowCount,
    succeededCount: job.succeededCount,
    failedCount: job.failedCount,
    rows: job.rows.map((row) => ({
      importRowId: row.importRowId,
      rowNo: row.rowNo,
      sourceRowId: row.sourceRowId,
      businessKey: row.businessKey,
      rowStatus: row.rowStatus,
      retryable: row.retryable,
      stableEntityId: row.stableEntityId,
      entityVersionId: row.entityVersionId,
      resultKind: row.resultKind,
      currentErrorCode: row.currentErrorCode,
    })),
  };
}

function payloadText(payload: Readonly<Record<string, unknown>>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`IMPORT_REQUIRED_FIELD:${field}`);
  }
  return value;
}

function payloadNullableText(
  payload: Readonly<Record<string, unknown>>,
  field: string,
): string | null {
  const value = payload[field];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`IMPORT_FIELD_TYPE:${field}`);
  return value;
}

function chargeItemContentFromImport(payload: Readonly<Record<string, unknown>>) {
  return {
    formalName: payloadText(payload, 'formalName'),
    serviceDefinition: payloadText(payload, 'serviceDefinition'),
    billingUnitCode: payloadText(payload, 'billingUnitCode'),
    chargingMethodCode: payloadText(payload, 'chargingMethodCode'),
    businessValidFrom: payloadText(payload, 'businessValidFrom'),
    businessValidTo: payloadNullableText(payload, 'businessValidTo'),
  };
}

function priceEntryFromImport(payload: Readonly<Record<string, unknown>>): PriceEntryInput {
  const scopeLevel = payloadText(payload, 'scopeLevel');
  const encounterMode = payloadText(payload, 'encounterMode');
  const encounterType = payloadNullableText(payload, 'encounterType');
  if (scopeLevel !== 'HOSPITAL' && scopeLevel !== 'CAMPUS') {
    throw new Error('PRICE_ENTRY_SCOPE_INVALID');
  }
  if (encounterMode !== 'GENERAL' && encounterMode !== 'SPECIFIC') {
    throw new Error('PRICE_ENTRY_ENCOUNTER_MODE_INVALID');
  }
  if (
    encounterType !== null &&
    !['OUTPATIENT', 'INPATIENT', 'EMERGENCY', 'CHECKUP'].includes(encounterType)
  ) {
    throw new Error('PRICE_ENTRY_ENCOUNTER_TYPE_INVALID');
  }
  return {
    chargeItemId: payloadText(payload, 'chargeItemId'),
    chargeItemVersionId: payloadText(payload, 'chargeItemVersionId'),
    scopeLevel,
    campusId: payloadNullableText(payload, 'campusId'),
    encounterMode,
    encounterType: encounterType as 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CHECKUP' | null,
    fixedUnitPrice: payloadText(payload, 'fixedUnitPrice'),
    billingUnitCode: payloadText(payload, 'billingUnitCode'),
    businessValidFrom: payloadText(payload, 'businessValidFrom'),
    businessValidTo: payloadNullableText(payload, 'businessValidTo'),
    zeroPriceReason: payloadNullableText(payload, 'zeroPriceReason'),
  };
}

function stableErrorCode(error: Error): string {
  const code = (error as Error & { readonly code?: unknown }).code;
  if (typeof code === 'string' && /^\d{5}$/u.test(code)) return `DATABASE_${code}`;
  return /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_-]+)?$/u.test(error.message)
    ? error.message
    : 'IMPORT_ROW_APPLY_FAILED';
}

function isRetryableImportError(error: Error): boolean {
  return [
    'CHARGE_ITEM_PUBLISHED_REFERENCE_NOT_FOUND',
    'CHARGE_ITEM_REFERENCE_MISSING',
    'PRICE_LIST_CURRENT_RELEASE_CLOSE_CONFLICT',
    'IMPORT_ROW_APPLY_FAILED',
  ].includes(stableErrorCode(error));
}
