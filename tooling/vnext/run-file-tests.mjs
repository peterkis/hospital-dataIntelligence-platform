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
 for(const fault of ['DIGEST_PAIR','MISSING_KIND','DUPLICATE_RAW_FILE','FILE_SHAPE']){
  const prefix=fault==='FILE_SHAPE'?29:28;
  const invalid=createTemporary('P0-04');
  try{
   await migrate(invalid.receipt,migrationFiles().slice(0,prefix));await seed(invalid.receipt);
   const catalog=await openCatalog(resolveTarget(invalid.receipt),new LocalSyntheticKeyProvider());
   try{
    const f=await fixture(catalog,{businessKey:false});
    peer(invalid.receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','STORE');`);
    const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{...f.create,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}}},Buffer.from('SYNTHETIC_UPGRADE_BYTES'));
    const mutation=fault==='DUPLICATE_RAW_FILE'
     ? `INSERT INTO governance_catalog.protected_artifact(job_id,revision_id,request_id,campus,purpose,kind,expires_at) SELECT job_id,revision_id,uuidv7(),campus,purpose,kind,expires_at FROM governance_catalog.protected_artifact WHERE id=${quote(file.artifact.artifactId)}::uuid;`
     : `UPDATE governance_catalog.import_input_revision SET ${fault==='DIGEST_PAIR'?"digest_status='DECLARED'":fault==='FILE_SHAPE'?"metadata=jsonb_build_object('kind','FILE')":"metadata='{}'::jsonb"} WHERE id=${quote(file.job.revisionId)}::uuid;`;
    peer(invalid.receipt.name,`BEGIN; SET LOCAL session_replication_role=replica; ${mutation} COMMIT;`);
    const snapshot=()=>peer(invalid.receipt.name,`SELECT jsonb_build_object('revision',(SELECT to_jsonb(r) FROM governance_catalog.import_input_revision r WHERE id=${quote(file.job.revisionId)}::uuid),'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM governance_catalog.protected_artifact a WHERE revision_id=${quote(file.job.revisionId)}::uuid))::text;`);
    const before=snapshot();await assert.rejects(migrate(invalid.receipt),/^Error: VNEXT_ADMIN_COMMAND_FAILED$/);
    assert.match(readFileSync(`${root}/.runtime/vnext/last-admin-error.log`,'utf8'),fault==='DUPLICATE_RAW_FILE'?/protected_artifact_raw_file_revision_unique/:fault==='FILE_SHAPE'?/import_input_revision_metadata_shape_check/:/import_input_revision_digest_status_check/);
    assert.equal((await inspect(invalid.receipt)).ledger.length,prefix);assert.equal(snapshot(),before);
    console.log(`PREFIX_${prefix}_${fault}_UPGRADE_REJECTED_AND_PRESERVED`);
   }finally{await catalog.close();}
  }finally{dropTemporary(invalid.receipt);}
 }
 const orphan=createTemporary('P0-04');
 try {
  await migrate(orphan.receipt,migrationFiles().slice(0,27));await seed(orphan.receipt);
  const catalog=await openCatalog(resolveTarget(orphan.receipt));
  try {
   const f=await fixture(catalog,{businessKey:false}),input={...f.create,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}};
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
   const f=await fixture(catalog,{businessKey:false});
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
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.files.config.ts','tooling/vnext/file-intake.test.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-04-FILES'},stdio:'inherit',windowsHide:true});
 process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P0-04',mode:previous?'PREFIX_27':'FRESH',exit:run.status,oid:owned.receipt.oid}));
}finally{dropTemporary(owned.receipt);}
