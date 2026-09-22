import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {Pool,types} from 'pg';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Check} from 'typebox/value';
import type {DB} from '../../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,canonicalPlan,planBinding,type KeyProviderPort} from '../../governance-catalog/index.js';
import {CampusStageSchema,type CampusStage} from './contracts.js';
export type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
export interface RecordInput {id:string;domain:string;revision:string;digest:string;campus:'NORTH'|'SOUTH';target:string|null;envelope:Envelope;jobId:string;jobRevision:string;currentRevision:string;withdrawn:boolean}
export function check(schema:unknown,value:unknown){if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function campusInput(connectionString:string,provider?:KeyProviderPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:new Pool({connectionString,max:4,options:'-c timezone=Asia/Shanghai',types:{getTypeParser:(oid,format)=>oid===1114?(v:string)=>v:types.getTypeParser(oid,format)}})})});
 const root=<T>(work:(scope:Scope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const record=async(scope:Scope,actor:string,id:string,permission='READ')=>{
  const r=(await sql<{r:RecordInput}>`select organization_master.input_read(${actor},${id}::uuid,${permission}) r`.execute(scope)).rows[0]!.r;
  if(r.domain!=='ORG02')throw new Error('ACCESS_DENIED');return r;
 };
 const unseal=(r:RecordInput):CampusStage=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from('CAMPUS_INPUT_V1\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value=JSON.parse(bytes.toString());check(CampusStageSchema,value);if(planBinding(provider,'CAMPUS_INPUT_V1',value)!==r.digest)throw new Error();return value;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const stageInTransaction=async(scope:Scope,actor:string,input:CampusStage)=>{
  check(CampusStageSchema,input);input=structuredClone(input);if(!provider)throw new Error('KEY_UNAVAILABLE');
  const digest=planBinding(provider,'CAMPUS_INPUT_V1',input),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('CAMPUS_INPUT_V1\0'+digest));const bytes=Buffer.from(canonicalPlan(input));let envelope:Envelope;try{const encrypted=Buffer.concat([cipher.update(bytes),cipher.final()]);envelope={keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:encrypted.toString('hex')};}finally{bytes.fill(0);}
   return (await sql<{r:{inputId:string;revisionId:string}}>`select organization_master.stage(${actor},${JSON.stringify({domain:'ORG02',requestId:input.requestId,jobId:input.jobId,revisionId:input.revisionId,campus:input.campus,target:'target' in input.command?input.command.target.id:null})}::jsonb,${digest},${JSON.stringify(envelope)}::jsonb) r`.execute(scope)).rows[0]!.r;
 };
 const stage=(actor:string,input:CampusStage)=>root(scope=>stageInTransaction(scope,actor,input));
 return {db,root,record,unseal,stage,stageInTransaction};
}
