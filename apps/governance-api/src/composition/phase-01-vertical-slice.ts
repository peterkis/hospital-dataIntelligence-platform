import type {
  RequestContext,
  TransactionRunner,
} from '../platform/transaction/transaction-runner.js';
import {
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
  CHARGE_CATALOG_PROJECTION_TYPE,
} from '../modules/charge-catalog/index.js';
import {
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_TYPE,
  type EncounterType,
} from '../modules/price-list/index.js';
import type { ScopedModules } from './create-scoped-modules.js';

export interface Phase01VerticalSlice {
  publishChargeItem(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly catalogCode: string;
      readonly internalCode: string;
      readonly formalName: string;
      readonly serviceDefinition: string;
      readonly billingUnitCode: string;
      readonly chargingMethodCode: string;
      readonly businessValidFrom: string;
      readonly businessValidTo: string | null;
      readonly changeReason: string;
    },
  ): Promise<{
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
    readonly releaseId: string;
    readonly snapshotId: string;
    readonly eventId: string;
    readonly recordedAt: string;
  }>;
  publishPriceList(
    context: RequestContext,
    command: {
      readonly governanceObjectId: string;
      readonly priceListCode: string;
      readonly displayName: string;
      readonly currencyCode: string;
      readonly businessValidFrom: string;
      readonly businessValidTo: string | null;
      readonly changeReason: string;
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
    },
  ): Promise<{
    readonly priceListId: string;
    readonly priceListReleaseId: string;
    readonly releaseId: string;
    readonly snapshotId: string;
    readonly eventId: string;
    readonly recordedAt: string;
  }>;
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
  options?: { readonly onPublicationCommitted?: () => void },
): Phase01VerticalSlice {
  return {
    async publishChargeItem(context, command) {
      const result = await transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'CHARGE_CATALOG_PUBLISH',
        });
        const prepared = await modules.chargeCatalog.prepareInitialPublication({
          ...command,
          recordedFrom: context.occurredAt,
          actorPrincipalId: context.actorPrincipalId,
        });
        await modules.workflow.approveInitialPublication({
          governanceObjectId: command.governanceObjectId,
          stableEntityId: prepared.chargeItemId,
          entityVersionId: prepared.chargeItemVersionId,
          submittedContentHash: prepared.contentHash,
          changeReason: command.changeReason,
        });
        const publication = await modules.releaseDistribution.registerPublication({
          governanceObjectId: command.governanceObjectId,
          aggregateType: 'CHARGE_CATALOG',
          businessValidFrom: command.businessValidFrom,
          businessValidTo: command.businessValidTo,
          recordedFrom: context.occurredAt,
          submittedBy: context.actorPrincipalId,
          approvedBy: context.actorPrincipalId,
          approvedAt: context.occurredAt,
          changeReason: command.changeReason,
          projection: {
            projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
            schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
            payload: prepared.projection,
            itemCount: prepared.projection.items.length,
          },
          member: {
            kind: 'CHARGE_ITEM',
            stableId: prepared.chargeItemId,
            versionId: prepared.chargeItemVersionId,
            snapshotName: command.formalName,
            memberHash: prepared.contentHash,
          },
        });
        await modules.chargeCatalog.confirmPublication({
          chargeItemVersionId: prepared.chargeItemVersionId,
          releaseId: publication.releaseId,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: prepared.chargeItemId,
          entityVersionId: prepared.chargeItemVersionId,
          action: 'PUBLISHED',
          afterHash: prepared.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT',
        });
        return {
          chargeItemId: prepared.chargeItemId,
          chargeItemVersionId: prepared.chargeItemVersionId,
          releaseId: publication.releaseId,
          snapshotId: publication.snapshotId,
          eventId: publication.eventId,
          recordedAt: context.occurredAt,
        };
      });
      signalPublicationCommitted(options?.onPublicationCommitted);
      return result;
    },

    async publishPriceList(context, command) {
      const result = await transactionRunner.run(context, async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: command.governanceObjectId,
          permissionCode: 'PRICE_LIST_PUBLISH',
        });
        const prepared = await modules.priceList.preparePublication({
          ...command,
          recordedFrom: context.occurredAt,
          actorPrincipalId: context.actorPrincipalId,
        });
        await modules.workflow.approveInitialPublication({
          governanceObjectId: command.governanceObjectId,
          stableEntityId: prepared.priceListId,
          entityVersionId: prepared.priceListReleaseId,
          submittedContentHash: prepared.contentHash,
          changeReason: command.changeReason,
        });
        const publication = await modules.releaseDistribution.registerPublication({
          governanceObjectId: command.governanceObjectId,
          aggregateType: 'PRICE_LIST',
          businessValidFrom: command.businessValidFrom,
          businessValidTo: command.businessValidTo,
          recordedFrom: context.occurredAt,
          submittedBy: context.actorPrincipalId,
          approvedBy: context.actorPrincipalId,
          approvedAt: context.occurredAt,
          changeReason: command.changeReason,
          projection: {
            projectionType: PRICE_LIST_PROJECTION_TYPE,
            schemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
            payload: prepared.projection,
            itemCount: prepared.projection.entries.length,
          },
          member: {
            kind: 'PRICE_LIST',
            stableId: prepared.priceListId,
            versionId: prepared.priceListReleaseId,
            snapshotName: command.displayName,
            memberHash: prepared.contentHash,
          },
        });
        await modules.priceList.confirmPublication({
          priceListReleaseId: prepared.priceListReleaseId,
          governanceReleaseId: publication.releaseId,
        });
        await modules.audit.append({
          auditStreamId: command.governanceObjectId,
          governanceObjectId: command.governanceObjectId,
          entityType: 'PRICE_LIST_RELEASE',
          stableEntityId: prepared.priceListId,
          entityVersionId: prepared.priceListReleaseId,
          action: 'PUBLISHED',
          afterHash: prepared.contentHash,
          authorityScope: 'GOVERNANCE_OBJECT',
        });
        return {
          priceListId: prepared.priceListId,
          priceListReleaseId: prepared.priceListReleaseId,
          releaseId: publication.releaseId,
          snapshotId: publication.snapshotId,
          eventId: publication.eventId,
          recordedAt: context.occurredAt,
        };
      });
      signalPublicationCommitted(options?.onPublicationCommitted);
      return result;
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

function signalPublicationCommitted(callback: (() => void) | undefined): void {
  if (!callback) return;
  try {
    callback();
  } catch {
    // The durable database poll remains authoritative if the best-effort wake signal is lost.
  }
}
