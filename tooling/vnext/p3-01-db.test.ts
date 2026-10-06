import {test,expect,afterAll} from 'vitest';
import {readFileSync} from 'node:fs';
import {openCatalog,canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-01-validation-keys.mjs';
import {businessUnitFixture} from './p3-01-fixture.js';
import {Pool,Client,type QueryConfig} from 'pg';
import type {UnitEntry,UnitHistory,UnitBindingInput} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {randomUUID,createHmac} from 'node:crypto';
import {openCampus,type CampusCommand} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.js';
import {withBusinessUnitImpacts} from '../../apps/governance-api/src/composition/business-unit-dependencies.js';
import {peer,quote} from './lineage.mjs';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createBusinessUnitClient} from '../../packages/generated-api-client/src/index.js';
import {ORG07_FIELDS,type UnitReceive} from '../../apps/governance-api/src/modules/care-organization/index.js';
import {organizationWorkbook} from './organization-workbook-fixture.js';
const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),provider=validationKeys(receipt),catalog=await openCatalog(connection,provider);
const p=new Pool({connectionString:connection,max:1}),role=(await p.query('select current_user r')).rows[0].r;await p.end();
const f=await businessUnitFixture(receipt,role,catalog,provider,connection,process.env['VNEXT_P3_01_POPULATED']==='1');
afterAll(async()=>{await f.close();await catalog.close();});
test('P3-01 CORE keeps an empty responsible person pending and publishes real unit identity',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),value=await f.input([f.entry(a)]),outcome=await f.apply(value),id=outcome.facts[0]!.id;
 expect(await f.owner.read('maker',{id,businessAt:'2026-04-01T00:00:00'})).toMatchObject({id,departmentId:d,state:'ACTIVE',clinicalReadiness:'NOT_READY',version:{facts:{responsibilityStatus:'PENDING'}}});
 expect(id).not.toBe(value.entries[0]!.row.unit_id);expect((await f.owner.history('maker',{id})).bindings).toHaveLength(1);
});
test('independent receiving verification must cover exactly every input row',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),value=await f.input([f.entry(a),f.entry(a)]),i=await f.owner.stage('maker',value);
 for(const numbers of [[2,3],[1,1],[1],[1,2,3]]){const proof=f.verification(value,i);proof.rows=numbers.map(n=>({...proof.rows[0]!,row:n}));await expect(f.owner.verify('reviewer',proof)).rejects.toThrow('VERIFICATION_ROW_MISMATCH');}
 expect((await f.owner.preview('maker',{inputId:i.inputId})).decision).toBe('BLOCKED');await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow();expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);
 const correct=f.verification(value,i);correct.rows.reverse();await f.owner.verify('reviewer',correct);const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:i.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);const outcome=await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId});expect(outcome.status).toBe('COMMITTED');if(outcome.status!=='COMMITTED')throw new Error();for(const fact of outcome.facts)expect((await f.owner.exact('maker',{id:fact.id,version:fact.version})).facts.receivingBasis).not.toBeNull();
});
async function populated(){const d=await f.newDepartment(),a=await f.endpoint(d),outcome=await f.apply(await f.input([f.entry(a)])),h=await f.owner.history('maker',{id:outcome.facts[0]!.id});return {d,a,h};}
function revision(h:UnitHistory,action:'REVISE'|'CLOSE'|'REBIND',at='2026-06-01T00:00:00',destination?:UnitBindingInput):UnitEntry{
 const v=h.versions.at(-1)!,binding=destination??h.bindings.find(b=>{const v=b.versions.at(-1)!;return v.validFrom<=at&&(v.validTo===null||at<v.validTo);})!.versions.at(-1)!.binding;
 const row={...f.row(binding),unit_id:v.facts.source.sourceAlias,unit_code:v.facts.unitCode,unit_name:v.facts.unitName,unit_type:v.facts.unitType,public_phone:v.facts.publicPhone??'',service_description:v.facts.serviceDescription??'',receiving_rule_ref:v.facts.receivingRuleReference??'',valid_from:at,record_status:action==='CLOSE'?'RETIRED':'ACTIVE'};
 const common={target:{owner:'care-organization/unit' as const,id:h.id,expectedHead:v.number},row,reason:'TEST explicit unit change',evidenceId:f.artifact.artifactId};return action==='REBIND'?{...common,action,binding}:{...common,action};
}
test('P3-01-AC-04 cross-campus rebind preserves unit and Department IDs and old R',async()=>{
 const {d,a,h}=await populated(),b=await f.endpoint(d);await f.apply(await f.input([revision(h,'REBIND','2026-06-01T00:00:00',b)]));
 const now=await f.owner.history('maker',{id:h.id});expect(now.bindings).toHaveLength(2);
 expect(await f.owner.read('maker',{id:h.id,businessAt:'2026-05-31T23:59:59.999999'})).toMatchObject({id:h.id,departmentId:d,binding:{binding:{campus:a.campus}}});
 expect(await f.owner.read('maker',{id:h.id,businessAt:'2026-06-01T00:00:00'})).toMatchObject({id:h.id,departmentId:d,binding:{binding:{campus:b.campus}}});
 expect(await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00',recordAsOf:h.versions[0]!.recordedAt})).toMatchObject({id:h.id,binding:{binding:{campus:a.campus}}});
});
test('real Unit Owner references participate in Department and Campus impact assessment',async()=>{
 const {d,a,h}=await populated(),campus=openCampus(connection,provider,{readInTransaction:f.owner.readCampusDependenciesInTransaction}),evolution=openOrganizationEvolutions(connection,provider,withBusinessUnitImpacts(()=>f.owner));
 try{
  const impact=await campus.assessCampusImpact('maker',{id:a.campus.id,validFrom:'2026-06-01T00:00:00',validTo:null});expect(impact.unavailable).not.toContain('BUSINESS_UNIT');expect(impact.dependencies).toContainEqual(expect.objectContaining({owner:'BUSINESS_UNIT',id:h.bindings[0]!.id,outstanding:true}));
  const j=await f.dep.newJob(),i=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:d,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:'2026-06-01T00:00:00',reason:'TEST upstream change',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts});
  const assessment=await evolution.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST finite unit impact',target:{kind:'INPUT',id:i.inputId}});
  expect(assessment.coverage).toContainEqual({owner:'BUSINESS_UNIT',status:'EVALUATED',reason:'OWNER_AVAILABLE'});expect(assessment.references).toContainEqual(expect.objectContaining({owner:'BUSINESS_UNIT',id:h.id,constraint:'UNSATISFIED'}));expect(assessment.coverage).toContainEqual({owner:'PERSONNEL',status:'NOT_EVALUABLE',reason:'OWNER_NOT_IMPLEMENTED'});
 }finally{await campus.close();await evolution.close();}
});
test('original accepted request and old R authorize their original campus after a later rebind',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),input=await f.input([f.entry(a)]),request=await f.prepare(input),original=await f.owner.applyUnit('maker',request);if(original.status!=='COMMITTED')throw new Error('COMMIT_UNKNOWN');const h=await f.owner.history('maker',{id:original.facts[0]!.id}),b=await f.endpoint(d);await f.apply(await f.input([revision(h,'REBIND','2026-06-01T00:00:00',b)]));
 peer(receipt.name,`DELETE FROM care_organization.access WHERE actor='maker' AND campus_id=${quote(b.campus.id)}::uuid AND permission='READ';`);
 try{
  expect(await f.owner.applyUnit('maker',request)).toEqual(original);
  expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00',recordAsOf:h.versions[0]!.recordedAt})).binding!.binding.campus).toEqual(a.campus);
  expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d,businessAt:'2026-07-01T00:00:00',recordAsOf:h.versions[0]!.recordedAt})).items[0]!.binding!.binding.campus).toEqual(a.campus);
  expect(await f.owner.reconcileCommittedUnit('maker',request)).toMatchObject({status:'MATCHED'});
  await expect(f.owner.history('maker',{id:h.id})).rejects.toThrow('ACCESS_DENIED');
 }finally{peer(receipt.name,`INSERT INTO care_organization.access VALUES('maker',${quote(b.campus.id)}::uuid,'NORTH','READ') ON CONFLICT DO NOTHING;`);}
});
test('an earlier rebind does not overwrite an already scheduled future property revision',async()=>{
 const {d,a,h}=await populated(),scheduled=revision(h,'REVISE','2026-10-01T00:00:00');scheduled.row.unit_name='TEST future approved name';await f.apply(await f.input([scheduled]));
 const current=await f.owner.history('maker',{id:h.id}),destination=await f.endpoint(d),move=revision(current,'REBIND','2026-06-01T00:00:00',destination);move.row.unit_name=h.versions[0]!.facts.unitName;await f.apply(await f.input([move]));
 expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00'})).version!.facts.unitName).toBe('TEST 同名业务单元');
 expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-11-01T00:00:00'})).version!.facts.unitName).toBe('TEST future approved name');expect(a.campus.id).not.toBe(destination.campus.id);
});
test('P3-01-AC-01 same Department has independent A/B units and multiple units on one campus',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),b=await f.endpoint(d),ea=f.entry(a),eb=f.entry(b),ipd=f.entry(a);ea.row.public_phone='TEST-A';eb.row.public_phone='TEST-B';ipd.row.unit_type='IPD';
 const result=await f.apply(await f.input([ea,eb,ipd]));expect(new Set(result.facts.map(v=>v.id)).size).toBe(3);
 const list=await f.owner.list('maker',{campus:'NORTH',departmentId:d,businessAt:'2026-04-01T00:00:00'});expect(list.items).toHaveLength(3);expect(list.items.map(i=>i.version!.facts.publicPhone)).toEqual(expect.arrayContaining(['TEST-A','TEST-B']));
});
test('P3-01-AC-02 a row cannot borrow another campus operating/license context',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),b=await f.endpoint(d),entry=f.entry(a);entry.row.campus_id=b.campus.id;
 await expect(f.prepare(await f.input([entry]))).rejects.toThrow('UNIT_ANCHOR_MISMATCH');expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);
});
test('P3-01-AC-03 nonempty unready responsible Person is retained and blocks CORE',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),entry=f.entry(a);entry.row.business_owner_id='TEST_PERSON_NOT_READY';const value=await f.input([entry]),i=await f.owner.stage('maker',value);await f.owner.verify('reviewer',f.verification(value,i));
 expect((await f.owner.readInput('maker',{inputId:i.inputId})).entries[0]!.row.business_owner_id).toBe('TEST_PERSON_NOT_READY');expect((await f.owner.preview('maker',{inputId:i.inputId})).issues).toContainEqual({row:1,field:'business_owner_id',code:'BLOCKED_DEPENDENCY',status:'BLOCKED'});
 await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);
});
test('FULL is retained without downgrade and aliases cannot independently verify',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),value={...await f.input([f.entry(a)]),profile:'FULL' as const},i=await f.owner.stage('maker',value);
 await expect(f.owner.verify('maker-alias',f.verification(value,i))).rejects.toThrow();await f.owner.verify('reviewer',f.verification(value,i));expect((await f.owner.readInput('maker',{inputId:i.inputId})).profile).toBe('FULL');await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('BLOCKED_DEPENDENCY');
});
test('receiving absence needs independent confirmation and a restricted reference freezes exact evidence',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),entry=f.entry(a),value=await f.input([entry]),i=await f.owner.stage('maker',value),verification=f.verification(value,i);verification.rows[0]!.receiving={kind:'UNKNOWN'};await f.owner.verify('reviewer',verification);await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('RECEIVING_BASIS_REQUIRED');
 const restricted=f.entry(a);restricted.row.receiving_rule_ref='TEST_RULE_AGE';const v=await f.input([restricted]),s=await f.owner.stage('maker',v),proof=f.verification(v,s);proof.rows[0]!.receiving={kind:'RESTRICTED_RULE_REFERENCE',ruleReference:'TEST_RULE_AGE',sourceRuleVersion:'TEST_RULE_V1',ruleEvidenceId:f.artifact.artifactId,validFrom:'2026-01-01T00:00:00',validTo:null};await f.owner.verify('reviewer',proof);
 const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:s.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);const result=await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId});if(result.status!=='COMMITTED')throw new Error();expect((await f.owner.exact('maker',{id:result.facts[0]!.id,version:'1'})).facts.receivingBasis).toMatchObject({source:{kind:'RESTRICTED_RULE_REFERENCE',sourceRuleVersion:'TEST_RULE_V1'}});
});
test('nonexpanding terminal closure survives upstream suspension and preserves history and code',async()=>{
 const {d,a,h}=await populated(),j=await f.dep.newJob(),i=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:j.id,revisionId:j.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:d,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:'2026-06-01T00:00:00',reason:'TEST suspension',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts.map(impact=>({...impact,determination:['IDENTIFIER','SOURCE_MAPPING','HIERARCHY'].includes(impact.domain)?'AFFECTED' as const:impact.determination}))});
 await f.lifecycle.verify('reviewer',{requestId:randomUUID(),inputId:i.inputId,inputDigest:i.digest,reason:'TEST explicit pending dispositions',policyApproved:true,materialsAccepted:true,impactReviews:f.impactReviews});const requestId=randomUUID(),c=await f.lifecycle.plan('maker',{inputId:i.inputId,requestId});await f.lifecycle.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.lifecycle.approveApplyUnit('reviewer',c);const lifecycleResult=await f.lifecycle.applyUnit('maker',{candidateId:c.candidateId,requestId});if(lifecycleResult.status!=='COMMITTED')throw new Error();
 const evolution=openOrganizationEvolutions(connection,provider,withBusinessUnitImpacts(()=>f.owner));
 try{
  const item=(await evolution.listImpactCases('maker',{eventId:lifecycleResult.facts[0]!.id,campus:'NORTH'})).items.find(v=>v.obligation.owner==='BUSINESS_UNIT')!;expect(item.status).toBe('OPEN');
  const draft=await catalog.command('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',kind:'RESPONSIBILITY',code:'UNIT_IMPACT_'+randomUUID().replaceAll('-','').toUpperCase(),values:{dataset:'ORG07',authorityScope:'ALL',fieldGroup:'ALL',role:'OWNER',assigneeRole:'SYNTHETIC_OWNER_A'},validFrom:'2026-01-01T00:00:00'}),submitted=await catalog.command('maker',{action:'SUBMIT',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:draft.head}),r=await catalog.command('reviewer',{action:'PUBLISH',scope:'SYNTHETIC',requestId:randomUUID(),reason:'RESPONSIBILITY',target:draft.id,expectedHead:submitted.head,reviewDigest:submitted.reviewDigest});
  const assigned=await evolution.assignImpactCase('maker',{requestId:randomUUID(),reason:'TEST unit Owner',caseId:item.id,campus:'NORTH',expectedHead:item.head,responsibilityId:r.id});
  const closeRequest=await f.prepare(await f.input([revision(h,'CLOSE')])),result=await f.owner.applyUnit('maker',closeRequest);expect(result.status).toBe('COMMITTED');const v=(await f.owner.history('maker',{id:h.id})).versions.at(-1)!,proof={owner:'BUSINESS_UNIT' as const,id:h.id,versionId:v.id,...closeRequest};
  await expect(evolution.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST forged result',caseId:item.id,campus:'NORTH',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.dep.artifact.artifactId,result:{...proof,requestId:randomUUID()}}})).rejects.toThrow();
  const proposed=await evolution.recordDisposition('maker',{requestId:randomUUID(),reason:'TEST committed closure',caseId:item.id,campus:'NORTH',expectedHead:assigned.head,disposition:{kind:'CLOSE_RELATION',evidenceId:f.dep.artifact.artifactId,result:proof}}),approved=await evolution.approveDisposition('reviewer',{requestId:randomUUID(),reason:'TEST independent result',caseId:item.id,campus:'NORTH',expectedHead:proposed.head,proposalEventId:proposed.eventId});expect((await evolution.recheckImpact('maker',{requestId:randomUUID(),reason:'TEST result recheck',caseId:item.id,campus:'NORTH',expectedHead:approved.head})).status).toBe('RESOLVED');
 }finally{await evolution.close();}
 expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00'})).state).toBe('CLOSED');expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-07-01T00:00:00',recordAsOf:h.versions[0]!.recordedAt})).state).toBe('ACTIVE');
 const closed=await f.owner.history('maker',{id:h.id});await expect(f.prepare(await f.input([revision(closed,'REVISE')]))).rejects.toThrow('UNIT_CLOSED');const duplicate=f.entry(a);duplicate.row.unit_code=h.versions[0]!.facts.unitCode;await expect(f.prepare(await f.input([duplicate]))).rejects.toThrow('UNIT_CODE_CONFLICT');
});
test('a closure before scheduled future revision masks it permanently',async()=>{
 const {h}=await populated(),future=revision(h,'REVISE','2027-01-01T00:00:00');future.row.unit_name='TEST FUTURE';await f.apply(await f.input([future]));const current=await f.owner.history('maker',{id:h.id}),close=revision(current,'CLOSE');close.row.unit_name=h.versions[0]!.facts.unitName;await f.apply(await f.input([close]));expect((await f.owner.read('maker',{id:h.id,businessAt:'2027-02-01T00:00:00'})).state).toBe('CLOSED');
});
test('permanent closure masks scheduled future bindings in lists and window admission while old R retains them',async()=>{
 const {d,a,h}=await populated(),destination=await f.endpoint(d),future='2030-01-01T00:00:00';await f.apply(await f.input([revision(h,'REBIND',future,destination)]));const scheduled=await f.owner.history('maker',{id:h.id}),asOf=scheduled.versions.at(-1)!.recordedAt;
 await f.apply(await f.input([revision(scheduled,'CLOSE')]));const current=await f.owner.history('maker',{id:h.id});expect(current.bindings).toHaveLength(2);expect(current.bindings.find(b=>b.campusId===destination.campus.id)!.versions).toEqual(scheduled.bindings.find(b=>b.campusId===destination.campus.id)!.versions);
 expect((await f.owner.list('maker',{campus:'NORTH',campusId:destination.campus.id,businessAt:future})).items).toHaveLength(0);expect((await f.owner.evaluateWindow('maker',{id:h.id,validFrom:future,validTo:null})).checks).toHaveLength(0);
 expect((await f.owner.list('maker',{campus:'NORTH',campusId:destination.campus.id,businessAt:future,recordAsOf:asOf})).items).toContainEqual(expect.objectContaining({id:h.id,binding:expect.objectContaining({binding:expect.objectContaining({campus:destination.campus})})}));expect((await f.owner.evaluateWindow('maker',{id:h.id,validFrom:future,validTo:null,recordAsOf:asOf})).checks).toContainEqual(expect.objectContaining({status:'SATISFIED'}));
 expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-05-01T00:00:00'})).binding!.binding.campus).toEqual(a.campus);
});
test('concurrent permanent-code claims and same-head updates allow only one commit',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),first=f.entry(a),second=f.entry(a);second.row.unit_code=first.row.unit_code;const x=await f.prepare(await f.input([first])),y=await f.prepare(await f.input([second])),results=await Promise.allSettled([f.owner.applyUnit('maker',x),f.owner.applyUnit('maker',y)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(1);
 const committed=results.find(r=>r.status==='fulfilled');if(committed?.status!=='fulfilled'||committed.value.status!=='COMMITTED')throw new Error();const h=await f.owner.history('maker',{id:committed.value.facts[0]!.id}),r1=revision(h,'REVISE'),r2=revision(h,'REVISE');r1.row.unit_name='TEST ONE';r2.row.unit_name='TEST TWO';const p1=await f.prepare(await f.input([r1])),p2=await f.prepare(await f.input([r2])),updates=await Promise.allSettled([f.owner.applyUnit('maker',p1),f.owner.applyUnit('maker',p2)]);expect(updates.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await f.owner.history('maker',{id:h.id})).versions).toHaveLength(2);
});
test('a failed audit rolls back the whole multi-unit revision and retry creates exactly one set',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),request=await f.prepare(await f.input([f.entry(a),f.entry(a)]));peer(receipt.name,"CREATE FUNCTION care_organization.test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='UNIT_CREATE' THEN RAISE EXCEPTION 'TEST_ATOMIC_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER test_audit_failure BEFORE INSERT ON vnext_control.audit FOR EACH ROW EXECUTE FUNCTION care_organization.test_audit_failure();");
 try{await expect(f.owner.applyUnit('maker',request)).rejects.toThrow('APPLY_FAILED');expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);expect(await f.owner.resumeOutcome('maker',request)).toBeNull();}finally{peer(receipt.name,'DROP TRIGGER test_audit_failure ON vnext_control.audit;DROP FUNCTION care_organization.test_audit_failure();');}
 const result=await f.owner.applyUnit('maker',request);expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error();expect(result.facts).toHaveLength(2);expect(await f.owner.applyUnit('maker',request)).toEqual(result);
});
test('restricted SQL cannot read/write tables or forge a mutation, and explicit withdrawal prevents publication',async()=>{
 const pool=new Pool({connectionString:connection});try{await expect(pool.query('SELECT * FROM care_organization.version')).rejects.toMatchObject({code:'42501'});await expect(pool.query("select care_organization.mutate('{}','bad')")).rejects.toMatchObject({message:'ACCESS_DENIED'});}finally{await pool.end();}
 const d=await f.newDepartment(),a=await f.endpoint(d),value=await f.input([f.entry(a)]),i=await f.owner.stage('maker',value),request={inputId:i.inputId,requestId:randomUUID()};expect(await f.owner.withdraw('maker',request)).toEqual({inputId:i.inputId,status:'WITHDRAWN'});expect(await f.owner.withdraw('maker',request)).toEqual({inputId:i.inputId,status:'WITHDRAWN'});await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('INPUT_WITHDRAWN');expect((await f.owner.readInput('maker',{inputId:i.inputId})).entries).toHaveLength(1);
});
test('generated client executes real HTTP verification, approval, publish and exact replay',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),value=await f.input([f.entry(a)]),contexts:Parameters<typeof buildCatalogServer>=[catalog,'CONTROL_PLANE'];contexts[15]={owner:f.owner,actor:r=>actor(r.headers)};const app=await buildCatalogServer(...contexts);
 try{const url=await app.listen({host:'127.0.0.1',port:0}),maker=createBusinessUnitClient(url,'maker'),reviewer=createBusinessUnitClient(url,'reviewer'),i=await maker.stage(value);expect(i.response.status).toBe(200);if(!i.data)throw new Error();expect((await reviewer.verify(f.verification(value,i.data))).response.status).toBe(200);
  const requestId=randomUUID(),c=await maker.plan({inputId:i.data.inputId,requestId});expect(c.response.status).toBe(200);if(!c.data)throw new Error();expect((await reviewer.review({candidateId:c.data.candidateId})).response.status).toBe(200);expect((await reviewer.approve(c.data)).response.status).toBe(200);const request={candidateId:c.data.candidateId,requestId},outcome=await maker.apply(request);expect(outcome.response.status).toBe(200);expect(outcome.data?.status).toBe('COMMITTED');expect((await maker.apply(request)).data).toEqual(outcome.data);if(outcome.data?.status!=='COMMITTED')throw new Error();const id=outcome.data.facts[0]!.id;expect((await maker.query({id,businessAt:'2026-04-01T00:00:00'})).data?.clinicalReadiness).toBe('NOT_READY');expect((await maker.history({id})).data?.versions).toHaveLength(1);expect((await maker.reconcile(request)).response.status).toBe(200);expect((await createBusinessUnitClient(url,'outsider').query({id})).response.status).toBe(403);
 }finally{await app.close();}
});
test('P3-01-AC-05 only separately approved future operation admits a future unit, never early clinical use',async()=>{
 const d=await f.newDepartment(),future='2030-01-01T00:00:00',a=await f.endpoint(d,future,null,future),early=f.entry(a);await expect(f.prepare(await f.input([early]))).rejects.toThrow('UNIT_SERVICE_PERIOD_NOT_COVERED');
 const entry=f.entry(a);entry.row.valid_from=future;const outcome=await f.apply(await f.input([entry])),id=outcome.facts[0]!.id;expect(await f.owner.read('maker',{id,businessAt:'2029-12-31T23:59:59.999999'})).toMatchObject({state:'NOT_EFFECTIVE',clinicalReadiness:'NOT_READY'});expect(await f.owner.read('maker',{id,businessAt:future})).toMatchObject({state:'ACTIVE',clinicalReadiness:'NOT_READY'});
});
test.each(['JSON','CSV','XLSX'] as const)('file %s follows the same Owner and preserves all 19 fields and physical row provenance',async(format)=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),entry=f.entry(a),{row,...operation}=entry,bytes=format==='JSON'?Buffer.from(JSON.stringify([row])):format==='CSV'?Buffer.from(ORG07_FIELDS.join(',')+'\r\n'+ORG07_FIELDS.map(field=>row[field]).join(',')+'\r\n'):organizationWorkbook({ORG07:[ORG07_FIELDS,ORG07_FIELDS.map(field=>row[field])]}),input:UnitReceive={requestId:randomUUID(),fileRequestId:randomUUID(),campus:'NORTH',timePolicy:'LOCAL',retentionSeconds:7200,job:{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'SYNTHETIC_BUSINESS_UNIT',profile:'CORE',contractId:f.contract!.id,contractVersionId:f.contract!.versionId,input:{kind:'FILE',format,parserPolicy:'STRICT_UNIT_V1'}},operations:[operation]};
 const received=await f.owner.receiveFile('maker',input,bytes);expect(received.issues).toHaveLength(0);expect(received.input).not.toBeNull();if(!received.input)throw new Error();const retained=await f.owner.readInput('maker',{inputId:received.input.inputId});expect(Object.keys(retained.entries[0]!.row).sort()).toEqual([...ORG07_FIELDS].sort());expect(retained.entries[0]!.row.business_owner_id).toBe('');
 const value={...await f.input([entry]),jobId:received.jobId,revisionId:received.revisionId};await f.owner.verify('reviewer',f.verification(value,received.input));const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:received.input.inputId,requestId});await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);const outcome=await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId});expect(outcome.status).toBe('COMMITTED');
});
test('a bad final row cannot publish earlier valid rows and typed API times reject offsets',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),good=f.entry(a),bad=f.entry(a);bad.row.business_owner_id='TEST_UNKNOWN';await expect(f.prepare(await f.input([good,bad]))).rejects.toThrow('BLOCKED_DEPENDENCY');expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);
 const value=await f.input([f.entry(a)]);value.entries[0]!.row.valid_from='2026-01-01T00:00:00Z';const i=await f.owner.stage('maker',value),proof=f.verification(value,i);proof.rows[0]!.receiving={kind:'NO_SPECIAL_RESTRICTION',confirmed:true,validFrom:'2026-01-01T00:00:00',validTo:null};await f.owner.verify('reviewer',proof);await expect(f.owner.plan('maker',{inputId:i.inputId,requestId:randomUUID()})).rejects.toThrow('LOCAL_TIME_REQUIRED');
});

