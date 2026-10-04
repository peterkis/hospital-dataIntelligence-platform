import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';

const closed={additionalProperties:false} as const;
export const LocationId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
export const LocationTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const text=(maximum=256)=>Type.String({maxLength:maximum});
const required=(maximum=256)=>Type.String({minLength:1,maxLength:maximum,pattern:'\\S'});
const Nullable=Type.Union([LocationTime,Type.Null()]);
export const LocationVersionNo=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
export const LOCATION_TYPES=['CAMPUS','BUILDING','FLOOR','ROOM','CLINIC_ROOM','OPERATING_ROOM','DISPENSING_WINDOW','WAREHOUSE','OTHER'] as const;
export const LocationTypeSchema=Type.Enum(LOCATION_TYPES);
export const LocationStableReferenceSchema=Type.Object({owner:Type.Literal('location-master'),id:LocationId},closed);
export const LocationTargetSchema=Type.Object({...LocationStableReferenceSchema.properties,expectedVersion:LocationVersionNo},closed);
const Parent=Type.Union([Type.Object({kind:Type.Literal('ALIAS'),clientKey:required(64)},closed),Type.Object({kind:Type.Literal('EXISTING'),reference:LocationStableReferenceSchema},closed),Type.Null()]);
export const LocationRowSchema=Type.Object({
 location_id:required(64),location_code:required(256),location_name:required(160),campus_id:LocationId,
 parent_location_id:text(64),location_type:required(64),floor_label:text(),room_number:text(),address_detail:text(),is_accessible:text(64),
 version_no:Type.String({pattern:'^[1-9][0-9]{0,9}$'}),valid_from:required(32),valid_to:text(32),record_status:required(64),
 source_system_id:LocationId,source_record_id:required(),approval_ref:text(2000),recorded_at:required(32),
},closed);
export type LocationRow=Static<typeof LocationRowSchema>;
export const ORG12_FIELDS=Object.keys(LocationRowSchema.properties) as Array<keyof LocationRow>;
const Successor=Type.Object({row:LocationRowSchema,parent:Parent,evidenceId:LocationId},closed);
const Common={reason:required(2000),evidenceId:LocationId,row:LocationRowSchema};
export const LocationEntrySchema=Type.Union([
 Type.Object({...Common,action:Type.Literal('CREATE'),parent:Parent},closed),
 Type.Object({...Common,action:Type.Literal('REVISE'),target:LocationTargetSchema},closed),
 Type.Object({...Common,action:Type.Literal('MOVE_CONTAINMENT'),target:LocationTargetSchema,parent:Parent},closed),
 Type.Object({...Common,action:Type.Literal('CLOSE'),target:LocationTargetSchema},closed),
 Type.Object({...Common,action:Type.Literal('SPLIT'),target:LocationTargetSchema,successors:Type.Array(Successor,{minItems:2,maxItems:99})},closed),
]);
export type LocationEntry=Static<typeof LocationEntrySchema>;
const StageFields={requestId:LocationId,jobId:LocationId,revisionId:LocationId,campus:Type.Enum(['NORTH','SOUTH']),campusId:LocationId,profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Enum(['LOCAL','SOURCE_PLUS08_TO_LOCAL'])};
export const LocationStageSchema=Type.Object({...StageFields,entries:Type.Array(LocationEntrySchema,{minItems:1,maxItems:100})},closed);
export const LocationStoredStageSchema=Type.Object({...LocationStageSchema.properties,sourceArtifactId:Type.Optional(LocationId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed);
export type LocationStage=Static<typeof LocationStageSchema>;
export type LocationStoredStage=Static<typeof LocationStoredStageSchema>;
export const LocationInputSchema=Type.Object({inputId:LocationId},closed);
export const LocationPlanSchema=Type.Object({inputId:LocationId,requestId:LocationId},closed);
export const LocationVerifySchema=Type.Object({requestId:LocationId,inputId:LocationId,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),evidenceId:LocationId,reason:required(2000),physicalFactsAccepted:Type.Boolean(),policyVersion:Type.Literal('ORG12_CORE_V1')},closed);
export type LocationVerification=Static<typeof LocationVerifySchema>;
export const LocationReceiveSchema=Type.Object({requestId:LocationId,fileRequestId:LocationId,job:ImportJobCommandSchema,campus:StageFields.campus,campusId:LocationId,timePolicy:StageFields.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([
 Type.Object({action:Type.Literal('CREATE'),parent:Parent,reason:required(2000),evidenceId:LocationId},closed),
 Type.Object({action:Type.Enum(['REVISE','CLOSE']),target:LocationTargetSchema,reason:required(2000),evidenceId:LocationId},closed),
 Type.Object({action:Type.Literal('MOVE_CONTAINMENT'),target:LocationTargetSchema,parent:Parent,reason:required(2000),evidenceId:LocationId},closed),
 ]),{minItems:1,maxItems:100})},closed);
