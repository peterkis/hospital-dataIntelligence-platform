import type {CatalogTransactionScope} from '../governance-catalog/index.js';
import type {ScopeRevisionProjection} from './ward-nursing-contracts.js';
// A planning capability only permits the Ward Owner to evaluate a staged
// cross-campus command. Its SQL writer still requires the exact signed root.
const members=new WeakMap<CatalogTransactionScope,ReadonlySet<string>>();
export const isLifecycleMember=(scope:CatalogTransactionScope,inputId:string)=>members.get(scope)?.has(inputId)??false;
export async function withLifecycleMembers<T>(scope:CatalogTransactionScope,inputIds:readonly string[],work:()=>Promise<T>):Promise<T>{const previous=members.get(scope);members.set(scope,new Set(inputIds));try{return await work();}finally{if(previous)members.set(scope,previous);else members.delete(scope);}}
const proposals=new WeakMap<CatalogTransactionScope,readonly ScopeRevisionProjection[]>();
export const lifecycleScopeProposal=(scope:CatalogTransactionScope,id:string,version:string)=>proposals.get(scope)?.find(p=>p.basis.scopeSetId===id&&p.basis.version===version);
export async function withLifecycleScopeProposals<T>(scope:CatalogTransactionScope,values:readonly ScopeRevisionProjection[],work:()=>Promise<T>):Promise<T>{const previous=proposals.get(scope);proposals.set(scope,values);try{return await work();}finally{if(previous)proposals.set(scope,previous);else proposals.delete(scope);}}
