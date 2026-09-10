import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalize } from 'json-canonicalize';
import { expect, it } from 'vitest';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, type ReplayRecord, type ReplayAdapter } from './index.js';

const id = '10000000-0000-7000-8000-000000000001';
const releaseId = '10000000-0000-7000-8000-000000000003';
const time = '2026-09-04T12:00:00';
function harness() {
  const fixture = JSON.parse(readFileSync(new URL('../../../tooling/prototype/fixtures/department-consumer-baseline.json', import.meta.url), 'utf8'))
    .contracts.find((f: { projectionType: string }) => f.projectionType === 'hdi.department-master');
  const artifact = JSON.parse(fixture.artifactUtf8);
  let bytes = fixture.artifactUtf8 as string;
  let failReceipt: 'NONE' | 'BEFORE' | 'AFTER' = 'NONE';
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const event = { eventId: id, governanceObjectId: artifact.release.governanceObjectId,
    aggregateVersion: '1', releaseId, snapshotId: id, projectionType: 'hdi.department-master',
    projectionSchemaVersion: '1', projectionSchemaDigest: fixture.schemaDigest,
    projectionPayloadDigest: hash(canonicalize(artifact.payload)), snapshotArtifactDigest: hash(fixture.artifactUtf8) };
  const calls: string[] = [];
  const metadata = { subscriptionId: id, servicePrincipalId: id, lifecycleStatus: 'ACTIVE',
    subscriptionVersion: { subscriptionVersionId: id, versionNo: '1', projectionType: event.projectionType,
      projectionSchemaVersion: '1', projectionSchemaDigest: fixture.schemaDigest }, event,
    checkpoint: { appliedAggregateVersion: '0', recordedAt: null as string | null }, latestReceipt: null,
    appliedReceipt: null as null | { receiptId: string; receiptSequence: string; receiveResult: string;
      validationResult: string; applyResult: string; processingDigest: string }, processingDigestMismatch: false };
  const auditReports: Record<string, unknown>[] = [];
  const client = createGovernanceApiClient({ baseUrl: 'http://127.0.0.1', fetch: async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const path = new URL(request.url).pathname;
    calls.push(`${request.method} ${path}`);
    if (path.endsWith('/audit-reports')) {
      const body = await request.json() as Record<string, unknown>;
      auditReports.push(body);
      return Response.json({ auditEventId: id, auditSequence: '1' }, { status: 201 });
    }
    if (path.endsWith('/replay-context')) return Response.json(metadata);
    if (path.endsWith('/content')) return new Response(bytes, { headers: {
      'x-snapshot-id': id, digest: `sha-256=:${Buffer.from(hash(bytes), 'hex').toString('base64')}:`,
    } });
    if (path.endsWith('/receipts')) {
      if (failReceipt === 'BEFORE') throw new Error('Bearer SECRET password SECRET');
      metadata.appliedReceipt = { receiptId: id, receiptSequence: '1', receiveResult: 'ACCEPTED',
        validationResult: 'VALID', applyResult: 'APPLIED', processingDigest: event.snapshotArtifactDigest };
      if (BigInt(metadata.checkpoint.appliedAggregateVersion) < 1n) metadata.checkpoint.appliedAggregateVersion = '1';
      if (failReceipt === 'AFTER') throw new Error('Bearer SECRET password SECRET');
      return Response.json({ receiptId: id, receiptSequence: '1' }, { status: 201 });
    }
    throw new Error('UNEXPECTED_MUTATION_OR_POLL');
  } });
  const consumer = createReleaseConsumer({ client, subscriptionId: id,
    supportedProjections: [{ projectionType: 'hdi.department-master', projectionSchemaVersion: '1' }],
    now: () => time, state: { async load() { throw new Error('ORDINARY_STATE_USED'); }, async save() { throw new Error('MUTATION'); } },
    async apply() { throw new Error('MUTATION'); } });
  let saved: ReplayRecord | null = null;
  let applyCount = 0;
  const adapter: ReplayAdapter = {
    async load() { return structuredClone(saved); },
    async commit(_snapshot, record) { applyCount++; saved = structuredClone(record); },
    async close(record) { saved = structuredClone(record); },
  };
  return { consumer, metadata, calls, auditReports, adapter, saved: () => saved, applyCount: () => applyCount,
    setReceiptFailure(value: typeof failReceipt) { failReceipt = value; },
    corruptBytes() { bytes = '{}'; },
    malformedPayload() { delete artifact.payload.departmentId; bytes = JSON.stringify(artifact); event.snapshotArtifactDigest = hash(bytes); },
    malformedEnvelope() { artifact.release.releaseKind = 'INVALID'; bytes = JSON.stringify(artifact); event.snapshotArtifactDigest = hash(bytes); },
  };
}

