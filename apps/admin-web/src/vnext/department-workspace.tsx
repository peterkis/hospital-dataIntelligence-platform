import { useEffect, useRef, useState } from "react";
import {
  createDepartmentClient,
  createDepartmentWorkspaceClient,
  createVNextCatalogClient,
  type DepartmentWorkspaceDraft,
  type VNextOperations as Operations,
  type VNextEntry,
} from "@hospital-data-intelligence/generated-api-client";
import { Field, Group, displayTime } from "./workspace-fields.js";
import { encodeWorkbenchFile } from "./workbench-file.js";
import "./organization-workspace.css";
import "./department-workspace.css";
import {
  DepartmentDomainWorkspace,
  type DepartmentPanelKind,
} from "./department-domain-workspace.js";
import {
  departmentValue as value,
  definiteFailure,
  pendingDepartmentSubmission,
} from "./department-request.js";
import { DepartmentQueries } from "./department-queries.js";

type Draft = Extract<DepartmentWorkspaceDraft, { kind: "DEPARTMENT" }>;
type Saved =
  Operations["saveDepartmentDraft"]["responses"][200]["content"]["application/json"];
type ReadSaved =
  Operations["readDepartmentDraft"]["responses"][200]["content"]["application/json"];
type Summary =
  Operations["listDepartmentDrafts"]["responses"][200]["content"]["application/json"]["items"][number];
type Application =
  Operations["listDepartmentApplications"]["responses"][200]["content"]["application/json"]["items"][number];
type Contract =
  Operations["listImportContracts"]["responses"][200]["content"]["application/json"]["items"][number];
type DepartmentHistory =
  Operations["getDepartmentVersionHistory"]["responses"][200]["content"]["application/json"];
