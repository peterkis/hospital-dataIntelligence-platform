import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.ts';

assert.ok(process.argv.length===3&&process.argv[2],'C04_NEGATIVE_RECOVERY_RECEIPT_REQUIRED');
const originalPath=resolve(process.argv[2]),originalBytes=await readFile(originalPath,'utf8'),original=JSON.parse(originalBytes);
assert.equal(original.task,'PV-006-C-04');assert.equal(original.mode,'RECOVERY');
const endpoint=new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.port,'55434');assert.equal(endpoint.pathname,'/hdi_prototype');
const directory=`.runtime/pv006-c04/${randomUUID()}`;await mkdir(directory,{recursive:false});
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,application_name:'hdi-pv006-c04-negative-recovery'});
const observations=[];
const counts=async()=>(await pool.query(`select (select count(*)::int from person_master.assignment) as assignments,
  (select count(*)::int from person_master.assignment_temporary_source) as links,
  (select count(*)::int from person_master.assignment_command_outcome) as outcomes,
  (select count(*)::int from person_master.assignment_semantic_term_version) as definitions,
  (select count(*)::int from audit.audit_event) as audits`)).rows[0];
function rehash(value){const {contentHash,...body}=value;return {...body,contentHash:canonicalSha256(body).toString('hex')};}
try {
  const before=await counts();
  const variants=[['MISSING',null],['MODE',rehash({...original,mode:'APPLICATION'})],['RUN',rehash({...original,runId:randomUUID()})],
    ['DATABASE',rehash({...original,identity:{...original.identity,database:'wrong_database'}})],
    ['OID',rehash({...original,identity:{...original.identity,oid:'0'}})],
    ['ENDPOINT',rehash({...original,identity:{...original.identity,endpoint:{...original.identity.endpoint,port:'5432'}}})],
    ['HASH',{...original,contentHash:'0'.repeat(64)}]];
  for(const [label,value] of variants) {
    const path=resolve(directory,`${label}.json`);if(value!==null) await writeFile(path,JSON.stringify(value,null,2),{flag:'wx'});
    const argv=['--import','tsx','tooling/prototype/person-assignment-temporary-recovery-probe.ts','--recover',path,original.runId];
    const startedAt=new Date().toISOString();
    const execution=spawnSync(process.execPath,argv,{cwd:process.cwd(),env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:2*1024*1024});
    assert.equal(execution.status,1,`C04_NEGATIVE_RECOVERY_${label}_ACCEPTED`);assert.deepEqual(await counts(),before);
    const output=`${execution.stdout??''}\n${execution.stderr??''}`.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu,'[DATABASE_URL]');
    await writeFile(`${directory}/${label}.log`,output,{flag:'wx'});
    observations.push({label,executable:process.execPath,argv,cwd:process.cwd(),startedAt,finishedAt:new Date().toISOString(),exit:execution.status});
  }
  assert.equal(await readFile(originalPath,'utf8'),originalBytes);
  await writeFile(`${directory}/negative-recovery.json`,JSON.stringify({task:'PV-006-C-04',status:'PASS',originalRunId:original.runId,
    observations,before,after:await counts(),originalReceiptUnchanged:true},null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-04',status:'PASS',negativeSubprocesses:observations.length,directory}));
} finally {await pool.end();}
