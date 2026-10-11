import {useEffect, useRef, useState} from 'react';
import {useNavigate, useSearchParams} from 'react-router';
import {useQueryClient} from '@tanstack/react-query';
import {createBusinessUnitClient, createCareWorkspaceClient, type BusinessUnitInput, type VNextOperations} from '@hospital-data-intelligence/generated-api-client';
import {Button} from '../components/ui/button.js';
import {departmentValue, definiteFailure, DepartmentResponseError} from './department-request.js';
import {careExecute} from './care-request.js';
import {record, text} from './care-model.js';
import {careTime} from './care-record-view.js';
import {unitBusinessError} from './unit-maintenance-model.js';
import {assertUnitPropertyInput,assertFrozenUnitProperty,unitPropertyDeclaration,unitExpectedReceivingBasis,unitActionLocation,type UnitApprovalContext} from './unit-approval-model.js';

type Permissions = VNextOperations['careWorkspacePermissions']['responses'][200]['content']['application/json'];
type Reference = VNextOperations['readCareWorkspaceApplicationReference']['responses'][200]['content']['application/json'];
type Original = VNextOperations['readBusinessUnitInput']['responses'][200]['content']['application/json'];
type Candidate = VNextOperations['listCareWorkspaceExecutions']['responses'][200]['content']['application/json']['items'][number];
type Before = VNextOperations['getBusinessUnitVersion']['responses'][200]['content']['application/json'];
type Verify = VNextOperations['verifyBusinessUnitInput']['requestBody']['content']['application/json'];
type Pending = {kind: 'VERIFY'; body: Verify} | {kind: 'PLAN'; body: {inputId: string; requestId: string}} | {kind: 'APPROVE'; body: {candidateId: string; digest: string}} | {kind: 'APPLY'; body: {candidateId: string; requestId: string}};

