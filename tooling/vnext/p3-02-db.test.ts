import {test,expect,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {Pool,Client,type QueryConfig} from 'pg';
import {randomUUID,createHmac} from 'node:crypto';
import {openCatalog,canonicalPlan,planBinding,LocalSyntheticKeyProvider} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-02-validation-keys.mjs';
import {wardFixture} from './p3-02-fixture.js';
import type {WardEntry,WardBindingInput} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {ORG08_FIELDS,openWard,type WardReceive} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {wardUpstreamPorts} from '../../apps/governance-api/src/composition/ward-dependencies.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createWardClient} from '../../packages/generated-api-client/src/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
import {openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.js';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {withCareOrganizationImpacts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {peer,quote} from './lineage.mjs';
import {assertWardProvisioned} from './p3-02-provisioning.mjs';
import {evolutionFixture} from './p2-05-fixture.js';
import {organizationMappingFixture} from './p2-03-fixture.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),provider=validationKeys(receipt),catalog=await openCatalog(connection,provider);
const p=new Pool({connectionString:connection,max:1}),role=(await p.query('select current_user r')).rows[0].r;await p.end();
const f=await wardFixture(receipt,role,catalog,provider,connection,process.env['VNEXT_P3_02_POPULATED']==='1');
let evolutionProtocolPromise:Promise<Awaited<ReturnType<typeof evolutionFixture>>>|undefined;
const evolutionProtocol=()=>evolutionProtocolPromise??=organizationMappingFixture(receipt,catalog,provider,connection,undefined,f.dep).then(base=>evolutionFixture(receipt,catalog,provider,connection,base));
afterAll(async()=>{await f.close();await catalog.close();});
test('published Ward CORE retains all source fields and a real admitted management Unit',async()=>{
 const b=await f.endpoint(),entry=f.entry(b),v=await f.input([entry]),outcome=await f.apply(v),id=outcome.facts[0]!.id;
 expect(id).not.toBe(entry.row.ward_id);
 expect(await f.owner.read('maker',{id,businessAt:'2026-04-01T00:00:00'})).toMatchObject({id,campusId:b.campus.id,state:'ACTIVE',clinicalReadiness:'NOT_READY',version:{facts:{wardType:'TEST 普通病区',publicPhone:null,admissionRuleReference:null}}});
 expect((await f.owner.history('maker',{id})).bindings[0]).toMatchObject({managingUnitId:b.unit.id});
 expect(await f.owner.evaluateWindow('maker',{id,validFrom:'2026-02-01T00:00:00',validTo:null})).toMatchObject({coreCovered:true,checks:[{status:'SATISFIED'}]});
});
test('a revision cannot replace the permanent source alias of an existing Ward',async()=>{
 const b=await f.endpoint(),entry=f.entry(b),outcome=await f.apply(await f.input([entry]));
 const changed={...entry.row,ward_id:randomUUID(),valid_from:'2026-03-01T00:00:00'};
 await expect(f.prepare(await f.input([{action:'REVISE',target:{owner:'care-organization/ward',id:outcome.facts[0]!.id,expectedHead:'1'},row:changed,reason:'TEST altered source alias',evidenceId:f.artifact.artifactId}]))).rejects.toThrow('WARD_SOURCE_IDENTITY_MISMATCH');
});
const populated=async()=>{const binding=await f.endpoint(),entry=f.entry(binding),request=await f.prepare(await f.input([entry])),outcome=await f.owner.applyUnit('maker',request);if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');return {binding,d:(await f.base.owner.history('maker',{id:binding.unit.id})).departmentId,entry,request,h:await f.owner.history('maker',{id:outcome.facts[0]!.id})};};
const revise=(a:Awaited<ReturnType<typeof populated>>,action:'REVISE'|'CLOSE',from:string):WardEntry=>({action,target:{owner:'care-organization/ward',id:a.h.id,expectedHead:a.h.versions.at(-1)!.number},row:{...a.entry.row,valid_from:from,record_status:action==='CLOSE'?'RETIRED':'ACTIVE'},reason:'TEST approved '+action,evidenceId:f.artifact.artifactId});
async function managerInSameCampus(b:WardBindingInput){
 const old=await f.base.owner.history('maker',{id:b.unit.id}),anchor=old.bindings[0]!.versions.at(-1)!.binding,d=await f.newDepartment(),j=await f.dep.newJob();
 const i=await f.base.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'ASSIGN',department:{owner:'department-master',id:d,expectedVersion:'1',expectedLifecycleHead:'0'},subject:anchor.subject,campus:anchor.campus,services:anchor.services,validFrom:'2026-01-01T00:00:00',validTo:null,reason:'TEST new Department in same Campus',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts});
 await f.base.lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST same Campus service assignment',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});const requestId=randomUUID(),c=await f.base.lifecycle.plan('maker',{inputId:i.inputId,requestId});await f.base.lifecycle.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.base.lifecycle.approveApplyUnit('reviewer',c);expect((await f.base.lifecycle.applyUnit('maker',{candidateId:c.candidateId,requestId})).status).toBe('COMMITTED');
 const relation=(await f.base.lifecycle.history('maker',{id:d})).relations[0]!,v=relation.versions.at(-1)!,binding={...anchor,department:{owner:'department-master' as const,id:d},relation:{owner:'department-master/campus-relation' as const,id:relation.id,version:v.number,versionId:v.id}},out=await f.base.apply(await f.base.input([f.base.entry(binding)]));return {unit:{owner:'care-organization/unit' as const,id:out.facts[0]!.id},campus:b.campus};
}
test('a draft or missing managing Unit, wrong campus and mid-period gap cannot publish',async()=>{
 const b=await f.endpoint(),missing={...b,unit:{owner:'care-organization/unit' as const,id:randomUUID()}},invalid=f.entry(missing);
 await expect(f.prepare(await f.input([invalid]))).rejects.toThrow('NOT_FOUND');
 const blank=f.entry(b);blank.row.managing_unit_id=null;await expect(f.prepare(await f.input([blank]))).rejects.toThrow('WARD_ANCHOR_MISMATCH');
 const foreign=await f.endpoint(),wrong={...b,campus:foreign.campus};await expect(f.prepare(await f.input([f.entry(wrong)]))).rejects.toThrow('WARD_MANAGING_UNIT_CAMPUS_MISMATCH');
 const a=await f.base.owner.history('maker',{id:b.unit.id}),binding=a.bindings[0]!.versions.at(-1)!.binding,row={...f.base.row(binding),unit_id:a.versions[0]!.facts.source.sourceAlias,unit_code:a.versions[0]!.facts.unitCode,unit_name:a.versions[0]!.facts.unitName,record_status:'RETIRED',valid_from:'2026-03-01T00:00:00'};
 await f.base.apply(await f.base.input([{action:'CLOSE',target:{owner:'care-organization/unit',id:b.unit.id,expectedHead:a.versions.at(-1)!.number},row,reason:'TEST close manager',evidenceId:f.base.artifact.artifactId}]));
 await expect(f.prepare(await f.input([f.entry(b)]))).rejects.toThrow('WARD_MANAGING_UNIT_NOT_ADMITTED');
});
test('same-campus rebind preserves Ward identity and a rejected target leaves old management',async()=>{
 const a=await populated(),b=await f.sameCampus(a.binding),bad=await f.endpoint(),from='2026-03-01T00:00:00',target={owner:'care-organization/ward' as const,id:a.h.id,expectedHead:'1'};
 await expect(f.prepare(await f.input([{action:'REBIND',target,binding:bad,row:{...a.entry.row,campus_id:bad.campus.id,managing_unit_id:bad.unit.id,valid_from:from},reason:'TEST campus move requires lifecycle bundle',evidenceId:f.artifact.artifactId}]))).rejects.toThrow('WARD_CAMPUS_CHANGE_REQUIRES_LIFECYCLE');
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:from})).binding?.binding.unit.id).toBe(a.binding.unit.id);
 const result=await f.apply(await f.input([{action:'REBIND',target,binding:b,row:{...a.entry.row,managing_unit_id:b.unit.id,valid_from:from},reason:'TEST explicit manager change',evidenceId:f.artifact.artifactId}]));expect(result.facts[0]!.id).toBe(a.h.id);
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:'2026-02-28T23:59:59.999999'})).binding?.binding.unit.id).toBe(a.binding.unit.id);
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:from})).binding?.binding.unit.id).toBe(b.unit.id);
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:from,recordAsOf:a.h.versions[0]!.recordedAt})).binding?.binding.unit.id).toBe(a.binding.unit.id);
});
test('permanent closure retains history and masks an already-approved future manager',async()=>{
 const a=await populated(),b=await f.sameCampus(a.binding);
 await f.apply(await f.input([{action:'REBIND',target:{owner:'care-organization/ward',id:a.h.id,expectedHead:'1'},binding:b,row:{...a.entry.row,managing_unit_id:b.unit.id,valid_from:'2026-04-01T00:00:00'},reason:'TEST future manager',evidenceId:f.artifact.artifactId}]));
 const before=await f.owner.history('maker',{id:a.h.id});a.h=before;await f.apply(await f.input([revise(a,'CLOSE','2026-03-01T00:00:00')]));
 expect(await f.owner.read('maker',{id:a.h.id,businessAt:'2026-04-01T00:00:00'})).toMatchObject({state:'CLOSED',binding:null,version:null});
 expect((await f.owner.history('maker',{id:a.h.id,recordAsOf:before.versions.at(-1)!.recordedAt})).bindings).toEqual(before.bindings);
 expect((await f.owner.list('maker',{campus:'NORTH',managingUnitId:b.unit.id,businessAt:'2026-04-01T00:00:00'})).items).not.toContainEqual(expect.objectContaining({id:a.h.id}));
 expect((await f.owner.list('maker',{campus:'NORTH',managingUnitId:b.unit.id,businessAt:'2026-04-01T00:00:00',recordAsOf:before.versions.at(-1)!.recordedAt})).items).toContainEqual(expect.objectContaining({id:a.h.id}));
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:'2026-02-01T00:00:00'})).state).toBe('ACTIVE');
 const pool=new Pool({connectionString:connection,max:1});try{const refs=(await pool.query('select care_organization.ward_department_references($1,$2,$3) r',['maker',JSON.stringify([a.d]),'NORTH'])).rows[0].r;expect(refs.filter((r:{id:string})=>r.id===a.h.id)).toContainEqual(expect.objectContaining({current:false,currentPeriod:{from:'2026-04-01T00:00:00.000000',to:'2026-04-01T00:00:00.000000'},originalPeriod:{from:'2026-04-01T00:00:00.000000',to:null}}));}finally{await pool.end();}
 const h=await f.owner.history('maker',{id:a.h.id});a.h=h;await expect(f.prepare(await f.input([revise(a,'REVISE','2026-05-01T00:00:00')]))).rejects.toThrow('WARD_CLOSED');
});
test('generated actual HTTP retains nullable fields through approval, publish and exact recovery',async()=>{
 const server=await buildCatalogServer(catalog,'CONTROL_PLANE',undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{owner:f.owner,actor:r=>actor(r.headers)});
 try{const address=await server.listen({host:'127.0.0.1',port:0}),maker=createWardClient(address,'maker'),reviewer=createWardClient(address,'reviewer'),b=await f.endpoint(),v=await f.input([f.entry(b)]),i=await maker.stage(v);expect(i.response.status).toBe(200);expect(i.data).toBeDefined();
  expect((await reviewer.verify(f.verification(v,i.data!))).response.status).toBe(200);const requestId=randomUUID(),plan=await maker.plan({inputId:i.data!.inputId,requestId});expect(plan.response.status).toBe(200);expect(plan.data).toBeDefined();
  expect((await reviewer.review({candidateId:plan.data!.candidateId})).response.status).toBe(200);expect((await reviewer.approve(plan.data!)).response.status).toBe(200);
  const request={candidateId:plan.data!.candidateId,requestId},outcome=await maker.apply(request);expect(outcome.data?.status).toBe('COMMITTED');if(outcome.data?.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  expect((await maker.query({id:outcome.data.facts[0]!.id,businessAt:'2026-04-01T00:00:00'})).data).toMatchObject({version:{facts:{publicPhone:null,admissionRuleReference:null}}});
  expect((await maker.apply(request)).data).toEqual(outcome.data);const {responseStatus:deliveryAttempt,...committed}=outcome.data;expect(deliveryAttempt).toBe('DELIVERED');expect((await maker.resume(request)).data).toEqual(committed);expect((await maker.reconcile(request)).data).toMatchObject({status:'MATCHED'});
  expect((await createWardClient(address,'outsider').query({id:outcome.data.facts[0]!.id})).response.status).toBe(403);
 }finally{await server.close();}
});
test.each(['CSV','JSON','XLSX'] as const)('Ward %s uses the real shared file intake and the same Owner publication',async format=>{
 const b=await f.endpoint(),entry=f.entry(b),fields=ORG08_FIELDS,row={...entry.row},stageRequestId=randomUUID();
 const fileRow={...row,version_no:9},bytes=format==='JSON'?Buffer.from(JSON.stringify([fileRow])):format==='CSV'?Buffer.from(fields.join(',')+'\n'+fields.map(field=>row[field]??'').join(',')):organizationWorkbook({'ORG08':[fields,fields.map(field=>String(row[field]??''))]});
 const received=await f.owner.receiveFile('maker',{requestId:stageRequestId,fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_WARD_FILE',profile:'CORE',contractId:f.contract!.id,contractVersionId:f.contract!.versionId,input:{kind:'FILE',format,parserPolicy:'STRICT_WARD_V1'}},campus:'NORTH',timePolicy:'LOCAL',retentionSeconds:7200,operations:[{action:'CREATE',binding:b,reason:entry.reason,evidenceId:entry.evidenceId}]},bytes);
 expect(received.structuralStatus).toBe('PARSED');expect(received.issues).toEqual([]);expect(received.input).toBeDefined();const stored=await f.owner.readInput('maker',{inputId:received.input!.inputId});
 await f.owner.verify('reviewer',f.verification(stored,received.input!));const requestId=randomUUID(),candidate=await f.owner.plan('maker',{inputId:received.input!.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await f.owner.approveApplyUnit('reviewer',candidate);const outcome=await f.owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(outcome.status).toBe('COMMITTED');if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 expect((await f.owner.read('maker',{id:outcome.facts[0]!.id})).version?.facts.publicPhone).toBeNull();
});
test('a contiguous finite Ward management period can extend after complete replacement admission',async()=>{
 const binding=await f.endpoint(),entry=f.entry(binding);entry.row.valid_to='2026-03-01T00:00:00';const result=await f.apply(await f.input([entry]));
 const revision:WardEntry={action:'REVISE',target:{owner:'care-organization/ward',id:result.facts[0]!.id,expectedHead:'1'},row:{...entry.row,valid_to:'2026-04-01T00:00:00'},reason:'TEST complete period extension',evidenceId:f.artifact.artifactId};
 await f.apply(await f.input([revision]));expect((await f.owner.coverage('maker',{id:result.facts[0]!.id,validFrom:'2026-02-01T00:00:00',validTo:'2026-04-01T00:00:00'})).covered).toBe(true);
});
test('mixed Ward receiving restrictions require exact independently reviewed rule evidence',async()=>{
 const b=await f.endpoint(),entry=f.entry(b);entry.row.ward_type='TEST 混合病区';entry.row.admission_rule_ref='TEST_MIXED_RULE';const v=await f.input([entry]),i=await f.owner.stage('maker',v),proof=f.verification(v,i);
 await f.owner.verify('reviewer',proof);await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('RECEIVING_BASIS_REQUIRED');
 proof.requestId=randomUUID();proof.rows[0]!.receiving={kind:'RESTRICTED_RULE_REFERENCE',ruleReference:'TEST_MIXED_RULE',sourceRuleVersion:'TEST_POLICY_ONLY_2',ruleEvidenceId:f.artifact.artifactId,validFrom:'2026-01-01T00:00:00',validTo:null};
 await f.owner.verify('reviewer',proof);const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:i.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);const outcome=await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId});if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 expect((await f.owner.read('maker',{id:outcome.facts[0]!.id})).version?.facts).toMatchObject({wardType:'TEST 混合病区',admissionRuleReference:'TEST_MIXED_RULE',receivingBasis:{source:{sourceRuleVersion:'TEST_POLICY_ONLY_2'}}});
});
test('unverified rows, FULL input and a same-person alias cannot bypass independent publication',async()=>{
 const b=await f.endpoint(),v=await f.input([f.entry(b),f.entry(b)]),i=await f.owner.stage('maker',v),proof=f.verification(v,i);proof.rows=proof.rows.slice(0,1);await expect(f.owner.verify('reviewer',proof)).rejects.toThrow('VERIFICATION_ROW_MISMATCH');
 await expect(f.owner.verify('maker-alias',f.verification(v,i))).rejects.toThrow('ACCESS_DENIED');
 const full={...await f.input([f.entry(b)]),profile:'FULL' as const},stored=await f.owner.stage('maker',full);await f.owner.verify('reviewer',f.verification(full,stored));expect((await f.owner.readInput('maker',{inputId:stored.inputId})).profile).toBe('FULL');await expect(f.owner.plan('maker',{inputId:stored.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
});
test('a draft with no managing Unit retains its source null and cannot be published',async()=>{
 const b=await f.endpoint(),row={...f.row(b),managing_unit_id:null,record_status:'DRAFT' as const},v=await f.input([{action:'CREATE',row,reason:'TEST unassigned draft',evidenceId:f.artifact.artifactId}]),i=await f.owner.stage('maker',v);
 expect((await f.owner.readInput('maker',{inputId:i.inputId})).entries[0]!.row.managing_unit_id).toBeNull();await f.owner.verify('reviewer',f.verification(v,i));expect((await f.owner.preview('maker',{inputId:i.inputId})).decision).toBe('BLOCKED');
});
test('stale concurrent revisions cannot both commit and old code claims survive changes',async()=>{
 const a=await populated(),r1=revise(a,'REVISE','2026-02-01T00:00:00'),r2=revise(a,'REVISE','2026-02-01T00:00:00');r1.row.ward_name='TEST name1';r2.row.ward_name='TEST name2';r1.row.ward_code='TEST_CHANGED_'+randomUUID();r2.row.ward_code='TEST_CHANGED_'+randomUUID();const q1=await f.prepare(await f.input([r1])),q2=await f.prepare(await f.input([r2])),outcomes=await Promise.allSettled([f.owner.applyUnit('maker',q1),f.owner.applyUnit('maker',q2)]);
 expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
 const duplicate=f.entry(a.binding);duplicate.row.ward_code=a.entry.row.ward_code;await expect(f.prepare(await f.input([duplicate]))).rejects.toThrow('WARD_CODE_CONFLICT');
 expect((await f.owner.history('maker',{id:a.h.id})).versions).toHaveLength(2);
});

test('SQL rejects approved-plan fact tampering even with a valid transaction signature',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),request=await f.prepare(await f.input([f.entry(a)])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId}),value=candidate.unit.commands[0]!.value,writes=JSON.parse(value['writes']!);writes[0].facts.wardName='TEST_UNAPPROVED';
 const p=new Pool({connectionString:connection,max:1}),client=await p.connect(),key=Buffer.from(planBinding(provider,'WARD_SQL_AUTHORITY_V1',{}),'hex');
 try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v,point=(await client.query('select care_organization.ward_record_time() r')).rows[0].r;
  const badTime=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes,writeIndex:1,writesDigest:value['writesDigest'],candidateId:request.candidateId,digest:candidate.digest,...point,recordAt:'2000-01-01T00:00:00.000000'});await client.query('SAVEPOINT wrong_time');await expect(client.query('select care_organization.ward_mutate($1,$2)',[badTime,createHmac('sha256',key).update(badTime).digest('hex')])).rejects.toMatchObject({message:'INVALID_PLAN_TOKEN'});await client.query('ROLLBACK TO SAVEPOINT wrong_time');
  const ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes,writeIndex:1,writesDigest:value['writesDigest'],candidateId:request.candidateId,digest:candidate.digest,...point});await expect(client.query('select care_organization.ward_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rejects.toMatchObject({message:'STALE_VALIDATION'});
 }finally{await client.query('ROLLBACK');client.release();await p.end();key.fill(0);}
 expect((await f.owner.list('maker',{campus:'NORTH',campusId:a.campus.id})).items).toHaveLength(0);expect((await f.owner.applyUnit('maker',request)).status).toBe('COMMITTED');
});


