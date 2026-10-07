import {canonicalPlan} from '../governance-catalog/index.js';
import {localTime,intersect} from '../organization-master/index.js';
import type {CoverageScope,WardNursingHistory,WardNursingRule} from './ward-nursing-contracts.js';

export const normalizedCoverage=(c:CoverageScope):CoverageScope=>c.kind==='WHOLE_WARD'?c:{...c,partitionIds:[...c.partitionIds].sort()};
export const sameCoverage=(a:CoverageScope,b:CoverageScope)=>canonicalPlan(normalizedCoverage(a))===canonicalPlan(normalizedCoverage(b));
export function coverageIntersects(a:CoverageScope,b:CoverageScope){if(a.kind==='WHOLE_WARD'||b.kind==='WHOLE_WARD')return true;if(a.scopeSetId!==b.scopeSetId||a.version!==b.version)throw new Error('SCOPE_BASIS_MISMATCH');return a.partitionIds.some(id=>b.partitionIds.includes(id));}
export function coverageContains(a:CoverageScope,b:CoverageScope){if(a.kind==='WHOLE_WARD')return true;if(b.kind==='WHOLE_WARD')return false;if(a.scopeSetId!==b.scopeSetId||a.version!==b.version)throw new Error('SCOPE_BASIS_MISMATCH');return b.partitionIds.every(id=>a.partitionIds.includes(id));}
export const knownWardNursing=(h:WardNursingHistory,r?:string):WardNursingHistory=>({...h,versions:h.versions.filter(v=>!r||v.recordedAt<=localTime(r))});
export const declaration=(h:WardNursingHistory)=>h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1)??null;
export type WardNursingHandoverStatus='NOT_COMPLETED'|'NOT_REQUIRED'|'CONFIRMED_SCHEDULED'|'CONFIRMED_EFFECTIVE';
export function wardNursingHandoverStatus(h:WardNursingHistory,b:string,peers:WardNursingHistory[]=[]):WardNursingHandoverStatus{
 const head=h.versions.at(-1),d=declaration(h);
 const confirmation=head?.action==='END'?peers.flatMap(p=>p.versions).find(v=>v.action==='CREATE'&&v.changeId===head.changeId&&v.facts.handover.kind==='CONFIRMED_HANDOVER'&&v.facts.handover.source.id===h.id&&localTime(v.facts.handover.cutover)===head.validFrom)?.facts.handover:d?.facts.handover;
 if(confirmation?.kind==='CONFIRMED_HANDOVER')return localTime(b)<localTime(confirmation.cutover)?'CONFIRMED_SCHEDULED':'CONFIRMED_EFFECTIVE';
 return head?.action==='END'?'NOT_COMPLETED':'NOT_REQUIRED';
}
export const wardNursingEnd=(h:WardNursingHistory)=>h.versions.filter(v=>v.action==='END').map(v=>v.validFrom).sort()[0]??null;
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
