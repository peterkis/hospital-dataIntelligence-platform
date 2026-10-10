import type {ImportJob} from './import-job.js';
export interface OwnerSourceLocation {origin:'PAGE'|'FILE';sourceArtifactId:string|null;sourceRow:number|null;worksheet:string|null}
/** The Owner parser already enforces one named worksheet for each P3 contract. */
export function ownerSourceLocation(input:{revisionId:string;sourceRows?:number[];sourceArtifactId?:string},job:ImportJob,row:number|null,dataset:string,physical=false):OwnerSourceLocation{
 const revision=job.revisions.find(r=>r.id===input.revisionId);if(!revision)throw new Error('STALE_REVISION');
 const file=revision.input.kind==='FILE';
 return {origin:file?'FILE':'PAGE',sourceArtifactId:input.sourceArtifactId??null,sourceRow:row===null?null:physical?row:input.sourceRows?.[row-1]??row,worksheet:revision.input.kind==='FILE'&&revision.input.format==='XLSX'?dataset:null};
}
