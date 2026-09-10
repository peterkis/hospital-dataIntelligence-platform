import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createTemporaryAssignmentFixture, type TemporaryCheck } from './person-assignment-temporary-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';
import { runTemporaryBehavior } from './person-assignment-temporary-behavior-probe.js';
import { runTemporaryHistory } from './person-assignment-temporary-history-probe.js';
import { runTemporaryRequests } from './person-assignment-temporary-request-probe.js';
import { runTemporaryConcurrency } from './person-assignment-temporary-concurrency-probe.js';
import { runTemporaryDefinitions } from './person-assignment-temporary-definition-probe.js';
import { runTemporarySql } from './person-assignment-temporary-sql-probe.js';
import { runTemporaryBoundaryNegatives } from './person-assignment-temporary-boundary-negative.js';
import { runTemporaryScopes } from './person-assignment-temporary-scope-probe.js';

assert.ok(process.env['DATABASE_URL'],'C04_MANAGED_DATABASE_REQUIRED');
const mode=process.argv[2]??'APPLICATION';
assert.ok(process.argv.length===2 || (process.argv.length===3 && ['--core','--concurrency','--sql'].includes(mode)),'C04_APPLICATION_MODE_INVALID');
process.env['NODE_ENV']='test';
const runId=randomUUID(),directory=`.runtime/pv006-c04/${runId}`;
await mkdir(directory,{recursive:false});
const startedAt=new Date().toISOString();
async function codeManifest() {
  const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','apps/governance-api/src','tooling/prototype','db/migrations','package.json','package-lock.json'],{encoding:'utf8'})
    .trim().split(/\r?\n/u).filter(Boolean);
  return Promise.all([...new Set(paths)].sort().map(async path=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')})));
}
const codeBefore=await codeManifest();
const handle=createDatabase({connectionString:process.env['DATABASE_URL'],max:14,application_name:'hdi-pv006-c04-application'});
const cases:{ids:string[];name:string;status:string;evidence?:unknown;error?:string}[]=[];
let failure:unknown,ownership:Awaited<ReturnType<typeof requireTemporaryFixtureTarget>>|undefined;
const check:TemporaryCheck=async(ids,name,work,status)=>{
  console.log(JSON.stringify({runId,caseStarted:ids,name}));
  try {cases.push({ids,name,status:status??'PASS',evidence:await work()});}
  catch(error) {cases.push({ids,name,status:'FAILED',error:error instanceof Error?error.message:'UNKNOWN'});throw error;}
  finally {await writeFile(`${directory}/case-${String(cases.length).padStart(2,'0')}.json`,JSON.stringify(cases.at(-1),null,2),{flag:'wx'});}
};
try {
  const database=handle.database;
  ownership=await requireTemporaryFixtureTarget(database,'COHORT');
  const count=(await sql<{migrations:number;tables:number}>`select (select count(*)::int from platform.schema_migration) as migrations,
    (select count(*)::int from information_schema.tables where table_schema='person_master' and table_type='BASE TABLE') as tables`.execute(database)).rows[0]!;
  assert.equal(count.migrations,39); assert.equal(count.tables,25);
  const oldDefinitions=()=>database.selectFrom('person_master.assignment_semantic_term_version').selectAll().where('code','!=','SECONDMENT').orderBy('term_version_id').execute();
  const before=await oldDefinitions();
  const f=await createTemporaryAssignmentFixture(database,runId);
  if(mode==='APPLICATION'||mode==='--core') {
    await runTemporaryBehavior(database,f,check);
    await runTemporaryHistory(database,f,check);
    await runTemporaryRequests(database,f,check);
    await runTemporaryScopes(database,f,check);
  }
  if(mode==='APPLICATION'||mode==='--concurrency') {
    await runTemporaryConcurrency(database,f,check);
    await runTemporaryDefinitions(database,f,check);
  }
  if(mode==='APPLICATION'||mode==='--sql') await runTemporarySql(database,f,check);
  if(mode==='APPLICATION'||mode==='--sql') await runTemporaryBoundaryNegatives(database,check);
  if(ownership.mode==='RETAINED') assert.deepEqual(await oldDefinitions(),before,'C04_RETAINED_SHARED_DEFINITION_CHANGED');
  await writeFile(`${directory}/retained-definition-protection.json`,JSON.stringify({mode:ownership.mode,
    status:ownership.mode==='RETAINED'?'PASS':'NOT_APPLICABLE_FRESH',originalVersionCount:before.length},null,2),{flag:'wx'});
} catch(error) {failure=error;process.exitCode=1;}
finally {
  await handle.close();
  const code=await codeManifest();
  const codeUnchanged=JSON.stringify(code)===JSON.stringify(codeBefore);
  if(!codeUnchanged&&!failure){failure=new Error('C04_CODE_CHANGED_DURING_RUN');process.exitCode=1;}
  const error=failure instanceof Error?failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu,'[DATABASE_URL]'):null;
  await writeFile(`${directory}/application.json`,JSON.stringify({task:'PV-006-C-04',runId,mode,ownership,startedAt,finishedAt:new Date().toISOString(),
    cwd:process.cwd(),argv:process.argv.slice(1),baselineHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cases,
    status:failure?'FAILED':'PASS',error,poolClosed:true,codeUnchanged,codeBefore,code},null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-04',runId,mode,status:failure?'FAILED':'PASS',cases:cases.length,error,poolClosed:true,directory}));
}
