import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {root,resolveTarget,migrate,migrationFiles,peer,quote,inspect} from './lineage.mjs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {seed} from './catalog-seed.mjs';

if(process.argv.includes('--dispose')){
 const receipt=JSON.parse(readFileSync(process.argv[process.argv.indexOf('--dispose')+1],'utf8'));
 if(receipt.taskId!=='P0-06')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 dropTemporary(receipt);console.log('OWNED_P0_06_DISPOSED');process.exit(0);
}

const owned=createTemporary('P0-06');let validationOwner;
try{
 let prefix=process.argv.includes('--prefix46')?46:process.argv.includes('--prefix45')?45:process.argv.includes('--prefix44')?44:process.argv.includes('--prefix43')?43:process.argv.includes('--prefix42')?42:process.argv.includes('--prefix41')?41:process.argv.includes('--prefix40')?40:process.argv.includes('--prefix39')?39:process.argv.includes('--prefix38')?38:37;
 let historical; let historicalKeys;
 if(process.argv.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,prefix));await seed(owned.receipt);
  if(prefix>=40)validationOwner=await createValidationOwnerSession(owned.receipt);
  const {openCatalog,LocalSyntheticKeyProvider}=await import('../../apps/governance-api/src/modules/governance-catalog/index.ts');
  const {fixture}=await import('./protected-fixture.ts');
  historicalKeys=new LocalSyntheticKeyProvider();
  const catalog=await openCatalog(validationOwner?.connectionString??resolveTarget(owned.receipt),historicalKeys);
  try{
   const f=await fixture(catalog,{businessKey:true,textField:true});
   for(const permission of ['STORE','READ'])peer(owned.receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`);
   const contract=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'HISTORY',target:f.contract.id,versionId:f.contract.versionId}))[0];
   const field=contract.definition.fields[0].code;
   const bytes=Buffer.from(`${field}\nUPGRADE_HISTORY`);
   const file=await catalog.receiveFile('maker',{campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,fileRequestId:randomUUID(),extension:'.csv',job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'UPGRADE_HISTORY',contractId:f.contract.id,contractVersionId:f.contract.versionId,profile:'CORE',input:{kind:'FILE',format:'CSV',parserPolicy:'STRICT_V2'}}},bytes);
   const parseInput={scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',retentionSeconds:3600,requestId:randomUUID(),outputRequestId:randomUUID(),jobId:file.job.id,revisionId:file.job.revisionId,artifactId:file.artifact.artifactId};
   const parsed=await catalog.parseFile('maker',parseInput);
   const validateInput={...parseInput,requestId:randomUUID(),outputRequestId:randomUUID(),artifactId:parsed.artifact.artifactId};
   const run=await catalog.validateRevision('maker',validateInput);
   historical={job:await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:file.job.id}),file,bytes,validateInput,run,explain:await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:run.runId})};
  }finally{await catalog.close();}
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(!validationOwner)validationOwner=await createValidationOwnerSession(owned.receipt,{failAfterRoleCreation:process.argv.includes('--owner-failure-probe')});
 for(const command of ['types-generate','types-verify']){
  const generated=spawnSync(process.execPath,['tooling/vnext/managed.mjs',command,owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
  if(generated.status!==0)throw new Error('P0_06_CODEGEN_FAILED');
 }
 if(historical){
  const {openCatalog,LocalSyntheticKeyProvider}=await import('../../apps/governance-api/src/modules/governance-catalog/index.ts');
  const catalog=await openCatalog(validationOwner?.connectionString??resolveTarget(owned.receipt),historicalKeys);
  try{
   assert.deepEqual(await catalog.importJobRead('maker',{scope:'SYNTHETIC',jobId:historical.job.id}),historical.job);
   const bytes=await catalog.authorizeSensitiveRead('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:historical.file.artifact.artifactId});
   assert.deepEqual(Buffer.from(bytes),historical.bytes);
   assert.deepEqual(await catalog.validateRevision('maker',historical.validateInput),historical.run);
   assert.deepEqual(await catalog.explainIssue('maker',{scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY',runId:historical.run.runId}),historical.explain);
   console.log(`PREFIX_${prefix}_HISTORY_AND_RAW_FILE_PRESERVED`);
  }finally{await catalog.close();}
 }
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.quality.config.ts','tooling/vnext/quality-owner.test.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:validationOwner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_RUN_ID:randomUUID(),VNEXT_CONNECTION_STEP:'P0-06-QUALITY'},stdio:'inherit',windowsHide:true});
 const observation=await inspect(owned.receipt);
 console.log(JSON.stringify({gate:'P0-06',mode:process.argv.includes('--upgrade')?'UPGRADE':'FRESH',exit:run.status,migrations:observation.ledger.length,tables:observation.tables.length,receipt:owned.receiptPath}));
 process.exitCode=run.status??1;
}catch(error){validationOwner??=error.ownerSession;if(process.argv.includes('--owner-failure-probe')&&error.message==='TEST_OWNER_RECEIPT_FAILURE'&&validationOwner?.receipt.roleOid){console.log('OWNER_RECEIPT_FAILURE_REPRODUCED');}else throw error;}finally{dropTemporary(owned.receipt);if(validationOwner)dropValidationOwnerSession(validationOwner);}
