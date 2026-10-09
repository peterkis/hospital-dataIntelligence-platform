import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Pool,Client,type QueryConfig} from 'pg';
import {test,expect,afterAll} from 'vitest';
import {openCatalog} from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import {validationKeys} from './p3-11-validation-keys.mjs';
import {nursingFixture} from './p3-03-fixture.js';
import {openCareLocationLifecycle} from '../../apps/governance-api/src/modules/care-organization/lifecycle-owner.js';
import {peer} from './lineage.mjs';
import {wardNursingFixture} from './p3-05-fixture.js';
import {wardFixture} from './p3-02-fixture.js';
import {openOrganizationEvolutions} from '../../apps/governance-api/src/modules/department-master/index.js';
import {withCareOrganizationImpacts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.js';
import {openCampus} from '../../apps/governance-api/src/modules/organization-master/index.js';
import {openLocation} from '../../apps/governance-api/src/modules/location-master/index.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {actor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js';
import {createWardNursingCoverageClient} from '../../packages/generated-api-client/src/index.js';

const connection=process.env['VNEXT_VALIDATION_OWNER_URL']!;
const receipt=JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!,'utf8'));
const provider=validationKeys(receipt),catalog=await openCatalog(connection,provider);
const pool=new Pool({connectionString:connection,max:1});
const role=(await pool.query('select current_user r')).rows[0]!.r;await pool.end();
const predecessor=(await catalog.contractRead('maker',{scope:'SYNTHETIC',mode:'CURRENT'})).find(c=>c.dataset==='ORG04'&&c.profile==='CORE'&&c.status==='PUBLISHED'),warm=!!predecessor&&(await catalog.read('maker',{scope:'SYNTHETIC'})).items.some(i=>i.kind==='SOURCE'&&i.status==='PUBLISHED'&&i.versionId===predecessor.definition.sourceVersionId);
const f=await nursingFixture(receipt,role,catalog,provider,connection,warm);
const wards=await wardFixture(receipt,role,catalog,provider,connection,true);
peer(receipt.name,`GRANT EXECUTE ON FUNCTION care_organization.lifecycle_record(text,text),care_organization.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp) TO ${role};`);
const nursingCoverage=await wardNursingFixture(receipt,role,catalog,provider,connection,true,wards);
const httpContexts:Parameters<typeof buildCatalogServer>=[catalog,'CONTROL_PLANE'];httpContexts[23]={owner:nursingCoverage.owner,actor:r=>actor(r.headers)};
const httpApp=await buildCatalogServer(...httpContexts);await httpApp.listen({host:'127.0.0.1',port:0});
const coverageClient=createWardNursingCoverageClient(httpApp.listeningOrigin,'maker');
const httpSuccess=<T>(result:{response:Response;data?:T;error?:{code:string}})=>{expect(result.response.status,result.error?.code).toBe(200);if(!result.data)throw new Error('HTTP_DATA_REQUIRED');return result.data;};
const campusReader=openCampus(connection,provider),locations=openLocation(connection,provider,campusReader.references);
peer(receipt.name,`GRANT USAGE ON SCHEMA location_master TO ${role};GRANT EXECUTE ON FUNCTION location_master.lifecycle_dependencies(text,text,uuid,timestamp,timestamp,timestamp) TO ${role};`);
const bundle=openCareLocationLifecycle(connection,provider,{UNIT:f.base.owner,NURSING:f.owner,WARD:wards.owner,WARD_NURSING:nursingCoverage.owner,LOCATION:locations});
peer(receipt.name,`GRANT EXECUTE ON FUNCTION care_organization.ward_nursing_scope_reserve(text,text),care_organization.ward_nursing_scope_proposal_read(text,uuid) TO ${role};`);
peer(receipt.name,`GRANT EXECUTE ON FUNCTION care_organization.ward_nursing_scope_version_read(text,uuid,bigint,timestamp) TO ${role};`);
const originalQuery=Client.prototype.query;
Client.prototype.query=(function(this:Client,config:string|QueryConfig,...args:unknown[]){
 const result=Reflect.apply(originalQuery,this,[config,...args]);
 if(result&&typeof result.then==='function')return Promise.resolve(result).catch((error:unknown)=>{
  if(error instanceof Error&&'code' in error&&typeof error.code==='string'){
   const code=/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:null;
   const frames='where' in error&&typeof error.where==='string'?error.where.split('\n').filter(line=>/^PL\/pgSQL function [a-z_]+\.[a-z_]+\([a-z, ]*\) line [0-9]+ at [a-z ]+$/.test(line)):[];
   console.error(JSON.stringify({gate:'P3_11_SQL_DIAGNOSTIC',sqlstate:error.code,code,frames}));
  }
  throw error;
 });
 return result;
}) as typeof Client.prototype.query;
afterAll(async()=>{await httpApp.close();await nursingCoverage.close();await bundle.close();await locations.close();await campusReader.close();await wards.close();await f.close();await catalog.close();});
afterAll(()=>{Client.prototype.query=originalQuery;});

test.each([{kind:'NURSING',finite:true},{kind:'NURSING',finite:false},{kind:'WARD',finite:true},{kind:'WARD',finite:false}] as const)('endpoint impacts retain exact pause, resume and subsequent pause through generated HTTP: %j',async({kind,finite})=>{
 const coverage=nursingCoverage,a=await coverage.endpoint(),entry=coverage.entry(a,{kind:'WHOLE_WARD'});await coverage.apply(await coverage.input([entry]));
 const id=kind==='NURSING'?a.nursing.id:a.ward.id;
 const command=await (async()=>{
  if(kind==='NURSING'){
   const native=coverage.nursing,h=await native.owner.history('maker',{id}),facts=h.versions[0]!.facts,seed=native.entry({department:{owner:'department-master',id:h.departmentId},campus:a.campus});if(seed.action!=='CREATE')throw new Error('TEST_CREATE_REQUIRED');const {binding:_,...accepted}=seed;
   return async(action:'SUSPEND'|'RESUME',expectedHead:string,from:string,to:string|null)=>native.apply(await native.input([{...accepted,action,target:{owner:'care-organization/nursing',id,expectedHead},row:{...seed.row,nursing_unit_id:facts.source.sourceAlias,nursing_code:facts.nursingCode,nursing_name:facts.nursingName,care_level:facts.careLevel??'',office_phone:facts.officePhone??'',record_status:action==='SUSPEND'?'SUSPENDED':'ACTIVE',valid_from:from,valid_to:to??''}}]));
  }
  const h=await wards.owner.history('maker',{id}),facts=h.versions[0]!.facts,seed=wards.entry({unit:{owner:'care-organization/unit',id:h.bindings[0]!.managingUnitId},campus:a.campus});if(seed.action!=='CREATE')throw new Error('TEST_CREATE_REQUIRED');const {binding:_,...accepted}=seed;
  return async(action:'SUSPEND'|'RESUME',expectedHead:string,from:string,to:string|null)=>wards.apply(await wards.input([{...accepted,action,target:{owner:'care-organization/ward',id,expectedHead},row:{...seed.row,ward_id:facts.source.sourceAlias,ward_code:facts.wardCode,ward_name:facts.wardName,ward_type:facts.wardType,public_phone:facts.publicPhone,admission_rule_ref:facts.admissionRuleReference,record_status:action==='SUSPEND'?'SUSPENDED':'ACTIVE',valid_from:from,valid_to:to}}]));
 })();
 const request={kind,id,validFrom:'2026-01-01T00:00:00.000001',validTo:null},S='2026-06-01T00:00:00.000001',T='2026-07-01T00:00:00.000002',E='2028-01-01T00:00:00.999999',U='2026-08-01T00:00:00.000003';
 const suspended=await command('SUSPEND','1',S,null);
 let currentRecord=suspended.recordedAt;
 const expectLifecycle=async(expected:unknown[])=>{const atRecord={...request,recordAsOf:currentRecord},direct=await coverage.owner.evaluateEndpointImpacts('maker',atRecord),http=httpSuccess(await coverageClient.evaluateEndpointImpacts(atRecord));expect(http).toEqual(direct);expect(direct.items).toHaveLength(1);expect(direct.items[0]!.lifecycle).toMatchObject(expected);};
 const finish=finite?E:null;
 await expectLifecycle([{action:'SUSPEND',from:S,to:null}]);currentRecord=(await command('RESUME','2',T,finish)).recordedAt;
 await expectLifecycle([{action:'SUSPEND',from:S,to:null},{action:'RESUME',from:T,to:finish}]);
 expect(kind==='NURSING'?await coverage.nursing.owner.read('maker',{id,businessAt:U}):await wards.owner.read('maker',{id,businessAt:U})).toMatchObject({state:'ACTIVE'});
 currentRecord=(await command('SUSPEND','3',U,null)).recordedAt;
 await expectLifecycle([{action:'SUSPEND',from:S,to:null},{action:'RESUME',from:T,to:finish},{action:'SUSPEND',from:U,to:null}]);
 expect(httpSuccess(await coverageClient.evaluateEndpointImpacts({...request,recordAsOf:suspended.recordedAt}))).toMatchObject({items:[{lifecycle:[{action:'SUSPEND',from:S,to:null}]}]});
});

