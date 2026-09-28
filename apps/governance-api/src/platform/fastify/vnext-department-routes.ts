import {Type,type Static,type TSchema} from 'typebox';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {DepartmentStageSchema as StageSchema,DepartmentStoredStageSchema as StoredStageSchema,DepartmentVerifySchema as VerifySchema,DepartmentPlanSchema as PlanSchema,DepartmentReadSchema as ReadSchema,DepartmentCoverageSchema as CoverageSchema,DepartmentReceiveSchema as ReceiveSchema,DepartmentEntrySchema as EntrySchema,DepartmentId as Id,type openDepartment} from '../../modules/department-master/index.js';
import {ApplyUnitSchema,ApproveApplyUnitSchema} from '../../modules/governance-catalog/index.js';

const closed={additionalProperties:false} as const,Text=Type.String(),Nullable=Type.Union([Text,Type.Null()]);
const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed);
const errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,413:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
const Input=Type.Object({inputId:Id},closed),Staged=Type.Object({inputId:Id,revisionId:Id,digest:Text},closed);
const Candidate=Type.Object({candidateId:Id},closed),Planned=Type.Object({candidateId:Id,digest:Text},closed);
const Issue=Type.Object({row:Type.Integer(),field:Text,code:Text,status:Type.Enum(['FAIL','BLOCKED'])},closed);
const Facts=Type.Object({name:Text,shortName:Nullable,orgType:Text,establishedOn:Nullable,description:Nullable,virtual:Type.Boolean(),historicalException:Type.Boolean(),sourceVersion:Text,sourceRecordedAt:Text,sourceSystemId:Id,policyVersionId:Id,verificationId:Id,commandDigest:Type.String({pattern:'^[a-f0-9]{64}$'})},closed);
const Version=Type.Object({id:Id,department_id:Id,number:Text,valid_from:Text,valid_to:Nullable,recorded_at:Text,source_row:Type.Integer(),facts:Facts,content_digest:Text},closed);
const History=Type.Object({id:Id,code:Text,versions:Type.Array(Version)},closed);
const Outcome=Type.Object({status:Type.Enum(['COMMITTED','COMMIT_UNKNOWN']),candidateId:Id,requestId:Id,facts:Type.Optional(Type.Array(Type.Object({owner:Type.Literal('department-master'),id:Id,version:Text,source:Type.Object({dataset:Type.Literal('ORG04'),row:Type.Integer(),step:Text},closed)},closed))),recordedAt:Type.Optional(Time),responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed);
const Scalar=Type.Union([Text,Type.Boolean(),Type.Null()]);
export interface DepartmentHttpContext {owner:ReturnType<typeof openDepartment>;actor:(r:FastifyRequest)=>string}
export function registerDepartmentRoutes(app:FastifyInstance,context?:DepartmentHttpContext){
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handler:(owner:DepartmentHttpContext['owner'],actor:string,input:Static<S>)=>Promise<unknown>)=>{
  app.post<{Body:Static<S>}>('/api/vnext/departments/'+path,{schema:{operationId,body,response:{200:response,...errors}},...(path==='files'?{bodyLimit:1500000}:{})},r=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return handler(context.owner,context.actor(r),r.body as Static<S>);});
 };
 route('inputs','stageDepartment',StageSchema,Staged,(o,a,b)=>o.stage(a,b));
 route('inputs/read','readDepartmentInput',Input,StoredStageSchema,(o,a,b)=>o.readInput(a,b));
 route('preview','previewDepartment',Input,Type.Object({entries:Type.Array(EntrySchema),heads:Type.Array(History),verification:Type.Union([VerifySchema,Type.Null()]),issues:Type.Array(Issue)},closed),(o,a,b)=>o.preview(a,b));
 route('validate','validateDepartment',Input,Type.Object({inputId:Id,digest:Text,validationRunId:Type.Union([Id,Type.Null()]),commandCount:Type.Integer(),decision:Type.Enum(['PASS','FAIL','BLOCKED']),issues:Type.Array(Issue)},closed),(o,a,b)=>o.validate(a,b));
 route('verify','verifyDepartmentEvidence',VerifySchema,Type.Object({verificationId:Id},closed),(o,a,b)=>o.verify(a,b));
 route('plan','planDepartment',PlanSchema,Planned,(o,a,b)=>o.plan(a,b));
 route('review','reviewDepartment',Candidate,Type.Object({candidateId:Id,digest:Text,approvedBy:Nullable,verification:Type.Union([VerifySchema,Type.Null()]),entries:Type.Array(EntrySchema),issues:Type.Array(Issue)},closed),async(o,a,b)=>{const c=await o.readApplyCandidate(a,b);return {candidateId:c.candidateId,digest:c.digest,approvedBy:c.approvedBy,verification:c.unit.basis['verification'],entries:c.unit.commands.map(c=>{const {validFrom:_,validTo:__,...entry}=JSON.parse(c.value['command']!);return entry;}),issues:c.unit.basis['issues']};});
 route('approve','approveDepartment',ApproveApplyUnitSchema,Type.Object({candidateId:Id,approvedBy:Text},closed),(o,a,b)=>o.approveApplyUnit(a,b));
 route('apply','applyDepartment',ApplyUnitSchema,Outcome,(o,a,b)=>o.applyUnit(a,b));
 route('resume','resumeDepartment',ApplyUnitSchema,Type.Union([Outcome,Type.Null()]),(o,a,b)=>o.resumeOutcome(a,b));
 route('list','listDepartments',Type.Object({after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),recordAsOf:Type.Optional(Time)},closed),Type.Array(Id),(o,a,b)=>o.list(a,b));
 route('query','getDepartmentAsOf',ReadSchema,Type.Object({id:Id,code:Text,version:Type.Union([Version,Type.Null()])},closed),(o,a,b)=>o.read(a,b));
 route('history','getDepartmentVersionHistory',Type.Object({id:Id,recordAsOf:Type.Optional(Time)},closed),History,(o,a,b)=>o.history(a,b.id,b.recordAsOf));
 route('references/exact','getExactDepartmentReference',Type.Object({id:Id,version:Type.String({pattern:'^[1-9][0-9]*$'}),recordAsOf:Type.Optional(Time)},closed),Type.Object({owner:Type.Literal('department-master'),id:Id,version:Text,versionId:Id,contentDigest:Text,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordedAt:Time},closed),(o,a,b)=>o.exact(a,b));
 route('references/coverage','getDepartmentCoverage',CoverageSchema,Type.Object({owner:Type.Literal('department-master'),id:Id,covered:Type.Boolean(),parts:Type.Array(Type.Object({from:Time,to:Type.Union([Time,Type.Null()]),versionId:Id,version:Text},closed))},closed),(o,a,b)=>o.coverage(a,b));
 route('diff','compareDepartmentVersions',Type.Object({id:Id,fromVersion:Text,toVersion:Text},closed),Type.Object({changes:Type.Array(Type.Object({field:Text,before:Scalar,after:Scalar},closed))},closed),(o,a,b)=>o.diff(a,b));
 route('files','receiveDepartmentFile',Type.Object({metadata:ReceiveSchema,bytesBase64:Type.String({maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'})},closed),Type.Object({jobId:Id,revisionId:Id,sourceArtifactId:Id,structuralStatus:Type.Enum(['PARSED','REJECTED']),issues:Type.Array(Type.Object({code:Text,row:Type.Integer(),column:Type.Integer(),sheet:Type.Optional(Text)},closed)),input:Type.Union([Staged,Type.Null()])},closed),async(o,a,b)=>{const bytes=Buffer.from(b.bytesBase64,'base64');try{return await o.receiveFile(a,b.metadata,bytes);}finally{bytes.fill(0);}});
}
