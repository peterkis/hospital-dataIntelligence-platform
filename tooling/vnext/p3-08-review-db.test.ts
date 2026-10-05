import {beforeAll,afterAll,test,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID,createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {openCatalog,openParameterValues,canonicalPlan,planBinding} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {capabilityFixture} from './p3-08-fixture.js';
import {validationKeys} from './p3-08-validation-keys.mjs';
import {peer,quote} from './lineage.mjs';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!,receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8')),provider=validationKeys(receipt);
let catalog:Awaited<ReturnType<typeof openCatalog>>,caps:Awaited<ReturnType<typeof capabilityFixture>>,values:ReturnType<typeof openParameterValues>,role:string;
beforeAll(async()=>{catalog=await openCatalog(connection,provider);const pool=new Pool({connectionString:connection,max:1});try{role=(await pool.query('select current_user r')).rows[0].r;caps=await capabilityFixture(receipt,role,catalog,provider,connection);values=openParameterValues(connection);}finally{await pool.end();}});
afterAll(async()=>{await values?.close();await caps?.close();await catalog?.close();});

async function parameter(scope:Awaited<ReturnType<typeof caps.endpoint>>,f=caps){
 const d=await catalog.parameterCommand('maker',{action:'CREATE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_PARAMETER',systemVersionId:f.contract.definition.sourceVersionId!,parameterKey:'REVIEW_'+randomUUID().replaceAll('-','').toUpperCase(),group:'CARE',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'BOOLEAN',enumValues:[],description:'TEST POLICY ONLY reviewed temporal gate'},validFrom:'2026-01-01T00:00:00',validTo:null});
 await catalog.parameterCommand('reviewer',{action:'APPROVE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_PARAMETER',target:d.id,versionId:d.versionId,reviewDigest:d.reviewDigest});
 const draft=await values.command('maker',{action:'CREATE',requestId:randomUUID(),reason:'TEST exact reviewed gate',definitionVersionId:d.versionId,definitionDigest:d.reviewDigest,applicability:scope,value:{type:'BOOLEAN',value:true},purpose:'BOOLEAN_GATE_V1',validFrom:'2026-01-01T00:00:00',validTo:null,evidenceId:f.artifact.artifactId});
 const approved=await values.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST independent gate review',target:draft.id,versionId:draft.versionId,reviewDigest:draft.reviewDigest});return {d,approved};
}

async function restrictedApply(request:Awaited<ReturnType<typeof caps.prepare>>,candidate:Awaited<ReturnType<typeof caps.owner.readApplyCandidate>>){
 const value=candidate.unit.commands[0]!.value;
 const pool=new Pool({connectionString:connection,max:1}),client=await pool.connect(),key=Buffer.from(planBinding(provider,'CAPABILITY_SQL_AUTHORITY_V1',{}),'hex');
 try{await client.query('BEGIN');const transaction=(await client.query('select pg_current_xact_id()::text v')).rows[0].v,point=(await client.query('select care_organization.capability_record_time() r')).rows[0].r;
  const ticket=canonicalPlan({operation:'APPLY',actor:'maker',transaction,inputId:value['inputId'],writes:JSON.parse(value['writes']!),writeIndex:1,writesDigest:value['writesDigest'],candidateId:request.candidateId,digest:candidate.digest,...point});
  const result=await client.query('select care_organization.capability_mutate($1,$2)',[ticket,createHmac('sha256',key).update(ticket).digest('hex')]).then(()=> 'AUTHORIZED',(error:Error)=>error.message);
  return result;
 }finally{await client.query('ROLLBACK');client.release();await pool.end();key.fill(0);}
}

test('restricted SQL rejects a frozen grant after a covering Unit revision',async()=>{
 const scope=await caps.endpoint(),request=await caps.prepare(await caps.input([caps.entry(scope)])),candidate=await caps.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId});
 const unit=await caps.base.owner.history('maker',{id:scope.unit.id}),binding=unit.bindings[0]!.versions[0]!.binding,original=unit.versions[0]!.facts;
 await caps.base.apply(await caps.base.input([{action:'REVISE',target:{owner:'care-organization/unit',id:unit.id,expectedHead:'1'},row:{...caps.base.row(binding),unit_id:original.source.sourceAlias,unit_code:original.unitCode,unit_name:'TEST covering Unit revision'},reason:'TEST changed frozen Unit dependency',evidenceId:caps.base.artifact.artifactId}]));
 expect(await restrictedApply(request,candidate)).toBe('STALE_VALIDATION');
 expect((await caps.owner.list('maker',{campus:'NORTH',unitId:unit.id})).items).toHaveLength(0);
});

