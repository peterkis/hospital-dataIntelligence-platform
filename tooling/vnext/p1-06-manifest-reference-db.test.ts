import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {peer,quote,inspect,migrationFiles} from './lineage.mjs';
import {workspaceStartupPrefix} from './workspace-migrations.mjs';
import {openCatalog,LocalSyntheticKeyProvider,canonicalPlan,planBinding,sealProtectedPayload,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,openOrganizationImport,type DraftContent,type DraftSave} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {draftMetadata} from '../../apps/governance-api/src/modules/organization-master/workspace/contracts.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createOrganizationBundleClient} from '../../packages/generated-api-client/src/vnext-client.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const upgrade=process.env['HDIP_REVIEW_CI_MANIFEST_UPGRADE']==='1';
type BundleDraft=Extract<DraftContent,{domain:'BUNDLE'}>;
type Kind='ORG01'|'ORG02'|'PAIR'|'RELATION'|'SUBJECT_ONLY'|'CAMPUS_ONLY';
const matrix:Array<{kind:Kind;permission:string}>=([] as Array<{kind:Kind;permission:string}>).concat(
 ...(['ORG01','ORG02'] as const).map(kind=>['READ','READ_RESTRICTED','WRITE'].map(permission=>({kind,permission}))),
 ['READ','READ_RESTRICTED','ESTABLISH'].map(permission=>({kind:'PAIR' as const,permission})),
 ['READ','READ_RESTRICTED','REVISE'].map(permission=>({kind:'RELATION' as const,permission})),
 [{kind:'SUBJECT_ONLY',permission:'READ'},{kind:'CAMPUS_ONLY',permission:'READ'}],
);
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,bundle:ReturnType<typeof openOrganizationImport>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>;
let app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
let subject:OwnerFact,other:OwnerFact,node:OwnerFact,otherNode:OwnerFact,relation:OwnerFact,otherRelation:OwnerFact;
const legacy:Array<{id:string;version:string}>=[];
let oldEmpty:{id:string;version:string},oldAmbiguousEmpty:{id:string;version:string};
const clone=<T>(value:T):T=>structuredClone(value);
const snapshot=()=>peer(receipt.name,`SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id,number) FROM organization_master.workspace_draft_revision r),
 (SELECT count(*) FROM organization_master.input),(SELECT count(*) FROM governance_catalog.import_job),
 (SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM vnext_control.outcome),
 (SELECT count(*) FROM vnext_control.request_identity))::text`);
