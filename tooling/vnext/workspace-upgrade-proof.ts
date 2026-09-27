import {expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import type {openOrganizationWorkspace,DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import type {Catalog,OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {upgradeWorkspace,peer} from './review-ci-database.mjs';

/** Runs only in the explicitly isolated 0071 upgrade job. */
export async function workspaceUpgradeProof(workspace:ReturnType<typeof openOrganizationWorkspace>,catalog:Catalog,connection:string,receipt:{name:string;oid:string;owner:string},campus:OwnerFact){
 const contracts=await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'});
 const binding=(domain:string)=>{const c=contracts.find(c=>c.dataset===domain&&c.status==='PUBLISHED'&&c.definition.templateVersion===domain+'_MANUAL_CORE_V1');if(!c)throw new Error('UPGRADE_FIXTURE_TRANSPORT_REQUIRED');return {contractId:c.id,contractVersionId:c.versionId};};
 const original=await workspace.prepareRevision('workspace-steward',{kind:'CAMPUS',id:campus.id,version:campus.version});
 if(original.domain!=='ORG02')throw new Error('UPGRADE_FIXTURE_DOMAIN_REQUIRED');
 expect(original.transport).toBeUndefined();
 const content:DraftContent={...original,transport:binding('ORG02'),command:{...original.command,validFrom:'2026-02-01T00:00:00',sourceOperationStatus:'PLANNING'}};
 const saved=await workspace.saveDraft('workspace-steward',{...content,requestId:randomUUID()});
 const request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()};
 const before=await workspace.readDraft('workspace-steward',saved.id);
 const jobs=()=>peer(receipt.name,'SELECT count(*) FROM governance_catalog.import_job');const jobCount=jobs();
 await expect(workspace.submitDraft('workspace-steward',request)).rejects.toThrow('ACCESS_DENIED');expect(jobs()).toBe(jobCount);
 // Demonstrate the old SQL domain hole without retaining its invalid job.
 const badBinding=binding('ORG01'),bad=await workspace.saveDraft('maker',{...content,transport:badBinding,requestId:randomUUID()});
 const input={action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'WORKSPACE_MANUAL',profile:'CORE',...badBinding,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},workspaceDraft:{id:bad.id,expectedVersion:bad.version}};
 const pool=new Pool({connectionString:connection}),client=await pool.connect();
 try{await client.query('BEGIN');const accepted=await client.query('select governance_catalog.import_job_command($1,$2::jsonb) result',['maker',JSON.stringify(input)]);expect(accepted.rows[0].result.id).toBeTruthy();}
 finally{await client.query('ROLLBACK');client.release();await pool.end();}
 expect(jobs()).toBe(jobCount);
 await upgradeWorkspace(receipt);
 expect(await workspace.readDraft('workspace-steward',saved.id)).toEqual(before);
 const restored=await workspace.prepareRevision('workspace-steward',{kind:'CAMPUS',id:campus.id,version:campus.version});
 expect(restored).toMatchObject({domain:'ORG02',transport:binding('ORG02'),command:original.command});
 const submitted=await workspace.submitDraft('workspace-steward',request);expect(submitted.domain).toBe('ORG02');expect(await workspace.submitDraft('workspace-steward',request)).toEqual(submitted);
 const deniedPool=new Pool({connectionString:connection});try{await expect(deniedPool.query('select governance_catalog.import_job_command($1,$2::jsonb)',['maker',JSON.stringify(input)])).rejects.toThrow('ACCESS_DENIED');}finally{await deniedPool.end();}
 console.log(JSON.stringify({status:'PASS',check:'0071_DEFECTS_REPRODUCED_0072_FIXED',privateDraftRestored:true,oldFailedRequestResumed:true,wrongDomainSQLRejected:true}));
}