test('restricted SQL admits an unchanged frozen basis and rejects a still-covering source replacement',async()=>{
 const command=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'TEST_PARAMETER_SOURCE',...extra});
 const publish=async(d:{id:string;head:string})=>{const s=await catalog.command('maker',command('SUBMIT',{target:d.id,expectedHead:d.head})),impact=await catalog.sourceImpact('reviewer','SYNTHETIC',d.id,'PUBLISH');return catalog.command('reviewer',command('PUBLISH',{target:d.id,expectedHead:s.head,reviewDigest:s.reviewDigest,impactDigest:impact.impactDigest}));};
 const source=await publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'REVIEW_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'TEST frozen source',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST_OWNER',technicalRole:'TEST',sourceEvidence:caps.base.dep.source.id},validFrom:'2026-01-01T00:00:00',validTo:null})));
 const f=await capabilityFixture(receipt,role,catalog,provider,connection,caps.base,false,{...source,validFrom:'2026-01-01T00:00:00',validTo:null});
 try{const scope=await f.endpoint(),request=await f.prepare(await f.input([f.entry(scope)])),candidate=await f.owner.readApplyCandidate('reviewer',{candidateId:request.candidateId});
  expect(await restrictedApply(request,candidate)).toBe('AUTHORIZED');
  const head=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===source.id)!.head;
  await publish(await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:head,values:{name:'TEST covering replacement source'},validFrom:'2026-01-01T00:00:00',validTo:null})));
  expect(await restrictedApply(request,candidate)).toBe('STALE_VALIDATION');
  expect((await f.owner.list('maker',{campus:'NORTH',unitId:scope.unit.id})).items).toHaveLength(0);
 }finally{await f.close();}
});

