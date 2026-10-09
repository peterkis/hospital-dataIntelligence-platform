import {localTime,subtract,intersect} from '../organization-master/index.js';
import {careUnavailable,careState} from './care-lifecycle-time.js';
import type {WardHistory,WardVersion,WardBindingHistory} from './ward-contracts.js';
export const knownWard=(h:WardHistory,asOf?:string):WardHistory=>({...h,versions:h.versions.filter(v=>!asOf||v.recordedAt<=localTime(asOf)),bindings:h.bindings.map(b=>({...b,versions:b.versions.filter(v=>!asOf||v.recordedAt<=localTime(asOf))})).filter(b=>b.versions.length>0)});
export function wardContentAt(h:WardHistory,at:string):WardVersion|null{at=localTime(at);const latest=h.versions.filter(v=>(v.action==='CREATE'||v.action==='REVISE')&&v.validFrom<=at).at(-1);return latest&&(latest.validTo===null||at<latest.validTo)?latest:null;}
export function wardAt(h:WardHistory,at:string):WardVersion|null{return careState(h.versions,at)==='ACTIVE'?wardContentAt(h,at):null;}
export function wardPeriods(h:WardHistory){return h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').flatMap(v=>subtract({from:v.validFrom,to:v.validTo},[...h.versions.filter(l=>(l.action==='CREATE'||l.action==='REVISE')&&BigInt(l.number)>BigInt(v.number)).map(l=>({from:l.validFrom,to:null})),...careUnavailable(h.versions)]).map(p=>({...p,version:v})));}
export const bindingHead=(b:WardBindingHistory)=>b.versions.at(-1)!;
export function bindingPeriods(h:WardHistory){const core=wardPeriods(h);return h.bindings.flatMap(binding=>{const v=bindingHead(binding);return core.flatMap(p=>intersect({from:v.validFrom,to:v.validTo},p).map(span=>({...span,binding})));});}
export function declaredBindingAt(h:WardHistory,at:string){at=localTime(at);if(careState(h.versions,at)==='CLOSED')return null;const found=h.bindings.filter(b=>{const v=bindingHead(b);return v.validFrom<=at&&(v.validTo===null||at<v.validTo);});if(found.length>1)throw new Error('WARD_BINDING_CONFLICT');return found[0]??null;}
export function bindingAt(h:WardHistory,at:string){at=localTime(at);const found=bindingPeriods(h).filter(p=>p.from<=at&&(p.to===null||at<p.to)).map(p=>p.binding);if(found.length>1)throw new Error('WARD_BINDING_CONFLICT');return found[0]??null;}
