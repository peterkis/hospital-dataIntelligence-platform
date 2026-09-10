import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

assert.ok(process.env.ASSIGNMENT_TRANSFER_RECOVERY_RECEIPT && process.env.DATABASE_URL, 'C0302_NEGATIVE_RECOVERY_INPUT_REQUIRED');
const endpoint = new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434');
assert.equal(endpoint.pathname, '/hdi_prototype');
const original = await readFile(process.env.ASSIGNMENT_TRANSFER_RECOVERY_RECEIPT);
const valid = JSON.parse(original.toString());
const directory = `.runtime/pv006-c0302/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const cases = [];
const changedValue = changes => ({ ...valid, transfers: valid.transfers.map((item, index) => index ? item : { ...item, value: { ...item.value, ...changes } }) });
try {
  const before = await counts();
  for (const [name, receipt, expected] of [
    ['missing', null, 'C0302_RECOVERY_RECEIPT_REQUIRED'],
    ['wrong-task', { ...valid, task: 'PV-006-C-03-01' }, 'C0302_RECEIPT_TASK_INVALID'],
    ['wrong-run-id', { ...valid, runId: randomUUID() }, 'C0302_RECEIPT_RUN_ID_INVALID'],
    ['wrong-mode', { ...valid, mode: 'APPLICATION' }, 'C0302_RECEIPT_MODE_INVALID'],
    ['wrong-database', { ...valid, identity: { ...valid.identity, database: 'different_database' } }, 'C0302_RECEIPT_DATABASE_INVALID'],
    ['wrong-oid', { ...valid, identity: { ...valid.identity, oid: '0' } }, 'C0302_RECEIPT_OID_INVALID'],
    ['wrong-endpoint', { ...valid, identity: { ...valid.identity, address: 'different.invalid' } }, 'C0302_RECEIPT_ADDRESS_INVALID'],
    ['wrong-port', { ...valid, identity: { ...valid.identity, port: 1 } }, 'C0302_RECEIPT_PORT_INVALID'],
    ['wrong-source', changedValue({ sourceAssignmentId: randomUUID() }), 'C0302_SOURCE_REF_INVALID'],
    ['wrong-target', changedValue({ targetAssignmentId: randomUUID() }), 'C0302_TARGET_REF_INVALID'],
    ['wrong-transfer', changedValue({ transferId: randomUUID() }), 'C0302_TRANSFER_REFS_INVALID'],
    ['wrong-source-version', changedValue({ sourcePreviousVersionId: randomUUID() }), 'C0302_SOURCE_VERSION_REF_INVALID'],
    ['wrong-target-version', changedValue({ targetAdmissionVersionId: randomUUID() }), 'C0302_TARGET_VERSION_REF_INVALID'],
    ['wrong-closure-version', changedValue({ sourceClosureVersionId: randomUUID() }), 'C0302_CLOSURE_REF_INVALID'],
  ]) {
    const env = { ...process.env };
    if (receipt === null) delete env.ASSIGNMENT_TRANSFER_RECOVERY_RECEIPT;
    else {
      const path = `${directory}/${name}.json`;
      await writeFile(path, JSON.stringify(receipt, null, 2), { flag: 'wx' });
      env.ASSIGNMENT_TRANSFER_RECOVERY_RECEIPT = path;
    }
    const argv = ['--import', 'tsx', 'tooling/prototype/person-assignment-transfer-recovery-probe.ts', '--recover'];
    const result = spawnSync(process.execPath, argv, { cwd: process.cwd(), encoding: 'utf8', env, windowsHide: true });
    assert.equal(result.status, 1);
    const outcome = result.stdout.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
      .find(row => row.task === 'PV-006-C-03-02' && row.mode === 'RECOVERY');
    assert.equal(outcome?.status, 'FAILED'); assert.equal(outcome?.poolClosed, true); assert.ok(outcome.error.includes(expected));
    assert.deepEqual(await counts(), before, 'C0302_RECOVERY_NEGATIVE_CREATED_COHORT');
    cases.push({ name, argv, cwd: process.cwd(), exitCode: result.status, outcome });
  }
  assert.deepEqual(await readFile(process.env.ASSIGNMENT_TRANSFER_RECOVERY_RECEIPT), original, 'C0302_RECEIPT_OVERWRITTEN');
  await writeFile(`${directory}/negative-recovery.json`, JSON.stringify({ task: 'PV-006-C-03-02', status: 'PASS',
    cases, before, after: await counts(), originalReceiptSha256: createHash('sha256').update(original).digest('hex') }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-03-02', mode: 'NEGATIVE_RECOVERY', status: 'PASS', caseCount: cases.length,
    cohortAndVersionCountsUnchanged: true, originalReceiptUnchanged: true, evidenceDirectory: directory }));
} catch (error) {
  process.exitCode = 1;
  const message = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : 'NEGATIVE_RECOVERY_FAILED';
  await writeFile(`${directory}/negative-recovery-failed.json`, JSON.stringify({ task: 'PV-006-C-03-02', status: 'FAILED', cases, message }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-03-02', status: 'FAILED', message, directory }));
} finally { await pool.end(); }
async function counts() {
  return (await pool.query(`select
    (select count(*)::int from person_master.person_subject) as persons,
    (select count(*)::int from person_master.engagement) as engagements,
    (select count(*)::int from person_master.assignment) as assignments,
    (select count(*)::int from person_master.assignment_version) as assignment_versions,
    (select count(*)::int from person_master.assignment_closure_evidence) as closure_evidence,
    (select count(*)::int from person_master.assignment_transfer) as transfers,
    (select count(*)::int from person_master.assignment_validation_segment) as segments,
    (select count(*)::int from person_master.assignment_command_outcome) as outcomes,
    (select count(*)::int from person_master.assignment_semantic_term) as terms,
    (select count(*)::int from person_master.assignment_semantic_term_version) as definitions,
    (select count(*)::int from person_master.assignment_version_semantics) as semantics,
    (select count(*)::int from department_master.department) as departments,
    (select count(*)::int from audit.audit_event) as audits`)).rows[0];
}
