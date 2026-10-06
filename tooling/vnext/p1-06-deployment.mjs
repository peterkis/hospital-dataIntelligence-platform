import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readReceipt,inspect,migrate,migrationFiles,peer,identitySQL,root} from './lineage.mjs';
import {workspaceDeploymentPrefix} from './workspace-migrations.mjs';
import {predecessorTables,predecessorDigest} from './p1-02-preservation.mjs';
import {ownerServiceConnection} from './owner-service.mjs';
import {organizationKeys} from './organization-keys.mjs';
import {assertHierarchyProvisioned,grantHierarchyFunctions} from './hierarchy-provisioning.mjs';

/** Persistent deployment retains the receipt-owned database and every predecessor fact. */
export async function prepareWorkspaceDeployment({reuseExisting=false,evidenceTask='p1-06',addedColumns={}}={}) {
 if(!['p1-06','p1-07','p2-01','p2-03','p2-04','p2-05','p2-06','p2-07','p2-08','p3-06','p3-01','p3-02','p3-03','p3-08','p3-09','p3-04'].includes(evidenceTask))throw new Error('CLOSED_COMMAND_REQUIRED');
 const receipt=readReceipt(),before=await inspect(receipt),files=migrationFiles();
 if(evidenceTask==='p3-08'&&before.ledger.length<170)throw new Error('P3_02_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p3-04'&&before.ledger.length<185)throw new Error('P3_09_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p3-09'&&before.ledger.length<175)throw new Error('P3_08_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p3-02'&&before.ledger.length<165)throw new Error('P3_03_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p3-03'&&before.ledger.length<161)throw new Error('P3_01_CURRENT_DEPLOYMENT_REQUIRED');
 const prefix=workspaceDeploymentPrefix(files,before.ledger,reuseExisting);
 // Only exclude newly introduced columns when comparing an older schema.
 // Once194 is installed, verification pins participate in full row preservation.
 if(evidenceTask==='p3-04'&&prefix<194)addedColumns={...addedColumns,'care_organization.unit_ward_apply_binding':['verification_id','verification_number','verification_digest']};
 if(evidenceTask==='p3-01'&&prefix<151)throw new Error('P3_06_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p3-06'&&prefix<148)throw new Error('P2_07_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p2-01'&&prefix<83)throw new Error('P1_07_REPAIRED_DEPLOYMENT_REQUIRED');
 // 0109 is the inspected persistent P2-02 prefix. The already-merged 0110/0111
 // repairs and this ticket's 0112 advance it together without rewriting lineage.
 if(evidenceTask==='p2-03'&&prefix<109)throw new Error('P2_02_MERGED_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p2-06'&&prefix<121)throw new Error('P2_05_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p2-08'&&prefix<133)throw new Error('P2_06_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p2-07'&&prefix<143)throw new Error('P2_08_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p2-05'&&prefix<117)throw new Error('P2_04_CURRENT_DEPLOYMENT_REQUIRED');
 if(evidenceTask==='p1-07'&&prefix<71)throw new Error('P1_06_MERGED_DEPLOYMENT_REQUIRED');
 mkdirSync('.runtime/vnext/'+evidenceTask,{recursive:true});const evidence='.runtime/vnext/'+evidenceTask+'/deployment-'+Date.now();
 const tables=predecessorTables(before.tables),digest=predecessorDigest(receipt,tables,addedColumns);
 const keyDigest=()=>createHash('sha256').update(readFileSync('.runtime/vnext/p1-01/keys.secret.json')).digest('hex'),keysBefore=keyDigest();
 const preservedRow=table=>{let expression='to_jsonb(o)';for(const column of addedColumns[table]??[]){if(!/^[a-z_][a-z0-9_]*$/.test(column))throw new Error('PRESERVATION_COLUMN_INVALID');expression+="-'"+column+"'";}return expression;};
 const rowHashes=()=>Object.fromEntries(tables.map(table=>[table,JSON.parse(peer(receipt.name,`SELECT coalesce(jsonb_agg(encode(sha256(convert_to((${preservedRow(table)})::text,'UTF8')),'hex')),'[]')::text FROM ${table} o`))]));
 const rowsBefore=rowHashes();writeFileSync(evidence+'.before.json',JSON.stringify({identity:before.identity,ledger:before.ledger,dataDigest:digest,keyDigest:keysBefore,rowHashes:rowsBefore},null,2),{flag:'wx'});
 if(evidenceTask==='p1-07'&&!reuseExisting&&prefix<77){
  const inherited=await migrate(receipt,files.slice(0,77));
  assert.equal(inherited.identity.oid,before.identity.oid);assert.deepEqual(inherited.ledger.slice(0,prefix),before.ledger);
  assert.equal(predecessorDigest(receipt,tables,addedColumns),digest);assert.equal(keyDigest(),keysBefore);
  writeFileSync(evidence+'.p1-06-prefix.json',JSON.stringify({status:'PASS',base:'ee15ef7ee738e2f204a915c9d41bb2367ff2a5bd',previousPrefix:prefix,currentPrefix:77,oid:inherited.identity.oid,priorRowsAndKeysPreserved:true},null,2),{flag:'wx'});
 }
 const after=reuseExisting?before:await migrate(receipt,files);
 // Verify the complete ordered/checksummed result before granting routes or
 // writing PASS evidence. A migrator that stops early is not a deployment.
 workspaceDeploymentPrefix(files,after.ledger,true);
 assert.equal(after.identity.oid,before.identity.oid);assert.deepEqual(after.ledger.slice(0,prefix),before.ledger);assert.equal(predecessorDigest(receipt,tables,addedColumns),digest);assert.equal(keyDigest(),keysBefore);
 const connection=await ownerServiceConnection(),ownership=JSON.parse(readFileSync('.runtime/vnext/p0-09/owner-service.json','utf8'));
 assert.match(ownership.role,/^hdi_owner_[a-f0-9]{16}$/);assert.match(String(ownership.roleOid),/^[0-9]+$/);assert.equal(new URL(connection).username,ownership.role);assert.equal(ownership.database,receipt.name);assert.equal(ownership.databaseOid,receipt.oid);assert.equal(ownership.databaseRequestId,receipt.requestId);
 const functions=['workspace_save(text,jsonb,text,jsonb)','workspace_read(text,uuid)','workspace_list(text)','workspace_capabilities(text,jsonb)','workspace_application_access(text,uuid)','workspace_applications(text,uuid)','workspace_object_context(text,text,uuid)','workspace_version_source(text,text,uuid,text)','workspace_bundles(text,uuid,uuid)','workspace_preview_access(text,jsonb,text)'];
 if(after.ledger.length>=79)functions.push('campus_impact(text,uuid,timestamp,timestamp,timestamp)','campus_admission(text,uuid,timestamp,timestamp)');
 if(!reuseExisting)peer(receipt.name,identitySQL(receipt)+` BEGIN; DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname='${ownership.role}') IS DISTINCT FROM '${ownership.roleOid}' THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$; GRANT EXECUTE ON FUNCTION ${functions.map(name=>'organization_master.'+name).join(',')} TO ${ownership.role}; COMMIT;`);
 if(!reuseExisting&&after.ledger.length>=109)grantHierarchyFunctions(receipt,ownership);
 if(after.ledger.length>=109)await assertHierarchyProvisioned(connection);
 const types=spawnSync(process.execPath,['tooling/vnext/managed.mjs','types-verify','.runtime/vnext/creation.json'],{cwd:root,env:process.env,stdio:'inherit',windowsHide:true});assert.equal(types.status,0);
 writeFileSync(evidence+'.migration.json',JSON.stringify({status:'PASS',mode:reuseExisting?'VERIFY_EXISTING':'FORWARD_UPGRADE',oid:after.identity.oid,previousPrefix:prefix,currentPrefix:after.ledger.length,priorRowsAndKeysPreserved:true},null,2),{flag:'wx'});
 return {receipt,connection,provider:organizationKeys(receipt),evidence,async complete(){
  const final=await inspect(receipt),retained=rowHashes();assert.equal(final.identity.oid,before.identity.oid);assert.deepEqual(final.ledger,after.ledger);assert.equal(keyDigest(),keysBefore);
  for(const table of tables){const current=new Set(retained[table]);assert.ok(rowsBefore[table].every(hash=>current.has(hash)),'Previous rows changed: '+table);}
  writeFileSync(evidence+'.preservation.json',JSON.stringify({status:'PASS',oid:final.identity.oid,ledgerPreserved:true,priorRowsAndKeysPreserved:true,browserAcceptance:'SEE_SEPARATE_BROWSER_EVIDENCE',restart:'NOT_RUN',formalAcceptance:'NOT_RUN'},null,2),{flag:'wx'});
  console.log(JSON.stringify({status:'PERSISTENT_WORKSPACE_PRESERVATION_PASSED',evidence:evidence+'.preservation.json'}));
 }};
}
