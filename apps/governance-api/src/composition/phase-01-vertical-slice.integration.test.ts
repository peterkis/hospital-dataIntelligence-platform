import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { sql } from 'kysely';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../platform/database/create-database.js';
import {
  configureControlledPublicationFault,
  PUBLICATION_TRANSACTION_FAULT_POINTS,
} from '../platform/fault-injection/controlled-faults.js';
import { canonicalSha256, sha256Bytes } from '../platform/hashing/canonical-hash.js';
import { createTransactionRunner } from '../platform/transaction/transaction-runner.js';
import {
  CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
  CHARGE_CATALOG_PROJECTION_TYPE,
  ChargeCatalogProjectionSchema,
  type ChargeCatalogProjection,
} from '../modules/charge-catalog/index.js';
import {
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_TYPE,
} from '../modules/price-list/index.js';
import {
  buildCanonicalSnapshotArtifact,
  createReleaseDistributionDispatcher,
  ReleaseNotificationError,
  type ReleaseNotification,
  type RegisteredPublication,
} from '../modules/release-distribution/index.js';
import {
  type ChangeKind,
  createWorkflowApplication,
  type GovernedEntityType,
  type RiskClassification,
  type WorkflowApplication,
} from '../modules/workflow/index.js';
import { createScopedModules, type ScopedModules } from './create-scoped-modules.js';
import { createPhase01VerticalSlice } from './phase-01-vertical-slice.js';
import { buildApplication } from './build-application.js';

interface IntegrationRuntimeAuthority {
  readonly authority: {
    readonly host: { readonly timezone: string };
    readonly podman: { readonly restartPolicy: 'no' };
    readonly network: {
      readonly managedContainerMode: 'host';
      readonly bindAddress: '127.0.0.1';
      readonly ports: { readonly postgresIntegration: number };
    };
    readonly images: { readonly postgresql: { readonly runtimeReference: string } };
    readonly labels: {
      readonly static: Readonly<{
        'hdi.repository': string;
        'hdi.phase': string;
        'hdi.managed-by': string;
      }>;
    };
  };
}

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const runtimeAuthorityModuleUrl = pathToFileURL(resolve(
  REPOSITORY_ROOT,
  'tooling/verification/src/runtime/podman-runtime-authority.ts',
)).href;
const { loadPodmanRuntimeAuthority } = await import(runtimeAuthorityModuleUrl) as Readonly<{
  loadPodmanRuntimeAuthority(repositoryRoot?: string): IntegrationRuntimeAuthority;
}>;
const RUNTIME_AUTHORITY = loadPodmanRuntimeAuthority(REPOSITORY_ROOT).authority;
const POSTGRES_IMAGE = RUNTIME_AUTHORITY.images.postgresql.runtimeReference;
const POSTGRES_HOST_PORT = RUNTIME_AUTHORITY.network.ports.postgresIntegration;
const TESTCONTAINER_LABELS = formalTestcontainerLabels();
const POSTGRES_CONTAINER_NAME = integrationPostgresContainerName();
const MIGRATION_DIRECTORY = resolve(
  import.meta.dirname,
  '../../../../db/migrations',
);

interface FoundationIds {
  readonly actorId: string;
  readonly reviewerId: string;
  readonly approverId: string;
  readonly servicePrincipalId: string;
  readonly incompatibleServicePrincipalId: string;
  readonly campusId: string;
  readonly chargeCatalogObjectId: string;
  readonly priceListObjectId: string;
}

interface IntegrationEvidenceObservation {
  readonly producerId: 'database' | 'integration' | 'fault' | 'consumer' | 'capacity';
  readonly scenarioId: string;
  readonly assertionId: string;
  readonly gateId: string;
  readonly description: string;
  readonly requestIds: readonly string[];
  readonly principalIds: readonly string[];
  readonly governanceObjectIds: readonly string[];
  readonly versionIds: readonly string[];
  readonly ruleVersions: readonly string[];
}

type PublicationTransactionFaultPoint = (typeof PUBLICATION_TRANSACTION_FAULT_POINTS)[number];

class AuthorityBoundGenericContainer extends GenericContainer {
  constructor(image: string, restartPolicy: 'no') {
    super(image);
    this.hostConfig.RestartPolicy = {
      Name: restartPolicy,
      MaximumRetryCount: 0,
    };
  }

  protected override async containerCreated(containerId: string): Promise<void> {
    const { stdout } = await execFileAsync('podman', [
      'inspect',
      '--format',
      '{{.HostConfig.RestartPolicy.Name}}',
      containerId,
    ], {
      windowsHide: true,
      encoding: 'utf8',
    });
    if (stdout.trim() !== RUNTIME_AUTHORITY.podman.restartPolicy) {
      throw new Error('FORMAL_TESTCONTAINER_RESTART_POLICY_DRIFT');
    }
  }
}

let container: StartedTestContainer | undefined;
let databaseHandle: DatabaseHandle | undefined;
let foundation: FoundationIds;
const integrationEvidenceObservations: IntegrationEvidenceObservation[] = [];

process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

beforeAll(async () => {
  container = await new AuthorityBoundGenericContainer(
    POSTGRES_IMAGE,
    RUNTIME_AUTHORITY.podman.restartPolicy,
  )
    .withName(POSTGRES_CONTAINER_NAME)
    .withLabels(TESTCONTAINER_LABELS)
    .withEnvironment({
      POSTGRES_HOST_AUTH_METHOD: 'trust',
      TZ: RUNTIME_AUTHORITY.host.timezone,
    })
    .withCommand([
      '-c', `timezone=${RUNTIME_AUTHORITY.host.timezone}`,
      '-c', `listen_addresses=${RUNTIME_AUTHORITY.network.bindAddress}`,
      '-p', String(POSTGRES_HOST_PORT),
    ])
    .withNetworkMode(RUNTIME_AUTHORITY.network.managedContainerMode)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start();
  await writeTestcontainerRuntimeEvent('STARTED', container);

  const poolConfig = {
    host: '127.0.0.1',
    port: POSTGRES_HOST_PORT,
    user: 'postgres',
    database: 'postgres',
  };
  const bootstrapPool = new Pool(poolConfig);
  try {
    const migrations = (await readdir(MIGRATION_DIRECTORY))
      .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
      .sort((left, right) => left.localeCompare(right));
    for (const migration of migrations) {
      await bootstrapPool.query(await readFile(resolve(MIGRATION_DIRECTORY, migration), 'utf8'));
    }
  } finally {
    await bootstrapPool.end();
  }
  databaseHandle = createDatabase(poolConfig);
  foundation = await seedFoundation(databaseHandle);
}, 120_000);

afterAll(async () => {
  try {
    await writeIntegrationEvidenceObservations();
  } finally {
    try {
      await databaseHandle?.close();
    } finally {
      if (container !== undefined) {
        await container.stop();
        await writeTestcontainerRuntimeEvent('STOPPED', container);
      }
    }
  }
}, 30_000);

