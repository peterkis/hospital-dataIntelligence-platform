import type {LocationUseHistory} from './use-contracts.js';
import {localTime,intersect} from '../organization-master/index.js';
export function knownLocationUse(h:LocationUseHistory,r?:string):LocationUseHistory{return {...h,versions:h.versions.filter(v=>r===undefined||v.recordedAt<=localTime(r))};}
export function useDeclaration(h:LocationUseHistory){return h.versions.filter(v=>v.action!=='END').at(-1)??null;}
export function useEnd(h:LocationUseHistory):string|null{return h.versions.filter(v=>v.action==='END').map(v=>v.validFrom).sort()[0]??null;}
export function useReserved(h:LocationUseHistory){const d=useDeclaration(h);if(!d)return [];const end=useEnd(h),to=end===null?d.validTo:d.validTo===null?end:end<d.validTo?end:d.validTo;return to!==null&&to<=d.validFrom?[]:[{from:d.validFrom,to,version:d}];}
export function useAt(h:LocationUseHistory,b:string){return useReserved(h).find(p=>p.from<=b&&(p.to===null||b<p.to))?.version??null;}
export function useConflicts(histories:LocationUseHistory[]):string[]{const errors=new Set<string>();for(let i=0;i<histories.length;i++){const a=histories[i]!,da=useDeclaration(a);for(const b of histories.slice(i+1)){const db=useDeclaration(b);if(!da||!db||!useReserved(a).some(x=>useReserved(b).some(y=>intersect(x,y).length)))continue;
 if(a.applicability.location.id===b.applicability.location.id&&(da.facts.policy.kind==='EXCLUSIVE'||db.facts.policy.kind==='EXCLUSIVE'))errors.add('LOCATION_USE_CONFLICT');
 if(da.facts.isPrimary&&db.facts.isPrimary&&a.applicability.targetType===b.applicability.targetType&&a.applicability.target.id===b.applicability.target.id&&a.applicability.campus.id===b.applicability.campus.id&&a.applicability.usageType.id===b.applicability.usageType.id)errors.add('PRIMARY_LOCATION_CONFLICT');
 } }return [...errors];}
