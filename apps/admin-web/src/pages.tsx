import { useMemo, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';

let api = createGovernanceApiClient({ baseUrl: '' });
let browserCsrfToken = '';
const DEFAULT_BUSINESS_TIME = '2026-08-08T00:00:00';

interface PublishedReference {
  readonly stableId: string;
  readonly versionId: string;
  readonly releaseId: string;
  readonly snapshotId: string;
  readonly eventId: string;
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
        </nav>
        <div className="scope-note">
          <span>当前范围</span>
          <strong>单一医院治理主体</strong>
          <small>固定 Asia/Shanghai · 合成数据</small>
        </div>
      </aside>
      <main className="content"><Outlet /></main>
    </div>
  );
}

export function OverviewPage() {
  return (
    <section>
      <header className="page-header">
        <div><span className="eyebrow">POC EXECUTABLE BASELINE</span><h1>可执行架构基线</h1></div>
        <span className="status-chip">纵向切片可执行</span>
      </header>
      <div className="metric-grid">
        <Metric value="7" label="治理能力深模块" />
        <Metric value="9" label="冻结 Phase 01 治理REST操作" />
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

export function VerticalSlicePage() {
  const [chargeObjectId, setChargeObjectId] = useState('');
  const [priceObjectId, setPriceObjectId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [charge, setCharge] = useState<PublishedReference | null>(null);
  const [price, setPrice] = useState<PublishedReference | null>(null);
  const [priceListId, setPriceListId] = useState('');
  const [resolution, setResolution] = useState<{ finalAmount: string | null; resultDigest: string | null } | null>(null);

  const chargeMutation = useMutation({
    mutationFn: async () => {
      const response = await api.POST('/v1/phase-01/charge-item-publications', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: {
          governanceObjectId: chargeObjectId,
          catalogCode: 'HOSPITAL-CHARGE-CATALOG',
          internalCode: 'POC-FEE-001',
          formalName: 'POC诊查费',
          serviceDefinition: '合成POC收费项目，仅用于验证治理闭环。',
          billingUnitCode: 'TIMES',
          chargingMethodCode: 'COUNT',
          businessValidFrom: DEFAULT_BUSINESS_TIME,
          businessValidTo: null,
          changeReason: '管理界面建立收费项目初始版本',
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setCharge,
  });

  const priceMutation = useMutation({
    mutationFn: async () => {
      if (!charge) throw new Error('请先发布收费项目');
      const response = await api.POST('/v1/phase-01/price-list-publications', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: {
          governanceObjectId: priceObjectId,
          priceListCode: 'HOSPITAL-DEFAULT-PRICE',
          displayName: 'POC全院默认价表',
          currencyCode: 'CNY',
          businessValidFrom: DEFAULT_BUSINESS_TIME,
          businessValidTo: null,
          changeReason: '管理界面建立价表初始完整快照',
          entries: [{
            chargeItemId: charge.stableId,
            chargeItemVersionId: charge.versionId,
            scopeLevel: 'HOSPITAL',
            campusId: null,
            encounterMode: 'GENERAL',
            encounterType: null,
            fixedUnitPrice: '12.34',
            billingUnitCode: 'TIMES',
            businessValidFrom: DEFAULT_BUSINESS_TIME,
            businessValidTo: null,
            zeroPriceReason: null,
          }],
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess(data) { setPrice(data); setPriceListId(data.stableId); },
  });

  const resolutionMutation = useMutation({
    mutationFn: async () => {
      if (!charge || !priceListId) throw new Error('请先发布收费项目和价表');
      const response = await api.POST('/v1/phase-01/price-resolutions', {
        params: { header: { 'x-csrf-token': browserCsrfToken } },
        body: {
          governanceObjectId: priceObjectId,
          requestId: `UI-POC-${crypto.randomUUID()}`,
          chargeItemId: charge.stableId,
          chargeItemVersionId: charge.versionId,
          priceListId,
          campusId,
          encounterType: 'OUTPATIENT',
          serviceOccurredAt: '2026-08-08T09:15:00',
          recordAsOf: '2026-08-08T09:20:00',
          quantity: '2',
        },
      });
      if (response.error) throw new Error(response.error.code);
      return response.data;
    },
    onSuccess: setResolution,
  });

  const ready = useMemo(() => Boolean(chargeObjectId && priceObjectId && campusId), [chargeObjectId, priceObjectId, campusId]);
  const submit = (action: () => void) => (event: FormEvent) => { event.preventDefault(); action(); };

  return (
    <section>
      <header className="page-header"><div><span className="eyebrow">END-TO-END CONTROL</span><h1>收费项目—价表—解析</h1><p>所有写操作均提交至治理 API；浏览器只显示服务端确认结果。</p></div></header>
      <article className="panel config-panel">
        <div className="panel-heading"><div><span className="step-label">准备</span><h2>合成治理上下文</h2></div></div>
        <div className="form-grid">
          <Field label="收费目录治理对象 ID" value={chargeObjectId} onChange={setChargeObjectId} />
          <Field label="价表治理对象 ID" value={priceObjectId} onChange={setPriceObjectId} />
          <Field label="当前院区 ID" value={campusId} onChange={setCampusId} />
        </div>
      </article>
      <div className="step-grid">
        <StepCard number="01" title="发布收费项目" state={charge ? 'done' : 'ready'} onSubmit={submit(() => chargeMutation.mutate())} disabled={!ready || chargeMutation.isPending} error={chargeMutation.error} reference={charge} />
        <StepCard number="02" title="发布完整价表" state={price ? 'done' : charge ? 'ready' : 'locked'} onSubmit={submit(() => priceMutation.mutate())} disabled={!charge || priceMutation.isPending} error={priceMutation.error} reference={price} />
        <StepCard number="03" title="执行价格解析" state={resolution ? 'done' : price ? 'ready' : 'locked'} onSubmit={submit(() => resolutionMutation.mutate())} disabled={!price || resolutionMutation.isPending} error={resolutionMutation.error} result={resolution ? `CNY ${resolution.finalAmount ?? '未命中'}` : undefined} />
      </div>
    </section>
  );
}

function Field({ label, value, onChange }: { readonly label: string; readonly value: string; readonly onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input required value={value} onChange={(event) => onChange(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" /></label>;
}

function StepCard(props: { readonly number: string; readonly title: string; readonly state: 'locked' | 'ready' | 'done'; readonly onSubmit: (event: FormEvent) => void; readonly disabled: boolean; readonly error: Error | null; readonly reference?: PublishedReference | null; readonly result?: string | undefined }) {
  return (
    <article className={`panel step-card ${props.state}`}>
      <form onSubmit={props.onSubmit}>
        <div className="panel-heading"><span className="step-number">{props.number}</span><span className="state">{props.state === 'done' ? '已完成' : props.state === 'locked' ? '等待前序' : '可执行'}</span></div>
        <h2>{props.title}</h2>
        <p>{props.state === 'locked' ? '完成前序步骤后自动解锁。' : '调用冻结契约，并以服务端事务结果作为唯一成功依据。'}</p>
        <button disabled={props.disabled} type="submit">{props.state === 'done' ? '重新执行' : '执行步骤'}</button>
        {props.reference ? <dl className="evidence"><dt>发布 ID</dt><dd>{props.reference.releaseId}</dd><dt>快照 ID</dt><dd>{props.reference.snapshotId}</dd></dl> : null}
        {props.result ? <div className="result"><span>解析金额</span><strong>{props.result}</strong></div> : null}
        {props.error ? <div className="error" role="alert">{props.error.message}</div> : null}
      </form>
    </article>
  );
}
