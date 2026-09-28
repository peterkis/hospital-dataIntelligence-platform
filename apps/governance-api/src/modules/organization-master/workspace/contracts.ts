export * from './contracts-core.js';
import {draftMetadata as coreDraftMetadata,type DraftContent,type DraftMetadata as CoreDraftMetadata} from './contracts-core.js';

type ManifestTargetOwner='organization-master'|'organization-master/campus'|'organization-master/operating-relation';
export interface DraftManifestReference {
 row:number|null;dataset:'ORG01'|'ORG02'|'ORG03';scope:'NORTH'|'SOUTH'|null;intent:'CREATE'|'REVISE'|null;
 target:{owner:ManifestTargetOwner;id:string;version:string|null}|null;
 subject:{id:string;version:string|null}|null;campus:{id:string;version:string|null}|null;
}
export interface DraftMetadata extends CoreDraftMetadata {manifestReferences?:DraftManifestReference[]}
const record=(value:unknown):Record<string,unknown>|null=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
const version=(value:unknown)=>typeof value==='string'?value:null;
const platform=(value:unknown)=>{const item=record(value);return item&&item['kind']!=='JOB_ALIAS'&&typeof item['id']==='string'?{id:item['id'],version:version(item['expectedVersion'])}:null;};
function exactManifestReferences(rows:unknown[]):DraftManifestReference[]{
 const result:DraftManifestReference[]=[];
 for(const value of rows){
  const row=record(value);if(!row)continue;
  const dataset=['ORG01','ORG02','ORG03'].includes(String(row['dataset']))?row['dataset'] as DraftManifestReference['dataset']:null;
  const rawTarget=record(row['target']),subject=platform(row['subject']),campus=platform(row['campus']);
  if(!dataset&&(rawTarget?.['id']||subject||campus))throw new Error('BLOCKED_DEPENDENCY');
  if(!dataset)continue;
  const fallback:Record<DraftManifestReference['dataset'],ManifestTargetOwner>={ORG01:'organization-master',ORG02:'organization-master/campus',ORG03:'organization-master/operating-relation'};
  const owner=['organization-master','organization-master/campus','organization-master/operating-relation'].includes(String(rawTarget?.['owner']))?rawTarget!['owner'] as ManifestTargetOwner:fallback[dataset];
  const target=rawTarget&&typeof rawTarget['id']==='string'?{owner,id:rawTarget['id'],version:version(rawTarget['expectedVersion'])}:null;
  if(!target&&!subject&&!campus)continue;
  result.push({row:Number.isInteger(row['row'])?row['row'] as number:null,dataset,scope:['NORTH','SOUTH'].includes(String(row['governanceScope']))?row['governanceScope'] as 'NORTH'|'SOUTH':null,intent:['CREATE','REVISE'].includes(String(row['intent']))?row['intent'] as 'CREATE'|'REVISE':null,target,subject,campus});
 }
 return result;
}
// V1/V2 preserve the original authenticated projections. Current V3 additionally
// binds every exact manifest target and ORG03 platform endpoint into draft metadata.
export function draftMetadata(content:DraftContent,format:'V1'|'V2'|'V3'='V3'):DraftMetadata{
 const metadata=coreDraftMetadata(content,format);
 if(format!=='V3'||content.domain!=='BUNDLE')return metadata;
 const manifest=content.metadata['manifest'];
 const rows=manifest&&typeof manifest==='object'&&'rows' in manifest&&Array.isArray(manifest.rows)?manifest.rows:[];
 return {...metadata,manifestReferences:exactManifestReferences(rows)};
}
