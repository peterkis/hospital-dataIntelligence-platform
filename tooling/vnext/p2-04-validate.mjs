import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {createFinitePrefixDepartment,verifyFinitePrefixDepartment} from './p2-04-prefix-periods.ts';

export function grantOrganizationIdentifierFunctions(receipt,role){
 if(!/^hdi_(validation|owner)_[a-f0-9]{16}$/.test(role))throw new Error('ROLE_INVALID');
 grantDepartment(receipt,role);grantOrganization(receipt,role);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/p2-04-validate.mjs')){
 const args=process.argv.slice(2);
 if(args[0]==='--dispose'&&args.length===2){const receipt=JSON.parse(readFileSync(args[1],'utf8'));if(receipt.taskId!=='P2-04')throw new Error('DISPOSAL_NOT_AUTHORIZED');dropTemporary(receipt);process.exit(0);}
 if(args.some(a=>!['--generate','--upgrade','--upgrade-periods'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
 const prefix=args.includes('--upgrade')||args.includes('--upgrade-periods')?114:null;
 const owned=createTemporary('P2-04');let owner;
 try{
  let before,tables,digest,finite;
  if(prefix){await migrate(owned.receipt,migrationFiles().slice(0,prefix));await seed(owned.receipt);peer(owned.receipt.name,"INSERT INTO department_master.department(id,code) VALUES('00000000-0000-7000-8000-000000000112','P2_04_PREFIX_IDENTITY');");before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);}
  if(args.includes('--upgrade-periods')){owner=await createValidationOwnerSession(owned.receipt);grantOrganizationIdentifierFunctions(owned.receipt,owner.receipt.role);finite=await createFinitePrefixDepartment(owned.receipt,owner.connectionString);before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);}
  await migrate(owned.receipt);await seed(owned.receipt);
  if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,prefix),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({status:'PREFIX_DATA_PRESERVED',prefix}));}
  owner??=await createValidationOwnerSession(owned.receipt);grantOrganizationIdentifierFunctions(owned.receipt,owner.receipt.role);
  if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
  assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
  if(finite){await verifyFinitePrefixDepartment(owner.connectionString,finite);console.log(JSON.stringify({gate:'P2-04',exit:0,mode:'114_FINITE_PERIOD_TO_CURRENT'}));}
  else{const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p2-04-db.config.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P2-04'},stdio:'inherit',windowsHide:true});
   process.exitCode=run.status??1;console.log(JSON.stringify({gate:'P2-04',exit:run.status,mode:prefix?prefix+'_TO_CURRENT':'FRESH'}));}
 }catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
