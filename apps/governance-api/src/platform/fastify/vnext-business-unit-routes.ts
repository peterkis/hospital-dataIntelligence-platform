import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {UnitId,UnitTime,UnitBindingSchema,UnitStageSchema,UnitStoredStageSchema,UnitInputSchema,UnitPlanSchema,UnitVerifySchema,UnitReceiveSchema,UnitReadSchema,UnitHistorySchema,UnitExactSchema,UnitListSchema,UnitWindowSchema,UnitDiffSchema,UNIT_TYPES,unitCheck,type BusinessUnitOwner} from '../../modules/care-organization/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const,Text=Type.String(),End=Type.Union([UnitTime,Type.Null()]),NullableText=Type.Union([Text,Type.Null()]);
const errors={400:Type.Object({code:Text,message:Text},closed),403:Type.Object({code:Text,message:Text},closed),404:Type.Object({code:Text,message:Text},closed),409:Type.Object({code:Text,message:Text},closed),503:Type.Object({code:Text,message:Text},closed)};
const Source=Type.Object({sourceAlias:Text,sourceVersion:Text,sourceSystemId:UnitId,sourceRecordedAt:UnitTime,recordLocatorEvidence:Type.Object({inputId:UnitId,row:Type.Integer()},closed),recordStatus:Text,approvalReference:Text},closed);
const Facts=Type.Object({unitCode:Text,unitName:Text,unitType:Type.Enum(UNIT_TYPES),publicPhone:NullableText,serviceDescription:NullableText,receivingRuleReference:NullableText,responsibilityStatus:Type.Literal('PENDING'),source:Source,contractVersionId:UnitId,receivingBasis:Type.Unknown()},closed);
const Version=Type.Object({id:UnitId,number:Text,action:Type.Enum(['CREATE','REVISE','REBIND','CLOSE']),validFrom:UnitTime,validTo:End,recordedAt:UnitTime,facts:Facts,reason:Text,changeId:UnitId},closed);
const BindingVersion=Type.Object({id:UnitId,number:Text,validFrom:UnitTime,validTo:End,recordedAt:UnitTime,binding:UnitBindingSchema,dependencies:Type.Unknown(),changeId:UnitId},closed);
const Read=Type.Object({id:UnitId,departmentId:UnitId,head:Text,state:Type.Enum(['ACTIVE','CLOSED','NOT_EFFECTIVE']),version:Type.Union([Version,Type.Null()]),binding:Type.Union([BindingVersion,Type.Null()]),clinicalReadiness:Type.Literal('NOT_READY'),reasons:Type.Array(Text)},closed);
const History=Type.Object({id:UnitId,departmentId:UnitId,versions:Type.Array(Version),bindings:Type.Array(Type.Object({id:UnitId,campusId:UnitId,subjectId:UnitId,scope:Type.Enum(['NORTH','SOUTH']),versions:Type.Array(BindingVersion)},closed)),codes:Type.Array(Text)},closed);
const Fact=Type.Object({owner:Type.Literal('care-organization/unit'),id:UnitId,version:Text,source:Type.Optional(Type.Object({dataset:Type.Literal('ORG07'),row:Type.Integer(),step:Text},closed))},closed);
const Outcome=Type.Union([Type.Object({status:Type.Literal('COMMITTED'),candidateId:UnitId,requestId:UnitId,facts:Type.Array(Fact),recordedAt:UnitTime,responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed),Type.Object({status:Type.Literal('COMMIT_UNKNOWN'),candidateId:UnitId,requestId:UnitId},closed)]);
const Issue=Type.Object({row:Type.Integer(),field:Text,code:Text,status:Type.Enum(['FAIL','BLOCKED'])},closed),Candidate=Type.Object({candidateId:UnitId},closed);
export interface BusinessUnitHttpContext {owner:BusinessUnitOwner;actor:(request:FastifyRequest)=>string}
export function registerBusinessUnitRoutes(app:FastifyInstance,context?:BusinessUnitHttpContext){
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handle:(owner:BusinessUnitOwner,actor:string,input:Static<S>)=>Promise<unknown>)=>app.post<{Body:Static<S>}>('/api/vnext/business-units/'+path,{preValidation:async r=>{unitCheck(body,r.body);},schema:{operationId,body,response:{200:response,...errors}}},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return handle(context.owner,context.actor(r),r.body as Static<S>);});
 route('inputs','stageBusinessUnitInput',UnitStageSchema,Type.Object({inputId:UnitId,revisionId:UnitId,digest:Text},closed),(o,a,b)=>o.stage(a,b));
 route('inputs/read','readBusinessUnitInput',UnitInputSchema,UnitStoredStageSchema,(o,a,b)=>o.readInput(a,b));
 route('verify','verifyBusinessUnitInput',UnitVerifySchema,Type.Object({verificationId:UnitId},closed),(o,a,b)=>o.verify(a,b));
 route('preview','previewBusinessUnitInput',UnitInputSchema,Type.Object({decision:Type.Enum(['PASS','BLOCKED']),issues:Type.Array(Issue),changes:Type.Array(Type.Object({action:Text,targetId:Type.Union([UnitId,Type.Null()]),name:Text,validFrom:UnitTime,validTo:End},closed))},closed),(o,a,b)=>o.preview(a,b));
 route('plan','planBusinessUnitInput',UnitPlanSchema,Type.Object({candidateId:UnitId,digest:Text},closed),(o,a,b)=>o.plan(a,b));
 route('withdraw','withdrawBusinessUnitInput',UnitPlanSchema,Type.Object({inputId:UnitId,status:Type.Literal('WITHDRAWN')},closed),(o,a,b)=>o.withdraw(a,b));
 route('review','reviewBusinessUnitCandidate',Candidate,Type.Unknown(),(o,a,b)=>o.readApplyCandidate(a,b));
 route('approve','approveBusinessUnitCandidate',ApproveApplyUnitSchema,Type.Unknown(),(o,a,b)=>o.approveApplyUnit(a,b));
 route('apply','applyBusinessUnitCandidate',ApplyUnitSchema,Outcome,(o,a,b)=>o.applyUnit(a,b));
 route('resume','resumeBusinessUnitOutcome',ApplyUnitSchema,Type.Union([Outcome,Type.Null()]),(o,a,b)=>o.resumeOutcome(a,b));
 route('reconcile','reconcileBusinessUnitOutcome',ApplyUnitSchema,Type.Unknown(),(o,a,b)=>o.reconcileCommittedUnit(a,b));
 route('history','getBusinessUnitHistory',UnitHistorySchema,History,(o,a,b)=>o.history(a,b));
 route('query','getBusinessUnitAsOf',UnitReadSchema,Read,(o,a,b)=>o.read(a,b));
 route('exact','getBusinessUnitVersion',UnitExactSchema,Version,(o,a,b)=>o.exact(a,b));
 route('diff','diffBusinessUnitVersions',UnitDiffSchema,Type.Object({id:UnitId,before:Version,after:Version},closed),(o,a,b)=>o.diff(a,b));
 route('list','listBusinessUnits',UnitListSchema,Type.Object({items:Type.Array(Read),nextAfterId:Type.Union([UnitId,Type.Null()])},closed),(o,a,b)=>o.list(a,b));
 route('coverage','getBusinessUnitCoverage',UnitWindowSchema,Type.Object({id:UnitId,covered:Type.Boolean(),parts:Type.Array(Type.Object({from:UnitTime,to:End,version:Text,versionId:UnitId},closed)),clinicalReadiness:Type.Literal('NOT_READY')},closed),(o,a,b)=>o.coverage(a,b));
 route('evaluate','evaluateBusinessUnitWindow',UnitWindowSchema,Type.Object({id:UnitId,coreCovered:Type.Boolean(),checks:Type.Array(Type.Union([Type.Object({from:UnitTime,to:End,status:Type.Literal('SATISFIED'),basis:Type.Unknown()},closed),Type.Object({from:UnitTime,to:End,status:Type.Literal('NOT_SATISFIED'),reason:Text},closed)])),clinicalReadiness:Type.Literal('NOT_READY'),responsibility:Type.Literal('NOT_EVALUABLE'),clinicalCapability:Type.Literal('NOT_EVALUABLE')},closed),(o,a,b)=>o.evaluateWindow(a,b));
 const FileBody=Type.Object({input:UnitReceiveSchema,contentBase64:Type.String({minLength:4,maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'})},closed);
 app.post<{Body:Static<typeof FileBody>}>('/api/vnext/business-units/files',{bodyLimit:1500000,preValidation:async r=>{unitCheck(FileBody,r.body);},schema:{operationId:'receiveBusinessUnitFile',body:FileBody,response:{200:Type.Object({jobId:UnitId,revisionId:UnitId,sourceArtifactId:UnitId,structuralStatus:Type.Enum(['PARSED','REJECTED']),input:Type.Union([Type.Object({inputId:UnitId,revisionId:UnitId,digest:Text},closed),Type.Null()]),issues:Type.Array(Issue),validation:Type.Unknown()},closed),...errors}}},async r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');const bytes=Buffer.from(r.body.contentBase64,'base64');try{return await context.owner.receiveFile(context.actor(r),r.body.input,bytes);}finally{bytes.fill(0);}});
}
