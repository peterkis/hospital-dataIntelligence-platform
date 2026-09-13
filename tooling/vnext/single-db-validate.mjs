import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { root, readReceipt } from './lineage.mjs';

const receipt=readReceipt();
const runId=randomUUID();
const tracePath=`.runtime/vnext/P0-02-connection-${runId}.jsonl`;
writeFileSync(tracePath,'',{flag:'wx'});
const commands=[
  ['--test', 'tooling/vnext/readiness.test.mjs'],
  ['tooling/vnext/managed.mjs', 'verify'],
  ['tooling/vnext/managed.mjs', 'seed'],
  ['tooling/vnext/managed.mjs', 'types-verify'],
  ['tooling/vnext/authority.mjs'],
];
for (const [step,args] of commands.entries()) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, VNEXT_CONNECTION_RUN_ID:runId,VNEXT_CONNECTION_STEP:String(step), NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${new URL('./connection-guard.mjs', import.meta.url).href}` },
    stdio: 'inherit', windowsHide: true,
  });
  assert.equal(result.status, 0, `single active database gate: ${args.join(' ')}`);
}
const trace = readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(row=>row.event==='CLIENT_CONNECT');
assert.ok(trace.length > 0);
assert.ok(trace.every(row=>row.runId===runId&&row.database===receipt.name&&row.expectedReceiptOid===receipt.oid));
for(const step of commands.keys())assert.ok(trace.some(row=>row.step===String(step)),`step ${step} has current-run connection evidence`);
console.log(JSON.stringify({ status: 'PASS', gate: 'P0-02-SINGLE_ACTIVE_DB',runId,tracePath, connectionAttempts: trace.length, legacyConnections: 0 }));