export type LocationReceive=Static<typeof LocationReceiveSchema>;
export const LocationReadSchema=Type.Object({id:LocationId,businessAt:Type.Optional(LocationTime),recordAsOf:Type.Optional(LocationTime)},closed);
export const LocationHistorySchema=Type.Object({id:LocationId,recordAsOf:Type.Optional(LocationTime)},closed);
export const LocationExactSchema=Type.Object({id:LocationId,version:LocationVersionNo,recordAsOf:Type.Optional(LocationTime)},closed);
export const LocationListSchema=Type.Object({campusId:LocationId,after:Type.Optional(LocationId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(LocationTime),recordAsOf:Type.Optional(LocationTime)},closed);
export const LocationTreeSchema=Type.Object({campusId:LocationId,businessAt:Type.Optional(LocationTime),recordAsOf:Type.Optional(LocationTime)},closed);
export const LocationWindowSchema=Type.Object({id:LocationId,validFrom:LocationTime,validTo:Nullable,recordAsOf:Type.Optional(LocationTime)},closed);
export const LocationDiffSchema=Type.Object({id:LocationId,fromVersion:LocationVersionNo,toVersion:LocationVersionNo},closed);
export interface LocationFacts {locationCode:string;locationName:string;locationType:Static<typeof LocationTypeSchema>;floorLabel:string|null;roomNumber:string|null;addressDetail:string|null;isAccessible:'Y'|'N'|null;parentId:string|null;source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string};contractVersionId:string;dependencyEvidence:unknown}
export interface LocationVersion {id:string;number:string;action:'CREATE'|'REVISE'|'MOVE_CONTAINMENT'|'CLOSE';validFrom:string;validTo:string|null;recordedAt:string;facts:LocationFacts;reason:string;changeId:string|null}
export interface LocationHistory {id:string;campusId:string;scope:'NORTH'|'SOUTH';versions:LocationVersion[];codes:string[]}
export interface LocationIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface LocationWrite {key:string;targetId:string|null;expectedVersion:string|null;action:LocationVersion['action'];validFrom:string;validTo:string|null;facts:LocationFacts;reason:string;sourceRow:number;splitKey:string|null}
export function locationCheck(schema:unknown,value:unknown):void {if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function locationTime(value:string,policy:LocationStage['timePolicy']='LOCAL'):string {
 if(policy==='SOURCE_PLUS08_TO_LOCAL'){if(!value.endsWith('+08:00'))throw new Error('LOCAL_TIME_REQUIRED');value=value.slice(0,-6);}
 return localTime(value);
}
export function normalizeLocationRow(value:unknown,policy:LocationStage['timePolicy']):{row:LocationRow;from:string;to:string|null;sourceRecordedAt:string} {
 locationCheck(LocationRowSchema,value);const row=structuredClone(value) as LocationRow;
 if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');
 const from=locationTime(row.valid_from,policy),to=row.valid_to?locationTime(row.valid_to,policy):null,sourceRecordedAt=locationTime(row.recorded_at,policy);
 if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');
 if(!LOCATION_TYPES.includes(row.location_type as LocationFacts['locationType'])||!['','Y','N'].includes(row.is_accessible))throw new Error('ENUM_INVALID');
 return {row,from,to,sourceRecordedAt};
}
