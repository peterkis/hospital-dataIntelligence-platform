import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import type { checkConsumerLifecycleFlow } from './check-consumer-lifecycle-flow.js';
import { PROTOTYPE_FIXTURE as fixture } from './prototype-fixture.js';
import { PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';

const statusPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/operational-status';
const versionPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/versions';
const receiptPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts';
const eventsPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/events';
const csrf = { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN };

export async function checkConsumerSlaFlow(input: Parameters<typeof checkConsumerLifecycleFlow>[0] & {
  person: Parameters<typeof checkConsumerLifecycleFlow>[0]['service'];
}) {
  const { database, runner, context, owner, service, event } = input;
  const governanceObjectId = event.governanceObjectId;
  const support = { governanceObjectId, projectionType: 'hdi.department-master' as const, projectionSchemaVersion: '1' as const };
  const policy = { criticality: 'HIGH' as const, expectedApplyWithinSeconds: 5, retryWindowSeconds: 10 };
  const lateContext = { ...context(fixture.serviceConsumerPrincipalId), occurredAt: '2099-01-01T00:00:00' };
  const read = (subscriptionId: string, subscriptionVersionId?: string) => runner.run(lateContext, (m) =>
    m.releaseDistribution.getConsumerOperationalStatus({ subscriptionId, ...(subscriptionVersionId ? { subscriptionVersionId } : {}) }));
  const wireRead = (subscriptionId: string) => service.GET(statusPath, { params: { path: { subscriptionId } } }).then(ok);
  const existing = await wireRead(input.subscriptionId);
  assert.equal(existing.status, 'NOT_CONFIGURED');
  assert.deepEqual(existing.sla, { criticality: 'NORMAL', expectedApplyWithinSeconds: null, retryWindowSeconds: null });
  assert.deepEqual(existing.owner, { servicePrincipalId: fixture.serviceConsumerPrincipalId,
    principalCode: (await database.selectFrom('platform.security_principal').select('principal_code')
      .where('security_principal_id', '=', fixture.serviceConsumerPrincipalId).executeTakeFirstOrThrow()).principal_code });

  const create = async () => ok(await owner.POST('/v1/phase-01/consumer-subscriptions', {
    params: { header: csrf }, body: { ...support, sla: policy,
      subscriptionCode: `PV005B03B-SYNTHETIC-${randomUUID()}`, servicePrincipalId: fixture.serviceConsumerPrincipalId },
  }));
  const { subscriptionId } = await create();
  const failed = await create();
  const initial = await wireRead(subscriptionId);
  assert.equal(initial.status, 'NEVER_APPLIED');
  assert.equal(initial.latestRelease, null);
  assert.equal(initial.lastSuccessfulApply, null);
  const originalVersions = await database.selectFrom('release_distribution.consumer_subscription_version').selectAll()
    .where('consumer_subscription_id', '=', subscriptionId).orderBy('version_no').execute();
  for (const criticality of ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'] as const) {
    ok(await owner.POST(versionPath, { params: { path: { subscriptionId }, header: csrf },
      body: { ...support, sla: { ...policy, criticality } } }));
    assert.equal((await wireRead(subscriptionId)).sla.criticality, criticality);
  }
  const reset = ok(await owner.POST(versionPath, { params: { path: { subscriptionId }, header: csrf }, body: support }));
  assert.equal((await wireRead(subscriptionId)).status, 'NOT_CONFIGURED');
  const restored = ok(await owner.POST(versionPath, { params: { path: { subscriptionId }, header: csrf }, body: { ...support, sla: policy } }));
  assert.equal((await read(subscriptionId, reset.subscriptionVersionId)).status, 'NOT_CONFIGURED');
  assert.deepEqual((await database.selectFrom('release_distribution.consumer_subscription_version').selectAll()
    .where('consumer_subscription_id', '=', subscriptionId).orderBy('version_no').execute()).slice(0, 1), originalVersions);
  await assert.rejects(database.updateTable('release_distribution.consumer_subscription_version').set({ expected_apply_within_seconds: 30 })
    .where('consumer_subscription_version_id', '=', initial.subscriptionVersionId).execute(), { code: '55000' });

  for (const sla of [{ criticality: 'INVALID' }, { expectedApplyWithinSeconds: 0 }, { expectedApplyWithinSeconds: -1 },
    { retryWindowSeconds: 0 }, { expectedApplyWithinSeconds: 6, retryWindowSeconds: 5 },
    { expectedApplyWithinSeconds: 2147483648 }, { retryWindowSeconds: 2147483648 },
    { expectedApplyWithinSeconds: 1.5 }, { expectedApplyWithinSeconds: '5' }, { lastSuccessAt: '2099-01-01T00:00:00' },
    { ownerName: 'untrusted' }]) {
    const result = await fetch(`${input.baseUrl}/v1/phase-01/consumer-subscriptions/${subscriptionId}/versions`, {
      method: 'POST', headers: { ...csrf, 'content-type': 'application/json', 'x-prototype-principal-code': 'prototype-owner' },
      body: JSON.stringify({ ...support, sla }),
    });
    assert.equal(result.status, 400);
  }
  assert.equal((await wireRead(subscriptionId)).subscriptionVersionId, restored.subscriptionVersionId);
  for (const values of [{ criticality: 'INVALID' }, { expected_apply_within_seconds: 0 },
    { retry_window_seconds: -1 }, { expected_apply_within_seconds: 6, retry_window_seconds: 5 }]) {
    await assert.rejects(database.insertInto('release_distribution.consumer_subscription_version').values({
      consumer_subscription_id: subscriptionId, version_no: '999', recorded_sequence: '999', status: 'ACTIVE', ...values,
    }).execute(), { code: '23514' });
  }
  await rejected(input.otherService.GET(statusPath, { params: { path: { subscriptionId } } }), 403);
  await rejected(owner.GET(statusPath, { params: { path: { subscriptionId } } }), 400);
  await rejected(input.person.GET(statusPath, { params: { path: { subscriptionId } } }), 403);
  await rejected(service.GET(statusPath, { params: { path: { subscriptionId }, query: { subscriptionVersionId: existing.subscriptionVersionId } } }), 404);
  await assert.rejects(runner.run(context(), (m) => m.releaseDistribution.getConsumerOperationalStatus({ subscriptionId })),
    { message: 'CONSUMER_SUBSCRIPTION_FORBIDDEN' });
  // Invalid owners cannot acquire a subscription, and disabling an existing owner rejects reads.
  for (const servicePrincipalId of [fixture.actorPrincipalId, randomUUID()]) {
    await rejected(owner.POST('/v1/phase-01/consumer-subscriptions', { params: { header: csrf }, body: {
      ...support, sla: policy, subscriptionCode: `PV005B03B-INVALID-${randomUUID()}`, servicePrincipalId,
    } }), 400);
  }
  await database.updateTable('platform.security_principal').set({ status: 'DISABLED' })
    .where('security_principal_id', '=', fixture.serviceConsumerPrincipalId).execute();
  try { await rejected(service.GET(statusPath, { params: { path: { subscriptionId } } }), 400); }
  finally { await database.updateTable('platform.security_principal').set({ status: 'ACTIVE' })
    .where('security_principal_id', '=', fixture.serviceConsumerPrincipalId).execute(); }

  const artifact = await runner.run(context(), (m) => m.releaseDistribution.getSnapshot(event.snapshotId));
  const source = await database.selectFrom('release_distribution.governance_release').selectAll()
    .where('release_id', '=', event.releaseId).executeTakeFirstOrThrow();
  const member = await database.selectFrom('release_distribution.release_member_department').selectAll()
    .where('release_id', '=', event.releaseId).executeTakeFirstOrThrow();
  const publish = () => runner.run(context(), (m) => m.releaseDistribution.registerPublication({
    governanceObjectId, aggregateType: 'DEPARTMENT_MASTER', releaseKind: 'HISTORICAL_REPUBLICATION',
    businessValidFrom: source.business_valid_from, businessValidTo: source.business_valid_to,
    recordedFrom: context().occurredAt, submittedBy: source.submitted_by, approvedBy: source.approved_by,
    approvedAt: context().occurredAt, changeReason: 'SYNTHETIC PROTOTYPE SLA validation',
    projection: { projectionType: support.projectionType, schemaVersion: '1', itemCount: 1,
      payload: (JSON.parse(artifact.bytes.toString('utf8')) as { payload: unknown }).payload },
    member: { kind: 'DEPARTMENT', stableId: member.department_id, versionId: member.department_version_id,
      snapshotName: member.snapshot_name, memberHash: member.member_hash },
  }));
  const first = await publish();
  assert.equal((await read(subscriptionId)).status, 'NEVER_APPLIED');
  assert.equal((await read(subscriptionId)).applyOverdue, true);
  const appliedBody = { eventId: first.eventId, receiveResult: 'ACCEPTED' as const, validationResult: 'VALID' as const,
    applyResult: 'APPLIED' as const, processingDigest: first.snapshotArtifactDigest.toString('hex'), processedAt: '2099-01-01T00:00:00' };
  await rejected(service.POST(receiptPath, { params: { path: { subscriptionId } }, body: { ...appliedBody, processingDigest: '0'.repeat(64) } }), 400);
  assert.equal((await read(subscriptionId)).lastSuccessfulApply, null);
  // Digest failure is a failed receipt, never a success or checkpoint.
  ok(await service.POST(receiptPath, { params: { path: failed }, body: { ...appliedBody,
    validationResult: 'INVALID', applyResult: 'NOT_APPLIED', processingDigest: '0'.repeat(64) } }));
  assert.equal((await read(failed.subscriptionId)).lastSuccessfulApply, null);
  assert.equal((await read(failed.subscriptionId)).latestCheckpoint, null);
  ok(await service.POST(receiptPath, { params: { path: { subscriptionId } }, body: appliedBody }));
  const success = await read(subscriptionId);
  assert.equal(success.status, 'HEALTHY');
  assert.equal(success.lastSuccessfulApply?.releaseId, first.releaseId);
  assert.notEqual(success.lastSuccessfulApply?.recordedAt, appliedBody.processedAt);
  assert.notEqual(success.latestCheckpoint?.recordedAt, appliedBody.processedAt);
  ok(await service.POST(receiptPath, { params: { path: { subscriptionId } }, body: { ...appliedBody, processedAt: '2099-02-01T00:00:00' } }));
  assert.deepEqual(await read(subscriptionId), success);
  assert.deepEqual(ok(await service.GET(eventsPath, { params: { path: { subscriptionId }, query: { afterAggregateVersion: first.releaseNo } } })).events, []);
  const second = await publish();
  await publish();
  const late = await read(subscriptionId);
  assert.equal(late.status, 'LATE');
  assert.equal(late.oldestPendingRelease?.releaseId, second.releaseId);
  assert.deepEqual(late.lastSuccessfulApply, success.lastSuccessfulApply);
  // Absolute arithmetic is independent of the PostgreSQL session timezone.
  await database.transaction().execute(async (transaction) => {
    await sql`set local time zone 'UTC'`.execute(transaction);
    const m = createScopedModules(transaction, lateContext);
    assert.deepEqual(await m.releaseDistribution.getConsumerOperationalStatus({ subscriptionId }), late);
  });
  ok(await service.POST(receiptPath, { params: { path: { subscriptionId } }, body: { ...appliedBody,
    eventId: second.eventId, processingDigest: second.snapshotArtifactDigest.toString('hex') } }));
  const advanced = await read(subscriptionId);
  assert.equal(advanced.lastSuccessfulApply?.releaseId, second.releaseId);
  assert.notEqual(advanced.latestCheckpoint?.recordedAt, appliedBody.processedAt);
  ok(await service.POST(receiptPath, { params: { path: { subscriptionId } }, body: appliedBody }));
  assert.deepEqual(await read(subscriptionId), advanced);
  for (const targetStatus of ['SUSPENDED', 'ACTIVE', 'REVOKED', 'ARCHIVED'] as const) {
    ok(await owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions', {
      params: { path: { subscriptionId }, header: csrf }, body: { governanceObjectId, targetStatus },
    }));
    assert.equal((await read(subscriptionId)).status, targetStatus === 'ACTIVE' ? 'LATE' : targetStatus);
    assert.equal((await wireRead(subscriptionId)).lifecycleStatus, targetStatus);
  }
  assert.deepEqual((await runner.run(context(), (m) => m.releaseDistribution.getSnapshot(event.snapshotId))).bytes, artifact.bytes);
  return { context: lateContext, views: [await read(subscriptionId), await read(failed.subscriptionId)], checks: {
    slaBackwardCompatible: true, slaPoliciesValidated: true, slaVersionsImmutable: true,
    slaDerivedFromAppliedReceipt: true, slaReplayDoesNotRefreshSuccess: true, slaDigestFailuresDoNotMarkSuccess: true,
    slaOldEventFiltering: true, slaLifecycleOverrides: true, slaCrossSubscriptionRejected: true,
    slaOwnerReusedAndValidated: true, slaAbsoluteTimeDeterministic: true, slaOldestPendingReleaseRetained: true,
  } };
}

function ok<T>(result: { data?: T; response: Response }): T {
  assert.ok(result.response.ok && result.data !== undefined, `SLA_HTTP_${result.response.status}`);
  return result.data;
}
async function rejected(promise: Promise<{ response: Response }>, status: number) {
  assert.equal((await promise).response.status, status);
}
