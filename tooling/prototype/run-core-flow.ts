import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { createScopedModules, type ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createPhase01VerticalSlice } from '../../apps/governance-api/src/composition/phase-01-vertical-slice.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

const steps = {
  chargeDraftCreated: false,
  chargeChangeSubmitted: false,
  chargeProfessionalReviewed: false,
  chargeFinalApproved: false,
  chargeItemPublished: false,
  priceListDraftCreated: false,
  priceListChangeSubmitted: false,
  priceListProfessionalReviewed: false,
  priceListFinalApproved: false,
  priceListPublished: false,
  priceResolutionSucceeded: false,
  versionHistoryObserved: false,
  auditRecordObserved: false,
  persistedRowsObserved: false,
};

const databaseHandle = createDatabase({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-prototype-core-flow',
  // Authorization decisions are persisted through a separate connection while
  // the business transaction remains open, so the existing composition needs
  // two pool slots even though the prototype itself is single-threaded.
  max: 2,
});

try {
  const rootDatabase = databaseHandle.database;
  const transactionRunner = createTransactionRunner<ScopedModules>(
    rootDatabase,
    (transaction, context) => createScopedModules(transaction, context, rootDatabase),
  );
  const verticalSlice = createPhase01VerticalSlice(transactionRunner);
  const workflow = createWorkflowApplication(transactionRunner);
  const runSuffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const baseTime = new Date();
  const at = (seconds: number) => asiaShanghaiLocalDateTime(new Date(baseTime.getTime() + seconds * 1000));
  const requestContext = (principalId: string, action: string, seconds: number) => ({
    actorPrincipalId: principalId,
    requestId: `PROTOTYPE-${runSuffix}-${action}`,
    correlationId: `PROTOTYPE-${runSuffix}-CORE-FLOW`,
    occurredAt: at(seconds),
  });

  const chargeDraft = await verticalSlice.createChargeItemDraft(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE-DRAFT', 0),
    {
      governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
      internalCode: `PROTOTYPE-SYNTHETIC-FEE-${runSuffix}`,
      formalName: `PROTOTYPE SYNTHETIC CHARGE ITEM ${runSuffix}`,
      serviceDefinition: 'PROTOTYPE SYNTHETIC SERVICE FOR DATABASE-ONLY GOVERNANCE VALIDATION',
      billingUnitCode: 'TIMES',
      chargingMethodCode: 'COUNT',
      businessValidFrom: at(-60),
      businessValidTo: null,
    },
  );
  steps.chargeDraftCreated = true;

  const chargeSubmitted = await workflow.submit(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE-SUBMIT', 1),
    {
      governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
      entityType: 'CHARGE_ITEM_VERSION',
      stableEntityId: chargeDraft.chargeItemId,
      entityVersionId: chargeDraft.chargeItemVersionId,
      changeKind: 'INITIAL_PUBLICATION',
      riskClassification: 'NORMAL',
      submittedContentDigest: chargeDraft.contentHash.toString('hex'),
      changeReason: 'PROTOTYPE SYNTHETIC CHARGE ITEM INITIAL PUBLICATION',
      campusId: null,
      frozenEvidence: { catalogCode: 'PROTOTYPE-SYNTHETIC-CHARGE-CATALOG' },
    },
  );
  steps.chargeChangeSubmitted = true;

  await workflow.act(
    requestContext(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'CHARGE-REVIEW', 2),
    {
      changeRequestId: chargeSubmitted.changeRequestId,
      stageType: 'PROFESSIONAL_REVIEW',
      actionResult: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC PROFESSIONAL REVIEW APPROVED',
      seenContentDigest: chargeDraft.contentHash.toString('hex'),
      campusId: null,
    },
  );
  steps.chargeProfessionalReviewed = true;

  const chargeApproval = await workflow.act(
    requestContext(PROTOTYPE_FIXTURE.approverPrincipalId, 'CHARGE-APPROVE', 3),
    {
      changeRequestId: chargeSubmitted.changeRequestId,
      stageType: 'OWNER_FINAL_APPROVAL',
      actionResult: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC OWNER FINAL APPROVAL',
      seenContentDigest: chargeDraft.contentHash.toString('hex'),
      campusId: null,
    },
  );
  steps.chargeFinalApproved = true;
  if (!chargeApproval.publication) throw new Error('PROTOTYPE_CHARGE_PUBLICATION_MISSING');
  steps.chargeItemPublished = true;

  const priceDraft = await verticalSlice.createPriceListDraft(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE-DRAFT', 4),
    {
      governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
      priceListCode: 'PROTOTYPE-SYNTHETIC-PRICE-LIST',
      displayName: `PROTOTYPE SYNTHETIC PRICE LIST ${runSuffix}`,
      currencyCode: 'CNY',
      businessValidFrom: at(-60),
      businessValidTo: null,
      entries: [{
        chargeItemId: chargeDraft.chargeItemId,
        chargeItemVersionId: chargeDraft.chargeItemVersionId,
        scopeLevel: 'HOSPITAL',
        campusId: null,
        encounterMode: 'GENERAL',
        encounterType: null,
        fixedUnitPrice: '12.34',
        billingUnitCode: 'TIMES',
        businessValidFrom: at(-60),
        businessValidTo: null,
        zeroPriceReason: null,
      }],
    },
  );
  steps.priceListDraftCreated = true;

  const priceSubmitted = await workflow.submit(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE-SUBMIT', 5),
    {
      governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
      entityType: 'PRICE_LIST_RELEASE',
      stableEntityId: priceDraft.priceListId,
      entityVersionId: priceDraft.priceListReleaseId,
      changeKind: 'INITIAL_PUBLICATION',
      riskClassification: 'HIGH',
      submittedContentDigest: priceDraft.contentHash.toString('hex'),
      changeReason: 'PROTOTYPE SYNTHETIC PRICE LIST INITIAL PUBLICATION',
      campusId: null,
      frozenEvidence: {},
    },
  );
  steps.priceListChangeSubmitted = true;

  await workflow.act(
    requestContext(PROTOTYPE_FIXTURE.reviewerPrincipalId, 'PRICE-REVIEW', 6),
    {
      changeRequestId: priceSubmitted.changeRequestId,
      stageType: 'PROFESSIONAL_REVIEW',
      actionResult: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC PROFESSIONAL REVIEW APPROVED',
      seenContentDigest: priceDraft.contentHash.toString('hex'),
      campusId: null,
    },
  );
  steps.priceListProfessionalReviewed = true;

  const priceApproval = await workflow.act(
    requestContext(PROTOTYPE_FIXTURE.approverPrincipalId, 'PRICE-APPROVE', 7),
    {
      changeRequestId: priceSubmitted.changeRequestId,
      stageType: 'OWNER_FINAL_APPROVAL',
      actionResult: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC OWNER FINAL APPROVAL',
      seenContentDigest: priceDraft.contentHash.toString('hex'),
      campusId: null,
    },
  );
  steps.priceListFinalApproved = true;
  if (!priceApproval.publication) throw new Error('PROTOTYPE_PRICE_LIST_PUBLICATION_MISSING');
  steps.priceListPublished = true;

  const resolutionRequestId = `PROTOTYPE-SYNTHETIC-PRICE-RESOLUTION-${runSuffix}`;
  const priceResolution = await verticalSlice.resolvePrice(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'PRICE-RESOLVE', 8),
    {
      governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
      requestId: resolutionRequestId,
      chargeItemId: chargeDraft.chargeItemId,
      chargeItemVersionId: chargeDraft.chargeItemVersionId,
      priceListId: priceDraft.priceListId,
      campusId: PROTOTYPE_FIXTURE.campusId,
      encounterType: 'OUTPATIENT',
      serviceOccurredAt: at(8),
      recordAsOf: at(8),
      quantity: '2',
    },
  );
  if (priceResolution.status !== 'SUCCEEDED' || priceResolution.result?.finalAmount !== '24.6800') {
    throw new Error('PROTOTYPE_PRICE_RESOLUTION_UNEXPECTED');
  }
  steps.priceResolutionSucceeded = true;

  const versionHistory = await verticalSlice.listChargeItemVersions(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'CHARGE-HISTORY', 9),
    {
      governanceObjectId: PROTOTYPE_FIXTURE.chargeCatalogObjectId,
      chargeItemId: chargeDraft.chargeItemId,
    },
  );
  if (!versionHistory.some((version) =>
    version.chargeItemVersionId === chargeDraft.chargeItemVersionId &&
    version.governanceStatus === 'PUBLISHED')) {
    throw new Error('PROTOTYPE_VERSION_HISTORY_MISSING');
  }
  steps.versionHistoryObserved = true;

  const auditEvents = await transactionRunner.run(
    requestContext(PROTOTYPE_FIXTURE.actorPrincipalId, 'AUDIT-QUERY', 10),
    async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
        permissionCode: 'AUDIT_READ',
      });
      return modules.audit.query({
        governanceObjectId: PROTOTYPE_FIXTURE.priceListObjectId,
        stableEntityId: chargeDraft.chargeItemId,
        action: 'RESOLVED',
        limit: 10,
      });
    },
  );
  if (!auditEvents.some((event) => event.entityVersionId === priceResolution.priceResolutionId)) {
    throw new Error('PROTOTYPE_AUDIT_RECORD_MISSING');
  }
  steps.auditRecordObserved = true;

  const migrationFiles = (await readdir(resolve(import.meta.dirname, '../../db/migrations')))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name));
  const [persistedCharge, persistedPriceList, persistedResolution] = await Promise.all([
    rootDatabase
      .selectFrom('charge_catalog.charge_item_version')
      .select('charge_item_version_id')
      .where('charge_item_version_id', '=', chargeDraft.chargeItemVersionId)
      .executeTakeFirst(),
    rootDatabase
      .selectFrom('price_list.price_list_release')
      .select('price_list_release_id')
      .where('price_list_release_id', '=', priceDraft.priceListReleaseId)
      .executeTakeFirst(),
    rootDatabase
      .selectFrom('price_resolution.price_resolution')
      .select('price_resolution_id')
      .where('price_resolution_id', '=', priceResolution.priceResolutionId)
      .executeTakeFirst(),
  ]);
  if (!persistedCharge || !persistedPriceList || !persistedResolution) {
    throw new Error('PROTOTYPE_PERSISTED_ROWS_MISSING');
  }
  steps.persistedRowsObserved = true;

  const appliedMigrations = await rootDatabase
    .selectFrom('platform.schema_migration')
    .select('migration_id')
    .execute();
  const appliedMigrationIds = new Set(appliedMigrations.map((migration) => migration.migration_id));
  const migrationsApplied = migrationFiles.every((name) => appliedMigrationIds.has(name.replace(/\.sql$/u, '')));
  if (!migrationsApplied) throw new Error('PROTOTYPE_MIGRATIONS_INCOMPLETE');

  const [chargeTotal, priceReleaseTotal, resolutionTotal] = await Promise.all([
    rootDatabase
      .selectFrom('charge_catalog.charge_item as item')
      .innerJoin('charge_catalog.charge_item_version as version',
        'version.charge_item_id', 'item.charge_item_id')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('item.governance_object_id', '=', PROTOTYPE_FIXTURE.chargeCatalogObjectId)
      .where('item.internal_code', 'like', 'PROTOTYPE-SYNTHETIC-FEE-%')
      .where('version.governance_status', '=', 'PUBLISHED')
      .executeTakeFirstOrThrow(),
    rootDatabase
      .selectFrom('price_list.price_list as list')
      .innerJoin('price_list.price_list_release as release',
        'release.price_list_id', 'list.price_list_id')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('list.governance_object_id', '=', PROTOTYPE_FIXTURE.priceListObjectId)
      .where('list.price_list_code', '=', 'PROTOTYPE-SYNTHETIC-PRICE-LIST')
      .where('release.governance_status', '=', 'PUBLISHED')
      .executeTakeFirstOrThrow(),
    rootDatabase
      .selectFrom('price_resolution.price_resolution')
      .select(({ fn }) => fn.countAll<string>().as('count'))
      .where('price_list_id', '=', priceDraft.priceListId)
      .where('request_id', 'like', 'PROTOTYPE-SYNTHETIC-PRICE-RESOLUTION-%')
      .executeTakeFirstOrThrow(),
  ]);

  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    databaseConnected: true,
    migrationsApplied: true,
    chargeItemPublished: true,
    priceListPublished: true,
    priceResolutionSucceeded: true,
    auditRecordObserved: true,
    steps,
    migrationCount: migrationFiles.length,
    objects: {
      chargeItemId: chargeDraft.chargeItemId,
      chargeItemVersionId: chargeDraft.chargeItemVersionId,
      chargeGovernanceReleaseId: chargeApproval.publication.releaseId,
      priceListId: priceDraft.priceListId,
      priceListReleaseId: priceDraft.priceListReleaseId,
      priceGovernanceReleaseId: priceApproval.publication.releaseId,
      priceResolutionId: priceResolution.priceResolutionId,
    },
    priceResolution: {
      requestId: resolutionRequestId,
      status: priceResolution.status,
      finalAmount: priceResolution.result.finalAmount,
      currencyCode: priceResolution.result.currencyCode,
      quantity: priceResolution.result.quantity,
      explanationCodes: priceResolution.steps.map((step) => step.explanationCode),
    },
    prototypePersistenceTotals: {
      publishedChargeItemVersions: chargeTotal.count,
      publishedPriceListReleases: priceReleaseTotal.count,
      priceResolutions: resolutionTotal.count,
    },
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    databaseConnected: true,
    steps,
    errorCode: safeErrorCode(error, 'PROTOTYPE_CORE_FLOW_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  await databaseHandle.close().catch(() => undefined);
}

function asiaShanghaiLocalDateTime(value: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(value).replace(' ', 'T');
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: `REQUIRED_ENVIRONMENT_MISSING:${name}` })}\n`);
    process.exit(1);
  }
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
