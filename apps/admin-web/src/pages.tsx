import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';

let api = createGovernanceApiClient({ baseUrl: '' });
let browserCsrfToken = '';
const DEFAULT_BUSINESS_TIME = '2026-08-08T00:00:00';
const DEFAULT_SERVICE_OCCURRED_AT = '2026-08-08T09:15:00';
const DEFAULT_PRICE_LIST_CODE = 'HOSPITAL-DEFAULT-PRICE';

interface ResolutionReference {
  readonly priceResolutionId: string;
  readonly status: string;
  readonly finalAmount: string | null;
  readonly resultDigest: string | null;
  readonly steps: readonly {
    readonly stepNo: string;
    readonly scopeChecked: string;
    readonly encounterModeChecked: string;
    readonly candidateCount: number;
    readonly decision: string;
    readonly explanationCode: string;
  }[];
}

export function configureBrowserApi(csrfToken: string): void {
  browserCsrfToken = csrfToken;
  api = createGovernanceApiClient({ baseUrl: '', csrfToken });
}

export function AppLayout() {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">HDI</span>
          <div>
            <strong>基础数据治理</strong>
            <small>Phase 01 · POC</small>
          </div>
        </div>
        <nav aria-label="主导航">
          <NavLink to="/" end>基线概览</NavLink>
          <NavLink to="/vertical-slice">纵向切片</NavLink>
          <NavLink to="/charge-items">收费项目草稿</NavLink>
          <NavLink to="/price-lists">价表草稿</NavLink>
          <NavLink to="/operations">导入·审批·审计</NavLink>
        </nav>
        <div className="scope-note">
          <span>当前范围</span>
          <strong>单一医院治理主体</strong>
          <small>固定 Asia/Shanghai · 合成数据</small>
          <button type="button" onClick={() => void switchGovernanceIdentity()}>退出并切换治理身份</button>
        </div>
      </aside>
      <main className="content"><Outlet /></main>
    </div>
  );
}

async function switchGovernanceIdentity(): Promise<void> {
  const response = await api.POST('/auth/logout', {
    params: { header: { 'x-csrf-token': browserCsrfToken } },
  });
  if (response.error) throw new Error(response.error.code);
  window.location.assign(`/auth/login?returnTo=${encodeURIComponent('/admin/operations')}`);
}

export function OverviewPage() {
  return (
    <section>
      <header className="page-header">
        <div><span className="eyebrow">POC EXECUTABLE BASELINE</span><h1>可执行架构基线</h1></div>
        <span className="status-chip">纵向切片可执行</span>
      </header>
      <div className="metric-grid">
        <Metric value="9" label="治理能力深模块" />
        <Metric value="30+" label="Phase 01 治理REST操作" />
        <Metric value="1" label="权威快照 / 每次发布" />
        <Metric value="0" label="治理数据库直连消费者" />
      </div>
      <article className="panel flow-panel">
        <div className="panel-heading"><div><span className="eyebrow">VERTICAL PATH</span><h2>本阶段证明什么</h2></div></div>
        <ol className="flow-line">
          {['收费项目发布', '完整价表发布', '固定两级解析', '审计与快照', '仿真消费闭环'].map((item, index) => (
            <li key={item}><span>{String(index + 1).padStart(2, '0')}</span><strong>{item}</strong></li>
          ))}
        </ol>
      </article>
    </section>
  );
}

function Metric({ value, label }: { readonly value: string; readonly label: string }) {
  return <article className="metric"><strong>{value}</strong><span>{label}</span></article>;
}

interface ChargeItemDraftReference {
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly versionNo: string;
  readonly internalCode: string;
  readonly formalName: string;
  readonly serviceDefinition: string;
  readonly billingUnitCode: string;
  readonly chargingMethodCode: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly governanceStatus: string;
  readonly contentDigest: string;
}

