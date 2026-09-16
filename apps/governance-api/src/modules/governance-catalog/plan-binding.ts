import {createHmac,timingSafeEqual} from 'node:crypto';
import type {KeyProviderPort} from './protected-artifact.js';

/** Object keys are canonical; array order remains part of the contract. */
export function canonicalPlan(value:unknown):string {
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalPlan).join(',')+']';
 if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
  const object=value as Record<string,unknown>;
  return '{'+Object.keys(object).sort().map(key=>JSON.stringify(key)+':'+canonicalPlan(object[key])).join(',')+'}';
 }
 throw new Error('CLOSED_INPUT_REQUIRED');
}
export function planBinding(provider:KeyProviderPort|undefined,domain:string,value:unknown):string {
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 return createHmac('sha256',provider.lookup()).update(domain+'\0').update(canonicalPlan(value)).digest('hex');
}
export function equalBinding(left:string,right:string):boolean {
 return /^[a-f0-9]{64}$/.test(left)&&/^[a-f0-9]{64}$/.test(right)&&timingSafeEqual(Buffer.from(left,'hex'),Buffer.from(right,'hex'));
}
