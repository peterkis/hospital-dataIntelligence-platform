import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {CapabilityScopeSchema,CAPABILITY_TYPES,CAPABILITY_CARE_SETTINGS,ImportJobCommandSchema,type CapabilityScope,type ParameterValueOwner,type CatalogTransactionScope} from '../governance-catalog/index.js';
import type {BusinessUnitOwner} from './owner.js';
import {localTime} from '../organization-master/index.js';
const closed={additionalProperties:false} as const;
export const CapabilityId=Type.String({format:'uuid'});
export const CapabilityTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const End=Type.Union([CapabilityTime,Type.Null()]),Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),OptionalText=Type.Union([Type.String({maxLength:2000}),Type.Null()]),Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
export const CapabilityHead=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
export const CapabilityRowSchema=Type.Object({capability_id:Type.String({minLength:1,maxLength:64,pattern:'\\S'}),unit_id:CapabilityId,capability_type:Type.Enum(CAPABILITY_TYPES),care_setting:Type.Enum(CAPABILITY_CARE_SETTINGS),enabled:Type.Enum(['Y','N']),rule_ref:OptionalText,approval_dept:Text,version_no:Type.Union([Type.String({pattern:'^[1-9][0-9]{0,9}$'}),Type.Integer({minimum:1,maximum:2147483647})]),valid_from:Type.String({minLength:1,maxLength:40}),valid_to:Type.Union([Type.String({maxLength:40}),Type.Null()]),record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),source_system_id:CapabilityId,source_record_id:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),approval_ref:OptionalText,recorded_at:Type.String({minLength:1,maxLength:40})},closed);
export type CapabilityRow=Static<typeof CapabilityRowSchema>;
export const ORG16_FIELDS=Object.keys(CapabilityRowSchema.properties) as Array<keyof CapabilityRow>;
export const ParameterAdoptionSchema=Type.Object({owner:Type.Literal('governance-catalog/parameter-value'),parameterId:CapabilityId,valueId:CapabilityId,versionId:CapabilityId,definitionVersionId:CapabilityId,definitionDigest:Digest,valueDigest:Digest},closed);
export type ParameterAdoption=Static<typeof ParameterAdoptionSchema>;
export const CapabilityRuleSchema=Type.Union([Type.Object({kind:Type.Literal('NO_ADDITIONAL_RULE')},closed),Type.Object({kind:Type.Literal('BOOLEAN_GATE_V1'),parameter:ParameterAdoptionSchema},closed)]);
export type CapabilityRule=Static<typeof CapabilityRuleSchema>;
export const CapabilityTargetSchema=Type.Object({owner:Type.Literal('care-organization/unit-capability'),id:CapabilityId,expectedHead:CapabilityHead},closed);
const Common={row:CapabilityRowSchema,applicability:CapabilityScopeSchema,rule:CapabilityRuleSchema,reason:Text,evidenceId:CapabilityId};
export const CapabilityEntrySchema=Type.Union([Type.Object({...Common,action:Type.Literal('GRANT')},closed),Type.Object({...Common,action:Type.Enum(['REVISE','ACTIVATE','SUSPEND','RESUME','END']),target:CapabilityTargetSchema},closed)]);
export type CapabilityEntry=Static<typeof CapabilityEntrySchema>;
export const CapabilityStageSchema=Type.Object({requestId:CapabilityId,jobId:CapabilityId,revisionId:CapabilityId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL']),entries:Type.Array(CapabilityEntrySchema,{minItems:1,maxItems:100})},closed);
export const CapabilityStoredStageSchema=Type.Object({...CapabilityStageSchema.properties,sourceArtifactId:Type.Optional(CapabilityId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type CapabilityStage=Static<typeof CapabilityStageSchema>;
export type CapabilityStoredStage=Static<typeof CapabilityStoredStageSchema>;
export const CapabilityVerifySchema=Type.Object({requestId:CapabilityId,inputId:CapabilityId,inputDigest:Digest,reason:Text,policyVersion:Type.Literal('ORG16_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:CapabilityId,classificationAccepted:Type.Boolean(),scopeAccepted:Type.Boolean(),rule:CapabilityRuleSchema,ruleConfirmed:Type.Boolean(),validFrom:CapabilityTime,validTo:End},closed),{minItems:1,maxItems:100})},closed);
export type CapabilityVerification=Static<typeof CapabilityVerifySchema>;
export const CapabilityInputSchema=Type.Object({inputId:CapabilityId},closed);
export const CapabilityPlanSchema=Type.Object({inputId:CapabilityId,requestId:CapabilityId},closed);
export const CapabilityReadSchema=Type.Object({id:CapabilityId,businessAt:Type.Optional(CapabilityTime),recordAsOf:Type.Optional(CapabilityTime)},closed);
export const CapabilityHistorySchema=Type.Object({id:CapabilityId,recordAsOf:Type.Optional(CapabilityTime)},closed);
export const CapabilityExactSchema=Type.Object({...CapabilityHistorySchema.properties,version:CapabilityHead},closed);
export const CapabilityDiffSchema=Type.Object({id:CapabilityId,fromVersion:CapabilityHead,toVersion:CapabilityHead},closed);
export const CapabilityListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(CapabilityId),unitId:Type.Optional(CapabilityId),after:Type.Optional(CapabilityId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(CapabilityTime),recordAsOf:Type.Optional(CapabilityTime)},closed);
export const CapabilityWindowSchema=Type.Object({applicability:CapabilityScopeSchema,validFrom:CapabilityTime,validTo:End,mode:Type.Enum(['CURRENT_ADMISSION','HISTORICAL']),recordAsOf:Type.Optional(CapabilityTime)},closed);
export type CapabilityWindow=Static<typeof CapabilityWindowSchema>;
export const CapabilityReceiveSchema=Type.Object({requestId:CapabilityId,fileRequestId:CapabilityId,job:ImportJobCommandSchema,campus:CapabilityStageSchema.properties.campus,timePolicy:CapabilityStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(CapabilityEntrySchema.anyOf[0],['row']),Type.Omit(CapabilityEntrySchema.anyOf[1],['row'])]),{minItems:1,maxItems:100})},closed);
export type CapabilityReceive=Static<typeof CapabilityReceiveSchema>;
export interface CapabilityFacts {approvalDepartment:string;initiallyEnabled:boolean;rule:CapabilityRule;contractVersionId:string;verificationBasis:{id:string;version:string;digest:string};dependencies:unknown;source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string}}
export interface CapabilityVersion {id:string;number:string;action:CapabilityEntry['action'];validFrom:string;validTo:string|null;recordedAt:string;facts:CapabilityFacts;reason:string;changeId:string}
export interface CapabilityHistory {id:string;scope:'NORTH'|'SOUTH';applicability:CapabilityScope;versions:CapabilityVersion[]}
export interface CapabilityWrite {key:string;targetId:string|null;expectedHead:string|null;action:CapabilityEntry['action'];validFrom:string;validTo:string|null;applicability:CapabilityScope;facts:CapabilityFacts;reason:string;sourceRow:number;scope:'NORTH'|'SOUTH'}
export interface CapabilityIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface CapabilityUpstreamPorts {
 referenceAccess(s:CatalogTransactionScope,actor:string,scope:CapabilityScope):Promise<{scope:'NORTH'|'SOUTH'}>;
 unitWindow(s:CatalogTransactionScope,actor:string,scope:CapabilityScope,from:string,to:string|null,r:string):ReturnType<BusinessUnitOwner['evaluateManagementWindowInTransaction']>;
 parameters:Pick<ParameterValueOwner,'authorizeReferenceInTransaction'|'evaluateWindowInTransaction'>;
}
export function capabilityCheck(schema:unknown,value:unknown){if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function normalizeCapabilityRow(value:unknown,policy:CapabilityStage['timePolicy']){capabilityCheck(CapabilityRowSchema,value);const row=structuredClone(value) as CapabilityRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const time=(v:string)=>{if(policy==='SOURCE_PLUS08_TO_LOCAL'){if(!v.endsWith('+08:00'))throw new Error('LOCAL_TIME_REQUIRED');v=v.slice(0,-6);}return localTime(v);};const from=time(row.valid_from),to=row.valid_to===null?null:time(row.valid_to);if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:time(row.recorded_at)};}