test('a finite unit can extend on its actual binding only with full new-period admission',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),entry=f.entry(a);entry.row.valid_to='2026-06-01T00:00:00';const o=await f.apply(await f.input([entry])),h=await f.owner.history('maker',{id:o.facts[0]!.id}),extend=revision(h,'REVISE','2026-05-01T00:00:00');extend.row.valid_to='2027-01-01T00:00:00';await f.apply(await f.input([extend]));expect((await f.owner.read('maker',{id:h.id,businessAt:'2026-12-31T23:59:59.999999'})).binding!.binding.campus).toEqual(a.campus);
 const d2=await f.newDepartment(),b=await f.endpoint(d2,'2026-01-01T00:00:00','2026-06-01T00:00:00'),limited=f.entry(b);limited.row.valid_to='2026-06-01T00:00:00';const oo=await f.apply(await f.input([limited])),hh=await f.owner.history('maker',{id:oo.facts[0]!.id}),bad=revision(hh,'REVISE','2026-05-01T00:00:00');bad.row.valid_to='2027-01-01T00:00:00';await expect(f.prepare(await f.input([bad]))).rejects.toThrow('UNIT_SERVICE_PERIOD_NOT_COVERED');expect((await f.owner.history('maker',{id:hh.id})).versions).toHaveLength(1);
});

