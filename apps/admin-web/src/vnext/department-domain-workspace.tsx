import { useEffect, useRef, useState } from "react";
import {
  createDepartmentClient,
  createDepartmentWorkspaceClient,
  createCampusClient,
  createOrganizationClient,
  createOrganizationMappingClient,
  createOrganizationIdentifierClient,
  createHierarchyClient,
  createOrganizationEvolutionClient,
  createVNextCatalogClient,
  type DepartmentWorkspaceDraft,
  type VNextOperations as Operations,
} from "@hospital-data-intelligence/generated-api-client";
import { departmentForms } from "./department-forms.generated.js";
import {
  DepartmentForm,
  DepartmentData,
  initialForm,
  fixedForm,
  human,
  type FormSchema,
  type ReferenceChoices,
  type ReferenceChoice,
} from "./department-form.js";
import {
  departmentValue as value,
  definiteFailure,
  pendingDepartmentSubmission,
} from "./department-request.js";
import { encodeWorkbenchFile } from "./workbench-file.js";

export type DepartmentPanelKind =
  "HIERARCHY" | "MAPPING" | "IDENTIFIER" | "EVOLUTION" | "LIFECYCLE" | "IMPACT";
type Saved =
  Operations["readDepartmentDraft"]["responses"][200]["content"]["application/json"];
type Application =
  Operations["listDepartmentApplications"]["responses"][200]["content"]["application/json"]["items"][number];
type Summary =
  Operations["listDepartmentDrafts"]["responses"][200]["content"]["application/json"]["items"][number];
type Contract =
  Operations["listImportContracts"]["responses"][200]["content"]["application/json"]["items"][number];
type Operation = keyof typeof departmentForms.operations;
const names: Record<DepartmentPanelKind, string> = {
  HIERARCHY: "层级视图",
  MAPPING: "来源映射",
  IDENTIFIER: "编码与别名",
  EVOLUTION: "组织演化",
  LIFECYCLE: "生命周期与院区关系",
  IMPACT: "影响处置",
};
const pipelines = {
  MAPPING: [
    "readOrganizationMappingInput",
    "previewOrganizationMappings",
    "verifyOrganizationMappingEvidence",
    "planOrganizationMappings",
    "reviewOrganizationMappings",
    "approveOrganizationMappings",
    "applyOrganizationMappings",
    "resumeOrganizationMappings",
  ],
  IDENTIFIER: [
    "readOrganizationIdentifierInput",
    "previewOrganizationIdentifiers",
    "verifyOrganizationIdentifierEvidence",
    "planOrganizationIdentifiers",
    "reviewOrganizationIdentifiers",
    "approveOrganizationIdentifiers",
    "applyOrganizationIdentifiers",
    "resumeOrganizationIdentifiers",
  ],
  EVOLUTION: [
    "readOrganizationEvolutionInput",
    "previewOrganizationEvolution",
    "verifyOrganizationEvolutionEvidence",
    "planOrganizationEvolution",
    "reviewOrganizationEvolution",
    "approveOrganizationEvolution",
    "applyOrganizationEvolution",
    "resumeOrganizationEvolution",
  ],
  LIFECYCLE: [
    "readDepartmentLifecycleInput",
    "readDepartmentLifecycleInput",
    "verifyDepartmentLifecycle",
    "planDepartmentLifecycle",
    "reviewDepartmentLifecycle",
    "approveDepartmentLifecycle",
    "applyDepartmentLifecycle",
    "resumeDepartmentLifecycleOutcome",
  ],
} as const;
const queryOperations: Record<
  DepartmentPanelKind,
  readonly [Operation, string, boolean?][]
> = {
  HIERARCHY: [
    ["getHierarchyWorkspaceTemplate", "下载 CORE 层级模板"],
    ["receiveHierarchyWorkspaceFile", "导入 CORE 层级工作簿", true],
    ["listHierarchyViews", "查看视图列表"],
    ["listHierarchyCandidates", "查看候选列表"],
    ["readHierarchyCandidate", "读取准确候选"],
    ["hierarchyHistory", "查看冻结版本历史"],
    ["readHierarchySnapshot", "读取准确快照"],
    ["readHierarchyWindow", "查询业务期间内的冻结快照"],
    ["diffHierarchySnapshots", "比较完整树版本"],
    ["approveHierarchyCandidate", "批准已核对候选", true],
    ["publishHierarchySnapshot", "发布已批准整树", true],
    ["prepareHierarchyClosure", "准备关闭或撤销候选", true],
    ["closeHierarchyView", "应用已批准关闭候选", true],
  ],
  MAPPING: [
    ["listOrganizationMappings", "查看映射列表"],
    ["getOrganizationMappingHistory", "查看映射历史"],
    ["getOrganizationMappingAsOf", "按 B/R 查询映射"],
    ["resolveOrganizationSourceMapping", "解析外部编码"],
    ["compareOrganizationMappingVersions", "比较映射版本"],
    ["receiveOrganizationMappingFile", "导入来源映射工作簿", true],
  ],
  IDENTIFIER: [
    ["listOrganizationIdentifiers", "查看标识列表"],
    ["getOrganizationIdentifierHistory", "查看标识历史"],
    ["getOrganizationIdentifierAsOf", "按 B/R 查询标识"],
    ["resolveOrganizationIdentifier", "解析编码或别名"],
    ["getOrganizationTargetAliases", "查看目标的所有别名"],
    ["getPreferredOrganizationAlias", "查看首选别名"],
    ["compareOrganizationIdentifierVersions", "比较标识版本"],
    ["receiveOrganizationIdentifierFile", "导入标识工作簿", true],
  ],
  EVOLUTION: [
    ["listOrganizationEvolutions", "查看演化事件"],
    ["getOrganizationEvolutionAsOf", "按 B/R 查询事件"],
    ["getOrganizationEvolutionGraph", "查看承继图"],
    ["getDepartmentEvolutionHistory", "查看科室演化历史"],
    ["getOrganizationEvolutionTemplate", "下载演化工作簿模板"],
    ["receiveOrganizationEvolutionFile", "导入演化工作簿", true],
    ["assessDepartmentChange", "生成影响评估", true],
    ["listDepartmentAssessments", "查看评估历史"],
  ],
  LIFECYCLE: [
    ["getDepartmentLifecycleAsOf", "按 B/R 查询生命周期"],
    ["getDepartmentLifecycleHistory", "查看生命周期历史"],
    ["getDepartmentAdmissionWindow", "核对整个期间的准入"],
    ["listDepartmentCampusRelations", "查看院区服务关系"],
    ["diffDepartmentCampusRelation", "比较院区关系版本"],
  ],
  IMPACT: [
    ["listDepartmentImpactCases", "查看影响案件"],
    ["readDepartmentImpactCase", "读取案件及当前头"],
    ["assignDepartmentImpactCase", "分配责任", true],
    ["approveDepartmentImpactDisposition", "独立批准处置", true],
    ["recheckDepartmentImpact", "复核剩余影响", true],
    ["recordDepartmentMigrationReceipt", "记录合成服务回执", true],
    ["readDepartmentMigrationHandoff", "读取准确合成交接"],
    ["readDepartmentAssessment", "读取准确影响评估"],
  ],
};
const record = (item: unknown): Record<string, unknown> =>
  item && typeof item === "object" && !Array.isArray(item)
    ? (item as Record<string, unknown>)
    : {};
