import type {
  RequestContext,
  TransactionRunner,
} from '../platform/transaction/transaction-runner.js';
import {
  type ChargeItemContentInput,
  type ChargeItemVersionDifference,
  type ChargeItemVersionView,
} from '../modules/charge-catalog/index.js';
import {
  type EncounterType,
  type PriceEntryInput,
  type PriceListDifference,
  type PriceListReleaseView,
} from '../modules/price-list/index.js';
import type { ScopedModules } from './create-scoped-modules.js';

export interface Phase01VerticalSlice {
  createChargeItemDraft(
    context: RequestContext,
    command: ChargeItemContentInput & {
      readonly governanceObjectId: string;
      readonly internalCode: string;
    },
  ): Promise<ChargeItemVersionView>;
  getChargeItemVersion(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
      readonly chargeItemVersionId: string;
    },
  ): Promise<ChargeItemVersionView>;
  updateChargeItemDraft(
    context: RequestContext,
    command: ChargeItemContentInput & {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
      readonly chargeItemVersionId: string;
    },
  ): Promise<ChargeItemVersionView>;
  deleteChargeItemDraft(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
      readonly chargeItemVersionId: string;
    },
  ): Promise<void>;
  createChargeItemVersionDraft(
    context: RequestContext,
    command: ChargeItemContentInput & {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
    },
  ): Promise<ChargeItemVersionView>;
  listChargeItemVersions(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
    },
  ): Promise<readonly ChargeItemVersionView[]>;
  getChargeItemVersionAsOf(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
      readonly businessAt: string;
      readonly recordAsOf: string;
    },
  ): Promise<ChargeItemVersionView | null>;
  compareChargeItemVersions(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly chargeItemId: string;
      readonly leftVersionId: string;
      readonly rightVersionId: string;
    },
  ): Promise<readonly ChargeItemVersionDifference[]>;
  createPriceListDraft(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly priceListCode: string;
      readonly displayName: string;
      readonly currencyCode: string;
      readonly businessValidFrom: string;
      readonly businessValidTo: string | null;
      readonly entries: readonly PriceEntryInput[];
    },
  ): Promise<PriceListReleaseView>;
  getPriceListRelease(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly priceListId: string;
      readonly priceListReleaseId: string;
    },
  ): Promise<PriceListReleaseView>;
  updatePriceListDraft(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly priceListId: string;
      readonly priceListReleaseId: string;
      readonly displayName: string;
      readonly currencyCode: string;
      readonly businessValidFrom: string;
      readonly businessValidTo: string | null;
      readonly entries: readonly PriceEntryInput[];
    },
  ): Promise<PriceListReleaseView>;
  deletePriceListDraft(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly priceListId: string;
      readonly priceListReleaseId: string;
    },
  ): Promise<void>;
  diffPriceListDraft(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly priceListId: string;
      readonly priceListReleaseId: string;
    },
  ): Promise<readonly PriceListDifference[]>;
  resolvePrice(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly requestId: string;
      readonly chargeItemId: string;
      readonly chargeItemVersionId: string;
      readonly priceListId: string;
      readonly campusId: string;
      readonly encounterType: EncounterType;
      readonly serviceOccurredAt: string;
      readonly recordAsOf: string;
      readonly quantity: string;
    },
  ): Promise<Awaited<ReturnType<ScopedModules['priceResolution']['resolve']>>>;
}

