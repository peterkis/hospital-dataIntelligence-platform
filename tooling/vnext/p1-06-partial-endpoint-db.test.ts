import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {peer,quote,inspect,migrationFiles} from './lineage.mjs';
import {workspaceStartupPrefix,workspaceDeploymentPrefix} from './workspace-migrations.mjs';
import {operatingScenario} from './operating-scenario.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type DraftContent} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';

type Manual=Extract<DraftContent,{domain:'ORG03'}>;
type Scenario=Awaited<ReturnType<typeof operatingScenario>>;
type Fact=Awaited<ReturnType<Scenario['createSubject']>>;
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,provider=new LocalSyntheticKeyProvider();
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const upgrade=process.env['HDIP_REVIEW_CI_ENDPOINT_UPGRADE']==='1';
let catalog:Awaited<ReturnType<typeof openCatalog>>,workspace:ReturnType<typeof openOrganizationWorkspace>,x:Scenario,app:Awaited<ReturnType<typeof buildCatalogServer>>,base:string;
const pool=new pg.Pool({connectionString:connection});
const cases:Array<{action:'ESTABLISH'|'VERIFY_SCOPE';endpoint:'subject'|'campus';subject:Fact;node:Fact;selected:string;content:Manual;saved:{id:string;version:string};original:Awaited<ReturnType<ReturnType<typeof openOrganizationWorkspace>['readDraft']>>}>=[];
const revoke=(id:string)=>peer(receipt.name,`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(id)}::uuid AND permission='READ'`);
const restore=(id:string,scope='NORTH')=>peer(receipt.name,`INSERT INTO organization_master.access VALUES('maker',${quote(id)}::uuid,${quote(scope)},'READ') ON CONFLICT DO NOTHING`);
async function post(path:string,payload:unknown,who='maker'){
 const r=await fetch(base+'/api/vnext/organization-workspace/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(payload)});
 return {status:r.status,body:await r.json() as Record<string,any>};
}
async function read(id:string,who='maker'){
 return post('drafts/read',{id},who);
}
const snapshot=(id:string)=>peer(receipt.name,`SELECT jsonb_build_object(
 'drafts',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY number),'[]') FROM organization_master.workspace_draft_revision r WHERE id=${quote(id)}::uuid),
 'allDraftCount',(SELECT count(*) FROM organization_master.workspace_draft_revision),
 'inputs',(SELECT count(*) FROM organization_master.input),
 'jobs',(SELECT count(*) FROM governance_catalog.import_job),
 'artifacts',(SELECT count(*) FROM governance_catalog.protected_artifact),
 'outcomes',(SELECT count(*) FROM vnext_control.outcome),
 'requests',(SELECT count(*) FROM vnext_control.request_identity))::text`);

beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);workspace=openOrganizationWorkspace(connection,provider);x=await operatingScenario(receipt,connection,provider,catalog);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('HTTP_ADDRESS_REQUIRED');base='http://127.0.0.1:'+address.port;
 for(const action of ['ESTABLISH','VERIFY_SCOPE'] as const)for(const endpoint of ['subject','campus'] as const){
  const subject=await x.createSubject(),node=await x.createCampus(),selected=endpoint==='subject'?subject.id:node.id;
  const content:Manual={domain:'ORG03',campus:'NORTH',transport:{contractId:x.codeSet.published.id,contractVersionId:x.codeSet.published.versionId},attachment:{filename:'partial.txt',bytesBase64:Buffer.from('DEMO private partial '+action+' '+endpoint).toString('base64')},command:{action,[endpoint]:x.endpoints(subject,node)[endpoint]}};
  let saved=await workspace.saveDraft('maker',{...content,requestId:randomUUID()});
  expect((await read(saved.id)).status).toBe(200);
  if(upgrade){
   revoke(selected);
   // Reproduce the previous release with the same authenticated actor, not a
   // deliberately invalid HTTP identity. Both the HTTP read and SQL read leaked.
   expect((await read(saved.id)).status).toBe(200);
   expect((await pool.query('select organization_master.workspace_read($1,$2::uuid) r',['maker',saved.id])).rows[0].r.envelope).toBeTruthy();
   const resaved=await post('drafts/save',{...content,id:saved.id,expectedVersion:saved.version,requestId:randomUUID()});
   expect(resaved.status).toBe(200);saved={...saved,version:resaved.body['version']};restore(selected);
  }
  const original=await workspace.readDraft('maker',saved.id);revoke(selected);
  cases.push({action,endpoint,subject,node,selected,content,saved,original});
 }
 if(upgrade){
  const before=await inspect(receipt);expect(before.ledger).toHaveLength(73);
  expect(()=>workspaceStartupPrefix(migrationFiles(),before.ledger)).toThrow('WORKSPACE_MIGRATION_REQUIRED');
  expect(()=>workspaceDeploymentPrefix(migrationFiles(),before.ledger,true)).toThrow('WORKSPACE_ALREADY_DEPLOYED_REQUIRED');
  console.log(JSON.stringify({check:'0073_PARTIAL_ENDPOINT_DEFECT_REPRODUCED',httpReads:4,sqlReads:4,httpResaves:4}));
  const {upgradePartialEndpoint}=await import('./review-ci-database.mjs');await upgradePartialEndpoint(receipt);
 }
 const current=await inspect(receipt);expect(workspaceStartupPrefix(migrationFiles(),current.ledger)).toBe(migrationFiles().length);expect(workspaceDeploymentPrefix(migrationFiles(),current.ledger,true)).toBe(current.ledger.length);
});
afterAll(async()=>{await app?.close();await workspace?.close();await x?.close();await catalog?.close();await pool.end();});