const impactDomains = [
  "PERSONNEL",
  "PATIENT",
  "ACCOUNT",
  "INVENTORY",
  "FINANCE",
  "SOURCE_MAPPING",
  "HIERARCHY",
  "CONSUMER",
  "IDENTIFIER",
];
function initialPayload(kind: DepartmentPanelKind) {
  const data = record(initialForm(departmentForms.drafts[kind] as FormSchema));
  if (kind === "LIFECYCLE" || kind === "EVOLUTION")
    data["impacts"] = impactDomains.map((domain) => ({
      domain,
      determination: "UNKNOWN",
      requiredAction: "",
    }));
  return data;
}
function fresh(kind: DepartmentPanelKind): DepartmentWorkspaceDraft {
  return {
    kind,
    campus: "NORTH",
    profile: "CORE",
    requestId: crypto.randomUUID(),
    payload: initialPayload(kind),
  } as DepartmentWorkspaceDraft;
}
function operationBody(
  operation: Operation,
  seed: Record<string, unknown> = {},
) {
  const schema = departmentForms.operations[operation].schema as FormSchema;
  return {
    ...record(initialForm(schema)),
    ...Object.fromEntries(
      Object.entries(seed).filter(([key]) => key in (schema.properties ?? {})),
    ),
  };
}
function requestIds(schema: FormSchema, item: unknown): unknown {
  if (Array.isArray(item))
    return item.map((value) => requestIds(schema.items ?? {}, value));
  const data = record(item),
    branch =
      schema.anyOf?.find(
        (child) =>
          child.properties &&
          Object.entries(child.properties)
            .filter(([, v]) => v.const !== undefined || v.enum)
            .every(([key, v]) =>
              v.const !== undefined
                ? v.const === data[key]
                : v.enum!.includes(data[key]),
            ),
      ) ?? schema;
  if (branch.properties) {
    const result = { ...data };
    for (const [key, child] of Object.entries(branch.properties)) {
      if (
        ["requestId", "fileRequestId"].includes(key) &&
        branch.required?.includes(key)
      ) {
        if (typeof result[key] !== "string") result[key] = crypto.randomUUID();
      } else if (Object.hasOwn(result, key))
        result[key] = requestIds(child, result[key]);
    }
    return result;
  }
  return item;
}
function download(data: unknown) {
  const item = record(data);
  if (typeof item["bytesBase64"] !== "string") return;
  const bytes = Uint8Array.from(atob(item["bytesBase64"]), (char) =>
      char.charCodeAt(0),
    ),
    url = URL.createObjectURL(new Blob([bytes]));
  const link = document.createElement("a");
  link.href = url;
  link.download =
    typeof item["filename"] === "string"
      ? item["filename"]
      : "department-workbook.xlsx";
  link.click();
  URL.revokeObjectURL(url);
}

