import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {Check} from 'typebox/value';
import {LifecycleStageSchema,LifecycleInputSchema,LifecycleHistorySchema,LifecyclePlanSchema,LifecycleVerifySchema,LifecycleAssessmentSchema,LifecycleAssessmentResultSchema,LifecyclePreviewResultSchema,LifecycleReviewResultSchema,LifecycleHistoryResultSchema,LifecycleApprovalResultSchema,LifecycleFactOwnerSchema,UnitTime,type CareLocationLifecycleOwner} from '../../modules/care-organization/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema,canonicalPlan,type ObservedOwnerUnit} from '../../modules/governance-catalog/index.js';
import {parseStrictJson} from './strict-json.js';
const closed={additionalProperties:false} as const,Text=Type.String(),Id=LifecycleInputSchema.properties.inputId;
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,413:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
const Staged=Type.Object({inputId:Id,revisionId:Id,digest:Text},closed),Candidate=Type.Object({candidateId:Id},closed);
const Fact=Type.Object({owner:LifecycleFactOwnerSchema,id:Id,version:Text,source:Type.Optional(Type.Object({dataset:Text,row:Type.Integer(),step:Text},closed))},closed);
const Outcome=Type.Union([Type.Object({status:Type.Literal('COMMITTED'),candidateId:Id,requestId:Id,facts:Type.Array(Fact),recordedAt:UnitTime,responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed),Type.Object({status:Type.Literal('COMMIT_UNKNOWN'),candidateId:Id,requestId:Id},closed)]);
export interface CareLocationLifecycleHttpContext {owner:CareLocationLifecycleOwner;actor:(request:FastifyRequest)=>string}
const opaque=(value:unknown)=>({format:'OWNER_BASIS_JSON_V1' as const,canonicalJson:canonicalPlan(value)});
const publicChange=(value:{owner:string;change:unknown})=>({...value,change:opaque(value.change)});
const publicReview=(value:Awaited<ReturnType<CareLocationLifecycleOwner['readApplyCandidate']>>)=>{
 const basis=value.unit.basis,members=basis['members'] as Array<{owner:string;reference:unknown;unit:ObservedOwnerUnit}>,verification=basis['verification'] as null|{id:string;recordedAt:string;actor:string;identity:string;digest:string;observationDigest:string};
 // Public review keeps exact approval content while excluding its encrypted storage envelope.
 const metadata=verification?{id:verification.id,recordedAt:verification.recordedAt,actor:verification.actor,identity:verification.identity,digest:verification.digest,observationDigest:verification.observationDigest}:null;
 return {...value,unit:{...value.unit,basis:{input:basis['input'],inputDigest:basis['inputDigest'],verification:metadata,members:members.map(m=>({...m,unit:opaque(m.unit)})),dependencies:basis['dependencies']},diff:(value.unit.diff as Array<{owner:string;change:unknown}>).map(publicChange)}};
};
const publicHistory=(value:Awaited<ReturnType<CareLocationLifecycleOwner['history']>>)=>({...value,currentDependencyReview:{...value.currentDependencyReview,items:value.currentDependencyReview.items.map(item=>({...item,lifecycle:{id:item.lifecycle.id,state:item.lifecycle.state,head:item.lifecycle.head}}))}});
export function registerCareLocationLifecycleRoutes(app:FastifyInstance,context?:CareLocationLifecycleHttpContext){
 app.register(async scoped=>{
  scoped.removeContentTypeParser('application/json');scoped.addContentTypeParser('application/json',{parseAs:'string'},(_r,body,done)=>{try{if(typeof body!=='string')throw new Error('CLOSED_INPUT_REQUIRED');done(null,parseStrictJson(body));}catch{done(new Error('CLOSED_INPUT_REQUIRED'));}});
   const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handle:(owner:CareLocationLifecycleOwner,actor:string,input:Static<S>)=>Promise<unknown>)=>scoped.post<{Body:Static<S>}>('/api/vnext/care-location-lifecycle/'+path,{validatorCompiler:({schema})=>input=>Check(schema as never,input)?{value:input}:{error:new Error('CLOSED_INPUT_REQUIRED')},schema:{operationId,body,response:{200:response,...errors}}},async r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const value=await handle(context.owner,context.actor(r),r.body as Static<S>);if(!Check(response,value))throw new Error('OWNER_RESPONSE_INVALID');return value;});
   route('assess-space-move','assessSpaceMove',LifecycleAssessmentSchema,LifecycleAssessmentResultSchema,(o,a,b)=>o.assessSpaceMove(a,b));
  route('inputs','stageCareLocationLifecycle',LifecycleStageSchema,Staged,(o,a,b)=>o.stage(a,b));
  const specialized=(kind:'MOVE'|'CLOSE'|'RESUME')=>Type.Object({...LifecycleStageSchema.properties,kind:Type.Literal(kind)},closed);
  route('schedule-unit-move','scheduleUnitMove',specialized('MOVE'),Staged,(o,a,b)=>o.stage(a,b));
  route('close-care-relation','closeCareRelation',specialized('CLOSE'),Staged,(o,a,b)=>o.stage(a,b));
  route('reopen-suspended-unit','reopenSuspendedUnit',specialized('RESUME'),Staged,(o,a,b)=>o.stage(a,b));
  route('verify','verifyCareLocationLifecycle',LifecycleVerifySchema,Type.Object({verificationId:Id},closed),(o,a,b)=>o.verify(a,b));
   route('preview','previewCareLocationLifecycle',LifecycleInputSchema,LifecyclePreviewResultSchema,async(o,a,b)=>{const value=await o.preview(a,b);return {...value,changes:value.changes.map(publicChange)};});
  route('plan','planCareLocationLifecycle',LifecyclePlanSchema,Type.Object({candidateId:Id,digest:Text},closed),(o,a,b)=>o.plan(a,b));
   route('review','reviewCareLocationLifecycle',Candidate,LifecycleReviewResultSchema,async(o,a,b)=>publicReview(await o.readApplyCandidate(a,b)));
   route('approve','approveCareLocationLifecycle',ApproveApplyUnitSchema,LifecycleApprovalResultSchema,(o,a,b)=>o.approveApplyUnit(a,b));
  route('apply','applyCareLocationLifecycle',ApplyUnitSchema,Outcome,(o,a,b)=>o.applyUnit(a,b));
  route('resume','resumeCareLocationLifecycleOutcome',ApplyUnitSchema,Type.Union([Outcome,Type.Null()]),(o,a,b)=>o.resumeOutcome(a,b));
  route('reconcile','reconcileCareLocationLifecycleOutcome',ApplyUnitSchema,Type.Object({status:Type.Enum(['MATCHED','MISMATCH']),receiptId:Id},closed),(o,a,b)=>o.reconcileCommittedUnit(a,b));
   route('history','getCareLocationLifecycleHistory',LifecycleHistorySchema,LifecycleHistoryResultSchema,async(o,a,b)=>publicHistory(await o.history(a,b)));
 });
}
