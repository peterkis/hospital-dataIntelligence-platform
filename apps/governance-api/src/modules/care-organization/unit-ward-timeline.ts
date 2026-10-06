import {intersect,covered,localTime} from '../organization-master/index.js';
import type {UnitWardHistory,UnitWardRule} from './unit-ward-contracts.js';
const sharedBoundary=(r:Extract<UnitWardRule,{kind:'SHARED_BOUNDARY'}>)=>JSON.stringify([r.ruleReference,r.ruleVersion,r.evidenceId,[...r.participants].sort(),localTime(r.validFrom),r.validTo===null?null:localTime(r.validTo)]);
export const knownUnitWard=(h:UnitWardHistory,r?:string):UnitWardHistory=>{const at=r?localTime(r):undefined;return {...h,versions:h.versions.filter(v=>!at||v.recordedAt<=at)};};
export const declaration=(h:UnitWardHistory)=>h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1)??null;
export const unitWardEnd=(h:UnitWardHistory)=>h.versions.filter(v=>v.action==='END').map(v=>v.validFrom).sort()[0]??null;
export function unitWardReserved(h:UnitWardHistory){const d=declaration(h);if(!d)return [];const end=unitWardEnd(h),to=d.validTo===null?end:end===null?d.validTo:d.validTo<end?d.validTo:end;return to!==null&&to<=d.validFrom?[]:[{from:d.validFrom,to}];}
export function unitWardState(h:UnitWardHistory,at:string):'ACTIVE'|'ENDED'|'NOT_EFFECTIVE'{const end=unitWardEnd(h);if(end&&at>=end)return 'ENDED';return unitWardReserved(h).some(p=>p.from<=at&&(p.to===null||at<p.to))?'ACTIVE':'NOT_EFFECTIVE';}
// Projected declarations reserve their intervals independently of current parent admission.
export function sharingIssues(all:UnitWardHistory[]):string[]{const issues=new Set<string>();
 for(const h of all){const d=declaration(h)!;if(!d)continue;for(const other of all)if(h.id<other.id&&h.applicability.ward.id===other.applicability.ward.id&&h.applicability.purpose===other.applicability.purpose&&unitWardReserved(h).some(a=>unitWardReserved(other).some(b=>intersect(a,b).length))){if(h.applicability.unit.id===other.applicability.unit.id)issues.add('UNIT_WARD_DUPLICATE_RELATION');if(d.facts.isPrimary&&declaration(other)?.facts.isPrimary)issues.add('UNIT_WARD_PRIMARY_CONFLICT');}
  if(h.applicability.purpose!=='ADMISSION')continue;
  for(const span of unitWardReserved(h)){const peers=all.filter(o=>o.applicability.ward.id===h.applicability.ward.id&&o.applicability.purpose==='ADMISSION'),bounds=[span.from,...peers.flatMap(o=>unitWardReserved(o).flatMap(p=>[p.from,...(p.to?[p.to]:[])])),...(span.to?[span.to]:[])].filter(v=>v>=span.from&&(span.to===null||v<=span.to)).filter((v,i,a)=>a.indexOf(v)===i).sort();
   for(const [i,from] of bounds.entries()){const to=bounds[i+1]??span.to;if(to===from)continue;const active=peers.filter(o=>unitWardState(o,from)==='ACTIVE'),units=new Set(active.map(o=>o.applicability.unit.id));if(units.size<2&&d.facts.relationType!=='共享'&&!d.facts.sharingRule)continue;const rule=d.facts.rule;if(rule.kind!=='SHARED_BOUNDARY'){issues.add('SHARING_REVIEW_REQUIRED');continue;}if(!covered([{from:localTime(rule.validFrom),to:rule.validTo===null?null:localTime(rule.validTo)}],from,to)||[...units].some(id=>!rule.participants.includes(id)))issues.add('SHARING_PARTICIPANTS_NOT_COVERED');if(active.some(o=>{const r=declaration(o)!.facts.rule;return r.kind!=='SHARED_BOUNDARY'||sharedBoundary(r)!==sharedBoundary(rule);} ))issues.add('SHARING_POLICY_CONFLICT');}
  }
 }return [...issues];
}
