import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary} from './fresh.mjs';
import {migrate,peer,migrationFiles,inspect} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {disposeOwnedValidationDatabase} from './owned-validation-disposal.mjs';
import {removeValidationKeys} from './p3-10-validation-keys.mjs';
import {captureP311Preservation,assertP311Preserved} from './p3-11-preservation.mjs';
import {provisionCareLifecycle} from './p3-11-provisioning.mjs';
import {provisionCareWorkspace} from './p3-10-provisioning.mjs';
import {writeFileSync} from 'node:fs';
const args=process.argv.slice(2);if(args.some(arg=>!['--upgrade','--generate'].includes(arg))||new Set(args).size!==args.length)throw new Error('CLOSED_COMMAND_REQUIRED');
const releaseFiles=migrationFiles(),owned=createTemporary('P3-10');let session;
try{
 let before;const keyPath='.runtime/vnext/p3-10/'+owned.receipt.name+'.secret.json';
 const run=(file,extra=[])=>{const result=spawnSync(process.execPath,['--import','tsx',file,...extra],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-10',GOMAXPROCS:'1'},stdio:'inherit',windowsHide:true});assert.equal(result.status,0,'P3_10_SUBCHECK_FAILED:'+file);};
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,releaseFiles.slice(0,252));await seed(owned.receipt);session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);provisionCareLifecycle(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  run('tooling/vnext/p3-10-upgrade-fixture.ts');before=captureP311Preservation(owned.receipt,await inspect(owned.receipt),keyPath);writeFileSync(owned.receiptPath+'.p3-10-before.json',JSON.stringify(before,null,2),{flag:'wx'});
 }
 const installed=await migrate(owned.receipt,releaseFiles);await seed(owned.receipt);writeFileSync(owned.receiptPath+'.p3-10-installed.json',JSON.stringify({prefix:releaseFiles.length,ledger:installed.ledger},null,2),{flag:'wx'});
 if(before){assertP311Preserved(before,captureP311Preservation(owned.receipt,await inspect(owned.receipt),keyPath),{exactRows:true});provisionCareWorkspace(owned.receipt,session.receipt.role);run('tooling/vnext/p3-10-upgrade-fixture.ts',['--verify']);}
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'ignore',windowsHide:true}).status,0,'P3_10_TYPES_GENERATE_FAILED');
 for(const [file,arguments_] of [['tooling/vnext/managed.mjs',['types-verify',owned.receiptPath]],['tooling/vnext/authority.mjs',[owned.receiptPath]]])assert.equal(spawnSync(process.execPath,[file,...arguments_],{stdio:'ignore',windowsHide:true}).status,0,'P3_10_AUTHORITY_FAILED:'+file);
 session??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
 const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p3-10-db.config.ts','--reporter=verbose'],{env:{...process.env,VNEXT_P3_10_POPULATED:before?'1':'0',VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-10',GOMAXPROCS:'1'},stdio:'inherit',windowsHide:true});
 assert.equal(result.status,0,'P3_10_DATABASE_TESTS_FAILED');
 if(before){const after=assertP311Preserved(before,captureP311Preservation(owned.receipt,await inspect(owned.receipt),keyPath));writeFileSync(owned.receiptPath+'.p3-10-after.json',JSON.stringify({gate:'P3_10_0252_PRESERVATION',status:'PASS',...after},null,2),{flag:'wx'});}
 console.log(JSON.stringify({gate:'P3_10_DATABASE_ACCEPTANCE',mode:before?'POPULATED_0252_TO_CURRENT':'FRESH',status:'PASS',prefix:releaseFiles.length,requiredTestsSkipped:false}));
}catch(error){session??=error.ownerSession;throw error;}
finally{disposeOwnedValidationDatabase(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
