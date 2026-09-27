import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {peer,quote} from './lineage.mjs';
import {workspaceManualFixture} from './workspace-manual-fixture.js';
import {openCatalog,LocalSyntheticKeyProvider,canonicalPlan,planBinding,sealProtectedPayload,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,openOrganization,type DraftContent,type DraftSave} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {draftMetadata} from '../../apps/governance-api/src/modules/organization-master/workspace/contracts.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const steward='exact-license-steward',from='2026-01-01T00:00:00';
type Manual=Extract<DraftContent,{domain:'ORG01'}>;
type Saved={id:string;version:string};
type Source={id:string;versionId:string};
type Transport={contractId:string;contractVersionId:string};
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,org:ReturnType<typeof openOrganization>,app:Awaited<ReturnType<typeof buildCatalogServer>>,pool:Pool;
let sourceA:Source,sourceB:Source,transportA:Transport,transportB:Transport,evidenceA:string,evidenceB:string;
let subject:OwnerFact,licenseA:OwnerFact,licenseB:OwnerFact,foreign:OwnerFact;
let legacy:Saved,legacyInput:DraftSave,legacyRow:string;
const oldProbes:Array<{saved:Saved;content:Manual;job:Record<string,unknown>}>=[];
const counts=()=>peer(receipt.name,"SELECT jsonb_build_array((SELECT count(*) FROM governance_catalog.import_job),(SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM organization_master.input),(SELECT count(*) FROM organization_master.workspace_draft_revision WHERE state='SUBMITTED'),(SELECT count(*) FROM organization_master.version),(SELECT count(*) FROM organization_master.license_version))::text");
const grants=()=>peer(receipt.name,`SELECT jsonb_build_array((SELECT count(*) FROM vnext_control.object_grant WHERE actor_code=${quote(steward)} AND permission='WRITE'),(SELECT count(*) FROM vnext_control.protected_grant WHERE actor_code=${quote(steward)} AND permission='STORE'))::text`);
const post=(who:string,path:string,payload:unknown)=>app.inject({method:'POST',url:'/api/vnext/organization-workspace/'+path,headers:{'x-catalog-actor':who},payload:payload as Record<string,unknown>});
const content=(which:'A'|'B',command:Record<string,unknown>):Manual=>{
 const s=which==='A'?sourceA:sourceB;
 return {domain:'ORG01',campus:'NORTH',transport:which==='A'?transportA:transportB,command:{source:{systemId:s.id,versionId:s.versionId,alias:'DEMO_EXACT_TRANSPORT',versionNo:1,recordLocator:'DEMO_ROW',recordedAt:from,recordStatus:'PUBLISHED',approvalRef:'DEMO_APPROVAL'},validFrom:from,validTo:null,...command}};
};
const organizationCommand=(evidence:string,action='REVISE')=>({action,...(action==='REVISE'?{target:{id:subject.id,version:subject.version}}:{}),facts:{legalName:'DEMO exact source subject',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:evidence},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_EXACT',value:action==='CREATE'?randomUUID():'DEMO_REVISED'}]});
const licenseCommand=(evidence:string,action='REVISE_LICENSE',target=licenseA)=>({action,target:{id:subject.id,version:subject.version},...(action==='REVISE_LICENSE'?{licenseTarget:{id:target.id,version:target.version}}:{}),license:{namespace:'DEMO_EXACT_LICENSE',number:action==='ADD_LICENSE'?randomUUID():'DEMO_REVISED_LICENSE',authority:'DEMO authority',evidence,validFrom:from,validTo:null,endKind:'VERIFIED_UNBOUNDED'}});
const job=(saved:Saved,transport:Transport)=>({action:'CREATE',scope:'SYNTHETIC',profile:'CORE',requestId:randomUUID(),reason:'WORKSPACE_MANUAL',workspaceDraft:{id:saved.id,expectedVersion:saved.version},...transport,input:{kind:'METADATA_ONLY',declaredSha256:'a'.repeat(64)}});
async function apply(who:string,inputId:string){
 const requestId=randomUUID(),candidate=await org.plan(who,{inputId,requestId});await org.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await org.approveApplyUnit('reviewer',candidate);
 const result=await org.applyUnit(who,{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
 expect(await org.applyUnit(who,{candidateId:candidate.candidateId,requestId})).toEqual(result);return result.facts[0]!;
}
async function commit(who:string,input:Manual){
 const saved=await workspace.saveDraft(who,{...input,requestId:randomUUID()}),request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()};
 const response=await post(who,'drafts/submit',request);expect(response.statusCode,response.body).toBe(200);
 const submission=response.json();expect(await workspace.submitDraft(who,request)).toEqual(submission);
 expect(await workspace.preflight(who,{domain:'ORG01',inputId:submission.inputId})).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE'});
 return apply(who,submission.inputId);
}
async function storeLegacy(input:DraftSave,metadata=draftMetadata(input,'V1')):Promise<Saved>{
 const digest=planBinding(provider,'WORKSPACE_DRAFT_V1',{state:'EDITING',input}),raw=Buffer.from(canonicalPlan(input));
 try{const envelope=sealProtectedPayload(raw,['WORKSPACE_DRAFT_V1',digest],provider);
  return (await pool.query('select organization_master.workspace_save($1,$2::jsonb,$3,$4::jsonb) r',[steward,JSON.stringify({requestId:input.requestId,state:'EDITING',metadata}),digest,JSON.stringify(envelope)])).rows[0].r;
 }finally{raw.fill(0);}
}
const readRow=(saved:Saved)=>peer(receipt.name,`SELECT to_jsonb(r)::text FROM organization_master.workspace_draft_revision r WHERE id=${quote(saved.id)}::uuid AND number=${quote(saved.version)}::bigint`);
async function blocked(input:Manual){
 const saved=await workspace.saveDraft(steward,{...input,requestId:randomUUID()}),before=counts();
 const response=await post(steward,'drafts/submit',{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()});
 expect(response.statusCode,response.body).toBe(403);expect(response.json().code).toBe('ACCESS_DENIED');expect(counts()).toBe(before);
 await expect(pool.query('select governance_catalog.import_job_command($1,$2::jsonb)',[steward,JSON.stringify(job(saved,input.transport!))])).rejects.toThrow('ACCESS_DENIED');
 expect(counts()).toBe(before);expect((await workspace.readDraft(steward,saved.id)).state).toBe('EDITING');expect(grants()).toBe('[0, 0]');
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);org=openOrganization(connection,provider);pool=new Pool({connectionString:connection});
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 const f=await workspaceManualFixture(catalog);sourceA=f.source;transportA={contractId:f.contract.id,contractVersionId:f.contract.versionId};
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 async function evidence(t:Transport){const j=await catalog.importJobCommand('maker',{...f.create,...t,requestId:randomUUID()});return (await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_EXACT_EVIDENCE'))).artifactId;}
 evidenceA=await evidence(transportA);
 subject=await commit('maker',content('A',organizationCommand(evidenceA,'CREATE')));
 licenseA=await commit('maker',content('A',licenseCommand(evidenceA,'ADD_LICENSE')));
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>)=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'DEMO_EXACT_SOURCE_B',...extra});
 const sd=await catalog.command('maker',cmd('CREATE',{kind:'SOURCE',code:'EXACT_B_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'DEMO independent source B',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST',technicalRole:'TEST',sourceEvidence:sourceA.id},validFrom:from}));
 const sr=await catalog.command('maker',cmd('SUBMIT',{target:sd.id,expectedHead:sd.head}));sourceB=await catalog.command('reviewer',cmd('PUBLISH',{target:sd.id,expectedHead:sr.head,reviewDigest:sr.reviewDigest}));
 const cd=await catalog.contractCommand('maker',cmd('REVISE',{target:f.contract.id,expectedHead:f.contract.head,datasetVersionId:f.dataset.versionId,definition:{...f.contract.definition,sourceVersionId:sourceB.versionId,ruleVersion:'EXACT_B_'+randomUUID().replaceAll('-','').toUpperCase()},validFrom:from,validTo:null}));
 const ca=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:cd.id,expectedHead:cd.head,reviewDigest:cd.reviewDigest})),impact=await catalog.contractImpact('reviewer','SYNTHETIC',cd.id,'PUBLISH');
 const cp=await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:cd.id,expectedHead:ca.head,reviewDigest:ca.reviewDigest,impactDigest:impact.impactDigest}));transportB={contractId:cp.id,contractVersionId:cp.versionId};evidenceB=await evidence(transportB);
 licenseB=await commit('maker',content('B',licenseCommand(evidenceB,'ADD_LICENSE')));
 const other=await commit('maker',content('B',organizationCommand(evidenceB,'CREATE')));
 foreign=await commit('maker',content('B',{...licenseCommand(evidenceB,'ADD_LICENSE'),target:{id:other.id,version:other.version}}));
 peer(receipt.name,`INSERT INTO vnext_control.actor VALUES('${steward}','DEMO_EXACT_LICENSE_STEWARD',true);
 INSERT INTO vnext_control.actor_grant SELECT '${steward}','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE']) p;
 INSERT INTO organization_master.access SELECT '${steward}',${quote(subject.id)}::uuid,'NORTH',p FROM unnest(ARRAY['READ','WRITE','READ_RESTRICTED']) p;
 INSERT INTO vnext_control.object_grant SELECT '${steward}',object_id,scope,object_kind,campus,purpose,field_group,permission FROM vnext_control.object_grant WHERE actor_code='maker' AND permission='READ' ON CONFLICT DO NOTHING;
 INSERT INTO vnext_control.protected_grant SELECT '${steward}',dataset_id,campus,purpose,permission FROM vnext_control.protected_grant WHERE actor_code='maker' AND permission='READ' ON CONFLICT DO NOTHING;`);
 legacyInput={...content('B',licenseCommand(evidenceB,'REVISE_LICENSE',licenseB)),requestId:randomUUID()};legacy=await storeLegacy(legacyInput);legacyRow=readRow(legacy);
 for(const c of [content('B',organizationCommand(evidenceB)),content('B',licenseCommand(evidenceB))]){const saved=await storeLegacy({...c,requestId:randomUUID()});oldProbes.push({saved,content:c,job:job(saved,c.transport!)});}
 if(process.env['HDIP_REVIEW_CI_LICENSE_UPGRADE']==='1'){
  for(const probe of oldProbes){const tx=await pool.connect();try{await tx.query('BEGIN');await tx.query('select governance_catalog.import_job_command($1,$2::jsonb)',[steward,JSON.stringify(probe.job)]);}finally{await tx.query('ROLLBACK');tx.release();}}
  console.log(JSON.stringify({check:'0072_ORG01_CROSS_LICENSE_AUTHORITY_REPRODUCED',probes:oldProbes.length}));
  const {upgradeLicenseTransport}=await import('./review-ci-database.mjs');await upgradeLicenseTransport(receipt);
 }
});
afterAll(async()=>{await app?.close();await pool?.end();await workspace?.close();await org?.close();await catalog?.close();});

