import type {CatalogTransactionScope} from '../governance-catalog/index.js';
import type {LifecyclePorts,LifecycleStage} from './lifecycle-contracts.js';
import type {ScopeRevisionProjection} from './ward-nursing-contracts.js';
import {withLifecycleMembers,withLifecycleScopeProposals} from './lifecycle-planning.js';
import {withLifecycleCareInputs} from './lifecycle-care-inputs.js';

/** The existing P3-11 proposal capabilities, scoped to one transaction executor. */
export async function withCareCandidateContext<T>(s:CatalogTransactionScope,actor:string,members:LifecycleStage['members'],ports:LifecyclePorts,work:(ordered:LifecycleStage['members'])=>Promise<T>):Promise<T>{
 return withLifecycleMembers(s,members.map(m=>m.inputId),async()=>{
  const projections:ScopeRevisionProjection[]=[];
  for(const member of [...members].sort((a,b)=>a.inputId.localeCompare(b.inputId))){const projection=await ports[member.owner]?.lifecycleScopeProjectionInTransaction?.(s,actor,member.inputId);if(projection)projections.push(projection);}
  const rank=(member:LifecycleStage['members'][number])=>{const base=['UNIT','NURSING','WARD'].indexOf(member.owner);return base>=0?base:projections.some(p=>p.basis.inputId===member.inputId)?3:member.owner==='LOCATION'?4:5;};
  const ordered=[...members].sort((a,b)=>rank(a)-rank(b)||(a.owner+'/'+a.inputId).localeCompare(b.owner+'/'+b.inputId));
  const location=ports.LOCATION?.lifecycleWithInputsInTransaction??(async<R>(_scope:CatalogTransactionScope,callback:()=>Promise<R>)=>callback());
  return location(s,()=>withLifecycleScopeProposals(s,projections,()=>withLifecycleCareInputs(s,()=>work(ordered))));
 });
}
