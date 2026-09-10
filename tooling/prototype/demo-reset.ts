import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Kysely } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createScopedModules, type ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createPhase01VerticalSlice } from '../../apps/governance-api/src/composition/phase-01-vertical-slice.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';
import {
  PROTOTYPE_DEMO,
  PROTOTYPE_DEMO_AUDIT_TARGET,
  PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS,
  assertSyntheticPrototypeDemoFixture,
} from '../../apps/governance-api/src/prototype-demo-fixture.js';
import {
  assertPrototypeDemoCounts,
  getPrototypeDemoCounts,
} from '../../apps/governance-api/src/prototype-demo.js';

process.env['TZ'] = 'Asia/Shanghai';

const reportPath = resolve(import.meta.dirname, '../../demo-ready-report.json');
const databaseHandle = createDatabase({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-prototype-demo-prepare',
  max: 2,
});

try {
  assertSyntheticPrototypeDemoFixture();
  const migrationIdsBefore = await loadMigrationIds(databaseHandle.database);
  const insertedMetadataRows = await seedDemoMetadata(databaseHandle.database);
  const transactionRunner = createTransactionRunner<ScopedModules>(
    databaseHandle.database,
    (transaction, context) => createScopedModules(transaction, context, databaseHandle.database),
  );
  const verticalSlice = createPhase01VerticalSlice(transactionRunner);
  const workflow = createWorkflowApplication(transactionRunner);

  await cleanAbandonedDemoDrafts(databaseHandle.database, verticalSlice);
  const publishedCharges: PublishedCharge[] = [];
  let createdBusinessObjects = 0;
  for (const [index, fixture] of PROTOTYPE_DEMO.chargeItems.entries()) {
    const result = await ensureChargeItem(
      databaseHandle.database,
      verticalSlice,
      workflow,
      fixture,
      index,
    );
    publishedCharges.push(result.published);
    createdBusinessObjects += result.created ? 1 : 0;
  }

  const publishedPriceLists: PublishedPriceList[] = [];
  for (const [index, fixture] of PROTOTYPE_DEMO.priceLists.entries()) {
    const result = await ensurePriceList(
      databaseHandle.database,
      verticalSlice,
      workflow,
      fixture,
      publishedCharges[fixture.chargeItemIndex]!,
      index,
    );
    publishedPriceLists.push(result.published);
    createdBusinessObjects += result.created ? 1 : 0;
  }

  await ensureResolution(
    databaseHandle.database,
    verticalSlice,
    publishedCharges[0]!,
    publishedPriceLists[0]!,
  );
  const auditEventsAdded = await padAuditEvents(databaseHandle.database, verticalSlice, publishedCharges[0]!);
  const report = assertPrototypeDemoCounts(await getPrototypeDemoCounts(databaseHandle.database));
  const migrationIdsAfter = await loadMigrationIds(databaseHandle.database);
  if (migrationIdsBefore.join('|') !== migrationIdsAfter.join('|')) {
    throw new Error('PROTOTYPE_DEMO_MIGRATION_STATE_CHANGED');
  }
  await assertNoNonSyntheticIdentity(databaseHandle.database);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    ...report,
    seedIdempotent: insertedMetadataRows === 0 && createdBusinessObjects === 0 && auditEventsAdded === 0,
    migrationCount: migrationIdsAfter.length,
    migrationStatePreserved: true,
    report: 'demo-ready-report.json',
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    errorCode: safeErrorCode(error, 'PROTOTYPE_DEMO_PREPARE_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  await databaseHandle.close();
}

type VerticalSlice = ReturnType<typeof createPhase01VerticalSlice>;
type Workflow = ReturnType<typeof createWorkflowApplication>;

interface PublishedCharge {
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly contentHash: Buffer;
}

interface PublishedPriceList {
  readonly priceListId: string;
  readonly priceListReleaseId: string;
  readonly recordedFrom: string;
}

async function seedDemoMetadata(database: Kysely<DB>): Promise<number> {
  let inserted = 0;
  for (const campus of PROTOTYPE_DEMO.campuses) {
    const result = await database.insertInto('platform.campus').values({
      campus_id: campus.campusId,
      campus_code: campus.campusCode,
      display_name: campus.displayName,
    }).onConflict((conflict) => conflict.column('campus_id').doNothing()).executeTakeFirst();
    inserted += Number(result.numInsertedOrUpdatedRows ?? 0n);
  }

  const governanceObjects = [
    {
      id: PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
      code: PROTOTYPE_DEMO.chargeCatalog.objectCode,
      type: 'CHARGE_CATALOG' as const,
      name: PROTOTYPE_DEMO.chargeCatalog.displayName,
    },
    ...PROTOTYPE_DEMO.priceLists.map((priceList) => ({
      id: priceList.governanceObjectId,
      code: priceList.objectCode,
      type: 'PRICE_LIST' as const,
      name: priceList.displayName,
    })),
  ];
  for (const object of governanceObjects) {
    const result = await database.insertInto('platform.governance_object').values({
      governance_object_id: object.id,
      object_code: object.code,
      object_type: object.type,
      display_name: object.name,
      created_by: PROTOTYPE_FIXTURE.actorPrincipalId,
    }).onConflict((conflict) => conflict.column('governance_object_id').doNothing()).executeTakeFirst();
    inserted += Number(result.numInsertedOrUpdatedRows ?? 0n);
  }

  const permissions = [
    ...permissionsForChargeObject(PROTOTYPE_DEMO.chargeCatalog.governanceObjectId),
    ...PROTOTYPE_DEMO.priceLists.flatMap((priceList) => permissionsForPriceObject(priceList.governanceObjectId)),
  ];
  for (const permission of permissions) {
    const result = await database.insertInto('access_control.object_permission_grant').values({
      governance_object_id: permission.governanceObjectId,
      security_principal_id: permission.principalId,
      permission_code: permission.permissionCode,
      grant_effect: 'ALLOW',
      valid_from: '2026-01-01 00:00:00',
      valid_to: null,
      grant_sequence: '1',
      granted_by: PROTOTYPE_FIXTURE.actorPrincipalId,
      reason: 'PV004 DEMO SYNTHETIC MINIMUM PERMISSION',
      scope_level: 'HOSPITAL',
      campus_id: null,
    }).onConflict((conflict) => conflict.columns([
      'governance_object_id',
      'security_principal_id',
      'permission_code',
      'grant_sequence',
    ]).doNothing()).executeTakeFirst();
    inserted += Number(result.numInsertedOrUpdatedRows ?? 0n);
  }
  return inserted;
}

function permissionsForChargeObject(governanceObjectId: string) {
  return [
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE_CATALOG_DRAFT_READ'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE_CATALOG_DRAFT_WRITE'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE_CATALOG_SUBMIT'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT_READ'],
    [PROTOTYPE_FIXTURE.reviewerPrincipalId, 'CHARGE_CATALOG_REVIEW'],
    [PROTOTYPE_FIXTURE.approverPrincipalId, 'CHARGE_CATALOG_APPROVE'],
  ].map(([principalId, permissionCode]) => ({ governanceObjectId, principalId: principalId!, permissionCode: permissionCode! }));
}

