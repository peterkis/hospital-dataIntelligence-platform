import {disposeOwnedValidationDatabase} from './owned-validation-disposal.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {runSourceDatabaseAuthorityCheck,assertMigrationDateTimeTypesAllowed,findForbiddenDatabaseColumns} from '../verification/src/check-database-authority.ts';
import {createTemporary} from './fresh.mjs';
import {migrate,migrationFiles,checkPrefix,resolveTarget,root} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');

// Keep the full source ownership scan shared with the existing checker. Its
// legacy live/type path is deliberately not the vNext database authority seam.
runSourceDatabaseAuthorityCheck();
const files=migrationFiles();
for(const file of files)assertMigrationDateTimeTypesAllowed(file.id,file.sql);
console.log(JSON.stringify({gate:'P3_07_SOURCE_AUTHORITY',status:'PASS',migrationDateTimeTypesChecked:true}));

const owned=createTemporary('P3-07');let currentPrefix;
const run=(arguments_,failure)=>{
 const result=spawnSync(process.execPath,arguments_,{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 // managed types-verify includes a full ledger in stdout. Consume its receipt
 // internally and emit only the bounded gate result, never the raw child output.
 if(result.status!==0)throw new Error(failure);
 let report;try{report=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));}catch{throw new Error(failure);}
 if(report?.status!=='PASS')throw new Error(failure);
 return report;
};
const disposeOwned=disposeOwnedValidationDatabase;
try{
 const observation=await migrate(owned.receipt,files);
 currentPrefix=checkPrefix(files,observation.ledger);assert.equal(currentPrefix,files.length);
 assert.equal(observation.identity.name,owned.receipt.name);assert.equal(observation.identity.oid,owned.receipt.oid);
 const ownership=JSON.parse(readFileSync(root+'/db/vnext/table-ownership.json','utf8'));assert.equal(ownership.lineage,'HDIP-MC-VNEXT');
 const pool=new Pool({connectionString:resolveTarget(owned.receipt),options:'-c default_transaction_read_only=on',application_name:'hdi-vnext-p3-07-authority',max:1});
 try{
  const identity=(await pool.query("select current_database() as name,d.oid::text as oid,pg_get_userbyid(d.datdba) as owner,inet_server_port() as port,current_user as role from pg_database d where d.datname=current_database()")).rows[0];
  assert.ok(identity);for(const key of ['name','oid','owner','port'])assert.equal(identity[key],owned.receipt[key]);assert.equal(identity.role,owned.receipt.owner);
  const forbidden=await findForbiddenDatabaseColumns((query,values)=>pool.query(query,[...values]),Object.keys(ownership.schemas));
  assert.deepEqual(forbidden,[],'Governance schemas contain forbidden date/time columns');
 }finally{await pool.end();}
 await seed(owned.receipt);
 const types=run(['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],'P3_07_TYPES_AUTHORITY_FAILED');
 assert.equal(types.command,'types-verify');assert.equal(types.identity.name,owned.receipt.name);assert.equal(types.identity.oid,owned.receipt.oid);
 const authority=run(['tooling/vnext/authority.mjs',owned.receiptPath],'P3_07_LINEAGE_AUTHORITY_FAILED');
 assert.equal(authority.lineage,'HDIP-MC-VNEXT');
}finally{disposeOwned(owned.receipt);}

// A disposal failure prevents this terminal PASS and leaves the target nonzero.
console.log(JSON.stringify({gate:'P3_07_AUTHORITY',status:'PASS',lineage:'HDIP-MC-VNEXT',currentPrefix,sourceOwnershipChecked:true,migrationDateTimeTypesChecked:true,readOnlyReceiptIdentityChecked:true,databaseDateTimeTypesChecked:true,forbiddenDatabaseTypeCount:0,generatedTypesVerified:true,databaseAuthorityVerified:true,ownedTemporaryDisposed:true,legacyDatabase:'LEGACY_OUT_OF_CURRENT_EXECUTION'}));
