import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {runSourceDatabaseAuthorityCheck,assertMigrationDateTimeTypesAllowed,findForbiddenDatabaseColumns} from '../verification/src/check-database-authority.ts';
import {createTemporary,dropTemporary} from './fresh.mjs';
import {migrate,migrationFiles,checkPrefix,resolveTarget,root,peer,quote,identitySQL} from './lineage.mjs';
import {seed} from './catalog-seed.mjs';
import {saveExclusiveReceipt} from './receipt.mjs';

if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');

// Keep the full source ownership scan shared with the existing checker. Its
// legacy live/type path is deliberately not the vNext database authority seam.
runSourceDatabaseAuthorityCheck();
const files=migrationFiles();
for(const file of files)assertMigrationDateTimeTypesAllowed(file.id,file.sql);
console.log(JSON.stringify({gate:'P3_05_SOURCE_AUTHORITY',status:'PASS',migrationDateTimeTypesChecked:true}));

const owned=createTemporary('P3-05');let currentPrefix;
const run=(arguments_,failure)=>{
 const result=spawnSync(process.execPath,arguments_,{cwd:root,env:process.env,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
 // managed types-verify includes a full ledger in stdout. Consume its receipt
 // internally and emit only the bounded gate result, never the raw child output.
 if(result.status!==0)throw new Error(failure);
 let report;try{report=JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));}catch{throw new Error(failure);}
 if(report?.status!=='PASS')throw new Error(failure);
 return report;
};
const disposeOwned=receipt=>{
 const applicationName='p3-05-drop:'+receipt.requestId,identity=identitySQL(receipt),countSql=`SELECT count(*) FROM pg_stat_activity WHERE datname=${quote(receipt.name)};`;
 const lastJson=output=>JSON.parse(output.trim().split(/\r?\n/).at(-1));
 const diagnostic={gate:'P3_05_DISPOSAL_OBSERVATION',database:receipt.name,oid:receipt.oid,requestId:receipt.requestId,ownedIdentitySession:null,ownedExitObservation:null,guardCount:null,sessions:[],status:'IN_PROGRESS'};
 const evidence=root+'/.runtime/vnext/p3-05/disposal-'+receipt.requestId+'-'+randomUUID()+'.json';
 const transportPeer=(name,sql,options)=>{
  if(name===receipt.name&&sql===identity){
   const session=lastJson(peer(name,`\\set QUIET on\nSET application_name=${quote(applicationName)};${identity}\nSELECT jsonb_build_object('pid',pg_backend_pid(),'backendStart',backend_start::text,'role',current_user,'database',current_database(),'databaseOid',datid::text,'applicationName',application_name,'state',state)::text FROM pg_catalog.pg_stat_activity WHERE pid=pg_backend_pid();`,options));
   if(!Number.isSafeInteger(session.pid)||session.pid<=0||typeof session.backendStart!=='string'||session.backendStart.length>64||session.role!=='postgres'||session.database!==receipt.name||session.databaseOid!==receipt.oid||session.applicationName!==applicationName)throw new Error('DISPOSAL_SESSION_IDENTITY_REQUIRED');
   diagnostic.ownedIdentitySession=session;
   const own=`a.pid=${session.pid} AND a.backend_start=${quote(session.backendStart)}::pg_catalog.timestamptz AND a.usename=${quote(session.role)} AND a.datname=${quote(session.database)} AND a.datid::text=${quote(session.databaseOid)} AND a.application_name=${quote(applicationName)}`;
   // Only this exact, freshly recorded psql backend may be observed until exit.
   // The original all-session count below still rejects every remaining backend.
   diagnostic.ownedExitObservation=lastJson(peer('postgres',`\\set QUIET on\nSET default_transaction_read_only=on;DO $p305_owned_exit$ BEGIN FOR attempt IN 1..20 LOOP PERFORM pg_catalog.pg_stat_clear_snapshot();EXIT WHEN NOT EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a WHERE ${own});PERFORM pg_catalog.pg_sleep(0.1);END LOOP;END $p305_owned_exit$;SELECT pg_catalog.pg_stat_clear_snapshot();SELECT jsonb_build_object('maxObservations',20,'intervalMs',100,'selfStillPresent',EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity a WHERE ${own}))::text;`));
   return '';
  }
  const result=peer(name,sql,options);
  if(name==='postgres'&&sql===countSql){
   diagnostic.guardCount=result;
   if(result!=='0'){
    try{diagnostic.sessions=lastJson(peer('postgres',`\\set QUIET on\nSET default_transaction_read_only=on;SELECT coalesce(jsonb_agg(s),'[]')::text FROM (SELECT pid,left(usename,64) AS role,left(application_name,64) AS application_name,left(state,32) AS state FROM pg_catalog.pg_stat_activity WHERE datname=${quote(receipt.name)} ORDER BY pid LIMIT 32) s;`));}
    catch(error){diagnostic.observationError=/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'DISPOSAL_OBSERVATION_FAILED';}
   }
  }
  return result;
 };
 let disposalFailure;
 try{dropTemporary(receipt,{peer:transportPeer});diagnostic.status='DISPOSED';}
 catch(error){disposalFailure=error;diagnostic.status='BLOCKED';diagnostic.code=/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'DISPOSAL_FAILED';throw error;}
 finally{
  try{saveExclusiveReceipt(evidence,diagnostic);console.log(JSON.stringify({event:'P3_05_DISPOSAL_OBSERVATION_SAVED',status:diagnostic.status,evidence}));}
  catch{console.error(JSON.stringify({event:'P3_05_DISPOSAL_OBSERVATION_UNAVAILABLE',status:diagnostic.status,code:diagnostic.code??'DISPOSAL_OBSERVATION_WRITE_FAILED'}));if(!disposalFailure)throw new Error('DISPOSAL_OBSERVATION_WRITE_FAILED');}
 }
};
try{
 const observation=await migrate(owned.receipt,files);
 currentPrefix=checkPrefix(files,observation.ledger);assert.equal(currentPrefix,files.length);
 assert.equal(observation.identity.name,owned.receipt.name);assert.equal(observation.identity.oid,owned.receipt.oid);
 const ownership=JSON.parse(readFileSync(root+'/db/vnext/table-ownership.json','utf8'));assert.equal(ownership.lineage,'HDIP-MC-VNEXT');
 const pool=new Pool({connectionString:resolveTarget(owned.receipt),options:'-c default_transaction_read_only=on',application_name:'hdi-vnext-p3-05-authority',max:1});
 try{
  const identity=(await pool.query("select current_database() as name,d.oid::text as oid,pg_get_userbyid(d.datdba) as owner,inet_server_port() as port,current_user as role from pg_database d where d.datname=current_database()")).rows[0];
  assert.ok(identity);for(const key of ['name','oid','owner','port'])assert.equal(identity[key],owned.receipt[key]);assert.equal(identity.role,owned.receipt.owner);
  const forbidden=await findForbiddenDatabaseColumns((query,values)=>pool.query(query,[...values]),Object.keys(ownership.schemas));
  assert.deepEqual(forbidden,[],'Governance schemas contain forbidden date/time columns');
 }finally{await pool.end();}
 await seed(owned.receipt);
 const types=run(['tooling/vnext/managed.mjs','types-verify',owned.receiptPath],'P3_05_TYPES_AUTHORITY_FAILED');
 assert.equal(types.command,'types-verify');assert.equal(types.identity.name,owned.receipt.name);assert.equal(types.identity.oid,owned.receipt.oid);
 const authority=run(['tooling/vnext/authority.mjs',owned.receiptPath],'P3_05_LINEAGE_AUTHORITY_FAILED');
 assert.equal(authority.lineage,'HDIP-MC-VNEXT');
}finally{disposeOwned(owned.receipt);}

// A disposal failure prevents this terminal PASS and leaves the target nonzero.
console.log(JSON.stringify({gate:'P3_05_AUTHORITY',status:'PASS',lineage:'HDIP-MC-VNEXT',currentPrefix,sourceOwnershipChecked:true,migrationDateTimeTypesChecked:true,readOnlyReceiptIdentityChecked:true,databaseDateTimeTypesChecked:true,forbiddenDatabaseTypeCount:0,generatedTypesVerified:true,databaseAuthorityVerified:true,ownedTemporaryDisposed:true,legacyDatabase:'LEGACY_OUT_OF_CURRENT_EXECUTION'}));
