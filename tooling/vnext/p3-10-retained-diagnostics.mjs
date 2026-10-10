import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {readReceipt,peer,identitySQL} from './lineage.mjs';
if(process.argv.length!==2)throw new Error('CLOSED_COMMAND_REQUIRED');
const receipt=readReceipt();assert.equal(receipt.name,'hdi_mc_vnext_a7049c9e5c2a4364');assert.equal(receipt.oid,'206108');peer(receipt.name,identitySQL(receipt));
const actors=JSON.parse(peer(receipt.name,"SELECT jsonb_agg(jsonb_build_object('code',code,'identity',identity_code,'active',active,'principalKind',principal_kind))::text FROM vnext_control.actor WHERE code IN ('maker','maker-alias','reviewer')"));
const rows=JSON.parse(peer(receipt.name,"SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'version',number::text,'maker',maker,'requestId',request_id,'submission',submission)),'[]')::text FROM care_organization.workspace_draft_revision WHERE maker='maker' AND state='SUBMITTED' AND metadata->>'kind'='UNIT'"));assert.equal(rows.length,1,'ONE_ORIGINAL_RETAINED_APPLICATION_REQUIRED');const draft=rows[0];assert.match(draft.id,/^[a-f0-9-]{36}$/);
const checks=[];
for(const actor of ['maker','maker-alias'])for(const permission of ['READ','WRITE','READ_RESTRICTED']){
 try{peer(receipt.name,`SELECT care_organization.workspace_authorize('${actor}',metadata,'${permission}') FROM care_organization.workspace_draft_revision WHERE id='${draft.id}'::uuid AND number=${Number(draft.version)}`);checks.push({actor,permission,status:'AUTHORIZED'});}
 catch(error){const log=readFileSync('.runtime/vnext/last-admin-error.log','utf8'),frames=log.split('\n').filter(line=>/^(?:CONTEXT:  |SQL statement|PL\/pgSQL function)/.test(line)).filter(line=>!line.startsWith('SQL statement'));checks.push({actor,permission,status:error.message,frames});}
}
const seed={receipt:{name:receipt.name,oid:receipt.oid,requestId:receipt.requestId},draftId:draft.id,submittedVersion:draft.version,submit:{id:draft.id,expectedVersion:String(BigInt(draft.version)-1n),requestId:draft.requestId},submission:draft.submission,actors,checks,source:'READ_ONLY_EXACT_TASK_METADATA_DIAGNOSTIC',acceptance:'NOT_ACCEPTANCE'};
const path='.runtime/vnext/p3-10/retained-recovery-seed.json';if(existsSync(path))assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),seed);else writeFileSync(path,JSON.stringify(seed,null,2),{flag:'wx'});console.log(JSON.stringify({event:'P3_10_RETAINED_DIAGNOSTIC',evidence:path,actors,checks,draftId:seed.draftId,acceptance:'NOT_ACCEPTANCE'}));
