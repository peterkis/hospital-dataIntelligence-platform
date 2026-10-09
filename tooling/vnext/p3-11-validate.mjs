import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {removeValidationKeys} from './p3-11-validation-keys.mjs';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
import {captureP311Preservation,assertP311Preserved} from './p3-11-preservation.mjs';
import {disposeOwnedValidationDatabase} from './owned-validation-disposal.mjs';
const diagnosticCleanup=process.argv.includes('--cleanup-diagnostic'),recoveryPath=resolve(diagnosticCleanup?'.runtime/vnext/p3-11/diagnostic-recovery.json':'.runtime/vnext/p3-11/interrupted-run.json');
if(process.argv.includes('--cleanup-interrupted')||diagnosticCleanup){
 assert.deepEqual(process.argv.slice(2),[diagnosticCleanup?'--cleanup-diagnostic':'--cleanup-interrupted']);
 const interrupted=JSON.parse(readFileSync(recoveryPath,'utf8'));assert.match(interrupted.name,/^hdi_mc_vnext_[a-f0-9]{16}$/);const path=resolve('.runtime/vnext/fresh',interrupted.name+'.json'),receipt=JSON.parse(readFileSync(path,'utf8'));
 assert.equal(receipt.taskId,'P3-11');assert.equal(receipt.purpose,'TEMPORARY_VALIDATION');assert.equal(receipt.oid,interrupted.oid);assert.equal(receipt.requestId,interrupted.requestId);
 if(!existsSync(path.replace(/\.json$/,'.disposed.json')))disposeOwnedValidationDatabase(receipt);
 for(const file of readdirSync('.runtime/vnext/fresh').filter(n=>/^hdi_validation_[a-f0-9]{16}\.json$/.test(n))){const roleReceipt=JSON.parse(readFileSync(resolve('.runtime/vnext/fresh',file),'utf8'));if(roleReceipt.database===receipt.name&&roleReceipt.databaseOid===receipt.oid&&roleReceipt.databaseRequestId===receipt.requestId)dropValidationOwnerSession({receipt:roleReceipt,receiptPath:resolve('.runtime/vnext/fresh',file)});}
 removeValidationKeys(receipt);console.log(JSON.stringify({gate:'P3_11_INTERRUPTED_VALIDATION_CLEANUP',status:'PASS',name:receipt.name,oid:receipt.oid}));process.exit(0);
}
const args=process.argv.slice(2);if(args.some(a=>!['--upgrade','--generate','--ddl-only','--baseline-205','--partial','--repartition','--move','--scope-move','--history','--entitlements','--physical','--paused','--handover','--diagnose-port','--future-end','--subtree','--future-repartition','--attribution','--nursing-activity','--same-cutover-repartition','--receipt-contracts','--finite-resume-read'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P3-11');let session;
try{
 let before,tables,digest,preservation;const keyPath='.runtime/vnext/p3-11/'+owned.receipt.name+'.secret.json';
 if(args.includes('--upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,205));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);
  peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  assert.equal(spawnSync(process.execPath,['--import','tsx','tooling/vnext/p3-11-upgrade-fixture.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-11'},stdio:'inherit',windowsHide:true}).status,0);
  before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);
  preservation=captureP311Preservation(owned.receipt,before,keyPath);writeFileSync(owned.receiptPath+'.p3-11-preservation-before.json',JSON.stringify(preservation,null,2),{flag:'wx'});
 }
 await migrate(owned.receipt,args.includes('--diagnose-port')?migrationFiles().slice(0,243):args.includes('--baseline-205')?migrationFiles().slice(0,205):migrationFiles());await seed(owned.receipt);
 if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,205),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({gate:'P3-11_UPGRADE',prefix:205,status:'PRESERVED'}));}
 if(preservation)assertP311Preserved(preservation,captureP311Preservation(owned.receipt,await inspect(owned.receipt),keyPath),{exactRows:true});
 if(before)assert.equal(spawnSync(process.execPath,['--import','tsx','tooling/vnext/p3-11-upgrade-fixture.ts','--verify'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-11'},stdio:'inherit',windowsHide:true}).status,0);
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 for(const command of args.includes('--baseline-205')||args.includes('--diagnose-port')?[]:[['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],['tooling/vnext/authority.mjs',owned.receiptPath]])assert.equal(spawnSync(process.execPath,command,{stdio:'inherit',windowsHide:true}).status,0);
   if(args.includes('--diagnose-port')){if(!args.includes('--ddl-only'))throw new Error('CLOSED_COMMAND_REQUIRED');console.log(peer(owned.receipt.name,`SELECT json_build_object('gate','P3_11_OWNED_PORT_BASELINE','guard',substring(body FROM greatest(position('IF EXISTS(SELECT 1 FROM care_organization.lifecycle_input' IN body),1) FOR 900)) FROM (SELECT pg_get_functiondef('governance_catalog.apply_record(text,text,jsonb)'::regprocedure) body) source;`));}
if(!args.includes('--ddl-only')){
  session??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p3-11-db.config.ts',...(args.includes('--finite-resume-read')?['tooling/vnext/p3-11-db.test.ts','-t','endpoint impacts retain']:args.includes('--receipt-contracts')?['tooling/vnext/p3-11-db.test.ts','-t','endpoint impacts retain|unended coverage|scope repartition|scheduled source END']:args.includes('--same-cutover-repartition')?['tooling/vnext/p3-11-db.test.ts','-t','"safeEnded":true']:args.includes('--nursing-activity')?['tooling/vnext/p3-11-db.test.ts','-t','explicitly approved Nursing resume']:args.includes('--attribution')?['tooling/vnext/p3-11-move-db.test.ts','-t','attribution|AC03']:args.includes('--future-repartition')?['tooling/vnext/p3-11-db.test.ts','-t','scheduledEnd\":true']:args.includes('--future-end')?['tooling/vnext/p3-11-db.test.ts','-t','scheduled source END']:args.includes('--subtree')?['tooling/vnext/p3-11-move-db.test.ts','-t','explicitly revalidated subtree']:args.includes('--handover')?['tooling/vnext/p3-11-db.test.ts','-t','whole handover|safe END']:args.includes('--paused')?['tooling/vnext/p3-11-move-db.test.ts','-t','AC03']:args.includes('--physical')?['tooling/vnext/p3-11-move-db.test.ts','-t','finite physical|physical producer|Nursing suspended binding']:args.includes('--entitlements')?['tooling/vnext/p3-11-entitlement-db.test.ts']:args.includes('--history')?['tooling/vnext/p3-11-move-db.test.ts','-t','lifecycle history at R']:args.includes('--scope-move')?['tooling/vnext/p3-11-db.test.ts','-t','scope repartition moves']:args.includes('--move')?['tooling/vnext/p3-11-move-db.test.ts']:args.includes('--repartition')?['tooling/vnext/p3-11-db.test.ts','-t','scope repartition']:args.includes('--partial')?['tooling/vnext/p3-11-db.test.ts','-t','partial handover']:[])],{env:{...process.env,VNEXT_P3_11_POPULATED:before?'1':'0',VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-11'},stdio:'inherit',windowsHide:true});process.exitCode=run.status??1;
 }
 if(preservation){const result=assertP311Preserved(preservation,captureP311Preservation(owned.receipt,await inspect(owned.receipt),keyPath));writeFileSync(owned.receiptPath+'.p3-11-preservation-after.json',JSON.stringify({gate:'P3_11_UPGRADE_PRESERVATION',status:'PASS',...result},null,2),{flag:'wx'});}
 console.log(JSON.stringify({gate:'P3-11',mode:args.includes('--upgrade')?'205_TO_CURRENT':'FRESH',migrationCount:(await inspect(owned.receipt)).ledger.length,exit:process.exitCode??0}));
}catch(error){session??=error.ownerSession;throw error;}finally{disposeOwnedValidationDatabase(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