it('dry-run resolves one immutable release without poll, apply, receipt or state mutation', async () => {
  const h = harness();
  const result = await h.consumer.inspectReplay({ releaseId });
  expect(result.context.subscriptionVersion.versionNo).toBe('1');
  expect(result.context.checkpoint.appliedAggregateVersion).toBe('0');
  expect(result.context.appliedReceipt).toBeNull();
  expect(h.calls).toHaveLength(2);
  expect(h.calls.every((call) => call.startsWith('GET ') && !call.endsWith('/events'))).toBe(true);
  expect(h.auditReports).toEqual([]);
});

it('pairs each real replay invocation with its own terminal evidence, including idempotent retries', async () => {
  const h = harness(); const command = { releaseId, operationId: id, reason: 'Synthetic repair' };
  await h.consumer.replayExactRelease(command, h.adapter);
  await h.consumer.replayExactRelease(command, h.adapter);
  const starts = h.auditReports.filter(r => r['eventType'] === 'CONSUMER_REPLAY_REQUESTED');
  expect(starts).toHaveLength(2); expect(starts[0]!['attemptId']).not.toBe(starts[1]!['attemptId']);
  for (const start of starts) expect(h.auditReports.filter(r => r['attemptId'] === start['attemptId'] &&
    r['eventType'] === 'CONSUMER_REPLAY_COMPLETED')).toHaveLength(1);
  expect(h.applyCount()).toBe(1);
});
it('records requested and failed for preflight digest failure', async () => {
  const h = harness(); h.corruptBytes();
  await expect(h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Synthetic repair' }, h.adapter))
    .rejects.toMatchObject({ code: 'SNAPSHOT_DIGEST_MISMATCH' });
  expect(h.auditReports[0]).toMatchObject({ eventType: 'CONSUMER_REPLAY_REQUESTED' });
  expect(h.auditReports.at(-1)).toMatchObject({ eventType: 'CONSUMER_REPLAY_FAILED', failureCode: 'DIGEST_MISMATCH' });
  expect(h.applyCount()).toBe(0);
});

it('explicit exact apply commits durably, closes a receipt and repeats the same operation idempotently', async () => {
  const h = harness();
  const command = { releaseId, operationId: id, reason: 'Synthetic restore' };
  await h.consumer.replayExactRelease(command, h.adapter);
  expect(h.applyCount()).toBe(1);
  expect(h.saved()?.closure).toBe('CLOSED');
  expect(h.metadata.checkpoint.appliedAggregateVersion).toBe('1');
  await h.consumer.replayExactRelease(command, h.adapter);
  expect(h.applyCount()).toBe(1);
  expect(h.calls.filter((call) => call.startsWith('POST ') && call.endsWith('/receipts'))).toHaveLength(1);
});

it('explicit repair reapplies an old release but reuses its immutable APPLIED receipt and checkpoint 105', async () => {
  const h = harness();
  h.metadata.checkpoint = { appliedAggregateVersion: '105', recordedAt: time };
  h.metadata.appliedReceipt = { receiptId: id, receiptSequence: '1', receiveResult: 'ACCEPTED',
    validationResult: 'VALID', applyResult: 'APPLIED', processingDigest: h.metadata.event.snapshotArtifactDigest };
  const before = structuredClone(h.metadata);
  const result = await h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Repair historical data' }, h.adapter);
  expect(result.businessApplied).toBe(true);
  expect(result.receiptReused).toBe(true);
  expect(result.checkpointAfter.appliedAggregateVersion).toBe('105');
  expect(h.metadata).toEqual(before);
  expect(h.calls.filter((call) => call.startsWith('POST ') && call.endsWith('/receipts'))).toHaveLength(1);
});

it('rejects processing digest mismatch before apply or checkpoint changes', async () => {
  const h = harness(); h.metadata.processingDigestMismatch = true;
  await expect(h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Repair' }, h.adapter))
    .rejects.toMatchObject({ code: 'CONSUMER_PROCESSING_DIGEST_MISMATCH' });
  expect(h.applyCount()).toBe(0);
  expect(h.metadata.checkpoint.appliedAggregateVersion).toBe('0');
});

it.each([
  ['content digest', 'SNAPSHOT_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => h.corruptBytes()],
  ['schema digest', 'SCHEMA_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => { h.metadata.event.projectionSchemaDigest = '0'.repeat(64); }],
  ['projection type', 'PROJECTION_TYPE_MISMATCH', (h: ReturnType<typeof harness>) => { h.metadata.event.projectionType = 'unknown'; }],
  ['projection version', 'PROJECTION_VERSION_MISMATCH', (h: ReturnType<typeof harness>) => { h.metadata.event.projectionSchemaVersion = '99'; }],
  ['malformed payload', 'PAYLOAD_INVALID', (h: ReturnType<typeof harness>) => h.malformedPayload()],
  ['malformed envelope', 'ENVELOPE_INVALID', (h: ReturnType<typeof harness>) => h.malformedEnvelope()],
  ['payload digest', 'PAYLOAD_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => { h.metadata.event.projectionPayloadDigest = '0'.repeat(64); }],
  ['foreign identity', 'IDENTITY_MISMATCH', (h: ReturnType<typeof harness>) => { h.metadata.event.releaseId = id; }],
  ['future release gap', 'EVENT_GAP', (h: ReturnType<typeof harness>) => {
    h.metadata.event.aggregateVersion = '105'; h.metadata.checkpoint.appliedAggregateVersion = '98';
  }],
] as const)('replay fails closed on %s before any business apply or receipt', async (_case, code, change) => {
  const h = harness(); change(h);
  await expect(h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Repair' }, h.adapter)).rejects.toMatchObject({ code });
  expect(h.applyCount()).toBe(0); expect(h.saved()).toBeNull();
  expect(h.calls.some((call) => call.startsWith('POST ') && call.endsWith('/receipts'))).toBe(false);
});

it.each(['BEFORE', 'AFTER'] as const)('recovers a durable pending replay after %s receipt transport failure without reapplying', async (failure) => {
  const h = harness(); const command = { releaseId, operationId: id, reason: 'Repair' };
  h.setReceiptFailure(failure);
  await expect(h.consumer.replayExactRelease(command, h.adapter)).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
  expect(h.saved()?.closure).toBe('APPLIED_PENDING_RECEIPT'); expect(h.applyCount()).toBe(1);
  h.setReceiptFailure('NONE');
  await h.consumer.replayExactRelease(command, h.adapter);
  expect(h.saved()?.closure).toBe('CLOSED'); expect(h.applyCount()).toBe(1);
});

it('refuses a reused operation with a different reason, before mutation', async () => {
  const h = harness(); await h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Repair' }, h.adapter);
  await expect(h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Different repair' }, h.adapter))
    .rejects.toMatchObject({ code: 'REPLAY_OPERATION_CONFLICT' });
  expect(h.applyCount()).toBe(1);
});

it('rejects callback success without durable evidence', async () => {
  const h = harness();
  await expect(h.consumer.replayExactRelease({ releaseId, operationId: id, reason: 'Repair' }, {
    ...h.adapter, async commit() {},
  })).rejects.toMatchObject({ code: 'APPLY_NOT_DURABLE' });
  expect(h.calls.some((call) => call.startsWith('POST ') && call.endsWith('/receipts'))).toBe(false);
});

it('does not reflect arbitrary receipt-state strings into CLI-visible replay metadata', async () => {
  const h = harness();
  Object.assign(h.metadata, { latestReceipt: { receiptId: id, receiptSequence: '1', receiveResult: 'ACCEPTED',
    validationResult: 'VALID', applyResult: 'Bearer private-secret', processingDigest: h.metadata.event.snapshotArtifactDigest } });
  await expect(h.consumer.inspectReplay({ releaseId })).rejects.toMatchObject({ code: 'RESPONSE_INVALID' });
});