function permissionsForPriceObject(governanceObjectId: string) {
  return [
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_LIST_DRAFT_READ'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_LIST_DRAFT_WRITE'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_LIST_SUBMIT'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE_RESOLVE'],
    [PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT_READ'],
    [PROTOTYPE_FIXTURE.reviewerPrincipalId, 'CAMPUS_PRICE_CONFIRM'],
    [PROTOTYPE_FIXTURE.reviewerPrincipalId, 'PRICE_LIST_REVIEW'],
    [PROTOTYPE_FIXTURE.approverPrincipalId, 'PRICE_LIST_APPROVE'],
  ].map(([principalId, permissionCode]) => ({ governanceObjectId, principalId: principalId!, permissionCode: permissionCode! }));
}

async function cleanAbandonedDemoDrafts(database: Kysely<DB>, verticalSlice: VerticalSlice): Promise<void> {
  const expectedCodes = new Set<string>(PROTOTYPE_DEMO.chargeItems.map((item) => item.internalCode));
  const rows = await database.selectFrom('charge_catalog.charge_item as item')
    .innerJoin('charge_catalog.charge_item_version as version', 'version.charge_item_id', 'item.charge_item_id')
    .select([
      'item.charge_item_id as chargeItemId',
      'item.internal_code as internalCode',
      'version.charge_item_version_id as versionId',
      'version.governance_status as status',
    ])
    .where('item.governance_object_id', '=', PROTOTYPE_DEMO.chargeCatalog.governanceObjectId)
    .where('item.internal_code', 'like', 'PV004-DEMO-%')
    .execute();
  for (const row of rows) {
    if (expectedCodes.has(row.internalCode)) continue;
    if (row.status !== 'DRAFT') throw new Error('PROTOTYPE_DEMO_NAMESPACE_CONTAINS_IMMUTABLE_HISTORY');
    await verticalSlice.deleteChargeItemDraft(
      requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, `CLEAN-${row.internalCode}`, '2026-09-03T08:50:00'),
      {
        governanceObjectId: PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
        chargeItemId: row.chargeItemId,
        chargeItemVersionId: row.versionId,
      },
    );
  }
}