test('current independent verification authority is rechecked after freeze',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),value=await f.input([f.entry(a)]),i=await f.owner.stage('maker',value);await f.owner.verify('reviewer',f.verification(value,i));const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:i.inputId,requestId});
 await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});peer(receipt.name,`DELETE FROM care_organization.ward_access WHERE actor='reviewer' AND campus_id=${quote(a.campus.id)}::uuid AND permission='VERIFY';`);
 try{await expect(f.owner.approveApplyUnit('reviewer',c)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO care_organization.ward_access VALUES('reviewer',${quote(a.campus.id)}::uuid,'NORTH','VERIFY');`);}
 await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);expect((await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId})).status).toBe('COMMITTED');
});




test.each(['CLOSE','REBIND'] as const)('committed %s disposition survives upstream suspension and later revisions',async action=>{
 const state=await populated(),{d,h,entry}=state,a=state.binding,replacement=action==='REBIND'?await managerInSameCampus(a):null,j=await f.dep.newJob(),i=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:d,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:'2026-06-01T00:00:00',reason:'TEST permanent closure',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts.map(impact=>({...impact,determination:['IDENTIFIER','SOURCE_MAPPING','HIERARCHY','BUSINESS_UNIT','WARD'].includes(impact.domain)?'AFFECTED' as const:impact.determination}))});
 await f.lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST explicit pending dispositions',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});const requestId=randomUUID(),c=await f.lifecycle.plan('maker',{inputId:i.inputId,requestId});await f.lifecycle.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.lifecycle.approveApplyUnit('reviewer',c);const lifecycleResult=await f.lifecycle.applyUnit('maker',{candidateId:c.candidateId,requestId});if(lifecycleResult.status!=='COMMITTED')throw new Error();
 const evolution=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>undefined,()=>f.owner));
 try{
  const item=(await evolution.listImpactCases('maker',{eventId:lifecycleResult.facts[0]!.id,campus:'NORTH'})).items.find(v=>v.obligation.owner==='WARD')!;expect(item.status).toBe('OPEN');
  let responsibilityId=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(r=>r.kind==='RESPONSIBILITY'&&r.status==='PUBLISHED'&&r.payload['dataset']==='ORG08'&&r.payload['role']==='OWNER')?.id;
  if(!responsibilityId){const draft=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',kind:'RESPONSIBILITY',code:'WARD_IMPACT_'+randomUUID().replaceAll('-','').toUpperCase(),values:{dataset:'ORG08',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}),submitted=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:draft.head}),r=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest});responsibilityId=r.id;}
  peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='SERVICE' WHERE code='maker';");try{await expect(evolution.assignImpactCase('maker',{requestId:randomUUID(),reason:'TEST service cannot adjudicate',caseId:item.id,campus:'NORTH',expectedHead:item.head,responsibilityId})).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='HUMAN' WHERE code='maker';");}
  const assigned=await evolution.assignImpactCase('maker',{requestId:randomUUID(),reason:'TEST unit Owner',caseId:item.id,campus:'NORTH',expectedHead:item.head,responsibilityId});
  const command:WardEntry=replacement?{action:'REBIND',target:{owner:'care-organization/ward',id:h.id,expectedHead:'1'},binding:replacement,row:{...entry.row,managing_unit_id:replacement.unit.id,valid_from:'2026-06-01T00:00:00'},reason:'TEST committed management handoff',evidenceId:f.artifact.artifactId}:revise(state,'CLOSE','2026-06-01T00:00:00'),closeRequest=await f.prepare(await f.input([command])),result=await f.owner.applyUnit('maker',closeRequest);expect(result.status).toBe('COMMITTED');const v=(await f.owner.history('maker',{id:h.id})).versions.at(-1)!,proof={owner:'WARD' as const,id:h.id,versionId:v.id,...closeRequest};
  if(replacement){
   await f.apply(await f.input([{action:'REVISE',target:{owner:'care-organization/ward',id:h.id,expectedHead:v.number},row:{...command.row,ward_name:'TEST property revision after committed rebind',valid_from:'2026-07-01T00:00:00'},reason:'TEST later attribute revision retains committed source closure',evidenceId:f.artifact.artifactId}]));
   const historical=await managerInSameCampus(a);
   await f.apply(await f.input([{action:'REBIND',target:{owner:'care-organization/ward',id:h.id,expectedHead:'3'},binding:historical,row:{...entry.row,managing_unit_id:historical.unit.id,valid_from:'2026-05-01T00:00:00',valid_to:'2026-06-01T00:00:00'},reason:'TEST historical management revision retains June outcome',evidenceId:f.artifact.artifactId}]));
   expect((await f.owner.history('maker',{id:h.id})).versions.at(-1)!.number).toBe('4');
  }
  await expect(evolution.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST forged result',caseId:item.id,campus:'NORTH',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.dep.artifact.artifactId,result:{...proof,requestId:randomUUID()}}})).rejects.toThrow();
  const proposed=await evolution.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST committed closure',caseId:item.id,campus:'NORTH',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.dep.artifact.artifactId,result:proof}}),approved=await evolution.approveDisposition('reviewer',{requestId:randomUUID(),reason:'TEST independent result',caseId:item.id,campus:'NORTH',expectedHead:proposed.head,proposalEventId:proposed.eventId});expect((await evolution.recheckImpact('maker',{requestId:randomUUID(),reason:'TEST result recheck',caseId:item.id,campus:'NORTH',expectedHead:approved.head})).status).toBe('RESOLVED');
 }finally{await evolution.close();}
 expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00'})).state).toBe(action==='CLOSE'?'CLOSED':'ACTIVE');expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00',recordAsOf:h.versions[0]!.recordedAt})).state).toBe('ACTIVE');
 if(action==='CLOSE'){const closed=await f.owner.history('maker',{id:h.id});await expect(f.prepare(await f.input([revise({...state,h:closed},'REVISE','2026-07-01T00:00:00')]))).rejects.toThrow('WARD_CLOSED');}const duplicate=f.entry(a);duplicate.row.ward_code=h.versions[0]!.facts.wardCode;await expect(f.prepare(await f.input([duplicate]))).rejects.toThrow('WARD_CODE_CONFLICT');
});


test('actual restricted SQL rejects raw DML, wrong typed manager and an unsigned mutation',async()=>{
 const b=await f.endpoint(),pool=new Pool({connectionString:connection,max:1});
 try{await expect(pool.query('select * from care_organization.ward_version')).rejects.toMatchObject({code:'42501'});await expect(pool.query('delete from care_organization.ward_code')).rejects.toMatchObject({code:'42501'});
  await expect(pool.query('select care_organization.ward_admission($1,$2,$3,$4,$5)',['maker',{...b,unit:{owner:'location-master',id:b.unit.id}},'2026-01-01',null,null])).rejects.toMatchObject({message:'REFERENCE_INVALID'});
  await expect(pool.query('select care_organization.ward_mutate($1,$2)',['{}','0'.repeat(64)])).rejects.toMatchObject({message:'ACCESS_DENIED'});
 }finally{await pool.end();}
});
test('ended Campus windows retain Ward history without outstanding obligations',async()=>{
 const a=await populated(),campus=openCampus(connection,provider,{owners:['WARD'],readInTransaction:f.owner.readCampusDependenciesInTransaction}),asOf=a.h.versions[0]!.recordedAt;
 try{for(const [validTo,outstanding] of [[asOf,false],['2032-01-01T00:00:00',true],[null,true]] as const){const report=await campus.assessCampusImpact('maker',{id:a.binding.campus.id,validFrom:'2026-01-01T00:00:00',validTo,asOf});expect(report.dependencies).toContainEqual(expect.objectContaining({owner:'WARD',id:a.h.id,active:true,outstanding}));}expect(await f.owner.history('maker',{id:a.h.id,recordAsOf:asOf})).toEqual(a.h);
 }finally{await campus.close();}
});
test('actual commit ACK loss recovers one exact published Ward outcome',async()=>{
 const b=await f.endpoint(),request=await f.prepare(await f.input([f.entry(b)])),original=Client.prototype.query;let injected=false;
 Client.prototype.query=(function(this:Client,config:string|QueryConfig,...args:unknown[]){const text=typeof config==='string'?config:config.text,result=Reflect.apply(original,this,[config,...args]);if(!injected&&text.trim().toLowerCase()==='commit'){injected=true;return Promise.resolve(result).then(()=>{throw Object.assign(new Error('ACK_LOST'),{code:'ECONNRESET'});});}return result;}) as typeof Client.prototype.query;
 try{expect((await f.owner.applyUnit('maker',request)).status).toBe('COMMIT_UNKNOWN');expect(injected).toBe(true);}finally{Client.prototype.query=original;}
 const recovered=await f.owner.resumeOutcome('maker',request),replay=await f.owner.applyUnit('maker',request);expect(recovered?.status).toBe('COMMITTED');if(recovered?.status!=='COMMITTED'||replay.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(replay.facts).toEqual(recovered.facts);expect(replay.recordedAt).toBe(recovered.recordedAt);expect((await f.owner.list('maker',{campus:'NORTH',campusId:b.campus.id})).items).toHaveLength(1);
});
test('same-name Wards in distinct campuses never merge and missing reference access blocks a complete assessment',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),b=await f.endpoint(d),e1=f.entry(a),e2=f.entry(b),v=await f.input([e1,e2]),i=await f.owner.stage('maker',v);expect(await f.owner.readInput('maker',{inputId:i.inputId})).toMatchObject({entries:[{row:e1.row},{row:e2.row}]});await f.owner.verify('reviewer',f.verification(v,i));
 const requestId=randomUUID(),candidate=await f.owner.plan('maker',{inputId:i.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await f.owner.approveApplyUnit('reviewer',candidate);const out=await f.owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(out.facts[0]!.id).not.toBe(out.facts[1]!.id);expect(a.campus.id).not.toBe(b.campus.id);expect(e1.row.ward_name).toBe(e2.row.ward_name);
 const j=await f.dep.newJob(),input=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:d,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:'2028-01-01T00:00:00',reason:'TEST all campuses',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts}),evolution=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>undefined,()=>f.owner));
 try{const report=await evolution.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST complete Ward reference set',target:{kind:'INPUT',id:input.inputId}});expect(report.references.filter(r=>r.owner==='WARD').map(r=>r.id).sort()).toEqual(out.facts.map(r=>r.id).sort());peer(receipt.name,`DELETE FROM care_organization.ward_access WHERE actor='maker' AND campus_id=${quote(b.campus.id)}::uuid AND permission='READ';`);
  try{await expect(evolution.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST no partial assessment',target:{kind:'INPUT',id:input.inputId}})).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO care_organization.ward_access VALUES('maker',${quote(b.campus.id)}::uuid,'NORTH','READ');`);}
 }finally{await evolution.close();}
});
test('a failed audit rolls back all Ward identities and the same request can retry exactly once',async()=>{
 const b=await f.endpoint(),request=await f.prepare(await f.input([f.entry(b),f.entry(b)]));peer(receipt.name,`CREATE FUNCTION care_organization.ward_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='WARD_CREATE' AND (SELECT count(*) FROM care_organization.ward_unit WHERE campus_id=${quote(b.campus.id)}::uuid)=2 THEN RAISE EXCEPTION 'TEST_SECOND_WARD_ROW';END IF;RETURN NEW;END $$;CREATE TRIGGER test_ward_audit_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION care_organization.ward_test_audit_failure();`);
 try{await expect(f.owner.applyUnit('maker',request)).rejects.toThrow('APPLY_FAILED');expect((await f.owner.list('maker',{campus:'NORTH',campusId:b.campus.id})).items).toHaveLength(0);expect(await f.owner.resumeOutcome('maker',request)).toBeNull();}finally{peer(receipt.name,'DROP TRIGGER test_ward_audit_failure ON vnext_control.audit;DROP FUNCTION care_organization.ward_test_audit_failure();');}
 const out=await f.owner.applyUnit('maker',request);expect(out.status).toBe('COMMITTED');if(out.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect(out.facts).toHaveLength(2);expect(await f.owner.applyUnit('maker',request)).toEqual(out);
});
test('a manager changed after approval invalidates Ward publication but closed managers cannot trap safe closure',async()=>{
 const b=await f.endpoint(),request=await f.prepare(await f.input([f.entry(b)])),h=await f.base.owner.history('maker',{id:b.unit.id}),binding=h.bindings[0]!.versions.at(-1)!.binding,unitRow={...f.base.row(binding),unit_id:h.versions[0]!.facts.source.sourceAlias,unit_code:h.versions[0]!.facts.unitCode,unit_name:'TEST changed manager'};
 await f.base.apply(await f.base.input([{action:'REVISE',target:{owner:'care-organization/unit',id:b.unit.id,expectedHead:'1'},row:unitRow,reason:'TEST dependency change',evidenceId:f.base.artifact.artifactId}]));await expect(f.owner.applyUnit('maker',request)).rejects.toThrow('STALE_VALIDATION');
 const e=f.entry(b),accepted=await f.apply(await f.input([e])),ward=await f.owner.history('maker',{id:accepted.facts[0]!.id});
 await f.base.apply(await f.base.input([{action:'CLOSE',target:{owner:'care-organization/unit',id:b.unit.id,expectedHead:'2'},row:{...unitRow,record_status:'RETIRED',valid_from:'2026-03-01T00:00:00'},reason:'TEST manager closes',evidenceId:f.base.artifact.artifactId}]));expect((await f.owner.evaluateWindow('maker',{id:ward.id,validFrom:'2026-04-01T00:00:00',validTo:null})).checks[0]?.status).toBe('NOT_SATISFIED');
 await f.apply(await f.input([{action:'CLOSE',target:{owner:'care-organization/ward',id:ward.id,expectedHead:'1'},row:{...e.row,record_status:'RETIRED',valid_from:'2026-04-01T00:00:00'},reason:'TEST safe closure after manager',evidenceId:f.artifact.artifactId}]));expect((await f.owner.read('maker',{id:ward.id,businessAt:'2026-05-01T00:00:00'})).state).toBe('CLOSED');
});
test('startup requires the exact installed Ward key authority and write authority requires a human',async()=>{
 await expect(assertWardProvisioned(connection,provider)).resolves.toBeUndefined();await expect(assertWardProvisioned(connection,new LocalSyntheticKeyProvider())).rejects.toThrow('WARD_OWNER_NOT_PROVISIONED');
 const b=await f.endpoint(),v=await f.input([f.entry(b)]);peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='SERVICE' WHERE code='maker';");try{await expect(f.owner.stage('maker',v)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='HUMAN' WHERE code='maker';");}
});
test('an explicitly published +08 conversion works for Ward JSON while retaining raw offsets',async()=>{
 const b=await f.endpoint(),entry=f.entry(b);entry.row.valid_from+='+08:00';entry.row.recorded_at+='+08:00';entry.row.valid_to=null;const {row,...operation}=entry;
 const received=await f.owner.receiveFile('maker',{requestId:randomUUID(),fileRequestId:randomUUID(),job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_SOURCE_PLUS_EIGHT',profile:'CORE',contractId:f.contract!.id,contractVersionId:f.contract!.versionId,input:{kind:'FILE',format:'JSON',parserPolicy:'STRICT_WARD_V1'}},campus:'NORTH',timePolicy:'SOURCE_PLUS08_TO_LOCAL',retentionSeconds:7200,operations:[operation]},Buffer.from(JSON.stringify([row])));
 expect(received.issues).toEqual([]);expect(received.input).not.toBeNull();const stored=await f.owner.readInput('maker',{inputId:received.input!.inputId});expect(stored.entries[0]!.row.valid_from).toBe('2026-01-01T00:00:00+08:00');
 const proof=f.verification(stored,received.input!);proof.rows[0]!.receiving={kind:'NO_SPECIAL_RESTRICTION',confirmed:true,validFrom:'2026-01-01T00:00:00',validTo:null};await f.owner.verify('reviewer',proof);const requestId=randomUUID(),candidate=await f.owner.plan('maker',{inputId:received.input!.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await f.owner.approveApplyUnit('reviewer',candidate);const outcome=await f.owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');expect((await f.owner.read('maker',{id:outcome.facts[0]!.id})).version?.validFrom).toBe('2026-01-01T00:00:00.000000');
});
test('concurrent creations claim one permanent code and an existing alias cannot create a second identity',async()=>{
 const b=await f.endpoint(),first=f.entry(b),second=f.entry(b);second.row.ward_code=first.row.ward_code;
 const q1=await f.prepare(await f.input([first])),q2=await f.prepare(await f.input([second]));
 const results=await Promise.allSettled([f.owner.applyUnit('maker',q1),f.owner.applyUnit('maker',q2)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 const winner=results.findIndex(r=>r.status==='fulfilled'),duplicate=f.entry(b);duplicate.row.ward_id=(winner===0?first:second).row.ward_id;
 await expect(f.prepare(await f.input([duplicate]))).rejects.toThrow('WARD_SOURCE_ALREADY_REGISTERED');
 expect((await f.owner.list('maker',{campus:'NORTH',campusId:b.campus.id})).items).toHaveLength(1);
});
test('revoked current access blocks exact committed recovery and read without repeating admission',async()=>{
 const a=await populated(),scope=a.binding.campus.id;
 peer(receipt.name,`DELETE FROM care_organization.ward_access WHERE actor='maker' AND campus_id=${quote(scope)}::uuid AND permission='READ';`);
 try{await expect(f.owner.read('maker',{id:a.h.id})).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.resumeOutcome('maker',a.request)).rejects.toThrow('ACCESS_DENIED');await expect(f.owner.applyUnit('maker',a.request)).rejects.toThrow('ACCESS_DENIED');}
 finally{peer(receipt.name,`INSERT INTO care_organization.ward_access VALUES('maker',${quote(scope)}::uuid,'NORTH','READ');`);}
 const recovered=await f.owner.resumeOutcome('maker',a.request);expect(recovered?.status).toBe('COMMITTED');expect(recovered?.facts[0]?.id).toBe(a.h.id);
});
test('a finite latest property version never falls back to an older open version',async()=>{
 const a=await populated(),revision=revise(a,'REVISE','2026-03-01T00:00:00');revision.row.valid_to='2026-04-01T00:00:00';revision.row.ward_name='TEST finite revision';await f.apply(await f.input([revision]));
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:'2026-03-31T23:59:59.999999'})).version?.facts.wardName).toBe('TEST finite revision');
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:'2026-04-01T00:00:00'})).version).toBeNull();
 expect((await f.owner.read('maker',{id:a.h.id,businessAt:'2026-04-01T00:00:00',recordAsOf:a.h.versions[0]!.recordedAt})).version?.facts.wardName).toBe(a.entry.row.ward_name);
 expect((await f.owner.coverage('maker',{id:a.h.id,validFrom:'2026-03-01T00:00:00',validTo:'2026-04-01T00:00:00'})).covered).toBe(true);
 expect((await f.owner.coverage('maker',{id:a.h.id,validFrom:'2026-03-01T00:00:00',validTo:'2026-04-01T00:00:00.000001'})).covered).toBe(false);
 const campus=openCampus(connection,provider,{owners:['WARD'],readInTransaction:f.owner.readCampusDependenciesInTransaction});try{const request={id:a.binding.campus.id,validFrom:'2026-04-01T00:00:00',validTo:null};expect((await campus.assessCampusImpact('maker',request)).dependencies).toContainEqual(expect.objectContaining({owner:'WARD',id:a.h.id,active:false,outstanding:false}));expect((await campus.assessCampusImpact('maker',{...request,asOf:a.h.versions[0]!.recordedAt})).dependencies).toContainEqual(expect.objectContaining({owner:'WARD',id:a.h.id,active:true,outstanding:true}));}finally{await campus.close();}
});

