import {renameSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {peer,inspect,provision} from './review-ci-database.mjs';
export {peer,inspect,resolveTarget} from './review-ci-database.mjs';
const root=resolve(import.meta.dirname,'../..'),file='0077_workspace_manifest_reference_access.sql',path=resolve(root,'db/vnext/migrations',file),hold=path+'.review-hold';
const quote=value=>"'"+String(value).replaceAll("'","''")+"'";
export async function provisionAt0076(){
 renameSync(path,hold);try{return await provision();}finally{renameSync(hold,path);}
}
export async function upgradeManifestReferenceAccess(receipt){
 if(process.env.HDIP_REVIEW_CI_MANIFEST_UPGRADE!=='1')throw new Error('REVIEW_MANIFEST_UPGRADE_MODE_REQUIRED');
 const before=await inspect(receipt);assert.equal(before.ledger.length,76);
 const tables=before.tables.filter(t=>t!=='vnext_control.migration');
 const hash=()=>Object.fromEntries(tables.map(t=>[t,peer(receipt.name,`SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E'\n' ORDER BY to_jsonb(r)::text),''),'UTF8')),'hex') FROM ${t} r`)]));
 const acl=()=>peer(receipt.name,"SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid,p.oid::regprocedure::text,p.proowner,p.proacl) ORDER BY p.oid::regprocedure::text),'[]')::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='organization_master' AND p.proname IN ('workspace_authorize','workspace_save')");
 const rows=hash(),permissions=acl(),bytes=readFileSync(path),sha=createHash('sha256').update(bytes).digest('hex');
 peer(receipt.name,`BEGIN;${bytes.toString()}\nINSERT INTO vnext_control.migration(lineage,id,sha256,runner_version) VALUES('HDIP-MC-VNEXT','0077_workspace_manifest_reference_access',${quote(sha)},'GITHUB_REVIEW_CI');COMMIT;`);
 const after=await inspect(receipt);assert.deepEqual(after.identity,before.identity);assert.deepEqual(after.ledger.slice(0,76),before.ledger);assert.equal(after.ledger.length,77);assert.deepEqual(after.tables,before.tables);assert.deepEqual(hash(),rows);assert.equal(acl(),permissions);
 console.log(JSON.stringify({status:'PASS',check:'POPULATED_0076_TO_0077',oldLedgerEntriesPreserved:76,tableHashesPreserved:tables.length,functionOwnersAndACLsPreserved:true}));
}