async function ensureChargeItem(
  database: Kysely<DB>,
  verticalSlice: VerticalSlice,
  workflow: Workflow,
  fixture: (typeof PROTOTYPE_DEMO.chargeItems)[number],
  index: number,
): Promise<{ readonly created: boolean; readonly published: PublishedCharge }> {
  const existing = await loadChargeVersions(database, fixture.internalCode);
  let created = false;
  let published = existing.find((version) => version.governanceStatus === 'PUBLISHED');
  if (!published) {
    let draft = existing.find((version) => version.governanceStatus === 'DRAFT');
    if (!draft) {
      draft = await verticalSlice.createChargeItemDraft(
        requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, `CHARGE-${index + 1}-CREATE`, fixture.times[0]),
        {
          governanceObjectId: PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
          internalCode: fixture.internalCode,
          formalName: fixture.formalName,
          serviceDefinition: fixture.serviceDefinition,
          billingUnitCode: fixture.billingUnitCode,
          chargingMethodCode: fixture.chargingMethodCode,
          businessValidFrom: fixture.businessValidFrom,
          businessValidTo: null,
        },
      );
      created = true;
    }
    await completeWorkflow(database, workflow, {
      governanceObjectId: PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
      entityType: 'CHARGE_ITEM_VERSION',
      stableEntityId: draft.chargeItemId,
      entityVersionId: draft.chargeItemVersionId,
      contentDigest: digestHex(draft.contentHash),
      changeKind: 'INITIAL_PUBLICATION',
      riskClassification: 'NORMAL',
      campusId: null,
      catalogCode: PROTOTYPE_DEMO.chargeCatalog.catalogCode,
      times: fixture.times.slice(1, 4),
      actionPrefix: `CHARGE-${index + 1}`,
    });
    published = (await loadChargeVersions(database, fixture.internalCode))
      .find((version) => version.governanceStatus === 'PUBLISHED');
  }
  if (!published) throw new Error('PROTOTYPE_DEMO_CHARGE_PUBLICATION_MISSING');
  verifyPublishedCharge(published, fixture);

  const current = await loadChargeVersions(database, fixture.internalCode);
  if (!current.some((version) => version.governanceStatus === 'DRAFT')) {
    await verticalSlice.createChargeItemVersionDraft(
      requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, `CHARGE-${index + 1}-VERSION-DRAFT`, fixture.times[4]),
      {
        governanceObjectId: PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
        chargeItemId: published.chargeItemId,
        formalName: fixture.formalName,
        serviceDefinition: `${fixture.serviceDefinition}（演示修订候选）`,
        billingUnitCode: fixture.billingUnitCode,
        chargingMethodCode: fixture.chargingMethodCode,
        businessValidFrom: '2026-10-01T00:00:00',
        businessValidTo: null,
      },
    );
    created = true;
  }
  return { created, published };
}

