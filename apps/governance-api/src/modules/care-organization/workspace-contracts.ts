import {Type,type Static,type TSchema} from 'typebox';
import {UnitId,UnitTime,UnitStageSchema,UNIT_TYPES} from './contracts.js';
import {NursingStageSchema} from './nursing-contracts.js';
import {WardStageSchema} from './ward-contracts.js';
import {UnitWardStageSchema} from './unit-ward-contracts.js';
import {WardNursingDirectStageSchema} from './ward-nursing-contracts.js';
import {CapabilityStageSchema} from './capability-contracts.js';
import {SubjectStageSchema} from './subject-permission-contracts.js';
import {LifecycleStageSchema} from './lifecycle-contracts.js';
import {LocationStageSchema,LocationUseDirectStageSchema,LOCATION_TYPES} from '../location-master/index.js';
import {ProtectedReadSchema,ProtectedStoreSchema} from '../governance-catalog/index.js';
import {careFileEditingSchemas,CareFileEditingBytesSchema,type CareSavedFile} from './workspace-file-contracts.js';
const closed={additionalProperties:false} as const;
export const careWorkspaceStages={UNIT:UnitStageSchema,NURSING:NursingStageSchema,WARD:WardStageSchema,UNIT_WARD:UnitWardStageSchema,WARD_NURSING:WardNursingDirectStageSchema,CAPABILITY:CapabilityStageSchema,PERMISSION:SubjectStageSchema,LOCATION:LocationStageSchema,LOCATION_USE:LocationUseDirectStageSchema,LIFECYCLE:LifecycleStageSchema} as const;
export type CareWorkspaceKind=keyof typeof careWorkspaceStages;
// A finite editor over these existing commands. Presence may be incomplete;
// field vocabulary, discriminators, types and limits remain closed.
function partial(value:unknown,field?:string):unknown{if(Array.isArray(value))return value.map(v=>partial(v));if(value&&typeof value==='object'){
 const vocabulary:Record<string,readonly string[]>={unit_type:UNIT_TYPES,location_type:LOCATION_TYPES,record_status:['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED'],is_accessible:['','Y','N']};
 const result=Object.fromEntries(Object.entries(value).filter(([key])=>key!=='required'&&key!=='minItems').map(([key,v])=>[key,partial(v,key)]));
 if(field&&vocabulary[field])return {...result,type:'string',enum:vocabulary[field]};return result;
 }return value;}
