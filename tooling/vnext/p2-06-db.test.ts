import {test,expect,afterAll,beforeAll} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {openCatalog,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {openOrganizationEvolutions,openOrganizationIdentifiers,openOrganizationMappings,openDepartment,openHierarchy,departmentImpactPorts,type HierarchyCandidateInput} from '../../apps/governance-api/src/modules/department-master/index.js';
import {evolutionFixture} from './p2-05-fixture.js';
import {peer,quote} from './lineage.mjs';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {Pool} from 'pg';

const provider=new LocalSyntheticKeyProvider(),connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const catalog=await openCatalog(connection,provider),owner=openOrganizationEvolutions(connection,provider);
let f:Awaited<ReturnType<typeof evolutionFixture>>;
beforeAll(async()=>{f=await evolutionFixture(receipt,catalog,provider,connection);});
afterAll(async()=>{await owner.close();await catalog.close();});
test('P2-06 assessment distinguishes unavailable downstream owners from zero references',async()=>{
 const input=await f.input(),staged=await owner.stage('maker',input);
 const result=await owner.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST_POLICY_ONLY',target:{kind:'INPUT',id:staged.inputId}});
 expect(result.coverage).toContainEqual({owner:'PERSONNEL',status:'NOT_EVALUABLE',reason:'OWNER_NOT_IMPLEMENTED'});
 expect(result.target).toEqual({kind:'INPUT',id:staged.inputId});
 expect(result.references.some(ref=>ref.owner==='IDENTIFIER'&&ref.change==='CHANGED'&&ref.constraint==='SATISFIED')).toBe(true);
});
async function freshRename(){
 const input=await f.input(),id=await f.newDepartment();f.grantTarget(id);
 input.predecessors=[{owner:'department-master',id,expectedVersion:'1'}];input.relations[0]!.from_target_id=id;input.relations[0]!.to_target_id=id;return input;
}
async function verify(input:Awaited<ReturnType<typeof owner.stage>>){return owner.verify('reviewer',{requestId:randomUUID(),inputId:input.inputId,inputDigest:input.digest,reason:'TEST POLICY ONLY independent impact materials',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});}
test.each(['sequential','concurrent'] as const)('a downstream reference and approved evolution serialize %s without stale acceptance',async(mode)=>{
 const input=await freshRename(),staged=await owner.stage('maker',input);await verify(staged);
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const aliases=openOrganizationIdentifiers(connection,provider);
 try{
  const alias=await f.identifierInput(input.predecessors[0]!.id,'2026-01-01T00:00:00'),record=await aliases.stage('maker',alias);
  await aliases.verify('reviewer',{requestId:randomUUID(),inputId:record.inputId,inputDigest:record.digest,rows:[{row:1,reason:'TEST POLICY ONLY approved new alias',evidenceId:alias.entries[0]!.evidenceId,policyApproved:true}]});
  const ar=randomUUID(),ap=await aliases.plan('maker',{inputId:record.inputId,requestId:ar});await aliases.readApplyCandidate('reviewer',{candidateId:ap.candidateId});await aliases.approveApplyUnit('reviewer',ap);
  if(mode==='concurrent'){
   const results=await Promise.allSettled([aliases.applyUnit('maker',{candidateId:ap.candidateId,requestId:ar}),owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})]);
   expect(results.filter(result=>result.status==='fulfilled'&&result.value.status==='COMMITTED')).toHaveLength(1);expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);return;
  }
  expect((await aliases.applyUnit('maker',{candidateId:ap.candidateId,requestId:ar})).status).toBe('COMMITTED');
  await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('STALE_VALIDATION');
  expect(await owner.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId})).toBeNull();
 }finally{await aliases.close();}
});
test('assessment replay preserves its identity and rejects a reused request with different intent',async()=>{
 const staged=await owner.stage('maker',await f.input());
 const command={requestId:randomUUID(),reason:'TEST_POLICY_ONLY',target:{kind:'INPUT' as const,id:staged.inputId}};
 const first=await owner.assessDepartmentChange('maker',command);
 expect(first.assessmentId).toMatch(/^[a-f0-9-]{36}$/);
 expect(await owner.assessDepartmentChange('maker',command)).toEqual(first);
 await expect(owner.assessDepartmentChange('maker',{...command,reason:'DIFFERENT_INTENT'})).rejects.toThrow('REQUEST_CONFLICT');
});
test('assessment byte budget is explicit at the persistence boundary over real HTTP',async()=>{
 const input=await freshRename(),staged=await owner.stage('maker',input);
 let padding=0,count=200;
 // A synthetic reverse-reader adapter varies only response volume. Every
 // reference still uses an actual Owner record and real reference authorization.
 const budgetOwner=openOrganizationEvolutions(connection,provider,{...departmentImpactPorts,async references(scope,who,departments,campus){
  const [reference]=await departmentImpactPorts.references(scope,who,departments,campus);if(!reference)throw new Error('REFERENCE_REQUIRED');
  return Array.from({length:count},(_,index)=>({...structuredClone(reference),frozenLabel:'x'.repeat(Math.floor(padding/count)+(index<padding%count?1:0))}));
 }});
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:budgetOwner,actor:r=>actor(r.headers)});
 const pool=new Pool({connectionString:connection,max:1});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0});
  const request={requestId:randomUUID(),reason:'TEST exact byte budget',target:{kind:'INPUT' as const,id:staged.inputId}};
  const baseline=await budgetOwner.assessDepartmentChange('maker',request),{assessmentId:_,recordedAt:__,...content}=baseline;
  const baseBytes=(await pool.query('SELECT octet_length($1::jsonb::text) bytes',[JSON.stringify(content)])).rows[0].bytes;
  padding=524287-baseBytes;expect(padding).toBeGreaterThan(0);expect(Math.ceil(padding/count)).toBeLessThanOrEqual(2000);
  const post=async(body:typeof request)=>{const response=await fetch(url+'/api/vnext/department-impacts/assess',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  expect((await post({...request,requestId:randomUUID()})).status).toBe(200);
  padding+=1;expect((await post({...request,requestId:randomUUID()})).status).toBe(200);
  padding+=1;const oversized={...request,requestId:randomUUID()},failed=await post(oversized);
  expect(failed).toMatchObject({status:400,data:{code:'PLAN_INPUT_LIMIT',budget:{kind:'ASSESSMENT_BYTES',observed:524289,limit:524288}}});
  expect(await post(oversized)).toEqual(failed);
  await expect.soft(budgetOwner.assessDepartmentChange('maker',request)).resolves.toEqual(baseline);
  count=2001;padding=0;
  expect(await post({...request,requestId:randomUUID()})).toMatchObject({status:400,data:{code:'PLAN_INPUT_LIMIT',budget:{kind:'REFERENCE_COUNT',observed:2001,limit:2000}}});
  expect(await budgetOwner.assessDepartmentChange('maker',request)).toEqual(baseline);
  await expect(budgetOwner.assessDepartmentChange('maker',{...request,reason:'TEST_CONFLICT'})).rejects.toThrow('REQUEST_CONFLICT');
 }finally{await app.close();await budgetOwner.close();await pool.end();}
});
test('P2-06-AC-01 rename commits frozen change evidence and explicit open impact cases',async()=>{
 const input=await freshRename(),staged=await owner.stage('maker',input);await verify(staged);
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const committed=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(committed.status).toBe('COMMITTED');
 if(committed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const eventId=committed.facts[0]!.id;
 const cases=await owner.listImpactCases('maker',{eventId,campus:'NORTH'});
 expect(cases.items.length).toBeGreaterThan(0);expect(cases.items[0]).toMatchObject({status:'OPEN',head:'0',eventId});
 if(cases.items[0]!.obligation.kind!=='REFERENCE')throw new Error('REFERENCE_REQUIRED');
 expect(cases.items[0]!.obligation.reference).toMatchObject({change:'CHANGED',constraint:'SATISFIED'});
 expect((await owner.query('maker',{id:eventId,campus:'NORTH',businessAt:input.event.effective_at})).predecessors[0]!.id).toBe(input.predecessors[0]!.id);
});
async function applyRename(){
 const input=await freshRename(),staged=await owner.stage('maker',input);await verify(staged);
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const committed=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(committed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return {input,eventId:committed.facts[0]!.id};
}
const responsibilities=new Map<string,Awaited<ReturnType<typeof catalog.command>>>();
async function responsibility(dataset:string,role='SYNTHETIC_OWNER_A'){
 const prior=responsibilities.get(dataset+role);if(prior)return prior;
 const draft=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',kind:'RESPONSIBILITY',code:'IMPACT_'+randomUUID().replaceAll('-','').toUpperCase(),values:{dataset,authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:role},validFrom:'2026-01-01T00:00:00'});
 const submitted=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:draft.head});const published=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest});responsibilities.set(dataset+role,published);return published;
}
test('label-only impacts require an independent disposition then side-effect-free recheck',async()=>{
 const {eventId}=await applyRename(),list=await owner.listImpactCases('maker',{eventId,campus:'NORTH'}),item=list.items[0]!,r=await responsibility('ORG23');
 peer(receipt.name,"INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['WRITE','REVIEW']) p ON CONFLICT DO NOTHING;");
 const assigned=await owner.assignImpactCase('maker',{requestId:randomUUID(),reason:'TEST_OWNER',caseId:item.id,campus:'NORTH',expectedHead:item.head,responsibilityId:r.id});
 const proposed=await owner.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST_KEEP_HISTORY',caseId:item.id,campus:'NORTH',expectedHead:assigned.head,disposition:{kind:'KEEP_HISTORY',evidenceId:f.material.artifactId}});
 peer(receipt.name,"INSERT INTO department_master.access VALUES('maker-alias','HOSPITAL','REVIEW') ON CONFLICT DO NOTHING;INSERT INTO department_master.identifier_access VALUES('maker-alias','SYNTHETIC_DEPARTMENT_CODE','NORTH','REVIEW') ON CONFLICT DO NOTHING;");
 try{await expect(owner.approveDisposition('maker-alias',{requestId:randomUUID(),reason:'TEST_SELF_APPROVAL',caseId:item.id,campus:'NORTH',expectedHead:proposed.head,proposalEventId:proposed.eventId})).rejects.toThrow('MAKER_CHECKER_REQUIRED');}
 finally{peer(receipt.name,"DELETE FROM department_master.access WHERE actor='maker-alias' AND scope='HOSPITAL' AND permission='REVIEW';DELETE FROM department_master.identifier_access WHERE actor='maker-alias' AND scheme='SYNTHETIC_DEPARTMENT_CODE' AND permission='REVIEW';");}
 const approved=await owner.approveDisposition('reviewer',{requestId:randomUUID(),reason:'TEST_INDEPENDENT',caseId:item.id,campus:'NORTH',expectedHead:proposed.head,proposalEventId:proposed.eventId});
 expect(approved.status).toBe('OPEN');
 const checked=await owner.recheckImpact('maker',{requestId:randomUUID(),reason:'TEST_RECHECK',caseId:item.id,campus:'NORTH',expectedHead:approved.head});expect(checked.status).toBe('RESOLVED');
 const repeatCommand={requestId:randomUUID(),reason:'TEST_RECHECK',caseId:item.id,campus:'NORTH' as const,expectedHead:checked.head};
 const repeated=await owner.recheckImpact('maker',repeatCommand);expect(repeated.head).toBe(checked.head);
 expect(await owner.recheckImpact('maker',repeatCommand)).toEqual(repeated);
 await expect(owner.recheckImpact('maker',{...repeatCommand,reason:'CONFLICT'})).rejects.toThrow('REQUEST_CONFLICT');
});
async function splitInput(){
 const input=await freshRename(),id=input.predecessors[0]!.id;input.event.change_type='SPLIT';input.rename=null;input.successors=[f.department.entry(),f.department.entry()];input.contextEvidenceId=f.material.artifactId;
 Object.assign(input.impacts.find(i=>i.domain==='IDENTIFIER')!,{determination:'AFFECTED',requiredAction:'TEST explicit identifier end after evolution'});
 for(const entry of input.successors){entry.row.valid_from=input.event.effective_at;entry.row.established_on='2026-06-01';}
 input.relations=input.successors.map(next=>({succession_id:randomUUID(),org_event_id:input.event.org_event_id,from_target_type:'ORG',from_target_id:id,to_target_type:'ORG',to_target_id:next.row.org_id,transfer_scope:'BUSINESS',context_rule:'TEST POLICY ONLY approved explicit destination',recorded_at:input.event.recorded_at}));return input;
}
test('active identifiers require an affected declaration before evolution verification',async()=>{
 const input=await splitInput();input.impacts.find(i=>i.domain==='IDENTIFIER')!.determination='UNAFFECTED';
 await expect(owner.stage('maker',{...input,impacts:input.impacts.filter(i=>i.domain!=='IDENTIFIER')})).rejects.toThrow('CLOSED_INPUT_REQUIRED');
 const staged=await owner.stage('maker',input);
 await expect(verify(staged)).rejects.toThrow('IMPACT_DECLARATION_CONFLICT');
 expect((await owner.validate('maker',{inputId:staged.inputId})).issues).toContainEqual(expect.objectContaining({code:'IMPACT_DECLARATION_CONFLICT'}));
 const job=await f.newJob();input.jobId=job.id;input.revisionId=job.revisionId;input.requestId=randomUUID();input.impacts.find(i=>i.domain==='IDENTIFIER')!.determination='AFFECTED';
 const accepted=await owner.stage('maker',input);await verify(accepted);
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:accepted.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 expect((await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
});
test('a complete negative IDENTIFIER Owner review is recorded, withdraws the old approval, and allows a fresh approval',async()=>{
 const staged=await owner.stage('maker',await freshRename());await verify(staged);
 const oldRequestId=randomUUID(),oldCandidate=await owner.plan('maker',{inputId:staged.inputId,requestId:oldRequestId});
 await owner.readApplyCandidate('reviewer',{candidateId:oldCandidate.candidateId});await owner.approveApplyUnit('reviewer',oldCandidate);
 const impactReviews=structuredClone(f.impactReviews),identifier=impactReviews.find(review=>review.domain==='IDENTIFIER');
 if(!identifier)throw new Error('IDENTIFIER_REVIEW_REQUIRED');
 identifier.ownerAttestationAccepted=false;identifier.dispositionAccepted=false;identifier.reason='TEST explicit negative Identifier Owner review';
 const negative=await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST record complete negative Owner review',policyApproved:true,materialsAccepted:true,impactReviews});
 expect(negative.verificationId).toMatch(/^[a-f0-9-]{36}$/);
 await expect(owner.applyUnit('maker',{candidateId:oldCandidate.candidateId,requestId:oldRequestId})).rejects.toThrow('STALE_VALIDATION');
 expect(await owner.resumeOutcome('maker',{candidateId:oldCandidate.candidateId,requestId:oldRequestId})).toBeNull();
 await verify(staged);
 const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
 await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 expect((await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
});
test.each(['UNCHANGED','SEMANTIC','TARGET'] as const)('P2-06-AC-02 mapping shrink preserves original semantics (%s)',async(mode)=>{
 const changed=mode!=='UNCHANGED';
 const input=changed?await freshRename():await splitInput(),id=input.predecessors[0]!.id,mapping=openOrganizationMappings(connection,provider),department=openDepartment(connection,provider);
 const entry=f.entry();entry.row.target_id=id;
 if(mode==='TARGET')entry.row.valid_to='2026-06-03T00:00:00';
 const applyMapping=async(value:typeof entry)=>{
  const staged=await mapping.stage('maker',await f.mappingInput([value]));await mapping.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'TEST POLICY ONLY explicit mapping action',evidenceId:f.artifact.artifactId,contextApproved:true,sourceKeyReuse:false}]});
  const requestId=randomUUID(),candidate=await mapping.plan('maker',{inputId:staged.inputId,requestId});await mapping.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await mapping.approveApplyUnit('reviewer',candidate);const outcome=await mapping.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const resultId=outcome.facts[0]!.id,history=await mapping.history('maker',resultId);return {owner:'SOURCE_MAPPING' as const,id:resultId,versionId:history.versions.at(-1)!.id,candidateId:candidate.candidateId,requestId};
 };
 try{
  const original=await applyMapping(entry);
  const old=await mapping.history('maker',original.id);
  const denied=await owner.stage('maker',input);if(changed)await verify(denied);else await expect(verify(denied)).rejects.toThrow('IMPACT_DECLARATION_CONFLICT');
  if(!changed)expect((await owner.validate('maker',{inputId:denied.inputId})).issues).toContainEqual(expect.objectContaining({code:'IMPACT_DECLARATION_CONFLICT'}));
  const correctedJob=await f.newJob();input.jobId=correctedJob.id;input.revisionId=correctedJob.revisionId;input.requestId=randomUUID();
  input.impacts.find(i=>i.domain==='SOURCE_MAPPING')!.determination='AFFECTED';input.impacts.find(i=>i.domain==='SOURCE_MAPPING')!.requiredAction='Explicit shrink and final withdrawal';input.event.migration_plan_ref='TEST_PLAN';input.migrationEvidenceId=f.material.artifactId;
  const staged=await owner.stage('maker',input);await verify(staged);const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const committed=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(committed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  if(!changed)expect((await department.read('maker',{id,campus:'NORTH',businessAt:input.event.effective_at})).businessState).toBe('SUPERSEDED');expect((await mapping.history('maker',original.id)).versions).toEqual(old.versions);
  const item=(await owner.listImpactCases('maker',{eventId:committed.facts[0]!.id,campus:'NORTH'})).items.find(c=>c.obligation.kind==='REFERENCE'&&c.obligation.owner==='SOURCE_MAPPING'&&c.obligation.reference.versionId===original.versionId)!,r=await responsibility('ORG22');
  const assigned=await owner.assignImpactCase('maker',{caseId:item.id,campus:'NORTH',expectedHead:'0',requestId:randomUUID(),reason:'TEST_ASSIGN',responsibilityId:r.id});
  const shrink={...entry,action:'CORRECT' as const,mapping:{owner:'department-master/organization-mapping' as const,id:original.id,expectedHead:'1'},row:{...entry.row,valid_to:'2026-06-02T00:00:00'}};
  if(changed){
   if(mode==='SEMANTIC'){
    shrink.row.source_name='TEST changed meaning';
   }
   if(mode==='SEMANTIC'||mode==='TARGET'){
    await applyMapping({...shrink,row:{...shrink.row,valid_to:''}});
    shrink.mapping.expectedHead='2';
   }
   const changedProof=await applyMapping(shrink);
   await expect(owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',expectedHead:assigned.head,requestId:randomUUID(),reason:'TEST_MULTI_HOP_NOT_ORIGINAL_SEMANTICS',disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:changedProof}})).rejects.toThrow('IMPACT_RESULT_MISMATCH');
   return;
  }
  const proof=await applyMapping(shrink);
  const proposal=await owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',expectedHead:assigned.head,requestId:randomUUID(),reason:'TEST_PARTIAL_CLOSE',disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:proof}});
  const approved=await owner.approveDisposition('reviewer',{caseId:item.id,campus:'NORTH',expectedHead:proposal.head,proposalEventId:proposal.eventId,requestId:randomUUID(),reason:'TEST_APPROVE'});
  const partial=await owner.recheckImpact('maker',{caseId:item.id,campus:'NORTH',expectedHead:approved.head,requestId:randomUUID(),reason:'TEST_PARTIAL'});
  expect(partial.status).toBe('OPEN');expect(partial.remainingSpans).toEqual([{from:'2026-06-01T00:00:00.000000',to:'2026-06-02T00:00:00.000000'}]);
  const finalProof=await applyMapping({...shrink,action:'RETRACT',mapping:{...shrink.mapping,expectedHead:'2'}});
  const successor=(await owner.query('maker',{id:committed.facts[0]!.id,campus:'NORTH',businessAt:input.event.effective_at})).successors[0]!.id;f.grantTarget(successor);
  const nextEntry=f.entry();nextEntry.row.target_id=successor;nextEntry.row.valid_from=input.event.effective_at;nextEntry.row.valid_to='2026-06-02T00:00:00';
  const nextProof=await applyMapping(nextEntry);
  const transfer=await owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',expectedHead:partial.head,requestId:randomUUID(),reason:'TEST_PARTIAL_NEW_RELATION',disposition:{kind:'NEW_RELATION',evidenceId:f.material.artifactId,result:nextProof,oldRelation:{kind:'CLOSE',result:finalProof}}});
  const transferApproval=await owner.approveDisposition('reviewer',{caseId:item.id,campus:'NORTH',expectedHead:transfer.head,proposalEventId:transfer.eventId,requestId:randomUUID(),reason:'TEST_APPROVE_PARTIAL_NEW'});
  const gap=await owner.recheckImpact('maker',{caseId:item.id,campus:'NORTH',expectedHead:transferApproval.head,requestId:randomUUID(),reason:'TEST_NEW_RELATION_GAP'});
  expect(gap.status).toBe('OPEN');expect(gap.remainingSpans).toEqual([{from:'2026-06-02T00:00:00.000000',to:null}]);
  const completeProof=await applyMapping({...nextEntry,action:'CORRECT',mapping:{owner:'department-master/organization-mapping',id:nextProof.id,expectedHead:'1'},row:{...nextEntry.row,valid_to:''}});
  const endProposal=await owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',expectedHead:gap.head,requestId:randomUUID(),reason:'TEST_COMPLETE_NEW_RELATION',disposition:{kind:'NEW_RELATION',evidenceId:f.material.artifactId,result:completeProof,oldRelation:{kind:'CLOSE',result:finalProof}}});
  const endApproved=await owner.approveDisposition('reviewer',{caseId:item.id,campus:'NORTH',expectedHead:endProposal.head,proposalEventId:endProposal.eventId,requestId:randomUUID(),reason:'TEST_APPROVE'});
  expect((await owner.recheckImpact('maker',{caseId:item.id,campus:'NORTH',expectedHead:endApproved.head,requestId:randomUUID(),reason:'TEST_CLOSED'})).status).toBe('RESOLVED');
  // A semantic retarget is a new relationship, not a safe closure correction.
  const renamed=await f.input();renamed.predecessors=[{owner:'department-master',id:successor,expectedVersion:'1'}];renamed.relations[0]!.from_target_id=successor;renamed.relations[0]!.to_target_id=successor;
  const renameStage=await owner.stage('maker',renamed);await verify(renameStage);const renameRequest=randomUUID(),renamePlan=await owner.plan('maker',{inputId:renameStage.inputId,requestId:renameRequest});await owner.readApplyCandidate('reviewer',{candidateId:renamePlan.candidateId});await owner.approveApplyUnit('reviewer',renamePlan);const renameResult=await owner.applyUnit('maker',{candidateId:renamePlan.candidateId,requestId:renameRequest});if(renameResult.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const retargetCase=(await owner.listImpactCases('maker',{eventId:renameResult.facts[0]!.id,campus:'NORTH'})).items.find(c=>c.obligation.owner==='SOURCE_MAPPING')!;
  const retargetAssigned=await owner.assignImpactCase('maker',{caseId:retargetCase.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_RETARGET',expectedHead:'0',responsibilityId:r.id});
  const retarget=await applyMapping({...nextEntry,action:'CORRECT',mapping:{owner:'department-master/organization-mapping',id:nextProof.id,expectedHead:'2'},row:{...nextEntry.row,target_id:f.targetId,valid_to:''}});
  await expect(owner.recordDisposition('maker',{caseId:retargetCase.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_NOT_A_SAFE_SHRINK',expectedHead:retargetAssigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:retarget}})).rejects.toThrow('IMPACT_RESULT_MISMATCH');
 }finally{await mapping.close();await department.close();}
});
test.each([false,true])('identifier shrink preserves original accepted versions and permits direct shortening (%s)',async(changed)=>{
 const input=await freshRename(),aliases=openOrganizationIdentifiers(connection,provider),departmentId=input.predecessors[0]!.id;
 const initial=await f.identifierInput(departmentId,'2026-01-01T00:00:00'),entry=initial.entries[0]!;
 const commit=async(value:typeof entry)=>{
  const next=await f.identifierInput(departmentId,'2026-01-01T00:00:00');next.entries=[value];
  const staged=await aliases.stage('maker',next);await aliases.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'TEST exact alias meaning',evidenceId:value.evidenceId,policyApproved:true}]});
  const requestId=randomUUID(),candidate=await aliases.plan('maker',{inputId:staged.inputId,requestId});await aliases.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await aliases.approveApplyUnit('reviewer',candidate);
  const outcome=await aliases.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const id=outcome.facts[0]!.id,history=await aliases.history('maker',{id,campus:'NORTH'});return {owner:'IDENTIFIER' as const,id,versionId:history.versions.at(-1)!.id,candidateId:candidate.candidateId,requestId};
 };
 try{
  const original=await commit(entry),staged=await owner.stage('maker',input);await verify(staged);
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
  const outcome=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const item=(await owner.listImpactCases('maker',{eventId:outcome.facts[0]!.id,campus:'NORTH'})).items.find(c=>c.obligation.kind==='REFERENCE'&&c.obligation.reference.id===original.id)!,r=await responsibility('ORG23');
  const assigned=await owner.assignImpactCase('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST alias Owner',expectedHead:'0',responsibilityId:r.id});
  if(!changed){
   const proof=await commit({...entry,action:'CORRECT',identifier:{owner:'department-master/organization-identifier',id:original.id,expectedHead:'1'},row:{...entry.row,valid_to:input.event.effective_at}});
   const proposal=await owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST direct original-version shrink',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:proof}});
   const approved=await owner.approveDisposition('reviewer',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST approve safe shrink',expectedHead:proposal.head,proposalEventId:proposal.eventId});
   expect((await owner.recheckImpact('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST closed at boundary',expectedHead:approved.head})).status).toBe('RESOLVED');return;
  }
  const correction={...entry,action:'CORRECT' as const,identifier:{owner:'department-master/organization-identifier' as const,id:original.id,expectedHead:'1'},row:{...entry.row,identifier_value:'TEST changed alias'}};
  await commit(correction);
  const proof=await commit({...correction,identifier:{...correction.identifier,expectedHead:'2'},row:{...entry.row,valid_to:'2026-06-02T00:00:00'}});
  await expect(owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST original accepted versions required',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:proof}})).rejects.toThrow('IMPACT_RESULT_MISMATCH');
 }finally{await aliases.close();}
});
test.each(['TARGET','SOURCE'] as const)('frozen assessment and candidate reauthorize the exact current mapping %s',async(authority)=>{
 const input=await freshRename(),targetB=await f.newDepartment(),sourceB=await f.newSource(),mapping=openOrganizationMappings(connection,provider);
 f.grantTarget(targetB);
 const entry=f.entry();entry.row.target_id=input.predecessors[0]!.id;
 const commit=async(value:typeof entry)=>{
  const staged=await mapping.stage('maker',await f.mappingInput([value]));
  await mapping.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,rows:[{row:1,reason:'TEST precise current target',evidenceId:value.evidenceId,contextApproved:true,sourceKeyReuse:false}]});
  const requestId=randomUUID(),candidate=await mapping.plan('maker',{inputId:staged.inputId,requestId});
  await mapping.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await mapping.approveApplyUnit('reviewer',candidate);
  const result=await mapping.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return result.facts[0]!.id;
 };
 try{
  const id=await commit(entry);
  await commit({...entry,action:'CORRECT',mapping:{owner:'department-master/organization-mapping',id,expectedHead:'1'},row:{...entry.row,target_id:targetB}});
  if(authority==='SOURCE')await commit({...entry,action:'RETRACT',mapping:{owner:'department-master/organization-mapping',id,expectedHead:'2'},row:{...entry.row,target_id:targetB,source_system_id:sourceB.id}});
  const staged=await owner.stage('maker',input),assessment=await owner.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST freeze A and current B',target:{kind:'INPUT',id:staged.inputId}});
  expect(assessment.references.find(r=>r.owner==='SOURCE_MAPPING'&&r.id===id)?.currentTargetId).toBe(targetB);
  await verify(staged);const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});
  await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
  expect((await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
  const predicate=`actor_code IN ('maker','reviewer') AND object_id=${quote(sourceB.id)}::uuid AND permission='READ' AND purpose='SYNTHETIC_REFERENCE'`;
  const grants=authority==='SOURCE'?peer(receipt.name,`SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]')::text FROM vnext_control.object_grant g WHERE ${predicate};`):null;
  if(authority==='TARGET')peer(receipt.name,`DELETE FROM department_master.mapping_target_access WHERE target_id=${quote(targetB)}::uuid AND actor IN ('maker','reviewer');`);
  else peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE ${predicate};`);
  try{
   await expect(owner.readDepartmentAssessment('maker',{assessmentId:assessment.assessmentId,campus:'NORTH'})).rejects.toThrow('ACCESS_DENIED');
   await expect(owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId})).rejects.toThrow('ACCESS_DENIED');
   await expect(owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('ACCESS_DENIED');
   await expect(owner.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId})).rejects.toThrow('ACCESS_DENIED');
  }finally{if(authority==='TARGET')f.grantTarget(targetB);else peer(receipt.name,`INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants!)}::jsonb) ON CONFLICT DO NOTHING;`);}
  expect((await owner.readDepartmentAssessment('maker',{assessmentId:assessment.assessmentId,campus:'NORTH'})).assessmentId).toBe(assessment.assessmentId);
  expect((await owner.resumeOutcome('maker',{candidateId:candidate.candidateId,requestId}))?.status).toBe('COMMITTED');
 }finally{await mapping.close();}
});
test.each([true,false])('P2-06-AC-04 real HTTP requires external Owner authority and matching signatory (%s)',async(matching)=>{
 const input=await freshRename(),impact=input.impacts.find(i=>i.domain==='CONSUMER')!;
 impact.ownerRole='SYNTHETIC_OWNER_A';impact.ownerSignatory=matching?'SYNTHETIC_REVIEWER':'TEST_DIFFERENT_SIGNATORY';
 impact.determination='AFFECTED';impact.requiredAction='TEST POLICY ONLY two independent consumer acknowledgements';input.event.migration_plan_ref='TEST_CONSUMER_PLAN';input.migrationEvidenceId=f.material.artifactId;
 const staged=await owner.stage('maker',input);await verify(staged);const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const applied=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(applied.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const item=(await owner.listImpactCases('maker',{eventId:applied.facts[0]!.id,campus:'NORTH'})).items.find(c=>c.obligation.owner==='CONSUMER')!,r=await responsibility('ORG26');
 peer(receipt.name,"INSERT INTO vnext_control.actor(code,identity_code,active,principal_kind) VALUES('impact-consumer-a','SYNTHETIC_CONSUMER_A',true,'SERVICE'),('impact-consumer-b','SYNTHETIC_CONSUMER_B',true,'SERVICE') ON CONFLICT DO NOTHING;INSERT INTO vnext_control.actor_grant SELECT a,'SYNTHETIC',p FROM unnest(ARRAY['impact-consumer-a','impact-consumer-b']) a CROSS JOIN unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;");
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0});
  const post=async(who:string,path:string,body:unknown)=>{const response=await fetch(url+'/api/vnext/department-impacts/'+path,{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':who},body:JSON.stringify(body)});const data=await response.json();return {status:response.status,data};};
  if(matching)expect((await post('maker','assign',{caseId:item.id,campus:'NORTH',reason:'TEST Department is not Consumer Owner',requestId:randomUUID(),expectedHead:'0',responsibilityId:r.id})).status).toBe(403);
  peer(receipt.name,`INSERT INTO department_master.impact_external_owner_access VALUES('maker','CONSUMER','NORTH','WRITE','SYNTHETIC_OWNER_A',${quote(r.versionId!)}::uuid) ON CONFLICT DO NOTHING;`);
  const base={caseId:item.id,campus:'NORTH',reason:'TEST_ONLY'},assigned=await post('maker','assign',{...base,requestId:randomUUID(),expectedHead:'0',responsibilityId:r.id});expect(assigned.status).toBe(200);
  const proposal=await post('maker','dispositions',{...base,requestId:randomUUID(),expectedHead:assigned.data.head,disposition:{kind:'MIGRATE_EXTERNAL',evidenceId:f.material.artifactId,consumers:['impact-consumer-a','impact-consumer-b']}});expect(proposal.status).toBe(200);
  expect((await post('reviewer','dispositions/approve',{...base,requestId:randomUUID(),expectedHead:proposal.data.head,proposalEventId:proposal.data.eventId})).status).toBe(403);
  peer(receipt.name,`INSERT INTO department_master.impact_external_owner_access VALUES('reviewer','CONSUMER','NORTH','REVIEW','SYNTHETIC_OWNER_A',${quote(r.versionId!)}::uuid) ON CONFLICT DO NOTHING;`);
  expect((await post('impact-consumer-a','dispositions/approve',{...base,requestId:randomUUID(),expectedHead:proposal.data.head,proposalEventId:proposal.data.eventId})).status).toBe(403);
  const approved=await post('reviewer','dispositions/approve',{...base,requestId:randomUUID(),expectedHead:proposal.data.head,proposalEventId:proposal.data.eventId});
  if(!matching){expect(approved.status).toBe(403);return;}expect(approved.status).toBe(200);
  const first=await post('impact-consumer-a','receipts',{...base,requestId:randomUUID(),expectedHead:approved.data.head,proposalEventId:proposal.data.eventId,consumerActor:'impact-consumer-a',outcome:'SIMULATED_COMPLETED',receiptRef:'TEST_A_ACK',simulated:true});expect(first.status).toBe(200);
  const checked=await post('maker','recheck',{...base,requestId:randomUUID(),expectedHead:first.data.head});expect(checked.status).toBe(200);expect(checked.data.status).toBe('OPEN');
  const detail=await post('maker','cases/read',{caseId:item.id,campus:'NORTH'});expect(detail.status).toBe(200);expect(detail.data.handoffs).toContainEqual({consumerActor:'impact-consumer-b',proposalEventId:proposal.data.eventId,status:'PENDING',simulated:true});
  const wrong=await post('impact-consumer-a','receipts',{...base,requestId:randomUUID(),expectedHead:checked.data.head,proposalEventId:proposal.data.eventId,consumerActor:'impact-consumer-b',outcome:'SIMULATED_COMPLETED',receiptRef:'TEST_WRONG',simulated:true});expect(wrong.status).toBe(403);
  let head=checked.data.head;
  for(const outcome of ['FAILED','PARTIAL']){
   const receiptCommand={...base,requestId:randomUUID(),expectedHead:head,proposalEventId:proposal.data.eventId,consumerActor:'impact-consumer-b',outcome,receiptRef:'TEST_B_'+outcome,simulated:true};
   const received=await post('impact-consumer-b','receipts',receiptCommand);expect(received.status).toBe(200);
   expect((await post('impact-consumer-b','receipts',receiptCommand)).data).toEqual(received.data);
   expect((await post('impact-consumer-b','receipts',{...receiptCommand,receiptRef:'CONFLICT'})).status).toBe(409);
   const pending=await post('maker','recheck',{...base,requestId:randomUUID(),expectedHead:received.data.head});expect(pending.data.status).toBe('OPEN');head=pending.data.head;
  }
  expect((await post('impact-consumer-b','receipts',{...base,requestId:randomUUID(),expectedHead:'0',proposalEventId:proposal.data.eventId,consumerActor:'impact-consumer-b',outcome:'SIMULATED_COMPLETED',receiptRef:'STALE',simulated:true})).status).toBe(409);
  const second=await post('impact-consumer-b','receipts',{...base,requestId:randomUUID(),expectedHead:head,proposalEventId:proposal.data.eventId,consumerActor:'impact-consumer-b',outcome:'SIMULATED_COMPLETED',receiptRef:'TEST_B_ACK',simulated:true});expect(second.status).toBe(200);
  const complete=await post('maker','recheck',{...base,requestId:randomUUID(),expectedHead:second.data.head});expect(complete.status).toBe(200);expect(complete.data.status).toBe('SIMULATED_COMPLETED');
 }finally{await app.close();}
});
test('an independently read exact assessment can be selected for evolution verification',async()=>{
 const input=await freshRename(),staged=await owner.stage('maker',input),assessment=await owner.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST_EXACT_REVIEW',target:{kind:'INPUT',id:staged.inputId}});
 await owner.verify('reviewer',{requestId:randomUUID(),inputId:staged.inputId,inputDigest:staged.digest,reason:'TEST_EXACT_MATERIALS',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews,impactAssessment:{id:assessment.assessmentId,digest:assessment.dependencyDigest}});
 expect((await owner.validate('maker',{inputId:staged.inputId})).decision).toBe('PASS');
});

test('impact reads and replay recheck exact source and material access; direct app-role writes fail',async()=>{
 const {eventId}=await applyRename(),command={requestId:randomUUID(),reason:'TEST_ACCESS',target:{kind:'EVENT' as const,id:eventId,campus:'NORTH' as const}};
 const assessment=await owner.assessDepartmentChange('maker',command);
 await expect(owner.listImpactCases('outsider',{eventId,campus:'NORTH'})).rejects.toThrow('ACCESS_DENIED');
 const pool=new Pool({connectionString:connection,max:1});
 try{
  await expect(pool.query('DELETE FROM governance_catalog.department_impact_case')).rejects.toThrow('permission denied');
  await expect(pool.query('SELECT * FROM department_master.impact_external_owner_access')).rejects.toThrow('permission denied');
  await expect(pool.query('SELECT governance_catalog.department_impact_record($1,$2)',['{}','0'.repeat(64)])).rejects.toThrow('ACCESS_DENIED');
 }finally{await pool.end();}
 peer(receipt.name,"DELETE FROM department_master.identifier_access WHERE actor='maker' AND scheme='SYNTHETIC_DEPARTMENT_CODE' AND campus='NORTH' AND permission='READ';");
 try{await expect(owner.assessDepartmentChange('maker',command)).rejects.toThrow('ACCESS_DENIED');await expect(owner.readDepartmentAssessment('maker',{assessmentId:assessment.assessmentId,campus:'NORTH'})).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,"INSERT INTO department_master.identifier_access VALUES('maker','SYNTHETIC_DEPARTMENT_CODE','NORTH','READ');");}
 expect(await owner.assessDepartmentChange('maker',command)).toEqual(assessment);
 peer(receipt.name,`DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(f.eventDataset.id)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`);
 try{await expect(owner.assessDepartmentChange('maker',command)).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,`INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(f.eventDataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ');`);}
});

test.each([
 ['impact case','governance_catalog.department_impact_case','true'],
 ['audit','vnext_control.audit',"NEW.action='EVOLUTION_APPLY'"],
 ['outcome','governance_catalog.apply_commit','true'],
] as const)('failure at %s rolls back evolution and every impact obligation',async(_label,table,condition)=>{
 const input=await freshRename(),staged=await owner.stage('maker',input);await verify(staged);const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const tables=['department_master.evolution_event','department_master.version','governance_catalog.department_impact_case','governance_catalog.department_impact_case_event','governance_catalog.apply_commit'];
 const state=()=>peer(receipt.name,`SELECT jsonb_build_array(${tables.map(t=>`(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]') FROM ${t} r)`).join(',')})::text`);
 const before=state(),command={candidateId:candidate.candidateId,requestId};
 peer(receipt.name,`CREATE FUNCTION department_master.p2_06_fault() RETURNS trigger LANGUAGE plpgsql AS $fault$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'P2_06_INJECTED_FAILURE';END IF;RETURN NEW;END $fault$;CREATE TRIGGER p2_06_fault BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION department_master.p2_06_fault();`);
 try{await expect(owner.applyUnit('maker',command)).rejects.toThrow('APPLY_FAILED');expect(state()).toBe(before);expect(await owner.resumeOutcome('maker',command)).toBeNull();}
 finally{peer(receipt.name,`DROP TRIGGER p2_06_fault ON ${table};DROP FUNCTION department_master.p2_06_fault();`);}
 const committed=await owner.applyUnit('maker',command);expect(committed.status).toBe('COMMITTED');if(committed.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const {responseStatus:_,...stored}=committed;expect(await owner.resumeOutcome('maker',command)).toEqual(stored);expect(await owner.applyUnit('maker',command)).toEqual(committed);
});

test('two concurrent case assignments share one expected head and admit one write',async()=>{
 const {eventId}=await applyRename(),item=(await owner.listImpactCases('maker',{eventId,campus:'NORTH'})).items[0]!,r=await responsibility('ORG23');
 const command={caseId:item.id,campus:'NORTH' as const,expectedHead:'0',reason:'TEST_CONCURRENT',responsibilityId:r.id};
 const results=await Promise.allSettled([owner.assignImpactCase('maker',{...command,requestId:randomUUID()}),owner.assignImpactCase('maker',{...command,requestId:randomUUID()})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await owner.readImpactCase('maker',{caseId:item.id,campus:'NORTH'})).history).toHaveLength(1);
});
test('hierarchy snapshots include owner Department dependencies without changing frozen versions',async()=>{
 const input=await freshRename(),id=input.predecessors[0]!.id,nodeId=await f.newDepartment(),hierarchy=openHierarchy(connection,provider),department=openDepartment(connection,provider);
 try{
  const exact=await department.exact('maker',{id:nodeId,version:'1'}),header={requestId:randomUUID(),sourceClientKey:randomUUID(),viewCode:'STAT_'+randomUUID(),viewName:'TEST owner source snapshot',viewType:'STATISTICAL' as const,purpose:'TEST_POLICY_ONLY',aggregationRule:'FROZEN_SOURCE',ownerDepartmentId:id,sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG05/SOURCE',sourceVersion:'1',validFrom:'2026-01-01T00:00:00',validTo:null,recordedAt:'2026-01-01T00:00:00',approvalRef:'TEST_APPROVAL'};
  const view=await hierarchy.createHierarchyView('maker',header);peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',${quote(view.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
  const candidate:HierarchyCandidateInput={...header,requestId:randomUUID(),viewId:view.viewId,parentCardinality:'STRICT_TREE',recordStatus:'ACTIVE',nodes:[{nodeKey:'root',parentNodeKey:null,nodeKind:'DEPARTMENT',departmentId:nodeId,departmentVersionId:exact.versionId,displayName:'TEST frozen statistical label',relationName:'TEST',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:randomUUID(),sourceVersion:'1',sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG06/SOURCE',validFrom:header.validFrom,validTo:null,recordedAt:header.recordedAt,recordStatus:'ACTIVE',approvalRef:'TEST_APPROVAL'}}]};
  const hc=await hierarchy.importHierarchyCandidate('maker',candidate);if(!hc.candidateId)throw new Error('NOT_STAGED');await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:hc.candidateId,digest:hc.digest});const frozen=await hierarchy.publishHierarchySnapshot('maker',{candidateId:hc.candidateId,digest:hc.digest,requestId:candidate.requestId});
  const staged=await owner.stage('maker',input),assessment=await owner.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST_HEADER_REFERENCE',target:{kind:'INPUT',id:staged.inputId}});
  expect(assessment.references).toContainEqual(expect.objectContaining({owner:'HIERARCHY',id:view.viewId,departmentId:id,referenceRole:'OWNER',change:'CHANGED',constraint:'SATISFIED'}));
  await verify(staged);const requestId=randomUUID(),ep=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:ep.candidateId});await owner.approveApplyUnit('reviewer',ep);expect((await owner.applyUnit('maker',{candidateId:ep.candidateId,requestId})).status).toBe('COMMITTED');
  expect(await hierarchy.readHierarchySnapshot('maker',{viewId:view.viewId,version:frozen.view.version})).toEqual(frozen);
 }finally{await hierarchy.close();await department.close();}
});

test.each(['CLOSE','REVOKE','SHRINK','CHANGED_TREE','DUPLICATE'] as const)('hierarchy disposition uses current %s state and its exact version',async(action)=>{
 const input=action==='CHANGED_TREE'?await freshRename():await splitInput(),department=openDepartment(connection,provider),hierarchy=openHierarchy(connection,provider);
 const publish=async(departmentId:string,from:string)=>{
  const exact=await department.exact('maker',{id:departmentId,version:'1'});
  const candidate:HierarchyCandidateInput={requestId:randomUUID(),viewId:null,sourceClientKey:randomUUID(),viewCode:'TEST_'+randomUUID(),viewName:'TEST explicit relationship',viewType:'ADMINISTRATIVE',parentCardinality:'STRICT_TREE',purpose:'TEST_POLICY_ONLY',aggregationRule:'NONE',ownerDepartmentId:departmentId,sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG05',sourceVersion:'1',validFrom:from,validTo:null,recordedAt:from,recordStatus:'ACTIVE',approvalRef:'TEST_APPROVAL',nodes:[{nodeKey:'root',parentNodeKey:null,nodeKind:'DEPARTMENT',departmentId,departmentVersionId:exact.versionId,displayName:'TEST frozen',relationName:'TEST',sortOrder:0,isPrimaryPath:true,sourceEvidence:{sourceClientKey:randomUUID(),sourceVersion:'1',sourceSystemId:f.source.id,sourceRecordId:'TEST/ORG06',validFrom:from,validTo:null,recordedAt:from,recordStatus:'ACTIVE',approvalRef:'TEST_APPROVAL'}}]};
  const {viewId:_,parentCardinality:__,recordStatus:___,nodes:____,...header}=candidate;
  const view=await hierarchy.createHierarchyView('maker',{...header,requestId:randomUUID()});candidate.viewId=view.viewId;
  const staged=await hierarchy.importHierarchyCandidate('maker',candidate);if(!staged.candidateId)throw new Error('NOT_STAGED');peer(receipt.name,`INSERT INTO department_master.hierarchy_grant SELECT 'reviewer',${quote(view.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p ON CONFLICT DO NOTHING;`);
  await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:staged.candidateId,digest:staged.digest});const snapshot=await hierarchy.publishHierarchySnapshot('maker',{candidateId:staged.candidateId,digest:staged.digest,requestId:candidate.requestId});
  return {candidate,snapshot,proof:{owner:'HIERARCHY' as const,id:snapshot.view.id,versionId:snapshot.view.versionId,candidateId:staged.candidateId,requestId:candidate.requestId}};
 };
 const close=async(view:Awaited<ReturnType<typeof publish>>,action:'CLOSE'|'REVOKE')=>{
  const command={requestId:randomUUID(),viewId:view.snapshot.view.id,expectedVersion:view.snapshot.view.version,action,reason:'TEST_OWNER_CLOSURE'},candidate=await hierarchy.prepareHierarchyClosure('maker',command);await hierarchy.approveHierarchyCandidate('reviewer',candidate);await hierarchy.closeHierarchyView('maker',{...candidate,requestId:command.requestId});return {...view.proof,candidateId:candidate.candidateId,requestId:command.requestId};
 };
 try{
  const original=await publish(input.predecessors[0]!.id,'2026-01-01T00:00:00');Object.assign(input.impacts.find(i=>i.domain==='HIERARCHY')!,{determination:'AFFECTED',requiredAction:'TEST explicit replacement view with separate closure'});
  let repeated:typeof original.proof|undefined;
  if(action==='DUPLICATE'){
   const sameContent={...original.candidate,requestId:randomUUID()},second=await hierarchy.importHierarchyCandidate('maker',sameContent);if(!second.candidateId)throw new Error('NOT_STAGED');
   await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:second.candidateId,digest:second.digest});
   const published=await hierarchy.publishHierarchySnapshot('maker',{candidateId:second.candidateId,digest:second.digest,requestId:sameContent.requestId});
   repeated={...original.proof,candidateId:second.candidateId,requestId:sameContent.requestId,versionId:published.view.versionId};
  }
  const staged=await owner.stage('maker',input);await verify(staged);const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const applied=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(applied.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const eventId=applied.facts[0]!.id,successor=(await owner.query('maker',{id:eventId,campus:'NORTH',businessAt:input.event.effective_at})).successors[0]!.id;f.grantTarget(successor);
  if(action==='DUPLICATE'){
   if(!repeated)throw new Error('REPEATED_PUBLICATION_REQUIRED');
   const item=(await owner.listImpactCases('maker',{eventId,campus:'NORTH'})).items.find(i=>i.obligation.kind==='REFERENCE'&&i.obligation.owner==='HIERARCHY'&&i.obligation.reference.versionId===repeated!.versionId)!,r=await responsibility('ORG05');
   const assigned=await owner.assignImpactCase('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST exact publication',expectedHead:'0',responsibilityId:r.id});
   const command={caseId:item.id,campus:'NORTH' as const,requestId:randomUUID(),reason:'TEST same contents are not the same candidate',expectedHead:assigned.head};
   await expect(owner.recordDisposition('maker',{...command,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:{...original.proof,versionId:repeated.versionId}}})).rejects.toThrow('IMPACT_RESULT_MISMATCH');
   expect((await owner.recordDisposition('maker',{...command,requestId:randomUUID(),disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:repeated}})).kind).toBe('PROPOSE');return;
  }
  if(action==='SHRINK'||action==='CHANGED_TREE'){
   if(action==='CHANGED_TREE'){
    original.candidate.nodes[0]!.displayName='TEST changed frozen tree';
    original.candidate.validFrom=input.event.effective_at;
    const changedNode=original.candidate.nodes[0]!;if(changedNode.nodeKind!=='DEPARTMENT')throw new Error('DEPARTMENT_REQUIRED');
    changedNode.departmentVersionId=(await department.exact('maker',{id:input.predecessors[0]!.id,version:'2'})).versionId;
    original.candidate.nodes[0]!.sourceEvidence.validFrom=input.event.effective_at;
    const changed={...original.candidate,requestId:randomUUID()},middle=await hierarchy.importHierarchyCandidate('maker',changed);
    if(!middle.candidateId)throw new Error('NOT_STAGED');
    await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:middle.candidateId,digest:middle.digest});
    await hierarchy.publishHierarchySnapshot('maker',{candidateId:middle.candidateId,digest:middle.digest,requestId:changed.requestId});
   }
   const until=action==='CHANGED_TREE'?'2026-06-02T00:00:00':input.event.effective_at;
   const value={...original.candidate,requestId:randomUUID(),validTo:until,nodes:original.candidate.nodes.map(node=>({...node,sourceEvidence:{...node.sourceEvidence,validTo:until}}))};
   const staged=await hierarchy.importHierarchyCandidate('maker',value);if(!staged.candidateId)throw new Error('NOT_STAGED');await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:staged.candidateId,digest:staged.digest});const shrunk=await hierarchy.publishHierarchySnapshot('maker',{candidateId:staged.candidateId,digest:staged.digest,requestId:value.requestId});
   const item=(await owner.listImpactCases('maker',{eventId,campus:'NORTH'})).items.find(i=>i.obligation.owner==='HIERARCHY')!,r=await responsibility('ORG05'),assigned=await owner.assignImpactCase('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_SHRINK',expectedHead:'0',responsibilityId:r.id});
   if(action==='CHANGED_TREE'){
    await expect(owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_CHANGED_TREE_IS_NOT_SAFE_SHRINK',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:{...original.proof,versionId:shrunk.view.versionId,candidateId:staged.candidateId,requestId:value.requestId}}})).rejects.toThrow('IMPACT_RESULT_MISMATCH');return;
   }
   const proposal=await owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_SAFE_SHRINK',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:{...original.proof,versionId:shrunk.view.versionId,candidateId:staged.candidateId,requestId:value.requestId}}});
   const approved=await owner.approveDisposition('reviewer',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_REVIEW',expectedHead:proposal.head,proposalEventId:proposal.eventId});
   expect((await owner.recheckImpact('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_RECHECK_SAFE_SHRINK',expectedHead:approved.head})).status).toBe('RESOLVED');return;
  }
  const replacement=await publish(successor,input.event.effective_at),oldProof=await close(original,'CLOSE');
  const item=(await owner.listImpactCases('maker',{eventId,campus:'NORTH'})).items.find(i=>i.obligation.owner==='HIERARCHY')!,r=await responsibility('ORG05'),assigned=await owner.assignImpactCase('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_OWNER',expectedHead:'0',responsibilityId:r.id});
  await expect(owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_PUBLICATION_CANNOT_PROVE_CLOSURE',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.material.artifactId,result:original.proof}})).rejects.toThrow('IMPACT_RESULT_MISMATCH');
  const proposed=await owner.recordDisposition('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_NEW_RELATION',expectedHead:assigned.head,disposition:{kind:'NEW_RELATION',evidenceId:f.material.artifactId,result:replacement.proof,oldRelation:{kind:'CLOSE',result:oldProof}}});
  const approved=await owner.approveDisposition('reviewer',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_REVIEW',expectedHead:proposed.head,proposalEventId:proposed.eventId});
  await close(replacement,action);
  await expect(owner.recheckImpact('maker',{caseId:item.id,campus:'NORTH',requestId:randomUUID(),reason:'TEST_RECHECK_CLOSED_REPLACEMENT',expectedHead:approved.head})).rejects.toThrow('IMPACT_RESULT_MISMATCH');
 }finally{await department.close();await hierarchy.close();}
});