async function ensurePriceList(
  database: Kysely<DB>,
  verticalSlice: VerticalSlice,
  workflow: Workflow,
  fixture: (typeof PROTOTYPE_DEMO.priceLists)[number],
  charge: PublishedCharge,
  index: number,
): Promise<{ readonly created: boolean; readonly published: PublishedPriceList }> {
  const existing = await loadPriceListRelease(database, fixture.governanceObjectId);
  let created = false;
  let release = existing;
  if (!release) {
    release = await verticalSlice.createPriceListDraft(
      requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, `PRICE-${index + 1}-CREATE`, fixture.times[0]),
      {
        governanceObjectId: fixture.governanceObjectId,
        priceListCode: fixture.priceListCode,
        displayName: fixture.displayName,
        currencyCode: 'CNY',
        businessValidFrom: fixture.businessValidFrom,
        businessValidTo: null,
        entries: [{
          chargeItemId: charge.chargeItemId,
          chargeItemVersionId: charge.chargeItemVersionId,
          scopeLevel: fixture.scopeLevel,
          campusId: fixture.campusId,
          encounterMode: fixture.encounterMode,
          encounterType: fixture.encounterType,
          fixedUnitPrice: fixture.fixedUnitPrice,
          billingUnitCode: 'TIMES',
          businessValidFrom: fixture.businessValidFrom,
          businessValidTo: null,
          zeroPriceReason: null,
        }],
      },
    );
    created = true;
  }
  if (release.governanceStatus !== 'PUBLISHED') {
    await completeWorkflow(database, workflow, {
      governanceObjectId: fixture.governanceObjectId,
      entityType: 'PRICE_LIST_RELEASE',
      stableEntityId: release.priceListId,
      entityVersionId: release.priceListReleaseId,
      contentDigest: digestHex(release.contentHash),
      changeKind: fixture.campusId ? 'CAMPUS_DIFFERENCE_PRICE' : 'INITIAL_PUBLICATION',
      riskClassification: 'HIGH',
      campusId: fixture.campusId,
      catalogCode: null,
      times: fixture.times.slice(1),
      actionPrefix: `PRICE-${index + 1}`,
    });
    release = await loadPriceListRelease(database, fixture.governanceObjectId);
  }
  if (!release || release.governanceStatus !== 'PUBLISHED' || !release.governanceReleaseId) {
    throw new Error('PROTOTYPE_DEMO_PRICE_PUBLICATION_MISSING');
  }
  if (release.displayName !== fixture.displayName || release.priceListCode !== fixture.priceListCode) {
    throw new Error('PROTOTYPE_DEMO_PRICE_FIXTURE_DRIFT');
  }
  return {
    created,
    published: {
      priceListId: release.priceListId,
      priceListReleaseId: release.priceListReleaseId,
      recordedFrom: release.recordedFrom,
    },
  };
}

