import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {readScopedSource,deferExactReadAuthority} from './source-read-authority.js';
import {CatalogTransactionScope} from './transaction-scope.js';

const closed={additionalProperties:false} as const;
const Id=Type.String({format:'uuid'}),Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'}),End=Type.Union([Time,Type.Null()]);
const Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
export const CAPABILITY_TYPES=['REGISTER','ORDER','EXECUTE','CONSULT','ADMIT','DISPENSE','REPORT'] as const;
export const CAPABILITY_CARE_SETTINGS=['OUTPATIENT','INPATIENT','EMERGENCY','EXAMINATION','DAYCARE','INTERNET'] as const;
export const CapabilityScopeSchema=Type.Object({unit:Type.Object({owner:Type.Literal('care-organization/unit'),id:Id},closed),campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:Id},closed),subject:Type.Object({owner:Type.Literal('organization-master'),id:Id},closed),services:Type.Array(Type.String({minLength:1,maxLength:64}),{minItems:1,maxItems:100,uniqueItems:true}),capabilityType:Type.Enum(CAPABILITY_TYPES),careSetting:Type.Enum(CAPABILITY_CARE_SETTINGS)},closed);
export type CapabilityScope=Static<typeof CapabilityScopeSchema>;
export const ParameterValueSchema=Type.Union([
 Type.Object({type:Type.Literal('TEXT'),value:Type.String({maxLength:256})},closed),
 Type.Object({type:Type.Literal('INTEGER'),value:Type.String({pattern:'^-?(0|[1-9][0-9]*)$',maxLength:256})},closed),
 Type.Object({type:Type.Literal('DECIMAL'),value:Type.String({pattern:'^-?(0|[1-9][0-9]*)(\\.[0-9]+)?$',maxLength:256})},closed),
 Type.Object({type:Type.Literal('BOOLEAN'),value:Type.Boolean()},closed),
]);
const Common={requestId:Id,reason:Text},Revision={definitionVersionId:Id,definitionDigest:Digest,value:ParameterValueSchema,purpose:Type.Enum(['METADATA','BOOLEAN_GATE_V1']),validFrom:Time,validTo:End,evidenceId:Id};
export const ParameterValueCommandSchema=Type.Union([
 Type.Object({...Common,...Revision,action:Type.Literal('CREATE'),applicability:CapabilityScopeSchema},closed),
 Type.Object({...Common,...Revision,action:Type.Literal('REVISE'),target:Id,expectedHead:Type.String({pattern:'^[1-9][0-9]*$'})},closed),
 Type.Object({...Common,action:Type.Literal('APPROVE'),target:Id,versionId:Id,reviewDigest:Digest},closed),
]);
export type ParameterValueCommand=Static<typeof ParameterValueCommandSchema>;
export const ParameterValueReadSchema=Type.Object({id:Id,versionId:Type.Optional(Id),recordAsOf:Type.Optional(Time)},closed);
export const ParameterValueWindowSchema=Type.Object({...ParameterValueReadSchema.properties,validFrom:Time,validTo:End},closed);
export const ParameterValueItemSchema=Type.Object({id:Id,parameterId:Id,versionId:Id,head:Type.String(),definitionVersionId:Id,definitionDigest:Digest,applicability:CapabilityScopeSchema,value:ParameterValueSchema,purpose:Type.Enum(['METADATA','BOOLEAN_GATE_V1']),validFrom:Time,validTo:End,evidenceId:Id,recordedAt:Time,approvedAt:End,status:Type.Enum(['DRAFT','APPROVED']),reviewDigest:Digest},closed);
export type ParameterValueItem=Static<typeof ParameterValueItemSchema>;
export const ParameterValueListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),recordAsOf:Type.Optional(Time)},closed);
export const ParameterValueWindowResultSchema=Type.Object({item:Type.Union([ParameterValueItemSchema,Type.Null()]),covered:Type.Boolean(),currentDefinitionVersionId:Type.Union([Id,Type.Null()]),reason:Type.Enum(['SATISFIED','PARAMETER_NOT_APPROVED','PARAMETER_PERIOD_NOT_COVERED','PARAMETER_ADOPTION_CHANGED'])},closed);
export type ParameterValueWindowResult=Static<typeof ParameterValueWindowResultSchema>;
const check=(schema:unknown,value:unknown)=>{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');};

export function openParameterValues(connection:string){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:CatalogTransactionScope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const read=(s:CatalogTransactionScope,actor:string,input:Static<typeof ParameterValueReadSchema>,history=false)=>(sql<{r:ParameterValueItem[]}>`select governance_catalog.parameter_value_read(${actor},${JSON.stringify(input)}::jsonb,${history}) r`.execute(s)).then(r=>r.rows[0]!.r);
 const evaluate=(s:CatalogTransactionScope,actor:string,input:Static<typeof ParameterValueWindowSchema>)=>(sql<{r:ParameterValueWindowResult}>`select governance_catalog.parameter_value_evaluate(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).then(r=>r.rows[0]!.r);
 return {
  async list(actor:string,input:Static<typeof ParameterValueListSchema>){check(ParameterValueListSchema,input);return root(async s=>(await sql<{r:{items:ParameterValueItem[];nextAfterId:string|null}}>`select governance_catalog.parameter_value_list(${actor},${input.campus},${input.after??null}::uuid,${input.limit??50},coalesce(${input.recordAsOf??null}::timestamp,timezone('Asia/Shanghai',clock_timestamp()))) r`.execute(s)).rows[0]!.r);},
  async command(actor:string,input:ParameterValueCommand){check(ParameterValueCommandSchema,input);return root(async s=>(await sql<{r:ParameterValueItem}>`select governance_catalog.parameter_value_command(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).rows[0]!.r);},
  async read(actor:string,input:Static<typeof ParameterValueReadSchema>){check(ParameterValueReadSchema,input);return root(async s=>{const rows=await read(s,actor,input);if(!rows.length)throw new Error('NOT_FOUND');return rows[0]!;});},
  async history(actor:string,input:Static<typeof ParameterValueReadSchema>){check(ParameterValueReadSchema,input);return root(s=>read(s,actor,input,true));},
  async evaluateWindow(actor:string,input:Static<typeof ParameterValueWindowSchema>){check(ParameterValueWindowSchema,input);return root(s=>evaluate(s,actor,input));},
  async authorizeReferenceInTransaction(s:CatalogTransactionScope,actor:string,id:string,versionId:string){check(Id,id);check(Id,versionId);await read(s,actor,{id,versionId});},
  async evaluateWindowInTransaction(s:CatalogTransactionScope,actor:string,input:Static<typeof ParameterValueWindowSchema>){check(ParameterValueWindowSchema,input);return evaluate(s,actor,input);},
  async readWindowBoundariesInTransaction(s:CatalogTransactionScope,actor:string,input:Static<typeof ParameterValueWindowSchema>&{recordAsOf:string}){check(ParameterValueWindowSchema,input);input=structuredClone(input);const points=(await sql<{r:string[]}>`select governance_catalog.parameter_value_boundaries(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).rows[0]!.r;if(s.recordAsOf){const references=(await sql<{r:unknown}>`select governance_catalog.care_parameter_boundary_references(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).rows[0]!.r;deferExactReadAuthority(s,actor,references,root);}return points;},
  async readSourceWindowBoundariesInTransaction(s:CatalogTransactionScope,actor:string,input:{id:string;validFrom:string;validTo:string|null;recordAsOf:string;sourceKind?:'UNIT_WARD'|'WARD_NURSING'}){
   check(Type.Object({id:Id,validFrom:Time,validTo:End,recordAsOf:Time,sourceKind:Type.Optional(Type.Enum(['UNIT_WARD','WARD_NURSING']))},closed),input);input=structuredClone(input);
   const operation=input.sourceKind==='WARD_NURSING'?'ward_nursing_source_windows':'unit_ward_source_windows',parts=(await readScopedSource(s,actor,{operation,id:input.id,validFrom:input.validFrom,validTo:input.validTo,recordAsOf:input.recordAsOf},root,scope=>(input.sourceKind==='WARD_NURSING'?sql<{r:Array<{from:string;to:string|null}>}>`select governance_catalog.ward_nursing_source_windows(${actor},${input.id}::uuid,${input.validFrom}::timestamp,${input.validTo}::timestamp,${input.recordAsOf}::timestamp) r`:sql<{r:Array<{from:string;to:string|null}>}>`select governance_catalog.unit_ward_source_windows(${actor},${input.id}::uuid,${input.validFrom}::timestamp,${input.validTo}::timestamp,${input.recordAsOf}::timestamp) r`).execute(scope))).rows[0]!.r;
   return parts.flatMap(p=>p.to===null?[p.from]:[p.from,p.to]);
  },
  async close(){await db.destroy();},
 };
}
export type ParameterValueOwner=ReturnType<typeof openParameterValues>;
