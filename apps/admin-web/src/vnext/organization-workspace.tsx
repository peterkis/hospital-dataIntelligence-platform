import {isManualWorkspaceContract} from './workspace-transport.js';
import {retainWorkspaceSubmit,workspaceSubmitRequest,type WorkspaceSubmitRequest} from './workspace-submit-request.js';
import {displayTime} from './workspace-fields.js';
import {WorkspaceBundleApplication,type WorkspaceBundle} from './workspace-bundle-application.js';
import {WorkspaceBundleEditor} from './workspace-bundle-editor.js';
import {WorkspaceLicenseSelection,WorkspaceServiceSelection} from './workspace-reference-fields.js';
import {WorkspaceDraftEndpointFields} from './workspace-endpoint-editor.js';
import {WorkspaceCommandFields} from './workspace-command-fields.js';
import {ApplicationPanel,applicationStatus,type Application} from './workspace-application.js';
import {WorkspaceEntities,type EntityKind} from './workspace-entities.js';
import {Field,Group,textField,objectField} from './workspace-fields.js';
import {encodeWorkbenchFile} from './workbench-file.js';
import {useEffect,useRef,useState} from 'react';
import {createOrganizationWorkspaceClient,createVNextCatalogClient,type VNextEntry,type VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import './organization-workspace.css';
type Draft=Operations['saveOrganizationDraft']['requestBody']['content']['application/json'];
type Saved=Operations['saveOrganizationDraft']['responses'][200]['content']['application/json'];
type Summary=Operations['listOrganizationDrafts']['responses'][200]['content']['application/json'][number];
type Contract=Operations['listImportContracts']['responses'][200]['content']['application/json']['items'][number];
type Submission=Operations['submitOrganizationDraft']['responses'][200]['content']['application/json'];
type OrgDraft=Extract<Draft,{domain:'ORG01'}>;
const blank=():OrgDraft=>({requestId:crypto.randomUUID(),domain:'ORG01',campus:'NORTH',command:{action:'CREATE',facts:{authority:null,legalAddress:null},identifiers:[],validTo:null}});
function patchManual(draft:Draft,patch:Record<string,unknown>):Draft{
 switch(draft.domain){
  case 'ORG01':return {...draft,command:Object.assign({},draft.command,patch)};
  case 'ORG02':return {...draft,command:Object.assign({},draft.command,patch)};
  case 'ORG03':return {...draft,command:Object.assign({},draft.command,patch)};
  case 'BUNDLE':return draft;
 }
}
const roles=[['maker','院办'],['workspace-reviewer','核验 / 审批人'],['workspace-steward','院区管家'],['bundle-admin','合成授权管理员'],['outsider','无授权访问者']] as const;
export function OrganizationWorkspaceApp(){
 const [page,setPage]=useState<EntityKind|'EDITOR'>(()=>{const value=new URLSearchParams(location.search).get('view');return value==='ORGANIZATION'||value==='CAMPUS'||value==='RELATION'||value==='SCOPE'?value:'EDITOR';});
 const [actor,setActor]=useState<string>(()=>{const value=new URLSearchParams(location.search).get('as');return roles.some(([id])=>id===value)?value!:'maker';}),[pendingActor,setPendingActor]=useState<string|null>(null);
 const [draft,setDraft]=useState<Draft>(blank),[saved,setSaved]=useState<Saved|null>(null),[list,setList]=useState<Summary[]>([]);
 const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[bundlePending,setBundlePending]=useState(false),[message,setMessage]=useState('编辑内容仅在显式保存后持久化。');
 const [capabilities,setCapabilities]=useState<{canRead:boolean;canWrite:boolean;canReview:boolean;identity:string;inputKey:string}|null>(null);
 const [bundles,setBundles]=useState<WorkspaceBundle[]>([]),[bundle,setBundle]=useState<WorkspaceBundle|null>(null);
 const [applications,setApplications]=useState<Application[]>([]),[application,setApplication]=useState<Application|null>(null);
 const actorRef=useRef(actor),referenceGeneration=useRef(0),listGeneration=useRef(0);
 const [contracts,setContracts]=useState<Contract[]>([]),[sources,setSources]=useState<VNextEntry[]>([]),[submission,setSubmission]=useState<Submission|null>(null);
 const pendingDiscard=useRef<{id:string;expectedVersion:string;requestId:string}|null>(null);
 const pendingSubmit=useRef<WorkspaceSubmitRequest|null>(null);
 const epoch=useRef(0),pendingSave=useRef<Draft|null>(null),initial=useRef(true);const renderEpoch=epoch.current;
 const client=()=>createOrganizationWorkspaceClient(location.origin,actor);
 const remember=(id?:string)=>{const url=new URL(location.href);if(id)url.searchParams.set('draft',id);else url.searchParams.delete('draft');url.searchParams.delete('input');url.searchParams.delete('bundle');url.searchParams.delete('bundleRevision');history.replaceState(null,'',url.pathname+url.search);};
 async function refresh(){
  if(actorRef.current!==actor)return;const e=epoch.current,generation=++listGeneration.current;
  try{const [result,appResult,bundleResult]=await Promise.all([client().listDrafts(),client().listApplications(),client().listBundles()]);if(e!==epoch.current||generation!==listGeneration.current)return;
   setApplications(appResult.data??[]);setBundles(bundleResult.data??[]);setList(result.data??[]);
   const params=new URLSearchParams(location.search),selectedBundle=params.get('bundle'),selectedRevision=params.get('bundleRevision'),selected=params.get('input');
   let selectedBundleItem=selectedBundle?bundleResult.data?.find(b=>b.jobId===selectedBundle&&(selectedRevision?b.revisionId===selectedRevision:b.currentRevision)):undefined;
   let selectedApplication=selected?appResult.data?.find(a=>a.inputId===selected):undefined;
   if(selectedBundle&&!selectedBundleItem){const exact=await client().listBundles({jobId:selectedBundle,...(selectedRevision?{revisionId:selectedRevision}:{})});if(e!==epoch.current||generation!==listGeneration.current)return;selectedBundleItem=exact.data?.find(b=>selectedRevision?b.revisionId===selectedRevision:b.currentRevision);if(!selectedBundleItem)setMessage('该工作簿申请不存在或当前不可读取。');}
   if(selected&&!selectedApplication){const exact=await client().listApplications({inputId:selected});if(e!==epoch.current||generation!==listGeneration.current)return;selectedApplication=exact.data?.[0];if(!selectedApplication)setMessage('该申请不存在或当前不可读取。');}
   setBundle(selectedBundleItem??null);setApplication(selectedApplication??null);
   const error=result.error??appResult.error??bundleResult.error;if(error)setMessage(error.message+' ['+error.code+']');
  }catch{if(e===epoch.current&&generation===listGeneration.current){setList([]);setApplications([]);setBundles([]);setApplication(null);setBundle(null);setMessage('列表连接失败，未使用旧列表作为当前结果；已确认的保存或提交结果仍可恢复。');}}
 }

 async function restore(id:string){
  const e=++epoch.current;setBusy(true);
  try{
   const result=await client().readDraft(id);if(e!==epoch.current)return;
   if(result.error){setMessage(result.error.message+' ['+result.error.code+']');return;}
   // A failed read leaves the current selection and its uncertain request intact.
   // A successful read retains retries only for the same editable revision.
   pendingSubmit.current=retainWorkspaceSubmit(pendingSubmit.current,result.data);
   setDraft(result.data.content);setApplication(null);setBundle(null);setSaved(result.data);setSubmission(result.data.submission);setDirty(false);pendingSave.current=null;remember(id);setMessage('已从服务器恢复草稿 · '+result.data.state);void refresh();return e;
  }catch{if(e===epoch.current)setMessage('连接失败，未改变服务器草稿.');}
  finally{if(e===epoch.current)setBusy(false);}
 }
 async function loadReferences(){const generation=++