async function completeWorkflow(
  database: Kysely<DB>,
  workflow: Workflow,
  input: {
    readonly governanceObjectId: string;
    readonly entityType: 'CHARGE_ITEM_VERSION' | 'PRICE_LIST_RELEASE';
    readonly stableEntityId: string;
    readonly entityVersionId: string;
    readonly contentDigest: string;
    readonly changeKind: 'INITIAL_PUBLICATION' | 'CAMPUS_DIFFERENCE_PRICE';
    readonly riskClassification: 'NORMAL' | 'HIGH';
    readonly campusId: string | null;
    readonly catalogCode: string | null;
    readonly times: readonly string[];
    readonly actionPrefix: string;
  },
): Promise<void> {
  let request = await loadChangeRequest(database, input.entityVersionId);
  if (!request) {
    request = await workflow.submit(
      requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, `${input.actionPrefix}-SUBMIT`, input.times[0]!),
      {
        governanceObjectId: input.governanceObjectId,
        entityType: input.entityType,
        stableEntityId: input.stableEntityId,
        entityVersionId: input.entityVersionId,
        changeKind: input.changeKind,
        riskClassification: input.riskClassification,
        submittedContentDigest: input.contentDigest,
        changeReason: `${input.actionPrefix} SYNTHETIC DEMO PUBLICATION`,
        campusId: input.campusId,
        frozenEvidence: input.catalogCode
          ? { catalogCode: input.catalogCode, demonstration: 'PV004-DEMO-SYNTHETIC' }
          : { demonstration: 'PV004-DEMO-SYNTHETIC' },
      },
    );
  }
  while (!['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(request.requestStatus)) {
    const next = Number(request.nextActionSequence);
    const campusWorkflow = input.changeKind === 'CAMPUS_DIFFERENCE_PRICE';
    const stageType = campusWorkflow
      ? (next === 1 ? 'CAMPUS_PRE_CONFIRMATION' : next === 2 ? 'PROFESSIONAL_REVIEW' : 'OWNER_FINAL_APPROVAL')
      : (next === 1 ? 'PROFESSIONAL_REVIEW' : 'OWNER_FINAL_APPROVAL');
    const actor = stageType === 'OWNER_FINAL_APPROVAL'
      ? PROTOTYPE_FIXTURE.approverPrincipalId
      : PROTOTYPE_FIXTURE.reviewerPrincipalId;
    const result = await workflow.act(
      requestContext(actor, `${input.actionPrefix}-${stageType}`, input.times[next]!),
      {
        changeRequestId: request.changeRequestId,
        stageType,
        actionResult: 'APPROVED',
        reason: `${input.actionPrefix} ${stageType} SYNTHETIC APPROVED`,
        seenContentDigest: input.contentDigest,
        campusId: stageType === 'CAMPUS_PRE_CONFIRMATION' ? input.campusId : null,
      },
    );
    request = result.request;
  }
  if (request.requestStatus !== 'APPROVED') throw new Error('PROTOTYPE_DEMO_WORKFLOW_NOT_APPROVED');
}

async function ensureResolution(
  database: Kysely<DB>,
  verticalSlice: VerticalSlice,
  charge: PublishedCharge,
  priceList: PublishedPriceList,
): Promise<void> {
  const existing = await database.selectFrom('price_resolution.price_resolution')
    .select('price_resolution_id')
    .where('request_id', '=', PROTOTYPE_DEMO.resolution.requestId)
    .executeTakeFirst();
  if (existing) return;
  const result = await verticalSlice.resolvePrice(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE-EXPLANATION', PROTOTYPE_DEMO.resolution.occurredAt),
    {
      governanceObjectId: PROTOTYPE_DEMO.priceLists[0].governanceObjectId,
      requestId: PROTOTYPE_DEMO.resolution.requestId,
      chargeItemId: charge.chargeItemId,
      chargeItemVersionId: charge.chargeItemVersionId,
      priceListId: priceList.priceListId,
      campusId: PROTOTYPE_DEMO.campuses[0].campusId,
      encounterType: PROTOTYPE_DEMO.resolution.encounterType,
      serviceOccurredAt: PROTOTYPE_DEMO.resolution.serviceOccurredAt,
      recordAsOf: priceList.recordedFrom,
      quantity: PROTOTYPE_DEMO.resolution.quantity,
    },
  );
  if (result.status !== 'SUCCEEDED' || result.result?.finalAmount !== '24.6800') {
    throw new Error('PROTOTYPE_DEMO_PRICE_EXPLANATION_INVALID');
  }
}

async function padAuditEvents(
  database: Kysely<DB>,
  verticalSlice: VerticalSlice,
  charge: PublishedCharge,
): Promise<number> {
  let counts = await getPrototypeDemoCounts(database);
  if (counts.auditEventCount > PROTOTYPE_DEMO_AUDIT_TARGET) {
    throw new Error('PROTOTYPE_DEMO_AUDIT_TARGET_EXCEEDED');
  }
  let added = 0;
  while (counts.auditEventCount < PROTOTYPE_DEMO_AUDIT_TARGET) {
    await verticalSlice.listChargeItemVersions(
      requestContext(
        PROTOTYPE_FIXTURE.actorPrincipalId,
        `INTEGRITY-${String(counts.auditEventCount + 1).padStart(3, '0')}`,
        '2026-09-03T10:50:00',
      ),
      {
        governanceObjectId: PROTOTYPE_DEMO.chargeCatalog.governanceObjectId,
        chargeItemId: charge.chargeItemId,
      },
    );
    added += 1;
    counts = await getPrototypeDemoCounts(database);
  }
  return added;
}