test('a lost COMMIT acknowledgement recovers the exact durable Unit identity',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),request=await f.prepare(await f.input([f.entry(a)])),original=Client.prototype.query;let loseAck=true,injected=false;
 Client.prototype.query=(function(this:Client,config:string|QueryConfig,...args:unknown[]){const text=typeof config==='string'?config:config.text,result=Reflect.apply(original,this,[config,...args]);if(loseAck&&text.trim().toLowerCase()==='commit'){loseAck=false;injected=true;return Promise.resolve(result).then(()=>{throw Object.assign(new Error('ACK_LOST'),{code:'ECONNRESET'});});}return result;}) as typeof Client.prototype.query;
 try{expect((await f.owner.applyUnit('maker',request)).status).toBe('COMMIT_UNKNOWN');expect(injected).toBe(true);}finally{Client.prototype.query=original;}
 const recovered=await f.owner.resumeOutcome('maker',request),replay=await f.owner.applyUnit('maker',request);expect(recovered?.status).toBe('COMMITTED');expect(replay.status).toBe('COMMITTED');if(recovered?.status==='COMMITTED'&&replay.status==='COMMITTED')expect(replay.facts).toEqual(recovered.facts);expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(1);
});

test('SQL rejects approved-plan fact tampering even with a valid transaction signature',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),request=await f.prepare(await f.input([f.entry(a)])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId}),value=candidate.unit.commands[0]!.value,writes=JSON.parse(value['writes']!);writes[0].facts.unitName='TEST_UNAPPROVED';
 const p=new Pool({connectionString:connection,max:1}),client=await p.connect(),key=Buffer.from(planBinding(provider,'UNIT_SQL_AUTHORITY_V1',{}),'hex');
 try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v,ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes,writeIndex:1,writesDigest:value['writesDigest'],candidateId:request.candidateId,digest:candidate.digest});await expect(client.query('select care_organization.mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')])).rejects.toMatchObject({message:'STALE_VALIDATION'});}finally{await client.query('ROLLBACK');client.release();await p.end();key.fill(0);}
 expect((await f.owner.list('maker',{campus:'NORTH',departmentId:d})).items).toHaveLength(0);expect((await f.owner.applyUnit('maker',request)).status).toBe('COMMITTED');
});