for(const action of ['ESTABLISH','VERIFY_SCOPE'] as const)for(const endpoint of ['subject','campus'] as const)test(`${action} ${endpoint}-only: current endpoint READ gates restore, list, capabilities, save, clear and submit`,async()=>{
 const c=cases.find(c=>c.action===action&&c.endpoint===endpoint)!;
 expect(peer(receipt.name,"SELECT count(*) FROM organization_master.access WHERE actor='maker' AND subject_id='00000000-0000-0000-0000-000000000000'::uuid AND campus='NORTH' AND permission IN ('READ','WRITE','READ_RESTRICTED')")).toBe('3');
 const before=snapshot(c.saved.id);
 const denied=await read(c.saved.id);expect(denied.status).toBe(403);expect(denied.body['code']).toBe('ACCESS_DENIED');expect(JSON.stringify(denied.body)).not.toContain(c.content.attachment!.bytesBase64);
 await expect(workspace.readDraft('maker',c.saved.id)).rejects.toThrow('ACCESS_DENIED');
 await expect(pool.query('select organization_master.workspace_read($1,$2::uuid) r',['maker',c.saved.id])).rejects.toThrow('ACCESS_DENIED');
 expect((await workspace.listDrafts('maker')).some(r=>r.id===c.saved.id)).toBe(false);
 expect(await workspace.capabilities('maker',c.content)).toMatchObject({canRead:false,canWrite:false,canReview:false});
 for(const content of [c.content,{...c.content,command:{action}}]){
  const result=await post('drafts/save',{...content,id:c.saved.id,expectedVersion:c.saved.version,requestId:randomUUID()});
  expect(result.status).toBe(403);expect(result.body['code']).toBe('ACCESS_DENIED');
 }
 const create=await post('drafts/save',{...c.content,requestId:randomUUID()});expect(create.status).toBe(403);expect(create.body['code']).toBe('ACCESS_DENIED');
 const submit=await post('drafts/submit',{id:c.saved.id,expectedVersion:c.saved.version,requestId:randomUUID()});expect(submit.status).toBe(403);expect(submit.body['code']).toBe('ACCESS_DENIED');
 expect(snapshot(c.saved.id)).toBe(before);
 restore(c.selected);expect(await workspace.readDraft('maker',c.saved.id)).toEqual(c.original);
 expect((await read(c.saved.id,'reviewer')).status).toBe(403);
 console.log(JSON.stringify({check:'PARTIAL_ENDPOINT_REVOCATION',action,endpoint,oldDraftPreserved:true,sideEffects:false}));
});

