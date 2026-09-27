import {Type,type Static,type TSchema} from 'typebox';
import {Check} from 'typebox/value';
import {Id,OrganizationCommandSchema,StageSchema} from '../contracts.js';
import {CampusCommandSchema,CampusStageSchema} from '../campus/contracts.js';
import {OperatingCommandSchema,OperatingStageSchema} from '../operating/contracts.js';
import {ReceiveOrganizationBundleSchema} from '../import/contracts.js';
const closed={additionalProperties:false} as const;
// Editing has the same finite fields as a command, but may omit incomplete fields at every depth.
function incomplete(value:unknown):unknown{
 if(Array.isArray(value))return value.map(incomplete);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='required'&&key!=='minItems').map(([key,v])=>[key,incomplete(v)]));
 return value;
}
const partial=(value:unknown)=>Type.Unsafe<Record<string,unknown>>(incomplete(value) as TSchema);
const Campus=Type.Enum(['NORTH','SOUTH']);
const Attachment=Type.Object({filename:Type.String({minLength:1,maxLength:160}),bytesBase64:Type.String({minLength:4,maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'})},closed);
export const TransportSchema=Type.Object({contractId:Id,contractVersionId:Id},closed);
export const DraftActionSchema=Type.Object({id:Id,expectedVersion:Type.String({pattern:'^[1-9][0-9]*$'}),requestId:Id},closed);
export type DraftAction=Static<typeof DraftActionSchema>;
export const SubmissionSchema=Type.Object({draftId:Id,requestId:Id,expectedVersion:Type.String(),domain:Type.Enum(['ORG01','ORG02','ORG03','BUNDLE']),inputId:Id,revisionId:Id,jobId:Id,jobRevisionId:Id},closed);
export type Submission=Static<typeof SubmissionSchema>;
export const DraftContentSchema=Type.Union([
 Type.Object({domain:Type.Literal('ORG01'),campus:Campus,profile:Type.Optional(Type.Enum(['CORE','FULL'])),dependencies:StageSchema.properties.dependencies,transport:Type.Optional(TransportSchema),attachment:Type.Optional(Attachment),command:partial(OrganizationCommandSchema)},closed),
 Type.Object({domain:Type.Literal('ORG02'),campus:Campus,profile:Type.Optional(Type.Enum(['CORE','FULL'])),dependencies:CampusStageSchema.properties.dependencies,transport:Type.Optional(TransportSchema),attachment:Type.Optional(Attachment),command:partial(CampusCommandSchema)},closed),
 Type.Object({domain:Type.Literal('ORG03'),campus:Campus,profile:Type.Optional(Type.Enum(['CORE','FULL'])),dependencies:OperatingStageSchema.properties.dependencies,transport:Type.Optional(TransportSchema),attachment:Type.Optional(Attachment),command:partial(OperatingCommandSchema)},closed),
 Type.Object({domain:Type.Literal('BUNDLE'),campus:Campus,metadata:partial(ReceiveOrganizationBundleSchema),bytesBase64:Type.Optional(Type.String({maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'}))},closed)
]);
export type DraftContent=Static<typeof DraftContentSchema>;
// Flatten the union so closed members include the request envelope explicitly.
export const DraftSaveSchema=Type.Union(DraftContentSchema.anyOf.map(member=>Type.Object({...member.properties,requestId:Id,id:Type.Optional(Id),expectedVersion:Type.Optional(Type.String({pattern:'^[1-9][0-9]*$'}))},closed)));
export type DraftSave=DraftContent & {requestId:string;id?:string;expectedVersion?:string};
export interface DraftMetadata {transport:{contractId:string;contractVersionId:string}|null;domain:string;campus:string;target:string|null;subject:string|null;campusId:string|null;action:string|null;hasPayload:boolean;bindings:Array<{dataset:string;contractId:string;contractVersionId:string}>;scopes:string[];licenseTarget?:{id:string;version:string}|null}
const ExactLicenseTarget=Type.Object({id:Id,version:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
// V1 is only for authenticating pre-0073 stored envelopes. New saves always use V2.
export function draftMetadata(content:DraftContent,format:'V1'|'V2'='V2'):DraftMetadata{
 const command='command' in content?content.command:{};
 const ref=(key:string)=>{const r=command[key];return r&&typeof r==='object'&&'id' in r&&typeof r.id==='string'?r.id:null;};
 const metadata=content.domain==='BUNDLE'?content.metadata:{};
 const hasPayload=content.domain==='BUNDLE'&&!!content.bytesBase64;
 const candidates=metadata['contracts'];
 if(hasPayload&&!Check(ReceiveOrganizationBundleSchema.properties.contracts,candidates))throw new Error('BLOCKED_DEPENDENCY');
 const bindings=hasPayload?candidates as DraftMetadata['bindings']:[];
 const scopes=new Set<string>([content.campus]);
 const manifest=metadata['manifest'];
 if(manifest&&typeof manifest==='object'&&'rows' in manifest&&Array.isArray(manifest.rows))for(const row of manifest.rows)if(row&&typeof row==='object'&&['NORTH','SOUTH'].includes(row.governanceScope))scopes.add(row.governanceScope);
 const licenseTarget=content.domain==='ORG01'&&Check(ExactLicenseTarget,command['licenseTarget'])?{id:command['licenseTarget'].id,version:command['licenseTarget'].version}:null;
 return {transport:'transport' in content?content.transport??null:null,hasPayload,bindings,scopes:[...scopes].sort(),domain:content.domain,campus:content.campus,target:ref('target'),subject:ref('subject'),campusId:ref('campus'),action:typeof command['action']==='string'?command['action']:null,...(format==='V2'?{licenseTarget}:{})};
}

export const ApplicationAccessSchema=Type.Object({canRead:Type.Boolean(),canWrite:Type.Boolean(),canReview:Type.Boolean(),canPlan:Type.Boolean()},closed);
export type ApplicationAccess=Static<typeof ApplicationAccessSchema>;
export const ApplicationSchema=Type.Object({inputId:Id,domain:Type.Enum(['ORG01','ORG02','ORG03']),kind:Type.Union([Type.Enum(['RELATION','SCOPE']),Type.Null()]),campus:Campus,maker:Type.String(),state:Type.Enum(['STAGED','CANDIDATE','APPROVED','COMMITTED','WITHDRAWN']),requestId:Type.Union([Id,Type.Null()]),candidateId:Type.Union([Id,Type.Null()]),approvedBy:Type.Union([Type.String(),Type.Null()]),recordedAt:Type.String(),access:ApplicationAccessSchema},closed);
export type ApplicationSummary=Static<typeof ApplicationSchema>;
export const WorkspaceBundleSchema=Type.Object({jobId:Id,revisionId:Id,currentRevision:Type.Boolean(),maker:Type.String(),campus:Campus,state:Type.Enum(['STAGED','VERIFIED','CANDIDATE','APPROVED','COMMITTED']),requestId:Type.Union([Id,Type.Null()]),candidateId:Type.Union([Id,Type.Null()]),approvedBy:Type.Union([Type.String(),Type.Null()]),access:Type.Object({...ApplicationAccessSchema.properties,canPreauthorize:Type.Boolean()},closed)},closed);
export type WorkspaceBundle=Static<typeof WorkspaceBundleSchema>;

export const MaterialReviewSchema=Type.Object({domain:Type.Enum(['ORG01','ORG02','ORG03']),candidateId:Id},closed);
export type MaterialReview=Static<typeof MaterialReviewSchema>;

export const PreflightSchema=Type.Object({domain:Type.Enum(['ORG01','ORG02','ORG03']),inputId:Id},closed);
export type PreflightInput=Static<typeof PreflightSchema>;

export const ObjectKindSchema=Type.Enum(['ORGANIZATION','LICENSE','CAMPUS','RELATION','SCOPE']);
export const ObjectContextInputSchema=Type.Object({kind:ObjectKindSchema,id:Id},closed);
export const PrepareRevisionSchema=Type.Object({...ObjectContextInputSchema.properties,version:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
export const ObjectContextSchema=Type.Object({kind:ObjectKindSchema,id:Id,campus:Campus,head:Type.String(),subjectId:Type.Union([Id,Type.Null()]),campusId:Type.Union([Id,Type.Null()]),subjectHead:Type.Union([Type.String(),Type.Null()]),canWrite:Type.Boolean(),canClose:Type.Boolean(),canActivate:Type.Boolean(),terminal:Type.Boolean()},closed);
export type ObjectContext=Static<typeof ObjectContextSchema>;
export type ObjectContextInput=Static<typeof ObjectContextInputSchema>;
export type PrepareRevision=Static<typeof PrepareRevisionSchema>;

export const ApplicationListSchema=Type.Object({inputId:Type.Optional(Id)},closed);
export const BundleListSchema=Type.Object({jobId:Type.Optional(Id),revisionId:Type.Optional(Id)},closed);
export type ApplicationList=Static<typeof ApplicationListSchema>;
export type BundleList=Static<typeof BundleListSchema>;
