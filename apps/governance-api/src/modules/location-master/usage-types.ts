import {sql} from 'kysely';
import {localTime} from '../organization-master/index.js';
import {planBinding,authenticateRegistrationEvidence,type CatalogTransactionScope,type KeyProviderPort} from '../governance-catalog/index.js';
import {useRuntime,useCheck} from './use-runtime.js';
import {UsageTypeCommandSchema,UsageTypeReadSchema,UsageTypeListSchema,UsageTypeMaterialReadSchema,type UsageTypeCommand,type UsageTypeItem,type UsageTypeReference,type UsageTypePermissions,type UsageTypeWindow} from './usage-type-contracts.js';

export function openLocationUsageTypes(connection:string,provider:KeyProviderPort){
 const runtime=useRuntime(connection,provider),{root,material,signed}=runtime;
 const readIn=async(s:CatalogTransactionScope,actor:string,input:{id:string;versionId?:string;businessAt?:string;recordAsOf?:string;history?:boolean}):Promise<UsageTypeItem[]>=>{if(input.recordAsOf)localTime(input.recordAsOf);if(input.businessAt)localTime(input.businessAt);return (await sql<{r:UsageTypeItem[]}>`select location_master.usage_type_read(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).rows[0]!.r;};
 return {
  async command(actor:string,input:UsageTypeCommand){useCheck(UsageTypeCommandSchema,input);input=structuredClone(input);if(input.action==='CREATE'||input.action==='REVISE'){localTime(input.validFrom);if(input.validTo!==null&&localTime(input.validTo)<=localTime(input.validFrom))throw new Error('INVALID_BUSINESS_PERIOD');}
   return root(async s=>{const prior=(await sql<{r:UsageTypeItem|null}>`select location_master.usage_type_replay(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).rows[0]!.r;if(prior)return prior;
    const basis=input.action==='CREATE'||input.action==='REVISE'?input:(await readIn(s,actor,{id:input.target,...('versionId' in input?{versionId:input.versionId}:{})}))[0];if(!basis)throw new Error('NOT_FOUND');
    const materials=[];if(input.action!=='ENABLE'&&input.action!=='DISABLE')for(const id of new Set([basis.evidenceId,...(input.action==='VERIFY'?[input.evidenceId]:input.action==='APPROVE'&&'verification' in basis&&basis.verification?[basis.verification.evidenceId]:[])]))materials.push(await material(s,actor,id,basis.sourceVersionId));
    return signed<UsageTypeItem>(s,actor,'usage_type_command',{command:input,materialDigest:planBinding(provider,'LOCATION_USAGE_TYPE_MATERIALS_V1',materials)});
   });
  },
  async read(actor:string,input:{id:string;versionId?:string;businessAt?:string;recordAsOf?:string}){useCheck(UsageTypeReadSchema,input);return root(async s=>{const result=(await readIn(s,actor,input))[0];if(!result)throw new Error('NOT_FOUND');return result;});},
  async history(actor:string,input:{id:string;businessAt?:string;recordAsOf?:string}){useCheck(UsageTypeReadSchema,input);return root(s=>readIn(s,actor,{...input,history:true}));},
  async list(actor:string,input:{after?:string;limit?:number;businessAt?:string;recordAsOf?:string}={}){useCheck(UsageTypeListSchema,input);return root(async s=>(await sql<{r:{items:UsageTypeItem[];nextAfterId:string|null}}>`select location_master.usage_type_list(${actor},${JSON.stringify(input)}::jsonb) r`.execute(s)).rows[0]!.r);},
  async permissions(actor:string){return root(async s=>(await sql<{r:UsageTypePermissions}>`select location_master.usage_type_permissions(${actor}) r`.execute(s)).rows[0]!.r);},
  async readMaterial(actor:string,input:{id:string;sourceVersionId:string}){useCheck(UsageTypeMaterialReadSchema,input);return root(async s=>{await sql`select location_master.usage_type_authorize(${actor},'READ')`.execute(s);const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${input.id}::uuid,${input.sourceVersionId}::uuid,'NORTH') r`.execute(s)).rows[0]!.r,bytes=authenticateRegistrationEvidence(proof,provider);try{return {id:input.id,bytesBase64:bytes.toString('base64')};}finally{bytes.fill(0);}});},
  async referenceInTransaction(s:CatalogTransactionScope,actor:string,pin:UsageTypeReference,recordAsOf?:string){const result=(await readIn(s,actor,{id:pin.id,versionId:pin.versionId,...(recordAsOf?{recordAsOf}:{})}))[0];if(!result||result.version!==pin.version||result.status!=='APPROVED')throw new Error('BLOCKED_DEPENDENCY');return result;},
  async requireEnabledInTransaction(s:CatalogTransactionScope,actor:string,pin:UsageTypeReference,recordAsOf:string){await sql`select location_master.usage_type_require_enabled(${actor},${JSON.stringify(pin)}::jsonb,${localTime(recordAsOf)}::timestamp)`.execute(s);},
  async evaluateReferenceWindowInTransaction(s:CatalogTransactionScope,actor:string,pin:UsageTypeReference,input:{validFrom:string;validTo:string|null;recordAsOf:string}){const exact=(await readIn(s,actor,{id:pin.id,versionId:pin.versionId,recordAsOf:input.recordAsOf}))[0];if(!exact||exact.version!==pin.version||exact.status!=='APPROVED')throw new Error('BLOCKED_DEPENDENCY');return (await sql<{r:UsageTypeWindow}>`select location_master.usage_type_window(${actor},${JSON.stringify(pin)}::jsonb,${exact.code},${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;},
  async readReferenceBoundariesInTransaction(s:CatalogTransactionScope,actor:string,pin:UsageTypeReference,input:{validFrom:string;validTo:string|null;recordAsOf:string}){return (await sql<{r:string[]}>`select location_master.usage_type_boundaries(${actor},${JSON.stringify(pin)}::jsonb,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;},
  close:runtime.close,
 };
}
export type LocationUsageTypeOwner=ReturnType<typeof openLocationUsageTypes>;
