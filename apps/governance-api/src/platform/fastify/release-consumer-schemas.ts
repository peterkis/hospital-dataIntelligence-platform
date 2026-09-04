import { Type, type TProperties, type TSchema } from 'typebox';
import { LOCAL_DATE_TIME_JSON_PATTERN } from '../local-datetime/local-datetime.js';
import {
  CHARGE_CATALOG_PROJECTION_TYPE,
  CHARGE_CATALOG_PROJECTION_SCHEMA_ID,
  CHARGE_CATALOG_PROJECTION_SCHEMA_ID_V2,
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2,
} from '../../modules/charge-catalog/index.js';
import {
  PRICE_LIST_PROJECTION_TYPE,
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_ID,
  PRICE_LIST_PROJECTION_SCHEMA_ID,
  PRICE_LIST_PROJECTION_SCHEMA_ID_V2,
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2,
} from '../../modules/price-list/index.js';
import {
  DEPARTMENT_MASTER_PROJECTION_TYPE,
  DEPARTMENT_HIERARCHY_PROJECTION_TYPE,
  DEPARTMENT_PROJECTION_SCHEMA_VERSION,
  DepartmentMasterProjectionSchema,
  DepartmentHierarchyProjectionSchema,
} from '../../modules/department-master/index.js';

const Uuid = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const LocalDateTime = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
const Digest = Type.String({ pattern: '^[0-9a-f]{64}$' });

// Flatten each closed object so both runtime validation and generated TypeScript
// preserve the projection type/version relationship.
function consumerProjectionSupport<Properties extends TProperties>(properties: Properties) {
  return Type.Union([
    Type.Object({
      ...properties,
      projectionType: Type.Literal(PRICE_LIST_PROJECTION_TYPE),
      projectionSchemaVersion: Type.Union([
        Type.Literal(PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION),
        Type.Literal(PRICE_LIST_PROJECTION_SCHEMA_VERSION),
        Type.Literal(PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2),
      ]),
    }, { additionalProperties: false }),
    Type.Object({
      ...properties,
      projectionType: Type.Literal(DEPARTMENT_MASTER_PROJECTION_TYPE),
      projectionSchemaVersion: Type.Literal(DEPARTMENT_PROJECTION_SCHEMA_VERSION),
    }, { additionalProperties: false }),
    Type.Object({
      ...properties,
      projectionType: Type.Literal(DEPARTMENT_HIERARCHY_PROJECTION_TYPE),
      projectionSchemaVersion: Type.Literal(DEPARTMENT_PROJECTION_SCHEMA_VERSION),
    }, { additionalProperties: false }),
  ]);
}

export const ConsumerProjectionSupportSchema = consumerProjectionSupport({});
export const CreateSubscriptionBodySchema = consumerProjectionSupport({
  subscriptionCode: Type.String({ minLength: 1, maxLength: 128 }),
  servicePrincipalId: Uuid,
  governanceObjectId: Uuid,
});
export const CreateSubscriptionVersionBodySchema = consumerProjectionSupport({
  governanceObjectId: Uuid,
});

function snapshotEnvelope(
  aggregateType: string,
  projectionType: string,
  projectionSchemaVersion: string,
  payload: TSchema,
) {
  return Type.Object({
    envelopeContractVersion: Type.Literal('phase-01.v1'),
    release: Type.Object({
      aggregateType: Type.Literal(aggregateType),
      governanceObjectId: Uuid,
      releaseId: Uuid,
      releaseNo: Type.String({ pattern: '^[1-9]\\d*$' }),
      releaseKind: Type.Union([
        Type.Literal('NORMAL'),
        Type.Literal('COMPENSATION'),
        Type.Literal('HISTORICAL_REPUBLICATION'),
        Type.Literal('CONTRACT_SCHEMA_UPGRADE'),
      ]),
      businessValidFrom: LocalDateTime,
      businessValidTo: Type.Union([LocalDateTime, Type.Null()]),
    }, { additionalProperties: false }),
    projectionContract: Type.Object({
      projectionType: Type.Literal(projectionType),
      schemaVersion: Type.Literal(projectionSchemaVersion),
      schemaDigestAlgorithm: Type.Literal('SHA-256'),
      schemaDigest: Digest,
    }, { additionalProperties: false }),
    serializationProfileVersion: Type.Literal('canonical-json.v1'),
    payload,
  }, { additionalProperties: false });
}

export const SnapshotEnvelopeSchema = Type.Union([
  snapshotEnvelope('CHARGE_CATALOG', CHARGE_CATALOG_PROJECTION_TYPE,
    CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION, Type.Ref(CHARGE_CATALOG_PROJECTION_SCHEMA_ID)),
  snapshotEnvelope('CHARGE_CATALOG', CHARGE_CATALOG_PROJECTION_TYPE,
    CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2, Type.Ref(CHARGE_CATALOG_PROJECTION_SCHEMA_ID_V2)),
  snapshotEnvelope('PRICE_LIST', PRICE_LIST_PROJECTION_TYPE,
    PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION, Type.Ref(PRICE_LIST_LEGACY_PROJECTION_SCHEMA_ID)),
  snapshotEnvelope('PRICE_LIST', PRICE_LIST_PROJECTION_TYPE,
    PRICE_LIST_PROJECTION_SCHEMA_VERSION, Type.Ref(PRICE_LIST_PROJECTION_SCHEMA_ID)),
  snapshotEnvelope('PRICE_LIST', PRICE_LIST_PROJECTION_TYPE,
    PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2, Type.Ref(PRICE_LIST_PROJECTION_SCHEMA_ID_V2)),
  // Inline the canonical schemas. OpenAPI metadata must never alter their digest.
  snapshotEnvelope('DEPARTMENT_MASTER', DEPARTMENT_MASTER_PROJECTION_TYPE,
    DEPARTMENT_PROJECTION_SCHEMA_VERSION, DepartmentMasterProjectionSchema),
  snapshotEnvelope('DEPARTMENT_HIERARCHY', DEPARTMENT_HIERARCHY_PROJECTION_TYPE,
    DEPARTMENT_PROJECTION_SCHEMA_VERSION, DepartmentHierarchyProjectionSchema),
]);

export const SnapshotBinarySchema = Type.Unsafe<Buffer>({
  ...SnapshotEnvelopeSchema,
  contentMediaType: 'application/vnd.hdi.canonical-snapshot+json',
});