test('a finite Ward can permanently close exactly at its property and management end',async()=>{
 const b=await f.endpoint(),entry=f.entry(b);entry.row.valid_to='2026-06-01T00:00:00';
 const created=await f.apply(await f.input([entry])),id=created.facts[0]!.id,prior=await f.owner.history('maker',{id});
 await f.apply(await f.input([{action:'CLOSE',target:{owner:'care-organization/ward',id,expectedHead:'1'},row:{...entry.row,valid_from:'2026-06-01T00:00:00',valid_to:null,record_status:'RETIRED'},reason:'TEST terminal closure at the excluded finite end',evidenceId:f.artifact.artifactId}]));
 expect(await f.owner.read('maker',{id,businessAt:'2026-06-01T00:00:00'})).toMatchObject({state:'CLOSED',head:'2'});
 expect((await f.owner.read('maker',{id,businessAt:'2026-05-01T00:00:00',recordAsOf:prior.versions[0]!.recordedAt})).state).toBe('ACTIVE');
 expect((await f.owner.history('maker',{id})).bindings[0]!.versions).toEqual(prior.bindings[0]!.versions);
 await expect(f.prepare(await f.input([{action:'REVISE',target:{owner:'care-organization/ward',id,expectedHead:'2'},row:{...entry.row,valid_from:'2026-07-01T00:00:00',valid_to:null},reason:'TEST a property cannot restore closure',evidenceId:f.artifact.artifactId}]))).rejects.toThrow('WARD_CLOSED');
});
test('unknown receiving basis and a permanent close carrying property edits remain blocked',async()=>{
 const a=await populated(),revision=revise(a,'REVISE','2026-02-01T00:00:00'),v=await f.input([revision]),i=await f.owner.stage('maker',v),proof=f.verification(v,i);proof.rows[0]!.receiving={kind:'UNKNOWN'};
 await f.owner.verify('reviewer',proof);await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('RECEIVING_BASIS_REQUIRED');
 const close=revise(a,'CLOSE','2026-03-01T00:00:00');close.row.ward_name='TEST hidden property change';await expect(f.prepare(await f.input([close]))).rejects.toThrow('WARD_CONTENT_CHANGED');
 expect((await f.owner.history('maker',{id:a.h.id})).versions).toHaveLength(1);
});
test('management coverage stitches property versions and rejects an internal Campus gap',async()=>{
 const b=await f.endpoint(),h=await f.base.owner.history('maker',{id:b.unit.id}),anchor=h.bindings[0]!.versions[0]!.binding,source={...f.base.row(anchor),unit_id:h.versions[0]!.facts.source.sourceAlias,unit_code:h.versions[0]!.facts.unitCode,unit_name:h.versions[0]!.facts.unitName};
 await f.base.apply(await f.base.input([{action:'REVISE',target:{owner:'care-organization/unit',id:b.unit.id,expectedHead:'1'},row:{...source,unit_name:'TEST manager revision',valid_from:'2026-02-01T00:00:00'},reason:'TEST stitched properties',evidenceId:f.base.artifact.artifactId}]));
 const entry=f.entry(b);entry.row.valid_to='2026-05-01T00:00:00';const accepted=await f.apply(await f.input([entry]));expect((await f.owner.coverage('maker',{id:accepted.facts[0]!.id,validFrom:'2026-01-01T00:00:00',validTo:entry.row.valid_to})).covered).toBe(true);
 const other=await f.base.endpoint(h.departmentId),row={...source,unit_name:'TEST manager revision'};
 await f.base.apply(await f.base.input([{action:'REBIND',target:{owner:'care-organization/unit',id:b.unit.id,expectedHead:'2'},binding:other,row:{...row,campus_id:other.campus.id,legal_entity_id:other.subject.id,valid_from:'2026-03-01T00:00:00'},reason:'TEST internal foreign Campus segment',evidenceId:f.base.artifact.artifactId}]));
 await f.base.apply(await f.base.input([{action:'REBIND',target:{owner:'care-organization/unit',id:b.unit.id,expectedHead:'3'},binding:anchor,row:{...row,valid_from:'2026-04-01T00:00:00'},reason:'TEST return to original Campus',evidenceId:f.base.artifact.artifactId}]));
 const attempt=f.entry(b);attempt.row.valid_to='2026-05-01T00:00:00';await expect(f.prepare(await f.input([attempt]))).rejects.toThrow('WARD_MANAGING_UNIT_CAMPUS_MISMATCH');
 expect((await f.owner.evaluateWindow('maker',{id:accepted.facts[0]!.id,validFrom:'2026-01-01T00:00:00',validTo:'2026-05-01T00:00:00'})).checks[0]?.status).toBe('NOT_SATISFIED');
 const history=await f.owner.history('maker',{id:accepted.facts[0]!.id});expect(history.bindings[0]!.versions[0]!.dependencies).toEqual((await f.owner.history('maker',{id:accepted.facts[0]!.id,recordAsOf:history.versions[0]!.recordedAt})).bindings[0]!.versions[0]!.dependencies);
});
test('a ten-domain evolution commits real Ward references through both application and SQL guards',async()=>{
 const evolution=await evolutionProtocol(),binding=await f.endpoint(evolution.targetId),ward=await f.apply(await f.input([f.entry(binding)])),owner=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>undefined,()=>f.owner));
 try{const v=await evolution.input(),i=await owner.stage('maker',v);await owner.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST exact ten-domain review',policyApproved:true,materialsAccepted:true,impactReviews:evolution.impactReviews});const requestId=randomUUID(),c=await owner.plan('maker',{inputId:i.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await owner.approveApplyUnit('reviewer',c);const outcome=await owner.applyUnit('maker',{candidateId:c.candidateId,requestId});expect(outcome.status).toBe('COMMITTED');if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  const report=await owner.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST accepted Ward original basis',target:{kind:'EVENT',id:outcome.facts[0]!.id,campus:'NORTH'}});expect(report.coverage).toContainEqual({owner:'WARD',status:'EVALUATED',reason:'OWNER_AVAILABLE'});expect(report.references).toContainEqual(expect.objectContaining({owner:'WARD',id:ward.facts[0]!.id,change:'CHANGED',constraint:'SATISFIED'}));expect(await owner.applyUnit('maker',{candidateId:c.candidateId,requestId})).toMatchObject({status:'COMMITTED',facts:outcome.facts});
 }finally{await owner.close();}
});

