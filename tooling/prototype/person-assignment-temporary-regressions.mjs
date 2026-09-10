import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID,createHash } from 'node:crypto';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.ts';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.ts';

assert.ok(process.env.npm_execpath&&process.env.DATABASE_URL,'C04_MANAGED_NPM_DATABASE_REQUIRED');
assert.equal(process.argv.length,2,'C04_REGRESSION_MODE_INVALID');
const handle=createDatabase({connectionString:process.env.DATABASE_URL,max:1,application_name:'hdi-pv006-c04-regression-boundary'});
let ownership;
try{ownership=await requireTemporaryFixtureTarget(handle.database,'SHARED_DEFINITION_MUTATION');}finally{await handle.close();}
assert.equal(ownership.mode,'OWNED_FRESH');
const runId=randomUUID(),directory=`.runtime/pv006-c04/${runId}`;await mkdir(directory,{recursive:false});
const root=process.cwd(),commands=[];
const childEnvironment={...process.env,REDOCLY_TELEMETRY:'off',REDOCLY_SUPPRESS_UPDATE_NOTICE:'true',npm_config_offline:'true',
  npm_config_update_notifier:'false',NO_UPDATE_NOTIFIER:'1',HOST:'127.0.0.1',PORT:'3000'};
const tracked=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','apps/governance-api/src','tooling/prototype','db/migrations','package.json','package-lock.json'],{encoding:'utf8'})
  .trim().split(/\r?\n/u).filter(Boolean);
const code=await Promise.all([...new Set(tracked)].map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
let status='IN_PROGRESS',error;
try {
  // Older B probes use the Identifier fixture principal in authorization negatives.
  // Seed through the original A validations before B/C on an actually empty database.
  for(const script of ['prototype:person:validate','prototype:person:identifier:validate','prototype:person:source-mapping:validate',
    'prototype:person:engagement:validate','prototype:person:engagement-classification:validate','prototype:person:engagement-lifecycle:validate',
    'prototype:person:engagement-temporal:application','prototype:person:assignment:application',
    'prototype:person:assignment-semantics:validate','prototype:person:assignment-semantics:sql',
    'prototype:person:assignment-closure:validate','prototype:person:assignment-transfer:validate']) await npm(script);
  await run([process.env.npm_execpath,'run','test','--workspace','@hospital-data-intelligence/governance-api','--',
    '--no-file-parallelism','--maxWorkers=1','--exclude','src/composition/phase-01-vertical-slice.integration.test.ts']);
  for(const workspace of ['@hospital-data-intelligence/sim-consumer','@hospital-data-intelligence/release-consumer-sdk'])
    await run([process.env.npm_execpath,'run','test','--workspace',workspace]);
  for(const script of ['test:consumer-replay','prototype:department:validate','prototype:department:http:validate',
    'prototype:consumer:metrics:validate','prototype:consumer:audit:validate','prototype:person:assignment:types',
    'prototype:person:assignment:catalog','prototype:person:assignment:freeze','test:assignment-temporary-fixture','test:assignment-temporary-policy',
    'contract:lint','typecheck','build','check']) await npm(script);
  await run(['--import','tsx','tooling/prototype/check-department-consumer-canonical.ts']);
  await run(['--test','tooling/prototype/person-engagement-temporal-schema.test.mjs']);
  const after=await Promise.all(code.map(async item=>({path:item.path,sha256:createHash('sha256').update(await readFile(item.path)).digest('hex')})));
  assert.deepEqual(after,code,'C04_REGRESSION_CODE_CHANGED_DURING_RUN');status='PASS';
} catch(failure) {status='FAILED';error=failure instanceof Error?failure.message:'C04_REGRESSION_FAILED';process.exitCode=1;}
finally {
  await writeFile(`${directory}/regressions.json`,JSON.stringify({task:'PV-006-C-04',runId,status,error,ownership,commands,code,
    formalContainerSuite:'EXCLUDED_EXISTING_NON_PROTOTYPE_SCOPE',sharedDefinitionMutation:'OWNED_FRESH_ONLY'},null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-04',runId,status,error,commandCount:commands.length,directory}));
}
async function npm(script){await run([process.env.npm_execpath,'run',script]);}
async function run(argv) {
  const number=commands.length+1,startedAt=new Date().toISOString();
  console.log(JSON.stringify({runId,commandStarted:number,argv,cwd:root}));
  let output='';
  const child=spawn(process.execPath,argv,{cwd:root,env:childEnvironment,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',value=>{output+=value.toString();});child.stderr.on('data',value=>{output+=value.toString();});
  const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  const endpoint=new URL(process.env.DATABASE_URL);
  output=output.replaceAll(process.env.DATABASE_URL,'[DATABASE_URL]');
  for(const password of [endpoint.password,decodeURIComponent(endpoint.password)])if(password)output=output.replaceAll(password,'[REDACTED]');
  output=output.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu,'[DATABASE_URL]');
  const path=`${directory}/${String(number).padStart(2,'0')}.log`;
  await writeFile(path,output,{flag:'wx'});
  commands.push({executable:process.execPath,argv,cwd:root,startedAt,finishedAt:new Date().toISOString(),exit,outputPath:path});
  console.log(JSON.stringify({runId,commandFinished:number,exit,outputPath:path}));
  if(exit!==0)throw new Error('C04_REQUIRED_REGRESSION_FAILED');
}