describe('Phase 01 executable vertical slice', () => {
  it('publishes, resolves, audits, snapshots, and closes simulated consumption', async () => {
    if (!databaseHandle) throw new Error('Integration database was not initialized');
    const rootDatabase = databaseHandle.database;
    const runner = createTransactionRunner<ScopedModules>(
      rootDatabase,
      (transaction, context) =>
        createScopedModules(transaction, context, rootDatabase),
    );
    const slice = createPhase01VerticalSlice(runner);
    const workflowApplication = createWorkflowApplication(runner);
    let dispatcherNow = '2026-08-08T09:10:30';
    const notifications: ReleaseNotification[] = [];
    const notificationAttemptCount = new Map<string, number>();
    const dispatcher = createReleaseDistributionDispatcher(
      databaseHandle.database,
      {
        async deliver(notification) {
          notifications.push(notification);
          const attemptCount = (notificationAttemptCount.get(notification.subscriptionId) ?? 0) + 1;
          notificationAttemptCount.set(notification.subscriptionId, attemptCount);
          if (
            notification.servicePrincipalId === foundation.servicePrincipalId &&
            attemptCount === 1
          ) {
            throw new ReleaseNotificationError('SIMULATED_NOTIFICATION_TIMEOUT', true);
          }
          const pulledEvents = await runner.run(
            requestContext(
              notification.servicePrincipalId,
              `notification-pull-${notification.subscriptionId}`,
              dispatcherNow,
            ),
            (modules) =>
              modules.releaseDistribution.listAvailableEvents({
                subscriptionId: notification.subscriptionId,
                servicePrincipalId: notification.servicePrincipalId,
                afterAggregateVersion: '0',
              }),
          );
          expect(pulledEvents.map((event) => event.eventId)).toContain(notification.eventId);
          const pulledSnapshot = await runner.run(
            requestContext(
              notification.servicePrincipalId,
              `notification-snapshot-${notification.subscriptionId}`,
              dispatcherNow,
            ),
            (modules) =>
              modules.releaseDistribution.getSnapshotForSubscription({
                subscriptionId: notification.subscriptionId,
                servicePrincipalId: notification.servicePrincipalId,
                snapshotId: notification.snapshotId,
              }),
          );
          expect(sha256Bytes(pulledSnapshot.bytes).equals(notification.snapshotArtifactDigest)).toBe(
            true,
          );
          const receipt = await runner.run(
            requestContext(
              notification.servicePrincipalId,
              `notification-receipt-${notification.subscriptionId}`,
              dispatcherNow,
            ),
            (modules) =>
              modules.releaseDistribution.recordReceipt({
                subscriptionId: notification.subscriptionId,
                servicePrincipalId: notification.servicePrincipalId,
                eventId: notification.eventId,
                receiveResult: 'ACCEPTED',
                validationResult: 'VALID',
                applyResult: 'APPLIED',
                processingDigest: pulledSnapshot.digest,
                processedAt: dispatcherNow,
              }),
          );
          expect(receipt.receiptSequence).toBe('1');
          return { responseDigest: null };
        },
      },
      {
        workerId: 'phase-01-integration-dispatcher',
        leaseSeconds: 30,
        retryDelaySeconds: 1,
        maxNotificationAttempts: 3,
        pollIntervalMilliseconds: 1_000,
        now: () => dispatcherNow,
      },
    );
    const chargeContext = requestContext(foundation.actorId, 'charge-draft', '2026-08-08T09:00:00');
    const chargeDraft = await slice.createChargeItemDraft(chargeContext, {
      governanceObjectId: foundation.chargeCatalogObjectId,
      internalCode: 'POC-FEE-001',
      formalName: 'POC诊查费',
      serviceDefinition: '合成POC收费项目，仅用于验证治理闭环。',
      billingUnitCode: 'TIMES',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-08-08T00:00:00',
      businessValidTo: null,
    });
    const chargePublication = await approveDraft(workflowApplication, {
      suffix: 'charge-initial',
      governanceObjectId: foundation.chargeCatalogObjectId,
      entityType: 'CHARGE_ITEM_VERSION',
      stableEntityId: chargeDraft.chargeItemId,
      entityVersionId: chargeDraft.chargeItemVersionId,
      contentHash: chargeDraft.contentHash,
      riskClassification: 'NORMAL',
      changeKind: 'INITIAL_PUBLICATION',
      changeReason: '建立纵向切片收费项目初始版本',
      frozenEvidence: { catalogCode: 'HOSPITAL-CHARGE-CATALOG' },
      submittedAt: '2026-08-08T09:01:00',
      reviewedAt: '2026-08-08T09:02:00',
      approvedAt: '2026-08-08T09:03:00',
    });
    const charge = {
      chargeItemId: chargeDraft.chargeItemId,
      chargeItemVersionId: chargeDraft.chargeItemVersionId,
      ...chargePublication,
    };

    const consumer = await runner.run(
      requestContext(foundation.actorId, 'subscription-create', '2026-08-08T09:05:00'),
      async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: foundation.priceListObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.createSubscription({
          subscriptionCode: 'SIM-CONSUMER-PRICE-LIST',
          servicePrincipalId: foundation.servicePrincipalId,
          governanceObjectId: foundation.priceListObjectId,
          projectionType: PRICE_LIST_PROJECTION_TYPE,
          projectionSchemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
        });
      },
    );
    const incompatibleConsumer = await runner.run(
      requestContext(foundation.actorId, 'legacy-subscription-create', '2026-08-08T09:06:00'),
      async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: foundation.priceListObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.createSubscription({
          subscriptionCode: 'SIM-CONSUMER-PRICE-LIST-LEGACY',
          servicePrincipalId: foundation.incompatibleServicePrincipalId,
          governanceObjectId: foundation.priceListObjectId,
          projectionType: PRICE_LIST_PROJECTION_TYPE,
          projectionSchemaVersion: PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
        });
      },
    );

    const priceContext = requestContext(foundation.actorId, 'price-draft', '2026-08-08T09:07:00');
    const priceDraft = await slice.createPriceListDraft(priceContext, {
      governanceObjectId: foundation.priceListObjectId,
      priceListCode: 'HOSPITAL-DEFAULT-PRICE',
      displayName: 'POC全院默认价表',
      currencyCode: 'CNY',
      businessValidFrom: '2026-08-08T00:00:00',
      businessValidTo: null,
      entries: [
        {
          chargeItemId: charge.chargeItemId,
          chargeItemVersionId: charge.chargeItemVersionId,
          scopeLevel: 'HOSPITAL',
          campusId: null,
          encounterMode: 'GENERAL',
          encounterType: null,
          fixedUnitPrice: '12.34',
          billingUnitCode: 'TIMES',
          businessValidFrom: '2026-08-08T00:00:00',
          businessValidTo: null,
          zeroPriceReason: null,
        },
      ],
    });
    const pricePublication = await approveDraft(workflowApplication, {
      suffix: 'price-initial',
      governanceObjectId: foundation.priceListObjectId,
      entityType: 'PRICE_LIST_RELEASE',
      stableEntityId: priceDraft.priceListId,
      entityVersionId: priceDraft.priceListReleaseId,
      contentHash: priceDraft.contentHash,
      riskClassification: 'HIGH',
      changeKind: 'INITIAL_PUBLICATION',
      changeReason: '建立纵向切片价表初始完整快照',
      frozenEvidence: {},
      submittedAt: '2026-08-08T09:08:00',
      reviewedAt: '2026-08-08T09:09:00',
      approvedAt: '2026-08-08T09:10:00',
    });
    const price = {
      priceListId: priceDraft.priceListId,
      priceListReleaseId: priceDraft.priceListReleaseId,
      ...pricePublication,
    };
    expect(await dispatcher.dispatchOnce()).toMatchObject({
      claimed: true,
      eventId: price.eventId,
      result: 'RETRYABLE_FAILURE',
    });
    const pendingEvents = await runner.run(
      requestContext(foundation.servicePrincipalId, 'consumer-poll-pending', '2026-08-08T09:10:30'),
      (modules) =>
        modules.releaseDistribution.listAvailableEvents({
          subscriptionId: consumer.subscriptionId,
          servicePrincipalId: foundation.servicePrincipalId,
          afterAggregateVersion: '0',
        }),
    );
    expect(pendingEvents.map((event) => event.eventId)).toEqual([price.eventId]);
    expect(await dispatcher.dispatchOnce()).toEqual({ claimed: false });
    dispatcherNow = '2026-08-08T09:10:31';
    expect(await dispatcher.dispatchOnce()).toMatchObject({
      claimed: true,
      eventId: price.eventId,
      result: 'NOTIFICATION_ACCEPTED',
    });
    expect(await dispatcher.dispatchOnce()).toEqual({ claimed: false });
    expect(notifications.map((notification) => notification.eventId)).toEqual([
      price.eventId,
      price.eventId,
    ]);

    const resolutionContext = requestContext(
      foundation.actorId,
      'price-resolution',
      '2026-08-08T09:20:00',
    );
    const outcome = await slice.resolvePrice(resolutionContext, {
      governanceObjectId: foundation.priceListObjectId,
      requestId: 'POC-PRICE-REQUEST-001',
      chargeItemId: charge.chargeItemId,
      chargeItemVersionId: charge.chargeItemVersionId,
      priceListId: price.priceListId,
      campusId: foundation.campusId,
      encounterType: 'OUTPATIENT',
      serviceOccurredAt: '2026-08-08T09:15:00',
      recordAsOf: '2026-08-08T09:20:00',
      quantity: '2',
    });

    expect(outcome.status).toBe('SUCCEEDED');
    expect(outcome.result?.finalAmount).toBe('24.6800');
    expect(outcome.steps.map((step) => step.explanationCode)).toEqual([
      'PRICE_CAMPUS_SPECIFIC_NO_CANDIDATE',
      'PRICE_CAMPUS_GENERAL_NO_CANDIDATE',
      'PRICE_HOSPITAL_SPECIFIC_NO_CANDIDATE',
      'PRICE_HOSPITAL_GENERAL_MATCHED',
    ]);

    const repeated = await slice.resolvePrice(
      requestContext(foundation.actorId, 'price-resolution-replay', '2026-08-08T09:21:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        requestId: 'POC-PRICE-REQUEST-001',
        chargeItemId: charge.chargeItemId,
        chargeItemVersionId: charge.chargeItemVersionId,
        priceListId: price.priceListId,
        campusId: foundation.campusId,
        encounterType: 'OUTPATIENT',
        serviceOccurredAt: '2026-08-08T09:15:00',
        recordAsOf: '2026-08-08T09:20:00',
        quantity: '2',
      },
    );
    expect(repeated.priceResolutionId).toBe(outcome.priceResolutionId);

    const events = await runner.run(
      requestContext(foundation.servicePrincipalId, 'consumer-poll', '2026-08-08T09:31:00'),
      (modules) =>
        modules.releaseDistribution.listAvailableEvents({
          subscriptionId: consumer.subscriptionId,
          servicePrincipalId: foundation.servicePrincipalId,
          afterAggregateVersion: '0',
        }),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.eventId).toBe(price.eventId);

    const blockedEvents = await runner.run(
      requestContext(
        foundation.incompatibleServicePrincipalId,
        'legacy-consumer-poll-blocked',
        '2026-08-08T09:31:30',
      ),
      (modules) =>
        modules.releaseDistribution.listAvailableEvents({
          subscriptionId: incompatibleConsumer.subscriptionId,
          servicePrincipalId: foundation.incompatibleServicePrincipalId,
          afterAggregateVersion: '0',
        }),
    );
    expect(blockedEvents).toHaveLength(0);
    const blockedAttempts = await databaseHandle.database
      .selectFrom('release_distribution.outbox_delivery_attempt as attempt')
      .innerJoin(
        'release_distribution.outbox_delivery as delivery',
        'delivery.outbox_delivery_id',
        'attempt.outbox_delivery_id',
      )
      .select((expression) => expression.fn.countAll<string>().as('count'))
      .where('delivery.consumer_subscription_id', '=', incompatibleConsumer.subscriptionId)
      .executeTakeFirstOrThrow();
    expect(blockedAttempts.count).toBe('0');

    const snapshot = await runner.run(
      requestContext(foundation.servicePrincipalId, 'snapshot-pull', '2026-08-08T09:32:00'),
      (modules) =>
        modules.releaseDistribution.getSnapshotForSubscription({
          subscriptionId: consumer.subscriptionId,
          servicePrincipalId: foundation.servicePrincipalId,
          snapshotId: price.snapshotId,
        }),
    );
    expect(snapshot.bytes.byteLength.toString()).toBe(snapshot.byteLength);
    expect(sha256Bytes(snapshot.bytes).equals(snapshot.digest)).toBe(true);

    await runner.run(
      requestContext(foundation.actorId, 'legacy-subscription-upgrade', '2026-08-08T09:34:00'),
      async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: foundation.priceListObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.createSubscriptionVersion({
          subscriptionId: incompatibleConsumer.subscriptionId,
          governanceObjectId: foundation.priceListObjectId,
          projectionType: PRICE_LIST_PROJECTION_TYPE,
          projectionSchemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
        });
      },
    );
    await runner.run(
      requestContext(foundation.actorId, 'legacy-delivery-replay', '2026-08-08T09:34:30'),
      async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: foundation.priceListObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.replayBlockedDelivery({
          subscriptionId: incompatibleConsumer.subscriptionId,
          governanceObjectId: foundation.priceListObjectId,
          eventId: price.eventId,
        });
      },
    );
    dispatcherNow = '2026-08-08T09:34:35';
    expect(await dispatcher.dispatchOnce()).toMatchObject({
      claimed: true,
      eventId: price.eventId,
      result: 'NOTIFICATION_ACCEPTED',
    });
    const replayedEvents = await runner.run(
      requestContext(
        foundation.incompatibleServicePrincipalId,
        'legacy-consumer-poll-replayed',
        '2026-08-08T09:34:40',
      ),
      (modules) =>
        modules.releaseDistribution.listAvailableEvents({
          subscriptionId: incompatibleConsumer.subscriptionId,
          servicePrincipalId: foundation.incompatibleServicePrincipalId,
          afterAggregateVersion: '0',
        }),
    );
    expect(replayedEvents.map((event) => event.eventId)).toEqual([price.eventId]);
    const replayedSnapshot = await runner.run(
      requestContext(
        foundation.incompatibleServicePrincipalId,
        'legacy-snapshot-pull-replayed',
        '2026-08-08T09:34:50',
      ),
      (modules) =>
        modules.releaseDistribution.getSnapshotForSubscription({
          subscriptionId: incompatibleConsumer.subscriptionId,
          servicePrincipalId: foundation.incompatibleServicePrincipalId,
          snapshotId: price.snapshotId,
        }),
    );
    expect(replayedSnapshot.bytes.equals(snapshot.bytes)).toBe(true);
    expect(replayedSnapshot.digest.equals(snapshot.digest)).toBe(true);
    const application = await buildApplication({
      phase01: {
        verticalSlice: slice,
        transactionRunner: runner,
        workflowApplication,
        async resolvePrincipal(request) {
          if (request.headers.authorization === 'Bearer simulated-service') {
            return {
              principalId: foundation.servicePrincipalId,
              principalKind: 'SERVICE' as const,
            };
          }
          return {
            principalId: foundation.actorId,
            principalKind: 'PERSON' as const,
          };
        },
        now: () => '2026-08-08T09:35:00',
      },
    });
    try {
      const apiEvents = await application.inject({
        method: 'GET',
        url: `/v1/phase-01/consumer-subscriptions/${consumer.subscriptionId}/events?afterAggregateVersion=0`,
        headers: { authorization: 'Bearer simulated-service' },
      });
      expect(apiEvents.statusCode).toBe(200);
      expect(apiEvents.json<{ events: { eventId: string }[] }>().events[0]?.eventId).toBe(
        price.eventId,
      );

      const apiSnapshot = await application.inject({
        method: 'GET',
        url: `/v1/phase-01/consumer-subscriptions/${consumer.subscriptionId}/snapshots/${price.snapshotId}/content`,
        headers: { authorization: 'Bearer simulated-service' },
      });
      expect(apiSnapshot.statusCode).toBe(200);
      expect(apiSnapshot.headers['x-snapshot-id']).toBe(price.snapshotId);
      expect(apiSnapshot.rawPayload.equals(snapshot.bytes)).toBe(true);
      expect(apiSnapshot.headers['digest']).toBe(
        `sha-256=:${snapshot.digest.toString('base64')}:`,
      );
    } finally {
      await application.close();
    }

    const lateConsumer = await runner.run(
      requestContext(foundation.actorId, 'late-subscription-create', '2026-08-08T09:49:00'),
      async (modules) => {
        await modules.authorization.requireObjectPermission({
          governanceObjectId: foundation.priceListObjectId,
          permissionCode: 'CONSUMER_SUBSCRIPTION_MANAGE',
        });
        return modules.releaseDistribution.createSubscription({
          subscriptionCode: 'SIM-CONSUMER-LATE-INITIALIZATION',
          servicePrincipalId: foundation.servicePrincipalId,
          governanceObjectId: foundation.priceListObjectId,
          projectionType: PRICE_LIST_PROJECTION_TYPE,
          projectionSchemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
        });
      },
    );
    const secondPriceDraft = await slice.createPriceListDraft(
      requestContext(foundation.actorId, 'price-draft-version-2', '2026-08-08T09:47:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        priceListCode: 'HOSPITAL-DEFAULT-PRICE',
        displayName: 'POC全院默认价表第二版',
        currencyCode: 'CNY',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
        entries: [
          {
            chargeItemId: charge.chargeItemId,
            chargeItemVersionId: charge.chargeItemVersionId,
            scopeLevel: 'HOSPITAL',
            campusId: null,
            encounterMode: 'GENERAL',
            encounterType: null,
            fixedUnitPrice: '15.00',
            billingUnitCode: 'TIMES',
            businessValidFrom: '2026-08-08T00:00:00',
            businessValidTo: null,
            zeroPriceReason: null,
          },
        ],
      },
    );
    const secondPricePublication = await approveDraft(workflowApplication, {
      suffix: 'price-version-2',
      governanceObjectId: foundation.priceListObjectId,
      entityType: 'PRICE_LIST_RELEASE',
      stableEntityId: secondPriceDraft.priceListId,
      entityVersionId: secondPriceDraft.priceListReleaseId,
      contentHash: secondPriceDraft.contentHash,
      riskClassification: 'HIGH',
      changeKind: 'VERSION_CHANGE',
      changeReason: '验证稳定价表身份下的显式新版本发布',
      frozenEvidence: {},
      submittedAt: '2026-08-08T09:48:00',
      reviewedAt: '2026-08-08T09:49:00',
      approvedAt: '2026-08-08T09:50:00',
    });
    const secondPrice = {
      priceListId: secondPriceDraft.priceListId,
      priceListReleaseId: secondPriceDraft.priceListReleaseId,
      ...secondPricePublication,
    };
    expect(secondPrice.priceListId).toBe(price.priceListId);
    expect(secondPrice.priceListReleaseId).not.toBe(price.priceListReleaseId);
    const secondSnapshot = await runner.run(
      requestContext(foundation.actorId, 'price-version-2-snapshot', '2026-08-08T09:50:10'),
      (modules) => modules.releaseDistribution.getSnapshot(secondPrice.snapshotId),
    );
    const secondSnapshotPayload = (
      JSON.parse(secondSnapshot.bytes.toString('utf8')) as {
        payload: { contentHash: string; recordedFrom: string; releaseNo: string };
      }
    ).payload;
    expect(secondSnapshotPayload.releaseNo).toBe('2');
    expect(secondSnapshotPayload.recordedFrom).toBe('2026-08-08T09:50:00');
    const [firstPublishedRelease, secondPublishedRelease] = await Promise.all([
      slice.getPriceListRelease(
        requestContext(foundation.actorId, 'price-version-1-read', '2026-08-08T09:50:11'),
        {
          governanceObjectId: foundation.priceListObjectId,
          priceListId: price.priceListId,
          priceListReleaseId: price.priceListReleaseId,
        },
      ),
      slice.getPriceListRelease(
        requestContext(foundation.actorId, 'price-version-2-read', '2026-08-08T09:50:12'),
        {
          governanceObjectId: foundation.priceListObjectId,
          priceListId: secondPrice.priceListId,
          priceListReleaseId: secondPrice.priceListReleaseId,
        },
      ),
    ]);
    expect(firstPublishedRelease.recordedTo).toBe('2026-08-08T09:50:00');
    expect(secondPublishedRelease.recordedFrom).toBe('2026-08-08T09:50:00');
    expect(secondSnapshotPayload.contentHash).toBe(
      secondPublishedRelease.contentHash.toString('hex'),
    );
    const lateEvents = await runner.run(
      requestContext(foundation.servicePrincipalId, 'late-consumer-initial-pull', '2026-08-08T09:50:20'),
      (modules) =>
        modules.releaseDistribution.listAvailableEvents({
          subscriptionId: lateConsumer.subscriptionId,
          servicePrincipalId: foundation.servicePrincipalId,
          afterAggregateVersion: '0',
        }),
    );
    expect(lateEvents.map((event) => event.aggregateVersion)).toEqual(['2']);
    await runner.run(
      requestContext(foundation.servicePrincipalId, 'late-consumer-initial-receipt', '2026-08-08T09:50:30'),
      (modules) =>
        modules.releaseDistribution.recordReceipt({
          subscriptionId: lateConsumer.subscriptionId,
          servicePrincipalId: foundation.servicePrincipalId,
          eventId: secondPrice.eventId,
          receiveResult: 'ACCEPTED',
          validationResult: 'VALID',
          applyResult: 'APPLIED',
          processingDigest: secondSnapshot.digest,
          processedAt: '2026-08-08T09:50:30',
        }),
    );
    const lateCheckpoint = await databaseHandle.database
      .selectFrom('release_distribution.consumer_checkpoint')
      .select('applied_aggregate_version')
      .where('consumer_subscription_id', '=', lateConsumer.subscriptionId)
      .where('governance_object_id', '=', foundation.priceListObjectId)
      .executeTakeFirstOrThrow();
    expect(lateCheckpoint.applied_aggregate_version).toBe('2');

    const historicalPrice = await slice.resolvePrice(
      requestContext(foundation.actorId, 'historical-price-resolution', '2026-08-08T09:51:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        requestId: 'POC-PRICE-HISTORICAL-001',
        chargeItemId: charge.chargeItemId,
        chargeItemVersionId: charge.chargeItemVersionId,
        priceListId: price.priceListId,
        campusId: foundation.campusId,
        encounterType: 'OUTPATIENT',
        serviceOccurredAt: '2026-08-08T09:15:00',
        recordAsOf: '2026-08-08T09:49:59',
        quantity: '2',
      },
    );
    const currentPrice = await slice.resolvePrice(
      requestContext(foundation.actorId, 'current-price-resolution', '2026-08-08T09:52:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        requestId: 'POC-PRICE-CURRENT-002',
        chargeItemId: charge.chargeItemId,
        chargeItemVersionId: charge.chargeItemVersionId,
        priceListId: price.priceListId,
        campusId: foundation.campusId,
        encounterType: 'OUTPATIENT',
        serviceOccurredAt: '2026-08-08T09:15:00',
        recordAsOf: '2026-08-08T09:51:00',
        quantity: '2',
      },
    );
    expect(historicalPrice.result?.finalAmount).toBe('24.6800');
    expect(currentPrice.result?.finalAmount).toBe('30.0000');

    const auditIntegrity = await runner.run(
      requestContext(foundation.actorId, 'audit-verify', '2026-08-08T09:40:00'),
      (modules) => modules.audit.verifyChain(foundation.priceListObjectId),
    );
    expect(auditIntegrity).toBe(true);

    const checkpoint = await databaseHandle.database
      .selectFrom('release_distribution.consumer_checkpoint')
      .select('applied_aggregate_version')
      .where('consumer_subscription_id', '=', consumer.subscriptionId)
      .where('governance_object_id', '=', foundation.priceListObjectId)
      .executeTakeFirstOrThrow();
    expect(checkpoint.applied_aggregate_version).toBe('1');
    const replayedCheckpoint = await databaseHandle.database
      .selectFrom('release_distribution.consumer_checkpoint')
      .select('applied_aggregate_version')
      .where('consumer_subscription_id', '=', incompatibleConsumer.subscriptionId)
      .where('governance_object_id', '=', foundation.priceListObjectId)
      .executeTakeFirstOrThrow();
    expect(replayedCheckpoint.applied_aggregate_version).toBe('1');

    const compatibilityResults = await databaseHandle.database
      .selectFrom('release_distribution.release_consumer_compatibility')
      .select(['consumer_subscription_id', 'result', 'result_sequence'])
      .where('event_id', '=', price.eventId)
      .orderBy('consumer_subscription_id', 'asc')
      .orderBy('result_sequence', 'asc')
      .execute();
    expect(compatibilityResults.filter((result) => result.result === 'UNSUPPORTED')).toHaveLength(1);
    expect(compatibilityResults.filter((result) => result.result === 'SUPPORTED')).toHaveLength(2);
    const issueEvents = await databaseHandle.database
      .selectFrom('release_distribution.consumer_compatibility_issue_event')
      .select(['issue_sequence', 'issue_status'])
      .orderBy('issue_sequence', 'asc')
      .execute();
    expect(issueEvents).toEqual([
      { issue_sequence: '1', issue_status: 'OPEN' },
      { issue_sequence: '2', issue_status: 'RESOLVED' },
    ]);

    await expect(
      databaseHandle.database
        .updateTable('release_distribution.release_snapshot')
        .set({ artifact_media_type: 'application/json' })
        .where('release_snapshot_id', '=', price.snapshotId)
        .execute(),
    ).rejects.toThrow(/append-only/u);

    const timeZoneTypes = await sql<{ count: string }>`
      select count(*)::bigint as count
      from information_schema.columns
      where table_schema in (
        'audit', 'charge_catalog', 'platform', 'price_list',
        'price_resolution', 'release_distribution'
      )
      and data_type in ('timestamp with time zone', 'time with time zone')
    `.execute(databaseHandle.database);
    expect(timeZoneTypes.rows[0]?.count).toBe('0');
    recordIntegrationObservation({
      producerId: 'database',
      scenarioId: 'INTEGRATION-DATABASE-TIMEZONE-TYPE-SCAN',
      assertionId: 'ABG-03:asia-shanghai-no-timezone-contract',
      gateId: 'ABG-03',
      description: 'The integrated PostgreSQL schema has no timezone-aware timestamp columns.',
      requestIds: ['request-audit-verify'],
      principalIds: [foundation.actorId],
      governanceObjectIds: [foundation.chargeCatalogObjectId, foundation.priceListObjectId],
      versionIds: [charge.chargeItemVersionId, price.priceListReleaseId],
      ruleVersions: ['phase-01.timezone-contract.v1'],
    });
    recordIntegrationObservation({
      producerId: 'integration',
      scenarioId: 'INTEGRATION-CHARGE-CATALOG-VERSION-PUBLICATION',
      assertionId: 'ABG-08:charge-item-stable-identity-version-candidate-immutable-publication',
      gateId: 'ABG-08',
      description: 'Charge publication retained a stable identity and immutable version.',
      requestIds: ['request-charge-draft', 'request-charge-initial-approve'],
      principalIds: [foundation.actorId, foundation.reviewerId, foundation.approverId],
      governanceObjectIds: [foundation.chargeCatalogObjectId],
      versionIds: [charge.chargeItemVersionId],
      ruleVersions: ['phase-01.workflow-template.v1'],
    });
    recordIntegrationObservation({
      producerId: 'integration',
      scenarioId: 'INTEGRATION-VERTICAL-SLICE-PUBLICATION',
      assertionId: 'ABG-10:price-list-draft-entry-change-complete-snapshot',
      gateId: 'ABG-10',
      description: 'Price-list publication produced a complete immutable snapshot.',
      requestIds: ['request-price-draft', 'request-price-initial-approve'],
      principalIds: [foundation.actorId, foundation.reviewerId, foundation.approverId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [price.priceListReleaseId],
      ruleVersions: ['phase-01.price-list-projection.v1'],
    });
    recordIntegrationObservation({
      producerId: 'integration',
      scenarioId: 'INTEGRATION-PRICE-RESOLUTION-FAIL-CLOSED',
      assertionId: 'ABG-12:two-level-price-resolution-fail-closed-evidence',
      gateId: 'ABG-12',
      description: 'The fixed two-level resolution path returned the expected amount and trace.',
      requestIds: ['request-price-resolution'],
      principalIds: [foundation.actorId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [charge.chargeItemVersionId, price.priceListReleaseId],
      ruleVersions: ['phase-01.fixed-two-level-price-resolution.v1'],
    });
    recordIntegrationObservation({
      producerId: 'consumer',
      scenarioId: 'LIVE-CONSUMER-INCOMPATIBILITY-REPLAY',
      assertionId: 'ABG-24:consumer-incompatibility-isolation-subscription-upgrade-replay',
      gateId: 'ABG-24',
      description: 'Incompatible consumer delivery remained isolated until explicit upgrade and replay.',
      requestIds: ['request-legacy-consumer-poll-blocked', 'request-legacy-delivery-replay'],
      principalIds: [foundation.incompatibleServicePrincipalId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [price.priceListReleaseId],
      ruleVersions: [PRICE_LIST_PROJECTION_SCHEMA_VERSION],
    });
    recordIntegrationObservation({
      producerId: 'consumer',
      scenarioId: 'CONSUMER-ISOLATION-GAP-BLOCKING',
      assertionId: 'ABG-35:two-consumer-isolation-next-version-gap-block',
      gateId: 'ABG-35',
      description: 'Consumer checkpoints remain independent and compatible delivery resumes separately.',
      requestIds: ['request-consumer-poll', 'request-legacy-consumer-poll-replayed'],
      principalIds: [foundation.servicePrincipalId, foundation.incompatibleServicePrincipalId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [price.priceListReleaseId],
      ruleVersions: [PRICE_LIST_PROJECTION_SCHEMA_VERSION],
    });
    recordIntegrationObservation({
      producerId: 'consumer',
      scenarioId: 'CONSUMER-CANONICAL-SNAPSHOT-DUAL-DIGEST',
      assertionId: 'ABG-36:uncompressed-canonical-snapshot-dual-digest-stream-client',
      gateId: 'ABG-36',
      description: 'Snapshot bytes and digest matched across subscription retrieval and API download.',
      requestIds: ['request-snapshot-pull', 'request-legacy-snapshot-pull-replayed'],
      principalIds: [foundation.servicePrincipalId, foundation.incompatibleServicePrincipalId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [price.priceListReleaseId],
      ruleVersions: [PRICE_LIST_PROJECTION_SCHEMA_VERSION],
    });
    recordIntegrationObservation({
      producerId: 'integration',
      scenarioId: 'INTEGRATION-CHARGE-CATALOG-BITEMPORAL-HISTORY',
      assertionId: 'ABG-09:charge-item-bitemporal-history-and-difference',
      gateId: 'ABG-09',
      description: 'Historical and current price resolutions retained their distinct recorded-time results.',
      requestIds: ['request-historical-price-resolution', 'request-current-price-resolution'],
      principalIds: [foundation.actorId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [price.priceListReleaseId, secondPrice.priceListReleaseId],
      ruleVersions: ['phase-01.bitemporal-price-resolution.v1'],
    });
    recordIntegrationObservation({
      producerId: 'database',
      scenarioId: 'INTEGRATION-AUDIT-HASH-CHAIN-TAMPER',
      assertionId: 'ABG-30:audit-hash-chain-recompute-first-tamper-position',
      gateId: 'ABG-30',
      description: 'Audit chain verification and append-only release snapshot guard both succeeded.',
      requestIds: ['request-audit-verify'],
      principalIds: [foundation.actorId],
      governanceObjectIds: [foundation.priceListObjectId],
      versionIds: [price.priceListReleaseId],
      ruleVersions: ['phase-01.audit-chain.v1'],
    });
  }, 120_000);

  it('rolls back the complete publication transaction at every durable write point', async () => {
    if (!databaseHandle) throw new Error('Integration database was not initialized');
    const runner = createTransactionRunner<ScopedModules>(
      databaseHandle.database,
      (transaction, context) =>
        createScopedModules(transaction, context, databaseHandle?.database),
    );
    const slice = createPhase01VerticalSlice(runner);
    const workflowApplication = createWorkflowApplication(runner);
    const chargeDraft = await slice.createChargeItemDraft(
      requestContext(foundation.actorId, 'fault-charge-draft', '2026-08-08T10:00:00'),
      {
        governanceObjectId: foundation.chargeCatalogObjectId,
        internalCode: 'POC-FAULT-FEE-001',
        formalName: '故障矩阵收费项目',
        serviceDefinition: '合成POC故障矩阵使用的收费项目。',
        billingUnitCode: 'TIMES',
        chargingMethodCode: 'COUNT',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
      },
    );
    await approveDraft(workflowApplication, {
      suffix: 'fault-charge',
      governanceObjectId: foundation.chargeCatalogObjectId,
      entityType: 'CHARGE_ITEM_VERSION',
      stableEntityId: chargeDraft.chargeItemId,
      entityVersionId: chargeDraft.chargeItemVersionId,
      contentHash: chargeDraft.contentHash,
      riskClassification: 'NORMAL',
      changeKind: 'INITIAL_PUBLICATION',
      changeReason: '建立故障矩阵引用收费项目',
      frozenEvidence: { catalogCode: 'HOSPITAL-CHARGE-CATALOG' },
      submittedAt: '2026-08-08T10:01:00',
      reviewedAt: '2026-08-08T10:02:00',
      approvedAt: '2026-08-08T10:03:00',
    });
    await runner.run(
      requestContext(foundation.actorId, 'fault-subscription', '2026-08-08T10:04:00'),
      (modules) =>
        modules.releaseDistribution.createSubscription({
          subscriptionCode: 'SIM-CONSUMER-FAULT-MATRIX',
          servicePrincipalId: foundation.servicePrincipalId,
          governanceObjectId: foundation.priceListObjectId,
          projectionType: PRICE_LIST_PROJECTION_TYPE,
          projectionSchemaVersion: PRICE_LIST_PROJECTION_SCHEMA_VERSION,
        }),
    );
    const priceDraft = await slice.createPriceListDraft(
      requestContext(foundation.actorId, 'fault-price-draft', '2026-08-08T10:05:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        priceListCode: 'HOSPITAL-DEFAULT-PRICE',
        displayName: '故障矩阵价表',
        currencyCode: 'CNY',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
        entries: [{
          chargeItemId: chargeDraft.chargeItemId,
          chargeItemVersionId: chargeDraft.chargeItemVersionId,
          scopeLevel: 'HOSPITAL',
          campusId: null,
          encounterMode: 'GENERAL',
          encounterType: null,
          fixedUnitPrice: '18.00',
          billingUnitCode: 'TIMES',
          businessValidFrom: '2026-08-08T00:00:00',
          businessValidTo: null,
          zeroPriceReason: null,
        }],
      },
    );
    const submitted = await workflowApplication.submit(
      requestContext(foundation.actorId, 'fault-price-submit', '2026-08-08T10:06:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        entityType: 'PRICE_LIST_RELEASE',
        stableEntityId: priceDraft.priceListId,
        entityVersionId: priceDraft.priceListReleaseId,
        changeKind: priceDraft.releaseNo === '1' ? 'INITIAL_PUBLICATION' : 'VERSION_CHANGE',
        riskClassification: 'HIGH',
        submittedContentDigest: priceDraft.contentHash.toString('hex'),
        changeReason: '验证发布事务逐写点回滚',
        campusId: null,
        frozenEvidence: {},
      },
    );
    await workflowApplication.act(
      requestContext(foundation.reviewerId, 'fault-price-review', '2026-08-08T10:07:00'),
      {
        changeRequestId: submitted.changeRequestId,
        stageType: 'PROFESSIONAL_REVIEW',
        actionResult: 'APPROVED',
        reason: '故障矩阵专业复核通过',
        seenContentDigest: priceDraft.contentHash.toString('hex'),
        campusId: null,
      },
    );

    const baseline = await publicationSideEffectCounts(databaseHandle.database);
    const recordingPeriodBaseline = await publishedPriceListRecordingPeriods(
      databaseHandle.database,
      priceDraft.priceListId,
    );
    const results: {
      readonly faultPoint: PublicationTransactionFaultPoint;
      readonly rolledBack: boolean;
    }[] = [];
    for (const faultPoint of PUBLICATION_TRANSACTION_FAULT_POINTS) {
      configureControlledPublicationFault(faultPoint);
      try {
        await expect(
          workflowApplication.act(
            requestContext(
              foundation.approverId,
              `fault-price-approve-${faultPoint}`,
              '2026-08-08T10:08:00',
            ),
            {
              changeRequestId: submitted.changeRequestId,
              stageType: 'OWNER_FINAL_APPROVAL',
              actionResult: 'APPROVED',
              reason: `故障矩阵终审 ${faultPoint}`,
              seenContentDigest: priceDraft.contentHash.toString('hex'),
              campusId: null,
            },
          ),
        ).rejects.toThrow(`CONTROLLED_PUBLICATION_FAULT:${faultPoint}`);
      } finally {
        configureControlledPublicationFault(null);
      }
      const afterFault = await publicationSideEffectCounts(databaseHandle.database);
      expect(afterFault).toEqual(baseline);
      expect(
        await publishedPriceListRecordingPeriods(
          databaseHandle.database,
          priceDraft.priceListId,
        ),
      ).toEqual(recordingPeriodBaseline);
      const unchangedDraft = await databaseHandle.database
        .selectFrom('price_list.price_list_release')
        .select(['governance_status', 'recorded_from', 'content_hash'])
        .where('price_list_release_id', '=', priceDraft.priceListReleaseId)
        .executeTakeFirstOrThrow();
      expect(unchangedDraft.governance_status).toBe('DRAFT');
      expect(unchangedDraft.recorded_from).toBe('2026-08-08T10:05:00');
      expect(unchangedDraft.content_hash.equals(priceDraft.contentHash)).toBe(true);
      results.push({ faultPoint, rolledBack: true });
      recordIntegrationObservation({
        producerId: 'fault',
        scenarioId: 'FAULT-PUBLICATION-ATOMIC-WRITE-MATRIX',
        assertionId: faultPointAssertionId(faultPoint),
        gateId: 'ABG-32',
        description: 'Publication transaction rolled back at controlled point ' + faultPoint + '.',
        requestIds: ['request-fault-price-approve-' + faultPoint],
        principalIds: [foundation.approverId],
        governanceObjectIds: [foundation.priceListObjectId],
        versionIds: [priceDraft.priceListReleaseId],
        ruleVersions: ['phase-01.publication-atomicity.v1'],
      });
    }
    expect(results).toEqual(
      PUBLICATION_TRANSACTION_FAULT_POINTS.map((faultPoint) => ({
        faultPoint,
        rolledBack: true,
      })),
    );
    const successful = await workflowApplication.act(
      requestContext(foundation.approverId, 'fault-price-approve-success', '2026-08-08T10:09:00'),
      {
        changeRequestId: submitted.changeRequestId,
        stageType: 'OWNER_FINAL_APPROVAL',
        actionResult: 'APPROVED',
        reason: '故障矩阵成功对照终审',
        seenContentDigest: priceDraft.contentHash.toString('hex'),
        campusId: null,
      },
    );
    expect(successful.request.requestStatus).toBe('APPROVED');
    expect(successful.publication).not.toBeNull();
  }, 120_000);

  it('accepts exactly 16 MiB and rejects 16 MiB plus one before publication writes', async () => {
    if (!databaseHandle) throw new Error('Integration database was not initialized');
    const runner = createTransactionRunner<ScopedModules>(
      databaseHandle.database,
      (transaction, context) =>
        createScopedModules(transaction, context, databaseHandle?.database),
    );
    const slice = createPhase01VerticalSlice(runner);
    const draft = await slice.createChargeItemDraft(
      requestContext(foundation.actorId, 'capacity-draft', '2026-08-08T11:00:00'),
      {
        governanceObjectId: foundation.chargeCatalogObjectId,
        internalCode: 'POC-CAPACITY-FEE-001',
        formalName: '容量边界收费项目',
        serviceDefinition: '用于精确规范快照容量边界验证。',
        billingUnitCode: 'TIMES',
        chargingMethodCode: 'COUNT',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
      },
    );
    const schemaDigest = canonicalSha256(ChargeCatalogProjectionSchema);
    const nextReleaseNo = await loadNextReleaseNo(
      databaseHandle.database,
      foundation.chargeCatalogObjectId,
    );
    const exactProjection = buildExactChargeCatalogProjection({
      targetByteLength: 16_777_216,
      governanceObjectId: foundation.chargeCatalogObjectId,
      releaseNo: nextReleaseNo,
      releaseId: '00000000-0000-7000-8000-000000000001',
      schemaDigest,
      draft,
    });
    const exactPublication = await runner.run(
      requestContext(foundation.approverId, 'capacity-exact', '2026-08-08T11:01:00'),
      async (modules) => {
        const publication = await modules.releaseDistribution.registerPublication({
          governanceObjectId: foundation.chargeCatalogObjectId,
          aggregateType: 'CHARGE_CATALOG',
          businessValidFrom: draft.businessValidFrom,
          businessValidTo: draft.businessValidTo,
          recordedFrom: '2026-08-08T11:01:00',
          submittedBy: foundation.actorId,
          approvedBy: foundation.approverId,
          approvedAt: '2026-08-08T11:01:00',
          changeReason: '精确16 MiB规范快照容量边界',
          projection: {
            projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
            schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
            payload: exactProjection,
            itemCount: exactProjection.items.length,
          },
          member: {
            kind: 'CHARGE_ITEM',
            stableId: draft.chargeItemId,
            versionId: draft.chargeItemVersionId,
            snapshotName: draft.formalName,
            memberHash: draft.contentHash,
          },
        });
        await modules.chargeCatalog.confirmPublication({
          chargeItemVersionId: draft.chargeItemVersionId,
          releaseId: publication.releaseId,
        });
        await modules.audit.append({
          auditStreamId: foundation.chargeCatalogObjectId,
          governanceObjectId: foundation.chargeCatalogObjectId,
          entityType: 'CHARGE_ITEM_VERSION',
          stableEntityId: draft.chargeItemId,
          entityVersionId: draft.chargeItemVersionId,
          action: 'PUBLISHED',
          afterHash: draft.contentHash,
          authorityScope: 'CAPACITY_BOUNDARY_TEST',
        });
        return publication;
      },
    );
    expect(exactPublication.artifactByteLength).toBe(16_777_216);
    const stored = await runner.run(
      requestContext(foundation.actorId, 'capacity-download', '2026-08-08T11:01:01'),
      (modules) => modules.releaseDistribution.getSnapshot(exactPublication.snapshotId),
    );
    expect(stored.bytes.byteLength).toBe(16_777_216);
    expect(sha256Bytes(stored.bytes).equals(stored.digest)).toBe(true);

    const oversizedReleaseNo = await loadNextReleaseNo(
      databaseHandle.database,
      foundation.chargeCatalogObjectId,
    );
    const oversizedProjection = buildExactChargeCatalogProjection({
      targetByteLength: 16_777_217,
      governanceObjectId: foundation.chargeCatalogObjectId,
      releaseNo: oversizedReleaseNo,
      releaseId: '00000000-0000-7000-8000-000000000001',
      schemaDigest,
      draft,
    });
    const beforeOversized = await publicationSideEffectCounts(databaseHandle.database);
    await expect(
      runner.run(
        requestContext(foundation.approverId, 'capacity-oversized', '2026-08-08T11:02:00'),
        (modules) =>
          modules.releaseDistribution.registerPublication({
            governanceObjectId: foundation.chargeCatalogObjectId,
            aggregateType: 'CHARGE_CATALOG',
            businessValidFrom: draft.businessValidFrom,
            businessValidTo: draft.businessValidTo,
            recordedFrom: '2026-08-08T11:02:00',
            submittedBy: foundation.actorId,
            approvedBy: foundation.approverId,
            approvedAt: '2026-08-08T11:02:00',
            changeReason: '精确16 MiB加一拒绝边界',
            projection: {
              projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
              schemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
              payload: oversizedProjection,
              itemCount: oversizedProjection.items.length,
            },
            member: {
              kind: 'CHARGE_ITEM',
              stableId: draft.chargeItemId,
              versionId: draft.chargeItemVersionId,
              snapshotName: draft.formalName,
              memberHash: draft.contentHash,
            },
          }),
      ),
    ).rejects.toThrow('SNAPSHOT_ARTIFACT_TOO_LARGE');
    expect(await publicationSideEffectCounts(databaseHandle.database)).toEqual(beforeOversized);
    recordIntegrationObservation({
      producerId: 'capacity',
      scenarioId: 'INTEGRATION-SNAPSHOT-16MIB-BOUNDARY',
      assertionId: 'ABG-37:canonical-artifact-16mib-exact-accepted',
      gateId: 'ABG-37',
      description: 'Canonical snapshot exactly 16 MiB was accepted and downloaded with matching digest.',
      requestIds: ['request-capacity-exact', 'request-capacity-download'],
      principalIds: [foundation.approverId, foundation.actorId],
      governanceObjectIds: [foundation.chargeCatalogObjectId],
      versionIds: [draft.chargeItemVersionId, exactPublication.releaseId],
      ruleVersions: [CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION],
    });
    recordIntegrationObservation({
      producerId: 'capacity',
      scenarioId: 'INTEGRATION-SNAPSHOT-16MIB-BOUNDARY',
      assertionId: 'ABG-37:canonical-artifact-16mib-plus-one-rejected',
      gateId: 'ABG-37',
      description: 'Canonical snapshot of 16 MiB plus one byte was rejected before publication writes.',
      requestIds: ['request-capacity-oversized'],
      principalIds: [foundation.approverId],
      governanceObjectIds: [foundation.chargeCatalogObjectId],
      versionIds: [draft.chargeItemVersionId],
      ruleVersions: [CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION],
    });
  }, 180_000);
});

function recordIntegrationObservation(observation: IntegrationEvidenceObservation): void {
  integrationEvidenceObservations.push(observation);
}

function faultPointAssertionId(faultPoint: PublicationTransactionFaultPoint): string {
  const assertionByFaultPoint: Readonly<Record<PublicationTransactionFaultPoint, string>> = {
    WORKFLOW_DECISION_WRITTEN: 'ABG-32:publication-workflow-decision-rollback',
    RELEASE_ENVELOPE_WRITTEN: 'ABG-32:publication-release-envelope-rollback',
    SNAPSHOT_ARTIFACT_WRITTEN: 'ABG-32:publication-snapshot-artifact-rollback',
    RELEASE_MEMBER_WRITTEN: 'ABG-32:publication-release-member-rollback',
    OUTBOX_EVENT_WRITTEN: 'ABG-32:publication-outbox-event-rollback',
    COMPATIBILITY_PRECHECK_WRITTEN: 'ABG-32:publication-compatibility-precheck-rollback',
    DELIVERY_REGISTERED: 'ABG-32:publication-delivery-registration-rollback',
    DOMAIN_CANDIDATE_CONFIRMED: 'ABG-32:publication-domain-candidate-confirmation-rollback',
    AUDIT_EVENT_WRITTEN: 'ABG-32:publication-audit-event-rollback',
  };
  return assertionByFaultPoint[faultPoint];
}

async function writeIntegrationEvidenceObservations(): Promise<void> {
  const path = process.env['PHASE01_INTEGRATION_EVIDENCE_PATH'];
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    JSON.stringify({
      schemaVersion: 'phase-01.integration-observations.v1',
      observations: integrationEvidenceObservations,
    }, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}

async function publicationSideEffectCounts(database: DatabaseHandle['database']) {
  const result = await sql<{
    readonly release_count: string;
    readonly snapshot_count: string;
    readonly member_count: string;
    readonly outbox_count: string;
    readonly compatibility_count: string;
    readonly delivery_count: string;
    readonly audit_count: string;
    readonly checkpoint_count: string;
    readonly approval_action_count: string;
  }>`
    select
      (select count(*)::bigint from release_distribution.governance_release) as release_count,
      (select count(*)::bigint from release_distribution.release_snapshot) as snapshot_count,
      (
        (select count(*) from release_distribution.release_member_charge_item) +
        (select count(*) from release_distribution.release_member_price_list)
      )::bigint as member_count,
      (select count(*)::bigint from release_distribution.outbox_event) as outbox_count,
      (select count(*)::bigint from release_distribution.release_consumer_compatibility) as compatibility_count,
      (select count(*)::bigint from release_distribution.outbox_delivery_state) as delivery_count,
      (select count(*)::bigint from audit.audit_event) as audit_count,
      (select count(*)::bigint from release_distribution.consumer_checkpoint) as checkpoint_count,
      (select count(*)::bigint from workflow.approval_action) as approval_action_count
  `.execute(database);
  return result.rows[0];
}

function publishedPriceListRecordingPeriods(
  database: DatabaseHandle['database'],
  priceListId: string,
) {
  return database
    .selectFrom('price_list.price_list_release')
    .select([
      'price_list_release_id as priceListReleaseId',
      'recorded_from as recordedFrom',
      'recorded_to as recordedTo',
    ])
    .where('price_list_id', '=', priceListId)
    .where('governance_status', '=', 'PUBLISHED')
    .orderBy('release_no', 'asc')
    .execute();
}

async function loadNextReleaseNo(
  database: DatabaseHandle['database'],
  governanceObjectId: string,
): Promise<string> {
  const result = await database
    .selectFrom('release_distribution.governance_release')
    .select((expression) => expression.fn.max('release_no').as('last_release_no'))
    .where('governance_object_id', '=', governanceObjectId)
    .executeTakeFirstOrThrow();
  return (BigInt(result.last_release_no ?? '0') + 1n).toString();
}

function buildExactChargeCatalogProjection(command: {
  readonly targetByteLength: number;
  readonly governanceObjectId: string;
  readonly releaseId: string;
  readonly releaseNo: string;
  readonly schemaDigest: Buffer;
  readonly draft: {
    readonly chargeItemId: string;
    readonly chargeItemVersionId: string;
    readonly versionNo: string;
    readonly internalCode: string;
    readonly formalName: string;
    readonly billingUnitCode: string;
    readonly chargingMethodCode: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly contentHash: Buffer;
  };
}): ChargeCatalogProjection {
  const makeItem = (serviceDefinition: string): ChargeCatalogProjection['items'][number] => ({
    chargeItemId: command.draft.chargeItemId,
    chargeItemVersionId: command.draft.chargeItemVersionId,
    versionNo: command.draft.versionNo,
    internalCode: command.draft.internalCode,
    formalName: command.draft.formalName,
    serviceDefinition,
    billingUnitCode: command.draft.billingUnitCode,
    chargingMethodCode: command.draft.chargingMethodCode,
    businessStatus: 'ACTIVE',
    businessValidFrom: command.draft.businessValidFrom,
    businessValidTo: command.draft.businessValidTo,
    recordedFrom: command.draft.recordedFrom,
    contentHash: command.draft.contentHash.toString('hex'),
  });
  const measure = (items: ChargeCatalogProjection['items']): number =>
    buildCanonicalSnapshotArtifact({
      aggregateType: 'CHARGE_CATALOG',
      governanceObjectId: command.governanceObjectId,
      releaseId: command.releaseId,
      releaseNo: command.releaseNo,
      releaseKind: 'NORMAL',
      businessValidFrom: command.draft.businessValidFrom,
      businessValidTo: command.draft.businessValidTo,
      projectionType: CHARGE_CATALOG_PROJECTION_TYPE,
      projectionSchemaVersion: CHARGE_CATALOG_PROJECTION_SCHEMA_VERSION,
      projectionSchemaDigest: command.schemaDigest,
      payload: { catalogCode: 'CAPACITY-BOUNDARY', items },
    }).byteLength;
  const oneMinimum = measure([makeItem('x')]);
  const twoMinimum = measure([makeItem('x'), makeItem('x')]);
  const minimumItemIncrement = twoMinimum - oneMinimum;
  let itemCount = Math.max(
    1,
    Math.ceil(
      (command.targetByteLength - (oneMinimum - minimumItemIncrement)) /
        (minimumItemIncrement + 1_999),
    ),
  );
  const minimumSize = (count: number) =>
    oneMinimum + (count - 1) * minimumItemIncrement;
  while (minimumSize(itemCount) > command.targetByteLength) itemCount -= 1;
  while (minimumSize(itemCount) + itemCount * 1_999 < command.targetByteLength) {
    itemCount += 1;
  }
  let remainingPadding = command.targetByteLength - minimumSize(itemCount);
  const items = Array.from({ length: itemCount }, () => {
    const padding = Math.min(1_999, remainingPadding);
    remainingPadding -= padding;
    return makeItem('x'.repeat(1 + padding));
  });
  if (remainingPadding !== 0 || measure(items) !== command.targetByteLength) {
    throw new Error('CAPACITY_VECTOR_EXACT_LENGTH_FAILED');
  }
  return { catalogCode: 'CAPACITY-BOUNDARY', items };
}

async function approveDraft(
  workflowApplication: WorkflowApplication,
  command: {
    readonly suffix: string;
    readonly governanceObjectId: string;
    readonly entityType: GovernedEntityType;
    readonly stableEntityId: string;
    readonly entityVersionId: string;
    readonly contentHash: Buffer;
    readonly riskClassification: RiskClassification;
    readonly changeKind: ChangeKind;
    readonly changeReason: string;
    readonly frozenEvidence: Readonly<Record<string, unknown>>;
    readonly submittedAt: string;
    readonly reviewedAt: string;
    readonly approvedAt: string;
  },
): Promise<RegisteredPublication> {
  const submitted = await workflowApplication.submit(
    requestContext(foundation.actorId, `${command.suffix}-submit`, command.submittedAt),
    {
      governanceObjectId: command.governanceObjectId,
      entityType: command.entityType,
      stableEntityId: command.stableEntityId,
      entityVersionId: command.entityVersionId,
      changeKind: command.changeKind,
      riskClassification: command.riskClassification,
      submittedContentDigest: command.contentHash.toString('hex'),
      changeReason: command.changeReason,
      campusId: null,
      frozenEvidence: command.frozenEvidence,
    },
  );
  await workflowApplication.act(
    requestContext(foundation.reviewerId, `${command.suffix}-review`, command.reviewedAt),
    {
      changeRequestId: submitted.changeRequestId,
      stageType: 'PROFESSIONAL_REVIEW',
      actionResult: 'APPROVED',
      reason: '合成专业复核通过',
      seenContentDigest: command.contentHash.toString('hex'),
      campusId: null,
    },
  );
  const approved = await workflowApplication.act(
    requestContext(foundation.approverId, `${command.suffix}-approve`, command.approvedAt),
    {
      changeRequestId: submitted.changeRequestId,
      stageType: 'OWNER_FINAL_APPROVAL',
      actionResult: 'APPROVED',
      reason: '合成Owner终审通过',
      seenContentDigest: command.contentHash.toString('hex'),
      campusId: null,
    },
  );
  if (!approved.publication) throw new Error('APPROVED_PUBLICATION_MISSING');
  return approved.publication;
}

async function seedFoundation(database: DatabaseHandle): Promise<FoundationIds> {
  const actor = await database.database
    .insertInto('platform.security_principal')
    .values({ principal_code: 'poc-governance-owner', principal_kind: 'PERSON' })
    .returning('security_principal_id')
    .executeTakeFirstOrThrow();
  const reviewer = await database.database
    .insertInto('platform.security_principal')
    .values({ principal_code: 'poc-professional-reviewer', principal_kind: 'PERSON' })
    .returning('security_principal_id')
    .executeTakeFirstOrThrow();
  const approver = await database.database
    .insertInto('platform.security_principal')
    .values({ principal_code: 'poc-governance-approver', principal_kind: 'PERSON' })
    .returning('security_principal_id')
    .executeTakeFirstOrThrow();
  const service = await database.database
    .insertInto('platform.security_principal')
    .values({ principal_code: 'poc-sim-consumer', principal_kind: 'SERVICE' })
    .returning('security_principal_id')
    .executeTakeFirstOrThrow();
  const incompatibleService = await database.database
    .insertInto('platform.security_principal')
    .values({ principal_code: 'poc-sim-consumer-legacy', principal_kind: 'SERVICE' })
    .returning('security_principal_id')
    .executeTakeFirstOrThrow();
  const campus = await database.database
    .insertInto('platform.campus')
    .values({ campus_code: 'MAIN', display_name: '合成主院区' })
    .returning('campus_id')
    .executeTakeFirstOrThrow();
  const chargeObject = await database.database
    .insertInto('platform.governance_object')
    .values({
      object_code: 'CHARGE-CATALOG',
      object_type: 'CHARGE_CATALOG',
      display_name: '收费项目目录',
      created_by: actor.security_principal_id,
    })
    .returning('governance_object_id')
    .executeTakeFirstOrThrow();
  const priceObject = await database.database
    .insertInto('platform.governance_object')
    .values({
      object_code: 'PRICE-LIST',
      object_type: 'PRICE_LIST',
      display_name: '价表',
      created_by: actor.security_principal_id,
    })
    .returning('governance_object_id')
    .executeTakeFirstOrThrow();
  await database.database
    .insertInto('access_control.object_permission_grant')
    .values([
      {
        governance_object_id: chargeObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'CHARGE_CATALOG_DRAFT_WRITE',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: chargeObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'CHARGE_CATALOG_SUBMIT',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'PRICE_LIST_DRAFT_WRITE',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'PRICE_LIST_DRAFT_READ',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'PRICE_LIST_SUBMIT',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: chargeObject.governance_object_id,
        security_principal_id: reviewer.security_principal_id,
        permission_code: 'CHARGE_CATALOG_REVIEW',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: reviewer.security_principal_id,
        permission_code: 'PRICE_LIST_REVIEW',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: chargeObject.governance_object_id,
        security_principal_id: approver.security_principal_id,
        permission_code: 'CHARGE_CATALOG_APPROVE',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: approver.security_principal_id,
        permission_code: 'PRICE_LIST_APPROVE',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'PRICE_RESOLVE',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
      {
        governance_object_id: priceObject.governance_object_id,
        security_principal_id: actor.security_principal_id,
        permission_code: 'CONSUMER_SUBSCRIPTION_MANAGE',
        grant_effect: 'ALLOW',
        valid_from: '2026-08-08T00:00:00',
        valid_to: null,
        grant_sequence: '1',
        granted_by: actor.security_principal_id,
        reason: 'Phase 01合成授权',
      },
    ])
    .execute();
  return {
    actorId: actor.security_principal_id,
    reviewerId: reviewer.security_principal_id,
    approverId: approver.security_principal_id,
    servicePrincipalId: service.security_principal_id,
    incompatibleServicePrincipalId: incompatibleService.security_principal_id,
    campusId: campus.campus_id,
    chargeCatalogObjectId: chargeObject.governance_object_id,
    priceListObjectId: priceObject.governance_object_id,
  };
}

function requestContext(
  actorPrincipalId: string,
  suffix: string,
  occurredAt: string,
) {
  return {
    actorPrincipalId,
    requestId: `request-${suffix}`,
    correlationId: `correlation-${suffix}`,
    occurredAt,
  };
}

function formalTestcontainerLabels(): Readonly<Record<string, string>> {
  const runId = process.env['ABG_RUN_ID'];
  const runSequence = process.env['ABG_RUN_SEQUENCE'];
  const runtimeNamespace = process.env['ABG_RUNTIME_NAMESPACE'];
  if (runId !== undefined && (runSequence === undefined || runtimeNamespace === undefined)) {
    throw new Error('FORMAL_TESTCONTAINER_RUN_IDENTITY_INCOMPLETE');
  }
  return {
    'hdi.repository': RUNTIME_AUTHORITY.labels.static['hdi.repository'],
    'hdi.phase': RUNTIME_AUTHORITY.labels.static['hdi.phase'],
    'hdi.run-id': runId ?? `integration-${process.pid}`,
    'hdi.run-sequence': runSequence ?? '0',
    'hdi.managed-by': runId === undefined
      ? 'integration-test'
      : RUNTIME_AUTHORITY.labels.static['hdi.managed-by'],
  };
}

function integrationPostgresContainerName(): string {
  const runtimeNamespace = process.env['ABG_RUNTIME_NAMESPACE'];
  return runtimeNamespace === undefined
    ? `phase-01-integration-postgres-${process.pid}`
    : `${runtimeNamespace}_integration_postgres`;
}

async function writeTestcontainerRuntimeEvent(
  event: 'STARTED' | 'STOPPED',
  startedContainer: StartedTestContainer,
): Promise<void> {
  const eventDirectory = process.env['ABG_RUNTIME_EVENT_DIR'];
  if (eventDirectory === undefined) return;
  const runId = process.env['ABG_RUN_ID'];
  const runSequence = process.env['ABG_RUN_SEQUENCE'];
  const runtimeNamespace = process.env['ABG_RUNTIME_NAMESPACE'];
  if (runId === undefined || runSequence === undefined || runtimeNamespace === undefined) {
    throw new Error('FORMAL_TESTCONTAINER_EVENT_IDENTITY_INCOMPLETE');
  }
  const id = startedContainer.getId();
  await mkdir(eventDirectory, { recursive: true, mode: 0o700 });
  await writeFile(
    resolve(eventDirectory, `container-integration-postgres-${id}-${event.toLowerCase()}.json`),
    JSON.stringify({
      schemaVersion: 'phase-01.formal-runtime-event.v1',
      runId,
      runSequence: Number(runSequence),
      runtimeNamespace,
      event,
      resourceType: 'container',
      id,
      name: POSTGRES_CONTAINER_NAME,
      role: 'testcontainers-postgres',
      labels: TESTCONTAINER_LABELS,
      occurredAt: new Date().toISOString(),
      imageReference: POSTGRES_IMAGE,
      imageDigest: POSTGRES_IMAGE.split('@')[1] ?? null,
      restartPolicy: RUNTIME_AUTHORITY.podman.restartPolicy,
      ports: [{
        containerPort: `${POSTGRES_HOST_PORT}/tcp`,
        hostIp: RUNTIME_AUTHORITY.network.bindAddress,
        hostPort: POSTGRES_HOST_PORT,
      }],
      ...(event === 'STOPPED' ? { exitStatus: 'STOPPED_BY_TESTCONTAINERS' } : {}),
    }, null, 2) + '\n',
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
}
