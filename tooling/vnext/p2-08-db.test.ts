import {test,expect,afterAll,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openDepartment,openDepartmentLifecycle,openOrganizationEvolutions,openOrganizationMappings,openHierarchy,EVOLUTION_IMPACT_DOMAINS,type DepartmentLifecycleCommand,type HierarchyCandidateInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {organizationMappingFixture} from './p2-03-fixture.js';
import {peer,quote} from './lineage.mjs';
import {operatingScenario} from './operating-scenario.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {evolutionFixture} from './p2-05-fixture.js';
import {Pool} from 'pg';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const provider=new LocalSyntheticKeyProvider(),owner=openDepartment(connection,provider),lifecycle=openDepartmentLifecycle(connection,provider),catalog=await openCatalog(connection,provider);
let f:Awaited<ReturnType<typeof organizationMappingFixture>>;
let evolutionData:Awaited<ReturnType<typeof evolutionFixture>>;
beforeAll(async()=>{f=await organizationMappingFixture(receipt,catalog,provider,connection);peer(receipt.name,"INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH','READ' FROM unnest(ARRAY['maker','maker-alias','reviewer']) a ON CONFLICT DO NOTHING;");});
afterAll(async()=>{await lifecycle.close();await owner.close();await catalog.close();});
test('P2-08 exposes the real Department lifecycle admission port',()=>{
 expect(owner).toHaveProperty('readAdmissionWindow');
});
test('P2-08 AC04 provides a forward compensation entry at the existing evolution Owner',async()=>{
 const evolution=openOrganizationEvolutions(connection,provider);try{expect(evolution).toHaveProperty('compensateEvolution');}finally{await evolution.close();}
});
test('P2-08 AC04 forward rename compensation adds an event while the accepted original remains unchanged',async()=>{
 const ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider);
 const apply=async(input:Awaited<ReturnType<typeof ef.input>>,compensate=false)=>{const i=await (compensate?e.compensateEvolution('maker',input):e.stage('maker',input));await e.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST POLICY ONLY compensation review',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),c=await e.plan('maker',{inputId:i.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:c.candidateId});await e.approveApplyUnit('reviewer',c);const result=await e.applyUnit('maker',{candidateId:c.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!.id;};
 try{
  const original=await ef.input(),id=await apply(original),query={id,campus:'NORTH' as const,businessAt:'2026-06-01T00:00:00'},before=await e.query('maker',query);
  const input=await ef.input();input.compensatesEvent={owner:'department-master/organization-evolution',id,version:'1'};input.event.effective_at='2026-07-01T00:00:00';input.predecessors[0]!.expectedVersion='2';input.rename={name:'TEST corrected name',shortName:'TEST correction'};
  const corrected=await apply(input,true);expect(corrected).not.toBe(id);expect(await e.query('maker',query)).toEqual(before);
  expect((await e.query('maker',{...query,id:corrected,businessAt:input.event.effective_at})).facts['compensatesEvent']).toEqual(input.compensatesEvent);
  expect((await owner.history('maker',f.targetId)).versions).toHaveLength(3);
 }finally{await e.close();}
});
const impactReviews=EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,ownerAttestationAccepted:true,dispositionAccepted:true,reason:'TEST POLICY ONLY independent declared impacts'}));
async function stage(commands:DepartmentLifecycleCommand[],campus:'NORTH'|'SOUTH'='NORTH',evidenceId=f.department.artifact.artifactId){const input=await f.department.input();return lifecycle.stage('maker',{requestId:randomUUID(),jobId:input.jobId,revisionId:input.revisionId,campus,profile:'CORE',commands,impacts:EVOLUTION_IMPACT_DOMAINS.map(domain=>({domain,determination:domain==='IDENTIFIER'||domain==='SOURCE_MAPPING'||domain==='HIERARCHY'?'AFFECTED':'UNAFFECTED',ownerRole:'TEST_ONLY_'+domain,ownerSignatory:'TEST_ONLY_'+domain+'_OWNER',ownerDecisionRef:'TEST_ONLY_'+domain+'_DECISION',requiredAction:'TEST explicit Owner disposition pending',reason:'TEST POLICY ONLY bounded declaration',evidenceId}))});}
async function prepare(commands:DepartmentLifecycleCommand[],campus:'NORTH'|'SOUTH'='NORTH',evidenceId=f.department.artifact.artifactId){const i=await stage(commands,campus,evidenceId);await lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST POLICY ONLY independent evidence',policyApproved:true,materialsAccepted:true,impactReviews});const requestId=randomUUID(),c=await lifecycle.plan('maker',{inputId:i.inputId,requestId});await lifecycle.readApplyCandidate('reviewer',{candidateId:c.candidateId});await lifecycle.approveApplyUnit('reviewer',c);return {candidateId:c.candidateId,requestId};}
function command(id:string,action:'SUSPEND'|'RESUME'|'DEPRECATE',head='0',at='2026-06-01T00:00:00'){return {action,department:{owner:'department-master' as const,id,expectedVersion:'1',expectedLifecycleHead:head},effectiveAt:at,reason:'TEST POLICY ONLY lifecycle',evidenceId:f.department.artifact.artifactId};}
test('P2-08 AC03 explicit suspension blocks a complete admission window and preserves old knowledge',async()=>{
 const id=await f.newDepartment(),oldR=(await owner.history('maker',id)).versions[0]!.recorded_at.replace(' ','T');
 f.grantTarget(id);
 await expect(lifecycle.history('maker',{id,recordAsOf:'2025-12-31T00:00:00'})).rejects.toThrow('NOT_FOUND');
 const request=await prepare([command(id,'SUSPEND')]),outcome=await lifecycle.applyUnit('maker',request);
 expect(outcome.status).toBe('COMMITTED');
 expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-05-01T00:00:00',validTo:'2026-07-01T00:00:00'})).toMatchObject({covered:false});
 expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-06-01T00:00:00',validTo:null,recordAsOf:oldR})).toMatchObject({covered:true});
 expect((await lifecycle.read('maker',{id,businessAt:'2026-06-01T00:00:00'})).businessState).toBe('SUSPENDED');
 expect(await lifecycle.applyUnit('maker',request)).toMatchObject({status:'COMMITTED',facts:outcome.status==='COMMITTED'?outcome.facts:[]});
 expect((await owner.history('maker',id)).versions).toHaveLength(1);
 if(outcome.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
 const impacts=openOrganizationEvolutions(connection,provider);
 try{const cases=await impacts.listImpactCases('maker',{eventId:outcome.facts[0]!.id,campus:'NORTH'});expect(cases.total).toBeGreaterThan(0);expect(cases.items[0]).toMatchObject({eventId:outcome.facts[0]!.id,observationBasis:'FROZEN_APPROVAL',status:'OPEN'});expect((await impacts.readImpactCase('maker',{caseId:cases.items[0]!.id,campus:'NORTH'})).item.id).toBe(cases.items[0]!.id);}finally{await impacts.close();}
});
async function newDepartment(){const id=await f.newDepartment();f.grantTarget(id);return id;}
test('P2-08 explicit resume restores the same identity and terminal deprecation cannot resume',async()=>{
 const id=await newDepartment();await lifecycle.applyUnit('maker',await prepare([command(id,'SUSPEND')]));
 const resumed=await lifecycle.applyUnit('maker',await prepare([command(id,'RESUME','1','2026-07-01T00:00:00')]));expect(resumed.status).toBe('COMMITTED');
 expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-07-01T00:00:00',validTo:null})).toMatchObject({covered:true});
 expect(await owner.coverage('maker',{id,validFrom:'2026-06-15T00:00:00',validTo:'2026-07-15T00:00:00'})).toMatchObject({covered:false});
 await lifecycle.applyUnit('maker',await prepare([command(id,'DEPRECATE','2','2026-08-01T00:00:00')]));
 expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-01-01T00:00:00',validTo:'2026-05-01T00:00:00'})).toMatchObject({covered:false});
 expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-01-01T00:00:00',validTo:'2026-05-01T00:00:00',recordAsOf:(await owner.history('maker',id)).versions[0]!.recorded_at.replace(' ','T')})).toMatchObject({covered:true});
 await expect(prepare([command(id,'RESUME','3','2026-09-01T00:00:00')])).rejects.toThrow('UNSUPPORTED_STATE_TRANSITION');
 expect((await owner.read('maker',{id,businessAt:'2026-09-01T00:00:00',campus:'NORTH'})).businessState).toBe('DEPRECATED');
});
test('lifecycle verification rejects a second account of the maker and the HTTP boundary rejects coercion',async()=>{
 const id=await newDepartment(),i=await stage([command(id,'SUSPEND')]);
 peer(receipt.name,"INSERT INTO department_master.access VALUES('maker-alias','HOSPITAL','VERIFY') ON CONFLICT DO NOTHING;");
 await expect(lifecycle.plan('reviewer',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 await expect(lifecycle.verify('maker-alias',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST self review',policyApproved:true,materialsAccepted:true,impactReviews})).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:lifecycle,actor:r=>actor(r.headers)});
 try{const url=await app.listen({host:'127.0.0.1',port:0});const post=(path:string,body:unknown,who='maker')=>fetch(url+'/api/vnext/department-lifecycle/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(body)});
  expect((await post('admission',{id,validFrom:'2026-06-01T00:00:00',validTo:null},'outsider')).status).toBe(403);
  expect((await post('admission',{id,validFrom:123,validTo:null})).status).toBe(400);
  expect((await post('admission',{id,validFrom:'2026-06-01T00:00:00',validTo:null,ignored:'bad'})).status).toBe(400);
  expect((await (await post('admission',{id,validFrom:'2026-06-01T00:00:00',validTo:null})).json()).covered).toBe(true);
 }finally{await app.close();}
});
test('two approved lifecycle writers serialize and the loser has no committed outcome',async()=>{
 const id=await newDepartment(),a=await prepare([command(id,'SUSPEND')]),b=await prepare([command(id,'DEPRECATE')]);
 const results=await Promise.allSettled([lifecycle.applyUnit('maker',a),lifecycle.applyUnit('maker',b)]);
 expect(results.filter(r=>r.status==='fulfilled'&&r.value.status==='COMMITTED')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await lifecycle.history('maker',{id})).lifecycle).toHaveLength(1);
 const failed=results[0]!.status==='rejected'?a:b;expect(await lifecycle.resumeOutcome('maker',failed)).toBeNull();
});
test('a database audit failure rolls back lifecycle facts and recovery stays empty',async()=>{
 const id=await newDepartment(),request=await prepare([command(id,'SUSPEND')]),before=await lifecycle.history('maker',{id});
 peer(receipt.name,"CREATE FUNCTION department_master.test_lifecycle_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='DEPARTMENT_LIFECYCLE_APPLY' THEN RAISE EXCEPTION 'TEST_ATOMIC_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER test_lifecycle_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION department_master.test_lifecycle_failure();");
 try{await expect(lifecycle.applyUnit('maker',request)).rejects.toThrow('APPLY_FAILED');expect(await lifecycle.history('maker',{id})).toEqual(before);expect(await lifecycle.resumeOutcome('maker',request)).toBeNull();}
 finally{peer(receipt.name,'DROP TRIGGER test_lifecycle_failure ON vnext_control.audit;DROP FUNCTION department_master.test_lifecycle_failure();');}
 expect((await lifecycle.applyUnit('maker',request)).status).toBe('COMMITTED');
});
test('actual application role cannot directly modify lifecycle facts or forge Owner tickets',async()=>{
 const pool=new Pool({connectionString:connection,max:1});try{
  await expect(pool.query('UPDATE department_master.lifecycle_version SET action=action WHERE false')).rejects.toMatchObject({code:'42501'});
  await expect(pool.query('SELECT * FROM vnext_control.department_write_authority')).rejects.toMatchObject({code:'42501'});
  await expect(pool.query("SELECT department_master.lifecycle_mutate('{}','bad')")).rejects.toThrow('ACCESS_DENIED');
  await expect(pool.query("SELECT department_master.apply_evolution_campus_changes('maker',$1::uuid)",[randomUUID()])).rejects.toMatchObject({code:'42501'});
 }finally{await pool.end();}
});
test('P2-08 AC01 two-campus relations and a partial service move preserve identity and source failure atomicity',async()=>{
 const s=await operatingScenario(receipt,connection,provider,catalog);
 try{
  peer(receipt.name,"INSERT INTO department_master.access SELECT actor,'SOUTH',permission FROM department_master.access WHERE scope='NORTH' ON CONFLICT DO NOTHING;");
  peer(receipt.name,"INSERT INTO department_master.identifier_access SELECT actor,scheme,'SOUTH',permission FROM department_master.identifier_access WHERE campus='NORTH' ON CONFLICT DO NOTHING;");
  const id=await newDepartment(),subject=await s.createSubject(),a=await s.createCampus('TEST campus A'),b=await s.createCampus('TEST campus B');
  peer(receipt.name,`INSERT INTO department_master.mapping_target_access SELECT actor,target_type,target_id,'SOUTH' FROM department_master.mapping_target_access WHERE target_id='${id}'::uuid AND campus='NORTH' ON CONFLICT DO NOTHING;`);
  await s.activateCampus(a);await s.activateCampus(b);s.grantPair(subject.id,a.id);s.grantPair(subject.id,b.id);
  const license=await s.addLicense(subject),services=['DEMO_MEDICAL_A','DEMO_MEDICAL_B'];
  for(const campus of [a,b]){const scope=await s.verifyScope(subject,campus,license,services);await s.operatingApply({...s.common,...s.endpoints(subject,campus),action:'ESTABLISH',evidence:s.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'TEST operator',primary:'Y',catalog:s.codeSet.reference,services,scopeTargets:[scope],licenseScopeText:'TEST POLICY ONLY'}});}
  const {effectiveAt:_,...base}=command(id,'SUSPEND');
  const assign:DepartmentLifecycleCommand={...base,action:'ASSIGN',campus:{owner:'organization-master/campus',id:a.id},subject:{owner:'organization-master',id:subject.id},services,validFrom:'2026-01-01T00:00:00',validTo:null};
  expect((await lifecycle.applyUnit('maker',await prepare([assign]))).status).toBe('COMMITTED');
  const relation=(await lifecycle.history('maker',{id})).relations[0]!;
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT actor_code,dataset_id,'SOUTH',purpose,permission FROM vnext_control.protected_grant WHERE campus='NORTH' AND dataset_id='${f.department.dataset.id}'::uuid ON CONFLICT DO NOTHING;`);
  const proofInput=await f.department.input(),southProof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proofInput.jobId,revisionId:proofInput.revisionId,campus:'SOUTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('TEST POLICY ONLY SOUTH independent relation evidence'));
  const southRequest=await prepare([{...assign,campus:{owner:'organization-master/campus',id:b.id},services:['DEMO_MEDICAL_B'],evidenceId:southProof.artifactId}],'SOUTH',southProof.artifactId),southCommitted=await lifecycle.applyUnit('maker',southRequest);expect(southCommitted.status).toBe('COMMITTED');if(southCommitted.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id='${f.department.dataset.id}'::uuid AND campus='SOUTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
  try{await expect(lifecycle.resumeOutcome('maker',southRequest)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker','${f.department.dataset.id}'::uuid,'SOUTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING;`);}
  expect(await lifecycle.resumeOutcome('maker',southRequest)).toMatchObject({status:'COMMITTED',facts:southCommitted.facts});
  const move={...command(id,'SUSPEND'),action:'MOVE',relation:{owner:'department-master/campus-relation',id:relation.id,expectedVersion:'1'},destination:{campus:{owner:'organization-master/campus',id:b.id},subject:{owner:'organization-master',id:subject.id}},services:['DEMO_MEDICAL_A']} satisfies DepartmentLifecycleCommand;
  const moveRequest=await prepare([move]),app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:lifecycle,actor:r=>actor(r.headers)});
  let responseError='';app.addHook('onError',async(_request,_reply,error)=>{responseError=error.message;});
  try{const url=await app.listen({host:'127.0.0.1',port:0}),response=await fetch(url+'/api/vnext/department-lifecycle/review',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'reviewer'},body:JSON.stringify({candidateId:moveRequest.candidateId})});expect(response.status,responseError).toBe(200);const body=await response.json();expect(body.writes).toHaveLength(3);expect(body.states[0].department.versions[0].facts.name).toBeDefined();expect(body.dependencies[0].status).toBe('SATISFIED');expect(body.verification.inputDigest).toMatch(/^[a-f0-9]{64}$/);expect(body.assessment.content.coverage).toContainEqual({owner:'CAMPUS_RELATION',status:'EVALUATED',reason:'OWNER_AVAILABLE'});}finally{await app.close();}
  expect((await lifecycle.applyUnit('maker',moveRequest)).status).toBe('COMMITTED');
  const after=await lifecycle.history('maker',{id});expect(after.department.id).toBe(id);expect(after.relations).toHaveLength(4);expect(new Set(after.relations.map(r=>r.governance_scope))).toEqual(new Set(['NORTH','SOUTH']));
  expect(after.relations.find(r=>r.id===relation.id)!.versions.at(-1)).toMatchObject({valid_to:'2026-06-01T00:00:00.000000',services});
  const destination=after.relations.find(r=>r.campus_id===b.id&&r.governance_scope==='NORTH')!;expect(destination.versions[0]!.services).toEqual(['DEMO_MEDICAL_A']);
  expect(after.relations.find(r=>r.campus_id===a.id&&r.id!==relation.id)!.versions[0]!.services).toEqual(['DEMO_MEDICAL_B']);
  const before=await lifecycle.history('maker',{id});
  const driftCommand={...move,relation:{...move.relation,id:destination.id},destination:{campus:{owner:'organization-master/campus' as const,id:a.id},subject:{owner:'organization-master' as const,id:subject.id}},effectiveAt:'2026-07-01T00:00:00'};
  const driftCandidate=await prepare([driftCommand]);
  const suspend=await s.campusApply({...s.common,action:'SUSPEND',target:{owner:'organization-master/campus',id:a.id,expectedVersion:'3'},evidence:s.artifact.artifactId,sourceOperationStatus:'SUSPENDED',reason:'TEST target unavailable'});expect(suspend.id).toBe(a.id);
  await expect(lifecycle.applyUnit('maker',driftCandidate)).rejects.toThrow('STALE_VALIDATION');expect(await lifecycle.resumeOutcome('maker',driftCandidate)).toBeNull();
  await expect(prepare([{...move,relation:{...move.relation,id:destination.id},destination:{campus:{owner:'organization-master/campus',id:a.id},subject:{owner:'organization-master',id:subject.id}},effectiveAt:'2026-07-01T00:00:00'}])).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
  expect(await lifecycle.history('maker',{id})).toEqual(before);
  const suspension=await lifecycle.applyUnit('maker',await prepare([command(id,'SUSPEND','0','2026-07-01T00:00:00')]));
  await expect(prepare([command(id,'RESUME','1','2026-08-01T00:00:00')])).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
  const remaining=(await lifecycle.history('maker',{id})).relations.find(r=>r.campus_id===a.id&&r.id!==relation.id)!;
  const end:DepartmentLifecycleCommand={...base,department:{...base.department,expectedLifecycleHead:'1'},action:'END',relation:{owner:'department-master/campus-relation',id:remaining.id,expectedVersion:'1'},services:['DEMO_MEDICAL_B'],validFrom:'2026-06-01T00:00:00',validTo:'2026-07-01T00:00:00'};
  const endRequest=await prepare([end]),ended=await lifecycle.applyUnit('maker',endRequest);expect(ended.status).toBe('COMMITTED');
  if(suspension.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  const impacts=openOrganizationEvolutions(connection,provider);
  try{
   const cases=await impacts.listImpactCases('maker',{eventId:suspension.facts[0]!.id,campus:'NORTH'}),item=cases.items.find(c=>c.obligation.kind==='REFERENCE'&&c.obligation.reference.owner==='CAMPUS_RELATION'&&c.obligation.reference.id===remaining.id)!;expect(item).toBeDefined();
   const draft=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_OWNER',kind:'RESPONSIBILITY',code:'LIFE_'+randomUUID().replaceAll('-','').toUpperCase(),values:{dataset:'ORG04',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}),submitted=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_OWNER',target:draft.id,expectedHead:draft.head}),responsibility=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_OWNER',target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest});
   const assigned=await impacts.assignImpactCase('maker',{requestId:randomUUID(),reason:'TEST_OWNER',caseId:item.id,campus:'NORTH',expectedHead:item.head,responsibilityId:responsibility.id});
   const version=(await lifecycle.history('maker',{id})).relations.find(r=>r.id===remaining.id)!.versions.at(-1)!;
   const proposed=await impacts.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST_CLOSE',caseId:item.id,campus:'NORTH',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.department.artifact.artifactId,result:{owner:'CAMPUS_RELATION',id:remaining.id,versionId:version.id,...endRequest}}});
   const accepted=await impacts.approveDisposition('reviewer',{requestId:randomUUID(),reason:'TEST_INDEPENDENT',caseId:item.id,campus:'NORTH',expectedHead:proposed.head,proposalEventId:proposed.eventId});
   expect((await impacts.recheckImpact('maker',{requestId:randomUUID(),reason:'TEST_RECHECK',caseId:item.id,campus:'NORTH',expectedHead:accepted.head})).status).toBe('RESOLVED');
  }finally{await impacts.close();}
  expect((await lifecycle.applyUnit('maker',await prepare([command(id,'RESUME','1','2026-08-01T00:00:00')]))).status).toBe('COMMITTED');
  expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-08-01T00:00:00',validTo:null})).toMatchObject({covered:true});
  const approvedSuspension=await prepare([command(id,'SUSPEND','2','2026-09-15T00:00:00')]);
  await s.orgApply({...s.common,validFrom:'2026-09-01T00:00:00',action:'REVOKE_LICENSE',target:{id:subject.id,version:subject.version},licenseTarget:{id:license.id,version:license.version},reason:'DEMO_REVOKED'});
  await lifecycle.applyUnit('maker',approvedSuspension);
  await expect(prepare([command(id,'RESUME','3','2026-10-01T00:00:00')])).rejects.toThrow('LICENSE_PERIOD_NOT_COVERED');
 }finally{await s.close();}
});