test('unended coverage has a closed NOT_COMPLETED HTTP receipt at its original R',async()=>{
 const coverage=nursingCoverage,a=await coverage.endpoint(),created=await coverage.apply(await coverage.input([coverage.entry(a,{kind:'WHOLE_WARD'})])),id=created.facts[0]!.id;
 const receipt=httpSuccess(await coverageClient.handoverReceipt({id,recordAsOf:created.recordedAt,businessAt:'2026-06-01T00:00:00.000001'}));
 expect(receipt).toEqual({source:{id,head:'1'},cutover:null,status:'NOT_COMPLETED',successors:[],clinicalReadiness:'NOT_READY'});
 const malformedContexts:Parameters<typeof buildCatalogServer>=[...httpContexts];
 malformedContexts[23]={owner:{...coverage.owner,handoverReceipt:async(...args)=>({...await coverage.owner.handoverReceipt(...args),undeclared:'TEST_RESPONSE_ONLY'}),evaluateEndpointImpacts:async(...args)=>({...await coverage.owner.evaluateEndpointImpacts(...args),undeclared:'TEST_RESPONSE_ONLY'})},actor:r=>actor(r.headers)};
 const malformedApp=await buildCatalogServer(...malformedContexts);await malformedApp.listen({host:'127.0.0.1',port:0});
 try{const client=createWardNursingCoverageClient(malformedApp.listeningOrigin,'maker');
  for(const response of [await client.handoverReceipt({id,recordAsOf:created.recordedAt}),await client.evaluateEndpointImpacts({kind:'NURSING',id:a.nursing.id,validFrom:'2026-01-01T00:00:00.000001',validTo:null})]){
   expect(response.response.status).toBe(500);expect(response.error).toMatchObject({code:'OWNER_RESPONSE_INVALID'});expect(JSON.stringify(response.error)).not.toContain('TEST_RESPONSE_ONLY');
  }
 }finally{await malformedApp.close();}

});

test('AC05 an explicitly approved Nursing resume retains the suspended identity and the old suspension history',async()=>{
 const binding=await f.endpoint(),entry=f.entry(binding),created=await f.apply(await f.input([entry])),id=created.facts[0]!.id;
 if(entry.action!=='CREATE')throw new Error('TEST_CREATION_REQUIRED');
 const {binding:_createBinding,...accepted}=entry;
 const suspend={...accepted,action:'SUSPEND' as const,target:{owner:'care-organization/nursing' as const,id,expectedHead:'1'},row:{...entry.row,record_status:'SUSPENDED' as const,valid_from:'2026-06-01T00:00:00'}};
  const suspended=await f.apply(await f.input([suspend]));
 const before=await f.owner.history('maker',{id});
  const proof={owner:'NURSING_UNIT',id,versionId:before.versions.at(-1)!.id,candidateId:suspended.candidateId,requestId:suspended.requestId},activityPool=new Pool({connectionString:connection,max:1});
  try{expect((await activityPool.query('select department_master.impact_result($1,$2,$3) r',['maker',proof,'NORTH'])).rows[0]!.r).toMatchObject({action:'END',safeShrink:true,period:{from:'2026-01-01T00:00:00.000000',to:'2026-06-01T00:00:00.000000'}});}finally{await activityPool.end();}
 const resume={...accepted,action:'RESUME' as const,target:{owner:'care-organization/nursing' as const,id,expectedHead:'2'},row:{...entry.row,record_status:'ACTIVE' as const,valid_from:'2026-07-01T00:00:00'}};
  const resumed=await f.apply(await f.input([resume]));
 expect(resumed.facts[0]!.id).toBe(id);
 expect((await f.owner.read('maker',{id,businessAt:'2026-07-01T00:00:00'})).state).toBe('ACTIVE');
 expect((await f.owner.read('maker',{id,businessAt:'2026-06-15T00:00:00'})).state).toBe('SUSPENDED');
 expect((await f.owner.read('maker',{id,businessAt:'2026-07-01T00:00:00',recordAsOf:before.versions.at(-1)!.recordedAt})).state).toBe('SUSPENDED');
 expect((await f.owner.history('maker',{id})).versions.map(v=>v.action)).toEqual(['CREATE','SUSPEND','RESUME']);
 expect(await f.owner.reconcileCommittedUnit('maker',{candidateId:resumed.candidateId,requestId:resumed.requestId})).toMatchObject({status:'MATCHED'});
  const currentPool=new Pool({connectionString:connection,max:1});try{const refs=(await currentPool.query('select care_organization.nursing_department_references($1,$2,$3) r',['maker',JSON.stringify([binding.department.id]),'NORTH'])).rows[0]!.r;expect(refs.find((ref:{id:string})=>ref.id===id)).toMatchObject({currentPeriods:[{from:'2026-01-01T00:00:00.000000',to:'2026-06-01T00:00:00.000000'},{from:'2026-07-01T00:00:00.000000',to:null}],current:true});await expect(currentPool.query('select department_master.impact_result($1,$2,$3) r',['maker',proof,'NORTH'])).rejects.toThrow('IMPACT_RESULT_MISMATCH');}finally{await currentPool.end();}
  const job=await f.dep.newJob(),upstream=await f.lifecycle.stage('maker',{requestId:randomUUID(),jobId:job.id,revisionId:job.revisionId,campus:'NORTH',profile:'CORE',commands:[{action:'SUSPEND',department:{owner:'department-master',id:binding.department.id,expectedVersion:'1',expectedLifecycleHead:'0'},effectiveAt:'2026-06-15T00:00:00',reason:'TEST exact Nursing pause gap and explicit resumed activity',evidenceId:f.dep.artifact.artifactId}],impacts:f.impacts}),evolution=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>f.base.owner,()=>f.owner));try{const assessment=await evolution.assessDepartmentChange('maker',{requestId:randomUUID(),reason:'TEST public impact observes only resumed activity after the gap',target:{kind:'INPUT',id:upstream.inputId}});expect(assessment.references.find(ref=>ref.owner==='NURSING_UNIT'&&ref.id===id)).toMatchObject({constraint:'UNSATISFIED',affectedSpans:[{from:'2026-07-01T00:00:00.000000',to:null}]});}finally{await evolution.close();}
});

