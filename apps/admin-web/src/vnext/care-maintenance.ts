import {careExecute} from './care-request.js';
import {careOwners,carePipelines,record,text,type CareKind} from './care-model.js';

/** Copy the original protected source row only after both native reads pass.
 * The new application binds the current head, never the displayed old head. */
export async function careMaintenance(actor:string,kind:CareKind,id:string){
 if(kind==='LIFECYCLE')throw new Error('请选择准确组合申请。');
 const history=record(await careExecute(actor,carePipelines[kind].history!,{id})),versions=Array.isArray(history['versions'])?history['versions'].map(record):[];
 const latest=versions.reduce<Record<string,unknown>|null>((head,v)=>!head||BigInt(text(v['number']??v['version']))>BigInt(text(head['number']??head['version']))?v:head,null);
 const declaration=versions.filter(v=>['CREATE','REVISE','GRANT','RECORD'].includes(text(v['action']))).at(-1),source=record(record(record(declaration)['facts'])['source']),locator=record(source['recordLocatorEvidence']);
 if(!latest||!text(locator['inputId']))throw new Error('原始维护依据不可读取，请从准确原申请继续。');
 if(['CLOSE','END','RETIRE','RETIRED'].includes(text(latest['action'])))throw new Error('对象已经永久结束，请读取历史。');
 const original=record(await careExecute(actor,carePipelines[kind].read,{inputId:locator['inputId']})),entries=Array.isArray(original['entries'])?original['entries']:[],sourceRows=Array.isArray(original['sourceRows'])?original['sourceRows']:[];
 const index=sourceRows.length?sourceRows.indexOf(locator['row']):Number(locator['row'])-1,entry=record(entries[index]);
 if(!Object.keys(entry).length)throw new Error('原来源行定位不匹配，不能准备维护。');
 const {requestId:_request,jobId:_job,revisionId:_revision,sourceArtifactId:_artifact,sourceRows:_rows,campus,profile,entries:_entries,...payload}=original;
 const owner=kind==='PERMISSION'&&entry['kind']==='MAPPING'?'care-organization/subject-mapping':careOwners[kind];
 // REVISE retains the accepted binding/parent through the Owner, so CREATE or
 // REBIND-only command fields must not be copied into this closed branch.
 const {binding:_binding,parent:_parent,target:_target,...editable}=entry,row=record(editable['row']);
 if(['UNIT_WARD','WARD_NURSING','LOCATION_USE','PERMISSION'].includes(kind)&&typeof row['version_no']==='string'){
  if(!/^[1-9][0-9]{0,9}$/.test(row['version_no'])||BigInt(row['version_no'])>2147483647n)throw new Error('原来源版本不符合直接维护契约。');
  editable['row']={...row,version_no:Number(row['version_no'])};
 }
 const head=text(latest['number']??latest['version']),target={owner,id,...(kind==='LOCATION'?{expectedVersion:head}:{expectedHead:head})};
 return {campus:campus==='SOUTH'?'SOUTH' as const:'NORTH' as const,profile:profile==='FULL'?'FULL' as const:'CORE' as const,payload:{...payload,entries:[{...editable,action:'REVISE',target}]}};
}
