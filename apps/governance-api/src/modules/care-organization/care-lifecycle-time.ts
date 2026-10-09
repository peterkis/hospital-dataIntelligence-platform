import {localTime,subtract,intersect} from '../organization-master/index.js';

interface CareEvent {number:string;action:string;validFrom:string;validTo:string|null}
export function careClosePoint(versions:readonly CareEvent[],at?:string):string|null{
 const point=at===undefined?undefined:localTime(at);
 return versions.filter(v=>v.action==='CLOSE').map(v=>localTime(v.validFrom)).filter(from=>point===undefined||from<=point).sort()[0]??null;
}
export function careUnavailable(versions:readonly CareEvent[]):Array<{from:string;to:string|null}>{
 const suspended=versions.filter(v=>v.action==='SUSPEND').flatMap(v=>subtract(
  {from:localTime(v.validFrom),to:null},
  versions.filter(r=>r.action==='RESUME'&&BigInt(r.number)>BigInt(v.number)).map(r=>({from:localTime(r.validFrom),to:r.validTo===null?null:localTime(r.validTo)})),
 ));
 const close=careClosePoint(versions);
 return [...suspended,...(close?[{from:close,to:null}]:[])];
}
export function careState(versions:readonly CareEvent[],at:string):'ACTIVE'|'SUSPENDED'|'CLOSED'{
 at=localTime(at);
 if(careClosePoint(versions,at)!==null)return 'CLOSED';
 return careUnavailable(versions).some(p=>p.from<=at&&(p.to===null||at<p.to))?'SUSPENDED':'ACTIVE';
}
export function careWindowOpen(versions:readonly CareEvent[],from:string,to:string|null):boolean{
 return !careUnavailable(versions).some(p=>intersect(p,{from:localTime(from),to:to===null?null:localTime(to)}).length>0);
}
