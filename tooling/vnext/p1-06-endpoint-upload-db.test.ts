import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {organizationBundleFixture} from './organization-bundle-fixture.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {unzip} from '../../apps/governance-api/src/modules/governance-catalog/file-parser.js';
import {zipText} from '../../apps/governance-api/src/modules/governance-catalog/issue-workbook.js';
import {openOrganizationWorkspace,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {WorkspaceDraftEndpointFields} from '../../apps/admin-web/src/vnext/workspace-endpoint-editor.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,fixture:Awaited<ReturnType<typeof organizationBundleFixture>>,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
type Manual=Extract<DraftContent,{domain:'ORG03'}>;
type Command=Record<string,unknown>;
const wire=<T>(value:T):T=>JSON.parse(JSON.stringify(value)) as T;
async function post(path:string,payload:unknown,who='maker'){
 const response=await fetch(base+'/api/vnext/organization-workspace/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(payload)});
 return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};
}
// Match the editor's closed capability projection, not the persisted save request envelope.
const capabilities=(content:Manual)=>post('capabilities',{domain:content.domain,campus:content.campus,command:Object.fromEntries(Object.entries(content.command).filter(([key])=>['action','target','subject','campus'].includes(key)))});
async function save(content:DraftContent,prior?:{id:string;version:string}){
 const payload={...content,requestId:randomUUID(),...(prior?{id:prior.id,expectedVersion:prior.version}:{})},response=await post('drafts/save',payload);
 expect(response.status,JSON.stringify(response.body)).toBe(200);return response.body as {id:string;version:string;state:string};
}
function choose(command:Command,subjectId:string,campusId:string):Command{
 let patch:Command|undefined;
 const field=WorkspaceDraftEndpointFields({actor:'maker',command,disabled:false,onChange:value=>{patch=value;}});
 expect(field.props.disabled).toBe(false);field.props.onChange(subjectId,campusId);expect(patch).toBeDefined();return wire({...command,...patch});
}
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);fixture=await organizationBundleFixture(receipt,connection,provider,catalog);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
});
afterAll(async()=>{await app?.close();await workspace?.close();await fixture?.close();await catalog?.close();});

