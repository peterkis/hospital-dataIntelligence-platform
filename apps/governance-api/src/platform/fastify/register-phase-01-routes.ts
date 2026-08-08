import { randomUUID } from 'node:crypto';
import {
  Type,
  type TypeBoxTypeProvider,
} from '@fastify/type-provider-typebox';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Static } from 'typebox';
import type { TransactionRunner } from '../transaction/transaction-runner.js';
import {
  LOCAL_DATE_TIME_JSON_PATTERN,
  parseLocalDateTime,
} from '../local-datetime/local-datetime.js';
import type { ScopedModules } from '../../composition/create-scoped-modules.js';
import type { Phase01VerticalSlice } from '../../composition/phase-01-vertical-slice.js';
import {
  CHARGE_CATALOG_PROJECTION_SCHEMA_ID,
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
} from '../../modules/charge-catalog/index.js';
import {
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_ID,
  PRICE_LIST_PROJECTION_SCHEMA_ID,
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_TYPE,
} from '../../modules/price-list/index.js';

const UuidSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const LocalDateTimeSchema = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
const DigestHexSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });
const PositiveSequenceSchema = Type.String({ pattern: '^(?:0|[1-9]\\d*)$' });
const BrowserMutationHeadersSchema = Type.Object({
  'x-csrf-token': Type.String({ minLength: 32 }),
});
const ServiceHeadersSchema = Type.Object({
  authorization: Type.String({ pattern: '^Bearer .+$' }),
});

const PublishChargeItemBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    catalogCode: Type.String({ minLength: 1, maxLength: 128 }),
    internalCode: Type.String({ minLength: 1, maxLength: 64 }),
    formalName: Type.String({ minLength: 1, maxLength: 256 }),
    serviceDefinition: Type.String({ minLength: 1, maxLength: 2000 }),
    billingUnitCode: Type.String({ minLength: 1, maxLength: 64 }),
    chargingMethodCode: Type.String({ minLength: 1, maxLength: 32 }),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    changeReason: Type.String({ minLength: 1, maxLength: 1000 }),
  },
  { additionalProperties: false },
);

const PublicationResponseSchema = Type.Object(
  {
    stableId: UuidSchema,
    versionId: UuidSchema,
    releaseId: UuidSchema,
    snapshotId: UuidSchema,
    eventId: UuidSchema,
  },
  { additionalProperties: false },
);

const EncounterTypeSchema = Type.Union([
  Type.Literal('OUTPATIENT'),
  Type.Literal('INPATIENT'),
  Type.Literal('EMERGENCY'),
  Type.Literal('CHECKUP'),
]);

const PublishPriceListBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    priceListCode: Type.String({ minLength: 1, maxLength: 64 }),
    displayName: Type.String({ minLength: 1, maxLength: 256 }),
    currencyCode: Type.String({ pattern: '^[A-Z]{3}$' }),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    changeReason: Type.String({ minLength: 1, maxLength: 1000 }),
    entries: Type.Array(
      Type.Object(
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
      ),
      { minItems: 1 },
    ),
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
  },
  { additionalProperties: false },
);

const PriceListProjectionSchemaVersionSchema = Type.Union([
  Type.Literal(PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION),
  Type.Literal(PRICE_LIST_PROJECTION_SCHEMA_VERSION),
]);

const CreateSubscriptionBodySchema = Type.Object(
  {
    subscriptionCode: Type.String({ minLength: 1, maxLength: 128 }),
    servicePrincipalId: UuidSchema,
    governanceObjectId: UuidSchema,
    projectionType: Type.Literal(PRICE_LIST_PROJECTION_TYPE),
    projectionSchemaVersion: PriceListProjectionSchemaVersionSchema,
  },
  { additionalProperties: false },
);

const CreateSubscriptionVersionBodySchema = Type.Object(
  {
    governanceObjectId: UuidSchema,
    projectionType: Type.Literal(PRICE_LIST_PROJECTION_TYPE),
    projectionSchemaVersion: PriceListProjectionSchemaVersionSchema,
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
  },
  { additionalProperties: false },
);

const ReceiptResponseSchema = Type.Object(
  { receiptId: UuidSchema, receiptSequence: Type.String({ pattern: '^[1-9]\\d*$' }) },
  { additionalProperties: false },
);

function createSnapshotEnvelopeSchema(
  aggregateType: 'CHARGE_CATALOG' | 'PRICE_LIST',
  projectionSchemaVersion: '0' | '1',
  payloadSchemaId: string,
) {
  return Type.Object(
    {
      envelopeContractVersion: Type.Literal('phase-01.v1'),
      release: Type.Object(
        {
          aggregateType: Type.Literal(aggregateType),
          governanceObjectId: UuidSchema,
          releaseId: UuidSchema,
          releaseNo: Type.String({ pattern: '^[1-9]\\d*$' }),
          businessValidFrom: LocalDateTimeSchema,
          businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
        },
        { additionalProperties: false },
      ),
      projectionContract: Type.Object(
        {
          projectionType: Type.String({ minLength: 1, maxLength: 128 }),
          schemaVersion: Type.Literal(projectionSchemaVersion),
          schemaDigestAlgorithm: Type.Literal('SHA-256'),
          schemaDigest: DigestHexSchema,
        },
        { additionalProperties: false },
      ),
      serializationProfileVersion: Type.Literal('canonical-json.v1'),
      payload: Type.Ref(payloadSchemaId),
    },
    { additionalProperties: false },
  );
}

