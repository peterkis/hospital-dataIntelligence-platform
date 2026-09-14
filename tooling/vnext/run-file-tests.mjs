import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {root,resolveTarget,migrate,migrationFiles} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';
import {readFileSync} from 'node:fs';
if(process.argv.includes('--dispose')) {
 const receipt=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--dispose')+1],'utf8'));
 assert.equal(receipt.taskId,'P0-04');dropTemporary(receipt);console.log('OWNED_P0_04_DISPOSED');process.exit(0);
}
const owned=createTemporary('P0-04');
try {
 let previous,jobId;
 if(process.argv.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,26));await seed(owned.receipt);
  const catalog=await openCatalog(resolveTarget(owned.receipt));try{const f=await fixture(catalog);const job=await catalog.importJobCommand('maker',f.create);jobId=job.id;previous=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId});}finally{await catalog.close();}
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(previous){const catalog=await openCatalog(resolveTarget(owned.receipt));try{assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId}),previous);assert.equal((await catalog.verifyAudit('auditor')).status,'PASS');console.log('PREFIX_26_PRESERVED');}finally{await catalog.close();}}
 const run=spawnSync(process.execPath,['--import','./tooling/vnext/connection-guard.mjs','--import','tsx','--test','tooling/vnext/file-intake.test.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-04-FILES'},stdio:'inherit',windowsHide:true});
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P0-04',mode:previous?'PREFIX_26':'FRESH',exit:run.status,oid:owned.receipt.oid}));
}finally{dropTemporary(owned.receipt);}
