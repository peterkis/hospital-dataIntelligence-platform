import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentEffectivePeriodApplication } from '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';
import type { AssignmentEffectivePeriodQuery, AssignmentEffectivePeriodContext } from '../../apps/governance-api/src/modules/person-master/index.js';
import { temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';

assert.ok(process.argv.length === 5 && process.argv[2] === '--recover', 'C05_RECOVERY_FIXED_MODE_REQUIRED');
const receiptPath = resolve(process.argv[3]!), expectedRunId = process.argv[4]!;
assert.match(expectedRunId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u, 'C05_RECOVERY_RUN_INVALID');
const original = await readFile(receiptPath), receipt = JSON.parse(original.toString('utf8'));
const binding = JSON.parse(await readFile(`.runtime/pv006-c05/${expectedRunId}/recovery-binding.json`, 'utf8'));
assert.equal(binding.task, 'PV-006-C-05'); assert.equal(binding.runId, expectedRunId);
assert.equal(createHash('sha256').update(original).digest('hex'), binding.receiptSha256, 'C05_RECOVERY_RECEIPT_BINDING_INVALID');
assert.equal(receipt.task, 'PV-006-C-05', 'C05_RECOVERY_TASK_INVALID');
assert.equal(receipt.mode, 'RECOVERY', 'C05_RECOVERY_MODE_INVALID');
assert.equal(receipt.runId, expectedRunId, 'C05_RECOVERY_RUN_INVALID');
assert.match(receipt.actor, /^[a-f0-9-]{36}$/u, 'C05_RECOVERY_ACTOR_INVALID');
assert.ok(Array.isArray(receipt.requests) && receipt.requests.length > 0 && receipt.requests.length <= 256, 'C05_RECOVERY_REQUESTS_INVALID');
assert.equal(createHash('sha256').update(JSON.stringify(receipt.requests)).digest('hex'), receipt.inputHash, 'C05_RECOVERY_INPUT_HASH_INVALID');
for (const request of receipt.requests) {
  assert.equal(request.actor, receipt.actor, 'C05_RECOVERY_ACTOR_BINDING_INVALID');
  assert.equal(request.query.assignmentId, request.result.assignmentId, 'C05_RECOVERY_ASSIGNMENT_BINDING_INVALID');
  assert.ok(receipt.hashes.some((item: { id: string }) => item.id === request.query.assignmentId), 'C05_RECOVERY_COHORT_BINDING_INVALID');
}
for (const item of receipt.source) {
  assert.ok(typeof item.path === 'string' && /^(apps\/governance-api\/src\/|tooling\/prototype\/|db\/migrations\/|package(?:-lock)?\.json$)/u.test(item.path)
    && !item.path.includes('..'), 'C05_RECOVERY_SOURCE_PATH_INVALID');
  assert.equal(createHash('sha256').update(await readFile(item.path)).digest('hex'), item.sha256, 'C05_RECOVERY_SOURCE_HASH_INVALID');
}
assert.ok(process.env['DATABASE_URL'], 'C05_MANAGED_DATABASE_REQUIRED');
const endpoint = new URL(process.env['DATABASE_URL']);
assert.deepEqual({ host: endpoint.hostname, port: endpoint.port, role: decodeURIComponent(endpoint.username) }, receipt.endpoint, 'C05_RECOVERY_ENDPOINT_INVALID');
assert.equal(decodeURIComponent(endpoint.pathname.slice(1)), receipt.identity.database, 'C05_RECOVERY_DATABASE_INVALID');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 4, application_name: 'hdi-pv006-c05-recovery' });
const directory = `.runtime/pv006-c05/${randomUUID()}`;
await mkdir(directory, { recursive: false });
let status = 'FAILED', error: string | undefined, readCount = 0;
try {
  const identity = (await sql<{ database: string; oid: string; role: string }>`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid,current_user as role`.execute(handle.database)).rows[0]!;
  assert.deepEqual(identity, receipt.identity, 'C05_RECOVERY_DATABASE_IDENTITY_INVALID');
  const actor = await handle.database.selectFrom('platform.security_principal').select(['principal_kind','status'])
    .where('security_principal_id', '=', receipt.actor).executeTakeFirst();
  assert.deepEqual(actor, { principal_kind: 'PERSON', status: 'ACTIVE' }, 'C05_RECOVERY_ACTOR_NOT_ACTIVE');
  for (const item of receipt.hashes) assert.deepEqual(await temporarySourceSnapshot(handle.database, item.id), item.rows, 'C05_RECOVERY_ORIGINAL_ROWS_CHANGED');
  for (const request of receipt.requests as { query: AssignmentEffectivePeriodQuery; result: AssignmentEffectivePeriodContext; actor: string }[]) {
    const id = randomUUID();
    const app = createAssignmentEffectivePeriodApplication(handle.database, { actorPrincipalId: receipt.actor, requestId: id,
      correlationId: id, occurredAt: '2026-09-09T00:00:00' });
    const value = await app.getAssignmentEffectivePeriodAsOf(request.query);
    assert.deepEqual(value, request.result, 'C05_RECOVERY_WINDOW_RESULT_CHANGED'); readCount++;
  }
  for (const item of receipt.hashes) assert.deepEqual(await temporarySourceSnapshot(handle.database, item.id), item.rows);
  assert.deepEqual(await readFile(receiptPath), original, 'C05_RECOVERY_RECEIPT_CHANGED'); status = 'PASS';
} catch (failure) { error = failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : 'UNKNOWN'; process.exitCode = 1; }
finally {
  await handle.close();
  await writeFile(`${directory}/recovery-result.json`, JSON.stringify({ task: 'PV-006-C-05', mode: 'RECOVER_ONLY', status, error,
    originalReceipt: receiptPath, originalSha256: createHash('sha256').update(original).digest('hex'), readCount,
    poolClosed: true, cohortCreated: false, cwd: process.cwd(), argv: process.argv.slice(1) }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-05', status, error, readCount, directory, cohortCreated: false }));
}
