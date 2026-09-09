import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

assert.equal(process.argv.length, 3, 'C05_NEGATIVE_RECEIPT_REQUIRED');
const original = await readFile(process.argv[2]), receipt = JSON.parse(original.toString('utf8'));
assert.equal(receipt.task, 'PV-006-C-05'); assert.equal(receipt.mode, 'RECOVERY');
const directory = `.runtime/pv006-c05/${randomUUID()}`; await mkdir(directory, { recursive: false });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const counts = async () => (await pool.query(`select
  (select count(*)::text from person_master.assignment) as assignments,
  (select count(*)::text from person_master.assignment_version) as versions,
  (select count(*)::text from person_master.assignment_command_outcome) as outcomes,
  (select count(*)::text from audit.audit_event) as audits`)).rows[0];
const cases = [];
try {
  const before = await counts();
  const variants = [
    ['task', { ...receipt, task: 'PV-006-C-04' }], ['mode', { ...receipt, mode: 'APPLICATION' }],
    ['database', { ...receipt, identity: { ...receipt.identity, database: 'unowned' } }],
    ['oid', { ...receipt, identity: { ...receipt.identity, oid: '0' } }],
    ['actor', { ...receipt, actor: randomUUID() }], ['hash', { ...receipt, inputHash: '0'.repeat(64) }],
    ['endpoint', { ...receipt, endpoint: { ...receipt.endpoint, port: '1' } }],
    ['run', { ...receipt, runId: randomUUID() }],
    ['source-hash', { ...receipt, source: receipt.source.map((v,i) => i ? v : { ...v, sha256: '0'.repeat(64) }) }],
  ];
  for (const [label, wrong] of variants) {
    const path = `${directory}/${label}.json`; await writeFile(path, JSON.stringify(wrong), { flag: 'wx' });
    const argv = ['--import','tsx','tooling/prototype/person-assignment-effective-recovery-probe.ts','--recover',path,receipt.runId];
    const startedAt = new Date().toISOString();
    const child = spawnSync(process.execPath, argv, { env: process.env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(child.status, 1, `C05_BAD_RECEIPT_ACCEPTED:${label}`);
    const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`.replace(/postgres(?:ql)?:\/\/\S+/gu,'[DATABASE_URL]');
    await writeFile(`${directory}/${label}.log`, output, { flag: 'wx' });
    assert.deepEqual(await counts(), before, 'C05_BAD_RECOVERY_WROTE_FACTS');
    cases.push({ label, argv, startedAt, finishedAt: new Date().toISOString(), exit: child.status, countsUnchanged: true });
  }
  assert.deepEqual(await readFile(process.argv[2]), original);
  await writeFile(`${directory}/negative-recovery.json`, JSON.stringify({ task: 'PV-006-C-05', status: 'PASS', cases, before,
    originalSha256: createHash('sha256').update(original).digest('hex') }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-05', status: 'PASS', cases: cases.length, directory }));
} finally { await pool.end(); }
