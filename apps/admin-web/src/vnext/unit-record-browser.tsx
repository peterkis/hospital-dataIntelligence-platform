import {useEffect, useRef, useState, type FormEvent, type MouseEvent} from 'react';
import {useQuery} from '@tanstack/react-query';
import {Link, useLocation, useNavigate, useParams, useSearchParams} from 'react-router';
import type {VNextOperations} from '@hospital-data-intelligence/generated-api-client';
import {Button} from '../components/ui/button.js';
import {Input} from '../components/ui/input.js';
import type {ReferenceChoices} from './department-form.js';
import {careMaintenance} from './care-maintenance.js';
import {careExecute, careError} from './care-request.js';
import {DepartmentResponseError} from './department-request.js';
import {careDate, careDisplay, careTime, careUuid} from './care-record-view.js';
import {CareOperationPanel} from './care-operation.js';
import './unit-record-browser.css';

type UnitRead = VNextOperations['getBusinessUnitAsOf']['responses'][200]['content']['application/json'];
type UnitPage = VNextOperations['listBusinessUnits']['responses'][200]['content']['application/json'];
type UnitHistory = VNextOperations['getBusinessUnitHistory']['responses'][200]['content']['application/json'];
type State = UnitRead['state'];
type Props = {
  actor: string; campus: 'NORTH' | 'SOUTH'; choices: ReferenceChoices;
  canRead: boolean; canWrite: boolean; readRestricted: boolean; loadingPermissions?: boolean; permissionError?: boolean;
  onCreate: () => void;
  onMaintain: (value: Awaited<ReturnType<typeof careMaintenance>>) => void;
};
const views: ReadonlyArray<{value: State | ''; label: string}> = [
  {value: 'ACTIVE', label: '当前有效'}, {value: '', label: '全部登记'},
  {value: 'NOT_EFFECTIVE', label: '当前未生效'}, {value: 'SUSPENDED', label: '已暂停'},
  {value: 'CLOSED', label: '已结束'},
];
const stateLabel = (value: State) => views.find(view => view.value === value)?.label ?? '状态暂不可识别';
const denied = (error: unknown) => error instanceof DepartmentResponseError && [401, 403].includes(error.status);
function readError(error: unknown) {
  if (denied(error)) return '当前身份无权读取此范围，请核对授权或切换身份。';
  if (error instanceof DepartmentResponseError && error.status === 404) return '此记录不存在，或当前身份不可读取。';
  return '读取未完成，请重试；已登记的数据不会因此改变。';
}
function displayOf(row: UnitRead) {
  return row.display ?? (row.version ? {
    name: row.version.facts.unitName, code: row.version.facts.unitCode,
    type: row.version.facts.unitType, version: row.version.number,
    validFrom: row.version.validFrom, validTo: row.version.validTo, mode: 'CURRENT' as const,
  } : null);
}
const labelOf = (label: string) => {
  const parts = label.split(' · ');
  return careUuid(parts[0]) ? '名称暂不可读取' : parts.slice(0, 2).join(' · ');
};

