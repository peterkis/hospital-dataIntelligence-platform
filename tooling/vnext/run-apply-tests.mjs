import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,root,resolveTarget,peer,quote} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';

const args=process.argv.slice(2);
if(args.some(a=>!['--upgrade','--generate'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P0-08');let owner;
try{
 let prefix;
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,49));await seed(owned.receipt);
  // A storage-only marker proves forward migration preserves an already frozen receipt.
  // It is not claimed as valid encrypted source evidence or an executable Owner candidate.
  const input={requestId:randomUUID(),jobId:randomUUID(),revisionId:randomUUID(),scope:'SYNTHETIC',campus:'NORTH',purpose:'IDENTITY_VERIFY'};
  const frozen=JSON.parse(peer(owned.receipt.name,`SELECT governance_catalog.apply_record('maker','FREEZE',${quote(JSON.stringify({input,digest:'1'.repeat(64),envelope:{kind:'PREFIX_STORAGE_MARKER'}}))}::jsonb);`));
  const observation=()=>peer(owned.receipt.name,`SELECT to_jsonb(c) FROM governance_catalog.apply_candidate c WHERE id=${quote(frozen.candidateId)}::uuid;`);
  prefix={input,frozen,observation,before:observation()};
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(prefix){
  assert.equal(prefix.observation(),prefix.before);
  assert.deepEqual(JSON.parse(peer(owned.receipt.name,`SELECT governance_catalog.apply_record('maker-alias','FROZEN_PRIOR',${quote(JSON.stringify({input:prefix.input}))}::jsonb);`)),prefix.frozen);
  console.log(JSON.stringify({gate:'P0-08-PREFIX-49-PRESERVATION',status:'PASS'}));
 }
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs',args.includes('--generate')?'types-generate':'types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});
 if(types.status!==0)throw new Error('P0_08_CODEGEN_FAILED');
 owner=await createValidationOwnerSession(owned.receipt);
 peer(owned.receipt.name,readFileSync('tooling/vnext/apply-owner-fixture.sql','utf8'));
 peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb) TO ${owner.receipt.role}; GRANT USAGE ON SCHEMA p0_08_owner TO ${owner.receipt.role}; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA p0_08_owner TO ${owner.receipt.role};`);
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.apply.config.ts'],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P0-08-APPLY'},stdio:'inherit',windowsHide:true});
 peer(owned.receipt.name,'DROP SCHEMA p0_08_owner CASCADE;');
 const observation=await inspect(owned.receipt);
 console.log(JSON.stringify({gate:'P0-08',exit:run.status,migrations:observation.ledger.length,receipt:owned.receiptPath,mode:args.includes('--upgrade')?'49_TO_50':'FRESH'}));
 process.exitCode=run.status??1;
}catch(error){owner??=error.ownerSession;throw error;}finally{
 // The fixture belongs exclusively to this owned database; disposal verifies identity and sessions.
 dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);
}
