import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, type ConsumerAuditReport, type ReplayRecord } from '@hospital-data-intelligence/release-consumer-sdk';
import type { checkConsumerLifecycleFlow } from './check-consumer-lifecycle-flow.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';

type Input = Pick<Parameters<typeof checkConsumerLifecycleFlow>[0], 'database' | 'runner' | 'context' | 'service' | 'otherService' | 'subscriptionId' | 'event'> & {
  baseUrl: string; accessToken: string;
};
const queryPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-events' as const;
const reportPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-reports' as const;
const receiptPath = '/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts' as const;
export async function readConsumerAuditProof(input: Pick<Input, 'service' | 'subscriptionId'>) {
  const events = [];
  let afterSequence = '0';
  for (let page = 0; page < 100; page++) {
    const result = await input.service.GET(queryPath, { params: { path: { subscriptionId: input.subscriptionId }, query: { limit: 7, afterSequence } } });
    assert.equal(result.response.status, 200, 'AUDIT_QUERY_FAILED'); assert.ok(result.data);
    events.push(...result.data.events);
    if (!result.data.nextAfterSequence) return events;
    assert.ok(BigInt(result.data.nextAfterSequence) > BigInt(afterSequence));
    afterSequence = result.data.nextAfterSequence;
  }
  throw new Error('AUDIT_TEST_PAGE_BOUND');
}
export async function checkConsumerAuditFlow(input: Input) {
  const { database, runner, context, service, otherService, subscriptionId, event } = input;
  const path = { subscriptionId };
  const before = await readConsumerAuditProof(input);
  for (const type of ['CONSUMER_RELEASE_OBSERVED', 'CONSUMER_SNAPSHOT_VERIFIED', 'CONSUMER_APPLY_SUCCEEDED',
    'CONSUMER_RECEIPT_ACCEPTED', 'CONSUMER_RECEIPT_REJECTED']) assert.ok(before.some(e => e.eventType === type), `AUDIT_MISSING_${type}`);
  assert.ok(before.some(e => e.evidence.failureCode === 'CROSS_SUBSCRIPTION'));
  assert.ok(before.some(e => e.evidence.failureCode === 'PROCESSING_DIGEST_MISMATCH'));
  for (const row of before) {
    assert.equal(row.evidence.subscriptionId, subscriptionId);
    assert.equal(row.evidence.releaseId, event.releaseId);
    assert.ok(row.evidence.subscriptionVersionId);
    assert.equal(row.evidence.projectionType, event.projectionType);
    assert.equal(row.evidence.projectionSchemaVersion, '1');
    assert.doesNotMatch(row.occurredAt, /Z|[+]08/u); assert.doesNotMatch(row.recordedAt, /Z|[+]08/u);
  }
  const filtered = await service.GET(queryPath, { params: { path, query: { releaseId: event.releaseId,
    projectionType: event.projectionType, eventType: 'CONSUMER_RECEIPT_ACCEPTED', result: 'SUCCEEDED', limit: 1 } } });
  assert.equal(filtered.response.status, 200); assert.equal(filtered.data?.events.length, 1);
  assert.equal((await otherService.GET(queryPath, { params: { path } })).response.status, 403);
  const raw = (suffix: string, method = 'GET', body?: unknown) => fetch(`${input.baseUrl}/v1/phase-01/consumer-subscriptions/${subscriptionId}/${suffix}`, {
    method, headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json',
      'x-request-id': 'Bearer synthetic-private', 'x-correlation-id': 'postgres://synthetic-private' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const query of ['limit=0', 'limit=101', 'limit=-1', 'afterSequence=9999999999999999999',
    'eventType=unknown', 'result=unknown', 'occurredFrom=2026-09-01T00:00:00',
    'occurredFrom=2026-09-01T00:00:00Z&occurredTo=2026-09-02T00:00:00',
    'occurredFrom=2026-09-02T00:00:00&occurredTo=2026-09-01T00:00:00',
    'occurredFrom=2026-01-01T00:00:00&occurredTo=2026-09-01T00:00:00']) {
    assert.equal((await raw(`audit-events?${query}`)).status, 400, `AUDIT_QUERY_BOUND_FAILED:${query}`);
  }
  const report: ConsumerAuditReport = { releaseId: event.releaseId, evidenceId: randomUUID(),
    eventType: 'CONSUMER_RELEASE_OBSERVED', mode: 'ORIGINAL', occurredAt: context().occurredAt };
  for (const value of [{ ...report, occurredAt: `${report.occurredAt}Z` }, { ...report, failureCode: 'secret exception' },
    { ...report, eventType: 'CONSUMER_RECEIPT_ACCEPTED' }, { ...report, payload: { patient: 'private' } },
    { ...report, Authorization: 'Bearer private' }, { ...report, DATABASE_URL: 'postgres://private' }]) {
    assert.equal((await raw('audit-reports', 'POST', value)).status, 400, 'AUDIT_REPORT_BOUND_FAILED');
  }
  assert.equal((await raw('audit-reports', 'POST', report)).status, 201);
  const retryReport = { ...report, evidenceId: randomUUID() };
  const first = await service.POST(reportPath, { params: { path }, body: retryReport });
  assert.equal(first.response.status, 201);
  const countBeforeRetry = (await readConsumerAuditProof(input)).length;
  const duplicate = await service.POST(reportPath, { params: { path }, body: retryReport });
  assert.deepEqual(duplicate.data, first.data);
  assert.equal((await readConsumerAuditProof(input)).length, countBeforeRetry);
  assert.equal((await service.POST(reportPath, { params: { path }, body: {
    ...retryReport, occurredAt: '2026-01-01T00:00:00',
  } })).response.status, 409);
  assert.deepEqual((await service.GET(queryPath, { params: { path, query: { releaseId: randomUUID() } } })).data?.events, []);
  const countBeforeAbsent = (await readConsumerAuditProof(input)).length;
  for (const method of ['PATCH', 'PUT', 'DELETE']) for (const suffix of ['audit-events', 'audit-reports']) {
    assert.equal((await raw(suffix, method, {})).status, 404);
  }
  assert.equal((await readConsumerAuditProof(input)).length, countBeforeAbsent);
  for (const mutation of ['UPDATE', 'DELETE'] as const) {
    await assert.rejects(database.transaction().execute(async tx => {
      if (mutation === 'UPDATE') await tx.updateTable('audit.audit_event').set({ action: 'TAMPER' })
        .where('audit_event_id', '=', before[0]!.auditEventId).execute();
      else await tx.deleteFrom('audit.audit_event').where('audit_event_id', '=', before[0]!.auditEventId).execute();
    }), error => error instanceof Error && 'code' in error && ['55000', '42501'].includes(String(error.code)));
  }
  // Freeze all affected business facts, then fail after the audit INSERT.
  const facts = async () => (await sql<{ facts: unknown }>`select jsonb_build_object(
    'receipts', (select jsonb_agg(to_jsonb(r) order by receipt_sequence) from release_distribution.consumer_receipt r where consumer_subscription_id=${subscriptionId}),
    'checkpoint', (select jsonb_agg(to_jsonb(c)) from release_distribution.consumer_checkpoint c where consumer_subscription_id=${subscriptionId}),
    'states', (select count(*) from release_distribution.outbox_delivery_state where consumer_subscription_id=${subscriptionId}),
    'audit', (select count(*) from audit.audit_event where audit_stream_id=${subscriptionId})) facts`.execute(database)).rows[0]!.facts;
  const frozen = await facts();
  const previousEnvironment = process.env['NODE_ENV']; process.env['NODE_ENV'] = 'test';
  try {
    configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
    const result = await service.POST(receiptPath, { params: { path }, body: { eventId: event.eventId,
      receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED',
      processedAt: context().occurredAt, processingDigest: event.snapshotArtifactDigest } });
    assert.equal(result.response.status, 503); assert.equal(result.error?.code, 'CONSUMER_AUDIT_UNAVAILABLE');
  } finally {
    configureControlledPublicationFault(null);
    if (previousEnvironment === undefined) delete process.env['NODE_ENV']; else process.env['NODE_ENV'] = previousEnvironment;
  }
  assert.deepEqual(await facts(), frozen, 'RECEIPT_AUDIT_ATOMICITY_FAILED');
  const owner = await database.selectFrom('release_distribution.consumer_subscription').select('service_principal_id')
    .where('consumer_subscription_id', '=', subscriptionId).executeTakeFirstOrThrow();
  const foreignActor = before.find(row => row.evidence.failureCode === 'CROSS_SUBSCRIPTION')!.actorPrincipalId;
  const forgedInternalReport = { ...report, denial: true, receiptApplyResult: 'Bearer private' };
  await assert.rejects(runner.run(context(foreignActor), modules =>
    modules.releaseDistribution.reportConsumerAudit(subscriptionId, forgedInternalReport)), { message: 'CONSUMER_SUBSCRIPTION_FORBIDDEN' });
  assert.deepEqual(await facts(), frozen);
  await assert.rejects(runner.run(context(owner.service_principal_id), async modules => {
    await modules.releaseDistribution.recordReceipt({ subscriptionId, servicePrincipalId: owner.service_principal_id,
      eventId: event.eventId, receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED',
      processingDigest: Buffer.from(event.snapshotArtifactDigest, 'hex'), processedAt: context().occurredAt });
    throw new Error('SYNTHETIC_BUSINESS_ROLLBACK');
  }), { message: 'SYNTHETIC_BUSINESS_ROLLBACK' });
  assert.deepEqual(await facts(), frozen, 'BUSINESS_ROLLBACK_LEFT_AUDIT');
  const corrupt = createGovernanceApiClient({ baseUrl: input.baseUrl, accessToken: input.accessToken, fetch: async (request, init) => {
    const response = await fetch(request, init);
    return response.ok && (request instanceof Request ? request.url : String(request)).includes('/content')
      ? new Response('{}', { headers: response.headers }) : response;
  } });
  const consumer = (client = service) => createReleaseConsumer({ client, subscriptionId,
    supportedProjections: [{ projectionType: event.projectionType as 'hdi.department-master' | 'hdi.department-hierarchy', projectionSchemaVersion: '1' }],
    state: { async load() { return null; }, async save() {} }, async apply() {}, now: () => context().occurredAt });
  const broken = consumer(corrupt);
  await assert.rejects(async () => broken.verifySnapshot(await broken.downloadSnapshot(await broken.fetchExactRelease({ releaseId: event.releaseId }))),
    { code: 'SNAPSHOT_DIGEST_MISMATCH' });
  const adapter = { async load(): Promise<ReplayRecord | null> { return null; }, async commit() { throw new Error('Bearer secret patient data'); }, async close() {} };
  await assert.rejects(consumer().replayExactRelease({ releaseId: event.releaseId, operationId: randomUUID(), reason: 'Synthetic audit failure' }, adapter), { code: 'APPLY_FAILED' });
  // Legacy replay idempotence also must not persist an arbitrary reason/header.
  assert.equal((await raw('receipts', 'POST', { eventId: event.eventId, receiveResult: 'ACCEPTED', validationResult: 'VALID',
    applyResult: 'APPLIED', processingDigest: event.snapshotArtifactDigest, processedAt: context().occurredAt,
    replay: { releaseId: event.releaseId, subscriptionVersionId: before[0]!.evidence.subscriptionVersionId,
      operationId: randomUUID(), reason: 'Bearer synthetic-private' },
  })).status, 201);
  const rows = await readConsumerAuditProof(input);
  assert.ok(rows.some(e => e.eventType === 'CONSUMER_SNAPSHOT_VERIFICATION_FAILED' && e.evidence.failureCode === 'DIGEST_MISMATCH'));
  assert.ok(rows.some(e => e.eventType === 'CONSUMER_APPLY_FAILED' && e.evidence.failureCode === 'APPLY_FAILED'));
  assert.ok(rows.some(e => e.eventType === 'CONSUMER_REPLAY_FAILED'));
  assert.equal(await runner.run(context(), m => m.audit.verifyChain(subscriptionId)), true);
  assert.doesNotMatch(JSON.stringify(rows), /Bearer|postgres(?:ql)?:\/\/|DATABASE_URL|password|patient|canonicalPayload|synthetic-private/iu);
  const stored = await database.selectFrom('audit.audit_event').select(['event_payload', 'request_id', 'correlation_id'])
    .where('audit_stream_id', '=', subscriptionId).execute();
  assert.doesNotMatch(JSON.stringify(stored), /Bearer|postgres(?:ql)?:\/\/|DATABASE_URL|password|patient|canonicalPayload|synthetic-private/iu);
  return { auditTaxonomy: true, auditPaginationBounds: true, auditIsolation: true, auditAppendOnly: true,
    auditMutationRoutesAbsent: true, auditSecretsAbsent: true, auditAtomicReceiptRollback: true, auditVerificationApplyFailure: true };
}