export function DepartmentDomainWorkspace({
  actor,
  kind,
  onLock,
  refreshToken,
}: {
  actor: string;
  kind: DepartmentPanelKind;
  onLock: (locked: boolean) => void;
  refreshToken: number;
}) {
  const [draft, setDraft] = useState<DepartmentWorkspaceDraft>(() =>
      fresh(kind),
    ),
    [saved, setSaved] = useState<Saved | null>(null),
    [drafts, setDrafts] = useState<Summary[]>([]),
    [draftCursor, setDraftCursor] = useState<string | null>(null),
    [applications, setApplications] = useState<Application[]>([]),
    [appCursor, setAppCursor] = useState<string | null>(null),
    [application, setApplication] = useState<Application | null>(null),
    [contracts, setContracts] = useState<Contract[]>([]),
    [choices, setChoices] = useState<ReferenceChoices>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [recoverId, setRecoverId] = useState<string | null>(null),
    [canSave, setCanSave] = useState(false),
    [viewAccess, setViewAccess] = useState<
      Record<string, { canWrite: boolean; canReview: boolean }>
    >({}),
    [selection, setSelection] = useState<Record<string, unknown>>({}),
    [applicationInput, setApplicationInput] = useState<unknown>(null),
    [operation, setOperation] = useState<Operation>(
      queryOperations[kind][0]![0],
    ),
    [body, setBody] = useState<Record<string, unknown>>(() =>
      operationBody(queryOperations[kind][0]![0]),
    ),
    [result, setResult] = useState<unknown>(null),
    [binding, setBinding] = useState<Record<string, unknown> | null>(null),
    [ack, setAck] = useState(false),
    [section, setSection] = useState<"DRAFT" | "APPLICATION" | "QUERY">(
      "DRAFT",
    );
  const alive = useRef(true),
    generation = useRef(0),
    pendingSave = useRef<DepartmentWorkspaceDraft | null>(null),
    pendingSubmit = useRef<{
      id: string;
      expectedVersion: string;
      requestId: string;
    } | null>(null),
    pendingOperation = useRef<{
      operation: Operation;
      body: Record<string, unknown>;
    } | null>(null);
  const recoveryKey = `hdip:p2-07:save:${actor}:${kind}`;
  const submitRecoveryKey = `hdip:p2-07:submit:${actor}:${kind}`;
  const workspace = createDepartmentWorkspaceClient(location.origin, actor),
    client = createVNextCatalogClient(location.origin, actor);
  const execute = (operation: Operation, body: Record<string, unknown>) =>
    value(
      client.POST(
        departmentForms.operations[operation].path as Parameters<
          typeof client.POST
        >[0],
        { body: body as never },
      ),
    );
  const run = async (work: () => Promise<void>) => {
    const token = generation.current;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      if (alive.current && token === generation.current)
        setMessage(error instanceof Error ? error.message : "请求未完成");
    } finally {
      if (alive.current && token === generation.current) setBusy(false);
    }
  };
  const remember = (id?: string) => {
    const url = new URL(location.href);
    url.searchParams.set("panel", kind);
    url.searchParams.set("actor", actor);
    url.searchParams.delete("input");
    if (id) url.searchParams.set("draft", id);
    else url.searchParams.delete("draft");
    history.replaceState(null, "", url.pathname + url.search);
  };
  const load = async () => {
    const [own, queue] = await Promise.all([
      value(workspace.list({ limit: 50 })),
      value(workspace.applications({ limit: 50 })),
    ]);
    if (!alive.current) return;
    setDrafts(own.items);
    setDraftCursor(own.nextCursor);
    setApplications(queue.items);
    setAppCursor(queue.nextCursor);
    setApplication((prior) =>
      prior
        ? (queue.items.find((item) => item.inputId === prior.inputId) ?? prior)
        : null,
    );
    if (kind === "HIERARCHY") {
      const views = await value(
        createHierarchyClient(location.origin, actor).list({ limit: 100 }),
      );
      if (alive.current) {
        setViewAccess(
          Object.fromEntries(
            views.items.map((item) => [
              item.viewId,
              { canWrite: item.canWrite, canReview: item.canReview },
            ]),
          ),
        );
        setChoices((prior) => ({
          ...prior,
          viewId: views.items.map((item) => ({
            value: item.viewId,
            label: item.viewName ?? item.viewCode,
          })),
        }));
      }
    }
  };
  const restorePrivateDraft = async (id: string) => {
    const token = generation.current;
    const pending = pendingDepartmentSubmission(submitRecoveryKey);
    if (pending?.id === id) pendingSubmit.current = pending;
    const item = await value(workspace.read(id));
    if (!alive.current || token !== generation.current) return;
    if (item.content.kind !== kind) throw new Error("草稿类型不匹配。");
    setDraft(item.content);
    setSaved(item);
    setDirty(false);
    setSection("DRAFT");
    if (
      pending?.id === id &&
      pending.expectedVersion === item.version &&
      item.state === "EDITING"
    ) {
      setMessage("原提交结果尚未确认，请恢复原提交请求。");
    } else {
      pendingSubmit.current = null;
      if (pending?.id === id) sessionStorage.removeItem(submitRecoveryKey);
    }
    remember(id);
  };
  useEffect(() => {
    if (refreshToken > 0) void run(load);
  }, [refreshToken]);
  useEffect(() => {
    alive.current = true;
    void run(async () => {
      await load();
      const catalog = await value(
          client.GET("/api/vnext/catalog", {
            params: { query: { scope: "SYNTHETIC" } },
          }),
        ),
        policy = await value(
          client.GET("/api/vnext/contracts/current", {
            params: { query: { scope: "SYNTHETIC" } },
          }),
        );
      const ids = await value(
          createDepartmentClient(location.origin, actor).list({ limit: 100 }),
        ),
        histories = await Promise.all(
          ids.map((id) =>
            value(
              createDepartmentClient(location.origin, actor).history({ id }),
            ),
          ),
        );
      const departments = histories.map((item) => ({
          value: item.id,
          label: `${item.versions.at(-1)?.facts.name ?? item.initialCode} · ${item.initialCode}`,
          owner: "department-master",
          version: item.versions.at(-1)?.number ?? "1",
        })),
        versions = histories.flatMap((item) =>
          item.versions.map((version) => ({
            value: version.id,
            label: `${version.facts.name} · v${version.number} · ${human(version.valid_from)}`,
          })),
        ),
        sources = catalog.items
          .filter(
            (item) => item.kind === "SOURCE" && item.status === "PUBLISHED",
          )
          .map((item) => ({
            value: item.id,
            label: String(
              item.payload.adopted?.name ?? item.payload.name ?? item.code,
            ),
          }));
      const views =
        kind === "HIERARCHY"
          ? await value(
              createHierarchyClient(location.origin, actor).list({
                limit: 100,
              }),
            )
          : null;
      if (!alive.current) return;
      setContracts(
        policy.items.filter(
          (item) =>
            item.profile === "CORE" &&
            item.status === "PUBLISHED" &&
            item.dataset ===
              {
                MAPPING: "ORG22",
                IDENTIFIER: "ORG23",
                EVOLUTION: "ORG26",
                LIFECYCLE: "ORG04",
                HIERARCHY: "ORG05",
                IMPACT: "ORG26",
              }[kind],
        ),
      );
      setChoices((prior) => ({
        ...prior,
        objects:
          kind === "MAPPING" || kind === "IDENTIFIER"
            ? (prior["objects"] ?? [])
            : departments,
        "department-master": departments,
        ORG: departments,
        departmentId: departments,
        ownerDepartmentId: departments,
        departmentVersionId: versions,
        source_system_id: sources,
        sourceSystemId: sources,
        from_system_id: sources,
        fromSystemId: sources,
        viewId:
          views?.items.map((view) => ({
            value: view.viewId,
            label: view.viewName ?? view.viewCode,
          })) ?? [],
        contractId: policy.items.map((item) => ({
          value: item.id,
          label: `${item.dataset} · ${item.profile}`,
        })),
        contractVersionId: policy.items.map((item) => ({
          value: item.versionId,
          label: `${item.dataset} · ${item.profile} · v${item.version}`,
        })),
        ...Object.fromEntries(
          [
            ["department", "ORG04"],
            ["succession", "ORG27"],
          ].flatMap(([prefix, dataset]) => {
            const selected = policy.items.filter(
              (item) =>
                item.dataset === dataset &&
                item.profile === "CORE" &&
                item.status === "PUBLISHED",
            );
            return [
              [
                prefix + "ContractId",
                selected.map((item) => ({
                  value: item.id,
                  label: `${item.dataset} · ${item.profile}`,
                })),
              ],
              [
                prefix + "ContractVersionId",
                selected.map((item) => ({
                  value: item.versionId,
                  label: `${item.dataset} · ${item.profile} · v${item.version}`,
                })),
              ],
            ];
          }),
        ),
      }));
      const inputId = new URL(location.href).searchParams.get("input");
      if (inputId) {
        const queue = await value(
            workspace.applications({ inputId, limit: 1 }),
          ),
          item = queue.items.find(
            (item) => item.inputId === inputId && item.kind === kind,
          );
        if (item) await openApplication(item);
      }
      const unresolved = sessionStorage.getItem(recoveryKey);
      if (unresolved) {
        const recovered = await value(workspace.recover(unresolved));
        if (!alive.current) return;
        if (recovered && recovered.content.kind === kind) {
          sessionStorage.removeItem(recoveryKey);
          setSaved(recovered);
          setDraft(recovered.content);
          setDirty(false);
          remember(recovered.id);
        } else {
          setRecoverId(unresolved);
          setMessage("原保存结果尚未确认，请恢复保存结果。");
        }
        return;
      }
      const pending = pendingDepartmentSubmission(submitRecoveryKey);
      const id =
        pending?.id ?? new URL(location.href).searchParams.get("draft");
      if (id) await restorePrivateDraft(id);
    });
    return () => {
      alive.current = false;
      generation.current++;
      onLock(false);
    };
  }, [actor, kind]);
  useEffect(() => {
    let current = true;
    const choose = (rows: unknown): ReferenceChoice[] =>
      Array.isArray(rows)
        ? rows.flatMap((item) => {
            const data = record(item),
              facts = record(data["facts"]);
            return typeof data["id"] === "string"
              ? [
                  {
                    value: data["id"],
                    label: String(
                      data["legalName"] ??
                        facts["campusName"] ??
                        facts["name"] ??
                        data["id"],
                    ),
                  },
                ]
              : [];
          })
        : [];
    void (async () => {
      const results = await Promise.allSettled([
        value(
          createOrganizationClient(location.origin, actor).read({
            mode: "LIST",
            limit: 100,
          }),
        ),
        value(createCampusClient(location.origin, actor).list({ limit: 100 })),
        value(
          createOrganizationMappingClient(location.origin, actor).list({
            campus: draft.campus,
            limit: 100,
          }),
        ),
        value(
          createOrganizationIdentifierClient(location.origin, actor).list({
            campus: draft.campus,
            limit: 100,
          }),
        ),
        value(
          createOrganizationEvolutionClient(location.origin, actor).list({
            campus: draft.campus,
            limit: 100,
          }),
        ),
      ]);
      const orgs =
          results[0]?.status === "fulfilled"
            ? choose(results[0].value)
            : undefined,
        campuses =
          results[1]?.status === "fulfilled"
            ? choose(results[1].value)
            : undefined;
      const mapping =
          results[2]?.status === "fulfilled" && Array.isArray(results[2].value)
            ? results[2].value.map((id) => ({
                value: id,
                label: "来源映射 · " + id,
              }))
            : undefined,
        identifiers =
          results[3]?.status === "fulfilled" && Array.isArray(results[3].value)
            ? results[3].value.map((id) => ({
                value: id,
                label: "标识 · " + id,
              }))
            : undefined;
      if (!current || !alive.current) return;
      setChoices((prior) => ({
        ...prior,
        ...(orgs ? { "organization-master": orgs, LEGAL: orgs } : {}),
        ...(campuses
          ? {
              "organization-master/campus": campuses,
              CAMPUS: campuses,
              campusId: campuses,
            }
          : {}),
        ...(mapping
          ? { "department-master/organization-mapping": mapping }
          : {}),
        ...(identifiers
          ? { "department-master/organization-identifier": identifiers }
          : {}),
        ...(results[4]?.status === "fulfilled"
          ? {
              "department-master/organization-evolution": results[4].value.map(
                (id) => ({
                  value: id,
                  label: "演化事件 · " + id,
                  version: "1",
                }),
              ),
              eventId: results[4].value.map((id) => ({
                value: id,
                label: "演化事件 · " + id,
              })),
            }
          : {}),
        ...(kind === "MAPPING" && mapping
          ? { objects: mapping }
          : kind === "IDENTIFIER" && identifiers
            ? { objects: identifiers }
            : {}),
      }));
    })();
    return () => {
      current = false;
    };
  }, [actor, kind, draft.campus]);
  useEffect(() => {
    onLock(
      busy ||
        dirty ||
        !!recoverId ||
        !!pendingSave.current ||
        !!pendingSubmit.current ||
        !!pendingOperation.current,
    );
  }, [busy, dirty, recoverId, onLock]);
  useEffect(() => {
    let current = true;
    setCanSave(false);
    void value(workspace.permissions({ kind, campus: draft.campus }))
      .then((result) => {
        if (current && alive.current) setCanSave(result.canSave);
      })
      .catch(() => {
        if (current && alive.current) setCanSave(false);
      });
    return () => {
      current = false;
    };
  }, [actor, kind, draft.campus]);
  const edit = (change: (next: DepartmentWorkspaceDraft) => void) => {
    if (
      !alive.current ||
      !!recoverId ||
      !canSave ||
      busy ||
      pendingSave.current ||
      pendingSubmit.current ||
      saved?.state === "SUBMITTED"
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
  const save = () =>
    run(async () => {
      pendingSave.current ??= {
        ...structuredClone(draft),
        payload: fixedForm(
          departmentForms.drafts[kind] as FormSchema,
          draft.payload,
        ) as never,
        ...(saved ? { id: saved.id, expectedVersion: saved.version } : {}),
      };
      sessionStorage.setItem(recoveryKey, pendingSave.current.requestId);
      try {
        const written = await value(workspace.save(pendingSave.current));
        if (!alive.current) return;
        pendingSave.current = null;
        sessionStorage.removeItem(recoveryKey);
        const restored = await value(workspace.read(written.id));
        if (!alive.current) return;
        setSaved(restored);
        setDirty(false);
        remember(written.id);
        setMessage("私有草稿已保存，刷新可恢复。");
        await load();
      } catch (error) {
        if (definiteFailure(error)) {
          pendingSave.current = null;
          sessionStorage.removeItem(recoveryKey);
        }
        throw error;
      }
    });
  const submit = () =>
    run(async () => {
      if (!saved || dirty) throw new Error("请先保存当前内容。");
      pendingSubmit.current ??= {
        id: saved.id,
        expectedVersion: saved.version,
        requestId: crypto.randomUUID(),
      };
      sessionStorage.setItem(
        submitRecoveryKey,
        JSON.stringify(pendingSubmit.current),
      );
      let accepted = false;
      try {
        const submitted = await value(workspace.submit(pendingSubmit.current));
        accepted = true;
        if (!alive.current) return;
        setResult(submitted);
        const restored = await value(workspace.read(saved.id));
        if (!alive.current) return;
        setSaved(restored);
        await load();
        if (!alive.current) return;
        pendingSubmit.current = null;
        sessionStorage.removeItem(submitRecoveryKey);
        setMessage("已提交到现有领域核验流程。");
      } catch (error) {
        if (!accepted && definiteFailure(error)) {
          pendingSubmit.current = null;
          sessionStorage.removeItem(submitRecoveryKey);
        }
        throw error;
      }
    });
  const choose = (next: Operation, seed: Record<string, unknown> = {}) => {
    if (pendingOperation.current) return;
    generation.current++;
    setOperation(next);
    const submitted = record(saved?.submission);
    const defaults = {
      ...submitted,
      ...(binding?.["head"] !== undefined
        ? { expectedHead: binding["head"] }
        : {}),
      ...(submitted["publicationRequestId"]
        ? { requestId: submitted["publicationRequestId"] }
        : {}),
    };
    const nextBody = operationBody(next, {
      campus: draft.campus,
      ...defaults,
      ...selection,
      ...seed,
    });
    // Only publication/apply/resume replay the accepted operation's request.
    // A new closure, verification, assessment or file intake is a new command.
    if (
      !/^(publishHierarchySnapshot|closeHierarchyView|apply|resume)/.test(next)
    )
      delete nextBody["requestId"];
    if (/^receiveOrganization.*File$/.test(next)) {
      const metadata = record(nextBody["metadata"]);
      metadata["campus"] = draft.campus;
      metadata["retentionSeconds"] = 7200;
      metadata["job"] = {
        action: "CREATE",
        scope: "SYNTHETIC",
        profile: "CORE",
        reason: "DEPARTMENT_WORKSPACE_FILE",
        contractId: contracts[0]?.id,
        contractVersionId: contracts[0]?.versionId,
        input: {
          kind: "FILE",
          format: "XLSX",
          parserPolicy: {
            MAPPING: "STRICT_ORGANIZATION_MAPPING_V1",
            IDENTIFIER: "STRICT_ORGANIZATION_IDENTIFIER_V1",
            EVOLUTION: "STRICT_ORGANIZATION_EVOLUTION_V1",
          }[kind as "MAPPING" | "IDENTIFIER" | "EVOLUTION"],
        },
      };
      nextBody["metadata"] = metadata;
    }
    setBody(nextBody);
    setResult(null);
    setAck(false);
    setSection("QUERY");
  };
  const mutation =
    queryOperations[kind].find((item) => item[0] === operation)?.[2] ??
    /^(verify|plan|approve|apply)/.test(operation);
  const approval = /^approve/.test(operation),
    approvalBound =
      !approval ||
      (binding !== null &&
        (body["candidateId"] !== undefined
          ? body["candidateId"] === binding["candidateId"] &&
            body["digest"] === binding["digest"]
          : body["caseId"] === binding["caseId"] &&
            body["proposalEventId"] === binding["proposalEventId"] &&
            body["expectedHead"] === binding["head"]));
  const operationAllowed = (id: Operation) => {
    if (id === "recordDepartmentMigrationReceipt") return false;
    if (kind === "HIERARCHY") {
      const selected = String(
        body["viewId"] ??
          binding?.["viewId"] ??
          selection["viewId"] ??
          record(saved?.submission)["viewId"] ??
          "",
      );
      const access = viewAccess[selected];
      if (id === "approveHierarchyCandidate") return access?.canReview ?? false;
      if (
        [
          "publishHierarchySnapshot",
          "closeHierarchyView",
          "prepareHierarchyClosure",
        ].includes(id)
      )
        return canSave && (access?.canWrite ?? false);
    }
    const isMutation = queryOperations[kind].find(
      (item) => item[0] === id,
    )?.[2];
    return !isMutation || /^approve/.test(id) || canSave;
  };
  const perform = () =>
    run(async () => {
      if (!operationAllowed(operation))
        throw new Error("当前身份没有此维护权限。");
      if (approval && (!ack || !approvalBound))
        throw new Error("请先读取准确候选或案件并核对内容。");
      pendingOperation.current ??= {
        operation,
        body: record(
          requestIds(
            departmentForms.operations[operation].schema as FormSchema,
            body,
          ),
        ),
      };
      if (operation === "receiveHierarchyWorkspaceFile")
        sessionStorage.setItem(
          recoveryKey,
          String(pendingOperation.current.body["requestId"]),
        );
      let acceptedFile = false;
      try {
        const output = await execute(
          pendingOperation.current.operation,
          pendingOperation.current.body,
        );
        if (!alive.current) return;
        setResult(output);
        const item = record(output);
        if (
          operation === "receiveHierarchyWorkspaceFile" &&
          record(item["draft"])["id"]
        ) {
          acceptedFile = true;
          const restored = await value(
            workspace.read(String(record(item["draft"])["id"])),
          );
          if (!alive.current) return;
          setDraft(restored.content);
          setSaved(restored);
          setDirty(false);
          remember(restored.id);
          setSection("DRAFT");
        }
        pendingOperation.current = null;
        if (operation === "receiveHierarchyWorkspaceFile")
          sessionStorage.removeItem(recoveryKey);
        if (/^review|^readHierarchyCandidate/.test(operation))
          setBinding({ ...item });
        else if (operation === "readDepartmentImpactCase") {
          const detail = record(item["item"]),
            history = Array.isArray(item["history"]) ? item["history"] : [],
            proposal = history
              .map(record)
              .filter((event) => event["kind"] === "PROPOSE")
              .at(-1);
          setBinding({
            caseId: detail["id"],
            head: detail["head"],
            proposalEventId: proposal?.["eventId"],
          });
        }
        setAck(false);
        if (mutation) await load();
        setMessage("操作已完成，以下为服务端持久化结果。");
      } catch (error) {
        if (!acceptedFile && definiteFailure(error)) {
          pendingOperation.current = null;
          if (operation === "receiveHierarchyWorkspaceFile")
            sessionStorage.removeItem(recoveryKey);
        }
        throw error;
      }
    });
  const openApplication = (item: Application) => {
    const token = ++generation.current;
    return run(async () => {
      if (!(kind in pipelines)) return;
      const steps = pipelines[kind as keyof typeof pipelines],
        input = await execute(steps[0], { inputId: item.inputId }),
        comparison =
          kind === "LIFECYCLE"
            ? null
            : await execute(steps[1], { inputId: item.inputId });
      if (!alive.current || token !== generation.current) return;
      setApplication(item);
      setApplicationInput(input);
      setResult({ input, comparison });
      setBinding(null);
      setSection("APPLICATION");
      const url = new URL(location.href);
      url.searchParams.set("input", item.inputId);
      url.searchParams.delete("draft");
      history.replaceState(null, "", url.pathname + url.search);
    });
  };
  const verifyBody = () => {
    if (!application) return {};
    const data = record(applicationInput),
      seed: Record<string, unknown> = {
        inputId: application.inputId,
        inputDigest: application.inputDigest,
      };
    if (kind === "MAPPING" || kind === "IDENTIFIER")
      seed["rows"] = (
        Array.isArray(data["entries"]) ? data["entries"] : []
      ).map((entry, index) => ({
        row: index + 1,
        evidenceId: record(entry)["evidenceId"],
        ...(kind === "MAPPING"
          ? { contextApproved: false, sourceKeyReuse: false }
          : { policyApproved: false }),
      }));
    else
      seed["impactReviews"] = impactDomains.map((domain) => ({
        domain,
        ownerAttestationAccepted: false,
        dispositionAccepted: false,
      }));
    return seed;
  };
  const selectRecord = (item: Record<string, unknown>) => {
    const view = item["viewCode"] ? item : record(item["view"]);
    setSelection({
      ...item,
      ...(view["id"] || view["viewId"]
        ? {
            viewId: view["id"] ?? view["viewId"],
            expectedVersion: view["version"],
          }
        : {}),
    });
    setMessage("已选择准确记录，下一项操作将使用此记录引用。");
  };
  const applicationActions =
    application && kind in pipelines ? (
      <div className="action-bar">
        {pipelines[kind as keyof typeof pipelines].slice(2).map((id, index) => {
          const permission =
            index === 0
              ? application.access.canVerify
              : index === 1
                ? application.access.canPlan
                : index === 2 || index === 3
                  ? application.access.canReview
                  : application.access.canApply;
          const labels = [
            "独立核验",
            "生成变更候选",
            "读取准确候选",
            "批准候选",
            "应用已批准候选",
            "恢复原应用结果",
          ];
          return (
            <button
              key={id}
              disabled={
                busy ||
                dirty ||
                !!pendingOperation.current ||
                !permission ||
                (index >= 2 && !application.candidateId) ||
                (index === 4 && application.state !== "APPROVED") ||
                (index === 1 && application.state === "COMMITTED")
              }
              onClick={() =>
                choose(
                  id,
                  index === 0
                    ? verifyBody()
                    : {
                        inputId: application.inputId,
                        candidateId: application.candidateId,
                        digest: application.candidateDigest,
                        requestId: application.requestId,
                      },
                )
              }
            >
              {labels[index]}
            </button>
          );
        })}
      </div>
    ) : null;
  const locked =
    !!recoverId ||
    busy ||
    dirty ||
    !!pendingSave.current ||
    !!pendingSubmit.current ||
    !!pendingOperation.current;
  return (
    <section className="domain-workspace">
      <h2>{names[kind]}</h2>
      <p>
        CORE 独立维护。每次提交仍由原领域 Owner
        核对当前权限、准确版本与整个业务期间。FULL 引用未就绪时阻断。
      </p>
      {kind === "IMPACT" && (
        <p>合成回执由已有服务主体提交；人工身份可读取准确交接和回执历史。</p>
      )}
      <p role="status">{message}</p>
      {recoverId && (
        <button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const recovered = await value(workspace.recover(recoverId));
              if (!recovered) {
                setMessage("服务端尚无此保存结果，保留原请求标识等待恢复。");
                return;
              }
              sessionStorage.removeItem(recoveryKey);
              setRecoverId(null);
              setDraft(recovered.content);
              setSaved(recovered);
              setDirty(false);
              setSection("DRAFT");
              remember(recovered.id);
            })
          }
        >
          恢复保存结果
        </button>
      )}
      {!saved && pendingSubmit.current && (
        <button
          disabled={busy}
          onClick={() => {
            const request = pendingSubmit.current;
            if (request) void run(() => restorePrivateDraft(request.id));
          }}
        >
          恢复提交状态
        </button>
      )}
      <div className="workspace-layout">
        <aside className="draft-list">
          <button
            disabled={!canSave || locked}
            onClick={() => {
              generation.current++;
              setDraft(fresh(kind));
              setSaved(null);
              setApplication(null);
              setResult(null);
              setBinding(null);
              setDirty(false);
              setSection("DRAFT");
              remember();
            }}
          >
            新建{names[kind]}草稿
          </button>
          <h3>私有草稿</h3>
          {drafts
            .filter((item) => item.kind === kind)
            .map((item) => (
              <button
                key={item.id}
                disabled={locked}
                onClick={() =>
                  void run(async () => {
                    await restorePrivateDraft(item.id);
                    if (alive.current) setResult(null);
                  })
                }
              >
                v{item.version} · {human(item.state)} · {human(item.recordedAt)}
              </button>
            ))}
          {draftCursor && (
            <button
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  const next = await value(
                    workspace.list({ after: draftCursor, limit: 50 }),
                  );
                  if (alive.current) {
                    setDrafts((old) => [...old, ...next.items]);
                    setDraftCursor(next.nextCursor);
                  }
                })
              }
            >
              更多草稿
            </button>
          )}
          <h3>核验申请</h3>
          {applications
            .filter((item) => item.kind === kind)
            .map((item) => (
              <button
                key={item.inputId}
                disabled={locked}
                onClick={() => void openApplication(item)}
              >
                {human(item.state)} · {item.maker} · {human(item.recordedAt)}
              </button>
            ))}
          {appCursor && (
            <button
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  const next = await value(
                    workspace.applications({ after: appCursor, limit: 50 }),
                  );
                  if (alive.current) {
                    setApplications((old) => [...old, ...next.items]);
                    setAppCursor(next.nextCursor);
                  }
                })
              }
            >
              更多申请
            </button>
          )}
          <h3>历史与维护操作</h3>
          {queryOperations[kind].map(([id, label]) => (
            <button
              key={id}
              disabled={locked || !operationAllowed(id)}
              onClick={() => choose(id, binding ?? {})}
            >
              {label}
            </button>
          ))}
        </aside>
        <main className="editor-card">
          {dirty && (
            <button
              disabled={
                busy || !!pendingSave.current || !!pendingSubmit.current
              }
              onClick={() => {
                generation.current++;
                setDraft(fresh(kind));
                setSaved(null);
                setDirty(false);
                setApplication(null);
                setSection("DRAFT");
                setResult(null);
                setBinding(null);
                remember();
              }}
            >
              放弃未保存修改
            </button>
          )}
          {section === "DRAFT" ? (
            <>
              <h3>
                {names[kind]}草稿{saved ? " · v" + saved.version : ""}
              </h3>
              <label>
                治理院区
                <select
                  aria-label="治理院区"
                  value={draft.campus}
                  disabled={
                    !canSave ||
                    !!recoverId ||
                    busy ||
                    !!pendingSave.current ||
                    !!pendingSubmit.current ||
                    saved?.state === "SUBMITTED"
                  }
                  onChange={(event) =>
                    edit((next) => {
                      next.campus = event.target.value as "NORTH" | "SOUTH";
                    })
                  }
                >
                  <option value="NORTH">北院区</option>
                  <option value="SOUTH">南院区</option>
                </select>
              </label>
              {kind !== "HIERARCHY" && kind !== "IMPACT" && (
                <label>
                  已发布 CORE 契约
                  <select
                    aria-label="已发布 CORE 契约"
                    value={draft.transport?.contractVersionId ?? ""}
                    disabled={
                      !canSave ||
                      !!recoverId ||
                      busy ||
                      !!pendingSave.current ||
                      !!pendingSubmit.current ||
                      saved?.state === "SUBMITTED"
                    }
                    onChange={(event) =>
                      edit((next) => {
                        const contract = contracts.find(
                          (item) => item.versionId === event.target.value,
                        );
                        if (contract)
                          next.transport = {
                            contractId: contract.id,
                            contractVersionId: contract.versionId,
                          };
                        else delete next.transport;
                      })
                    }
                  >
                    <option value="">请选择</option>
                    {contracts.map((item) => (
                      <option value={item.versionId} key={item.versionId}>
                        {item.dataset} · CORE · v{item.version}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <DepartmentForm
                schema={departmentForms.drafts[kind] as FormSchema}
                value={draft.payload}
                onChange={(payload) =>
                  edit((next) => {
                    next.payload = payload as never;
                  })
                }
                choices={choices}
                disabled={
                  !canSave ||
                  !!recoverId ||
                  busy ||
                  saved?.state === "SUBMITTED" ||
                  !!pendingSave.current ||
                  !!pendingSubmit.current ||
                  (kind === "HIERARCHY" && !!draft.attachment)
                }
              />
              {kind === "HIERARCHY" && draft.attachment && (
                <p>
                  内容来自不可变原工作簿。修改请新建文件导入草稿，并重新核验。
                </p>
              )}
              {kind !== "HIERARCHY" && kind !== "IMPACT" && (
                <label>
                  上传核验材料
                  <input
                    type="file"
                    disabled={
                      !canSave ||
                      !!recoverId ||
                      busy ||
                      !!pendingSave.current ||
                      !!pendingSubmit.current ||
                      saved?.state === "SUBMITTED"
                    }
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file)
                        void run(async () => {
                          const bytesBase64 = await encodeWorkbenchFile(file);
                          if (alive.current)
                            edit((next) => {
                              next.attachment = {
                                filename: file.name,
                                bytesBase64,
                              };
                            });
                        });
                    }}
                  />
                  {draft.attachment?.filename}
                </label>
              )}
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
                <button
                  disabled={locked || !saved || saved.state !== "EDITING"}
                  onClick={() =>
                    void run(async () => {
                      if (!saved) return;
                      await value(
                        workspace.discard({
                          id: saved.id,
                          expectedVersion: saved.version,
                          requestId: crypto.randomUUID(),
                        }),
                      );
                      await load();
                      setSaved(await value(workspace.read(saved.id)));
                    })
                  }
                >
                  放弃当前草稿
                </button>
              </div>
            </>
          ) : section === "APPLICATION" && application && kind in pipelines ? (
            <>
              <h3>核验申请 · {human(application.state)}</h3>
              <DepartmentData value={result} label="申请及当前差异" />
              <div className="action-bar">
                {pipelines[kind as keyof typeof pipelines]
                  .slice(2)
                  .map((id, index) => {
                    const permission =
                      index === 0
                        ? application.access.canVerify
                        : index === 1
                          ? application.access.canPlan
                          : index === 2 || index === 3
                            ? application.access.canReview
                            : application.access.canApply;
                    const labels = [
                      "独立核验",
                      "生成变更候选",
                      "读取准确候选",
                      "批准候选",
                      "应用已批准候选",
                      "恢复原应用结果",
                    ];
                    return (
                      <button
                        key={id}
                        disabled={
                          locked ||
                          !permission ||
                          (index >= 2 && !application.candidateId) ||
                          (index === 4 && application.state !== "APPROVED")
                        }
                        onClick={() =>
                          choose(
                            id,
                            index === 0
                              ? verifyBody()
                              : {
                                  inputId: application.inputId,
                                  candidateId: application.candidateId,
                                  digest: application.candidateDigest,
                                  requestId: application.requestId,
                                },
                          )
                        }
                      >
                        {labels[index]}
                      </button>
                    );
                  })}
              </div>
            </>
          ) : (
            <>
              <h3>
                {queryOperations[kind].find(
                  (item) => item[0] === operation,
                )?.[1] ?? "申请维护操作"}
              </h3>
              <DepartmentForm
                schema={
                  departmentForms.operations[operation].schema as FormSchema
                }
                value={body}
                onChange={(next) => {
                  if (pendingOperation.current) return;
                  setBody(record(next));
                  setResult(null);
                  setAck(false);
                }}
                choices={choices}
                disabled={busy || !!pendingOperation.current}
              />
              {approval && (
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                    disabled={busy || !approvalBound}
                  />
                  我已读取并核对本次准确候选或案件
                </label>
              )}
              <button
                disabled={
                  busy ||
                  !operationAllowed(operation) ||
                  (approval && (!ack || !approvalBound))
                }
                onClick={() => void perform()}
              >
                {pendingOperation.current
                  ? "恢复原操作请求"
                  : mutation
                    ? "提交维护操作"
                    : "查询"}
              </button>
              {approval && !approvalBound && (
                <p>请先读取准确候选或案件，再从左侧进入批准操作。</p>
              )}
              {operation === "recordDepartmentMigrationReceipt" && (
                <p>
                  合成回执由已有服务主体提交；当前人工身份仅可读取准确交接和回执历史。
                </p>
              )}
              <DepartmentData
                value={result}
                label="持久化结果"
                onSelect={selectRecord}
              />
              {applicationActions}
              {typeof record(result)["bytesBase64"] === "string" && (
                <button onClick={() => download(result)}>下载工作簿</button>
              )}
            </>
          )}
        </main>
      </div>
    </section>
  );
}
