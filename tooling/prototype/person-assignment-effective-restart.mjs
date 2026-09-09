import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

assert.ok(process.argv.length===3&&process.argv[2]&&process.env.DATABASE_URL&&process.env.npm_execpath,'C05_RESTART_INPUT_REQUIRED');
const endpoint=new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname,'127.0.0.1');assert.equal(endpoint.port,'55434');assert.equal(endpoint.pathname,'/hdi_prototype');
const receiptPath=resolve(process.argv[2]),original=await readFile(receiptPath),receipt=JSON.parse(original.toString('utf8'));
assert.equal(receipt.task,'PV-006-C-05');assert.equal(receipt.mode,'RECOVERY');
const directory=`.runtime/pv006-c05/${randomUUID()}`;await mkdir(directory,{recursive:false});
const result={task:'PV-006-C-05',mode:'REAL_SERVICE_RESTART',status:'IN_PROGRESS',cwd:process.cwd(),argv:process.argv.slice(1),
  startedAt:new Date().toISOString(),receiptRunId:receipt.runId,originalReceiptSha256:createHash('sha256').update(original).digest('hex'),commands:[]};
async function identity() {
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:1000,application_name:'hdi-pv006-c05-restart-inspection'});
  try {return (await pool.query(`select current_database() as database,(select oid::text from pg_database where datname=current_database()) as oid,
    current_user as role,to_char(pg_postmaster_start_time() at time zone 'Asia/Shanghai','YYYY-MM-DD"T"HH24:MI:SS.US') as "startedAt",
    (select count(*)::int from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid()) as "otherClientBackends"`)).rows[0];}
  finally {await pool.end();}
}
try {
  const before=await identity();assert.equal(before.database,receipt.identity.database);assert.equal(before.oid,receipt.identity.oid);assert.equal(before.role,receipt.identity.role);
  assert.equal(before.otherClientBackends,0,'C05_RESTART_UNRELATED_SESSION_PRESENT');result.before=before;
  const argv=['-d','Anolis-8.9-HDI-POC','-u','root','--','systemctl','restart','postgresql-18'],startedAt=new Date().toISOString();
  const restarted=spawnSync('wsl.exe',argv,{encoding:'utf8',windowsHide:true,timeout:30000});
  result.commands.push({executable:'wsl.exe',argv,cwd:process.cwd(),startedAt,finishedAt:new Date().toISOString(),exit:restarted.status});
  await writeFile(`${directory}/restart-command.json`,JSON.stringify({argv,exit:restarted.status,stdout:restarted.stdout,stderr:restarted.stderr,error:restarted.error?.code},null,2),{flag:'wx'});
  assert.equal(restarted.status,0,'C05_RESTART_COMMAND_FAILED');
  let after;
  for(let attempt=0;attempt<30;attempt++){try{after=await identity();break;}catch{await delay(250);}}
  assert.ok(after,'C05_RESTART_RECONNECT_FAILED');assert.notEqual(after.startedAt,before.startedAt,'C05_POSTMASTER_START_UNCHANGED');
  for(const key of ['database','oid','role'])assert.equal(after[key],before[key]);result.after=after;
  for(const [label,argv] of [
    ['recovery',['--import','tsx','tooling/prototype/person-assignment-effective-recovery-probe.ts','--recover',receiptPath,receipt.runId]],
    ['negative-recovery',['--import','tsx','tooling/prototype/person-assignment-effective-recover-negative.mjs',receiptPath]],
  ]) {
    const startedAt=new Date().toISOString();
    const child=spawnSync(process.execPath,argv,{cwd:process.cwd(),env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
    const output=`${child.stdout??''}\n${child.stderr??''}`.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu,'[DATABASE_URL]');
    await writeFile(`${directory}/${label}.log`,output,{flag:'wx'});
    result.commands.push({executable:process.execPath,argv,cwd:process.cwd(),startedAt,finishedAt:new Date().toISOString(),exit:child.status,log:`${directory}/${label}.log`});
    assert.equal(child.status,0,'C05_RESTART_RECOVERY_FAILED');
  }
  assert.deepEqual(await readFile(receiptPath),original);result.status='PASS';result.postmasterChanged=true;result.originalReceiptUnchanged=true;
}catch(error){process.exitCode=1;result.status='FAILED';result.error=error instanceof Error?error.message.replace(/postgres(?:ql)?:\/\/\S+/gu,'[DATABASE_URL]'):'C05_RESTART_FAILED';}
finally{result.finishedAt=new Date().toISOString();await writeFile(`${directory}/restart.json`,JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify({task:result.task,status:result.status,before:result.before,after:result.after,error:result.error,directory}));}