const SnapshotEnvelopeSchema = Type.Union([
  createSnapshotEnvelopeSchema(
    'CHARGE_CATALOG',
    CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
    CHARGE_CATALOG_PROJECTION_SCHEMA_ID,
  ),
  createSnapshotEnvelopeSchema(
    'PRICE_LIST',
    PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
    PRICE_LIST_LEGACY_PROJECTION_SCHEMA_ID,
  ),
  createSnapshotEnvelopeSchema(
    'PRICE_LIST',
    PRICE_LIST_PROJECTION_SCHEMA_VERSION,
    PRICE_LIST_PROJECTION_SCHEMA_ID,
  ),
]);

const SnapshotBinarySchema = Type.Unsafe<Buffer>({
  ...SnapshotEnvelopeSchema,
  contentMediaType: 'application/vnd.hdi.canonical-snapshot+json',
});

const ErrorResponseSchema = Type.Object(
  {
    code: Type.String(),
    requestId: Type.String(),
  },
  { additionalProperties: false },
);

export interface ResolvedPrincipal {
  readonly principalId: string;
  readonly principalKind: 'PERSON' | 'SERVICE';
}

export interface Phase01HttpDependencies {
  readonly verticalSlice: Phase01VerticalSlice;
  readonly transactionRunner: TransactionRunner<ScopedModules>;
  resolvePrincipal(request: FastifyRequest): Promise<ResolvedPrincipal>;
  now(): string;
}

export async function registerPhase01Routes(
  application: FastifyInstance,
  dependencies?: Phase01HttpDependencies,
): Promise<void> {
  const typed = application.withTypeProvider<TypeBoxTypeProvider>();

  typed.post(
    '/v1/phase-01/charge-item-publications',
    {
      schema: {
        operationId: 'publishPhase01ChargeItem',
        summary: '发布 Phase 01 收费项目版本和规范快照',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: PublishChargeItemBodySchema,
        response: {
          201: PublicationResponseSchema,
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
      const result = await runtime.verticalSlice.publishChargeItem(context, request.body);
      return reply.code(201).send({
        stableId: result.chargeItemId,
        versionId: result.chargeItemVersionId,
        releaseId: result.releaseId,
        snapshotId: result.snapshotId,
        eventId: result.eventId,
      });
    },
  );

  typed.post(
    '/v1/phase-01/price-list-publications',
    {
      schema: {
        operationId: 'publishPhase01PriceList',
        summary: '发布 Phase 01 完整价表版本和规范快照',
        security: [{ browserSession: [] }],
        headers: BrowserMutationHeadersSchema,
        body: PublishPriceListBodySchema,
        response: {
          201: PublicationResponseSchema,
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
      const result = await runtime.verticalSlice.publishPriceList(context, request.body);
      return reply.code(201).send({
        stableId: result.priceListId,
        versionId: result.priceListReleaseId,
        releaseId: result.releaseId,
        snapshotId: result.snapshotId,
        eventId: result.eventId,
      });
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
        security: [{ serviceBearer: [] }],
        headers: ServiceHeadersSchema,
        produces: ['application/vnd.hdi.canonical-snapshot+json'],
        params: SnapshotParamsSchema,
        response: {
          200: SnapshotBinarySchema,
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
      const receipt = await runtime.transactionRunner.run(context, (modules) =>
        modules.releaseDistribution.recordReceipt({
          subscriptionId: request.params.subscriptionId,
          servicePrincipalId: context.actorPrincipalId,
          eventId: request.body.eventId,
          receiveResult: request.body.receiveResult,
          validationResult: request.body.validationResult,
          applyResult: request.body.applyResult,
          processingDigest: Buffer.from(request.body.processingDigest, 'hex'),
          processedAt: request.body.processedAt,
        }),
      );
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

async function createRequestContext(
  request: FastifyRequest,
  dependencies: Phase01HttpDependencies,
  requiredKind: 'PERSON' | 'SERVICE',
) {
  const principal = await dependencies.resolvePrincipal(request);
  if (principal.principalKind !== requiredKind) throw new Error('PRINCIPAL_KIND_FORBIDDEN');
  const occurredAt = parseLocalDateTime(dependencies.now());
  const requestId = headerValue(request, 'x-request-id') ?? request.id ?? randomUUID();
  return {
    actorPrincipalId: principal.principalId,
    requestId,
    correlationId: headerValue(request, 'x-correlation-id') ?? requestId,
    occurredAt,
  };
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export type PublishChargeItemBody = Static<typeof PublishChargeItemBodySchema>;
export type PublishPriceListBody = Static<typeof PublishPriceListBodySchema>;
export type ResolvePriceBody = Static<typeof ResolvePriceBodySchema>;
