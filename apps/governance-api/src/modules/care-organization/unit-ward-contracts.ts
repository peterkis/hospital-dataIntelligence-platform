import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema,type CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
const closed={additionalProperties:false} as const;
export const UnitWardId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
export const UnitWardTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const UnitWardHead=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
const End=Type.Union([UnitWardTime,Type.Null()]),Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),OptionalText=Type.Union([Type.String({maxLength:2000}),Type.Null()]),Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
export const UnitWardRowSchema=Type.Object({unit_ward_rel_id:Type.String({minLength:1,maxLength:64,pattern:'\\S'}),unit_id:UnitWardId,ward_id:UnitWardId,relation_type:Type.Enum(['收治','管理','共享']),is_primary:Type.Enum(['Y','N']),sharing_rule:OptionalText,version_no:Type.Union([Type.String({pattern:'^[1-9][0-9]{0,9}$'}),Type.Integer({minimum:1,maximum:2147483647})]),valid_from:UnitWardTime,valid_to:End,record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),source_system_id:UnitWardId,source_record_id:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),approval_ref:OptionalText,recorded_at:UnitWardTime},closed);
export const UnitWardDirectRowSchema=Type.Object({...UnitWardRowSchema.properties,version_no:Type.Integer({minimum:1,maximum:2147483647})},closed);
export type UnitWardRow=Static<typeof UnitWardRowSchema>;
export const ORG10_FIELDS=Object.keys(UnitWardRowSchema.properties) as Array<keyof UnitWardRow>;
export const UnitWardScopeSchema=Type.Object({unit:Type.Object({owner:Type.Literal('care-organization/unit'),id:UnitWardId},closed),ward:Type.Object({owner:Type.Literal('care-organization/ward'),id:UnitWardId},closed),campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:UnitWardId},closed),purpose:Type.Enum(['ADMISSION','MANAGEMENT'])},closed);
export type UnitWardScope=Static<typeof UnitWardScopeSchema>;
export const UnitWardRuleSchema=Type.Union([Type.Object({kind:Type.Literal('NO_SHARING_REQUIRED')},closed),Type.Object({kind:Type.Literal('SHARED_BOUNDARY'),ruleReference:Text,ruleVersion:Text,evidenceId:UnitWardId,participants:Type.Array(UnitWardId,{minItems:1,maxItems:100,uniqueItems:true}),validFrom:UnitWardTime,validTo:End},closed),Type.Object({kind:Type.Literal('UNKNOWN')},closed)]);
export type UnitWardRule=Static<typeof UnitWardRuleSchema>;
const Common={row:UnitWardRowSchema,applicability:UnitWardScopeSchema,rule:UnitWardRuleSchema,reason:Text,evidenceId:UnitWardId};
export const UnitWardTargetSchema=Type.Object({owner:Type.Literal('care-organization/unit-ward-relation'),id:UnitWardId,expectedHead:UnitWardHead},closed);
export const UnitWardEntrySchema=Type.Union([Type.Object({...Common,action:Type.Literal('CREATE')},closed),Type.Object({...Common,action:Type.Literal('REVISE'),target:UnitWardTargetSchema},closed),Type.Object({...Common,action:Type.Literal('END'),target:UnitWardTargetSchema,endAt:UnitWardTime},closed)]);
export type UnitWardEntry=Static<typeof UnitWardEntrySchema>;
export const UnitWardStageSchema=Type.Object({requestId:UnitWardId,jobId:UnitWardId,revisionId:UnitWardId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Literal('LOCAL'),entries:Type.Array(UnitWardEntrySchema,{minItems:1,maxItems:100})},closed);
export const UnitWardDirectEntrySchema=Type.Union([Type.Object({...UnitWardEntrySchema.anyOf[0].properties,row:UnitWardDirectRowSchema},closed),Type.Object({...UnitWardEntrySchema.anyOf[1].properties,row:UnitWardDirectRowSchema},closed),Type.Object({...UnitWardEntrySchema.anyOf[2].properties,row:UnitWardDirectRowSchema},closed)]);
export const UnitWardDirectStageSchema=Type.Object({...UnitWardStageSchema.properties,entries:Type.Array(UnitWardDirectEntrySchema,{minItems:1,maxItems:100})},closed);
export const UnitWardStoredStageSchema=Type.Object({...UnitWardStageSchema.properties,sourceArtifactId:Type.Optional(UnitWardId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type UnitWardStage=Static<typeof UnitWardStageSchema>;
export type UnitWardStoredStage=Static<typeof UnitWardStoredStageSchema>;
export const UnitWardVerifySchema=Type.Object({requestId:UnitWardId,inputId:UnitWardId,inputDigest:Digest,reason:Text,policyVersion:Type.Literal('ORG10_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:UnitWardId,classificationAccepted:Type.Boolean(),scopeAccepted:Type.Boolean(),rule:UnitWardRuleSchema,ruleConfirmed:Type.Boolean(),validFrom:UnitWardTime,validTo:End},closed),{minItems:1,maxItems:100})},closed);
export type UnitWardVerification=Static<typeof UnitWardVerifySchema>;
export const UnitWardInputSchema=Type.Object({inputId:UnitWardId},closed);
export const UnitWardPlanSchema=Type.Object({inputId:UnitWardId,requestId:UnitWardId},closed);
export const UnitWardReadSchema=Type.Object({id:UnitWardId,businessAt:Type.Optional(UnitWardTime),recordAsOf:Type.Optional(UnitWardTime)},closed);
export const UnitWardHistorySchema=Type.Object({id:UnitWardId,recordAsOf:Type.Optional(UnitWardTime)},closed);
export const UnitWardExactSchema=Type.Object({...UnitWardHistorySchema.properties,version:UnitWardHead},closed);
export const UnitWardDiffSchema=Type.Object({id:UnitWardId,fromVersion:UnitWardHead,toVersion:UnitWardHead},closed);
export const UnitWardListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(UnitWardId),unitId:Type.Optional(UnitWardId),wardId:Type.Optional(UnitWardId),after:Type.Optional(UnitWardId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(UnitWardTime),recordAsOf:Type.Optional(UnitWardTime)},closed);
export const UnitWardWindowSchema=Type.Object({applicability:UnitWardScopeSchema,validFrom:UnitWardTime,validTo:End,mode:Type.Enum(['CURRENT_ADMISSION','HISTORICAL']),recordAsOf:Type.Optional(UnitWardTime)},closed);
export type UnitWardWindow=Static<typeof UnitWardWindowSchema>;
export const UnitWardReceiveSchema=Type.Object({requestId:UnitWardId,fileRequestId:UnitWardId,job:ImportJobCommandSchema,campus:UnitWardStageSchema.properties.campus,timePolicy:UnitWardStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(UnitWardEntrySchema.anyOf[0],['row']),Type.Omit(UnitWardEntrySchema.anyOf[1],['row']),Type.Omit(UnitWardEntrySchema.anyOf[2],['row'])]),{minItems:1,maxItems:100})},closed);
export type UnitWardReceive=Static<typeof UnitWardReceiveSchema>;
export interface UnitWardFacts {relationType:UnitWardRow['relation_type'];isPrimary:boolean;sharingRule:string|null;rule:UnitWardRule;contractVersionId:string;verificationBasis:{id:string;version:string;digest:string};dependencies:unknown;source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string}}
export interface UnitWardVersion {id:string;number:string;action:UnitWardEntry['action'];validFrom:string;validTo:string|null;recordedAt:string;facts:UnitWardFacts;reason:string;changeId:string}
export interface UnitWardHistory {id:string;scope:'NORTH'|'SOUTH';applicability:UnitWardScope;versions:UnitWardVersion[]}
export interface UnitWardWrite {key:string;targetId:string|null;expectedHead:string|null;action:UnitWardEntry['action'];validFrom:string;validTo:string|null;applicability:UnitWardScope;facts:UnitWardFacts;reason:string;sourceRow:number;scope:'NORTH'|'SOUTH'}
export interface UnitWardIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface UnitWardUpstreamPorts {referenceAccess(s:CatalogTransactionScope,actor:string,scope:UnitWardScope):Promise<{scope:'NORTH'|'SOUTH'}>;admit(s:CatalogTransactionScope,actor:string,scope:UnitWardScope,from:string,to:string|null,r:string):Promise<unknown>}
export function unitWardCheck(schema:unknown,value:unknown){if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function normalizeUnitWardRow(value:unknown,_policy:'LOCAL'){unitWardCheck(UnitWardRowSchema,value);const row=structuredClone(value) as UnitWardRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const from=localTime(row.valid_from),to=row.valid_to===null?null:localTime(row.valid_to);if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:localTime(row.recorded_at)};}
