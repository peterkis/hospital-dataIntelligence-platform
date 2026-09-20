import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantOrganization as grantOriginal} from './p1-01-validate.mjs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,root,resolveTarget,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
export function grantOrganization(receipt,role){
 if(!/^hdi_(validation|owner)_[a-f0-9]{16}$/.test(role))throw new Error('ROLE_INVALID');
 peer(receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.campus_division(text,jsonb,timestamp,timestamp) TO ${role}; GRANT USAGE ON SCHEMA organization_master TO ${role}; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA organization_master TO ${role}; GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb) TO ${role};
 INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000'::uuid,'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;`);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/p1-02-validate.mjs')){
 const args=process.argv.slice(2);if(args.some(a=>!['--generate','--upgrade','--upgrade-57','--upgrade-58','--upgrade-59','--upgrade-60'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
 const prefix=args.includes('--upgrade-60')?60:args.includes('--upgrade-59')?59:args.includes('--upgrade-58')?58:args.includes('--upgrade-57')?57:56;const upgrading=args.includes('--upgrade')||args.includes('--upgrade-57')||args.includes('--upgrade-58')||args.includes('--upgrade-59')||args.includes('--upgrade-60');
 const owned=createTemporary('P1-02');let owner;
 try{
  let before,beforeLedger,tables;
  if(upgrading){
   await migrate(owned.receipt,migrationFiles().slice(0,prefix));await seed(owned.receipt);owner=await createValidationOwnerSession(owned.receipt);grantOriginal(owned.receipt,owner.receipt.role);if(prefix>=57)grantOrganization(owned.receipt,owner.receipt.role);
   const prefixRun=spawnSync(process.execPath,['--import','tsx','tooling/vnext/p1-02-prefix.ts'],{cwd:root,env:{...process.env,VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_UPGRADE_PREFIX:String(prefix)},stdio:'inherit',windowsHide:true});assert.equal(prefixRun.status,0);beforeLedger=(await inspect(owned.receipt)).ledger;tables=predecessorTables((await inspect(owned.receipt)).tables);before=predecessorDigest(owned.receipt,tables);
  }
  await migrate(owned.receipt);await seed(owned.receipt);
  if(before){assert.equal(predecessorDigest(owned.receipt,tables),before);assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,prefix),beforeLedger);console.log(JSON.stringify({status:'PREFIX_DATA_PRESERVED',prefix,digest:before}));}
  if(upgrading&&prefix===57)assert.equal(peer(owned.receipt.name,`SELECT has_function_privilege('${owner.receipt.role}','organization_master.campus_list(text,uuid,integer,timestamp)','EXECUTE');`),'t','existing service EXECUTE grant survives signature replacement');
  if(upgrading&&prefix===58){
   for(const fn of ['plan_input_for','withdraw_for'])assert.equal(peer(owned.receipt.name,`SELECT has_function_privilege('${owner.receipt.role}','organization_master.${fn}(text,uuid,uuid,text)','EXECUTE');`),'t');
   const legacyCheck=spawnSync(process.execPath,['--import','tsx','tooling/vnext/p1-02-legacy-condition-check.ts'],{cwd:root,env:{...process.env,VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath},stdio:'inherit',windowsHide:true});assert.equal(legacyCheck.status,0);
  }
  const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs',args.includes('--generate')?'types-generate':'types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});if(types.status!==0)throw new Error('P1_02_CODEGEN_FAILED');
  owner??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,owner.receipt.role);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p1-02-db.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P1-02'},stdio:'inherit',windowsHide:true});
  process.exitCode=run.status??1;console.log(JSON.stringify({gate:'P1-02',exit:run.status,receipt:owned.receiptPath,migrations:(await inspect(owned.receipt)).ledger.length,mode:upgrading?`${prefix}_TO_CURRENT`:'FRESH'}));
 }catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
