import { Decimal } from 'decimal.js';
import { sql, type Kysely } from 'kysely';
import { Type, type Static } from 'typebox';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  canonicalSha256,
  digestHex,
} from '../../platform/hashing/canonical-hash.js';
import { LOCAL_DATE_TIME_JSON_PATTERN } from '../../platform/local-datetime/local-datetime.js';
import type { ChargeCatalogModule } from '../charge-catalog/index.js';

export const PRICE_LIST_MODULE_ID = 'price-list' as const;
export const PRICE_LIST_PROJECTION_TYPE = 'hdi.price-list' as const;
export const PRICE_LIST_PROJECTION_SCHEMA_VERSION = '1' as const;
export const PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION = '0' as const;
export const PRICE_LIST_PROJECTION_SCHEMA_ID = 'PriceListProjectionV1' as const;
export const PRICE_LIST_LEGACY_PROJECTION_SCHEMA_ID = 'PriceListProjectionV0' as const;

const UuidSchema = Type.String({
  pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
});
const LocalDateTimeSchema = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
const DigestSchema = Type.String({ pattern: '^[0-9a-f]{64}$' });

export const PriceListLegacyProjectionSchema = Type.Object(
  {
    priceListId: UuidSchema,
    priceListCode: Type.String({ minLength: 1, maxLength: 64 }),
    legacyEntries: Type.Array(
      Type.Object(
        {
          itemCode: Type.String({ minLength: 1, maxLength: 64 }),
          unitPrice: Type.String({ pattern: '^\\d+\\.\\d{2}$' }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  {
    $id: PRICE_LIST_LEGACY_PROJECTION_SCHEMA_ID,
    additionalProperties: false,
  },
);

const PriceProjectionEntrySchema = Type.Object(
  {
    entryNo: Type.String({ pattern: '^[1-9]\\d*$' }),
    priceEntryId: UuidSchema,
    chargeItemId: UuidSchema,
    chargeItemVersionId: UuidSchema,
    chargeItemInternalCode: Type.String({ minLength: 1, maxLength: 64 }),
    scopeLevel: Type.Union([Type.Literal('HOSPITAL'), Type.Literal('CAMPUS')]),
    campusId: Type.Union([UuidSchema, Type.Null()]),
    encounterMode: Type.Union([Type.Literal('GENERAL'), Type.Literal('SPECIFIC')]),
    encounterType: Type.Union([
      Type.Literal('OUTPATIENT'),
      Type.Literal('INPATIENT'),
      Type.Literal('EMERGENCY'),
      Type.Literal('CHECKUP'),
      Type.Null(),
    ]),
    fixedUnitPrice: Type.String({ pattern: '^\\d+\\.\\d{4}$' }),
    currencyCode: Type.String({ pattern: '^[A-Z]{3}$' }),
    billingUnitCode: Type.String({ minLength: 1, maxLength: 64 }),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    priceNature: Type.Union([
      Type.Literal('HOSPITAL_DEFAULT'),
      Type.Literal('CAMPUS_DIFFERENCE'),
    ]),
    zeroPriceReason: Type.Union([Type.String({ minLength: 1, maxLength: 500 }), Type.Null()]),
    contentHash: DigestSchema,
  },
  { additionalProperties: false },
);

export const PriceListProjectionSchema = Type.Object(
  {
    priceListId: UuidSchema,
    priceListReleaseId: UuidSchema,
    releaseNo: Type.String({ pattern: '^[1-9]\\d*$' }),
    priceListCode: Type.String({ minLength: 1, maxLength: 64 }),
    displayName: Type.String({ minLength: 1, maxLength: 256 }),
    currencyCode: Type.String({ pattern: '^[A-Z]{3}$' }),
    businessValidFrom: LocalDateTimeSchema,
    businessValidTo: Type.Union([LocalDateTimeSchema, Type.Null()]),
    recordedFrom: LocalDateTimeSchema,
    contentHash: DigestSchema,
    entries: Type.Array(PriceProjectionEntrySchema, { minItems: 1 }),
  },
  {
    $id: PRICE_LIST_PROJECTION_SCHEMA_ID,
    additionalProperties: false,
  },
);

export type PriceListProjection = Static<typeof PriceListProjectionSchema>;
export type EncounterType = 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CHECKUP';

export interface PreparedPriceListPublication {
  readonly governanceObjectId: string;
  readonly priceListId: string;
  readonly priceListReleaseId: string;
  readonly contentHash: Buffer;
  readonly projection: PriceListProjection;
}

export interface PublishedPriceCandidate {
  readonly priceEntryId: string;
  readonly entryNo: string;
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly scopeLevel: 'HOSPITAL' | 'CAMPUS';
  readonly campusId: string | null;
  readonly encounterMode: 'GENERAL' | 'SPECIFIC';
  readonly encounterType: EncounterType | null;
  readonly fixedUnitPrice: string;
  readonly currencyCode: string;
  readonly billingUnitCode: string;
  readonly contentHash: Buffer;
}

export interface PublishedPriceView {
  readonly selectionStatus: 'SELECTED' | 'NO_RELEASE' | 'SUSPENDED';
  readonly priceListId: string;
  readonly priceListReleaseId: string | null;
  readonly priceListReleaseHash: Buffer | null;
  readonly publishedViewHash: Buffer;
  readonly candidates: readonly PublishedPriceCandidate[];
}

export interface PriceListModule {
  preparePublication(command: {
    readonly governanceObjectId: string;
    readonly priceListCode: string;
    readonly displayName: string;
    readonly currencyCode: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
    readonly entries: readonly {
      readonly chargeItemId: string;
      readonly chargeItemVersionId: string;
      readonly scopeLevel: 'HOSPITAL' | 'CAMPUS';
      readonly campusId: string | null;
      readonly encounterMode: 'GENERAL' | 'SPECIFIC';
      readonly encounterType: EncounterType | null;
      readonly fixedUnitPrice: string;
      readonly billingUnitCode: string;
      readonly businessValidFrom: string;
      readonly businessValidTo: string | null;
      readonly zeroPriceReason: string | null;
    }[];
  }): Promise<PreparedPriceListPublication>;
  confirmPublication(command: {
    readonly priceListReleaseId: string;
    readonly governanceReleaseId: string;
  }): Promise<void>;
  getPublishedView(command: {
    readonly priceListId: string;
    readonly pricedObjectId: string;
    readonly serviceOccurredAt: string;
    readonly recordAsOf: string;
  }): Promise<PublishedPriceView>;
}

export function createPriceListModule(
  database: Kysely<DB>,
  chargeCatalog: ChargeCatalogModule,
): PriceListModule {
  return {
    async preparePublication(command) {
      if (command.entries.length === 0) throw new Error('PRICE_LIST_ENTRIES_REQUIRED');
      if (!/^[A-Z]{3}$/u.test(command.currencyCode)) throw new Error('CURRENCY_CODE_INVALID');

      const references = await Promise.all(
        command.entries.map((entry) =>
          chargeCatalog.getPublishedReference({
            chargeItemId: entry.chargeItemId,
            chargeItemVersionId: entry.chargeItemVersionId,
          }),
        ),
      );
      let priceList = await database
        .selectFrom('price_list.price_list')
        .select(['price_list_id', 'price_list_code'])
        .where('governance_object_id', '=', command.governanceObjectId)
        .executeTakeFirst();
      let releaseNo = '1';
      if (priceList) {
        if (priceList.price_list_code !== command.priceListCode) {
          throw new Error('PRICE_LIST_STABLE_CODE_IMMUTABLE');
        }
        const latestRelease = await database
          .selectFrom('price_list.price_list_release')
          .select(['release_no', 'recorded_from'])
          .where('price_list_id', '=', priceList.price_list_id)
          .where('governance_status', '=', 'PUBLISHED')
          .where('recorded_to', 'is', null)
          .orderBy('release_no', 'desc')
          .limit(1)
          .executeTakeFirst();
        if (!latestRelease) throw new Error('PRICE_LIST_CURRENT_RELEASE_NOT_FOUND');
        if (command.recordedFrom <= latestRelease.recorded_from) {
          throw new Error('PRICE_LIST_RECORDED_TIME_CONFLICT');
        }
        const closed = await database
          .updateTable('price_list.price_list_release')
          .set({ recorded_to: command.recordedFrom })
          .where('price_list_id', '=', priceList.price_list_id)
          .where('price_list_release_id', '=', sql<string>`(
            select current_release.price_list_release_id
            from price_list.price_list_release as current_release
            where current_release.price_list_id = ${priceList.price_list_id}
              and current_release.governance_status = 'PUBLISHED'
              and current_release.recorded_to is null
            order by current_release.release_no desc
            limit 1
          )`)
          .executeTakeFirst();
        if (closed.numUpdatedRows !== 1n) throw new Error('PRICE_LIST_CURRENT_RELEASE_CLOSE_CONFLICT');
        releaseNo = (BigInt(latestRelease.release_no) + 1n).toString();
      } else {
        priceList = await database
          .insertInto('price_list.price_list')
          .values({
            governance_object_id: command.governanceObjectId,
            price_list_code: command.priceListCode,
            created_by: command.actorPrincipalId,
          })
          .returning(['price_list_id', 'price_list_code'])
          .executeTakeFirstOrThrow();
      }
      const priceListReleaseId = await nextUuid(database);

      const projectionEntries: PriceListProjection['entries'] = [];
      for (const [index, entry] of command.entries.entries()) {
        const reference = references[index];
        if (!reference) throw new Error('CHARGE_ITEM_REFERENCE_MISSING');
        if (reference.billingUnitCode !== entry.billingUnitCode) {
          throw new Error('PRICE_ENTRY_BILLING_UNIT_MISMATCH');
        }
        const fixedUnitPrice = normalizeMoney(entry.fixedUnitPrice);
        const priceEntryId = await nextUuid(database);
        const entryNo = (index + 1).toString();
        const priceNature =
          entry.scopeLevel === 'HOSPITAL'
            ? ('HOSPITAL_DEFAULT' as const)
            : ('CAMPUS_DIFFERENCE' as const);
        const entryContent = {
          billingUnitCode: entry.billingUnitCode,
          businessValidFrom: entry.businessValidFrom,
          businessValidTo: entry.businessValidTo,
          campusId: entry.campusId,
          chargeItemId: entry.chargeItemId,
          chargeItemInternalCode: reference.internalCode,
          chargeItemVersionId: entry.chargeItemVersionId,
          currencyCode: command.currencyCode,
          encounterMode: entry.encounterMode,
          encounterType: entry.encounterType,
          entryNo,
          fixedUnitPrice,
          priceEntryId,
          priceNature,
          scopeLevel: entry.scopeLevel,
          zeroPriceReason: entry.zeroPriceReason,
        };
        const entryHash = canonicalSha256(entryContent);
        projectionEntries.push({ ...entryContent, contentHash: digestHex(entryHash) });
      }

      const releaseContent = {
        businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo,
        currencyCode: command.currencyCode,
        displayName: command.displayName,
        entries: projectionEntries,
        priceListCode: priceList.price_list_code,
        priceListId: priceList.price_list_id,
        priceListReleaseId,
        recordedFrom: command.recordedFrom,
        releaseNo,
      };
      const contentHash = canonicalSha256(releaseContent);
      await database
        .insertInto('price_list.price_list_release')
        .values({
          price_list_release_id: priceListReleaseId,
          price_list_id: priceList.price_list_id,
          release_no: releaseNo,
          display_name: command.displayName,
          currency_code: command.currencyCode,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          recorded_to: null,
          governance_status: 'DRAFT',
          business_status: 'ACTIVE',
          governance_release_id: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
        })
        .execute();

      for (const entry of projectionEntries) {
        await database
          .insertInto('price_list.price_entry')
          .values({
            price_entry_id: entry.priceEntryId,
            price_list_release_id: priceListReleaseId,
            entry_no: entry.entryNo,
            priced_object_id: entry.chargeItemId,
            scope_level: entry.scopeLevel,
            campus_id: entry.campusId,
            encounter_mode: entry.encounterMode,
            encounter_type: entry.encounterType,
            fixed_unit_price: entry.fixedUnitPrice,
            currency_code: entry.currencyCode,
            billing_unit_code: entry.billingUnitCode,
            business_valid_from: entry.businessValidFrom,
            business_valid_to: entry.businessValidTo,
            price_nature: entry.priceNature,
            zero_price_reason: entry.zeroPriceReason,
            content_hash: Buffer.from(entry.contentHash, 'hex'),
          })
          .execute();
        await database
          .insertInto('price_list.price_entry_charge_item_target')
          .values({
            price_entry_id: entry.priceEntryId,
            charge_item_id: entry.chargeItemId,
            charge_item_version_id: entry.chargeItemVersionId,
          })
          .execute();
      }

      return {
        governanceObjectId: command.governanceObjectId,
        priceListId: priceList.price_list_id,
        priceListReleaseId,
        contentHash,
        projection: { ...releaseContent, contentHash: digestHex(contentHash) },
      };
    },

    async confirmPublication(command) {
      const result = await database
        .updateTable('price_list.price_list_release')
        .set({
          governance_status: 'PUBLISHED',
          governance_release_id: command.governanceReleaseId,
        })
        .where('price_list_release_id', '=', command.priceListReleaseId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirst();
      if (result.numUpdatedRows !== 1n) throw new Error('PRICE_LIST_PUBLICATION_STATE_CONFLICT');
    },

    async getPublishedView(command) {
      const releases = await database
        .selectFrom('price_list.price_list_release')
        .select([
          'price_list_release_id',
          'content_hash',
          'business_status',
        ])
        .where('price_list_id', '=', command.priceListId)
        .where('governance_status', '=', 'PUBLISHED')
        .where(sql<boolean>`business_period @> ${command.serviceOccurredAt}::timestamp`)
        .where(sql<boolean>`recorded_period @> ${command.recordAsOf}::timestamp`)
        .execute();
      if (releases.length === 0) {
        return emptyPublishedView(command.priceListId, 'NO_RELEASE');
      }
      if (releases.length > 1) throw new Error('PRICE_LIST_RELEASE_CONFLICT');
      const release = releases[0];
      if (!release) throw new Error('PRICE_LIST_RELEASE_SELECTION_FAILED');
      if (release.business_status === 'SUSPENDED') {
        return emptyPublishedView(command.priceListId, 'SUSPENDED');
      }

      const rows = await database
        .selectFrom('price_list.price_entry as entry')
        .innerJoin(
          'price_list.price_entry_charge_item_target as target',
          'target.price_entry_id',
          'entry.price_entry_id',
        )
        .select([
          'entry.price_entry_id as priceEntryId',
          'entry.entry_no as entryNo',
          'target.charge_item_id as chargeItemId',
          'target.charge_item_version_id as chargeItemVersionId',
          'entry.scope_level as scopeLevel',
          'entry.campus_id as campusId',
          'entry.encounter_mode as encounterMode',
          'entry.encounter_type as encounterType',
          'entry.fixed_unit_price as fixedUnitPrice',
          'entry.currency_code as currencyCode',
          'entry.billing_unit_code as billingUnitCode',
          'entry.content_hash as contentHash',
        ])
        .where('entry.price_list_release_id', '=', release.price_list_release_id)
        .where('entry.priced_object_id', '=', command.pricedObjectId)
        .where(sql<boolean>`entry.business_period @> ${command.serviceOccurredAt}::timestamp`)
        .orderBy('entry.entry_no', 'asc')
        .execute();
      const candidates = rows.map((row) => ({
        ...row,
        scopeLevel: row.scopeLevel as 'HOSPITAL' | 'CAMPUS',
        encounterMode: row.encounterMode as 'GENERAL' | 'SPECIFIC',
        encounterType: row.encounterType as EncounterType | null,
      }));
      const publishedViewHash = canonicalSha256({
        candidates: candidates.map((candidate) => ({
          ...candidate,
          contentHash: digestHex(candidate.contentHash),
        })),
        priceListId: command.priceListId,
        priceListReleaseHash: digestHex(release.content_hash),
        priceListReleaseId: release.price_list_release_id,
        recordAsOf: command.recordAsOf,
        serviceOccurredAt: command.serviceOccurredAt,
      });
      return {
        selectionStatus: 'SELECTED',
        priceListId: command.priceListId,
        priceListReleaseId: release.price_list_release_id,
        priceListReleaseHash: release.content_hash,
        publishedViewHash,
        candidates,
      };
    },
  };
}

function emptyPublishedView(
  priceListId: string,
  status: 'NO_RELEASE' | 'SUSPENDED',
): PublishedPriceView {
  return {
    selectionStatus: status,
    priceListId,
    priceListReleaseId: null,
    priceListReleaseHash: null,
    publishedViewHash: canonicalSha256({ priceListId, selectionStatus: status }),
    candidates: [],
  };
}

function normalizeMoney(value: string): string {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.isNegative() || amount.decimalPlaces() > 4) {
    throw new Error('FIXED_UNIT_PRICE_INVALID');
  }
  return amount.toFixed(4);
}

async function nextUuid(database: Kysely<DB>): Promise<string> {
  const result = await database
    .selectNoFrom((expression) => expression.fn<string>('uuidv7', []).as('id'))
    .executeTakeFirstOrThrow();
  return result.id;
}