test('AC05 Unit suspension and independent resume preserve identity while permanent closure cannot resume or release the code',async()=>{
 const units=f.base,binding=await units.endpoint(await units.newDepartment()),entry=units.entry(binding),created=await units.apply(await units.input([entry])),id=created.facts[0]!.id;
 if(entry.action!=='CREATE')throw new Error('TEST_CREATION_REQUIRED');
 const {binding:_createBinding,...accepted}=entry;
 const command=(action:'SUSPEND'|'RESUME'|'CLOSE',expectedHead:string,from:string)=>({...accepted,action,target:{owner:'care-organization/unit' as const,id,expectedHead},row:{...entry.row,record_status:action==='SUSPEND'?'SUSPENDED':action==='CLOSE'?'RETIRED':'ACTIVE',valid_from:from}});
 await units.apply(await units.input([command('SUSPEND','1','2026-06-01T00:00:00') as never]));
 expect((await units.owner.read('maker',{id,businessAt:'2026-06-15T00:00:00'})).state).toBe('SUSPENDED');
 const resumed=await units.apply(await units.input([command('RESUME','2','2026-07-01T00:00:00') as never]));
 expect(resumed.facts[0]!.id).toBe(id);
 expect((await units.owner.read('maker',{id,businessAt:'2026-07-01T00:00:00'})).state).toBe('ACTIVE');
 await units.apply(await units.input([command('CLOSE','3','2026-08-01T00:00:00') as never]));
 expect((await units.owner.read('maker',{id,businessAt:'2026-09-01T00:00:00'})).state).toBe('CLOSED');
 await expect(units.prepare(await units.input([command('RESUME','4','2026-09-01T00:00:00') as never]))).rejects.toThrow('UNIT_CLOSED');
 const duplicate=units.entry(binding);duplicate.row.unit_code=entry.row.unit_code;
 await expect(units.apply(await units.input([duplicate]))).rejects.toThrow('UNIT_CODE_CONFLICT');
});

test('AC03 a suspended Nursing organization can permanently close without rewriting its accepted binding or old knowledge',async()=>{
 const binding=await f.endpoint(),entry=f.entry(binding),created=await f.apply(await f.input([entry])),id=created.facts[0]!.id;
 if(entry.action!=='CREATE')throw new Error('TEST_CREATION_REQUIRED');
 const {binding:_createBinding,...accepted}=entry;
 const command=(action:'SUSPEND'|'CLOSE'|'RESUME',expectedHead:string,from:string)=>({...accepted,action,target:{owner:'care-organization/nursing' as const,id,expectedHead},row:{...entry.row,record_status:action==='SUSPEND'?'SUSPENDED' as const:action==='CLOSE'?'RETIRED' as const:'ACTIVE' as const,valid_from:from}});
 await f.apply(await f.input([command('SUSPEND','1','2026-06-01T00:00:00') as never]));
 const original=await f.owner.history('maker',{id});
 await f.apply(await f.input([command('CLOSE','2','2026-07-01T00:00:00') as never]));
 expect((await f.owner.read('maker',{id,businessAt:'2026-08-01T00:00:00'})).state).toBe('CLOSED');
 expect((await f.owner.history('maker',{id})).bindings).toEqual(original.bindings);
 expect(await f.owner.history('maker',{id,recordAsOf:original.versions.at(-1)!.recordedAt})).toEqual(original);
 await expect(f.prepare(await f.input([command('RESUME','3','2026-09-01T00:00:00') as never]))).rejects.toThrow('NURSING_CLOSED');
});

test('AC05 Ward suspension and explicit resume retain identity and permanent closure remains irreversible',async()=>{
 const binding=await wards.endpoint(),entry=wards.entry(binding),created=await wards.apply(await wards.input([entry])),id=created.facts[0]!.id;
 if(entry.action!=='CREATE')throw new Error('TEST_CREATION_REQUIRED');
 const {binding:_createBinding,...accepted}=entry;
 const command=(action:'SUSPEND'|'RESUME'|'CLOSE',expectedHead:string,from:string)=>({...accepted,action,target:{owner:'care-organization/ward' as const,id,expectedHead},row:{...entry.row,record_status:action==='SUSPEND'?'SUSPENDED' as const:action==='CLOSE'?'RETIRED' as const:'ACTIVE' as const,valid_from:from}});
 await wards.apply(await wards.input([command('SUSPEND','1','2026-06-01T00:00:00') as never]));
 const suspended=await wards.owner.history('maker',{id});
 expect((await wards.owner.read('maker',{id,businessAt:'2026-06-15T00:00:00'})).state).toBe('SUSPENDED');
 await wards.apply(await wards.input([command('RESUME','2','2026-07-01T00:00:00') as never]));
 expect((await wards.owner.read('maker',{id,businessAt:'2026-07-01T00:00:00'})).state).toBe('ACTIVE');
 expect((await wards.owner.read('maker',{id,businessAt:'2026-07-01T00:00:00',recordAsOf:suspended.versions.at(-1)!.recordedAt})).state).toBe('SUSPENDED');
 await wards.apply(await wards.input([command('CLOSE','3','2026-08-01T00:00:00') as never]));
 expect((await wards.owner.read('maker',{id,businessAt:'2026-09-01T00:00:00'})).state).toBe('CLOSED');
 await expect(wards.prepare(await wards.input([command('RESUME','4','2026-09-01T00:00:00') as never]))).rejects.toThrow('WARD_CLOSED');
});

async function preparedCloseMembers(){
 const ub=await f.base.endpoint(await f.base.newDepartment()),ue=f.base.entry(ub),ur=await f.base.apply(await f.base.input([ue])),nb=await f.endpoint(),ne=f.entry(nb),nr=await f.apply(await f.input([ne]));
 if(ue.action!=='CREATE'||ne.action!=='CREATE')throw new Error('TEST_CREATION_REQUIRED');
 const {binding:_ub,...uc}=ue,{binding:_nb,...nc}=ne;
 peer(receipt.name,`INSERT INTO care_organization.access VALUES('maker-alias','${ub.campus.id}'::uuid,'NORTH','REVIEW') ON CONFLICT DO NOTHING;INSERT INTO care_organization.nursing_access VALUES('maker-alias','${nb.campus.id}'::uuid,'NORTH','REVIEW') ON CONFLICT DO NOTHING;`);
 const us=await f.base.input([{...uc,action:'CLOSE',target:{owner:'care-organization/unit',id:ur.facts[0]!.id,expectedHead:'1'},row:{...ue.row,record_status:'RETIRED',valid_from:'2027-01-01T00:00:00'}}]);
 const ns=await f.input([{...nc,action:'CLOSE',target:{owner:'care-organization/nursing',id:nr.facts[0]!.id,expectedHead:'1'},row:{...ne.row,record_status:'RETIRED',valid_from:'2027-01-01T00:00:00'}}]);
 const ui=await f.base.owner.stage('maker',us),ni=await f.owner.stage('maker',ns);await f.base.owner.verify('reviewer',f.base.verification(us,ui));await f.owner.verify('reviewer',f.verification(ns,ni));
 return {ids:[ur.facts[0]!.id,nr.facts[0]!.id],members:[{owner:'UNIT' as const,...ui,contractVersionId:f.base.contract!.versionId},{owner:'NURSING' as const,...ni,contractVersionId:f.contract!.versionId}]};
}
async function preparedBundle(){const value=await preparedCloseMembers(),input=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:'CLOSE',cutover:'2027-01-01T00:00:00',reason:'TEST atomic two Owner closure',members:value.members});
 await expect(bundle.verify('maker-alias',{inputId:input.inputId,inputDigest:input.digest,requestId:randomUUID(),reason:'TEST invalid alias',policy:'TEST_POLICY_ONLY'})).rejects.toThrow('MAKER_CHECKER_REQUIRED');
 await bundle.verify('reviewer',{inputId:input.inputId,inputDigest:input.digest,requestId:randomUUID(),reason:'TEST exact whole bundle verified',policy:'TEST_POLICY_ONLY'});
 const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:input.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);return {...value,candidate,requestId};}

