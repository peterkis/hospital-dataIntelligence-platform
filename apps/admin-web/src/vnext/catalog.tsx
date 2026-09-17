import {ImportApp} from './imports.js';
import React,{useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {createVNextCatalogClient,type VNextEntry,type VNextCommand,type VNextOutcome,type VNextHistory,type VNextSourceImpact} from '@hospital-data-intelligence/generated-api-client';
import './catalog.css';
import {ContractApp} from './contracts.js';
import {ParameterApp} from './parameters.js';
type ResponsibilityValues=Extract<VNextCommand,{action:'CREATE';kind:'RESPONSIBILITY'}>['values'];
type Impact=VNextSourceImpact;
const choices={authorityScope:['ALL','NORTH','SOUTH'],fieldGroup:['ALL','IDENTITY','CONTACT'],role:['OWNER','STEWARD','COLLABORATOR'],assigneeRole:['SYNTHETIC_OWNER_A','SYNTHETIC_OWNER_B','SYNTHETIC_STEWARD']} as const;
const pick=<T extends string,>(options:readonly T[],value:string|undefined,fallback:T):T=>options.find(option=>option===value)??fallback;

function CatalogApp(){
 const [actor,setActor]=useState('maker');const [scope,setScope]=useState<'BASELINE'|'SYNTHETIC'>(()=>new URLSearchParams(window.location.search).get('scope')==='SYNTHETIC'?'SYNTHETIC':'BASELINE');
 const [kind,setKind]=useState<'DATASET'|'SOURCE'|'RESPONSIBILITY'>(()=>{const value=new URLSearchParams(window.location.search).get('kind');return value==='SOURCE'||value==='RESPONSIBILITY'?value:'DATASET';});
 const [domains,setDomains]=useState<Array<{code:string;name:string;datasets:string[]}>>([]);const [domain,setDomain]=useState('');
 const [items,setItems]=useState<VNextEntry[]>([]);const [total,setTotal]=useState(0);const [page,setPage]=useState(1);
 const [selected,setSelected]=useState<VNextEntry|null>(null);const [history,setHistory]=useState<VNextHistory>([]);
 const [historyUnavailable,setHistoryUnavailable]=useState(false);
 const [retirementReview,setRetirementReview]=useState<{head:string;entry:VNextEntry;impact?:Impact}|null>(null);
 const [publicationImpact,setPublicationImpact]=useState<{head:string;id:string;impact:Impact}|null>(null);
 const [impactCases,setImpactCases]=useState<Array<Record<string,unknown>>>([]);
 const [name,setName]=useState('');const [explanation,setExplanation]=useState('');const [message,setMessage]=useState('');
 const [outcome,setOutcome]=useState<VNextOutcome|null>(null);const [tab,setTab]=useState<'fields'|'dependencies'|'history'>('fields');
 const [creating,setCreating]=useState(false);const [code,setCode]=useState('');const [authority,setAuthority]=useState<NonNullable<ResponsibilityValues['authorityScope']>>('ALL');
 const [responsibilityDataset,setResponsibilityDataset]=useState('ORG07');const [responsibilityRole,setResponsibilityRole]=useState<NonNullable<ResponsibilityValues['role']>>('OWNER');const [fieldGroup,setFieldGroup]=useState<NonNullable<ResponsibilityValues['fieldGroup']>>('ALL');const [assigneeRole,setAssigneeRole]=useState<NonNullable<ResponsibilityValues['assigneeRole']>>('SYNTHETIC_OWNER_A');
 const [from,setFrom]=useState('2026-01-01T00:00:00');const [to,setTo]=useState('2027-01-01T00:00:00');
 const [sourceEvidence,setSourceEvidence]=useState('SYNTHETIC_BOOTSTRAP');const [ownerFilter,setOwnerFilter]=useState('');const [statusFilter,setStatusFilter]=useState<VNextEntry['status']|''>('');
 const [qualificationTime,setQualificationTime]=useState('');const qualificationRequest=useRef(0);
 const detailRequest=useRef(0);
 const listRequest=useRef(0);const [refresh,setRefresh]=useState(0);
 const client=()=>createVNextCatalogClient(window.location.origin,actor);
 async function load(){
  const requestVersion=++listRequest.current;
  const {data,error}=await client().GET('/api/vnext/catalog',{params:{query:{scope,kind,page,...(domain?{domain}:{}),...(ownerFilter?{owner:ownerFilter}:{}),...(statusFilter?{status:statusFilter}:{})}}});
  if(requestVersion!==listRequest.current)return;
  if(error){setItems([]);setTotal(0);setSelected(null);setHistory([]);setMessage(error.message+' ['+error.code+']');return;}
  setItems(data.items);setTotal(data.total);setDomains(data.domains);
 }
 async function detail(id:string,entryScope:'BASELINE'|'SYNTHETIC'=scope){
  const requestVersion=++detailRequest.current;
  setRetirementReview(null);setPublicationImpact(null);setSelected(null);setHistory([]);setHistoryUnavailable(false);setImpactCases([]);
  const [entry,versions]=await Promise.all([client().GET('/api/vnext/catalog/{id}',{params:{path:{id},query:{scope:entryScope}}}),client().GET('/api/vnext/catalog/{id}/history',{params:{path:{id},query:{scope:entryScope}}})]);
  if(requestVersion!==detailRequest.current)return false;
  if(entry.error){setMessage(entry.error.message);return false;}setSelected(entry.data);setName(entry.data.payload.adopted?.name??entry.data.payload.name??'');setExplanation(entry.data.payload.adopted?.explanation??'');
  setQualificationTime(entry.data.validFrom);++qualificationRequest.current;setFrom(entry.data.validFrom);setTo(entry.data.validTo??'');setHistory(versions.data??[]);setHistoryUnavailable(!!versions.error);setCreating(false);
  setAuthority(pick(choices.authorityScope,entry.data.payload.authorityScope,'ALL'));setResponsibilityDataset(entry.data.payload.dataset??'ORG07');setResponsibilityRole(pick(choices.role,entry.data.payload.role,'OWNER'));setFieldGroup(pick(choices.fieldGroup,entry.data.payload.fieldGroup,'ALL'));setAssigneeRole(pick(choices.assigneeRole,entry.data.payload.assigneeRole,'SYNTHETIC_OWNER_A'));
  window.history.replaceState(null,'','?id='+id+'&scope='+entryScope+'&kind='+entry.data.kind);
  return true;
 }
 useEffect(()=>{++detailRequest.current;setSelected(null);setHistory([]);void load();},[actor,scope,kind,page,domain,ownerFilter,statusFilter]);
 useEffect(()=>{if(refresh)void load();},[refresh]);
 useEffect(()=>{const params=new URLSearchParams(window.location.search);const id=params.get('id');if(id){const savedScope=params.get('scope')==='SYNTHETIC'?'SYNTHETIC':'BASELINE';setScope(savedScope);void detail(id,savedScope);}},[]);
 async function send(command:VNextCommand){
  const requestVersion=++detailRequest.current;
  setMessage('正在核验当前权限、版本与目录规则…');
  const {data,error}=await client().POST('/api/vnext/catalog/commands',{body:command});
  if(requestVersion!==detailRequest.current)return;
  if(error){setMessage(error.message+' ['+error.code+']');return;}
  setOutcome(data);setMessage('已保存 · '+data.status+' · 版本 '+data.version);setScope('SYNTHETIC');await detail(data.id,'SYNTHETIC');setRefresh(n=>n+1);
 }
 async function action(action:VNextCommand['action']){
  if(!selected)return;
  const base={scope:'SYNTHETIC' as const,requestId:crypto.randomUUID(),reason:'SYNTHETIC_UI',target:selected.id,expectedHead:selected.head};
  if(action==='REVISE')void send({...base,action,values:selected.kind==='DATASET'?{name,explanation}:selected.kind==='SOURCE'?{name}:{dataset:responsibilityDataset,authorityScope:authority,fieldGroup,role:responsibilityRole,assigneeRole},validFrom:from,validTo:to||null});
  else if(action==='PUBLISH')void send({...base,action,reviewDigest:selected.reviewDigest,...(selected.kind==='SOURCE'&&publicationImpact?.id===selected.id&&publicationImpact.head===selected.head?{impactDigest:publicationImpact.impact.impactDigest}:{})});
  else if(action==='RETIRE'&&retirementReview?.head===selected.head&&retirementReview.entry.id===selected.id)void send({...base,action,reviewDigest:retirementReview.entry.reviewDigest,...(selected.kind==='SOURCE'&&retirementReview.impact?{impactDigest:retirementReview.impact.impactDigest}:{})});
  else if(action==='SUBMIT'||action==='REJECT')void send({...base,action});
 }
 async function refreshReview(){
  if(!selected)return;
  if(await detail(selected.id,selected.scope))setMessage('已从当前 API 载入 exact 版本与复核摘要。');
 }
 async function loadPublicationImpact(){
  if(!selected)return;const requestVersion=detailRequest.current;
  const response=await client().GET('/api/vnext/sources/{id}/change-impact',{params:{path:{id:selected.id},query:{scope:selected.scope,action:'PUBLISH'}}});
  if(requestVersion!==detailRequest.current)return;
  if(response.error){setMessage(response.error.message);return;}
  setPublicationImpact({head:selected.head,id:selected.id,impact:response.data});
 }
 async function loadRetirementReview(){
  if(!selected)return;
  const accepted=history.findLast(h=>h.status==='PUBLISHED'||h.status==='RETIRED');if(accepted?.status!=='PUBLISHED')return;
  const requestVersion=detailRequest.current;
  const review=await client().GET('/api/vnext/catalog/{id}',{params:{path:{id:selected.id},query:{scope:selected.scope,asOf:accepted.recordedAt}}});
  if(requestVersion!==detailRequest.current)return;
  if(review.error){setMessage(review.error.message);return;}
  let impact:Impact|undefined;
  if(selected.kind==='SOURCE'){
   const response=await client().GET('/api/vnext/sources/{id}/change-impact',{params:{path:{id:selected.id},query:{scope:selected.scope,action:'RETIRE'}}});
   if(requestVersion!==detailRequest.current)return;
   if(response.error){setMessage(response.error.message);return;}impact=response.data;
  }
  setRetirementReview({head:selected.head,entry:review.data,...(impact?{impact}:{})});
 }
 function create(){
  const base={action:'CREATE' as const,scope:'SYNTHETIC' as const,code,validFrom:from,validTo:to||null,requestId:crypto.randomUUID(),reason:'SYNTHETIC_UI'};
  if(kind==='SOURCE')void send({...base,kind,values:{name,environment:'SYNTHETIC',sourceKind:'MANUAL',deploymentScope:'UNRESOLVED_DECLARATION',businessOwnerRole:'合成归口岗位',technicalRole:'合成技术责任岗位',sourceEvidence}});
  else if(kind==='RESPONSIBILITY')void send({...base,kind,values:{dataset:responsibilityDataset,authorityScope:authority,fieldGroup,role:responsibilityRole,assigneeRole}});
  else void send({...base,kind,values:{name,explanation}});
 }
 const previous=selected?history.findLast(h=>h.version<selected.version):undefined;
 const canonicalTime=(value:string|null|undefined)=>value?(value.includes('.')?value:value+'.').padEnd(26,'0'):value;
 const flatten=(p:VNextEntry['payload']|undefined,b:string|null|undefined,e:string|null|undefined):Record<string,unknown>=>({
  名称:p?.adopted?.name??p?.name,采用解释:p?.adopted?.explanation,环境:p?.['environment'],来源类别:p?.['sourceKind'],部署范围声明:p?.['deploymentScope'],厂商:p?.['vendor'],系统版本:p?.['systemVersion'],业务责任岗位:p?.['businessOwnerRole'],技术责任岗位:p?.['technicalRole'],来源证据:p?.sourceEvidence,接口声明:p?.['interfaceContractRef'],责任数据集:p?.dataset,权威范围:p?.authorityScope,事实字段组:p?.fieldGroup,职责类别:p?.role,责任岗位:p?.assigneeRole,业务起始:canonicalTime(b),业务结束:canonicalTime(e)??'无界'});
 const persistedBefore=flatten(previous?.payload,previous?.validFrom,previous?.validTo);
 const persistedAfter=flatten(selected?.payload,selected?.validFrom,selected?.validTo);
 const persistedDiff=Object.keys(persistedAfter).filter(k=>JSON.stringify(persistedBefore[k])!==JSON.stringify(persistedAfter[k]));
 const responsibilityFields=<><label>责任数据集<select value={responsibilityDataset} onChange={e=>setResponsibilityDataset(e.target.value)}>{domains.flatMap(d=>d.datasets).sort().map(c=><option key={c}>{c}</option>)}</select></label><label>职责类别<select value={responsibilityRole} onChange={e=>setResponsibilityRole(pick(choices.role,e.target.value,'OWNER'))}><option value="OWNER">权威Owner</option><option value="STEWARD">数据管家</option><option value="COLLABORATOR">协同方</option></select></label><label>事实字段组<select value={fieldGroup} onChange={e=>setFieldGroup(pick(choices.fieldGroup,e.target.value,'ALL'))}><option value="ALL">全部</option><option value="IDENTITY">身份说明</option><option value="CONTACT">联系说明</option></select></label><label>合成责任岗位<select value={assigneeRole} onChange={e=>setAssigneeRole(pick(choices.assigneeRole,e.target.value,'SYNTHETIC_OWNER_A'))}><option>SYNTHETIC_OWNER_A</option><option>SYNTHETIC_OWNER_B</option><option>SYNTHETIC_STEWARD</option></select></label><label>权威覆盖范围<select value={authority} onChange={e=>setAuthority(pick(choices.authorityScope,e.target.value,'ALL'))}><option value="ALL">全院合成范围</option><option value="NORTH">北区合成范围</option><option value="SOUTH">南区合成范围</option></select></label></>;
 return <div className="workbench"><aside><div className="brand">HDIP<span>GOVERNANCE CATALOG</span></div><h1>组织人员空间<br/>治理目录</h1><p className="aside-note">目录说明与责任归口<br/>P0-01 · 合成研发环境</p><button className={!domain?'nav active':'nav'} onClick={()=>{setDomain('');setPage(1);}}>全部主题</button>{domains.map(d=><button key={d.code} className={domain===d.code?'nav active':'nav'} onClick={()=>{setDomain(d.code);setPage(1);}}>{d.name}<small>{d.datasets.length}</small></button>)}<a className="nav" href="/admin/vnext/contracts">数据集契约注册表</a><div className="scope-note">元数据登记 ≠ 业务实现<br/>来源材料仍待院方确认</div></aside>
 <main><header><div><span className="eyebrow">CATALOG / CONTROL PLANE</span><h2>可追溯的治理对象说明书</h2></div><label>合成验证身份<select aria-label="合成验证身份" value={actor} onChange={e=>{setActor(e.target.value);setOutcome(null);}}><option value="maker">编制者 · Maker</option><option value="reviewer">复核者 · Reviewer</option><option value="maker-alias">编制者别名 · 同一身份</option><option value="outsider">无授权观察者</option></select></label></header>
 <section className="summary"><div><strong>11</strong><span>治理主题</span></div><div><strong>53</strong><span>来源数据集</span></div><div><strong>866</strong><span>原始字段描述</span></div><p><b>METADATA ONLY</b><br/>业务适配器尚未就绪；数据导入 / 应用由后续 P0-02 至 P0-08 负责。</p></section>
 <section className="toolbar"><label>目录范围<select aria-label="目录范围" value={scope} onChange={e=>{setScope(e.target.value as 'BASELINE'|'SYNTHETIC');setPage(1);setSelected(null);}}><option value="BASELINE">来源基线 · 待院方确认</option><option value="SYNTHETIC">独立合成验证范围</option></select></label><label>对象类型<select aria-label="对象类型" value={kind} onChange={e=>{setKind(e.target.value as typeof kind);setDomain('');setPage(1);setSelected(null);}}><option value="DATASET">数据集目录</option><option value="SOURCE">来源系统</option><option value="RESPONSIBILITY">责任归口</option></select></label><label>拟定 Owner<input aria-label="拟定Owner筛选" value={ownerFilter} onChange={e=>{setOwnerFilter(e.target.value);setPage(1);}}/></label><label>治理状态<select aria-label="治理状态筛选" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as VNextEntry['status']|'')}><option value="">全部</option>{['DRAFT','REVIEW','PUBLISHED','RETIRED'].map(s=><option key={s}>{s}</option>)}</select></label><button onClick={()=>{++detailRequest.current;setCreating(true);setSelected(null);setScope('SYNTHETIC');setName('合成验证条目');setCode(kind==='DATASET'?'ORG07':'SYNTHETIC_'+Date.now());}}>新建合成候选</button></section>
 <div role="status" className="message">{message||'选择一个目录条目，查看原始字段、拟采用解释与治理历史。'}</div>
 <div className="panels"><section className="list"><div className="section-title">目录条目 <span>{total} 项</span></div>{items.map(item=><button className={'entry '+(selected?.id===item.id?'selected':'')} key={item.id} onClick={()=>{setOutcome(null);void detail(item.id);}}><code>{item.code}</code><b>{item.payload.adopted?.name??item.payload.name??item.payload.dataset??item.code}</b><span>{item.status} · v{item.version}</span></button>)}<div className="pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button><span>{page} / {Math.max(1,Math.ceil(total/10))}</span><button disabled={page*10>=total} onClick={()=>setPage(page+1)}>下一页</button></div></section>
 <section className="detail">{creating?<><h3>新建合成{kind==='DATASET'?'目录':kind==='SOURCE'?'来源系统':'责任归口'}</h3><label>技术码<input value={code} onChange={e=>setCode(e.target.value)}/></label><label>名称<input value={name} onChange={e=>setName(e.target.value)}/></label>{kind==='SOURCE'&&<label>来源证据（首次根 / 已发布来源 ID）<input value={sourceEvidence} onChange={e=>setSourceEvidence(e.target.value)}/></label>}{kind==='RESPONSIBILITY'&&responsibilityFields}<label>业务起始<input value={from} onChange={e=>setFrom(e.target.value)}/></label><label>业务结束（空为无界）<input value={to} onChange={e=>setTo(e.target.value)}/></label><button onClick={create}>保存候选</button></>:selected?<><div className="detail-heading"><div><code>{selected.code}</code><h3>{selected.payload.adopted?.name??selected.payload.name??'责任归口'}</h3></div><span className="badge">{selected.status} · v{selected.version}</span></div><p>{String(selected.payload.model?.['grain']??'仅元数据范围；不创建业务对象')}</p><dl className="source-summary"><dt>粒度 / 类型</dt><dd>{String(selected.payload.model?.['grain']??'目录元数据')} / {String(selected.payload.model?.['kind']??selected.kind)}</dd><dt>来源身份声明</dt><dd>{JSON.stringify(selected.payload.model?.['pk']??'DB签发技术身份')}</dd><dt>时态 / 隐私</dt><dd>来源生命周期：{String(selected.payload.model?.['lifecycle']??'目录专用')}；字段隐私：{[...new Set(selected.payload.fields?.map(f=>String(f.original['privacy']))??['INTERNAL'])].join(' / ')}；平台采用解释：半开B、本地微秒R</dd><dt>来源采集 / 当前准备</dt><dd>{selected.payload.original?.['schema_selector']??'目录薄切'}；METADATA_ONLY / adapter NOT_READY</dd><dt>建议Owner / 协同方</dt><dd>{selected.payload.original?.['owner']??'合成岗位'} / {selected.payload.original?.['contributors']??'独立scope'}（来源建议不自动授权）</dd></dl>{historyUnavailable?<p role="alert">完整历史不可用，无法计算持久化版本差异。</p>:<section className="persisted-diff"><h4>持久化版本差异 · {previous?'v'+previous.version:'首次登记'} → v{selected.version}</h4><table aria-label="持久化版本差异"><thead><tr><th>字段</th><th>前一版本</th><th>当前候选 / 版本</th></tr></thead><tbody>{persistedDiff.map(k=><tr key={k}><td>{k}</td><td>{String(persistedBefore[k]??'未登记')}</td><td>{String(persistedAfter[k]??'未登记')}</td></tr>)}</tbody></table></section>}<p className="provenance">来源批准：{selected.payload.original?.['approval_status']??'SYNTHETIC_ONLY'} · {selected.validFrom} → {selected.validTo??'无界'}</p>
 {selected.scope==='BASELINE'?<button onClick={()=>{++detailRequest.current;setCreating(true);setCode(selected.code);setScope('SYNTHETIC');}}>从来源建立合成候选</button>:<div className="editor">{selected.kind==='RESPONSIBILITY'&&responsibilityFields}{selected.kind!=='RESPONSIBILITY'&&<label>候选名称<input aria-label="候选名称" value={name} onChange={e=>setName(e.target.value)}/></label>}{selected.kind==='DATASET'&&<label>拟采用解释<textarea aria-label="拟采用解释" value={explanation} onChange={e=>setExplanation(e.target.value)}/></label>}<p>差异：{selected.payload.adopted?.name??selected.payload.name??''} → {name}；{selected.payload.adopted?.explanation??''} → {explanation}</p><label>修订业务起始<input value={from} onChange={e=>setFrom(e.target.value)}/></label><label>修订业务结束（空为无界）<input value={to} onChange={e=>setTo(e.target.value)}/></label><div className="actions"><button disabled={selected.status==='RETIRED'} onClick={()=>action('REVISE')}>保存新修订</button><button disabled={selected.status!=='DRAFT'} onClick={()=>action('SUBMIT')}>提交复核</button><button disabled={selected.status!=='REVIEW'} onClick={()=>void refreshReview()}>载入复核摘要</button><button disabled={selected.status!=='REVIEW'} onClick={()=>action('REJECT')}>退回复核</button>{selected.kind==='SOURCE'&&<button disabled={selected.status!=='REVIEW'} onClick={()=>void loadPublicationImpact()}>载入发布影响摘要</button>}<button disabled={selected.status!=='REVIEW'} onClick={()=>action('PUBLISH')}>审核并发布</button><button disabled={history.findLast(h=>h.status==='PUBLISHED'||h.status==='RETIRED')?.status!=='PUBLISHED'} onClick={()=>void loadRetirementReview()}>载入废止复核摘要</button><button disabled={retirementReview?.head!==selected.head||retirementReview?.entry.id!==selected.id} onClick={()=>action('RETIRE')}>审核并废止</button></div>{retirementReview?.entry.id===selected.id&&retirementReview.head===selected.head&&<section aria-label="废止复核内容"><h4>永久结束已发布版本 v{retirementReview.entry.version}</h4><p>{retirementReview.entry.payload.adopted?.name??retirementReview.entry.payload.name} · B {retirementReview.entry.validFrom} → {retirementReview.entry.validTo??"无界"}</p><pre>{JSON.stringify(retirementReview.entry.payload,null,2)}</pre>{retirementReview.impact&&<section aria-label="来源废止影响"><h4>拟废止影响 · 新建问题 {retirementReview.impact.opening.length+retirementReview.impact.contractOpening.length} · 关闭问题 {retirementReview.impact.closing.length+retirementReview.impact.contractClosing.length}</h4><pre>{JSON.stringify(retirementReview.impact,null,2)}</pre><p>当前下游将生成影响问题；历史引用保留，后续经独立复核废止或合格重发后关闭，不自动替换。</p></section>}<small>废止摘要：{retirementReview.entry.reviewDigest}。将停止新的权威采用并保留历史，需独立复核身份。</small></section>}{publicationImpact?.id===selected.id&&publicationImpact.head===selected.head&&<section aria-label="来源发布影响"><h4>拟发布影响 · 新建问题 {publicationImpact.impact.opening.length+publicationImpact.impact.contractOpening.length} · 关闭问题 {publicationImpact.impact.closing.length+publicationImpact.impact.contractClosing.length}</h4><pre>{JSON.stringify(publicationImpact.impact,null,2)}</pre></section>}<p><small>复核摘要：{selected.reviewDigest}。权限由服务端校验。</small></p>{selected.kind==='SOURCE'&&<><button onClick={async()=>{const requestVersion=detailRequest.current;const response=await client().GET('/api/vnext/sources/{id}/impact-cases',{params:{path:{id:selected.id},query:{scope:selected.scope}}});if(requestVersion!==detailRequest.current)return;if(response.error){setMessage(response.error.message);return;}setImpactCases(response.data);}}>查看影响问题</button><section aria-label="来源影响问题">{impactCases.map(item=><article key={String(item['case_id'])}><b>{String(item['status'])} · {String(item['reason'])}</b><pre>{JSON.stringify(item,null,2)}</pre></article>)}</section><label>资格业务时间（Asia/Shanghai）<input aria-label="资格业务时间" value={qualificationTime} onChange={e=>{++qualificationRequest.current;setQualificationTime(e.target.value);setMessage('业务时间已修改，请重新检查来源资格。');}}/></label><button onClick={async()=>{const requestVersion=detailRequest.current;const qualificationVersion=++qualificationRequest.current;const businessAt=qualificationTime;const r=await client().GET('/api/vnext/sources/{id}/qualification',{params:{path:{id:selected.id},query:{scope:selected.scope,businessAt}}});if(requestVersion!==detailRequest.current||qualificationVersion!==qualificationRequest.current)return;setMessage(r.error?r.error.message+' ['+r.error.code+']':'合成来源引用准入通过 · B '+businessAt+' · v'+r.data['version']+'；正式 apply 尚未实现。');}}>检查来源引用资格</button></>}</div>}
 <div className="tabs"><button onClick={()=>setTab('fields')}>原始字段 {selected.payload.fields?.length??0}</button><button onClick={()=>setTab('dependencies')}>依赖与归口</button><button onClick={()=>setTab('history')}>版本历史 / 差异</button></div>
 {tab==='fields'?<div className="field-table"><table><thead><tr><th>字段 / 来源定位</th><th>类型 / 必填</th><th>原始定义</th></tr></thead><tbody>{selected.payload.fields?.map((f,i)=><tr key={i}><td><b>{String(f.original['label'])}</b><code>{String(f.original['code'])}</code><small>{f.pointer}</small></td><td>{String(f.original['type'])}<br/>{String(f.original['required'])}<br/>{String(f.original['privacy'])}<br/>格式：{String(f.original['max_length_or_format'])}<br/>引用：{String(f.original['ref']||'无')}</td><td>{String(f.original['definition'])}<br/><small>{String(f.original['conditional_requirement'])}<br/>{String(f.original['source_trace'])}</small></td></tr>)}</tbody></table></div>:tab==='dependencies'?<pre>{JSON.stringify(selected.payload.dependencies??selected.payload,null,2)}</pre>:<div>{historyUnavailable&&<p role="alert">版本历史不可用：当前身份未获得完整历史维度的读取权限或请求失败。无法展示完整历史差异。</p>}{history.map((h,i)=><article className="history" key={i}><b>v{h.version} · {h.status}</b><time>{h.recordedAt} · B {h.validFrom} → {h.validTo??'无界'}</time><p>{h.payload.adopted?.name??h.payload.name} · {h.payload.adopted?.explanation}</p><button onClick={async()=>{const requestVersion=++detailRequest.current;const r=await client().GET('/api/vnext/catalog/{id}',{params:{path:{id:selected.id},query:{scope:selected.scope,asOf:h.recordedAt}}});if(requestVersion===detailRequest.current&&r.data){setSelected(r.data);setMessage('正在读取历史认知，写入时仍校验当前 head。');}}}>读取此时认知</button></article>)}</div>}</>:<div className="empty"><h3>选择一项，开始核对</h3><p>原始来源、采用解释与发布历史在这里分开呈现。</p></div>}</section></div>
 </main></div>;
}
createRoot(document.getElementById('root')!).render(window.location.pathname.endsWith('/imports')?<ImportApp/>:window.location.pathname.endsWith('/parameter-definitions')?<ParameterApp/>:window.location.pathname.endsWith('/contracts')?<ContractApp/>:<CatalogApp/>);
