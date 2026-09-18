import {Type,type Static} from 'typebox';
import type {FastifyInstance,FastifyRequest} from 'fastify';
import {StageSchema,InputSchema,ReadSchema,QualificationSchema,LicenseReadSchema,Id,Time,type OrganizationOwner} from '../../modules/organization-master/index.js';
import {ApproveApplyUnitSchema,ApplyUnitSchema} from '../../modules/governance-catalog/index.js';
const closed={additionalProperties:false} as const;
const Text=Type.String();const Nullable=Type.Union([Text,Type.Null()]);
const Fact=Type.Object({id:Id,version:Text,versionId:Id,legalName:Text,entityNature:Text,authority:Nullable,legalAddress:Nullable,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordedAt:Time},closed);
const OwnerFact=Type.Object({owner:Text,id:Id,version:Text},closed);
const Result=Type.Object({status:Type.Union([Type.Literal('COMMITTED'),Type.Literal('COMMIT_UNKNOWN')]),candidateId:Id,requestId:Id,facts:Type.Optional(Type.Array(OwnerFact)),recordedAt:Type.Optional(Time),responseStatus:Type.Optional(Type.Union([Type.Literal('DELIVERED'),Type.Literal('POST_COMMIT_FAILED')]))},closed);
const ErrorSchema=Type.Object({code:Text,message:Text,field:Type.Optional(Text)},closed);
const errors={400:ErrorSchema,403:ErrorSchema,404:ErrorSchema,409:ErrorSchema,500:ErrorSchema,503:ErrorSchema};
export interface OrganizationHttpContext {owner:OrganizationOwner;actor:(request:FastifyRequest)=>string}
/** Authentication is supplied by composition, never accepted as a command field. */
export function registerOrganizationRoutes(app:FastifyInstance,context?:OrganizationHttpContext){
 const owner=()=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.owner;};
 const actor=(r:FastifyRequest)=>{if(!context)throw new Error('BLOCKED_DEPENDENCY');return context.actor(r);};
 app.post<{Body:Static<typeof StageSchema>}>('/api/vnext/organizations/inputs',{schema:{operationId:'stageOrganizationCommand',body:StageSchema,response:{200:Type.Object({inputId:Id,revisionId:Id},closed),...errors}}},r=>owner().stage(actor(r),r.body));
 app.post<{Body:Static<typeof InputSchema>}>('/api/vnext/organizations/plan',{schema:{operationId:'planOrganizationCommand',body:InputSchema,response:{200:Type.Object({candidateId:Id,digest:Text},closed),...errors}}},r=>owner().plan(actor(r),r.body));
 app.post<{Body:Static<typeof InputSchema>}>('/api/vnext/organizations/withdraw',{schema:{operationId:'withdrawOrganizationInput',body:InputSchema,response:{200:Type.Object({inputId:Id,status:Type.Literal('WITHDRAWN')},closed),...errors}}},r=>owner().withdraw(actor(r),r.body));
 app.post<{Body:Static<typeof ApproveApplyUnitSchema>}>('/api/vnext/organizations/approve',{schema:{operationId:'approveOrganizationCommand',body:ApproveApplyUnitSchema,response:{200:Type.Object({candidateId:Id,approvedBy:Text},closed),...errors}}},r=>owner().approveApplyUnit(actor(r),r.body));
 app.post<{Body:Static<typeof ApplyUnitSchema>}>('/api/vnext/organizations/apply',{schema:{operationId:'applyOrganizationCommand',body:ApplyUnitSchema,response:{200:Result,...errors}}},r=>owner().applyUnit(actor(r),r.body));
 app.post<{Body:Static<typeof ApplyUnitSchema>}>('/api/vnext/organizations/resume',{schema:{operationId:'resumeOrganizationOutcome',body:ApplyUnitSchema,response:{200:Type.Union([Result,Type.Null()]),...errors}}},r=>owner().resumeOutcome(actor(r),r.body));
 // Candidate content is restricted to reviewers by the existing Coordinator.
 const CandidateRead=Type.Object({candidateId:Id},closed);
 const Candidate=Type.Object({candidateId:Id,digest:Text,approvedBy:Nullable,command:StageSchema.properties.command,blockingIssues:Type.Optional(Type.Array(Type.Literal('IDENTIFIER_CONFLICT'),{minItems:1,maxItems:1}))},closed);
 app.post<{Body:Static<typeof CandidateRead>}>('/api/vnext/organizations/review',{schema:{operationId:'readOrganizationCandidate',body:CandidateRead,response:{200:Candidate,...errors}}},async r=>{
  const result=await owner().readApplyCandidate(actor(r),r.body);const issues=result.unit.basis['blockingIssues'];return {candidateId:result.candidateId,digest:result.digest,approvedBy:result.approvedBy,command:JSON.parse(result.unit.commands[0]!.value['original']!),...(Array.isArray(issues)&&issues.includes('IDENTIFIER_CONFLICT')?{blockingIssues:['IDENTIFIER_CONFLICT']}: {})};
 });
 app.post<{Body:Static<typeof ReadSchema>}>('/api/vnext/organizations/query',{schema:{operationId:'readOrganizations',body:ReadSchema,response:{200:Type.Array(Fact),...errors}}},r=>owner().read(actor(r),r.body));
 const Target=Type.Object({id:Id},closed);
 const VersionBase={versionId:Id,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordedAt:Time};
 const LicenseFact=Type.Object({...VersionBase,id:Id,version:Text,endKind:Type.Union([Type.Literal('FINITE'),Type.Literal('VERIFIED_UNBOUNDED'),Type.Literal('UNKNOWN')]),revoked:Type.Boolean()},closed);
 app.post<{Body:Static<typeof LicenseReadSchema>}>('/api/vnext/organizations/licenses/query',{schema:{operationId:'readOrganizationLicenses',body:LicenseReadSchema,response:{200:Type.Array(LicenseFact),...errors}}},r=>owner().readLicenses(actor(r),r.body));
 app.post<{Body:{id:string}}>('/api/vnext/organizations/history-details',{schema:{operationId:'readOrganizationLicenseHistory',body:Target,response:{200:Type.Object({organizationId:Id,licenses:Type.Array(Type.Object({...VersionBase,id:Id,version:Text,endKind:Type.Union([Type.Literal('FINITE'),Type.Literal('VERIFIED_UNBOUNDED'),Type.Literal('UNKNOWN')]),revoked:Type.Boolean()},closed)),verifications:Type.Array(Type.Object({id:Id,subjectVersionId:Id,licenseVersionIds:Type.Array(Id),validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordedAt:Time},closed))},closed),...errors}}},r=>owner().historyDetails(actor(r),r.body.id));
 app.post<{Body:{id:string}}>('/api/vnext/organizations/restricted-input',{schema:{operationId:'readOrganizationRestrictedInput',body:Target,response:{200:StageSchema,...errors}}},r=>owner().readRestrictedInput(actor(r),r.body.id));
 const Diff=Type.Object({id:Id,fromVersion:Type.String({pattern:'^[1-9][0-9]*$'}),toVersion:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
 app.post<{Body:Static<typeof Diff>}>('/api/vnext/organizations/diff',{schema:{operationId:'compareOrganizationVersions',body:Diff,response:{200:Type.Object({id:Id,fromVersion:Text,toVersion:Text,changes:Type.Array(Type.Object({field:Text,before:Nullable,after:Nullable,redacted:Type.Optional(Type.Boolean())},closed))},closed),...errors}}},r=>owner().diff(actor(r),r.body.id,r.body.fromVersion,r.body.toVersion));
 app.post<{Body:Static<typeof QualificationSchema>}>('/api/vnext/organizations/qualification',{schema:{operationId:'readOrganizationQualification',body:QualificationSchema,response:{200:Type.Object({status:Type.Union([Type.Literal('LICENSED_REGISTRATION'),Type.Literal('NOT_ESTABLISHED')]),organizationId:Id,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),operatingPermission:Type.Literal('NOT_EVALUABLE')},closed),...errors}}},r=>owner().qualification(actor(r),r.body));
}