async function loadChargeVersions(database: Kysely<DB>, internalCode: string) {
  return database.selectFrom('charge_catalog.charge_item as item')
    .innerJoin('charge_catalog.charge_item_version as version', 'version.charge_item_id', 'item.charge_item_id')
    .select([
      'item.charge_item_id as chargeItemId',
      'item.internal_code as internalCode',
      'version.charge_item_version_id as chargeItemVersionId',
      'version.formal_name as formalName',
      'version.governance_status as governanceStatus',
      'version.content_hash as contentHash',
    ])
    .where('item.governance_object_id', '=', PROTOTYPE_DEMO.chargeCatalog.governanceObjectId)
    .where('item.internal_code', '=', internalCode)
    .orderBy('version.version_no')
    .execute();
}

async function loadPriceListRelease(database: Kysely<DB>, governanceObjectId: string) {
  return database.selectFrom('price_list.price_list as list')
    .innerJoin('price_list.price_list_release as release', 'release.price_list_id', 'list.price_list_id')
    .select([
      'list.price_list_id as priceListId',
      'list.price_list_code as priceListCode',
      'release.price_list_release_id as priceListReleaseId',
      'release.display_name as displayName',
      'release.governance_status as governanceStatus',
      'release.governance_release_id as governanceReleaseId',
      'release.content_hash as contentHash',
      'release.recorded_from as recordedFrom',
    ])
    .where('list.governance_object_id', '=', governanceObjectId)
    .orderBy('release.release_no', 'desc')
    .limit(1)
    .executeTakeFirst();
}

async function loadChangeRequest(database: Kysely<DB>, entityVersionId: string) {
  return database.selectFrom('workflow.change_request')
    .select([
      'change_request_id as changeRequestId',
      'request_status as requestStatus',
      'next_action_sequence as nextActionSequence',
    ])
    .where('entity_version_id', '=', entityVersionId)
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst();
}

async function loadMigrationIds(database: Kysely<DB>): Promise<string[]> {
  const migrations = await database.selectFrom('platform.schema_migration')
    .select('migration_id')
    .orderBy('migration_id')
    .execute();
  return migrations.map((migration) => migration.migration_id);
}

async function assertNoNonSyntheticIdentity(database: Kysely<DB>): Promise<void> {
  const principals = await database.selectFrom('platform.security_principal')
    .select('principal_code')
    .where('security_principal_id', 'in', [
      PROTOTYPE_FIXTURE.actorPrincipalId,
      PROTOTYPE_FIXTURE.reviewerPrincipalId,
      PROTOTYPE_FIXTURE.approverPrincipalId,
    ])
    .execute();
  if (principals.length !== 3 || principals.some((principal) => !principal.principal_code.startsWith('PROTOTYPE-SYNTHETIC-'))) {
    throw new Error('PROTOTYPE_DEMO_REAL_IDENTITY_DETECTED');
  }
  const objects = await database.selectFrom('platform.governance_object')
    .select('object_code')
    .where('governance_object_id', 'in', [...PROTOTYPE_DEMO_GOVERNANCE_OBJECT_IDS])
    .execute();
  if (objects.length !== 4 || objects.some((object) => !object.object_code.startsWith('PV004-DEMO-'))) {
    throw new Error('PROTOTYPE_DEMO_NAMESPACE_INVALID');
  }
}

function verifyPublishedCharge(
  published: Awaited<ReturnType<typeof loadChargeVersions>>[number],
  fixture: (typeof PROTOTYPE_DEMO.chargeItems)[number],
): void {
  if (published.formalName !== fixture.formalName || published.internalCode !== fixture.internalCode) {
    throw new Error('PROTOTYPE_DEMO_CHARGE_FIXTURE_DRIFT');
  }
}

function requestContext(actorPrincipalId: string, action: string, occurredAt: string) {
  return {
    actorPrincipalId,
    requestId: `PV004-DEMO-${action}`,
    correlationId: 'PV004-DEMO-PREPARE',
    occurredAt,
  };
}

function digestHex(value: Buffer): string {
  return value.toString('hex');
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}

function safeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (/^[A-Z0-9_]+$/u.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) return error.message;
  return fallback;
}
