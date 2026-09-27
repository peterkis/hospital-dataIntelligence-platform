import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {peer,quote} from './lineage.mjs';
import {workspaceManualFixture} from './workspace-manual-fixture.js';
import {campusCodeSet} from './campus-fixture.js';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {organizationBundleHttpSmoke} from './organization-bundle-http-smoke.js';
import {openCatalog,LocalSyntheticKeyProvider,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,openOrganizationImport,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,bundle:ReturnType<typeof openOrganizationImport>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,pool:Pool;
let facts:OwnerFact[],campus:OwnerFact;
const steward='workspace-steward';
const counts=()=>peer(receipt.name,"SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.import_job),(SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM organization_master.input),(SELECT count(*) FROM organization_master.workspace_draft_revision WHERE state='SUBMITTED'))::text");
const post=(who:string,url:string,payload:unknown)=>app.inject({method:'POST',url,headers:{'x-catalog-actor':who},payload:payload as Record<string,unknown>});
const save=(who:string,content:DraftContent)=>workspace.saveDraft(who,{...content,requestId:randomUUID()});
const transport=async(domain:string)=>{const item=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset===domain&&c.status==='PUBLISHED'&&c.definition.templateVersion===domain+'_MANUAL_CORE_V1');if(!item)throw new Error('MANUAL_FIXTURE_REQUIRED');return {contractId:item.id,contractVersionId:item.versionId};};
const job=(draft:{id:string;version:string},binding:{contractId:string;contractVersionId:string})=>({action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'WORKSPACE_MANUAL',profile:'CORE',...binding,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)},workspaceDraft:{id:draft.id,expectedVersion:draft.version}});
async function revision(who:string=steward):Promise<Extract<DraftContent,{domain:'ORG02'}>>{const draft=await workspace.prepareRevision(who,{kind:'CAMPUS',id:campus.id,version:campus.version});if(draft.domain!=='ORG02')throw new Error('WRONG_DOMAIN');return {...draft,command:{...draft.command,validFrom:'2026-02-01T00:00:00',sourceOperationStatus:'PLANNING'}};}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);bundle=openOrganizationImport(connection,provider);pool=new Pool({connectionString:connection});
 fixture=await organizationBundleFixture(receipt,connection,provider,catalog);
 await workspaceManualFixture(catalog);await campusCodeSet(catalog,fixture.x.source.versionId);
 const result=await organizationBundleHttpSmoke(bundle,fixture,()=>{},catalog);facts=result.facts!;
 campus=facts.find(f=>f.owner==='organization-master/campus')!;expect(campus).toBeDefined();
 // Import preauthorization grants CREATE, not ongoing REVISE. Provision only
 // the actual imported pairs for this maintenance scenario, not a Cartesian set.
 for(const relation of facts.filter(f=>f.owner==='organization-master/operating-relation')){
  const [row]=await fixture.x.operating.read('maker',{kind:'RELATION',mode:'EXACT',id:relation.id,version:relation.version});
  if(!row)throw new Error('IMPORTED_PAIR_REQUIRED');fixture.x.grantPair(row.subject.id,row.campus.id);
 }
 peer(receipt.name,`INSERT INTO vnext_control.actor VALUES('${steward}','SYNTHETIC_IMPORTED_CAMPUS_STEWARD',true);
 INSERT INTO vnext_control.actor_grant SELECT '${steward}','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE']) p;
 INSERT INTO organization_master.access SELECT '${steward}',${quote(campus.id)}::uuid,'NORTH',p FROM unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p;
 INSERT INTO vnext_control.object_grant SELECT '${steward}',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='maker' AND permission='READ' ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.protected_grant SELECT '${steward}',dataset_id,campus,purpose,permission FROM vnext_control.protected_grant WHERE actor_code='maker' AND permission='READ' ON CONFLICT DO NOTHING;`);
 if(process.env['HDIP_REVIEW_CI_UPGRADE']==='1'){
  const {workspaceUpgradeProof}=await import('./workspace-upgrade-proof.js');
  await workspaceUpgradeProof(workspace,catalog,connection,receipt,campus);
 }
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
});
afterAll(async()=>{await app?.close();await pool?.end();await workspace?.close();await bundle?.close();await fixture?.close();await catalog?.close();});