test('AC04 one root approval atomically closes two real Owners at the same database recording time and recovers its exact result',async()=>{
 const v=await preparedBundle(),result=await bundle.applyUnit('maker',{candidateId:v.candidate.candidateId,requestId:v.requestId});expect(result.status).toBe('COMMITTED');
 const u=await f.base.owner.history('maker',{id:v.ids[0]!}),n=await f.owner.history('maker',{id:v.ids[1]!});expect(u.versions.at(-1)!.action).toBe('CLOSE');expect(n.versions.at(-1)!.action).toBe('CLOSE');expect(u.versions.at(-1)!.recordedAt).toBe(n.versions.at(-1)!.recordedAt);
 expect(await bundle.resumeOutcome('maker',{candidateId:v.candidate.candidateId,requestId:v.requestId})).toMatchObject({status:'COMMITTED'});expect(await bundle.reconcileCommittedUnit('maker',{candidateId:v.candidate.candidateId,requestId:v.requestId})).toMatchObject({status:'MATCHED'});
});

test('AC04 an actual second Owner SQL write failure rolls back the first Owner and the whole outcome',async()=>{
 const v=await preparedBundle();
 peer(receipt.name,`CREATE FUNCTION care_organization.p3_11_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'TEST_INJECTED_WRITE_FAILURE';END $$;CREATE TRIGGER p3_11_fail BEFORE INSERT ON care_organization.nursing_version FOR EACH ROW EXECUTE FUNCTION care_organization.p3_11_fail();`);
 try{await expect(bundle.applyUnit('maker',{candidateId:v.candidate.candidateId,requestId:v.requestId})).rejects.toThrow('APPLY_FAILED');}finally{peer(receipt.name,'DROP TRIGGER p3_11_fail ON care_organization.nursing_version;DROP FUNCTION care_organization.p3_11_fail();');}
 expect((await f.base.owner.history('maker',{id:v.ids[0]!})).versions).toHaveLength(1);expect((await f.owner.history('maker',{id:v.ids[1]!})).versions).toHaveLength(1);
 expect(await bundle.resumeOutcome('maker',{candidateId:v.candidate.candidateId,requestId:v.requestId})).toBeNull();
 const retried=await bundle.applyUnit('maker',{candidateId:v.candidate.candidateId,requestId:v.requestId});expect(retried.status).toBe('COMMITTED');
});


test('a Ward cross-campus binding requires the lifecycle bundle and reads campus from its B/R binding rather than its creation header',async()=>{
 const source=await wards.endpoint(),entry=wards.entry(source),created=await wards.apply(await wards.input([entry])),id=created.facts[0]!.id,destination=await wards.endpoint(),old=await wards.owner.history('maker',{id});
 if(entry.action!=='CREATE')throw new Error('TEST_CREATION_REQUIRED');
 const changed={...entry,action:'REBIND' as const,target:{owner:'care-organization/ward' as const,id,expectedHead:'1'},binding:destination,row:{...entry.row,campus_id:destination.campus.id,managing_unit_id:destination.unit.id,valid_from:'2027-01-01T00:00:00'}};
 const data=await wards.input([changed]),staged=await wards.owner.stage('maker',data);await wards.owner.verify('reviewer',wards.verification(data,staged));
 expect(await wards.owner.preview('maker',{inputId:staged.inputId})).toMatchObject({decision:'BLOCKED',issues:[{code:'WARD_CAMPUS_CHANGE_REQUIRES_LIFECYCLE'}]});
 const input=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:'MOVE',cutover:'2027-01-01T00:00:00',reason:'TEST Ward move with existing admitted target Unit',members:[{owner:'WARD',...staged,contractVersionId:wards.contract!.versionId}]});
 await bundle.verify('reviewer',{inputId:input.inputId,inputDigest:input.digest,requestId:randomUUID(),reason:'TEST source and target reviewed',policy:'TEST_POLICY_ONLY'});
 const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:input.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);expect((await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');
 expect(await wards.owner.read('maker',{id,businessAt:'2027-01-01T00:00:00'})).toMatchObject({id,campusId:destination.campus.id});
 expect(await wards.owner.read('maker',{id,businessAt:'2026-12-31T23:59:59.999999'})).toMatchObject({id,campusId:source.campus.id});
 expect(await wards.owner.read('maker',{id,businessAt:'2027-01-01T00:00:00',recordAsOf:old.versions.at(-1)!.recordedAt})).toMatchObject({id,campusId:source.campus.id});
 expect((await wards.owner.history('maker',{id})).campusId).toBe(source.campus.id);
});


test('a partial handover ends the original complete coverage and establishes retained and received partitions with exact Nursing confirmations',async()=>{
 const f=nursingCoverage,a=await f.endpoint(),b=await f.sameWard(a),set=await f.register(a),whole=f.partition(set,[0,1]),old=f.entry(a,whole),created=await f.apply(await f.input([old])),id=created.facts[0]!.id,T='2027-01-01T00:00:00';
 const left=f.entry(a,f.partition(set,[0])),right=f.entry(b,f.partition(set,[1]));left.row.valid_from=T;right.row.valid_from=T;left.row.handover_rule_ref='TEST_PARTIAL';right.row.handover_rule_ref='TEST_PARTIAL';
 const ended={...old,action:'END' as const,target:{owner:'care-organization/ward-nursing-coverage' as const,id,expectedHead:'1'},endAt:T,row:{...old.row,record_status:'RETIRED' as const}};
 const data=await f.input([ended,left,right]),staged=await f.owner.stage('maker',data),plan={sourceCoverage:whole,successors:[{sourceAlias:left.row.ward_nursing_rel_id,nursing:a.nursing,coverage:left.coverage},{sourceAlias:right.row.ward_nursing_rel_id,nursing:b.nursing,coverage:right.coverage}]};
 const verification=f.verification(data,staged);for(const [index,entry] of [left,right].entries())verification.rows[index+1]!.handover={kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:entry.row.ward_nursing_rel_id,successorNursing:entry.applicability.nursing,coverage:entry.coverage,cutover:T,ruleReference:'TEST_PARTIAL',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true,partitionPlan:plan};
 await f.owner.verify('reviewer',await f.confirmHandover(verification));
 const bundled=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:'HANDOVER',cutover:T,reason:'TEST one root partial handover approval',members:[{owner:'WARD_NURSING',...staged,contractVersionId:f.contract!.versionId}]});await bundle.verify('reviewer',{inputId:bundled.inputId,inputDigest:bundled.digest,requestId:randomUUID(),reason:'TEST all mapped successors verified',policy:'TEST_POLICY_ONLY'});
 const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:bundled.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);const result=await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');
 expect((await f.owner.history('maker',{id})).versions.at(-1)!.action).toBe('END');
 expect(await f.owner.evaluateWindow('maker',{applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:whole,validFrom:T,validTo:null,mode:'CURRENT_ADMISSION'})).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true});
});


test('scope repartition reserves new partition identities on the original stable scope set without changing its accepted definition',async()=>{
 const f=nursingCoverage,a=await f.endpoint(),set=await f.register(a),data=await f.scopeInput(a);if(data.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_REQUIRED');
 const request={...data,kind:'SCOPE_REVISION' as const,target:{id:set.id,expectedHead:'1'},definition:{...data.definition,sourceAlias:set.sourceAlias,validFrom:'2027-01-01T00:00:00',partitions:data.definition.partitions.map(p=>({...p,boundary:p.boundary+' TEST independently revised boundary'}))},mapping:set.partitions.map(p=>({version:'1',partitionId:p.id,toAliases:[p.sourceAlias]}))};
 const staged=await f.owner.stage('maker',request);expect(staged).toHaveProperty('proposal.partitions');
 const proposal=staged.proposal;if(!proposal)throw new Error('TEST_PROPOSAL_REQUIRED');
 expect(proposal.scopeSetId).toBe(set.id);expect(proposal.version).toBe('2');expect(proposal.partitions).toHaveLength(2);expect(proposal.partitions.every(p=>!set.partitions.some(old=>old.id===p.id))).toBe(true);
 expect(await f.owner.readScopeDefinition('maker',{id:set.id})).toEqual(set);
 await f.owner.verify('reviewer',{...f.verification(request,staged),scopeDefinition:{completeAndDisjoint:true,definitionDigest:staged.digest,evidenceId:f.artifact.artifactId}});
 const bundled=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:'REPARTITION',cutover:request.definition.validFrom,reason:'TEST exact immutable scope version without existing coverage',members:[{owner:'WARD_NURSING',inputId:staged.inputId,revisionId:staged.revisionId,digest:staged.digest,contractVersionId:f.contract!.versionId}]});
 await bundle.verify('reviewer',{inputId:bundled.inputId,inputDigest:bundled.digest,requestId:randomUUID(),reason:'TEST material and map independently accepted',policy:'TEST_POLICY_ONLY'});
 const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:bundled.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);
 expect(await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'COMMITTED',facts:[{id:set.id,version:'2'}]});
 expect(await f.owner.readScopeDefinition('maker',{id:set.id})).toMatchObject({id:set.id,version:'2',partitions:proposal.partitions});
 expect(await f.owner.readScopeDefinition('maker',{id:set.id,recordAsOf:set.recordedAt})).toEqual(set);
});

