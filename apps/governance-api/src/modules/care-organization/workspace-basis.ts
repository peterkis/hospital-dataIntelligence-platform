import {createHmac} from 'node:crypto';
import {sql} from 'kysely';
import {Check} from 'typebox/value';
import {CatalogTransactionScope,canonicalPlan,planBinding,sealProtectedPayload,authenticateRegistrationEvidence,type KeyProviderPort} from '../governance-catalog/index.js';
import {CareBasisContentSchema,CareBasisSaveSchema,CareBasisReadSchema,type CareBasisContent} from './workspace-basis-contracts.js';
import type {Static} from 'typebox';
interface Stored {id:string;requestId:string;recordedAt:string;digest:string;metadata:Record<string,unknown>;envelope:Parameters<typeof authenticateRegistrationEvidence>[0]['envelope']}
type Root=<T>(work:(scope:CatalogTransactionScope)=>Promise<T>)=>Promise<T>;
const check=(schema:unknown,value:unknown)=>{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');};
export function careBasisRequests(provider:KeyProviderPort,root:Root,readRoot:Root){
 const record=async(s:CatalogTransactionScope,actor:string,operation:'READ'|'SAVE',input:Record<string,unknown>)=>{const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...input,actor,operation,transaction}),key=Buffer.from(planBinding(provider,'UNIT_SQL_AUTHORITY_V1',{}),'hex');try{const result=(await sql<{r:Stored|null}>`select care_organization.workspace_basis_record(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;await s.protectedReadCompleted();return result;}finally{key.fill(0);}};
 const unseal=(r:Stored)=>{const bytes=authenticateRegistrationEvidence({binding:['CARE_BASIS_REQUEST_V1',r.digest,canonicalPlan(r.metadata)],envelope:r.envelope},provider);try{const content:unknown=JSON.parse(bytes.toString());check(CareBasisContentSchema,content);if(planBinding(provider,'CARE_BASIS_REQUEST_V1',{content,metadata:r.metadata})!==r.digest)throw new Error('PAYLOAD_UNAVAILABLE');return content as CareBasisContent;}finally{bytes.fill(0);}};
 const result=(r:Stored)=>({id:r.id,requestId:r.requestId,recordedAt:r.recordedAt,content:unseal(r)});
 return {
  async saveBasisRequest(actor:string,input:Static<typeof CareBasisSaveSchema>){check(CareBasisSaveSchema,input);input=structuredClone(input);if(input.requestId===input.command.requestId)throw new Error('CLOSED_INPUT_REQUIRED');return root(async s=>{const {requestId,...content}=input,prior=await record(s,actor,'READ',{requestId});let stored:Stored|null;
   if(prior){if(canonicalPlan(unseal(prior))!==canonicalPlan(content))throw new Error('REQUEST_CONFLICT');stored=await record(s,actor,'SAVE',{requestId,metadata:prior.metadata,digest:prior.digest,envelope:prior.envelope});}
   else{const metadata=(await sql<{r:Record<string,unknown>}>`select governance_catalog.workspace_basis_metadata(${actor},${content.operation},${JSON.stringify(content.command)}::jsonb) r`.execute(s)).rows[0]!.r,digest=planBinding(provider,'CARE_BASIS_REQUEST_V1',{content,metadata}),bytes=Buffer.from(canonicalPlan(content));try{stored=await record(s,actor,'SAVE',{requestId,metadata,digest,envelope:sealProtectedPayload(bytes,['CARE_BASIS_REQUEST_V1',digest,canonicalPlan(metadata)],provider)});}finally{bytes.fill(0);}}
   if(!stored)throw new Error('PAYLOAD_UNAVAILABLE');return result(stored);
  });},
  async readBasisRequest(actor:string,input:Static<typeof CareBasisReadSchema>){check(CareBasisReadSchema,input);return readRoot(async s=>{const r=await record(s,actor,'READ',input);return r?result(r):null;});},
 };
}