export function ChargeItemDraftPage() {
  const [governanceObjectId, setGovernanceObjectId] = useState('');
  const [chargeItemId, setChargeItemId] = useState('');
  const [chargeItemVersionId, setChargeItemVersionId] = useState('');
  const [internalCode, setInternalCode] = useState('');
  const [formalName, setFormalName] = useState('POC诊查费草稿');
  const [serviceDefinition, setServiceDefinition] = useState('合成POC收费项目草稿。');
  const [billingUnitCode, setBillingUnitCode] = useState('TIMES');
  const [chargingMethodCode, setChargingMethodCode] = useState('COUNT');
  const [businessValidFrom, setBusinessValidFrom] = useState(DEFAULT_BUSINESS_TIME);
  const [draft, setDraft] = useState<ChargeItemDraftReference | null>(null);
  const [history, setHistory] = useState<readonly ChargeItemDraftReference[]>([]);
  const [asOfVersion, setAsOfVersion] = useState<ChargeItemDraftReference | null>(null);
  const [differences, setDifferences] = useState<readonly { readonly field: string; readonly leftValue: string | null; readonly rightValue: string | null }[]>([]);
  const [leftVersionId, setLeftVersionId] = useState('');
  const [rightVersionId, setRightVersionId] = useState('');
  const [businessAt, setBusinessAt] = useState(DEFAULT_SERVICE_OCCURRED_AT);
  const [historyRecordAsOf, setHistoryRecordAsOf] = useState('2099-12-31T23:59:59');

  const content = {
    billingUnitCode,
    businessValidFrom,
    businessValidTo: null,
    chargingMethodCode,
    formalName,
    serviceDefinition,
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/charge-item-drafts', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: { governanceObjectId, internalCode, ...content },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) {
      setDraft(data);
      setChargeItemId(data.chargeItemId);
      setChargeItemVersionId(data.chargeItemVersionId);
      setLeftVersionId(data.chargeItemVersionId);
    },
  });

  const readMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET(
        '/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}',
        {
          params: {
            path: { chargeItemId, chargeItemVersionId },
            query: { governanceObjectId },
          },
        },
      );
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setDraft,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const response = await api.PUT(
        '/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}/draft',
        {
          params: {
            header: { 'x-csrf-token': browserCsrfToken },
            path: { chargeItemId, chargeItemVersionId },
          },
          body: { governanceObjectId, ...content },
        },
      );
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setDraft,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.DELETE(
        '/v1/phase-01/charge-items/{chargeItemId}/versions/{chargeItemVersionId}/draft',
        {
          params: {
            header: { 'x-csrf-token': browserCsrfToken },
            path: { chargeItemId, chargeItemVersionId },
            query: { governanceObjectId },
          },
        },
      );
      if (response.error) throw new Error(response.error.code);
    },
    onSuccess() {
      setDraft(null);
      setChargeItemId('');
      setChargeItemVersionId('');
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST(
        '/v1/phase-01/charge-items/{chargeItemId}/version-drafts',
        {
          params: {
            header: { 'x-csrf-token': browserCsrfToken },
            path: { chargeItemId },
          },
          body: { governanceObjectId, ...content },
        },
      );
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) {
      setDraft(data);
      setChargeItemVersionId(data.chargeItemVersionId);
      setRightVersionId(data.chargeItemVersionId);
    },
  });

  const historyMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/charge-items/{chargeItemId}/versions', {
        params: { path: { chargeItemId }, query: { governanceObjectId } },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data.versions;
    },
    onSuccess: setHistory,
  });

  const asOfMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/charge-items/{chargeItemId}/as-of', {
        params: {
          path: { chargeItemId },
          query: { governanceObjectId, businessAt, recordAsOf: historyRecordAsOf },
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setAsOfVersion,
  });

  const diffMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/charge-items/{chargeItemId}/version-diff', {
        params: {
          path: { chargeItemId },
          query: { governanceObjectId, leftVersionId, rightVersionId },
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data.differences;
    },
    onSuccess: setDifferences,
  });

  const identityReady = Boolean(governanceObjectId && chargeItemId && chargeItemVersionId);
  const error = createMutation.error ?? readMutation.error ?? updateMutation.error ?? deleteMutation.error ?? createVersionMutation.error ?? historyMutation.error ?? asOfMutation.error ?? diffMutation.error;

  return (
    <section>
      <header className="page-header">
        <div><span className="eyebrow">CHARGE ITEM GOVERNANCE</span><h1>收费项目草稿 CRUD</h1><p>稳定身份与草稿版本分离；只有未提交草稿允许修改和删除。</p></div>
      </header>
      <article className="panel config-panel">
        <div className="panel-heading"><div><span className="step-label">草稿上下文</span><h2>收费项目内容</h2></div></div>
        <div className="form-grid">
          <Field label="收费目录治理对象 ID" value={governanceObjectId} onChange={setGovernanceObjectId} />
          <Field label="收费项目稳定 ID" value={chargeItemId} onChange={setChargeItemId} />
          <Field label="收费项目版本 ID" value={chargeItemVersionId} onChange={setChargeItemVersionId} />
          <Field label="收费项目代码" value={internalCode} onChange={setInternalCode} placeholder="POC-FEE-001" />
          <Field label="正式名称" value={formalName} onChange={setFormalName} placeholder="收费项目名称" />
          <Field label="服务定义" value={serviceDefinition} onChange={setServiceDefinition} placeholder="收费服务内涵" />
          <Field label="计价单位代码" value={billingUnitCode} onChange={setBillingUnitCode} placeholder="TIMES" />
          <Field label="计费方式代码" value={chargingMethodCode} onChange={setChargingMethodCode} placeholder="COUNT" />
          <Field label="业务生效时间" value={businessValidFrom} onChange={setBusinessValidFrom} placeholder="YYYY-MM-DDTHH:mm:ss" />
          <Field label="差异左版本 ID" value={leftVersionId} onChange={setLeftVersionId} />
          <Field label="差异右版本 ID" value={rightVersionId} onChange={setRightVersionId} />
          <Field label="查询业务时点" value={businessAt} onChange={setBusinessAt} placeholder="YYYY-MM-DDTHH:mm:ss" />
          <Field label="查询记录时点" value={historyRecordAsOf} onChange={setHistoryRecordAsOf} placeholder="YYYY-MM-DDTHH:mm:ss" />
        </div>
        <div className="flow-line">
          <button disabled={!governanceObjectId || !internalCode || createMutation.isPending} onClick={() => createMutation.mutate()} type="button">新增草稿</button>
          <button disabled={!identityReady || readMutation.isPending} onClick={() => readMutation.mutate()} type="button">查询版本</button>
          <button disabled={!identityReady || updateMutation.isPending} onClick={() => updateMutation.mutate()} type="button">修改草稿</button>
          <button disabled={!identityReady || deleteMutation.isPending} onClick={() => deleteMutation.mutate()} type="button">删除草稿</button>
          <button disabled={!chargeItemId || createVersionMutation.isPending} onClick={() => createVersionMutation.mutate()} type="button">建立新版本候选</button>
          <button disabled={!chargeItemId || historyMutation.isPending} onClick={() => historyMutation.mutate()} type="button">查询版本历史</button>
          <button disabled={!chargeItemId || !businessAt || !historyRecordAsOf || asOfMutation.isPending} onClick={() => asOfMutation.mutate()} type="button">执行双时态查询</button>
          <button disabled={!chargeItemId || !leftVersionId || !rightVersionId || diffMutation.isPending} onClick={() => diffMutation.mutate()} type="button">比较版本差异</button>
        </div>
        {draft ? (
          <dl className="evidence">
            <dt>稳定 ID</dt><dd data-testid="draft-charge-item-id">{draft.chargeItemId}</dd>
            <dt>版本 ID</dt><dd data-testid="draft-charge-item-version-id">{draft.chargeItemVersionId}</dd>
            <dt>版本序号</dt><dd>{draft.versionNo}</dd>
            <dt>治理状态</dt><dd>{draft.governanceStatus}</dd>
            <dt>内容摘要</dt><dd data-testid="draft-content-digest">{draft.contentDigest}</dd>
          </dl>
        ) : null}
        {history.length > 0 ? (
          <ol className="flow-line" data-testid="charge-item-version-history">
            {history.map((version) => <li key={version.chargeItemVersionId}><span>{version.versionNo}</span><strong>{version.formalName} · {version.governanceStatus}</strong></li>)}
          </ol>
        ) : null}
        {asOfVersion ? <div className="result" data-testid="charge-item-as-of"><span>时态命中版本</span><strong>{asOfVersion.versionNo} · {asOfVersion.formalName}</strong></div> : null}
        {differences.length > 0 ? (
          <dl className="evidence" data-testid="charge-item-version-diff">
            {differences.map((difference) => <div key={difference.field}><dt>{difference.field}</dt><dd>{difference.leftValue ?? 'null'} → {difference.rightValue ?? 'null'}</dd></div>)}
          </dl>
        ) : null}
        {error ? <div className="error" role="alert">{error.message}</div> : null}
      </article>
    </section>
  );
}