test('evolution compensation includes explicit campus writes in one root and split keeps external handoff pending',async()=>{
 const ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider),s=await operatingScenario(receipt,connection,provider,catalog,true);
 try{
  const id=await newDepartment(),subject=await s.createSubject(),campus=await s.createCampus();await s.activateCampus(campus);s.grantPair(subject.id,campus.id);const license=await s.addLicense(subject),scope=await s.verifyScope(subject,campus,license,['DEMO_MEDICAL_A']);await s.operatingApply({...s.common,...s.endpoints(subject,campus),action:'ESTABLISH',evidence:s.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'TEST operator',primary:'Y',catalog:s.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[scope],licenseScopeText:'TEST POLICY ONLY'}});
  const input=await ef.input();input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0]!.from_target_id=id;input.relations[0]!.to_target_id=id;
  input.campusChanges=[{action:'ASSIGN',department:{owner:'department-master',id},...s.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validTo:null}];
  async function prepareEvolution(value:typeof input){const i=await (value.compensatesEvent?e.compensateEvolution('maker',value):e.stage('maker',value));await e.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST explicit campus bundle',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),c=await e.plan('maker',{inputId:i.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:c.candidateId});await e.approveApplyUnit('reviewer',c);return {candidateId:c.candidateId,requestId};}
  const original=await e.applyUnit('maker',await prepareEvolution(input));if(original.status!=='COMMITTED')throw new Error('NOT_COMMITTED');const eventId=original.facts[0]!.id,relation=(await lifecycle.history('maker',{id})).relations[0]!;
  const compensation=await ef.input();compensation.compensatesEvent={owner:'department-master/organization-evolution',id:eventId,version:'1'};compensation.event.effective_at='2026-07-01T00:00:00';compensation.predecessors=[{owner:'department-master',id,expectedVersion:'2'}];compensation.relations[0]!.from_target_id=id;compensation.relations[0]!.to_target_id=id;compensation.campusChanges=[{action:'END',departmentId:id,relation:{owner:'department-master/campus-relation',id:relation.id,expectedVersion:'1'}},...input.campusChanges];
  const before=await lifecycle.history('maker',{id}),request=await prepareEvolution(compensation);
  peer(receipt.name,"CREATE FUNCTION department_master.test_evolution_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='EVOLUTION_APPLY' THEN RAISE EXCEPTION 'TEST_ATOMIC_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER test_evolution_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION department_master.test_evolution_failure();");
  try{await expect(e.applyUnit('maker',request)).rejects.toThrow('APPLY_FAILED');expect(await lifecycle.history('maker',{id})).toEqual(before);expect(await e.resumeOutcome('maker',request)).toBeNull();}finally{peer(receipt.name,'DROP TRIGGER test_evolution_failure ON vnext_control.audit;DROP FUNCTION department_master.test_evolution_failure();');}
  const result=await e.applyUnit('maker',request);if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');const query=await e.query('maker',{id:result.facts[0]!.id,campus:'NORTH',businessAt:'2026-07-01T00:00:00'}),after=await lifecycle.history('maker',{id});expect(after.relations).toHaveLength(2);expect(after.relations.flatMap(r=>r.versions).filter(v=>v.operation_id===query.id).every(v=>v.recorded_at===query.recordedAt)).toBe(true);expect(after.department.versions.at(-1)!.recorded_at.replace(' ','T').replace(/0+$/,'')).toBe(query.recordedAt.replace(/0+$/,''));
  const split=await ef.input();split.event.change_type='SPLIT';split.event.effective_at='2026-08-01T00:00:00';split.rename=null;split.contextEvidenceId=ef.material.artifactId;split.predecessors=[{owner:'department-master',id,expectedVersion:'3'}];split.successors=[f.department.entry(),f.department.entry()];for(const entry of split.successors){entry.row.valid_from=split.event.effective_at;entry.row.established_on='2026-08-01';}
  Object.assign(split.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit permanent-code assertion end pending'});
  split.relations=split.successors.map(next=>({...input.relations[0]!,succession_id:randomUUID(),org_event_id:split.event.org_event_id,to_target_id:next.row.org_id,context_rule:'TEST explicit successor'}));const current=after.relations.find(r=>r.id!==relation.id)!;
  split.campusChanges=[{action:'END',departmentId:id,relation:{owner:'department-master/campus-relation',id:current.id,expectedVersion:'1'}},{...input.campusChanges[0]!,action:'ASSIGN',department:{owner:'department-master/evolution-successor',alias:split.successors[0]!.row.org_id},...s.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validTo:null}];
  const splitted=await e.applyUnit('maker',await prepareEvolution(split));if(splitted.status!=='COMMITTED')throw new Error('NOT_COMMITTED');const event=await e.query('maker',{id:splitted.facts[0]!.id,campus:'NORTH',businessAt:split.event.effective_at});expect(event.handoff).toBe('NOT_EXECUTED');expect(event.successors).toHaveLength(2);for(const successor of event.successors)f.grantTarget(successor.id);expect((await lifecycle.history('maker',{id:event.successors[0]!.id})).relations).toHaveLength(1);expect((await lifecycle.history('maker',{id:event.successors[1]!.id})).relations).toHaveLength(0);expect((await lifecycle.read('maker',{id,businessAt:split.event.effective_at})).businessState).toBe('SUPERSEDED');
  const merge=await ef.input();merge.compensatesEvent={owner:'department-master/organization-evolution',id:event.id,version:'1'};merge.event.change_type='MERGE';merge.event.effective_at='2026-09-01T00:00:00';merge.rename=null;merge.predecessors=event.successors.map(d=>({owner:'department-master',id:d.id,expectedVersion:'1'}));merge.successors=[f.department.entry()];merge.successors[0]!.row.valid_from=merge.event.effective_at;merge.successors[0]!.row.established_on='2026-09-01';Object.assign(merge.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit ended assertions pending'});merge.relations=merge.predecessors.map(p=>({...input.relations[0]!,succession_id:randomUUID(),org_event_id:merge.event.org_event_id,from_target_id:p.id,to_target_id:merge.successors[0]!.row.org_id,context_rule:'TEST forward compensation'}));
  const sourceRelation=(await lifecycle.history('maker',{id:event.successors[0]!.id})).relations[0]!;merge.campusChanges=[{action:'END',departmentId:event.successors[0]!.id,relation:{owner:'department-master/campus-relation',id:sourceRelation.id,expectedVersion:'1'}},{action:'ASSIGN',department:{owner:'department-master/evolution-successor',alias:merge.successors[0]!.row.org_id},...s.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validTo:null}];
  const rebuilt=await e.applyUnit('maker',await prepareEvolution(merge));if(rebuilt.status!=='COMMITTED')throw new Error('NOT_COMMITTED');const corrected=await e.query('maker',{id:rebuilt.facts[0]!.id,campus:'NORTH',businessAt:merge.event.effective_at});expect(corrected.successors[0]!.id).not.toBe(id);expect(corrected.facts['compensatesEvent']).toEqual(merge.compensatesEvent);expect(await e.query('maker',{id:event.id,campus:'NORTH',businessAt:split.event.effective_at})).toEqual(event);expect((await lifecycle.read('maker',{id,businessAt:merge.event.effective_at})).businessState).toBe('SUPERSEDED');for(const d of event.successors)expect((await lifecycle.read('maker',{id:d.id,businessAt:merge.event.effective_at})).businessState).toBe('SUPERSEDED');
  const terminalId=corrected.successors[0]!.id;f.grantTarget(terminalId);await lifecycle.applyUnit('maker',await prepare([command(terminalId,'DEPRECATE','0','2026-09-15T00:00:00')]));
  const invalid=await ef.input();invalid.compensatesEvent={owner:'department-master/organization-evolution',id:corrected.id,version:'1'};invalid.event.change_type='SPLIT';invalid.event.effective_at='2026-10-01T00:00:00';invalid.rename=null;invalid.contextEvidenceId=ef.material.artifactId;invalid.predecessors=[{owner:'department-master',id:terminalId,expectedVersion:'1'}];invalid.successors=[f.department.entry(),f.department.entry()];for(const next of invalid.successors){next.row.valid_from=invalid.event.effective_at;next.row.established_on='2026-10-01';}invalid.relations=invalid.successors.map(next=>({...input.relations[0]!,succession_id:randomUUID(),org_event_id:invalid.event.org_event_id,from_target_id:terminalId,to_target_id:next.row.org_id,context_rule:'TEST invalid terminal compensation'}));Object.assign(invalid.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST pending'});invalid.campusChanges=[{action:'ASSIGN',department:{owner:'department-master/evolution-successor',alias:invalid.successors[0]!.row.org_id},...s.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validTo:null}];
  const beforeTerminal=await lifecycle.history('maker',{id:terminalId});await expect(prepareEvolution(invalid)).rejects.toThrow('UNSUPPORTED_STATE_TRANSITION');expect(await lifecycle.history('maker',{id:terminalId})).toEqual(beforeTerminal);expect(await owner.readAdmissionWindow('maker',{id:terminalId,validFrom:'2026-09-01T00:00:00',validTo:'2026-09-10T00:00:00'})).toMatchObject({covered:false});
 }finally{await e.close();await s.close();}
});

test('a SOUTH lifecycle case accepts an exact committed NORTH mapping closure',async()=>{
 const id=await newDepartment(),mapping=openOrganizationMappings(connection,provider),impacts=openOrganizationEvolutions(connection,provider);
 try{
  const entry=f.entry();entry.row.target_id=id;
  async function commitMap(value:typeof entry){const input=await f.input([value]),i=await mapping.stage('maker',input);await mapping.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,rows:[{row:1,reason:'TEST original mapping',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});const requestId=randomUUID(),c=await mapping.plan('maker',{inputId:i.inputId,requestId});await mapping.readApplyCandidate('reviewer',{candidateId:c.candidateId});await mapping.approveApplyUnit('reviewer',c);const result=await mapping.applyUnit('maker',{candidateId:c.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');const mid=result.facts[0]!.id;return {owner:'SOURCE_MAPPING' as const,id:mid,versionId:(await mapping.history('maker',mid)).versions.at(-1)!.id,candidateId:c.candidateId,requestId};}
  const original=await commitMap(entry);
  peer(receipt.name,`INSERT INTO department_master.mapping_target_access SELECT actor,target_type,target_id,'SOUTH' FROM department_master.mapping_target_access WHERE target_id='${id}'::uuid AND campus='NORTH' ON CONFLICT DO NOTHING;`);
  const proofInput=await f.department.input(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:proofInput.jobId,revisionId:proofInput.revisionId,campus:'SOUTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('TEST POLICY ONLY SOUTH lifecycle closure'));
  const committed=await lifecycle.applyUnit('maker',await prepare([{...command(id,'SUSPEND'),evidenceId:proof.artifactId}],'SOUTH',proof.artifactId));if(committed.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  const item=(await impacts.listImpactCases('maker',{eventId:committed.facts[0]!.id,campus:'SOUTH'})).items.find(c=>c.obligation.kind==='REFERENCE'&&c.obligation.reference.id===original.id)!;expect(item).toBeDefined();
  const r=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_OWNER',kind:'RESPONSIBILITY',code:'MAP_LIFE_'+randomUUID().replaceAll('-','').toUpperCase(),values:{dataset:'ORG22',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}),submitted=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_OWNER',target:r.id,expectedHead:r.head}),published=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_OWNER',target:r.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest});
  const assigned=await impacts.assignImpactCase('maker',{requestId:randomUUID(),reason:'TEST_OWNER',caseId:item.id,campus:'SOUTH',expectedHead:item.head,responsibilityId:published.id});
  const result=await commitMap({...entry,action:'CORRECT',mapping:{owner:'department-master/organization-mapping',id:original.id,expectedHead:'1'},row:{...entry.row,valid_to:'2026-06-01T00:00:00'}});
  const proposed=await impacts.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST exact cross-scope proof',caseId:item.id,campus:'SOUTH',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:proof.artifactId,result}}),approved=await impacts.approveDisposition('reviewer',{requestId:randomUUID(),reason:'TEST_INDEPENDENT',caseId:item.id,campus:'SOUTH',expectedHead:proposed.head,proposalEventId:proposed.eventId});
  expect((await impacts.recheckImpact('maker',{requestId:randomUUID(),reason:'TEST_RECHECK',caseId:item.id,campus:'SOUTH',expectedHead:approved.head})).status).toBe('RESOLVED');
 }finally{await mapping.close();await impacts.close();}
});

test.each(['SUSPEND','DEPRECATE'] as const)('a %s Department cannot own a new GROUP-only hierarchy interval',async(action)=>{
 const id=await newDepartment(),hierarchy=openHierarchy(connection,provider);
 try{
  expect(await lifecycle.applyUnit('maker',await prepare([command(id,action)]))).toMatchObject({status:'COMMITTED'});
  async function publish(from:string,to:string|null){
   const header={requestId:randomUUID(),sourceClientKey:randomUUID(),viewCode:'TEST_'+randomUUID(),viewName:'TEST POLICY ONLY lifecycle hierarchy owner',viewType:'ADMINISTRATIVE' as const,purpose:'TEST_POLICY_ONLY',aggregationRule:'NONE',ownerDepartmentId:id,sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG05/LIFECYCLE',sourceVersion:'1',validFrom:from,validTo:to,recordedAt:'2026-01-01T00:00:00',approvalRef:'TEST_APPROVAL'};
   const view=await hierarchy.createHierarchyView('maker',header);peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',${quote(view.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
   const candidate:HierarchyCandidateInput={...header,requestId:randomUUID(),viewId:view.viewId,parentCardinality:'STRICT_TREE',recordStatus:'ACTIVE',nodes:[{nodeKey:'group',parentNodeKey:null,nodeKind:'GROUP',groupCode:'TEST_OWNER',groupId:null,groupVersionId:null,displayName:'TEST independent group',relationName:'TEST',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:randomUUID(),sourceVersion:'1',sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG06/LIFECYCLE',validFrom:from,validTo:to,recordedAt:header.recordedAt,recordStatus:'ACTIVE',approvalRef:'TEST_APPROVAL'}}]};
   const staged=await hierarchy.importHierarchyCandidate('maker',candidate);if(!staged.candidateId)throw new Error('HIERARCHY_NOT_STAGED');await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:staged.candidateId,digest:staged.digest});return hierarchy.publishHierarchySnapshot('maker',{candidateId:staged.candidateId,digest:staged.digest,requestId:candidate.requestId});
  }
  expect((await publish('2026-01-01T00:00:00','2026-06-01T00:00:00')).validTo).toBe('2026-06-01T00:00:00.000000');
  await expect(publish('2026-06-01T00:00:00',null)).rejects.toThrow('BLOCKED_DEPENDENCY');
 }finally{await hierarchy.close();}
});

test('backdated resume retains a later scheduled suspension in admission and both Department queries',async()=>{
 const id=await newDepartment();
 for(const [action,head,at] of [['SUSPEND','0','2026-11-15T00:00:00'],['RESUME','1','2026-11-20T00:00:00'],['SUSPEND','2','2026-12-01T00:00:00']] as const)expect(await lifecycle.applyUnit('maker',await prepare([command(id,action,head,at)]))).toMatchObject({status:'COMMITTED'});
 const oldR=(await lifecycle.history('maker',{id})).lifecycle.at(-1)!.recorded_at;
 for(const [action,head,at] of [['SUSPEND','3','2026-11-25T00:00:00'],['RESUME','4','2026-11-30T00:00:00']] as const)expect(await lifecycle.applyUnit('maker',await prepare([command(id,action,head,at)]))).toMatchObject({status:'COMMITTED'});
 expect(await owner.readAdmissionWindow('maker',{id,validFrom:'2026-12-01T00:00:00',validTo:'2026-12-02T00:00:00'})).toMatchObject({covered:false});
 expect(await lifecycle.read('maker',{id,businessAt:'2026-12-01T00:00:00'})).toMatchObject({businessState:'SUSPENDED'});
 expect(await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-12-01T00:00:00'})).toMatchObject({businessState:'SUSPENDED'});
 expect(await lifecycle.read('maker',{id,businessAt:'2026-12-01T00:00:00',recordAsOf:oldR})).toMatchObject({businessState:'SUSPENDED'});
 expect((await lifecycle.history('maker',{id})).lifecycle.map(v=>v.number)).toEqual(['1','2','3','4','5']);
});

test('bounded attribute correction preserves the original assertion outside its own business interval',async()=>{
 const entry=f.department.entry();
 async function apply(entryValue:typeof entry){const input=await f.department.input([entryValue]),staged=await owner.stage('maker',input);await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,disposition:'DEPARTMENT',historicalException:false,reason:'TEST bounded assertion',evidenceId:f.department.artifact.artifactId}]});const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!.id;}
 const id=await apply(entry);f.grantTarget(id);
 const correction={...entry,intent:'REVISE' as const,target:{owner:'department-master' as const,id,expectedVersion:'1'},row:{...entry.row,org_name:'TEST March assertion',valid_from:'2026-03-01T00:00:00',valid_to:'2026-04-01T00:00:00'}};
 expect(await apply(correction)).toBe(id);
 expect(await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-03-15T00:00:00'})).toMatchObject({version:{number:'2',facts:{name:'TEST March assertion'}}});
 expect(await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-05-01T00:00:00'})).toMatchObject({version:{number:'1',facts:{name:entry.row.org_name}}});
 expect(await owner.coverage('maker',{id,validFrom:'2026-05-01T00:00:00',validTo:'2026-06-01T00:00:00'})).toMatchObject({covered:true});
 expect(await lifecycle.readAdmissionWindow('maker',{id,validFrom:'2026-05-01T00:00:00',validTo:'2026-06-01T00:00:00'})).toMatchObject({covered:true});
});

test('forward rename compensation before a scheduled split is bounded by the original exit',async()=>{
 const id=await newDepartment(),ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider);
 try{
  async function apply(input:Awaited<ReturnType<typeof ef.input>>){const staged=await (input.compensatesEvent?e.compensateEvolution('maker',input):e.stage('maker',input));await e.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST pre-exit correction',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),candidate=await e.plan('maker',{inputId:staged.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await e.approveApplyUnit('reviewer',candidate);const result=await e.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('NOT_COMMITTED');return result.facts[0]!.id;}
  const first=await ef.input();first.event.effective_at='2026-11-01T00:00:00';first.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];first.relations[0]!.from_target_id=id;first.relations[0]!.to_target_id=id;
  const original=await apply(first),originalQuery={id:original,campus:'NORTH' as const,businessAt:first.event.effective_at},originalEvent=await e.query('maker',originalQuery);
  const split=await ef.input();split.event.change_type='SPLIT';split.event.effective_at='2026-12-01T00:00:00';split.rename=null;split.contextEvidenceId=ef.material.artifactId;split.predecessors=[{owner:'department-master',id,expectedVersion:'2'}];split.successors=[f.department.entry(),f.department.entry()];for(const row of split.successors){row.row.valid_from=split.event.effective_at;row.row.established_on='2026-12-01';}
  Object.assign(split.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicitly close code at scheduled exit'});
  split.relations=split.successors.map(row=>({...first.relations[0]!,org_event_id:split.event.org_event_id,succession_id:randomUUID(),to_target_id:row.row.org_id,context_rule:'TEST future split'}));
  const splitId=await apply(split),splitQuery={id:splitId,campus:'NORTH' as const,businessAt:split.event.effective_at},splitEvent=await e.query('maker',splitQuery);
  const correction=await ef.input();correction.compensatesEvent={owner:'department-master/organization-evolution',id:original,version:'1'};correction.event.effective_at='2026-11-15T00:00:00';correction.predecessors=[{owner:'department-master',id,expectedVersion:'2'}];correction.relations[0]!.from_target_id=id;correction.relations[0]!.to_target_id=id;correction.rename={name:'TEST legal pre-exit correction',shortName:'TEST'};
  Object.assign(correction.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST preserve pending code closure at original scheduled exit'});
  await apply(correction);
  expect((await owner.history('maker',id)).versions.at(-1)).toMatchObject({valid_from:'2026-11-15T00:00:00',valid_to:'2026-12-01T00:00:00'});
  expect(await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-11-20T00:00:00'})).toMatchObject({businessState:'ACTIVE',version:{number:'3',facts:{name:'TEST legal pre-exit correction'}}});
  expect(await owner.read('maker',{id,campus:'NORTH',businessAt:split.event.effective_at})).toMatchObject({businessState:'SUPERSEDED'});
  expect(await e.query('maker',originalQuery)).toEqual(originalEvent);expect(await e.query('maker',splitQuery)).toEqual(splitEvent);
 }finally{await e.close();}
});

test('accepted replay ignores an unrelated later SOUTH relationship but preserves frozen access checks',async()=>{
 const id=await newDepartment(),s=await operatingScenario(receipt,connection,provider,catalog,true);
 try{
  await lifecycle.applyUnit('maker',await prepare([command(id,'SUSPEND')]));
  const request=await prepare([command(id,'RESUME','1','2026-07-01T00:00:00')]),accepted=await lifecycle.applyUnit('maker',request);if(accepted.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  const subject=await s.createSubject(),campus=await s.createCampus();await s.activateCampus(campus);s.grantPair(subject.id,campus.id);const license=await s.addLicense(subject),scope=await s.verifyScope(subject,campus,license,['DEMO_MEDICAL_A']);await s.operatingApply({...s.common,...s.endpoints(subject,campus),action:'ESTABLISH',evidence:s.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'TEST later relationship',primary:'Y',catalog:s.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[scope],licenseScopeText:'TEST POLICY ONLY'}});
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.department.dataset.id)}::uuid,'SOUTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;INSERT INTO department_master.mapping_target_access SELECT actor,target_type,target_id,'SOUTH' FROM department_master.mapping_target_access WHERE target_id=${quote(id)}::uuid ON CONFLICT DO NOTHING;`);
  const job=await f.department.input(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.jobId,revisionId:job.revisionId,campus:'SOUTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('TEST POLICY ONLY later SOUTH relationship'));
  await lifecycle.applyUnit('maker',await prepare([{action:'ASSIGN',department:{owner:'department-master',id,expectedVersion:'1',expectedLifecycleHead:'2'},...s.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validFrom:'2026-08-01T00:00:00',validTo:null,reason:'TEST later SOUTH relationship',evidenceId:proof.artifactId}],'SOUTH',proof.artifactId));
  peer(receipt.name,`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(campus.id)}::uuid AND permission='READ';`);
  try{
   await expect(lifecycle.history('maker',{id})).rejects.toThrow('ACCESS_DENIED');
   expect(await lifecycle.resumeOutcome('maker',request)).toMatchObject({status:'COMMITTED',facts:accepted.facts});
   expect(await lifecycle.applyUnit('maker',request)).toMatchObject({status:'COMMITTED',facts:accepted.facts});
   expect(await lifecycle.reconcileCommittedUnit('maker',request)).toMatchObject({status:'MATCHED'});
   peer(receipt.name,"DELETE FROM department_master.access WHERE actor='maker' AND scope='HOSPITAL' AND permission='READ';");
   try{await expect(lifecycle.resumeOutcome('maker',request)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"INSERT INTO department_master.access VALUES('maker','HOSPITAL','READ') ON CONFLICT DO NOTHING;");}
  }finally{peer(receipt.name,`INSERT INTO organization_master.access VALUES('maker',${quote(campus.id)}::uuid,'NORTH','READ') ON CONFLICT DO NOTHING;`);}
 }finally{await s.close();}
});

test('composite evolution replay authorizes its original campus rather than a later unrelated relationship',async()=>{
 const id=await newDepartment(),ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider),s=await operatingScenario(receipt,connection,provider,catalog,true);
 try{
  const subject=await s.createSubject(),a=await s.createCampus(),b=await s.createCampus();await s.activateCampus(a);await s.activateCampus(b);s.grantPair(subject.id,a.id);s.grantPair(subject.id,b.id);const license=await s.addLicense(subject);
  for(const campus of [a,b]){const scope=await s.verifyScope(subject,campus,license,['DEMO_MEDICAL_A']);await s.operatingApply({...s.common,...s.endpoints(subject,campus),action:'ESTABLISH',evidence:s.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'TEST frozen campus access',primary:'Y',catalog:s.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[scope],licenseScopeText:'TEST POLICY ONLY'}});}
  const input=await ef.input();input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0]!.from_target_id=id;input.relations[0]!.to_target_id=id;input.campusChanges=[{action:'ASSIGN',department:{owner:'department-master',id},...s.endpoints(subject,a),services:['DEMO_MEDICAL_A'],validTo:null}];
  const staged=await e.stage('maker',input);await e.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST original composite',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),candidate=await e.plan('maker',{inputId:staged.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await e.approveApplyUnit('reviewer',candidate);const request={candidateId:candidate.candidateId,requestId},accepted=await e.applyUnit('maker',request);if(accepted.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT actor,${quote(f.department.dataset.id)}::uuid,'SOUTH','IDENTITY_VERIFY',permission FROM (VALUES('maker','READ'),('maker','STORE'),('reviewer','READ'),('reviewer','STORE')) x(actor,permission) ON CONFLICT DO NOTHING;INSERT INTO department_master.mapping_target_access SELECT actor,target_type,target_id,'SOUTH' FROM department_master.mapping_target_access WHERE target_id=${quote(id)}::uuid ON CONFLICT DO NOTHING;`);
  const job=await f.department.input(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.jobId,revisionId:job.revisionId,campus:'SOUTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('TEST POLICY ONLY unrelated SOUTH relation'));
  await lifecycle.applyUnit('maker',await prepare([{action:'ASSIGN',department:{owner:'department-master',id,expectedVersion:'2',expectedLifecycleHead:'0'},...s.endpoints(subject,b),services:['DEMO_MEDICAL_A'],validFrom:'2026-07-01T00:00:00',validTo:null,reason:'TEST unrelated later relation',evidenceId:proof.artifactId}],'SOUTH',proof.artifactId));
  peer(receipt.name,`DELETE FROM organization_master.access WHERE actor='maker' AND subject_id=${quote(b.id)}::uuid AND permission='READ';`);
  try{expect(await e.resumeOutcome('maker',request)).toMatchObject({status:'COMMITTED',facts:accepted.facts});expect(await e.applyUnit('maker',request)).toMatchObject({status:'COMMITTED',facts:accepted.facts});expect(await e.reconcileCommittedUnit('maker',request)).toMatchObject({status:'MATCHED'});}finally{peer(receipt.name,`INSERT INTO organization_master.access VALUES('maker',${quote(b.id)}::uuid,'NORTH','READ') ON CONFLICT DO NOTHING;`);}
 }finally{await e.close();await s.close();}
});

test('rename before a scheduled deprecation ends at the immutable terminal boundary',async()=>{
 const id=await newDepartment(),ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider);
 try{
  await lifecycle.applyUnit('maker',await prepare([command(id,'DEPRECATE','0','2026-12-01T00:00:00')]));
  const terminal=(await lifecycle.history('maker',{id})).lifecycle;
  const input=await ef.input();input.event.effective_at='2026-11-15T00:00:00';input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0]!.from_target_id=id;input.relations[0]!.to_target_id=id;
  Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST preserve code closure at scheduled deprecation'});
  const staged=await e.stage('maker',input);await e.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST pre-deprecation rename',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),candidate=await e.plan('maker',{inputId:staged.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await e.approveApplyUnit('reviewer',candidate);
  expect(await e.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'COMMITTED'});
  expect((await owner.history('maker',id)).versions.at(-1)).toMatchObject({valid_from:'2026-11-15T00:00:00',valid_to:'2026-12-01T00:00:00'});
  expect(await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-11-20T00:00:00'})).toMatchObject({businessState:'ACTIVE',version:{number:'2'}});
  expect(await owner.read('maker',{id,campus:'NORTH',businessAt:'2026-12-01T00:00:00'})).toMatchObject({businessState:'DEPRECATED'});
  expect((await lifecycle.history('maker',{id})).lifecycle).toEqual(terminal);
 }finally{await e.close();}
});

test('planning uses the earlier deprecation when a later replacement is already scheduled',async()=>{
 const id=await newDepartment(),ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider);
 try{
  const input=await ef.input();input.event.change_type='SPLIT';input.event.effective_at='2026-12-01T00:00:00';input.rename=null;input.contextEvidenceId=ef.material.artifactId;input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.successors=[f.department.entry(),f.department.entry()];for(const row of input.successors){row.row.valid_from=input.event.effective_at;row.row.established_on='2026-12-01';}
  Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST scheduled code closure'});input.relations=input.successors.map(row=>({...input.relations[0]!,succession_id:randomUUID(),from_target_id:id,to_target_id:row.row.org_id,context_rule:'TEST scheduled split'}));
  const staged=await e.stage('maker',input);await e.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST two terminal boundaries',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),candidate=await e.plan('maker',{inputId:staged.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await e.approveApplyUnit('reviewer',candidate);expect(await e.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'COMMITTED'});
  expect(await lifecycle.applyUnit('maker',await prepare([command(id,'DEPRECATE','0','2026-11-01T00:00:00')]))).toMatchObject({status:'COMMITTED'});
  const before=await lifecycle.history('maker',{id});
  await expect(prepare([command(id,'SUSPEND','1','2026-11-15T00:00:00')])).rejects.toThrow('UNSUPPORTED_STATE_TRANSITION');
  expect(await lifecycle.history('maker',{id})).toEqual(before);
 }finally{await e.close();}
});

test('NORTH evolution ends a SOUTH relation with its own scope authority and one immutable root',async()=>{
 const id=await newDepartment(),ef=evolutionData??=await evolutionFixture(receipt,catalog,provider,connection,f),e=openOrganizationEvolutions(connection,provider),s=await operatingScenario(receipt,connection,provider,catalog,true);
 try{
  const subject=await s.createSubject(),campus=await s.createCampus();await s.activateCampus(campus);s.grantPair(subject.id,campus.id);const license=await s.addLicense(subject),scope=await s.verifyScope(subject,campus,license,['DEMO_MEDICAL_A']);await s.operatingApply({...s.common,...s.endpoints(subject,campus),action:'ESTABLISH',evidence:s.artifact.artifactId,facts:{role:'OPERATOR',relationTypeText:'TEST cross-scope END',primary:'Y',catalog:s.codeSet.reference,services:['DEMO_MEDICAL_A'],scopeTargets:[scope],licenseScopeText:'TEST POLICY ONLY'}});
  peer(receipt.name,`INSERT INTO vnext_control.protected_grant SELECT a,${quote(f.department.dataset.id)}::uuid,'SOUTH','IDENTITY_VERIFY',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['READ','STORE']) p ON CONFLICT DO NOTHING;INSERT INTO department_master.mapping_target_access SELECT actor,target_type,target_id,'SOUTH' FROM department_master.mapping_target_access WHERE target_id=${quote(id)}::uuid ON CONFLICT DO NOTHING;`);
  const job=await f.department.input(),proof=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:job.jobId,revisionId:job.revisionId,campus:'SOUTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:3600},Buffer.from('TEST POLICY ONLY SOUTH relation closure'));
  await lifecycle.applyUnit('maker',await prepare([{action:'ASSIGN',department:{owner:'department-master',id,expectedVersion:'1',expectedLifecycleHead:'0'},...s.endpoints(subject,campus),services:['DEMO_MEDICAL_A'],validFrom:'2026-01-01T00:00:00',validTo:null,reason:'TEST SOUTH relation',evidenceId:proof.artifactId}],'SOUTH',proof.artifactId));
  const before=await lifecycle.history('maker',{id}),relation=before.relations[0]!;
  const input=await ef.input();input.event.change_type='SPLIT';input.rename=null;input.contextEvidenceId=ef.material.artifactId;input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.successors=[f.department.entry(),f.department.entry()];for(const row of input.successors){row.row.valid_from=input.event.effective_at;row.row.established_on='2026-06-01';}
  Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit code closure'});input.relations=input.successors.map(row=>({...input.relations[0]!,succession_id:randomUUID(),from_target_id:id,to_target_id:row.row.org_id,context_rule:'TEST cross-scope split'}));input.campusChanges=[{action:'END',departmentId:id,relation:{owner:'department-master/campus-relation',id:relation.id,expectedVersion:'1'}}];
  const staged=await e.stage('maker',input);await e.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST scope-local END authority',policyApproved:true,materialsAccepted:true,impactReviews:ef.impactReviews});const requestId=randomUUID(),candidate=await e.plan('maker',{inputId:staged.inputId,requestId});await e.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await e.approveApplyUnit('reviewer',candidate);const request={candidateId:candidate.candidateId,requestId};
  // HOSPITAL WRITE legitimately covers both scopes; remove that fallback too.
  peer(receipt.name,"INSERT INTO department_master.access VALUES('maker','NORTH','WRITE') ON CONFLICT DO NOTHING;DELETE FROM department_master.access WHERE actor='maker' AND scope IN ('HOSPITAL','SOUTH') AND permission='WRITE';");
  try{await expect(e.applyUnit('maker',request)).rejects.toThrow('ACCESS_DENIED');expect(await lifecycle.history('maker',{id})).toEqual(before);expect(await e.resumeOutcome('maker',request)).toBeNull();}finally{peer(receipt.name,"INSERT INTO department_master.access VALUES('maker','HOSPITAL','WRITE'),('maker','SOUTH','WRITE') ON CONFLICT DO NOTHING;");}
  const accepted=await e.applyUnit('maker',request);if(accepted.status!=='COMMITTED')throw new Error('NOT_COMMITTED');
  const event=await e.query('maker',{id:accepted.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at}),after=await lifecycle.history('maker',{id});
  expect(after.relations[0]!.governance_scope).toBe('SOUTH');expect(after.relations[0]!.versions).toHaveLength(2);expect(after.relations[0]!.versions[0]).toEqual(relation.versions[0]);expect(after.relations[0]!.versions[1]).toMatchObject({action:'END',valid_to:input.event.effective_at+'.000000',operation_id:event.id,recorded_at:event.recordedAt});
  expect(event.handoff).toBe('NOT_EXECUTED');expect(await e.resumeOutcome('maker',request)).toMatchObject({status:'COMMITTED',facts:accepted.facts});
 }finally{await e.close();await s.close();}
});