const labels: Record<string, string> = {
  org_id: "来源行键",
  org_code: "院内科室编码",
  org_name: "科室名称",
  org_short_name: "简称",
  org_type: "科室类型",
  established_on: "成立日期",
  abolished_on: "来源撤销日期",
  establishment_doc: "成立依据",
  description: "职责说明",
  version_no: "来源版本",
  valid_from: "业务起始时间",
  valid_to: "业务结束时间",
  source_record_id: "来源记录定位",
  approval_ref: "来源批准依据",
  recorded_at: "来源记录时间",
};
const blank = (): Draft => ({
  kind: "DEPARTMENT",
  campus: "NORTH",
  profile: "CORE",
  requestId: crypto.randomUUID(),
  payload: {
    timePolicy: "LOCAL",
    entries: [
      {
        intent: "CREATE",
        target: null,
        origin: "NEW",
        row: {
          org_short_name: "",
          established_on: "",
          abolished_on: "",
          establishment_doc: "",
          description: "",
          is_virtual: "N",
          version_no: "1",
          valid_to: "",
          record_status: "ACTIVE",
          approval_ref: "",
        },
      },
    ],
  },
});
export function DepartmentWorkspaceApp() {
  const panels = {
    DEPARTMENT: "科室维护",
    HIERARCHY: "层级视图",
    MAPPING: "来源映射",
    IDENTIFIER: "编码与别名",
    EVOLUTION: "组织演化",
    LIFECYCLE: "生命周期与院区",
    IMPACT: "影响处置",
  } as const;
  const [recoverId, setRecoverId] = useState<string | null>(null),
    [canSave, setCanSave] = useState(false),
    [filter, setFilter] = useState("");
  const [panel, setPanel] = useState<keyof typeof panels>(() => {
      const name = new URL(location.href).searchParams.get("panel");
      return name && name in panels
        ? (name as keyof typeof panels)
        : "DEPARTMENT";
    }),
    [domainLock, setDomainLock] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [actor, setActor] = useState(
      new URL(location.href).searchParams.get("actor") ?? "maker",
    ),
    [draft, setDraft] = useState<Draft>(blank),
    [saved, setSaved] = useState<Saved | null>(null),
    [drafts, setDrafts] = useState<Summary[]>([]),
    [applications, setApplications] = useState<Application[]>([]),
    [contracts, setContracts] = useState<Contract[]>([]),
    [sources, setSources] = useState<VNextEntry[]>([]),
    [histories, setHistories] = useState<DepartmentHistory[]>([]),
    [draftCursor, setDraftCursor] = useState<string | null>(null),
    [appCursor, setAppCursor] = useState<string | null>(null),
    [departmentCursor, setDepartmentCursor] = useState<string | null>(null),
    [application, setApplication] = useState<Application | null>(null),
    [input, setInput] = useState<
      | Operations["readDepartmentInput"]["responses"][200]["content"]["application/json"]
      | null
    >(null),
    [preview, setPreview] = useState<
      | Operations["previewDepartment"]["responses"][200]["content"]["application/json"]
      | null
    >(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [reason, setReason] = useState(""),
    [historicalException, setHistoricalException] = useState(false);
  const [review, setReview] = useState<
      | Operations["reviewDepartment"]["responses"][200]["content"]["application/json"]
      | null
    >(null),
    [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    document.title = "科室主数据工作台";
  }, []);
  const epoch = useRef(0),
    pendingSave = useRef<Draft | null>(null),
    pendingSubmit = useRef<{
      id: string;
      expectedVersion: string;
      requestId: string;
    } | null>(null);
  const recoveryKey = `hdip:p2-07:save:${actor}:DEPARTMENT`;
  const submitRecoveryKey = `hdip:p2-07:submit:${actor}:DEPARTMENT`;
  const workspace = () =>
      createDepartmentWorkspaceClient(location.origin, actor),
    department = () => createDepartmentClient(location.origin, actor);
  const remember = (draftId?: string, inputId?: string) => {
    const url = new URL(location.href);
    url.searchParams.set("actor", actor);
    url.searchParams.delete("draft");
    url.searchParams.delete("input");
    if (draftId) url.searchParams.set("draft", draftId);
    if (inputId) url.searchParams.set("input", inputId);
    history.replaceState(null, "", url.pathname + url.search);
  };
  const run = async (work: () => Promise<void>) => {
    const generation = epoch.current;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      if (generation === epoch.current)
        setMessage(error instanceof Error ? error.message : "请求未完成");
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  };
  const reload = async (generation = epoch.current) => {
    const client = createDepartmentWorkspaceClient(location.origin, actor),
      [own, queue, ids] = await Promise.all([
        value(client.list({ limit: 100 })),
        value(client.applications({ limit: 100 })),
        value(department().list({ limit: 100 })),
      ]);
    const rows = await Promise.all(
      ids.map((id) => value(department().history({ id }))),
    );
    if (generation === epoch.current) {
      setDrafts(own.items);
      setApplications(queue.items);
      setHistories(rows);
      setDraftCursor(own.nextCursor);
      setAppCursor(queue.nextCursor);
      setDepartmentCursor(ids.length === 100 ? ids.at(-1)! : null);
    }
  };
  const restore = async (id: string, recovered?: ReadSaved) => {
    const generation = ++epoch.current;
    await run(async () => {
      const pending = pendingDepartmentSubmission(submitRecoveryKey);
      if (pending?.id === id) pendingSubmit.current = pending;
      const record = recovered ?? (await value(workspace().read(id)));
      if (generation !== epoch.current) return;
      if (record.content.kind !== "DEPARTMENT")
        throw new Error("请选择对应维护页恢复此草稿。");
      setDraft(record.content);
      setSaved(record);
      setApplication(null);
      setInput(null);
      setPreview(null);
      setReview(null);
      setAcknowledged(false);
      setDirty(false);
      pendingSave.current = null;
      if (
        pending?.id === id &&
        pending.expectedVersion === record.version &&
        record.state === "EDITING"
      ) {
        pendingSubmit.current = pending;
        setMessage("原提交结果尚未确认，请恢复原提交请求。");
      } else {
        pendingSubmit.current = null;
        if (pending?.id === id) sessionStorage.removeItem(submitRecoveryKey);
      }
      remember(id);
      if (recovered) {
        sessionStorage.removeItem(recoveryKey);
        setRecoverId(null);
      }
    });
  };
  const selectApplication = async (item: Application) => {
    const generation = ++epoch.current;
    await run(async () => {
      if (item.kind !== "DEPARTMENT")
        throw new Error("请选择对应维护页核对申请。");
      const [content, comparison] = await Promise.all([
        value(department().readInput({ inputId: item.inputId })),
        value(department().preview({ inputId: item.inputId })),
      ]);
      if (generation !== epoch.current) return;
      setApplication(item);
      setInput(content);
      setPreview(comparison);
      setReview(null);
      setAcknowledged(false);
      setSaved(null);
      setDirty(false);
      pendingSave.current = null;
      pendingSubmit.current = null;
      remember(undefined, item.inputId);
    });
  };
  useEffect(() => {
    const generation = ++epoch.current;
    setDraft(blank());
    setSaved(null);
    setApplication(null);
    setInput(null);
    setPreview(null);
    setReview(null);
    setAcknowledged(false);
    setDrafts([]);
    setApplications([]);
    setContracts([]);
    setSources([]);
    setHistories([]);
    pendingSave.current = null;
    pendingSubmit.current = null;
    setRecoverId(
      panel === "DEPARTMENT" ? sessionStorage.getItem(recoveryKey) : null,
    );
    setMessage("");
    if (panel !== "DEPARTMENT") {
      setBusy(false);
      return;
    }
    void run(async () => {
      await reload(generation);
      const catalog = createVNextCatalogClient(location.origin, actor),
        [policy, entries, ids] = await Promise.all([
          value(
            catalog.GET("/api/vnext/contracts/current", {
              params: { query: { scope: "SYNTHETIC" } },
            }),
          ),
          value(
            catalog.GET("/api/vnext/catalog", {
              params: { query: { scope: "SYNTHETIC" } },
            }),
          ),
          value(department().list({ limit: 100 })),
        ]);
      const rows = await Promise.all(
        ids.map((id) => value(department().history({ id }))),
      );
      if (generation !== epoch.current) return;
      setContracts(
        policy.items.filter(
          (item) =>
            item.dataset === "ORG04" &&
            item.profile === "CORE" &&
            item.status === "PUBLISHED",
        ),
      );
      setSources(
        entries.items.filter(
          (item) => item.kind === "SOURCE" && item.status === "PUBLISHED",
        ),
      );
      setHistories(rows);
      const unresolved = sessionStorage.getItem(recoveryKey);
      if (unresolved) {
        setRecoverId(unresolved);
        const recovered = await value(workspace().recover(unresolved));
        if (generation !== epoch.current) return;
        if (recovered && recovered.content.kind === "DEPARTMENT") {
          await restore(recovered.id, recovered);
          return;
        }
        setRecoverId(unresolved);
        setMessage("原保存结果尚未确认，请恢复保存结果。");
        return;
      }
      const url = new URL(location.href),
        id =
          pendingDepartmentSubmission(submitRecoveryKey)?.id ??
          url.searchParams.get("draft"),
        inputId = url.searchParams.get("input");
      if (id && panel === "DEPARTMENT") await restore(id);
      else if (inputId) {
        const queue = await value(
            workspace().applications({ inputId, limit: 1 }),
          ),
          item = queue.items.find((item) => item.inputId === inputId);
        if (item) await selectApplication(item);
      }
    });
  }, [actor, panel]);
  const edit = (change: (next: Draft) => void) => {
    if (
      saved?.state === "SUBMITTED" ||
      pendingSave.current ||
      pendingSubmit.current
    )
      return;
    setDraft((prior) => {
      const next = structuredClone(prior);
      change(next);
      next.requestId = crypto.randomUUID();
      return next;
    });
    setDirty(true);
  };
  useEffect(() => {
    let current = true;
    setCanSave(false);
    void value(
      createVNextCatalogClient(location.origin, actor).POST(
        "/api/vnext/department-workspace/permissions",
        { body: { kind: "DEPARTMENT", campus: draft.campus } },
      ),
    )
      .then((result) => {
        if (current) setCanSave(result.canSave);
      })
      .catch(() => {
        if (current) setCanSave(false);
      });
    return () => {
      current = false;
    };
  }, [actor, draft.campus]);
  const entry = draft.payload.entries?.[0],
    row = entry?.row ?? {},
    editable =
      canSave &&
      !recoverId &&
      !busy &&
      saved?.state !== "SUBMITTED" &&
      !pendingSave.current &&
      !pendingSubmit.current;
  const field = (key: string, next: string) =>
    edit((data) => {
      const row = data.payload.entries?.[0]?.row;
      if (!row) return;
      if (
        next === "" &&
        ![
          "org_short_name",
          "established_on",
          "abolished_on",
          "establishment_doc",
          "description",
          "valid_to",
          "approval_ref",
        ].includes(key)
      )
        Reflect.deleteProperty(row, key);
      else Reflect.set(row, key, next);
    });
  const save = () =>
    run(async () => {
      const generation = epoch.current;
      // A retained request may already have committed even if its response was lost.
      const retrying = pendingSave.current !== null;
      pendingSave.current ??= {
        ...structuredClone(draft),
        ...(saved ? { id: saved.id, expectedVersion: saved.version } : {}),
      };
      sessionStorage.setItem(recoveryKey, pendingSave.current.requestId);
      let accepted = retrying;
      try {
        const result = await value(workspace().save(pendingSave.current));
        accepted = true;
        if (generation !== epoch.current) return;
        const restored = await value(workspace().read(result.id));
        if (generation !== epoch.current) return;
        if (restored.content.kind !== "DEPARTMENT")
          throw new Error("草稿类型不匹配。");
        setDraft(restored.content);
        setSaved(restored);
        setDirty(false);
        remember(restored.id);
        pendingSave.current = null;
        sessionStorage.removeItem(recoveryKey);
        setMessage("草稿已保存，可刷新恢复。尚未形成科室事实。");
        await reload(generation);
      } catch (error) {
        if (
          generation === epoch.current &&
          !accepted &&
          definiteFailure(error)
        ) {
          pendingSave.current = null;
          sessionStorage.removeItem(recoveryKey);
        }
        throw error;
      }
    });
  const submit = () =>
    run(async () => {
      if (!saved || dirty) throw new Error("请先保存当前内容。");
      const generation = epoch.current;
      const retrying = pendingSubmit.current !== null;
      pendingSubmit.current ??= {
        id: saved.id,
        expectedVersion: saved.version,
        requestId: crypto.randomUUID(),
      };
      sessionStorage.setItem(
        submitRecoveryKey,
        JSON.stringify(pendingSubmit.current),
      );
      let result;
      let accepted = false;
      try {
        result = await value(workspace().submit(pendingSubmit.current));
        accepted = true;
      } catch (error) {
        if (
          generation === epoch.current &&
          !retrying &&
          definiteFailure(error)
        ) {
          pendingSubmit.current = null;
          sessionStorage.removeItem(submitRecoveryKey);
        }
        throw error;
      }
      if (generation !== epoch.current) return;
      try {
        await reload(generation);
        if (result.kind !== "DEPARTMENT") throw new Error("申请类型不匹配。");
        const queue = await value(
            workspace().applications({ inputId: result.inputId, limit: 1 }),
          ),
          item = queue.items.find((item) => item.inputId === result.inputId);
        if (!item) throw new Error("申请已提交，请从申请列表恢复。");
        await selectApplication(item);
        sessionStorage.removeItem(submitRecoveryKey);
        setMessage("已提交核验申请，等待独立核验与审批。");
      } catch (error) {
        if (accepted)
          setMessage("申请已提交，后续读取未完成，请恢复原提交请求。");
        throw error;
      }
    });
  const refreshApplication = async () => {
    if (!application) return;
    const queue = await value(
        workspace().applications({ inputId: application.inputId, limit: 1 }),
      ),
      item = queue.items.find((item) => item.inputId === application.inputId);
    await reload();
    if (item) await selectApplication(item);
  };
  const contextLocked =
    busy ||
    dirty ||
    !!recoverId ||
    !!pendingSave.current ||
    !!pendingSubmit.current;
  return (
    <div className="organization-workspace department-workspace">
      <header className="workspace-header">
        <div>
          <a href="/admin/vnext/catalog">治理目录</a>
          <h1>科室主数据工作台</h1>
          <p>合成数据开发环境 · 来源记录、核验申请和已发布事实分别维护</p>
        </div>
        <label>
          当前身份
          <select
            value={actor}
            disabled={
              busy ||
              dirty ||
              !!recoverId ||
              domainLock ||
              !!pendingSave.current ||
              !!pendingSubmit.current
            }
            onChange={(event) => {
              epoch.current++;
              const url = new URL(location.href);
              url.searchParams.set("actor", event.target.value);
              url.searchParams.delete("draft");
              url.searchParams.delete("input");
              history.replaceState(null, "", url.pathname + url.search);
              setActor(event.target.value);
            }}
          >
            <option value="maker">维护者</option>
            <option value="maker-alias">维护者同人别名</option>
            <option value="reviewer">独立审核者</option>
            <option value="outsider">无权限身份</option>
          </select>
        </label>
      </header>
      <nav className="workspace-tabs">
        {Object.entries(panels).map(([key, label]) => (
          <button
            key={key}
            aria-pressed={panel === key}
            disabled={
              busy ||
              dirty ||
              !!recoverId ||
              domainLock ||
              !!pendingSave.current ||
              !!pendingSubmit.current
            }
            onClick={() => {
              epoch.current++;
              setPanel(key as keyof typeof panels);
              setRefreshToken(0);
              const url = new URL(location.href);
              url.searchParams.set("panel", key);
              url.searchParams.delete("draft");
              url.searchParams.delete("input");
              history.replaceState(null, "", url.pathname + url.search);
            }}
          >
            {label}
          </button>
        ))}
        <a href="/admin/vnext/organizations">机构与院区</a>
        <a href="/admin/vnext/imports">导入任务</a>
        <button
          onClick={() =>
            panel === "DEPARTMENT"
              ? void run(async () => reload())
              : setRefreshToken((value) => value + 1)
          }
          disabled={
            busy ||
            dirty ||
            domainLock ||
            !!pendingSave.current ||
            !!pendingSubmit.current
          }
        >
          刷新列表
        </button>
      </nav>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {recoverId && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const recovered = await value(workspace().recover(recoverId));
              if (!recovered) {
                setMessage("服务端尚无此保存结果，保留原请求标识等待恢复。");
                return;
              }
              await restore(recovered.id, recovered);
            })
          }
        >
          恢复保存结果
        </button>
      )}
      {!saved && pendingSubmit.current && panel === "DEPARTMENT" && (
        <button
          disabled={busy}
          onClick={() => {
            const request = pendingSubmit.current;
            if (request) void restore(request.id);
          }}
        >
          恢复提交状态
        </button>
      )}
      {panel === "DEPARTMENT" ? (
        <div className="workspace-layout">
          <aside className="draft-list">
            <h2>私有草稿</h2>
            <button
              disabled={!canSave || contextLocked}
              onClick={() => {
                epoch.current++;
                setDraft(blank());
                setSaved(null);
                setApplication(null);
                setInput(null);
                setPreview(null);
                setReview(null);
                setAcknowledged(false);
                setDirty(false);
                remember();
              }}
            >
              新建科室草稿
            </button>
            {drafts
              .filter((item) => item.kind === "DEPARTMENT")
              .map((item) => (
                <button
                  className="draft-item"
                  disabled={contextLocked}
                  key={item.id}
                  onClick={() => void restore(item.id)}
                >
                  <strong>科室 · v{item.version}</strong>
                  <span>{item.state}</span>
                  <small>{displayTime(item.recordedAt)}</small>
                </button>
              ))}
            {draftCursor && (
              <button
                disabled={
                  busy ||
                  dirty ||
                  !!pendingSubmit.current ||
                  !!pendingSave.current
                }
                onClick={() =>
                  void run(async () => {
                    const generation = epoch.current;
                    const next = await value(
                      workspace().list({ after: draftCursor, limit: 100 }),
                    );
                    if (generation !== epoch.current) return;
                    setDrafts((prior) => [...prior, ...next.items]);
                    setDraftCursor(next.nextCursor);
                  })
                }
              >
                更多私有草稿
              </button>
            )}
            <h2>核验申请</h2>
            {applications
              .filter((item) => item.kind === "DEPARTMENT")
              .map((item) => (
                <button
                  className="draft-item"
                  disabled={contextLocked}
                  key={item.inputId}
                  onClick={() => void selectApplication(item)}
                >
                  <strong>{item.state}</strong>
                  <span>提交人：{item.maker}</span>
                  <small>{displayTime(item.recordedAt)}</small>
                </button>
              ))}
            {appCursor && (
              <button
                disabled={
                  busy ||
                  dirty ||
                  !!pendingSubmit.current ||
                  !!pendingSave.current
                }
                onClick={() =>
                  void run(async () => {
                    const generation = epoch.current;
                    const next = await value(
                      workspace().applications({
                        after: appCursor,
                        limit: 100,
                      }),
                    );
                    if (generation !== epoch.current) return;
                    setApplications((prior) => [...prior, ...next.items]);
                    setAppCursor(next.nextCursor);
                  })
                }
              >
                更多核验申请
              </button>
            )}
          </aside>
          <main className="editor-card">
            {dirty && (
              <button
                disabled={
                  busy || !!pendingSave.current || !!pendingSubmit.current
                }
                onClick={() => {
                  epoch.current++;
                  setDraft(blank());
                  setSaved(null);
                  setDirty(false);
                  setApplication(null);
                  setInput(null);
                  setPreview(null);
                  setReview(null);
                  setAcknowledged(false);
                  remember();
                }}
              >
                放弃未保存修改
              </button>
            )}
            {application && input ? (
              <>
                <h2>科室申请 · {application.state}</h2>
                <p>
                  输入与候选均保留原始证据；审批时服务端重新检查当前权限与引用。
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>行</th>
                      <th>科室</th>
                      <th>动作</th>
                      <th>业务期间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {input.entries.map((entry, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td>{entry.row.org_name}</td>
                        <td>{entry.intent}</td>
                        <td>
                          {displayTime(entry.row.valid_from)} →{" "}
                          {entry.row.valid_to
                            ? displayTime(entry.row.valid_to)
                            : "无界"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview?.issues.map((issue, index) => (
                  <p role="alert" key={index}>
                    第 {issue.row} 行 · {labels[issue.field] ?? issue.field} ·{" "}
                    {issue.code}
                  </p>
                ))}
                <section>
                  <h3>准确候选核对</h3>
                  {review ? (
                    <>
                      <p>
                        候选摘要：<code>{review.digest}</code>
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>动作</th>
                            <th>科室名称</th>
                            <th>编码</th>
                            <th>业务期间</th>
                            <th>原版本</th>
                          </tr>
                        </thead>
                        <tbody>
                          {review.entries.map((entry, index) => (
                            <tr key={index}>
                              <td>{entry.intent}</td>
                              <td>{entry.row.org_name}</td>
                              <td>{entry.row.org_code}</td>
                              <td>
                                {displayTime(entry.row.valid_from)} →{" "}
                                {entry.row.valid_to
                                  ? displayTime(entry.row.valid_to)
                                  : "无界"}
                              </td>
                              <td>
                                {entry.target?.expectedVersion ?? "新身份"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {review.issues.map((issue, index) => (
                        <p role="alert" key={index}>
                          第 {issue.row} 行 · {issue.field} · {issue.code}
                        </p>
                      ))}
                      <label className="confirmation">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          disabled={busy}
                          onChange={(event) =>
                            setAcknowledged(event.target.checked)
                          }
                        />
                        我已核对候选内容与独立核验结果
                      </label>
                    </>
                  ) : (
                    <p>批准前请读取准确候选并核对冻结内容。</p>
                  )}
                </section>
                <Group title="独立核验">
                  <Field
                    label="核验理由"
                    value={reason}
                    onChange={setReason}
                    disabled={busy}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={historicalException}
                      onChange={(event) =>
                        setHistoricalException(event.target.checked)
                      }
                      disabled={busy}
                    />
                    历史缺失成立依据例外（仅历史来源适用）
                  </label>
                </Group>
                <div className="action-bar">
                  <button
                    disabled={busy || !application.access.canVerify || !reason}
                    onClick={() =>
                      void run(async () => {
                        await value(
                          department().verify({
                            requestId: crypto.randomUUID(),
                            inputId: application.inputId,
                            inputDigest: application.inputDigest,
                            rows: input.entries.map((entry, index) => ({
                              row: index + 1,
                              disposition: "DEPARTMENT",
                              historicalException,
                              reason,
                              evidenceId: entry.evidenceId,
                            })),
                          }),
                        );
                        await refreshApplication();
                      })
                    }
                  >
                    核验为科室
                  </button>
                  <button
                    disabled={busy || !application.access.canPlan}
                    onClick={() =>
                      void run(async () => {
                        await value(
                          department().plan({
                            inputId: application.inputId,
                            requestId: crypto.randomUUID(),
                          }),
                        );
                        await refreshApplication();
                      })
                    }
                  >
                    生成变更候选
                  </button>
                  <button
                    disabled={
                      busy ||
                      !application.access.canReview ||
                      !application.candidateId
                    }
                    onClick={() =>
                      void run(async () => {
                        const generation = epoch.current,
                          result = await value(
                            department().review({
                              candidateId: application.candidateId!,
                            }),
                          );
                        if (generation !== epoch.current) return;
                        setReview(result);
                        setAcknowledged(false);
                        setMessage(
                          "已读取准确候选；请核对下方冻结内容后批准。",
                        );
                      })
                    }
                  >
                    读取准确候选
                  </button>
                  <button
                    disabled={
                      busy ||
                      !application.access.canReview ||
                      !application.candidateId ||
                      !application.candidateDigest ||
                      !review ||
                      review.candidateId !== application.candidateId ||
                      review.digest !== application.candidateDigest ||
                      !acknowledged
                    }
                    onClick={() =>
                      void run(async () => {
                        await value(
                          department().approve({
                            candidateId: application.candidateId!,
                            digest: application.candidateDigest!,
                          }),
                        );
                        await refreshApplication();
                      })
                    }
                  >
                    批准候选
                  </button>
                  <button
                    disabled={
                      busy ||
                      !application.access.canApply ||
                      application.state !== "APPROVED" ||
                      !application.candidateId ||
                      !application.requestId
                    }
                    onClick={() =>
                      void run(async () => {
                        const result = await value(
                          department().apply({
                            candidateId: application.candidateId!,
                            requestId: application.requestId!,
                          }),
                        );
                        await refreshApplication();
                        setMessage(
                          result.status === "COMMITTED"
                            ? "科室事实已持久化。"
                            : `应用结果：${result.status}`,
                        );
                      })
                    }
                  >
                    应用已批准候选
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>
                  {saved ? `科室草稿 · v${saved.version}` : "新建科室草稿"}
                </h2>
                {entry?.target && (
                  <p>
                    修订准确身份：{entry.target.id} · 预期 v
                    {entry.target.expectedVersion}。提交时重新检查当前版本。
                  </p>
                )}
                <p>
                  缺少字段可先保存；提交时校验全部字段、来源和证据。FULL
                  来源未就绪时继续阻断。
                </p>
                <Group title="来源与范围">
                  <label>
                    治理范围
                    <select
                      value={draft.campus}
                      disabled={!editable}
                      onChange={(event) =>
                        edit((data) => {
                          data.campus = event.target.value as Draft["campus"];
                        })
                      }
                    >
                      <option value="NORTH">北院区</option>
                      <option value="SOUTH">南院区</option>
                    </select>
                  </label>
                  <label>
                    已发布 CORE 契约
                    <select
                      value={draft.transport?.contractVersionId ?? ""}
                      disabled={!editable}
                      onChange={(event) =>
                        edit((data) => {
                          const selected = contracts.find(
                            (item) => item.versionId === event.target.value,
                          );
                          if (selected)
                            data.transport = {
                              contractId: selected.id,
                              contractVersionId: selected.versionId,
                            };
                          else delete data.transport;
                        })
                      }
                    >
                      <option value="">请选择</option>
                      {contracts.map((item) => (
                        <option key={item.versionId} value={item.versionId}>
                          {item.dataset} · {item.profile} · v{item.version}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    来源系统
                    <select
                      value={row.source_system_id ?? ""}
                      disabled={!editable}
                      onChange={(event) =>
                        field("source_system_id", event.target.value)
                      }
                    >
                      <option value="">请选择</option>
                      {sources.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.payload.adopted?.name ??
                            item.payload.name ??
                            item.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    来源类别
                    <select
                      value={entry?.origin ?? "NEW"}
                      disabled={!editable}
                      onChange={(event) =>
                        edit((data) => {
                          data.payload.entries![0]!.origin = event.target
                            .value as "NEW" | "HISTORICAL";
                        })
                      }
                    >
                      <option value="NEW">新建来源</option>
                      <option value="HISTORICAL">历史来源</option>
                    </select>
                  </label>
                </Group>
                <Group title="科室与业务期间">
                  {Object.entries(labels).map(([key, label]) => (
                    <Field
                      key={key}
                      label={label}
                      value={String(Reflect.get(row, key) ?? "")}
                      onChange={(next) => field(key, next)}
                      disabled={!editable}
                      time={["valid_from", "valid_to", "recorded_at"].includes(
                        key,
                      )}
                    />
                  ))}
                  <label>
                    是否虚拟
                    <select
                      value={row.is_virtual ?? "N"}
                      disabled={!editable}
                      onChange={(event) =>
                        field("is_virtual", event.target.value)
                      }
                    >
                      <option value="N">否</option>
                      <option value="Y">是，需核验领域归属</option>
                    </select>
                  </label>
                  <label>
                    来源记录状态
                    <select
                      value={row.record_status ?? "ACTIVE"}
                      disabled={!editable}
                      onChange={(event) =>
                        field("record_status", event.target.value)
                      }
                    >
                      {[
                        "DRAFT",
                        "REVIEW",
                        "ACTIVE",
                        "SUSPENDED",
                        "RETIRED",
                      ].map((status) => (
                        <option key={status}>{status}</option>
                      ))}
                    </select>
                  </label>
                </Group>
                <Group title="证据材料">
                  <label>
                    上传成立或来源依据
                    <input
                      type="file"
                      disabled={!editable}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file)
                          void run(async () => {
                            const generation = epoch.current,
                              bytesBase64 = await encodeWorkbenchFile(file);
                            if (generation === epoch.current)
                              edit((data) => {
                                data.attachment = {
                                  filename: file.name,
                                  bytesBase64,
                                };
                              });
                          });
                      }}
                    />
                  </label>
                  {draft.attachment && (
                    <p>
                      {draft.attachment.filename} ·
                      随私有草稿加密保存，提交时绑定申请
                    </p>
                  )}
                </Group>
                <div className="action-bar">
                  <button
                    disabled={
                      !canSave ||
                      !!recoverId ||
                      busy ||
                      saved?.state === "SUBMITTED" ||
                      (!!saved && !dirty && !pendingSave.current)
                    }
                    onClick={() => void save()}
                  >
                    {pendingSave.current ? "恢复原保存请求" : "保存私有草稿"}
                  </button>
                  <button
                    disabled={
                      !canSave ||
                      !!recoverId ||
                      busy ||
                      dirty ||
                      !saved ||
                      saved.state !== "EDITING"
                    }
                    onClick={() => void submit()}
                  >
                    {pendingSubmit.current ? "恢复原提交请求" : "提交核验申请"}
                  </button>
                </div>
              </>
            )}
            <DepartmentQueries
              key={actor}
              actor={actor}
              histories={histories}
            />
            <section>
              <h2>已保存科室</h2>
              <Field
                label="筛选已载入科室"
                value={filter}
                onChange={setFilter}
              />
              {histories
                .filter(
                  (item) =>
                    !filter ||
                    [
                      item.initialCode,
                      ...item.versions.map((version) => version.facts.name),
                    ].some((value) => value.includes(filter)),
                )
                .map((item) => (
                  <article className="history" key={item.id}>
                    <h3>{item.versions.at(-1)?.facts.name}</h3>
                    <button
                      disabled={!canSave || contextLocked}
                      onClick={() => {
                        const version = item.versions.at(-1);
                        if (!version) return;
                        const next = blank();
                        next.payload.entries![0]!.intent = "REVISE";
                        next.payload.entries![0]!.target = {
                          owner: "department-master",
                          id: item.id,
                          expectedVersion: version.number,
                        };
                        Object.assign(next.payload.entries![0]!.row!, {
                          org_code: item.initialCode,
                          org_name: version.facts.name,
                          org_short_name: version.facts.shortName ?? "",
                          org_type: version.facts.orgType,
                          established_on: version.facts.establishedOn ?? "",
                          description: version.facts.description ?? "",
                          is_virtual: version.facts.virtual ? "Y" : "N",
                          source_system_id: version.facts.sourceSystemId,
                        });
                        setDraft(next);
                        setSaved(null);
                        setApplication(null);
                        setDirty(true);
                        remember();
                      }}
                    >
                      修订此科室
                    </button>
                    <p>
                      初始编码：{item.initialCode} · {item.versions.length}{" "}
                      个版本
                    </p>
                    {item.versions.map((version) => (
                      <p key={version.id}>
                        v{version.number} · {version.facts.name} · B{" "}
                        {displayTime(version.valid_from)} →{" "}
                        {version.valid_to
                          ? displayTime(version.valid_to)
                          : "无界"}{" "}
                        · 平台 R {displayTime(version.recorded_at)}
                      </p>
                    ))}
                  </article>
                ))}
              {departmentCursor && (
                <button
                  disabled={
                    busy ||
                    dirty ||
                    !!pendingSubmit.current ||
                    !!pendingSave.current
                  }
                  onClick={() =>
                    void run(async () => {
                      const generation = epoch.current;
                      const ids = await value(
                        department().list({
                          after: departmentCursor,
                          limit: 100,
                        }),
                      );
                      const rows = await Promise.all(
                        ids.map((id) => value(department().history({ id }))),
                      );
                      if (generation !== epoch.current) return;
                      setHistories((prior) => [...prior, ...rows]);
                      setDepartmentCursor(
                        ids.length === 100 ? ids.at(-1)! : null,
                      );
                    })
                  }
                >
                  更多已保存科室
                </button>
              )}
            </section>
          </main>
        </div>
      ) : (
        <DepartmentDomainWorkspace
          key={actor + panel}
          actor={actor}
          kind={panel as DepartmentPanelKind}
          onLock={setDomainLock}
          refreshToken={refreshToken}
        />
      )}
    </div>
  );
}
