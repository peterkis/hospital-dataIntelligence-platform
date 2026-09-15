import React,{useEffect,useRef,useState} from 'react';
import {createVNextCatalogClient,type VNextImportContract,type VNextImportCommand,type VNextEntry,type VNextParameterDefinition} from '@hospital-data-intelligence/generated-api-client';
import {ContractDefinitionEditor} from './contract-definition-editor.js';
import {contractRetirement} from './contract-editor-state.js';

type Definition=VNextImportContract['definition'];
const statusName:Record<string,string>={DRAFT:'草稿',APPROVED:'已批准',PUBLISHED:'已发布',RETIRED:'已废止'};
export function ContractApp(){
 const params=new URLSearchParams(window.location.search);
 const [actor,setActor]=useState('maker');
 const [scope,setScope]=useState<'BASELINE'|'SYNTHETIC'>(params.get('scope')==='SYNTHETIC'?'SYNTHETIC':'BASELINE');
 const [items,setItems]=useState<VNextImportContract[]>([]);const [selected,setSelected]=useState<VNextImportContract|null>(null);
 const [history,setHistory]=useState<VNextImportContract[]>([]);const [total,setTotal]=useState(0);const [page,setPage]=useState(1);
 const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const [reload,setReload]=useState(0);
 const [mode,setMode]=useState<'CURRENT'|'EFFECTIVE'>('CURRENT');const [businessAt,setBusinessAt]=useState('2026-06-01T00:00:00');const [asOf,setAsOf]=useState('');
 const [creating,setCreating]=useState(false);const [catalog,setCatalog]=useState<VNextEntry[]>([]);const [datasetId,setDatasetId]=useState('');const [sourceId,setSourceId]=useState('');
 const [businessKeyText,setBusinessKeyText]=useState('');
 const [profile,setProfile]=useState<'CORE'|'FULL'>('CORE');const [chosen,setChosen]=useState<string[]>([]);
 const [rule,setRule]=useState('SYNTHETIC_UI_1');const [template,setTemplate]=useState('SYNTHETIC_UI_1');const [from,setFrom]=useState('2026-01-01T00:00:00');const [to,setTo]=useState('2027-01-01T00:00:00');
 const [enumField,setEnumField]=useState('');const [enumCodes,setEnumCodes]=useState('');const [enumStatus,setEnumStatus]=useState<'CANDIDATE'|'SYNTHETIC_ADOPTED'>('CANDIDATE');
 const [impact,setImpact]=useState<{action:'PUBLISH'|'RETIRE';id:string;head:string;selectionHead:string;digest:string;closing:Array<Record<string,unknown>>}|null>(null);
 const [impactCases,setImpactCases]=useState<Array<Record<string,unknown>>>([]);
 const [parameters,setParameters]=useState<VNextParameterDefinition[]>([]);const [parameterId,setParameterId]=useState('');
 const [revision,setRevision]=useState<Definition|null>(null);
 const generation=useRef(0);const detailGeneration=useRef(0);
 const client=()=>createVNextCatalogClient(window.location.origin,actor);
 function clear(){++generation.current;++detailGeneration.current;setItems([]);setSelected(null);setRevision(null);setHistory([]);setCatalog([]);setCreating(false);setMessage('');setImpact(null);setImpactCases([]);setParameters([]);setParameterId('');}
 async function loadParameters(context:number,detail?:number){
  const response=await client().GET('/api/vnext/parameter-definitions',{params:{query:{scope,mode:'APPROVED'}}});
  if(context!==generation.current||(detail!==undefined&&detail!==detailGeneration.current))return;
  if(response.error){setParameters([]);setMessage('参数定义选择不可用：'+response.error.code);return;}
  setParameters(response.data.items);
 }
 async function detail(item:VNextImportContract){
  const turn=++detailGeneration.current;const context=generation.current;
  setSelected(item);setHistory([]);setRule(item.definition.ruleVersion);setTemplate(item.definition.templateVersion);setFrom(item.validFrom);setTo(item.validTo??'');setCreating(false);setImpact(null);setImpactCases([]);
  setRevision(structuredClone(item.definition));setParameters([]);if(scope==='SYNTHETIC')void loadParameters(context,turn);
  window.history.replaceState(null,'',`?scope=${scope}&id=${item.id}`);
  const response=await client().GET('/api/vnext/contracts/history',{params:{query:{scope,target:item.id,page:1}}});
  if(context!==generation.current||turn!==detailGeneration.current)return;
  if(response.error){setMessage('完整历史不可读取：'+response.error.message+' ['+response.error.code+']');return;}
  const events=response.data.items;
  for(let next=2;next<=Math.ceil(response.data.total/10);next++){
   const more=await client().GET('/api/vnext/contracts/history',{params:{query:{scope,target:item.id,page:next}}});
   if(context!==generation.current||turn!==detailGeneration.current)return;
   if(more.error){setHistory([]);setMessage('完整历史不可读取：'+more.error.message);return;}
   events.push(...more.data.items);
  }
  setHistory(events);
 }
 useEffect(()=>{
  const turn=++generation.current;++detailGeneration.current;setSelected(null);setHistory([]);setItems([]);
  const query={scope,page,...(asOf?{asOf}:{})};
  const load=mode==='EFFECTIVE'?client().GET('/api/vnext/contracts/effective',{params:{query:{...query,businessAt}}}):client().GET('/api/vnext/contracts/current',{params:{query}});
  void load.then(response=>{
   if(turn!==generation.current)return;
   if(response.error){setMessage(response.error.message+' ['+response.error.code+']');setTotal(0);return;}
   setItems(response.data.items);setTotal(response.data.total);
   const saved=new URLSearchParams(window.location.search).get('id');const item=response.data.items.find(item=>item.id===saved);
   if(item)void detail(item);
  });
  return ()=>{++generation.current;++detailGeneration.current;};
 },[actor,scope,page,mode,reload]);
 async function prepare(){
  const turn=generation.current;setCreating(true);setSelected(null);setHistory([]);setChosen([]);setBusinessKeyText('');setCatalog([]);setParameters([]);setParameterId('');setMessage('正在读取当前已接受的目录与来源版本…');
  const response=await client().GET('/api/vnext/catalog/effective',{params:{query:{scope:'SYNTHETIC',businessAt:from}}});
  if(turn!==generation.current)return;
  if(response.error){setCatalog([]);setMessage(response.error.message+' ['+response.error.code+']');return;}
  setCatalog(response.data.items);setDatasetId('');setSourceId('');setParameters([]);setParameterId('');setMessage('选择独立 CORE 或完整 FULL；条件与引用未就绪时，契约仍只能保持候选。');
  await loadParameters(turn);
 }
 async function send(command:VNextImportCommand){
  const turn=generation.current;setBusy(true);setMessage('正在核验当前权限、固定版本与完整适用期间…');
  try {
   const response=await client().POST('/api/vnext/contracts/commands',{body:command});
   if(turn!==generation.current)return;
   if(response.error){if(response.error.code==='ACCESS_DENIED')clear();setMessage(response.error.message+' ['+response.error.code+']');return;}
   setMessage(`${statusName[response.data.status]} · ${command.action==='VALIDATE'?'校验 '+response.data.decision:'命令已接受'}${response.data.blockers.length?' · '+response.data.blockers.join(' / '):''} · adapter NOT_READY`);
   window.history.replaceState(null,'',`?scope=${scope}&id=${response.data.id}`);
   setReload(value=>value+1);
  } finally {setBusy(false);}
 }
 async function create(){
  const dataset=catalog.find(item=>item.versionId===datasetId);if(!dataset){setMessage('请选择已接受的目录版本。');return;}
  const originals=(dataset.payload.fields??[]).filter(field=>profile==='FULL'||chosen.includes(field.original.code));
  const types=['id','text','date','datetime','integer','decimal','code'] as const;
  const privacy=['INTERNAL','RESTRICTED','HIGH_RESTRICTED'] as const;
  const fields:Definition['fields']=[];
  for(const {original} of originals){
   const type=types.find(type=>type===original.type);const level=privacy.find(level=>level===original.privacy);
   if(!type||!level||!['R','C','O'].includes(original.required)){setMessage('目录字段定义无法生成受控契约。');return;}
   const required=original.required==='R'?'R':original.required==='C'?'C':'O';
   fields.push({code:original.code,type,required,privacy:level,condition:required==='R'?'ALWAYS':required==='C'?'UNRESOLVED':'OPTIONAL',enumValues:original.code===enumField&&enumCodes?enumCodes.split(','):[]});
  }
  const parameter=parameters.find(item=>item.versionId===parameterId);
  const references:Definition['references']=originals.filter(field=>field.original.ref).map(field=>field.original.ref==='GOV09.config_id'&&parameter?{field:field.original.code,target:'GOV09.config_id',status:'DECLARED_PARAMETER',parameterVersionId:parameter.versionId,parameterDigest:parameter.reviewDigest}:{field:field.original.code,target:field.original.ref,status:'BLOCKED_DEPENDENCY'});
  const businessKey=businessKeyText===''?[]:businessKeyText.split(',');
  if(businessKey.length<1||businessKey.length>8||new Set(businessKey).size!==businessKey.length||businessKey.some(key=>!fields.some(field=>field.code===key))){setMessage('请明确填写 1–8 个已纳入的业务键字段代码，逗号分隔且不重复。');return;}
  const definition:Definition & {businessKey:string[]}={businessKey,ruleVersion:rule,templateVersion:template,sourceVersionId:sourceId||null,fields,rules:[],references,codeSets:enumField&&enumCodes&&sourceId?[{field:enumField,codeSystem:'SYNTHETIC_UI_CODES',version:rule,status:enumStatus,codes:enumCodes.split(','),validFrom:from,validTo:to||null,sourceVersionId:sourceId}]:[]};
  await send({action:'CREATE',scope,requestId:crypto.randomUUID(),reason:'SYNTHETIC_CONTRACT_UI',datasetVersionId:datasetId,profile,definition,validFrom:from,validTo:to||null});
 }
 function action(action:'VALIDATE'|'APPROVE'|'PUBLISH'|'RETIRE'|'REVISE'){
  if(!selected)return;
  if(action!=='REVISE'&&action!=='RETIRE'&&revision&&(JSON.stringify(revision)!==JSON.stringify(selected.definition)||rule!==selected.definition.ruleVersion||template!==selected.definition.templateVersion||from!==selected.validFrom||to!==(selected.validTo??''))){setMessage('定义有未保存的修订，请先另存新规则版本，再校验或批准。');return;}
  const base={scope,requestId:crypto.randomUUID(),reason:'SYNTHETIC_CONTRACT_UI',target:selected.id,expectedHead:selected.head};
  if(action==='REVISE'){
   if(!revision)return;
   if(!revision.businessKey?.length){setMessage('修订版本必须明确配置业务唯一键。');return;}
   void send({...base,action,definition:{...revision,businessKey:revision.businessKey,ruleVersion:rule,templateVersion:template},validFrom:from,validTo:to||null});
  }
  else if(action==='RETIRE'){
   const retirement=contractRetirement(history);
   if(!retirement){setMessage('没有可废止的已发布版本，或当前历史尚未完整加载。');return;}
   void send({...base,action,...retirement,...(impact?.action==='RETIRE'&&impact.id===selected.id&&impact.selectionHead===selected.head?{impactDigest:impact.digest,expectedHead:impact.head}:{})});
  }else void send({...base,action,reviewDigest:selected.reviewDigest,...(action!=='VALIDATE'&&impact?.action==='PUBLISH'&&impact.id===selected.id&&impact.selectionHead===selected.head?{impactDigest:impact.digest}:{})});
 }
 async function previewImpact(action:'PUBLISH'|'RETIRE'){
  if(!selected)return;const item=selected;const turn=detailGeneration.current;const context=generation.current;
  const response=await client().GET('/api/vnext/contracts/{id}/change-impact',{params:{path:{id:item.id},query:{scope,action}}});
  if(turn!==detailGeneration.current||context!==generation.current)return;
  if(response.error){setImpact(null);if(response.error.code==='ACCESS_DENIED')clear();setMessage(response.error.message+' ['+response.error.code+']');return;}
  setImpact({action,id:item.id,head:response.data.head,selectionHead:item.head,digest:response.data.impactDigest,closing:response.data.closing});
 }
 async function loadCases(){
  if(!selected)return;const item=selected;const turn=detailGeneration.current;const context=generation.current;
  const response=await client().GET('/api/vnext/contracts/{id}/impact-cases',{params:{path:{id:item.id},query:{scope}}});
  if(turn!==detailGeneration.current||context!==generation.current)return;
  if(response.error){setImpactCases([]);if(response.error.code==='ACCESS_DENIED')clear();setMessage(response.error.message);return;}setImpactCases(response.data);
 }
 async function download(item:VNextImportContract|null=selected){
  if(!item)return;const turn=generation.current;const detail=detailGeneration.current;
  const response=await client().GET('/api/vnext/contracts/{id}/schema',{params:{path:{id:item.id},query:{scope,versionId:item.versionId}}});
  if(turn!==generation.current||detail!==detailGeneration.current)return;
  if(response.error){setMessage(response.error.message);return;}
  const url=URL.createObjectURL(new Blob([JSON.stringify(response.data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`${item.dataset}-${item.profile}-v${item.version}.schema.json`;link.click();URL.revokeObjectURL(url);
 }
 const dataset=catalog.find(item=>item.versionId===datasetId);
 return <div className="workbench"><aside><div className="brand">HDIP<span>IMPORT CONTRACT REGISTRY</span></div><h1>数据集契约<br/>注册表</h1><p className="aside-note">P0-02 · 合成研发环境<br/>字段、规则与发布版本</p><a className="nav" href="/admin/vnext/catalog">治理目录</a><a className="nav active" href="/admin/vnext/contracts">契约维护</a><div className="scope-note">来源仍待院方确认<br/>契约发布不代表 adapter 就绪<br/>不执行文件导入或业务 apply</div></aside><main>
  <header><div><div className="eyebrow">GOVERNED IMPORT CONTRACTS</div><h2>数据如何被接收，由固定契约说明</h2></div><label>合成操作者<select aria-label="合成操作者" disabled={busy} value={actor} onChange={event=>{clear();setActor(event.target.value);}}><option value="maker">提交人</option><option value="reviewer">独立复核人</option><option value="maker-alias">提交人同身份别名</option><option value="outsider">无权限身份</option></select></label></header>
  <div className="summary"><div><strong>{total}</strong><span>当前查询契约</span></div><p>53 份 FULL 来源草案 / 77 条条件<br/><b>METADATA ONLY · adapter NOT_READY</b></p></div>
  <div className="toolbar"><label>范围<select disabled={busy} value={scope} onChange={event=>{clear();setScope(event.target.value==='SYNTHETIC'?'SYNTHETIC':'BASELINE');setPage(1);window.history.replaceState(null,'','?scope='+event.target.value);}}><option value="BASELINE">来源草案</option><option value="SYNTHETIC">合成治理</option></select></label><label>读取语义<select value={mode} onChange={event=>{setMode(event.target.value==='EFFECTIVE'?'EFFECTIVE':'CURRENT');setPage(1);}}><option value="CURRENT">当前版本（含候选）</option><option value="EFFECTIVE">B/R 有效发布</option></select></label><label>业务时点 B<input value={businessAt} onChange={event=>setBusinessAt(event.target.value)}/></label><label>已知时点 R（空为当前）<input value={asOf} onChange={event=>setAsOf(event.target.value)}/></label><button disabled={busy} onClick={()=>setReload(value=>value+1)}>刷新查询</button><button disabled={busy||scope!=='SYNTHETIC'} onClick={()=>void prepare()}>新建契约草稿</button></div>
  <div className="message" role="status">{message}</div><div className="panels"><section className="list"><div className="section-title">契约版本 <span>{total} 项</span></div>{items.map(item=><button key={item.id} className={'entry'+(selected?.id===item.id?' selected':'')} onClick={()=>void detail(item)}><code>{item.dataset} · {item.profile}</code><b>{statusName[item.status]} · v{item.version}</b><span>{item.definition.ruleVersion}</span></button>)}<div className="pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button>{page}<button disabled={page*10>=total} onClick={()=>setPage(page+1)}>下一页</button></div></section>
  <section className="detail">{creating?<><h3>新建受控草稿</h3><p>先在治理目录中建立并发布合成 DATASET 与 SOURCE；这里固定选择其已接受版本。</p><div className="toolbar"><label>目录版本<select value={datasetId} onChange={event=>{setDatasetId(event.target.value);setChosen([]);setBusinessKeyText('');}}><option value="">请选择</option>{catalog.filter(item=>item.kind==='DATASET').map(item=><option key={item.versionId} value={item.versionId}>{item.code} · v{item.version}</option>)}</select></label><label>来源版本<select value={sourceId} onChange={event=>setSourceId(event.target.value)}><option value="">未选择（不能发布）</option>{catalog.filter(item=>item.kind==='SOURCE').map(item=><option key={item.versionId} value={item.versionId}>{item.code} · v{item.version}</option>)}</select></label><label>独立 profile<select value={profile} onChange={event=>setProfile(event.target.value==='FULL'?'FULL':'CORE')}><option value="CORE">CORE（显式选字段）</option><option value="FULL">FULL（完整字段）</option></select></label></div>
   <div className="field-table"><table><thead><tr><th>纳入</th><th>字段</th><th>约束</th><th>原条件</th></tr></thead><tbody>{dataset?.payload.fields?.map(({original})=><tr key={original.code}><td><input type="checkbox" aria-label={'纳入 '+original.code} checked={profile==='FULL'||chosen.includes(original.code)} disabled={profile==='FULL'} onChange={event=>setChosen(values=>event.target.checked?[...values,original.code]:values.filter(value=>value!==original.code))}/></td><td>{original.label}<code>{original.code}</code></td><td>{original.required} · {original.type}<small>{original.privacy}</small></td><td>{original.conditional_requirement}</td></tr>)}</tbody></table></div>
   <div className="toolbar"><label>业务唯一键（字段代码，逗号分隔）<input value={businessKeyText} onChange={event=>setBusinessKeyText(event.target.value)}/></label><label>枚举字段（可选）<select value={enumField} onChange={event=>setEnumField(event.target.value)}><option value="">无</option>{(profile==='FULL'?(dataset?.payload.fields??[]).map(field=>field.original.code):chosen).map(code=><option key={code}>{code}</option>)}</select></label><label>枚举值（逗号分隔，不自动 trim）<input value={enumCodes} onChange={event=>setEnumCodes(event.target.value)}/></label><label>采纳状态<select value={enumStatus} onChange={event=>setEnumStatus(event.target.value==='SYNTHETIC_ADOPTED'?'SYNTHETIC_ADOPTED':'CANDIDATE')}><option value="CANDIDATE">候选（阻断发布）</option><option value="SYNTHETIC_ADOPTED">仅合成采纳</option></select></label></div>
   <label>GOV09 固定参数定义（适用于已选 rule_ref）<select value={parameterId} onChange={event=>setParameterId(event.target.value)}><option value="">未选择，保持依赖未就绪</option>{parameters.map(parameter=><option key={parameter.versionId} value={parameter.versionId}>{parameter.parameterKey} · v{parameter.version} · {parameter.ownerRole}</option>)}</select></label><a href="/admin/vnext/parameter-definitions">维护参数结构定义</a>
  </>:selected?<><div className="detail-heading"><h3>{selected.dataset} · {selected.profile}</h3><span className="badge">{statusName[selected.status]} / v{selected.version}</span></div><p className="provenance">目录版本：{selected.datasetVersionId}<br/>契约版本：{selected.versionId}<br/>规则：{selected.definition.ruleVersion} · 模板：{selected.definition.templateVersion}<br/>源资料摘要：{selected.sourceDraftDigest}</p><div className="field-table"><table><thead><tr><th>字段</th><th>类型 / 隐私</th><th>条件 / 枚举</th></tr></thead><tbody>{selected.definition.fields.map(field=><tr key={field.code}><td>{field.code}<small>{field.required}</small></td><td>{field.type}<small>{field.privacy}</small></td><td>{field.condition}<small>{field.enumValues.join(' / ')}</small></td></tr>)}</tbody></table></div><p>未解析规则 {selected.definition.rules.length} 条 · 未就绪引用 {selected.definition.references.filter(ref=>ref.status==='BLOCKED_DEPENDENCY').length} 项 · 代码集 {selected.definition.codeSets.length} 版</p><details><summary>固定来源条件与引用</summary>{selected.definition.rules.map(rule=><p key={rule.id}>{rule.id} · {rule.field}：{rule.text}（{rule.status}）</p>)}{selected.definition.references.map(ref=><p key={ref.field}>{ref.field} → {ref.target}（{ref.status}）{'parameterVersionId' in ref&&<small>{ref.parameterVersionId} · {ref.parameterDigest}</small>}</p>)}{selected.definition.codeSets.map(codes=><p key={codes.field}>{codes.field} · {codes.codeSystem} / {codes.version} · {codes.status}</p>)}</details><div className="actions"><button disabled={busy} onClick={()=>void download()}>下载此版本 schema</button>{scope==='SYNTHETIC'&&(['VALIDATE','APPROVE','PUBLISH','RETIRE'] as const).map(command=><button key={command} disabled={busy} onClick={()=>action(command)}>{{VALIDATE:'校验契约',APPROVE:'批准此版本',PUBLISH:'发布此版本',RETIRE:'废止发布'}[command]}</button>)}</div>
  </>:<div className="empty">选择契约查看固定字段、来源与版本历史。</div>}
  {selected&&scope==='SYNTHETIC'&&revision&&<ContractDefinitionEditor definition={revision} onChange={setRevision} parameters={parameters} disabled={busy}/>}
  {(creating||(selected&&scope==='SYNTHETIC'))&&<div className="editor"><div className="toolbar"><label>规则版本<input aria-label="规则版本" value={rule} onChange={event=>setRule(event.target.value)}/></label><label>模板版本<input value={template} onChange={event=>setTemplate(event.target.value)}/></label><label>生效时间<input value={from} onChange={event=>setFrom(event.target.value)}/></label><label>结束时间（空为无界）<input value={to} onChange={event=>setTo(event.target.value)}/></label></div><div className="actions"><button disabled={busy} onClick={()=>creating?void create():action('REVISE')}>{creating?'保存契约草稿':'另存新规则版本'}</button></div></div>}
  {selected&&<section><div className="actions"><button onClick={()=>void previewImpact('PUBLISH')}>查看发布影响</button><button onClick={()=>void previewImpact('RETIRE')}>查看废止影响</button><button onClick={()=>void loadCases()}>查看契约影响问题</button></div>{impact&&<div className="provenance"><strong>{impact.action==='RETIRE'?'废止':'发布'}将关闭 {impact.closing.length} 项已冻结义务</strong>{impact.closing.map(row=><p key={String(row['caseId'])}>{String(row['caseId'])} · {String(row['obligationSpans'])}</p>)}<small>审批绑定摘要：{impact.digest}</small></div>}{impactCases.map(row=><div className="history" key={String(row['caseId'])+String(row['eventSequence'])}>{row['eventSequence']===1?'新增义务':'义务已关闭'} · {String(row['obligationSpans'])}<small>来源事件 {String(row['upstreamEvent'])} / 审批 {String(row['assessmentHead'])}</small></div>)}</section>}
  {!!history.length&&<section><h4>原版本与治理历史</h4>{history.map(event=><div className="history" key={event.head}>{statusName[event.status]} · v{event.version} · {event.definition.ruleVersion}<time>{event.recordedAt}</time><small>[{event.validFrom}, {event.validTo??'无界'})</small><button disabled={busy} onClick={()=>void download(event)}>下载 v{event.version} 原版本 schema</button></div>)}</section>}
  </section></div></main></div>;
}
