import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {removeValidationKeys} from './p3-01-validation-keys.mjs';
const args=process.argv.slice(2);if(args.some(a=>!['--upgrade','--generate','--ddl-only','--focused','--history'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P3-01');let session;
try{
 let before,tables,digest;
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,151));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);
  peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  assert.equal(spawnSync(process.execPath,['--import','tsx','tooling/vnext/p3-01-upgrade-fixture.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-01'},stdio:'inherit',windowsHide:true}).status,0);
  before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,151),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({gate:'P3-01_UPGRADE',prefix:151,status:'PRESERVED'}));}
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 for(const command of [['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],['tooling/vnext/authority.mjs',owned.receiptPath]])assert.equal(spawnSync(process.execPath,command,{stdio:'inherit',windowsHide:true}).status,0);
 if(!args.includes('--ddl-only')){
  session??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p3-01-db.config.ts',...(args.includes('--history')?['-t','original accepted']:args.includes('--focused')?['-t','AC-04']:[])],{env:{...process.env,VNEXT_P3_01_POPULATED:before?'1':'0',VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-01'},stdio:'inherit',windowsHide:true});process.exitCode=run.status??1;
 }
 console.log(JSON.stringify({gate:'P3-01',mode:args.includes('--upgrade')?'151_TO_CURRENT':'FRESH',migrationCount:(await inspect(owned.receipt)).ledger.length,exit:process.exitCode??0}));
}catch(error){session??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