const payload=(schema:TSchema)=>{
 const copy=structuredClone(schema) as TSchema&{properties?:Record<string,TSchema>;anyOf?:TSchema[];required?:string[]};
 const strip=(s:typeof copy)=>{for(const name of ['requestId','jobId','revisionId','campus','profile']){if(s.properties)delete s.properties[name];if(s.required)s.required=s.required.filter(x=>x!==name);}return s;};
 if(copy.anyOf)copy.anyOf=copy.anyOf.map(strip);else strip(copy);return Type.Unsafe<Record<string,unknown>>(partial(copy) as TSchema);
};
const Transport=Type.Object({contractId:UnitId,contractVersionId:UnitId},closed),Version=Type.String({pattern:'^[1-9][0-9]*$'});
const branches=Object.entries(careWorkspaceStages).map(([kind,schema])=>Type.Object({kind:Type.Literal(kind),campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),transport:Type.Optional(Transport),payload:payload(schema),...(kind in careFileEditingSchemas?{file:Type.Optional(Type.Object({requestId:UnitId,body:Type.Object({input:careFileEditingSchemas[kind as keyof typeof careFileEditingSchemas],contentBase64:CareFileEditingBytesSchema},closed)},closed))}:{})},closed));
export const CareWorkspaceContentSchema=Type.Union(branches);
export interface CareWorkspaceContent {kind:CareWorkspaceKind;campus:'NORTH'|'SOUTH';profile:'CORE'|'FULL';transport?:{contractId:string;contractVersionId:string};payload:Record<string,unknown>;file?:CareSavedFile}
export const CareWorkspaceSaveSchema=Type.Union(branches.map(branch=>Type.Object({...branch.properties,requestId:UnitId,id:Type.Optional(UnitId),expectedVersion:Type.Optional(Version)},closed)));
export type CareWorkspaceSave=CareWorkspaceContent&{requestId:string;id?:string;expectedVersion?:string};
export const CareWorkspaceIdSchema=Type.Object({id:UnitId},closed);
export const CareWorkspaceActionSchema=Type.Object({id:UnitId,expectedVersion:Version,requestId:UnitId},closed);
export type CareWorkspaceAction=Static<typeof CareWorkspaceActionSchema>;
export const CareWorkspaceListSchema=Type.Object({kind:Type.Optional(Type.Enum(Object.keys(careWorkspaceStages))),campus:Type.Optional(Type.Enum(['NORTH','SOUTH'])),after:Type.Optional(UnitId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},closed);
const SubmittedInput={inputId:UnitId,revisionId:UnitId,digest:Type.String({pattern:'^[a-f0-9]{64}$'})};
export const CareWorkspaceSubmissionSchema=Type.Union([
 Type.Object({kind:Type.Enum(Object.keys(careWorkspaceStages).filter(kind=>kind!=='LIFECYCLE')),...SubmittedInput,contractVersionId:UnitId,jobId:UnitId,jobRevisionId:UnitId},closed),
 Type.Object({kind:Type.Literal('LIFECYCLE'),...SubmittedInput},closed),
]);
export type CareWorkspaceSubmission=Static<typeof CareWorkspaceSubmissionSchema>;
export const CareWorkspaceSavedSchema=Type.Object({id:UnitId,version:Version,state:Type.Enum(['EDITING','DISCARDED','SUBMITTED']),recordedAt:UnitTime,submission:Type.Optional(CareWorkspaceSubmissionSchema)},closed);
export const CareWorkspaceReadSchema=Type.Object({...CareWorkspaceSavedSchema.properties,content:CareWorkspaceContentSchema,maker:Type.String()},closed);
export const CareWorkspaceRecoverSchema=Type.Object({requestId:UnitId},closed);
export const CareWorkspaceApplicationsSchema=Type.Object({kind:Type.Enum(Object.keys(careWorkspaceStages)),campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(UnitId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},closed);
export const CareWorkspaceApplicationsResultSchema=Type.Object({items:Type.Array(Type.Object({id:UnitId,maker:Type.String(),recordedAt:UnitTime,submission:CareWorkspaceSubmissionSchema},closed)),nextAfterId:Type.Union([UnitId,Type.Null()])},closed);
export const CareWorkspacePermissionsSchema=Type.Object({kind:Type.Enum(Object.keys(careWorkspaceStages)),campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(UnitId)},closed);
export const CareWorkspacePermissionsResultSchema=Type.Object({read:Type.Boolean(),write:Type.Boolean(),readRestricted:Type.Boolean(),verify:Type.Boolean(),review:Type.Boolean()},closed);
export const CareWorkspaceExecutionsSchema=Type.Object({kind:Type.Enum(Object.keys(careWorkspaceStages)),inputId:UnitId,candidateId:Type.Optional(UnitId),requestId:Type.Optional(UnitId),after:Type.Optional(UnitId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},closed);
export const CareWorkspaceExecutionsResultSchema=Type.Object({items:Type.Array(Type.Object({candidateId:UnitId,digest:Type.String({pattern:'^[a-f0-9]{64}$'}),requestId:UnitId,recordedAt:UnitTime,approvedBy:Type.Union([Type.String(),Type.Null()]),committed:Type.Boolean()},closed)),nextAfterId:Type.Union([UnitId,Type.Null()])},closed);
export const CareWorkspaceApplicationReferenceSchema=Type.Object({kind:Type.Enum(Object.keys(careWorkspaceStages)),inputId:UnitId},closed);
export const CareWorkspaceApplicationReferenceResultSchema=Type.Object({id:UnitId,maker:Type.String(),recordedAt:UnitTime,submission:CareWorkspaceSubmissionSchema,source:Type.Optional(Type.Union([Type.Object({origin:Type.Enum(['PAGE','FILE']),sourceArtifactId:Type.Union([UnitId,Type.Null()]),sourceRow:Type.Union([Type.Integer({minimum:1}),Type.Null()]),worksheet:Type.Union([Type.String(),Type.Null()])},closed),Type.Null()]))},closed);
const Bytes=Type.String({minLength:4,maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'});
export const CareWorkspaceMaterialStoreSchema=Type.Object({input:Type.Object({...ProtectedStoreSchema.properties,kind:Type.Literal('RAW_CELL')},closed),contentBase64:Bytes},closed);
export const CareWorkspaceMaterialReadSchema=Type.Union([Type.Object({access:Type.Literal('OWN'),...ProtectedReadSchema.properties},closed),Type.Object({access:Type.Literal('INPUT'),kind:Type.Enum(Object.keys(careWorkspaceStages).filter(kind=>kind!=='LIFECYCLE')),inputId:UnitId,artifactId:UnitId},closed)]);
export const CareWorkspaceMaterialReferenceSchema=Type.Object({artifactId:UnitId,status:Type.Literal('QUARANTINED'),masked:Type.Literal('[REDACTED]'),purged:Type.Boolean(),expiresAt:Type.String()},closed);
export const CareWorkspaceMaterialReadResultSchema=Type.Object({artifactId:UnitId,contentBase64:Bytes},closed);
export const CareWorkspaceMaterialCreateSchema=Type.Object({requestId:UnitId,campus:Type.Enum(['NORTH','SOUTH']),transport:Transport,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),contentBase64:Bytes},closed);
export const CareWorkspaceMaterialCreateResultSchema=Type.Object({...CareWorkspaceMaterialReferenceSchema.properties,jobId:UnitId,revisionId:UnitId},closed);