interface PriceListDraftReference {
  readonly governanceObjectId: string;
  readonly priceListId: string;
  readonly priceListReleaseId: string;
  readonly releaseNo: string;
  readonly governanceStatus: string;
  readonly businessStatus: string;
  readonly contentDigest: string;
  readonly entries: readonly { readonly priceEntryId: string; readonly fixedUnitPrice: string }[];
}

export function PriceListDraftPage() {
  const [governanceObjectId, setGovernanceObjectId] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [priceListReleaseId, setPriceListReleaseId] = useState('');
  const [resolutionChargeItemId, setResolutionChargeItemId] = useState('');
  const [resolutionChargeItemVersionId, setResolutionChargeItemVersionId] = useState('');
  const [resolutionRecordAsOf, setResolutionRecordAsOf] = useState('2099-12-31T23:59:59');
  const [resolution, setResolution] = useState<ResolutionReference | null>(null);
  const [priceListCode, setPriceListCode] = useState(DEFAULT_PRICE_LIST_CODE);
  const [displayName, setDisplayName] = useState('POC院内价表草稿');
  const [chargeItemId, setChargeItemId] = useState('');
  const [chargeItemVersionId, setChargeItemVersionId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [scopeLevel, setScopeLevel] = useState<'HOSPITAL' | 'CAMPUS'>('HOSPITAL');
  const [encounterMode, setEncounterMode] = useState<'GENERAL' | 'SPECIFIC'>('GENERAL');
  const [encounterType, setEncounterType] = useState<'OUTPATIENT' | 'INPATIENT' | 'EMERGENCY' | 'CHECKUP'>('OUTPATIENT');
  const [fixedUnitPrice, setFixedUnitPrice] = useState('10.0000');
  const [billingUnitCode, setBillingUnitCode] = useState('TIMES');
  const [businessValidFrom, setBusinessValidFrom] = useState(DEFAULT_BUSINESS_TIME);
  const [draft, setDraft] = useState<PriceListDraftReference | null>(null);
  const [differences, setDifferences] = useState<readonly { readonly kind: string; readonly businessKey: string }[]>([]);

  const entries = [{
    chargeItemId,
    chargeItemVersionId,
    scopeLevel,
    campusId: scopeLevel === 'CAMPUS' ? campusId : null,
    encounterMode,
    encounterType: encounterMode === 'SPECIFIC' ? encounterType : null,
    fixedUnitPrice,
    billingUnitCode,
    businessValidFrom,
    businessValidTo: null,
    zeroPriceReason: fixedUnitPrice === '0' || fixedUnitPrice === '0.0000' ? 'POC零价说明' : null,
  }];
  const content = {
    governanceObjectId,
    displayName,
    currencyCode: 'CNY',
    businessValidFrom,
    businessValidTo: null,
    entries,
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/price-list-drafts', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: { ...content, priceListCode },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) {
      setDraft(data);
      setPriceListId(data.priceListId);
      setPriceListReleaseId(data.priceListReleaseId);
    },
  });
  const readMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}', {
        params: { path: { priceListId, priceListReleaseId }, query: { governanceObjectId } },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setDraft,
  });
  const updateMutation = useMutation({
    mutationFn: async () => {
      const response = await api.PUT('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}/draft', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { priceListId, priceListReleaseId },
        },
        body: content,
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setDraft,
  });
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await api.DELETE('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}/draft', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { priceListId, priceListReleaseId },
          query: { governanceObjectId },
        },
      });
      if (response.error) throw new Error(response.error.code);
    },
    onSuccess() {
      setDraft(null);
      setPriceListReleaseId('');
    },
  });
  const diffMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}/diff', {
        params: { path: { priceListId, priceListReleaseId }, query: { governanceObjectId } },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data.differences;
    },
    onSuccess: setDifferences,
  });
  const ready = Boolean(governanceObjectId && chargeItemId && chargeItemVersionId && billingUnitCode);
  const identityReady = Boolean(ready && priceListId && priceListReleaseId);
  const error = createMutation.error ?? readMutation.error ?? updateMutation.error ?? deleteMutation.error ?? diffMutation.error;

  return (
    <section>
      <header className="page-header"><div><span className="eyebrow">PRICE LIST GOVERNANCE</span><h1>价表草稿与完整快照</h1><p>草稿可整体替换条目；发布后形成冻结收费项目版本引用的不可变快照。</p></div></header>
      <article className="panel config-panel">
        <div className="form-grid">
          <Field label="价表治理对象 ID" value={governanceObjectId} onChange={setGovernanceObjectId} />
          <Field label="价表稳定 ID" value={priceListId} onChange={setPriceListId} />
          <Field label="价表发布 ID" value={priceListReleaseId} onChange={setPriceListReleaseId} />
          <Field label="价表代码" value={priceListCode} onChange={setPriceListCode} />
          <Field label="价表名称" value={displayName} onChange={setDisplayName} />
          <Field label="收费项目稳定 ID" value={chargeItemId} onChange={setChargeItemId} />
          <Field label="收费项目发布版本 ID" value={chargeItemVersionId} onChange={setChargeItemVersionId} />
          <Field label="院区 ID（院区价必填）" value={campusId} onChange={setCampusId} />
          <label>价格范围<select value={scopeLevel} onChange={(event) => setScopeLevel(event.target.value as 'HOSPITAL' | 'CAMPUS')}><option value="HOSPITAL">全院默认</option><option value="CAMPUS">院区差异</option></select></label>
          <label>场景模式<select value={encounterMode} onChange={(event) => setEncounterMode(event.target.value as 'GENERAL' | 'SPECIFIC')}><option value="GENERAL">通用</option><option value="SPECIFIC">专用</option></select></label>
          <label>实际场景<select value={encounterType} disabled={encounterMode === 'GENERAL'} onChange={(event) => setEncounterType(event.target.value as typeof encounterType)}><option value="OUTPATIENT">门诊</option><option value="INPATIENT">住院</option><option value="EMERGENCY">急诊</option><option value="CHECKUP">体检</option></select></label>
          <Field label="固定单价" value={fixedUnitPrice} onChange={setFixedUnitPrice} />
          <Field label="计价单位" value={billingUnitCode} onChange={setBillingUnitCode} />
          <Field label="业务生效时间" value={businessValidFrom} onChange={setBusinessValidFrom} />
        </div>
        <div className="flow-line">
          <button disabled={!ready || createMutation.isPending} onClick={() => createMutation.mutate()} type="button">新增草稿</button>
          <button disabled={!identityReady || readMutation.isPending} onClick={() => readMutation.mutate()} type="button">查询草稿</button>
          <button disabled={!identityReady || updateMutation.isPending} onClick={() => updateMutation.mutate()} type="button">替换条目</button>
          <button disabled={!identityReady || deleteMutation.isPending} onClick={() => deleteMutation.mutate()} type="button">删除草稿</button>
          <button disabled={!identityReady || diffMutation.isPending} onClick={() => diffMutation.mutate()} type="button">与上一发布比较</button>
        </div>
        {draft ? <dl className="evidence"><dt>价表 ID</dt><dd data-testid="draft-price-list-id">{draft.priceListId}</dd><dt>价表发布 ID</dt><dd data-testid="draft-price-list-release-id">{draft.priceListReleaseId}</dd><dt>版本序号</dt><dd>{draft.releaseNo}</dd><dt>治理/业务状态</dt><dd>{draft.governanceStatus} / {draft.businessStatus}</dd><dt>条目数</dt><dd>{draft.entries.length}</dd><dt>内容摘要</dt><dd data-testid="draft-price-content-digest">{draft.contentDigest}</dd></dl> : null}
        {differences.length > 0 ? <ol className="flow-line">{differences.map((difference) => <li key={`${difference.kind}:${difference.businessKey}`}><span>{difference.kind}</span><strong>{difference.businessKey}</strong></li>)}</ol> : null}
        {error ? <div className="error" role="alert">{error.message}</div> : null}
      </article>
    </section>
  );
}

