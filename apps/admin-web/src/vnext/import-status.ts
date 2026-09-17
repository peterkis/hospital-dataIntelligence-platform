export interface ImportStatusView {
  code: string;
  label: string;
  terminal: boolean;
}

export type ImportStatusContext =
  | "generic"
  | "job"
  | "parse"
  | "validation"
  | "apply";

const statusLabels: Readonly<Record<string, Omit<ImportStatusView, "code">>> =
  Object.freeze({
    RECEIVED: { label: "文件已接收", terminal: false },
    FILE_RECEIVED: { label: "文件已接收", terminal: false },
    QUARANTINED: { label: "文件已接收（隔离中）", terminal: false },
    ACCEPTED: { label: "文件已接收，尚未解析", terminal: false },
    WAITING_INPUT: { label: "等待文件输入", terminal: false },
    NOT_INSPECTED: { label: "尚未解析", terminal: false },
    PARSED: { label: "文件结构解析完成", terminal: false },
    VALIDATION_COMPLETED: { label: "校验已完成", terminal: false },
    VALIDATION_FAILED: { label: "存在数据质量问题", terminal: false },
    FAIL: { label: "存在数据质量问题", terminal: false },
    QUALITY_BLOCKED: { label: "存在未解决的数据质量问题", terminal: false },
    BLOCKED: { label: "等待治理条件", terminal: false },
    BLOCKED_DEPENDENCY: { label: "等待治理条件", terminal: false },
    FROZEN: { label: "候选已冻结，等待审核", terminal: false },
    READY_FOR_REVIEW: { label: "可进入审核", terminal: false },
    READ_READY: { label: "可进入审核", terminal: false },
    APPROVED: { label: "已批准，等待应用", terminal: false },
    COMMITTED: { label: "已完成应用", terminal: true },
    POST_COMMIT_FAILED: { label: "已完成应用，后续通知未完成", terminal: true },
    COMMIT_UNKNOWN: { label: "应用结果待确认", terminal: false },
    NOT_COMMITTED: { label: "尚未完成应用", terminal: false },
    NOT_RUN: { label: "尚未校验", terminal: false },
    NOT_APPROVED: { label: "尚未批准", terminal: false },
    QUALITY_ITEMS: { label: "质量问题已读取", terminal: false },
    RESTRICTED_EXPLANATION: { label: "已读取受限校验解释", terminal: false },
    FINITE_PREVIEW: { label: "有限范围预览完成", terminal: false },
    EXACT_TEMPLATE: { label: "精确模板已生成", terminal: false },
    MATCHED: { label: "对账一致", terminal: false },
    MISMATCH: { label: "对账不一致", terminal: false },
  });

const contextualStatusLabels: Readonly<
  Record<ImportStatusContext, Readonly<Record<string, Omit<ImportStatusView, "code">>>>
> = Object.freeze({
  generic: Object.freeze({}),
  job: Object.freeze({
    REJECTED: { label: "批次已拒绝", terminal: false },
  }),
  parse: Object.freeze({
    REJECTED: { label: "文件结构解析失败", terminal: false },
  }),
  validation: Object.freeze({
    REJECTED: { label: "校验结果被拒绝", terminal: false },
  }),
  apply: Object.freeze({
    REJECTED: { label: "候选已拒绝", terminal: false },
  }),
});

export function describeImportStatus(
  code: string,
  context: ImportStatusContext = "generic",
): ImportStatusView {
  const contextual = contextualStatusLabels[context];
  let view: Omit<ImportStatusView, "code"> | undefined;
  if (Object.prototype.hasOwnProperty.call(contextual, code)) {
    view = contextual[code];
  } else if (Object.prototype.hasOwnProperty.call(statusLabels, code)) {
    view = statusLabels[code];
  }
  return view
    ? { code, ...view }
    : { code, label: "状态：" + code, terminal: false };
}

export function describeImportJobStatus(code: string): ImportStatusView {
  return describeImportStatus(code, "job");
}

export function describeParseStatus(code: string): ImportStatusView {
  return describeImportStatus(code, "parse");
}

export function describeValidationStatus(code: string): ImportStatusView {
  return describeImportStatus(code, "validation");
}

export function describeApplyStatus(code: string): ImportStatusView {
  return describeImportStatus(code, "apply");
}