test('a future evolution excludes ended Ward bindings through its restricted SQL guard',async()=>{
 const e=await evolutionProtocol(),targetId=await f.newDepartment(),binding=await f.endpoint(targetId),entry=f.entry(binding),created=await f.apply(await f.input([entry])),replacement=await managerInSameCampus(binding),id=created.facts[0]!.id;
 await f.apply(await f.input([{action:'REBIND',target:{owner:'care-organization/ward',id,expectedHead:'1'},binding:replacement,row:{...entry.row,managing_unit_id:replacement.unit.id,valid_from:'2099-06-01T00:00:00'},reason:'TEST future manager before Department rename',evidenceId:f.artifact.artifactId}]));
 const owner=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>undefined,()=>f.owner));
 try{
  const value=await e.input();value.event.effective_at='2099-07-01T00:00:00';value.predecessors[0]!.id=targetId;for(const relation of value.relations){relation.from_target_id=targetId;relation.to_target_id=targetId;}const input=await owner.stage('maker',value);await owner.verify('reviewer',{requestId:randomUUID(),inputId:input.inputId,inputDigest:input.digest,reason:'TEST independent future rename',policyApproved:true,materialsAccepted:true,impactReviews:e.impactReviews});
  const requestId=randomUUID(),candidate=await owner.plan('maker',{inputId:input.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await owner.approveApplyUnit('reviewer',candidate);const result=await owner.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
  expect((await owner.listImpactCases('maker',{eventId:result.facts[0]!.id,campus:'NORTH'})).items.filter(item=>item.obligation.owner==='WARD')).toHaveLength(0);
  expect((await owner.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST ended future reference is historical',target:{kind:'EVENT',id:result.facts[0]!.id,campus:'NORTH'}})).references.find(ref=>ref.owner==='WARD'&&ref.id===id)).toMatchObject({current:false,reason:'HISTORICAL_REFERENCE'});
 }finally{await owner.close();}
});
test('unrelated unreadable management does not poison the complete Department reference set',async()=>{
 const a=await populated(),b=await populated(),evolution=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>undefined,()=>f.owner)),j=await f.dep.newJob(),i=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:a.d,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:'2028-01-01T00:00:00',reason:'TEST target Department only',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts});
 peer(receipt.name,`DELETE FROM care_organization.access WHERE actor='maker' AND campus_id=${quote(b.binding.campus.id)}::uuid AND permission='READ';`);
 try{const report=await evolution.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST complete target reference set',target:{kind:'INPUT',id:i.inputId}});expect(report.references.filter(r=>r.owner==='WARD').map(r=>r.id)).toEqual([a.h.id]);}
 finally{peer(receipt.name,`INSERT INTO care_organization.access VALUES('maker',${quote(b.binding.campus.id)}::uuid,'NORTH','READ');`);await evolution.close();}
});

