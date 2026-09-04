import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import type { RequestContext, TransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createReleaseDistributionDispatcher, type ConsumerSubscriptionLifecycleStatus } from '../../apps/governance-api/src/modules/release-distribution/index.js';
import { createConsumerReferenceReader } from '../../apps/governance-api/src/platform/release-consumer/consumer-reference-reader.js';
import { createGovernanceApiClient, type GovernanceApiOperations } from '@hospital-data-intelligence/generated-api-client';
import { PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';
import { PROTOTYPE_FIXTURE as fixture } from './prototype-fixture.js';

type Client = ReturnType<typeof createGovernanceApiClient>;
type Event = GovernanceApiOperations['listPhase01ConsumerEvents']['responses'][200]['content']['application/json']['events'][number];
type History = Awaited<ReturnType<ScopedModules['releaseDistribution']['getSubscriptionHistory']>>;
const lifecyclePath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions';
const eventsPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/events';
const snapshotPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content';
const receiptPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts';
const csrf = { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN };

export async function checkConsumerLifecycleFlow(input: {
  database: Kysely<DB>; runner: TransactionRunner<ScopedModules>;
  context(actorPrincipalId?: string): RequestContext;
  owner: Client; reviewer: Client; service: Client; otherService: Client;
  baseUrl: string; subscriptionId: string; event: Event;
}) {
  const { database, runner, context, subscriptionId, event, owner, service } = input;
  const governanceObjectId = event.governanceObjectId;
  const scope = { subscriptionId, governanceObjectId };
  const consumer = { subscriptionId, servicePrincipalId: fixture.serviceConsumerPrincipalId };
  const history = () => runner.run(context(), (m) => m.releaseDistribution.getSubscriptionHistory(scope));
  const change = (targetStatus: ConsumerSubscriptionLifecycleStatus, client = owner) => client.POST(lifecyclePath, {
    params: { path: { subscriptionId }, header: csrf }, body: { governanceObjectId, targetStatus, reason: 'PROTOTYPE SYNTHETIC lifecycle validation' },
  });
  const moduleChange = (targetStatus: ConsumerSubscriptionLifecycleStatus) => runner.run(context(), (m) =>
    m.releaseDistribution.changeSubscriptionLifecycle({ ...scope, targetStatus }));
  const receipt = { ...consumer, eventId: event.eventId, receiveResult: 'ACCEPTED' as const,
    validationResult: 'VALID' as const, applyResult: 'APPLIED' as const,
    processingDigest: Buffer.from(event.snapshotArtifactDigest, 'hex'), processedAt: context().occurredAt };
  const version = () => runner.run(context(), (m) => m.releaseDistribution.createSubscriptionVersion({
    ...scope, projectionType: event.projectionType, projectionSchemaVersion: '1',
  }));
  const auditEvents = () => database.selectFrom('audit.audit_event').selectAll()
    .where('audit_stream_id', '=', subscriptionId).orderBy('audit_sequence').execute();
  const stableHistory = ({ lifecycleStatus: _status, lifecycleChangedAt: _at, ...rest }: History) => rest;
  const initial = await history();
  assert.equal(initial.lifecycleStatus, 'ACTIVE');
  const originalArtifact = await runner.run(context(), (m) => m.releaseDistribution.getSnapshot(event.snapshotId));
  await assert.rejects(runner.run(context(fixture.serviceConsumerPrincipalId), (m) =>
    m.releaseDistribution.getSnapshot(event.snapshotId)), { message: 'PRINCIPAL_KIND_FORBIDDEN' });
  const sourceRelease = await database.selectFrom('release_distribution.governance_release').selectAll()
    .where('release_id', '=', event.releaseId).executeTakeFirstOrThrow();
  const sourceMember = await database.selectFrom('release_distribution.release_member_department').selectAll()
    .where('release_id', '=', event.releaseId).executeTakeFirstOrThrow();
  const envelope = JSON.parse(originalArtifact.bytes.toString('utf8')) as { payload: unknown };
  const publishAgain = () => runner.run(context(), (m) => m.releaseDistribution.registerPublication({
    governanceObjectId, aggregateType: 'DEPARTMENT_MASTER', releaseKind: 'HISTORICAL_REPUBLICATION',
    businessValidFrom: sourceRelease.business_valid_from, businessValidTo: sourceRelease.business_valid_to,
    recordedFrom: context().occurredAt, submittedBy: sourceRelease.submitted_by,
    approvedBy: sourceRelease.approved_by, approvedAt: context().occurredAt,
    changeReason: 'PROTOTYPE SYNTHETIC lifecycle backlog check',
    projection: { projectionType: event.projectionType, schemaVersion: '1', itemCount: 1, payload: envelope.payload },
    member: { kind: 'DEPARTMENT', stableId: sourceMember.department_id, versionId: sourceMember.department_version_id,
      snapshotName: sourceMember.snapshot_name, memberHash: sourceMember.member_hash },
  }));
  const originalVersions = await database.selectFrom('release_distribution.consumer_subscription_version')
    .selectAll().where('consumer_subscription_id', '=', subscriptionId).orderBy('version_no').execute();
  await change('ACTIVE').then(ok);
  assert.equal((await auditEvents()).length, 0);
  assert.deepEqual(await history(), initial);

  await rejected(change('SUSPENDED', service), 403, 'PRINCIPAL_KIND_FORBIDDEN');
  await rejected(change('SUSPENDED', input.reviewer), 403, 'OBJECT_PERMISSION_FORBIDDEN');
  await assert.rejects(runner.run(context(fixture.serviceConsumerPrincipalId), (m) =>
    m.releaseDistribution.changeSubscriptionLifecycle({ ...scope, targetStatus: 'SUSPENDED' })), { message: 'PRINCIPAL_KIND_FORBIDDEN' });
  await rejected(owner.POST(lifecyclePath, { params: { path: { subscriptionId }, header: csrf },
    body: { governanceObjectId: '74100000-0000-7000-8000-000000000001', targetStatus: 'SUSPENDED' } }), 404, 'CONSUMER_SUBSCRIPTION_NOT_FOUND');
  for (const body of [
    { governanceObjectId, targetStatus: 'DRAFT' }, { governanceObjectId, targetStatus: 'active' },
    { governanceObjectId, targetStatus: 'SUSPENDED', reason: 'x'.repeat(257) },
    { governanceObjectId, targetStatus: 'SUSPENDED', reason: '<b>invalid</b>' },
    { governanceObjectId, targetStatus: 'SUSPENDED', projectionType: 'changed' },
  ]) {
    const result = await fetch(`${input.baseUrl}/v1/phase-01/consumer-subscriptions/${subscriptionId}/lifecycle-transitions`, {
      method: 'POST', headers: { ...csrf, 'content-type': 'application/json', 'x-prototype-principal-code': 'prototype-owner' }, body: JSON.stringify(body),
    });
    assert.equal(result.status, 400);
    assert.equal((await result.json() as { code: string }).code, 'REQUEST_SCHEMA_INVALID');
  }
  // State and audit roll back together if the surrounding application transaction fails.
  const rollback = new Error('SYNTHETIC_LIFECYCLE_ROLLBACK');
  await assert.rejects(runner.run(context(), async (m) => {
    await m.releaseDistribution.changeSubscriptionLifecycle({ ...scope, targetStatus: 'SUSPENDED' });
    throw rollback;
  }), (error) => error === rollback);
  assert.deepEqual(await history(), initial);
  assert.equal((await auditEvents()).length, 0);

  const paused = ok(await change('SUSPENDED'));
  assert.deepEqual(ok(await change('SUSPENDED')), paused);
  assert.equal((await auditEvents()).length, 1);
  assert.deepEqual(stableHistory(await history()), stableHistory(initial));

  async function assertConsumptionBlocked() {
    await rejected(service.GET(eventsPath, { params: { path: { subscriptionId } } }), 403, 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE');
    await rejected(service.GET(snapshotPath, { params: { path: { subscriptionId, snapshotId: event.snapshotId } } }), 403, 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE');
    await rejected(service.POST(receiptPath, { params: { path: { subscriptionId } }, body: {
      ...receipt, processingDigest: event.snapshotArtifactDigest,
      // Only wire receipt fields are accepted.
      ...{ subscriptionId: undefined, servicePrincipalId: undefined },
    } }), 403, 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE');
    for (const action of [
      (m: ScopedModules) => m.releaseDistribution.listAvailableEvents({ ...consumer, afterAggregateVersion: '0' }),
      (m: ScopedModules) => m.releaseDistribution.getSnapshotForSubscription({ ...consumer, snapshotId: event.snapshotId }),
      (m: ScopedModules) => m.releaseDistribution.recordReceipt(receipt),
      (m: ScopedModules) => m.releaseDistribution.recordReceipt({ ...receipt, applyResult: 'NOT_APPLIED' }),
      (m: ScopedModules) => m.releaseDistribution.replayBlockedDelivery({ ...scope, eventId: event.eventId }),
    ]) await assert.rejects(runner.run(context(), async (m) => { await action(m); }), { message: 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE' });
  }
  await assertConsumptionBlocked();
  await rejected(input.otherService.GET(eventsPath, { params: { path: { subscriptionId } } }), 403, 'CONSUMER_SUBSCRIPTION_FORBIDDEN');
  await version();
  const pausedHistory = await history();
  assert.equal(pausedHistory.versions.length, initial.versions.length + 1);
  assert.deepEqual(pausedHistory.checkpoints, initial.checkpoints);
  assert.deepEqual(pausedHistory.receipts, initial.receipts);
  const queued = await publishAgain();
  assert.ok((await history()).releases.some((item) => item.eventId === queued.eventId));
  await assertConsumptionBlocked();
  await assertDispatcherBlocked();

  ok(await change('ACTIVE'));
  assert.equal((await auditEvents()).length, 2);
  assert.ok(ok(await service.GET(eventsPath, { params: { path: { subscriptionId } } })).events
    .some((item) => item.eventId === queued.eventId));
  await runner.run(context(), (m) => m.releaseDistribution.getSnapshotForSubscription({ ...consumer, snapshotId: event.snapshotId }));
  // A now-disabled owner cannot consume an otherwise ACTIVE subscription. Roll back fixture changes.
  await assert.rejects(database.transaction().execute(async (transaction) => {
    await transaction.updateTable('platform.security_principal').set({ status: 'DISABLED' })
      .where('security_principal_id', '=', consumer.servicePrincipalId).execute();
    const { createScopedModules } = await import('../../apps/governance-api/src/composition/create-scoped-modules.js');
    const modules = createScopedModules(transaction, context());
    await assert.rejects(modules.releaseDistribution.listAvailableEvents({ ...consumer, afterAggregateVersion: '0' }), { message: 'CONSUMER_SERVICE_PRINCIPAL_INVALID' });
    await assert.rejects(modules.releaseDistribution.recordReceipt(receipt), { message: 'CONSUMER_SERVICE_PRINCIPAL_INVALID' });
    throw rollback;
  }), (error) => error === rollback);
  await assert.rejects(runner.run(context(), (m) => m.releaseDistribution.recordReceipt({ ...receipt, processingDigest: Buffer.alloc(32) })), { message: 'CONSUMER_PROCESSING_DIGEST_MISMATCH' });
  assert.deepEqual((await history()).checkpoints, initial.checkpoints);

  // Hold the lifecycle row update open, then start consumption in another transaction.
  // Once the state commits, the waiting consumer must read SUSPENDED and fail closed.
  let entered!: () => void;
  let release!: () => void;
  const locked = new Promise<void>((resolve) => { entered = resolve; });
  const unlocked = new Promise<void>((resolve) => { release = resolve; });
  const transition = runner.run(context(), async (m) => {
    await m.releaseDistribution.changeSubscriptionLifecycle({ ...scope, targetStatus: 'SUSPENDED' });
    entered(); await unlocked;
  });
  await locked;
  const consumption = runner.run(context(), (m) => m.releaseDistribution.recordReceipt(receipt));
  const rejection = assert.rejects(consumption, { message: 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE' });
  release();
  await transition;
  await rejection;
  assert.deepEqual((await history()).checkpoints, initial.checkpoints);

  ok(await change('REVOKED'));
  assert.deepEqual(ok(await change('REVOKED')), await moduleChange('REVOKED'));
  await assertConsumptionBlocked();
  await assert.rejects(version(), { message: 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE' });
  for (const state of ['ACTIVE', 'SUSPENDED'] as const) await rejected(change(state), 409, 'CONSUMER_SUBSCRIPTION_LIFECYCLE_INVALID_TRANSITION');
  const revoked = await history();
  await publishAgain();
  assert.deepEqual(await history(), revoked);
  await assertDispatcherBlocked();
  ok(await change('ARCHIVED'));
  const archived = await history();
  await change('ARCHIVED').then(ok);
  assert.deepEqual(await history(), archived);
  await publishAgain();
  assert.deepEqual(await history(), archived);
  assert.deepEqual(stableHistory(archived), stableHistory(revoked));
  assert.equal((await auditEvents()).length, 5);
  assert.equal(await runner.run(context(), (m) => m.audit.verifyChain(subscriptionId)), true);
  await assertConsumptionBlocked();
  await assert.rejects(version(), { message: 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE' });
  for (const state of ['ACTIVE', 'SUSPENDED', 'REVOKED'] as const) await rejected(change(state), 409, 'CONSUMER_SUBSCRIPTION_LIFECYCLE_INVALID_TRANSITION');
  await assert.rejects(runner.run(context(fixture.serviceConsumerPrincipalId), (m) =>
    m.releaseDistribution.getSubscriptionHistory(scope)), { message: 'PRINCIPAL_KIND_FORBIDDEN' });
  // Database identity/history guards remain effective even under privileged fixture SQL.
  await assert.rejects(database.deleteFrom('release_distribution.consumer_subscription')
    .where('consumer_subscription_id', '=', subscriptionId).execute(), { code: '55000' });
  await assert.rejects(database.updateTable('release_distribution.consumer_subscription')
    .set({ lifecycle_status: 'ACTIVE' }).where('consumer_subscription_id', '=', subscriptionId).execute(), { code: '55000' });
  assert.deepEqual(await history(), archived);
  assert.deepEqual(await runner.run(context(), (m) => m.releaseDistribution.getSnapshot(event.snapshotId)), originalArtifact);
  assert.deepEqual((await database.selectFrom('release_distribution.consumer_subscription_version')
    .selectAll().where('consumer_subscription_id', '=', subscriptionId).orderBy('version_no').execute()).slice(0, originalVersions.length), originalVersions);

  // A second subscription exercises the direct ACTIVE -> REVOKED branch.
  const second = await runner.run(context(), (m) => m.releaseDistribution.createSubscription({
    subscriptionCode: `PROTOTYPE-SYNTHETIC-LIFECYCLE-${randomUUID()}`, servicePrincipalId: consumer.servicePrincipalId,
    governanceObjectId, projectionType: event.projectionType, projectionSchemaVersion: '1',
  }));
  const secondScope = { ...scope, ...second };
  await runner.run(context(), (m) => m.releaseDistribution.changeSubscriptionLifecycle({ ...secondScope, targetStatus: 'REVOKED' }));
  const secondHistory = await runner.run(context(), (m) => m.releaseDistribution.getSubscriptionHistory(secondScope));
  assert.equal(secondHistory.lifecycleStatus, 'REVOKED');

  await assertDispatcherBlocked();
  async function assertDispatcherBlocked() {
    // Isolate dispatch selection to this subscription with a real PENDING backlog.
    const dispatcherRollback = new Error('SYNTHETIC_DISPATCH_ROLLBACK');
    await assert.rejects(database.transaction().execute(async (transaction) => {
    // Other subscriptions are locked by this transaction, so SKIP LOCKED cannot claim them.
    await transaction.selectFrom('release_distribution.consumer_subscription').select('consumer_subscription_id')
      .where('consumer_subscription_id', '!=', subscriptionId).forUpdate().execute();
    let notifications = 0;
    const dispatcher = createReleaseDistributionDispatcher(database, {
      async deliver() { notifications++; return { responseDigest: null }; },
    }, { workerId: 'pv-005-b-03a', leaseSeconds: 10, retryDelaySeconds: 0,
      maxNotificationAttempts: 1, pollIntervalMilliseconds: 1_000,
      now: () => context().occurredAt, references: createConsumerReferenceReader });
    try { assert.deepEqual(await dispatcher.dispatchOnce(), { claimed: false }); }
    finally { await dispatcher.stop(); }
    assert.equal(notifications, 0);
    throw dispatcherRollback;
    }), (error) => error === dispatcherRollback);
  }
  return { histories: [archived, secondHistory], checks: {
    lifecycleDefaultActive: true, lifecycleLegalTransitions: true, lifecycleRetriesIdempotent: true,
    lifecycleInvalidTransitionsRejected: true, lifecycleConsumerBoundaryEnforced: true,
    lifecycleSuspendedVersionAllowed: true, lifecycleTerminalVersionRejected: true,
    lifecycleHistoryPreserved: true, lifecycleAuditAtomicAndVerifiable: true,
    lifecycleConcurrentReceiptBlocked: true, lifecycleServicePrincipalStillRequired: true,
    lifecycleRuntimeValuesRejected: true, lifecycleArchivedDispatcherBlocked: true,
    lifecycleSuspendedBacklogPreserved: true, lifecycleTerminalPublicationSkipped: true,
  } };
}

function ok<T>(result: { data?: T; response: Response }): T {
  assert.ok(result.response.ok && result.data !== undefined, `LIFECYCLE_HTTP_${result.response.status}`);
  return result.data;
}
async function rejected(promise: Promise<{ error?: unknown; response: Response }>, status: number, code: string) {
  const result = await promise;
  assert.equal(result.response.status, status);
  assert.equal((result.error as { code: string }).code, code);
}
