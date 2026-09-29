import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,root,resolveTarget,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import databaseConfig from './vitest.p1-06-db.config.ts';
const args=process.argv.slice(2),fileArgs=args.filter(a=>a.startsWith('--test-file=')),testFile=fileArgs[0]?.slice('--test-file='.length);
if(fileArgs.length>1||args.some(a=>!['--generate','--upgrade'].includes(a)&&!fileArgs.includes(a))||(fileArgs.length&&(!testFile||!databaseConfig.test.include.includes(testFile))))throw new Error('CLOSED_COMMAND_REQUIRED');
const prefix=70,addedColumns={};
// Each file creates its own provider and authorization fixtures. Sharing one
// database across files mixes unrelated key receipts and mutable grants.
async function validateFile(testFile){
const owned=createTemporary('P1-06');let owner;
try{
 let before,tables,digest;
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,prefix));await seed(owned.receipt);
  owner??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,owner.receipt.role);
  const seeded=spawnSync(process.execPath,['--import','tsx','tooling/vnext/p1-02-prefix.ts'],{cwd:root,env:{...process.env,VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_UPGRADE_PREFIX:String(prefix)},stdio:'inherit',windowsHide:true});assert.equal(seeded.status,0);

  before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables,addedColumns);
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){const after=await inspect(owned.receipt);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,prefix),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables,addedColumns),digest);console.log(JSON.stringify({status:'PREFIX_DATA_PRESERVED',prefix,digest}));}

 owner??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,owner.receipt.role);if(migrationFiles().length>=62)peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp) TO ${owner.receipt.role};`);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs',args.includes('--generate')?'types-generate':'types-verify',owned.receiptPath],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p1-06-db.config.ts',...(testFile?[testFile]:[])],{cwd:root,env:{...process.env,VNEXT_DATABASE_URL:resolveTarget(owned.receipt),VNEXT_VALIDATION_OWNER_URL:owner.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P1-06'},stdio:'inherit',windowsHide:true});
 if(run.status!==0)process.exitCode=run.status??1;
 console.log(JSON.stringify({gate:'P1-06',testFile,exit:run.status,receipt:owned.receiptPath,migrations:(await inspect(owned.receipt)).ledger.length}));
}catch(error){owner??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(owner)dropValidationOwnerSession(owner);}
}
for(const file of testFile?[testFile]:databaseConfig.test.include)await validateFile(file);
