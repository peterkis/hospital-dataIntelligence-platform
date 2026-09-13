import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='npm_execpath'));
test('current managed entry rejects historical database scripts before any session starts',()=>{
 for(const script of ['prototype:db:check','prototype:db:migrate','prototype:api:start','test']){
  const result=spawnSync(process.execPath,['tooling/prototype/run-with-database.mjs',script],{env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.match(result.stderr,/LEGACY_OUT_OF_CURRENT_EXECUTION/);
  assert.doesNotMatch(result.stdout,/DATABASE_SESSION_READY/);
 }
});
test('current vNext and compiler entries advance to the normal managed-session preconditions',()=>{
 for(const script of ['vnext:db:verify','typecheck','build']){
  const result=spawnSync(process.execPath,['tooling/prototype/run-with-database.mjs',script],{env,encoding:'utf8',windowsHide:true});
  assert.equal(result.status,1);assert.match(result.stderr,/PROTOTYPE_DATABASE_NPM_ENTRYPOINT_REQUIRED/);
 }
});
