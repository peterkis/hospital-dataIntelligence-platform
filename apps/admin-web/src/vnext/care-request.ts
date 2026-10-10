import {createCareOperationClient,type CareOperation,type CareOperationInput} from '@hospital-data-intelligence/generated-api-client';
import {departmentValue} from './department-request.js';
import type {FormSchema} from './department-form.js';
import {record} from './care-model.js';
/** Dynamic forms still dispatch only the finite generated operation vocabulary. */
export const careExecute=(actor:string,operation:CareOperation,input:Record<string,unknown>)=>departmentValue(createCareOperationClient(location.origin,actor).call(operation,input as CareOperationInput<typeof operation>));
export function careLocator(values:Record<string,string|null|undefined>){const url=new URL(location.href);for(const [key,value] of Object.entries(values))value?url.searchParams.set(key,value):url.searchParams.delete(key);history.replaceState(null,'',url.pathname+url.search);}
export const careError=(error:unknown)=>error instanceof Error?error.message:'请求未完成，请恢复原请求。';
export function careRequestIds(schema:FormSchema,value:unknown):unknown{
 if(value===null&&schema.anyOf?.some(branch=>branch.type==='null'))return null;
 if(schema.anyOf){const data=record(value),branch=schema.anyOf.find(s=>s.type==='null'?value===null:Object.entries(s.properties??{}).every(([key,p])=>p.const!==undefined?data[key]===p.const:p.enum?data[key]===undefined||p.enum.includes(data[key]):true))??schema.anyOf[0]!;return careRequestIds(branch,value);}
 if(schema.type==='array'&&Array.isArray(value))return value.map(item=>careRequestIds(schema.items!,item));
 if(schema.properties){const data={...record(value)};for(const [key,property] of Object.entries(schema.properties)){if((key==='requestId'||key==='fileRequestId')&&!data[key])data[key]=crypto.randomUUID();else if(key in data)data[key]=careRequestIds(property,data[key]);}return data;}return value;
}
export function newCareRequest(value:unknown):unknown {if(Array.isArray(value))return value.map(newCareRequest);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='requestId'&&key!=='fileRequestId').map(([key,v])=>[key,newCareRequest(v)]));return value;}
export const careMutation=(operation:CareOperation)=>! /^(read|get|query|history|exact|diff|preview|evaluate|list|assess|validate|download)/.test(operation);
export function careFormBranch(schema:FormSchema,value:Record<string,unknown>):FormSchema{return schema.anyOf?.find(branch=>Object.entries(branch.properties??{}).every(([key,field])=>value[key]===undefined||field.const!==undefined?value[key]===undefined||value[key]===field.const:field.enum?field.enum.includes(value[key]):true))??schema;}
