import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,root,resolveTarget,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
export function grantOrganization(receipt,role){
 if(!/^hdi_(validation|owner)_[a-f0-9]{16}$/.test(role))throw new Error('ROLE_INVALID');
 peer(receipt.name,`GRANT USAGE ON SCHEMA organization_master TO ${role}; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA organization_master TO ${role}; GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb) TO ${role};
 INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000'::uuid,'NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','REVIEW','READ_RESTRICTED']) p ON CONFLICT DO NOTHING;`);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/p1-01-validate.mjs')){
 const args=process.argv.slice(2);if(args.some(a=>!['--generate','--upgrade'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
 const owned=createTemporary('P1-01');let owner;
 try{
  let before;
  if(args.includes('--upgrade')){await migrate(owned.receipt,migrationFiles().slice(0,53));await seed(owned.receipt);before=peer(owned.receipt.name,'SELECT row_to_json(t) FROM (SELECT count(*) objects FROM governance_catalog.object) t;');}
  await migrate(owned.receipt);await seed(owned.receipt);
  if(before)assert.equal(peer(owned.receipt.name,'SELECT row_to_json(t) FROM (SELECT count(*) objects FROM governance_catalog.object) t;'),before);
  const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs',args.includes('--generate')?'types-generate':'types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});if(types.status!==0)throw new Error('P1_01_CODEGEN_FAILED');
  owner=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,owner.receipt.role);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p1-01-db.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P1-01'},stdio:'inherit',windowsHide:true});
  process.exitCode=run.status??1;console.log(JSON.stringify({gate:'P1-01',exit:run.status,receipt:owned.receiptPath,migrations:(await inspect(owned.receipt)).ledger.length,mode:args.includes('--upgrade')?'53_TO_54':'FRESH'}));
 }catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
