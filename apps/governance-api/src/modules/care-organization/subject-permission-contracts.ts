import {Type,type Static} from 'typebox';
import {SubjectId,SubjectTime,SubjectEnd,SubjectHead,SubjectText,SubjectDigest,subjectCheck,ImportJobCommandSchema,type CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime,type OperatingOwner} from '../organization-master/index.js';
const closed={additionalProperties:false} as const;
export const SubjectScopeSchema=Type.Object({
 target:Type.Union([
  Type.Object({type:Type.Literal('LEGAL'),owner:Type.Literal('organization-master'),id:SubjectId},closed),
  Type.Object({type:Type.Literal('ORG'),owner:Type.Literal('department-master'),id:SubjectId},closed),
  Type.Object({type:Type.Literal('UNIT'),owner:Type.Literal('care-organization/unit'),id:SubjectId},closed),
 ]),
 subject:Type.Object({owner:Type.Literal('organization-master'),id:SubjectId},closed),
 campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:SubjectId},closed),
 services:Type.Array(Type.String({minLength:1,maxLength:64}),{minItems:1,maxItems:100,uniqueItems:true}),
},closed);
export type SubjectScope=Static<typeof SubjectScopeSchema>;
export const SubjectAdoptionSchema=Type.Object({owner:Type.Literal('governance-catalog/subject-code'),systemId:SubjectId,versionId:SubjectId,version:SubjectHead,code:Type.String({minLength:1,maxLength:64})},closed);
export const SubjectWindowSchema=Type.Object({scope:SubjectScopeSchema,adoption:SubjectAdoptionSchema,validFrom:SubjectTime,validTo:SubjectEnd,mode:Type.Enum(['CURRENT_ADMISSION','HISTORICAL']),recordAsOf:Type.Optional(SubjectTime)},closed);
export type SubjectWindow=Static<typeof SubjectWindowSchema>;
export const SubjectListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),kind:Type.Optional(Type.Enum(['MAPPING','PERMISSION'])),campusId:Type.Optional(SubjectId),targetType:Type.Optional(Type.Enum(['LEGAL','ORG','UNIT'])),after:Type.Optional(SubjectId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(SubjectTime),recordAsOf:Type.Optional(SubjectTime)},closed);
export type SubjectList=Static<typeof SubjectListSchema>;
export const SubjectWindowResultSchema=Type.Object({status:Type.Enum(['SATISFIED','NOT_SATISFIED','REVIEW_REQUIRED']),reason:Type.String(),recordAsOf:SubjectTime,clinicalReadiness:Type.Literal('NOT_READY'),checks:Type.Array(Type.Object({service:Type.String(),from:SubjectTime,to:SubjectEnd,status:Type.Enum(['SATISFIED','NOT_SATISFIED','REVIEW_REQUIRED']),reason:Type.String(),permissionId:Type.Union([SubjectId,Type.Null()]),version:Type.Union([SubjectHead,Type.Null()]),acceptedBasis:Type.Unknown(),basis:Type.Unknown()},closed))},closed);
const OptionalText=Type.Union([Type.String({maxLength:2000}),Type.Null()]);
export const SubjectRowSchema=Type.Object({subject_license_id:Type.String({minLength:1,maxLength:64,pattern:'\\S'}),target_type:Type.String({minLength:1,maxLength:64}),target_id:Type.String({minLength:1,maxLength:64}),code_system_id:Type.String({minLength:1,maxLength:64}),code_system_version:Type.String({minLength:1,maxLength:256}),subject_code:Type.String({minLength:1,maxLength:256}),license_ref:SubjectText,permitted_scope:OptionalText,verifier:SubjectText,version_no:Type.Union([Type.Integer({minimum:1,maximum:2147483647}),Type.String({pattern:'^[1-9][0-9]{0,9}$'})]),valid_from:Type.String({minLength:1,maxLength:40}),valid_to:Type.Union([Type.String({maxLength:40}),Type.Null()]),record_status:Type.String({minLength:1,maxLength:64}),source_system_id:Type.String({minLength:1,maxLength:64}),source_record_id:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),approval_ref:OptionalText,recorded_at:Type.String({minLength:1,maxLength:40})},closed);
export type SubjectRow=Static<typeof SubjectRowSchema>;
export const ORG17_FIELDS=Object.keys(SubjectRowSchema.properties) as Array<keyof SubjectRow>;
export const SubjectLicenseSchema=Type.Object({owner:Type.Literal('organization-master/license'),id:SubjectId,version:SubjectHead,versionId:SubjectId},closed);
export const SubjectRelationContextSchema=Type.Object({departmentRelation:Type.Object({owner:Type.Literal('department-master/campus-relation'),id:SubjectId,version:SubjectHead,versionId:SubjectId},closed)},closed);
export const SubjectLimitationsSchema=Type.Union([Type.Object({kind:Type.Literal('NO_ADDITIONAL_LIMITS')},closed),Type.Object({kind:Type.Literal('SERVICES_ONLY'),services:SubjectScopeSchema.properties.services},closed),Type.Object({kind:Type.Literal('UNRESOLVED')},closed)]);
const Semantic=Type.Enum(['EQUIVALENT','NARROWER','BROADER','RELATED']);
const Common={row:SubjectRowSchema,scope:SubjectScopeSchema,adoption:SubjectAdoptionSchema,context:Type.Optional(SubjectRelationContextSchema),reason:SubjectText,evidenceId:SubjectId};
const Target=Type.Object({owner:Type.Enum(['care-organization/subject-permission','care-organization/subject-mapping']),id:SubjectId,expectedHead:SubjectHead},closed);
const Mapping={...Common,kind:Type.Literal('MAPPING'),semantic:Semantic};
const Permission={...Common,kind:Type.Literal('PERMISSION'),license:SubjectLicenseSchema,limitations:SubjectLimitationsSchema};
export const SubjectEntrySchema=Type.Union([
 Type.Object({...Mapping,action:Type.Literal('RECORD')},closed),Type.Object({...Mapping,action:Type.Enum(['REVISE','RETIRE']),target:Target},closed),
 Type.Object({...Permission,action:Type.Literal('RECORD')},closed),Type.Object({...Permission,action:Type.Enum(['REVISE','RETIRE']),target:Target},closed),
]);
export type SubjectEntry=Static<typeof SubjectEntrySchema>;
export const SubjectDirectRowSchema=Type.Object({...SubjectRowSchema.properties,version_no:Type.Integer({minimum:1,maximum:2147483647}),valid_from:SubjectTime,valid_to:SubjectEnd,recorded_at:SubjectTime},closed);
const DirectMapping={...Mapping,row:SubjectDirectRowSchema},DirectPermission={...Permission,row:SubjectDirectRowSchema};
export const SubjectDirectEntrySchema=Type.Union([
 Type.Object({...DirectMapping,action:Type.Literal('RECORD')},closed),Type.Object({...DirectMapping,action:Type.Enum(['REVISE','RETIRE']),target:Target},closed),
 Type.Object({...DirectPermission,action:Type.Literal('RECORD')},closed),Type.Object({...DirectPermission,action:Type.Enum(['REVISE','RETIRE']),target:Target},closed),
]);
export type SubjectDirectEntry=Static<typeof SubjectDirectEntrySchema>;
export const SubjectStageSchema=Type.Object({requestId:SubjectId,jobId:SubjectId,revisionId:SubjectId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Literal('LOCAL'),entries:Type.Array(SubjectDirectEntrySchema,{minItems:1,maxItems:100})},closed);
// Legacy policy labels remain readable as protected source evidence, but cannot
// enter a new command or pass current normalization/admission.
export const SubjectStoredStageSchema=Type.Object({...SubjectStageSchema.properties,timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL']),entries:Type.Array(SubjectEntrySchema,{minItems:1,maxItems:100}),sourceArtifactId:Type.Optional(SubjectId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type SubjectStage=Static<typeof SubjectStageSchema>;export type SubjectStoredStage=Static<typeof SubjectStoredStageSchema>;
export const SubjectReceiveSchema=Type.Object({requestId:SubjectId,fileRequestId:SubjectId,job:ImportJobCommandSchema,campus:SubjectStageSchema.properties.campus,timePolicy:SubjectStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(SubjectEntrySchema.anyOf[0],['row']),Type.Omit(SubjectEntrySchema.anyOf[1],['row']),Type.Omit(SubjectEntrySchema.anyOf[2],['row']),Type.Omit(SubjectEntrySchema.anyOf[3],['row'])]),{minItems:1,maxItems:100})},closed);
export type SubjectReceive=Static<typeof SubjectReceiveSchema>;
export const SubjectVerificationSchema=Type.Object({requestId:SubjectId,inputId:SubjectId,inputDigest:SubjectDigest,reason:SubjectText,policyVersion:Type.Literal('ORG17_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:SubjectId,classificationAccepted:Type.Boolean(),scopeAccepted:Type.Boolean(),adoptionConfirmed:Type.Boolean(),limitationsConfirmed:Type.Boolean(),license:Type.Union([SubjectLicenseSchema,Type.Null()]),semantic:Type.Optional(Semantic),validFrom:SubjectTime,validTo:SubjectEnd},closed),{minItems:1,maxItems:100})},closed);
export type SubjectVerification=Static<typeof SubjectVerificationSchema>;
export const SubjectInputSchema=Type.Object({inputId:SubjectId},closed),SubjectPlanSchema=Type.Object({inputId:SubjectId,requestId:SubjectId},closed);
export const SubjectRecheckSchema=Type.Object({id:SubjectId},closed);
export const SubjectReadSchema=Type.Object({id:SubjectId,businessAt:Type.Optional(SubjectTime),recordAsOf:Type.Optional(SubjectTime)},closed),SubjectHistorySchema=Type.Object({id:SubjectId,recordAsOf:Type.Optional(SubjectTime)},closed),SubjectExactSchema=Type.Object({id:SubjectId,version:SubjectHead,recordAsOf:Type.Optional(SubjectTime)},closed);
export interface SubjectFacts {adoption:Static<typeof SubjectAdoptionSchema>;context:Static<typeof SubjectRelationContextSchema>|null;semantic:Static<typeof Semantic>|null;license:Static<typeof SubjectLicenseSchema>|null;limitations:Static<typeof SubjectLimitationsSchema>|null;verifierRole:string;contractVersionId:string;verificationBasis:{id:string;digest:string};dependencies:{source:unknown;code:unknown;target:unknown;operating:unknown}|null;source:{codeSystemId:string;codeSystemVersion:string;sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string;licenseDocumentEvidence:{inputId:string;row:number}}}
export interface SubjectVersion {id:string;number:string;action:'RECORD'|'REVISE'|'RETIRE';validFrom:string;validTo:string|null;recordedAt:string;facts:SubjectFacts;reason:string;changeId:string}
export interface SubjectHistory {id:string;kind:'MAPPING'|'PERMISSION';scope:SubjectScope;versions:SubjectVersion[]}
export interface SubjectIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface SubjectWrite {targetId:string|null;expectedHead:string|null;kind:'MAPPING'|'PERMISSION';action:'RECORD'|'REVISE'|'RETIRE';scope:SubjectScope;validFrom:string;validTo:string|null;facts:SubjectFacts;reason:string;sourceRow:number}
export interface SubjectPermissionPorts {operatingWindow:OperatingOwner['evaluateOperatingWindowInTransaction'];candidateTarget?(s:CatalogTransactionScope,actor:string,scope:SubjectScope,from:string,to:string|null,r:string):Promise<unknown|null>;targetBoundaries?(s:CatalogTransactionScope,actor:string,scope:SubjectScope,context:SubjectFacts['context'],from:string,to:string|null,r:string):Promise<string[]>}
export function normalizeSubjectRow(value:unknown,policy:SubjectStoredStage['timePolicy']){subjectCheck(SubjectRowSchema,value);if(policy!=='LOCAL')throw new Error('LOCAL_TIME_REQUIRED');const row=structuredClone(value) as SubjectRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const from=localTime(row.valid_from),to=row.valid_to===null?null:localTime(row.valid_to);if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:localTime(row.recorded_at)};}
