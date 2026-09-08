import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { metricCounters, metricValue, type ReadMetrics } from './check-consumer-metrics-flow.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { createReleaseConsumer, type ReleaseEvent, type ProjectionSupport } from '@hospital-data-intelligence/release-consumer-sdk';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import type { checkConsumerLifecycleFlow } from './check-consumer-lifecycle-flow.js';
import { PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';
import { PROTOTYPE_FIXTURE as fixture } from './prototype-fixture.js';

interface CliResult {
  readonly mode?: string; readonly alreadyApplied?: boolean; readonly businessApplied?: boolean;
  readonly checkpointChanged?: boolean; readonly checkpointBefore?: string; readonly checkpointAfter?: string;
  readonly receiptReused?: boolean; readonly errorCode?: string;
}

export async function checkConsumerReplayFlow(input: Pick<Parameters<typeof checkConsumerLifecycleFlow>[0],
  'database' | 'runner' | 'context' | 'owner' | 'subscriptionId' | 'event'> & {
    baseUrl: string; accessToken: string; otherReleaseId: string; statePath: string; readMetrics?: ReadMetrics;
}) {
  const { database, runner, context, owner, subscriptionId, event, statePath } = input;
  const counters = async () => input.readMetrics ? metricCounters(await input.readMetrics()) : '';
  const metric = async (name: string, labels: Record<string, string>) => input.readMetrics
    ? metricValue(await input.readMetrics(), name, event.projectionType, labels) : 0;
  const client = createGovernanceApiClient({ baseUrl: input.baseUrl, accessToken: input.accessToken });
  const consumer = createReleaseConsumer({ client, subscriptionId,
    supportedProjections: [{ projectionType: event.projectionType, projectionSchemaVersion: '1' } as ProjectionSupport],
    now: () => '2026-09-04T12:00:00', state: { async load() { return null; }, async save() { throw new Error('READ_ONLY'); } },
    async apply() { throw new Error('READ_ONLY'); } });
  const facts = async () => (await sql<{ facts: unknown }>`select jsonb_build_object(
    'receipts', (select jsonb_agg(to_jsonb(r) order by r.event_id, r.receipt_sequence) from release_distribution.consumer_receipt r where consumer_subscription_id = ${subscriptionId}),
    'checkpoints', (select jsonb_agg(to_jsonb(c)) from release_distribution.consumer_checkpoint c where consumer_subscription_id = ${subscriptionId}),
    'versions', (select jsonb_agg(to_jsonb(v) order by v.version_no) from release_distribution.consumer_subscription_version v where consumer_subscription_id = ${subscriptionId}),
    'attempts', (select count(*) from release_distribution.outbox_delivery_attempt a join release_distribution.outbox_delivery d using(outbox_delivery_id) where d.consumer_subscription_id = ${subscriptionId}),
    'states', (select count(*) from release_distribution.outbox_delivery_state where consumer_subscription_id = ${subscriptionId})
  ) as facts`.execute(database)).rows[0]!.facts;
  const before = await facts(); const fileBefore = await readFile(statePath, 'utf8');
  const dryMetrics = await counters();
  const dry = await cli(event.releaseId);
  assert.equal(dry.mode, 'DRY_RUN'); assert.equal(dry.alreadyApplied, true); assert.equal(dry.checkpointChanged, false);
  assert.deepEqual(await facts(), before); assert.equal(await readFile(statePath, 'utf8'), fileBefore);
  assert.equal(await counters(), dryMetrics, 'METRICS_DRY_RUN_COUNTED');
  const original = await consumer.inspectReplay({ releaseId: event.releaseId });
  const snapshotBefore = await client.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content', {
    params: { path: { subscriptionId, snapshotId: event.snapshotId } }, parseAs: 'arrayBuffer',
  });
  // A new, explicit synthetic publication advances the test stream. This fixture
  // setup is outside the replay tool; the historical artifact is never rebuilt.
  const payload = original.snapshot.snapshot.payload;
  const publication = await runner.run(context(), (modules) => modules.releaseDistribution.registerPublication({
    governanceObjectId: event.governanceObjectId,
    aggregateType: event.projectionType === 'hdi.department-master' ? 'DEPARTMENT_MASTER' : 'DEPARTMENT_HIERARCHY',
    businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, recordedFrom: context().occurredAt,
    submittedBy: fixture.actorPrincipalId, approvedBy: fixture.approverPrincipalId, approvedAt: context().occurredAt,
    changeReason: 'PROTOTYPE SYNTHETIC C02 new publication fixture',
    projection: { projectionType: event.projectionType, schemaVersion: '1', payload, itemCount: 1 },
    member: 'departmentId' in payload ? { kind: 'DEPARTMENT', stableId: payload.departmentId,
      versionId: payload.departmentVersionId, snapshotName: payload.standardName, memberHash: Buffer.from(payload.contentHash, 'hex') }
      : 'hierarchyViewId' in payload ? { kind: 'DEPARTMENT_HIERARCHY', stableId: payload.hierarchyViewId,
        versionId: payload.hierarchyViewVersionId, snapshotName: payload.viewCode, memberHash: Buffer.from(payload.contentHash, 'hex') }
        : (() => { throw new Error('REPLAY_FIXTURE_PAIR_INVALID'); })(),
  }));
  const newer = (await consumer.inspectReplay({ releaseId: publication.releaseId })).context.event;
  const frozenVersion = (await consumer.inspectReplay({ releaseId: newer.releaseId })).context.subscriptionVersion;
  if (input.readMetrics) {
    // The HTTP business clock has second precision; an event has microseconds.
    // Wait until that same clock is strictly beyond the actual one-second SLA,
    // rather than assuming 1.1 wall-clock seconds always crosses its next tick.
    const deadline = (await sql<{ value: string }>`select
      to_char(created_at + interval '1 second', 'YYYY-MM-DD"T"HH24:MI:SS.US') as value
      from release_distribution.outbox_event where event_id = ${newer.eventId}`.execute(database)).rows[0]!.value;
    const clockWaitStarted = performance.now();
    while (context().occurredAt <= deadline) {
      assert.ok(performance.now() - clockWaitStarted < 5000, 'REPLAY_FIXTURE_BUSINESS_CLOCK_DID_NOT_ADVANCE');
      await setTimeout(20);
    }
    const status = await client.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/operational-status', { params: { path: { subscriptionId } } });
    assert.equal(status.data?.status, 'LATE'); assert.equal(status.data.applyOverdue, true);
    assert.ok(await metric('consumer_sla_breached', { criticality: 'CRITICAL' }) >= 1);
    const lagFacts = (await runner.run(context(), modules => modules.releaseDistribution.readConsumerMetricFacts())).filter(row => row.name === 'consumer_checkpoint_lag_seconds'
      && row.projectionType === event.projectionType && row.labels['criticality'] === 'CRITICAL');
    const interval = (await sql<{ seconds: string }>`select greatest(0, extract(epoch from later.created_at at time zone 'Asia/Shanghai')
      - extract(epoch from earlier.created_at at time zone 'Asia/Shanghai'))::text seconds
      from release_distribution.outbox_event earlier, release_distribution.outbox_event later
      where earlier.event_id = ${event.eventId} and later.event_id = ${newer.eventId}`.execute(database)).rows[0]!.seconds;
    assert.ok(Number(interval) > 0);
    assert.ok(lagFacts.some(row => Number(row.value) === Number(interval)), 'METRICS_LAG_FORMULA');
    assert.equal(await metric('consumer_checkpoint_lag_seconds', { criticality: 'CRITICAL' }), Math.max(...lagFacts.map(row => Number(row.value))));
  }
  const laterVersion = await owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/versions', {
    params: { path: { subscriptionId }, header: { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN } },
    body: { governanceObjectId: event.governanceObjectId,
      projectionType: event.projectionType as 'hdi.department-master' | 'hdi.department-hierarchy', projectionSchemaVersion: '1' },
  });
  assert.equal(laterVersion.response.status, 201);
  assert.deepEqual((await consumer.inspectReplay({ releaseId: newer.releaseId })).context.subscriptionVersion, frozenVersion);
  const failedReceipt = await client.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts', {
    params: { path: { subscriptionId } }, body: { eventId: newer.eventId, receiveResult: 'ACCEPTED', validationResult: 'VALID',
      applyResult: 'NOT_APPLIED', processingDigest: newer.snapshotArtifactDigest, processedAt: context().occurredAt },
  });
  assert.equal(failedReceipt.response.status, 201);
  const pendingBefore = await facts();
  assert.equal((await cli(newer.releaseId)).alreadyApplied, false);
  assert.deepEqual(await facts(), pendingBefore);
  const operationId = randomUUID();
  const replayApplied = await metric('consumer_apply_total', { mode: 'replay', result: 'success' });
  const normalApplied = await metric('consumer_apply_total', { mode: 'normal', result: 'success' });
  const replayCompleted = await metric('consumer_replay_total', { mode: 'replay', result: 'success' });
  const apply = await cli(newer.releaseId, operationId);
  assert.equal(apply.businessApplied, true); assert.equal(apply.checkpointAfter, newer.aggregateVersion);
  if (input.readMetrics) {
    assert.equal(await metric('consumer_apply_total', { mode: 'replay', result: 'success' }), replayApplied + 1);
    assert.equal(await metric('consumer_apply_total', { mode: 'normal', result: 'success' }), normalApplied);
    assert.equal(await metric('consumer_replay_total', { mode: 'replay', result: 'success' }), replayCompleted + 1);
  }
  const appliedFacts = await facts();
  const repeated = await cli(newer.releaseId, operationId);
  assert.equal(repeated.businessApplied, false); assert.equal(repeated.receiptReused, true);
  assert.deepEqual(await facts(), appliedFacts);
  if (input.readMetrics) assert.equal(await metric('consumer_apply_total', { mode: 'replay', result: 'success' }), replayApplied + 1);
  const old = await cli(event.releaseId, randomUUID());
  assert.equal(old.businessApplied, true); assert.equal(old.checkpointBefore, newer.aggregateVersion);
  assert.equal(old.checkpointAfter, newer.aggregateVersion); assert.equal(old.checkpointChanged, false);
  assert.equal(old.receiptReused, true);
  assert.deepEqual(await facts(), appliedFacts);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.replayApplyCount, 2); assert.equal(state.applyCount, 1);
  assert.deepEqual(state.lastAppliedPayload, original.snapshot.snapshot.payload);
  const audit = await runner.run(context(), async (modules) => ({
    entries: (await Promise.all(Object.keys(state.replays).map((stableEntityId) => modules.audit.query({
      governanceObjectId: event.governanceObjectId, stableEntityId, action: 'CONSUMER_RELEASE_REPLAYED', limit: 2,
    })))).flat(),
    valid: await modules.audit.verifyChain(subscriptionId),
  }));
  assert.equal(audit.valid, true);
  assert.equal(audit.entries.filter((entry) => entry.auditStreamId === subscriptionId).length, 2, 'REPLAY_AUDIT_MISSING');
  const snapshotAfter = await client.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content', {
    params: { path: { subscriptionId, snapshotId: event.snapshotId } }, parseAs: 'arrayBuffer',
  });
  assert.deepEqual(Buffer.from(snapshotAfter.data!), Buffer.from(snapshotBefore.data!));
  const missing = await cli(randomUUID(), undefined, 1);
  const foreign = await cli(input.otherReleaseId, undefined, 1);
  assert.deepEqual(foreign, missing); assert.equal(missing.errorCode, 'CONSUMER_EVENT_NOT_AVAILABLE');
  for (const targetStatus of ['SUSPENDED', 'ACTIVE', 'REVOKED', 'ARCHIVED'] as const) {
    const response = await owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions', {
      params: { path: { subscriptionId }, header: { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN } },
      body: { governanceObjectId: event.governanceObjectId, targetStatus },
    });
    assert.equal(response.response.status, 200);
    if (targetStatus !== 'ACTIVE') {
      const failures = await metric('consumer_replay_total', { mode: 'replay', result: 'failed' });
      const deniedBefore = await facts(); const deniedState = await readFile(statePath, 'utf8');
      assert.equal((await cli(event.releaseId, randomUUID(), 1)).errorCode, targetStatus);
      if (input.readMetrics) {
        assert.equal(await metric('consumer_replay_total', { mode: 'replay', result: 'failed' }), failures + 1);
        assert.equal((await client.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/events', { params: { path: { subscriptionId } } })).response.status, 403);
        assert.equal((await client.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/operational-status', { params: { path: { subscriptionId } } })).data?.applyOverdue, false);
      }
      assert.deepEqual(await facts(), deniedBefore); assert.equal(await readFile(statePath, 'utf8'), deniedState);
    }
  }
  return { newer, proof: { dryRun: dry, apply, repeat: repeated, oldRelease: old }, checks: {
    ...(input.readMetrics ? { metricsReplaySuccessFailure: true, metricsReplayRetryNoApply: true, metricsDryRunExcluded: true,
      metricsSlaLate: true, metricsLagFormula: true, metricsRevokedArchivedOverride: true } : {}),
    replayDryRunZeroMutation: true, replayExactSuccess: true, replayIdempotentRestart: true,
    replayOldCheckpointMonotonic: true, replayArtifactBytesUnchanged: true,
    replayCrossSubscriptionOpaque: true, replayLifecycleRejected: true, replayStdoutSafe: true, replayExitCodesCorrect: true,
    replayFailedApplyRecovered: true, replayFrozenSubscriptionVersion: true,
    replayAuditVerified: true,
  } };

  async function cli(releaseId: string, operationId?: string, expectedExit = 0): Promise<CliResult> {
    const args = ['--import', 'tsx', 'tooling/prototype/consumer-replay.ts', '--subscription-id', subscriptionId, '--release-id', releaseId,
      ...(operationId ? ['--apply', '--operation-id', operationId, '--reason', 'PROTOTYPE SYNTHETIC repair'] : [])];
    const child = spawn(process.execPath, args, { cwd: resolve(import.meta.dirname, '../..'), windowsHide: true,
      env: { ...process.env, HDI_REPLAY_BASE_URL: input.baseUrl, HDI_REPLAY_ACCESS_TOKEN: input.accessToken, HDI_REPLAY_STATE_PATH: statePath },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; if (output.length > 8192) child.kill(); });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk; if (errors.length > 8192) child.kill(); });
    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      child.once('error', () => reject(new Error('REPLAY_CHILD_START_FAILED'))); child.once('close', resolveExit);
    });
    assert.equal(output.includes(input.accessToken), false, 'REPLAY_SECRET_LEAK');
    assert.equal(errors, '', 'REPLAY_STDERR_NOT_EMPTY');
    assert.doesNotMatch(output, /postgres(?:ql)?:\/\/|DATABASE_URL=|password|Bearer/iu);
    const value = JSON.parse(output);
    assert.equal(exitCode, expectedExit, `REPLAY_CHILD_${value.errorCode ?? 'UNEXPECTED_EXIT'}`);
    return value;
  }
}
