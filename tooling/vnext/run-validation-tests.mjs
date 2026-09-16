import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {root,resolveTarget,migrate,migrationFiles,peer,quote,inspect} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {fixture} from './protected-fixture.ts';
if(process.argv.includes('--dispose')){
 const receipt=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--dispose')+1],'utf8'));
 if(receipt.taskId!=='P0-05')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 dropTemporary(receipt);console.log('OWNED_P0_05_DISPOSED');process.exit(0);
}
const owned=createTemporary('P0-05');let validationOwner;
const prefix=process.argv.includes('--prefix36')?36:process.argv.includes('--prefix35')?35:process.argv.includes('--prefix34')?34:process.argv.includes('--prefix33')?33:30;
try{
 let historical;
 const keys=new LocalSyntheticKeyProvider();
 if(process.argv.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,prefix));await seed(owned.receipt);
  const catalog=await openCatalog(validationOwner?.connectionString??resolveTarget(owned.receipt),keys);
  try{
   const f=await fixture(catalog,{businessKey:prefix>=36}),field=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:f.contract.id,versionId:f.contract.versionId}))[0].definition.fields[0].code;
   for(const permission of ['STORE','READ'])peer(owned.receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
   const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{...f.create,input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V1'}}},Buffer.from(field+'\n0012'));
   historical={file,job:await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:file.job.id}),bytes:field+'\n0012'};
   if(prefix>=33){
    const parse={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId};
    const parsed=await catalog.parseFile('maker',parse);
    historical.input={...parse,requestId:randomUUID(),outputRequestId:randomUUID(),artifactId:parsed.artifact.artifactId};
    historical.run=await catalog.validateRevision('maker',historical.input);
    historical.explain=await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:historical.run.runId});
   }
  }finally{await catalog.close();}
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 validationOwner=await createValidationOwnerSession(owned.receipt);
 if(historical){
  const catalog=await openCatalog(validationOwner?.connectionString??resolveTarget(owned.receipt),keys);
  try{
   assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:historical.file.job.id}),historical.job);
   const bytes=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:historical.file.artifact.artifactId});
   assert.equal(Buffer.from(bytes).toString(),historical.bytes);
   if(prefix===30)assert.equal(peer(owned.receipt.name,'SELECT count(*) FROM governance_catalog.parse_provenance;'),'0');
   if(historical.run){
    assert.deepEqual(await catalog.validateRevision('maker',historical.input),historical.run);
    assert.deepEqual(await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:historical.run.runId}),historical.explain);
    await assert.rejects(catalog.validateRevision('maker',{...historical.input,requestId:randomUUID()}),error=>error instanceof Error && error.message==='REQUEST_CONFLICT');
    if(prefix===35){
     const original=historical.job.contract;
     const validation=await catalog.contractCommand('maker',{action:'VALIDATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'LEGACY_KEY_CHECK',target:original.id,expectedHead:original.head});
     assert.ok(validation.blockers.includes('BUSINESS_KEY_REQUIRED'));
     await assert.rejects(catalog.contractCommand('reviewer',{action:'APPROVE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'LEGACY_KEY_CHECK',target:original.id,expectedHead:validation.head,reviewDigest:validation.reviewDigest}),/CONTRACT_VALIDATION_BLOCKED/);
     const impact=await catalog.contractImpact('reviewer','SYNTHETIC',original.id,'RETIRE');
     await catalog.contractCommand('reviewer',{action:'RETIRE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'LEGACY_CLOSE',target:original.id,expectedHead:validation.head,reviewDigest:validation.reviewDigest,impactDigest:impact.impactDigest});
     assert.deepEqual(await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:historical.run.runId}),historical.explain);
     console.log('LEGACY_KEYLESS_PUBLICATION_BLOCKED_RETIRE_AND_HISTORY_ALLOWED');
    }
   }
   console.log(`PREFIX_${prefix}_JOB_FILE_AND_EXISTING_RUN_PRESERVED`);
  }finally{await catalog.close();}
 }
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.validation.config.ts','tooling/vnext/validation-owner.test.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:validationOwner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-05'},stdio:'inherit',windowsHide:true});
 process.exitCode=run.status??1;
 if(run.status===0&&process.argv.includes('--types')){
  for(const command of ['types-generate','types-verify']){
   const generated=spawnSync(process.execPath,['tooling/vnext/managed.mjs',command,owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
   if(generated.status!==0)throw new Error('VALIDATION_CODEGEN_FAILED');
  }
 }
 const observation=await inspect(owned.receipt);
 console.log(JSON.stringify({gate:'P0-05',mode:historical?`PREFIX_${prefix}`:'FRESH',exit:run.status,migrations:observation.ledger.length,tables:observation.tables.length,receipt:owned.receiptPath}));
}catch(error){validationOwner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(validationOwner)dropValidationOwnerSession(validationOwner);}
