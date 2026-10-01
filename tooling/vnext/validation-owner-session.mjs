import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import pg from 'pg';
import {peer,quote,root,resolveTarget,identitySQL} from './lineage.mjs';
import {saveExclusiveReceipt,localReceiptTime} from './receipt.mjs';

/** Temporary test facility. No provider key or database password enters receipts. */
export async function createValidationOwnerSession(receipt,{failAfterRoleCreation=false,roleFamily='validation'}={}){
 const base=resolveTarget(receipt);
 if(receipt.purpose!=='TEMPORARY_VALIDATION'||!['P0-05','P0-06','P0-07','P0-08','P0-09','P0-10','P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07','P2-01','P2-02','P2-03'].includes(receipt.taskId))throw new Error('TEMPORARY_VALIDATION_REQUIRED');
 peer(receipt.name,identitySQL(receipt));
 if(roleFamily!=='validation'&&!(roleFamily==='owner'&&receipt.taskId==='P2-02'))throw new Error('TEMPORARY_OWNER_ROLE_FAMILY_INVALID');
 const role='hdi_'+roleFamily+'_'+randomUUID().replaceAll('-','').slice(0,16);
 const path=resolve(root,'.runtime/vnext/fresh',role+'.json');
 const intent={taskId:receipt.taskId,purpose:'TEMPORARY_VALIDATION_OWNER',role,database:receipt.name,databaseOid:receipt.oid,databaseRequestId:receipt.requestId};
 saveExclusiveReceipt(path+'.intent',intent);
 let ownership={...intent,roleOid:null};
 try{
  const created=peer('postgres',`BEGIN; CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 8; SELECT oid::text FROM pg_roles WHERE rolname=${quote(role)}; COMMIT;`);
  const ids=created.split(/\r?\n/).filter(line=>/^\d+$/.test(line));
  if(ids.length!==1)throw new Error('OWNER_ROLE_IDENTITY_PENDING');
  ownership={...intent,roleOid:ids[0]};
  if(failAfterRoleCreation)throw new Error('TEST_OWNER_RECEIPT_FAILURE');
  saveExclusiveReceipt(path,ownership);
  const password=randomBytes(32).toString('hex');
  const url=new URL(base);url.username=role;url.password=password;
  // Use stdin, suppress raw diagnostics, and never route credential SQL through peer's error log.
  const provision=spawnSync('wsl.exe',['-d','Anolis-8.9-HDI-POC','-u','postgres','--','env','-u','PGOPTIONS','-u','PGHOST','-u','PGUSER','-u','PGHOSTADDR','-u','PGSERVICE','-u','PGSERVICEFILE','-u','PGPASSFILE','psql','-X','-q','-v','ON_ERROR_STOP=1','-p','55434','-d',receipt.name,'-At'],{input:`SET log_statement='none'; SET log_min_error_statement='panic'; SET log_min_duration_statement=-1; SET log_duration=off; ALTER ROLE ${role} LOGIN PASSWORD '${password}';`,encoding:'utf8',windowsHide:true});
  if(provision.status!==0)throw new Error('OWNER_CREDENTIAL_PROVISION_FAILED');
  peer(receipt.name,`GRANT CONNECT ON DATABASE ${receipt.name} TO ${role}; GRANT USAGE ON SCHEMA governance_catalog,vnext_control TO ${role};
 DO $$ DECLARE f record; t record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('governance_catalog','vnext_control') AND (has_function_privilege('hdi_prototype',p.oid,'EXECUTE') OR p.proname IN ('accept_validation','quality_issue_record_correction')) LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ${role}',f.signature); END LOOP;
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('governance_catalog','vnext_control') AND c.relkind='r' AND has_table_privilege('hdi_prototype',c.oid,'SELECT') LOOP EXECUTE format('GRANT SELECT ON TABLE %I.%I TO ${role}',t.nspname,t.relname); END LOOP;
 END $$;`);
  const pool=new pg.Pool({connectionString:url.href,max:1});
  try{
   const row=(await pool.query("SELECT current_user AS role,current_database() AS database,d.oid::text AS oid,inet_server_port() AS port,r.rolsuper,r.rolcreatedb,r.rolcreaterole,r.rolbypassrls FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()" )).rows[0];
   if(row.role!==role||row.database!==receipt.name||row.oid!==receipt.oid||row.port!==receipt.port||row.rolsuper||row.rolcreatedb||row.rolcreaterole||row.rolbypassrls)throw new Error('OWNER_CONNECTION_IDENTITY_MISMATCH');
  }finally{await pool.end();}
  return {connectionString:url.href,receipt:ownership,receiptPath:path};
 }catch(cause){
  // The owning runner retains this receipt on failure; no guessed cleanup or leaked error text.
  const error=new Error(cause.message==='TEST_OWNER_RECEIPT_FAILURE'?'TEST_OWNER_RECEIPT_FAILURE':'OWNER_SESSION_PROVISION_FAILED');
  error.ownerSession={receipt:ownership,receiptPath:path};
  throw error;
 }
}

