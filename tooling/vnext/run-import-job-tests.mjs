import {spawnSync} from 'node:child_process';
import {resolveTarget,root,migrate,migrationFiles,peer} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const owned=createTemporary('P0-03');
const receipt=owned.receipt;
try {
  let before;
  const baseline=()=>peer(receipt.name,`SELECT governance_catalog.contract_read('maker','{"scope":"BASELINE","mode":"CURRENT"}'::jsonb)::text;`);
  if(process.argv.includes('--upgrade')){await migrate(receipt,migrationFiles().slice(0,21));await seed(receipt);before=baseline();}
  await migrate(receipt);await seed(receipt);
  if(before){assert.equal(baseline(),before);console.log(JSON.stringify({gate:'PREFIX_21_PRESERVES_CONTRACTS',status:'PASS'}));}
 const run=spawnSync(process.execPath,['--import','./tooling/vnext/connection-guard.mjs','--import','tsx','--test','tooling/vnext/import-job.test.ts'],{
  cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(receipt),VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-03-JOBS'},stdio:'inherit',windowsHide:true,
 });
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P0-03',mode:process.argv.includes('--upgrade')?'PREFIX_21':'FRESH',exit:run.status,oid:receipt.oid}));
}finally{dropTemporary(receipt);}