for(const action of ['ESTABLISH','VERIFY_SCOPE'] as const)test(`${action}: completing a saved partial draft requires the exact pair and finishes independent approval`,async()=>{
 const c=cases.find(c=>c.action===action&&c.endpoint==='subject')!;
 // Endpoint READ and creation grants alone cannot stand in for pair grants.
 const command={action,...x.endpoints(c.subject,c.node)};
 const paired:Manual={...c.content,command};
 expect(await workspace.capabilities('maker',paired)).toMatchObject({canRead:false,canWrite:false});
 await expect(workspace.saveDraft('maker',{...paired,id:c.saved.id,expectedVersion:c.saved.version,requestId:randomUUID()})).rejects.toThrow('ACCESS_DENIED');
 x.grantPair(c.subject.id,c.node.id);const license=await x.addLicense(c.subject);
 const facts=action==='VERIFY_SCOPE'?{license,catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],licenseScopeText:'DEMO verified scope'}:{role:'OPERATOR',relationTypeText:'DEMO operator',primary:'N',catalog:x.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[await x.verifyScope(c.subject,c.node,license)],licenseScopeText:'DEMO verified scope'};
 // Choose the governed existing artifact explicitly instead of mixing two evidence selections.
 const complete:Manual={domain:'ORG03',campus:'NORTH',transport:{contractId:x.codeSet.published.id,contractVersionId:x.codeSet.published.versionId},command:{...x.common,...command,evidence:x.artifact.artifactId,facts}};
 const saved=await workspace.saveDraft('maker',{...complete,id:c.saved.id,expectedVersion:c.saved.version,requestId:randomUUID()});
 const request={id:saved.id,expectedVersion:saved.version,requestId:randomUUID()},submission=await workspace.submitDraft('maker',request);
 expect(await workspace.submitDraft('maker',request)).toEqual(submission);
 expect(await workspace.preflight('maker',{domain:'ORG03',inputId:submission.inputId})).toMatchObject({status:'ELIGIBLE_FOR_CANDIDATE'});
 const candidate=await x.operating.plan('maker',{inputId:submission.inputId,requestId:randomUUID()});
 await x.operating.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await x.operating.approveApplyUnit('reviewer',candidate);
 const apply={candidateId:candidate.candidateId,requestId:randomUUID()},result=await x.operating.applyUnit('maker',apply);expect(result.status).toBe('COMMITTED');expect(await x.operating.applyUnit('maker',apply)).toEqual(result);
});
test('empty editing drafts remain allowed, but nonexistent and wrong-kind selected endpoints do not become NIL',async()=>{
 const content:Manual={domain:'ORG03',campus:'NORTH',command:{action:'ESTABLISH'}};
 const saved=await workspace.saveDraft('maker',{...content,requestId:randomUUID()}),restored=await workspace.readDraft('maker',saved.id);
 expect(restored.content.domain).toBe('ORG03');if(restored.content.domain!=='ORG03')throw new Error('ORG03_REQUIRED');
 expect(restored.content.command).toEqual(content.command);
 const c=cases[0]!;
 for(const [key,id] of [['subject',randomUUID()],['campus',randomUUID()],['subject',c.node.id],['campus',c.subject.id]] as const){
  const ref={owner:key==='subject'?'organization-master':'organization-master/campus',id};
  const before=snapshot(saved.id);const result=await post('drafts/save',{...content,command:{action:'ESTABLISH',[key]:ref},requestId:randomUUID()});
  expect(result.status).toBe(404);expect(result.body['code']).toBe('NOT_FOUND');expect(snapshot(saved.id)).toBe(before);
 }
});
test('partial campus checks use its real scope, not a permitted NIL grant in the declared draft scope',async()=>{
 const node=await x.createCampus('DEMO other scope','CITY_CENTER','SOUTH');
 const content:Manual={domain:'ORG03',campus:'NORTH',command:{action:'VERIFY_SCOPE',campus:{owner:'organization-master/campus',id:node.id}}};
 const saved=await workspace.saveDraft('maker',{...content,requestId:randomUUID()});const original=await workspace.readDraft('maker',saved.id);revoke(node.id);
 try{
  await expect(workspace.readDraft('maker',saved.id)).rejects.toThrow('ACCESS_DENIED');
  expect(await workspace.capabilities('maker',content)).toMatchObject({canRead:false,canWrite:false});
 }finally{restore(node.id,'SOUTH');}
 expect(await workspace.readDraft('maker',saved.id)).toEqual(original);
});
