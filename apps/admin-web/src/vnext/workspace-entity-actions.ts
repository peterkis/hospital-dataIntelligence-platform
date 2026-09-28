export type WorkspaceEntityActionKind='ORGANIZATION'|'CAMPUS'|'RELATION'|'SCOPE';

export function canReviseWorkspaceEntity(kind:WorkspaceEntityActionKind,context:{canWrite:boolean;terminal:boolean}|null|undefined){
 return Boolean(context?.canWrite&&!(kind==='CAMPUS'&&context.terminal));
}

export const campusWorkspaceActions=['SCHEDULE_OPENING','CANCEL_OPENING','ACTIVATE','SUSPEND','RESUME','RETIRE','RECORD_DISPOSITION','COMPLETE_DISPOSITION'] as const;
export function isCampusWorkspaceAction(action:string):action is typeof campusWorkspaceActions[number]{return campusWorkspaceActions.some(value=>value===action);}
export function canRetireWorkspaceCampus(context:{canWrite:boolean;terminal:boolean}|null|undefined,retiredFrom:string|null){return Boolean(context?.canWrite&&!context.terminal&&retiredFrom===null);}
export function canRecordCampusDisposition(context:{canWrite:boolean;terminal:boolean}|null|undefined,retiredFrom:string|null,completed:boolean|null=false){return Boolean(context?.canWrite&&retiredFrom!==null&&completed!==true);}
export function canCompleteCampusDisposition(context:{canWrite:boolean;terminal:boolean}|null|undefined,retiredFrom:string|null,completed:boolean|null=false){return Boolean(canRecordCampusDisposition(context,retiredFrom,completed)&&context?.terminal);}
export function canCancelCampusOpening(context:{canWrite:boolean;terminal:boolean}|null|undefined,plannedOpeningAt:string|null){return Boolean(context?.canWrite&&context.terminal&&plannedOpeningAt!==null);}
