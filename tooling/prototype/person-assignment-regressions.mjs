import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

if (!process.env.npm_execpath || !process.env.DATABASE_URL) throw new Error('C01_MANAGED_NPM_DATABASE_SESSION_REQUIRED');
const directory = `.runtime/pv006-c01/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const root = process.cwd();
const commands = [];
const gatesOnly = process.argv.includes('--gates-only');
const preservedTables = {
  person_subject: 'created_at', person_subject_version: 'recorded_from',
  person_identifier: 'created_at', person_identifier_version: 'recorded_from',
  person_source_mapping: 'created_at', person_source_mapping_version: 'recorded_from',
  engagement: 'created_at', engagement_version: 'recorded_from',
  engagement_type: 'created_at', engagement_type_version: 'recorded_from',
  engagement_classification: 'classified_at', engagement_overlap_rule: 'created_at',
  engagement_overlap_rule_version: 'recorded_from', engagement_lifecycle_event: 'recorded_at',
  engagement_lifecycle_rejection: 'recorded_at',
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
let cutoff;
try {
  cutoff = (await pool.query("select to_char(platform.local_now(),'YYYY-MM-DD\"T\"HH24:MI:SS.US') as value")).rows[0].value;
  const before = await fingerprint();
  await writeFile(`${directory}/immutable-before.json`, JSON.stringify({ cutoff, before }, null, 2), { flag: 'wx' });
  const scripts = [
    'prototype:person:engagement:validate', 'prototype:person:engagement-classification:validate',
    'prototype:person:engagement-lifecycle:validate', 'prototype:person:validate',
    'prototype:person:identifier:validate', 'prototype:person:source-mapping:validate',
    'prototype:person:engagement-temporal:application',
  ];
  if (!gatesOnly) {
    for (const script of scripts) await npm(script);
    await run(['../../node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', '--maxWorkers=1',
      '--exclude', 'src/composition/phase-01-vertical-slice.integration.test.ts'], resolve(root, 'apps/governance-api'));
    await run([process.env.npm_execpath, 'run', 'test', '--workspace', '@hospital-data-intelligence/sim-consumer']);
    await run([process.env.npm_execpath, 'run', 'test', '--workspace', '@hospital-data-intelligence/release-consumer-sdk']);
    for (const script of ['test:consumer-replay', 'prototype:department:validate', 'prototype:department:http:validate',
      'prototype:consumer:metrics:validate', 'prototype:consumer:audit:validate',
      'prototype:person:assignment:types', 'prototype:person:assignment:catalog', 'prototype:person:assignment:freeze']) await npm(script);
  }
  for (const script of ['contract:lint', 'typecheck', 'build', 'check']) await npm(script);
  await run(['--import', 'tsx', 'tooling/prototype/check-department-consumer-canonical.ts']);
  await run(['--test', 'tooling/prototype/person-engagement-temporal-schema.test.mjs']);
  const after = await fingerprint();
  await writeFile(`${directory}/immutable-after.json`, JSON.stringify({ cutoff, after }, null, 2), { flag: 'wx' });
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('PREEXISTING_IMMUTABLE_ROWS_CHANGED');
  console.log(JSON.stringify({ task: 'PV-006-C-01', status: gatesOnly ? 'REMAINING_GATES_PASSED' : 'REGRESSIONS_PASSED', commandCount: commands.length,
    preexistingImmutableRowsPreserved: true, evidenceDirectory: directory }));
} catch (error) {
  console.log(JSON.stringify({ task: 'PV-006-C-01', status: 'REGRESSIONS_FAILED',
    code: error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'REGRESSION_ERROR',
    evidenceDirectory: directory }));
  process.exitCode = 1;
} finally {
  await pool.end();
  await writeFile(`${directory}/commands.json`, JSON.stringify(commands, null, 2), { flag: 'wx' });
}
async function npm(script) { await run([process.env.npm_execpath, 'run', script]); }
async function run(argv, cwd = root) {
  const index = commands.length + 1;
  const startedAt = new Date().toISOString();
  console.log(JSON.stringify({ commandStarted: index, cwd, argv }));
  let output = '';
  const child = spawn(process.execPath, argv, { cwd, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { output += data.toString(); });
  child.stderr.on('data', data => { output += data.toString(); });
  const exitCode = await new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
  const url = new URL(process.env.DATABASE_URL);
  output = output.replaceAll(process.env.DATABASE_URL, '[DATABASE_URL]');
  if (url.password) output = output.replaceAll(decodeURIComponent(url.password), '[REDACTED]').replaceAll(url.password, '[REDACTED]');
  output = output.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu, '[DATABASE_URL]');
  const path = `${directory}/${String(index).padStart(2, '0')}.log`;
  await writeFile(path, output, { flag: 'wx' });
  commands.push({ cwd, executable: process.execPath, argv, startedAt, finishedAt: new Date().toISOString(), exitCode, outputPath: path });
  console.log(JSON.stringify({ commandFinished: index, exitCode, outputPath: path,
    summary: output.split(/\r?\n/u).filter(line => /Test Files|Tests |tests |pass |fail |"status"|passed|failed/i.test(line)).slice(-4) }));
  if (exitCode !== 0) throw new Error('REQUIRED_REGRESSION_FAILED');
}
async function fingerprint() {
  const manifest = {};
  for (const [table, timestamp] of Object.entries(preservedTables)) {
    // Names come exclusively from this static allowlist; no caller-supplied SQL identifiers.
    const observation = await pool.query(`select count(*)::int as count,
      encode(digest(coalesce(string_agg(row_json, '' order by row_json),''),'sha256'),'hex') as digest
      from (select to_jsonb(t)::text as row_json from person_master.${table} t where ${timestamp} <= $1::timestamp) rows`, [cutoff]);
    manifest[table] = observation.rows[0];
  }
  return manifest;
}
