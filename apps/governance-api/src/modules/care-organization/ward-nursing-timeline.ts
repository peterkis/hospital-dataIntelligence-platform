import {canonicalPlan} from '../governance-catalog/index.js';
import {localTime,intersect} from '../organization-master/index.js';
import type {CoverageScope,WardNursingHistory,WardNursingRule,NursingHandover} from './ward-nursing-contracts.js';

export const normalizedCoverage=(c:CoverageScope):CoverageScope=>c.kind==='WHOLE_WARD'?c:{...c,partitionIds:[...c.partitionIds].sort()};
export const sameCoverage=(a:CoverageScope,b:CoverageScope)=>canonicalPlan(normalizedCoverage(a))===canonicalPlan(normalizedCoverage(b));
export function coverageIntersects(a:CoverageScope,b:CoverageScope){if(a.kind==='WHOLE_WARD'||b.kind==='WHOLE_WARD')return true;if(a.scopeSetId!==b.scopeSetId||a.version!==b.version)throw new Error('SCOPE_BASIS_MISMATCH');return a.partitionIds.some(id=>b.partitionIds.includes(id));}
export function coverageContains(a:CoverageScope,b:CoverageScope){if(a.kind==='WHOLE_WARD')return true;if(b.kind==='WHOLE_WARD')return false;if(a.scopeSetId!==b.scopeSetId||a.version!==b.version)throw new Error('SCOPE_BASIS_MISMATCH');return b.partitionIds.every(id=>a.partitionIds.includes(id));}
export function partialHandover(h:Extract<NursingHandover,{kind:'CONFIRMED_HANDOVER'}>,original:CoverageScope):boolean{
 const plan=h.partitionPlan;if(!plan)return false;if(!plan.repartition&&plan.successors.length<2)throw new Error('HANDOVER_NOT_CONFIRMED');
 if(!sameCoverage(plan.sourceCoverage,original)||(original.kind!=='PARTITIONS'&&!plan.repartition))throw new Error('HANDOVER_NOT_CONFIRMED');
 const ids:string[]=[],aliases=new Set<string>();
 for(const successor of plan.successors){if(aliases.has(successor.sourceAlias)||successor.coverage.kind!=='PARTITIONS'||(!plan.repartition&&!coverageContains(original,successor.coverage)))throw new Error('HANDOVER_NOT_CONFIRMED');aliases.add(successor.sourceAlias);ids.push(...successor.coverage.partitionIds);}
 if(new Set(ids).size!==ids.length||(!plan.repartition&&(original.kind!=='PARTITIONS'||ids.length!==original.partitionIds.length||!original.partitionIds.every(id=>ids.includes(id)))))throw new Error('HANDOVER_NOT_CONFIRMED');
 if(!plan.successors.some(s=>s.sourceAlias===h.successorSourceAlias&&s.nursing.id===h.successorNursing.id&&sameCoverage(s.coverage,h.coverage)))throw new Error('HANDOVER_NOT_CONFIRMED');
 return true;
}
export const knownWardNursing=(h:WardNursingHistory,r?:string):WardNursingHistory=>({...h,versions:h.versions.filter(v=>!r||v.recordedAt<=localTime(r))});
export const declaration=(h:WardNursingHistory)=>h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1)??null;
export type WardNursingHandoverStatus='NOT_COMPLETED'|'NOT_REQUIRED'|'CONFIRMED_SCHEDULED'|'CONFIRMED_EFFECTIVE';
export function confirmedWardNursingHandover(h:WardNursingHistory,peers:WardNursingHistory[]){
 return h.versions.flatMap((end,index)=>{
     const previous=h.versions[index-1];if(end.action!=='END'||!previous)return [];
     const successors=peers.flatMap(p=>p.versions.flatMap(v=>{
      const handover=v.facts.handover;
      if(v.action!=='CREATE'||v.changeId!==end.changeId||handover.kind!=='CONFIRMED_HANDOVER'||!handover.confirmed||handover.source.id!==h.id||handover.source.expectedHead!==previous.number||localTime(handover.cutover)!==end.validFrom||v.validFrom!==end.validFrom||handover.successorNursing.id!==p.applicability.nursing.id||handover.successorSourceAlias!==v.facts.source.sourceAlias||!sameCoverage(handover.coverage,v.facts.coverageScope))return [];
      return [{id:p.id,versionId:v.id,version:v.number,nursing:p.applicability.nursing,coverage:v.facts.coverageScope,sourceAlias:v.facts.source.sourceAlias,handover}];
     }));
     const plan=successors[0]?.handover;if(!plan)return [];
     const complete=plan.partitionPlan
      ?sameCoverage(plan.partitionPlan.sourceCoverage,end.facts.coverageScope)&&successors.length===plan.partitionPlan.successors.length&&successors.every(v=>canonicalPlan(v.handover.partitionPlan)===canonicalPlan(plan.partitionPlan))&&plan.partitionPlan.successors.every(expected=>successors.filter(v=>v.sourceAlias===expected.sourceAlias&&v.nursing.id===expected.nursing.id&&sameCoverage(v.coverage,expected.coverage)).length===1)
      :successors.length===1&&sameCoverage(end.facts.coverageScope,plan.coverage);
     return complete?[{end,successors}]:[];
    }).at(-1);
}
export function wardNursingHandoverStatus(h:WardNursingHistory,b:string,peers:WardNursingHistory[]=[]):WardNursingHandoverStatus{
 const confirmed=confirmedWardNursingHandover(h,peers);
 if(confirmed)return localTime(b)<confirmed.end.validFrom?'CONFIRMED_SCHEDULED':'CONFIRMED_EFFECTIVE';
 if(h.versions.some(v=>v.action==='END'))return 'NOT_COMPLETED';
 const confirmation=declaration(h)?.facts.handover;
 return confirmation?.kind==='CONFIRMED_HANDOVER'?(localTime(b)<localTime(confirmation.cutover)?'CONFIRMED_SCHEDULED':'CONFIRMED_EFFECTIVE'):'NOT_REQUIRED';
}
export const wardNursingEnd=(h:WardNursingHistory)=>h.versions.filter(v=>v.action==='END').map(v=>v.validFrom).sort()[0]??null;
export function wardNursingHandoverEnd(h:WardNursingHistory,cutover:string){
 const d=declaration(h);if(!d)return null;const at=localTime(cutover);
 // An immutable END at this exact cutover already closes the source half. A new
 // independently confirmed successor may complete that boundary. Other accepted
 // ENDs still limit its period; a later cutover cannot fill a historical gap.
 const end=h.versions.filter(v=>v.action==='END'&&localTime(v.validFrom)!==at).map(v=>localTime(v.validFrom)).sort()[0]??null,to=d.validTo===null?null:localTime(d.validTo);
 return to===null?end:end===null?to:to<end?to:end;
}
export function wardNursingReserved(h:WardNursingHistory){const d=declaration(h);if(!d)return [];const end=wardNursingEnd(h),to=d.validTo===null?end:end===null?d.validTo:d.validTo<end?d.validTo:end;return to!==null&&to<=d.validFrom?[]:[{from:d.validFrom,to}];}
export function wardNursingState(h:WardNursingHistory,b:string):'ACTIVE'|'ENDED'|'NOT_EFFECTIVE'{const at=localTime(b),end=wardNursingEnd(h);if(end!==null&&at>=end)return 'ENDED';return wardNursingReserved(h).some(p=>p.from<=at&&(p.to===null||at<p.to))?'ACTIVE':'NOT_EFFECTIVE';}
export function normalizedRule(r:WardNursingRule):WardNursingRule{return r.kind==='SHARED_BOUNDARY'?{...r,coverage:normalizedCoverage(r.coverage),participants:[...r.participants].sort(),validFrom:localTime(r.validFrom),validTo:r.validTo===null?null:localTime(r.validTo)}:r;}
export const sameRule=(a:WardNursingRule,b:WardNursingRule)=>canonicalPlan(normalizedRule(a))===canonicalPlan(normalizedRule(b));
export function sharingIssues(all:WardNursingHistory[]):string[]{
 const issues=new Set<string>();
 for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
  const a=all[i]!,b=all[j]!,av=declaration(a),bv=declaration(b);if(!av||!bv||a.applicability.ward.id!==b.applicability.ward.id)continue;
  if(!wardNursingReserved(a).some(x=>wardNursingReserved(b).some(y=>intersect(x,y).length))||!coverageIntersects(av.facts.coverageScope,bv.facts.coverageScope))continue;
  if(a.applicability.nursing.id===b.applicability.nursing.id)issues.add('WARD_NURSING_DUPLICATE_RELATION');
  if(av.facts.isPrimary&&bv.facts.isPrimary)issues.add('WARD_NURSING_PRIMARY_CONFLICT');
  const ar=av.facts.rule,br=bv.facts.rule;
  if(ar.kind!=='SHARED_BOUNDARY'||br.kind!=='SHARED_BOUNDARY'){issues.add('SHARING_REVIEW_REQUIRED');continue;}
  if(!sameRule(ar,br))issues.add('SHARING_POLICY_CONFLICT');
  if(!ar.participants.includes(a.applicability.nursing.id)||!ar.participants.includes(b.applicability.nursing.id)||!coverageContains(ar.coverage,av.facts.coverageScope)||!coverageContains(ar.coverage,bv.facts.coverageScope))issues.add('SHARING_PARTICIPANTS_NOT_COVERED');
 }
 return [...issues];
}
