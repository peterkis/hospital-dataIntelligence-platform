import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema,type CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
const closed={additionalProperties:false} as const;
export const WardId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const required=(maxLength=2000)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
const text=(maxLength=2000)=>Type.String({maxLength});
const nullableText=(maxLength=2000)=>Type.Union([text(maxLength),Type.Null()]);
export const WardTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const WardHead=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
export const WardRowSchema=Type.Object({ward_id:required(64),ward_code:required(256),ward_name:required(160),campus_id:WardId,managing_unit_id:Type.Union([WardId,Type.Null(),Type.Literal('')]),ward_type:required(256),admission_rule_ref:nullableText(),public_phone:nullableText(256),version_no:Type.Union([Type.String({pattern:'^[1-9][0-9]{0,9}$'}),Type.Integer({minimum:1,maximum:2147483647})]),valid_from:required(40),valid_to:nullableText(40),record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),source_system_id:WardId,source_record_id:required(256),approval_ref:nullableText(),recorded_at:required(40)},closed);
export type WardRow=Static<typeof WardRowSchema>;
export const ORG08_FIELDS=Object.keys(WardRowSchema.properties) as Array<keyof WardRow>;
export const WardTargetSchema=Type.Object({owner:Type.Literal('care-organization/ward'),id:WardId,expectedHead:WardHead},closed);
const Common={row:WardRowSchema,reason:required(),evidenceId:WardId};
const Binding={unit:Type.Object({owner:Type.Literal('care-organization/unit'),id:WardId},closed),campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:WardId},closed)};
export const WardBindingSchema=Type.Object(Binding,closed);
export type WardBindingInput=Static<typeof WardBindingSchema>;
export const WardEntrySchema=Type.Union([Type.Object({...Common,action:Type.Literal('CREATE'),binding:Type.Optional(WardBindingSchema)},closed),Type.Object({...Common,action:Type.Literal('REBIND'),target:WardTargetSchema,binding:WardBindingSchema},closed),Type.Object({...Common,action:Type.Enum(['REVISE','CLOSE','SUSPEND','RESUME']),target:WardTargetSchema},closed)]);
export type WardEntry=Static<typeof WardEntrySchema>;
export const WardStageSchema=Type.Object({requestId:WardId,jobId:WardId,revisionId:WardId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL']),entries:Type.Array(WardEntrySchema,{minItems:1,maxItems:100})},closed);
export const WardStoredStageSchema=Type.Object({...WardStageSchema.properties,sourceArtifactId:Type.Optional(WardId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type WardStage=Static<typeof WardStageSchema>;
export type WardStoredStage=Static<typeof WardStoredStageSchema>;
export const WardVerifySchema=Type.Object({requestId:WardId,inputId:WardId,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),reason:required(),policyVersion:Type.Literal('ORG08_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:WardId,classificationAccepted:Type.Boolean(),managementAccepted:Type.Boolean(),receiving:Type.Union([Type.Object({kind:Type.Literal('NO_SPECIAL_RESTRICTION'),confirmed:Type.Boolean({description:'Independent confirmation that no specialty, mixed-ward, age or isolation condition in SRC-COND-015 applies to this exact input.'}),validFrom:WardTime,validTo:Type.Union([WardTime,Type.Null()])},closed),Type.Object({kind:Type.Literal('RESTRICTED_RULE_REFERENCE'),ruleReference:required(),sourceRuleVersion:required(256),ruleEvidenceId:WardId,validFrom:WardTime,validTo:Type.Union([WardTime,Type.Null()])},closed),Type.Object({kind:Type.Literal('UNKNOWN')},closed)])},closed),{minItems:1,maxItems:100})},closed);
export type WardVerification=Static<typeof WardVerifySchema>;
export const WardInputSchema=Type.Object({inputId:WardId},closed);
export const WardPlanSchema=Type.Object({inputId:WardId,requestId:WardId},closed);
export const WardReadSchema=Type.Object({id:WardId,businessAt:Type.Optional(WardTime),recordAsOf:Type.Optional(WardTime)},closed);
export const WardHistorySchema=Type.Object({id:WardId,recordAsOf:Type.Optional(WardTime)},closed);
export const WardExactSchema=Type.Object({...WardHistorySchema.properties,version:WardHead},closed);
export const WardDiffSchema=Type.Object({id:WardId,fromVersion:WardHead,toVersion:WardHead},closed);
export const WardWindowSchema=Type.Object({id:WardId,validFrom:WardTime,validTo:Type.Union([WardTime,Type.Null()]),recordAsOf:Type.Optional(WardTime)},closed);
export const WardListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(WardId),managingUnitId:Type.Optional(WardId),after:Type.Optional(WardId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(WardTime),recordAsOf:Type.Optional(WardTime)},closed);
export const WardReceiveSchema=Type.Object({requestId:WardId,fileRequestId:WardId,job:ImportJobCommandSchema,campus:WardStageSchema.properties.campus,timePolicy:WardStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(WardEntrySchema.anyOf[0],['row']),Type.Omit(WardEntrySchema.anyOf[1],['row']),Type.Omit(WardEntrySchema.anyOf[2],['row'])]),{minItems:1,maxItems:100})},closed);
export type WardReceive=Static<typeof WardReceiveSchema>;
export interface WardFacts {wardCode:string;wardName:string;wardType:string;admissionRuleReference:string|null;publicPhone:string|null;responsibilityStatus:'PENDING';source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string};contractVersionId:string;managementBasis:unknown;receivingBasis:unknown}
export interface WardVersion {id:string;number:string;action:'CREATE'|'REVISE'|'REBIND'|'CLOSE'|'SUSPEND'|'RESUME';validFrom:string;validTo:string|null;recordedAt:string;facts:WardFacts;reason:string;changeId:string}
export interface WardBindingVersion {id:string;number:string;validFrom:string;validTo:string|null;recordedAt:string;binding:WardBindingInput;dependencies:unknown;changeId:string}
export interface WardBindingHistory {id:string;campusId:string;managingUnitId:string;scope:'NORTH'|'SOUTH';versions:WardBindingVersion[]}
export interface WardHistory {id:string;campusId:string;versions:WardVersion[];bindings:WardBindingHistory[];codes:string[]}
export interface WardWrite {key:string;targetId:string|null;expectedHead:string|null;action:WardVersion['action'];validFrom:string;validTo:string|null;facts:WardFacts;binding:WardBindingInput|null;bindingChanges:Array<{id:string|null;expectedHead:string|null;validFrom:string;validTo:string|null;binding:WardBindingInput;dependencies:unknown}>;reason:string;sourceRow:number;scope:'NORTH'|'SOUTH'}
export interface WardIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface WardAdmissionInput extends WardBindingInput {validFrom:string;validTo:string|null;recordAsOf?:string}
export interface WardUpstreamPorts {admit(scope:CatalogTransactionScope,actor:string,input:WardAdmissionInput):Promise<unknown>;referenceAccess(scope:CatalogTransactionScope,actor:string,input:WardBindingInput):Promise<{scope:'NORTH'|'SOUTH'}>;boundaries?(scope:CatalogTransactionScope,actor:string,input:WardAdmissionInput):Promise<string[]>}
export function wardCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function normalizeWardRow(value:unknown,policy:WardStage['timePolicy']){wardCheck(WardRowSchema,value);const row=structuredClone(value) as WardRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const time=(value:string)=>{if(policy==='SOURCE_PLUS08_TO_LOCAL'){if(!value.endsWith('+08:00'))throw new Error('LOCAL_TIME_REQUIRED');value=value.slice(0,-6);}return localTime(value);};const from=time(row.valid_from),to=row.valid_to?time(row.valid_to):null;if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:time(row.recorded_at)};}
