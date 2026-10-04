import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema,type CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
const closed={additionalProperties:false} as const;
export const NursingId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const required=(maxLength=2000)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
const text=(maxLength=2000)=>Type.String({maxLength});
export const NursingTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const NursingHead=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
export const NursingRowSchema=Type.Object({nursing_unit_id:required(64),nursing_code:required(256),nursing_name:required(160),campus_id:NursingId,managing_org_id:NursingId,care_level:text(256),office_phone:text(256),version_no:Type.String({pattern:'^[1-9][0-9]{0,9}$'}),valid_from:required(40),valid_to:text(40),record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),source_system_id:NursingId,source_record_id:required(256),approval_ref:text(),recorded_at:required(40)},closed);
export type NursingRow=Static<typeof NursingRowSchema>;
export const ORG09_FIELDS=Object.keys(NursingRowSchema.properties) as Array<keyof NursingRow>;
export const NursingTargetSchema=Type.Object({owner:Type.Literal('care-organization/nursing'),id:NursingId,expectedHead:NursingHead},closed);
const Common={row:NursingRowSchema,reason:required(),evidenceId:NursingId};
const Binding={department:Type.Object({owner:Type.Literal('department-master'),id:NursingId},closed),campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:NursingId},closed)};
export const NursingBindingSchema=Type.Object(Binding,closed);
export type NursingBindingInput=Static<typeof NursingBindingSchema>;
export const NursingEntrySchema=Type.Union([Type.Object({...Common,action:Type.Literal('CREATE'),binding:NursingBindingSchema},closed),Type.Object({...Common,action:Type.Literal('REBIND'),target:NursingTargetSchema,binding:NursingBindingSchema},closed),Type.Object({...Common,action:Type.Enum(['REVISE','SUSPEND']),target:NursingTargetSchema},closed)]);
export type NursingEntry=Static<typeof NursingEntrySchema>;
export const NursingStageSchema=Type.Object({requestId:NursingId,jobId:NursingId,revisionId:NursingId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL']),entries:Type.Array(NursingEntrySchema,{minItems:1,maxItems:100})},closed);
export const NursingStoredStageSchema=Type.Object({...NursingStageSchema.properties,sourceArtifactId:Type.Optional(NursingId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type NursingStage=Static<typeof NursingStageSchema>;
export type NursingStoredStage=Static<typeof NursingStoredStageSchema>;
export const NursingVerifySchema=Type.Object({requestId:NursingId,inputId:NursingId,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),reason:required(),policyVersion:Type.Literal('ORG09_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:NursingId,classificationAccepted:Type.Boolean()},closed),{minItems:1,maxItems:100})},closed);
export type NursingVerification=Static<typeof NursingVerifySchema>;
export const NursingInputSchema=Type.Object({inputId:NursingId},closed);
export const NursingPlanSchema=Type.Object({inputId:NursingId,requestId:NursingId},closed);
export const NursingReadSchema=Type.Object({id:NursingId,businessAt:Type.Optional(NursingTime),recordAsOf:Type.Optional(NursingTime)},closed);
export const NursingHistorySchema=Type.Object({id:NursingId,recordAsOf:Type.Optional(NursingTime)},closed);
export const NursingExactSchema=Type.Object({...NursingHistorySchema.properties,version:NursingHead},closed);
export const NursingDiffSchema=Type.Object({id:NursingId,fromVersion:NursingHead,toVersion:NursingHead},closed);
export const NursingWindowSchema=Type.Object({id:NursingId,validFrom:NursingTime,validTo:Type.Union([NursingTime,Type.Null()]),recordAsOf:Type.Optional(NursingTime)},closed);
export const NursingListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(NursingId),departmentId:Type.Optional(NursingId),after:Type.Optional(NursingId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(NursingTime),recordAsOf:Type.Optional(NursingTime)},closed);
export const NursingReceiveSchema=Type.Object({requestId:NursingId,fileRequestId:NursingId,job:ImportJobCommandSchema,campus:NursingStageSchema.properties.campus,timePolicy:NursingStageSchema.properties.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(NursingEntrySchema.anyOf[0],['row']),Type.Omit(NursingEntrySchema.anyOf[1],['row']),Type.Omit(NursingEntrySchema.anyOf[2],['row'])]),{minItems:1,maxItems:100})},closed);
export type NursingReceive=Static<typeof NursingReceiveSchema>;
export interface NursingFacts {nursingCode:string;nursingName:string;careLevel:string|null;officePhone:string|null;responsibilityStatus:'PENDING';source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string};contractVersionId:string;managementBasis:unknown}
export interface NursingVersion {id:string;number:string;action:'CREATE'|'REVISE'|'REBIND'|'SUSPEND';validFrom:string;validTo:string|null;recordedAt:string;facts:NursingFacts;reason:string;changeId:string}
export interface NursingBindingVersion {id:string;number:string;validFrom:string;validTo:string|null;recordedAt:string;binding:NursingBindingInput;dependencies:unknown;changeId:string}
export interface NursingBindingHistory {id:string;campusId:string;managingDepartmentId:string;scope:'NORTH'|'SOUTH';versions:NursingBindingVersion[]}
export interface NursingHistory {id:string;departmentId:string;versions:NursingVersion[];bindings:NursingBindingHistory[];codes:string[]}
export interface NursingWrite {key:string;targetId:string|null;expectedHead:string|null;action:NursingVersion['action'];validFrom:string;validTo:string|null;facts:NursingFacts;binding:NursingBindingInput|null;bindingChanges:Array<{id:string|null;expectedHead:string|null;validFrom:string;validTo:string|null;binding:NursingBindingInput;dependencies:unknown}>;reason:string;sourceRow:number;scope:'NORTH'|'SOUTH'}
export interface NursingIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface NursingAdmissionInput extends NursingBindingInput {validFrom:string;validTo:string|null;recordAsOf?:string}
export interface NursingUpstreamPorts {admit(scope:CatalogTransactionScope,actor:string,input:NursingAdmissionInput):Promise<unknown>;referenceAccess(scope:CatalogTransactionScope,actor:string,input:NursingBindingInput):Promise<{scope:'NORTH'|'SOUTH'}>}
export function nursingCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function normalizeNursingRow(value:unknown,policy:NursingStage['timePolicy']){nursingCheck(NursingRowSchema,value);const row=structuredClone(value) as NursingRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const time=(value:string)=>{if(policy==='SOURCE_PLUS08_TO_LOCAL'){if(!value.endsWith('+08:00'))throw new Error('LOCAL_TIME_REQUIRED');value=value.slice(0,-6);}return localTime(value);};const from=time(row.valid_from),to=row.valid_to?time(row.valid_to):null;if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:time(row.recorded_at)};}
