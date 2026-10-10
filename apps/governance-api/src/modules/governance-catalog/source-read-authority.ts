import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {sql} from 'kysely';
import {CatalogTransactionScope} from './transaction-scope.js';

const time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const SourceReadSchema=Type.Object({operation:Type.Enum(['unit_ward_source_windows','ward_nursing_source_windows','use_source_windows','capability_source_coverage','ward_nursing_source_coverage','unit_ward_source_coverage','ward_source_coverage','nursing_source_coverage','use_source_coverage','location_source_at']),id,validFrom:time,validTo:Type.Union([time,Type.Null()]),recordAsOf:time,expectedVersionId:Type.Optional(Type.Union([id,Type.Null()]))},{additionalProperties:false});
type SourceRead=Static<typeof SourceReadSchema>;
type CurrentReadRoot=<T>(work:(scope:CatalogTransactionScope)=>Promise<T>)=>Promise<T>;

/** Capture authority references in the same snapshot as facts; release checks
 * authorize those exact pins without choosing versions in a newer snapshot. */
export function deferExactReadAuthority(scope:CatalogTransactionScope,actor:string,references:unknown,currentRoot:CurrentReadRoot){
 if(!scope.recordAsOf)return;
 const captured=JSON.stringify(references);
 scope.deferCurrentReadAudit(JSON.stringify(['EXACT_READ_AUTHORITY',actor,captured]),()=>currentRoot(async current=>{await sql`select governance_catalog.care_read_reference_authority(${actor},${captured}::jsonb)`.execute(current);}));
}

/** Original master/physical SQL embeds Source pins in its returned basis.
 * Capture those pins, rather than authorizing a freshly selected Source head. */
export function deferNativeSourceReadAuthority(scope:CatalogTransactionScope,actor:string,basis:unknown,kind:'MASTER'|'LOCATION',currentRoot:CurrentReadRoot){
 if(!scope.recordAsOf)return;
 const parts=(basis as {parts?:Array<{source?:unknown;graph?:Array<{source?:unknown}>}>})?.parts;
 if(!Array.isArray(parts))throw new Error('REFERENCE_INVALID');
 const sources=parts.flatMap(part=>kind==='MASTER'?[part.source]:Array.isArray(part.graph)?part.graph.map(node=>node.source):[undefined]);
 const references=sources.map(source=>{const pin=source as {sourceId?:unknown;versionId?:unknown};if(!pin||!Check(id,pin.sourceId)||!Check(id,pin.versionId))throw new Error('REFERENCE_INVALID');return {kind:'SOURCE',id:pin.sourceId,versionId:pin.versionId};});
 deferExactReadAuthority(scope,actor,references,currentRoot);
}

export async function readScopedSource<T>(scope:CatalogTransactionScope,actor:string,input:SourceRead,currentRoot:CurrentReadRoot,read:(scope:CatalogTransactionScope)=>Promise<T>):Promise<T>{
 if(scope.recordAsOf&&(!Check(SourceReadSchema,input)||input.recordAsOf!==scope.recordAsOf))throw new Error('READ_CONTEXT_REQUIRED');
 const result=await read(scope);
 if(scope.recordAsOf){
  let references:unknown;
  if(input.operation.endsWith('_windows'))references=(await sql<{r:unknown}>`select governance_catalog.care_source_window_references(${actor},${input.id}::uuid,${input.validFrom}::timestamp,${input.validTo}::timestamp,${input.recordAsOf}::timestamp) r`.execute(scope)).rows[0]!.r;
  else{
   // Original coverage queries return one exact source version. No fallback
   // to a current head is permitted when that original result is malformed.
   const pin=(result as {rows?:Array<{r?:{sourceId?:unknown;versionId?:unknown}}>}).rows?.[0]?.r;
   if(!pin||!Check(id,pin.sourceId)||!Check(id,pin.versionId)||pin.sourceId!==input.id)throw new Error('REFERENCE_INVALID');
   references=[{kind:'SOURCE',id:pin.sourceId,versionId:pin.versionId}];
  }
  deferExactReadAuthority(scope,actor,references,currentRoot);
 }
 return result;
}
