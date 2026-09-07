import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

assert.ok(process.env.ASSIGNMENT_SEMANTIC_RECOVERY_RECEIPT && process.env.DATABASE_URL, 'C02_NEGATIVE_RECOVERY_INPUT_REQUIRED');
const endpoint = new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434');
assert.equal(endpoint.pathname, '/hdi_prototype');
const original = await readFile(process.env.ASSIGNMENT_SEMANTIC_RECOVERY_RECEIPT);
const valid = JSON.parse(original.toString());
const directory = `.runtime/pv006-c02/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const cases = [];
try {
  const before = await counts();
  for (const [name, receipt, expected] of [
    ['missing', null, 'C02_RECOVERY_RECEIPT_REQUIRED'],
    ['wrong-mode', { ...valid, mode: 'APPLICATION' }, 'C02_RECEIPT_MODE_INVALID'],
    ['wrong-database', { ...valid, identity: { ...valid.identity, database: 'different_database' } }, 'C02_RECEIPT_DATABASE_INVALID'],
    ['wrong-oid', { ...valid, identity: { ...valid.identity, oid: '0' } }, 'C02_RECEIPT_OID_INVALID'],
    ['wrong-endpoint', { ...valid, identity: { ...valid.identity, address: 'different.invalid' } }, 'C02_RECEIPT_ENDPOINT_INVALID'],
  ]) {
    const env = { ...process.env };
    if (receipt === null) delete env.ASSIGNMENT_SEMANTIC_RECOVERY_RECEIPT;
    else {
      const path = `${directory}/${name}.json`;
      await writeFile(path, JSON.stringify(receipt, null, 2), { flag: 'wx' });
      env.ASSIGNMENT_SEMANTIC_RECOVERY_RECEIPT = path;
    }
    const argv = ['--import', 'tsx', 'tooling/prototype/person-assignment-semantics-recovery-probe.ts', '--recover'];
    const result = spawnSync(process.execPath, argv, { cwd: process.cwd(), encoding: 'utf8', env, windowsHide: true });
    assert.equal(result.status, 1);
    const outcome = result.stdout.split(/\r?\n/u).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } })
      .find(row => row.task === 'PV-006-C-02' && row.mode === 'RECOVERY');
    assert.equal(outcome?.status, 'FAILED'); assert.equal(outcome?.poolClosed, true); assert.ok(outcome.error.includes(expected));
    assert.deepEqual(await counts(), before, 'C02_RECOVERY_NEGATIVE_CREATED_COHORT');
    cases.push({ name, argv, cwd: process.cwd(), exitCode: result.status, outcome });
  }
  assert.deepEqual(await readFile(process.env.ASSIGNMENT_SEMANTIC_RECOVERY_RECEIPT), original, 'C02_RECEIPT_OVERWRITTEN');
  await writeFile(`${directory}/negative-recovery.json`, JSON.stringify({ task: 'PV-006-C-02', status: 'PASSED',
    cases, before, after: await counts(), originalReceiptSha256: createHash('sha256').update(original).digest('hex') }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-02', mode: 'NEGATIVE_RECOVERY', status: 'PASSED', caseCount: cases.length,
    cohortAndVersionCountsUnchanged: true, originalReceiptUnchanged: true, evidenceDirectory: directory }));
} finally { await pool.end(); }
async function counts() {
  return (await pool.query(`select
    (select count(*)::int from person_master.person_subject) as persons,
    (select count(*)::int from person_master.engagement) as engagements,
    (select count(*)::int from person_master.assignment) as assignments,
    (select count(*)::int from person_master.assignment_version) as assignment_versions,
    (select count(*)::int from person_master.assignment_validation_segment) as segments,
    (select count(*)::int from person_master.assignment_command_outcome) as outcomes,
    (select count(*)::int from person_master.assignment_semantic_term) as terms,
    (select count(*)::int from person_master.assignment_semantic_term_version) as definitions,
    (select count(*)::int from person_master.assignment_version_semantics) as semantics,
    (select count(*)::int from department_master.department) as departments,
    (select count(*)::int from audit.audit_event) as audits`)).rows[0];
}
