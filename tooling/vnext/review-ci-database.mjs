import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';

// This is a GitHub-hosted synthetic database adapter, not a substitute for the
// receipt-owned WSL/persistent deployment runner. Production URLs are refused.
const base=new URL(process.env.HDIP_REVIEW_CI_ADMIN_URL??'postgresql://invalid/');
if(process.env.GITHUB_ACTIONS!=='true'||base.hostname!=='127.0.0.1'||base.port!=='55434'||base.pathname!=='/postgres'||base.username!=='postgres')throw new Error('ISOLATED_REVIEW_CI_REQUIRED');
const root=resolve(import.meta.dirname,'../..');
const allowed=new Set(['postgres']);
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
const temporaryCreate=/^CREATE DATABASE (hdi_mc_vnext_[a-f0-9]{16}) OWNER hdi_prototype TEMPLATE template0;$/u;
const temporaryDrop=/\bDROP DATABASE (hdi_mc_vnext_[a-f0-9]{16})(?: WITH \(FORCE\))?;/u;
function authorizeTemporary(receipt){
 if(!receipt||receipt.taskId!=='P1-02'||receipt.purpose!=='TEMPORARY_VALIDATION'||receipt.lineage!=='HDIP-MC-VNEXT'||receipt.owner!=='hdi_prototype'||receipt.distro!=='Anolis-8.9-HDI-POC'||receipt.port!==55434||!/^hdi_mc_vnext_[a-f0-9]{16}$/u.test(receipt.name)||!/^\d+$/u.test(receipt.oid)||!/^[-a-f0-9]{36}$/u.test(receipt.requestId))throw new Error('REVIEW_CI_TARGET_DENIED');
 const path=resolve(root,'.runtime/vnext/fresh',receipt.name+'.json'),intentPath=path+'.intent';
 if(!existsSync(path)||!existsSync(intentPath))throw new Error('REVIEW_CI_TARGET_DENIED');
 const persisted=JSON.parse(readFileSync(path,'utf8')),intent=JSON.parse(readFileSync(intentPath,'utf8'));
 if(JSON.stringify(persisted)!==JSON.stringify(receipt)||intent.taskId!==receipt.taskId||intent.purpose!==receipt.purpose||intent.lineage!==receipt.lineage||intent.name!==receipt.name||intent.owner!==receipt.owner||intent.distro!==receipt.distro||intent.port!==receipt.port||intent.requestId!==receipt.requestId||intent.recordedAt!==receipt.recordedAt)throw new Error('REVIEW_CI_TARGET_DENIED');
 const present=peer('postgres',`SELECT count(*) FROM pg_database WHERE datname=${quote(receipt.name)} AND oid::text=${quote(receipt.oid)} AND pg_get_userbyid(datdba)=${quote(receipt.owner)};`);
 if(present!=='1')throw new Error('REVIEW_CI_TARGET_DENIED');allowed.add(receipt.name);
}
export function peer(name,sql){
 if(!allowed.has(name))throw new Error('REVIEW_CI_TARGET_DENIED');
 const created=name==='postgres'?temporaryCreate.exec(sql)?.[1]:undefined,dropped=name==='postgres'?temporaryDrop.exec(sql)?.[1]:undefined;
 const url=new URL(base);url.pathname='/'+name;
 const result=spawnSync('psql',['-X','-q','-v','ON_ERROR_STOP=1','-h',url.hostname,'-p',url.port,'-U',url.username,'-d',name,'-At'],{input:sql,encoding:'utf8',env:{...process.env,PGPASSWORD:decodeURIComponent(url.password)},maxBuffer:32*1024*1024});
 if(result.status!==0)throw new Error(result.stderr||'REVIEW_CI_SQL_FAILED');
 if(created)allowed.add(created);if(dropped)allowed.delete(dropped);return result.stdout.trim();
}
export function resolveTarget(receipt){if(!allowed.has(receipt.name))authorizeTemporary(receipt);const url=new URL(base);url.pathname='/'+receipt.name;return url.href;}
export async function inspect(receipt){
 const pool=new pg.Pool({connectionString:resolveTarget(receipt)});
 try{
  const identity=(await pool.query("select current_database() name,d.oid::text oid,pg_get_userbyid(d.datdba) owner,inet_server_port() port from pg_database d where datname=current_database()" )).rows[0];
  if(identity.name!==receipt.name||identity.oid!==receipt.oid||identity.owner!=='hdi_prototype')throw new Error('REVIEW_CI_IDENTITY_MISMATCH');
  const present=(await pool.query("select to_regclass('vnext_control.migration') is not null present")).rows[0].present;
  const ledger=present?(await pool.query('select id,sha256 from vnext_control.migration order by id')).rows:[];
  const tables=(await pool.query("select schemaname||'.'||tablename name from pg_tables where schemaname in ('vnext_control','governance_catalog','organization_master') order by 1")).rows.map(r=>r.name);
  return {identity,ledger,tables};
 }finally{await pool.end();}
}
const migrationFiles=()=>readdirSync(resolve(root,'db/vnext/migrations')).filter(f=>/^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
function applyMigration(name,file){const bytes=readFileSync(resolve(root,'db/vnext/migrations',file));peer(name,`BEGIN;${bytes.toString()}\nINSERT INTO vnext_control.migration(lineage,id,sha256,runner_version) VALUES('HDIP-MC-VNEXT',${quote(file.slice(0,-4))},${quote(createHash('sha256').update(bytes).digest('hex'))},'GITHUB_REVIEW_CI');COMMIT;`);}
async function upgradeOne(receipt,oldCount,file,check){
 const before=await inspect(receipt),files=migrationFiles();assert.ok(files.length>=oldCount+1);assert.equal(before.ledger.length,oldCount);assert.equal(files[oldCount],file);
 for(let i=0;i<oldCount;i++){assert.equal(before.ledger[i].id,files[i].slice(0,-4));assert.equal(before.ledger[i].sha256,createHash('sha256').update(readFileSync(resolve(root,'db/vnext/migrations',files[i]))).digest('hex'));}
 const tables=before.tables.filter(t=>t!=='vnext_control.migration');
 const hash=()=>Object.fromEntries(tables.map(t=>[t,peer(receipt.name,`SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),''),'UTF8')),'hex') FROM ${t} r`)]));
 const acl=()=>peer(receipt.name,"SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid,p.oid::regprocedure::text,p.proowner,p.proacl) ORDER BY p.oid::regprocedure::text),'[]')::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='organization_master' AND p.proname IN ('workspace_version_source','workspace_transport_authorize','workspace_authorize','workspace_save','workspace_object_context','campus_write_approved')");
 const rowsBefore=hash(),aclBefore=acl();applyMigration(receipt.name,file);const after=await inspect(receipt);
 assert.deepEqual(after.identity,before.identity);assert.deepEqual(after.ledger.slice(0,oldCount),before.ledger);assert.equal(after.ledger.length,oldCount+1);assert.deepEqual(after.tables,before.tables);assert.deepEqual(hash(),rowsBefore);assert.equal(acl(),aclBefore);
 console.log(JSON.stringify({status:'PASS',check,oid:after.identity.oid,oldLedgerEntriesPreserved:oldCount,tableHashesPreserved:tables.length,functionOwnersAndACLsPreserved:true}));
}
export async function upgradeWorkspace(receipt){
 if(process.env.HDIP_REVIEW_CI_UPGRADE!=='1')throw new Error('REVIEW_UPGRADE_MODE_REQUIRED');
 await upgradeOne(receipt,71,'0072_workspace_domain_transports.sql','POPULATED_0071_TO_0072');
}
export async function upgradeLicenseTransport(receipt){
 if(process.env.HDIP_REVIEW_CI_LICENSE_UPGRADE!=='1')throw new Error('REVIEW_LICENSE_UPGRADE_MODE_REQUIRED');
 await upgradeOne(receipt,72,'0073_workspace_exact_license_transport.sql','POPULATED_0072_TO_0073');
}
export async function upgradePartialEndpoint(receipt){
 if(process.env.HDIP_REVIEW_CI_ENDPOINT_UPGRADE!=='1')throw new Error('REVIEW_ENDPOINT_UPGRADE_MODE_REQUIRED');
 await upgradeOne(receipt,73,'0074_workspace_partial_endpoint_authorization.sql','POPULATED_0073_TO_0074');
}
export async function upgradePreviousDraftAccess(receipt){
 if(process.env.HDIP_REVIEW_CI_PREVIOUS_UPGRADE!=='1')throw new Error('REVIEW_PREVIOUS_UPGRADE_MODE_REQUIRED');
 await upgradeOne(receipt,74,'0075_workspace_previous_draft_access.sql','POPULATED_0074_TO_0075');
 await upgradeOne(receipt,75,'0076_workspace_retained_manifest_access.sql','POPULATED_0075_TO_0076');
 await upgradeOne(receipt,76,'0077_workspace_manifest_reference_access.sql','POPULATED_0076_TO_0077');
}
export async function upgradeManifestReferenceAccess(receipt){
 if(process.env.HDIP_REVIEW_CI_MANIFEST_UPGRADE!=='1')throw new Error('REVIEW_MANIFEST_UPGRADE_MODE_REQUIRED');
 await upgradeOne(receipt,76,'0077_workspace_manifest_reference_access.sql','POPULATED_0076_TO_0077');
}
export async function upgradeEffectiveActivation(receipt){
 if(process.env.HDIP_REVIEW_CI_ACTIVATION_UPGRADE!=='1')throw new Error('REVIEW_ACTIVATION_UPGRADE_MODE_REQUIRED');
 await upgradeOne(receipt,79,'0080_campus_effective_activation.sql','POPULATED_0079_TO_0080');
 await upgradeOne(receipt,80,'0081_campus_explicit_resume_basis.sql','POPULATED_0080_TO_0081');
}
export async function provision(){
 const name='hdi_mc_vnext_'+randomBytes(8).toString('hex'),role='hdi_validation_'+randomBytes(8).toString('hex'),password=randomBytes(24).toString('hex');
 peer('postgres',"DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='hdi_prototype') THEN CREATE ROLE hdi_prototype NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;END IF;END $$;");
 peer('postgres',`CREATE DATABASE ${name} OWNER hdi_prototype;CREATE ROLE ${role} LOGIN PASSWORD ${quote(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;`);
 allowed.add(name);
 const receipt={name,oid:peer(name,'SELECT oid::text FROM pg_database WHERE datname=current_database()'),owner:'hdi_prototype',port:55434,purpose:'GITHUB_ACTIONS_SYNTHETIC_REVIEW',requestId:randomUUID()};
 const path=resolve(root,'.runtime/vnext/review-ci-'+name+'.json');mkdirSync(resolve(root,'.runtime/vnext'),{recursive:true});writeFileSync(path,JSON.stringify(receipt));
 const all=migrationFiles();
 const count=process.env.HDIP_REVIEW_CI_UPGRADE==='1'?71:process.env.HDIP_REVIEW_CI_LICENSE_UPGRADE==='1'?72:process.env.HDIP_REVIEW_CI_ENDPOINT_UPGRADE==='1'?73:process.env.HDIP_REVIEW_CI_PREVIOUS_UPGRADE==='1'?74:process.env.HDIP_REVIEW_CI_MANIFEST_UPGRADE==='1'?76:process.env.HDIP_REVIEW_CI_ACTIVATION_UPGRADE==='1'?79:all.length;
 const files=all.slice(0,count);assert.equal(files.length,count);
 for(const file of files)applyMigration(name,file);
 peer(name,`GRANT CONNECT ON DATABASE ${name} TO ${role};GRANT USAGE ON SCHEMA governance_catalog,vnext_control,organization_master TO ${role};
 DO $$ DECLARE f record;t record;BEGIN
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('governance_catalog','vnext_control') AND (has_function_privilege('hdi_prototype',p.oid,'EXECUTE') OR p.proname IN ('accept_validation','quality_issue_record_correction','apply_record','campus_division','operating_catalog')) LOOP EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ${role}',f.signature);END LOOP;
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('governance_catalog','vnext_control') AND c.relkind='r' AND has_table_privilege('hdi_prototype',c.oid,'SELECT') LOOP EXECUTE format('GRANT SELECT ON TABLE %I.%I TO ${role}',t.nspname,t.relname);END LOOP;
 END $$;GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA organization_master TO ${role};`);
 const connection=new URL(base);connection.pathname='/'+name;connection.username=role;connection.password=password;
 process.env.VNEXT_VALIDATION_OWNER_URL=connection.href;process.env.VNEXT_TEST_RECEIPT=path;
 console.log(JSON.stringify({database:name,role,server:peer(name,'SHOW server_version'),migrations:files.length,environment:'ISOLATED_GITHUB_CI'}));
 return {receipt,async close(){peer('postgres',`DROP DATABASE ${name} WITH (FORCE);DROP ROLE ${role};`);allowed.delete(name);}};
}