test('scope repartition moves the Ward anchor only through its exact controlled lifecycle rebind',async()=>{
 const f=nursingCoverage,a=await f.endpoint(),set=await f.register(a),h=await wards.owner.history('maker',{id:a.ward.id}),target=await wards.endpoint(),T='2027-06-01T00:00:00.000001',facts=h.versions[0]!.facts,e=wards.entry(target);
 const rebind={...e,action:'REBIND' as const,binding:target,target:{owner:'care-organization/ward' as const,id:h.id,expectedHead:'1'},row:{...e.row,ward_id:facts.source.sourceAlias,ward_code:facts.wardCode,ward_name:facts.wardName,ward_type:facts.wardType,public_phone:facts.publicPhone,admission_rule_ref:facts.admissionRuleReference,valid_from:T}},careData=await wards.input([rebind]),care=await wards.owner.stage('maker',careData);await wards.owner.verify('reviewer',wards.verification(careData,care));
  expect((await bundle.assessSpaceMove('maker',{target:{kind:'WARD',id:a.ward.id},validFrom:T,validTo:null})).items).toEqual(expect.arrayContaining([expect.objectContaining({owner:'WARD_NURSING',id:set.id,head:'1',campusId:a.campus.id})]));
  await expect(bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',kind:'MOVE',policy:'TEST_POLICY_ONLY',cutover:T,reason:'TEST omitted logical scope must block campus move',members:[{owner:'WARD',...care,contractVersionId:wards.contract!.versionId}]})).rejects.toThrow('LIFECYCLE_DISPOSITION_INCOMPLETE');
 const next={...a,campus:target.campus};f.grant(next);const definition=await f.scopeInput(next);if(definition.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_REQUIRED');const revision={...definition,kind:'SCOPE_REVISION' as const,target:{id:set.id,expectedHead:'1'},definition:{...definition.definition,sourceAlias:set.sourceAlias,validFrom:T},mapping:set.partitions.map(p=>({version:'1',partitionId:p.id,toAliases:[p.sourceAlias]}))},scope=await f.owner.stage('maker',revision);await f.owner.verify('reviewer',{...f.verification(revision,scope),scopeDefinition:{completeAndDisjoint:true,definitionDigest:scope.digest,evidenceId:f.artifact.artifactId}});
 const root=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:'MOVE',cutover:T,reason:'TEST controlled Ward and immutable logical scope anchor move',members:[{owner:'WARD_NURSING',inputId:scope.inputId,revisionId:scope.revisionId,digest:scope.digest,contractVersionId:f.contract!.versionId},{owner:'WARD',...care,contractVersionId:wards.contract!.versionId}]});await bundle.verify('reviewer',{requestId:randomUUID(),inputId:root.inputId,inputDigest:root.digest,reason:'TEST independent target scope boundary and binding review',policy:'TEST_POLICY_ONLY'});const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:root.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);const applied=await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(applied.status).toBe('COMMITTED');if(applied.status!=='COMMITTED')throw new Error('TEST_COMMITTED_REQUIRED');expect(applied.facts).toHaveLength(2);
 expect(await f.owner.readScopeDefinition('maker',{id:set.id})).toMatchObject({id:set.id,version:'2',applicability:{campus:target.campus},recordedAt:applied.recordedAt});expect(await f.owner.readScopeDefinition('maker',{id:set.id,recordAsOf:set.recordedAt})).toEqual(set);expect(await f.owner.readScopeVersion('maker',{id:set.id,version:'1'})).toMatchObject({applicability:{campus:a.campus},validTo:T});expect(await bundle.reconcileCommittedUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'MATCHED'});
});