function content(metadata:BundleDraft['metadata'],bytes=true):BundleDraft{return {domain:'BUNDLE',campus:'NORTH',metadata,...(bytes?{bytesBase64:fixture.workbook().toString('base64')}:{})};}
function draftFor(kind:Kind,replacement=false,bytes=true):BundleDraft{
 const s=replacement?other:subject,c=replacement?otherNode:node,r=replacement?otherRelation:relation;
 const metadata=clone(fixture.input),dataset=kind==='ORG01'?'ORG01':kind==='ORG02'?'ORG02':'ORG03';
 const row=metadata.manifest.rows.find(row=>row.dataset===dataset)!;metadata.manifest.rows=[row];
 if(row.dataset==='ORG01'){row.intent='REVISE';row.target={owner:'organization-master',id:s.id,expectedVersion:s.version};}
 else if(row.dataset==='ORG02'){row.intent='REVISE';row.target={owner:'organization-master/campus',id:c.id,expectedVersion:c.version};}
 else{
  row.intent=kind==='RELATION'?'REVISE':'CREATE';
  row.subject={kind:'PLATFORM_REF',dataset:'ORG01',id:s.id,expectedVersion:s.version};
  row.campus={kind:'PLATFORM_REF',dataset:'ORG02',id:c.id,expectedVersion:c.version};
  if(kind==='RELATION'){row.target={owner:'organization-master/operating-relation',id:r.id,expectedVersion:r.version};}
  else delete row.target;
  if(kind==='SUBJECT_ONLY')row.campus={kind:'JOB_ALIAS',dataset:'ORG02',alias:'DEMO_UNFINISHED'};
  if(kind==='CAMPUS_ONLY')row.subject={kind:'JOB_ALIAS',dataset:'ORG01',alias:'DEMO_UNFINISHED'};
 }
 return content(metadata,bytes);
}
function revoke(kind:Kind,permission:string){
 const pair=kind==='PAIR'||kind==='RELATION',table=pair?'organization_master.operating_access':'organization_master.access';
 const where=pair?`subject_id=${quote(subject.id)}::uuid AND campus_id=${quote(node.id)}::uuid`:`subject_id=${quote(kind==='ORG01'||kind==='SUBJECT_ONLY'?subject.id:node.id)}::uuid AND campus='NORTH'`;
 const removed=peer(receipt.name,`WITH r AS(DELETE FROM ${table} WHERE actor='maker' AND ${where} AND permission=${quote(permission)} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]')::text FROM r`);
 expect(JSON.parse(removed)).toHaveLength(1);
 return ()=>peer(receipt.name,`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${quote(removed)}::jsonb) ON CONFLICT DO NOTHING`);
}
async function post(path:string,payload:unknown,identity='maker'){
 const response=await fetch(base+'/api/vnext/organization-workspace/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':identity},body:JSON.stringify(payload)});
 return {status:response.status,body:await response.json() as Record<string,any>};
}
function rawRead(id:string){return peer(receipt.name,`SELECT organization_master.workspace_read('maker',${quote(id)}::uuid)::text`);}
function rawSave(value:BundleDraft,format:'V2'|'V3'|'V4',prior?:{id:string;version:string},omitReferences=false){
 const input:DraftSave={...value,requestId:randomUUID(),...(prior?{id:prior.id,expectedVersion:prior.version}:{})},metadata=draftMetadata(input,format);
 if(omitReferences)metadata.manifestReferences=[]; // Deliberate corruption: ciphertext remains bound to the exact source refs.
 const digest=planBinding(provider,'WORKSPACE_DRAFT_V1',{state:'EDITING',input}),raw=Buffer.from(canonicalPlan(input));
 try{const envelope=sealProtectedPayload(raw,['WORKSPACE_DRAFT_V1',digest],provider),request={requestId:input.requestId,id:input.id,expectedVersion:input.expectedVersion,state:'EDITING',metadata};
  return JSON.parse(peer(receipt.name,`SELECT organization_master.workspace_save('maker',${quote(JSON.stringify(request))}::jsonb,${quote(digest)},${quote(JSON.stringify(envelope))}::jsonb)::text`)) as {id:string;version:string};
 }finally{raw.fill(0);}
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);bundle=openOrganizationImport(connection,provider);fixture=await organizationBundleFixture(receipt,connection,provider,catalog);
 subject=await fixture.x.createSubject();other=await fixture.x.createSubject();node=await fixture.x.createCampus();otherNode=await fixture.x.createCampus();fixture.x.grantPair(subject.id,node.id);fixture.x.grantPair(other.id,otherNode.id);
 const establish=(s:OwnerFact,c:OwnerFact)=>fixture.x.operatingApply({...fixture.x.common,...fixture.x.endpoints(s,c),action:'ESTABLISH',evidence:fixture.x.artifact.artifactId,facts:{role:'MANAGER',relationTypeText:'DEMO_MANIFEST',primary:'N',catalog:fixture.x.codeSet.reference,services:[],scopeTargets:[],licenseScopeText:null}});
 relation=await establish(subject,node);otherRelation=await establish(other,otherNode);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,{owner:bundle,actor:r=>actor(r.headers)},{owner:workspace,actor:r=>actor(r.headers)});
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
 if(upgrade){
  for(const {kind,permission} of matrix.filter(c=>c.permission==='READ'||c.permission==='READ_RESTRICTED')){
   const draft=draftFor(kind,false,permission==='READ'),saved=rawSave(draft,'V3'),restore=revoke(kind,permission);
   try{
    expect((await post('drafts/read',{id:saved.id})).status).toBe(200);expect(rawRead(saved.id)).toContain(saved.id);
    legacy.push(rawSave(draft,'V3',saved));
   }finally{restore();}
  }
  const empty=content({...clone(fixture.input),manifest:{policy:'ORG_BUNDLE_V1',rows:[]}},false);
  oldEmpty=rawSave(empty,'V3');oldAmbiguousEmpty=rawSave(empty,'V2');
  expect((await inspect(receipt)).ledger).toHaveLength(76);expect(()=>workspaceStartupPrefix(migrationFiles(),migrationFiles().slice(0,76))).toThrow('WORKSPACE_MIGRATION_REQUIRED');
  console.log(JSON.stringify({check:'0076_EXACT_MANIFEST_REPRODUCED',httpReads:legacy.length,sqlReads:legacy.length,sqlResaves:legacy.length}));
  const {upgradeManifestReferenceAccess}=await import('./review-ci-manifest-database.mjs');await upgradeManifestReferenceAccess(receipt);
 }
 expect(workspaceStartupPrefix(migrationFiles(),(await inspect(receipt)).ledger)).toBe(migrationFiles().length);
});
afterAll(async()=>{await app?.close();await workspace?.close();await bundle?.close();await fixture?.close();await catalog?.close();});

