export type WorkspaceEntityActionKind='ORGANIZATION'|'CAMPUS'|'RELATION'|'SCOPE';

export function canReviseWorkspaceEntity(kind:WorkspaceEntityActionKind,context:{canWrite:boolean;terminal:boolean}|null|undefined){
 return Boolean(context?.canWrite&&!(kind==='CAMPUS'&&context.terminal));
}
