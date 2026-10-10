import {Type,type Static,type TSchema} from 'typebox';
import {UnitId,UnitReceiveSchema} from './contracts.js';
import {NursingReceiveSchema} from './nursing-contracts.js';
import {WardReceiveSchema} from './ward-contracts.js';
import {UnitWardReceiveSchema} from './unit-ward-contracts.js';
import {WardNursingReceiveSchema} from './ward-nursing-contracts.js';
import {CapabilityReceiveSchema} from './capability-contracts.js';
import {SubjectReceiveSchema} from './subject-permission-contracts.js';
import {LocationReceiveSchema,LocationUseReceiveSchema} from '../location-master/index.js';
const closed={additionalProperties:false} as const;
export const CareFileBytesSchema=Type.String({minLength:4,maxLength:1398104,pattern:'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$'});
export const careFileSchemas={UNIT:UnitReceiveSchema,NURSING:NursingReceiveSchema,WARD:WardReceiveSchema,UNIT_WARD:UnitWardReceiveSchema,WARD_NURSING:WardNursingReceiveSchema,CAPABILITY:CapabilityReceiveSchema,PERMISSION:SubjectReceiveSchema,LOCATION:LocationReceiveSchema,LOCATION_USE:LocationUseReceiveSchema} as const;
/** Editing may omit required values; filled types, vocabulary and maxima stay closed. */
const partialFile=(value:unknown):unknown=>Array.isArray(value)?value.map(partialFile):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>key!=='required'&&key!=='minItems').map(([key,value])=>[key,partialFile(value)])):value;
const fileEditing=(schema:TSchema)=>Type.Unsafe<Record<string,unknown>>(partialFile(schema) as TSchema);
export const careFileEditingSchemas={UNIT:fileEditing(UnitReceiveSchema),NURSING:fileEditing(NursingReceiveSchema),WARD:fileEditing(WardReceiveSchema),UNIT_WARD:fileEditing(UnitWardReceiveSchema),WARD_NURSING:fileEditing(WardNursingReceiveSchema),CAPABILITY:fileEditing(CapabilityReceiveSchema),PERMISSION:fileEditing(SubjectReceiveSchema),LOCATION:fileEditing(LocationReceiveSchema),LOCATION_USE:fileEditing(LocationUseReceiveSchema)} as const;
export const CareFileEditingBytesSchema=Type.Union([CareFileBytesSchema,Type.Literal('')]);
export const CareFileReceiptSchema=Type.Object({jobId:UnitId,revisionId:UnitId,sourceArtifactId:UnitId,structuralStatus:Type.Enum(['PARSED','REJECTED']),input:Type.Union([Type.Object({inputId:UnitId,revisionId:UnitId,digest:Type.String({pattern:'^[a-f0-9]{64}$'})},closed),Type.Null()]),issues:Type.Array(Type.Object({row:Type.Integer(),field:Type.String(),code:Type.String(),status:Type.Enum(['FAIL','BLOCKED'])},closed)),worksheet:Type.Union([Type.String(),Type.Null()])},closed);
export type CareFileReceipt=Static<typeof CareFileReceiptSchema>;
export interface CareSavedFile {requestId:string;body:{input:Record<string,unknown>;contentBase64:string}}
export const CareSavedFileResultSchema=Type.Union(Object.entries(careFileEditingSchemas).map(([kind,input])=>Type.Object({id:UnitId,version:Type.String({pattern:'^[1-9][0-9]*$'}),kind:Type.Literal(kind),campus:Type.Enum(['NORTH','SOUTH']),file:Type.Object({requestId:UnitId,body:Type.Object({input,contentBase64:CareFileEditingBytesSchema},closed)},closed)},closed)));
