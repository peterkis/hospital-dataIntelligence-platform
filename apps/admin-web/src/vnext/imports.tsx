import { useEffect, useRef, useState } from "react";
import { createVNextCatalogClient } from "@hospital-data-intelligence/generated-api-client";
import type { VNextOperations as operations } from "@hospital-data-intelligence/generated-api-client";
import {
  describeImportStatus,
  type ImportStatusContext,
} from "./import-status.js";
import {
  MAX_RAW_FILE_BYTES,
  encodeWorkbenchFile,
} from "./workbench-file.js";

type Summary =
  operations["readWorkbenchJob"]["responses"][200]["content"]["application/json"];
type Result =
  operations["importWorkbenchAction"]["responses"][200]["content"]["application/json"];
type Contract =
  operations["listImportContracts"]["responses"][200]["content"]["application/json"]["items"][number];
type Action =
  operations["importWorkbenchAction"]["requestBody"]["content"]["application/json"]["action"];
const statusLine = (
  code: string,
  context: ImportStatusContext = "generic",
) => {
  const view = describeImportStatus(code, context);
  return view.code + " · " + view.label;
};
function actionStatusContext(action: Action): ImportStatusContext {
  if (action === "PARSE") return "parse";
  if (action === "VALIDATE" || action === "ERROR_WORKBOOK")
    return "validation";
  return "generic";
}
const dimensions = {
  scope: "SYNTHETIC" as const,
  campus: "NORTH" as const,
  purpose: "IDENTITY_VERIFY" as const,
};
const uuid = () => crypto.randomUUID();
function download(bytes: string, name: string) {
  const b = Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([b]));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function ImportApp() {
  const [responsibilities, setResponsibilities] = useState<
    Array<{ id: string; code: string }>
  >([]);
  const [contractPage, setContractPage] = useState(1),
    [contractTotal, setContractTotal] = useState(0);
  const [responsibilityPage, setResponsibilityPage] = useState(1),
    [responsibilityTotal, setResponsibilityTotal] = useState(0);
  const [mode, setMode] = useState("LOADING");
  const [actor, setActor] = useState("maker"),
    [contracts, setContracts] = useState<Contract[]>([]),
    [selected, setSelected] = useState("");
  const [jobId, setJobId] = useState(
      () => new URLSearchParams(location.search).get("job") ?? "",
    ),
    [summary, setSummary] = useState<Summary | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [format, setFormat] = useState<"CSV" | "JSON" | "XLSX">("CSV"),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null),
    [offset, setOffset] = useState(0);
  const [resultContext, setResultContext] =
    useState<ImportStatusContext>("generic");
  const [candidateId, setCandidateId] = useState(
      () => new URLSearchParams(location.search).get("candidate") ?? "",
    ),
    [requestId, setRequestId] = useState(
      () => new URLSearchParams(location.search).get("request") ?? "",
    ),
    [review, setReview] = useState<
      | operations["readImportCandidate"]["responses"][200]["content"]["application/json"]
      | null
    >(null);
  const [candidateAccess, setCandidateAccess] = useState<{
    canReview: boolean;
    canExecute: boolean;
  } | null>(null);
  const [issueFilter, setIssueFilter] = useState("");
  const [issueId, setIssueId] = useState(""),
    [sourceRun, setSourceRun] = useState(""),
    [head, setHead] = useState("0"),
    [responsibilityId, setResponsibilityId] = useState("");
  const pendingUpload = useRef<{
    file: File;
    version: string;
    format: string;
    requestId: string;
    fileRequestId: string;
  } | null>(null);
  const pendingActions = useRef(
    new Map<
      string,
      { requestId: string; outputRequestId: string; issueRequestId: string }
      >(),
  );
  const pendingActionScope = useRef("");
  const epoch = useRef(0);
  const client = () => createVNextCatalogClient(location.origin, actor);
  const contract = contracts.find((c) => c.versionId === selected);
  const [uploadCanReceive, setUploadCanReceive] = useState(false);
  const [fileAccess, setFileAccess] = useState<{
    canReceive: boolean;
    canReadProtected: boolean;
  } | null>(null);
  const [rawByteLimit, setRawByteLimit] = useState(MAX_RAW_FILE_BYTES);
  const write = summary?.canWrite ?? false;
  useEffect(() => {
    let active = true;
    setUploadCanReceive(false);
    if (selected)
      void client()
        .POST("/api/vnext/workbench/file-access", {
          body: { ...dimensions, contractVersionId: selected },
        })
        .then((r) => {
          if (active) setUploadCanReceive(r.data?.canReceive ?? false);
        });
    return () => {
      active = false;
    };
  }, [actor, selected]);
  useEffect(() => {
    let active = true;
    setFileAccess(null);
    if (summary?.contractVersionId)
      void client()
        .POST("/api/vnext/workbench/file-access", {
          body: { ...dimensions, contractVersionId: summary.contractVersionId },
        })
        .then((r) => {
          if (active) setFileAccess(r.data ?? null);
        });
    return () => {
      active = false;
    };
  }, [actor, summary?.contractVersionId, summary?.revisionId]);
  useEffect(() => {
    let active = true;
    setCandidateAccess(null);
    if (/^[a-f0-9-]{36}$/.test(candidateId))
      void client()
        .POST("/api/vnext/workbench/candidate-access", {
          body: { candidateId },
        })
        .then((r) => {
          if (active) setCandidateAccess(r.data ?? null);
        });
    return () => {
      active = false;
    };
  }, [actor, candidateId]);
  function url(job = jobId, candidate = candidateId, request = requestId) {
    const p = new URLSearchParams();
    if (job) p.set("job", job);
    if (candidate) p.set("candidate", candidate);
    if (request) p.set("request", request);
    history.replaceState(null, "", location.pathname + "?" + p);
  }
  async function refresh(id = jobId) {
    if (!id) return;
    const token = epoch.current;
    const r = await client().GET("/api/vnext/workbench/jobs/{id}", {
      params: { path: { id } },
    });
    if (token !== epoch.current) return;
    if (r.error) {
      setSummary(null);
      setMessage(`${r.error.code}：${r.error.message}`);
    } else {
      setSummary(r.data);
      const access = await client().POST("/api/vnext/workbench/file-access", {
        body: { ...dimensions, contractVersionId: r.data.contractVersionId },
      });
      if (token !== epoch.current) return;
      setFileAccess(access.data ?? null);
      const c = r.data.candidates
        .filter((candidate) => candidate.revisionId === r.data.revisionId)
        .at(-1);
      if (c) {
        setCandidateId(c.candidateId);
        setRequestId(c.requestId);
        url(id, c.candidateId, c.requestId);
      }
    }
  }
  useEffect(() => {
    const token = ++epoch.current;
    setSummary(null);
    setResult(null);
    setReview(null);
    setMessage("");
    let active = true;
    void (async () => {
      const caps = await client().GET("/api/vnext/workbench/capabilities");
      if (active && token === epoch.current) {
        setMode(caps.data?.mode ?? "UNAVAILABLE");
        setRawByteLimit(caps.data?.rawByteLimit ?? MAX_RAW_FILE_BYTES);
      }
      if (actor !== "reviewer") await refresh();
    })();
    return () => {
      active = false;
    };
  }, [actor]);
  useEffect(() => {
    let active = true;
    setContracts([]);
    void client()
      .GET("/api/vnext/contracts/current", {
        params: { query: { scope: "SYNTHETIC", page: contractPage } },
      })
      .then((r) => {
        if (!active) return;
        setContracts(
          r.data?.items.filter((c) => c.status === "PUBLISHED") ?? [],
        );
        setContractTotal(r.data?.total ?? 0);
      });
    return () => {
      active = false;
    };
  }, [actor, contractPage]);
  useEffect(() => {
    let active = true;
    setResponsibilities([]);
    void client()
      .GET("/api/vnext/catalog", {
        params: {
          query: {
            scope: "SYNTHETIC",
            kind: "RESPONSIBILITY",
            status: "PUBLISHED",
            page: responsibilityPage,
          },
        },
      })
      .then((r) => {
        if (!active) return;
        setResponsibilities(r.data?.items ?? []);
        setResponsibilityTotal(r.data?.total ?? 0);
      });
    return () => {
      active = false;
    };
  }, [actor, responsibilityPage]);
  async function run(
    work: () => Promise<{
      data?: Result;
      error?: { code: string; message: string };
    }>,
    context: ImportStatusContext = "generic",
  ) {
    const token = epoch.current;
    setBusy(true);
    setMessage("");
    try {
      const r = await work();
      if (token !== epoch.current) return;
      if (r.error) {
        setReview(null);
        if (r.error.code === "ACCESS_DENIED") {
          setFileAccess(null);
          setCandidateAccess(null);
          setUploadCanReceive(false);
        }
        setMessage(`${r.error.code}：${r.error.message}`);
        return;
      }
      if (r.data) {
        setResult(r.data);
        setResultContext(context);
        setMessage(
          r.data.responseStatus === "POST_COMMIT_FAILED"
            ? statusLine("POST_COMMIT_FAILED", "apply")
            : r.data.status === "COMMIT_UNKNOWN"
              ? statusLine("COMMIT_UNKNOWN", "apply") + "；请按原候选和请求恢复结果"
              : statusLine(r.data.status, context),
        );
        if (r.data.download)
          download(r.data.download, r.data.filename ?? "receipt.json");
        if (r.data.jobId) {
          setJobId(r.data.jobId);
          setCandidateId("");
          setRequestId("");
          setReview(null);
          url(r.data.jobId, "", "");
          await refresh(r.data.jobId);
        } else if (jobId && actor !== "reviewer") await refresh();
      }
    } catch (error) {
      if (token === epoch.current)
        setMessage(
          error instanceof Error && error.message === "FILE_SIZE_OR_ENCODING"
            ? "文件必须为 1 至 " + rawByteLimit + " 字节"
            : "网络结果待确认。执行请求请按原 candidateId/requestId 恢复，不要生成新请求。",
        );
    } finally {
      if (token === epoch.current) setBusy(false);
    }
  }
  const action = (action: Action) => {
    if (!summary) return;
    const scope = `${actor}:${jobId}:${summary.revisionId}`;
    if (pendingActionScope.current !== scope) {
      pendingActions.current.clear();
      pendingActionScope.current = scope;
    }
    const key = [
      actor,
      jobId,
      summary.revisionId,
      action,
      action === "ISSUES" ? offset : "",
    ].join(":");
    const operation =
      pendingActions.current.get(key) ??
      {
        requestId: uuid(),
        outputRequestId: uuid(),
        issueRequestId: uuid(),
      };
    pendingActions.current.set(key, operation);
    const context = actionStatusContext(action);
    void run(
      async () => {
        const response = await client().POST("/api/vnext/workbench/action", {
          body: {
            ...dimensions,
            jobId,
            revisionId: summary.revisionId,
            action,
            offset,
            ...operation,
          },
        });
        // Keep the operation identity for this job/revision so a refresh failure
        // after a committed response can still be retried without duplication.
        return response;
      },
      context,
    );
  };
  async function upload() {
    if (!file || !contract) return;
    if (
      pendingUpload.current?.file !== file ||
      pendingUpload.current.version !== contract.versionId ||
      pendingUpload.current.format !== format
    )
      pendingUpload.current = {
        file,
        version: contract.versionId,
        format,
        requestId: uuid(),
        fileRequestId: uuid(),
      };
    const pending = pendingUpload.current;
    await run(async () => {
      const response = await client().POST("/api/vnext/workbench/upload", {
        body: {
          bytes: await encodeWorkbenchFile(file, rawByteLimit),
          templateVersion: contract.definition.templateVersion,
          contractVersionId: contract.versionId,
          input: {
            campus: "NORTH",
            purpose: "IDENTITY_VERIFY",
            retentionSeconds: 3600,
            fileRequestId: pending.fileRequestId,
            extension:
              format === "CSV" ? ".csv" : format === "JSON" ? ".json" : ".xlsx",
            job: {
              action: "CREATE",
              scope: "SYNTHETIC",
              requestId: pending.requestId,
              reason: "WORKBENCH_UPLOAD",
              contractId: contract.id,
              contractVersionId: contract.versionId,
              profile: contract.profile,
              input: { kind: "FILE", format, parserPolicy: "STRICT_V2" },
            },
          },
        },
      });
      if (response.data) {
        setFile(null);
        pendingUpload.current = null;
      }
      return response;
    });
  }
  async function plan() {
    if (!summary) return;
    const id = uuid();
    await run(async () => {
      const r = await client().POST("/api/vnext/workbench/plan", {
        body: {
          ...dimensions,
          jobId,
          revisionId: summary.revisionId,
          requestId: id,
        },
      });
      if (r.data) {
        setCandidateId(r.data.candidateId);
        setRequestId(id);
        url(jobId, r.data.candidateId, id);
      }
      return r;
    });
  }
  async function readReview() {
    setReview(null);
    await run(async () => {
      const r = await client().POST("/api/vnext/workbench/review", {
        body: { candidateId },
      });
      if (r.data) setReview(r.data);
      return r;
    });
  }
  return (
    <div className="workbench import-workbench">
      <aside>
        <h1>导入工作台</h1>
        <p>本机合成运行</p>
        <nav>
          <a className="nav" href="/admin/vnext/catalog">
            目录
          </a>
          <br />
          <a className="nav" href="/admin/vnext/contracts">
            契约维护
          </a>
        </nav>
        <label>
          合成身份
          <select
            value={actor}
            disabled={busy}
            onChange={(e) => {
              ++epoch.current;
              setSummary(null);
              setUploadCanReceive(false);
              setFileAccess(null);
              setContractPage(1);
              setResponsibilityPage(1);
              setSelected("");
              setCandidateAccess(null);
              setActor(e.target.value);
              setReview(null);
              setResult(null);
            }}
          >
            <option value="maker">maker · 提交人</option>
            <option value="maker-alias">maker-alias · 同一底层身份</option>
            <option value="reviewer">reviewer · 独立复核人</option>
            <option value="outsider">outsider · 无权限</option>
          </select>
        </label>
        <p>不是医院真实身份认证。ORG/PER Owner 尚未就绪。</p>
      </aside>
      <main>
        <p>
          当前服务模式：{mode} · FINITE_E2E 仅为 receipt-owned
          临时测试目标，不是 ORG/PER 业务接入。
        </p>
        <h2>选择精确契约 → 文件 → 问题 → 预览 → 复核与回执</h2>
        <p>
          院区 NORTH · 用途 IDENTITY_VERIFY · 原始文件限 {rawByteLimit} 字节。XLSX
          仅文本子集，未验证 Excel/WPS 编辑重传兼容。
        </p>
        <p role="status">{message}</p>
        <section>
          <h3>1. 契约与模板</h3>
          <label>
            精确契约
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">选择已发布合成契约</option>
              {contracts.map((c) => (
                <option key={c.versionId} value={c.versionId}>
                  {c.dataset} / {c.profile} / v{c.version} /{" "}
                  {c.definition.templateVersion}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              disabled={busy || contractPage <= 1}
              onClick={() => {
                setSelected("");
                setContractPage((p) => p - 1);
              }}
            >
              上一页契约
            </button>
            <span>
              {" "}
              契约页 {contractPage} /{" "}
              {Math.max(1, Math.ceil(contractTotal / 10))}{" "}
            </span>
            <button
              disabled={busy || contractPage * 10 >= contractTotal}
              onClick={() => {
                setSelected("");
                setContractPage((p) => p + 1);
              }}
            >
              下一页契约
            </button>
          </div>
          <label>
            文件格式
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option>CSV</option>
              <option>JSON</option>
              <option>XLSX</option>
            </select>
          </label>
          {contract && (
            <p>
              契约 {contract.versionId} · 规则 {contract.definition.ruleVersion}{" "}
              · parserPolicy STRICT_V2 · Owner NOT_READY
            </p>
          )}
          <button
            disabled={!contract || busy}
            onClick={() =>
              run(() =>
                client().POST("/api/vnext/workbench/template", {
                  body: {
                    contractId: contract!.id,
                    versionId: contract!.versionId,
                    format,
                  },
                }),
              )
            }
          >
            下载精确模板
          </button>
          {uploadCanReceive && (
            <>
              <label>
                本地合成文件
                <input
                  aria-label="本地合成文件"
                  type="file"
                  accept=".csv,.json,.xlsx"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <button
                disabled={!file || !contract || busy}
                onClick={() => void upload()}
              >
                接收文件并创建作业
              </button>
            </>
          )}
        </section>
        <section>
          <h3>2. 服务端作业状态</h3>
          <label>
            作业引用
            <input
              aria-label="作业引用"
              value={jobId}
              onChange={(e) => {
                setJobId(e.target.value);
                setSummary(null);
                setReview(null);
                setCandidateId("");
                setRequestId("");
                setCandidateAccess(null);
              }}
            />
          </label>
          <button
            disabled={!jobId || busy}
            onClick={() => {
              url();
              void refresh();
            }}
          >
            恢复同一作业
          </button>
          {summary && (
            <>
              <p>
                job {summary.jobId} · revision {summary.revisionId}
              </p>
              <p>
                作业 {statusLine(summary.status, "job")} · 文件 {statusLine("QUARANTINED")} · 安全扫描 NOT_RUN ·
                ORG/PER NOT_READY · 发布 NOT_READY
              </p>
              <p>
                结构解析：
                {statusLine(
                  summary.artifacts
                  .filter(
                    (a) =>
                      a.revisionId === summary.revisionId &&
                      a.kind === "RAW_CELL",
                  )
                  .at(-1)?.structuralStatus ?? "NOT_INSPECTED",
                  "parse",
                )}{" "}
                · 批准：
                {statusLine(
                  summary.candidates
                  .filter((c) => c.revisionId === summary.revisionId)
                  .at(-1)?.approved
                  ? "APPROVED"
                  : "NOT_APPROVED",
                  "apply",
                )}{" "}
                · 执行：
                {statusLine(
                  summary.candidates
                  .filter((c) => c.revisionId === summary.revisionId)
                  .at(-1)?.committed
                  ? "COMMITTED"
                  : "NOT_COMMITTED",
                  "apply",
                )}
              </p>
              <p>
                最近校验：{statusLine(summary.runs.at(-1)?.decision ?? "NOT_RUN", "validation")}；批准与
                COMMITTED 以独立回执为准。
              </p>
              {fileAccess?.canReceive && (
                <>
                  <button disabled={busy} onClick={() => action("PARSE")}>
                    解析文件
                  </button>
                  <button disabled={busy} onClick={() => action("VALIDATE")}>
                    校验并登记问题
                  </button>
                </>
              )}
              {fileAccess?.canReadProtected && (
                <>
                  <button disabled={busy} onClick={() => action("ISSUES")}>
                    读取问题页
                  </button>
                  <label>
                    问题偏移
                    <input
                      type="number"
                      min="0"
                      step="20"
                      value={offset}
                      onChange={(e) => setOffset(Number(e.target.value))}
                    />
                  </label>
                  <button disabled={busy} onClick={() => action("EXPLAIN")}>
                    受限校验解释
                  </button>
                  {fileAccess?.canReceive && (
                    <button
                      disabled={busy}
                      onClick={() => action("ERROR_WORKBOOK")}
                    >
                      下载受限错误工作簿
                    </button>
                  )}
                  <button disabled={busy} onClick={() => action("PREVIEW")}>
                    Dry-run 与影响说明（全部文件行 CREATE 意图）
                  </button>
                </>
              )}
              {fileAccess?.canReceive && (
                <details>
                  <summary>完整文件纠正 / 责任分派 / 证据解决</summary>
                  <p>
                    从问题页选择技术引用；不能凭手工 PASS
                    关闭问题。新文件必须完整包含原契约列。
                  </p>
                  <label>
                    问题 ID
                    <input
                      value={issueId}
                      onChange={(e) => setIssueId(e.target.value)}
                    />
                  </label>
                  <label>
                    来源 run ID
                    <input
                      value={sourceRun}
                      onChange={(e) => setSourceRun(e.target.value)}
                    />
                  </label>
                  <label>
                    处置 head
                    <input
                      value={head}
                      onChange={(e) => setHead(e.target.value)}
                    />
                  </label>
                  <label>
                    已发布责任定义
                    <select
                      value={responsibilityId}
                      onChange={(e) => setResponsibilityId(e.target.value)}
                    >
                      <option value="">选择已授权的责任引用</option>
                      {responsibilities.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} · {r.id}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <button
                      disabled={busy || responsibilityPage <= 1}
                      onClick={() => {
                        setResponsibilityId("");
                        setResponsibilityPage((p) => p - 1);
                      }}
                    >
                      上一页责任
                    </button>
                    <span>
                      {" "}
                      责任页 {responsibilityPage} /{" "}
                      {Math.max(1, Math.ceil(responsibilityTotal / 10))}{" "}
                    </span>
                    <button
                      disabled={
                        busy || responsibilityPage * 10 >= responsibilityTotal
                      }
                      onClick={() => {
                        setResponsibilityId("");
                        setResponsibilityPage((p) => p + 1);
                      }}
                    >
                      下一页责任
                    </button>
                  </div>
                  <button
                    disabled={busy || !issueId}
                    onClick={() =>
                      run(async () => {
                        const r = await client().POST(
                          "/api/vnext/workbench/issue",
                          { body: { ...dimensions, issueId } },
                        );
                        if (r.data?.head) setHead(r.data.head);
                        return r;
                      })
                    }
                  >
                    读取当前处置与 head
                  </button>
                  <button
                    disabled={busy || !sourceRun || !summary.runs.length}
                    onClick={() =>
                      run(() =>
                        client().POST("/api/vnext/workbench/compare", {
                          body: {
                            ...dimensions,
                            leftRunId: sourceRun,
                            rightRunId: summary.runs.at(-1)!.runId,
                          },
                        }),
                      )
                    }
                  >
                    对比修订校验
                  </button>
                  <button
                    disabled={busy || !issueId || !responsibilityId}
                    onClick={() =>
                      run(() =>
                        client().POST("/api/vnext/workbench/assign", {
                          body: {
                            ...dimensions,
                            issueId,
                            expectedHead: head,
                            responsibilityId,
                            requestId: uuid(),
                            reason: "WORKBENCH_ASSIGN",
                          },
                        }),
                      )
                    }
                  >
                    分派责任
                  </button>
                  <button
                    disabled={busy || !issueId || !sourceRun || !file}
                    onClick={() =>
                      run(async () =>
                        client().POST("/api/vnext/workbench/correction", {
                          body: {
                            bytes: await encodeWorkbenchFile(file!, rawByteLimit),
                            templateVersion: summary.templateVersion,
                            contractVersionId: summary.contractVersionId,
                            input: {
                              ...dimensions,
                              issueId,
                              jobId,
                              sourceRunId: sourceRun,
                              expectedCurrentRevision: summary.revisionId,
                              requestId: uuid(),
                              receiveRequestId: uuid(),
                              reason: "WORKBENCH_CORRECTION",
                              format,
                              parserPolicy: "STRICT_V2",
                              retentionSeconds: 3600,
                            },
                          },
                        }),
                      )
                    }
                  >
                    上传完整纠正文件
                  </button>
                  <button
                    disabled={busy || !issueId || !summary.runs.length}
                    onClick={() =>
                      run(() =>
                        client().POST("/api/vnext/workbench/resolve", {
                          body: {
                            ...dimensions,
                            issueId,
                            expectedHead: head,
                            newRunId: summary.runs.at(-1)!.runId,
                            newRevisionId: summary.revisionId,
                            requestId: uuid(),
                            reason: "WORKBENCH_RESOLVE",
                          },
                        }),
                      )
                    }
                  >
                    以当前校验证据解决
                  </button>
                </details>
              )}
              {write && fileAccess?.canReadProtected && (
                <button disabled={busy} onClick={() => void plan()}>
                  请求冻结可执行候选
                </button>
              )}
            </>
          )}
        </section>
        <section>
          <h3>3. 显式复核、批准与结果恢复</h3>
          <p>
            普通 ORG/PER 路径将保持 BLOCKED。有限 E2E
            成功路径只属于隔离测试目标。
          </p>
          <label>
            候选 ID
            <input
              value={candidateId}
              onChange={(e) => {
                setCandidateAccess(null);
                setCandidateId(e.target.value);
                setReview(null);
              }}
            />
          </label>
          <label>
            原 request ID
            <input
              value={requestId}
              onChange={(e) => setRequestId(e.target.value)}
            />
          </label>
          {actor !== "outsider" && (
            <>
              {candidateAccess?.canReview && (
                <button
                  disabled={busy || !candidateId}
                  onClick={() => {
                    url();
                    void readReview();
                  }}
                >
                  以当前身份读取冻结候选
                </button>
              )}
              {review?.status === "READ_READY" && (
                <>
                  <h4>冻结成员、差异、来源与摘要</h4>
                  <pre>{review.text}</pre>
                  <p>digest {review.digest}</p>
                  <p>
                    READ_READY
                    只证明服务端读取和验签成功；请自行审阅后显式批准。
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() =>
                        client().POST("/api/vnext/workbench/approve", {
                          body: { candidateId, digest: review.digest },
                        }),
                      )
                    }
                  >
                    确认审阅并批准
                  </button>
                </>
              )}
              {candidateAccess?.canExecute && (
                <button
                  disabled={busy || !candidateId || !requestId}
                  onClick={() =>
                    run(() =>
                      client().POST("/api/vnext/workbench/apply", {
                        body: { candidateId, requestId },
                      }),
                    )
                  }
                >
                  执行原候选
                </button>
              )}
              <button
                disabled={busy || !candidateId || !requestId}
                onClick={() =>
                  run(() =>
                    client().POST("/api/vnext/workbench/resume", {
                      body: { candidateId, requestId },
                    }),
                  )
                }
              >
                恢复原请求结果
              </button>
              <button
                disabled={busy || !candidateId || !requestId}
                onClick={() =>
                  run(() =>
                    client().POST("/api/vnext/workbench/reconcile", {
                      body: { candidateId, requestId },
                    }),
                  )
                }
              >
                读取对账回执
              </button>
            </>
          )}
        </section>
        {result && (
          <section aria-label="命令结果">
            <h3>{statusLine(result.status, resultContext)}</h3>
            {result.issues && (
              <>
                <label>
                  本页问题筛选
                  <input
                    value={issueFilter}
                    onChange={(e) => setIssueFilter(e.target.value)}
                  />
                </label>
                <p>
                  总计 {result.total} · 偏移 {offset} · 每页 20
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>行</th>
                      <th>字段</th>
                      <th>代码</th>
                      <th>状态</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues
                      .filter(
                        (i) =>
                          !issueFilter ||
                          [i.code, i.field, i.status].some((v) =>
                            v?.includes(issueFilter),
                          ),
                      )
                      .map((i) => (
                        <tr key={i.id}>
                          <td>{i.row}</td>
                          <td>{i.field ?? "整批"}</td>
                          <td>{i.code}</td>
                          <td>{i.status}</td>
                          <td>
                            <button
                              onClick={() => {
                                setIssueId(i.id);
                                setSourceRun(i.runId);
                              }}
                            >
                              选为纠正问题
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}
            {result.status !== "READ_READY" && <pre>{result.text}</pre>}
            {["COMMITTED", "MATCHED", "MISMATCH"].includes(result.status) && (
              <button
                onClick={() =>
                  download(btoa(result.text ?? "{}"), "technical-receipt.json")
                }
              >
                下载技术回执
              </button>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
