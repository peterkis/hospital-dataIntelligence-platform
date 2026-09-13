import type {VNextImportContract} from '@hospital-data-intelligence/generated-api-client';
type Definition=VNextImportContract['definition'];
export function updateContractCodeSet(definition:Definition,index:number,patch:Partial<Definition['codeSets'][number]>):Definition{
 const previous=definition.codeSets[index];if(!previous)return definition;
 const next={...previous,...patch};
 return {...definition,codeSets:definition.codeSets.map((value,i)=>i===index?next:value),fields:definition.fields.map(field=>
  field.code===next.field?{...field,enumValues:next.codes}:field.code===previous.field&&previous.field!==next.field?{...field,enumValues:[]}:field)};
}
export function contractRetirement(history:Array<Pick<VNextImportContract,'head'|'status'|'reviewDigest'>>):{expectedHead:string;reviewDigest:string}|null{
 const current=history.at(-1);
 const publication=[...history].reverse().find(event=>event.status==='PUBLISHED'||event.status==='RETIRED');
 return current&&publication?.status==='PUBLISHED'?{expectedHead:current.head,reviewDigest:publication.reviewDigest}:null;
}