/** Explicit independent actions over one submitted UNIT revision, without a command-schema editor. */
export function UnitApplication({actor, id, inputId, permissions, onLock, onRecoveryLock, returnUrl, context}: {actor: string; id: string; inputId: string; permissions: Permissions; onLock: (value: boolean) => void; onRecoveryLock: (value: boolean) => void; returnUrl: string; context: unknown}) {
  const workspace = createCareWorkspaceClient(location.origin, actor), client = createBusinessUnitClient(location.origin, actor), navigate = useNavigate(), queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const locatorParams = useRef(new URLSearchParams(params));
  useEffect(() => {locatorParams.current = new URLSearchParams(params);}, [params]);
  const [reference, setReference] = useState<Reference>(), [original, setOriginal] = useState<Original>(), [before, setBefore] = useState<Before>();
  const [approvalContext,setApprovalContext]=useState<UnitApprovalContext>();
  const [candidate, setCandidate] = useState<Candidate>(), [busy, setBusy] = useState(true), [error, setError] = useState('');
  const [executionHistory,setExecutionHistory]=useState<Candidate[]>([]),[executionsLoaded,setExecutionsLoaded]=useState(false),[executionAfter,setExecutionAfter]=useState<string|null>(null);
  const [preview, setPreview] = useState<VNextOperations['previewBusinessUnitInput']['responses'][200]['content']['application/json']>();
  const [material, setMaterial] = useState(''), [materialRead, setMaterialRead] = useState(false), [classification, setClassification] = useState(false), [restriction, setRestriction] = useState(false), [verifyReason, setVerifyReason] = useState('');
  const [reviewed, setReviewed] = useState(false), [reviewConfirmed, setReviewConfirmed] = useState(false), [frozenFacts, setFrozenFacts] = useState<Record<string, unknown>>();
  const [uncertain, setUncertain] = useState(false), [completed, setCompleted] = useState(false), [denied, setDenied] = useState(false);
  const pending = useRef<Pending | null>(null), generation = useRef(0);
  const entry = original?.entries[0];
  const locate = (values: Record<string, string | null>) => {const next = new URLSearchParams(locatorParams.current); for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key); locatorParams.current = next; setParams(next, {replace: true, state: context});};
  function selectExecution(value:Candidate){if(value.candidateId!==candidate?.candidateId){setReviewed(false);setReviewConfirmed(false);setFrozenFacts(undefined);setCompleted(false);}setCandidate(value);locate({candidate:value.candidateId,execution:value.requestId});}
  async function readExecutionHistory(after?:string){setExecutionsLoaded(false);const result=await departmentValue(workspace.executions({kind:'UNIT',inputId,limit:20,...(after?{after}:{})}));setExecutionHistory(previous=>after?[...new Map([...previous,...result.items].map(value=>[value.candidateId,value])).values()]:result.items);setExecutionAfter(result.nextAfterId);setExecutionsLoaded(true);return result.items;}
  async function executions(requestId?: string) {
    const result = await departmentValue(workspace.executions({kind: 'UNIT', inputId, limit: 1,
      ...(locatorParams.current.get('candidate') ? {candidateId: locatorParams.current.get('candidate')!} : {}), ...(requestId ? {requestId} : {})}));
    const exact = result.items[0]; if (exact) {setExecutionHistory(previous=>[exact,...previous.filter(value=>value.candidateId!==exact.candidateId)]);selectExecution(exact);} return exact;
  }
  async function reloadExecutions(more=false){setBusy(true);setError('');try{const items=await readExecutionHistory(more?executionAfter??undefined:undefined);if(candidate)await executions(candidate.requestId);else if(items[0])selectExecution(items[0]);}catch(value){fail(value);}finally{setBusy(false);}}
  function fail(value: unknown) {setError(unitBusinessError(value)); if (value instanceof DepartmentResponseError && [401, 403].includes(value.status)) {setDenied(true); queryClient.clear();}}
  useEffect(() => {
    let active = true; const token = ++generation.current;
    void (async () => {
      setBusy(true);
      if(params.has('unitStage'))setUncertain(true);
      try {
        const [ref, input] = await Promise.all([departmentValue(workspace.applicationReference({kind: 'UNIT', inputId})), departmentValue(client.readInput({inputId}))]);
        const selected = input.entries[0];
        if (input.entries.length !== 1 || !selected || selected.action !== 'REVISE' || selected.target.id !== id) throw new Error('原申请不是当前业务单元的单条属性修订。');
        const head = await departmentValue(client.exact({id, version: selected.target.expectedHead}));
        const history=await departmentValue(client.history({id,recordAsOf:head.recordedAt})),declaration=unitPropertyDeclaration(history.versions,head.number);
        const accepted=await departmentValue(client.query({id,businessAt:declaration.validFrom,recordAsOf:head.recordedAt})),previous=accepted.version;
        if(!previous||previous.id!==declaration.id||!accepted.binding)throw new Error('最新接受属性版本和对应归属当前不可核对，不能批准。');
        const producer=await departmentValue(client.readInput({inputId:previous.facts.source.recordLocatorEvidence.inputId}));
        const context:UnitApprovalContext={input,expectedHead:head.number,before:previous,binding:accepted.binding.binding,producer,inputId};
        assertUnitPropertyInput(context);
        if (!active || token !== generation.current) return;
        setReference(ref); setOriginal(input); setBefore(previous);setApprovalContext(context);
        const items=await readExecutionHistory(),execution=params.get('execution');if(execution||params.get('candidate'))await executions(execution??undefined);else if(items[0])selectExecution(items[0]);
        const unresolved = params.get('unitStage'); if (unresolved) {setUncertain(true); setError('存在待确认的原执行请求，请先恢复准确结果。');}
      } catch (value) {if (active) fail(value);} finally {if (active) setBusy(false);}
    })();
    return () => {active = false; generation.current++;};
  }, [actor, id, inputId]);
  useEffect(() => {onLock(busy || uncertain); onRecoveryLock(uncertain);}, [busy, uncertain, onLock, onRecoveryLock]);
  useEffect(() => () => {onLock(false); onRecoveryLock(false);}, [onLock, onRecoveryLock]);
  async function checkInput() {setBusy(true); setError(''); try {setPreview(await departmentValue(client.preview({inputId})));} catch (value) {fail(value);} finally {setBusy(false);}}
  async function readMaterial() {
    if (!entry) return; setBusy(true); setError('');
    try {const result = record(await careExecute(actor, 'readCareWorkspaceMaterial', {access: 'INPUT', kind: 'UNIT', inputId, artifactId: entry.evidenceId}));
      const raw = atob(text(result['contentBase64'])); setMaterial(new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0)))); setMaterialRead(true);
    } catch (value) {fail(value);} finally {setBusy(false);}
  }
  async function dispatch(packet: Pending) {
    if (busy || denied || pending.current || (packet.kind==='PLAN'&&(!executionsLoaded||!!candidate||executionHistory.length>0))) return; pending.current = packet; setBusy(true); setError('');
    locate(unitActionLocation(packet.kind,'requestId' in packet.body?packet.body.requestId:undefined));
    try {
      if (packet.kind === 'VERIFY') {await departmentValue(client.verify(packet.body)); setPreview(await departmentValue(client.preview({inputId}))); setMaterial('');}
      if (packet.kind === 'PLAN') {const result = await departmentValue(client.plan(packet.body));
        const exact = await departmentValue(workspace.executions({kind: 'UNIT', inputId, candidateId: result.candidateId, requestId: packet.body.requestId, limit: 1}));
        if (!exact.items[0] || exact.items[0].digest !== result.digest) throw new Error('冻结结果与服务器候选记录不一致，请核对原请求。');
        setExecutionHistory(previous=>[exact.items[0]!,...previous.filter(value=>value.candidateId!==result.candidateId)]);selectExecution(exact.items[0]);}
      if (packet.kind === 'APPROVE') {await departmentValue(client.approve(packet.body)); await executions(candidate?.requestId);}
      if (packet.kind === 'APPLY') {const result = await departmentValue(client.apply(packet.body)); if (result.status !== 'COMMITTED') {setUncertain(true); return;} await confirmCommitted(packet.body);}
      pending.current = null; setUncertain(false); locate({unitStage: null,verificationRequest:null});
    } catch (value) {if (definiteFailure(value)) {pending.current = null; setUncertain(false); locate({unitStage: null,verificationRequest:null});} else setUncertain(true); fail(value);}
    finally {setBusy(false);}
  }
  async function confirmCommitted(body: {candidateId: string; requestId: string}) {
    const matched = record(await departmentValue(client.reconcile(body)));
    if (matched['status'] !== 'MATCHED') throw new Error('已提交结果尚未完成事实核对，请继续核对原请求。');
    const current = await departmentValue(client.query({id}));
    const history = await departmentValue(client.history({id}));
    if (!entry || entry.action !== 'REVISE' || current.id !== id || !current.version || current.version.facts.serviceDescription !== (entry.row.service_description || null)
      || current.version.facts.unitName !== entry.row.unit_name || current.version.facts.publicPhone !== (entry.row.public_phone || null)
      || current.version.facts.unitCode !== entry.row.unit_code || BigInt(current.version.number) <= BigInt(entry.target.expectedHead)
      || !history.versions.some(version => version.id === current.version!.id)) throw new Error('服务端回读尚未与本次修订匹配，请继续核对原请求。');
    await Promise.all([queryClient.invalidateQueries({queryKey: ['care-records', actor, 'UNIT']}), queryClient.invalidateQueries({queryKey: ['care-record', actor, 'UNIT']}), queryClient.invalidateQueries({queryKey: ['care-history', actor, 'UNIT']})]);
    setCompleted(true); await executions(body.requestId);
  }
  async function recover() {
    setBusy(true); setError('');
    try {
      const stage = pending.current?.kind ?? params.get('unitStage');
      if (stage === 'PLAN') {const prior = await executions(params.get('execution') ?? undefined); if (!prior) throw new Error('原冻结请求尚无服务器候选，请保留原请求。');}
      else if (stage === 'APPROVE') {const prior = await executions(candidate?.requestId); if (!prior?.approvedBy) throw new Error('服务器尚未确认该候选已批准。');}
      else if (stage === 'APPLY' && candidate) {const body = {candidateId: candidate.candidateId, requestId: candidate.requestId}, outcome = await departmentValue(client.resume(body));
        if (outcome?.status !== 'COMMITTED') throw new Error('原请求结果仍未确认，不生成新执行请求。'); await confirmCommitted(body);}
      else if (stage === 'VERIFY' && pending.current?.kind === 'VERIFY') {await departmentValue(client.preview({inputId})); await departmentValue(client.verify(pending.current.body)); setPreview(await departmentValue(client.preview({inputId})));}
      else throw new Error('原操作内容当前不在内存，不能自动重建。请按原申请与执行标识核对服务端记录。');
      pending.current = null; setUncertain(false); locate({unitStage: null,verificationRequest:null});
    } catch (value) {fail(value);} finally {setBusy(false);}
  }
  async function reviewCandidate() {
    if (!candidate||!approvalContext||!reference) return; setBusy(true); setError('');setReviewed(false);setReviewConfirmed(false);setFrozenFacts(undefined);
    try {const verified=await departmentValue(client.readVerification({inputId})),basis=unitExpectedReceivingBasis(verified,approvalContext,reference.submission.digest);
      const result = record(await departmentValue(client.review({candidateId: candidate.candidateId}))), unit = record(result['unit']);
      if (result['digest'] !== candidate.digest || !Array.isArray(unit['commands']) || unit['commands'].length !== 1) throw new Error('候选摘要或命令范围不匹配。');
      const command = record(unit['commands'][0]), target = record(command['target']), value = record(command['value']);
      if (target['id'] !== id||target['owner']!=='care-organization/unit'||target['version']!==approvalContext.expectedHead||command['owner']!=='care-organization/unit'||command['intent']!=='REVISE'||value['inputId']!==inputId) throw new Error('候选目标或预期头与当前申请不匹配。');
      const writes: unknown = JSON.parse(text(value['writes']));
      if (!Array.isArray(writes) || writes.length !== 1) throw new Error('冻结修订范围与单记录编辑不匹配。');
      const write = record(writes[0]), facts = record(write['facts']);
      assertFrozenUnitProperty(write,approvalContext,basis);
      setFrozenFacts(facts); setReviewed(true); setReviewConfirmed(false);
    } catch (value) {fail(value);} finally {setBusy(false);}
  }
  function verify() {
    if (!reference || !original || !entry || !classification || !restriction || !materialRead || !verifyReason.trim() || entry.row.receiving_rule_ref) return;
    const time = (value: string) => original.timePolicy === 'SOURCE_PLUS08_TO_LOCAL' ? value.replace(/\+08:00$/, '') : value;
    void dispatch({kind: 'VERIFY', body: {requestId: crypto.randomUUID(), inputId, inputDigest: reference.submission.digest, reason: verifyReason,
      policyVersion: 'ORG07_CORE_V1', rows: [{row: 1, evidenceId: entry.evidenceId, classificationAccepted: classification,
        receiving: {kind: 'NO_SPECIAL_RESTRICTION', confirmed: restriction, validFrom: time(entry.row.valid_from), validTo: entry.row.valid_to ? time(entry.row.valid_to) : null}}]}});
  }
  const enabled = !busy && !uncertain && !denied && !!original;
  const differences = before && entry ? [
    ['名称', before.facts.unitName, entry.row.unit_name], ['公开电话', before.facts.publicPhone, entry.row.public_phone], ['服务说明', before.facts.serviceDescription, entry.row.service_description],
  ] : [];
  return <section className="unit-maintenance unit-application" aria-label="业务单元申请处理">
    <div className="unit-maintenance__toolbar"><Button variant="ghost" disabled={busy} onClick={() => void navigate(returnUrl, {state: context})}>返回列表</Button><span>{completed ? '已发布并回读确认' : candidate?.committed ? '已应用，待回读确认' : candidate?.approvedBy ? '已批准，待应用' : candidate ? '候选待审批' : '已提交，待独立核验'}</span></div>
    <h2>{denied ? '申请当前不可读取' : entry?.row.unit_name ?? '业务单元修订申请'}</h2>
    {error && <p role="alert">{error}</p>}{busy && !original && <p role="status">正在读取原申请…</p>}
    {uncertain && <div className="unit-edit-alert" role="alert"><h3>结果待确认</h3><p>绑定原申请和原执行请求，不另发新请求。{params.get('unitStage')==='VERIFY'&&params.get('verificationRequest')&&<>原核验请求：{params.get('verificationRequest')}。刷新后仅保留定位，原核验内容不在内存时需核对服务端记录。</>}</p><Button disabled={busy} onClick={() => void recover()}>恢复原执行结果</Button></div>}
    {original && entry && !denied && <>
      <p>原提交人：{reference?.maker} · {original.profile === 'CORE' ? '合成核心维护' : '完整依赖维护'} · 临床就绪仍须另行核验</p>
      <p>本次生效：{careTime(entry.row.valid_from)} 至 {entry.row.valid_to ? careTime(entry.row.valid_to) : '无固定结束时间'}</p><p>修订理由：{entry.reason}</p>
      <table className="unit-change-table"><caption>本次字段变化</caption><thead><tr><th>字段</th><th>原内容</th><th>申请内容</th></tr></thead><tbody>{differences.map(([label, old, next]) => <tr key={label}><th>{label}</th><td>{old || '未填写'}</td><td>{next || '未填写'}</td></tr>)}</tbody></table>
      <section><h3>1. 服务端校验</h3><Button variant="outline" disabled={!enabled} onClick={() => void checkInput()}>校验本次申请</Button>{preview && <div role="status"><p>{preview.decision === 'PASS' ? '校验通过，可冻结候选。' : '尚有阻断，请完成依据核验或处理问题。'}</p>{preview.issues.map((issue, index) => <p key={index}>{issue.field}：{issue.code}（{issue.status}）</p>)}</div>}</section>
      <section><h3>2. 独立核验依据</h3><p>提交人不能代替独立核验主体。本轮依据为虚构测试资料。</p><Button variant="outline" disabled={!enabled || !permissions.verify} onClick={() => void readMaterial()}>读取本次受保护依据</Button>{material && <details><summary>当前授权依据原文</summary><pre className="unit-material-preview">{material}</pre></details>}
        <fieldset disabled={!enabled || !permissions.verify}><label><input type="checkbox" checked={classification} onChange={event => setClassification(event.target.checked)}/>已独立核对业务单元分类</label><label><input type="checkbox" checked={restriction} onChange={event => setRestriction(event.target.checked)}/>已独立确认该期间无附加收治限制</label><label>独立核验理由<textarea value={verifyReason} onChange={event => setVerifyReason(event.target.value)} rows={2}/></label></fieldset>
        {!!entry.row.receiving_rule_ref && <p role="alert">当前记录有收治规则引用，须按准确规则版本核验，不能作为无限制提交。</p>}
        <Button disabled={!enabled || !permissions.verify || !classification || !restriction || !materialRead || !verifyReason.trim() || !!entry.row.receiving_rule_ref} onClick={verify}>提交独立核验</Button>
      </section>
      <section><h3>3. 冻结本次候选</h3><Button disabled={!enabled || !permissions.write || !executionsLoaded || !!candidate || executionHistory.length>0 || preview?.decision !== 'PASS'} onClick={() => void dispatch({kind: 'PLAN', body: {inputId, requestId: crypto.randomUUID()}})}>冻结本次修订</Button><Button variant="outline" disabled={busy||uncertain} onClick={()=>void reloadExecutions()}>读取已有执行记录</Button>{executionHistory.length>0&&<><label htmlFor="unit-existing-execution">已有冻结候选</label><select id="unit-existing-execution" disabled={busy||uncertain} value={candidate?.candidateId??''} onChange={event=>{const selected=executionHistory.find(value=>value.candidateId===event.target.value);if(selected)selectExecution(selected);}}><option value="">请选择已有候选</option>{executionHistory.map((value,index)=><option key={value.candidateId} value={value.candidateId}>候选 {index+1} · {careTime(value.recordedAt)} · {value.committed?'已应用':value.approvedBy?'已批准':'待审批'}</option>)}</select></>}{executionAfter&&<Button variant="outline" disabled={busy||uncertain} onClick={()=>void reloadExecutions(true)}>读取更多执行记录</Button>}</section>
      {candidate && <section><h3>4. 独立审批</h3><Button variant="outline" disabled={!enabled || !permissions.review} onClick={() => void reviewCandidate()}>审阅冻结候选</Button>{reviewed && <><p role="status">已读取与本次记录和摘要匹配的冻结候选。</p><label><input type="checkbox" disabled={!enabled || !permissions.review} checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)}/>已审阅字段变化、生效期间与冻结依据，同意本次修订</label></>}<Button disabled={!enabled || !permissions.review || !reviewed || !reviewConfirmed || !!candidate.approvedBy} onClick={() => void dispatch({kind: 'APPROVE', body: {candidateId: candidate.candidateId, digest: candidate.digest}})}>批准本次修订</Button></section>}
      {candidate && <section><h3>5. 应用并回读</h3><Button disabled={!enabled || !permissions.write || !candidate.approvedBy || candidate.committed || completed} onClick={() => void dispatch({kind: 'APPLY', body: {candidateId: candidate.candidateId, requestId: candidate.requestId}})}>应用已批准修订</Button>{candidate.committed && !completed && <Button variant="outline" disabled={!enabled} onClick={() => {setBusy(true); void confirmCommitted({candidateId: candidate.candidateId, requestId: candidate.requestId}).catch(fail).finally(() => setBusy(false));}}>核对已发布内容</Button>}{completed && <p role="status">已发布：服务器提交、事实核对与本记录回读均确认，稳定身份保持不变，历史已追加。</p>}</section>}
      <details className="unit-technical"><summary>技术定位与冻结内容</summary><p>申请 {inputId}</p><p>候选 {candidate?.candidateId} · 原执行请求 {candidate?.requestId}</p>{frozenFacts && <pre>{JSON.stringify(frozenFacts, null, 2)}</pre>}</details>
    </>}
  </section>;
}
