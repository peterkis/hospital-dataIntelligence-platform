import type {CatalogTransactionScope,ObservedOwnerUnit} from '../governance-catalog/index.js';
import {localTime,intersect} from '../organization-master/index.js';
import type {LocationWrite,LocationStoredStage} from './contracts.js';

interface Reference {inputId:string;revisionId:string;digest:string;contractVersionId:string}
interface Producer extends Reference {id:string;version:string;campusId:string;producerValidFrom:string;producerValidTo:string|null}
const inputs=new WeakMap<CatalogTransactionScope,Map<string,Producer>>();
/** Prospective native input provenance exists only while the root observes all members. */
export async function withLifecycleLocationInputs<T>(scope:CatalogTransactionScope,work:()=>Promise<T>):Promise<T>{const prior=inputs.get(scope);inputs.set(scope,new Map());try{return await work();}finally{if(prior)inputs.set(scope,prior);else inputs.delete(scope);}}
export function registerLifecycleLocationInputs(scope:CatalogTransactionScope,reference:Reference,unit:ObservedOwnerUnit){
 const cache=inputs.get(scope);if(!cache)throw new Error('INVALID_PLAN_TOKEN');const input=unit.basis['input'] as LocationStoredStage;
 for(const command of unit.commands.filter(c=>c.value['writes']))for(const w of JSON.parse(command.value['writes']!) as LocationWrite[]){
  if(w.action!=='MOVE_CONTAINMENT'||!w.targetId||!w.expectedVersion)continue;if(cache.has(w.targetId))throw new Error('BATCH_CONFLICT');
  cache.set(w.targetId,{inputId:reference.inputId,revisionId:reference.revisionId,digest:reference.digest,contractVersionId:reference.contractVersionId,id:w.targetId,version:String(BigInt(w.expectedVersion)+1n),campusId:input.campusId,producerValidFrom:w.validFrom,producerValidTo:w.validTo});
 }
}
export function lifecycleLocationInput(scope:CatalogTransactionScope,input:{id:string;campusId:string;validFrom:string;validTo:string|null},accepted:unknown){
 const cache=inputs.get(scope);if(!cache?.size)return null;const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo),ids=new Set([input.id]);
 // An ancestor producer affects every room whose accepted graph traverses that ancestor.
 if(accepted&&typeof accepted==='object'&&'parts' in accepted&&Array.isArray(accepted.parts))for(const part of accepted.parts)if(part&&Array.isArray(part.graph))for(const node of part.graph)if(typeof node?.id==='string')ids.add(node.id);
 const producers=[...cache.values()].filter(p=>ids.has(p.id)&&intersect({from:p.producerValidFrom,to:p.producerValidTo},{from,to}).length);
 if(!producers.length)return null;if(producers.some(p=>p.campusId!==input.campusId))throw new Error('LOCATION_CAMPUS_MISMATCH');
 return {kind:'LIFECYCLE_LOCATION_INPUT' as const,id:input.id,campusId:input.campusId,validFrom:from,validTo:to,inputs:producers,prior:accepted};
}
