import {localTime} from '../../organization-master/index.js';

// Record numbers order accepted history; business projections order effective
// points first and use record numbers only to resolve an identical point.
export function orderLifecycleByEffectiveTime<T extends {effective_at:string;number:string}>(events:readonly T[]):T[]{
 return [...events].sort((a,b)=>localTime(a.effective_at.replace(' ','T')).localeCompare(localTime(b.effective_at.replace(' ','T')))||(BigInt(a.number)<BigInt(b.number)?-1:BigInt(a.number)>BigInt(b.number)?1:0));
}