async function independentlyClosedReference(){
 const {eventId}=await applyRename(),item=(await owner.listImpactCases('maker',{eventId,campus:'NORTH'})).items.find(c=>c.obligation.owner==='IDENTIFIER')!,r=await responsibility('ORG23');
 peer(receipt.name,"INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH',p FROM unnest(ARRAY['maker','reviewer']) a CROSS JOIN unnest(ARRAY['WRITE','REVIEW']) p ON CONFLICT DO NOTHING;");
 const base={caseId:item.id,campus:'NORTH' as const,reason:'TEST independent terminal case'};
 const assigned=await owner.assignImpactCase('maker',{...base,requestId:randomUUID(),expectedHead:'0',responsibilityId:r.id});
 const proposal=await owner.recordDisposition('maker',{...base,requestId:randomUUID(),expectedHead:assigned.head,disposition:{kind:'KEEP_HISTORY',evidenceId:f.material.artifactId}});
 const approve={...base,requestId:randomUUID(),expectedHead:proposal.head,proposalEventId:proposal.eventId},approved=await owner.approveDisposition('reviewer',approve);
 const closed=await owner.recheckImpact('maker',{...base,requestId:randomUUID(),expectedHead:approved.head});expect(closed.status).toBe('RESOLVED');
 return {base,approve,approved,closed};
}
test('independent review: a new approval cannot reopen a resolved case, but the accepted request replays',async()=>{
 const {base,approve,approved,closed}=await independentlyClosedReference();
 const before=await owner.readImpactCase('maker',{caseId:base.caseId,campus:base.campus});
 expect(await owner.approveDisposition('reviewer',approve)).toEqual(approved);
 await expect(owner.approveDisposition('reviewer',{...approve,requestId:randomUUID(),expectedHead:closed.head})).rejects.toThrow('DISPOSITION_ALREADY_COMPLETE');
 expect(await owner.readImpactCase('maker',{caseId:base.caseId,campus:base.campus})).toEqual(before);
});

