import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readReceipt,inspect,migrate,migrationFiles,checkPrefix,peer,identitySQL,root} from './lineage.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';

/** Persistent deployment retains the receipt-owned database and every predecessor fact. */
export async function prepareWorkspaceDeployment({reuseExisting=false}={}){
 const receipt=readReceipt(),before=await inspect(receipt),files=migrationFiles();assert.equal(files.length,72);
 const prefix=checkPrefix(files,before.ledger);assert.ok([70,71,72].includes(prefix),'P1_05_LATEST_DEPLOYMENT_REQUIRED');if(reuseExisting)assert.equal(prefix,72,'WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
 mkdirSync('.runtime/vnext/p1-06',{recursive:true});const evidence='.runtime/vnext/p1-06/deployment-'+Date.now();
 const tables=predecessorTables(before.tables),digest=predecessorDigest(receipt,tables);
 const keyDigest=()=>createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex'),keysBefore=keyDigest();
 const rowHashes=()=>Object.fromEntries(tables.map(table=>[table,JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(encode(sha256(convert_to(to_jsonb(o)::text,'UTF8')),'hex')),'[]')::text FROM ${table} o`))]));
 const rowsBefore=rowHashes();writeFileSync(evidence+'.before.json',JSON.stringify({identity:before.identity,ledger:before.ledger,dataDigest:digest,keyDigest:keysBefore,rowHashes:rowsBefore},null,2),{flag:'wx'});
 const after=reuseExisting?before:await migrate(receipt,files);assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,prefix),before.ledger);assert.equal(predecessorDigest(receipt,tables),digest);assert.equal(keyDigest(),keysBefore);
 const connection=await ownerServiceConnection(),ownership=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
 assert.match(ownership.role,/^hdi_owner_[a-f0-9]{16}$/);assert.match(String(ownership.roleOid),/^[0-9]+$/);assert.equal(new URL(connection).username,ownership.role);assert.equal(ownership.database,receipt.name);assert.equal(ownership.databaseOid,receipt.oid);assert.equal(ownership.databaseRequestId,receipt.requestId);
 const functions=['workspace_save(text,jsonb,text,jsonb)','workspace_read(text,uuid)','workspace_list(text)','workspace_capabilities(text,jsonb)','workspace_application_access(text,uuid)','workspace_applications(text,uuid)','workspace_object_context(text,text,uuid)','workspace_version_source(text,text,uuid,text)','workspace_bundles(text,uuid,uuid)','workspace_preview_access(text,jsonb,text)'];
 if(!reuseExisting)peer(receipt.name,identitySQL(receipt)+` BEGIN; DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname='${ownership.role}') IS DISTINCT FROM '${ownership.roleOid}' THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$; GRANT EXECUTE ON FUNCTION ${functions.map(name=>'organization_master.'+name).join(',')} TO ${ownership.role}; COMMIT;`);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify','.runtime/vnext/creation.json'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 writeFileSync(evidence+'.migration.json',JSON.stringify({status:'PASS',mode:reuseExisting?'VERIFY_EXISTING':'FORWARD_UPGRADE',oid:after.identity.oid,previousPrefix:prefix,currentPrefix:after.ledger.length,priorRowsAndKeysPreserved:true},null,2),{flag:'wx'});
 return {receipt,connection,provider:organizationKeys(receipt),evidence,async complete(){
  const final=await inspect(receipt),retained=rowHashes();assert.equal(final.identity.oid,before.identity.oid);assert.deepEqual(final.ledger,after.ledger);assert.equal(keyDigest(),keysBefore);
  for(const table of tables){const current=new Set(retained[table]);assert.ok(rowsBefore[table].every(hash=>current.has(hash)),'Previous rows changed: '+table);}
  writeFileSync(evidence+'.preservation.json',JSON.stringify({status:'PASS',oid:final.identity.oid,ledgerPreserved:true,priorRowsAndKeysPreserved:true,browserAcceptance:'SEE_SEPARATE_BROWSER_EVIDENCE',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
  console.log(JSON.stringify({status:'PERSISTENT_WORKSPACE_PRESERVATION_PASSED',evidence:evidence+'.preservation.json'}));
 }};
}
