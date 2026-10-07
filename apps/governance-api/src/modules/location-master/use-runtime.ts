import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,canonicalPlan,planBinding,authenticateRegistrationEvidence,type KeyProviderPort} from '../governance-catalog/index.js';
import {Check} from 'typebox/value';
export interface UseEnvelope {keyId:string;nonce:string;tag:string;ciphertext:string}
export function useCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
/** Private to the two real Location use writers; never exported by the module. */
export function useRuntime(connection:string,provider:KeyProviderPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:CatalogTransactionScope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const signed=async<T>(s:CatalogTransactionScope,actor:string,operation:'usage_type_command'|'use_mutate',value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{v:string}>`select pg_current_xact_id()::text v`.execute(s)).rows[0]!.v,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'LOCATION_USE_SQL_AUTHORITY_V1',{}),'hex');
  try{const signature=createHmac('sha256',key).update(ticket).digest('hex');return (await (operation==='usage_type_command'?sql<{r:T}>`select location_master.usage_type_command(${ticket},${signature}) r`:sql<{r:T}>`select location_master.use_mutate(${ticket},${signature}) r`).execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const material=async(s:CatalogTransactionScope,actor:string,id:string,sourceVersionId:string,campus='NORTH')=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r,bytes=authenticateRegistrationEvidence(proof,provider);
  try{return {id,digest:planBinding(provider,'LOCATION_USE_MATERIAL_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const seal=(domain:string,value:unknown)=>{const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce),bytes=Buffer.from(canonicalPlan(value));cipher.setAAD(Buffer.from(domain+'\0'+digest));try{const data=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:data.toString('hex')}};}finally{bytes.fill(0);}};
 const unseal=<T>(domain:string,value:{digest:string;envelope:UseEnvelope},schema:unknown):T=>{try{const e=value.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+value.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const v:unknown=JSON.parse(bytes.toString());useCheck(schema,v);if(planBinding(provider,domain,v)!==value.digest)throw new Error('PAYLOAD_UNAVAILABLE');return v as T;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}};
 const recoverable=async<T>(s:CatalogTransactionScope,work:()=>Promise<T>)=>{await sql`savepoint location_use_dependency`.execute(s);try{const result=await work();await sql`release savepoint location_use_dependency`.execute(s);return result;}catch(error){await sql`rollback to savepoint location_use_dependency`.execute(s);await sql`release savepoint location_use_dependency`.execute(s);throw error;}};
 return {db,root,signed,material,seal,unseal,recoverable,close:()=>db.destroy()};
}
