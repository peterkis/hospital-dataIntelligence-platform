import {Type,type Static} from 'typebox';
import type {CatalogTransactionScope} from '../governance-catalog/index.js';
import {ImportJobCommandSchema} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
import {useCheck} from './use-runtime.js';
import {UseClosed as closed,UseId as Id,UseTime as Time,UseEnd as End,UseHead as Head,UseText as Text,UseDigest as Digest,UsageTypeReferenceSchema,type UsageTypeReference} from './usage-type-contracts.js';
const OptionalText=Type.Union([Type.String({maxLength:2000}),Type.Null()]);
export const USE_TARGET_OWNERS={ORG:'department-master',UNIT:'care-organization/unit',WARD:'care-organization/ward',NURSING:'care-organization/nursing'} as const;
export const UseTargetSchema=Type.Union([
 Type.Object({owner:Type.Literal('department-master'),id:Id},closed),
 Type.Object({owner:Type.Literal('care-organization/unit'),id:Id},closed),
 Type.Object({owner:Type.Literal('care-organization/ward'),id:Id},closed),
 Type.Object({owner:Type.Literal('care-organization/nursing'),id:Id},closed),
]);
export const UseScopeSchema=Type.Object({targetType:Type.Enum(['ORG','UNIT','WARD','NURSING']),target:UseTargetSchema,campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:Id},closed),location:Type.Object({owner:Type.Literal('location-master'),id:Id},closed),usageType:Type.Object({owner:Type.Literal('location-master/usage-type'),id:Id},closed)},closed);
export type LocationUseScope=Static<typeof UseScopeSchema>;
export const UsePolicySchema=Type.Object({kind:Type.Enum(['SHARED','EXCLUSIVE']),version:Type.Literal('WHOLE_LOCATION_V1')},closed);
export type LocationUsePolicy=Static<typeof UsePolicySchema>;
export const LocationUseRowSchema=Type.Object({object_location_rel_id:Type.String({minLength:1,maxLength:64,pattern:'\\S'}),target_type:Type.Enum(['LEGAL','CAMPUS','ORG','UNIT','WARD','NURSING','TEAM','LOCATION','COST','BED']),target_id:Id,location_id:Id,usage_type:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),is_primary:Type.Enum(['Y','N']),sharing_description:OptionalText,version_no:Type.Union([Type.Integer({minimum:1,maximum:2147483647}),Type.String({pattern:'^[1-9][0-9]{0,9}$'})]),valid_from:Type.String({minLength:1,maxLength:40}),valid_to:Type.Union([Type.String({maxLength:40}),Type.Null()]),record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),source_system_id:Id,source_record_id:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),approval_ref:OptionalText,recorded_at:Type.String({minLength:1,maxLength:40})},closed);
export type LocationUseRow=Static<typeof LocationUseRowSchema>;
export const ORG13_FIELDS=Object.keys(LocationUseRowSchema.properties) as Array<keyof LocationUseRow>;
export const LocationUseTargetSchema=Type.Object({owner:Type.Literal('location-master/location-use'),id:Id,expectedHead:Head},closed);
const Common={row:LocationUseRowSchema,applicability:UseScopeSchema,usageType:UsageTypeReferenceSchema,policy:UsePolicySchema,evidenceId:Id,reason:Text};
export const LocationUseEntrySchema=Type.Union([Type.Object({...Common,action:Type.Literal('CREATE')},closed),Type.Object({...Common,action:Type.Literal('REVISE'),target:LocationUseTargetSchema},closed),Type.Object({...Common,action:Type.Literal('END'),target:LocationUseTargetSchema,endAt:Time},closed)]);
export type LocationUseEntry=Static<typeof LocationUseEntrySchema>;
export const LocationUseStageSchema=Type.Object({requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL']),entries:Type.Array(LocationUseEntrySchema,{minItems:1,maxItems:100})},closed);
const DirectRowSchema=Type.Object({...LocationUseRowSchema.properties,version_no:Type.Integer({minimum:1,maximum:2147483647})},closed);
export const LocationUseDirectStageSchema=Type.Object({...LocationUseStageSchema.properties,entries:Type.Array(Type.Union([
 Type.Object({...LocationUseEntrySchema.anyOf[0].properties,row:DirectRowSchema},closed),
 Type.Object({...LocationUseEntrySchema.anyOf[1].properties,row:DirectRowSchema},closed),
 Type.Object({...LocationUseEntrySchema.anyOf[2].properties,row:DirectRowSchema},closed),
]),{minItems:1,maxItems:100})},closed);
export const LocationUseStoredStageSchema=Type.Object({...LocationUseStageSchema.properties,sourceArtifactId:Type.Optional(Id),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type LocationUseStage=Static<typeof LocationUseStageSchema>;
export type LocationUseStoredStage=Static<typeof LocationUseStoredStageSchema>;
export const LocationUseVerifySchema=Type.Object({requestId:Id,inputId:Id,inputDigest:Digest,reason:Text,policyVersion:Type.Literal('ORG13_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:Id,classificationAccepted:Type.Boolean(),scopeAccepted:Type.Boolean(),policyAccepted:Type.Boolean(),policy:UsePolicySchema,validFrom:Time,validTo:End},closed),{minItems:1,maxItems:100})},closed);
export type LocationUseVerification=Static<typeof LocationUseVerifySchema>;
export const LocationUseInputSchema=Type.Object({inputId:Id},closed),LocationUsePlanSchema=Type.Object({inputId:Id,requestId:Id},closed);
export const LocationUseReadSchema=Type.Object({id:Id,businessAt:Type.Optional(Time),recordAsOf:Type.Optional(Time)},closed),LocationUseHistorySchema=Type.Object({id:Id,recordAsOf:Type.Optional(Time)},closed);
export const LocationUseExactSchema=Type.Object({...LocationUseHistorySchema.properties,version:Head},closed),LocationUseDiffSchema=Type.Object({id:Id,fromVersion:Head,toVersion:Head},closed);
export const LocationUseListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(Id),targetId:Type.Optional(Id),locationId:Type.Optional(Id),usageTypeId:Type.Optional(Id),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(Time),recordAsOf:Type.Optional(Time)},closed);
export const LocationUseWindowSchema=Type.Object({id:Id,validFrom:Time,validTo:End,mode:Type.Enum(['CURRENT_ADMISSION','HISTORICAL']),recordAsOf:Type.Optional(Time)},closed);
export type LocationUseWindow=Static<typeof LocationUseWindowSchema>;
export const LocationUseReceiveSchema=Type.Object({requestId:Id,fileRequestId:Id,job:ImportJobCommandSchema,campus:LocationUseStageSchema.properties.campus,timePolicy:LocationUseStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(LocationUseEntrySchema.anyOf[0],['row'],closed),Type.Omit(LocationUseEntrySchema.anyOf[1],['row'],closed),Type.Omit(LocationUseEntrySchema.anyOf[2],['row'],closed)]),{minItems:1,maxItems:100})},closed);
export type LocationUseReceive=Static<typeof LocationUseReceiveSchema>;
export interface LocationUseFacts{isPrimary:boolean;sharingDescription:string|null;policy:LocationUsePolicy;usageType:UsageTypeReference;usageCode:string;contractVersionId:string;verificationBasis:{id:string;version:string;digest:string};dependencies:unknown;source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string|null}}
export interface LocationUseVersion{id:string;number:string;action:'CREATE'|'REVISE'|'END';validFrom:string;validTo:string|null;recordedAt:string;facts:LocationUseFacts;reason:string;changeId:string}
export interface LocationUseHistory{id:string;scope:'NORTH'|'SOUTH';applicability:LocationUseScope;versions:LocationUseVersion[]}
export interface LocationUseWrite{key:string;targetId:string|null;expectedHead:string|null;action:'CREATE'|'REVISE'|'END';validFrom:string;validTo:string|null;applicability:LocationUseScope;facts:LocationUseFacts;reason:string;sourceRow:number;verificationRow:number;scope:'NORTH'|'SOUTH';reduction:boolean}
export interface LocationUseIssue{row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface LocationUseUpstreamPorts{
 referenceAccess(s:CatalogTransactionScope,actor:string,a:LocationUseScope):Promise<{scope:'NORTH'|'SOUTH'}>;
 boundaries(s:CatalogTransactionScope,actor:string,a:LocationUseScope,from:string,to:string|null,r:string):Promise<string[]>;
 admit(s:CatalogTransactionScope,actor:string,a:LocationUseScope,from:string,to:string|null,r:string):Promise<{location:unknown;upstream:unknown}>;
 admitLocation(s:CatalogTransactionScope,actor:string,a:LocationUseScope,from:string,to:string|null,r:string):Promise<unknown>;
 admitTarget(s:CatalogTransactionScope,actor:string,a:LocationUseScope,from:string,to:string|null,r:string):Promise<unknown>;
}
export function normalizeLocationUseRow(value:unknown,policy:LocationUseStage['timePolicy']){
 useCheck(LocationUseRowSchema,value);const row=structuredClone(value) as LocationUseRow;
 if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');
 const normalize=(time:string)=>{if(policy==='SOURCE_PLUS08_TO_LOCAL'){if(!time.endsWith('+08:00'))throw new Error('LOCAL_TIME_REQUIRED');time=time.slice(0,-6);}return localTime(time);};
 const from=normalize(row.valid_from),to=row.valid_to===null?null:normalize(row.valid_to),sourceRecordedAt=normalize(row.recorded_at);
 if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt};
}
