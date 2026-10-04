import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
const args=process.argv.slice(2);if(args.some(a=>!['--upgrade','--generate','--ddl-only'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P3-06');let session;
try{
 let before,tables,digest;
 if(args.includes('--upgrade')){await migrate(owned.receipt,migrationFiles().slice(0,148));await seed(owned.receipt);peer(owned.receipt.name,"INSERT INTO department_master.department(id,code) VALUES('00000000-0000-7000-8000-000000000149','P3_06_PREFIX_IDENTITY');");before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);}
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,148),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({gate:'P3-06_UPGRADE',prefix:148,status:'PRESERVED'}));}
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 for(const command of [['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],['tooling/vnext/authority.mjs',owned.receiptPath]])assert.equal(spawnSync(process.execPath,command,{stdio:'inherit',windowsHide:true}).status,0);
 if(!args.includes('--ddl-only')){
  session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p3-06-db.config.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-06'},stdio:'inherit',windowsHide:true});process.exitCode=run.status??1;
 }
 console.log(JSON.stringify({gate:'P3-06',mode:args.includes('--upgrade')?'148_TO_CURRENT':'FRESH',migrationCount:(await inspect(owned.receipt)).ledger.length,exit:process.exitCode??0}));
}catch(error){session??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);}
