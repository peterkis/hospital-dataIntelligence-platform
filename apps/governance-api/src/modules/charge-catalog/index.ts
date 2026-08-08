import type { Kysely } from 'kysely';
import { Type, type Static } from 'typebox';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import { LOCAL_DATE_TIME_JSON_PATTERN } from '../../platform/local-datetime/local-datetime.js';

export const CHARGE_CATALOG_MODULE_ID = 'charge-catalog' as const;
export const CHARGE_CATALOG_PROJECTION_TYPE = 'hdi.charge-catalog' as const;
export const CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION = '1' as const;
export const CHARGE_CATALOG_PROJECTION_SCHEMA_ID = 'ChargeCatalogProjectionV1' as const;

const UuidSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const LocalDateTimeSchema = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });

export const ChargeCatalogProjectionSchema = Type.Object(
  {
    catalogCode: Type.String({ minLength: 1, maxLength: 128 }),
    items: Type.Array(
      Type.Object(
        {
          chargeItemId: UuidSchema,
          chargeItemVersionId: UuidSchema,
          versionNo: Type.String({ pattern: '^[1-9]\\d*$' }),
          internalCode: Type.String({ minLength: 1, maxLength: 64 }),
          formalName: Type.String({ minLength: 1, maxLength: 256 }),
          serviceDefinition: Type.String({ minLength: 1, maxLength: 2000 }),
          billingUnitCode: Type.String({ minLength: 1, maxLength: 64 }),
          chargingMethodCode: Type.String({ minLength: 1, maxLength: 32 }),
          businessStatus: Type.Literal('ACTIVE'),
          businessValidFrom: LocalDateTimeSchema,
          businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
          recordedFrom: LocalDateTimeSchema,
          contentHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  {
    $id: CHARGE_CATALOG_PROJECTION_SCHEMA_ID,
    additionalProperties: false,
  },
);

export type ChargeCatalogProjection = Static<typeof ChargeCatalogProjectionSchema>;

export interface PreparedChargeItemPublication {
  readonly governanceObjectId: string;
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly contentHash: Buffer;
  readonly projection: ChargeCatalogProjection;
}

export interface PublishedChargeItemReference {
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly versionNo: string;
  readonly internalCode: string;
  readonly formalName: string;
  readonly billingUnitCode: string;
  readonly contentHash: Buffer;
}

export interface ChargeCatalogModule {
  prepareInitialPublication(command: {
    readonly governanceObjectId: string;
    readonly catalogCode: string;
    readonly internalCode: string;
    readonly formalName: string;
    readonly serviceDefinition: string;
    readonly billingUnitCode: string;
    readonly chargingMethodCode: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<PreparedChargeItemPublication>;
  confirmPublication(command: {
    readonly chargeItemVersionId: string;
    readonly releaseId: string;
  }): Promise<void>;
  getPublishedReference(command: {
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }): Promise<PublishedChargeItemReference>;
}

export function createChargeCatalogModule(database: Kysely<DB>): ChargeCatalogModule {
  return {
    async prepareInitialPublication(command) {
      const pricedObject = await database
        .insertInto('charge_catalog.priced_object')
        .values({
          object_kind: 'CHARGE_ITEM',
          created_by: command.actorPrincipalId,
        })
        .returning('priced_object_id')
        .executeTakeFirstOrThrow();
      await database
        .insertInto('charge_catalog.charge_item')
        .values({
          charge_item_id: pricedObject.priced_object_id,
          internal_code: command.internalCode,
          origin_scope: 'HOSPITAL',
          origin_campus_id: null,
          created_by: command.actorPrincipalId,
        })
        .execute();

      const chargeItemVersionId = await nextUuid(database);
      const domainContent = {
        billingUnitCode: command.billingUnitCode,
        businessStatus: 'ACTIVE' as const,
        businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo,
        chargeItemId: pricedObject.priced_object_id,
        chargeItemVersionId,
        chargingMethodCode: command.chargingMethodCode,
        formalName: command.formalName,
        internalCode: command.internalCode,
        recordedFrom: command.recordedFrom,
        serviceDefinition: command.serviceDefinition,
        versionNo: '1',
      };
      const contentHash = canonicalSha256(domainContent);
      await database
        .insertInto('charge_catalog.charge_item_version')
        .values({
          charge_item_version_id: chargeItemVersionId,
          charge_item_id: pricedObject.priced_object_id,
          version_no: '1',
          formal_name: command.formalName,
          service_definition: command.serviceDefinition,
          billing_unit_code: command.billingUnitCode,
          charging_method_code: command.chargingMethodCode,
          governance_status: 'DRAFT',
          business_status: 'ACTIVE',
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          recorded_to: null,
          release_id: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
        })
        .execute();

      return {
        governanceObjectId: command.governanceObjectId,
        chargeItemId: pricedObject.priced_object_id,
        chargeItemVersionId,
        contentHash,
        projection: {
          catalogCode: command.catalogCode,
          items: [
            {
              ...domainContent,
              contentHash: digestHex(contentHash),
            },
          ],
        },
      };
    },

    async confirmPublication(command) {
      const result = await database
        .updateTable('charge_catalog.charge_item_version')
        .set({
          governance_status: 'PUBLISHED',
          release_id: command.releaseId,
        })
        .where('charge_item_version_id', '=', command.chargeItemVersionId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) throw new Error('CHARGE_ITEM_PUBLICATION_STATE_CONFLICT');
    },

    async getPublishedReference(command) {
      const reference = await database
        .selectFrom('charge_catalog.charge_item_version as version')
        .innerJoin('charge_catalog.charge_item as item', 'item.charge_item_id', 'version.charge_item_id')
        .select([
          'version.charge_item_id as chargeItemId',
          'version.charge_item_version_id as chargeItemVersionId',
          'version.version_no as versionNo',
          'item.internal_code as internalCode',
          'version.formal_name as formalName',
          'version.billing_unit_code as billingUnitCode',
          'version.content_hash as contentHash',
        ])
        .where('version.charge_item_id', '=', command.chargeItemId)
        .where('version.charge_item_version_id', '=', command.chargeItemVersionId)
        .where('version.governance_status', '=', 'PUBLISHED')
        .executeTakeFirst();
      if (!reference) throw new Error('CHARGE_ITEM_PUBLISHED_REFERENCE_NOT_FOUND');
      return reference;
    },
  };
}

async function nextUuid(database: Kysely<DB>): Promise<string> {
  const result = await database
    .selectNoFrom((expression) => expression.fn<string>('uuidv7', []).as('id'))
    .executeTakeFirstOrThrow();
  return result.id;
}
