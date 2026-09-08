import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql,type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { TemporaryCheck } from './person-assignment-temporary-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';

export async function runTemporaryBoundaryNegatives(database:Kysely<DB>,check:TemporaryCheck) {
  await check(['EV-04','SC-06'],'Actual subprocesses reject wrong/missing receipt, OID, owner, database, endpoint and mode before mutation',async()=>{
    const owned=await requireTemporaryFixtureTarget(database,'COHORT'),runId=randomUUID(),directory=`.runtime/pv006-c04/${runId}`;
    await mkdir(directory,{recursive:false});
    const originalPath=process.env['C04_FRESH_OWNERSHIP_RECEIPT'];
    const originalBytes=originalPath?await readFile(originalPath,'utf8'):null;
    const original:Record<string,unknown>=originalBytes?JSON.parse(originalBytes):{
      task:'PV-006-C-04',runId,mode:'FRESH_INSTALL',databaseName:owned.identity.database,
      identity:{name:owned.identity.database,oid:owned.identity.oid,owner:owned.identity.owner},endpoint:owned.identity.endpoint,createdByPeerRole:'postgres'};
    const variants:[string,unknown][]=[['MISSING',null],['MODE',{...original,mode:'RETAINED'}],['DATABASE',{...original,databaseName:'wrong_database'}],
      ['OID',{...original,identity:{name:owned.identity.database,oid:'0',owner:'hdi_prototype'}}],
      ['OWNER',{...original,identity:{name:owned.identity.database,oid:owned.identity.oid,owner:'postgres'}}],
      ['ENDPOINT',{...original,endpoint:{host:'localhost',port:'55434',role:'hdi_prototype'}}],['TASK',{...original,task:'PV-006-C-03-02'}]];
    const counts=async()=>(await sql<{facts:string;audits:string}>`select
      ((select count(*) from person_master.assignment)+(select count(*) from person_master.assignment_temporary_source)
        +(select count(*) from person_master.assignment_semantic_term_version))::text as facts,
      (select count(*)::text from audit.audit_event) as audits`.execute(database)).rows[0]!;
    const before=await counts(),observations=[];
    for(const [label,receipt] of variants) {
      const file=resolve(directory,`${label}.json`);
      if(receipt!==null) await writeFile(file,JSON.stringify(receipt,null,2),{flag:'wx'});
      const argv=['--import','tsx','tooling/prototype/person-assignment-temporary-boundary-probe.ts','--shared-mutation-guard'];
      const startedAt=new Date().toISOString();
      const execution=spawnSync(process.execPath,argv,{cwd:process.cwd(),encoding:'utf8',windowsHide:true,
        env:{...process.env,C04_FRESH_OWNERSHIP_RECEIPT:receipt===null?undefined:file}});
      assert.equal(execution.status,1,`${label}: C04_BOUNDARY_NEGATIVE_ACCEPTED`);
      assert.deepEqual(await counts(),before);
      // Receipt/endpoint validation errors contain no domain values or credentials.
      const output=`${execution.stdout??''}\n${execution.stderr??''}`.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu,'[DATABASE_URL]');
      await writeFile(`${directory}/${label}.log`,output,{flag:'wx'});
      observations.push({label,executable:process.execPath,argv,cwd:process.cwd(),startedAt,finishedAt:new Date().toISOString(),exit:execution.status});
    }
    const argv=['--import','tsx','tooling/prototype/person-assignment-temporary-boundary-probe.ts','--wrong-mode'];
    const wrongModeStartedAt=new Date().toISOString();
    const wrongMode=spawnSync(process.execPath,argv,{cwd:process.cwd(),encoding:'utf8',windowsHide:true,env:process.env});
    assert.equal(wrongMode.status,1);assert.deepEqual(await counts(),before);
    observations.push({label:'CLI_MODE',executable:process.execPath,argv,cwd:process.cwd(),startedAt:wrongModeStartedAt,finishedAt:new Date().toISOString(),exit:wrongMode.status});
    if(originalPath) assert.equal(await readFile(originalPath,'utf8'),originalBytes);
    await writeFile(`${directory}/boundary-negative.json`,JSON.stringify({task:'PV-006-C-04',status:'PASS',owned,before,after:await counts(),observations},null,2),{flag:'wx'});
    return {directory,observations,countsUnchanged:before,originalReceiptUnchanged:true};
  });
}
