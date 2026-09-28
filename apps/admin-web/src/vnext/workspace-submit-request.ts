import type {VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';

type Saved=Operations['saveOrganizationDraft']['responses'][200]['content']['application/json'];
export type WorkspaceSubmitRequest=Operations['submitOrganizationDraft']['requestBody']['content']['application/json'];
type Target=Pick<Saved,'id'|'version'|'state'>;

/** Retain an uncertain request only while the same editable revision is selected. */
export function retainWorkspaceSubmit(pending:WorkspaceSubmitRequest|null,target:Target|null):WorkspaceSubmitRequest|null{
 return target?.state==='EDITING'&&pending?.id===target.id&&pending.expectedVersion===target.version?pending:null;
}

/** Check again at dispatch: restoration is not the only way the selection changes. */
export function workspaceSubmitRequest(pending:WorkspaceSubmitRequest|null,target:Target|null,newId:()=>string=()=>crypto.randomUUID()):WorkspaceSubmitRequest|null{
 if(!target||target.state!=='EDITING')return null;
 return retainWorkspaceSubmit(pending,target)??{id:target.id,expectedVersion:target.version,requestId:newId()};
}
