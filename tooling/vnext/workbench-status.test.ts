import { test, expect } from "vitest";
import {
  describeImportJobStatus,
  describeImportStatus,
  describeParseStatus,
} from "../../apps/admin-web/src/vnext/import-status.js";

test("P0-09 keeps parsed, blocked, review, and committed states distinct", () => {
  expect(describeImportStatus("PARSED")).toEqual({
    code: "PARSED",
    label: "文件结构解析完成",
    terminal: false,
  });
  expect(describeImportStatus("VALIDATION_FAILED")).toEqual({
    code: "VALIDATION_FAILED",
    label: "存在数据质量问题",
    terminal: false,
  });
  expect(describeImportStatus("BLOCKED_DEPENDENCY")).toEqual({
    code: "BLOCKED_DEPENDENCY",
    label: "等待治理条件",
    terminal: false,
  });
  expect(describeImportStatus("READY_FOR_REVIEW")).toEqual({
    code: "READY_FOR_REVIEW",
    label: "可进入审核",
    terminal: false,
  });
  expect(describeImportStatus("COMMITTED")).toEqual({
    code: "COMMITTED",
    label: "已完成应用",
    terminal: true,
  });
  expect(describeImportStatus("PARSED").label).not.toBe(
    describeImportStatus("COMMITTED").label,
  );
});

test("P0-09 gives REJECTED a context-specific meaning", () => {
  expect(describeImportJobStatus("REJECTED").label).toBe("批次已拒绝");
  expect(describeParseStatus("REJECTED").label).toBe("文件结构解析失败");
  expect(describeImportStatus("REJECTED").label).toBe("状态：REJECTED");
});

test("P0-09 preserves unknown backend states instead of calling them success", () => {
  expect(describeImportStatus("SOME_NEW_STATE")).toEqual({
    code: "SOME_NEW_STATE",
    label: "状态：SOME_NEW_STATE",
    terminal: false,
  });
  expect(describeImportStatus("toString")).toEqual({
    code: "toString",
    label: "状态：toString",
    terminal: false,
  });
});

test("P0-09 gives explicit labels to work that has not started", () => {
  expect(describeImportStatus("ACCEPTED").label).toBe("文件已接收，尚未解析");
  expect(describeImportStatus("NOT_INSPECTED").label).toBe("尚未解析");
  expect(describeImportStatus("NOT_RUN").label).toBe("尚未校验");
  expect(describeImportStatus("NOT_APPROVED").label).toBe("尚未批准");
});
