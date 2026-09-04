import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runSimulatedConsumerOnce } from './consumer.js';

let directory: string;
let statePath: string;
const id = '10000000-0000-7000-8000-000000000001';
const localTime = '2026-09-04T10:00:00';
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hdi-sim-consumer-test-'));
  statePath = join(directory, 'state.json');
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(statePath, { force: true });
  await rm(`${statePath}.tmp`, { force: true });
  await rmdir(directory);
});

function fixture() {
  return {
    envelopeContractVersion: 'phase-01.v1',
    release: { aggregateType: 'DEPARTMENT_MASTER', governanceObjectId: id, releaseId: id, releaseNo: '1',
      releaseKind: 'NORMAL', businessValidFrom: localTime, businessValidTo: null },
    projectionContract: { projectionType: 'hdi.department-master', schemaVersion: '1', schemaDigestAlgorithm: 'SHA-256', schemaDigest: 'a'.repeat(64) },
    serializationProfileVersion: 'canonical-json.v1', payload: { synthetic: true },
  };
}
function server(artifact: unknown, options?: { wrongHeader?: boolean; failReceipt?: boolean }) {
  const bytes = Buffer.from(JSON.stringify(artifact));
  const digest = createHash('sha256').update(bytes).digest();
  let receipts = 0;
  let downloads = 0;
  let offered = false;
  vi.stubGlobal('fetch', vi.fn(async (input: Request) => {
    if (input.url.includes('/events')) {
      const events = offered ? [] : [{ eventId: id, governanceObjectId: id, aggregateVersion: '1',
        releaseId: id, snapshotId: id, projectionType: 'hdi.department-master', projectionSchemaVersion: '1',
        projectionSchemaDigest: 'a'.repeat(64), projectionPayloadDigest: 'b'.repeat(64), snapshotArtifactDigest: digest.toString('hex') }];
      offered = true;
      return Response.json({ events });
    }
    if (input.url.includes('/snapshots/')) {
      downloads += 1;
      return new Response(bytes, { headers: { digest: options?.wrongHeader ? 'invalid' : `sha-256=:${digest.toString('base64')}:` } });
    }
    receipts += 1;
    return options?.failReceipt ? Response.json({ code: 'SYNTHETIC_RETRY' }, { status: 503 })
      : Response.json({ receiptId: id, receiptSequence: '1' }, { status: 201 });
  }));
  return { receipts: () => receipts, downloads: () => downloads };
}
function consume(expectedProjectionType = 'hdi.department-master', expectedProjectionSchemaVersion = '1') {
  return runSimulatedConsumerOnce({ baseUrl: 'http://127.0.0.1', accessToken: 'synthetic-test-only', subscriptionId: id,
    statePath, expectedProjectionType, expectedProjectionSchemaVersion, now: () => localTime });
}

it('applies and closes a validated snapshot once', async () => {
  const mock = server(fixture());
  expect(await consume()).toEqual({ applied: 1, receiptsClosed: 1 });
  expect(await consume()).toEqual({ applied: 0, receiptsClosed: 0 });
  expect(mock.receipts()).toBe(1);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  expect(state.appliedAggregateVersion).toBe('1');
  expect(state.appliedEvents[id].closure).toBe('CLOSED');
});
it('retains atomic pending state and closes its receipt on retry', async () => {
  server(fixture(), { failReceipt: true });
  await expect(consume()).rejects.toThrow('SIM_CONSUMER_RECEIPT_FAILED');
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  expect(state.appliedEvents[id].closure).toBe('APPLIED_PENDING_RECEIPT');
  const mock = server(fixture());
  // The retry response repeats the original event; CLOSED local state prevents reapplication.
  // Return only newer events, as the real endpoint does for the persisted checkpoint.
  const fetchMock = vi.mocked(globalThis.fetch);
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input, init) => (input as Request).url.includes('/events')
    ? Promise.resolve(Response.json({ events: [] })) : original(input, init));
  expect(await consume()).toEqual({ applied: 0, receiptsClosed: 1 });
  expect(mock.downloads()).toBe(0);
});
it.each([
  ['envelopeContractVersion', 'unknown'], ['serializationProfileVersion', 'unknown'],
  ['release', null], ['projectionContract', null],
])('rejects malformed %s before persisting or receipting', async (field, value) => {
  const mock = server({ ...fixture(), [field]: value });
  await expect(consume()).rejects.toThrow('SIM_CONSUMER_SNAPSHOT_SCHEMA_INVALID');
  await expect(readFile(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(mock.receipts()).toBe(0);
});
it('requires payload presence', async () => {
  const { payload: _payload, ...artifact } = fixture();
  server(artifact);
  await expect(consume()).rejects.toThrow('SIM_CONSUMER_SNAPSHOT_SCHEMA_INVALID');
});
it.each(['aggregateType', 'governanceObjectId', 'releaseId', 'releaseNo', 'releaseKind', 'businessValidFrom'])(
  'rejects inconsistent release %s', async (field) => {
    const artifact = fixture();
    server({ ...artifact, release: { ...artifact.release, [field]: 'invalid' } });
    await expect(consume()).rejects.toThrow('SIM_CONSUMER_SNAPSHOT_CONTRACT_MISMATCH');
  });
it.each(['projectionType', 'schemaVersion', 'schemaDigestAlgorithm', 'schemaDigest'])(
  'rejects inconsistent projection %s', async (field) => {
    const artifact = fixture();
    server({ ...artifact, projectionContract: { ...artifact.projectionContract, [field]: 'invalid' } });
    await expect(consume()).rejects.toThrow('SIM_CONSUMER_SNAPSHOT_CONTRACT_MISMATCH');
  });
it('rejects an incorrect Digest header', async () => {
  server(fixture(), { wrongHeader: true });
  await expect(consume()).rejects.toThrow('SIM_CONSUMER_SNAPSHOT_DIGEST_HEADER_MISMATCH');
});
it.each([['hdi.department-hierarchy', '1'], ['hdi.department-master', '2']])(
  'enforces expected projection %s @ %s before downloading', async (type, version) => {
    const mock = server(fixture());
    await expect(consume(type, version)).rejects.toThrow('SIM_CONSUMER_PROJECTION_CONTRACT_MISMATCH');
    expect(mock.downloads()).toBe(0);
    expect(mock.receipts()).toBe(0);
  });
