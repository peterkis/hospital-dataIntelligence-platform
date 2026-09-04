import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import { parseReplayArguments, replayFailure } from './consumer-replay-command.js';
import { openSyntheticReplayAdapter } from './consumer-replay-store.js';

const id = '10000000-0000-7000-8000-000000000001';
const args = ['--subscription-id', id, '--release-id', id];
test('CLI defaults safely to dry-run and rejects ambiguous or unbounded commands', () => {
  assert.equal(parseReplayArguments(args).mode, 'DRY_RUN');
  for (const extra of [['--force'], ['--apply'], ['--apply', '--dry-run'], ['--release-id', id], ['--all']]) {
    assert.throws(() => parseReplayArguments([...args, ...extra]), { message: 'REPLAY_ARGUMENT_INVALID' });
  }
  assert.equal(parseReplayArguments([...args, '--apply', '--operation-id', id, '--reason', 'Synthetic repair']).mode, 'APPLY');
});

test('CLI never reflects argument, configuration, driver or callback secrets', async () => {
  const secret = 'Bearer private-secret password=private postgres://private';
  assert.deepEqual(replayFailure(new Error(secret)), { status: 'FAILED', eligible: false, errorCode: 'REPLAY_FAILED' });
  const result = await child(['--force', secret], {});
  assert.equal(result.exitCode, 1);
  assert.deepEqual(JSON.parse(result.output), { status: 'FAILED', eligible: false, errorCode: 'REPLAY_ARGUMENT_INVALID' });
  assert.equal(result.errors, ''); assert.equal(result.output.includes(secret), false);
});

test('synthetic store excludes simultaneous writers and survives reopen without changing ordinary checkpoint', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hdi-replay-store-'));
  const path = join(directory, 'state.json');
  try {
    const first = await openSyntheticReplayAdapter(path, id);
    try {
      assert.equal(await first.adapter.load(id), null);
      await assert.rejects(openSyntheticReplayAdapter(path, id), { message: 'REPLAY_LOCKED' });
    } finally { await first.close(); }
    const second = await openSyntheticReplayAdapter(path, id);
    await second.close(); assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true }); }
});

test('real CLI processes reject corrupted artifacts and recover durable state after a lost receipt response', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hdi-replay-cli-'));
  const statePath = join(directory, 'state.json');
  const fixtures = JSON.parse(readFileSync(new URL('./fixtures/department-consumer-baseline.json', import.meta.url), 'utf8')).contracts;
  const fixture = fixtures.find((f: { projectionType: string }) => f.projectionType === 'hdi.department-master');
  const artifact = JSON.parse(fixture.artifactUtf8);
  const releaseId = artifact.release.releaseId as string;
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  let corrupt = true; let dropResponse = true; let receiptCount = 0;
  const digest = fixture.artifactDigest as string;
  const metadata = { subscriptionId: id, servicePrincipalId: id, lifecycleStatus: 'ACTIVE',
    subscriptionVersion: { subscriptionVersionId: id, versionNo: '1', projectionType: 'hdi.department-master', projectionSchemaVersion: '1', projectionSchemaDigest: fixture.schemaDigest },
    event: { eventId: id, governanceObjectId: artifact.release.governanceObjectId, releaseId, snapshotId: id, aggregateVersion: '1',
      projectionType: 'hdi.department-master', projectionSchemaVersion: '1', projectionSchemaDigest: fixture.schemaDigest,
      snapshotArtifactDigest: digest, projectionPayloadDigest: hash(canonicalize(artifact.payload)) },
    checkpoint: { appliedAggregateVersion: '0', recordedAt: null }, latestReceipt: null,
    appliedReceipt: null as null | { receiptId: string; receiptSequence: string; receiveResult: string; validationResult: string; applyResult: string; processingDigest: string },
    processingDigestMismatch: false };
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/replay-context')) { response.end(JSON.stringify(metadata)); return; }
    if (request.url?.includes('/content')) {
      response.setHeader('x-snapshot-id', id); response.setHeader('digest', `sha-256=:${Buffer.from(digest, 'hex').toString('base64')}:`);
      response.end(corrupt ? '{}' : fixture.artifactUtf8); return;
    }
    if (request.url?.endsWith('/receipts')) {
      request.resume();
      if (!metadata.appliedReceipt) { receiptCount++; metadata.appliedReceipt = { receiptId: id, receiptSequence: '1',
        receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED', processingDigest: digest }; }
      metadata.checkpoint.appliedAggregateVersion = '1';
      if (dropResponse) { dropResponse = false; response.statusCode = 503; response.end(JSON.stringify({ private: 'Bearer private-secret password postgres://hidden' })); }
      else { response.statusCode = 201; response.end(JSON.stringify({ receiptId: id, receiptSequence: '1' })); }
      return;
    }
    response.statusCode = 404; response.end('{}');
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); assert.ok(address && typeof address === 'object');
    const env = { HDI_REPLAY_BASE_URL: `http://127.0.0.1:${address.port}`, HDI_REPLAY_ACCESS_TOKEN: 'private-secret', HDI_REPLAY_STATE_PATH: statePath };
    const command = ['--subscription-id', id, '--release-id', releaseId];
    const rejected = await child(command, env);
    assert.equal(rejected.exitCode, 1); assert.equal(JSON.parse(rejected.output).errorCode, 'SNAPSHOT_DIGEST_MISMATCH');
    assert.deepEqual(await readdir(directory), []); assert.equal(receiptCount, 0);
    corrupt = false;
    const dry = await child(command, env); assert.equal(dry.exitCode, 0); assert.deepEqual(await readdir(directory), []);
    const apply = [...command, '--apply', '--operation-id', id, '--reason', 'Synthetic repair'];
    const interrupted = await child(apply, env);
    assert.equal(interrupted.exitCode, 1); assert.equal(JSON.parse(interrupted.output).errorCode, 'HTTP_FAILED');
    assert.equal((await readState()).replays[id].closure, 'APPLIED_PENDING_RECEIPT');
    const restarted = await child(apply, env);
    assert.equal(restarted.exitCode, 0); assert.equal(JSON.parse(restarted.output).businessApplied, false);
    assert.equal((await readState()).replayApplyCount, 1); assert.equal(receiptCount, 1);
    assert.equal((await readState()).replays[id].closure, 'CLOSED');
    for (const result of [rejected, dry, interrupted, restarted]) {
      assert.equal(result.errors, ''); assert.doesNotMatch(result.output, /private-secret|password|postgres:\/\/|Bearer|"payload"/iu);
    }
    assert.deepEqual(await readdir(directory), ['state.json']);
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true });
  }
  async function readState() { return JSON.parse(await readFile(statePath, 'utf8')); }
});

async function child(args: string[], env: NodeJS.ProcessEnv) {
  const process = spawn(globalThis.process.execPath, ['--import', 'tsx', 'tooling/prototype/consumer-replay.ts', ...args], {
    cwd: new URL('../..', import.meta.url), windowsHide: true, env: { ...globalThis.process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; let errors = '';
  process.stdout.setEncoding('utf8').on('data', (value: string) => { output += value; });
  process.stderr.setEncoding('utf8').on('data', (value: string) => { errors += value; });
  const exitCode = await new Promise<number | null>((resolve, reject) => { process.once('close', resolve); process.once('error', reject); });
  return { output, errors, exitCode };
}
