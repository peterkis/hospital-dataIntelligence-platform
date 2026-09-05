import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

const source = process.env.PERSON_ENGAGEMENT_TEMPORAL_RECEIPT;
if (!source || !process.env.DATABASE_URL) throw new Error('B04_NEGATIVE_RECOVERY_INPUT_REQUIRED');
const valid = JSON.parse(await readFile(source, 'utf8'));
const directory = `.runtime/pv006-b04/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const cases = [];
try {
  const before = await counts();
  for (const [name, receipt] of [
    ['missing', null], ['wrong-mode', { ...valid, mode: 'APPLICATION' }],
    ['wrong-database', { ...valid, database: `${valid.database}_wrong` }],
    ['wrong-oid', { ...valid, databaseOid: '0' }],
    ['wrong-endpoint', { ...valid, endpoint: { ...valid.endpoint, host: 'different.invalid' } }],
  ]) {
    const env = { ...process.env };
    if (receipt === null) delete env.PERSON_ENGAGEMENT_TEMPORAL_RECEIPT;
    else {
      const path = `${directory}/${name}.json`;
      await writeFile(path, JSON.stringify(receipt, null, 2), { flag: 'wx' });
      env.PERSON_ENGAGEMENT_TEMPORAL_RECEIPT = path;
    }
    const argv = ['--import', 'tsx', 'tooling/prototype/person-engagement-temporal-application-probe.ts', '--recover'];
    const run = spawnSync(process.execPath, argv, { encoding: 'utf8', env, windowsHide: true });
    assert.equal(run.status, 1);
    const outcome = run.stdout.trim().split(/\r?\n/).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).find(row => row?.task === 'PV-006-B-04');
    assert.equal(outcome?.mode, 'RECOVERY'); assert.equal(outcome?.status, 'FAILED');
    assert.equal(outcome?.poolClosed, true);
    assert.deepEqual(await counts(), before);
    cases.push({ name, argv, exitCode: run.status, outcome });
  }
  await writeFile(`${directory}/negative-recovery.json`, JSON.stringify({ status: 'PASSED', cases,
    cohortAndVersionCountsUnchanged: true }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-B-04', mode: 'NEGATIVE_RECOVERY', status: 'PASSED',
    caseCount: cases.length, cohortAndVersionCountsUnchanged: true, evidenceDirectory: directory }));
} finally { await pool.end(); }

async function counts() {
  return (await pool.query(`select
    (select count(*)::int from person_master.person_subject) as persons,
    (select count(*)::int from person_master.engagement) as engagements,
    (select count(*)::int from person_master.engagement_version) as versions,
    (select count(*)::int from person_master.engagement_type) as types,
    (select count(*)::int from person_master.engagement_overlap_rule_version) as rules`)).rows[0];
}
