import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, type ProjectionSupport } from '@hospital-data-intelligence/release-consumer-sdk';
import type { checkConsumerLifecycleFlow } from './check-consumer-lifecycle-flow.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { PROTOTYPE_CSRF_TOKEN } from '../../apps/governance-api/src/platform/authentication/prototype-authentication.js';

export type ReadMetrics = () => Promise<string>;
export function metricValue(text: string, name: string, projection: string, labels: Record<string, string> = {}): number {
  const key = `${name}{projection_type="${projection}",projection_schema_version="1"${Object.keys(labels).sort().map(k => `,${k}="${labels[k]}"`).join('')}} `;
  const line = text.split('\n').find(line => line.startsWith(key));
  assert.ok(line, `METRIC_SAMPLE_MISSING:${name}`);
  return Number(line.slice(key.length));
}
export const metricCounters = (text: string) => text.split('\n').filter(line => /^[a-z_]+_total\{/u.test(line)).join('\n');

export async function checkPublicationMetrics<T>(read: ReadMetrics, projection: string, publish: () => Promise<T>): Promise<T> {
  const before = metricCounters(await read());
  const previous = process.env['NODE_ENV']; process.env['NODE_ENV'] = 'test';
  try {
    configureControlledPublicationFault('OUTBOX_EVENT_WRITTEN');
    await assert.rejects(publish);
  } finally {
    configureControlledPublicationFault(null);
    if (previous === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = previous;
  }
  assert.equal(metricCounters(await read()), before, 'METRICS_PUBLICATION_ROLLBACK');
  const count = metricValue(await read(), 'release_publish_total', projection);
  const result = await publish();
  assert.equal(metricValue(await read(), 'release_publish_total', projection), count + 1, 'METRICS_PUBLISH_SUCCESS');
  // An idempotent result or explicit terminal-state rejection both preserve business volume.
  await publish().catch(() => undefined);
  assert.equal(metricValue(await read(), 'release_publish_total', projection), count + 1, 'METRICS_PUBLICATION_RETRY');
  return result;
}

type Input = Pick<Parameters<typeof checkConsumerLifecycleFlow>[0], 'database' | 'runner' | 'context' | 'service' | 'owner' | 'subscriptionId' | 'event'> & {
  baseUrl: string; accessToken: string; readMetrics: ReadMetrics;
};
export async function checkConsumerMetricsBeforeApply(input: Input) {
  const { database, runner, context, service, owner, subscriptionId, event, readMetrics } = input;
  const path = { subscriptionId };
  const value = async (name: string, labels: Record<string, string>) => metricValue(await readMetrics(), name, event.projectionType, labels);
  const success = () => value('consumer_apply_total', { mode: 'normal', result: 'success' });
  const noClosure = async () => {
    assert.deepEqual(await database.selectFrom('release_distribution.consumer_checkpoint').selectAll().where('consumer_subscription_id', '=', subscriptionId).execute(), []);
    assert.deepEqual(await database.selectFrom('release_distribution.consumer_receipt').selectAll().where('consumer_subscription_id', '=', subscriptionId).where('apply_result', '=', 'APPLIED').execute(), []);
  };
  const makeConsumer = (client = service) => createReleaseConsumer({ client, subscriptionId,
    supportedProjections: [{ projectionType: event.projectionType, projectionSchemaVersion: '1' } as ProjectionSupport],
    now: () => context().occurredAt, state: { async load() { return null; }, async save() {} },
    async apply() { throw new Error('synthetic-private callback detail'); } });
  const baseline = await success();
  const corrupt = createGovernanceApiClient({ baseUrl: input.baseUrl, accessToken: input.accessToken,
    async fetch(request, init) {
      const response = await fetch(request, init);
      return response.ok && (request instanceof Request ? request.url : String(request)).includes('/content')
        ? new Response('{}', { headers: response.headers }) : response;
    } });
  const schemaCorrupt = createGovernanceApiClient({ baseUrl: input.baseUrl, accessToken: input.accessToken,
    async fetch(request, init) {
      const response = await fetch(request, init);
      if (!response.ok || !(request instanceof Request ? request.url : String(request)).includes('/events')) return response;
      const body = await response.json() as { events: { projectionSchemaDigest: string }[] };
      for (const row of body.events) row.projectionSchemaDigest = '0'.repeat(64);
      return new Response(JSON.stringify(body), { headers: response.headers });
    } });
  for (const reason of ['content_digest_mismatch', 'schema_digest_mismatch']) {
    const before = await value('consumer_digest_failure_total', { mode: 'normal', bounded_reason: reason });
    const sdk = makeConsumer(reason === 'content_digest_mismatch' ? corrupt : schemaCorrupt);
    const selected = await sdk.fetchExactRelease({ releaseId: event.releaseId });
    const downloaded = await sdk.downloadSnapshot(selected);
    await assert.rejects(sdk.verifySnapshot(downloaded), { code: reason === 'content_digest_mismatch' ? 'SNAPSHOT_DIGEST_MISMATCH' : 'SCHEMA_DIGEST_MISMATCH' });
    assert.equal(await value('consumer_digest_failure_total', { mode: 'normal', bounded_reason: reason }), before + 1);
    assert.equal(await success(), baseline); await noClosure();
  }
  const sdk = makeConsumer();
  const verified = await sdk.verifySnapshot(await sdk.downloadSnapshot(await sdk.fetchExactRelease({ releaseId: event.releaseId })));
  assert.equal(await success(), baseline, 'METRICS_VERIFIED_IS_NOT_APPLIED');
  assert.equal((await service.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-reports', { params: { path },
    body: { evidenceId: randomUUID(), releaseId: event.releaseId, mode: 'ORIGINAL', eventType: 'CONSUMER_APPLY_SUCCEEDED', occurredAt: context().occurredAt },
  })).response.status, 201);
  assert.equal(await success(), baseline, 'METRICS_HTTP_AND_REPORT_ARE_NOT_APPLIED');
  await noClosure();
  const failed = await value('consumer_apply_total', { mode: 'normal', result: 'failed' });
  await assert.rejects(sdk.apply(verified), { code: 'APPLY_FAILED' });
  assert.equal(await value('consumer_apply_total', { mode: 'normal', result: 'failed' }), failed + 1);
  await noClosure();
  const report = { evidenceId: randomUUID(), releaseId: event.releaseId, mode: 'ORIGINAL' as const,
    eventType: 'CONSUMER_APPLY_FAILED' as const, failureCode: 'APPLY_FAILED' as const, occurredAt: context().occurredAt };
  const first = await service.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-reports', { params: { path }, body: report });
  assert.equal(first.response.status, 201);
  const beforeRetry = metricCounters(await readMetrics());
  assert.equal((await service.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-reports', { params: { path }, body: report })).response.status, 201);
  assert.equal(metricCounters(await readMetrics()), beforeRetry, 'METRICS_AUDIT_RETRY');
  const processed = await value('consumer_digest_failure_total', { mode: 'normal', bounded_reason: 'processing_digest_mismatch' });
  assert.equal((await service.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts', { params: { path }, body: {
    eventId: event.eventId, receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED',
    processingDigest: '0'.repeat(64), processedAt: context().occurredAt,
  } })).response.status, 400);
  assert.equal(await value('consumer_digest_failure_total', { mode: 'normal', bounded_reason: 'processing_digest_mismatch' }), processed + 1);
  await noClosure(); assert.equal(await success(), baseline);
  const principal = await database.selectFrom('release_distribution.consumer_subscription').select('service_principal_id')
    .where('consumer_subscription_id', '=', subscriptionId).executeTakeFirstOrThrow();
  const counters = metricCounters(await readMetrics());
  await assert.rejects(runner.run(context(principal.service_principal_id), async modules => {
    await modules.releaseDistribution.recordReceipt({ subscriptionId, servicePrincipalId: principal.service_principal_id,
      eventId: event.eventId, receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED',
      processingDigest: Buffer.from(event.snapshotArtifactDigest, 'hex'), processedAt: context().occurredAt });
    throw new Error('SYNTHETIC_METRICS_ROLLBACK');
  }), { message: 'SYNTHETIC_METRICS_ROLLBACK' });
  assert.equal(metricCounters(await readMetrics()), counters); await noClosure();

  const support = { governanceObjectId: event.governanceObjectId,
    projectionType: event.projectionType as 'hdi.department-master' | 'hdi.department-hierarchy', projectionSchemaVersion: '1' as const };
  const policy = async (configured: boolean) => {
    assert.equal((await owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/versions', {
      params: { path, header: { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN } }, body: { ...support,
        ...(configured ? { sla: { criticality: 'CRITICAL' as const, expectedApplyWithinSeconds: 1 } } : {}) },
    })).response.status, 201);
  };
  const status = async () => {
    const result = await service.GET('/v1/phase-01/consumer-subscriptions/{subscriptionId}/operational-status', { params: { path } });
    assert.equal(result.response.status, 200); assert.ok(result.data); return result.data;
  };
  assert.equal((await status()).status, 'NOT_CONFIGURED');
  await setTimeout(1100);
  const breaches = await value('consumer_sla_breached', { criticality: 'CRITICAL' });
  await policy(true);
  assert.equal((await status()).applyOverdue, true);
  assert.equal(await value('consumer_sla_breached', { criticality: 'CRITICAL' }), breaches + 1);
  assert.equal(await value('consumer_sla_breached', { criticality: 'CRITICAL' }), breaches + 1, 'METRICS_SCRAPE_IS_NOT_EVENT');
  for (const targetStatus of ['SUSPENDED', 'ACTIVE'] as const) {
    assert.equal((await owner.POST('/v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions', {
      params: { path, header: { 'x-csrf-token': PROTOTYPE_CSRF_TOKEN } }, body: { governanceObjectId: event.governanceObjectId, targetStatus },
    })).response.status, 200);
    assert.equal(await value('consumer_sla_breached', { criticality: 'CRITICAL' }), breaches + (targetStatus === 'ACTIVE' ? 1 : 0));
  }
  await policy(false); assert.equal((await status()).status, 'NOT_CONFIGURED');
  assert.equal(await value('consumer_sla_breached', { criticality: 'CRITICAL' }), breaches);
  await policy(true);
  return { baseline, status, checks: { metricsDigestFailuresNoClosure: true, metricsCallbackFailure: true,
    metricsProcessingDigestNoClosure: true, metricsReceiptRollback: true, metricsAuditRetry: true,
    metricsSlaNotConfigured: true, metricsSlaNeverApplied: true, metricsLifecycleOverride: true } };
}
