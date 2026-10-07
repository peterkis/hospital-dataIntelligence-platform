import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {beforeAll,afterAll,test,expect} from 'vitest';
import {openCatalog,type Catalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {locationFixture} from './p3-06-fixture.js';
import {validationKeys} from './p3-07-validation-keys.mjs';
import {provisionLocationUse} from './p3-07-provisioning.mjs';
import {peer} from './lineage.mjs';
import {openLocationUsageTypes} from '../../apps/governance-api/src/modules/location-master/usage-types.js';
import type {UsageTypeItem} from '../../apps/governance-api/src/modules/location-master/usage-type-contracts.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Catalog,base:Awaited<ReturnType<typeof locationFixture>>;
beforeAll(async()=>{const provider=validationKeys(receipt),pool=new Pool({connectionString:connection,max:1});try{catalog=await openCatalog(connection,provider);const role=(await pool.query('select current_user r')).rows[0].r;base=await locationFixture(receipt,role,catalog,provider,connection);provisionLocationUse(receipt,role,provider);peer(receipt.name,"INSERT INTO location_master.usage_type_access SELECT a,p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;INSERT INTO location_master.usage_type_access SELECT 'reviewer',p FROM unnest(ARRAY['VERIFY','REVIEW']) p ON CONFLICT DO NOTHING;");}finally{await pool.end();}});
afterAll(async()=>{await base?.owner.close();await base?.campus.close();await catalog?.close();});

async function approvedPurpose(owner:ReturnType<typeof openLocationUsageTypes>):Promise<UsageTypeItem>{
 const draft=await owner.command('maker',{action:'CREATE',requestId:randomUUID(),reason:'TEST POLICY ONLY purpose',code:'TEST_'+randomUUID().replaceAll('-','').toUpperCase(),name:'办公用途',meaning:'TEST office use',description:null,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:base.source!.id,sourceVersionId:base.source!.versionId,evidenceId:base.artifact.artifactId});
 await owner.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST independent meaning review',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:base.artifact.artifactId,meaningAccepted:true});
 return owner.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST independent approval',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest});
}

test('D02: direct disable and enable retain actor, exact requests and historical disabled state without approval',async()=>{
 const owner=openLocationUsageTypes(connection,validationKeys(receipt));try{const a=await approvedPurpose(owner),disable={action:'DISABLE' as const,requestId:randomUUID(),reason:'TEST suspend purpose directly',target:a.id,expectedHead:a.head},stopped=await owner.command('maker',disable);
 expect(stopped.enabled).toBe(false);expect(stopped.events.at(-1)).toMatchObject({action:'DISABLE',actor:'maker',reason:disable.reason,requestId:disable.requestId});expect(await owner.command('maker',disable)).toEqual(stopped);
 await expect(owner.command('maker',{...disable,reason:'different payload'})).rejects.toThrow('REQUEST_CONFLICT');
 const restarted=await owner.command('maker',{action:'ENABLE',requestId:randomUUID(),reason:'TEST restore directly without independent approval',target:a.id,expectedHead:stopped.head});expect(restarted.enabled).toBe(true);expect(restarted.events.map(e=>e.action)).toEqual(['DISABLE','ENABLE']);
 expect((await owner.read('maker',{id:a.id,recordAsOf:stopped.events[0]!.recordedAt})).enabled).toBe(false);
 await expect(owner.command('maker',{action:'DISABLE',requestId:randomUUID(),reason:'TEST stale state',target:a.id,expectedHead:stopped.head})).rejects.toThrow('STALE_HEAD');
 }finally{await owner.close();}
});

test('D03: rename keeps purpose identity/code and changing meaning must create a distinct purpose',async()=>{
 const owner=openLocationUsageTypes(connection,validationKeys(receipt));try{const a=await approvedPurpose(owner),revision={action:'REVISE' as const,requestId:randomUUID(),reason:'TEST rename',target:a.id,expectedHead:a.head,code:a.code,name:'行政办公',meaning:a.meaning,description:'TEST same meaning',validFrom:a.validFrom,validTo:a.validTo,sourceId:a.sourceId,sourceVersionId:a.sourceVersionId,evidenceId:a.evidenceId},draft=await owner.command('maker',revision);expect(draft).toMatchObject({id:a.id,code:a.code,name:'行政办公',status:'DRAFT'});
 await expect(owner.command('maker',{...revision,requestId:randomUUID(),expectedHead:draft.head,meaning:'changed substantive meaning'})).rejects.toThrow('USAGE_TYPE_MEANING_IMMUTABLE');
 expect((await owner.history('maker',{id:a.id})).map(v=>v.name)).toEqual(['办公用途','行政办公']);
 }finally{await owner.close();}
});

test('D04: enabling draft cannot publish it and maker alias cannot independently verify it',async()=>{
 const owner=openLocationUsageTypes(connection,validationKeys(receipt));try{const a=await owner.command('maker',{action:'CREATE',requestId:randomUUID(),reason:'TEST draft only',code:'DRAFT_'+randomUUID().replaceAll('-','').toUpperCase(),name:'草稿用途',meaning:'TEST unpublished',description:null,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:base.source!.id,sourceVersionId:base.source!.versionId,evidenceId:base.artifact.artifactId});
 await expect(owner.command('maker',{action:'ENABLE',requestId:randomUUID(),reason:'TEST must not publish',target:a.id,expectedHead:a.head})).rejects.toThrow('APPROVAL_REQUIRED');
 peer(receipt.name,"INSERT INTO location_master.usage_type_access VALUES('maker-alias','VERIFY') ON CONFLICT DO NOTHING;");
 try{await expect(owner.command('maker-alias',{action:'VERIFY',requestId:randomUUID(),reason:'TEST same underlying maker',target:a.id,expectedHead:a.head,versionId:a.versionId,reviewDigest:a.reviewDigest,evidenceId:a.evidenceId,meaningAccepted:true})).rejects.toThrow('MAKER_CHECKER_REQUIRED');}finally{peer(receipt.name,"DELETE FROM location_master.usage_type_access WHERE actor='maker-alias' AND permission='VERIFY';");}
 expect((await owner.read('maker',{id:a.id})).status).toBe('DRAFT');
 }finally{await owner.close();}
});

test('D01: independently approved purpose is readable and enables new codes without a code change',async()=>{
 const {openLocationUsageTypes}=await import('../../apps/governance-api/src/modules/location-master/usage-types.js');
 const owner=openLocationUsageTypes(connection,validationKeys(receipt));
 try{
  const request={action:'CREATE' as const,requestId:randomUUID(),reason:'TEST POLICY ONLY new purpose',code:'RESEARCH_'+randomUUID().replaceAll('-','').toUpperCase(),name:'科研办公',meaning:'TEST research office purpose',description:null,validFrom:'2026-01-01T00:00:00',validTo:null,sourceId:base.source!.id,sourceVersionId:base.source!.versionId,evidenceId:base.artifact.artifactId};
  const draft=await owner.command('maker',request);
  await owner.command('reviewer',{action:'VERIFY',requestId:randomUUID(),reason:'TEST independently checked source and meaning',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest,evidenceId:base.artifact.artifactId,meaningAccepted:true});
  const approved=await owner.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST independent purpose approval',target:draft.id,expectedHead:draft.head,versionId:draft.versionId,reviewDigest:draft.reviewDigest});
  expect(await owner.read('maker',{id:approved.id})).toMatchObject({id:approved.id,code:request.code,name:'科研办公',status:'APPROVED',enabled:true});
  expect((await owner.list('maker',{limit:100})).items).toContainEqual(expect.objectContaining({id:approved.id,code:request.code,status:'APPROVED'}));
 }finally{await owner.close();}
});