test.each([{year:'2026',month:'07',cases:0},{year:'2099',month:'07',cases:0},{year:'2099',month:'05',cases:1}])('ended Ward source references preserve history and only open live $year-$month obligations',async({year,month,cases})=>{
 const a=await populated(),replacement=await managerInSameCampus(a.binding);
 await f.apply(await f.input([{action:'REBIND',target:{owner:'care-organization/ward',id:a.h.id,expectedHead:'1'},binding:replacement,row:{...a.entry.row,managing_unit_id:replacement.unit.id,valid_from:`${year}-06-01T00:00:00`},reason:'TEST accepted management handoff',evidenceId:f.artifact.artifactId}]));
 const j=await f.dep.newJob(),i=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:a.d,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:`${year}-${month}-01T00:00:00`,reason:'TEST Department boundary around Ward handoff',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts.map(impact=>({...impact,determination:['IDENTIFIER','SOURCE_MAPPING','HIERARCHY','BUSINESS_UNIT','WARD'].includes(impact.domain)?'AFFECTED' as const:impact.determination}))});
 await f.lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST independent finite obligations',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});
 const requestId=randomUUID(),candidate=await f.lifecycle.plan('maker',{inputId:i.inputId,requestId});await f.lifecycle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await f.lifecycle.approveApplyUnit('reviewer',candidate);const result=await f.lifecycle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');
 const evolution=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>undefined,()=>f.owner));
 try{
  const opened=await evolution.listImpactCases('maker',{eventId:result.facts[0]!.id,campus:'NORTH'});expect(opened.items.filter(item=>item.obligation.owner==='WARD')).toHaveLength(cases);
  const report=await evolution.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST historical reference remains visible',target:{kind:'EVENT',id:result.facts[0]!.id,campus:'NORTH'}}),reference=report.references.find(ref=>ref.owner==='WARD'&&ref.id===a.h.id)!;
  expect(reference.current).toBe(cases===1);expect(reference.reason).toBe(cases===1?'REFERENCE_EXITED':'HISTORICAL_REFERENCE');expect(reference.originalPeriod.to).toBeNull();expect(reference.currentPeriod.to).toBe(`${year}-06-01T00:00:00.000000`);
 }finally{await evolution.close();}
});

