import {useRef,useState} from 'react';
import type {VNextOperations as Operations} from '@hospital-data-intelligence/generated-api-client';
import {Button} from '../components/ui/button.js';
import {Input} from '../components/ui/input.js';
import {displayTime} from './workspace-fields.js';
type History=Operations['getDepartmentVersionHistory']['responses'][200]['content']['application/json'];
export function DepartmentRecords({items,busy,onEditor,onMore}: {items: History[];busy: boolean;onEditor: ()=>void;onMore?: (()=>void)|undefined}) {
  const [filter,setFilter]=useState(''),[selected,setSelected]=useState<string|null>(null);
  const table=useRef<HTMLDivElement>(null);
  const close=()=>{const id=selected;setSelected(null);requestAnimationFrame(()=>table.current?.querySelector<HTMLButtonElement>(`[data-department-id="${id}"]`)?.focus());};
  const shown=items.filter(item=>!filter||[item.initialCode,...item.versions.map(version=>version.facts.name)].some(value=>value.toLocaleLowerCase().includes(filter.toLocaleLowerCase())));
  const current=items.find(item=>item.id===selected),head=current?.versions.at(-1);
  return <section className="reference-records" aria-label="逻辑科室记录">
    <div className="reference-records__toolbar"><label>筛选已载入科室<Input value={filter} onChange={event=>setFilter(event.target.value)} placeholder="名称或院内编码" disabled={busy}/></label><Button variant="outline" onClick={onEditor} disabled={busy}>草稿与申请</Button></div>
    <p className="muted">显示当前授权已载入的接受记录，名称来自最近接受版本；当前业务有效性请在时点核对入口读取。</p>
    <div className="reference-records__layout" data-peek={!!current}>
      <div ref={table} className="reference-records__table"><table><thead><tr><th>最近接受名称</th><th>院内编码</th><th>科室类型</th><th>版本</th></tr></thead><tbody>{shown.map(item=>{const version=item.versions.at(-1);return <tr key={item.id} aria-selected={item.id===selected}><td><button data-department-id={item.id} className="reference-records__name" disabled={busy} onClick={()=>setSelected(item.id)}>{version?.facts.name??'名称不可读取'}</button></td><td>{item.initialCode}</td><td>{version?.facts.orgType??'—'}</td><td>{version?.number??'—'}</td></tr>;})}</tbody></table>{!busy&&!shown.length&&<p className="empty">{filter?'已载入记录中没有匹配项。':'当前没有可读取的科室记录。'}</p>}{onMore&&<Button variant="outline" disabled={busy} onClick={onMore}>载入更多科室</Button>}</div>
      {current&&head&&<aside className="reference-records__peek" aria-label="科室记录详情"><div className="section-heading"><h2>{head.facts.name}</h2><Button variant="ghost" onClick={close}>关闭详情</Button></div><dl><dt>院内编码</dt><dd>{current.initialCode}</dd><dt>简称</dt><dd>{head.facts.shortName||'未填写'}</dd><dt>职责说明</dt><dd>{head.facts.description||'未填写'}</dd></dl><h3>已接受版本历史</h3>{current.versions.map(version=><div className="history" key={version.id}><strong>{version.facts.name} · v{version.number}</strong><p>业务期间 {displayTime(version.valid_from)} → {version.valid_to?displayTime(version.valid_to):'无界'}</p><p className="muted">记录于 {displayTime(version.recorded_at)}</p></div>)}<Button variant="outline" onClick={onEditor} disabled={busy}>打开维护与时点核对</Button></aside>}
    </div>
  </section>;
}