test('an unreadable unapproved revision cannot poison an approved exact parameter pin or capability history',async()=>{
 const command=<A extends string>(action:A,extra:Record<string,unknown>={})=>({action,scope:'SYNTHETIC' as const,requestId:randomUUID(),reason:'TEST_PARAMETER_SOURCE',...extra});
 const publish=async(d:{id:string;head:string})=>{const s=await catalog.command('maker',command('SUBMIT',{target:d.id,expectedHead:d.head})),impact=await catalog.sourceImpact('reviewer','SYNTHETIC',d.id,'PUBLISH');return catalog.command('reviewer',command('PUBLISH',{target:d.id,expectedHead:s.head,reviewDigest:s.reviewDigest,impactDigest:impact.impactDigest}));};
 const createSource=async(parent:string)=>publish(await catalog.command('maker',command('CREATE',{kind:'SOURCE',code:'REVIEW_'+randomUUID().replaceAll('-','').toUpperCase(),values:{name:'TEST exact source authority',environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'SYNTHETIC_ALL',businessOwnerRole:'TEST_OWNER',technicalRole:'TEST',sourceEvidence:parent},validFrom:'2026-01-01T00:00:00',validTo:null})));
 const source=await createSource(caps.base.dep.source.id);
 const f=await capabilityFixture(receipt,role,catalog,provider,connection,caps.base,false,{...source,validFrom:'2026-01-01T00:00:00',validTo:null});let futureFixture:Awaited<ReturnType<typeof capabilityFixture>>|undefined;
 try{
  const scope=await f.endpoint(),{d,approved}=await parameter(scope,f),pin={owner:'governance-catalog/parameter-value' as const,parameterId:approved.parameterId,valueId:approved.id,versionId:approved.versionId,definitionVersionId:d.versionId,definitionDigest:d.reviewDigest,valueDigest:approved.reviewDigest};
  const entry=f.entry(scope);entry.row.valid_to='2026-07-01T00:00:00';entry.row.rule_ref=approved.parameterId;entry.rule={kind:'BOOLEAN_GATE_V1',parameter:pin};
  const applied=await f.apply(await f.input([entry])),id=applied.facts[0]!.id,before=await f.owner.history('maker',{id});
  const newParent=await createSource(caps.base.dep.source.id),head=(await catalog.read('maker',{scope:'SYNTHETIC'})).items.find(i=>i.id===source.id)!.head;
  const revised=await publish(await catalog.command('maker',command('REVISE',{target:source.id,expectedHead:head,values:{sourceEvidence:newParent.id},validFrom:'2026-10-01T00:00:00',validTo:null})));
  const definition=await catalog.parameterCommand('maker',{action:'REVISE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_PARAMETER',target:d.id,expectedCurrentVersion:d.versionId,systemVersionId:revised.versionId,group:'CARE',campus:'SYNTHETIC_ALL',definition:{kind:'VALUE_SCHEMA_V1',valueType:'BOOLEAN',enumValues:[],description:'TEST POLICY ONLY future draft source'},validFrom:'2026-10-01T00:00:00',validTo:null});
  await catalog.parameterCommand('reviewer',{action:'APPROVE',scope:'SYNTHETIC',requestId:randomUUID(),reason:'TEST_PARAMETER',target:d.id,versionId:definition.versionId,reviewDigest:definition.reviewDigest});
  futureFixture=await capabilityFixture(receipt,role,catalog,provider,connection,caps.base,false,{...revised,validFrom:'2026-10-01T00:00:00',validTo:null});
  const draft=await values.command('maker',{action:'REVISE',requestId:randomUUID(),reason:'TEST unapproved future actual value',target:approved.id,expectedHead:'1',definitionVersionId:definition.versionId,definitionDigest:definition.reviewDigest,value:{type:'BOOLEAN',value:false},purpose:'BOOLEAN_GATE_V1',validFrom:'2026-10-01T00:00:00',validTo:null,evidenceId:futureFixture.artifact.artifactId});
  peer(receipt.name,`DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(newParent.id)}::uuid AND permission='READ';`);
  await expect(values.read('maker',{id:approved.id,versionId:draft.versionId})).rejects.toThrow('ACCESS_DENIED');
  expect(await values.read('maker',{id:approved.id,versionId:approved.versionId})).toEqual(approved);
  expect(await f.owner.history('maker',{id})).toEqual(before);
  expect(await values.evaluateWindow('maker',{id:approved.id,versionId:approved.versionId,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00'})).toMatchObject({covered:true,reason:'SATISFIED',item:{versionId:approved.versionId}});
  await expect(values.read('outsider',{id:approved.id,versionId:approved.versionId})).rejects.toThrow('ACCESS_DENIED');
 }finally{await futureFixture?.close();await f.close();}
});

test('future approved parameter revisions leave earlier complete windows usable and never restore an expired latest value',async()=>{
 const scope=await caps.endpoint(),{d,approved}=await parameter(scope);
 const revision=await values.command('maker',{action:'REVISE',requestId:randomUUID(),reason:'TEST future approved gate',target:approved.id,expectedHead:'1',definitionVersionId:d.versionId,definitionDigest:d.reviewDigest,value:{type:'BOOLEAN',value:false},purpose:'BOOLEAN_GATE_V1',validFrom:'2027-01-01T00:00:00',validTo:null,evidenceId:caps.base.artifact.artifactId});
 const future=await values.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST independent future policy',target:revision.id,versionId:revision.versionId,reviewDigest:revision.reviewDigest});
 expect(await values.evaluateWindow('maker',{id:approved.id,versionId:approved.versionId,validFrom:'2026-02-01T00:00:00',validTo:'2026-03-01T00:00:00'})).toMatchObject({covered:true,reason:'SATISFIED',item:{versionId:approved.versionId}});
 expect(await values.evaluateWindow('maker',{id:approved.id,versionId:approved.versionId,validFrom:'2026-12-31T23:59:59.999999',validTo:'2027-01-01T00:00:00.000001'})).toMatchObject({covered:false,reason:'PARAMETER_ADOPTION_CHANGED'});
 expect(await values.evaluateWindow('maker',{id:approved.id,versionId:future.versionId,validFrom:'2027-02-01T00:00:00',validTo:'2027-03-01T00:00:00'})).toMatchObject({covered:true,item:{versionId:future.versionId}});
 const finite=await values.command('maker',{action:'REVISE',requestId:randomUUID(),reason:'TEST finite latest gate',target:approved.id,expectedHead:'2',definitionVersionId:d.versionId,definitionDigest:d.reviewDigest,value:{type:'BOOLEAN',value:true},purpose:'BOOLEAN_GATE_V1',validFrom:'2027-06-01T00:00:00',validTo:'2027-07-01T00:00:00',evidenceId:caps.base.artifact.artifactId});
 await values.command('reviewer',{action:'APPROVE',requestId:randomUUID(),reason:'TEST independent finite policy',target:finite.id,versionId:finite.versionId,reviewDigest:finite.reviewDigest});
 expect(await values.evaluateWindow('maker',{id:approved.id,validFrom:'2027-08-01T00:00:00',validTo:null})).toMatchObject({covered:false,reason:'PARAMETER_PERIOD_NOT_COVERED',item:{versionId:finite.versionId}});
});
