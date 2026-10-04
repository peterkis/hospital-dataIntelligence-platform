import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema,type CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime,type EvaluateOperatingInput,type OperatingOwner} from '../organization-master/index.js';
const closed={additionalProperties:false} as const;
export const UnitId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const required=(maxLength=2000)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
const text=(maxLength=2000)=>Type.String({maxLength});
export const UnitTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const UnitHead=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
export const UNIT_TYPES=['OPD','IPD','ED','EXAM','LAB','PHARMACY','OR','OTHER'] as const;
export const UnitRowSchema=Type.Object({unit_id:required(64),unit_code:required(256),unit_name:required(160),org_id:UnitId,campus_id:UnitId,legal_entity_id:UnitId,unit_type:required(64),public_phone:text(256),service_description:text(),receiving_rule_ref:text(),business_owner_id:text(64),version_no:Type.String({pattern:'^[1-9][0-9]{0,9}$'}),valid_from:required(40),valid_to:text(40),record_status:required(64),source_system_id:UnitId,source_record_id:required(256),approval_ref:text(),recorded_at:required(40)},closed);
export type UnitRow=Static<typeof UnitRowSchema>;
export const ORG07_FIELDS=Object.keys(UnitRowSchema.properties) as Array<keyof UnitRow>;
export const UnitTargetSchema=Type.Object({owner:Type.Literal('care-organization/unit'),id:UnitId,expectedHead:UnitHead},closed);
export const UnitRelationReferenceSchema=Type.Object({owner:Type.Literal('department-master/campus-relation'),id:UnitId,version:UnitHead,versionId:UnitId},closed);
const Common={row:UnitRowSchema,reason:required(),evidenceId:UnitId};
const Binding={department:Type.Object({owner:Type.Literal('department-master'),id:UnitId},closed),campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:UnitId},closed),subject:Type.Object({owner:Type.Literal('organization-master'),id:UnitId},closed),relation:UnitRelationReferenceSchema,services:Type.Array(required(64),{minItems:1,maxItems:100,uniqueItems:true})};
export const UnitBindingSchema=Type.Object(Binding,closed);
export type UnitBindingInput=Static<typeof UnitBindingSchema>;
export const UnitEntrySchema=Type.Union([Type.Object({...Common,action:Type.Literal('CREATE'),binding:UnitBindingSchema},closed),Type.Object({...Common,action:Type.Literal('REBIND'),target:UnitTargetSchema,binding:UnitBindingSchema},closed),Type.Object({...Common,action:Type.Enum(['REVISE','CLOSE']),target:UnitTargetSchema},closed)]);
export type UnitEntry=Static<typeof UnitEntrySchema>;
export const UnitStageSchema=Type.Object({requestId:UnitId,jobId:UnitId,revisionId:UnitId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL']),entries:Type.Array(UnitEntrySchema,{minItems:1,maxItems:100})},closed);
export const UnitStoredStageSchema=Type.Object({...UnitStageSchema.properties,sourceArtifactId:Type.Optional(UnitId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type UnitStage=Static<typeof UnitStageSchema>;
export type UnitStoredStage=Static<typeof UnitStoredStageSchema>;
export const UnitVerifySchema=Type.Object({requestId:UnitId,inputId:UnitId,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),reason:required(),policyVersion:Type.Literal('ORG07_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:UnitId,classificationAccepted:Type.Boolean(),receiving:Type.Union([Type.Object({kind:Type.Literal('NO_SPECIAL_RESTRICTION'),confirmed:Type.Boolean(),validFrom:UnitTime,validTo:Type.Union([UnitTime,Type.Null()])},closed),Type.Object({kind:Type.Literal('RESTRICTED_RULE_REFERENCE'),ruleReference:required(),sourceRuleVersion:required(256),ruleEvidenceId:UnitId,validFrom:UnitTime,validTo:Type.Union([UnitTime,Type.Null()])},closed),Type.Object({kind:Type.Literal('UNKNOWN')},closed)])},closed),{minItems:1,maxItems:100})},closed);
export type UnitVerification=Static<typeof UnitVerifySchema>;
export const UnitInputSchema=Type.Object({inputId:UnitId},closed);
export const UnitPlanSchema=Type.Object({inputId:UnitId,requestId:UnitId},closed);
export const UnitReadSchema=Type.Object({id:UnitId,businessAt:Type.Optional(UnitTime),recordAsOf:Type.Optional(UnitTime)},closed);
export const UnitHistorySchema=Type.Object({id:UnitId,recordAsOf:Type.Optional(UnitTime)},closed);
export const UnitExactSchema=Type.Object({...UnitHistorySchema.properties,version:UnitHead},closed);
export const UnitDiffSchema=Type.Object({id:UnitId,fromVersion:UnitHead,toVersion:UnitHead},closed);
export const UnitWindowSchema=Type.Object({id:UnitId,validFrom:UnitTime,validTo:Type.Union([UnitTime,Type.Null()]),recordAsOf:Type.Optional(UnitTime)},closed);
export const UnitListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(UnitId),departmentId:Type.Optional(UnitId),after:Type.Optional(UnitId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(UnitTime),recordAsOf:Type.Optional(UnitTime)},closed);
export const UnitReceiveSchema=Type.Object({requestId:UnitId,fileRequestId:UnitId,job:ImportJobCommandSchema,campus:UnitStageSchema.properties.campus,timePolicy:UnitStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(UnitEntrySchema.anyOf[0],['row']),Type.Omit(UnitEntrySchema.anyOf[1],['row']),Type.Omit(UnitEntrySchema.anyOf[2],['row'])]),{minItems:1,maxItems:100})},closed);
export type UnitReceive=Static<typeof UnitReceiveSchema>;
export interface UnitFacts {unitCode:string;unitName:string;unitType:typeof UNIT_TYPES[number];publicPhone:string|null;serviceDescription:string|null;receivingRuleReference:string|null;responsibilityStatus:'PENDING';source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string};contractVersionId:string;receivingBasis:unknown}
export interface UnitVersion {id:string;number:string;action:'CREATE'|'REVISE'|'REBIND'|'CLOSE';validFrom:string;validTo:string|null;recordedAt:string;facts:UnitFacts;reason:string;changeId:string}
export interface UnitBindingVersion {id:string;number:string;validFrom:string;validTo:string|null;recordedAt:string;binding:UnitBindingInput;dependencies:unknown;changeId:string}
export interface UnitBindingHistory {id:string;campusId:string;subjectId:string;scope:'NORTH'|'SOUTH';versions:UnitBindingVersion[]}
export interface UnitHistory {id:string;departmentId:string;versions:UnitVersion[];bindings:UnitBindingHistory[];codes:string[]}
export interface UnitWrite {key:string;targetId:string|null;expectedHead:string|null;action:UnitVersion['action'];validFrom:string;validTo:string|null;facts:UnitFacts;binding:UnitBindingInput|null;bindingChanges:Array<{id:string|null;expectedHead:string|null;validFrom:string;validTo:string|null;binding:UnitBindingInput;dependencies:unknown}>;reason:string;sourceRow:number;scope:'NORTH'|'SOUTH'}
export interface UnitIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface UnitAdmissionInput extends UnitBindingInput {validFrom:string;validTo:string|null;recordAsOf?:string}
export interface UnitUpstreamPorts {departmentCoverage(scope:CatalogTransactionScope,actor:string,input:UnitAdmissionInput):Promise<unknown>;operatingWindow(scope:CatalogTransactionScope,actor:string,input:EvaluateOperatingInput):ReturnType<OperatingOwner['evaluateOperatingWindowInTransaction']>;referenceAccess(scope:CatalogTransactionScope,actor:string,input:UnitBindingInput):Promise<void>}
export function unitCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function normalizeUnitRow(value:unknown,policy:UnitStage['timePolicy']){unitCheck(UnitRowSchema,value);const row=structuredClone(value) as UnitRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const time=(value:string)=>{if(policy==='SOURCE_PLUS08_TO_LOCAL'){if(!value.endsWith('+08:00'))throw new Error('LOCAL_TIME_REQUIRED');value=value.slice(0,-6);}return localTime(value);};const from=time(row.valid_from),to=row.valid_to?time(row.valid_to):null;if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:time(row.recorded_at)};}