test('current independent verification authority is rechecked after freeze',async()=>{
 const d=await f.newDepartment(),a=await f.endpoint(d),value=await f.input([f.entry(a)]),i=await f.owner.stage('maker',value);await f.owner.verify('reviewer',f.verification(value,i));const requestId=randomUUID(),c=await f.owner.plan('maker',{inputId:i.inputId,requestId});
 await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});peer(receipt.name,`DELETE FROM care_organization.access WHERE actor='reviewer' AND campus_id=${quote(a.campus.id)}::uuid AND permission='VERIFY';`);
 try{await expect(f.owner.approveApplyUnit('reviewer',c)).rejects.toThrow('ACCESS_DENIED');}finally{peer(receipt.name,`INSERT INTO care_organization.access VALUES('reviewer',${quote(a.campus.id)}::uuid,'NORTH','VERIFY');`);}
 await f.owner.readApplyCandidate('reviewer',{candidateId:c.candidateId});await f.owner.approveApplyUnit('reviewer',c);expect((await f.owner.applyUnit('maker',{candidateId:c.candidateId,requestId})).status).toBe('COMMITTED');
});

test('Campus retirement, late Unit closure, dispositions and explicit completion use one authoritative finite report',async()=>{
 const {a,h}=await populated(),campus=openCampus(connection,provider,{readInTransaction:f.owner.readCampusDependenciesInTransaction}),from='2026-06-01T00:00:00';
 const applyCampus=async(command:CampusCommand)=>{const i=await campus.stage('maker',{...f.operating.campusContext,requestId:randomUUID(),command}),requestId=randomUUID(),c=await campus.plan('maker',{inputId:i.inputId,requestId});await campus.readApplyCandidate('reviewer',{candidateId:c.candidateId});await campus.approveApplyUnit('reviewer',c);return campus.applyUnit('maker',{candidateId:c.candidateId,requestId});};
 const common={...f.operating.common,validFrom:from,evidence:f.operating.artifact.artifactId,sourceOperationStatus:'RETIRED' as const,reason:'TEST finite Campus disposition'},target=async()=>({owner:'organization-master/campus' as const,id:a.campus.id,expectedVersion:(await campus.references.history('maker',a.campus.id)).head});
 try{
  const initial=await campus.assessCampusImpact('maker',{id:a.campus.id,validFrom:from,validTo:null});expect(initial.dependencies).toContainEqual(expect.objectContaining({owner:'BUSINESS_UNIT',outstanding:true}));expect((await applyCampus({...common,action:'RETIRE',target:await target(),assessmentDigest:initial.digest,plan:{responsibleOwner:'TEST office',dueAt:'2027-01-01T00:00:00',actions:'TEST each Owner independently closes'}})).status).toBe('COMMITTED');
  await f.apply(await f.input([revision(h,'CLOSE','2026-07-01T00:00:00')]));
  const after=await campus.assessCampusImpact('maker',{id:a.campus.id,validFrom:from,validTo:null});expect(after.dependencies).toContainEqual(expect.objectContaining({owner:'BUSINESS_UNIT',active:true,outstanding:false}));expect(after.completed).toBe(false);
  for(const kind of ['RELATION','SCOPE'] as const){const records=await f.operating.operating.read('maker',{kind,mode:'LIST',subjectId:a.subject.id,campusId:a.campus.id});for(const v of records)await f.operating.operatingApply({...f.operating.common,subject:a.subject,campus:a.campus,evidence:f.operating.artifact.artifactId,validFrom:'2026-07-01T00:00:00',action:kind==='RELATION'?'CLOSE':'REVOKE_SCOPE',target:{owner:kind==='RELATION'?'organization-master/operating-relation':'organization-master/license-scope',id:v.id,expectedVersion:v.version},reason:'TEST late nonexpanding close'});}
  expect(after.unavailable).toContain('UNIT_WARD_RELATION');
  for(const owner of after.unavailable){const report=await campus.assessCampusImpact('maker',{id:a.campus.id,validFrom:from,validTo:null});expect((await applyCampus({...common,action:'RECORD_DISPOSITION',target:await target(),assessmentDigest:report.digest,resolution:{owner,status:'CLEAR',scope:'SYNTHETIC'}})).status).toBe('COMMITTED');}
  const ready=await campus.assessCampusImpact('maker',{id:a.campus.id,validFrom:from,validTo:null});expect(ready.completed).toBe(false);expect(ready.dependencies.every(d=>!d.outstanding)).toBe(true);expect((await applyCampus({...common,action:'COMPLETE_DISPOSITION',target:await target(),assessmentDigest:ready.digest})).status).toBe('COMMITTED');expect((await campus.assessCampusImpact('maker',{id:a.campus.id,validFrom:from,validTo:null})).completed).toBe(true);
 }finally{await campus.close();}
});
