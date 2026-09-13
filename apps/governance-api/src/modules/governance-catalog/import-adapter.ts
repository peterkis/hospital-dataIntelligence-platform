/** Declarations only. Owner-specific validation, planning and apply belong to later tickets. */
export interface AdapterRequest {dataset:string;profile:'CORE'|'FULL';contractVersion:number}
export interface AdapterDescriptor {
 readonly dataset:string;readonly profile:'CORE'|'FULL';readonly owner:null;
 readonly supportedContractRange:null;readonly allowedIntents:readonly [];
 readonly capability:'NOT_READY';
}
const datasets:ReadonlySet<string>=new Set([
 'ORG01','ORG02','ORG03','ORG04','ORG05','ORG06','ORG07','ORG08','ORG09','ORG10','ORG11','ORG12','ORG13',
 'ORG14','ORG15','ORG16','ORG17','ORG18','ORG19','ORG20','ORG21','ORG22','ORG23','ORG24','ORG25','ORG26','ORG27',
 'PER01','PER02','PER03','PER04','PER05','PER06','PER07','PER08','PER09','PER10','PER11','PER12','PER13',
 'PER14','PER15','PER16','PER17','PER18','PER19','PER20','PER21','PER22','PER23','PER24','PER25','PER26',
]);
export function selectImportAdapter(request:AdapterRequest):AdapterDescriptor {
 if(!datasets.has(request.dataset))throw new Error('UNKNOWN_ADAPTER');
 if(!['CORE','FULL'].includes(request.profile)||!Number.isSafeInteger(request.contractVersion)||request.contractVersion<1)throw new Error('INVALID_ADAPTER_REQUEST');
 return Object.freeze({dataset:request.dataset,profile:request.profile,owner:null,supportedContractRange:null,allowedIntents:[] as const,capability:'NOT_READY'});
}
export interface JobRevisionContext {jobId:string;revisionId:string;datasetId:string}
export interface JobLocalAlias extends JobRevisionContext {clientKey:string}
export function assertJobLocalAlias(context:JobRevisionContext,reference:JobLocalAlias):void {
 if(reference.jobId!==context.jobId)throw new Error('CROSS_JOB_ALIAS');
 if(reference.revisionId!==context.revisionId)throw new Error('CROSS_REVISION_ALIAS');
 if(reference.datasetId!==context.datasetId)throw new Error('CROSS_DATASET_ALIAS');
 if(!/^[A-Z_]{1,64}$/.test(reference.clientKey))throw new Error('INVALID_CLIENT_KEY');
}
/** Finite execution gate, not a pluggable owner interface. */
export type ImportStage='validate'|'plan'|'apply';
export function requireImportExecution(request:AdapterRequest,stage:ImportStage):never {
 if(!['validate','plan','apply'].includes(stage))throw new Error('INVALID_IMPORT_STAGE');
 selectImportAdapter(request);
 throw new Error('ADAPTER_NOT_READY');
}
