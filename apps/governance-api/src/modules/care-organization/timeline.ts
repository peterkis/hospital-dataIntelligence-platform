import {localTime,subtract,intersect} from '../organization-master/index.js';
import {careUnavailable,careState} from './care-lifecycle-time.js';
import type {UnitHistory,UnitVersion,UnitBindingHistory} from './contracts.js';
export const knownUnit=(h:UnitHistory,asOf?:string):UnitHistory=>({...h,versions:h.versions.filter(v=>!asOf||v.recordedAt<=localTime(asOf)),bindings:h.bindings.map(b=>({...b,versions:b.versions.filter(v=>!asOf||v.recordedAt<=localTime(asOf))})).filter(b=>b.versions.length>0)});
export function unitContentAt(h:UnitHistory,at:string):UnitVersion|null{at=localTime(at);return h.versions.filter(v=>(v.action==='CREATE'||v.action==='REVISE')&&v.validFrom<=at&&(v.validTo===null||at<v.validTo)).at(-1)??null;}
export function unitAt(h:UnitHistory,at:string):UnitVersion|null{return careState(h.versions,at)==='ACTIVE'?unitContentAt(h,at):null;}
export function unitPeriods(h:UnitHistory){return h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').flatMap(v=>subtract({from:v.validFrom,to:v.validTo},[...h.versions.filter(l=>(l.action==='CREATE'||l.action==='REVISE')&&BigInt(l.number)>BigInt(v.number)).map(l=>({from:l.validFrom,to:l.validTo})),...careUnavailable(h.versions)]).map(p=>({...p,version:v})));}
export const bindingHead=(b:UnitBindingHistory)=>b.versions.at(-1)!;
export function bindingPeriods(h:UnitHistory){const core=unitPeriods(h);return h.bindings.flatMap(binding=>{const v=bindingHead(binding);return core.flatMap(p=>intersect({from:v.validFrom,to:v.validTo},p).map(span=>({...span,binding})));});}
export function declaredBindingAt(h:UnitHistory,at:string){at=localTime(at);if(careState(h.versions,at)==='CLOSED')return null;const found=h.bindings.filter(b=>{const v=bindingHead(b);return v.validFrom<=at&&(v.validTo===null||at<v.validTo);});if(found.length>1)throw new Error('UNIT_BINDING_CONFLICT');return found[0]??null;}
export function bindingAt(h:UnitHistory,at:string){at=localTime(at);const found=bindingPeriods(h).filter(p=>p.from<=at&&(p.to===null||at<p.to)).map(p=>p.binding);if(found.length>1)throw new Error('UNIT_BINDING_CONFLICT');return found[0]??null;}
