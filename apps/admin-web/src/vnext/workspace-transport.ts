interface WorkspaceContract {
 dataset:string;
 status:string;
 profile:string;
 definition:{templateVersion:string};
}
/** Presentation filter only; Owner and SQL repeat the authoritative check. */
export function isManualWorkspaceContract(contract:WorkspaceContract,domain:string):boolean{
 return ['ORG01','ORG02','ORG03'].includes(domain)&&contract.dataset===domain&&contract.status==='PUBLISHED'&&contract.profile==='CORE'&&contract.definition.templateVersion===domain+'_MANUAL_CORE_V1';
}
