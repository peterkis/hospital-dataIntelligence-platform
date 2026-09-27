import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {peer,quote} from './lineage.mjs';
import {workspaceManualFixture} from './workspace-manual-fixture.js';
import {openCatalog,LocalSyntheticKeyProvider,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganization,openOrganizationWorkspace,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {licenseVersionActions,licenseRevocationDraft} from '../../apps/admin-web/src/vnext/workspace-license-actions.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,organization:ReturnType<typeof openOrganization>,app:Awaited<ReturnType<typeof buildCatalogServer>>;
let fixture:Awaited<ReturnType<typeof workspaceManualFixture>>,evidence:string;
const from='2026-01-01T00:00:00';
const post=(url:string,payload:Record<string,unknown>)=>app.inject({method:'POST',url,headers:{'x-catalog-actor':'maker'},payload});
const source=()=>({systemId:fixture.source.id,versionId:fixture.source.versionId,alias:'DEMO_LICENSE_ACTIONS',versionNo:1,recordLocator:'DEMO_LICENSE_ROW',recordedAt:from,recordStatus:'PUBLISHED',approvalRef:'DEMO_APPROVAL'});
const content=(command:Record<string,unknown>):DraftContent=>({domain:'ORG01',campus:'NORTH',transport:{contractId:fixture.contract.id,contractVersionId:fixture.contract.versionId},command:{source:source(),validFrom:from,validTo:null,...command}});
async function submit(draft:DraftContent){
 const saved=await post('/api/vnext/organization-workspace/drafts/save',{...draft,requestId:randomUUID()});expect(saved.statusCode,saved.body).toBe(200);
 const {id,version}=saved.json<{id:string;version:string}>(),requestId=randomUUID();
 const submitted=await post('/api/vnext/organization-workspace/drafts/submit',{id,expectedVersion:version,requestId});expect(submitted.statusCode,submitted.body).toBe(200);
 const replay=await post('/api/vnext/organization-workspace/drafts/submit',{id,expectedVersion:version,requestId});expect(replay.json()).toEqual(submitted.json());
 return submitted.json<{inputId:string}>();
}
async function commit(draft:DraftContent):Promise<OwnerFact>{
 const submitted=await submit(draft);
 expect(await workspace.preflight('maker',{domain:'ORG01',inputId:submitted.inputId})).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE',codes:[]});
 const requestId=randomUUID(),candidate=await organization.plan('maker',{inputId:submitted.inputId,requestId});
 await organization.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await organization.approveApplyUnit('reviewer',candidate);
 const result=await organization.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');
 expect(await organization.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toEqual(result);
 const fact=result.facts?.[0];if(!fact)throw new Error('COMMITTED_LICENSE_FACT_REQUIRED');return fact;
}
async function createLicensedSubject(){
 const subject=await commit(content({action:'CREATE',facts:{legalName:'DEMO license action subject',entityNature:'DEMO',authority:null,legalAddress:null,registrationEvidence:evidence},identifiers:[{kind:'INSTITUTION_CODE',namespace:'DEMO_LICENSE_ACTIONS',value:randomUUID()}]}));
 const license=await commit(content({action:'ADD_LICENSE',target:{id:subject.id,version:subject.version},license:{namespace:'DEMO_LICENSE',number:randomUUID(),authority:'DEMO authority',evidence,validFrom:from,validTo:null,endKind:'VERIFIED_UNBOUNDED'}}));
 return {subject,license};
}
async function revisedDraft(id:string,version:string){
 const draft=await workspace.prepareRevision('maker',{kind:'LICENSE',id,version});
 if(draft.domain!=='ORG01')throw new Error('ORG01_REQUIRED');
 return {...draft,command:{...draft.command,validFrom:from}};
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);organization=openOrganization(connection,provider);
 fixture=await workspaceManualFixture(catalog);
 const job=await catalog.importJobCommand('maker',{...fixture.create,requestId:randomUUID()});
 peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(fixture.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;`);
 evidence=(await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('DEMO_LICENSE_ACTION_EVIDENCE'))).artifactId;
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
});
afterAll(async()=>{await app?.close();await workspace?.close();await organization?.close();await catalog?.close();});

test('license add, historical revision and current-head revocation complete independent approval without rewriting history',async()=>{
 const {subject,license}=await createLicensedSubject();
 const first=(await organization.historyDetails('maker',subject.id)).licenses[0]!;
 expect(licenseVersionActions(first,[first],true)).toEqual({canRevise:true,canRevoke:true});
 await commit(await revisedDraft(license.id,license.version));
 const historicalDraft=await revisedDraft(license.id,license.version);
 expect(historicalDraft.command).toMatchObject({action:'REVISE_LICENSE',licenseTarget:{id:license.id,version:'2'}});
 await commit(historicalDraft);
 const before=(await organization.historyDetails('maker',subject.id)).licenses;
 expect(before.map(row=>row.version)).toEqual(['1','2','3']);
 expect(before[0]).toEqual(first);
 const head=before.at(-1)!;
 for(const row of before)expect(licenseVersionActions(row,before,true)).toEqual({canRevise:true,canRevoke:row.version==='3'});
 const current=await workspace.objectContext('maker',{kind:'LICENSE',id:license.id});
 expect(licenseRevocationDraft(first,subject.id,current)).toBeNull();
 const draft=licenseRevocationDraft(head,subject.id,current);if(!draft||draft.domain!=='ORG01')throw new Error('CURRENT_REVOCATION_REQUIRED');
 await commit(content(draft.command));
 const after=(await organization.historyDetails('maker',subject.id)).licenses;
 expect(after.slice(0,before.length)).toEqual(before);expect(after.at(-1)).toMatchObject({id:license.id,version:'4',revoked:true});
 expect(after.map(row=>licenseVersionActions(row,after,true).canRevoke)).toEqual([false,false,false,false]);
 expect(licenseVersionActions(after.at(-1)!,after,true).canRevise).toBe(false);
 await expect(workspace.prepareRevision('maker',{kind:'LICENSE',id:license.id,version:'4'})).rejects.toThrow('NOT_FOUND');
 const historical=(await organization.historyDetails('maker',subject.id,first.recordedAt)).licenses;
 expect(historical).toEqual([first]);expect(licenseVersionActions(first,historical,false)).toEqual({canRevise:false,canRevoke:false});
});
test('a stale revocation bypassing the UI is still rejected by Owner validation with no new license fact',async()=>{
 const {subject,license}=await createLicensedSubject();await commit(await revisedDraft(license.id,license.version));
 const before=(await organization.historyDetails('maker',subject.id)).licenses;
 const submitted=await submit(content({action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version}}));
 expect(await workspace.preflight('maker',{domain:'ORG01',inputId:submitted.inputId})).toMatchObject({status:'BLOCKED',codes:['STALE_VALIDATION']});
 await expect(organization.plan('maker',{inputId:submitted.inputId,requestId:randomUUID()})).rejects.toThrow('STALE_VALIDATION');
 expect((await organization.historyDetails('maker',subject.id)).licenses).toEqual(before);
});
test('readable license history does not grant maintenance authority',async()=>{
 const {subject,license}=await createLicensedSubject(),reader='license-reader-'+randomUUID();
 peer(receipt.name,`INSERT INTO vnext_control.actor VALUES(${quote(reader)},${quote(reader)},true);INSERT INTO vnext_control.actor_grant VALUES(${quote(reader)},'SYNTHETIC','READ');INSERT INTO organization_master.access VALUES(${quote(reader)},${quote(subject.id)}::uuid,'NORTH','READ');`);
 const history=(await organization.historyDetails(reader,subject.id)).licenses,current=await workspace.objectContext(reader,{kind:'LICENSE',id:license.id});
 expect(current).toMatchObject({canWrite:false,canClose:false});
 expect(licenseVersionActions(history[0]!,history,current.canWrite)).toEqual({canRevise:false,canRevoke:false});
 expect(licenseRevocationDraft(history[0]!,subject.id,current)).toBeNull();
 await expect(workspace.prepareRevision(reader,{kind:'LICENSE',id:license.id,version:license.version})).rejects.toThrow('ACCESS_DENIED');
});
