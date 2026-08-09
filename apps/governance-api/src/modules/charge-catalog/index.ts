import { sql, type Kysely } from 'kysely';
import { Type, type Static } from 'typebox';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import {
  LOCAL_DATE_TIME_JSON_PATTERN,
  parseLocalDateTime,
} from '../../platform/local-datetime/local-datetime.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';

export const CHARGE_CATALOG_MODULE_ID = 'charge-catalog' as const;
export const CHARGE_CATALOG_PROJECTION_TYPE = 'hdi.charge-catalog' as const;
export const CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION = '1' as const;
export const CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2 = '2' as const;
export const CHARGE_CATALOG_PROJECTION_SCHEMA_ID = 'ChargeCatalogProjectionV1' as const;
export const CHARGE_CATALOG_PROJECTION_SCHEMA_ID_V2 = 'ChargeCatalogProjectionV2' as const;

const UuidSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const LocalDateTimeSchema = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
const CHARGE_ITEM_VERSION_SELECTION = [
  'version.charge_item_id as chargeItemId',
  'version.charge_item_version_id as chargeItemVersionId',
  'version.version_no as versionNo',
  'item.internal_code as internalCode',
  'version.formal_name as formalName',
  'version.service_definition as serviceDefinition',
  'version.billing_unit_code as billingUnitCode',
  'version.charging_method_code as chargingMethodCode',
  'version.governance_status as governanceStatus',
  'version.business_status as businessStatus',
  'version.business_valid_from as businessValidFrom',
  'version.business_valid_to as businessValidTo',
  'version.recorded_from as recordedFrom',
  'version.recorded_to as recordedTo',
  'version.release_id as releaseId',
  'version.content_hash as contentHash',
] as const;

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

export const ChargeCatalogProjectionSchemaV2 = Type.Object(
  {
    ...ChargeCatalogProjectionSchema.properties,
    contractRevision: Type.Literal('2'),
  },
  { $id: CHARGE_CATALOG_PROJECTION_SCHEMA_ID_V2, additionalProperties: false },
);

export type ChargeCatalogProjection = Static<typeof ChargeCatalogProjectionSchema>;

export interface ChargeItemContentInput {
  readonly formalName: string;
  readonly serviceDefinition: string;
  readonly billingUnitCode: string;
  readonly chargingMethodCode: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}

export interface ChargeItemVersionView extends ChargeItemContentInput {
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly versionNo: string;
  readonly internalCode: string;
  readonly governanceStatus: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED';
  readonly businessStatus: 'PLANNED' | 'ACTIVE' | 'SUSPENDED' | 'ENDED' | 'SUPERSEDED';
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly releaseId: string | null;
  readonly contentHash: Buffer;
}

