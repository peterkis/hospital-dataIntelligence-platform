import type {CatalogTransactionScope,ApplyOwnerPort} from '../governance-catalog/index.js';
import {covered,localTime} from '../organization-master/index.js';
import type {LifecycleReference} from './lifecycle-contracts.js';
import type {UnitBindingInput} from './contracts.js';
import {careCandidateInputIds} from './candidate-peers.js';

export interface LifecycleCareInputBasis {
 kind:'LIFECYCLE_CARE_INPUT';owner:'UNIT'|'NURSING'|'WARD';inputId:string;revisionId:string;digest:string;contractVersionId:string;
 id:string;version:string;campusId:string;producerValidFrom:string;producerValidTo:string|null;validFrom:string;validTo:string|null;managerId:string|null;
}
type Write={targetId:string|null;expectedHead:string|null;action:string;validFrom:string;validTo:string|null;binding?:{campus:{id:string};unit?:{id:string};department?:{id:string}}|null};
const inputs=new WeakMap<CatalogTransactionScope,Map<string,LifecycleCareInputBasis>>();
const bindings=new WeakMap<CatalogTransactionScope,Map<string,Write['binding']>>();
export async function withLifecycleCareInputs<T>(s:CatalogTransactionScope,work:()=>Promise<T>):Promise<T>{const previous=inputs.get(s),priorBindings=bindings.get(s);inputs.set(s,new Map());bindings.set(s,new Map());try{return await work();}finally{if(previous)inputs.set(s,previous);else inputs.delete(s);if(priorBindings)bindings.set(s,priorBindings);else bindings.delete(s);}}
export function registerLifecycleCareInputs(s:CatalogTransactionScope,owner:LifecycleCareInputBasis['owner'],reference:LifecycleReference,commands:Parameters<ApplyOwnerPort['validate']>[2]['commands']){
 const cache=inputs.get(s);if(!cache)throw new Error('INVALID_PLAN_TOKEN');
 for(const command of commands.filter(c=>c.value['writes']))for(const w of JSON.parse(command.value['writes']!) as Write[]){
  if(!['REBIND','RESUME'].includes(w.action)||!w.targetId||!w.expectedHead||!w.binding)continue;
  const key=owner+'/'+w.targetId;if(cache.has(key))throw new Error('BATCH_CONFLICT');bindings.get(s)!.set(key,w.binding);
  cache.set(key,{kind:'LIFECYCLE_CARE_INPUT',owner,inputId:reference.inputId,revisionId:reference.revisionId,digest:reference.digest,contractVersionId:reference.contractVersionId,id:w.targetId,version:String(BigInt(w.expectedHead)+1n),campusId:w.binding.campus.id,producerValidFrom:w.validFrom,producerValidTo:w.validTo,validFrom:w.validFrom,validTo:w.validTo,managerId:w.binding.unit?.id??null});
 }
}
export function lifecycleCareBinding(s:CatalogTransactionScope,owner:LifecycleCareInputBasis['owner'],id:string){return bindings.get(s)?.get(owner+'/'+id)??null;}
export function lifecycleCareProposal(s:CatalogTransactionScope,owner:LifecycleCareInputBasis['owner'],id:string){return inputs.get(s)?.get(owner+'/'+id)??null;}
/** Aggregate cells strictly before a proposal retain the original published basis.
 * P3-11 still uses its original whole-window capability below. */
export function lifecycleCareReadInput(s:CatalogTransactionScope,owner:LifecycleCareInputBasis['owner'],input:{id:string;campusId:string;validFrom:string;validTo:string|null}){
 const value=lifecycleCareProposal(s,owner,input.id);
 if(value&&careCandidateInputIds(s,owner).includes(value.inputId)&&input.validTo!==null&&localTime(input.validTo)<=localTime(value.producerValidFrom))return null;
 return lifecycleCareInput(s,owner,input);
}
export function lifecycleUnitBinding(s:CatalogTransactionScope,id:string){return lifecycleCareBinding(s,'UNIT',id) as UnitBindingInput|null;}
export function lifecycleCareInputReferences(value:unknown):LifecycleCareInputBasis[]{
 if(!value||typeof value!=='object')return [];
 if('kind' in value&&value.kind==='LIFECYCLE_CARE_INPUT')return [value as LifecycleCareInputBasis];
 return Object.values(value).flatMap(lifecycleCareInputReferences);
}
export function lifecycleCareInput(s:CatalogTransactionScope,owner:LifecycleCareInputBasis['owner'],input:{id:string;campusId:string;validFrom:string;validTo:string|null}){
 const value=inputs.get(s)?.get(owner+'/'+input.id);if(!value)return null;
 const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);
 if(value.campusId!==input.campusId||!covered([{from:value.producerValidFrom,to:value.producerValidTo}],from,to))throw new Error('BLOCKED_DEPENDENCY');
 return {...value,validFrom:from,validTo:to};
}
