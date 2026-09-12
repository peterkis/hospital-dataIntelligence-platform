import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTemporary,dropTemporary } from './fresh.mjs';
import { migrate,migrationFiles,inspect,resolveTarget,peer,quote,root } from './lineage.mjs';
import { seed } from './catalog-seed.mjs';
import { runtime } from './catalog-runtime.mjs';

const owned=createTemporary();let catalog;let pool;
const checks=[];
try{
 const files=migrationFiles();
 await assert.rejects(inspect({...owned.receipt,oid:String(Number(owned.receipt.oid)+1)}),/RECEIPT_IDENTITY_MISMATCH/);
 await assert.rejects(inspect({...owned.receipt,name:'hdi_prototype'}),/RECEIPT_INVALID/);
 checks.push('PF03_LIVE_OID_MISMATCH','PF05_OLD_TARGET_REFUSAL');
 for(const [setup,cleanup] of [
  ['CREATE SCHEMA pgx;','DROP SCHEMA pgx;'],
  ["CREATE FUNCTION public.unexpected() RETURNS integer LANGUAGE sql AS 'SELECT 1';",'DROP FUNCTION public.unexpected();'],
  ["CREATE TYPE public.unexpected AS ENUM ('SYNTHETIC');",'DROP TYPE public.unexpected;'],
 ]){
  peer(owned.receipt.name,setup);
  await assert.rejects(inspect(owned.receipt),/UNKNOWN_/);
  await assert.rejects(migrate(owned.receipt),/UNKNOWN_/);
  peer(owned.receipt.name,cleanup);
 }
 checks.push('PF03_PUBLIC_FUNCTION_ENUM_AND_PGX_REFUSED');
 await migrate(owned.receipt,files.slice(0,1));
 peer(owned.receipt.name,"INSERT INTO vnext_control.actor VALUES('prefix-fixture','SYNTHETIC_PREFIX',true);");
 const prefix=await inspect(owned.receipt);
 const run=()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tooling/vnext/managed.mjs','migrate',owned.receiptPath],{cwd:root,env:process.env,stdio:'ignore',windowsHide:true});child.on('error',reject);child.on('exit',code=>code===0?resolve(code):reject(new Error('CONCURRENT_MIGRATION_FAILED')));});
 await Promise.all([run(),run()]);
 assert.equal((await inspect(owned.receipt)).ledger.length,files.length);
 assert.deepEqual((await inspect(owned.receipt)).ledger[0],prefix.ledger[0]);
 assert.equal(peer(owned.receipt.name,"SELECT count(*) FROM vnext_control.actor WHERE code='prefix-fixture';"),'1');
 checks.push('DB05_CONCURRENT_MIGRATION','DB08_PREFIX_PRESERVED');
 await assert.rejects(migrate(owned.receipt,[{...files[0],sha256:'0'.repeat(64)},...files.slice(1)]),/LINEAGE_MISMATCH/);
 await assert.rejects(migrate(owned.receipt,files.slice(0,1)),/LINEAGE_MISMATCH/);
 const fault={id:String(files.length+1).padStart(4,'0')+'_injected_fault',sha256:'f'.repeat(64),sql:'CREATE TABLE governance_catalog.fault_marker(id integer); SELECT 1/0;'};
 await assert.rejects(migrate(owned.receipt,[...files,fault]));
 assert.equal(peer(owned.receipt.name,"SELECT to_regclass('governance_catalog.fault_marker') IS NULL;"),'t');
 assert.equal((await inspect(owned.receipt)).ledger.length,files.length);
 checks.push('DB02_CHECKSUM_REFUSAL','DB03_MISSING_FILE_REFUSAL','DB04_DDL_ROLLBACK');
 await seed(owned.receipt);await seed(owned.receipt);
 catalog=await runtime(owned.receiptPath);
 pool=new pg.Pool({connectionString:resolveTarget(owned.receipt),max:1});
 assert.equal((await pool.query('select * from governance_catalog.version')).rowCount,0);
 await assert.rejects(pool.query("update governance_catalog.version set payload='{}'"),/permission denied/);
 const roles=JSON.parse(peer(owned.receipt.name,"SELECT json_build_object('super',rolsuper,'createdb',rolcreatedb) FROM pg_roles WHERE rolname='hdi_prototype';"));
 assert.equal(roles.super,false);assert.equal(roles.createdb,false);checks.push('DB09_NO_ROLE_ESCALATION','GV01_DIRECT_DML_DENIED','GV04_DIRECT_READ_DENIED');
 const cmd={action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_FAULT',kind:'DATASET',code:'ORG01',values:{name:'合成故障测试'},validFrom:'2026-01-01T00:00:00'};
 const before=peer(owned.receipt.name,'SELECT json_build_array((SELECT count(*) FROM governance_catalog.object),(SELECT count(*) FROM governance_catalog.version),(SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.audit));');
 peer(owned.receipt.name,"CREATE FUNCTION vnext_control.inject_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_AUDIT_FAILURE'; END $$; CREATE TRIGGER synthetic_fault BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION vnext_control.inject_fault();");
 await assert.rejects(catalog.command('maker',cmd),/SYNTHETIC_AUDIT_FAILURE/);
 assert.equal(peer(owned.receipt.name,'SELECT json_build_array((SELECT count(*) FROM governance_catalog.object),(SELECT count(*) FROM governance_catalog.version),(SELECT count(*) FROM governance_catalog.event),(SELECT count(*) FROM vnext_control.outcome),(SELECT count(*) FROM vnext_control.audit));'),before);
 peer(owned.receipt.name,'DROP TRIGGER synthetic_fault ON vnext_control.audit; DROP FUNCTION vnext_control.inject_fault();');
 const accepted=await catalog.command('maker',cmd);checks.push('GV05_AUDIT_AND_OUTCOME_ATOMIC');
 peer(owned.receipt.name,"UPDATE vnext_control.actor SET active=false WHERE code='maker';");
 await assert.rejects(catalog.command('maker',cmd),/ACCESS_DENIED/);
 await assert.rejects(catalog.read('maker',{scope:'SYNTHETIC',asOf:accepted.recordedAt}),/ACCESS_DENIED/);
 peer(owned.receipt.name,"UPDATE vnext_control.actor SET active=true WHERE code='maker';");
 assert.deepEqual(await catalog.command('maker',cmd),accepted);checks.push('GV04_REVOKED_REPLAY_HISTORY','GV06_ORIGINAL_OUTCOME_REPLAY');
 const rejectCandidate=await catalog.command('maker',{...cmd,requestId:randomUUID(),code:'ORG03'});
 const rejectReview=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_REJECT',target:rejectCandidate.id,expectedHead:rejectCandidate.head});
 const rejection={action:'REJECT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_REJECT',target:rejectCandidate.id,expectedHead:rejectReview.head};
 const rejectionOutcome=await catalog.command('reviewer',rejection);
 peer(owned.receipt.name,"DELETE FROM vnext_control.actor_grant WHERE actor_code='reviewer' AND scope='SYNTHETIC' AND permission='REVIEW';");
 await assert.rejects(catalog.command('reviewer',rejection),/ACCESS_DENIED/);
 peer(owned.receipt.name,"INSERT INTO vnext_control.actor_grant VALUES('reviewer','SYNTHETIC','REVIEW');");
 assert.deepEqual(await catalog.command('reviewer',rejection),rejectionOutcome);checks.push('GV04_SELECTIVE_REVIEW_REVOKE_REPLAY');
 // Current HTTP uses the same owner against this actual database.
 const {buildCatalogServer}=await import('../../apps/governance-api/src/composition/build-vnext-catalog.ts');
 const app=await buildCatalogServer(catalog);await app.listen({host:'127.0.0.1',port:0});
 try{
  const base=app.listeningOrigin;const headers={'x-catalog-actor':'maker','content-type':'application/json'};
  const list=await fetch(base+'/api/vnext/catalog?scope=BASELINE',{headers});assert.equal(list.status,200);const body=await list.json();assert.equal(body.total,53);assert.equal(body.items.length,10);
  const denied=await fetch(base+'/api/vnext/catalog?scope=BASELINE',{headers:{'x-catalog-actor':'outsider'}});assert.equal(denied.status,403);
  const invalidRead=await fetch(base+'/api/vnext/catalog?scope=BASELINE&rawPersonIdentifier=SYNTHETIC_READ_CANARY',{headers:{...headers,'request-id':'SYNTHETIC_READ_CANARY'}});assert.equal(invalidRead.status,400);
  const invalid=await fetch(base+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify({...cmd,rawPersonIdentifier:'SYNTHETIC_PRIVACY_CANARY'})});assert.equal(invalid.status,400);assert.ok(!(await invalid.text()).includes('SYNTHETIC_PRIVACY_CANARY'));
  const invalidRef=await fetch(base+'/api/vnext/catalog/commands',{method:'POST',headers,body:JSON.stringify({...cmd,kind:'SOURCE',code:'INVALID_REF',requestId:randomUUID(),values:{name:'合成',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'source-1'}})});
  assert.equal(invalidRef.status,400);assert.equal((await invalidRef.json()).code,'SOURCE_REFERENCE_INVALID');
  checks.push('UI04_REAL_HTTP_CONTRACT','UI06_ERROR_PRIVACY');
 }finally{await app.close();}
 console.log(JSON.stringify({status:'PASS',checks,receipt:owned.receipt,baselineCount:(await catalog.read('reviewer',{scope:'BASELINE'})).items.length}));
}catch(error){console.error(JSON.stringify({status:'FAIL',checks,message:error.message}));process.exitCode=1;}
finally{await catalog?.close();await pool?.end();dropTemporary(owned.receipt);}
