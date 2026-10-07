import {randomUUID} from 'node:crypto';
import {root,identitySQL,peer,quote} from './lineage.mjs';
import {dropTemporary} from './fresh.mjs';
import {saveExclusiveReceipt} from './receipt.mjs';

export function disposeOwnedValidationDatabase(receipt){
 if(!['P3-05','P3-07'].includes(receipt.taskId)||receipt.purpose!=='TEMPORARY_VALIDATION')throw new Error('DISPOSAL_NOT_AUTHORIZED');
 const tag=receipt.taskId.toLowerCase(),gate=receipt.taskId.replaceAll('-','_');
 const applicationName=tag+'-drop:'+receipt.requestId,identity=identitySQL(receipt),countSql=`SELECT count(*) FROM pg_stat_activity WHERE datname=${quote(receipt.name)};`;
 const lastJson=output=>JSON.parse(output.trim().split(/\r?\n/).at(-1));
 const diagnostic={gate:gate+'_DISPOSAL_OBSERVATION',database:receipt.name,oid:receipt.oid,requestId:receipt.requestId,ownedIdentitySession:null,ownedExitObservation:null,guardCount:null,sessions:[],status:'IN_PROGRESS'};
 const evidence=root+'/.runtime/vnext/'+tag+'/disposal-'+receipt.requestId+'-'+randomUUID()+'.json';
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
  try{saveExclusiveReceipt(evidence,diagnostic);console.log(JSON.stringify({event:gate+'_DISPOSAL_OBSERVATION_SAVED',status:diagnostic.status,evidence}));}
  catch{console.error(JSON.stringify({event:gate+'_DISPOSAL_OBSERVATION_UNAVAILABLE',status:diagnostic.status,code:diagnostic.code??'DISPOSAL_OBSERVATION_WRITE_FAILED'}));if(!disposalFailure)throw new Error('DISPOSAL_OBSERVATION_WRITE_FAILED');}
 }
};
