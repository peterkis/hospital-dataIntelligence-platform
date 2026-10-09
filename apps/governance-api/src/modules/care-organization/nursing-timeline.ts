import {localTime,subtract,intersect} from '../organization-master/index.js';
import type {NursingHistory,NursingVersion,NursingBindingHistory} from './nursing-contracts.js';
import {careUnavailable,careState} from './care-lifecycle-time.js';
export const knownNursing=(h:NursingHistory,asOf?:string):NursingHistory=>({...h,versions:h.versions.filter(v=>!asOf||v.recordedAt<=localTime(asOf)),bindings:h.bindings.map(b=>({...b,versions:b.versions.filter(v=>!asOf||v.recordedAt<=localTime(asOf))})).filter(b=>b.versions.length>0)});
export function nursingContentAt(h:NursingHistory,at:string):NursingVersion|null{at=localTime(at);return h.versions.filter(v=>(v.action==='CREATE'||v.action==='REVISE')&&v.validFrom<=at&&(v.validTo===null||at<v.validTo)).at(-1)??null;}
export function nursingAt(h:NursingHistory,at:string):NursingVersion|null{return careState(h.versions,at)==='ACTIVE'?nursingContentAt(h,at):null;}
export function nursingPeriods(h:NursingHistory){return h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').flatMap(v=>subtract({from:v.validFrom,to:v.validTo},[...h.versions.filter(l=>(l.action==='CREATE'||l.action==='REVISE')&&BigInt(l.number)>BigInt(v.number)).map(l=>({from:l.validFrom,to:l.validTo})),...careUnavailable(h.versions)]).map(p=>({...p,version:v})));}
export const bindingHead=(b:NursingBindingHistory)=>b.versions.at(-1)!;
export function bindingPeriods(h:NursingHistory){const core=nursingPeriods(h);return h.bindings.flatMap(binding=>{const v=bindingHead(binding);return core.flatMap(p=>intersect({from:v.validFrom,to:v.validTo},p).map(span=>({...span,binding})));});}
export function declaredBindingAt(h:NursingHistory,at:string){at=localTime(at);if(careState(h.versions,at)==='CLOSED')return null;const found=h.bindings.filter(b=>{const v=bindingHead(b);return v.validFrom<=at&&(v.validTo===null||at<v.validTo);});if(found.length>1)throw new Error('NURSING_BINDING_CONFLICT');return found[0]??null;}
export function bindingAt(h:NursingHistory,at:string){at=localTime(at);const found=bindingPeriods(h).filter(p=>p.from<=at&&(p.to===null||at<p.to)).map(p=>p.binding);if(found.length>1)throw new Error('NURSING_BINDING_CONFLICT');return found[0]??null;}
