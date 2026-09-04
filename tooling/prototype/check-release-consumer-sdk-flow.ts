import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, type ProjectionSupport, type ReleaseConsumerState, type ReleaseEvent } from '@hospital-data-intelligence/release-consumer-sdk';

export async function checkReleaseConsumerSdkFlow(options: {
  readonly baseUrl: string; readonly accessToken: string; readonly otherAccessToken: string;
  readonly owner: ReturnType<typeof createGovernanceApiClient>;
  readonly csrfToken: string;
  readonly subscriptionIds: readonly string[]; readonly statePaths: readonly string[];
  readonly projection: ProjectionSupport; readonly event: ReleaseEvent;
}) {
  const client = createGovernanceApiClient({ baseUrl: options.baseUrl, accessToken: options.accessToken });
  for (const [index, interruption] of ['BEFORE_APPLY', 'BEFORE_SEND', 'AFTER_RESPONSE'].entries()) {
    const subscriptionId = options.subscriptionIds[index]!;
    const statePath = options.statePaths[index]!;
    const config = { baseUrl: options.baseUrl, accessToken: options.accessToken, subscriptionId, statePath,
      expectedProjectionType: options.projection.projectionType, expectedProjectionSchemaVersion: options.projection.projectionSchemaVersion };
    const readonlyConsumer = createReleaseConsumer({ client, subscriptionId,
      expectedGovernanceObjectId: options.event.governanceObjectId, supportedProjections: [options.projection],
      now: () => '2026-09-04T12:00:00',
      state: { async load() { return null; }, async save() { throw new Error('READ_ONLY_PROBE'); } },
      async apply() { throw new Error('READ_ONLY_PROBE'); },
    });
    const event = await readonlyConsumer.fetchExactRelease({ releaseId: options.event.releaseId });
    assert.deepEqual(event, options.event);
    const snapshot = readonlyConsumer.verifySnapshot(await readonlyConsumer.downloadSnapshot(event));
    assert.equal(snapshot.event.snapshotArtifactDigest, options.event.snapshotArtifactDigest);
    assert.equal(snapshot.snapshot.projectionContract.schemaDigest, options.event.projectionSchemaDigest);
    assert.equal((await readonlyConsumer.getCheckpoint()).appliedAggregateVersion, '0');
    const failure = await worker({ ...config,
      ...(interruption === 'BEFORE_APPLY' ? { failurePoint: 'BEFORE_APPLY' } : { receiptInterruption: interruption }) });
    assert.equal(failure.exitCode, 86, 'SDK_INTERRUPTION_NOT_OBSERVED');
    if (interruption === 'BEFORE_APPLY') await assert.rejects(readFile(statePath), { code: 'ENOENT' });
    else {
      const pending = JSON.parse(await readFile(statePath, 'utf8')) as ReleaseConsumerState & { applyCount: number };
      assert.equal(pending.applyCount, 1);
      assert.equal(pending.appliedEvents[event.eventId]?.closure, 'APPLIED_PENDING_RECEIPT');
    }
    const expectedCheckpoint = interruption === 'AFTER_RESPONSE' ? event.aggregateVersion : '0';
    assert.equal((await readonlyConsumer.getCheckpoint()).appliedAggregateVersion, expectedCheckpoint);
    const recovered = await worker(config);
    assert.equal(recovered.exitCode, 0, 'SDK_RESTART_FAILED');
    assert.deepEqual(JSON.parse(recovered.output), { applied: interruption === 'BEFORE_APPLY' ? 1 : 0, receiptsClosed: 1 });
    const closed = JSON.parse(await readFile(statePath, 'utf8')) as ReleaseConsumerState & { applyCount: number };
    assert.equal(closed.applyCount, 1, 'SDK_DESTRUCTIVE_REAPPLICATION');
    assert.equal(closed.appliedEvents[event.eventId]?.closure, 'CLOSED');
    assert.equal((await readonlyConsumer.getCheckpoint()).appliedAggregateVersion, event.aggregateVersion);
    assert.deepEqual(await readonlyConsumer.poll(event.aggregateVersion), []);
    assert.deepEqual(JSON.parse((await worker(config)).output), { applied: 0, receiptsClosed: 0 });
    // The latest checkpoint is backed by the server's first qualifying receipt.
    assert.equal((await readonlyConsumer.getOperationalStatus()).lastSuccessfulApply?.releaseId, event.releaseId);
  }
  const other = createReleaseConsumer({ client: createGovernanceApiClient({ baseUrl: options.baseUrl, accessToken: options.otherAccessToken }),
    subscriptionId: options.subscriptionIds[0]!, supportedProjections: [options.projection], now: () => '2026-09-04T12:00:00',
    state: { async load() { return null; }, async save() {} }, async apply() {} });
  await assert.rejects(other.poll(), { code: 'CONSUMER_SUBSCRIPTION_FORBIDDEN' });
  const lifecycleConsumer = createReleaseConsumer({ client,
    subscriptionId: options.subscriptionIds[0]!, supportedProjections: [options.projection], now: () => '2026-09-04T12:00:00',
    state: { async load() { return null; }, async save() {} }, async apply() {} });
  for (const targetStatus of ['SUSPENDED', 'ACTIVE', 'REVOKED', 'ARCHIVED'] as const) {
    const transition = await options.owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions', {
      params: { path: { subscriptionId: options.subscriptionIds[0]! }, header: { 'x-csrf-token': options.csrfToken } },
      body: { governanceObjectId: options.event.governanceObjectId, targetStatus },
    });
    assert.equal(transition.response.status, 200);
    if (targetStatus === 'ACTIVE') assert.equal((await lifecycleConsumer.poll()).length, 1);
    else await assert.rejects(lifecycleConsumer.poll(), { code: targetStatus });
  }
  return { verifiedBeforeApplyRestart: true, appliedBeforeReceiptRestart: true, receiptBeforeLocalClosureRestart: true,
    exactReleaseAndSnapshotVerified: true, callbacksAppliedOnce: true, sdkCheckpointAdvanced: true,
    sdkOldEventsFiltered: true, sdkCrossSubscriptionRejected: true, sdkLifecycleTyped: true, childProcessesClosed: true };
}

async function worker(input: object): Promise<{ exitCode: number | null; output: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tooling/prototype/release-consumer-sdk-worker.ts'], {
    cwd: resolve(import.meta.dirname, '../..'), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let errorOutput = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errorOutput += chunk; });
  const completion = new Promise<number | null>((resolveExit, reject) => {
    child.once('error', () => reject(new Error('SDK_WORKER_START_FAILED')));
    child.once('close', resolveExit);
  });
  const timer = setTimeout(() => child.kill(), 30_000);
  child.stdin.end(JSON.stringify(input));
  try {
    const exitCode = await completion;
    assert.doesNotMatch(output + errorOutput, /postgres:\/\/|postgresql:\/\/|DATABASE_URL=|password|Bearer/iu);
    return { exitCode, output };
  } finally { clearTimeout(timer); }
}