test.each([{start:'2026-01-01T00:00:00',finish:null},{start:'2028-01-01T00:00:00.000001',finish:'2029-01-01T00:00:00.000001'}])('scope repartition moves occupied partitions with Ward and Nursing rebinds and exact independent Nursing confirmations: %j',async({start,finish})=>{
 const f=nursingCoverage,a=await f.endpoint(),set=await f.register(a),whole=f.partition(set,[0,1]),old={...f.entry(a,whole),row:{...f.row(a,whole),valid_from:start,valid_to:finish}},created=await f.apply(await f.input([old])),id=created.facts[0]!.id,T='2027-08-01T00:00:00.000001',target=await wards.endpoint(),wh=await wards.owner.history('maker',{id:a.ward.id}),nh=await f.nursing.owner.history('maker',{id:a.nursing.id});
 const wf=wh.versions[0]!.facts,we=wards.entry(target),w={...we,action:'REBIND' as const,binding:target,target:{owner:'care-organization/ward' as const,id:wh.id,expectedHead:'1'},row:{...we.row,ward_id:wf.source.sourceAlias,ward_code:wf.wardCode,ward_name:wf.wardName,ward_type:wf.wardType,public_phone:wf.publicPhone,admission_rule_ref:wf.admissionRuleReference,valid_from:T}},wi=await wards.input([w]),ws=await wards.owner.stage('maker',wi);await wards.owner.verify('reviewer',wards.verification(wi,ws));
 const next={...a,campus:target.campus};f.grant(next);const b=await f.sameWard(next),nb={department:nh.bindings[0]!.versions[0]!.binding.department,campus:target.campus},nf=nh.versions[0]!.facts,ne=f.nursing.entry(nb),n={...ne,action:'REBIND' as const,binding:nb,target:{owner:'care-organization/nursing' as const,id:nh.id,expectedHead:'1'},row:{...ne.row,nursing_unit_id:nf.source.sourceAlias,nursing_code:nf.nursingCode,nursing_name:nf.nursingName,care_level:nf.careLevel,office_phone:nf.officePhone,source_system_id:nf.source.sourceSystemId,valid_from:T}},ni=await f.nursing.input([n]),ns=await f.nursing.owner.stage('maker',ni);await f.nursing.owner.verify('reviewer',f.nursing.verification(ni,ns));
 const definition=await f.scopeInput(next);if(definition.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_REQUIRED');const revision={...definition,kind:'SCOPE_REVISION' as const,target:{id:set.id,expectedHead:'1'},definition:{...definition.definition,sourceAlias:set.sourceAlias,validFrom:T},mapping:set.partitions.map(p=>({version:'1',partitionId:p.id,toAliases:[p.sourceAlias]}))},scope=await f.owner.stage('maker',revision);if(!scope.proposal)throw new Error('TEST_PROPOSAL_REQUIRED');await f.owner.verify('reviewer',{...f.verification(revision,scope),scopeDefinition:{completeAndDisjoint:true,definitionDigest:scope.digest,evidenceId:f.artifact.artifactId}});
 const K=start>T?start:T;const ref={inputId:scope.inputId,revisionId:scope.revisionId,digest:scope.digest,contractVersionId:f.contract!.versionId},cov=(i:number)=>({kind:'PARTITIONS' as const,scopeSetId:set.id,version:'2',partitionIds:[scope.proposal!.partitions[i]!.id]}),left=f.entry(next,cov(0)),right=f.entry(b,cov(1));for(const e of [left,right]){e.row.valid_from=K;e.row.valid_to=finish;e.row.handover_rule_ref='TEST_CROSS_SCOPE';}const end={...old,action:'END' as const,target:{owner:'care-organization/ward-nursing-coverage' as const,id,expectedHead:'1'},endAt:K,row:{...old.row,record_status:'RETIRED' as const}},ci=await f.input([end,left,right]),cs=await f.owner.stage('maker',ci),v=f.verification(ci,cs),plan={sourceCoverage:whole,repartition:ref,successors:[left,right].map(e=>({sourceAlias:e.row.ward_nursing_rel_id,nursing:e.applicability.nursing,coverage:e.coverage}))};
 for(const [index,e] of [left,right].entries())v.rows[index+1]!.handover={kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:e.row.ward_nursing_rel_id,successorNursing:e.applicability.nursing,coverage:e.coverage,cutover:K,ruleReference:'TEST_CROSS_SCOPE',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true,partitionPlan:plan};await f.owner.verify('reviewer',await f.confirmHandover(v));
 const root=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',kind:'MOVE',policy:'TEST_POLICY_ONLY',cutover:T,reason:'TEST all occupied source scopes and target responsibilities mapped',members:[{owner:'WARD_NURSING',...cs,contractVersionId:f.contract!.versionId},{owner:'WARD_NURSING',...ref},{owner:'WARD',...ws,contractVersionId:wards.contract!.versionId},{owner:'NURSING',...ns,contractVersionId:f.nursing.contract!.versionId}]});await bundle.verify('reviewer',{requestId:randomUUID(),inputId:root.inputId,inputDigest:root.digest,reason:'TEST independent complete mapped cross-campus responsibility',policy:'TEST_POLICY_ONLY'});const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:root.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);const result=await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('TEST_COMMITTED_REQUIRED');expect(result.facts).toHaveLength(6);
 expect(await f.owner.read('maker',{id,businessAt:K,recordAsOf:created.recordedAt})).toMatchObject({state:'ACTIVE',applicability:{campus:a.campus}});expect(await f.owner.evaluateWindow('maker',{applicability:{ward:a.ward,campus:target.campus,purpose:a.purpose},coverage:{kind:'WHOLE_WARD'},validFrom:K,validTo:finish,mode:'CURRENT_ADMISSION'})).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true});expect(await bundle.reconcileCommittedUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'MATCHED'});
  const source=(await f.owner.history('maker',{id})).versions.at(-1)!,successorFacts=result.facts.filter(f=>f.owner==='care-organization/ward-nursing-coverage'&&f.version==='1');
   const expectedReceipt={source:{id,versionId:source.id,version:source.number,expectedHead:'1'},cutover:K,status:'CONFIRMED_EFFECTIVE',successors:expect.arrayContaining(successorFacts.map(f=>expect.objectContaining({id:f.id,version:'1'}))),clinicalReadiness:'NOT_READY'};
   expect(await f.owner.handoverReceipt('maker',{id,businessAt:K,recordAsOf:result.recordedAt})).toMatchObject(expectedReceipt);
   expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:K,recordAsOf:result.recordedAt}))).toMatchObject(expectedReceipt);
  expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:K,recordAsOf:created.recordedAt}))).toMatchObject({status:'NOT_COMPLETED',successors:[]});
   expect(httpSuccess(await coverageClient.query({id,businessAt:K,recordAsOf:result.recordedAt}))).toMatchObject({state:'ENDED',handoverStatus:'CONFIRMED_EFFECTIVE'});
   const listing=httpSuccess(await coverageClient.list({campus:'NORTH',campusId:a.campus.id,wardId:a.ward.id,businessAt:K,recordAsOf:result.recordedAt}));
   expect(listing.items.find(item=>item.id===id)).toMatchObject({handoverStatus:'CONFIRMED_EFFECTIVE'});
   expect(httpSuccess(await coverageClient.evaluate({applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:whole,validFrom:K,validTo:finish,mode:'HISTORICAL',recordAsOf:result.recordedAt})).handovers.find(item=>item.relationId===id)).toMatchObject({status:'CONFIRMED_EFFECTIVE'});
   peer(receipt.name,`DELETE FROM care_organization.ward_nursing_access WHERE actor='maker' AND campus_id='${target.campus.id}'::uuid AND scope='NORTH' AND permission='READ';`);
   try{
    for(const response of [await coverageClient.handoverReceipt({id,businessAt:K,recordAsOf:result.recordedAt}),await coverageClient.query({id,businessAt:K,recordAsOf:result.recordedAt}),await coverageClient.list({campus:'NORTH',campusId:a.campus.id,wardId:a.ward.id,businessAt:K,recordAsOf:result.recordedAt}),await coverageClient.evaluate({applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:whole,validFrom:K,validTo:finish,mode:'HISTORICAL',recordAsOf:result.recordedAt})]){
     expect(response.response.status).toBe(403);expect(response.error).toMatchObject({code:'ACCESS_DENIED'});
    }
    expect(httpSuccess(await coverageClient.query({id,businessAt:K,recordAsOf:created.recordedAt}))).toMatchObject({state:'ACTIVE',handoverStatus:'NOT_REQUIRED'});
   }finally{peer(receipt.name,`INSERT INTO care_organization.ward_nursing_access VALUES('maker','${target.campus.id}'::uuid,'NORTH','READ');`);}

});