for(const [domain,kind,owner] of [['ORG01','ORGANIZATION','organization-master'],['ORG02','CAMPUS','organization-master/campus'],['ORG03','RELATION','organization-master/operating-relation']] as const){
 for(const wrong of ['ORG01','ORG02','ORG03'].filter(d=>d!==domain))test(`${domain} refuses ${wrong} transport through HTTP and SQL with no job or artifact side effects`,async()=>{
  const target=facts.find(f=>f.owner===owner)!;
  const original=await workspace.prepareRevision('maker',{kind,id:target.id,version:target.version});
  if(original.domain==='BUNDLE')throw new Error('WRONG_DOMAIN');
  const bad={...original,transport:await transport(wrong),attachment:{filename:'DEMO.txt',bytesBase64:Buffer.from('DEMO domain mismatch').toString('base64')},command:{...original.command,validFrom:'2026-02-01T00:00:00'}};
  const saved=await save('maker',bad),before=counts();
  const response=await post('maker','/api/vnext/organization-workspace/drafts/submit',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()});
  expect(response.statusCode).toBe(503);expect(response.json().code).toBe('BLOCKED_DEPENDENCY');expect(counts()).toBe(before);
  await expect(pool.query('select governance_catalog.import_job_command($1,$2::jsonb)',['maker',JSON.stringify(job(saved,bad.transport))])).rejects.toThrow('ACCESS_DENIED');
  expect(counts()).toBe(before);expect((await workspace.readDraft('maker',saved.id)).state).toBe('EDITING');
 });
}
test('imported campus revision uses a matching manual transport and completes independent approval without catalog WRITE',async()=>{
 const old=await fixture.x.campus.references.history('maker',campus.id);
 const content=await revision();expect(content.transport).toEqual(await transport('ORG02'));
 expect(content.command['source']).toEqual((await revision('maker')).command['source']);
 const originalFacts=content.command['facts'];if(!originalFacts||typeof originalFacts!=='object')throw new Error('CAMPUS_FACTS_REQUIRED');
 const saved=await save(steward,{...content,command:{...content.command,facts:{...originalFacts,campusName:'DEMO steward revised imported campus'}}});
 const response=await post(steward,'/api/vnext/organization-workspace/drafts/submit',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()});
 expect(response.statusCode,response.body).toBe(200);const submitted=response.json();
 expect(await workspace.preflight(steward,{domain:'ORG02',inputId:submitted.inputId})).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE'});
 const requestId=randomUUID(),candidate=await fixture.x.campus.plan(steward,{inputId:submitted.inputId,requestId});
 await fixture.x.campus.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await fixture.x.campus.approveApplyUnit('reviewer',candidate);
 const result=await fixture.x.campus.applyUnit(steward,{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');
 const after=await fixture.x.campus.references.history('maker',campus.id);expect(after.versions.slice(0,old.versions.length)).toEqual(old.versions);expect(after.versions.at(-1)!.facts.campusName).toBe('DEMO steward revised imported campus');
 campus={...campus,version:after.head};
 expect(peer(receipt.name,`SELECT count(*) FROM vnext_control.object_grant WHERE actor_code='${steward}' AND permission='WRITE'`)).toBe('0');
 expect(peer(receipt.name,`SELECT count(*) FROM vnext_control.protected_grant WHERE actor_code='${steward}' AND permission='STORE'`)).toBe('0');
});
test('the steward still cannot create an ordinary import job, create a campus or revise another imported campus',async()=>{
 const binding=await transport('ORG02');
 await expect(catalog.importJobCommand(steward,{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DEMO_NO_DRAFT',profile:'CORE',...binding,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}})).rejects.toThrow('ACCESS_DENIED');
 expect(await workspace.capabilities(steward,{domain:'ORG02',campus:'NORTH',command:{action:'CREATE'}})).toMatchObject({canWrite:false});
 const other=facts.find(f=>f.owner==='organization-master/campus'&&f.id!==campus.id)!;
 await expect(workspace.prepareRevision(steward,{kind:'CAMPUS',id:other.id,version:other.version})).rejects.toThrow('ACCESS_DENIED');
});
for(const permission of ['WRITE','READ','READ_RESTRICTED'])test(`current ${permission} revocation blocks imported-object submission atomically`,async()=>{
 const saved=await save(steward,await revision()),before=counts();
 peer(receipt.name,`DELETE FROM organization_master.access WHERE actor='${steward}' AND subject_id=${quote(campus.id)}::uuid AND permission=${quote(permission)}`);
 try{const response=await post(steward,'/api/vnext/organization-workspace/drafts/submit',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()});expect(response.statusCode).toBe(403);expect(counts()).toBe(before);}
 finally{peer(receipt.name,`INSERT INTO organization_master.access VALUES('${steward}',${quote(campus.id)}::uuid,'NORTH',${quote(permission)})`);}
});
test('private draft identity, expected revision, scope and internal transport binding remain mandatory',async()=>{
 const content=await revision(),saved=await save(steward,content),before=counts();
 await expect(workspace.submitDraft('maker',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 await expect(workspace.submitDraft(steward,{id:saved.id,expectedVersion:'999',requestId:randomUUID()})).rejects.toThrow('STALE_HEAD');
 await expect(save(steward,{...content,campus:'SOUTH'})).rejects.toThrow('ACCESS_DENIED');
 const request=job(saved,content.transport!);
 for(const invalid of [{...request,workspaceDraft:{id:saved.id,expectedVersion:'999'}},{...request,contractId:randomUUID()}, {...request,input:{kind:'FILE'}}, {...request,action:'REVISE'}]){
  await expect(pool.query('select organization_master.workspace_transport_authorize($1,$2::jsonb)',[steward,JSON.stringify(invalid)])).rejects.toThrow('ACCESS_DENIED');
 }
 expect(counts()).toBe(before);
});
test('a same-domain published non-manual template is not an execution transport',async()=>{
 const current=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG01'&&c.definition.templateVersion==='ORG01_MANUAL_CORE_V1')!;
 const command=<A extends string>(action:A,extra:Record<string,unknown>)=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'DEMO_WRONG_TEMPLATE',...extra});
 const draft=await catalog.contractCommand('maker',command('REVISE',{target:current.id,expectedHead:current.head,datasetVersionId:current.datasetVersionId,definition:{...current.definition,ruleVersion:'ORG01_OTHER_'+randomUUID().replaceAll('-','').toUpperCase(),templateVersion:'ORG01_OTHER_CORE_V1'},validFrom:'2026-01-01T00:00:00',validTo:null}));
 const approved=await catalog.contractCommand('reviewer',command('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest}));
 const impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
 const published=await catalog.contractCommand('reviewer',command('PUBLISH',{target:draft.id,expectedHead:approved.head,reviewDigest:approved.reviewDigest,impactDigest:impact.impactDigest}));
 const saved=await save('maker',{domain:'ORG01',campus:'NORTH',transport:{contractId:published.id,contractVersionId:published.versionId},command:{action:'CREATE',source:{...fixture.x.common.source}}}),before=counts();
 await expect(workspace.submitDraft('maker',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');expect(counts()).toBe(before);
 await workspaceManualFixture(catalog);
});
test('a steward cannot borrow the maintenance exception for an unrelated source version',async()=>{
 const oldContent=await revision();
 const command=<A extends string>(action:A,extra:Record<string,unknown>)=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'DEMO_UNRELATED_SOURCE',...extra});
 const sourceDraft=await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'UNRELATED_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'DEMO unrelated source',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:'SYNTHETIC_BOOTSTRAP'},validFrom:'2026-01-01T00:00:00'}));
 const sourceReview=await catalog.command('maker',command('SUBMIT',{target:sourceDraft.id,expectedHead:sourceDraft.head}));
 const source=await catalog.command('reviewer',command('PUBLISH',{target:sourceDraft.id,expectedHead:sourceReview.head,reviewDigest:sourceReview.reviewDigest}));
 const changed=await campusCodeSet(catalog,source.versionId);
 peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT '${steward}',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(source.id)}::uuid AND permission='READ' ON CONFLICT DO NOTHING;`);
 try{
  const originalSource=oldContent.command['source'];if(!originalSource||typeof originalSource!=='object')throw new Error('SOURCE_REQUIRED');
  const changedBinding={contractId:changed.published.id,contractVersionId:changed.published.versionId};
  const saved=await save(steward,{...oldContent,transport:changedBinding,command:{...oldContent.command,source:{...originalSource,systemId:source.id,versionId:source.versionId}}});
  const before=counts(),response=await post(steward,'/api/vnext/organization-workspace/drafts/submit',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()});
  expect(response.statusCode,response.body).toBe(403);expect(response.json().code).toBe('ACCESS_DENIED');expect(counts()).toBe(before);
  await expect(pool.query('select organization_master.workspace_transport_authorize($1,$2::jsonb)',[steward,JSON.stringify(job(saved,changedBinding))])).rejects.toThrow('ACCESS_DENIED');
  expect(counts()).toBe(before);expect((await workspace.readDraft(steward,saved.id)).state).toBe('EDITING');
 }finally{await campusCodeSet(catalog,fixture.x.source.versionId);}
});