if(upgrade)test('0076 protected legacy envelopes are withheld without poisoning lists; safe empty V3 drafts still resume',async()=>{
 const before=snapshot();
 for(const saved of legacy){
  expect(()=>rawRead(saved.id)).toThrow('ACCESS_DENIED');expect((await post('drafts/read',{id:saved.id})).status).toBe(403);
  await expect(workspace.saveDraft('maker',{...draftFor('ORG01',true),id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 }
 const list=await post('drafts/list',{});expect(list.status).toBe(200);for(const saved of legacy)expect((list.body as unknown as Array<{id:string}>).some(r=>r.id===saved.id)).toBe(false);
 expect(snapshot()).toBe(before);
 const restored=await workspace.readDraft('maker',oldEmpty.id);expect(restored.content.domain).toBe('BUNDLE');
 const next=await workspace.saveDraft('maker',{...restored.content,id:oldEmpty.id,expectedVersion:oldEmpty.version,requestId:randomUUID()});expect(next.version).toBe('2');
 const ambiguous=await workspace.readDraft('maker',oldAmbiguousEmpty.id);
 await expect(workspace.saveDraft('maker',{...ambiguous.content,id:oldAmbiguousEmpty.id,expectedVersion:oldAmbiguousEmpty.version,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
});

for(const {kind,permission} of matrix)test(`${kind}: current ${permission} is required despite retained generic scope and contract access`,async()=>{
 const draft=draftFor(kind,false,permission!=='READ_RESTRICTED'),replacement=draftFor(kind,true,permission!=='READ_RESTRICTED'),saved=await workspace.saveDraft('maker',{...draft,requestId:randomUUID()}),original=await workspace.readDraft('maker',saved.id);
 expect((await post('drafts/read',{id:saved.id})).status).toBe(200);expect((await post('drafts/read',{id:saved.id},'outsider')).status).toBe(403);
 const restore=revoke(kind,permission),request={...replacement,id:saved.id,expectedVersion:saved.version,requestId:randomUUID()},before=snapshot();
 const mutationOnly=['WRITE','ESTABLISH','REVISE'].includes(permission);
 try{
  expect(await workspace.capabilities('maker',replacement)).toMatchObject({canRead:true,canWrite:true});
  expect((await post('drafts/read',{id:saved.id})).status).toBe(mutationOnly?200:403);
  if(!mutationOnly)expect(()=>rawRead(saved.id)).toThrow('ACCESS_DENIED');
  if(permission==='READ')expect((await workspace.listDrafts('maker')).some(r=>r.id===saved.id)).toBe(false);
  for(const [path,payload] of [
   ['drafts/save',{...draft,id:saved.id,expectedVersion:saved.version,requestId:randomUUID()}],
   ['drafts/save',request],
   ['drafts/submit',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()}],
   ['drafts/discard',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()}],
  ] as const){const denied=await post(path,payload);expect(denied.status,JSON.stringify(denied.body)).toBe(403);expect(denied.body['code']).toBe('ACCESS_DENIED');}
  expect(snapshot()).toBe(before);
 }finally{restore();}
 expect(await workspace.readDraft('maker',saved.id)).toEqual(original);
 const revised=await post('drafts/save',request);expect(revised.status,JSON.stringify(revised.body)).toBe(200);expect(revised.body['version']).toBe('2');expect((await post('drafts/save',request)).body).toEqual(revised.body);
 const reopened=openOrganizationWorkspace(connection,provider);try{expect((await reopened.readDraft('maker',saved.id)).content).toEqual(request);}finally{await reopened.close();}
});

test('cross-scope ORG03 endpoints use their real scopes rather than the receiving scope',async()=>{
 peer(receipt.name,"INSERT INTO vnext_control.protected_grant SELECT actor_code,dataset_id,'SOUTH',purpose,permission FROM vnext_control.protected_grant WHERE campus='NORTH' ON CONFLICT DO NOTHING; INSERT INTO organization_master.access SELECT a,'00000000-0000-0000-0000-000000000000'::uuid,'SOUTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','WRITE','READ_RESTRICTED','REVIEW']) p ON CONFLICT DO NOTHING;");
 const south=await fixture.x.createCampus('DEMO south','HEADQUARTERS','SOUTH');fixture.x.grantPair(subject.id,south.id);
 const draft=draftFor('PAIR'),row=draft.metadata.manifest!.rows![0]!;if(row.dataset!=='ORG03')throw new Error('ORG03_REQUIRED');row.governanceScope='SOUTH';row.campus={kind:'PLATFORM_REF',dataset:'ORG02',id:south.id,expectedVersion:south.version};
 const saved=await workspace.saveDraft('maker',{...draft,requestId:randomUUID()});expect((await workspace.readDraft('maker',saved.id)).content).toMatchObject(draft);
 const restore=revoke('SUBJECT_ONLY','READ');try{await expect(workspace.readDraft('maker',saved.id)).rejects.toThrow('ACCESS_DENIED');}finally{restore();}
});

test('metadata with omitted exact references cannot authenticate retained ciphertext',async()=>{
 const saved=rawSave(draftFor('ORG01'),'V4',undefined,true);
 await expect(workspace.readDraft('maker',saved.id)).rejects.toThrow('PAYLOAD_UNAVAILABLE');
});

test('authorized workbook still completes independent approval and idempotent Apply',async()=>{
 const draft=content(clone(fixture.input)),saved=await workspace.saveDraft('maker',{...draft,requestId:randomUUID()}),request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()};
 const submitted=await workspace.submitDraft('maker',request);expect(await workspace.submitDraft('maker',request)).toEqual(submitted);
 const ref={jobId:submitted.jobId,revisionId:submitted.revisionId},writer=createOrganizationBundleClient(base,'maker'),reviewer=createOrganizationBundleClient(base,'reviewer'),admin=createOrganizationBundleClient(base,'bundle-admin');
 const preauth=await admin.preauthorize({...ref,requestId:randomUUID(),grants:[2,3,4].flatMap(row=>['maker','reviewer'].map(actor=>({row,actor,permissions:['READ','CREATE','REVIEW'] as const})))});expect(preauth.response.status,JSON.stringify(preauth.error)).toBe(200);
 const legal=await reviewer.legalReview(ref);expect(legal.response.status,JSON.stringify(legal.error)).toBe(200);
 const verified=await reviewer.verify({...ref,requestId:randomUUID(),digest:legal.data!.digest});expect(verified.response.status,JSON.stringify(verified.error)).toBe(200);
 const requestId=randomUUID(),plan=await writer.plan({...ref,requestId});expect(plan.response.status,JSON.stringify(plan.error)).toBe(200);
 const candidate=plan.data!,review=await reviewer.review({candidateId:candidate.candidateId});expect(review.response.status,JSON.stringify(review.error)).toBe(200);expect(review.data!.commands).toHaveLength(12);
 expect((await reviewer.approve(candidate)).response.status).toBe(200);
 const applied=await writer.apply({candidateId:candidate.candidateId,requestId});expect(applied.response.status,JSON.stringify(applied.error)).toBe(200);expect(applied.data).toMatchObject({status:'COMMITTED'});expect(applied.data!.facts).toHaveLength(12);expect((await writer.apply({candidateId:candidate.candidateId,requestId})).data).toEqual(applied.data);
 const recovered=await workspace.readDraft('maker',saved.id);expect(recovered.state).toBe('SUBMITTED');expect(recovered.content).toHaveProperty('bytesBase64',draft.bytesBase64);
});
