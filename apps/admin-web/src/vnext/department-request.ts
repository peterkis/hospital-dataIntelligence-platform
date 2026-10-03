export class DepartmentResponseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${code} · ${message}`);
  }
}
export async function departmentValue<T>(
  request: Promise<{
    data?: T;
    error?: { code?: string; message?: string };
    response?: { status: number };
  }>,
): Promise<T> {
  const result = await request;
  if (result.error)
    throw new DepartmentResponseError(
      result.response?.status ?? 500,
      result.error.code ?? "REQUEST_FAILED",
      result.error.message ?? "请求未完成",
    );
  if (result.data === undefined) throw new Error("响应未完成，请恢复原请求。");
  return result.data;
}
export const definiteFailure = (error: unknown): boolean =>
  error instanceof DepartmentResponseError &&
  ((error.status >= 400 && error.status < 500) ||
    error.code === "BLOCKED_DEPENDENCY");

export interface DepartmentPendingSubmission {
  id: string;
  expectedVersion: string;
  requestId: string;
}
// Persist only command identity/version metadata, never source rows or attachments.
export function pendingDepartmentSubmission(
  key: string,
): DepartmentPendingSubmission | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const item: unknown = JSON.parse(raw);
  if (!item || typeof item !== "object") throw new Error("提交恢复标识无效。");
  const data = item as Record<string, unknown>;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (
    Object.keys(data).sort().join(",") !== "expectedVersion,id,requestId" ||
    typeof data["id"] !== "string" ||
    !uuid.test(data["id"]) ||
    typeof data["requestId"] !== "string" ||
    !uuid.test(data["requestId"]) ||
    typeof data["expectedVersion"] !== "string" ||
    !/^[1-9][0-9]*$/.test(data["expectedVersion"])
  )
    throw new Error("提交恢复标识无效。");
  return data as unknown as DepartmentPendingSubmission;
}