/** The first product slice. Other care objects continue to use their existing browser. */
export function UnitRecordBrowser({actor, campus, choices, canRead, canWrite, readRestricted,
  loadingPermissions = false, permissionError = false, onCreate, onMaintain}: Props) {
  const location = useLocation(), navigate = useNavigate(), route = useParams();
  const [params, setParams] = useSearchParams();
  const id = careUuid(route['recordId']) ? route['recordId'] : undefined;
  // A reload/direct link opens a full page even when browser history retained peek state.
  const enteredFromList = useRef(!id);
  const peek = !!id && enteredFromList.current && location.state?.unitPeek === true;
  const rawQ = params.get('q') ?? '', q = rawQ.trim().slice(0, 256);
  const rawState = params.get('state');
  const state: State | '' = rawState === 'ALL' ? '' : views.some(view => view.value === rawState)
    ? rawState as State : 'ACTIVE';
  const campusId = careUuid(params.get('campusId')) ? params.get('campusId')! : '';
  const departmentId = careUuid(params.get('departmentId')) ? params.get('departmentId')! : '';
  const after = careUuid(params.get('after')) ? params.get('after')! : '';
  const date = careDate(params.get('on'));
  const [search, setSearch] = useState(q), [historyOpen, setHistoryOpen] = useState(false);
  const [maintaining, setMaintaining] = useState(false), [operationError, setOperationError] = useState('');
  const listRef = useRef<HTMLDivElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const lastList = useRef(location.state?.unitListContext ?? {top: 0, left: 0, windowY: 0, focusId: ''});
  const restoreOnMount = useRef(!!location.state?.unitListContext);
  const previousId = useRef(id), focusedId = useRef<string | undefined>(undefined);
  const cursorTrail = useRef<string[]>([]), maintenanceToken = useRef(0);
  const filterKey = JSON.stringify([campus, q, state, campusId, departmentId, date]);
  const previousFilter = useRef(filterKey);
  const request = {campus, limit: 20, ...(q ? {q} : {}), ...(state ? {state} : {}),
    ...(campusId ? {campusId} : {}), ...(departmentId ? {departmentId} : {}),
    ...(after ? {after} : {}), ...(date ? {businessAt: date + 'T00:00:00'} : {})};
  const list = useQuery({queryKey: ['care-records', actor, 'UNIT', request],
    queryFn: () => careExecute(actor, 'listBusinessUnits', request) as Promise<UnitPage>,
    enabled: canRead, retry: false, staleTime: 15000, refetchOnWindowFocus: false});
  const detail = useQuery({queryKey: ['care-record', actor, 'UNIT', campus, id, date],
    queryFn: () => careExecute(actor, 'getBusinessUnitAsOf', {id,
      ...(date ? {businessAt: date + 'T00:00:00'} : {})}) as Promise<UnitRead>,
    enabled: canRead && !!id, retry: false, refetchOnWindowFocus: false});
  const history = useQuery({queryKey: ['care-history', actor, 'UNIT', campus, id],
    queryFn: () => careExecute(actor, 'getBusinessUnitHistory', {id}) as Promise<UnitHistory>,
    enabled: canRead && !!id && historyOpen, retry: false, refetchOnWindowFocus: false});
  const rows = canRead && !denied(list.error) ? list.data?.items ?? [] : [];
  const current = canRead && !denied(detail.error) ? detail.data : undefined;
  const display = current ? displayOf(current) : null;
  const listUrl = '/care-space/UNIT' + location.search;
  const filtered = !!(q || campusId || departmentId || date || state !== 'ACTIVE');
  useEffect(() => setSearch(q), [q]);
  useEffect(() => {setHistoryOpen(false); setOperationError(''); setMaintaining(false); return () => {maintenanceToken.current++;};}, [id, campus]);
  useEffect(() => {
    if (!id && canRead && !loadingPermissions && !permissionError && list.data && restoreOnMount.current) {
      restoreOnMount.current = false;
      requestAnimationFrame(() => {
        const saved = lastList.current;
        if (scrollRef.current) {scrollRef.current.scrollTop = saved.top; scrollRef.current.scrollLeft = saved.left;}
        const trigger = listRef.current?.querySelector<HTMLElement>(`[data-record-id="${saved.focusId}"]`);
        (trigger ?? listRef.current)?.focus({preventScroll: true}); window.scrollTo({top: saved.windowY});
      });
    }
  }, [id, canRead, loadingPermissions, permissionError, list.data]);
  useEffect(() => {
    if (filterKey !== previousFilter.current) {
      previousFilter.current = filterKey; cursorTrail.current = [];
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  }, [filterKey]);
  useEffect(() => {
    if (id && current && focusedId.current !== id) {
      detailTitle.current?.focus({preventScroll: true}); focusedId.current = id;
    }
    if (!id && previousId.current) {
      const saved = lastList.current;
      requestAnimationFrame(() => {
        if (scrollRef.current) {scrollRef.current.scrollTop = saved.top; scrollRef.current.scrollLeft = saved.left;}
        const trigger = listRef.current?.querySelector<HTMLElement>(`[data-record-id="${saved.focusId}"]`);
        (trigger ?? listRef.current)?.focus({preventScroll: true});
        window.scrollTo({top: saved.windowY});
      });
      focusedId.current = undefined;
    }
    previousId.current = id;
  }, [id, current]);
  useEffect(() => {
    if (!id) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || maintaining) return;
      if (event.target instanceof Element && event.target.closest('input,select,textarea,[role="dialog"]')) return;
      event.preventDefault(); void navigate(listUrl, {replace: true});
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [id, maintaining, listUrl, navigate]);
  function filters(values: Record<string, string>) {
    setParams(previous => {
      const next = new URLSearchParams(previous); next.delete('after');
      for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
      return next;
    }, {replace: true, state: location.state});
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {event.preventDefault(); filters({q: search.trim()});}
  function open(event: MouseEvent<HTMLAnchorElement>, recordId: string) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    lastList.current = {top: scrollRef.current?.scrollTop ?? 0, left: scrollRef.current?.scrollLeft ?? 0,
      windowY: window.scrollY, focusId: recordId};
    void navigate('/care-space/UNIT/' + recordId + location.search,
      {replace: !!id, state: {unitPeek: true}});
  }
  function scope(next: string) {
    const query = new URLSearchParams(params); query.set('scope', next);
    for (const key of ['after', 'campusId', 'departmentId', 'draft', 'application', 'request']) query.delete(key);
    void navigate('/care-space/UNIT?' + query.toString(), {replace: true});
  }
  function nextPage() {
    if (!list.data?.nextAfterId) return;
    cursorTrail.current.push(after); filters({after: list.data.nextAfterId});
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }
  async function maintain() {
    if (!id || !canWrite || detail.isError) return;
    setMaintaining(true); setOperationError(''); const token = ++maintenanceToken.current;
    try {const query = new URLSearchParams(params); query.set('view', 'edit');
      await navigate('/care-space/UNIT/' + id + '?' + query.toString(), {state: {...location.state, unitListContext: {...lastList.current, focusId: id}}});}
    catch (error) {if (token === maintenanceToken.current) setOperationError(careError(error));}
    finally {if (token === maintenanceToken.current) setMaintaining(false);}
  }
  const reference = (owner: string, value: string | undefined) => {
    if (!value) return '该时点未返回关联';
    const name = choices[owner]?.find(choice => choice.value === value)?.label.split(' · ')[0];
    return name && !careUuid(name) ? name : '关联名称暂不可读取';
  };
  return <section className={'unit-browser' + (id ? peek ? ' unit-browser--peek' : ' unit-browser--full' : '')} aria-label="院区业务单元记录">
    <div className="unit-browser__list record-list" ref={listRef} tabIndex={-1}>
      <h2 className="unit-sr-only">业务单元记录</h2>
      <div className="unit-viewbar">
        <nav className="unit-views" aria-label="业务状态视图">{views.map(view => <button type="button" key={view.value}
          aria-current={view.value === state ? 'page' : undefined}
          onClick={() => filters({state: view.value || 'ALL'})}>{view.label}</button>)}</nav>
        {canWrite && <Button onClick={onCreate}>新增业务单元</Button>}
      </div>
      <div className="unit-toolbar">
        <form className="unit-search" role="search" onSubmit={submitSearch}>
          <label className="unit-sr-only" htmlFor="unit-search">名称或业务编码</label>
          <Input id="unit-search" value={search} maxLength={256} onChange={event => setSearch(event.target.value)}
            onKeyDown={event => {if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();}}
            placeholder="搜索名称或业务编码" autoComplete="off"/>
          <Button variant="outline" type="submit" disabled={!canRead}>搜索</Button>
        </form>
        <label className="unit-scope">治理范围<select value={campus} onChange={event => scope(event.target.value)}>
          <option value="NORTH">北院区</option><option value="SOUTH">南院区</option>
        </select></label>
        <Button variant="ghost" disabled={list.isFetching || !canRead} onClick={() => {void list.refetch(); if (id) void detail.refetch();}}>刷新</Button>
      </div>
      <details className="unit-filters" open={!!(campusId || departmentId || date) || undefined}>
        <summary>筛选条件{campusId || departmentId || date ? ' · 已设置' : ''}</summary>
        <div className="unit-filter-fields">
          <label>院区节点<select value={campusId} onChange={event => filters({campusId: event.target.value})}>
            <option value="">当前授权范围</option>{(choices['organization-master/campus'] ?? []).map(choice =>
              <option key={choice.value} value={choice.value}>{labelOf(choice.label)}</option>)}
          </select></label>
          <label>逻辑科室<select value={departmentId} onChange={event => filters({departmentId: event.target.value})}>
            <option value="">不限科室</option>{(choices['department-master'] ?? []).map(choice =>
              <option key={choice.value} value={choice.value}>{labelOf(choice.label)}</option>)}
          </select></label>
          <label>截至业务日期（上海）<Input type="date" value={date} onChange={event => filters({on: event.target.value})}/></label>
        </div>
        <p>日期按所选日 00:00 查询；留空使用服务器当前时点。关联候选来自已授权读取，名称为登记标签。</p>
      </details>
      <div className="unit-list-note"><span>{date ? date + ' 00:00' : '服务器当前时点'} · {q ? '已按名称 / 编码查询授权范围' : '只显示当前范围内可读记录'}{list.isFetching && list.data ? ' · 正在刷新…' : ''}</span>
        {filtered && <button type="button" onClick={() => {setSearch(''); filters({q: '', state: '', campusId: '', departmentId: '', on: ''});}}>清除筛选</button>}
      </div>
      {loadingPermissions ? <div className="unit-empty" role="status">正在核对读取权限…</div> : permissionError ? <div className="unit-empty" role="alert"><h3>权限信息读取失败</h3><p>暂不能确定此范围的权限；请重新加载后重试。</p><Button variant="outline" onClick={() => window.location.reload()}>重新加载</Button></div> : !canRead ?
        <div className="unit-empty" role="alert"><h3>此范围暂不可读取</h3><p>当前身份没有业务单元读取权限；不能通过修改筛选绕过授权。</p></div> : <>
        {list.isError && <div className="unit-read-error" role="alert">{readError(list.error)}{rows.length > 0 && ' 下方保留上次已读取内容。'}
          <Button variant="ghost" onClick={() => void list.refetch()}>重试读取</Button></div>}
        {list.isPending ? <div className="unit-empty" role="status">正在读取业务单元…</div> : !denied(list.error) && <>
          <div className="unit-table-scroll" ref={scrollRef} aria-label="业务单元表格" tabIndex={0}>
            <table><caption className="unit-sr-only">院区业务单元 · 授权查询结果</caption><thead><tr>
              <th scope="col">名称</th><th scope="col">业务编码</th><th scope="col" className="unit-col-type">类型</th>
              <th scope="col" className="unit-col-relation">关联归属</th><th scope="col">状态</th><th scope="col" className="unit-col-period">有效期</th>
            </tr></thead><tbody>{rows.map(row => {
              const label = displayOf(row), binding = row.binding?.binding;
              return <tr key={row.id} data-selected={id === row.id || undefined}>
                <td><Link className="record-name" data-record-id={row.id} aria-current={id === row.id ? 'true' : undefined}
                  to={'/care-space/UNIT/' + row.id + location.search} onClick={event => open(event, row.id)}>{label?.name || '未返回登记名称'}</Link>
                  {label?.mode === 'REGISTERED' && <small>登记标签 · 非当前有效属性</small>}</td>
                <td className="unit-code">{label?.code || '未返回编码'}</td>
                <td className="unit-col-type">{label ? careDisplay(label.type) : '未返回'}</td>
                <td className="unit-col-relation"><span>{reference('department-master', row.departmentId)}</span><small>{reference('organization-master/campus', binding?.campus.id)}</small></td>
                <td><span className={'unit-status unit-status--' + row.state}>{stateLabel(row.state)}</span></td>
                <td className="unit-col-period">{label ? <>{careTime(label.validFrom)}<small>至 {label.validTo ? careTime(label.validTo) : '无固定结束时间'}</small>{label.mode === 'REGISTERED' && <small>上述为登记版本期间</small>}</> : '未返回'}</td>
              </tr>;
            })}</tbody></table>
            {!rows.length && !list.isError && <div className="unit-empty" role="status"><h3>{filtered ? '没有符合条件的记录' : '当前范围暂无有效记录'}</h3><p>可调整搜索与业务日期，或切换“全部登记”查看其他状态。此结果不代表全院没有记录。</p></div>}
          </div>
          <div className="unit-pagination"><span role="status" aria-live="polite">本页 {rows.length} 条 · 每页最多 20 条</span>
            <Button variant="ghost" disabled={!after || list.isFetching} onClick={() => {cursorTrail.current = []; filters({after: ''});}}>首页</Button>
            <Button variant="ghost" disabled={!cursorTrail.current.length || list.isFetching} onClick={() => filters({after: cursorTrail.current.pop() ?? ''})}>上一页</Button>
            <Button variant="outline" disabled={!list.data?.nextAfterId || list.isFetching} onClick={nextPage}>下一页</Button>
          </div>
        </>}
      </>}
    </div>
    {id && <aside className="record-detail unit-detail" aria-label="业务单元详情">
      <div className="unit-detail__toolbar"><Button variant="ghost" onClick={() => void navigate(listUrl, {replace: true})}>返回列表</Button>
        {peek && <Button variant="ghost" onClick={() => void navigate(location.pathname + location.search, {replace: true, state: {unitPeek: false}})}>全页打开</Button>}</div>
      {loadingPermissions ? <p role="status">正在核对读取权限…</p> : permissionError ? <p role="alert">权限信息读取失败，请重新加载后重试。</p> : !canRead ? <p role="alert">当前身份无权读取此记录。</p> : <>
        {detail.isError && <p role="alert">{readError(detail.error)}<Button variant="ghost" onClick={() => void detail.refetch()}>重试</Button></p>}
        {detail.isPending ? <p role="status">正在读取记录详情…</p> : current && <>
          <header className="unit-detail__heading"><span>院区业务单元</span><h2 ref={detailTitle} tabIndex={-1}>{display?.name || '未返回登记名称'}</h2>
            <span className={'unit-status unit-status--' + current.state}>{stateLabel(current.state)}</span></header>
          {display?.mode === 'REGISTERED' && <p className="unit-registration-note">该时点没有当前有效属性。名称与编码来自第 {display.version} 版登记信息，仅用于识别，不表示已经生效或获准运营。</p>}
          <dl className="record-properties unit-properties">
            <div><dt>业务编码</dt><dd>{display?.code || '未返回编码'}</dd></div>
            <div><dt>单元类型</dt><dd>{display ? careDisplay(display.type) : '未返回'}</dd></div>
            <div><dt>逻辑科室</dt><dd>{reference('department-master', current.departmentId)}</dd></div>
            <div><dt>院区</dt><dd>{reference('organization-master/campus', current.binding?.binding.campus.id)}</dd></div>
            <div><dt>运营主体</dt><dd>{reference('organization-master', current.binding?.binding.subject.id)}</dd></div>
            <div><dt>查询内容版本</dt><dd>{display ? '第 ' + display.version + ' 版' : '未返回'}{display?.mode === 'REGISTERED' ? '（登记标签）' : ''}</dd></div>
          </dl>
          <section className="unit-detail__section"><h3>服务说明</h3><p>{current.version?.facts.serviceDescription || '该时点未提供服务说明'}</p>
            {current.version?.facts.publicPhone && <p>公开电话：{current.version.facts.publicPhone}</p>}</section>
          <section className="unit-detail__section"><h3>{display?.mode === 'REGISTERED' ? '登记版本期间' : '有效期与来源'}</h3>
            <dl className="unit-properties">
              <div><dt>业务生效</dt><dd>{display ? careTime(display.validFrom) : '未返回'}</dd></div>
              <div><dt>业务结束</dt><dd>{display ? display.validTo ? careTime(display.validTo) : '无固定结束时间' : '未返回'}</dd></div>
              <div><dt>平台记录时间</dt><dd>{current.version ? careTime(current.version.recordedAt) : '无当前有效版本'}</dd></div>
              <div><dt>来源记录时间</dt><dd>{current.version?.facts.source.sourceRecordedAt ? careTime(current.version.facts.source.sourceRecordedAt) : '来源时间未知'}</dd></div>
            </dl><p className="unit-help">使用上海本地时间；结束时间为不再有效的起点。登记标签与业务有效状态分别表达。</p>
          </section>
          <section className="unit-detail__section"><h3>业务关联</h3><p className="unit-help">病区、护理与地点关系独立维护，不是唯一行政父级。上方关联名称为当前可读取的登记标签。</p>
            <div className="unit-related-links"><Link to={'/care-space/UNIT_WARD?actor=' + encodeURIComponent(actor)}>科室与病区</Link><Link to={'/care-space/WARD_NURSING?actor=' + encodeURIComponent(actor)}>病区与护理</Link><Link to={'/care-space/LOCATION_USE?actor=' + encodeURIComponent(actor)}>地点使用</Link></div>
          </section>
          {canWrite && !date && current.state === 'ACTIVE' && <div className="unit-maintain"><Button disabled={maintaining || detail.isError} onClick={() => void maintain()}>{maintaining ? '正在准备…' : '修改此记录'}</Button><p className="unit-help">修订先保存私有草稿，再提交独立核验与审批。</p></div>}
          {canWrite && current.state === 'SUSPENDED' && <p className="unit-help">当前单元已暂停，不能提交属性修订。请先按原生命周期流程完成恢复。</p>}
          {operationError && <p role="alert">{operationError}</p>}
          <details className="unit-history" open={historyOpen} onToggle={event => setHistoryOpen(event.currentTarget.open)}><summary>变更历史</summary>
            {historyOpen && (history.isPending ? <p role="status">正在读取历史…</p> : history.isError ? <p role="alert">{readError(history.error)}</p> : <ol>{[...(history.data?.versions ?? [])].reverse().map(version => <li key={version.id}>
              <b>第 {version.number} 版 · {careDisplay(version.action)}</b><span>{version.facts.unitName}</span><span>业务生效：{careTime(version.validFrom)}</span><span>平台记录：{careTime(version.recordedAt)}</span><p>{version.reason}</p>
            </li>)}</ol>)}
          </details>
          <p className="unit-help unit-core-note">本页为主数据登记。临床能力与负责人就绪情况另行核验，登记有效不等于临床获准使用。</p>
          {readRestricted && <details className="unit-technical"><summary>技术信息与高级查询</summary><p>稳定身份：{current.id}</p><p>最新记录头：{current.head}</p>
            <CareOperationPanel actor={actor} operation="getBusinessUnitVersion" label="读取指定版本" initial={{id}} choices={choices}/>
            <CareOperationPanel actor={actor} operation="diffBusinessUnitVersions" label="比较两个版本" initial={{id}} choices={choices}/>
          </details>}
        </>}
      </>}
    </aside>}
  </section>;
}
