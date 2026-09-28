import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {localTime} from '../../organization-master/index.js';
import {ImportJobCommandSchema} from '../../governance-catalog/index.js';

const closed={additionalProperties:false} as const;
export const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const text=(maxLength=2000)=>Type.String({maxLength});
const required=(maxLength=2000)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
export const RowSchema=Type.Object({
 org_id:required(64),org_code:required(256),org_name:required(160),org_short_name:text(160),org_type:required(64),
 established_on:text(10),abolished_on:text(10),establishment_doc:text(256),description:text(),is_virtual:Type.Enum(['Y','N']),
 version_no:Type.String({pattern:'^[1-9][0-9]*$'}),valid_from:required(40),valid_to:text(40),record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),
 source_system_id:Id,source_record_id:required(256),approval_ref:text(),recorded_at:required(40),
},closed);
export type ORG04Row=Static<typeof RowSchema>;
export const ORG04_FIELDS=Object.keys(RowSchema.properties) as Array<keyof ORG04Row>;
export const ReferenceSchema=Type.Object({owner:Type.Literal('department-master'),id:Id,expectedVersion:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
// `sourceRow` is parser-owned provenance. It is deliberately absent from the
// public metadata stage entry so callers cannot choose the committed row.
const EntryFields={
 row:RowSchema,intent:Type.Enum(['CREATE','REVISE']),target:Type.Union([ReferenceSchema,Type.Null()]),
 origin:Type.Enum(['NEW','HISTORICAL']),evidenceId:Id,
};
export const EntrySchema=Type.Object(EntryFields,closed);
export const StoredEntrySchema=Type.Object({...EntryFields,sourceRow:Type.Integer({minimum:1,maximum:1048576})},closed);
export const StageSchema=Type.Object({
 requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),
 timePolicy:Type.Enum(['SOURCE_OFFSET_08','LOCAL']),entries:Type.Array(EntrySchema,{minItems:1,maxItems:100}),
 sourceArtifactId:Type.Optional(Id),
},closed);
export type StageInput=Static<typeof StageSchema>;
export const StoredStageSchema=Type.Object({
 requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),
 timePolicy:Type.Enum(['SOURCE_OFFSET_08','LOCAL']),entries:Type.Array(StoredEntrySchema,{minItems:1,maxItems:100}),
 sourceArtifactId:Type.Optional(Id),
},closed);
export type StoredStageInput=Static<typeof StoredStageSchema>;
export const ReceiveSchema=Type.Object({requestId:Id,fileRequestId:Id,job:ImportJobCommandSchema,campus:Type.Enum(['NORTH','SOUTH']),retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),entries:Type.Array(Type.Omit(EntrySchema,['row']),{minItems:1,maxItems:100})},closed);
export type ReceiveInput=Static<typeof ReceiveSchema>;
export const VerifySchema=Type.Object({
 requestId:Id,inputId:Id,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),
 rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),disposition:Type.Enum(['DEPARTMENT','VIEW_GROUP','UNKNOWN']),
  historicalException:Type.Boolean(),reason:required(),evidenceId:Id},closed),{minItems:1,maxItems:100}),
},closed);
export type VerifyInput=Static<typeof VerifySchema>;
export const PlanSchema=Type.Object({inputId:Id,requestId:Id},closed);
export const ReadSchema=Type.Object({id:Id,businessAt:required(26),recordAsOf:Type.Optional(required(26))},closed);
export const CoverageSchema=Type.Object({id:Id,validFrom:required(26),validTo:Type.Union([required(26),Type.Null()]),recordAsOf:Type.Optional(required(26))},closed);
export function check(schema:unknown,input:unknown):void{if(!Check(schema as never,input))throw new Error('CLOSED_INPUT_REQUIRED');}
export function validateORG04(value:unknown):ORG04Row{check(RowSchema,value);const row=structuredClone(value) as ORG04Row;if(Object.values(row).some(v=>v!==v.trim())||BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');return row;}
export function sourceTime(value:string,_policy:StageInput['timePolicy']):string{
 if(!value.includes('T'))throw new Error('LOCAL_TIME_REQUIRED');
 return localTime(value);
}
export function normalizeEntry(entry:StageInput['entries'][number]|StoredStageInput['entries'][number],policy:StageInput['timePolicy']){
 const row=validateORG04(entry.row),validFrom=sourceTime(row.valid_from,policy),validTo=row.valid_to?sourceTime(row.valid_to,policy):null,recordedAt=sourceTime(row.recorded_at,policy);
 if(validTo!==null&&validTo<=validFrom)throw new Error('INVALID_BUSINESS_PERIOD');
 for(const date of [row.established_on,row.abolished_on])if(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('CLOSED_INPUT_REQUIRED');localTime(date+'T00:00:00');}
 if((entry.intent==='CREATE')!==(entry.target===null))throw new Error('CLOSED_INPUT_REQUIRED');
  if(entry.target&&BigInt(entry.target.expectedVersion)>9223372036854775807n)throw new Error('CLOSED_INPUT_REQUIRED');
 return {...entry,row,validFrom,validTo,recordedAt,sourceRow:'sourceRow' in entry?entry.sourceRow:undefined};
}
