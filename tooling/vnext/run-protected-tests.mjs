import {spawnSync} from 'node:child_process';
import {resolveTarget,root,migrate,migrationFiles,peer} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';
const owned=createTemporary('P0-11');
try {
 let before; let originalJob; let jobId;
 const baseline=()=>peer(owned.receipt.name,`SELECT governance_catalog.contract_read('maker','{"scope":"BASELINE","mode":"CURRENT"}'::jsonb)::text;`);
 if(process.argv.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,22));await seed(owned.receipt);before=baseline();
  const catalog=await openCatalog(resolveTarget(owned.receipt));
  try {const f=await fixture(catalog);jobId=(await catalog.importJobCommand('maker',f.create)).id;originalJob=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId});}finally{await catalog.close();}
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){assert.equal(baseline(),before);console.log(JSON.stringify({gate:'PREFIX_22_PRESERVES_CONTRACTS',status:'PASS'}));}
 if(originalJob){const catalog=await openCatalog(resolveTarget(owned.receipt));try{assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId}),originalJob);console.log(JSON.stringify({gate:'PREFIX_22_PRESERVES_JOB_HISTORY',status:'PASS'}));}finally{await catalog.close();}}
 const run=spawnSync(process.execPath,['--import','./tooling/vnext/connection-guard.mjs','--import','tsx','--test','tooling/vnext/protected-artifact.test.ts'],{
  cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-11-PROTECTED'},stdio:'inherit',windowsHide:true,
 });
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P0-11',mode:before?'PREFIX_22':'FRESH',exit:run.status,oid:owned.receipt.oid}));
}finally{dropTemporary(owned.receipt);}
