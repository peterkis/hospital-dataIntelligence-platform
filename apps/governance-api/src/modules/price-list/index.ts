import { Decimal } from 'decimal.js';
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
import type { ChargeCatalogModule } from '../charge-catalog/index.js';
import type { EmergencyControlModule } from '../emergency-control/index.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';

export const PRICE_LIST_MODULE_ID = 'price-list' as const;
export const PRICE_LIST_PROJECTION_TYPE = 'hdi.price-list' as const;
export const PRICE_LIST_PROJECTION_SCHEMA_VERSION = '1' as const;
export const PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2 = '2' as const;
export const PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION = '0' as const;
export const PRICE_LIST_PROJECTION_SCHEMA_ID = 'PriceListProjectionV1' as const;
export const PRICE_LIST_PROJECTION_SCHEMA_ID_V2 = 'PriceListProjectionV2' as const;
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

export const PriceListProjectionSchemaV2 = Type.Object(
  {
    ...PriceListProjectionSchema.properties,
    contractRevision: Type.Literal('2'),
  },
  { $id: PRICE_LIST_PROJECTION_SCHEMA_ID_V2, additionalProperties: false },
);

export type PriceListProjection = Static<typeof PriceListProjectionSchema>;
export type EncounterType = 'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CHECKUP';

export interface PriceEntryInput {
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
}

export interface PriceListReleaseView {
  readonly governanceObjectId: string;
  readonly priceListId: string;
  readonly priceListReleaseId: string;
  readonly releaseNo: string;
  readonly priceListCode: string;
  readonly displayName: string;
  readonly currencyCode: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly governanceStatus: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED';
  readonly governanceReleaseId: string | null;
  readonly businessStatus: 'PLANNED' | 'ACTIVE' | 'SUSPENDED' | 'ENDED';
  readonly contentHash: Buffer;
  readonly entries: PriceListProjection['entries'];
}

export interface PriceListDifference {
  readonly kind: 'ADDED' | 'REMOVED' | 'PRICE_CHANGED' | 'APPLICABILITY_CHANGED';
  readonly businessKey: string;
  readonly previousEntry: PriceListProjection['entries'][number] | null;
  readonly currentEntry: PriceListProjection['entries'][number] | null;
}

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
  createDraft(command: {
    readonly governanceObjectId: string;
    readonly priceListCode: string;
    readonly displayName: string;
    readonly currencyCode: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
    readonly entries: readonly PriceEntryInput[];
  }): Promise<PriceListReleaseView>;
  getRelease(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }): Promise<PriceListReleaseView | null>;
  findOpenDraftByCode(command: {
    readonly governanceObjectId: string;
    readonly priceListCode: string;
  }): Promise<PriceListReleaseView | null>;
  appendDraftEntry(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
    readonly entry: PriceEntryInput;
  }): Promise<PriceListReleaseView>;
  lockReleaseForMutation(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }): Promise<PriceListReleaseView | null>;
  updateDraft(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
    readonly displayName: string;
    readonly currencyCode: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly entries: readonly PriceEntryInput[];
  }): Promise<PriceListReleaseView>;
  deleteDraft(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }): Promise<boolean>;
  diffAgainstPreviousPublished(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }): Promise<readonly PriceListDifference[]>;
  prepareDraftPublication(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }): Promise<PreparedPriceListPublication>;
  prepareReleaseProjection(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly priceListReleaseId: string;
  }): Promise<PreparedPriceListPublication>;
  preparePublication(command: {
    readonly governanceObjectId: string;
    readonly priceListCode: string;
    readonly displayName: string;
    readonly currencyCode: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
    readonly entries: readonly PriceEntryInput[];
  }): Promise<PreparedPriceListPublication>;
  confirmPublication(command: {
    readonly priceListReleaseId: string;
    readonly governanceReleaseId: string;
  }): Promise<void>;
  getPublishedView(command: {
    readonly governanceObjectId: string;
    readonly priceListId: string;
    readonly pricedObjectId: string;
    readonly campusId: string;
    readonly serviceOccurredAt: string;
    readonly recordAsOf: string;
  }): Promise<PublishedPriceView>;
}

