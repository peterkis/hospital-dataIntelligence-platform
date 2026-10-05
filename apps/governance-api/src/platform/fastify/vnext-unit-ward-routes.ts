import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {unitWardCheck,UnitWardId,UnitWardTime,UnitWardStageSchema,UnitWardDirectStageSchema,UnitWardStoredStageSchema,UnitWardInputSchema,UnitWardPlanSchema,UnitWardVerifySchema,UnitWardReceiveSchema,UnitWardReadSchema,UnitWardHistorySchema,UnitWardExactSchema,UnitWardListSchema,UnitWardWindowSchema,UnitWardDiffSchema,UnitWardRuleSchema,UnitWardScopeSchema,type UnitWardOwner} from '../../modules/care-organization/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const,Text=Type.String(),End=Type.Union([UnitWardTime,Type.Null()]);
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,503:ErrorSchema};
const Source=Type.Object({sourceAlias:Text,sourceVersion:Text,sourceSystemId:UnitWardId,sourceRecordedAt:UnitWardTime,recordLocatorEvidence:Type.Object({inputId:UnitWardId,row:Type.Integer()},closed),recordStatus:Text,approvalReference:Text},closed);
const Facts=Type.Object({relationType:Type.Enum(['收治','管理','共享']),isPrimary:Type.Boolean(),sharingRule:Type.Union([Text,Type.Null()]),rule:UnitWardRuleSchema,contractVersionId:UnitWardId,verificationBasis:Type.Object({id:UnitWardId,version:Text,digest:Text},closed),dependencies:Type.Unknown(),source:Source},closed);
const Version=Type.Object({id:UnitWardId,number:Text,action:Type.Enum(['CREATE','REVISE','END']),validFrom:UnitWardTime,validTo:End,recordedAt:UnitWardTime,facts:Facts,reason:Text,changeId:UnitWardId},closed);
const Read=Type.Object({id:UnitWardId,applicability:UnitWardScopeSchema,head:Text,state:Type.Enum(['ACTIVE','ENDED','NOT_EFFECTIVE']),version:Type.Union([Version,Type.Null()]),clinicalReadiness:Type.Literal('NOT_READY')},closed);
const History=Type.Object({id:UnitWardId,scope:Type.Enum(['NORTH','SOUTH']),applicability:UnitWardScopeSchema,versions:Type.Array(Version)},closed);
const Fact=Type.Object({owner:Type.Literal('care-organization/unit-ward-relation'),id:UnitWardId,version:Text,source:Type.Optional(Type.Object({dataset:Type.Literal('ORG10'),row:Type.Integer(),step:Text},closed))},closed);
const Outcome=Type.Union([Type.Object({status:Type.Literal('COMMITTED'),candidateId:UnitWardId,requestId:UnitWardId,facts:Type.Array(Fact),recordedAt:UnitWardTime,responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed),Type.Object({status:Type.Literal('COMMIT_UNKNOWN'),candidateId:UnitWardId,requestId:UnitWardId},closed)]);
const Issue=Type.Object({row:Type.Integer(),field:Text,code:Text,status:Type.Enum(['FAIL','BLOCKED'])},closed),Candidate=Type.Object({candidateId:UnitWardId},closed);
export interface UnitWardHttpContext {owner:UnitWardOwner;actor:(request:FastifyRequest)=>string}
export function registerUnitWardRoutes(app:FastifyInstance,context?:UnitWardHttpContext){
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handle:(owner:UnitWardOwner,actor:string,input:Static<S>)=>Promise<unknown>)=>app.post<{Body:Static<S>}>('/api/vnext/unit-ward-relations/'+path,{validatorCompiler:({schema})=>input=>{try{unitWardCheck(schema,input);return {value:input};}catch(error){return {error:error instanceof Error?error:new Error('CLOSED_INPUT_REQUIRED')};}},schema:{operationId,body,response:{200:response,...errors}}},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return handle(context.owner,context.actor(r),r.body as Static<S>);});
 route('inputs','stageUnitWardInput',UnitWardDirectStageSchema,Type.Object({inputId:UnitWardId,revisionId:UnitWardId,digest:Text},closed),(o,a,b)=>o.stage(a,b));
 route('inputs/read','readUnitWardInput',UnitWardInputSchema,UnitWardStoredStageSchema,(o,a,b)=>o.readInput(a,b));
 route('verify','verifyUnitWardInput',UnitWardVerifySchema,Type.Object({verificationId:UnitWardId},closed),(o,a,b)=>o.verify(a,b));
 route('preview','previewUnitWardInput',UnitWardInputSchema,Type.Object({decision:Type.Enum(['PASS','BLOCKED']),issues:Type.Array(Issue),changes:Type.Array(Type.Object({action:Text,targetId:Type.Union([UnitWardId,Type.Null()]),validFrom:UnitWardTime,validTo:End},closed))},closed),(o,a,b)=>o.preview(a,b));
 route('plan','planUnitWardInput',UnitWardPlanSchema,Type.Object({candidateId:UnitWardId,digest:Text},closed),(o,a,b)=>o.plan(a,b));
 route('withdraw','withdrawUnitWardInput',UnitWardPlanSchema,Type.Object({inputId:UnitWardId,status:Type.Literal('WITHDRAWN')},closed),(o,a,b)=>o.withdraw(a,b));
 route('review','reviewUnitWardCandidate',Candidate,Type.Unknown(),(o,a,b)=>o.readApplyCandidate(a,b));
 route('approve','approveUnitWardCandidate',ApproveApplyUnitSchema,Type.Unknown(),(o,a,b)=>o.approveApplyUnit(a,b));
 route('apply','applyUnitWardCandidate',ApplyUnitSchema,Outcome,(o,a,b)=>o.applyUnit(a,b));
 route('resume','resumeUnitWardOutcome',ApplyUnitSchema,Type.Union([Outcome,Type.Null()]),(o,a,b)=>o.resumeOutcome(a,b));
 route('reconcile','reconcileUnitWardOutcome',ApplyUnitSchema,Type.Unknown(),(o,a,b)=>o.reconcileCommittedUnit(a,b));
 route('query','getUnitWardAsOf',UnitWardReadSchema,Read,(o,a,b)=>o.read(a,b));
 route('history','getUnitWardHistory',UnitWardHistorySchema,History,(o,a,b)=>o.history(a,b));
 route('exact','getUnitWardVersion',UnitWardExactSchema,Version,(o,a,b)=>o.exact(a,b));
 route('diff','diffUnitWardVersions',UnitWardDiffSchema,Type.Object({id:UnitWardId,before:Version,after:Version},closed),(o,a,b)=>o.diff(a,b));
 route('list','listUnitWardRelations',UnitWardListSchema,Type.Object({items:Type.Array(Read),nextAfterId:Type.Union([UnitWardId,Type.Null()])},closed),(o,a,b)=>o.list(a,b));
 route('evaluate','evaluateUnitWardWindow',UnitWardWindowSchema,Type.Object({mode:Type.Enum(['CURRENT_ADMISSION','HISTORICAL']),recordAsOf:UnitWardTime,status:Type.Enum(['SATISFIED','NOT_SATISFIED']),checks:Type.Array(Type.Object({from:UnitWardTime,to:End,status:Type.Enum(['SATISFIED','NOT_SATISFIED']),reason:Text,relationId:Type.Union([UnitWardId,Type.Null()]),acceptedBasis:Type.Unknown(),basis:Type.Unknown()},closed)),clinicalReadiness:Type.Literal('NOT_READY')},closed),(o,a,b)=>o.evaluateWindow(a,b));
 const File=Type.Object({input:UnitWardReceiveSchema,contentBase64:Type.String({minLength:4,maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'})},closed);
 app.post<{Body:Static<typeof File>}>('/api/vnext/unit-ward-relations/files',{validatorCompiler:({schema})=>input=>{try{unitWardCheck(schema,input);return {value:input};}catch(error){return {error:error instanceof Error?error:new Error('CLOSED_INPUT_REQUIRED')};}},bodyLimit:1500000,schema:{operationId:'receiveUnitWardFile',body:File,response:{200:Type.Object({jobId:UnitWardId,revisionId:UnitWardId,sourceArtifactId:UnitWardId,structuralStatus:Type.Enum(['PARSED','REJECTED']),input:Type.Union([Type.Object({inputId:UnitWardId,revisionId:UnitWardId,digest:Text},closed),Type.Null()]),issues:Type.Array(Issue),validation:Type.Unknown()},closed),...errors}}},async r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const bytes=Buffer.from(r.body.contentBase64,'base64');try{return await context.owner.receiveFile(context.actor(r),r.body.input,bytes);}finally{bytes.fill(0);}});
}
