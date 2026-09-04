import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalize } from 'json-canonicalize';
import { expect, it, vi } from 'vitest';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, ReleaseConsumerError, type ReleaseConsumerOptions, type ReleaseConsumerState,
  type ReleaseEvent, type ProjectionSupport, type VerifiedSnapshot } from './index.js';

const id = '10000000-0000-7000-8000-000000000001';
const objectId = '10000000-0000-7000-8000-000000000002';
const releaseId = '10000000-0000-7000-8000-000000000003';
const time = '2026-09-04T10:00:00';
const secret = 'postgres://hidden postgresql://hidden DATABASE_URL=hidden password Bearer hidden patient-data';
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
type Fixture = { projectionType: string; schemaVersion: string; schemaDigest: string; artifactUtf8: string };
const fixtures = (JSON.parse(readFileSync(new URL('../../../tooling/prototype/fixtures/department-consumer-baseline.json', import.meta.url), 'utf8')) as { contracts: Fixture[] }).contracts;
function harness(pair: ProjectionSupport = { projectionType: 'hdi.department-master', projectionSchemaVersion: '1' }) {
  const fixture = fixtures.find((f) => f.projectionType === pair.projectionType && f.schemaVersion === pair.projectionSchemaVersion)!;
  const artifact = JSON.parse(fixture.artifactUtf8) as { release: Record<string, string | null>; projectionContract: Record<string, string>; payload: Record<string, unknown> };
  let bytes = Buffer.from(fixture.artifactUtf8);
  const event: { -readonly [K in keyof ReleaseEvent]: ReleaseEvent[K] } = {
    eventId: id, governanceObjectId: objectId, aggregateVersion: '1', releaseId, snapshotId: id,
    projectionType: pair.projectionType, projectionSchemaVersion: pair.projectionSchemaVersion,
    projectionSchemaDigest: fixture.schemaDigest, projectionPayloadDigest: digest(canonicalize(artifact.payload)),
    snapshotArtifactDigest: digest(bytes),
  };
  let state: ReleaseConsumerState | null = null;
  let checkpoint = '0';
  let mode: 'before-receipt' | 'after-receipt' | 'no-checkpoint' | 'normal' = 'normal';
  let lifecycle: 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'ARCHIVED' = 'ACTIVE';
  let wrongHeader = false;
  let wrongId = false;
  const receiptBodies: unknown[] = [];
  const callbacks: unknown[] = [];
  const transport = vi.fn<typeof fetch>(async (input) => {
    const request = input instanceof Request ? input : new Request(input);
    const path = new URL(request.url).pathname;
    if (path.endsWith('/operational-status')) return Response.json({
      subscriptionId: id, subscriptionVersionId: id, versionNo: '1', lifecycleStatus: lifecycle,
      sla: { criticality: 'NORMAL', expectedApplyWithinSeconds: null, retryWindowSeconds: null },
      status: lifecycle === 'ACTIVE' ? 'NOT_CONFIGURED' : lifecycle, applyOverdue: false,
      owner: { servicePrincipalId: id, principalCode: 'SYNTHETIC' }, evaluatedAt: time, timezone: 'Asia/Shanghai',
      latestRelease: null, oldestPendingRelease: null, lastSuccessfulApply: null,
      latestCheckpoint: checkpoint === '0' ? null : { appliedReleaseNo: checkpoint, recordedAt: time },
    });
    if (lifecycle !== 'ACTIVE') return Response.json({ code: 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE' }, { status: 403 });
    if (path.endsWith('/events')) return Response.json({ events: [event] }); // deliberately repeats old events
    if (path.endsWith('/content')) return new Response(bytes, { headers: {
      'x-snapshot-id': wrongId ? 'wrong' : id,
      digest: wrongHeader ? 'invalid' : `sha-256=:${Buffer.from(digest(bytes), 'hex').toString('base64')}:`,
    } });
    if (mode === 'before-receipt') throw new Error(secret);
    const body = await request.json() as { applyResult: string };
    receiptBodies.push(body);
    if (body.applyResult === 'APPLIED' && mode !== 'no-checkpoint') checkpoint = event.aggregateVersion;
    if (mode === 'after-receipt') throw new Error(secret);
    return Response.json({ receiptId: id, receiptSequence: '1' }, { status: 201 });
  });
  const options: ReleaseConsumerOptions = {
    client: createGovernanceApiClient({ baseUrl: 'http://127.0.0.1', accessToken: secret, fetch: transport }),
    subscriptionId: id, expectedGovernanceObjectId: objectId, supportedProjections: [pair], now: () => time,
    state: { async load() { return structuredClone(state); }, async save(value) { state = structuredClone(value); } },
    async apply(snapshot, nextState) { callbacks.push(snapshot.snapshot.payload); state = structuredClone(nextState); },
  };
  return { artifact, event, options, transport, receiptBodies, callbacks,
    create: () => createReleaseConsumer(options), state: () => state, checkpoint: () => checkpoint,
    setCheckpoint: (value: string) => { checkpoint = value; },
    setState: (value: ReleaseConsumerState | null) => { state = value; },
    setLifecycle: (value: typeof lifecycle) => { lifecycle = value; },
    setMode: (value: typeof mode) => { mode = value; },
    wrongHeader: () => { wrongHeader = true; }, wrongId: () => { wrongId = true; },
    updateArtifact() { bytes = Buffer.from(JSON.stringify(artifact)); event.snapshotArtifactDigest = digest(bytes); },
    corruptBytes: () => { bytes = Buffer.from('{}'); },
  };
}
async function verified(h: ReturnType<typeof harness>, consumer = h.create()) {
  const event = await consumer.fetchExactRelease({ releaseId });
  return { consumer, value: consumer.verifySnapshot(await consumer.downloadSnapshot(event)) };
}

it.each(fixtures)('verifies frozen $projectionType@$schemaVersion through the generated client', async (f) => {
  const h = harness({ projectionType: f.projectionType, projectionSchemaVersion: f.schemaVersion } as ProjectionSupport);
  expect(await h.create().consume()).toEqual({ applied: 1, receiptsClosed: 1 });
  expect(h.callbacks).toHaveLength(1);
  expect(h.receiptBodies).toHaveLength(1);
  expect(h.checkpoint()).toBe('1');
  expect(h.state()?.appliedEvents[id]?.closure).toBe('CLOSED');
  expect(await h.create().resume()).toEqual({ applied: 0, receiptsClosed: 0 });
});
it.each([
  ['content digest', 'SNAPSHOT_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => h.corruptBytes()],
  ['HTTP digest', 'SNAPSHOT_DIGEST_HEADER_MISMATCH', (h: ReturnType<typeof harness>) => h.wrongHeader()],
  ['snapshot identity', 'IDENTITY_MISMATCH', (h: ReturnType<typeof harness>) => h.wrongId()],
  ['projection type', 'PROJECTION_TYPE_MISMATCH', (h: ReturnType<typeof harness>) => { h.event.projectionType = 'unknown'; }],
  ['projection version', 'PROJECTION_VERSION_MISMATCH', (h: ReturnType<typeof harness>) => { h.event.projectionSchemaVersion = '2'; }],
  ['canonical schema digest', 'SCHEMA_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => { h.event.projectionSchemaDigest = '0'.repeat(64); }],
  ['payload', 'PAYLOAD_INVALID', (h: ReturnType<typeof harness>) => { delete h.artifact.payload['departmentId']; h.updateArtifact(); }],
  ['payload digest', 'PAYLOAD_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => { h.event.projectionPayloadDigest = '0'.repeat(64); }],
  ['envelope', 'ENVELOPE_INVALID', (h: ReturnType<typeof harness>) => { h.artifact.release['releaseKind'] = 'wrong'; h.updateArtifact(); }],
  ['release identity', 'IDENTITY_MISMATCH', (h: ReturnType<typeof harness>) => { h.artifact.release['releaseNo'] = '2'; h.updateArtifact(); }],
  ['envelope digest', 'SCHEMA_DIGEST_MISMATCH', (h: ReturnType<typeof harness>) => { h.artifact.projectionContract['schemaDigest'] = '0'.repeat(64); h.updateArtifact(); }],
  ['subscription object', 'IDENTITY_MISMATCH', (h: ReturnType<typeof harness>) => { h.event.governanceObjectId = '20000000-0000-7000-8000-000000000001'; }],
] as const)('fails closed on %s', async (_name, code, change) => {
  const h = harness(); change(h);
  await expect(h.create().consume()).rejects.toMatchObject({ code });
  expect(h.callbacks).toHaveLength(0); expect(h.receiptBodies).toHaveLength(0);
  expect(h.state()).toBeNull(); expect(h.checkpoint()).toBe('0');
});
it('validates content digest before projection and payload failures', async () => {
  const h = harness(); h.corruptBytes(); h.event.projectionType = 'wrong';
  await expect(h.create().consume()).rejects.toMatchObject({ code: 'SNAPSHOT_DIGEST_MISMATCH' });
});
it.each(['SUSPENDED', 'REVOKED', 'ARCHIVED'] as const)('maps %s without retry or bypass', async (status) => {
  const h = harness(); h.setLifecycle(status);
  await expect(h.create().poll()).rejects.toMatchObject({ code: status });
  expect(h.transport).toHaveBeenCalledTimes(2);
  expect(h.receiptBodies).toHaveLength(0);
});
it.each(['CONSUMER_SUBSCRIPTION_FORBIDDEN', 'SNAPSHOT_NOT_AVAILABLE_TO_SUBSCRIPTION', 'CONSUMER_SUBSCRIPTION_NOT_FOUND',
  'CONSUMER_CHECKPOINT_GAP', 'CONSUMER_EVENT_NOT_AVAILABLE', 'CONSUMER_PROCESSING_DIGEST_MISMATCH'])('retains stable server error %s', async (code) => {
  const h = harness(); h.transport.mockResolvedValue(Response.json({ code, detail: secret }, { status: 403 }));
  await expect(h.create().poll()).rejects.toMatchObject({ code });
});
it('verified snapshot lost before apply is safely consumed on restart', async () => {
  const h = harness(); await verified(h);
  expect(h.state()).toBeNull(); expect(h.receiptBodies).toHaveLength(0);
  expect(await h.create().resume()).toEqual({ applied: 1, receiptsClosed: 1 });
});
it('callback failure neither receipts nor advances checkpoint and sanitizes the exception', async () => {
  const h = harness(); const consumer = createReleaseConsumer({ ...h.options, async apply() { throw new Error(secret); } });
  await expect(consumer.consume()).rejects.toMatchObject({ code: 'APPLY_FAILED' });
  expect(h.receiptBodies).toHaveLength(0); expect(h.checkpoint()).toBe('0');
  expect(await h.create().resume()).toEqual({ applied: 1, receiptsClosed: 1 });
});
it('rejects callback success without the required atomic pending marker', async () => {
  const h = harness(); const consumer = createReleaseConsumer({ ...h.options, async apply() {} });
  await expect(consumer.consume()).rejects.toMatchObject({ code: 'APPLY_NOT_DURABLE' });
  expect(h.receiptBodies).toHaveLength(0); expect(h.checkpoint()).toBe('0');
});
it.each(['before-receipt', 'after-receipt'] as const)('recovers %s interruption without destructive reapply', async (mode) => {
  const h = harness(); h.setMode(mode);
  await expect(h.create().consume()).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
  expect(h.state()?.appliedEvents[id]?.closure).toBe('APPLIED_PENDING_RECEIPT');
  h.setMode('normal');
  expect(await h.create().resume()).toEqual({ applied: 0, receiptsClosed: 1 });
  expect(h.callbacks).toHaveLength(1); expect(h.receiptBodies).toHaveLength(1);
});
it('recovers an ambiguous callback commit by reloading durable pending state', async () => {
  const h = harness(); const consumer = createReleaseConsumer({ ...h.options, async apply(value, next) {
    await h.options.apply(value, next); throw new Error(secret);
  } });
  await expect(consumer.consume()).rejects.toMatchObject({ code: 'APPLY_FAILED' });
  expect(h.receiptBodies).toHaveLength(0);
  expect(await h.create().resume()).toEqual({ applied: 0, receiptsClosed: 1 });
  expect(h.callbacks).toHaveLength(1);
});
it('uses server checkpoint after receipt exists and local state is absent', async () => {
  const h = harness(); await h.create().consume(); h.setState(null);
  expect(await h.create().resume()).toEqual({ applied: 0, receiptsClosed: 0 });
  expect(h.callbacks).toHaveLength(1);
  const { consumer, value } = await verified(h);
  expect(await consumer.ackApplied(await consumer.apply(value))).toBeNull();
  expect(h.callbacks).toHaveLength(1); expect(h.receiptBodies).toHaveLength(1);
});
it('receipt HTTP success alone cannot close state without checkpoint progression', async () => {
  const h = harness(); h.setMode('no-checkpoint');
  await expect(h.create().consume()).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_ADVANCED' });
  expect(h.state()?.appliedEvents[id]?.closure).toBe('APPLIED_PENDING_RECEIPT');
  h.setCheckpoint('1'); expect(await h.create().resume()).toEqual({ applied: 0, receiptsClosed: 1 });
});
it('submits processing without APPLIED and exposes exact-release primitives', async () => {
  const h = harness(); const consumer = h.create();
  const event = await consumer.fetchExactRelease({ eventId: id });
  const content = await consumer.downloadSnapshot(event);
  await consumer.submitProcessingReceipt(content, { receiveResult: 'ACCEPTED', validationResult: 'VALID' });
  expect(h.checkpoint()).toBe('0');
  await consumer.ackApplied(await consumer.apply(consumer.verifySnapshot(content)));
  expect(h.receiptBodies).toHaveLength(2); expect(h.checkpoint()).toBe('1');
});
it('runtime capabilities prevent forged or cross-consumer apply handles', async () => {
  const h = harness(); const { value } = await verified(h);
  await expect(h.create().apply(value)).rejects.toMatchObject({ code: 'UNVERIFIED_INPUT' });
  await expect(h.create().apply({} as VerifiedSnapshot)).rejects.toMatchObject({ code: 'UNVERIFIED_INPUT' });
  expect(h.callbacks).toHaveLength(0);
});
it('rejects concurrent application in one SDK instance', async () => {
  const h = harness(); const consumer = h.create(); const first = consumer.consume();
  await expect(consumer.consume()).rejects.toMatchObject({ code: 'CONCURRENT_CONSUMPTION' }); await first;
});
it('does not expose transport, callback, or server secrets in logs or exceptions', async () => {
  const h = harness(); h.transport.mockRejectedValue(new Error(secret));
  const spy = vi.spyOn(console, 'log');
  let caught: unknown;
  try { await h.create().consume(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ReleaseConsumerError);
  expect(String(caught) + JSON.stringify(caught) + JSON.stringify(spy.mock.calls)).not.toMatch(/postgres:\/\/|postgresql:\/\/|DATABASE_URL=|password|Bearer|patient-data/u);
  expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
});
it('validates state and event sequence before applying later releases', async () => {
  const h = harness(); await h.create().consume(); h.event.aggregateVersion = '3';
  h.event.eventId = '20000000-0000-7000-8000-000000000001'; h.artifact.release['releaseNo'] = '3'; h.updateArtifact();
  await expect(h.create().resume()).rejects.toMatchObject({ code: 'EVENT_GAP' });
  expect(h.callbacks).toHaveLength(1); expect(h.checkpoint()).toBe('1');
});
it('receipt HTTP denial retains the pending marker and stable receipt stage', async () => {
  const h = harness(); const implementation = h.transport.getMockImplementation()!;
  h.transport.mockImplementation((input, init) => (input instanceof Request && input.url.endsWith('/receipts'))
    ? Promise.resolve(Response.json({ code: 'CONSUMER_EVENT_NOT_AVAILABLE', detail: secret }, { status: 404 }))
    : implementation(input, init));
  await expect(h.create().consume()).rejects.toMatchObject({ code: 'CONSUMER_EVENT_NOT_AVAILABLE', stage: 'receipt' });
  expect(h.checkpoint()).toBe('0'); expect(h.state()?.appliedEvents[id]?.closure).toBe('APPLIED_PENDING_RECEIPT');
});
it('revalidates durable application evidence before sending APPLIED', async () => {
  const h = harness(); const { consumer, value } = await verified(h);
  const applied = await consumer.apply(value); h.setState(null);
  await expect(consumer.ackApplied(applied)).rejects.toMatchObject({ code: 'STATE_INVALID' });
  expect(h.receiptBodies).toHaveLength(0); expect(h.checkpoint()).toBe('0');
});
it('does not skip local closed events when the server checkpoint is inconsistent', async () => {
  const h = harness(); await h.create().consume(); h.setCheckpoint('0');
  await expect(h.create().resume()).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_ADVANCED' });
  expect(h.callbacks).toHaveLength(1);
});
it('does not receipt recovered state under an unsupported projection declaration', async () => {
  const h = harness(); h.setMode('before-receipt');
  await expect(h.create().consume()).rejects.toMatchObject({ code: 'TRANSPORT_FAILED' });
  const changed = createReleaseConsumer({ ...h.options,
    supportedProjections: [{ projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '1' }] });
  await expect(changed.resume()).rejects.toMatchObject({ code: 'PROJECTION_TYPE_MISMATCH' });
  expect(h.receiptBodies).toHaveLength(0); expect(h.checkpoint()).toBe('0');
});
it('treats an untyped callback failure return as failure even with a durable marker', async () => {
  const h = harness(); const apply = h.options.apply;
  Reflect.set(h.options, 'apply', async (...args: Parameters<typeof apply>) => { await apply(...args); return false; });
  await expect(h.create().consume()).rejects.toMatchObject({ code: 'APPLY_FAILED' });
  expect(h.receiptBodies).toHaveLength(0); expect(h.checkpoint()).toBe('0');
});