test.each(['APPROVE','RECEIPT'] as const)('independent review: completed synthetic handoff rejects a new %s over HTTP',async(operation)=>{
 const input=await freshRename(),r=await responsibility('ORG26');
 Object.assign(input.impacts.find(i=>i.domain==='CONSUMER')!,{determination:'AFFECTED',requiredAction:'TEST synthetic handoff',ownerRole:'SYNTHETIC_OWNER_A',ownerSignatory:'SYNTHETIC_REVIEWER'});input.event.migration_plan_ref='TEST';input.migrationEvidenceId=f.material.artifactId;
 const staged=await owner.stage('maker',input);await verify(staged);const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:staged.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);
 const applied=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(applied.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const item=(await owner.listImpactCases('maker',{eventId:applied.facts[0]!.id,campus:'NORTH'})).items.find(c=>c.obligation.owner==='CONSUMER')!;
 peer(receipt.name,`INSERT INTO department_master.impact_external_owner_access VALUES('maker','CONSUMER','NORTH','WRITE','SYNTHETIC_OWNER_A',${quote(r.versionId!)}::uuid),('reviewer','CONSUMER','NORTH','REVIEW','SYNTHETIC_OWNER_A',${quote(r.versionId!)}::uuid) ON CONFLICT DO NOTHING;INSERT INTO vnext_control.actor(code,identity_code,active,principal_kind) VALUES('impact-consumer-a','SYNTHETIC_CONSUMER_A',true,'SERVICE') ON CONFLICT DO NOTHING;INSERT INTO vnext_control.actor_grant SELECT 'impact-consumer-a','SYNTHETIC',p FROM unnest(ARRAY['READ','WRITE']) p ON CONFLICT DO NOTHING;`);
 const base={caseId:item.id,campus:'NORTH' as const,reason:'TEST terminal preservation'},read={caseId:item.id,campus:'NORTH' as const};
 const assigned=await owner.assignImpactCase('maker',{...base,requestId:randomUUID(),expectedHead:'0',responsibilityId:r.id});
 const proposal=await owner.recordDisposition('maker',{...base,requestId:randomUUID(),expectedHead:assigned.head,disposition:{kind:'MIGRATE_EXTERNAL',evidenceId:f.material.artifactId,consumers:['impact-consumer-a']}});
 const approve={...base,requestId:randomUUID(),expectedHead:proposal.head,proposalEventId:proposal.eventId},approved=await owner.approveDisposition('reviewer',approve);
 const receiptCommand={...base,requestId:randomUUID(),expectedHead:approved.head,proposalEventId:proposal.eventId,consumerActor:'impact-consumer-a',outcome:'SIMULATED_COMPLETED' as const,receiptRef:'TEST synthetic completion',simulated:true as const};
 const received=await owner.recordMigrationReceipt('impact-consumer-a',receiptCommand),closed=await owner.recheckImpact('maker',{...base,requestId:randomUUID(),expectedHead:received.head});expect(closed.status).toBe('SIMULATED_COMPLETED');
 const before=await owner.readImpactCase('maker',read);
 expect(await owner.recordMigrationReceipt('impact-consumer-a',receiptCommand)).toEqual(received);
 expect(await owner.approveDisposition('reviewer',approve)).toEqual(approved);
 const app=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner,actor:r=>actor(r.headers)});
 try{
  const url=await app.listen({host:'127.0.0.1',port:0}),command=operation==='APPROVE'?approve:receiptCommand;
  const response=await fetch(url+'/api/vnext/department-impacts/'+(operation==='APPROVE'?'dispositions/approve':'receipts'),{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':operation==='APPROVE'?'reviewer':'impact-consumer-a'},body:JSON.stringify({...command,requestId:randomUUID(),expectedHead:closed.head})});
  expect({status:response.status,data:await response.json()}).toMatchObject({status:409,data:{code:'DISPOSITION_ALREADY_COMPLETE'}});
  expect(await owner.readImpactCase('maker',read)).toEqual(before);
 }finally{await app.close();}
});

