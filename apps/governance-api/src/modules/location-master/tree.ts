import {localTime,subtract} from '../organization-master/index.js';
import type {LocationHistory,LocationVersion,LocationFacts} from './contracts.js';

export const LOCATION_PARENT_TYPES:Readonly<Record<LocationFacts['locationType'],readonly LocationFacts['locationType'][]>>={
 CAMPUS:[],BUILDING:['CAMPUS'],FLOOR:['BUILDING'],ROOM:['FLOOR'],CLINIC_ROOM:['FLOOR'],OPERATING_ROOM:['FLOOR'],
 WAREHOUSE:['FLOOR'],DISPENSING_WINDOW:['FLOOR','ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE'],OTHER:[],
};
export function locationAt(history:LocationHistory,businessAt:string,recordAsOf?:string):LocationVersion|null {
 const at=localTime(businessAt),known=history.versions.filter(v=>recordAsOf===undefined||v.recordedAt<=localTime(recordAsOf));
 if(known.some(v=>v.action==='CLOSE'&&v.validFrom<=at))return null;
 return known.filter(v=>v.action!=='CLOSE'&&v.validFrom<=at&&(v.validTo===null||at<v.validTo)).at(-1)??null;
}
export function locationPeriods(history:LocationHistory,recordAsOf?:string):Array<{from:string;to:string|null;version:LocationVersion}> {
 const known=history.versions.filter(v=>recordAsOf===undefined||v.recordedAt<=localTime(recordAsOf)),closed=known.filter(v=>v.action==='CLOSE').map(v=>({from:v.validFrom,to:null}));
 return known.filter(v=>v.action!=='CLOSE').flatMap(v=>subtract({from:v.validFrom,to:v.validTo},[...known.filter(later=>BigInt(later.number)>BigInt(v.number)&&later.action!=='CLOSE').map(later=>({from:later.validFrom,to:later.validTo})),...closed]).map(p=>({...p,version:v}))).sort((a,b)=>a.from.localeCompare(b.from));
}
/** Complete physical graph at every assertion boundary; no point-only admission. */
export function validateLocationTree(histories:readonly LocationHistory[],recordAsOf?:string,window?:{from:string;to:string|null}):void {
 const points=[...new Set([...(window?[window.from]:[]),...histories.flatMap(h=>h.versions.filter(v=>recordAsOf===undefined||v.recordedAt<=localTime(recordAsOf)).flatMap(v=>[v.validFrom,...(v.validTo?[v.validTo]:[])]))])].filter(p=>!window||p>=window.from&&(window.to===null||p<window.to)).sort();
 for(const at of points){
  const active=new Map(histories.flatMap(h=>{const v=locationAt(h,at,recordAsOf);return v?[[h.id,{h,v}] as const]:[];}));
  const roots=new Set<string>();
  for(const [id,{h,v}] of active){
   const parent=v.facts.parentId;
   if(parent!==null&&!active.has(parent))throw new Error('PARENT_PERIOD_NOT_COVERED');
   const visited=new Set([id]);let next=parent;
   while(next!==null){if(visited.has(next))throw new Error('LOCATION_CYCLE');visited.add(next);next=active.get(next)?.v.facts.parentId??null;}
   if(v.facts.locationType==='OTHER')throw new Error('BLOCKED_DEPENDENCY');
   if(v.facts.locationType==='CAMPUS'){
    if(parent!==null)throw new Error('LOCATION_TYPE_INVALID');
    if(roots.has(h.campusId))throw new Error('LOCATION_ROOT_CONFLICT');roots.add(h.campusId);
   }else{
    if(parent===null)throw new Error('PARENT_PERIOD_NOT_COVERED');
    const p=active.get(parent)!;
    if(p.h.campusId!==h.campusId)throw new Error('LOCATION_CAMPUS_MISMATCH');
    if(!LOCATION_PARENT_TYPES[v.facts.locationType].includes(p.v.facts.locationType))throw new Error('LOCATION_TYPE_INVALID');
   }
   if(!['CAMPUS','BUILDING'].includes(v.facts.locationType)&&!v.facts.floorLabel?.trim())throw new Error('FLOOR_LABEL_REQUIRED');
   if(['ROOM','CLINIC_ROOM','OPERATING_ROOM'].includes(v.facts.locationType)&&!v.facts.roomNumber?.trim())throw new Error('ROOM_NUMBER_REQUIRED');
  }
 }
}
