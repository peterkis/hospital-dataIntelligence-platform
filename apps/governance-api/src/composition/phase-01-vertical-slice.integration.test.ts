import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { sql } from 'kysely';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '../platform/database/create-database.js';
import { sha256Bytes } from '../platform/hashing/canonical-hash.js';
import { createTransactionRunner } from '../platform/transaction/transaction-runner.js';
import {
  PRICE_LIST_LEGACY_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_SCHEMA_VERSION,
  PRICE_LIST_PROJECTION_TYPE,
} from '../modules/price-list/index.js';
import {
  createReleaseDistributionDispatcher,
  ReleaseNotificationError,
  type ReleaseNotification,
} from '../modules/release-distribution/index.js';
import { createScopedModules, type ScopedModules } from './create-scoped-modules.js';
import { createPhase01VerticalSlice } from './phase-01-vertical-slice.js';
import { buildApplication } from './build-application.js';

const POSTGRES_IMAGE =
  'postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382';
const MIGRATION_DIRECTORY = resolve(
  import.meta.dirname,
  '../../../../db/migrations',
);

interface FoundationIds {
  readonly actorId: string;
  readonly servicePrincipalId: string;
  readonly incompatibleServicePrincipalId: string;
  readonly campusId: string;
  readonly chargeCatalogObjectId: string;
  readonly priceListObjectId: string;
}

let container: StartedTestContainer | undefined;
let databaseHandle: DatabaseHandle | undefined;
let foundation: FoundationIds;

process.env['TESTCONTAINERS_RYUK_DISABLED'] = 'true';

beforeAll(async () => {
  container = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_HOST_AUTH_METHOD: 'trust',
      TZ: 'Asia/Shanghai',
    })
    .withCommand(['-c', 'timezone=Asia/Shanghai'])
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/u, 2))
    .start();

  const poolConfig = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
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
  await databaseHandle?.close();
  await container?.stop();
}, 30_000);

describe('Phase 01 executable vertical slice', () => {
  it('publishes, resolves, audits, snapshots, and closes simulated consumption', async () => {
    if (!databaseHandle) throw new Error('Integration database was not initialized');
    const runner = createTransactionRunner<ScopedModules>(
      databaseHandle.database,
      createScopedModules,
    );
    const slice = createPhase01VerticalSlice(runner);
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
    const chargeContext = requestContext(foundation.actorId, 'charge-publish', '2026-08-08T09:00:00');
    const charge = await slice.publishChargeItem(chargeContext, {
      governanceObjectId: foundation.chargeCatalogObjectId,
      catalogCode: 'HOSPITAL-CHARGE-CATALOG',
      internalCode: 'POC-FEE-001',
      formalName: 'POC诊查费',
      serviceDefinition: '合成POC收费项目，仅用于验证治理闭环。',
      billingUnitCode: 'TIMES',
      chargingMethodCode: 'COUNT',
      businessValidFrom: '2026-08-08T00:00:00',
      businessValidTo: null,
      changeReason: '建立纵向切片收费项目初始版本',
    });

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

    const priceContext = requestContext(foundation.actorId, 'price-publish', '2026-08-08T09:10:00');
    const price = await slice.publishPriceList(priceContext, {
      governanceObjectId: foundation.priceListObjectId,
      priceListCode: 'HOSPITAL-DEFAULT-PRICE',
      displayName: 'POC全院默认价表',
      currencyCode: 'CNY',
      businessValidFrom: '2026-08-08T00:00:00',
      businessValidTo: null,
      changeReason: '建立纵向切片价表初始完整快照',
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
    const secondPrice = await slice.publishPriceList(
      requestContext(foundation.actorId, 'price-publish-version-2', '2026-08-08T09:50:00'),
      {
        governanceObjectId: foundation.priceListObjectId,
        priceListCode: 'HOSPITAL-DEFAULT-PRICE',
        displayName: 'POC全院默认价表第二版',
        currencyCode: 'CNY',
        businessValidFrom: '2026-08-08T00:00:00',
        businessValidTo: null,
        changeReason: '验证稳定价表身份下的显式新版本发布',
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
    expect(secondPrice.priceListId).toBe(price.priceListId);
    expect(secondPrice.priceListReleaseId).not.toBe(price.priceListReleaseId);
    const secondSnapshot = await runner.run(
      requestContext(foundation.actorId, 'price-version-2-snapshot', '2026-08-08T09:50:10'),
      (modules) => modules.releaseDistribution.getSnapshot(secondPrice.snapshotId),
    );
    expect(
      (JSON.parse(secondSnapshot.bytes.toString('utf8')) as { payload: { releaseNo: string } })
        .payload.releaseNo,
    ).toBe('2');
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
  }, 120_000);
});

async function seedFoundation(database: DatabaseHandle): Promise<FoundationIds> {
  const actor = await database.database
    .insertInto('platform.security_principal')
    .values({ principal_code: 'poc-governance-owner', principal_kind: 'PERSON' })
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
        permission_code: 'CHARGE_CATALOG_PUBLISH',
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
        permission_code: 'PRICE_LIST_PUBLISH',
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
