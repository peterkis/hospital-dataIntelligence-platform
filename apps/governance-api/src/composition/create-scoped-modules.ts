import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../platform/database/database-types.generated.js';
import type { RequestContext } from '../platform/transaction/transaction-runner.js';
import { createCampusReferenceReader } from '../platform/campus/campus-reference-reader.js';
import { createConsumerReferenceReader } from '../platform/release-consumer/consumer-reference-reader.js';
import { createAuditModule, type AuditModule } from '../modules/audit/index.js';
import { createBatchImportModule, type BatchImportModule } from '../modules/batch-import/index.js';
import {
  createAuthorizationModule,
  type AuthorizationModule,
} from '../modules/authorization/index.js';
import {
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2,
  CHARGE_CATALOG_PROJECTION_TYPE,
  ChargeCatalogProjectionSchema,
  ChargeCatalogProjectionSchemaV2,
  createChargeCatalogModule,
  type ChargeCatalogModule,
} from '../modules/charge-catalog/index.js';
import {
  createPriceListModule,
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2,
  PRICE_LIST_PROJECTION_TYPE,
  PriceListLegacyProjectionSchema,
  PriceListProjectionSchema,
  PriceListProjectionSchemaV2,
  type PriceListModule,
} from '../modules/price-list/index.js';
import {
  createPriceResolutionModule,
  type PriceResolutionModule,
} from '../modules/price-resolution/index.js';
import {
  createEmergencyControlModule,
  type EmergencyControlModule,
} from '../modules/emergency-control/index.js';
import {
  createReleaseDistributionModule,
  type ProjectionContractRegistration,
  type ReleaseDistributionModule,
} from '../modules/release-distribution/index.js';
import { createWorkflowModule, type WorkflowModule } from '../modules/workflow/index.js';
import {
  createDepartmentMasterModule,
  DEPARTMENT_HIERARCHY_PROJECTION_TYPE,
  DEPARTMENT_MASTER_PROJECTION_TYPE,
  DEPARTMENT_PROJECTION_SCHEMA_VERSION,
  DepartmentHierarchyProjectionSchema,
  DepartmentMasterProjectionSchema,
  type DepartmentMasterModule,
} from '../modules/department-master/index.js';

export interface ScopedModules {
  readonly audit: AuditModule;
  readonly batchImport: BatchImportModule;
  readonly authorization: AuthorizationModule;
  readonly chargeCatalog: ChargeCatalogModule;
  readonly departmentMaster: DepartmentMasterModule;
  readonly priceList: PriceListModule;
  readonly priceResolution: PriceResolutionModule;
  readonly emergencyControl: EmergencyControlModule;
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
    projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
    schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION_V2,
    schema: ChargeCatalogProjectionSchemaV2,
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
  {
    projectionType: PRICE_LIST_PROJECTION_TYPE,
    schemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION_V2,
    schema: PriceListProjectionSchemaV2,
  },
  {
    projectionType: DEPARTMENT_MASTER_PROJECTION_TYPE,
    schemaVersion: DEPARTMENT_PROJECTION_SCHEMA_VERSION,
    schema: DepartmentMasterProjectionSchema,
  },
  {
    projectionType: DEPARTMENT_HIERARCHY_PROJECTION_TYPE,
    schemaVersion: DEPARTMENT_PROJECTION_SCHEMA_VERSION,
    schema: DepartmentHierarchyProjectionSchema,
  },
];

export function createScopedModules(
  transaction: Transaction<DB>,
  context: RequestContext,
  authorizationDecisionDatabase?: Kysely<DB>,
): ScopedModules {
  const chargeCatalog = createChargeCatalogModule(transaction);
  const emergencyControl = createEmergencyControlModule(transaction, context);
  const priceList = createPriceListModule(transaction, chargeCatalog, emergencyControl);
  const audit = createAuditModule(transaction, context);
  return {
    audit,
    batchImport: createBatchImportModule(transaction, context),
    authorization: createAuthorizationModule(
      transaction,
      context,
      authorizationDecisionDatabase,
    ),
    chargeCatalog,
    departmentMaster: createDepartmentMasterModule(
      transaction,
      audit,
      context,
      createCampusReferenceReader(transaction),
    ),
    priceList,
    priceResolution: createPriceResolutionModule(transaction, priceList),
    emergencyControl,
    releaseDistribution: createReleaseDistributionModule(
      transaction,
      PHASE_01_PROJECTION_CONTRACTS,
      context,
      createConsumerReferenceReader(transaction),
    ),
    workflow: createWorkflowModule(transaction, context),
  };
}
