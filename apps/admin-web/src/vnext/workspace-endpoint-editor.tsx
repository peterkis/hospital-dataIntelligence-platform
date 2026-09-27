import {WorkspaceEndpointFields} from './workspace-reference-fields.js';
import {objectField,textField} from './workspace-fields.js';

type Command=Record<string,unknown>;
export function canEditWorkspaceEndpoints(command:Command,disabled:boolean):boolean{
 return !disabled&&!textField(objectField(command,'target'),'id')&&['ESTABLISH','VERIFY_SCOPE'].includes(textField(command,'action'));
}

/** Explicit endpoint edits invalidate only references owned by the previous endpoint or pair. */
export function workspaceEndpointPatch(command:Command,subjectId:string,campusId:string):Command{
 const subjectChanged=textField(objectField(command,'subject'),'id')!==subjectId;
 const campusChanged=textField(objectField(command,'campus'),'id')!==campusId;
 const facts=objectField(command,'facts'),action=textField(command,'action');
 return {
  subject:subjectId?{owner:'organization-master',id:subjectId}:undefined,
  campus:campusId?{owner:'organization-master/campus',id:campusId}:undefined,
  ...(action==='VERIFY_SCOPE'&&subjectChanged?{facts:{...facts,license:undefined}}:{}),
  ...(action==='ESTABLISH'&&(subjectChanged||campusChanged)?{facts:{...facts,scopeTargets:[]}}:{}),
 };
}

export function WorkspaceDraftEndpointFields({actor,command,disabled,onChange}:{actor:string;command:Command;disabled:boolean;onChange:(patch:Command)=>void}){
 const editable=canEditWorkspaceEndpoints(command,disabled);
 const subjectId=textField(objectField(command,'subject'),'id'),campusId=textField(objectField(command,'campus'),'id');
 return <WorkspaceEndpointFields actor={actor} subjectId={subjectId} campusId={campusId} disabled={!editable} onChange={(nextSubject,nextCampus)=>{
  if(editable&&(nextSubject!==subjectId||nextCampus!==campusId))onChange(workspaceEndpointPatch(command,nextSubject,nextCampus));
 }}/>;
}
