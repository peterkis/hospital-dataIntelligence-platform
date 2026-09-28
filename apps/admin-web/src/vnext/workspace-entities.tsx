import {canCompleteCampusDisposition,canRecordCampusDisposition,canReviseWorkspaceEntity,canRetireWorkspaceCampus,isCampusWorkspaceAction} from './workspace-entity-actions.js';
import {WorkspaceCampusDisposition} from './workspace-campus-impact.js';
import {WorkspaceVersionComparison} from './workspace-version-comparison.js';
import {displayTime} from './workspace-fields.js';
import {WorkspaceOperatingWindow} from './workspace-window.js';
import {WorkspaceEndpointFields} from './workspace-reference-fields.js';
import {useEffect,useRef,useState} from 'react';
import {createVNextCatalogClient,createOrganizationWorkspaceClient,type VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import {ReviewValues} from './workspace-application.js';
import {readAllWorkspacePages} from './workspace-pagination.js';
import {WorkspaceLicenseActions,licenseVersionActions,licenseRevocationDraft,type License} from './workspace-license-actions.js';
import {Field,textField,objectField} from './workspace-fields.js';
export type EntityKind='ORGANIZATION'|'CAMPUS'|'RELATION'|'SCOPE';
type DraftContent=Operations['prepareOrganizationRevision']['responses'][200]['content']['application/json'];
type Context=Operations['organizationObjectContext']['responses'][200]['content']['application/json'];
interface Row {id:string;name:string;version:string;value:unknown}
const titles:Record<EntityKind,string>={ORGANIZATION:'机构主体',CAMPUS:'院区',RELATION:'运营关系',SCOPE:'许可范围'};
const stamp=(value:string)=>value.includes('.')?value.padEnd(26,'0'):(value+'.').padEnd(26,'0');
export function WorkspaceEntities({actor,kind,onDraft,serviceCodes}:{actor:string;kind:EntityKind;serviceCodes:string[];onDraft:(draft:DraftContent)=>void}){
 const [retiredFrom,setRetiredFrom]=useState<string|null>(null);
 const [subjectId,setSubjectId]=useState(''),[campusId,setCampusId]=useState('');
 const [businessAt,setBusinessAt]=useState(''),[asOf,setAsOf]=useState(''),[active,setActive]=useState<{businessAt:string;asOf:string;current:boolean}|null>(null);
 const [rows,setRows]=useState<Row[]>([]),[selected,setSelected]=useState<Row|null>(null),[detail,setDetail]=useState<unknown>(null),[versions,setVersions]=useState<Array<{version:string;value:unknown}>>([]),[licenses,setLicenses]=useState<License[]>([]),[context,setContext]=useState<Context|null>(null),[message,setMessage]=useState('正在读取当前对象…'),[busy,setBusy]=useState(false);
 const epoch=useRef(0),api=()=>createVNextCatalogClient(location.origin,actor),workspace=()=>createOrganizationWorkspaceClient(location.origin,actor);
 useEffect(()=>{void current();return()=>{epoch.current++;};},[]);
 async function current(){const e=++epoch.current;setBusy(true);try{const clock=await workspace().capabilities({domain:'ORG01',campus:'NORTH',command:{action:'CREATE'}});if(e!==epoch.current)return;if(clock.error){setMessage(clock.error.message);return;}const value=clock.data.observedAt;setBusinessAt(value);setAsOf(value);await load({businessAt:value,asOf:value,current:true},e);}catch{if(e===epoch.current)setMessage('服务不可用，未使用旧缓存。');}finally{if(e===epoch.current)setBusy(false);}}
 async function load(filter:{businessAt:string;asOf:string;current:boolean},token=++epoch.current){setBusy(true);setRows([]);setSelected(null);setDetail(null);setRetiredFrom(null);setVersions([]);setLicenses([]);setContext(null);setActive(filter);
  try{
   if(kind==='ORGANIZATION'){const r=await readAllWorkspacePages(after=>api().POST('/api/vnext/organizations/query',{body:{mode:'LIST',businessAt:filter.businessAt,asOf:filter.asOf,limit:100,...(after?{after}: {})}}));if(token!==epoch.current)return;if(r.error||!r.data){setMessage('组织列表读取失败；未截断为前 100 项。');return;}setRows(r.data.map(value=>({id:value.id,name:value.legalName,version:value.version,value})));}
   else if(kind==='CAMPUS'){const r=await readAllWorkspacePages(after=>api().POST('/api/vnext/campuses/list',{body:{businessAt:filter.businessAt,asOf:filter.asOf,limit:100,...(after?{after}: {})}}));if(token!==epoch.current)return;if(r.error||!r.data){setMessage('院区列表读取失败；未截断为前 100 项。');return;}setRows(r.data.map(value=>({id:value.id,name:value.facts?.campusName??'资料期间空档',version:value.head,value})));}
   else{if(!subjectId||!campusId){setMessage('先选择准确主体与院区，再读取关系。');return;}const r=await api().POST(kind==='RELATION'?'/api/vnext/operating-relations/query':'/api/vnext/license-scope-evidence/query',{body:{kind,subjectId,campusId,mode:'LIST',businessAt:filter.businessAt,asOf:filter.asOf}});if(token!==epoch.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}setRows(r.data.map(value=>({id:value.id,name:kind==='RELATION'?textField(value.facts,'role')||'关系关闭断言':'许可范围',version:value.version,value})));}
   setMessage(filter.current?'已读取当前可见对象。':'历史观察：所有详情沿用指定 B/R。');
  }catch{if(token!==epoch.current)return;setMessage('读取失败，未保留旧结果作为当前事实。');}finally{if(token===epoch.current)setBusy(false);}
 }
 async function inspect(row:Row){if(!active)return;const e=++epoch.current;setBusy(true);setSelected(row);setDetail(null);setRetiredFrom(null);setVersions([]);setLicenses([]);setContext(null);const filters={businessAt:active.businessAt,asOf:active.asOf};
  try{
   const permissions=await workspace().objectContext({kind,id:row.id});if(e!==epoch.current)return;if(permissions.data)setContext(permissions.data);
   if(kind==='ORGANIZATION'){
    const [history,currentLicense,licenseHistory]=await Promise.all([api().POST('/api/vnext/organizations/query',{body:{id:row.id,mode:'HISTORY',asOf:active.asOf}}),api().POST('/api/vnext/organizations/licenses/query',{body:{id:row.id,mode:'EFFECTIVE',...filters}}),api().POST('/api/vnext/organizations/history-details',{body:{id:row.id,asOf:active.asOf}})]);if(e!==epoch.current)return;
    if(history.error||currentLicense.error||licenseHistory.error){setMessage('详情读取被拒绝或不可用，未拼接其他时点的内容。');return;}
    setVersions(history.data.map(value=>({version:value.version,value})));setLicenses(licenseHistory.data.licenses);setDetail({资料:row.value,登记核验历史:licenseHistory.data.verifications,所选业务时点命中的证照断言:currentLicense.data,持证说明:'证照断言不等于登记资格；未知期限不视为已核验无界。'});
   }else if(kind==='CAMPUS'){
    const [resolved,history]=await Promise.all([api().POST('/api/vnext/campuses/references/resolve',{body:{references:[{owner:'organization-master/campus',id:row.id}],...filters}}),api().POST('/api/vnext/campuses/history',{body:{id:row.id,asOf:active.asOf}})]);if(e!==epoch.current)return;
    if(resolved.error||history.error){setMessage('院区资料或历史不可用。');return;}
    setRetiredFrom(history.data.operations.find(v=>v.action==='RETIRE')?.validFrom??null);setDetail({...resolved.data.items[0],计划历史:history.data.plans,运营状态历史:history.data.operations});setVersions(history.data.versions.map(value=>({version:value.version,value})));
   }else{
    const history=await api().POST(kind==='RELATION'?'/api/vnext/operating-relations/query':'/api/vnext/license-scope-evidence/query',{body:{kind,id:row.id,mode:'HISTORY',asOf:active.asOf}});if(e!==epoch.current)return;if(history.error){setMessage(history.error.message);return;}setDetail(row.value);setVersions(history.data.map(value=>({version:value.version,value})));
   }
  }catch{if(e===epoch.current)setMessage('详情读取失败。');}finally{if(e===epoch.current)setBusy(false);}
 }
 async function revise(version:string,targetKind:EntityKind|'LICENSE'=kind,id=selected?.id,revalidate=false){
  if(!id||busy)return;
  if(targetKind==='CAMPUS'&&!canReviseWorkspaceEntity('CAMPUS',context)){setMessage('永久退出院区只允许登记或完成处置，不能再建立资料修订草稿。');return;}
  if(targetKind==='LICENSE'){
   const license=licenses.find(row=>row.id===id&&row.version===version);
   if(!license||!licenseVersionActions(license,licenses,Boolean(active?.current&&context?.canWrite)).canRevise){setMessage('该证照版本不可作为修订底稿，请读取当前资料。');return;}
  }
  const e=epoch.current;setBusy(true);try{const r=await workspace().prepareRevision({kind:targetKind,id,version});if(e!==epoch.current)return;if(r.error){setMessage(r.error.message+' ['+r.error.code+']');return;}onDraft(revalidate&&r.data.domain==='ORG03'?{...r.data,command:{...r.data.command,action:'REVALIDATE'}}:r.data);}catch{if(e===epoch.current)setMessage('修订底稿读取失败，未创建草稿。');}finally{if(e===epoch.current)setBusy(false);}
 }
 async function actionDraft(action:string,license?:License){if(busy||!selected||!context||!active?.current)return;
  const common={action,validTo:null};
  if(kind==='ORGANIZATION'){
   if(action==='REVOKE_LICENSE'){
    if(!license||!licenseVersionActions(license,licenses,context.canWrite).canRevoke){setMessage('只能撤销最新且未撤销的证照版本，请读取当前资料。');return;}
    const e=epoch.current;setBusy(true);
    try{
     const latest=await workspace().objectContext({kind:'LICENSE',id:license.id});if(e!==epoch.current)return;
     if(latest.error){setMessage(latest.error.message+' ['+latest.error.code+']');return;}
     const draft=licenseRevocationDraft(license,selected.id,latest.data);
     if(!draft){setMessage('证照版本或维护权限已变化，请读取当前资料后重试；未创建草稿。');return;}
     onDraft(draft);
    }catch{if(e===epoch.current)setMessage('当前证照状态读取失败，未创建撤销草稿。');}finally{if(e===epoch.current)setBusy(false);}
   }
   else if(action==='ADD_LICENSE')onDraft({domain:'ORG01',campus:context.campus,command:{...common,action:'ADD_LICENSE',target:{id:selected.id,version:context.head},license:{validTo:null}}});
   else if(action==='VERIFY_REGISTRATION')onDraft({domain:'ORG01',campus:context.campus,command:{...common,action:'VERIFY_REGISTRATION',target:{id:selected.id,version:context.head},licenseTargets:[]}});
  }else if(kind==='CAMPUS'){
   const target={owner:'organization-master/campus' as const,id:selected.id,expectedVersion:context.head};
   const rawState=textField(selected.value,'operationStatus');const sourceOperationStatus=rawState==='PLANNING'||rawState==='RUNNING'||rawState==='TRIAL_RUNNING'||rawState==='SUSPENDED'?rawState:undefined;if(!isCampusWorkspaceAction(action))return;if(action==='RETIRE'&&!canRetireWorkspaceCampus(context,retiredFrom)){setMessage('该院区已登记永久退出，不能重复申请。');return;}const command:Record<string,unknown>={...common,target,sourceOperationStatus:action==='SUSPEND'?'SUSPENDED':['RETIRE','RECORD_DISPOSITION','COMPLETE_DISPOSITION'].includes(action)?'RETIRED':sourceOperationStatus};
   const version=versions.at(-1)?.version;if(!version){setMessage('没有可读取的资料版本，不能生成占位证据。');return;}const e=epoch.current;setBusy(true);
   try{const original=await workspace().prepareCampusLifecycle({kind:'CAMPUS',id:selected.id,version,action});if(e!==epoch.current)return;if(original.error){setMessage(original.error.message);return;}if(original.data.domain!=='ORG02'||!original.data.command.source||!original.data.command.evidence)throw new Error('INCOMPLETE_SOURCE');onDraft({...original.data,command:{...command,...original.data.command}});}catch{if(e===epoch.current)setMessage('无法读取准确来源底稿，未创建生命周期申请。');}finally{if(e===epoch.current)setBusy(false);}
  }else{
   const command:Record<string,unknown>=Object.assign({},common,{target:{owner:kind==='RELATION'?'organization-master/operating-relation':'organization-master/license-scope',id:selected.id,expectedVersion:context.head},subject:objectField(selected.value,'subject'),campus:objectField(selected.value,'campus'),evidence:null});onDraft({domain:'ORG03',campus:context.campus,command});
  }
 }
 return <section className="entity-workspace"><header><h2>{titles[kind]} · 资料与时间</h2><button className="secondary" disabled={busy} onClick={()=>void current()}>读取当前资料</button></header>{(kind==='RELATION'||kind==='SCOPE')&&<div className="workspace-form"><WorkspaceEndpointFields actor={actor} subjectId={subjectId} campusId={campusId} disabled={busy} onChange={(subject,campus)=>{epoch.current++;setSubjectId(subject);setCampusId(campus);setRows([]);setSelected(null);setDetail(null);setRetiredFrom(null);setVersions([]);setContext(null);setLicenses([]);}}/></div>}<div className="workspace-form time-query"><Field time label="业务时点 B" value={businessAt} onChange={setBusinessAt}/><Field time label="记录时点 R" value={asOf} onChange={setAsOf}/><button disabled={busy||!businessAt||!asOf} onClick={()=>void load({businessAt,asOf,current:false})}>读取指定时点</button></div><p role="status">{message}</p>{active&&<p className="muted">已应用查询：B {displayTime(active.businessAt)} · R {displayTime(active.asOf)}{(businessAt!==active.businessAt||asOf!==active.asOf)?'；编辑后的查询条件尚未读取。':''}</p>}<p className="muted">历史视图只读；维护操作需先返回当前资料。时间按 Asia/Shanghai 显示到秒，不包含区间结束点。</p><div className="workspace-columns"><section className="draft-rail"><h3>{titles[kind]}列表</h3>{rows.length?rows.map(row=><button className="draft-item" key={row.id} disabled={busy} onClick={()=>void inspect(row)}><strong>{row.name}</strong><span>{kind==='CAMPUS'?'整体版本':'资料版本'} {row.version} · {row.id.slice(-8)}</span></button>):<p>当前权限与时点下没有对象。</p>}</section><section className="editor-card"><h3>{selected?.name??'选择对象查看资料'}</h3>{detail!==null&&<ReviewValues value={detail}/>} {kind==='CAMPUS'&&selected&&retiredFrom&&active&&<WorkspaceCampusDisposition key={actor+selected.id+active.asOf} actor={actor} id={selected.id} from={retiredFrom} asOf={active.asOf}/>}{kind==='CAMPUS'&&retiredFrom&&active?.current&&!context?.terminal&&<p className="muted">已登记永久退出，生效时间 {displayTime(retiredFrom)}；生效前仅可申请符合退出边界的维护。</p>}<div className="action-bar">{selected&&active?.current&&context&&!context.terminal&&<>{kind==='ORGANIZATION'&&context.canWrite&&<><button disabled={busy} onClick={()=>actionDraft('ADD_LICENSE')}>新增证照申请</button><button disabled={busy} onClick={()=>actionDraft('VERIFY_REGISTRATION')}>登记核验申请</button></>}{kind==='CAMPUS'&&context.canWrite&&<><button disabled={busy} onClick={()=>actionDraft('SCHEDULE_OPENING')}>制定开业计划</button><button disabled={busy} onClick={()=>actionDraft('CANCEL_OPENING')}>取消开业计划</button><button disabled={busy||textField(selected.value,'operationStatus')!=='SUSPENDED'} onClick={()=>actionDraft('RESUME')}>申请恢复</button>{canRetireWorkspaceCampus(context,retiredFrom)&&<button disabled={busy} onClick={()=>actionDraft('RETIRE')}>申请永久退出</button>}<button disabled={busy||!context.canActivate} onClick={()=>actionDraft('ACTIVATE')}>申请试运行 / 运行</button></>}{kind==='RELATION'&&context.canWrite&&<button disabled={busy} onClick={()=>void revise(selected.version,'RELATION',selected.id,true)}>重新核验关系依据</button>}{context.canClose&&<button className="secondary" disabled={busy} onClick={()=>actionDraft(kind==='CAMPUS'?'SUSPEND':kind==='RELATION'?'CLOSE':'REVOKE_SCOPE')}>{kind==='CAMPUS'?'申请停用':kind==='RELATION'?'关闭关系':'撤销范围断言'}</button>}</>}{kind==='CAMPUS'&&selected&&active?.current&&canRecordCampusDisposition(context,retiredFrom)&&<button disabled={busy} onClick={()=>actionDraft('RECORD_DISPOSITION')}>登记处置证据</button>}{kind==='CAMPUS'&&selected&&active?.current&&canCompleteCampusDisposition(context,retiredFrom)&&<button disabled={busy} onClick={()=>actionDraft('COMPLETE_DISPOSITION')}>申请处置结案</button>}{selected&&active?.current&&canReviseWorkspaceEntity(kind,context)&&<span>可对明确版本发起修订，提交后仍需独立审批。</span>}</div>{!!licenses.length&&<section><h3>该 R 前已知的证照版本</h3><p className="muted">包括明确标记的未来安排，不把未来证照当作所选业务时点的持证依据。非撤销历史版本可作修订底稿；撤销仅针对最新且未撤销的证照版本。</p>{licenses.map(license=><article className="history" key={license.versionId}><strong>{stamp(license.validFrom)>stamp(active!.businessAt)?'未来业务安排 · 尚未在所选 B 生效':'证照版本'} {license.version}</strong><ReviewValues value={license}/><WorkspaceLicenseActions license={license} history={licenses} canMaintain={Boolean(active?.current&&context?.canWrite)} busy={busy} onRevise={()=>void revise(license.version,'LICENSE',license.id)} onRevoke={()=>void actionDraft('REVOKE_LICENSE',license)}/></article>)}</section>}
 {!!versions.length&&<section><h3>版本历史</h3>{versions.map(version=><article className="history" key={version.version}><h4>版本 {version.version}</h4><ReviewValues value={version.value}/>{active&&textField(version.value,'recordedAt')&&<button className="secondary" disabled={busy} onClick={()=>{const recordedAt=textField(version.value,'recordedAt');setAsOf(recordedAt);void load({businessAt:active.businessAt,asOf:recordedAt,current:false});}}>查看该版本记录时点</button>}{active?.current&&canReviseWorkspaceEntity(kind,context)&&<button className="secondary" disabled={busy} onClick={()=>void revise(version.version)}>以此资料版本修订</button>}</article>)}{selected&&(kind==='ORGANIZATION'||kind==='CAMPUS')&&<WorkspaceVersionComparison key={actor+'/'+kind+'/'+selected.id+'/'+active?.businessAt+'/'+active?.asOf} actor={actor} kind={kind} id={selected.id} versions={versions.map(v=>v.version)} disabled={busy}/>}</section>}</section></div>{kind==='RELATION'&&active&&<WorkspaceOperatingWindow key={actor+'/'+subjectId+'/'+campusId+'/'+active.asOf} actor={actor} subjectId={subjectId} campusId={campusId} asOf={active.asOf} codes={serviceCodes}/>}</section>;
}
