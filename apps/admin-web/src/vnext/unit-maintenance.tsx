import {useEffect, useRef, useState, type ChangeEvent} from 'react';
import {useLocation, useNavigate, useSearchParams} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {createCareWorkspaceClient, type VNextOperations} from '@hospital-data-intelligence/generated-api-client';
import {Button} from '../components/ui/button.js';
import {Input} from '../components/ui/input.js';
import {departmentValue, DepartmentResponseError, definiteFailure} from './department-request.js';
import {careExecute} from './care-request.js';
import {loadCareContracts} from './care-contracts.js';
import {loadUnitBrowserReferences} from './care-references.js';
import {record, text} from './care-model.js';
import {careTime, careUuid} from './care-record-view.js';
import {editUnitDraft, mergeUnitDraftConflict, prepareUnitDraft, unitBusinessError, unitEntry, unitFields, unitFieldLabels, validateUnitFields, type UnitDraft, type UnitFields} from './unit-maintenance-model.js';
import {UnitApplication} from './unit-application.js';
import type {ReferenceChoices} from './department-form.js';
import './unit-maintenance.css';

type Saved = VNextOperations['readCareWorkspaceDraft']['responses'][200]['content']['application/json'];
type Permissions = VNextOperations['careWorkspacePermissions']['responses'][200]['content']['application/json'];
type Submit = VNextOperations['submitCareWorkspaceDraft']['requestBody']['content']['application/json'];
type Material = VNextOperations['createCareWorkspaceMaterial']['requestBody']['content']['application/json'];
type Pending = {kind: 'SAVE'; body: UnitDraft} | {kind: 'SUBMIT'; body: Submit} | {kind: 'MATERIAL'; body: Material};
const emptyFields: UnitFields = {name: '', phone: '', description: '', reason: ''};
const noPermissions: Permissions = {read: false, write: false, readRestricted: false, verify: false, review: false};

