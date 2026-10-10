import type {FormSchema,ReferenceChoice,ReferenceChoices} from './department-form.js';
import {record} from './care-model.js';
import {careFormBranch} from './care-request.js';
export interface CareReferenceChoice extends ReferenceChoice {fields:Readonly<Record<string,unknown>>}
export function careContextChoices(choices:ReferenceChoices,field:string,root:Readonly<Record<string,unknown>>):readonly ReferenceChoice[]|undefined{
 if(field==='code'&&root['owner']!=='governance-catalog/subject-code'&&!('systemId' in root))return undefined;
 if(field==='partitionIds'&&!('scopeSetId' in root)&&root['kind']!=='PARTITIONS')return undefined;
 const owner=field==='code'?'subjectAdoption':field==='partitionIds'?'nursingScope':null;if(!owner)return undefined;
 const id=field==='code'?root['systemId']:root['scopeSetId'],version=field==='code'?root['versionId']:root['version'];
 const selected=(choices[owner]??[]).find(value=>value.value===id&&(field==='code'?value.versionId:value.version)===version);
 if(!selected||!('fields' in selected))return [];
 const items=record(selected.fields)[field==='code'?'codes':'partitions'];if(!Array.isArray(items))return [];
 return items.map(value=>{const row=record(value);return {value:String(row[field==='code'?'code':'id']??''),label:`${String(row['name']??'')} · ${String(row[field==='code'?'code':'sourceAlias']??'')} · ${selected.label}`};});
}
/** An explicit selection binds only fields present in the closed form branch. */
export function bindCareReferenceFields(schema:FormSchema,field:string,value:Readonly<Record<string,unknown>>,choices:ReferenceChoices):Readonly<Record<string,unknown>>{
 if(schema.anyOf)return bindCareReferenceFields(careFormBranch(schema,value),field,value,choices);
 if(!schema.properties||!['systemId','valueId','scopeSetId','definitionVersionId'].includes(field))return value;
 const result={...value},selected=(choices[field]??[]).find(option=>option.value===value[field]);if(!selected||!('fields' in selected))return value;
 for(const [name,content] of Object.entries(record(selected.fields)))if(name in schema.properties)result[name]=content;
 return result;
}
