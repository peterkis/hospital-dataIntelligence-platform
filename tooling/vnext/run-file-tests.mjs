import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {root,resolveTarget,migrate,migrationFiles,peer,quote,inspect} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';
import {readFileSync} from 'node:fs';
if(process.argv.includes('--dispose')) {
 const receipt=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--dispose')+1],'utf8'));
 assert.equal(receipt.taskId,'P0-04');dropTemporary(receipt);console.log('OWNED_P0_04_DISPOSED');process.exit(0);
}
if(process.argv.includes('--upgrade')) {
 const orphan=createTemporary('P0-04');
 try {
  await migrate(orphan.receipt,migrationFiles().slice(0,27));await seed(orphan.receipt);
  const catalog=await openCatalog(resolveTarget(orphan.receipt));
  try {
   const f=await fixture(catalog),input={...f.create,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}};
   const outcome=JSON.parse(peer(orphan.receipt.name,`SELECT governance_catalog.import_job_command('maker',${quote(JSON.stringify(input))}::jsonb)::text;`));
   const before=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:outcome.id});
   await assert.rejects(migrate(orphan.receipt),/FILE_ORIGINAL_REQUIRED/);
   assert.equal((await inspect(orphan.receipt)).ledger.length,27);
   assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:outcome.id}),before);
   console.log('PREFIX_27_ORPHAN_UPGRADE_REJECTED_AND_PRESERVED');
  }finally{await catalog.close();}
 }finally{dropTemporary(orphan.receipt);}
}
const owned=createTemporary('P0-04');
const keys=new LocalSyntheticKeyProvider();
try {
 let previous,jobId,originalFile;
 if(process.argv.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,27));await seed(owned.receipt);
  const catalog=await openCatalog(resolveTarget(owned.receipt),keys);try{
   const f=await fixture(catalog);
   for(const permission of ['STORE','READ'])peer(owned.receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
   originalFile=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{...f.create,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}}},Buffer.from('SYNTHETIC_UPGRADE_BYTES'));
   jobId=originalFile.job.id;previous=await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId});
  }finally{await catalog.close();}
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(previous){const catalog=await openCatalog(resolveTarget(owned.receipt),keys);try{
  assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId}),previous);
  assert.equal(Buffer.from(await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:originalFile.artifact.artifactId})).toString(),'SYNTHETIC_UPGRADE_BYTES');
  assert.equal((await catalog.verifyAudit('auditor')).status,'PASS');console.log('PREFIX_27_FILE_AND_AUDIT_PRESERVED');
 }finally{await catalog.close();}}
 const run=spawnSync(process.execPath,['--import','./tooling/vnext/connection-guard.mjs','--import','tsx','--test','tooling/vnext/file-intake.test.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-04-FILES'},stdio:'inherit',windowsHide:true});
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P0-04',mode:previous?'PREFIX_27':'FRESH',exit:run.status,oid:owned.receipt.oid}));
}finally{dropTemporary(owned.receipt);}