test('Ward references select the requested governance scope before authorizing objects',async()=>{
 const a=await populated(),pool=new Pool({connectionString:connection,max:1});
 try{
  const query=(campus:string)=>pool.query('select care_organization.ward_department_references($1,$2::jsonb,$3) r',['maker',JSON.stringify([a.d]),campus]);
  expect((await query('NORTH')).rows[0].r.map((r:{id:string})=>r.id)).toEqual([a.h.id]);
  expect((await query('SOUTH')).rows[0].r).toEqual([]);
  peer(receipt.name,`DELETE FROM care_organization.ward_access WHERE actor='maker' AND campus_id=${quote(a.binding.campus.id)}::uuid AND permission='READ';`);
  try{expect((await query('SOUTH')).rows[0].r).toEqual([]);await expect(query('NORTH')).rejects.toThrow('ACCESS_DENIED');}
  finally{peer(receipt.name,`INSERT INTO care_organization.ward_access VALUES('maker',${quote(a.binding.campus.id)}::uuid,'NORTH','READ');`);}
 }finally{await pool.end();}
});

test('Ward freezes exact accepted Department versions and periods in its management history',async()=>{
 const a=await populated(),department=await f.base.department.history('maker',a.d),parts=[{versionId:department.versions[0]!.id,version:'1',from:'2026-01-01T00:00:00.000000',to:null}];
 expect(a.h.bindings[0]!.versions[0]!.dependencies).toMatchObject({department:{id:a.d,parts}});
 const pool=new Pool({connectionString:connection,max:1});
 try{const references=(await pool.query('select care_organization.ward_department_references($1,$2::jsonb,$3) r',['maker',JSON.stringify([a.d]),'NORTH'])).rows[0].r;expect(references.find((r:{id:string})=>r.id===a.h.id).acceptedVersions).toEqual(parts);}
 finally{await pool.end();}
 await f.apply(await f.input([revise(a,'REVISE','2026-02-01T00:00:00')]));
 expect((await f.owner.history('maker',{id:a.h.id})).bindings[0]!.versions[0]!.dependencies).toEqual(a.h.bindings[0]!.versions[0]!.dependencies);
});