test.each([{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:false,safeEnded:false,extendFinish:false,lateCutover:false},{start:'2028-01-01T00:00:00.000001',end:'2029-01-01T00:00:00.000001',omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:false,safeEnded:false,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:true,dropPrimary:false,single:false,scheduledEnd:false,safeEnded:false,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:true,single:false,scheduledEnd:false,safeEnded:false,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:true,scheduledEnd:false,safeEnded:false,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:true,safeEnded:false,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:false,safeEnded:true,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:true,safeEnded:true,extendFinish:false,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:true,safeEnded:true,extendFinish:true,lateCutover:false},{start:'2026-01-01T00:00:00',end:null,omitSuccessor:false,dropPrimary:false,single:false,scheduledEnd:false,safeEnded:true,extendFinish:false,lateCutover:true}])('scope repartition atomically transfers the complete responsibility map, including finite future declarations: %j',async({start,end:finish,omitSuccessor,dropPrimary,single,scheduledEnd,safeEnded,extendFinish,lateCutover})=>{
 const f=nursingCoverage,a=await f.endpoint(),b=await f.sameWard(a),set=await f.register(a),oldScope=f.partition(set,single?[0]:[0,1]),old=f.entry(a,oldScope),T='2027-01-01T00:00:00.000001',switchAt=start>T?start:T;old.row.valid_from=start;old.row.valid_to=finish;const out=await f.apply(await f.input([old])),id=out.facts[0]!.id,definition=await f.scopeInput(a);if(definition.kind!=='SCOPE_DEFINITION')throw new Error('TEST_SCOPE_REQUIRED');
 const remainingFinish=scheduledEnd?'2029-01-01T00:00:00.000001':finish;if(scheduledEnd)await f.apply(await f.input([{...old,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},endAt:remainingFinish!,row:{...old.row,record_status:'RETIRED'}}]));
  if(safeEnded){const head=(await f.owner.history('maker',{id})).versions.at(-1)!.number;await f.apply(await f.input([{...old,action:'END',target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:head},endAt:switchAt,row:{...old.row,record_status:'RETIRED'}}]));}const before=await f.owner.history('maker',{id}),sourceHead=before.versions.at(-1)!.number,handoverAt=lateCutover?'2027-02-01T00:00:00.000001':switchAt;
 const revision={...definition,kind:'SCOPE_REVISION' as const,target:{id:set.id,expectedHead:'1'},definition:{...definition.definition,sourceAlias:set.sourceAlias,validFrom:T,partitions:definition.definition.partitions.map(p=>({...p,boundary:p.boundary+' TEST verified new boundary'}))},mapping:set.partitions.map(p=>({version:'1',partitionId:p.id,toAliases:[p.sourceAlias]}))};
 const proposed=await f.owner.stage('maker',revision);if(!proposed.proposal)throw new Error('TEST_PROPOSAL_REQUIRED');await f.owner.verify('reviewer',{...f.verification(revision,proposed),scopeDefinition:{completeAndDisjoint:true,definitionDigest:proposed.digest,evidenceId:f.artifact.artifactId}});
 const reference={inputId:proposed.inputId,revisionId:proposed.revisionId,digest:proposed.digest,contractVersionId:f.contract!.versionId},rootInput={requestId:randomUUID(),campus:'NORTH' as const,policy:'TEST_POLICY_ONLY' as const,kind:'REPARTITION' as const,cutover:T,reason:'TEST complete independently verified responsibility map',members:[{owner:'WARD_NURSING' as const,...reference}]};
 if(!safeEnded)await expect(bundle.stage('maker',rootInput)).rejects.toThrow('SCOPE_AFFECTED_COVERAGE_OMITTED');
 const coverage=(i:number)=>({kind:'PARTITIONS' as const,scopeSetId:set.id,version:'2',partitionIds:[proposed.proposal!.partitions[i]!.id]}),left=f.entry(a,coverage(0)),right=f.entry(b,coverage(1)),successors=single?[left]:[left,right];for(const e of successors){e.row.valid_from=handoverAt;e.row.valid_to=extendFinish?null:remainingFinish;e.row.handover_rule_ref='TEST_REPARTITION';}
 const end={...old,action:'END' as const,target:{owner:'care-organization/ward-nursing-coverage' as const,id,expectedHead:sourceHead},endAt:handoverAt,row:{...old.row,record_status:'RETIRED' as const}};
 if(omitSuccessor){const data=await f.input([end]),staged=await f.owner.stage('maker',data);await f.owner.verify('reviewer',f.verification(data,staged));await expect(bundle.stage('maker',{...rootInput,members:[...rootInput.members,{owner:'WARD_NURSING',...staged,contractVersionId:f.contract!.versionId}]})).rejects.toThrow('HANDOVER_NOT_CONFIRMED');return;}
 if(dropPrimary)for(const e of successors)e.row.is_primary='N';
 const data=await f.input([end,...successors]),staged=await f.owner.stage('maker',data),verification=f.verification(data,staged),plan={sourceCoverage:oldScope,repartition:reference,successors:successors.map(e=>({sourceAlias:e.row.ward_nursing_rel_id,nursing:e.applicability.nursing,coverage:e.coverage}))};
 for(const [index,e] of successors.entries())verification.rows[index+1]!.handover={kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:sourceHead},successorSourceAlias:e.row.ward_nursing_rel_id,successorNursing:e.applicability.nursing,coverage:e.coverage,cutover:handoverAt,ruleReference:'TEST_REPARTITION',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true,partitionPlan:plan};
 if(dropPrimary){await expect(f.confirmHandover(verification)).rejects.toThrow('HANDOVER_PRIMARY_DISCONTINUITY');return;}
  if(extendFinish||lateCutover){await expect(f.confirmHandover(verification)).rejects.toThrow('HANDOVER_NOT_CONFIRMED');expect((await f.owner.history('maker',{id})).versions).toEqual(before.versions);expect(await f.owner.read('maker',{id,businessAt:switchAt})).toMatchObject({state:'ENDED'});return;}
 await f.owner.verify('reviewer',await f.confirmHandover(verification));
 const grouped=await bundle.stage('maker',{...rootInput,members:[{owner:'WARD_NURSING',inputId:staged.inputId,revisionId:staged.revisionId,digest:staged.digest,contractVersionId:f.contract!.versionId},...rootInput.members]});
 await bundle.verify('reviewer',{inputId:grouped.inputId,inputDigest:grouped.digest,requestId:randomUUID(),reason:'TEST exact members and complete map independently accepted',policy:'TEST_POLICY_ONLY'});
 const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:grouped.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);
 const applied=await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(applied.status).toBe('COMMITTED');const after=await f.owner.history('maker',{id});expect(after.versions.slice(0,before.versions.length)).toEqual(before.versions);expect(await f.owner.read('maker',{id,businessAt:switchAt})).toMatchObject({state:'ENDED'});
  if(applied.status!=='COMMITTED')throw new Error('TEST_COMMITTED_REQUIRED');const source=after.versions.at(-1)!;
  const successorFacts=applied.facts.filter(f=>f.owner==='care-organization/ward-nursing-coverage'&&f.version==='1'),receipt={source:{id,versionId:source.id,version:source.number},cutover:handoverAt,status:'CONFIRMED_EFFECTIVE',successors:expect.arrayContaining(successorFacts.map(f=>expect.objectContaining({id:f.id,version:'1'}))),clinicalReadiness:'NOT_READY'};
  const direct=await f.owner.handoverReceipt('maker',{id,businessAt:handoverAt,recordAsOf:applied.recordedAt});expect(direct).toMatchObject(receipt);expect(direct.successors).toHaveLength(successorFacts.length);
  expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:handoverAt,recordAsOf:applied.recordedAt}))).toMatchObject(receipt);
  expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:handoverAt,recordAsOf:before.versions.at(-1)!.recordedAt}))).toMatchObject({status:'NOT_COMPLETED',successors:[]});
 const current=await f.owner.readScopeDefinition('maker',{id:set.id});expect(current.version).toBe('2');expect(await f.owner.readScopeVersion('maker',{id:set.id,version:'1'})).toMatchObject({id:set.id,version:'1',validTo:T});expect(await f.owner.readScopeDefinition('maker',{id:set.id,recordAsOf:set.recordedAt})).toEqual(set);
 expect(await f.owner.evaluateWindow('maker',{applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:{kind:'PARTITIONS',scopeSetId:set.id,version:'2',partitionIds:current.partitions.filter((_,index)=>!single||index===0).map(p=>p.id)},validFrom:switchAt,validTo:remainingFinish,mode:'CURRENT_ADMISSION'})).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true});
 if(!single&&start<T)for(const window of [{validFrom:'2026-12-01T00:00:00',validTo:T},{validFrom:'2026-12-01T00:00:00',validTo:'2027-02-01T00:00:00'}])expect(await f.owner.evaluateWindow('maker',{applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:{kind:'WHOLE_WARD'},...window,mode:'CURRENT_ADMISSION'})).toMatchObject({declaredCovered:true,primaryCovered:true,currentAdmissionCovered:true});
 expect(await bundle.reconcileCommittedUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'MATCHED'});
});

