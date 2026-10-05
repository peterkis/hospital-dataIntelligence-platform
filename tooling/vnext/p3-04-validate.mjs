import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {seed} from './catalog-seed.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {removeValidationKeys} from './p3-04-validation-keys.mjs';
import {readFileSync} from 'node:fs';
const args=process.argv.slice(2);if(args[0]==='--dispose'){
 if(args.length!==2||!/^\.runtime\/vnext\/fresh\/hdi_mc_vnext_[a-f0-9]{16}\.json$/.test(args[1]))throw new Error('CLOSED_COMMAND_REQUIRED');const previous=JSON.parse(readFileSync(args[1],'utf8'));if(previous.taskId!=='P3-04'||previous.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');dropTemporary(previous);removeValidationKeys(previous);console.log(JSON.stringify({gate:'P3_04_OWNED_FAILURE_CLEANUP',status:'PASS',name:previous.name}));process.exit(0);
}if(args.some(a=>!['--generate','--upgrade','--source-fix'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P3-04');let session;
const run=(command,environment={})=>spawnSync(process.execPath,command,{env:{...process.env,...environment},stdio:'inherit',windowsHide:true});
const grant=()=>{grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);};
const environment=()=>({VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-04'});
try{
 let before,tables,digest;
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,185));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grant();
  assert.equal(run(['--import','tsx','tooling/vnext/p3-04-upgrade-fixture.ts'],environment()).status,0);
  before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,185),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({gate:'P3-04_UPGRADE',prefix:185,status:'PRESERVED'}));}
 session??=await createValidationOwnerSession(owned.receipt);grant();
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 for(const command of [['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],['tooling/vnext/authority.mjs',owned.receiptPath]])assert.equal(run(command).status,0);
 const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p3-04-db.config.ts',...(args.includes('--source-fix')?['-t','independent relation source version']:[])],{env:{...process.env,...environment(),VNEXT_P3_04_UPGRADED:before?'1':'0'},stdio:'inherit',windowsHide:true});
 process.exitCode=result.status??1;
 console.log(JSON.stringify({gate:'P3-04',mode:before?'0185_TO_CURRENT':'FRESH',migrations:(await inspect(owned.receipt)).ledger.length,exit:process.exitCode}));
}catch(error){session??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
