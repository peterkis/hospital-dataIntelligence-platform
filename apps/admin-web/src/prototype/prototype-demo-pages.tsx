import { useEffect, useState } from 'react';
import {
  loadPrototypeDemoDashboard,
  type PrototypeDemoDashboard,
} from './prototype-api.js';
import { LocalTime, TechnicalDetails } from './prototype-components.js';

export function DashboardPage() {
  const state = useDemoDashboard();
  if (state.error) return <DemoLoadError />;
  if (!state.dashboard) return <p className="demo-loading">正在读取合成演示数据…</p>;
  const dashboard = state.dashboard;
  return (
    <section className="demo-dashboard">
      <header className="dashboard-hero">
        <div>
          <p className="prototype-kicker">HOSPITAL DATA GOVERNANCE / DEMO READY</p>
          <h1>医院数据治理驾驶舱</h1>
          <p>数据治理演示环境 · <strong>{dashboard.organization.displayName}</strong></p>
        </div>
        <div className="dashboard-clock">
          <span>平台时间</span>
          <LocalTime value={dashboard.currentLocalDateTime} />
        </div>
      </header>

      <div className="metric-grid" aria-label="治理对象统计">
        <Metric label="收费项目" value={dashboard.counts.chargeItemCount} note="合成治理对象" />
        <Metric label="已发布版本" value={dashboard.counts.publishedChargeVersionCount} note="另有 5 个修订草稿" />
        <Metric label="价表" value={dashboard.counts.priceListCount} note="覆盖全院与两个院区" />
        <Metric label="审批事件" value={dashboard.counts.approvalEventCount} note="职责分离完整留痕" />
        <Metric label="审计事件" value={dashboard.counts.auditEventCount} note="只追加可追溯" />
      </div>

      <div className="dashboard-columns">
        <section className="dashboard-panel lifecycle-panel">
          <header><span>治理生命周期</span><strong>从采集到追溯</strong></header>
          <ol className="lifecycle-chain">
            {['采集', '标准化', '审核', '发布', '消费', '追溯'].map((step, index) => (
              <li key={step}><span>{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>
            ))}
          </ol>
        </section>
        <section className="dashboard-panel resolution-explainer">
          <header><span>规则可解释</span><strong>价格解析链</strong></header>
          <ResolutionRuleChain resolution={dashboard.resolution} />
        </section>
      </div>

      <section className="dashboard-panel">
        <header><span>Audit Timeline</span><strong>最近治理事件</strong></header>
        <AuditTimeline events={dashboard.auditTimeline.slice(0, 6)} />
      </section>
    </section>
  );
}

export function DomainExplorerPage() {
  const state = useDemoDashboard();
  if (state.error) return <DemoLoadError />;
  if (!state.dashboard) return <p className="demo-loading">正在读取主题域…</p>;
  const dashboard = state.dashboard;
  const domains = [
    ['组织主数据', '规划中'],
    ['人员主数据', '规划中'],
    ['科室主数据', '规划中'],
    ['收费项目', '已实现'],
    ['价表', '已实现'],
    ['审批流程', '规划中'],
    ['审计日志', '规划中'],
  ] as const;
  return (
    <section>
      <header className="page-heading">
        <p className="prototype-kicker">MASTER DATA BLUEPRINT</p>
        <h1>医院数据治理主题域</h1>
        <p>以收费项目与价表验证纵向切片，其余主题域保留医院 MDM 蓝图位置。</p>
      </header>
      <div className="domain-grid">
        {domains.map(([name, status], index) => (
          <article className={status === '已实现' ? 'domain-card implemented' : 'domain-card planned'} key={name}>
            <span>{String(index + 1).padStart(2, '0')}</span>
            <h2>{name}</h2>
            <strong>{status}</strong>
            {name === '收费项目' ? <p>{dashboard.counts.chargeItemCount} 个对象 · {dashboard.counts.publishedChargeVersionCount} 个已发布版本</p> : null}
            {name === '价表' ? <p>{dashboard.counts.priceListCount} 套价表 · 不同院区、生效时间与价格</p> : null}
          </article>
        ))}
      </div>
      <section className="dashboard-panel explorer-data">
        <header><span>当前演示对象</span><strong>收费项目与价表</strong></header>
        <div className="explorer-columns">
          <div>
            <h3>收费项目</h3>
            {dashboard.chargeItems.map((item) => (
              <article className="business-object-row" key={item.code}>
                <div><strong>{item.displayName}</strong><span>{item.code}</span></div>
                <span>已发布 + 修订草稿</span>
                <TechnicalDetails>
                  <code>objectId: {item.objectId}</code>
                  <code>versionId: {item.publishedVersion?.versionId}</code>
                  <code>digest: {item.publishedVersion?.digest}</code>
                </TechnicalDetails>
              </article>
            ))}
          </div>
          <div>
            <h3>价表</h3>
            {dashboard.priceLists.map((item) => (
              <article className="business-object-row" key={item.code}>
                <div><strong>{item.displayName}</strong><span>{item.scopeLabel} · {formatDemoDecimal(item.fixedUnitPrice)} CNY</span></div>
                <LocalTime value={item.businessValidFrom} />
                <TechnicalDetails>
                  <code>objectId: {item.objectId}</code>
                  <code>versionId: {item.versionId}</code>
                  <code>digest: {item.digest}</code>
                </TechnicalDetails>
              </article>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}

export function GovernanceFlowRail() {
  return (
    <aside className="governance-flow-rail" aria-label="治理流程步骤">
      <span>治理流程</span>
      <ol>
        {['创建', '提交', '审核', '发布', '消费'].map((step, index) => (
          <li key={step}><strong>{index + 1}</strong><span>{step}</span></li>
        ))}
      </ol>
      <p>右侧操作始终通过平台治理服务执行，技术标识默认收起。</p>
    </aside>
  );
}

export function AuditTimeline({ events }: { readonly events: PrototypeDemoDashboard['auditTimeline'] }) {
  return (
    <ol className="demo-audit-timeline">
      {events.map((event) => (
        <li key={event.auditEventId}>
          <time>{event.timestamp}</time>
          <div><strong>{event.actor}</strong><span>{event.role}</span><p>{event.action}</p></div>
          <TechnicalDetails><code>auditSequence: {event.auditSequence}</code><code>{event.auditEventId}</code></TechnicalDetails>
        </li>
      ))}
    </ol>
  );
}

function ResolutionRuleChain({ resolution }: { readonly resolution: PrototypeDemoDashboard['resolution'] }) {
  return (
    <div className="rule-chain">
      <div className="rule-request">请求</div>
      {resolution.steps.map((step) => (
        <div className={step.decision === '命中' ? 'rule-step matched' : 'rule-step'} key={step.stepNo}>
          <span>{step.label}</span><strong>{step.decision}</strong>
        </div>
      ))}
      <div className="rule-result">
        <span>最终价格 <strong>{formatDemoDecimal(resolution.unitPrice)} CNY</strong></span>
        <span>数量 <strong>{formatDemoDecimal(resolution.quantity)}</strong></span>
        <span>金额 <strong>{formatDemoDecimal(resolution.finalAmount)} CNY</strong></span>
      </div>
      <TechnicalDetails><code>objectId: {resolution.objectId}</code><code>digest: {resolution.digest}</code></TechnicalDetails>
    </div>
  );
}

function Metric({ label, value, note }: { readonly label: string; readonly value: number; readonly note: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

function useDemoDashboard(): { readonly dashboard: PrototypeDemoDashboard | null; readonly error: boolean } {
  const [dashboard, setDashboard] = useState<PrototypeDemoDashboard | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void loadPrototypeDemoDashboard().then((result) => {
      if (active) setDashboard(result);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => { active = false; };
  }, []);
  return { dashboard, error };
}

function DemoLoadError() {
  return (
    <div className="prototype-error" role="alert">
      <strong>Demo 数据尚未准备完成</strong>
      <span>请先执行 npm run prototype:demo:prepare，再重新打开本页。</span>
    </div>
  );
}

export function formatDemoDecimal(value: string | null): string {
  if (value === null) return '—';
  return value.replace(/(\.\d*?[1-9])0+$/u, '$1').replace(/\.0+$/u, '');
}
