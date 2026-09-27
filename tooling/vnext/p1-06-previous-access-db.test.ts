import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {peer,quote,inspect,migrationFiles} from './lineage.mjs';
import {workspaceStartupPrefix} from './workspace-migrations.mjs';
import {operatingScenario} from './operating-scenario.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';

type Scenario=Awaited<ReturnType<typeof operatingScenario>>;
type Fact=Awaited<ReturnType<Scenario['createSubject']>>;
type Manual=Exclude<DraftContent,{domain:'BUNDLE'}>;
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const upgrade=process.env['HDIP_REVIEW_CI_PREVIOUS_UPGRADE']==='1';
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,x:Scenario,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
let a:Fact,b:Fact,na:Fact,nb:Fact;
const nil='00000000-0000-0000-0000-000000000000';
const kinds=['ORG01','ORG02','ESTABLISH','VERIFY_SCOPE','SUBJECT_ONLY','CAMPUS_ONLY'] as const;
type Kind=typeof kinds[number];type Permission='READ'|'READ_RESTRICTED';
const scenarios=kinds.flatMap(kind=>(kind.endsWith('_ONLY')?['READ_RESTRICTED'] as const:['READ','READ_RESTRICTED'] as const).map(permission=>({kind,permission})));
const cases:Array<{kind:Kind;permission:Permission;old:Manual;next:Manual;saved:{id:string;version:string};original:unknown}>=[];
const attachment={filename:'retained.txt',bytesBase64:Buffer.from('DEMO retained confidential material').toString('base64')};
function contents(kind:Kind,next=false):Manual{
 const s=next?b:a,c=next?nb:na;
 if(kind==='ORG01')return {domain:'ORG01',campus:'NORTH',attachment,command:{action:'REVISE',target:{id:s.id,version:s.version}}};
 if(kind==='ORG02')return {domain:'ORG02',campus:'NORTH',attachment,command:{action:'REVISE',target:{owner:'organization-master/campus',id:c.id,expectedVersion:c.version}}};
 const endpoints=x.endpoints(s,c),action=kind==='VERIFY_SCOPE'?'VERIFY_SCOPE':'ESTABLISH';
 return {domain:'ORG03',campus:'NORTH',attachment,command:{action,...(kind==='SUBJECT_ONLY'&&!next?{subject:endpoints.subject}:kind==='CAMPUS_ONLY'&&!next?{campus:endpoints.campus}:endpoints)}};
}
function revoke(kind:Kind,permission:Permission){
 const pair=kind==='ESTABLISH'||kind==='VERIFY_SCOPE';
 const table=pair?'organization_master.operating_access':'organization_master.access';
 const where=pair?`subject_id=${quote(a.id)}::uuid AND campus_id=${quote(na.id)}::uuid`:`subject_id=${quote(kind==='ORG01'?a.id:kind==='ORG02'?na.id:nil)}::uuid AND campus='NORTH'`;
 const removed=peer(receipt.name,`WITH r AS(DELETE FROM ${table} WHERE actor='maker' AND ${where} AND permission=${quote(permission)} RETURNING *) SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]')::text FROM r`);
 expect(JSON.parse(removed)).toHaveLength(1);
 return ()=>peer(receipt.name,`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${quote(removed)}::jsonb) ON CONFLICT DO NOTHING`);
}
async function post(path:string,payload:unknown){
 const r=await fetch(base+'/api/vnext/organization-workspace/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(payload)});
 return {status:r.status,body:await r.json() as Record<string,any>};
}
const snapshot=()=>peer(receipt.name,`SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY id,number) FROM organization_master.workspace_draft_revision r),
 (SELECT count(*) FROM organization_master.input),(SELECT count(*) FROM governance_catalog.import_job),
 (SELECT count(*) FROM governance_catalog.protected_artifact),(SELECT count(*) FROM vnext_control.outcome),
 (SELECT count(*) FROM vnext_control.request_identity))::text`);
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);x=await operatingScenario(receipt,connection,provider,catalog);
 a=await x.createSubject();b=await x.createSubject();na=await x.createCampus();nb=await x.createCampus();x.grantPair(a.id,na.id);x.grantPair(b.id,nb.id);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
 for(const {kind,permission} of scenarios){
  const old=contents(kind),next=contents(kind,true),saved=await workspace.saveDraft('maker',{...old,requestId:randomUUID()}),original=await workspace.readDraft('maker',saved.id);
  if(upgrade){
   const probe=await workspace.saveDraft('maker',{...old,requestId:randomUUID()}),restore=revoke(kind,permission);
   try{
    // The same actor loses old READ/READ_RESTRICTED, but can still WRITE it and
    // access the replacement. Baseline succeeds only via the flawed save path.
    expect((await post('drafts/read',{id:probe.id})).status).toBe(403);
    expect(await workspace.capabilities('maker',next)).toMatchObject({canRead:true,canWrite:true});
    const resaved=await post('drafts/save',{...next,id:probe.id,expectedVersion:probe.version,requestId:randomUUID()});expect(resaved.status,JSON.stringify(resaved.body)).toBe(200);
    const leaked=await workspace.readDraft('maker',probe.id);expect('attachment' in leaked.content&&leaked.content.attachment).toEqual(attachment);
   }finally{restore();}
  }
  cases.push({kind,permission,old,next,saved,original});
 }
 if(upgrade){
  expect((await inspect(receipt)).ledger).toHaveLength(74);
  expect(()=>workspaceStartupPrefix(migrationFiles(),(migrationFiles().slice(0,74)))).toThrow('WORKSPACE_MIGRATION_REQUIRED');
  console.log(JSON.stringify({check:'0074_RESTRICTED_RETARGET_REPRODUCED',httpResaves:cases.length}));
  const {upgradePreviousDraftAccess}=await import('./review-ci-database.mjs');await upgradePreviousDraftAccess(receipt);
 }
 expect(workspaceStartupPrefix(migrationFiles(),(await inspect(receipt)).ledger)).toBe(migrationFiles().length);
});
afterAll(async()=>{await app?.close();await workspace?.close();await x?.close();await catalog?.close();});
for(const {kind,permission} of scenarios)test(`${kind}: retained content cannot escape revoked previous ${permission} through a permitted replacement`,async()=>{
 const c=cases.find(c=>c.kind===kind&&c.permission===permission)!,restore=revoke(kind,permission),before=snapshot();
 const request={...c.next,id:c.saved.id,expectedVersion:c.saved.version,requestId:randomUUID()};
 try{
  expect((await post('drafts/read',{id:c.saved.id})).status).toBe(403);
  expect(await workspace.capabilities('maker',c.next)).toMatchObject({canRead:true,canWrite:true});
  const result=await post('drafts/save',request);expect(result.status,JSON.stringify(result.body)).toBe(403);expect(result.body['code']).toBe('ACCESS_DENIED');
  expect(snapshot()).toBe(before);
 }finally{restore();}
 expect(await workspace.readDraft('maker',c.saved.id)).toEqual(c.original);
 const saved=await post('drafts/save',request);expect(saved.status,JSON.stringify(saved.body)).toBe(200);expect(saved.body['version']).toBe('2');
 expect((await post('drafts/save',request)).body).toEqual(saved.body);
 const reopened=openOrganizationWorkspace(connection,provider);
 try{const read=await reopened.readDraft('maker',c.saved.id);expect('attachment' in read.content&&read.content.attachment).toEqual(attachment);expect('command' in read.content&&read.content.command).toEqual(c.next.command);}finally{await reopened.close();}
});
for(const action of ['ESTABLISH','VERIFY_SCOPE'] as const)test(`${action}: authorized retargeting still completes independent approval and idempotent Apply`,async()=>{
 const s=await x.createSubject(),n=await x.createCampus();x.grantPair(s.id,n.id);
 const license=await x.addLicense(s),facts=action==='VERIFY_SCOPE'?{license,catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO checked'}:{role:'OPERATOR',relationTypeText:'DEMO',primary:'N',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[await x.verifyScope(s,n,license)],licenseScopeText:'DEMO checked'};
 const content:Extract<DraftContent,{domain:'ORG03'}>={domain:'ORG03',campus:'NORTH',transport:{contractId:x.codeSet.published.id,contractVersionId:x.codeSet.published.versionId},command:{...x.common,action,...x.endpoints(s,n),evidence:x.artifact.artifactId,facts}};
 const first=await workspace.saveDraft('maker',{domain:'ORG03',campus:'NORTH',command:{action,...x.endpoints(a,na)},requestId:randomUUID()});
 const saved=await workspace.saveDraft('maker',{...content,id:first.id,expectedVersion:first.version,requestId:randomUUID()});
 const request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()},submission=await workspace.submitDraft('maker',request);expect(await workspace.submitDraft('maker',request)).toEqual(submission);
 const requestId=randomUUID(),candidate=await x.operating.plan('maker',{inputId:submission.inputId,requestId});await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await x.operating.approveApplyUnit('reviewer',candidate);
 const apply={candidateId:candidate.candidateId,requestId},result=await x.operating.applyUnit('maker',apply);expect(result.status).toBe('COMMITTED');expect(await x.operating.applyUnit('maker',apply)).toEqual(result);
});
