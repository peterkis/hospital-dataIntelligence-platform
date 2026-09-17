export interface ImportStatusView {
  code: string;
  label: string;
  terminal: boolean;
}

const statusLabels: Readonly<Record<string, Omit<ImportStatusView, "code">>> =
  Object.freeze({
    RECEIVED: { label: "文件已接收", terminal: false },
    FILE_RECEIVED: { label: "文件已接收", terminal: false },
    QUARANTINED: { label: "文件已接收（隔离中）", terminal: false },
    ACCEPTED: { label: "文件已接收，尚未解析", terminal: false },
    WAITING_INPUT: { label: "等待文件输入", terminal: false },
    NOT_INSPECTED: { label: "尚未解析", terminal: false },
    PARSED: { label: "文件结构解析完成", terminal: false },
    REJECTED: { label: "文件结构解析失败", terminal: false },
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

export function describeImportStatus(code: string): ImportStatusView {
  const view = Object.prototype.hasOwnProperty.call(statusLabels, code)
    ? statusLabels[code]
    : undefined;
  return view
    ? { code, ...view }
    : { code, label: "状态：" + code, terminal: false };
}
