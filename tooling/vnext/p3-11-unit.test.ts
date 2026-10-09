import {randomUUID} from 'node:crypto';
import {test,expect,afterAll} from 'vitest';
import {Check} from 'typebox/value';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import type {CareLocationLifecycleInput} from '../../packages/generated-api-client/src/index.js';
import {LifecycleStageSchema} from '../../apps/governance-api/src/modules/care-organization/lifecycle-contracts.js';
import {LifecycleAssessmentResultSchema,LifecycleHistoryResultSchema,LifecycleReviewResultSchema} from '../../apps/governance-api/src/modules/care-organization/lifecycle-response-contracts.js';
import type {operations} from '../../packages/generated-api-client/src/vnext-schema.generated.js';
import {wardNursingCheck} from '../../apps/governance-api/src/modules/care-organization/ward-nursing-contracts.js';
const app=await buildCatalogServer();await app.listen({host:'127.0.0.1',port:0});afterAll(()=>app.close());
const input=():CareLocationLifecycleInput=>({requestId:randomUUID(),campus:'NORTH',kind:'MOVE',policy:'TEST_POLICY_ONLY',cutover:'2027-01-01T00:00:00.000001',reason:'TEST closed exact Owner references',members:[{owner:'LOCATION_USE',inputId:randomUUID(),revisionId:randomUUID(),digest:'a'.repeat(64),contractVersionId:randomUUID()}]});
const send=(body:unknown)=>fetch(app.listeningOrigin+'/api/vnext/care-location-lifecycle/schedule-unit-move',{method:'POST',headers:{'content-type':'application/json','x-catalog-actor':'maker'},body:JSON.stringify(body)});
test('generated input accepts exact Owner references and six-place local times through the actual HTTP contract',async()=>{const value=input();expect(Check(LifecycleStageSchema,value)).toBe(true);expect((await send(value)).status).toBe(503);});
test('finite lifecycle input rejects an arbitrary Owner, SQL, personnel command and undeclared business field',async()=>{const value=input();for(const rejected of [{...value,sql:'select 1'},{...value,personnelTransfer:true},{...value,members:[{...value.members[0]!,owner:'PERSONNEL'}]},{...value,members:[{...value.members[0]!,target:'implicit room'}]}])expect((await send(rejected)).status).toBe(400);});
test('the contract refuses missing exact digest, wrong typed target, malformed time and unbounded member lists',async()=>{const value=input();for(const rejected of [{...value,cutover:'2027-01-01T00:00:00.0000001'},{...value,cutover:'2027-01-01T00:00:00Z'},{...value,members:[{...value.members[0]!,digest:'bad'}]},{...value,members:Array.from({length:101},()=>value.members[0]!)}])expect((await send(rejected)).status).toBe(400);});
test('strict JSON rejects duplicate names, including escaped aliases',async()=>{const text=JSON.stringify(input());for(const field of ['kind','k\\u0069nd']){const result=await fetch(app.listeningOrigin+'/api/vnext/care-location-lifecycle/inputs',{method:'POST',headers:{'content-type':'application/json'},body:text.replace('"kind":"MOVE"',`"kind":"MOVE","${field}":"MOVE"`)});expect(result.status).toBe(400);}});
test('exact immutable scope versions enforce the database bigint range before any Owner call',async()=>{for(const [version,status] of [['9223372036854775807',503],['9223372036854775808',400],['9999999999999999999',400],['0',400]]){const result=await fetch(app.listeningOrigin+'/api/vnext/ward-nursing-coverages/scope-definitions/exact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:randomUUID(),version})});expect(result.status).toBe(status);}});
// @ts-expect-error - the generated contract does not expose arbitrary Owner names.
const invalidOwner:CareLocationLifecycleInput['members'][number]['owner']='PERSONNEL';
// @ts-expect-error - source digest cannot be omitted from a native input reference.
const missingDigest:CareLocationLifecycleInput['members'][number]={owner:'UNIT',inputId:randomUUID(),revisionId:randomUUID(),contractVersionId:randomUUID()};
void invalidOwner;void missingDigest;
type Assessment=operations['assessSpaceMove']['responses'][200]['content']['application/json'];
type History=operations['getCareLocationLifecycleHistory']['responses'][200]['content']['application/json'];
const assessment:Assessment={target:{kind:'UNIT',id:randomUUID()},recordAsOf:'2028-01-01T00:00:00.000001',items:[],unavailable:[{owner:'BED_RESOURCE',status:'NOT_EVALUABLE'}],dispositionStatus:'NO_IMPLEMENTED_REFERENCE',clinicalReadiness:'NOT_READY'};
test('executable success contract preserves unknown dependencies without inventing completed disposition',()=>{expect(Check(LifecycleAssessmentResultSchema,assessment)).toBe(true);for(const bad of [{...assessment,dispositionStatus:'CLOSED'},{...assessment,unavailable:[{owner:'BED_RESOURCE',status:'SATISFIED'}]},{...assessment,recordAsOf:'2028-01-01T00:00:00.0000001'},{...assessment,personnelCount:0}])expect(Check(LifecycleAssessmentResultSchema,bad)).toBe(false);});
test('history success requires exact accepted verification and a separate typed current B/R review',()=>{const value:History={input:input(),originalAcceptedBasis:{inputDigest:'a'.repeat(64),observationDigest:'b'.repeat(64),verification:null},currentDependencyReview:{businessAt:'2028-01-01T00:00:00.000001',recordAsOf:assessment.recordAsOf,items:[]},policy:'TEST_POLICY_ONLY',clinicalReadiness:'NOT_READY'};expect(Check(LifecycleHistoryResultSchema,value)).toBe(true);expect(Check(LifecycleHistoryResultSchema,{...value,currentDependencyReview:{...value.currentDependencyReview,recordAsOf:undefined}})).toBe(false);expect(Check(LifecycleReviewResultSchema,{candidateId:randomUUID(),digest:'a'.repeat(64)})).toBe(false);});
// @ts-expect-error - unsupported consumers cannot be represented as admitted dependency Owners.
const invalidResponseOwner:Assessment['items'][number]['owner']='PERSONNEL';
// @ts-expect-error - an unimplemented dependency has no SATISFIED success status.
const invalidResponseStatus:Assessment['unavailable'][number]['status']='SATISFIED';
// @ts-expect-error - success must carry a complete current B/R review envelope.
const missingCurrentRecord:History['currentDependencyReview']={businessAt:'2028-01-01T00:00:00.000001',items:[]};
void invalidResponseOwner;void invalidResponseStatus;void missingCurrentRecord;
const publishedResponse=(path:string)=>{const response=app.swagger().paths?.[path]?.post?.responses?.['200'];if(!response||!('content' in response))throw new Error('RESPONSE_SCHEMA_REQUIRED');const schema=response.content?.['application/json']?.schema;if(!schema)throw new Error('RESPONSE_SCHEMA_REQUIRED');return schema;};
test('the published nursing impact response admits RESUME with exact finite and unbounded periods',()=>{
 const id=randomUUID(),period={from:'2028-01-01T00:00:00.000001',to:null},scope={ward:{owner:'care-organization/ward',id},nursing:{owner:'care-organization/nursing',id},campus:{owner:'organization-master/campus',id},purpose:'NURSING_COVERAGE'},coverage={kind:'WHOLE_WARD'};
 const item={id,applicability:scope,original:{versionId:id,version:'1',period,coverage,digest:'a'.repeat(64),dependencies:{}},current:{versionId:id,version:'1',action:'CREATE',period,coverage},active:true,outstanding:true,affectedSpans:[period],lifecycle:[],constraint:'SATISFIED'};
 const value={owner:'WARD_NURSING_COVERAGE',endpoint:{kind:'NURSING',id},validFrom:period.from,validTo:null,recordAsOf:period.from,status:'EVALUATED',clinicalReadiness:'NOT_READY',items:[item]},schema=publishedResponse('/api/vnext/ward-nursing-coverages/impacts');
 for(const to of [null,'2029-01-01T00:00:00.999999'])expect(()=>wardNursingCheck(schema,{...value,items:[{...item,lifecycle:[{versionId:id,action:'RESUME',from:period.from,to}]}]})).not.toThrow();
});
test('the published handover receipt rejects undeclared fields and incoherent status branches',()=>{
 const schema=publishedResponse('/api/vnext/ward-nursing-coverages/handover-receipt'),id=randomUUID(),incomplete={source:{id,head:'1'},cutover:null,status:'NOT_COMPLETED',successors:[],clinicalReadiness:'NOT_READY'};
 expect(()=>wardNursingCheck(schema,incomplete)).not.toThrow();
 for(const bad of [{...incomplete,clinicalReadiness:undefined},{...incomplete,unrestrictedMaterial:'not part of receipt'},{...incomplete,status:'CONFIRMED_EFFECTIVE'},{...incomplete,successors:[{id}]},{...incomplete,source:{id,head:'9223372036854775808'}}])expect(()=>wardNursingCheck(schema,bad)).toThrow();
});
type Receipt=operations['getWardNursingHandoverReceipt']['responses'][200]['content']['application/json'];
type ImpactLifecycle=operations['evaluateWardNursingEndpointImpacts']['responses'][200]['content']['application/json']['items'][number]['lifecycle'][number];
const typedIncomplete:Extract<Receipt,{status:'NOT_COMPLETED'}>={source:{id:randomUUID(),head:'1'},cutover:null,status:'NOT_COMPLETED',successors:[],clinicalReadiness:'NOT_READY'};
const typedResume:ImpactLifecycle={versionId:randomUUID(),action:'RESUME',from:'2028-01-01T00:00:00.000001',to:'2029-01-01T00:00:00.999999'};
// @ts-expect-error - a confirmed receipt identifies the accepted END and its exact expected source head.
const unversionedConfirmation:Extract<Receipt,{status:'CONFIRMED_EFFECTIVE'}>['source']={id:randomUUID(),head:'1'};
// @ts-expect-error - the official lifecycle response cannot invent an unimplemented action.
const invalidLifecycleAction:ImpactLifecycle['action']='REOPEN';
// @ts-expect-error - an incomplete receipt cannot masquerade as a confirmed scheduled branch.
const invalidConfirmedReceipt:Extract<Receipt,{status:'CONFIRMED_SCHEDULED'}>={...typedIncomplete,status:'CONFIRMED_SCHEDULED'};
void typedIncomplete;void typedResume;void unversionedConfirmation;void invalidLifecycleAction;void invalidConfirmedReceipt;
