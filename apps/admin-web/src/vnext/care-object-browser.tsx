import {UnitRecordBrowser} from './unit-record-browser.js';
import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link,useLocation,useNavigate,useParams,useSearchParams} from 'react-router';
import {Button} from '../components/ui/button.js';
import {Input} from '../components/ui/input.js';
import {CareOperationPanel} from './care-operation.js';
import {careNames,carePipelines,record,text,type CareKind} from './care-model.js';
import type {ReferenceChoices} from './department-form.js';
import {careMaintenance} from './care-maintenance.js';
import {careError,careExecute} from './care-request.js';
import {careDate,careDisplay,careRecordView,careTime,careUuid} from './care-record-view.js';
import './care-record-browser.css';

interface Props {permissionError?:boolean;loadingPermissions?:boolean;actor:string;kind:CareKind;campus:'NORTH'|'SOUTH';choices:ReferenceChoices;canRead:boolean;canWrite:boolean;readRestricted:boolean;onCreate:()=>void;onMaintain:(value:Awaited<ReturnType<typeof careMaintenance>>)=>void}
/** Native Owner reads feed a bounded table. A relation is never reduced to a tree parent. */
export function CareObjectBrowser(props:Props){return props.kind==='UNIT'?<UnitRecordBrowser {...props}/>:<LegacyCareObjectBrowser {...props}/>;}
function LegacyCareObjectBrowser({actor,kind,campus,choices,canRead,canWrite,readRestricted,onCreate,onMaintain}:Props){
 const pipeline=carePipelines[kind],navigate=useNavigate(),location=useLocation(),[params,setParams]=useSearchParams(),route=useParams();
 const selected=careUuid(route['recordId'])?route['recordId']:undefined;
 const [search,setSearch]=useState(''),[error,setError]=useState(''),[maintaining,setMaintaining]=useState(false);
 const listRef=useRef<HTMLDivElement>(null),previousSelection=useRef<string|undefined>(selected);
 const campusId=careUuid(params.get('campusId'))?params.get('campusId')!:'',departmentId=careUuid(params.get('departmentId'))?params.get('departmentId')!:'',after=careUuid(params.get('after'))?params.get('after')!:'',date=careDate(params.get('on'));
 const state=['ACTIVE','SUSPENDED','CLOSED','RETIRED','NOT_EFFECTIVE'].includes(params.get('state')??'')?params.get('state')!:'';
 const filter:Record<string,unknown>={...(kind==='LOCATION'?{}:{campus}),limit:50,...(campusId?{campusId}:{}),...(['UNIT','NURSING'].includes(kind)&&departmentId?{departmentId}:{}),...(after?{after}:{}),...(date?{businessAt:date+'T00:00:00'}:{})};
 const list=useQuery({queryKey:['care-records',actor,kind,filter],queryFn:()=>careExecute(actor,pipeline.list!,filter),enabled:canRead&&!!pipeline.list&&(kind!=='LOCATION'||!!campusId),retry:false});
 const detail=useQuery({queryKey:['care-record',actor,kind,selected,date],queryFn:()=>careExecute(actor,pipeline.query!,{id:selected,...(date?{businessAt:date+'T00:00:00'}:{})}),enabled:canRead&&!!selected&&!!pipeline.query,retry:false});
 const history=useQuery({queryKey:['care-history',actor,kind,selected],queryFn:()=>careExecute(actor,pipeline.history!,{id:selected}),enabled:canRead&&!!selected&&!!pipeline.history&&kind!=='LIFECYCLE',retry:false});
 const page=record(list.data),rows=(Array.isArray(page['items'])?page['items']:[]).map(value=>careRecordView(value,kind,choices));
 const shown=rows.filter(row=>(!state||row.state===state)&&(!search||[row.name,row.code].some(value=>value.toLocaleLowerCase().includes(search.toLocaleLowerCase()))));
 const current=detail.data?careRecordView(detail.data,kind,choices):null;
 const historyData=record(history.data),versions=Array.isArray(historyData['versions'])?historyData['versions'].map(record):[];
 const peek=!!record(location.state)['carePeek'];
 function filters(values:Record<string,string>){setParams(previous=>{const next=new URLSearchParams(previous);next.delete('after');for(const [key,value] of Object.entries(values))value?next.set(key,value):next.delete(key);return next;},{replace:true});}
 function open(id:string){navigate(`/care-space/${kind}/${id}${location.search}`,{state:{carePeek:true}});}
 function close(){if(peek)navigate(-1);else navigate(`/care-space/${kind}${location.search}`);}
 useEffect(()=>{if(!selected&&previousSelection.current){const id=previousSelection.current;requestAnimationFrame(()=>{const trigger=listRef.current?.querySelector<HTMLButtonElement>(`button[data-record-id="${id}"]`);(trigger??listRef.current)?.focus({preventScroll:true});});}previousSelection.current=selected;},[selected]);
 useEffect(()=>{if(!selected)return;function escape(event:KeyboardEvent){if(event.key==='Escape'&&!maintaining){event.preventDefault();close();}}window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[selected,peek,maintaining]);
 async function maintain(){if(!selected||!canWrite)return;setMaintaining(true);setError('');try{onMaintain(await careMaintenance(actor,kind,selected));}catch(cause){setError(careError(cause));}finally{setMaintaining(false);}}
 return <section className={'record-workspace'+(selected?' has-detail':'')+(selected&&!peek?' is-full-detail':'')} aria-label="组织记录">
 <div className="record-list" ref={listRef} tabIndex={-1}>
 <div className="record-list-heading"><div><h3>{careNames[kind]}记录</h3><p>按院区与业务日期读取；关联关系分别维护。</p></div>{canWrite&&<Button onClick={onCreate}>新增{careNames[kind]}</Button>}</div>
 <div className="record-toolbar" aria-label="记录筛选">
 <label>名称或业务编码<Input value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索当前页"/></label>
 <label>院区<select value={campusId} onChange={event=>filters({campusId:event.target.value})}><option value="">{kind==='LOCATION'?'请选择院区':'当前授权范围的全部院区'}</option>{(choices['organization-master/campus']??[]).map(choice=><option key={choice.value} value={choice.value}>{choice.label.split(' · ').slice(0,2).join(' · ')}</option>)}</select></label>
 {['UNIT','NURSING'].includes(kind)&&<label>逻辑科室<select value={departmentId} onChange={event=>filters({departmentId:event.target.value})}><option value="">全部逻辑科室</option>{(choices['department-master']??[]).map(choice=><option key={choice.value} value={choice.value}>{choice.label.split(' · ').slice(0,2).join(' · ')}</option>)}</select></label>}
 <label>业务日期（上海）<Input type="date" value={date} onChange={event=>filters({on:event.target.value})}/></label>
 <label>状态<select value={state} onChange={event=>filters({state:event.target.value})}><option value="">本页全部状态</option>{['ACTIVE','NOT_EFFECTIVE','SUSPENDED','CLOSED','RETIRED'].map(value=><option key={value} value={value}>{careDisplay(value)}</option>)}</select></label>
 <Button variant="outline" disabled={list.isFetching||!canRead||!pipeline.list||(kind==='LOCATION'&&!campusId)} onClick={()=>void list.refetch()}>刷新</Button>
 </div>
 <div className="record-view-note"><span>{date?`${date} 00:00 起点的业务事实`:'当前业务事实'} · {campus==='NORTH'?'北院区':'南院区'}授权范围 · 每页最多 50 条</span>{(search||state||campusId||departmentId||date)&&<button onClick={()=>{setSearch('');filters({state:'',campusId:'',departmentId:'',on:''});}}>清除筛选</button>}</div>
 {!canRead?<p role="alert">当前身份没有此类记录的读取权限。</p>:kind==='LOCATION'&&!campusId?<p role="status" className="record-empty">先选择院区，查看其物理地点。</p>:list.isPending?<p role="status" className="record-empty">正在读取服务器记录…</p>:list.isError?<p role="alert">记录未能读取：{careError(list.error)}</p>:<>
 <div className="record-table-scroll"><table><caption className="visually-hidden">{careNames[kind]} · 当前页的正式记录</caption><thead><tr><th>名称</th><th>业务编码</th><th>类型</th><th>状态</th><th>有效期</th></tr></thead><tbody>{shown.map(row=><tr key={row.id} aria-selected={selected===row.id}><td><button className="record-name" data-record-id={row.id} onClick={()=>open(row.id)}>{row.name}</button>{row.related.filter(item=>item.label==='逻辑科室'||item.label==='院区').map(item=><small key={item.label}>{item.name}</small>)}</td><td className="record-code">{row.code||'未提供业务编码'}</td><td>{row.type}</td><td><span className={'record-status status-'+row.state}>{row.stateLabel}</span></td><td className="record-period">{careTime(row.validFrom)}<small>至 {row.validTo?careTime(row.validTo):'无固定结束时间'}</small></td></tr>)}</tbody></table></div>
 {!shown.length&&<div className="record-empty"><h4>{rows.length?'当前页没有符合条件的记录':'当前范围暂无可读记录'}</h4><p>{rows.length?'可清除搜索和状态筛选，或继续查看下一页。':'可调整院区、业务日期，或有权限时新增草稿。'}</p></div>}
 <div className="record-pagination"><span>本页显示 {shown.length} / {rows.length} 条{list.isFetching?' · 正在刷新…':''}</span><Button variant="outline" disabled={!after||list.isFetching} onClick={()=>filters({after:''})}>回到首页</Button><Button variant="outline" disabled={!text(page['nextAfterId'])||list.isFetching} onClick={()=>filters({after:text(page['nextAfterId'])})}>下一页</Button></div>
 </>}
 </div>
 {selected&&<aside className="record-detail" aria-label="记录详情"><div className="record-detail-actions"><Button variant="ghost" onClick={close}>返回列表</Button>{peek&&<Button variant="ghost" onClick={()=>navigate(location.pathname+location.search,{replace:true,state:{}})}>全页打开</Button>}</div>
 {!canRead?<p role="alert">当前身份无权读取此记录。</p>:detail.isPending?<p role="status">正在读取记录详情…</p>:detail.isError?<p role="alert">{careError(detail.error)}</p>:current?<>
 <header className="record-detail-heading"><span>{careNames[kind]}</span><h2>{current.name}</h2><span className={'record-status status-'+current.state}>{current.stateLabel}</span></header>
 <dl className="record-properties"><div><dt>业务编码</dt><dd>{current.code||'未提供业务编码'}</dd></div><div><dt>类型</dt><dd>{current.type}</dd></div><div><dt>版本</dt><dd>{current.head?'第 '+current.head+' 版':'未提供'}</dd></div><div><dt>业务生效</dt><dd>{careTime(current.validFrom)}</dd></div><div><dt>业务结束</dt><dd>{current.validTo?careTime(current.validTo):'无固定结束时间'}</dd></div><div><dt>平台记录时间</dt><dd>{careTime(current.recordedAt)}</dd></div><div><dt>来源记录时间</dt><dd>{current.sourceRecordedAt?careTime(current.sourceRecordedAt):'来源时间未知'}</dd></div></dl>
 {current.description&&<p>{current.description}</p>}
 <section className="record-relations"><h3>业务关联</h3><p>下列关联各有独立身份和有效期，不表示唯一父子关系。</p>{current.related.length?<dl>{current.related.map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.name}</dd></div>)}</dl>:<p>此接口未返回关联摘要，请在相应关系视图中核对。</p>}<div className="record-relation-links"><Link to={`/care-space/UNIT_WARD?actor=${encodeURIComponent(actor)}`}>科室与病区关系</Link><Link to={`/care-space/WARD_NURSING?actor=${encodeURIComponent(actor)}`}>病区与护理覆盖</Link><Link to={`/care-space/LOCATION_USE?actor=${encodeURIComponent(actor)}`}>地点使用关系</Link></div></section>
 {canWrite&&!['RETIRED','CLOSED'].includes(current.state)&&<Button disabled={maintaining} onClick={()=>void maintain()}>{maintaining?'正在读取维护依据…':'修改此记录'}</Button>}
 {error&&<p role="alert">{error}</p>}
 <section className="record-history"><h3>变更历史</h3>{history.isPending?<p>正在读取历史…</p>:history.isError?<p role="alert">历史暂不可读取：{careError(history.error)}</p>:versions.length?<ol>{[...versions].reverse().map((version,index)=>{const facts=record(version['facts']);return <li key={text(version['id'])||index}><b>第 {text(version['number']??version['version'])} 版 · {careDisplay(version['action'])}</b><span>{text(facts['unitName']??facts['wardName']??facts['nursingName']??facts['locationName'])}</span><span>生效：{careTime(version['validFrom'])} · 记录：{careTime(version['recordedAt'])}</span><p>{text(version['reason'])||'未提供变更原因'}</p></li>;})}</ol>:<p>此记录未返回可读历史。</p>}{Array.isArray(historyData['codes'])&&<p>保留的历史业务编码：{historyData['codes'].map(text).join('、')||'无'}</p>}</section>
 {readRestricted&&<details className="record-technical"><summary>技术信息与高级历史查询</summary><p>稳定身份：{selected}</p>{pipeline.exact&&<CareOperationPanel actor={actor} operation={pipeline.exact} label="读取指定版本" initial={{id:selected}} choices={choices}/>} {pipeline.diff&&<CareOperationPanel actor={actor} operation={pipeline.diff} label="比较两个版本" initial={{id:selected}} choices={choices}/>}</details>}
 </>:<p>没有返回此记录的可读事实。</p>}</aside>}
 </section>;
}