export interface ChargeItemVersionDifference {
  readonly field: string;
  readonly leftValue: string | null;
  readonly rightValue: string | null;
}

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
  createDraft(command: ChargeItemContentInput & {
    readonly governanceObjectId: string;
    readonly internalCode: string;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<ChargeItemVersionView>;
  createVersionDraft(command: ChargeItemContentInput & {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<ChargeItemVersionView>;
  getVersion(command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }): Promise<ChargeItemVersionView>;
  findChargeItemIdByInternalCode(command: {
    readonly governanceObjectId: string;
    readonly internalCode: string;
  }): Promise<string | null>;
  lockVersionForMutation(command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }): Promise<ChargeItemVersionView>;
  listVersions(command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
  }): Promise<readonly ChargeItemVersionView[]>;
  getVersionAsOf(command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly businessAt: string;
    readonly recordAsOf: string;
  }): Promise<ChargeItemVersionView | null>;
  compareVersions(command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly leftVersionId: string;
    readonly rightVersionId: string;
  }): Promise<readonly ChargeItemVersionDifference[]>;
  updateDraft(command: ChargeItemContentInput & {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }): Promise<ChargeItemVersionView>;
  deleteDraft(command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }): Promise<void>;
  prepareInitialPublication(command: ChargeItemContentInput & {
    readonly governanceObjectId: string;
    readonly catalogCode: string;
    readonly internalCode: string;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<PreparedChargeItemPublication>;
  prepareDraftPublication(command: {
    readonly governanceObjectId: string;
    readonly catalogCode: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }): Promise<PreparedChargeItemPublication>;
  prepareVersionProjection(command: {
    readonly governanceObjectId: string;
    readonly catalogCode: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
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
  const getVersionQuery = (command: {
    readonly governanceObjectId: string;
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
  }) => database
    .selectFrom('charge_catalog.charge_item_version as version')
    .innerJoin('charge_catalog.charge_item as item', 'item.charge_item_id', 'version.charge_item_id')
    .select(CHARGE_ITEM_VERSION_SELECTION)
    .where('item.governance_object_id', '=', command.governanceObjectId)
    .where('version.charge_item_id', '=', command.chargeItemId)
    .where('version.charge_item_version_id', '=', command.chargeItemVersionId);

  return {
    createDraft(command) {
      return insertInitialDraft(database, command);
    },

    async createVersionDraft(command) {
      parseLocalDateTime(command.recordedFrom);
      validateChargeItemContent(command);
      const item = await database
        .selectFrom('charge_catalog.charge_item')
        .select(['charge_item_id', 'internal_code'])
        .where('charge_item_id', '=', command.chargeItemId)
        .where('governance_object_id', '=', command.governanceObjectId)
        .forUpdate()
        .executeTakeFirst();
      if (!item) throw new Error('CHARGE_ITEM_NOT_FOUND');
      const openCandidate = await database
        .selectFrom('charge_catalog.charge_item_version')
        .select('charge_item_version_id')
        .where('charge_item_id', '=', command.chargeItemId)
        .where('governance_status', 'in', ['DRAFT', 'IN_REVIEW', 'APPROVED'])
        .executeTakeFirst();
      if (openCandidate) throw new Error('CHARGE_ITEM_OPEN_VERSION_CANDIDATE_CONFLICT');
      const latest = await database
        .selectFrom('charge_catalog.charge_item_version')
        .select('version_no')
        .where('charge_item_id', '=', command.chargeItemId)
        .orderBy('version_no', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!latest) throw new Error('CHARGE_ITEM_VERSION_HISTORY_NOT_FOUND');
      const versionNo = (BigInt(latest.version_no) + 1n).toString();
      const chargeItemVersionId = await nextUuid(database);
      const businessStatus = command.businessValidFrom > command.recordedFrom
        ? ('PLANNED' as const)
        : ('ACTIVE' as const);
      const contentHash = chargeItemContentHash({
        ...command,
        businessStatus,
        chargeItemVersionId,
        internalCode: item.internal_code,
        versionNo,
      });
      await database
        .insertInto('charge_catalog.charge_item_version')
        .values({
          charge_item_version_id: chargeItemVersionId,
          charge_item_id: command.chargeItemId,
          version_no: versionNo,
          formal_name: command.formalName,
          service_definition: command.serviceDefinition,
          billing_unit_code: command.billingUnitCode,
          charging_method_code: command.chargingMethodCode,
          governance_status: 'DRAFT',
          business_status: businessStatus,
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
        ...command,
        businessStatus,
        chargeItemVersionId,
        contentHash,
        governanceStatus: 'DRAFT',
        internalCode: item.internal_code,
        recordedTo: null,
        releaseId: null,
        versionNo,
      };
    },

    async getVersion(command) {
      const row = await getVersionQuery(command).executeTakeFirst();
      if (!row) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      return toVersionView(row);
    },

    async findChargeItemIdByInternalCode(command) {
      const item = await database
        .selectFrom('charge_catalog.charge_item')
        .select('charge_item_id')
        .where('governance_object_id', '=', command.governanceObjectId)
        .where('internal_code', '=', command.internalCode)
        .executeTakeFirst();
      return item?.charge_item_id ?? null;
    },

    async lockVersionForMutation(command) {
      const row = await getVersionQuery(command).forUpdate().executeTakeFirst();
      if (!row) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      return toVersionView(row);
    },

    async listVersions(command) {
      const rows = await database
        .selectFrom('charge_catalog.charge_item_version as version')
        .innerJoin('charge_catalog.charge_item as item', 'item.charge_item_id', 'version.charge_item_id')
        .select(CHARGE_ITEM_VERSION_SELECTION)
        .where('item.governance_object_id', '=', command.governanceObjectId)
        .where('version.charge_item_id', '=', command.chargeItemId)
        .orderBy('version.version_no', 'asc')
        .execute();
      if (rows.length === 0) throw new Error('CHARGE_ITEM_NOT_FOUND');
      return rows.map(toVersionView);
    },

    async getVersionAsOf(command) {
      const rows = await database
        .selectFrom('charge_catalog.charge_item_version as version')
        .innerJoin('charge_catalog.charge_item as item', 'item.charge_item_id', 'version.charge_item_id')
        .select(CHARGE_ITEM_VERSION_SELECTION)
        .where('item.governance_object_id', '=', command.governanceObjectId)
        .where('version.charge_item_id', '=', command.chargeItemId)
        .where('version.governance_status', '=', 'PUBLISHED')
        .where(sql<boolean>`version.business_period @> ${command.businessAt}::timestamp`)
        .where(sql<boolean>`version.recorded_period @> ${command.recordAsOf}::timestamp`)
        .execute();
      if (rows.length > 1) throw new Error('CHARGE_ITEM_BITEMPORAL_CONFLICT');
      return rows[0] ? toVersionView(rows[0]) : null;
    },

    async compareVersions(command) {
      const [left, right] = await Promise.all([
        getVersionQuery({
          governanceObjectId: command.governanceObjectId,
          chargeItemId: command.chargeItemId,
          chargeItemVersionId: command.leftVersionId,
        }).executeTakeFirst(),
        getVersionQuery({
          governanceObjectId: command.governanceObjectId,
          chargeItemId: command.chargeItemId,
          chargeItemVersionId: command.rightVersionId,
        }).executeTakeFirst(),
      ]);
      if (!left || !right) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      const leftView = toVersionView(left);
      const rightView = toVersionView(right);
      const fields: readonly (keyof Pick<
        ChargeItemVersionView,
        | 'formalName'
        | 'serviceDefinition'
        | 'billingUnitCode'
        | 'chargingMethodCode'
        | 'businessStatus'
        | 'businessValidFrom'
        | 'businessValidTo'
        | 'governanceStatus'
      >)[] = [
        'formalName',
        'serviceDefinition',
        'billingUnitCode',
        'chargingMethodCode',
        'businessStatus',
        'businessValidFrom',
        'businessValidTo',
        'governanceStatus',
      ];
      return fields.flatMap((field) => leftView[field] === rightView[field] ? [] : [{
        field,
        leftValue: leftView[field],
        rightValue: rightView[field],
      }]);
    },

    async updateDraft(command) {
      validateChargeItemContent(command);
      const current = await getVersionQuery(command).forUpdate().executeTakeFirst();
      if (!current) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      if (current.governanceStatus !== 'DRAFT') throw new Error('CHARGE_ITEM_DRAFT_IMMUTABLE');
      const contentHash = chargeItemContentHash({
        ...command,
        businessStatus: current.businessStatus,
        chargeItemId: current.chargeItemId,
        chargeItemVersionId: current.chargeItemVersionId,
        internalCode: current.internalCode,
        recordedFrom: current.recordedFrom,
        versionNo: current.versionNo,
      });
      await database
        .updateTable('charge_catalog.charge_item_version')
        .set({
          formal_name: command.formalName,
          service_definition: command.serviceDefinition,
          billing_unit_code: command.billingUnitCode,
          charging_method_code: command.chargingMethodCode,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          content_hash: contentHash,
        })
        .where('charge_item_version_id', '=', command.chargeItemVersionId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirstOrThrow();
      return {
        ...toVersionView(current),
        ...command,
        contentHash,
      };
    },

    async deleteDraft(command) {
      const current = await getVersionQuery(command).forUpdate().executeTakeFirst();
      if (!current) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      if (current.governanceStatus !== 'DRAFT') throw new Error('CHARGE_ITEM_DRAFT_IMMUTABLE');
      await database
        .deleteFrom('charge_catalog.charge_item_version')
        .where('charge_item_version_id', '=', command.chargeItemVersionId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirstOrThrow();
      const remaining = await database
        .selectFrom('charge_catalog.charge_item_version')
        .select((expression) => expression.fn.countAll<string>().as('count'))
        .where('charge_item_id', '=', command.chargeItemId)
        .executeTakeFirstOrThrow();
      if (remaining.count !== '0') return;
      await database
        .deleteFrom('charge_catalog.charge_item')
        .where('charge_item_id', '=', command.chargeItemId)
        .executeTakeFirstOrThrow();
      await database
        .deleteFrom('charge_catalog.priced_object')
        .where('priced_object_id', '=', command.chargeItemId)
        .executeTakeFirstOrThrow();
    },

    async prepareInitialPublication(command) {
      const draft = await insertInitialDraft(database, command);
      return preparedPublicationFromDraft(command.governanceObjectId, command.catalogCode, draft);
    },

    async prepareDraftPublication(command) {
      const draft = await getVersionQuery(command).forUpdate().executeTakeFirst();
      if (!draft) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      const view = toVersionView(draft);
      if (view.governanceStatus !== 'DRAFT') {
        throw new Error('CHARGE_ITEM_PUBLICATION_STATE_CONFLICT');
      }
      return preparedPublicationFromDraft(command.governanceObjectId, command.catalogCode, view);
    },

    async prepareVersionProjection(command) {
      const version = await getVersionQuery(command).executeTakeFirst();
      if (!version) throw new Error('CHARGE_ITEM_VERSION_NOT_FOUND');
      return preparedPublicationFromDraft(
        command.governanceObjectId,
        command.catalogCode,
        toVersionView(version),
      );
    },

    async confirmPublication(command) {
      const draft = await database
        .selectFrom('charge_catalog.charge_item_version')
        .select(['charge_item_id', 'recorded_from'])
        .where('charge_item_version_id', '=', command.chargeItemVersionId)
        .where('governance_status', '=', 'DRAFT')
        .forUpdate()
        .executeTakeFirst();
      if (!draft) throw new Error('CHARGE_ITEM_PUBLICATION_STATE_CONFLICT');
      const current = await database
        .selectFrom('charge_catalog.charge_item_version')
        .select(['charge_item_version_id', 'recorded_from'])
        .where('charge_item_id', '=', draft.charge_item_id)
        .where('governance_status', '=', 'PUBLISHED')
        .where('recorded_to', 'is', null)
        .orderBy('version_no', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (current) {
        if (draft.recorded_from <= current.recorded_from) {
          throw new Error('CHARGE_ITEM_RECORDED_TIME_CONFLICT');
        }
        await database
          .updateTable('charge_catalog.charge_item_version')
          .set({ recorded_to: draft.recorded_from })
          .where('charge_item_version_id', '=', current.charge_item_version_id)
          .where('recorded_to', 'is', null)
          .executeTakeFirstOrThrow();
      }
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
      hitControlledPublicationFault('DOMAIN_CANDIDATE_CONFIRMED');
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

function preparedPublicationFromDraft(
  governanceObjectId: string,
  catalogCode: string,
  draft: ChargeItemVersionView,
): PreparedChargeItemPublication {
  return {
    governanceObjectId,
    chargeItemId: draft.chargeItemId,
    chargeItemVersionId: draft.chargeItemVersionId,
    contentHash: draft.contentHash,
    projection: {
      catalogCode,
      items: [{
        billingUnitCode: draft.billingUnitCode,
        businessStatus: 'ACTIVE',
        businessValidFrom: draft.businessValidFrom,
        businessValidTo: draft.businessValidTo,
        chargeItemId: draft.chargeItemId,
        chargeItemVersionId: draft.chargeItemVersionId,
        chargingMethodCode: draft.chargingMethodCode,
        contentHash: digestHex(draft.contentHash),
        formalName: draft.formalName,
        internalCode: draft.internalCode,
        recordedFrom: draft.recordedFrom,
        serviceDefinition: draft.serviceDefinition,
        versionNo: draft.versionNo,
      }],
    },
  };
}

async function insertInitialDraft(
  database: Kysely<DB>,
  command: ChargeItemContentInput & {
    readonly governanceObjectId: string;
    readonly internalCode: string;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  },
): Promise<ChargeItemVersionView> {
  parseLocalDateTime(command.recordedFrom);
  validateInternalCode(command.internalCode);
  validateChargeItemContent(command);
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
      governance_object_id: command.governanceObjectId,
      internal_code: command.internalCode,
      origin_scope: 'HOSPITAL',
      origin_campus_id: null,
      created_by: command.actorPrincipalId,
    })
    .execute();

  const chargeItemVersionId = await nextUuid(database);
  const versionNo = '1';
  const businessStatus = 'ACTIVE' as const;
  const contentHash = chargeItemContentHash({
    ...command,
    businessStatus,
    chargeItemId: pricedObject.priced_object_id,
    chargeItemVersionId,
    versionNo,
  });
  await database
    .insertInto('charge_catalog.charge_item_version')
    .values({
      charge_item_version_id: chargeItemVersionId,
      charge_item_id: pricedObject.priced_object_id,
      version_no: versionNo,
      formal_name: command.formalName,
      service_definition: command.serviceDefinition,
      billing_unit_code: command.billingUnitCode,
      charging_method_code: command.chargingMethodCode,
      governance_status: 'DRAFT',
      business_status: businessStatus,
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
    ...command,
    businessStatus,
    chargeItemId: pricedObject.priced_object_id,
    chargeItemVersionId,
    contentHash,
    governanceStatus: 'DRAFT',
    recordedTo: null,
    releaseId: null,
    versionNo,
  };
}

function validateInternalCode(value: string): void {
  if (value.trim().length === 0 || value.length > 64) {
    throw new Error('CHARGE_ITEM_INTERNAL_CODE_INVALID');
  }
}

function validateChargeItemContent(command: ChargeItemContentInput): void {
  parseLocalDateTime(command.businessValidFrom);
  if (command.businessValidTo) parseLocalDateTime(command.businessValidTo);
  if (command.formalName.trim().length === 0 || command.formalName.length > 256) {
    throw new Error('CHARGE_ITEM_FORMAL_NAME_INVALID');
  }
  if (command.serviceDefinition.trim().length === 0 || command.serviceDefinition.length > 2000) {
    throw new Error('CHARGE_ITEM_SERVICE_DEFINITION_INVALID');
  }
  if (command.billingUnitCode.trim().length === 0 || command.billingUnitCode.length > 64) {
    throw new Error('CHARGE_ITEM_BILLING_UNIT_INVALID');
  }
  if (command.chargingMethodCode.trim().length === 0 || command.chargingMethodCode.length > 32) {
    throw new Error('CHARGE_ITEM_CHARGING_METHOD_INVALID');
  }
  if (command.businessValidTo !== null && command.businessValidTo <= command.businessValidFrom) {
    throw new Error('CHARGE_ITEM_BUSINESS_PERIOD_INVALID');
  }
}

function chargeItemContentHash(content: ChargeItemContentInput & {
  readonly businessStatus: string;
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly internalCode: string;
  readonly recordedFrom: string;
  readonly versionNo: string;
}): Buffer {
  return canonicalSha256({
    billingUnitCode: content.billingUnitCode,
    businessStatus: content.businessStatus,
    businessValidFrom: content.businessValidFrom,
    businessValidTo: content.businessValidTo,
    chargeItemId: content.chargeItemId,
    chargeItemVersionId: content.chargeItemVersionId,
    chargingMethodCode: content.chargingMethodCode,
    formalName: content.formalName,
    internalCode: content.internalCode,
    recordedFrom: content.recordedFrom,
    serviceDefinition: content.serviceDefinition,
    versionNo: content.versionNo,
  });
}

function toVersionView(row: {
  readonly billingUnitCode: string;
  readonly businessStatus: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly chargingMethodCode: string;
  readonly contentHash: Buffer;
  readonly formalName: string;
  readonly governanceStatus: string;
  readonly internalCode: string;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly releaseId: string | null;
  readonly serviceDefinition: string;
  readonly versionNo: string;
}): ChargeItemVersionView {
  return {
    ...row,
    businessStatus: row.businessStatus as ChargeItemVersionView['businessStatus'],
    governanceStatus: row.governanceStatus as ChargeItemVersionView['governanceStatus'],
  };
}

async function nextUuid(database: Kysely<DB>): Promise<string> {
  const result = await database
    .selectNoFrom((expression) => expression.fn<string>('uuidv7', []).as('id'))
    .executeTakeFirstOrThrow();
  return result.id;
}