test('stored wrong-source drafts cannot reuse organization or sibling-license authority after upgrade',async()=>{
 for(const p of oldProbes){const before=counts(),row=readRow(p.saved);const r=await post(steward,'drafts/submit',{id:p.saved.id,expectedVersion:p.saved.version,requestId:randomUUID()});expect(r.statusCode,r.body).toBe(403);
  await expect(pool.query('select governance_catalog.import_job_command($1,$2::jsonb)',[steward,JSON.stringify(p.job)])).rejects.toThrow('ACCESS_DENIED');expect(counts()).toBe(before);expect(readRow(p.saved)).toBe(row);
 }
});
test('an organization revision cannot borrow a held license source',()=>blocked(content('B',organizationCommand(evidenceB))));
test('a license revision cannot borrow a sibling license source',()=>blocked(content('B',licenseCommand(evidenceB))));
for(const which of ['A','B'] as const)test('a new license requires ordinary catalog WRITE even for existing source '+which,()=>blocked(content(which,licenseCommand(which==='A'?evidenceA:evidenceB,'ADD_LICENSE'))));
test('a license owned by another subject does not establish the exception',()=>blocked(content('B',licenseCommand(evidenceB,'REVISE_LICENSE',foreign))));
test('an absent license version fails closed at transport before staging',()=>blocked(content('B',licenseCommand(evidenceB,'REVISE_LICENSE',{...licenseB,version:'999'}))));
test('revocation cannot borrow another license source',()=>blocked(content('B',{action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:licenseA.id,version:licenseA.version},reason:'DEMO_REVOKE'})));
test('authenticated metadata rejects a different license target in the plaintext projection',async()=>{
 const input={...content('B',licenseCommand(evidenceB,'REVISE_LICENSE',licenseB)),requestId:randomUUID()},metadata={...draftMetadata(input),licenseTarget:{id:licenseA.id,version:licenseA.version}};
 const saved=await storeLegacy(input,metadata),before=counts();await expect(workspace.readDraft(steward,saved.id)).rejects.toThrow('PAYLOAD_UNAVAILABLE');await expect(workspace.submitDraft(steward,{id:saved.id,expectedVersion:saved.version,requestId:randomUUID()})).rejects.toThrow('PAYLOAD_UNAVAILABLE');expect(counts()).toBe(before);
});
test('legacy encrypted license draft restores unchanged and explicitly resaves before object-scoped submission',async()=>{
 const restored=await workspace.readDraft(steward,legacy.id);expect(restored.content).toEqual(legacyInput);expect(readRow(legacy)).toBe(legacyRow);
 const before=counts();await expect(workspace.submitDraft(steward,{id:legacy.id,expectedVersion:legacy.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');expect(counts()).toBe(before);
 const resaved=await workspace.saveDraft(steward,{...restored.content,id:legacy.id,expectedVersion:legacy.version,requestId:randomUUID()});expect(resaved.version).toBe('2');expect(readRow(legacy)).toBe(legacyRow);
 const request={id:resaved.id,expectedVersion:resaved.version,requestId:randomUUID()},r=await post(steward,'drafts/submit',request);expect(r.statusCode,r.body).toBe(200);expect(await workspace.submitDraft(steward,request)).toEqual(r.json());licenseB=await apply(steward,r.json().inputId);expect(grants()).toBe('[0, 0]');
});
test('same-source organization and exact license revisions commit without catalog WRITE',async()=>{
 subject=await commit(steward,content('A',organizationCommand(evidenceA)));
 licenseA=await commit(steward,content('A',licenseCommand(evidenceA)));
 await commit(steward,content('B',{action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:licenseB.id,version:licenseB.version},reason:'DEMO_EXACT_REVOKE'}));expect(grants()).toBe('[0, 0]');
});
test('ordinary authorized maker can still create a new license',async()=>{
 await commit('maker',content('A',licenseCommand(evidenceA,'ADD_LICENSE')));
 await expect(catalog.importJobCommand(steward,{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'DEMO_NO_EXCEPTION',...transportB,profile:'CORE',input:{kind:'METADATA_ONLY',declaredSha256:'b'.repeat(64)}})).rejects.toThrow('ACCESS_DENIED');
});
