import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {sql} from 'kysely';
import {canonicalPlan,planBinding,type KeyProviderPort} from '../../governance-catalog/index.js';
import {campusInput,check,type Scope} from '../campus/input.js';
import {OperatingStageSchema,kindOf,type OperatingStage} from './contracts.js';
export type {Scope};
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
export interface OperatingInputRecord {id:string;domain:string;revision:string;digest:string;campus:'NORTH'|'SOUTH';target:string|null;envelope:Envelope;subjectId:string;campusId:string;kind:'RELATION'|'SCOPE';action:OperatingStage['command']['action'];jobId:string;jobRevision:string;currentRevision:string;withdrawn:boolean}
export function operatingInput(connectionString:string,provider?:KeyProviderPort){
 const {db,root}=campusInput(connectionString,provider);
 const record=async(scope:Scope,actor:string,id:string,permission='READ')=>{
  const r=(await sql<{r:OperatingInputRecord}>`select organization_master.operating_input_read(${actor},${id}::uuid,${permission}) r`.execute(scope)).rows[0]!.r;
  if(r.domain!=='ORG03')throw new Error('ACCESS_DENIED');return r;
 };
 const unseal=(r:OperatingInputRecord):OperatingStage=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from('OPERATING_INPUT_V1\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value=JSON.parse(bytes.toString());check(OperatingStageSchema,value);if(planBinding(provider,'OPERATING_INPUT_V1',value)!==r.digest)throw new Error();return value;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const stageInTransaction=async(scope:Scope,actor:string,input:OperatingStage)=>{
  check(OperatingStageSchema,input);input=structuredClone(input);if(!provider)throw new Error('KEY_UNAVAILABLE');
  const digest=planBinding(provider,'OPERATING_INPUT_V1',input),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from('OPERATING_INPUT_V1\0'+digest));const bytes=Buffer.from(canonicalPlan(input));let envelope:Envelope;
   try{envelope={keyId:id,nonce:nonce.toString('hex'),ciphertext:Buffer.concat([cipher.update(bytes),cipher.final()]).toString('hex'),tag:cipher.getAuthTag().toString('hex')};}finally{bytes.fill(0);}
   const c=input.command,metadata={requestId:input.requestId,jobId:input.jobId,revisionId:input.revisionId,subjectId:c.subject.id,campusId:c.campus.id,kind:kindOf(c.action),action:c.action,target:'target' in c?c.target.id:null};
   return (await sql<{r:{inputId:string;revisionId:string}}>`select organization_master.operating_stage(${actor},${JSON.stringify(metadata)}::jsonb,${digest},${JSON.stringify(envelope)}::jsonb) r`.execute(scope)).rows[0]!.r;
 };
 const stage=(actor:string,input:OperatingStage)=>root(scope=>stageInTransaction(scope,actor,input));
 return {db,root,record,unseal,stage,stageInTransaction};
}
