import type { Transaction } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import { createAuditModule, type AuditModule } from '../modules/audit/index.js';
import {
  createAuthorizationModule,
  type AuthorizationModule,
} from '../modules/authorization/index.js';
import {
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
  CHARGE_CATALOG_PROJECTION_TYPE,
  ChargeCatalogProjectionSchema,
  createChargeCatalogModule,
  type ChargeCatalogModule,
} from '../modules/charge-catalog/index.js';
import {
  createPriceListModule,
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_TYPE,
  PriceListLegacyProjectionSchema,
  PriceListProjectionSchema,
  type PriceListModule,
} from '../modules/price-list/index.js';
import {
  createPriceResolutionModule,
  type PriceResolutionModule,
} from '../modules/price-resolution/index.js';
import {
  createReleaseDistributionModule,
  type ProjectionContractRegistration,
  type ReleaseDistributionModule,
} from '../modules/release-distribution/index.js';
import { createWorkflowModule, type WorkflowModule } from '../modules/workflow/index.js';

export interface ScopedModules {
  readonly audit: AuditModule;
  readonly authorization: AuthorizationModule;
  readonly chargeCatalog: ChargeCatalogModule;
  readonly priceList: PriceListModule;
  readonly priceResolution: PriceResolutionModule;
  readonly releaseDistribution: ReleaseDistributionModule;
  readonly workflow: WorkflowModule;
}

export const PHASE_01_PROJECTION_CONTRACTS: readonly ProjectionContractRegistration[] = [
  {
    projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
    schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
    schema: ChargeCatalogProjectionSchema,
  },
  {
    projectionType: PRICE_LIST_PROJECTION_TYPE,
    schemaVersion: PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
    schema: PriceListLegacyProjectionSchema,
  },
  {
    projectionType: PRICE_LIST_PROJECTION_TYPE,
    schemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
    schema: PriceListProjectionSchema,
  },
];

export function createScopedModules(
  transaction: Transaction<DB>,
  context: RequestContext,
): ScopedModules {
  const chargeCatalog = createChargeCatalogModule(transaction);
  const priceList = createPriceListModule(transaction, chargeCatalog);
  return {
    audit: createAuditModule(transaction, context),
    authorization: createAuthorizationModule(transaction, context),
    chargeCatalog,
    priceList,
    priceResolution: createPriceResolutionModule(transaction, priceList),
    releaseDistribution: createReleaseDistributionModule(
      transaction,
      PHASE_01_PROJECTION_CONTRACTS,
      context,
    ),
    workflow: createWorkflowModule(transaction, context),
  };
}
