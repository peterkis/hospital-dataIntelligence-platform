import type { ReactNode } from 'react';
import type {
  PrototypeRoleCode,
  WorkflowActionState,
} from './prototype-state.js';

export const ROLE_LABELS: Readonly<Record<PrototypeRoleCode, string>> = {
  'prototype-owner': '数据维护员',
  'prototype-reviewer': '专业审核员',
  'prototype-final-owner': '终审负责人',
};

export function PrototypeBanner() {
  return (
    <div className="prototype-banner" role="note" aria-label="原型环境提示">
      <strong>🏥 医院数据治理平台 Demo</strong>
      <span>环境：Synthetic Prototype</span>
      <span>身份：Prototype Synthetic</span>
      <span>时间：Asia/Shanghai</span>
      <span>非生产环境</span>
    </div>
  );
}

export function RoleSwitcher({
  currentRole,
  onChange,
}: {
  readonly currentRole: PrototypeRoleCode | null;
  readonly onChange: (role: PrototypeRoleCode) => void;
}) {
  return (
    <div className="role-switcher" aria-label="原型身份">
      <span>当前身份</span>
      <div className="role-buttons">
        {(Object.entries(ROLE_LABELS) as [PrototypeRoleCode, string][]).map(([code, label]) => (
          <button
            aria-pressed={currentRole === code}
            className={currentRole === code ? 'selected' : ''}
            key={code}
            onClick={() => onChange(code)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <details>
        <summary>查看技术身份</summary>
        <code>{currentRole ?? '未选择'}</code>
      </details>
    </div>
  );
}

export function StepCard({
  number,
  title,
  summary,
  status,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly summary: string;
  readonly status: 'complete' | 'current' | 'locked';
  readonly children: ReactNode;
}) {
  const statusText = status === 'complete' ? '已完成' : status === 'current' ? '当前步骤' : '等待前序步骤';
  return (
    <article className={`journey-step ${status}`} aria-labelledby={`journey-step-${number}`}>
      <div className="step-rail" aria-hidden="true"><span>{number}</span></div>
      <div className="step-body">
        <header>
          <div>
            <small>步骤 {number} / 8</small>
            <h2 id={`journey-step-${number}`}>{title}</h2>
            <p>{summary}</p>
          </div>
          <span className={`step-status ${status}`}>{statusText}</span>
        </header>
        {children}
      </div>
    </article>
  );
}

export function LoadingButton({
  busy,
  children,
  disabled = false,
  onClick,
  kind = 'primary',
}: {
  readonly busy: boolean;
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly kind?: 'primary' | 'secondary';
}) {
  return (
    <button
      className={`action-button ${kind}`}
      disabled={disabled || busy}
      onClick={onClick}
      type="button"
    >
      {busy ? '正在处理，请稍候…' : children}
    </button>
  );
}

export function RequiredRole({
  currentRole,
  requiredRole,
  onSwitch,
}: {
  readonly currentRole: PrototypeRoleCode | null;
  readonly requiredRole: PrototypeRoleCode;
  readonly onSwitch: (role: PrototypeRoleCode) => void;
}) {
  if (currentRole === requiredRole) return null;
  return (
    <div className="role-required" role="status">
      <div>
        <strong>需要切换到{ROLE_LABELS[requiredRole]}</strong>
        <span>职责分离不会被自动绕过。</span>
      </div>
      <button onClick={() => onSwitch(requiredRole)} type="button">切换身份</button>
    </div>
  );
}

export function TechnicalDetails({ children }: { readonly children: ReactNode }) {
  return (
    <details className="technical-details">
      <summary>技术详情</summary>
      <div>{children}</div>
    </details>
  );
}

export function LocalTime({ value }: { readonly value: string }) {
  return <span className="local-time">{value} <small>Asia/Shanghai</small></span>;
}

export function ErrorNotice({
  error,
}: {
  readonly error: { readonly title: string; readonly detail: string } | null;
}) {
  if (!error) return null;
  return (
    <div className="prototype-error" role="alert">
      <strong>{error.title}</strong>
      <span>本步骤未推进，可以修正后重试。</span>
      <TechnicalDetails><code>{error.detail}</code></TechnicalDetails>
    </div>
  );
}

export function WorkflowTimeline({ actions }: { readonly actions: readonly WorkflowActionState[] }) {
  if (actions.length === 0) return <p className="empty-state">已提交，等待专业审核。</p>;
  return (
    <ol className="approval-timeline">
      {actions.map((action) => (
        <li key={action.actionSequence}>
          <span aria-hidden="true">✓</span>
          <div>
            <strong>{stageLabel(action.stageType)}</strong>
            <p>{action.reason}</p>
            <LocalTime value={action.occurredAt} />
          </div>
        </li>
      ))}
    </ol>
  );
}

export function stageLabel(stage: string): string {
  if (stage === 'PROFESSIONAL_REVIEW') return '专业审核员已审核';
  if (stage === 'OWNER_FINAL_APPROVAL') return '终审负责人已批准';
  return '治理审批动作';
}