test('a safe END can only close coverage and cannot masquerade as a completed HANDOVER bundle',async()=>{
 const f=nursingCoverage,a=await f.endpoint(),old=f.entry(a,{kind:'WHOLE_WARD'}),created=await f.apply(await f.input([old])),id=created.facts[0]!.id,T='2028-10-01T00:00:00.000001',end={...old,action:'END' as const,target:{owner:'care-organization/ward-nursing-coverage' as const,id,expectedHead:'1'},endAt:T,row:{...old.row,record_status:'RETIRED' as const}},data=await f.input([end]),staged=await f.owner.stage('maker',data);await f.owner.verify('reviewer',f.verification(data,staged));
 const root={requestId:randomUUID(),campus:'NORTH' as const,policy:'TEST_POLICY_ONLY' as const,kind:'HANDOVER' as const,cutover:T,reason:'TEST no confirmed successor exists',members:[{owner:'WARD_NURSING' as const,...staged,contractVersionId:f.contract!.versionId}]};await expect(bundle.stage('maker',root)).rejects.toThrow('HANDOVER_NOT_CONFIRMED');
 const close=await bundle.stage('maker',{...root,requestId:randomUUID(),kind:'CLOSE'});await bundle.verify('reviewer',{requestId:randomUUID(),inputId:close.inputId,inputDigest:close.digest,reason:'TEST explicitly approved safe close retains a gap',policy:'TEST_POLICY_ONLY'});const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:close.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);expect((await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId})).status).toBe('COMMITTED');expect(await f.owner.handoverReceipt('maker',{id,businessAt:T})).toMatchObject({status:'NOT_COMPLETED',successors:[]});
});
test.each(['SHORT_WINDOW','PRIMARY'] as const)('a whole handover rejects %s before issuing Nursing confirmation',async(mode)=>{
 const f=nursingCoverage,a=await f.endpoint(),b=await f.sameWard(a),old=f.entry(a,{kind:'WHOLE_WARD'}),created=await f.apply(await f.input([old])),id=created.facts[0]!.id,T='2028-10-01T00:00:00.000001',next=f.entry(b,{kind:'WHOLE_WARD'});next.row.valid_from=T;next.row.handover_rule_ref='TEST_WHOLE_HANDOVER';if(mode==='SHORT_WINDOW')next.row.valid_to='2029-10-01T00:00:00.000001';else next.row.is_primary='N';
 const end={...old,action:'END' as const,target:{owner:'care-organization/ward-nursing-coverage' as const,id,expectedHead:'1'},endAt:T,row:{...old.row,record_status:'RETIRED' as const}},data=await f.input([end,next]),staged=await f.owner.stage('maker',data),verification=f.verification(data,staged);verification.rows[1]!.handover={kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'},successorSourceAlias:next.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:next.coverage,cutover:T,ruleReference:'TEST_WHOLE_HANDOVER',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true};
 await expect(f.confirmHandover(verification)).rejects.toThrow(mode==='PRIMARY'?'HANDOVER_PRIMARY_DISCONTINUITY':'HANDOVER_NOT_CONFIRMED');expect((await f.owner.history('maker',{id})).versions).toHaveLength(1);
});

test.each([{finite:true,safeEnded:false},{finite:false,safeEnded:false},{finite:true,safeEnded:true},{finite:false,safeEnded:true}])('a previously scheduled source END remains the exact remaining handover limit (finite=$finite, safeEnded=$safeEnded)',async({finite,safeEnded})=>{
 const f=nursingCoverage,a=await f.endpoint(),b=await f.sameWard(a),old=f.entry(a,{kind:'WHOLE_WARD'}),created=await f.apply(await f.input([old])),id=created.facts[0]!.id,T='2028-10-01T00:00:00.000001',E='2029-10-01T00:00:00.000001';
 const scheduled={...old,action:'END' as const,target:{owner:'care-organization/ward-nursing-coverage' as const,id,expectedHead:'1'},endAt:E,row:{...old.row,record_status:'RETIRED' as const}};await f.apply(await f.input([scheduled]));
 if(safeEnded)await f.apply(await f.input([{...scheduled,target:{...scheduled.target,expectedHead:'2'},endAt:T}]));const before=await f.owner.history('maker',{id}),expectedHead=safeEnded?'3':'2';
 const end={...scheduled,target:{...scheduled.target,expectedHead},endAt:T},next=f.entry(b,{kind:'WHOLE_WARD'});next.row.valid_from=T;next.row.valid_to=finite?E:null;next.row.handover_rule_ref='TEST_SCHEDULED_END';const data=await f.input([end,next]),staged=await f.owner.stage('maker',data),verification=f.verification(data,staged);verification.rows[1]!.handover={kind:'CONFIRMED_HANDOVER',source:{owner:'care-organization/ward-nursing-coverage',id,expectedHead},successorSourceAlias:next.row.ward_nursing_rel_id,successorNursing:b.nursing,coverage:next.coverage,cutover:T,ruleReference:'TEST_SCHEDULED_END',ruleVersion:'TEST_POLICY_ONLY_1',evidenceId:f.artifact.artifactId,confirmed:true};
 if(!finite){await expect(f.confirmHandover(verification)).rejects.toThrow('HANDOVER_NOT_CONFIRMED');return;}
 await f.owner.verify('reviewer',await f.confirmHandover(verification));const root=await bundle.stage('maker',{requestId:randomUUID(),campus:'NORTH',policy:'TEST_POLICY_ONLY',kind:'HANDOVER',cutover:T,reason:'TEST preserve preexisting source terminal period',members:[{owner:'WARD_NURSING',...staged,contractVersionId:f.contract!.versionId}]});await bundle.verify('reviewer',{requestId:randomUUID(),inputId:root.inputId,inputDigest:root.digest,reason:'TEST exact previous terminal and complete remaining responsibility',policy:'TEST_POLICY_ONLY'});const requestId=randomUUID(),candidate=await bundle.plan('maker',{inputId:root.inputId,requestId});await bundle.readApplyCandidate('reviewer',{candidateId:candidate.candidateId});await bundle.approveApplyUnit('reviewer',candidate);const result=await bundle.applyUnit('maker',{candidateId:candidate.candidateId,requestId});expect(result.status).toBe('COMMITTED');if(result.status!=='COMMITTED')throw new Error('TEST_COMMITTED_REQUIRED');expect(await f.owner.read('maker',{id:result.facts[1]!.id,businessAt:E})).toMatchObject({state:'NOT_EFFECTIVE'});const history=await f.owner.history('maker',{id});expect(history.versions).toHaveLength(safeEnded?4:3);expect(history.versions.slice(0,before.versions.length)).toEqual(before.versions);expect(await f.owner.read('maker',{id,businessAt:T})).toMatchObject({state:'ENDED'});expect(await bundle.reconcileCommittedUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'MATCHED'});
 const ended=history.versions.at(-1)!;
 const effective={source:{id,versionId:ended.id,version:ended.number},cutover:T,status:'CONFIRMED_EFFECTIVE',successors:[{id:result.facts[1]!.id,version:'1'}],clinicalReadiness:'NOT_READY'};
 expect(await f.owner.handoverReceipt('maker',{id,businessAt:T,recordAsOf:result.recordedAt})).toMatchObject(effective);
 expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:T,recordAsOf:result.recordedAt}))).toMatchObject(effective);
 expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:'2028-09-30T23:59:59.999999',recordAsOf:result.recordedAt}))).toMatchObject({...effective,status:'CONFIRMED_SCHEDULED'});
 expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:T,recordAsOf:before.versions.at(-1)!.recordedAt}))).toMatchObject({status:'NOT_COMPLETED',successors:[]});
  const later=await f.apply(await f.input([{...scheduled,target:{...scheduled.target,expectedHead:ended.number},endAt:T}]));
  expect(httpSuccess(await coverageClient.handoverReceipt({id,businessAt:T,recordAsOf:later.recordedAt}))).toMatchObject(effective);
  expect(httpSuccess(await coverageClient.query({id,businessAt:T,recordAsOf:later.recordedAt}))).toMatchObject({state:'ENDED',handoverStatus:'CONFIRMED_EFFECTIVE'});
  expect(httpSuccess(await coverageClient.query({id,businessAt:T,recordAsOf:before.versions.at(-1)!.recordedAt}))).toMatchObject({handoverStatus:'NOT_COMPLETED'});
  const listing=httpSuccess(await coverageClient.list({campus:'NORTH',campusId:a.campus.id,wardId:a.ward.id,businessAt:T,recordAsOf:later.recordedAt}));
  expect(listing.items.find(item=>item.id===id)).toMatchObject({handoverStatus:'CONFIRMED_EFFECTIVE'});
  expect(httpSuccess(await coverageClient.evaluate({applicability:{ward:a.ward,campus:a.campus,purpose:a.purpose},coverage:{kind:'WHOLE_WARD'},validFrom:T,validTo:E,mode:'HISTORICAL',recordAsOf:later.recordedAt})).handovers.find(item=>item.relationId===id)).toMatchObject({status:'CONFIRMED_EFFECTIVE'});
  expect((await f.owner.history('maker',{id})).versions.slice(0,history.versions.length)).toEqual(history.versions);
  expect(await bundle.reconcileCommittedUnit('maker',{candidateId:candidate.candidateId,requestId})).toMatchObject({status:'MATCHED'});
});