/** One record's property revision. Native Owners remain responsible for every write. */
export function UnitMaintenance({actor, id, onLock, onRecoveryLock}: {actor: string; id: string; onLock: (value: boolean) => void; onRecoveryLock: (value: boolean) => void}) {
  const workspace = createCareWorkspaceClient(location.origin, actor), navigate = useNavigate(), locationState = useLocation(), queryClient = useQueryClient();
  const [params, setParams] = useSearchParams(), applicationId = params.get('application');
  const locatorParams = useRef(new URLSearchParams(params));
  useEffect(() => {locatorParams.current = new URLSearchParams(params);}, [params]);
  const [draft, setDraft] = useState<UnitDraft>(), [saved, setSaved] = useState<Saved>(), [base, setBase] = useState<UnitFields>(emptyFields);
  const [fields, setFields] = useState<UnitFields>(emptyFields), [choices, setChoices] = useState<ReferenceChoices>({});
  const [permissions, setPermissions] = useState<Permissions>(noPermissions), [busy, setBusy] = useState(true), [ready, setReady] = useState(false);
  const [message, setMessage] = useState(''), [errors, setErrors] = useState<Partial<Record<keyof UnitFields, string>>>({});
  const [conflict, setConflict] = useState<Saved>(), [uncertain, setUncertain] = useState(false), [materialName, setMaterialName] = useState('沿用原来源依据');
  const [materialReady, setMaterialReady] = useState(false), [materialDirty, setMaterialDirty] = useState(false);
  const pending = useRef<Pending | null>(null), generation = useRef(0);
  const materialReadGeneration=useRef(0);
  const dirty = ready && (JSON.stringify(fields) !== JSON.stringify(base) || materialDirty);
  const editable = permissions.write && permissions.readRestricted && !busy && !uncertain && !conflict;
  const locate = (values: Record<string, string | null>) => {const next = new URLSearchParams(locatorParams.current); for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); locatorParams.current = next; setParams(next, {replace: true, state: locationState.state});};
  const returnUrl = () => {const next = new URLSearchParams(params); for (const key of ['view', 'draft', 'application', 'request', 'unitAction', 'unitStage','verificationRequest','candidate', 'execution']) next.delete(key); return '/care-space/UNIT?' + next.toString();};
  function checkDraftMaterial(next:UnitDraft){
    const session=generation.current,token=++materialReadGeneration.current;setMaterialReady(false);
    void careExecute(actor,'readCareWorkspaceMaterial',{access:'OWN',scope:'SYNTHETIC',campus:next.campus,purpose:'IDENTITY_VERIFY',requestId:crypto.randomUUID(),artifactId:unitEntry(next).evidenceId})
      .then(()=>{if(generation.current===session&&materialReadGeneration.current===token)setMaterialReady(true);})
      .catch(()=>{if(generation.current===session&&materialReadGeneration.current===token){setMaterialReady(false);setMessage('草稿依据当前不可读取，请补齐当前可读取的合成依据。');}});
  }
  function accept(value: Saved) {
    if (value.content.kind !== 'UNIT') throw new Error('服务器草稿类型与当前业务单元不匹配。');
    const next: UnitDraft = {...value.content, id: value.id, expectedVersion: value.version, requestId: crypto.randomUUID()};
    if (unitEntry(next).target.id !== id) throw new Error('服务器草稿属于另一条记录。');
    setSaved(value); setDraft(next); setFields(unitFields(next)); setBase(unitFields(next)); setConflict(undefined); setReady(true);
    setMaterialDirty(false);
    pending.current = null; setUncertain(false);
    locate({draft: value.id, request: null, unitAction: null, application: value.submission?.inputId ?? null});
    checkDraftMaterial(next);
  }
  function fail(error: unknown) {
    setMessage(unitBusinessError(error));
    if (error instanceof DepartmentResponseError && [401, 403].includes(error.status)) {setPermissions(noPermissions); queryClient.clear();}
  }
  useEffect(() => {
    const token = ++generation.current; let active = true;
    const current = () => active && token === generation.current;
    void (async () => {
      setBusy(true);
      try {
        const access = await departmentValue(workspace.permissions({kind: 'UNIT', campus: params.get('scope') === 'SOUTH' ? 'SOUTH' : 'NORTH'}));
        if (!current()) return; setPermissions(access);
        if (applicationId || !access.readRestricted) return;
        const request = params.get('request'), action = params.get('unitAction');
        if (request) {
          const result = action === 'MATERIAL' ? null : await departmentValue(workspace.recover(request));
          if (!current()) return;
          if (!result) {setUncertain(true); setMessage('原请求结果待确认。刷新不能恢复未保存输入，请先查询原请求；不能另发新请求。'); return;}
          const stored = await departmentValue(workspace.read(result.id)); if (current()) accept(stored); return;
        }
        const draftId = params.get('draft');
        if (draftId) {const stored = await departmentValue(workspace.read(draftId)); if (current()) {accept(stored); setMaterialName('服务器草稿中已绑定的依据');}}
        else {
          const prepared = await prepareUnitDraft(actor, id), contracts = await loadCareContracts(actor, 'ORG07', prepared.draft.profile);
          if (!current()) return;
          const exact = contracts.find(contract => contract.versionId === prepared.contractVersionId);
          const next: UnitDraft = {...prepared.draft, ...(exact ? {transport: {contractId: exact.id, contractVersionId: exact.versionId}} : {})};
          setDraft(next); setFields(unitFields(next)); setBase(unitFields(next)); setReady(true);
          if (!exact) setMessage('原采用契约当前不可选择，请核对已发布的准确来源契约。');
          try {await careExecute(actor, 'readCareWorkspaceMaterial', {access: 'INPUT', kind: 'UNIT', inputId: prepared.sourceInputId, artifactId: unitEntry(next).evidenceId}); if (current()) setMaterialReady(true);}
          catch {if (current()) setMessage('原依据内容不可读取。可显式上传本次合成依据，保存与提交分别执行。');}
        }
        const refs = await loadUnitBrowserReferences(actor); if (current()) setChoices(refs.choices);
      } catch (error) {if (current()) fail(error);} finally {if (current()) setBusy(false);}
    })();
    return () => {active = false; generation.current++;};
  }, [actor, id, applicationId]);
  useEffect(() => {if (!applicationId) {onLock(busy || dirty || uncertain); onRecoveryLock(uncertain);}}, [busy, dirty, uncertain, applicationId, onLock, onRecoveryLock]);
  useEffect(() => () => {onLock(false); onRecoveryLock(false);}, [onLock, onRecoveryLock]);
  async function save() {
    if (!draft || conflict || (!editable && !uncertain)) return;
    const invalid = validateUnitFields(fields); setErrors(invalid);
    if (Object.keys(invalid).length) {document.getElementById('unit-' + Object.keys(invalid)[0])?.focus(); return;}
    const packet: Pending = pending.current ?? {kind: 'SAVE', body: {...editUnitDraft(draft, fields), requestId: crypto.randomUUID()}};
    if (packet.kind !== 'SAVE') return;
    pending.current = packet; setBusy(true); setMessage(''); locate({request: packet.body.requestId, unitAction: 'SAVE'});
    let acknowledged = false;
    try {
      if (uncertain) {const recovered = await departmentValue(workspace.recover(packet.body.requestId)); if (recovered) {accept(await departmentValue(workspace.read(recovered.id))); setMessage('已核对原请求，私有草稿已保存。'); return;}}
      const receipt = await departmentValue(workspace.save(packet.body)); acknowledged = true; accept(await departmentValue(workspace.read(receipt.id))); setMessage('私有草稿已保存，尚未提交或发布。');
    } catch (error) {
      if (!acknowledged && definiteFailure(error)) {pending.current = null; setUncertain(false); locate({request: null, unitAction: null});
        if (error instanceof DepartmentResponseError && error.status === 409 && draft.id) {try {setConflict(await departmentValue(workspace.read(draft.id)));} catch (readError) {fail(readError);}}}
      else setUncertain(true);
      fail(error);
    } finally {setBusy(false);}
  }
  async function submit() {
    if (!saved || saved.state !== 'EDITING' || dirty || !materialReady || !editable) return;
    const packet: Pending = {kind: 'SUBMIT', body: {id: saved.id, expectedVersion: saved.version, requestId: crypto.randomUUID()}};
    pending.current = packet; setBusy(true); locate({request: packet.body.requestId, unitAction: 'SUBMIT'});
    let acknowledged = false;
    try {const receipt = await departmentValue(workspace.submit(packet.body)); acknowledged = true; accept(await departmentValue(workspace.read(receipt.id))); setMessage('已提交原申请，等待独立核验。');}
    catch (error) {if (!acknowledged && definiteFailure(error)) {pending.current = null; locate({request: null, unitAction: null});} else setUncertain(true); fail(error);}
    finally {setBusy(false);}
  }
  async function recover() {
    const requestId = pending.current?.body.requestId ?? params.get('request'); if (!requestId) return;
    if (pending.current?.kind === 'MATERIAL') {await upload(undefined); return;}
    setBusy(true);
    try {const receipt = await departmentValue(workspace.recover(requestId));
      if (receipt) {accept(await departmentValue(workspace.read(receipt.id))); setMessage('已从服务器恢复原请求的准确结果。');}
      else if (pending.current?.kind === 'SAVE') {setBusy(false); await save();}
      else if (pending.current?.kind === 'SUBMIT') {const receipt = await departmentValue(workspace.submit(pending.current.body)); accept(await departmentValue(workspace.read(receipt.id)));}
      else setMessage('服务器尚无原请求的已保存结果；未保存内容不在内存，仍须核对原请求，不能自动重建请求。');
    } catch (error) {fail(error);} finally {setBusy(false);}
  }
  async function upload(file: File | undefined) {
    if (!draft?.transport || (!editable && !pending.current)) return;
    setBusy(true); setMessage('');materialReadGeneration.current++;
    try {
      let packet = pending.current;
      if (!packet) {
        if (!file || file.size < 1 || file.size > 1048576) throw new Error('请选择不超过1MiB的依据文件。');
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        packet = {kind: 'MATERIAL', body: {requestId: crypto.randomUUID(), campus: draft.campus, transport: draft.transport, retentionSeconds: 86400, contentBase64: btoa(binary)}};
        pending.current = packet; setMaterialName(file.name); locate({request: packet.body.requestId, unitAction: 'MATERIAL'});
      }
      if (packet.kind !== 'MATERIAL') return;
      const result = record(await careExecute(actor, 'createCareWorkspaceMaterial', packet.body));
      const entry = unitEntry(draft), next: UnitDraft = {...draft, payload: {...draft.payload, entries: [{...entry, evidenceId: text(result['artifactId'])}]}};
      setDraft(next); setMaterialReady(true); setMaterialDirty(true); pending.current = null; setUncertain(false); locate({request: null, unitAction: null});
      setMessage('本次依据已保存到受保护存储，尚未经过独立核验。请保存草稿。');
    } catch (error) {if (definiteFailure(error)) {pending.current = null; locate({request: null, unitAction: null});} else if (pending.current) setUncertain(true); fail(error);}
    finally {setBusy(false);}
  }
  function merge(keepMine: boolean) {
    if (!draft||!conflict?.content || conflict.content.kind !== 'UNIT' || conflict.state !== 'EDITING') return;
    const next: UnitDraft = {...conflict.content, id: conflict.id, expectedVersion: conflict.version, requestId: crypto.randomUUID()}, server = unitFields(next);
    try{const merged=mergeUnitDraftConflict(base,draft,fields,next,keepMine,materialDirty);
      setSaved(conflict);setDraft(merged.draft);setBase(server);setFields(merged.fields);setConflict(undefined);setMaterialDirty(merged.materialDirty);
      if(!merged.materialDirty)setMaterialName('采用服务器草稿中绑定的依据');
      checkDraftMaterial(merged.draft);setMessage(keepMine?'已保留你的字段和材料改动并更新草稿基准，请核对后保存。':'已采用服务器字段和材料，请等待依据读取确认。');
    }catch(error){fail(error);}
  }
  async function reloadSaved() {if (!saved || busy || uncertain) return; setBusy(true); try {accept(await departmentValue(workspace.read(saved.id))); setMessage('已恢复服务器草稿；未保存内容不会被声称已恢复。');} catch (error) {fail(error);} finally {setBusy(false);}}
  if (applicationId) return <UnitApplication actor={actor} id={id} inputId={applicationId} permissions={permissions} onLock={onLock} onRecoveryLock={onRecoveryLock} returnUrl={returnUrl()} context={locationState.state}/>;
  const entry = draft ? unitEntry(draft) : undefined, reference = (owner: string, value: string | undefined) => {
    const name = choices[owner]?.find(choice => choice.value === value)?.label.split(' · ')[0];
    return name && !careUuid(name) ? name : '关联名称暂不可读取';
  };
  return <section className="unit-maintenance" aria-label="修订业务单元">
    <div className="unit-maintenance__toolbar"><Button variant="ghost" disabled={busy} onClick={() => void navigate(returnUrl(), {state: locationState.state})}>返回列表</Button><span>{saved ? '私有草稿 · 第 ' + saved.version + ' 修订' : '尚未保存'}</span></div>
    <h2>{permissions.read && fields.name ? fields.name : '业务单元属性修订'}</h2>
    <p className="unit-help">修订既有记录，保存草稿、提交申请与发布分别确认。</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {uncertain && <div role="alert" className="unit-edit-alert"><h3>结果待确认</h3><p>保持原请求，输入已锁定。先查询服务器结果，再恢复同一请求。</p><Button disabled={busy} onClick={() => void recover()}>查询原请求结果</Button></div>}
    {busy && !ready && <p role="status">正在读取准确记录和权限…</p>}
    {!busy && !permissions.readRestricted && <p role="alert">当前身份不能读取维护依据或执行此修订。</p>}
    {ready && draft && entry && permissions.readRestricted && <>
      <dl className="unit-edit-context"><div><dt>业务编码</dt><dd>{entry.row.unit_code}</dd></div><div><dt>逻辑科室</dt><dd>{reference('department-master', entry.row.org_id)}</dd></div><div><dt>院区</dt><dd>{reference('organization-master/campus', entry.row.campus_id)}</dd></div><div><dt>运营主体</dt><dd>{reference('organization-master', entry.row.legal_entity_id)}</dd></div><div><dt>本次生效期间</dt><dd>{careTime(entry.row.valid_from ?? '')} 至 {entry.row.valid_to ? careTime(entry.row.valid_to) : '无固定结束时间'}</dd></div></dl>
      {Object.keys(errors).length > 0 && <div role="alert" className="unit-edit-alert"><h3>请修正以下字段</h3>{Object.entries(errors).map(([field, error]) => <button key={field} onClick={() => document.getElementById('unit-' + field)?.focus()}>{unitFieldLabels[field as keyof UnitFields]}：{error}</button>)}</div>}
      <form onSubmit={event => {event.preventDefault(); void save();}}>
        <fieldset disabled={!editable}><legend>业务属性</legend>{(['name', 'phone', 'description', 'reason'] as const).map(field => <label key={field} htmlFor={'unit-' + field}>{unitFieldLabels[field]}{field === 'description' || field === 'reason' ? <textarea aria-label={unitFieldLabels[field]} id={'unit-' + field} rows={field === 'description' ? 5 : 3} value={fields[field]} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? 'unit-error-' + field : undefined} onChange={event => {setFields(previous => ({...previous, [field]: event.target.value})); setErrors(previous => ({...previous, [field]: undefined}));}}/> : <Input aria-label={unitFieldLabels[field]} id={'unit-' + field} value={fields[field]} aria-invalid={!!errors[field]} aria-describedby={errors[field] ? 'unit-error-' + field : undefined} onChange={event => setFields(previous => ({...previous, [field]: event.target.value}))}/>} {errors[field] && <span id={'unit-error-' + field} className="unit-field-error">{errors[field]}</span>}</label>)}</fieldset>
        <section className="unit-edit-material"><h3>本次依据</h3><p>{materialName} · {materialReady ? '已绑定，待独立核验' : '内容不可读取，尚不能提交'}</p><label>上传本次合成依据<input type="file" disabled={!editable || !draft.transport} onChange={(event: ChangeEvent<HTMLInputElement>) => {const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '';}}/></label><p className="unit-help">依据保存在受保护服务端存储；上传不等于批准。</p></section>
        <div className="unit-edit-actions"><Button type="submit" disabled={!editable || saved?.state === 'SUBMITTED'}>保存私有草稿</Button><Button variant="outline" type="button" disabled={!editable || !saved || dirty || !materialReady || !draft.transport || saved.state !== 'EDITING'} onClick={() => void submit()}>提交申请</Button>{saved && <Button variant="ghost" type="button" disabled={busy || uncertain || dirty} onClick={() => void reloadSaved()}>从服务器恢复草稿</Button>}</div>
      </form>
      {conflict?.content.kind === 'UNIT' && <section role="alert" className="unit-edit-conflict"><h3>服务器已有较新草稿</h3><p>你的输入未被覆盖。比较后明确选择，再基于最新版本保存。</p><table><thead><tr><th>字段</th><th>原基准</th><th>服务器最新</th><th>我的输入</th></tr></thead><tbody>{(Object.keys(fields) as (keyof UnitFields)[]).map(field => <tr key={field}><th>{unitFieldLabels[field]}</th><td>{base[field] || '未填写'}</td><td>{unitFields({...conflict.content as UnitDraft, requestId: draft.requestId})[field] || '未填写'}</td><td>{fields[field] || '未填写'}</td></tr>)}<tr><th>依据材料</th><td>原草稿绑定的材料</td><td>服务器最新草稿绑定的材料</td><td>{materialDirty?materialName:'沿用原材料'}</td></tr></tbody></table><Button onClick={() => merge(true)}>保留我的字段和材料并更新基准</Button><Button variant="outline" onClick={() => merge(false)}>采用服务器草稿</Button></section>}
      <details className="unit-technical"><summary>技术信息与来源定位</summary><p>稳定身份 {id} · 绑定记录头 {entry.target.expectedHead}</p><p>依据标识 {entry.evidenceId}</p></details>
    </>}
  </section>;
}
