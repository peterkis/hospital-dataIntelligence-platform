import type {FastifyInstance,FastifyRequest} from 'fastify';
import {Type,type Static,type TSchema} from 'typebox';
import {openOrganizationMappings,OrganizationMappingStageSchema,OrganizationMappingStoredStageSchema,OrganizationMappingEntrySchema,OrganizationMappingStoredEntrySchema,OrganizationMappingVerifySchema,OrganizationMappingResolveSchema,OrganizationMappingReceiveSchema} from '../../modules/department-master/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';

const closed={additionalProperties:false} as const,Text=Type.String(),Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'}),Nullable=Type.Union([Text,Type.Null()]);
const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const Hex=Type.String({pattern:'^[a-f0-9]{64}$'}),Input=Type.Object({inputId:Id},closed),Candidate=Type.Object({candidateId:Id},closed),Staged=Type.Object({inputId:Id,revisionId:Id,digest:Hex},closed),Planned=Type.Object({candidateId:Id,digest:Hex},closed);
const Issue=Type.Object({row:Type.Integer(),field:Text,code:Text,status:Type.Enum(['FAIL','BLOCKED'])},closed);
const Target=Type.Object({owner:Type.Enum(['organization-master','organization-master/campus','department-master']),id:Id,parts:Type.Array(Type.Object({from:Time,to:Type.Union([Time,Type.Null()]),versionId:Id,version:Text},closed))},closed);
const Facts=Type.Object({sourceName:Nullable,sourceVersion:Text,sourceRecordedAt:Time,sourceSystemId:Id,contractVersionId:Id,verificationId:Id,target:Target,sourcePins:Type.Array(Type.Object({sourceId:Id,versionId:Id},closed)),resolutionRule:Nullable,commandDigest:Hex},closed);
const Version=Type.Object({id:Id,mapping_id:Id,number:Text,predecessor:Type.Union([Id,Type.Null()]),action:Type.Enum(['REGISTER','CORRECT','RETRACT']),target_type:Type.Enum(['LEGAL','CAMPUS','ORG']),target_id:Id,valid_from:Time,valid_to:Type.Union([Time,Type.Null()]),recorded_at:Time,source_row:Type.Integer(),reason:Text,facts:Facts,content_digest:Hex},closed);
const History=Type.Object({id:Id,from_system_id:Id,entity_type:Text,source_code:Text,context:Text,campus:Type.Enum(['NORTH','SOUTH']),versions:Type.Array(Version)},closed);
const Fact=Type.Object({owner:Type.Literal('department-master/organization-mapping'),id:Id,version:Text,source:Type.Object({dataset:Type.Literal('ORG22'),row:Type.Integer(),step:Type.Enum(['REGISTER','CORRECT','RETRACT'])},closed)},closed);
const Outcome=Type.Object({status:Type.Enum(['COMMITTED','COMMIT_UNKNOWN']),candidateId:Id,requestId:Id,facts:Type.Optional(Type.Array(Fact)),recordedAt:Type.Optional(Time),responseStatus:Type.Optional(Type.Enum(['DELIVERED','POST_COMMIT_FAILED']))},closed);
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed),errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,413:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
export interface OrganizationMappingHttpContext {owner:ReturnType<typeof openOrganizationMappings>;actor:(request:FastifyRequest)=>string}
export function registerOrganizationMappingRoutes(app:FastifyInstance,context?:OrganizationMappingHttpContext){
 const route=<S extends TSchema>(path:string,operationId:string,body:S,response:TSchema,handler:(owner:OrganizationMappingHttpContext['owner'],actor:string,input:Static<S>)=>Promise<unknown>)=>{
  app.post<{Body:Static<S>}>('/api/vnext/organization-mappings/'+path,{schema:{operationId,body,response:{200:response,...errors}},...(path==='files'?{bodyLimit:1500000}:{})},r=>{if(!context)throw new globalThis.Error('BLOCKED_DEPENDENCY');return handler(context.owner,context.actor(r),r.body as Static<S>);});
 };
 route('inputs','stageOrganizationMappings',OrganizationMappingStageSchema,Staged,(o,a,b)=>o.stage(a,b));
 route('inputs/read','readOrganizationMappingInput',Input,OrganizationMappingStoredStageSchema,(o,a,b)=>o.readInput(a,b));
 route('preview','previewOrganizationMappings',Input,Type.Object({entries:Type.Array(OrganizationMappingStoredEntrySchema),verification:Type.Union([OrganizationMappingVerifySchema,Type.Null()]),heads:Type.Array(History),issues:Type.Array(Issue)},closed),(o,a,b)=>o.preview(a,b));
 route('validate','validateOrganizationMappings',Input,Type.Object({inputId:Id,digest:Hex,validationRunId:Type.Union([Id,Type.Null()]),decision:Type.Enum(['PASS','FAIL','BLOCKED']),issues:Type.Array(Issue),commandCount:Type.Integer()},closed),(o,a,b)=>o.validate(a,b));
 route('verify','verifyOrganizationMappingEvidence',OrganizationMappingVerifySchema,Type.Object({verificationId:Id},closed),(o,a,b)=>o.verify(a,b));
 route('plan','planOrganizationMappings',Type.Object({inputId:Id,requestId:Id},closed),Planned,(o,a,b)=>o.plan(a,b));
 route('review','reviewOrganizationMappings',Candidate,Type.Object({candidateId:Id,digest:Hex,approvedBy:Nullable,entries:Type.Array(OrganizationMappingEntrySchema),issues:Type.Array(Issue)},closed),async(o,a,b)=>{const result=await o.readApplyCandidate(a,b);return {candidateId:result.candidateId,digest:result.digest,approvedBy:result.approvedBy,entries:result.unit.commands.map(command=>{const entry=JSON.parse(command.value['command']!);return {action:entry.action,mapping:entry.mapping,reason:entry.reason,evidenceId:entry.evidenceId,row:entry.row};}),issues:result.unit.basis['issues']};});
 route('approve','approveOrganizationMappings',ApproveApplyUnitSchema,Type.Object({candidateId:Id,approvedBy:Text},closed),(o,a,b)=>o.approveApplyUnit(a,b));
 route('apply','applyOrganizationMappings',ApplyUnitSchema,Outcome,(o,a,b)=>o.applyUnit(a,b));
 route('resume','resumeOrganizationMappings',ApplyUnitSchema,Type.Union([Outcome,Type.Null()]),(o,a,b)=>o.resumeOutcome(a,b));
 route('list','listOrganizationMappings',Type.Object({campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),recordAsOf:Type.Optional(Time)},closed),Type.Array(Id),(o,a,b)=>o.list(a,b));
 route('history','getOrganizationMappingHistory',Type.Object({id:Id,recordAsOf:Type.Optional(Time)},closed),History,(o,a,b)=>o.history(a,b.id,b.recordAsOf));
 route('query','getOrganizationMappingAsOf',Type.Object({id:Id,businessAt:Time,recordAsOf:Type.Optional(Time)},closed),Type.Object({id:Id,version:Type.Union([Version,Type.Null()])},closed),(o,a,b)=>o.read(a,b));
 route('resolve','resolveOrganizationSourceMapping',OrganizationMappingResolveSchema,Type.Union([Type.Object({status:Type.Literal('NOT_FOUND')},closed),Type.Object({status:Type.Literal('RESOLVED'),mappingId:Id,version:Text,versionId:Id,target:Target,assertion:Type.Literal('HISTORICAL_ASSERTION'),currentReview:Type.Literal('NOT_EVALUATED')},closed)]),(o,a,b)=>o.resolve(a,b));
 route('diff','compareOrganizationMappingVersions',Type.Object({id:Id,fromVersion:Text,toVersion:Text},closed),Type.Object({before:Version,after:Version},closed),(o,a,b)=>o.diff(a,b));
 route('files','receiveOrganizationMappingFile',Type.Object({metadata:OrganizationMappingReceiveSchema,bytesBase64:Type.String({maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'})},closed),Type.Object({jobId:Id,revisionId:Id,sourceArtifactId:Id,structuralStatus:Type.Enum(['PARSED','REJECTED']),issues:Type.Array(Type.Object({code:Text,row:Type.Integer(),column:Type.Integer()},closed)),input:Type.Union([Staged,Type.Null()])},closed),async(o,a,b)=>{const bytes=Buffer.from(b.bytesBase64,'base64');try{return await o.receiveFile(a,b.metadata,bytes);}finally{bytes.fill(0);}});
}