interface ImportJobReference {
  readonly importJobId: string;
  readonly rawContentDigest: string;
  readonly jobStatus: string;
  readonly rowCount: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly rows: readonly {
    readonly importRowId: string;
    readonly rowNo: string;
    readonly sourceRowId: string;
    readonly rowStatus: string;
    readonly resultKind: string | null;
    readonly currentErrorCode: string | null;
  }[];
}

interface ChangeRequestReference {
  readonly changeRequestId: string;
  readonly requestStatus: string;
  readonly approvalTemplateVersionId: string;
  readonly nextActionSequence: string;
  readonly submittedContentDigest: string;
}

export function GovernanceOperationsPage() {
  const [governanceObjectId, setGovernanceObjectId] = useState('');
  const [stableEntityId, setStableEntityId] = useState('');
  const [entityVersionId, setEntityVersionId] = useState('');
  const [contentDigest, setContentDigest] = useState('');
  const [campusId, setCampusId] = useState('');
  const [rawContent, setRawContent] = useState('[\n  {\n    "rowId": "ROW-001",\n    "internalCode": "POC-FEE-IMPORT-001",\n    "formalName": "导入诊查费",\n    "serviceDefinition": "合成POC导入记录",\n    "billingUnitCode": "TIMES",\n    "chargingMethodCode": "COUNT",\n    "businessValidFrom": "2026-08-08T00:00:00",\n    "businessValidTo": null\n  }\n]');
  const [importType, setImportType] = useState<'CHARGE_ITEM' | 'PRICE_ENTRY'>('CHARGE_ITEM');
  const [sourceKind, setSourceKind] = useState<'CSV' | 'JSON'>('JSON');
  const [importJob, setImportJob] = useState<ImportJobReference | null>(null);
  const [entityType, setEntityType] = useState<'CHARGE_ITEM_VERSION' | 'PRICE_LIST_RELEASE'>('CHARGE_ITEM_VERSION');
  const [changeKind, setChangeKind] = useState<'INITIAL_PUBLICATION' | 'VERSION_CHANGE' | 'RETROACTIVE_CORRECTION' | 'CAMPUS_DIFFERENCE_PRICE' | 'PROJECTION_SCHEMA_UPGRADE' | 'RECOVERY_PUBLICATION'>('INITIAL_PUBLICATION');
  const [riskClassification, setRiskClassification] = useState<'NORMAL' | 'HIGH' | 'PURE_SCHEMA_UPGRADE' | 'RECOVERY'>('NORMAL');
  const [changeRequestId, setChangeRequestId] = useState(
    () => window.sessionStorage.getItem('phase01.changeRequestId') ?? '',
  );
  const [changeRequest, setChangeRequest] = useState<ChangeRequestReference | null>(null);
  const [stageType, setStageType] = useState<'PROFESSIONAL_REVIEW' | 'OWNER_FINAL_APPROVAL' | 'CAMPUS_PRE_CONFIRMATION' | 'DOMAIN_SEMANTIC_CONFIRMATION' | 'CONTRACT_FINAL_APPROVAL'>('PROFESSIONAL_REVIEW');
  const [priceListId, setPriceListId] = useState('');
  const [priceListReleaseId, setPriceListReleaseId] = useState('');
  const [resolutionChargeItemId, setResolutionChargeItemId] = useState('');
  const [resolutionChargeItemVersionId, setResolutionChargeItemVersionId] = useState('');
  const [resolutionRecordAsOf, setResolutionRecordAsOf] = useState('');
  const [resolution, setResolution] = useState<ResolutionReference | null>(null);
  const [impactCaseId, setImpactCaseId] = useState('');
  const [auditStreamId, setAuditStreamId] = useState('');
  const [auditEvents, setAuditEvents] = useState<readonly { readonly auditEventId: string; readonly auditSequence: string; readonly action: string }[]>([]);
  const [integrity, setIntegrity] = useState<{ readonly valid: boolean; readonly eventCount: number; readonly firstMismatchSequence: string | null } | null>(null);

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/import-jobs', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: { governanceObjectId, importType, sourceKind, schemaVersion: 'phase-01.import.v1', rawContent },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setImportJob,
  });
  const processMutation = useMutation({
    mutationFn: async () => {
      if (!importJob) throw new Error('请先建立导入批次');
      const response = await api.POST('/v1/phase-01/import-jobs/{importJobId}/process-next', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { importJobId: importJob.importJobId },
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setImportJob,
  });
  const retryMutation = useMutation({
    mutationFn: async () => {
      if (!importJob) throw new Error('请先建立导入批次');
      const response = await api.POST('/v1/phase-01/import-jobs/{importJobId}/retry', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { importJobId: importJob.importJobId },
        },
        body: { rawContentDigest: importJob.rawContentDigest },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setImportJob,
  });
  const submitChangeMutation = useMutation({
    mutationFn: async () => {
      const schemaUpgrade = changeKind === 'PROJECTION_SCHEMA_UPGRADE';
      const response = await api.POST('/v1/phase-01/change-requests', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: {
          governanceObjectId, entityType, stableEntityId, entityVersionId, changeKind,
          riskClassification, submittedContentDigest: contentDigest,
          changeReason: '管理界面提交的Phase 01合成变更',
          campusId: campusId || null,
          frozenEvidence: schemaUpgrade ? {
            oldSchemaVersion: '1', newSchemaVersion: '2',
            oldSchemaDigest: '0'.repeat(64), newSchemaDigest: '1'.repeat(64),
            openApiDiffDigest: '2'.repeat(64), memberSetDigest: '3'.repeat(64),
            compatibilityMatrixDigest: '4'.repeat(64), simulationEvidenceDigest: '5'.repeat(64),
            domainContentDigest: contentDigest, domainChanged: false, membersChanged: false,
            rulesChanged: false, lifecycleChanged: false,
          } : {},
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) {
      setChangeRequest(data);
      setChangeRequestId(data.changeRequestId);
      window.sessionStorage.setItem('phase01.changeRequestId', data.changeRequestId);
    },
  });
  const loadChangeRequestMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/change-requests/{changeRequestId}', {
        params: { path: { changeRequestId } },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data.request;
    },
    onSuccess: setChangeRequest,
  });
  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!changeRequest) throw new Error('请先提交变更');
      const response = await api.POST('/v1/phase-01/change-requests/{changeRequestId}/actions', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { changeRequestId: changeRequest.changeRequestId },
        },
        body: {
          stageType, actionResult: 'APPROVED', reason: 'Phase 01合成审批动作',
          seenContentDigest: changeRequest.submittedContentDigest, campusId: campusId || null,
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) {
      setChangeRequest(data);
      setChangeRequestId(data.changeRequestId);
      window.sessionStorage.setItem('phase01.changeRequestId', data.changeRequestId);
    },
  });
  const suspensionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/price-lists/{priceListId}/releases/{priceListReleaseId}/emergency-suspensions', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { priceListId, priceListReleaseId },
        },
        body: {
          governanceObjectId, scopeLevel: campusId ? 'CAMPUS' : 'HOSPITAL',
          campusId: campusId || null, effectiveFrom: DEFAULT_SERVICE_OCCURRED_AT,
          reason: 'Phase 01合成紧急暂停', evidence: { source: 'MANAGED_UI' },
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) { setImpactCaseId(data.impactCaseId); },
  });
  const reviewImpactMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/impact-cases/{impactCaseId}/post-incident-review', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { impactCaseId },
        },
        body: { governanceObjectId, reason: 'Phase 01事后复核', evidence: { source: 'MANAGED_UI' } },
      });
      if (response.error) throw new Error(response.error.code);
    },
  });
  const closeImpactMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/impact-cases/{impactCaseId}/closure', {
        params: {
          header: { 'x-csrf-token': browserCsrfToken },
          path: { impactCaseId },
        },
        body: { governanceObjectId, reason: 'Phase 01闭环确认', evidence: { source: 'MANAGED_UI' } },
      });
      if (response.error) throw new Error(response.error.code);
    },
  });
  const resolutionMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/price-resolutions', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: {
          governanceObjectId,
          requestId: `MANAGED-UI-${crypto.randomUUID()}`,
          chargeItemId: resolutionChargeItemId,
          chargeItemVersionId: resolutionChargeItemVersionId,
          priceListId,
          campusId,
          encounterType: 'OUTPATIENT',
          serviceOccurredAt: DEFAULT_SERVICE_OCCURRED_AT,
          recordAsOf: resolutionRecordAsOf,
          quantity: '2',
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setResolution,
  });
  const auditMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/audit-events', {
        params: { query: { governanceObjectId, limit: 100 } },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data.events;
    },
    onSuccess: setAuditEvents,
  });
  const integrityMutation = useMutation({
    mutationFn: async () => {
      const response = await api.GET('/v1/phase-01/audit-streams/{auditStreamId}/integrity', {
        params: { path: { auditStreamId }, query: { governanceObjectId } },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setIntegrity,
  });
  const error = importMutation.error ?? processMutation.error ?? retryMutation.error ?? submitChangeMutation.error ?? loadChangeRequestMutation.error ?? actionMutation.error ?? suspensionMutation.error ?? reviewImpactMutation.error ?? closeImpactMutation.error ?? resolutionMutation.error ?? auditMutation.error ?? integrityMutation.error;

  return (
    <section>
      <header className="page-header"><div><span className="eyebrow">GOVERNANCE OPERATIONS</span><h1>导入、审批、暂停与审计</h1><p>所有界面动作调用同一冻结REST契约，浏览器不复制治理规则。</p></div></header>
      <article className="panel config-panel">
        <div className="panel-heading"><div><span className="step-label">共同上下文</span><h2>对象与版本</h2></div></div>
        <div className="form-grid"><Field label="治理对象 ID" value={governanceObjectId} onChange={setGovernanceObjectId} /><Field label="稳定实体 ID" value={stableEntityId} onChange={setStableEntityId} /><Field label="实体版本 ID" value={entityVersionId} onChange={setEntityVersionId} /><Field label="内容 SHA-256" value={contentDigest} onChange={setContentDigest} /><Field label="院区 ID（可选）" value={campusId} onChange={setCampusId} /></div>
      </article>
      <div className="step-grid">
        <article className="panel step-card ready"><h2>批量导入</h2><div className="form-grid"><label>对象类型<select value={importType} onChange={(event) => setImportType(event.target.value as typeof importType)}><option value="CHARGE_ITEM">收费项目</option><option value="PRICE_ENTRY">价表条目</option></select></label><label>来源格式<select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as typeof sourceKind)}><option value="JSON">REST JSON</option><option value="CSV">UTF-8 CSV</option></select></label><label>选择本地文件<input type="file" accept=".csv,.json,text/csv,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then(setRawContent); }} /></label></div><textarea rows={10} value={rawContent} onChange={(event) => setRawContent(event.target.value)} /><div className="flow-line"><button type="button" onClick={() => importMutation.mutate()}>建立批次</button><button type="button" disabled={!importJob} onClick={() => processMutation.mutate()}>处理下一行</button><button type="button" disabled={!importJob} onClick={() => retryMutation.mutate()}>原批次重试</button></div>{importJob ? <><div className="result"><span>{importJob.jobStatus}</span><strong>{importJob.succeededCount}成功 / {importJob.failedCount}失败 / {importJob.rowCount}总行</strong></div><ol className="flow-line">{importJob.rows.map((row) => <li key={row.importRowId}><span>{row.rowNo}</span><strong>{row.sourceRowId} · {row.rowStatus} · {row.resultKind ?? row.currentErrorCode ?? '待处理'}</strong></li>)}</ol></> : null}</article>
        <article className="panel step-card ready"><h2>版本化审批</h2><div className="form-grid"><Field label="变更请求 ID" value={changeRequestId} onChange={setChangeRequestId} /><label>实体类型<select value={entityType} onChange={(event) => setEntityType(event.target.value as typeof entityType)}><option value="CHARGE_ITEM_VERSION">收费项目版本</option><option value="PRICE_LIST_RELEASE">价表发布版本</option></select></label><label>变更类型<select value={changeKind} onChange={(event) => setChangeKind(event.target.value as typeof changeKind)}><option value="INITIAL_PUBLICATION">初始发布</option><option value="VERSION_CHANGE">普通版本变更</option><option value="RETROACTIVE_CORRECTION">追溯更正</option><option value="CAMPUS_DIFFERENCE_PRICE">院区差异价</option><option value="PROJECTION_SCHEMA_UPGRADE">纯Schema升级</option><option value="RECOVERY_PUBLICATION">补偿恢复</option></select></label><label>风险分类<select value={riskClassification} onChange={(event) => setRiskClassification(event.target.value as typeof riskClassification)}><option value="NORMAL">普通</option><option value="HIGH">高风险</option><option value="PURE_SCHEMA_UPGRADE">纯Schema升级</option><option value="RECOVERY">恢复发布</option></select></label><label>下一动作<select value={stageType} onChange={(event) => setStageType(event.target.value as typeof stageType)}><option value="CAMPUS_PRE_CONFIRMATION">院区前置确认</option><option value="PROFESSIONAL_REVIEW">专业复核</option><option value="DOMAIN_SEMANTIC_CONFIRMATION">领域语义确认</option><option value="OWNER_FINAL_APPROVAL">Owner终审</option><option value="CONTRACT_FINAL_APPROVAL">契约终审</option></select></label></div><div className="flow-line"><button type="button" onClick={() => submitChangeMutation.mutate()}>提交变更</button><button type="button" disabled={!changeRequestId} onClick={() => loadChangeRequestMutation.mutate()}>载入请求</button><button type="button" disabled={!changeRequest} onClick={() => actionMutation.mutate()}>执行当前阶段</button></div>{changeRequest ? <div className="result"><span>{changeRequest.requestStatus}</span><strong>模板 {changeRequest.approvalTemplateVersionId} · 下一序号 {changeRequest.nextActionSequence}</strong></div> : null}</article>
        <article className="panel step-card ready"><h2>紧急暂停</h2><div className="form-grid"><Field label="价表 ID" value={priceListId} onChange={setPriceListId} /><Field label="价表发布 ID" value={priceListReleaseId} onChange={setPriceListReleaseId} /><Field label="影响事项 ID" value={impactCaseId} onChange={setImpactCaseId} /></div><div className="flow-line"><button type="button" onClick={() => suspensionMutation.mutate()}>追加紧急暂停事件</button><button type="button" disabled={!impactCaseId} onClick={() => reviewImpactMutation.mutate()}>事后复核</button><button type="button" disabled={!impactCaseId} onClick={() => closeImpactMutation.mutate()}>闭环确认</button></div>{impactCaseId ? <div className="result"><span>影响事项</span><strong>{impactCaseId}</strong></div> : null}</article>
        <article className="panel step-card ready"><h2>价格解析</h2><div className="form-grid"><Field label="解析收费项目 ID" value={resolutionChargeItemId} onChange={setResolutionChargeItemId} /><Field label="解析收费项目版本 ID" value={resolutionChargeItemVersionId} onChange={setResolutionChargeItemVersionId} /><Field label="解析记录时点" value={resolutionRecordAsOf} onChange={setResolutionRecordAsOf} placeholder="YYYY-MM-DDTHH:mm:ss" /></div><button type="button" disabled={!governanceObjectId || !priceListId || !campusId || !resolutionChargeItemId || !resolutionChargeItemVersionId || resolutionMutation.isPending} onClick={() => resolutionMutation.mutate()}>执行价格解析</button>{resolution ? <dl className="evidence"><dt>解析状态</dt><dd>{resolution.status}</dd><dt>解析金额</dt><dd data-testid="resolution-amount">CNY {resolution.finalAmount ?? '未命中'}</dd><dt>解析 ID</dt><dd data-testid="resolution-id">{resolution.priceResolutionId}</dd><dt>结果摘要</dt><dd data-testid="resolution-digest">{resolution.resultDigest ?? '无'}</dd></dl> : null}</article>
        <article className="panel step-card ready"><h2>审计与完整性</h2><Field label="审计流 ID" value={auditStreamId} onChange={setAuditStreamId} /><div className="flow-line"><button type="button" onClick={() => auditMutation.mutate()}>查询对象审计</button><button type="button" disabled={!auditStreamId} onClick={() => integrityMutation.mutate()}>验证哈希链</button></div>{integrity ? <div className="result"><span>{integrity.valid ? '完整' : '不一致'}</span><strong>{integrity.eventCount}条 · 首个异常 {integrity.firstMismatchSequence ?? '无'}</strong></div> : null}<ol className="flow-line">{auditEvents.map((event) => <li key={event.auditEventId}><span>{event.auditSequence}</span><strong>{event.action}</strong></li>)}</ol></article>
      </div>
      {error ? <div className="error" role="alert">{error.message}</div> : null}
    </section>
  );
}

