import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import pg from 'pg';

assert.ok(process.argv.length === 2 && process.env.DATABASE_URL && process.env.npm_execpath, 'C05_MANAGED_VALIDATION_REQUIRED');
const endpoint = new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434'); assert.equal(endpoint.pathname, '/hdi_prototype');
const directory = `.runtime/pv006-c05/${randomUUID()}`; await mkdir(directory, { recursive: false });
const commands = [], startedAt = new Date().toISOString();
const environment = { ...process.env, npm_config_offline: 'true', REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true',
  npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1' };
const auditPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'hdi-pv006-c05-preservation' });
let status = 'IN_PROGRESS', error, retainedRunId, auditPoolClosed = false;
async function auditRows(cutoff) {
  return (await auditPool.query(`select count(*)::text as count,
    encode(digest(coalesce(string_agg(to_jsonb(t)::text,'' order by audit_event_id),''),'sha256'),'hex') as digest
    from audit.audit_event t where created_at <= $1::timestamp`, [cutoff])).rows[0];
}
try {
  const cutoff = (await auditPool.query(`select to_char(platform.local_now(),'YYYY-MM-DD"T"HH24:MI:SS.US') as cutoff`)).rows[0].cutoff;
  const originalAudit = await auditRows(cutoff);
  await writeFile(`${directory}/audit-before.json`, JSON.stringify({ cutoff, originalAudit }, null, 2), { flag: 'wx' });
  await run('initial-green', [process.env.npm_execpath,'run','test:person:assignment-effective:initial']);
  await run('contract', [process.env.npm_execpath,'run','test:person:assignment-effective:contract']);
  const retained = await run('retained', [process.env.npm_execpath,'run','prototype:person:assignment-effective:validate']);
  const summary = retained.split(/\r?\n/u).filter(line => line.startsWith('{')).map(line => JSON.parse(line))
    .findLast(value => value.task === 'PV-006-C-05' && value.status === 'PASS' && value.directory);
  assert.ok(summary, 'C05_RETAINED_RECEIPT_NOT_FOUND'); retainedRunId = summary.runId;
  environment.C05_REVIEW_RECEIPT = `${summary.directory}/recovery.json`;
  await run('review-audit-green', [process.env.npm_execpath,'run','test:person:assignment-effective:review']);
  await run('full-fresh-regressions', [process.env.npm_execpath,'run','prototype:person:assignment-effective:fresh']);
  assert.deepEqual(await auditRows(cutoff), originalAudit, 'C05_PREEXISTING_AUDIT_CHANGED');
  await writeFile(`${directory}/audit-after.json`, JSON.stringify({ cutoff, originalAudit, status: 'PASS' }, null, 2), { flag: 'wx' });
  // Release the inspection connection before the receipt-checked service restart.
  await auditPool.end();
  auditPoolClosed = true;
  await run('restart', [process.env.npm_execpath,'run','prototype:person:assignment-effective:restart','--',`${summary.directory}/recovery.json`]);
  await run('preservation', [process.env.npm_execpath,'run','prototype:person:assignment-effective:preserve','--','verify']);
  status = 'PASS';
} catch (failure) { status = 'FAILED'; error = failure instanceof Error ? failure.message : 'UNKNOWN'; process.exitCode = 1; }
finally {
  if (!auditPoolClosed) await auditPool.end();
  await writeFile(`${directory}/validation.json`, JSON.stringify({ task: 'PV-006-C-05', status, error, retainedRunId, commands,
    startedAt, finishedAt: new Date().toISOString(), cwd: process.cwd(), argv: process.argv.slice(1) }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-05', status, error, retainedRunId, commands: commands.length, directory }));
}
async function run(label, argv) {
  const startedAt = new Date().toISOString(); console.log(JSON.stringify({ phase: label, argv, directory }));
  let output = '';
  const child = spawn(process.execPath, argv, { cwd: process.cwd(), env: environment, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
  child.stdout.on('data', data => { output += data.toString(); }); child.stderr.on('data', data => { output += data.toString(); });
  const exit = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',resolve); });
  let safe = output.replaceAll(process.env.DATABASE_URL, '[DATABASE_URL]').replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu,'[DATABASE_URL]');
  for (const password of [endpoint.password, decodeURIComponent(endpoint.password)]) if (password) safe = safe.replaceAll(password, '[REDACTED]');
  await writeFile(`${directory}/${label}.log`, safe, { flag: 'wx' });
  commands.push({ label, argv, cwd: process.cwd(), startedAt, finishedAt: new Date().toISOString(), exit,
    outputPath: `${directory}/${label}.log`, outputSha256: createHash('sha256').update(safe).digest('hex') });
  console.log(JSON.stringify({ phase: label, exit, directory }));
  if (exit !== 0) throw new Error(`C05_REQUIRED_${label.toUpperCase().replaceAll('-','_')}_FAILED`);
  return safe;
}
