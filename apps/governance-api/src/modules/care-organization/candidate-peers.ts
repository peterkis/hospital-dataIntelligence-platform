import type {CatalogTransactionScope,ApplyOwnerPort,CareCandidateOwner} from '../governance-catalog/index.js';
type Owner=CareCandidateOwner;
type Unit=Parameters<ApplyOwnerPort['validate']>[2];
interface Peers {ready:boolean;units:Map<Owner,Map<string,Unit>>}
const peers=new WeakMap<CatalogTransactionScope,Peers>();
export function careCandidateInputIds(scope:CatalogTransactionScope,owner:Owner):string[]{const value=peers.get(scope);return value?.ready?[...(value.units.get(owner)?.keys()??[])]:[];}
/** Only original Owner observations enter this request-local capability. No
 * client command, permission, domain algorithm or fact is stored here. */
export async function withCareCandidatePeers<T>(scope:CatalogTransactionScope,work:(register:(owner:Owner,id:string,unit:Unit)=>void,seal:()=>void)=>Promise<T>):Promise<T>{
 const prior=peers.get(scope),value:Peers={ready:false,units:new Map()};peers.set(scope,value);const restore=scope.bindCareCandidateReader({inputIds:owner=>careCandidateInputIds(scope,owner),peerWrites:(owner,id)=>careCandidatePeerWrites(scope,owner,id)});
 try{return await work((owner,id,unit)=>{if(value.ready)throw new Error('INVALID_PLAN_TOKEN');const entries=value.units.get(owner)??new Map<string,Unit>();if(entries.has(id))throw new Error('BATCH_CONFLICT');entries.set(id,unit);value.units.set(owner,entries);},()=>{value.ready=true;});}
 finally{restore();if(prior)peers.set(scope,prior);else peers.delete(scope);}
}
/** Each Owner decodes its own authorized observation, then runs its
 * existing conflict algorithm over the complete projected native group. */
export function careCandidatePeerWrites(scope:CatalogTransactionScope,owner:Owner,inputId:string):string[]{
 const value=peers.get(scope);if(!value?.ready)return [];
 return [...(value.units.get(owner)??[])].filter(([id])=>id!==inputId).flatMap(([,unit])=>unit.commands.flatMap(command=>command.value['writes']?[command.value['writes']]:[]));
}
