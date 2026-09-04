import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
    baseUrl: string; accessToken: string; otherReleaseId: string; statePath: string;
}) {
  const { database, runner, context, owner, subscriptionId, event, statePath } = input;
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
  const dry = await cli(event.releaseId);
  assert.equal(dry.mode, 'DRY_RUN'); assert.equal(dry.alreadyApplied, true); assert.equal(dry.checkpointChanged, false);
  assert.deepEqual(await facts(), before); assert.equal(await readFile(statePath, 'utf8'), fileBefore);
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
  const apply = await cli(newer.releaseId, operationId);
  assert.equal(apply.businessApplied, true); assert.equal(apply.checkpointAfter, newer.aggregateVersion);
  const appliedFacts = await facts();
  const repeated = await cli(newer.releaseId, operationId);
  assert.equal(repeated.businessApplied, false); assert.equal(repeated.receiptReused, true);
  assert.deepEqual(await facts(), appliedFacts);
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
      const deniedBefore = await facts(); const deniedState = await readFile(statePath, 'utf8');
      assert.equal((await cli(event.releaseId, randomUUID(), 1)).errorCode, targetStatus);
      assert.deepEqual(await facts(), deniedBefore); assert.equal(await readFile(statePath, 'utf8'), deniedState);
    }
  }
  return { newer, proof: { dryRun: dry, apply, repeat: repeated, oldRelease: old }, checks: {
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
