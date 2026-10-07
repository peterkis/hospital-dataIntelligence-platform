import React,{useEffect,useRef,useState} from 'react';
import {createLocationUsageTypeClient,createVNextCatalogClient,type LocationUsageTypeCommand,type LocationUsageTypeItem,type LocationUsageTypePermissions,type VNextEntry} from '@hospital-data-intelligence/generated-api-client';
import {WorkspaceMaterial} from './workspace-material.js';
import './location-usage-types.css';

const emptyForm={code:'',name:'',meaning:'',description:'',validFrom:'2026-01-01T00:00:00',validTo:'',sourceId:'',sourceVersionId:'',evidenceId:''};
type Form=typeof emptyForm;
type Pending={actor:string;command:LocationUsageTypeCommand};
const formatError=(error:{code?:string;message?:string})=>(error.message??'请求未完成')+' ['+(error.code??'REQUEST_FAILED')+']';

export function LocationUsageTypesApp(){
 const [actor,setActor]=useState('maker'),[items,setItems]=useState<LocationUsageTypeItem[]>([]),[selected,setSelected]=useState<LocationUsageTypeItem|null>(null);
 const [sources,setSources]=useState<VNextEntry[]>([]),[form,setForm]=useState<Form>(emptyForm),[reason,setReason]=useState(''),[verificationEvidence,setVerificationEvidence]=useState(''),[meaningAccepted,setMeaningAccepted]=useState(false);
 const [history,setHistory]=useState<LocationUsageTypeItem[]>([]),[businessAt,setBusinessAt]=useState(''),[recordAsOf,setRecordAsOf]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState<Pending|null>(null);
 const [after,setAfter]=useState<string|undefined>(),[next,setNext]=useState<string|null>(null),[reload,setReload]=useState(0);
 const [permissions,setPermissions]=useState<LocationUsageTypePermissions|null>(null),[material,setMaterial]=useState<{id:string;bytesBase64:string;token:number}|null>(null),[materialRead,setMaterialRead]=useState(false);
 const pendingByActor=useRef(new Map<string,LocationUsageTypeCommand>()),epoch=useRef(0),listEpoch=useRef(0),commandEpoch=useRef(0),materialEpoch=useRef(0);
 const client=(identity=actor)=>createLocationUsageTypeClient(window.location.origin,identity);
 const catalog=(identity=actor)=>createVNextCatalogClient(window.location.origin,identity);
 const queryPoint={...(businessAt?{businessAt}:{}),...(recordAsOf?{recordAsOf}:{})};
 const historicalQuery=!!businessAt||!!recordAsOf;
 const put=(key:keyof Form,value:string)=>setForm(current=>({...current,[key]:value}));
 function changeQueryTime(kind:'B'|'R',value:string){++epoch.current;++listEpoch.current;++materialEpoch.current;setSelected(null);setHistory([]);setItems([]);setMaterial(null);setMaterialRead(false);setMeaningAccepted(false);setAfter(undefined);if(kind==='B')setBusinessAt(value);else setRecordAsOf(value);}
 function display(item:LocationUsageTypeItem){setSelected(item);setForm({code:item.code,name:item.name,meaning:item.meaning,description:item.description??'',validFrom:item.validFrom,validTo:item.validTo??'',sourceId:item.sourceId,sourceVersionId:item.sourceVersionId,evidenceId:item.evidenceId});setVerificationEvidence(item.verification?.evidenceId??item.evidenceId);setMeaningAccepted(false);}
 async function select(id:string,versionId?:string){
  const token=++epoch.current;setSelected(null);setHistory([]);setMeaningAccepted(false);
  try{const [entry,versions]=await Promise.all([client().read({id,...(versionId?{versionId}:{}),...queryPoint}),client().history({id,...queryPoint})]);if(token!==epoch.current)return;
   if(entry.error){setMessage(formatError(entry.error));return;}display(entry.data);
   if(versions.error)setMessage(formatError(versions.error));else setHistory(versions.data);
  }catch{if(token===epoch.current)setMessage('读取未完成，请重新读取当前版本。');}
 }
 useEffect(()=>{
  const token=++listEpoch.current,currentActor=actor;setItems([]);setNext(null);setSources([]);setPermissions(null);
  void Promise.all([client(currentActor).list({limit:25,...(after?{after}:{}),...queryPoint}),catalog(currentActor).GET('/api/vnext/catalog',{params:{query:{scope:'SYNTHETIC',kind:'SOURCE',page:1}}}),client(currentActor).permissions()]).then(([listing,sourceListing,access])=>{
   if(token!==listEpoch.current)return;
   if(listing.error)setMessage(formatError(listing.error));else{setItems(listing.data.items);setNext(listing.data.nextAfterId);}
   if(!sourceListing.error)setSources(sourceListing.data.items.filter(item=>item.status==='PUBLISHED'));
   if(access.error)setMessage(formatError(access.error));else setPermissions(access.data);
  }).catch(()=>{if(token===listEpoch.current)setMessage('列表读取未完成，请刷新。');});
  return ()=>{++listEpoch.current;};
 },[actor,after,reload,businessAt,recordAsOf]);
 useEffect(()=>{++materialEpoch.current;setMaterial(null);setMaterialRead(false);setMeaningAccepted(false);},[actor,selected?.versionId,verificationEvidence,form.sourceVersionId]);
 useEffect(()=>()=>{++epoch.current;++commandEpoch.current;},[]);
 function switchActor(identity:string){++epoch.current;++commandEpoch.current;++listEpoch.current;++materialEpoch.current;setActor(identity);setSelected(null);setHistory([]);setItems([]);setSources([]);setPermissions(null);setMaterial(null);setMaterialRead(false);setForm({...emptyForm});setReason('');setVerificationEvidence('');setMeaningAccepted(false);setBusy(false);setAfter(undefined);setPending(pendingByActor.current.has(identity)?{actor:identity,command:pendingByActor.current.get(identity)!}:null);setMessage('已切换身份，重新核验当前权限。');}
 async function loadMaterial(){
  const token=++materialEpoch.current,actorToken=epoch.current;setMaterial(null);setMaterialRead(false);setMeaningAccepted(false);
  try{const result=await client().readMaterial({id:verificationEvidence,sourceVersionId:form.sourceVersionId});if(token!==materialEpoch.current||actorToken!==epoch.current)return;
   if(result.error)setMessage(formatError(result.error));else{setMaterial({...result.data,token});setMessage('已从受控入口读取原材料，请打开或下载核对。');}
  }catch{if(token===materialEpoch.current&&actorToken===epoch.current)setMessage('受控材料未能读取，不能确认核验。');}
 }
 async function send(command:LocationUsageTypeCommand){
  const identity=actor,token=++commandEpoch.current,actorToken=epoch.current;
  pendingByActor.current.set(identity,structuredClone(command));setPending({actor:identity,command:structuredClone(command)});setBusy(true);setMessage('正在核验当前权限、准确版本和材料…');
  try{const result=await client(identity).command(command);
   if(token!==commandEpoch.current||actorToken!==epoch.current)return;
   if(result.error){const definite=result.response.status>=400&&result.response.status<500||result.error.code==='BLOCKED_DEPENDENCY';if(definite&&pendingByActor.current.get(identity)?.requestId===command.requestId)pendingByActor.current.delete(identity);
    setPending(definite?null:{actor:identity,command});setMessage(formatError(result.error)+(definite?'':'；结果尚未确定，请恢复原请求。'));return;}
   if(pendingByActor.current.get(identity)?.requestId===command.requestId)pendingByActor.current.delete(identity);
   const actionTime=command.action==='CREATE'||command.action==='REVISE'?result.data.recordedAt:command.action==='VERIFY'?result.data.verification?.recordedAt:command.action==='APPROVE'?result.data.approvedAt:result.data.events.find(event=>event.requestId===command.requestId)?.recordedAt;
   setPending(null);setMessage('已记录 '+command.action+' · 内容版本 '+result.data.version+(actionTime?' · 动作时间 '+actionTime:''));setReload(value=>value+1);await select(result.data.id);
  }catch{if(token===commandEpoch.current&&actorToken===epoch.current)setMessage('响应未完成，原请求标识已保留。请恢复原请求，勿重复新建。');}
  finally{if(token===commandEpoch.current)setBusy(false);}
 }
 function save(){
  const content={...form,description:form.description||null,validTo:form.validTo||null,requestId:crypto.randomUUID(),reason};
  void send(selected?{...content,action:'REVISE',target:selected.id,expectedHead:selected.head}:{...content,action:'CREATE'});
 }
 function act(action:'VERIFY'|'APPROVE'|'ENABLE'|'DISABLE'){
  if(!selected)return;const base={requestId:crypto.randomUUID(),reason,target:selected.id,expectedHead:selected.head};
  if(action==='VERIFY')void send({...base,action,versionId:selected.versionId,reviewDigest:selected.reviewDigest,evidenceId:verificationEvidence,meaningAccepted});
  else if(action==='APPROVE')void send({...base,action,versionId:selected.versionId,reviewDigest:selected.reviewDigest});
  else void send({...base,action});
 }
 const unchanged=selected!==null&&Object.entries(form).every(([key,value])=>value===(selected[key as keyof LocationUsageTypeItem]??''));
 const canSend=!busy&&!pending&&/\S/u.test(reason)&&permissions?.human===true;
 return <div className="workbench usage-types-workbench"><aside><div className="brand">HDIP<span>LOCATION USAGE TYPES</span></div><h1>地点用途字典</h1><p className="aside-note">后勤用途维护<br/>P3-07 · 合成研发环境</p><a className="nav" href="/admin/vnext/catalog">治理目录</a><a className="nav" href="/admin/vnext/departments">组织工作台</a><a className="nav active" href="/admin/vnext/location-usage-types" aria-current="page">地点用途字典</a><div className="scope-note">全院统一用途编码<br/>用途含义通过独立核验和审批<br/>启停直接记录人、时间和理由</div></aside><main>
  <header><div><span className="eyebrow">LOCATION / PURPOSE DICTIONARY</span><h2>维护用途定义与使用状态</h2></div><label>合成验证身份<select aria-label="合成验证身份" value={actor} onChange={event=>switchActor(event.target.value)}><option value="maker">编制者 · Maker</option><option value="reviewer">独立核验与审批人 · Reviewer</option><option value="maker-alias">编制者别名 · 同一身份</option><option value="outsider">无权限身份</option><option value="service">服务身份</option></select></label></header>
  <p>编码与用途含义固定。名称或说明修订生成新内容版本；含义变化请另建用途。停用后原地点使用声明仍保留，重新启用时核验其余依赖。</p>
  <p className="usage-permissions">当前权限：{permissions?`${permissions.human?'人类身份':'非人类身份'} · ${permissions.read?'可读':'不可读'} · ${permissions.write?'可维护':'不可维护'} · ${permissions.verify?'可核验':'不可核验'} · ${permissions.review?'可审批':'不可审批'}`:'正在读取'}；服务器在每次操作时重新核验。</p>
  <div className="toolbar"><label>业务时间 B（可选）<input aria-label="用途业务查询时间" value={businessAt} onChange={event=>changeQueryTime('B',event.target.value)} placeholder="YYYY-MM-DDTHH:mm:ss"/></label><label>记录认知时间 R（空为当前）<input aria-label="记录认知时间" value={recordAsOf} onChange={event=>changeQueryTime('R',event.target.value)} placeholder="YYYY-MM-DDTHH:mm:ss"/></label><button disabled={busy} onClick={()=>{setReload(value=>value+1);if(selected)void select(selected.id);}}>刷新查询</button><button disabled={busy||!!pending||historicalQuery} onClick={()=>{++epoch.current;setSelected(null);setHistory([]);setForm({...emptyForm});setMeaningAccepted(false);setVerificationEvidence('');setMessage('填写来源版本和受控材料后保存用途草稿。');}}>新建用途</button></div>
  {historicalQuery?<p>正在只读查询 B {businessAt||'当前'} / R {recordAsOf||'当前'}。内容版本按 R 读取；显式 B 单独评价内容期间及启停状态。清空 B、R 后可维护当前条目。</p>:null}
  <div className="message" role="status">{message||'选择一个用途，核对内容版本、启停及历史。'}</div>
  {pending?.actor===actor?<section className="usage-pending" aria-label="待恢复请求"><p>原请求：<code>{pending.command.requestId}</code> · {pending.command.action}</p><button disabled={busy} onClick={()=>void send(pending.command)}>恢复原请求</button><p>恢复会重检当前权限；使用同一请求标识读取或准确重放原结果。</p></section>:null}
  <div className="panels"><section className="list"><div className="section-title">用途条目 <span>{items.length} 项</span></div>{items.map(item=><button disabled={busy} className={'entry '+(selected?.id===item.id?'selected':'')} key={item.id} onClick={()=>void select(item.id)}><code>{item.code}</code><b>{item.name}</b><span>{item.status} · 内容 v{item.version} · {item.enabled?'启用':'停用'}</span></button>)}<div className="pagination"><button disabled={!after} onClick={()=>setAfter(undefined)}>首页</button><button disabled={!next} onClick={()=>setAfter(next??undefined)}>下一页</button></div></section><section className="detail">
   <div className="detail-heading"><h3>{selected?selected.name:'新建用途定义'}</h3>{selected?<span className="badge">{selected.status} · {selected.enabled?'启用':'停用'}</span>:null}</div>
   {selected?<p className="provenance">稳定 ID：{selected.id}<br/>内容版本：{selected.versionId} · v{selected.version}<br/>内容 R：{selected.recordedAt}<br/>期待 Head：{selected.head}<br/>准确复核摘要：{selected.reviewDigest}</p>:null}
   {selected&&selected.applicableAtBusinessTime!==null?<p>指定业务时间的内容期间：{selected.applicableAtBusinessTime?'覆盖该时点':'不覆盖该时点'}；该 B/R 下用途{selected.enabled?'启用':'停用'}。</p>:null}
   <div className="usage-form"><label>用途编码<input aria-label="用途编码" disabled={!!selected} value={form.code} onChange={event=>put('code',event.target.value)}/></label><label>用途名称<input aria-label="用途名称" value={form.name} onChange={event=>put('name',event.target.value)}/></label><label className="usage-wide">用途含义<textarea aria-label="用途含义" disabled={!!selected} value={form.meaning} onChange={event=>put('meaning',event.target.value)}/></label><label className="usage-wide">用途说明<textarea aria-label="用途说明" value={form.description} onChange={event=>put('description',event.target.value)}/></label><label>业务起始<input aria-label="业务起始" readOnly={!!selected} value={form.validFrom} onChange={event=>put('validFrom',event.target.value)}/></label><label>业务结束（空为无界）<input aria-label="业务结束" value={form.validTo} onChange={event=>put('validTo',event.target.value)}/></label></div>
   <label>已发布来源<select aria-label="已发布来源" value={sources.some(item=>item.id===form.sourceId)?form.sourceId:''} onChange={event=>{const source=sources.find(item=>item.id===event.target.value);if(source)setForm(current=>({...current,sourceId:source.id,sourceVersionId:source.versionId}));}}><option value="">选择来源，或填写准确历史引用</option>{sources.map(source=><option key={source.id} value={source.id}>{source.code} · {source.payload.name} · v{source.version}</option>)}</select></label>
   <div className="usage-form"><label>来源稳定 ID<input aria-label="来源稳定ID" value={form.sourceId} onChange={event=>put('sourceId',event.target.value)}/></label><label>来源版本 ID<input aria-label="来源版本ID" value={form.sourceVersionId} onChange={event=>put('sourceVersionId',event.target.value)}/></label><label className="usage-wide">受控材料 ID<input aria-label="受控材料ID" value={form.evidenceId} onChange={event=>put('evidenceId',event.target.value)}/></label></div>
   <label>操作理由<textarea aria-label="操作理由" value={reason} onChange={event=>setReason(event.target.value)}/></label>
   <div className="actions"><button disabled={!canSend||!permissions?.write||historicalQuery} onClick={save}>{selected?'保存名称或说明修订':'保存用途草稿'}</button>{selected?<><button disabled={!canSend||!permissions?.verify||!unchanged||selected.status==='APPROVED'||historicalQuery||!meaningAccepted||!materialRead} onClick={()=>act('VERIFY')}>独立核验当前版本</button><button disabled={!canSend||!permissions?.review||!unchanged||selected.status!=='REVIEW'||!selected.verification?.meaningAccepted||historicalQuery} onClick={()=>act('APPROVE')}>独立审批当前版本</button><button disabled={!canSend||!permissions?.write||!unchanged||selected.status!=='APPROVED'||selected.enabled||historicalQuery} onClick={()=>act('ENABLE')}>启用用途</button><button disabled={!canSend||!permissions?.write||!unchanged||selected.status!=='APPROVED'||!selected.enabled||historicalQuery} onClick={()=>act('DISABLE')}>停用用途</button></>:null}</div>
   {selected&&selected.status!=='APPROVED'?<section><h4>独立核验材料</h4><label>核验材料 ID<input aria-label="核验材料ID" value={verificationEvidence} onChange={event=>{++materialEpoch.current;setMaterial(null);setMaterialRead(false);setVerificationEvidence(event.target.value);setMeaningAccepted(false);}}/></label><button disabled={busy||!verificationEvidence||!form.sourceVersionId||!permissions?.read} onClick={()=>void loadMaterial()}>读取核验原材料</button>{material?<WorkspaceMaterial key={material.token} id={material.id} bytesBase64={material.bytesBase64} onRead={()=>{if(material.token===materialEpoch.current)setMaterialRead(true);}}/>:null}<label className="usage-check"><input type="checkbox" disabled={!materialRead} checked={meaningAccepted} onChange={event=>setMeaningAccepted(event.target.checked)}/>已核对用途含义及准确来源版本</label></section>:null}
   {selected&&!unchanged?<p>当前表单有未保存修改。核验、审批或启停前，请保存修订或重新读取原版本。</p>:null}
   {selected?<section className="usage-history"><h4>启停历史</h4><table aria-label="用途启停历史"><thead><tr><th>动作</th><th>操作人</th><th>数据库实际时间</th><th>理由</th></tr></thead><tbody>{selected.events.map(event=><tr key={event.id}><td>{event.action==='ENABLE'?'启用':'停用'}</td><td>{event.actor}</td><td>{event.recordedAt}</td><td>{event.reason}</td></tr>)}</tbody></table><h4>不可变内容版本</h4>{history.map(item=><article className="history" key={item.versionId}><b>v{item.version} · {item.status} · {item.name}</b><time>R {item.recordedAt} · B {item.validFrom} → {item.validTo??'无界'}</time><p>{item.description}</p><button disabled={busy} onClick={()=>void select(item.id,item.versionId)}>读取准确内容版本</button></article>)}</section>:null}
  </section></div>
 </main></div>;
}
