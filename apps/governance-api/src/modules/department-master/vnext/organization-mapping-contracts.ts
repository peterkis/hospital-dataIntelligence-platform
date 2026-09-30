import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema} from '../../governance-catalog/index.js';
import {localTime} from '../../organization-master/index.js';
import {Id,MAX_EXPECTED_VERSION} from './contracts.js';

const closed={additionalProperties:false} as const;
const text=(maxLength=2000)=>Type.String({maxLength});
const required=(maxLength=256)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
export const OrganizationMappingRowSchema=Type.Object({
 org_map_id:required(64),from_system_id:Id,source_entity_type:required(64),source_code:required(),source_name:text(),source_context:required(),
 target_type:required(64),target_id:Id,mapping_relation:required(64),resolution_rule:text(),verified_by:required(),
 version_no:Type.String({pattern:'^[1-9][0-9]{0,9}$'}),valid_from:required(26),valid_to:text(26),record_status:required(64),
 source_system_id:Id,source_record_id:required(),approval_ref:text(),recorded_at:required(26),
},closed);
export type ORG22Row=Static<typeof OrganizationMappingRowSchema>;
export const ORG22_FIELDS=Object.keys(OrganizationMappingRowSchema.properties) as Array<keyof ORG22Row>;
const MappingReference=Type.Object({owner:Type.Literal('department-master/organization-mapping'),id:Id,expectedHead:Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19})},closed);
export const OrganizationMappingEntrySchema=Type.Object({action:Type.Enum(['REGISTER','CORRECT','RETRACT']),mapping:Type.Union([MappingReference,Type.Null()]),reason:required(2000),evidenceId:Id,row:OrganizationMappingRowSchema},closed);
export const OrganizationMappingStoredEntrySchema=Type.Object({...OrganizationMappingEntrySchema.properties,sourceRow:Type.Integer({minimum:1,maximum:1048576})},closed);
const fields={requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL'])};
export const OrganizationMappingStageSchema=Type.Object({...fields,entries:Type.Array(OrganizationMappingEntrySchema,{minItems:1,maxItems:100})},closed);
export const OrganizationMappingStoredStageSchema=Type.Object({...fields,entries:Type.Array(OrganizationMappingStoredEntrySchema,{minItems:1,maxItems:100}),sourceArtifactId:Type.Optional(Id)},closed);
export type OrganizationMappingStageInput=Static<typeof OrganizationMappingStageSchema>;
export type OrganizationMappingStoredStageInput=Static<typeof OrganizationMappingStoredStageSchema>;
export type OrganizationMappingEntry=Static<typeof OrganizationMappingEntrySchema>;
export const OrganizationMappingVerifySchema=Type.Object({requestId:Id,inputId:Id,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),reason:required(2000),evidenceId:Id,contextApproved:Type.Boolean(),sourceKeyReuse:Type.Boolean()},closed),{minItems:1,maxItems:100})},closed);
export type OrganizationMappingVerifyInput=Static<typeof OrganizationMappingVerifySchema>;
export const OrganizationMappingReceiveSchema=Type.Object({requestId:Id,fileRequestId:Id,job:ImportJobCommandSchema,campus:fields.campus,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),entries:Type.Array(Type.Omit(OrganizationMappingEntrySchema,['row']),{minItems:1,maxItems:100})},closed);
export type OrganizationMappingReceiveInput=Static<typeof OrganizationMappingReceiveSchema>;
export const OrganizationMappingResolveSchema=Type.Object({fromSystemId:Id,sourceEntityType:required(64),sourceCode:required(),sourceContext:required(),campus:fields.campus,businessAt:required(26),recordAsOf:Type.Optional(required(26))},closed);
export type OrganizationMappingResolveInput=Static<typeof OrganizationMappingResolveSchema>;
export function mappingCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function validateORG22(value:unknown):ORG22Row{
 mappingCheck(OrganizationMappingRowSchema,value);const row=structuredClone(value) as ORG22Row;
 if(Object.values(row).some(v=>v!==v.trim())||BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');
 return row;
}
export function normalizeMappingEntry(entry:OrganizationMappingEntry|OrganizationMappingStoredStageInput['entries'][number]){
 const row=validateORG22(entry.row),validFrom=localTime(row.valid_from),validTo=row.valid_to?localTime(row.valid_to):null,sourceRecordedAt=localTime(row.recorded_at);
 if(validTo!==null&&validTo<=validFrom)throw new Error('INVALID_BUSINESS_PERIOD');
 if((entry.action==='REGISTER')!==(entry.mapping===null)||entry.mapping&&BigInt(entry.mapping.expectedHead)>MAX_EXPECTED_VERSION)throw new Error('CLOSED_INPUT_REQUIRED');
 return {...entry,row,validFrom,validTo,sourceRecordedAt,sourceRow:'sourceRow' in entry?entry.sourceRow:undefined};
}