/**
 * Dispose the validation owner role after its receipt-owned database is gone.
 * Application pools must be closed before dropTemporary; this final step only
 * removes the role after verifying that no session or membership remains.
 */
export function dropValidationOwnerRole(session){
 const r=session.receipt;
 if(r.purpose!=='TEMPORARY_VALIDATION_OWNER'||!['P0-05','P0-06','P0-07','P0-08','P0-09','P0-10','P1-01','P1-02','P1-03','P1-04','P1-05','P1-06','P1-07','P2-01','P2-02','P2-03'].includes(r.taskId)||!/^hdi_mc_vnext_[a-f0-9]{16}$/.test(r.database)||(!/^hdi_validation_[a-f0-9]{16}$/.test(r.role)&&!(r.taskId==='P2-02'&&/^hdi_owner_[a-f0-9]{16}$/.test(r.role)))||!/^\d+$/.test(r.roleOid))throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
 if(resolve(session.receiptPath)!==resolve(root,'.runtime/vnext/fresh',r.role+'.json'))throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
 const disposed=JSON.parse(readFileSync(resolve(root,'.runtime/vnext/fresh',r.database+'.disposed.json'),'utf8'));
 if(disposed.name!==r.database||disposed.oid!==r.databaseOid||disposed.disposed!==true)throw new Error('OWNER_DATABASE_NOT_DISPOSED');
 const persisted=existsSync(session.receiptPath)?JSON.parse(readFileSync(session.receiptPath,'utf8')):r;
 const intent=JSON.parse(readFileSync(session.receiptPath+'.intent','utf8'));
 if(JSON.stringify(persisted)!==JSON.stringify(r)||JSON.stringify(intent)!==JSON.stringify({taskId:r.taskId,purpose:r.purpose,role:r.role,database:r.database,databaseOid:r.databaseOid,databaseRequestId:r.databaseRequestId}))throw new Error('OWNER_DISPOSAL_NOT_AUTHORIZED');
 const roleIdentity=peer('postgres',`SELECT oid::text||E'\\t'||rolname FROM pg_roles WHERE rolname=${quote(r.role)};`);
 const roleInUse=peer('postgres',`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid::text=${quote(r.roleOid)}) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid::text=${quote(r.roleOid)} OR member::text=${quote(r.roleOid)});`);
 if(roleInUse==='t')throw new Error('OWNER_ROLE_IN_USE');
 if(!roleIdentity){
  // A prior cleanup may have dropped the exact role before its marker write.
  // Record the observed terminal state without recreating or guessing anything.
  const disposedPath=session.receiptPath+'.disposed.json';
  if(existsSync(disposedPath)){
   const marker=JSON.parse(readFileSync(disposedPath,'utf8'));
   if(marker.role!==r.role||marker.roleOid!==r.roleOid||marker.databaseOid!==r.databaseOid||marker.disposed!==true)throw new Error('OWNER_DISPOSAL_MARKER_MISMATCH');
   return;
  }
  saveExclusiveReceipt(disposedPath,{role:r.role,roleOid:r.roleOid,databaseOid:r.databaseOid,disposed:true,disposition:'ALREADY_ABSENT',time:localReceiptTime()});
  return;
 }
 if(roleIdentity!==`${r.roleOid}\t${r.role}`)throw new Error('OWNER_ROLE_IDENTITY_MISMATCH');
 peer('postgres',`DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_database WHERE oid::text=${quote(r.databaseOid)} OR datname=${quote(r.database)}) THEN RAISE EXCEPTION 'OWNER_DATABASE_NOT_DISPOSED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${quote(r.role)} AND oid::text=${quote(r.roleOid)} AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls) THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE usesysid::text=${quote(r.roleOid)}) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid::text=${quote(r.roleOid)} OR member::text=${quote(r.roleOid)}) THEN RAISE EXCEPTION 'OWNER_ROLE_IN_USE'; END IF;
 END $$; DROP ROLE ${r.role};`);
 saveExclusiveReceipt(session.receiptPath+'.disposed.json',{role:r.role,roleOid:r.roleOid,databaseOid:r.databaseOid,disposed:true,time:localReceiptTime()});
}

// Compatibility name for existing validation runners; the operation removes a
// role after database disposal and is not an application-session close.
export const dropValidationOwnerSession = dropValidationOwnerRole;
