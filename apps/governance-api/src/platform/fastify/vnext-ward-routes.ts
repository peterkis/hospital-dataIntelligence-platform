import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {WardId,WardTime,WardBindingSchema,WardStageSchema,WardStoredStageSchema,WardInputSchema,WardPlanSchema,WardVerifySchema,WardReceiveSchema,WardReadSchema,WardHistorySchema,WardExactSchema,WardListSchema,WardWindowSchema,WardDiffSchema,wardCheck,type WardOwner} from '../../modules/care-organization/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const,Text=Type.String(),End=Type.Union([WardTime,Type.Null()]),NullableText=Type.Union([Text,Type.Null()]);
const errors={400:Type.Object({code:Text,message:Text},closed),403:Type.Object({code:Text,message:Text},closed),404:Type.Object({code:Text,message:Text},closed),409:Type.Object({code:Text,message:Text},closed),503:Type.Object({code:Text,message:Text},closed)};
const Source=Type.Object({sourceAlias:Text,sourceVersion:Text,sourceSystemId:WardId,sourceRecordedAt:WardTime,recordLocatorEvidence:Type.Object({inputId:WardId,row:Type.Integer()},closed),recordStatus:Text,approvalReference:Text},closed);
const Facts=Type.Object({wardCode:Text,wardName:Text,wardType:Text,admissionRuleReference:NullableText,publicPhone:NullableText,responsibilityStatus:Type.Literal('PENDING'),source:Source,contractVersionId:WardId,managementBasis:Type.Unknown(),receivingBasis:Type.Unknown()},closed);
const Version=Type.Object({id:WardId,number:Text,action:Type.Enum(['CREATE','REVISE','REBIND','CLOSE','SUSPEND','RESUME']),validFrom:WardTime,validTo:End,recordedAt:WardTime,facts:Facts,reason:Text,changeId:WardId},closed);
const BindingVersion=Type.Object({id:WardId,number:Text,validFrom:WardTime,validTo:End,recordedAt:WardTime,binding:WardBindingSchema,dependencies:Type.Unknown(),changeId:WardId},closed);
const Read=Type.Object({id:WardId,campusId:WardId,head:Text,state:Type.Enum(['ACTIVE','SUSPENDED','CLOSED','NOT_EFFECTIVE']),version:Type.Union([Version,Type.Null()]),binding:Type.Union([BindingVersion,Type.Null()]),clinicalReadiness:Type.Literal('NOT_READY'),reasons:Type.Array(Text)},closed);
const History=Type.Object({id:WardId,campusId:WardId,versions:Type.Array(Version),bindings:Type.Array(Type.Object({id:WardId,campusId:WardId,managingUnitId:WardId,scope:Type.Enum(['NORTH','SOUTH']),versions:Type.Array(BindingVersion)},closed)),codes:Type.Array(Text)},closed);
const Fact=Type.Object({owner:Type.Literal('care-organization/ward'),id:WardId,version:Text,source:Type.Optional(Type.Object({dataset:Type.Literal('ORG08'),row:Type.Integer(),step:Text},closed))},closed);
const Outcome=Type.Union([Type.Object({status:Type.Literal('COMMITTED'),candidateId:WardId,requestId:WardId,facts:Type.Array(Fact),recordedAt:WardTime,responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed),Type.Object({status:Type.Literal('COMMIT_UNKNOWN'),candidateId:WardId,requestId:WardId},closed)]);
const Issue=Type.Object({row:Type.Integer(),field:Text,code:Text,status:Type.Enum(['FAIL','BLOCKED'])},closed),Candidate=Type.Object({candidateId:WardId},closed);
export interface WardHttpContext {owner:WardOwner;actor:(request:FastifyRequest)=>string}
export function registerWardRoutes(app:FastifyInstance,context?:WardHttpContext){
 // The shared TypeBox check keeps exact raw input; AJV's default coercion would
 // turn nullable text into empty strings before it reaches protected staging.
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handle:(owner:WardOwner,actor:string,input:Static<S>)=>Promise<unknown>)=>app.post<{Body:Static<S>}>('/api/vnext/wards/'+path,{validatorCompiler:({schema})=>input=>{try{wardCheck(schema,input);return {value:input};}catch(error){return {error:error instanceof Error?error:new Error('CLOSED_INPUT_REQUIRED')};}},schema:{operationId,body,response:{200:response,...errors}}},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return handle(context.owner,context.actor(r),r.body as Static<S>);});
 route('inputs','stageWardInput',WardStageSchema,Type.Object({inputId:WardId,revisionId:WardId,digest:Text},closed),(o,a,b)=>o.stage(a,b));
 route('inputs/read','readWardInput',WardInputSchema,WardStoredStageSchema,(o,a,b)=>o.readInput(a,b));
 route('verify','verifyWardInput',WardVerifySchema,Type.Object({verificationId:WardId},closed),(o,a,b)=>o.verify(a,b));
 route('preview','previewWardInput',WardInputSchema,Type.Object({decision:Type.Enum(['PASS','BLOCKED']),issues:Type.Array(Issue),changes:Type.Array(Type.Object({action:Text,targetId:Type.Union([WardId,Type.Null()]),name:Text,validFrom:WardTime,validTo:End},closed))},closed),(o,a,b)=>o.preview(a,b));
 route('plan','planWardInput',WardPlanSchema,Type.Object({candidateId:WardId,digest:Text},closed),(o,a,b)=>o.plan(a,b));
 route('withdraw','withdrawWardInput',WardPlanSchema,Type.Object({inputId:WardId,status:Type.Literal('WITHDRAWN')},closed),(o,a,b)=>o.withdraw(a,b));
 route('review','reviewWardCandidate',Candidate,Type.Unknown(),(o,a,b)=>o.readApplyCandidate(a,b));
 route('approve','approveWardCandidate',ApproveApplyUnitSchema,Type.Unknown(),(o,a,b)=>o.approveApplyUnit(a,b));
 route('apply','applyWardCandidate',ApplyUnitSchema,Outcome,(o,a,b)=>o.applyUnit(a,b));
 route('resume','resumeWardOutcome',ApplyUnitSchema,Type.Union([Outcome,Type.Null()]),(o,a,b)=>o.resumeOutcome(a,b));
 route('reconcile','reconcileWardOutcome',ApplyUnitSchema,Type.Unknown(),(o,a,b)=>o.reconcileCommittedUnit(a,b));
 route('history','getWardHistory',WardHistorySchema,History,(o,a,b)=>o.history(a,b));
 route('query','getWardAsOf',WardReadSchema,Read,(o,a,b)=>o.read(a,b));
 route('exact','getWardVersion',WardExactSchema,Version,(o,a,b)=>o.exact(a,b));
 route('diff','diffWardVersions',WardDiffSchema,Type.Object({id:WardId,before:Version,after:Version},closed),(o,a,b)=>o.diff(a,b));
 route('list','listWards',WardListSchema,Type.Object({items:Type.Array(Read),nextAfterId:Type.Union([WardId,Type.Null()])},closed),(o,a,b)=>o.list(a,b));
 route('coverage','getWardCoverage',WardWindowSchema,Type.Object({id:WardId,covered:Type.Boolean(),parts:Type.Array(Type.Object({from:WardTime,to:End,version:Text,versionId:WardId},closed)),clinicalReadiness:Type.Literal('NOT_READY')},closed),(o,a,b)=>o.coverage(a,b));
 route('evaluate','evaluateWardWindow',WardWindowSchema,Type.Object({id:WardId,coreCovered:Type.Boolean(),checks:Type.Array(Type.Union([Type.Object({from:WardTime,to:End,status:Type.Literal('SATISFIED'),basis:Type.Unknown(),source:Type.Unknown()},closed),Type.Object({from:WardTime,to:End,status:Type.Literal('NOT_SATISFIED'),reason:Text},closed)])),clinicalReadiness:Type.Literal('NOT_READY'),responsibility:Type.Literal('NOT_EVALUABLE'),clinicalCapability:Type.Literal('NOT_EVALUABLE')},closed),(o,a,b)=>o.evaluateWindow(a,b));
 const FileBody=Type.Object({input:WardReceiveSchema,contentBase64:Type.String({minLength:4,maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'})},closed);
 app.post<{Body:Static<typeof FileBody>}>('/api/vnext/wards/files',{bodyLimit:1500000,preValidation:async r=>{wardCheck(FileBody,r.body);},schema:{operationId:'receiveWardFile',body:FileBody,response:{200:Type.Object({jobId:WardId,revisionId:WardId,sourceArtifactId:WardId,structuralStatus:Type.Enum(['PARSED','REJECTED']),input:Type.Union([Type.Object({inputId:WardId,revisionId:WardId,digest:Text},closed),Type.Null()]),issues:Type.Array(Issue),validation:Type.Unknown()},closed),...errors}}},async r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const bytes=Buffer.from(r.body.contentBase64,'base64');try{return await context.owner.receiveFile(context.actor(r),r.body.input,bytes);}finally{bytes.fill(0);}});
}