export function createPriceListModule(
  database: Kysely<DB>,
  chargeCatalog: ChargeCatalogModule,
  emergencyControl: Pick<EmergencyControlModule, 'isPriceReleaseSuspended'>,
): PriceListModule {
  const module: PriceListModule = {
    async createDraft(command) {
      const prepared = await module.preparePublication(command);
      return loadReleaseView(database, chargeCatalog, prepared.priceListId, prepared.priceListReleaseId, false).then(
        requireRelease,
      );
    },

    async getRelease(command) {
      const release = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        false,
      );
      return release?.governanceObjectId === command.governanceObjectId ? release : null;
    },

    async findOpenDraftByCode(command) {
      const row = await database
        .selectFrom('price_list.price_list as list')
        .innerJoin('price_list.price_list_release as release', 'release.price_list_id', 'list.price_list_id')
        .select(['list.price_list_id as priceListId', 'release.price_list_release_id as priceListReleaseId'])
        .where('list.governance_object_id', '=', command.governanceObjectId)
        .where('list.price_list_code', '=', command.priceListCode)
        .where('release.governance_status', '=', 'DRAFT')
        .executeTakeFirst();
      return row
        ? loadReleaseView(database, chargeCatalog, row.priceListId, row.priceListReleaseId, false)
        : null;
    },

    async appendDraftEntry(command) {
      const current = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        true,
      ).then(requireRelease);
      if (current.governanceObjectId !== command.governanceObjectId) {
        throw new Error('PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH');
      }
      if (current.governanceStatus !== 'DRAFT') throw new Error('PRICE_LIST_DRAFT_IMMUTABLE');
      const added = await buildProjectionEntries(
        database,
        chargeCatalog,
        current.currencyCode,
        [command.entry],
        current.entries.length,
      );
      const entry = added[0];
      if (!entry) throw new Error('PRICE_ENTRY_BUILD_FAILED');
      await insertProjectionEntries(database, current.priceListReleaseId, [entry]);
      const entries = [...current.entries, entry];
      const contentHash = canonicalSha256({
        businessValidFrom: current.businessValidFrom,
        businessValidTo: current.businessValidTo,
        currencyCode: current.currencyCode,
        displayName: current.displayName,
        entries,
        priceListCode: current.priceListCode,
        priceListId: current.priceListId,
        priceListReleaseId: current.priceListReleaseId,
        recordedFrom: current.recordedFrom,
        releaseNo: current.releaseNo,
      });
      await database
        .updateTable('price_list.price_list_release')
        .set({ content_hash: contentHash })
        .where('price_list_release_id', '=', current.priceListReleaseId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirstOrThrow();
      return loadReleaseView(
        database,
        chargeCatalog,
        current.priceListId,
        current.priceListReleaseId,
        false,
      ).then(requireRelease);
    },

    async lockReleaseForMutation(command) {
      const release = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        true,
      );
      return release?.governanceObjectId === command.governanceObjectId ? release : null;
    },

    async updateDraft(command) {
      validatePriceListTimes(command);
      if (command.entries.length === 0) throw new Error('PRICE_LIST_ENTRIES_REQUIRED');
      if (!/^[A-Z]{3}$/u.test(command.currencyCode)) throw new Error('CURRENCY_CODE_INVALID');
      const current = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        true,
      );
      if (!current) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
      if (current.governanceObjectId !== command.governanceObjectId) {
        throw new Error('PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH');
      }
      if (current.governanceStatus !== 'DRAFT') throw new Error('PRICE_LIST_DRAFT_IMMUTABLE');
      const projectionEntries = await buildProjectionEntries(
        database,
        chargeCatalog,
        command.currencyCode,
        command.entries,
      );
      const releaseContent = {
        businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo,
        currencyCode: command.currencyCode,
        displayName: command.displayName,
        entries: projectionEntries,
        priceListCode: current.priceListCode,
        priceListId: current.priceListId,
        priceListReleaseId: current.priceListReleaseId,
        recordedFrom: command.recordedFrom,
        releaseNo: current.releaseNo,
      };
      const contentHash = canonicalSha256(releaseContent);
      await database
        .deleteFrom('price_list.price_entry_charge_item_target')
        .where(
          'price_entry_id',
          'in',
          database
            .selectFrom('price_list.price_entry')
            .select('price_entry_id')
            .where('price_list_release_id', '=', command.priceListReleaseId),
        )
        .execute();
      await database
        .deleteFrom('price_list.price_entry')
        .where('price_list_release_id', '=', command.priceListReleaseId)
        .execute();
      await database
        .updateTable('price_list.price_list_release')
        .set({
          display_name: command.displayName,
          currency_code: command.currencyCode,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          business_status:
            command.businessValidFrom > command.recordedFrom ? 'PLANNED' : 'ACTIVE',
          content_hash: contentHash,
        })
        .where('price_list_release_id', '=', command.priceListReleaseId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirstOrThrow();
      await insertProjectionEntries(database, command.priceListReleaseId, projectionEntries);
      return loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        false,
      ).then(requireRelease);
    },

    async deleteDraft(command) {
      const current = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        true,
      );
      if (!current) return false;
      if (current.governanceObjectId !== command.governanceObjectId) {
        throw new Error('PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH');
      }
      if (current.governanceStatus !== 'DRAFT') throw new Error('PRICE_LIST_DRAFT_IMMUTABLE');
      await database
        .deleteFrom('price_list.price_entry_charge_item_target')
        .where(
          'price_entry_id',
          'in',
          database
            .selectFrom('price_list.price_entry')
            .select('price_entry_id')
            .where('price_list_release_id', '=', command.priceListReleaseId),
        )
        .execute();
      await database
        .deleteFrom('price_list.price_entry')
        .where('price_list_release_id', '=', command.priceListReleaseId)
        .execute();
      const deleted = await database
        .deleteFrom('price_list.price_list_release')
        .where('price_list_release_id', '=', command.priceListReleaseId)
        .where('governance_status', '=', 'DRAFT')
        .executeTakeFirst();
      return deleted.numDeletedRows === 1n;
    },

    async diffAgainstPreviousPublished(command) {
      const current = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        false,
      );
      if (!current) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
      if (current.governanceObjectId !== command.governanceObjectId) {
        throw new Error('PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH');
      }
      const previous = await database
        .selectFrom('price_list.price_list_release')
        .select('price_list_release_id')
        .where('price_list_id', '=', command.priceListId)
        .where('governance_status', '=', 'PUBLISHED')
        .where('release_no', '<', current.releaseNo)
        .orderBy('release_no', 'desc')
        .limit(1)
        .executeTakeFirst();
      if (!previous) {
        return current.entries.map((entry) => ({
          kind: 'ADDED' as const,
          businessKey: priceEntryBusinessKey(entry),
          previousEntry: null,
          currentEntry: entry,
        }));
      }
      const prior = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        previous.price_list_release_id,
        false,
      ).then(requireRelease);
      return comparePriceEntries(prior.entries, current.entries);
    },

    async prepareDraftPublication(command) {
      const draft = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        true,
      ).then(requireRelease);
      if (draft.governanceObjectId !== command.governanceObjectId) {
        throw new Error('PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH');
      }
      if (draft.governanceStatus !== 'DRAFT') {
        throw new Error('PRICE_LIST_PUBLICATION_STATE_CONFLICT');
      }
      return {
        governanceObjectId: command.governanceObjectId,
        priceListId: draft.priceListId,
        priceListReleaseId: draft.priceListReleaseId,
        contentHash: draft.contentHash,
        projection: {
          priceListId: draft.priceListId,
          priceListReleaseId: draft.priceListReleaseId,
          releaseNo: draft.releaseNo,
          priceListCode: draft.priceListCode,
          displayName: draft.displayName,
          currencyCode: draft.currencyCode,
          businessValidFrom: draft.businessValidFrom,
          businessValidTo: draft.businessValidTo,
          recordedFrom: draft.recordedFrom,
          contentHash: digestHex(draft.contentHash),
          entries: draft.entries,
        },
      };
    },

    async prepareReleaseProjection(command) {
      const release = await loadReleaseView(
        database,
        chargeCatalog,
        command.priceListId,
        command.priceListReleaseId,
        false,
      ).then(requireRelease);
      if (release.governanceObjectId !== command.governanceObjectId) {
        throw new Error('PRICE_LIST_GOVERNANCE_OBJECT_MISMATCH');
      }
      return preparedPublicationFromRelease(command.governanceObjectId, release);
    },

    async preparePublication(command) {
      validatePriceListTimes(command);
      if (command.entries.length === 0) throw new Error('PRICE_LIST_ENTRIES_REQUIRED');
      if (!/^[A-Z]{3}$/u.test(command.currencyCode)) throw new Error('CURRENCY_CODE_INVALID');

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
          .select('release_no')
          .where('price_list_id', '=', priceList.price_list_id)
          .orderBy('release_no', 'desc')
          .limit(1)
          .executeTakeFirst();
        releaseNo = (BigInt(latestRelease?.release_no ?? '0') + 1n).toString();
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

      const projectionEntries = await buildProjectionEntries(
        database,
        chargeCatalog,
        command.currencyCode,
        command.entries,
      );

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
          business_status: command.businessValidFrom > command.recordedFrom ? 'PLANNED' : 'ACTIVE',
          governance_release_id: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
        })
        .execute();

      await insertProjectionEntries(database, priceListReleaseId, projectionEntries);

      return {
        governanceObjectId: command.governanceObjectId,
        priceListId: priceList.price_list_id,
        priceListReleaseId,
        contentHash,
        projection: { ...releaseContent, contentHash: digestHex(contentHash) },
      };
    },

    async confirmPublication(command) {
      const draft = await database
        .selectFrom('price_list.price_list_release')
        .select(['price_list_id', 'recorded_from'])
        .where('price_list_release_id', '=', command.priceListReleaseId)
        .where('governance_status', '=', 'DRAFT')
        .forUpdate()
        .executeTakeFirst();
      if (!draft) throw new Error('PRICE_LIST_PUBLICATION_STATE_CONFLICT');
      const current = await database
        .selectFrom('price_list.price_list_release')
        .select(['price_list_release_id', 'recorded_from'])
        .where('price_list_id', '=', draft.price_list_id)
        .where('governance_status', '=', 'PUBLISHED')
        .where('recorded_to', 'is', null)
        .orderBy('release_no', 'desc')
        .limit(1)
        .forUpdate()
        .executeTakeFirst();
      if (current) {
        if (draft.recorded_from <= current.recorded_from) {
          throw new Error('PRICE_LIST_RECORDED_TIME_CONFLICT');
        }
        const closed = await database
          .updateTable('price_list.price_list_release')
          .set({ recorded_to: draft.recorded_from })
          .where('price_list_release_id', '=', current.price_list_release_id)
          .where('recorded_to', 'is', null)
          .executeTakeFirst();
        if (closed.numUpdatedRows !== 1n) throw new Error('PRICE_LIST_CURRENT_RELEASE_CLOSE_CONFLICT');
      }
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
      hitControlledPublicationFault('DOMAIN_CANDIDATE_CONFIRMED');
    },

    async getPublishedView(command) {
      const releases = await database
        .selectFrom('price_list.price_list_release as release')
        .innerJoin('price_list.price_list as list', 'list.price_list_id', 'release.price_list_id')
        .select([
          'release.price_list_release_id as price_list_release_id',
          'release.content_hash as content_hash',
          'release.business_status as business_status',
        ])
        .where('release.price_list_id', '=', command.priceListId)
        .where('list.governance_object_id', '=', command.governanceObjectId)
        .where('release.governance_status', '=', 'PUBLISHED')
        .where(sql<boolean>`release.business_period @> ${command.serviceOccurredAt}::timestamp`)
        .where(sql<boolean>`release.recorded_period @> ${command.recordAsOf}::timestamp`)
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
      if (await emergencyControl.isPriceReleaseSuspended({
        priceListReleaseId: release.price_list_release_id,
        campusId: command.campusId,
        serviceOccurredAt: command.serviceOccurredAt,
        recordAsOf: command.recordAsOf,
      })) {
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
  return module;
}

async function buildProjectionEntries(
  database: Kysely<DB>,
  chargeCatalog: ChargeCatalogModule,
  currencyCode: string,
  entries: readonly PriceEntryInput[],
  entryNoOffset = 0,
): Promise<PriceListProjection['entries']> {
  const references = await Promise.all(
    entries.map((entry) =>
      chargeCatalog.getPublishedReference({
        chargeItemId: entry.chargeItemId,
        chargeItemVersionId: entry.chargeItemVersionId,
      }),
    ),
  );
  const projectionEntries: PriceListProjection['entries'] = [];
  for (const [index, entry] of entries.entries()) {
    const reference = references[index];
    if (!reference) throw new Error('CHARGE_ITEM_REFERENCE_MISSING');
    if (reference.billingUnitCode !== entry.billingUnitCode) {
      throw new Error('PRICE_ENTRY_BILLING_UNIT_MISMATCH');
    }
    validatePriceEntryDimensions(entry);
    const fixedUnitPrice = normalizeMoney(entry.fixedUnitPrice);
    const priceEntryId = await nextUuid(database);
    const entryNo = (entryNoOffset + index + 1).toString();
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
      currencyCode,
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
  return projectionEntries;
}

function validatePriceEntryDimensions(entry: PriceEntryInput): void {
  parseLocalDateTime(entry.businessValidFrom);
  if (entry.businessValidTo) parseLocalDateTime(entry.businessValidTo);
  if (entry.scopeLevel === 'HOSPITAL' ? entry.campusId !== null : entry.campusId === null) {
    throw new Error('PRICE_ENTRY_SCOPE_INVALID');
  }
  if (
    entry.encounterMode === 'GENERAL'
      ? entry.encounterType !== null
      : entry.encounterType === null
  ) {
    throw new Error('PRICE_ENTRY_ENCOUNTER_MODE_INVALID');
  }
  if (entry.businessValidTo && entry.businessValidTo <= entry.businessValidFrom) {
    throw new Error('PRICE_ENTRY_BUSINESS_PERIOD_INVALID');
  }
  const normalized = normalizeMoney(entry.fixedUnitPrice);
  if (normalized === '0.0000' && !entry.zeroPriceReason?.trim()) {
    throw new Error('ZERO_PRICE_REASON_REQUIRED');
  }
  if (normalized !== '0.0000' && entry.zeroPriceReason !== null) {
    throw new Error('ZERO_PRICE_REASON_NOT_ALLOWED');
  }
}

function validatePriceListTimes(command: {
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
}): void {
  parseLocalDateTime(command.businessValidFrom);
  if (command.businessValidTo) parseLocalDateTime(command.businessValidTo);
  parseLocalDateTime(command.recordedFrom);
  if (command.businessValidTo && command.businessValidTo <= command.businessValidFrom) {
    throw new Error('PRICE_LIST_BUSINESS_PERIOD_INVALID');
  }
}

async function insertProjectionEntries(
  database: Kysely<DB>,
  priceListReleaseId: string,
  entries: PriceListProjection['entries'],
): Promise<void> {
  for (const entry of entries) {
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
}

async function loadReleaseView(
  database: Kysely<DB>,
  chargeCatalog: ChargeCatalogModule,
  priceListId: string,
  priceListReleaseId: string,
  forUpdate: boolean,
): Promise<PriceListReleaseView | null> {
  let query = database
    .selectFrom('price_list.price_list_release as release')
    .innerJoin('price_list.price_list as list', 'list.price_list_id', 'release.price_list_id')
    .select([
      'list.governance_object_id as governanceObjectId',
      'list.price_list_id as priceListId',
      'list.price_list_code as priceListCode',
      'release.price_list_release_id as priceListReleaseId',
      'release.release_no as releaseNo',
      'release.display_name as displayName',
      'release.currency_code as currencyCode',
      'release.business_valid_from as businessValidFrom',
      'release.business_valid_to as businessValidTo',
      'release.recorded_from as recordedFrom',
      'release.recorded_to as recordedTo',
      'release.governance_status as governanceStatus',
      'release.governance_release_id as governanceReleaseId',
      'release.business_status as businessStatus',
      'release.content_hash as contentHash',
    ])
    .where('list.price_list_id', '=', priceListId)
    .where('release.price_list_release_id', '=', priceListReleaseId);
  if (forUpdate) query = query.forUpdate();
  const row = await query.executeTakeFirst();
  if (!row) return null;
  const entries = await loadProjectionEntries(database, chargeCatalog, priceListReleaseId);
  return {
    ...row,
    governanceStatus: row.governanceStatus as PriceListReleaseView['governanceStatus'],
    businessStatus: row.businessStatus as PriceListReleaseView['businessStatus'],
    entries,
  };
}

async function loadProjectionEntries(
  database: Kysely<DB>,
  chargeCatalog: ChargeCatalogModule,
  priceListReleaseId: string,
): Promise<PriceListProjection['entries']> {
  const rows = await database
    .selectFrom('price_list.price_entry as entry')
    .innerJoin(
      'price_list.price_entry_charge_item_target as target',
      'target.price_entry_id',
      'entry.price_entry_id',
    )
    .select([
      'entry.entry_no as entryNo',
      'entry.price_entry_id as priceEntryId',
      'target.charge_item_id as chargeItemId',
      'target.charge_item_version_id as chargeItemVersionId',
      'entry.scope_level as scopeLevel',
      'entry.campus_id as campusId',
      'entry.encounter_mode as encounterMode',
      'entry.encounter_type as encounterType',
      'entry.fixed_unit_price as fixedUnitPrice',
      'entry.currency_code as currencyCode',
      'entry.billing_unit_code as billingUnitCode',
      'entry.business_valid_from as businessValidFrom',
      'entry.business_valid_to as businessValidTo',
      'entry.price_nature as priceNature',
      'entry.zero_price_reason as zeroPriceReason',
      'entry.content_hash as contentHash',
    ])
    .where('entry.price_list_release_id', '=', priceListReleaseId)
    .orderBy('entry.entry_no', 'asc')
    .execute();
  return Promise.all(rows.map(async (row) => {
    const reference = await chargeCatalog.getPublishedReference({
      chargeItemId: row.chargeItemId,
      chargeItemVersionId: row.chargeItemVersionId,
    });
    return {
      ...row,
      chargeItemInternalCode: reference.internalCode,
      scopeLevel: row.scopeLevel as 'HOSPITAL' | 'CAMPUS',
      encounterMode: row.encounterMode as 'GENERAL' | 'SPECIFIC',
      encounterType: row.encounterType as EncounterType | null,
      priceNature: row.priceNature as 'HOSPITAL_DEFAULT' | 'CAMPUS_DIFFERENCE',
      contentHash: digestHex(row.contentHash),
    };
  }));
}

function requireRelease(view: PriceListReleaseView | null): PriceListReleaseView {
  if (!view) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
  return view;
}

function preparedPublicationFromRelease(
  governanceObjectId: string,
  release: PriceListReleaseView,
): PreparedPriceListPublication {
  return {
    governanceObjectId,
    priceListId: release.priceListId,
    priceListReleaseId: release.priceListReleaseId,
    contentHash: release.contentHash,
    projection: {
      priceListId: release.priceListId,
      priceListReleaseId: release.priceListReleaseId,
      releaseNo: release.releaseNo,
      priceListCode: release.priceListCode,
      displayName: release.displayName,
      currencyCode: release.currencyCode,
      businessValidFrom: release.businessValidFrom,
      businessValidTo: release.businessValidTo,
      recordedFrom: release.recordedFrom,
      contentHash: digestHex(release.contentHash),
      entries: release.entries,
    },
  };
}

function priceEntryBusinessKey(entry: PriceListProjection['entries'][number]): string {
  return [
    entry.chargeItemId,
    entry.chargeItemVersionId,
    entry.scopeLevel,
    entry.campusId ?? '',
    entry.encounterMode,
    entry.encounterType ?? '',
    entry.billingUnitCode,
  ].join('|');
}

function comparePriceEntries(
  previous: PriceListProjection['entries'],
  current: PriceListProjection['entries'],
): readonly PriceListDifference[] {
  const prior = new Map(previous.map((entry) => [priceEntryBusinessKey(entry), entry]));
  const next = new Map(current.map((entry) => [priceEntryBusinessKey(entry), entry]));
  const differences: PriceListDifference[] = [];
  for (const [businessKey, previousEntry] of prior) {
    const currentEntry = next.get(businessKey);
    if (!currentEntry) {
      differences.push({ kind: 'REMOVED', businessKey, previousEntry, currentEntry: null });
      continue;
    }
    if (
      previousEntry.fixedUnitPrice !== currentEntry.fixedUnitPrice ||
      previousEntry.currencyCode !== currentEntry.currencyCode
    ) {
      differences.push({ kind: 'PRICE_CHANGED', businessKey, previousEntry, currentEntry });
    }
    if (
      previousEntry.businessValidFrom !== currentEntry.businessValidFrom ||
      previousEntry.businessValidTo !== currentEntry.businessValidTo
    ) {
      differences.push({ kind: 'APPLICABILITY_CHANGED', businessKey, previousEntry, currentEntry });
    }
  }
  for (const [businessKey, currentEntry] of next) {
    if (!prior.has(businessKey)) {
      differences.push({ kind: 'ADDED', businessKey, previousEntry: null, currentEntry });
    }
  }
  return differences;
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
