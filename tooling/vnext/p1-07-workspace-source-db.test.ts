import {afterAll,beforeAll,expect,test} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openCatalog,LocalSyntheticKeyProvider,type OwnerFact} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationWorkspace,type CampusCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {operatingScenario} from './operating-scenario.js';
import {peer,quote} from './lineage.mjs';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')) as {name:string};
const provider=new LocalSyntheticKeyProvider();
let catalog:Awaited<ReturnType<typeof openCatalog>>,scenario:Awaited<ReturnType<typeof operatingScenario>>,workspace:ReturnType<typeof openOrganizationWorkspace>,app:Awaited<ReturnType<typeof buildCatalogServer>>;
const base='/api/vnext/organization-workspace/references/';
const post=(path:string,payload:Record<string,unknown>,who='maker')=>app.inject({method:'POST',url:base+path,headers:{'x-catalog-actor':who},payload});
const source=(node:OwnerFact)=>({kind:'CAMPUS' as const,id:node.id,version:node.version});
const target=(node:OwnerFact)=>({owner:'organization-master/campus' as const,id:node.id,expectedVersion:node.version});
const counts=()=>peer(receipt.name,"SELECT jsonb_build_array((SELECT count(*) FROM organization_master.campus_event),(SELECT count(*) FROM organization_master.workspace_draft_revision),(SELECT count(*) FROM organization_master.input),(SELECT count(*) FROM governance_catalog.import_job))::text");
beforeAll(async()=>{
 catalog=await openCatalog(connection,provider);scenario=await operatingScenario(receipt,connection,provider,catalog);workspace=openOrganizationWorkspace(connection,provider);
 app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,{owner:workspace,actor:r=>actor(r.headers)});
});
afterAll(async()=>{await app?.close();await workspace?.close();await scenario?.close();await catalog?.close();});
async function retire(node:OwnerFact,from=scenario.common.validFrom){
 const assessment=await scenario.campus.assessCampusImpact('maker',{id:node.id,validFrom:from,validTo:null});
 return scenario.campusApply({...scenario.common,validFrom:from,action:'RETIRE',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'RETIRED',reason:'DEMO_EXIT',assessmentDigest:assessment.digest,plan:{responsibleOwner:'DEMO_OFFICE',dueAt:'2099-12-01T00:00:00',actions:'DEMO separately close dependencies'}});
}
test('effective retirement rejects historical profile sources in both Owner and HTTP without creating drafts',async()=>{
 const node=await scenario.createCampus();await retire(node);const before=counts();
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:node.id})).toMatchObject({canWrite:true,terminal:true});
 await expect(workspace.prepareRevision('maker',source(node))).rejects.toThrow('CAMPUS_RETIRED');
 const result=await post('revision-source',source(node));expect(result.statusCode).toBe(409);expect(result.json().code).toBe('CAMPUS_RETIRED');expect(counts()).toBe(before);
});
test('dedicated disposition source retains exact evidence, current head and retirement boundary',async()=>{
 const node=await scenario.createCampus(),retired=await retire(node);
 for(const action of ['RECORD_DISPOSITION','COMPLETE_DISPOSITION'] as const){
  const response=await post('campus-lifecycle-source',{...source(node),action});expect(response.statusCode).toBe(200);
  const draft=response.json();expect(draft).toMatchObject({domain:'ORG02',command:{action,target:target(retired),source:scenario.common.source,evidence:scenario.artifact.artifactId,validFrom:'2026-01-01T00:00:00.000000',validTo:null,sourceOperationStatus:'RETIRED'}});
  expect(draft.command).not.toHaveProperty('facts');expect(draft.command).not.toHaveProperty('assessmentDigest');
  const saved=await workspace.saveDraft('maker',{...draft,requestId:randomUUID()});expect(await workspace.readDraft('maker',saved.id)).toMatchObject({content:{command:draft.command}});
 }
 const draft=await workspace.prepareCampusLifecycle('maker',{...source(node),action:'RECORD_DISPOSITION'});if(draft.domain!=='ORG02')throw new Error('WRONG_DOMAIN');
 const report=await scenario.campus.assessCampusImpact('maker',{id:node.id,validFrom:scenario.common.validFrom,validTo:null});
 const recorded=await scenario.campusApply({...draft.command,reason:'DEMO_RECORD',assessmentDigest:report.digest,resolution:{owner:'ASSIGNMENT',status:'UNKNOWN',scope:'SYNTHETIC'}} as CampusCommand);
 expect(recorded.id).toBe(node.id);expect((await scenario.campus.assessCampusImpact('maker',{id:node.id,validFrom:scenario.common.validFrom,validTo:null})).completed).toBe(false);
 const denied=await post('campus-lifecycle-source',{...source(node),action:'RESUME'});expect(denied.statusCode).toBe(409);expect(denied.json().code).toBe('CAMPUS_RETIRED');
});
test('scheduled retirement blocks duplicate RETIRE but keeps bounded pre-exit profile maintenance',async()=>{
 const node=await scenario.createCampus(),from='2099-01-01T00:00:00';await retire(node,from);
 expect(await workspace.objectContext('maker',{kind:'CAMPUS',id:node.id})).toMatchObject({canWrite:true,terminal:false});
 const profile=await workspace.prepareRevision('maker',source(node));if(profile.domain!=='ORG02')throw new Error('WRONG_DOMAIN');
 const response=await post('revision-source',source(node));expect(response.statusCode).toBe(200);expect(response.json().command.action).toBe('REVISE');
 const before=counts();await expect(workspace.prepareCampusLifecycle('maker',{...source(node),action:'RETIRE'})).rejects.toThrow('CAMPUS_RETIRED');
 const duplicate=await post('campus-lifecycle-source',{...source(node),action:'RETIRE'});expect(duplicate.statusCode).toBe(409);expect(duplicate.json().code).toBe('CAMPUS_RETIRED');expect(counts()).toBe(before);
 const maintained=await scenario.campusApply({...profile.command,validFrom:'2026-02-01T00:00:00',validTo:from,sourceOperationStatus:'PLANNING'} as CampusCommand);expect(maintained.id).toBe(node.id);
 const stop=await post('campus-lifecycle-source',{...source(node),action:'SUSPEND'});expect(stop.statusCode).toBe(200);expect(stop.json().command.target.expectedVersion).toBe(maintained.version);
});
test('effective retirement keeps a surviving opening plan cancellable',async()=>{
 const node=await scenario.createCampus();
 const planned=await scenario.campusApply({...scenario.common,action:'SCHEDULE_OPENING',target:target(node),evidence:scenario.artifact.artifactId,sourceOperationStatus:'PLANNING',plannedOpeningAt:'2099-12-01T00:00:00'});
 const retired=await retire(planned);
 const response=await post('campus-lifecycle-source',{...source(node),action:'CANCEL_OPENING'});
 expect(response.statusCode).toBe(200);expect(response.json().command).toMatchObject({action:'CANCEL_OPENING',target:target(retired)});
});
test('completed disposition rejects further disposition sources',async()=>{
 const node=await scenario.createCampus();let current=await retire(node);
 for(const owner of ['BUSINESS_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION','NURSING_UNIT'] as const){const report=await scenario.campus.assessCampusImpact('maker',{id:current.id,validFrom:scenario.common.validFrom,validTo:null});current=await scenario.campusApply({...scenario.common,action:'RECORD_DISPOSITION',target:target(current),sourceOperationStatus:'RETIRED',evidence:scenario.artifact.artifactId,reason:'DEMO_CLEAR',assessmentDigest:report.digest,resolution:{owner,status:'CLEAR',scope:'SYNTHETIC'}});}
 const report=await scenario.campus.assessCampusImpact('maker',{id:current.id,validFrom:scenario.common.validFrom,validTo:null});await scenario.campusApply({...scenario.common,action:'COMPLETE_DISPOSITION',target:target(current),sourceOperationStatus:'RETIRED',evidence:scenario.artifact.artifactId,reason:'DEMO_COMPLETE',assessmentDigest:report.digest});
 const before=counts();for(const action of ['RECORD_DISPOSITION','COMPLETE_DISPOSITION'] as const){const response=await post('campus-lifecycle-source',{...source(node),action});expect(response.statusCode).toBe(409);expect(response.json().code).toBe('DISPOSITION_ALREADY_COMPLETE');}expect(counts()).toBe(before);
});
test('lifecycle source is a closed action-specific route, not a revision bypass',async()=>{
 const node=await scenario.createCampus();const before=counts();
 for(const extra of [{action:'REVISE'},{action:'RETIRE',kind:'ORGANIZATION'},{action:'RETIRE',terminal:false}]){
  expect((await post('campus-lifecycle-source',{...source(node),...extra})).statusCode).toBe(400);
 }
 const missing=await post('campus-lifecycle-source',{...source(node),action:'RECORD_DISPOSITION'});expect(missing.statusCode).toBe(503);expect(missing.json().code).toBe('BLOCKED_DEPENDENCY');expect(counts()).toBe(before);
});
test('source routes require current write permission and preserve other entity revision sources',async()=>{
 const node=await scenario.createCampus(),who='workspace-source-reader';
 peer(receipt.name,`INSERT INTO vnext_control.actor VALUES(${quote(who)},'SYNTHETIC_SOURCE_READER',true);INSERT INTO vnext_control.actor_grant VALUES(${quote(who)},'SYNTHETIC','READ');INSERT INTO organization_master.access VALUES(${quote(who)},${quote(node.id)}::uuid,'NORTH','READ');`);
 const before=counts();for(const [path,payload] of [['revision-source',source(node)],['campus-lifecycle-source',{...source(node),action:'RETIRE'}]] as const){const denied=await post(path,payload,who);expect(denied.statusCode).toBe(403);expect(denied.json().code).toBe('ACCESS_DENIED');}expect(counts()).toBe(before);
 const subject=await scenario.createSubject();const ordinary=await workspace.prepareRevision('maker',{kind:'ORGANIZATION',id:subject.id,version:subject.version});expect(ordinary).toMatchObject({domain:'ORG01',command:{action:'REVISE',target:{id:subject.id,version:subject.version}}});
});
