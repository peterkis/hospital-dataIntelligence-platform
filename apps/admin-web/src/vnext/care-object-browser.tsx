import {useState} from 'react';
import {CareOperationPanel} from './care-operation.js';
import {careNames,carePipelines,careStatus,record,text,type CareKind} from './care-model.js';
import type {ReferenceChoices} from './department-form.js';
import {careMaintenance} from './care-maintenance.js';
import {careError,careExecute} from './care-request.js';

interface ObjectRow {id:string;name:string;code:string;type:string;campus:string;head:string;state:string}
function objectRow(value:unknown):ObjectRow {
 const row=record(value),versions=Array.isArray(row['versions'])?row['versions']:[],version=record(row['version']??versions.at(-1)),facts=record(version['facts']??row['facts']),binding=record(record(row['binding'])['binding']),applicability=record(row['applicability']??row['scope']);
 return {id:text(row['id']),name:text(facts['unitName']??facts['nursingName']??facts['wardName']??facts['locationName'])||text(row['kind'])+' '+text(row['id']),code:text(facts['unitCode']??facts['nursingCode']??facts['wardCode']??facts['locationCode']??record(facts['adoption'])['code']),type:text(facts['unitType']??facts['wardType']??facts['locationType']??row['kind']??applicability['purpose']??applicability['capabilityType']??applicability['targetType']),campus:text(row['campusId']??record(binding['campus']??applicability['campus'])['id']),head:text(row['head']??version['number']),state:careStatus(row['state']??version['action'])};
}

/** Bounded native pages and exact identities; the table is only a projection. */
export function CareObjectBrowser({actor,kind,campus,choices,onMaintain}:{actor:string;kind:CareKind;campus:'NORTH'|'SOUTH';choices:ReferenceChoices;onMaintain:(value:Awaited<ReturnType<typeof careMaintenance>>)=>void}) {
 const pipeline=carePipelines[kind],[rows,setRows]=useState<ObjectRow[]>([]),[selected,setSelected]=useState<string|null>(null),[after,setAfter]=useState<string|null>(null),[listGeneration,setListGeneration]=useState(0);
 const [error,setError]=useState(''),[maintaining,setMaintaining]=useState(false),[history,setHistory]=useState<Record<string,unknown>|null>(null);
 const initial=kind==='LOCATION'?{limit:50}:{campus,limit:50};
 const [query,setQuery]=useState<Record<string,unknown>>(initial),[paging,setPaging]=useState(false),[loaded,setLoaded]=useState(false);
 function listed(value:unknown,body:Record<string,unknown>){const page=record(value);setQuery(body);setRows(Array.isArray(page['items'])?page['items'].map(objectRow):[]);setAfter(typeof page['nextAfterId']==='string'?page['nextAfterId']:null);setLoaded(true);}
 async function page(cursor:string|null){if(!pipeline.list)return;setPaging(true);setError('');try{const {after:_after,...filters}=query,body={...filters,...(cursor?{after:cursor}:{})};listed(await careExecute(actor,pipeline.list,body),body);setListGeneration(generation=>generation+1);}catch(error){setError(careError(error));}finally{setPaging(false);}}
 async function maintain(){if(!selected)return;setMaintaining(true);setError('');try{onMaintain(await careMaintenance(actor,kind,selected));}catch(error){setError(careError(error));}finally{setMaintaining(false);}}
 return <section aria-label="已提交事实与历史"><h3>{careNames[kind]} · 已提交事实</h3>
 {pipeline.list&&<CareOperationPanel key={pipeline.list+listGeneration} actor={actor} operation={pipeline.list} label="查询当前对象" initial={query} choices={choices} enabled={!paging} onResult={listed}/>}
 {loaded&&rows.length===0&&<p role="status">当前授权范围和筛选条件下，本页没有可读记录。</p>}
 {rows.length>0&&<div className="care-object-table"><table><caption>当前页 · {rows.length} 项</caption><thead><tr><th>对象与稳定身份</th><th>代码／类型</th><th>院区</th><th>状态／版本</th><th>操作</th></tr></thead><tbody>{rows.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.id}</small></td><td>{row.code||'—'}<small>{row.type||'—'}</small></td><td>{row.campus||'—'}</td><td>{row.state||'—'}<small>v{row.head||'—'}</small></td><td><button onClick={()=>setSelected(row.id)}>读取详情与历史</button></td></tr>)}</tbody></table></div>}
 {pipeline.list&&<div className="action-bar"><button disabled={paging||!after} onClick={()=>void page(after)}>{paging?'正在读取…':'下一页'}</button><button disabled={paging} onClick={()=>void page(null)}>从首页查询</button></div>}
 {selected&&<p className="care-bound-reference">稳定身份：{selected} <button onClick={()=>{setSelected(null);setHistory(null);}}>清除选择</button> <button disabled={maintaining} onClick={()=>void maintain()}>以当前准确头准备维护草稿</button></p>}{error&&<p role="alert">{error}</p>}
 {pipeline.query&&<CareOperationPanel key={pipeline.query+(selected??'')} actor={actor} operation={pipeline.query} label="读取业务时点 B／记录时点 R" initial={selected?{id:selected}:{}} choices={choices}/>}
 {pipeline.history&&<CareOperationPanel key={pipeline.history+(selected??'')} actor={actor} operation={pipeline.history} label="读取历史时间线" initial={selected?{[kind==='LIFECYCLE'?'inputId':'id']:selected}:{}} choices={choices} onResult={value=>setHistory(record(value))}/>}
 {pipeline.exact&&<CareOperationPanel key={pipeline.exact+(selected??'')} actor={actor} operation={pipeline.exact} label="读取准确版本" initial={selected?{id:selected}:{}} choices={choices}/>}
 {pipeline.diff&&<CareOperationPanel key={pipeline.diff+(selected??'')} actor={actor} operation={pipeline.diff} label="比较版本差异" initial={selected?{id:selected}:{}} choices={choices}/>}
 </section>;
}
