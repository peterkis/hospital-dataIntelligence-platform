import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createTemporary} from './fresh.mjs';
import {disposeOwnedValidationDatabase} from './owned-validation-disposal.mjs';
import {createValidationOwnerSession,dropValidationOwnerSession} from './validation-owner-session.mjs';
import {migrate,migrationFiles,inspect,peer} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {grantOrganization} from './p1-02-validate.mjs';
import {grantDepartment} from './p2-01-validate.mjs';
import {removeValidationKeys} from './p3-02-validation-keys.mjs';
const args=process.argv.slice(2);
if(args.length===2&&args[0]==='--cleanup-database'){
 const receiptPath=args[1],receipt=JSON.parse(readFileSync(receiptPath,'utf8'));if(receipt.taskId!=='P3-02'||receipt.purpose!=='TEMPORARY_VALIDATION'||receipt.oid==='206108')throw new Error('DATABASE_DISPOSAL_NOT_AUTHORIZED');
 const owners=readdirSync('.runtime/vnext/fresh').filter(name=>/^hdi_validation_[a-f0-9]{16}\.json$/.test(name)).map(name=>({receiptPath:'.runtime/vnext/fresh/'+name,receipt:JSON.parse(readFileSync('.runtime/vnext/fresh/'+name,'utf8'))})).filter(owner=>owner.receipt.taskId==='P3-02'&&owner.receipt.database===receipt.name&&owner.receipt.databaseOid===receipt.oid);
 disposeOwnedValidationDatabase(receipt);for(const owner of owners)dropValidationOwnerSession(owner);removeValidationKeys(receipt);
 console.log(JSON.stringify({gate:'P3-02_OWNED_DATABASE_CLEANUP',status:'PASS',database:receipt.name,oid:receipt.oid,owners:owners.map(owner=>owner.receipt.role)}));process.exit(0);
}
if(args.length===2&&args[0]==='--cleanup-owner'){
 const receiptPath=args[1],receipt=JSON.parse(readFileSync(receiptPath,'utf8'));if(receipt.taskId!=='P3-02')throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
 dropValidationOwnerSession({receipt,receiptPath});removeValidationKeys(JSON.parse(readFileSync('.runtime/vnext/fresh/'+receipt.database+'.json','utf8')));
 console.log(JSON.stringify({gate:'P3-02_OWNED_CLEANUP',status:'PASS',role:receipt.role}));process.exit(0);
}
if(args.some(a=>!['--upgrade','--ward-upgrade','--generate','--ddl-only','--focused','--review-fixes','--scope-fix','--rebind-fix','--accepted-fix','--closure-fix','--ended-fix'].includes(a)))throw new Error('CLOSED_COMMAND_REQUIRED');
const owned=createTemporary('P3-02');let session;
try{
 let before,tables,digest;const predecessor=args.includes('--ward-upgrade')?167:165;
 if(args.includes('--upgrade')||args.includes('--ward-upgrade')){
  await migrate(owned.receipt,migrationFiles().slice(0,predecessor));await seed(owned.receipt);
  session=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);
  peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  assert.equal(spawnSync(process.execPath,['--import','tsx',args.includes('--ward-upgrade')?'tooling/vnext/p3-02-impact-upgrade-fixture.ts':'tooling/vnext/p3-02-upgrade-fixture.ts'],{env:{...process.env,VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-02'},stdio:'inherit',windowsHide:true}).status,0);
  before=await inspect(owned.receipt);tables=predecessorTables(before.tables);digest=predecessorDigest(owned.receipt,tables);
 }
 await migrate(owned.receipt);await seed(owned.receipt);
 if(before){assert.deepEqual((await inspect(owned.receipt)).ledger.slice(0,predecessor),before.ledger);assert.equal(predecessorDigest(owned.receipt,tables),digest);console.log(JSON.stringify({gate:'P3-02_UPGRADE',prefix:predecessor,status:'PRESERVED'}));}
 if(args.includes('--generate'))assert.equal(spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-generate',owned.receiptPath],{stdio:'inherit',windowsHide:true}).status,0);
 for(const command of [['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],['tooling/vnext/authority.mjs',owned.receiptPath]])assert.equal(spawnSync(process.execPath,command,{stdio:'inherit',windowsHide:true}).status,0);
 if(!args.includes('--ddl-only')){
  session??=await createValidationOwnerSession(owned.receipt);grantOrganization(owned.receipt,session.receipt.role);grantDepartment(owned.receipt,session.receipt.role);peer(owned.receipt.name,`GRANT EXECUTE ON FUNCTION governance_catalog.operating_catalog(text,jsonb,timestamp,timestamp,timestamp),governance_catalog.department_lifecycle_assessment(text,text) TO ${session.receipt.role};`);
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tooling/vnext/vitest.p3-02-db.config.ts',...(args.includes('--ended-fix')?['-t','ended Ward source references|future evolution excludes']:args.includes('--closure-fix')?['-t','finite Ward can permanently close']:args.includes('--accepted-fix')?['-t','exact accepted Department']:args.includes('--rebind-fix')?['-t','committed REBIND disposition']:args.includes('--scope-fix')?['-t','requested governance scope']:args.includes('--focused')?['-t','explicitly published']:args.includes('--review-fixes')?['-t','finite latest|committed REBIND|management coverage|ten-domain|permanent closure|failed audit|unrelated unreadable|transaction R']:[])],{env:{...process.env,VNEXT_P3_02_POPULATED:before?'1':'0',VNEXT_P3_02_WARD_UPGRADED:args.includes('--ward-upgrade')?'1':'0',VNEXT_VALIDATION_OWNER_URL:session.connectionString,VNEXT_TEST_RECEIPT:owned.receiptPath,VNEXT_CONNECTION_STEP:'P3-02'},stdio:'inherit',windowsHide:true});process.exitCode=run.status??1;
 }
 console.log(JSON.stringify({gate:'P3-02',mode:before?predecessor+'_TO_CURRENT':'FRESH',migrationCount:(await inspect(owned.receipt)).ledger.length,exit:process.exitCode??0}));
}catch(error){session??=error.ownerSession;throw error;}finally{disposeOwnedValidationDatabase(owned.receipt);if(session)dropValidationOwnerSession(session);removeValidationKeys(owned.receipt);}