export function VerticalSlicePage() {
  return (
    <section>
      <header className="page-header"><div><span className="eyebrow">GOVERNED VERTICAL SLICE</span><h1>收费项目—价表—解析闭环</h1><p>直接发布入口已停用。请依次建立草稿、提交版本化审批，并由独立身份完成复核与终审；发布成功后再执行价格解析。</p></div></header>
      <div className="step-grid">
        <article className="panel step-card ready"><span className="step-number">01</span><h2>收费项目草稿</h2><p>建立稳定身份和初始草稿版本，不产生发布或消费事件。</p><NavLink to="/charge-items">进入收费项目治理</NavLink></article>
        <article className="panel step-card ready"><span className="step-number">02</span><h2>价表完整草稿</h2><p>冻结收费项目明确版本、范围、场景和价格条目。</p><NavLink to="/price-lists">进入价表治理</NavLink></article>
        <article className="panel step-card ready"><span className="step-number">03</span><h2>审批、发布与闭环</h2><p>提交变更请求，按冻结阶段切换独立人员身份审批，再查看解析、审计和消费证据。</p><NavLink to="/operations">进入治理操作</NavLink></article>
      </div>
    </section>
  );
}

function Field({ label, value, onChange, placeholder = '00000000-0000-0000-0000-000000000000' }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void; readonly placeholder?: string }) {
  return <label className="field"><span>{label}</span><input required value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