for(const action of ['ESTABLISH','VERIFY_SCOPE'] as const)test(`${action}: save incomplete, reopen, correct endpoints, reauthorize and independently commit`,async()=>{
 const x=fixture.x,subjectA=await x.createSubject(),subjectB=await x.createSubject(),campusA=await x.createCampus(),campusB=await x.createCampus();
 x.grantPair(subjectA.id,campusA.id);x.grantPair(subjectB.id,campusB.id);
 const licenseA=await x.addLicense(subjectA),licenseB=await x.addLicense(subjectB);
 const scopeA=action==='ESTABLISH'?await x.verifyScope(subjectA,campusA,licenseA):null,scopeB=action==='ESTABLISH'?await x.verifyScope(subjectB,campusB,licenseB):null;
 const facts=action==='ESTABLISH'?{role:'OPERATOR',relationTypeText:'DEMO operator',primary:'N',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[],licenseScopeText:'DEMO verified service'}:{catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO verified service'};
 const content:Manual={domain:'ORG03',campus:'NORTH',transport:{contractId:x.codeSet.published.id,contractVersionId:x.codeSet.published.versionId},command:{...x.common,action,evidence:x.artifact.artifactId,facts}};
 const saved=await save(content),reopened=openOrganizationWorkspace(connection,provider);
 let restored:Manual;
 try{const r=await reopened.readDraft('maker',saved.id);expect(r.state).toBe('EDITING');if(r.content.domain!=='ORG03')throw new Error('ORG03_REQUIRED');restored=r.content;}finally{await reopened.close();}
 let command=choose(restored.command,subjectA.id,'');const one=await save({...restored,command},saved);
 command=choose(command,subjectA.id,campusA.id);
 command['facts']={...(command['facts'] as Command),...(action==='ESTABLISH'?{scopeTargets:[scopeA]}:{license:licenseA})};
 const two=await save({...restored,command},one),read=await workspace.readDraft('maker',two.id);expect(read.state).toBe('EDITING');
 if(read.content.domain!=='ORG03')throw new Error('ORG03_REQUIRED');
 const changed=choose(read.content.command,subjectB.id,campusB.id);
 if(action==='ESTABLISH')expect(changed).toHaveProperty('facts.scopeTargets',[]);else expect(changed['facts']).not.toHaveProperty('license');
 changed['facts']={...(changed['facts'] as Command),...(action==='ESTABLISH'?{scopeTargets:[scopeB]}:{license:licenseB})};
 const corrected={...restored,command:changed};expect((await capabilities(corrected)).body).toMatchObject({canRead:true,canWrite:true});
 const three=await save(corrected,two);
 const unauthorized={...corrected,command:choose(changed,subjectB.id,campusA.id)};
 expect((await capabilities(unauthorized)).body).toMatchObject({canWrite:false});
 const denied=await post('drafts/save',{...unauthorized,id:three.id,expectedVersion:three.version,requestId:randomUUID()});expect(denied.status).toBe(403);
 expect((await workspace.readDraft('maker',three.id)).version).toBe(three.version);
 const submission={id:three.id,expectedVersion:three.version,requestId:randomUUID()},submitted=await post('drafts/submit',submission);expect(submitted.status,JSON.stringify(submitted.body)).toBe(200);
 expect((await post('drafts/submit',submission)).body).toEqual(submitted.body);
 expect((await post('applications/preflight',{domain:'ORG03',inputId:submitted.body.inputId})).body).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE',codes:[]});
 const requestId=randomUUID(),candidate=await x.operating.plan('maker',{inputId:submitted.body.inputId,requestId});
 await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await x.operating.approveApplyUnit('reviewer',candidate);
 const applied=await x.operating.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(applied.status).toBe('COMMITTED');
 if(applied.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
 expect(await x.operating.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toEqual(applied);
 const fact=applied.facts![0]!,kind=action==='ESTABLISH'?'RELATION':'SCOPE';
 const rows=await x.operating.read('maker',{kind,mode:'EXACT',id:fact.id,version:fact.version});expect(rows[0]).toMatchObject(x.endpoints(subjectB,campusB));
 const revision=await workspace.prepareRevision('maker',{kind,id:fact.id,version:fact.version});if(revision.domain!=='ORG03')throw new Error('ORG03_REQUIRED');
 expect(WorkspaceDraftEndpointFields({actor:'maker',command:revision.command,disabled:false,onChange:()=>{throw new Error('REVISION_MUST_STAY_LOCKED');}}).props.disabled).toBe(true);
 expect((await workspace.readDraft('maker',three.id)).state).toBe('SUBMITTED');
});

test('exact one-MiB XLSX traverses real HTTP preview, capabilities, private save and restore unchanged',async()=>{
 const original=fixture.workbook(),files=Object.fromEntries(unzip(original,true));
 // Stored ZIP members make byte size deterministic. XML trailing whitespace adds no cells or facts.
 files['xl/workbook.xml']+=' '.repeat(1048576-original.length);const bytes=zipText(files);expect(bytes.length).toBe(1048576);
 const content:DraftContent={domain:'BUNDLE',campus:'NORTH',metadata:fixture.input,bytesBase64:bytes.toString('base64')};
 expect(Buffer.byteLength(JSON.stringify(content))).toBeGreaterThan(1398104);
 const preview=await post('workbook/preview',content);expect(preview.status,JSON.stringify(preview.body)).toBe(200);expect(preview.cache).toBe('no-store');
 expect(preview.body).toMatchObject({structuralStatus:'PARSED',qualification:'NOT_EVALUATED',readOnly:true});
 const small=await post('workbook/preview',{...content,bytesBase64:original.toString('base64')});expect(preview.body.cells).toEqual(small.body.cells);
 expect((await post('capabilities',content)).body).toMatchObject({canRead:true,canWrite:true});
 const saved=await save(content),read=await post('drafts/read',{id:saved.id});expect(read.status).toBe(200);expect(read.body.state).toBe('EDITING');expect(read.body.content.bytesBase64).toBe(content.bytesBase64);
 expect((await post('drafts/read',{id:saved.id},'reviewer')).status).toBe(403);
 const before=await workspace.listDrafts('maker'),tooLarge=JSON.stringify({...content,requestId:randomUUID()})+' '.repeat(2000000);
 const response=await fetch(base+'/api/vnext/organization-workspace/drafts/save',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:tooLarge});
 expect(response.status).toBe(413);expect(await response.json()).toMatchObject({code:'FST_ERR_CTP_BODY_TOO_LARGE'});expect(await workspace.listDrafts('maker')).toEqual(before);
});
