import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.ok(process.env.DATABASE_URL && process.env.npm_execpath, 'C0301_MANAGED_NPM_DATABASE_REQUIRED');
assert.ok(process.env.ASSIGNMENT_CLOSURE_RECOVERY_RECEIPT && process.env.ASSIGNMENT_CLOSURE_RECOVERY_RUN_ID, 'C0301_RECOVERY_INPUT_REQUIRED');
const endpoint = new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434'); assert.equal(endpoint.pathname, '/hdi_prototype');
const original = await readFile(process.env.ASSIGNMENT_CLOSURE_RECOVERY_RECEIPT), receipt = JSON.parse(original.toString('utf8'));
assert.equal(receipt.task, 'PV-006-C-03-01'); assert.equal(receipt.mode, 'RECOVERY');
assert.equal(receipt.runId, process.env.ASSIGNMENT_CLOSURE_RECOVERY_RUN_ID);
const directory = `.runtime/pv006-c0301/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const result = { task: 'PV-006-C-03-01', mode: 'REAL_SERVICE_RESTART', status: 'IN_PROGRESS',
  argv: process.argv.slice(1), cwd: process.cwd(), commands: [], receiptRunId: receipt.runId,
  originalReceiptSha256: createHash('sha256').update(original).digest('hex') };
async function identity() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 1000,
    application_name: 'hdi-pv006-c0301-restart-inspection' });
  try { return (await pool.query(`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid,current_user as role,
    inet_server_addr()::text as address,inet_server_port() as port,pg_postmaster_start_time()::text as "startedAt"`)).rows[0]; }
  finally { await pool.end(); }
}
try {
  const before = await identity();
  for (const key of ['database', 'oid', 'role', 'address', 'port']) assert.equal(before[key], receipt.identity[key], `C0301_RESTART_${key.toUpperCase()}_MISMATCH`);
  result.before = before;
  // All probe pools are closed before the actual service restart. The parent
  // prototype:db:with session retains its original service/distribution ownership.
  const argv = ['-d', 'Anolis-8.9-HDI-POC', '-u', 'root', '--', 'systemctl', 'restart', 'postgresql-18'];
  const restarted = spawnSync('wsl.exe', argv, { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  result.commands.push({ executable: 'wsl.exe', argv, cwd: process.cwd(), exitCode: restarted.status });
  await writeFile(`${directory}/restart-command.json`, JSON.stringify({ argv, exitCode: restarted.status,
    stdout: restarted.stdout, stderr: restarted.stderr, error: restarted.error?.code }, null, 2), { flag: 'wx' });
  assert.equal(restarted.status, 0, 'C0301_REAL_RESTART_COMMAND_FAILED');
  let after;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { after = await identity(); break; } catch { await delay(250); }
  }
  assert.ok(after, 'C0301_RESTART_RECONNECT_FAILED');
  for (const key of ['database', 'oid', 'role', 'address', 'port']) assert.equal(after[key], before[key], `C0301_RESTART_${key.toUpperCase()}_DRIFT`);
  assert.notEqual(after.startedAt, before.startedAt, 'C0301_POSTMASTER_START_UNCHANGED');
  result.after = after;
  for (const script of ['prototype:person:assignment-closure:recover', 'prototype:person:assignment-closure:recover-negative']) {
    const childArgv = [process.env.npm_execpath, 'run', script];
    const child = spawnSync(process.execPath, childArgv, { cwd: process.cwd(), env: process.env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const output = `${child.stdout ?? ''}\n${child.stderr ?? ''}`.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]');
    await writeFile(`${directory}/${script.split(':').at(-1)}.log`, output, { flag: 'wx' });
    result.commands.push({ executable: process.execPath, argv: childArgv, cwd: process.cwd(), exitCode: child.status });
    assert.equal(child.status, 0, 'C0301_RESTART_RECOVERY_FAILED');
  }
  assert.deepEqual(await readFile(process.env.ASSIGNMENT_CLOSURE_RECOVERY_RECEIPT), original, 'C0301_ORIGINAL_RECEIPT_CHANGED');
  result.status = 'PASS'; result.postmasterChanged = true; result.originalReceiptUnchanged = true;
} catch (error) {
  process.exitCode = 1; result.status = 'FAILED';
  result.error = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : 'RESTART_ERROR';
} finally {
  await writeFile(`${directory}/restart.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: result.task, mode: result.mode, status: result.status, directory, error: result.error }));
}
