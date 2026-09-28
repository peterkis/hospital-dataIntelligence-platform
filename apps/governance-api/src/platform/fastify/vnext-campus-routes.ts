import {CampusResolveSchema,CampusResolveResultSchema,CampusPinSchema,CampusPinResultSchema,CampusCoverageSchema,CampusCoverageResultSchema,type CampusReferencePort} from '../../modules/organization-master/index.js';
import {Type,type Static} from 'typebox';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {CampusStageSchema,CampusCommandSchema,CampusReadSchema,CampusListSchema,CampusVersionSchema,CampusDiffSchema,CampusFactsSchema,InputSchema,Id,Time,type CampusOwner} from '../../modules/organization-master/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const,Text=Type.String(),Nullable=Type.Union([Text,Type.Null()]);
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
const Target=Type.Object({id:Id},closed);
const Ref=Type.Object({owner:Type.Literal('organization-master/campus'),id:Id,version:Text},closed);
const Outcome=Type.Object({status:Type.Enum(['COMMITTED','COMMIT_UNKNOWN']),candidateId:Id,requestId:Id,facts:Type.Optional(Type.Array(Ref)),recordedAt:Type.Optional(Time),responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed);
const State=Type.Enum(['PLANNING','TRIAL_RUNNING','RUNNING','SUSPENDED']);
const Event={version:Text,versionId:Id,action:Type.Enum(['CREATE','REVISE','SCHEDULE_OPENING','CANCEL_OPENING','ACTIVATE','SUSPEND']),validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordedAt:Time};
const Version=Type.Object({...Event,facts:CampusFactsSchema},closed);
const View=Type.Object({id:Id,head:Text,facts:Type.Union([CampusFactsSchema,Type.Null()]),operationStatus:Type.Union([State,Type.Literal('NOT_ESTABLISHED')]),plannedOpeningAt:Type.Union([Time,Type.Null()]),operatingPermission:Type.Literal('NOT_EVALUABLE')},closed);
export interface CampusHttpContext {owner?:CampusOwner;references?:CampusReferencePort;actor:(r:FastifyRequest)=>string}
export function registerCampusRoutes(app:FastifyInstance,context?:CampusHttpContext){
 const owner=()=>{if(!context?.owner)throw new Error('BLOCKED_DEPENDENCY');return context.owner;};const actor=(r:FastifyRequest)=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.actor(r);};
 const reader=():CampusReferencePort=>{const port=context?.references??context?.owner?.references;if(!port)throw new Error('BLOCKED_DEPENDENCY');return port;};
 app.post<{Body:Static<typeof CampusStageSchema>}>('/api/vnext/campuses/inputs',{schema:{operationId:'stageCampusCommand',body:CampusStageSchema,response:{200:Type.Object({inputId:Id,revisionId:Id},closed),...errors}}},r=>owner().stage(actor(r),r.body));
 app.post<{Body:Static<typeof InputSchema>}>('/api/vnext/campuses/plan',{schema:{operationId:'planCampusCommand',body:InputSchema,response:{200:Type.Object({candidateId:Id,digest:Text},closed),...errors}}},r=>owner().plan(actor(r),r.body));
 app.post<{Body:Static<typeof InputSchema>}>('/api/vnext/campuses/withdraw',{schema:{operationId:'withdrawCampusInput',body:InputSchema,response:{200:Type.Object({inputId:Id,status:Type.Literal('WITHDRAWN')},closed),...errors}}},r=>owner().withdraw(actor(r),r.body));
 const Candidate=Type.Object({candidateId:Id},closed);
 app.post<{Body:Static<typeof Candidate>}>('/api/vnext/campuses/review',{schema:{operationId:'readCampusCandidate',body:Candidate,response:{200:Type.Object({candidateId:Id,digest:Text,approvedBy:Nullable,command:CampusCommandSchema,blockingIssues:Type.Array(Type.Literal('IDENTIFIER_CONFLICT'))},closed),...errors}}},async r=>{const c=await owner().readApplyCandidate(actor(r),r.body);return {candidateId:c.candidateId,digest:c.digest,approvedBy:c.approvedBy,command:JSON.parse(c.unit.commands[0]!.value['original']!),blockingIssues:c.unit.basis['blockingIssues']??[]};});
 app.post<{Body:Static<typeof ApproveApplyUnitSchema>}>('/api/vnext/campuses/approve',{schema:{operationId:'approveCampusCommand',body:ApproveApplyUnitSchema,response:{200:Type.Object({candidateId:Id,approvedBy:Text},closed),...errors}}},r=>owner().approveApplyUnit(actor(r),r.body));
 app.post<{Body:Static<typeof ApplyUnitSchema>}>('/api/vnext/campuses/apply',{schema:{operationId:'applyCampusCommand',body:ApplyUnitSchema,response:{200:Outcome,...errors}}},r=>owner().applyUnit(actor(r),r.body));
 app.post<{Body:Static<typeof ApplyUnitSchema>}>('/api/vnext/campuses/resume',{schema:{operationId:'resumeCampusOutcome',body:ApplyUnitSchema,response:{200:Type.Union([Outcome,Type.Null()]),...errors}}},r=>owner().resumeOutcome(actor(r),r.body));
 app.post<{Body:Static<typeof CampusResolveSchema>}>('/api/vnext/campuses/references/resolve',{schema:{operationId:'resolveCampusReference',body:CampusResolveSchema,response:{200:CampusResolveResultSchema,...errors}}},r=>reader().resolveCampusReference(actor(r),r.body));
 app.post<{Body:Static<typeof CampusPinSchema>}>('/api/vnext/campuses/references/pin',{schema:{operationId:'pinCampusVersion',body:CampusPinSchema,response:{200:CampusPinResultSchema,...errors}}},r=>reader().pinCampusVersion(actor(r),r.body));
 app.post<{Body:Static<typeof CampusCoverageSchema>}>('/api/vnext/campuses/references/coverage',{schema:{operationId:'readCampusReferenceCoverage',body:CampusCoverageSchema,response:{200:CampusCoverageResultSchema,...errors}}},r=>reader().readCampusReferenceCoverage(actor(r),r.body));
 app.post<{Body:Static<typeof CampusReadSchema>}>('/api/vnext/campuses/query',{schema:{operationId:'getCampusAsOf',body:CampusReadSchema,response:{200:View,...errors}}},r=>reader().read(actor(r),r.body));
 app.post<{Body:Static<typeof CampusListSchema>}>('/api/vnext/campuses/list',{schema:{operationId:'listCampuses',body:CampusListSchema,response:{200:Type.Array(View),...errors}}},r=>reader().list(actor(r),r.body));
 app.post<{Body:Static<typeof CampusVersionSchema>}>('/api/vnext/campuses/versions/query',{schema:{operationId:'getCampusVersion',body:CampusVersionSchema,response:{200:Version,...errors}}},r=>reader().exact(actor(r),r.body));
 app.post<{Body:{id:string;asOf?:string}}>('/api/vnext/campuses/history',{schema:{operationId:'getCampusHistory',body:Type.Object({id:Id,asOf:Type.Optional(Time)},closed),response:{200:Type.Object({id:Id,head:Text,versions:Type.Array(Version),plans:Type.Array(Type.Object({...Event,plannedOpeningAt:Type.Union([Time,Type.Null()])},closed)),operations:Type.Array(Type.Object({...Event,state:State},closed))},closed),...errors}}},r=>reader().history(actor(r),r.body.id,r.body.asOf));
 app.post<{Body:Static<typeof CampusDiffSchema>}>('/api/vnext/campuses/diff',{schema:{operationId:'compareCampusVersions',body:CampusDiffSchema,response:{200:Type.Object({...CampusDiffSchema.properties,changes:Type.Array(Type.Object({field:Text,before:Nullable,after:Nullable},closed))},closed),...errors}}},r=>reader().diff(actor(r),r.body));
 app.post<{Body:{id:string}}>('/api/vnext/campuses/restricted-input',{schema:{operationId:'readCampusRestrictedInput',body:Target,response:{200:CampusStageSchema,...errors}}},r=>owner().readRestrictedInput(actor(r),r.body.id));
}