test('independent review: contract publication does not invalidate closed impact history or accepted command replay',async()=>{
 const {base,approve,approved}=await independentlyClosedReference(),read={caseId:base.caseId,campus:base.campus};
 const before=await owner.readImpactCase('maker',read),current=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.id===f.eventContract.id)!;
 const cmd=<A extends string>(action:A,extra:Record<string,unknown>)=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'TEST_LATER_CONTRACT_VERSION',...extra});
 const draft=await catalog.contractCommand('maker',cmd('REVISE',{target:current.id,expectedHead:current.head,datasetVersionId:current.datasetVersionId,definition:{...current.definition,ruleVersion:'ORG_EVOLUTION_REVIEW_2'},validFrom:'2026-01-01T00:00:00',validTo:null}));
 const accepted=await catalog.contractCommand('reviewer',cmd('APPROVE',{target:draft.id,expectedHead:draft.head,reviewDigest:draft.reviewDigest})),impact=await catalog.contractImpact('reviewer','SYNTHETIC',draft.id,'PUBLISH');
 await catalog.contractCommand('reviewer',cmd('PUBLISH',{target:draft.id,expectedHead:accepted.head,reviewDigest:accepted.reviewDigest,impactDigest:impact.impactDigest}));
 expect(await owner.readImpactCase('maker',read)).toEqual(before);
 expect(await owner.approveDisposition('reviewer',approve)).toEqual(approved);
});