test.skipIf(process.env['VNEXT_P3_02_WARD_UPGRADED']!=='1')('a 0167 Ward retains exact accepted Department evidence after upgrade without rewriting history',async()=>{
 const prior=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!+'.ward-impact.json','utf8')),history=await f.owner.history('maker',{id:prior.id});
 expect(history.bindings[0]!.versions[0]!.dependencies).toEqual(prior.dependencies);
 expect(prior.dependencies.department.parts).toEqual([]);
 const pool=new Pool({connectionString:connection,max:1});
 try{const references=(await pool.query('select care_organization.ward_department_references($1,$2::jsonb,$3) r',['maker',JSON.stringify([prior.departmentId]),'NORTH'])).rows[0].r,reference=references.find((r:{id:string})=>r.id===prior.id);expect(reference.originalDigest).toBe(prior.originalDigest);expect(reference.acceptedVersions).toEqual(prior.expectedParts);}
 finally{await pool.end();}
});
test('a mismatched input digest and a service reviewer cannot approve Ward publication',async()=>{
 const b=await f.endpoint(),v=await f.input([f.entry(b)]),i=await f.owner.stage('maker',v),proof=f.verification(v,i);
 await expect(f.owner.verify('reviewer',{...proof,inputDigest:'f'.repeat(64)})).rejects.toThrow('STALE_VALIDATION');await f.owner.verify('reviewer',proof);
 const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:i.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});
 peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='SERVICE' WHERE code='reviewer';");try{await expect(f.owner.approveApplyUnit('reviewer',c)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,"UPDATE vnext_control.actor SET principal_kind='HUMAN' WHERE code='reviewer';");}
 await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);expect((await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId})).status).toBe('COMMITTED');
});
test.each(['UNCONFIRMED','SHORT_PERIOD'] as const)('receiving evidence %s cannot support a full Ward window',async kind=>{
 const b=await f.endpoint(),v=await f.input([f.entry(b)]),i=await f.owner.stage('maker',v),proof=f.verification(v,i);proof.rows[0]!.receiving={kind:'NO_SPECIAL_RESTRICTION',confirmed:kind!=='UNCONFIRMED',validFrom:'2026-01-01T00:00:00',validTo:kind==='SHORT_PERIOD'?'2026-02-01T00:00:00':null};
 await f.owner.verify('reviewer',proof);await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow(kind==='UNCONFIRMED'?'RECEIVING_BASIS_REQUIRED':'RECEIVING_PERIOD_NOT_COVERED');
});
test('expired independently accepted protected evidence cannot complete an approved Ward Apply',async()=>{
 const b=await f.endpoint(),v=await f.input([f.entry(b)]),j=await f.newJob(),artifact=await catalog.storeProtectedArtifact('maker',{scope:'SYNTHETIC',requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',purpose:'IDENTITY_VERIFY',kind:'RAW_CELL',retentionSeconds:5},Buffer.from('TEST time-bounded Ward verification material')),i=await f.owner.stage('maker',v),proof=f.verification(v,i);proof.rows[0]!.evidenceId=artifact.artifactId;
 await f.owner.verify('reviewer',proof);const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:i.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);
 const pool=new Pool({connectionString:connection,max:1});try{await pool.query("select pg_sleep(greatest(0,extract(epoch from $1::timestamp-timezone('Asia/Shanghai',clock_timestamp())))+0.05)",[artifact.expiresAt]);}finally{await pool.end();}
 await expect(f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId})).rejects.toThrow();expect(await f.owner.resumeOutcome('maker',{candidateId:c.candidateId,requestId})).toBeNull();expect((await f.owner.list('maker',{campus:'NORTH',campusId:b.campus.id})).items).toHaveLength(0);
});
test('admission and recorded Ward facts use one database-issued transaction R',async()=>{
 const b=await f.endpoint(),value=await f.input([f.entry(b)]),port=wardUpstreamPorts(f.base.owner),observed:string[]=[],owner=openWard(connection,provider,{...port,async admit(s,a,input){observed.push(input.recordAsOf!);return port.admit(s,a,input);}});
 try{const i=await owner.stage('maker',value);await owner.verify('reviewer',f.verification(value,i));const requestId=randomUUID(),c=await owner.plan('maker',{inputId:i.inputId,requestId});await owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await owner.approveApplyUnit('reviewer',c);observed.length=0;const outcome=await owner.applyUnit('maker',{candidateId:c.candidateId,requestId});if(outcome.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const h=await owner.history('maker',{id:outcome.facts[0]!.id});expect(observed.length).toBeGreaterThan(0);expect([...new Set(observed)]).toEqual([h.versions[0]!.recordedAt]);expect(h.bindings[0]!.versions[0]!.recordedAt).toBe(h.versions[0]!.recordedAt);
 }finally{await owner.close();}
});
