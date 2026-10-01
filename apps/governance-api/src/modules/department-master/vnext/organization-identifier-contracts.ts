import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema} from '../../governance-catalog/index.js';
import {localTime} from '../../organization-master/index.js';
import {Id,MAX_EXPECTED_VERSION} from './contracts.js';
const closed={additionalProperties:false} as const;
const text=(maxLength=256)=>Type.String({maxLength});
const required=(maxLength=256)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
export const OrganizationIdentifierRowSchema=Type.Object({
 org_identifier_id:required(64),target_type:required(64),target_id:Id,identifier_kind:required(64),identifier_system:required(),identifier_value:required(),language:text(64),is_preferred:Type.Enum(['Y','N']),
 version_no:Type.String({pattern:'^[1-9][0-9]{0,9}$'}),valid_from:required(26),valid_to:text(26),record_status:required(64),source_system_id:Id,source_record_id:required(),approval_ref:text(2000),recorded_at:required(26),
},closed);
export type ORG23Row=Static<typeof OrganizationIdentifierRowSchema>;
export const ORG23_FIELDS=Object.keys(OrganizationIdentifierRowSchema.properties) as Array<keyof ORG23Row>;
// Finite CORE policies; an adopted name alone cannot introduce new semantics.
export const ORGANIZATION_IDENTIFIER_SCHEMES:Readonly<Record<string,{kind:string;targets:readonly string[];issuer:string}>>=Object.freeze({
 SYNTHETIC_DEPARTMENT_CODE:{kind:'HOSPITAL_CODE',targets:['ORG'],issuer:'SYNTHETIC_ORGANIZATION_PERSONNEL'},
 SYNTHETIC_ALIAS:{kind:'ALIAS',targets:['LEGAL','CAMPUS','ORG'],issuer:'SYNTHETIC_ORGANIZATION_PERSONNEL'},
 SYNTHETIC_FORMER_NAME:{kind:'FORMER_NAME',targets:['LEGAL','CAMPUS','ORG'],issuer:'SYNTHETIC_ORGANIZATION_PERSONNEL'},
 SYNTHETIC_SEARCH_CODE:{kind:'SEARCH_CODE',targets:['LEGAL','CAMPUS','ORG'],issuer:'SYNTHETIC_ORGANIZATION_PERSONNEL'},
});
const Reference=Type.Object({owner:Type.Literal('department-master/organization-identifier'),id:Id,expectedHead:Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19})},closed);
export const OrganizationIdentifierEntrySchema=Type.Object({action:Type.Enum(['REGISTER','CORRECT','END','RETRACT','CHANGE']),identifier:Type.Union([Reference,Type.Null()]),reason:required(2000),evidenceId:Id,row:OrganizationIdentifierRowSchema},closed);
export const OrganizationIdentifierStoredEntrySchema=Type.Object({...OrganizationIdentifierEntrySchema.properties,sourceRow:Type.Integer({minimum:1,maximum:1048576})},closed);
const fields={requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL'])};
export const OrganizationIdentifierStageSchema=Type.Object({...fields,entries:Type.Array(OrganizationIdentifierEntrySchema,{minItems:1,maxItems:100})},closed);
export const OrganizationIdentifierStoredStageSchema=Type.Object({...fields,entries:Type.Array(OrganizationIdentifierStoredEntrySchema,{minItems:1,maxItems:100}),sourceArtifactId:Type.Optional(Id)},closed);
export type OrganizationIdentifierStageInput=Static<typeof OrganizationIdentifierStageSchema>;
export type OrganizationIdentifierStoredStageInput=Static<typeof OrganizationIdentifierStoredStageSchema>;
export type OrganizationIdentifierEntry=Static<typeof OrganizationIdentifierEntrySchema>;
export const OrganizationIdentifierVerifySchema=Type.Object({requestId:Id,inputId:Id,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),reason:required(2000),evidenceId:Id,policyApproved:Type.Boolean()},closed),{minItems:1,maxItems:100})},closed);
export type OrganizationIdentifierVerifyInput=Static<typeof OrganizationIdentifierVerifySchema>;
export const OrganizationIdentifierReceiveSchema=Type.Object({requestId:Id,fileRequestId:Id,job:ImportJobCommandSchema,campus:fields.campus,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),entries:Type.Array(Type.Omit(OrganizationIdentifierEntrySchema,['row']),{minItems:1,maxItems:100})},closed);
export type OrganizationIdentifierReceiveInput=Static<typeof OrganizationIdentifierReceiveSchema>;
export const OrganizationIdentifierResolveSchema=Type.Object({scheme:required(),value:required(),campus:fields.campus,businessAt:required(26),recordAsOf:Type.Optional(required(26))},closed);
export type OrganizationIdentifierResolveInput=Static<typeof OrganizationIdentifierResolveSchema>;
export function identifierCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function validateORG23(value:unknown):ORG23Row{
 identifierCheck(OrganizationIdentifierRowSchema,value);const row=structuredClone(value) as ORG23Row;
 if(Object.values(row).some(v=>v!==v.trim())||BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');return row;
}
export function normalizeIdentifierEntry(entry:OrganizationIdentifierEntry|OrganizationIdentifierStoredStageInput['entries'][number]){
 const row=validateORG23(entry.row),validFrom=localTime(row.valid_from),validTo=row.valid_to?localTime(row.valid_to):null,sourceRecordedAt=localTime(row.recorded_at);
 if(validTo!==null&&validTo<=validFrom)throw new Error('INVALID_BUSINESS_PERIOD');
 if((entry.action==='REGISTER')!==(entry.identifier===null)||entry.identifier&&BigInt(entry.identifier.expectedHead)>MAX_EXPECTED_VERSION)throw new Error('CLOSED_INPUT_REQUIRED');
 return {...entry,row,validFrom,validTo,sourceRecordedAt,sourceRow:'sourceRow' in entry?entry.sourceRow:undefined};
}
