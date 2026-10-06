import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer,quote,identitySQL} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {seed} from './catalog-seed.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {removeValidationKeys} from './p3-05-validation-keys.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import {disposeWardNursingValidation} from './p3-05-disposal.mjs';
const args=process.argv.slice(2);if(args[0]==='--dispose'){
 if(args.length!==2||!/^\.runtime\/vnext\/fresh\/hdi_mc_vnext_[a-f0-9]{16}\.json$/.test(args[1]))throw new Error('CLOSED_COMMAND_REQUIRED');const previous=JSON.parse(readFileSync(args[1],'utf8'));console.log(JSON.stringify(disposeWardNursingValidation(previous)));process.exit(0);
}if(args.some(a=>!['--generate','--upgrade'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P3-05');let session;
const run=(command,environment={})=>spawnSync(process.execPath,command,{env:{...process.env,...environment},stdio:'inherit',windowsHide:true});
const grant=()=>{grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);};
const environment=()=>({VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-05'});
const rowHashes=tables=>{
 const queries=tables.map(table=>{if(!/^(vnext_control|governance_catalog|organization_master|department_master|location_master|care_organization)\.[a-z_]+$/.test(table))throw new Error('PRESERVATION_TABLE_INVALID');return `SELECT ${quote(table)} name,coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex') ORDER BY to_jsonb(o)::text),'[]') hashes FROM ${table} o`;});
 return JSON.parse(peer(owned.receipt.name,'\\set QUIET on\n'+identitySQL(owned.receipt)+`SELECT jsonb_object_agg(name,hashes)::text FROM (${queries.join(' UNION ALL ')}) original_rows;`));
};
const keyDigest=()=>createHash('sha256').update(readFileSync('.runtime/vnext/p3-05/'+owned.receipt.name+'.secret.json')).digest('hex');
try{
 let before,tables,digest,originalRows,keysBefore;
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,196));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grant();
  assert.equal(run(['--import','tsx','tooling/vnext/p3-05-upgrade-fixture.ts'],environment()).status,0);
  before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);originalRows=rowHashes(tables);keysBefore=keyDigest();
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){
  const after=await inspect(owned.receipt);assert.deepEqual(after.ledger.slice(0,196),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);assert.deepEqual(rowHashes(tables),originalRows);assert.equal(keyDigest(),keysBefore);
  assert.equal(run(['--import','tsx','tooling/vnext/p3-05-upgrade-fixture.ts','--verify'],environment()).status,0);
  writeFileSync(owned.receiptPath+'.p3-05-upgrade.json',JSON.stringify({gate:'P3_05_POPULATED_0196_UPGRADE',status:'PASS',oid:owned.receipt.oid,predecessorPrefix:196,currentPrefix:after.ledger.length,oldLedgerPreserved:true,originalRowsPreserved:true,allOriginalColumnsPreserved:true,keyBytesPreserved:true,originalHistoriesPreserved:true,predecessorEvidence:owned.receiptPath+'.p3-05-predecessor.json',tablesChecked:tables.length,dataDigest:digest,originalRowHashes:originalRows,keyDigest:keysBefore,policy:'TEST POLICY ONLY',hospitalPolicy:'NOT_ADOPTED',clinicalReadiness:'NOT_READY',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
  console.log(JSON.stringify({gate:'P3-05_UPGRADE',prefix:196,status:'PRESERVED'}));
 }
 session??=await createValidationOwnerSession(owned.receipt);grant();
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 for(const command of [['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],['tooling/vnext/authority.mjs',owned.receiptPath]])assert.equal(run(command).status,0);
 for(const suite of ['tooling/vnext/p3-05-db.test.ts','tooling/vnext/p3-05-extended-db.test.ts']){
  const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',suite,'--config','tooling/vnext/vitest.p3-05-db.config.ts','--reporter=verbose'],{env:{...process.env,...environment(),VNEXT_P3_05_UPGRADED:before?'1':'0'},stdio:'inherit',windowsHide:true});
  if(result.status!==0){process.exitCode=result.status??1;break;}
 }
 process.exitCode??=0;
 console.log(JSON.stringify({gate:'P3-05',mode:before?'0196_TO_CURRENT':'FRESH',migrations:(await inspect(owned.receipt)).ledger.length,exit:process.exitCode}));
}catch(error){session??=error.ownerSession;throw error;}finally{dropTemporary(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
