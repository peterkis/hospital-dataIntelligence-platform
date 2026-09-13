import React,{useEffect,useRef,useState} from 'react';
import {createVNextCatalogClient,type VNextEntry,type VNextParameterDefinition,type VNextParameterCommand} from '@hospital-data-intelligence/generated-api-client';

export function ParameterApp(){
 const [actor,setActor]=useState('maker');const [items,setItems]=useState<VNextParameterDefinition[]>([]);const [selected,setSelected]=useState<VNextParameterDefinition|null>(null);
 const [sources,setSources]=useState<VNextEntry[]>([]);const [system,setSystem]=useState('');const [key,setKey]=useState('');const [group,setGroup]=useState('SYNTHETIC');
 const [type,setType]=useState<'TEXT'|'INTEGER'|'DECIMAL'|'BOOLEAN'>('TEXT');const [codes,setCodes]=useState('');const [description,setDescription]=useState('');
 const [from,setFrom]=useState('2026-01-01T00:00:00');const [to,setTo]=useState('2027-01-01T00:00:00');const [versionId,setVersionId]=useState('');
 const [page,setPage]=useState(1);const [total,setTotal]=useState(0);const [reload,setReload]=useState(0);const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const epoch=useRef(0);
 const client=()=>createVNextCatalogClient(window.location.origin,actor);
 useEffect(()=>{
  const turn=++epoch.current;setSelected(null);setItems([]);setSources([]);
  void Promise.all([client().GET('/api/vnext/parameter-definitions',{params:{query:{scope:'SYNTHETIC',page,...(versionId?{versionId}:{})}}}),client().GET('/api/vnext/catalog/effective',{params:{query:{scope:'SYNTHETIC',businessAt:from}}})]).then(([parameters,catalog])=>{
   if(turn!==epoch.current)return;
   if(parameters.error){setMessage(parameters.error.message+' ['+parameters.error.code+']');setTotal(0);}else{setItems(parameters.data.items);setTotal(parameters.data.total);}
   if(catalog.error){setMessage(catalog.error.message+' ['+catalog.error.code+']');}else setSources(catalog.data.items.filter(item=>item.kind==='SOURCE'));
  });
  return ()=>{++epoch.current;};
 },[actor,page,reload]);
 function choose(item:VNextParameterDefinition){setSelected(item);setSystem(item.systemVersionId);setKey(item.parameterKey);setGroup(item.group);setType(item.definition.valueType);setCodes(item.definition.enumValues.join(','));setDescription(item.definition.description);setFrom(item.validFrom);setTo(item.validTo??'');}
 async function send(command:VNextParameterCommand){
  const turn=epoch.current;setBusy(true);
  try{const response=await client().POST('/api/vnext/parameter-definitions/commands',{body:command});if(turn!==epoch.current)return;
   if(response.error){setMessage(response.error.message+' ['+response.error.code+']');return;}
   setMessage(`${response.data.status==='APPROVED'?'结构定义已批准':'结构草稿已保存'} · v${response.data.version} · 运行参数值 NOT_READY`);setVersionId(response.data.versionId);setReload(n=>n+1);
  }finally{setBusy(false);}
 }
 function save(){
  const revision={scope:'SYNTHETIC' as const,requestId:crypto.randomUUID(),reason:'SYNTHETIC_PARAMETER_UI',systemVersionId:system,group,campus:'SYNTHETIC_ALL' as const,definition:{kind:'VALUE_SCHEMA_V1' as const,valueType:type,enumValues:codes?codes.split(','):[],description},validFrom:from,validTo:to||null};
  if(selected)void send({...revision,action:'REVISE',target:selected.id,expectedCurrentVersion:selected.versionId});
  else void send({...revision,action:'CREATE',parameterKey:key});
 }
 const unchanged=selected&&system===selected.systemVersionId&&group===selected.group&&type===selected.definition.valueType&&codes===selected.definition.enumValues.join(',')&&description===selected.definition.description&&from===selected.validFrom&&to===(selected.validTo??'');
 return <div className="workbench"><aside><div className="brand">HDIP<span>GOVERNED PARAMETER DEFINITIONS</span></div><h1>参数结构定义</h1><p className="aside-note">GOV09 最小元数据<br/>P0-02 · 合成研发环境</p><a className="nav" href="/admin/vnext/catalog">治理目录</a><a className="nav" href="/admin/vnext/contracts">契约注册表</a><a className="nav active" href="/admin/vnext/parameter-definitions">参数结构定义</a><div className="scope-note">定义值类型和允许值<br/>不保存运营参数值<br/>不执行 SQL 或表达式<br/>P3-08 消费能力尚未就绪</div></aside><main>
  <header><h2>将参数结构固定到已批准版本</h2><label>合成操作者<select disabled={busy} value={actor} onChange={event=>{++epoch.current;setSelected(null);setItems([]);setSources([]);setSystem('');setKey('');setGroup('SYNTHETIC');setType('TEXT');setCodes('');setDescription('');setActor(event.target.value);setMessage('');}}><option value="maker">提交人</option><option value="reviewer">独立复核人</option><option value="maker-alias">提交人同身份别名</option><option value="outsider">无权限身份</option></select></label></header>
  <p>权限同时核验精确参数授权、来源 owner 及固定来源版本；owner 名称由服务端复制，不能由表单指定。</p>
  <div className="toolbar"><label>指定原版本 ID（空为当前）<input value={versionId} onChange={event=>setVersionId(event.target.value)}/></label><button onClick={()=>setReload(n=>n+1)}>刷新参数定义</button><button onClick={()=>{setSelected(null);setKey('');setDescription('');}}>新建参数定义</button></div><div className="message" role="status">{message}</div>
  <div className="panels"><section className="list"><div className="section-title">参数定义 <span>{total} 项</span></div>{items.map(item=><button className="entry" key={item.versionId} onClick={()=>choose(item)}><b>{item.parameterKey}</b><code>{item.status} · v{item.version}</code><span>{item.group} · {item.ownerRole}</span></button>)}<div className="pagination"><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页</button>{page}<button disabled={page*10>=total} onClick={()=>setPage(page+1)}>下一页</button></div></section><section className="detail">
   <h3>{selected?'新增不可变修订 / 独立批准':'新建参数结构草稿'}</h3>{selected&&<p className="provenance">固定版本：{selected.versionId}<br/>Owner：{selected.ownerRole}<br/>摘要：{selected.reviewDigest}<br/>状态：{selected.status} · 不代表运行参数已启用</p>}
   <label>来源系统已接受版本<select value={system} onChange={event=>setSystem(event.target.value)}><option value="">请选择</option>{selected&&!sources.some(source=>source.versionId===selected.systemVersionId)&&<option value={selected.systemVersionId}>固定历史来源 · {selected.systemVersionId}</option>}{sources.filter(source=>!selected||source.id===selected.systemObjectId).map(source=><option key={source.versionId} value={source.versionId}>{source.code} · v{source.version}</option>)}</select></label>
   <div className="toolbar"><label>参数键<input disabled={!!selected} value={key} onChange={event=>setKey(event.target.value)}/></label><label>参数组<input value={group} onChange={event=>setGroup(event.target.value)}/></label><label>显式范围<input readOnly value="SYNTHETIC_ALL / GOV09_METADATA"/></label></div>
   <label>声明值类型<select value={type} onChange={event=>{const value=event.target.value;if(value==='TEXT'||value==='INTEGER'||value==='DECIMAL'||value==='BOOLEAN')setType(value);}}><option value="TEXT">文本</option><option value="INTEGER">整数</option><option value="DECIMAL">十进制数</option><option value="BOOLEAN">布尔</option></select></label>
   <label>允许值声明（逗号分隔，不自动 trim）<input value={codes} onChange={event=>setCodes(event.target.value)}/></label><label>结构定义说明<textarea value={description} onChange={event=>setDescription(event.target.value)}/></label>
   <div className="toolbar"><label>参数定义生效时间<input value={from} onChange={event=>setFrom(event.target.value)}/></label><label>参数定义结束时间<input value={to} onChange={event=>setTo(event.target.value)}/></label></div>
   <div className="actions"><button disabled={busy} onClick={save}>{selected?'保存新定义版本':'保存参数定义'}</button>{selected&&<button disabled={busy||!unchanged} onClick={()=>void send({action:'APPROVE',scope:'SYNTHETIC',requestId:crypto.randomUUID(),reason:'SYNTHETIC_PARAMETER_UI',target:selected.id,versionId:selected.versionId,reviewDigest:selected.reviewDigest})}>独立批准当前显示的固定版本</button>}</div>{selected&&!unchanged&&<p>当前有未保存的修改。请另存新版本，或重新选择已保存版本后批准。</p>}
  </section></div></main></div>;
}