export function createPhase01VerticalSlice(
  transactionRunner: TransactionRunner<ScopedModules>,
): Phase01VerticalSlice {
  return {
    createChargeItemDraft(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_WRITE',
        });
        const draft = await modules.chargeCatalog.createDraft({
          ...command,
          actorPrincipalId: context.actorPrincipalId,
          recordedFrom: context.occurredAt,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: draft.chargeItemId,
          entityVersionId: draft.chargeItemVersionId,
          action: 'DRAFT_CREATED',
          afterHash: draft.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        return draft;
      });
    },

    getChargeItemVersion(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_READ',
        });
        const version = await modules.chargeCatalog.getVersion(command);
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: version.chargeItemId,
          entityVersionId: version.chargeItemVersionId,
          action: 'DRAFT_READ',
          afterHash: version.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_READ',
        });
        return version;
      });
    },

    async updateChargeItemDraft(context, command) {
      const outcome = await transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_WRITE',
        });
        const current = await modules.chargeCatalog.lockVersionForMutation(command);
        if (current.governanceStatus !== 'DRAFT') {
          await modules.audit.append({
            auditStreamId: command.governanceObjectId,
            governanceObjectId: command.governanceObjectId,
            entityType: 'CHARGE_ITEM_VERSION',
            stableEntityId: current.chargeItemId,
            entityVersionId: current.chargeItemVersionId,
            action: 'DRAFT_MUTATION_REJECTED',
            afterHash: current.contentHash,
            authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
          });
          return { kind: 'rejected' as const };
        }
        const updated = await modules.chargeCatalog.updateDraft(command);
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: updated.chargeItemId,
          entityVersionId: updated.chargeItemVersionId,
          action: 'DRAFT_UPDATED',
          afterHash: updated.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        return { kind: 'updated' as const, updated };
      });
      if (outcome.kind === 'rejected') throw new Error('CHARGE_ITEM_DRAFT_IMMUTABLE');
      return outcome.updated;
    },

    async deleteChargeItemDraft(context, command) {
      const outcome = await transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_WRITE',
        });
        const current = await modules.chargeCatalog.lockVersionForMutation(command);
        if (current.governanceStatus !== 'DRAFT') {
          await modules.audit.append({
            auditStreamId: command.governanceObjectId,
            governanceObjectId: command.governanceObjectId,
            entityType: 'CHARGE_ITEM_VERSION',
            stableEntityId: current.chargeItemId,
            entityVersionId: current.chargeItemVersionId,
            action: 'DRAFT_MUTATION_REJECTED',
            afterHash: current.contentHash,
            authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
          });
          return 'rejected' as const;
        }
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: current.chargeItemId,
          entityVersionId: current.chargeItemVersionId,
          action: 'DRAFT_DELETED',
          afterHash: current.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        await modules.chargeCatalog.deleteDraft(command);
        return 'deleted' as const;
      });
      if (outcome === 'rejected') throw new Error('CHARGE_ITEM_DRAFT_IMMUTABLE');
    },

    createChargeItemVersionDraft(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_WRITE',
        });
        const draft = await modules.chargeCatalog.createVersionDraft({
          ...command,
          actorPrincipalId: context.actorPrincipalId,
          recordedFrom: context.occurredAt,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: draft.chargeItemId,
          entityVersionId: draft.chargeItemVersionId,
          action: 'VERSION_CANDIDATE_CREATED',
          afterHash: draft.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_VERSION',
        });
        return draft;
      });
    },

    listChargeItemVersions(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_READ',
        });
        const versions = await modules.chargeCatalog.listVersions(command);
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: command.chargeItemId,
          entityVersionId: null,
          action: 'VERSION_HISTORY_READ',
          afterHash: null,
          authorityScope: 'GOVERNANCE_OBJECT_HISTORY',
        });
        return versions;
      });
    },

    getChargeItemVersionAsOf(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_READ',
        });
        const version = await modules.chargeCatalog.getVersionAsOf(command);
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: command.chargeItemId,
          entityVersionId: version?.chargeItemVersionId ?? null,
          action: 'VERSION_AS_OF_READ',
          afterHash: version?.contentHash ?? null,
          authorityScope: 'GOVERNANCE_OBJECT_BITEMPORAL',
        });
        return version;
      });
    },

    compareChargeItemVersions(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_DRAFT_READ',
        });
        const differences = await modules.chargeCatalog.compareVersions(command);
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: command.chargeItemId,
          entityVersionId: command.rightVersionId,
          action: 'VERSION_DIFF_READ',
          afterHash: null,
          authorityScope: 'GOVERNANCE_OBJECT_HISTORY',
        });
        return differences;
      });
    },

    createPriceListDraft(context, command) {
      return transactionRunner.run(context, async (modules) => {
        for (const campusId of priceEntryAuthorizationScopes(command.entries)) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: command.governanceObjectId,
            permissionCode: 'PRICE_LIST_DRAFT_WRITE',
            campusId,
          });
        }
        const draft = await modules.priceList.createDraft({
          ...command,
          recordedFrom: context.occurredAt,
          actorPrincipalId: context.actorPrincipalId,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: draft.priceListId,
          entityVersionId: draft.priceListReleaseId,
          action: 'PRICE_LIST_DRAFT_CREATED',
          afterHash: draft.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        return draft;
      });
    },

    getPriceListRelease(context, command) {
      return transactionRunner.run(context, async (modules) => {
        const release = await modules.priceList.getRelease(command);
        if (!release) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
        for (const campusId of priceEntryAuthorizationScopes(release.entries)) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: command.governanceObjectId,
            permissionCode: 'PRICE_LIST_DRAFT_READ',
            campusId,
          });
        }
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: command.priceListId,
          entityVersionId: command.priceListReleaseId,
          action: 'PRICE_LIST_DRAFT_READ',
          afterHash: release.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        return release;
      });
    },

    async updatePriceListDraft(context, command) {
      const outcome = await transactionRunner.run(context, async (modules) => {
        const current = await modules.priceList.lockReleaseForMutation(command);
        if (!current) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
        for (const campusId of priceEntryAuthorizationScopes([...current.entries, ...command.entries])) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: command.governanceObjectId,
            permissionCode: 'PRICE_LIST_DRAFT_WRITE',
            campusId,
          });
        }
        if (current.governanceStatus !== 'DRAFT') {
          await modules.audit.append({
            auditStreamId: command.governanceObjectId,
            governanceObjectId: command.governanceObjectId,
            entityType: 'PRICE_LIST_RELEASE',
            stableEntityId: command.priceListId,
            entityVersionId: command.priceListReleaseId,
            action: 'PRICE_LIST_DRAFT_MUTATION_REJECTED',
            afterHash: current.contentHash,
            authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
          });
          return { rejected: true as const, release: current };
        }
        const release = await modules.priceList.updateDraft({
          ...command,
          recordedFrom: context.occurredAt,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: command.priceListId,
          entityVersionId: command.priceListReleaseId,
          action: 'PRICE_LIST_DRAFT_UPDATED',
          afterHash: release.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        return { rejected: false as const, release };
      });
      if (outcome.rejected) throw new Error('PRICE_LIST_DRAFT_IMMUTABLE');
      return outcome.release;
    },

    async deletePriceListDraft(context, command) {
      const rejected = await transactionRunner.run(context, async (modules) => {
        const current = await modules.priceList.lockReleaseForMutation(command);
        if (!current) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
        for (const campusId of priceEntryAuthorizationScopes(current.entries)) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: command.governanceObjectId,
            permissionCode: 'PRICE_LIST_DRAFT_WRITE',
            campusId,
          });
        }
        if (current.governanceStatus !== 'DRAFT') {
          await modules.audit.append({
            auditStreamId: command.governanceObjectId,
            governanceObjectId: command.governanceObjectId,
            entityType: 'PRICE_LIST_RELEASE',
            stableEntityId: command.priceListId,
            entityVersionId: command.priceListReleaseId,
            action: 'PRICE_LIST_DRAFT_MUTATION_REJECTED',
            afterHash: current.contentHash,
            authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
          });
          return true;
        }
        if (!(await modules.priceList.deleteDraft(command))) {
          throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
        }
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: command.priceListId,
          entityVersionId: command.priceListReleaseId,
          action: 'PRICE_LIST_DRAFT_DELETED',
          afterHash: null,
          authorityScope: 'GOVERNANCE_OBJECT_DRAFT',
        });
        return false;
      });
      if (rejected) throw new Error('PRICE_LIST_DRAFT_IMMUTABLE');
    },

    diffPriceListDraft(context, command) {
      return transactionRunner.run(context, async (modules) => {
        const current = await modules.priceList.getRelease(command);
        if (!current) throw new Error('PRICE_LIST_RELEASE_NOT_FOUND');
        for (const campusId of priceEntryAuthorizationScopes(current.entries)) {
          await modules.authorization.requireObjectPermission({
            governanceObjectId: command.governanceObjectId,
            permissionCode: 'PRICE_LIST_DRAFT_READ',
            campusId,
          });
        }
        const differences = await modules.priceList.diffAgainstPreviousPublished(command);
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: command.priceListId,
          entityVersionId: command.priceListReleaseId,
          action: 'PRICE_LIST_DRAFT_DIFF_READ',
          afterHash: null,
          authorityScope: 'GOVERNANCE_OBJECT_HISTORY',
        });
        return differences;
      });
    },

    resolvePrice(context, command) {
      return transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'PRICE_RESOLVE',
        });
        const outcome = await modules.priceResolution.resolve({
          ...command,
          resolvedAt: context.occurredAt,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_RESOLUTION',
          stableEntityId: command.chargeItemId,
          entityVersionId: outcome.priceResolutionId,
          action: 'RESOLVED',
          afterHash: outcome.result?.resultHash ?? null,
          authorityScope: 'PRICE_RESOLUTION',
        });
        return outcome;
      });
    },
  };
}

function priceEntryAuthorizationScopes(entries: readonly PriceEntryInput[]): readonly (string | null)[] {
  const scopes = new Set<string | null>();
  for (const entry of entries) {
    scopes.add(entry.scopeLevel === 'CAMPUS' ? entry.campusId : null);
  }
  return [...scopes];
}
