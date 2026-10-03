import { sql } from "kysely";
import type { Static } from "typebox";
import { createHash } from "node:crypto";
import { campusInput } from "../../organization-master/campus/input.js";
import {
  authenticateRegistrationEvidence,
  canonicalPlan,
  planBinding,
  sealProtectedPayload,
  protectedArtifacts,
  type KeyProviderPort,
  type CatalogTransactionScope,
} from "../../governance-catalog/index.js";
import { check, Id, StageSchema, type StageInput } from "./contracts.js";
import { openDepartment } from "./index.js";
import {
  openHierarchy,
  HierarchyCandidateSchema,
  CreateHierarchyViewSchema,
  type HierarchyCandidateInput,
  type CreateHierarchyViewInput,
} from "./hierarchy.js";
import { openOrganizationMappings } from "./organization-mapping.js";
import { openOrganizationIdentifiers } from "./organization-identifier.js";
import { openOrganizationEvolutions } from "./organization-evolution.js";
import { openDepartmentLifecycle } from "./department-lifecycle.js";
import type { OrganizationMappingStageInput } from "./organization-mapping-contracts.js";
import type { OrganizationIdentifierStageInput } from "./organization-identifier-contracts.js";
import type { EvolutionStageInput } from "./organization-evolution-contracts.js";
import type { DepartmentLifecycleStageInput } from "./department-lifecycle-contracts.js";
import type { RecordDispositionInput } from "./department-impact-contracts.js";
import {
  HierarchyWorkspaceFileSchema,
  HierarchyWorkspaceTemplateSchema,
  hierarchyCoreTemplate,
  parseHierarchyCoreFile,
  type HierarchyWorkspaceFile,
} from "./hierarchy-workbook.js";
import {
  workspaceStages,
  DepartmentDraftActionSchema,
  DepartmentDraftListSchema,
  DepartmentApplicationListSchema,
  SaveDepartmentDraftSchema,
  DepartmentWorkspacePermissionSchema,
  type DepartmentWorkspacePermission,
  type DepartmentApplicationList,
  type SaveDepartmentDraft,
  type DepartmentDraftAction,
  type DepartmentDraftList,
  type DepartmentDraftSaved,
  type DepartmentDraftSubmission,
  type DepartmentApplication,
} from "./workspace-contracts.js";
export * from "./workspace-contracts.js";
type StaticTemplate = Static<typeof HierarchyWorkspaceTemplateSchema>;

function metadata(input: SaveDepartmentDraft) {
  const references: Array<{ owner: string; id: string }> = [];
  const namespaces: Array<{ source: string; entity: string; context: string }> =
      [],
    schemes: string[] = [];
  const add = (owner: string, id: unknown) => {
    if (typeof id === "string") {
      check(Id, id);
      if (!references.some((ref) => ref.owner === owner && ref.id === id))
        references.push({ owner, id });
    }
  };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (
      [
        "department-master",
        "organization-master",
        "organization-master/campus",
        "department-master/organization-mapping",
        "department-master/organization-identifier",
      ].includes(String(item["owner"]))
    )
      add(String(item["owner"]), item["id"]);
    if (item["departmentId"]) add("department-master", item["departmentId"]);
    if (item["ownerDepartmentId"])
      add("department-master", item["ownerDepartmentId"]);
    if (item["viewId"]) add("department-master/hierarchy-view", item["viewId"]);
    if (input.kind === "IMPACT" && item["caseId"])
      add("department-master/impact-case", item["caseId"]);
    if (
      item["target_id"] &&
      ["ORG", "LEGAL", "CAMPUS"].includes(String(item["target_type"]))
    )
      add(
        item["target_type"] === "ORG"
          ? "department-master"
          : item["target_type"] === "LEGAL"
            ? "organization-master"
            : "organization-master/campus",
        item["target_id"],
      );
    for (const key of ["source_system_id", "from_system_id", "sourceSystemId"])
      if (item[key]) add("governance-catalog/source", item[key]);
    if (
      input.kind === "MAPPING" &&
      typeof item["from_system_id"] === "string" &&
      typeof item["source_entity_type"] === "string" &&
      typeof item["source_context"] === "string"
    )
      namespaces.push({
        source: item["from_system_id"],
        entity: item["source_entity_type"],
        context: item["source_context"],
      });
    if (
      input.kind === "IDENTIFIER" &&
      typeof item["identifier_system"] === "string"
    )
      schemes.push(item["identifier_system"]);
    Object.values(item).forEach(visit);
  };
  visit(input.payload);
  return {
    kind: input.kind,
    campus: input.campus,
    references,
    namespaces,
    schemes,
    hasAttachment: !!input.attachment,
    ...(input.transport ? { transport: input.transport } : {}),
  };
}
interface Stored extends DepartmentDraftSaved {
  digest: string;
  metadata: ReturnType<typeof metadata>;
  envelope: ReturnType<typeof sealProtectedPayload>;
  submission: DepartmentDraftSubmission | null;
}
export function openDepartmentWorkspace(
  connection: string,
  provider?: KeyProviderPort,
) {
  const { db, root } = campusInput(connection, provider);
  const department = openDepartment(connection, provider);
  const hierarchy = openHierarchy(connection, provider);
  const mapping = openOrganizationMappings(connection, provider),
    identifier = openOrganizationIdentifiers(connection, provider),
    evolution = openOrganizationEvolutions(connection, provider),
    lifecycle = openDepartmentLifecycle(connection, provider);
  const part = (requestId: string, label: string) => {
    const bytes = createHash("sha256")
      .update("DEPARTMENT_WORKSPACE_REQUEST_V1\0" + requestId + "\0" + label)
      .digest()
      .subarray(0, 16);
    bytes[6] = (bytes[6]! & 15) | 128;
    bytes[8] = (bytes[8]! & 63) | 128;
    const h = bytes.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  const unseal = (record: Stored): SaveDepartmentDraft => {
    const bytes = authenticateRegistrationEvidence(
      {
        binding: ["DEPARTMENT_WORKSPACE_DRAFT_V1", record.digest],
        envelope: record.envelope,
      },
      provider,
    );
    try {
      const content: SaveDepartmentDraft = JSON.parse(bytes.toString());
      check(SaveDepartmentDraftSchema, content);
      if (
        planBinding(provider, "DEPARTMENT_WORKSPACE_DRAFT_V1", {
          state: record.state,
          input: content,
        }) !== record.digest ||
        canonicalPlan(metadata(content)) !== canonicalPlan(record.metadata)
      )
        throw new Error("PAYLOAD_UNAVAILABLE");
      return content;
    } finally {
      bytes.fill(0);
    }
  };
  const save = async (
    actor: string,
    input: SaveDepartmentDraft,
    state: DepartmentDraftSaved["state"],
  ) => {
    check(SaveDepartmentDraftSchema, input);
    input = structuredClone(input);
    const digest = planBinding(provider, "DEPARTMENT_WORKSPACE_DRAFT_V1", {
        state,
        input,
      }),
      bytes = Buffer.from(canonicalPlan(input));
    try {
      const envelope = sealProtectedPayload(
        bytes,
        ["DEPARTMENT_WORKSPACE_DRAFT_V1", digest],
        provider,
      );
      return await root(
        async (scope) =>
          (
            await sql<{
              r: DepartmentDraftSaved;
            }>`select department_master.workspace_save(${actor},${JSON.stringify({ ...input, state, metadata: metadata(input) })}::jsonb,${digest},${JSON.stringify(envelope)}::jsonb) r`.execute(
              scope,
            )
          ).rows[0]!.r,
      );
    } finally {
      bytes.fill(0);
    }
  };
  const read = async (actor: string, id: string) => {
    check(Id, id);
    return root(
      async (scope) =>
        (
          await sql<{
            r: Stored;
          }>`select department_master.workspace_read(${actor},${id}::uuid) r`.execute(
            scope,
          )
        ).rows[0]!.r,
    );
  };
  const link = async (
    scope: CatalogTransactionScope,
    actor: string,
    content: SaveDepartmentDraft,
    input: DepartmentDraftAction,
    submission: DepartmentDraftSubmission,
  ) => {
    const saved = { ...content, ...input },
      authorization = metadata(saved),
      digest = planBinding(provider, "DEPARTMENT_WORKSPACE_DRAFT_V1", {
        state: "SUBMITTED",
        input: saved,
      }),
      bytes = Buffer.from(canonicalPlan(saved));
    if (
      submission.kind === "HIERARCHY" &&
      !authorization.references.some(
        (ref) =>
          ref.owner === "department-master/hierarchy-view" &&
          ref.id === submission.viewId,
      )
    ) {
      authorization.references.push({
        owner: "department-master/hierarchy-view",
        id: submission.viewId,
      });
    }
    try {
      const envelope = sealProtectedPayload(
        bytes,
        ["DEPARTMENT_WORKSPACE_DRAFT_V1", digest],
        provider,
      );
      await sql`select department_master.workspace_save(${actor},${JSON.stringify({ ...input, state: "SUBMITTED", metadata: authorization, submission })}::jsonb,${digest},${JSON.stringify(envelope)}::jsonb)`.execute(
        scope,
      );
    } finally {
      bytes.fill(0);
    }
    return submission;
  };
  const permissions = async (
    actor: string,
    input: DepartmentWorkspacePermission,
  ) => {
    check(DepartmentWorkspacePermissionSchema, input);
    const access = async (permission: string) => {
      try {
        await root((scope) =>
          sql`select department_master.workspace_authorize(${actor},${JSON.stringify({ ...input, references: [], namespaces: [], schemes: [] })}::jsonb,${permission})`.execute(
            scope,
          ),
        );
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          ["ACCESS_DENIED", "ACTOR_INACTIVE"].includes(error.message)
        )
          return false;
        throw error;
      }
    };
    const canRead = await access("READ"),
      restricted = await access("READ_RESTRICTED");
    return {
      canRead: canRead && restricted,
      canSave: canRead && restricted && (await access("WRITE")),
    };
  };
  return {
    async hierarchyFileTemplate(actor: string, input: StaticTemplate) {
      check(HierarchyWorkspaceTemplateSchema, input);
      if (input.profile !== "CORE") throw new Error("BLOCKED_DEPENDENCY");
      if (
        !(await permissions(actor, { kind: "HIERARCHY", campus: input.campus }))
          .canRead
      )
        throw new Error("ACCESS_DENIED");
      const bytes = hierarchyCoreTemplate();
      try {
        return {
          filename: "hierarchy-core-v1.xlsx",
          bytesBase64: bytes.toString("base64"),
          profile: "CORE" as const,
          parserPolicy: "STRICT_HIERARCHY_CORE_V1" as const,
        };
      } finally {
        bytes.fill(0);
      }
    },
    async receiveHierarchyFile(actor: string, input: HierarchyWorkspaceFile) {
      check(HierarchyWorkspaceFileSchema, input);
      if (input.profile !== "CORE") throw new Error("BLOCKED_DEPENDENCY");
      if (
        !(await permissions(actor, { kind: "HIERARCHY", campus: input.campus }))
          .canSave
      )
        throw new Error("ACCESS_DENIED");
      const bytes = Buffer.from(input.bytesBase64, "base64");
      try {
        if (
          !bytes.length ||
          bytes.length > 1048576 ||
          bytes.toString("base64") !== input.bytesBase64
        )
          throw new Error("FILE_SIZE_OR_ENCODING");
        const parsed = await parseHierarchyCoreFile(bytes);
        if (!parsed.payload) return { ...parsed, draft: null };
        const draft = await save(
          actor,
          {
            requestId: input.requestId,
            kind: "HIERARCHY",
            campus: input.campus,
            profile: "CORE",
            attachment: {
              filename: input.filename,
              bytesBase64: input.bytesBase64,
            },
            payload: parsed.payload,
          },
          "EDITING",
        );
        return {
          structuralStatus: parsed.structuralStatus,
          issues: parsed.issues,
          draft,
        };
      } finally {
        bytes.fill(0);
      }
    },
    async recoverDraft(actor: string, input: { requestId: string }) {
      check(Id, input.requestId);
      if (Object.keys(input).some((key) => key !== "requestId"))
        throw new Error("CLOSED_INPUT_REQUIRED");
      const record = await root(
        async (scope) =>
          (
            await sql<{
              r: Stored | null;
            }>`select department_master.workspace_recover(${actor},${input.requestId}::uuid) r`.execute(
              scope,
            )
          ).rows[0]!.r,
      );
      return record
        ? {
            id: record.id,
            version: record.version,
            state: record.state,
            recordedAt: record.recordedAt,
            content: unseal(record),
            submission: record.submission,
          }
        : null;
    },
    permissions,
    async listApplications(actor: string, input: DepartmentApplicationList) {
      check(DepartmentApplicationListSchema, input);
      return root(
        async (scope) =>
          (
            await sql<{
              r: { items: DepartmentApplication[]; nextCursor: string | null };
            }>`select department_master.workspace_applications(${actor},${input.after ?? null}::uuid,${input.limit ?? 50},${input.inputId ?? null}::uuid) r`.execute(
              scope,
            )
          ).rows[0]!.r,
      );
    },
    saveDraft: (actor: string, input: SaveDepartmentDraft) =>
      save(actor, input, "EDITING"),
    async readDraft(actor: string, input: { id: string }) {
      check(Id, input.id);
      if (Object.keys(input).some((key) => key !== "id"))
        throw new Error("CLOSED_INPUT_REQUIRED");
      const record = await read(actor, input.id);
      return {
        id: record.id,
        version: record.version,
        state: record.state,
        recordedAt: record.recordedAt,
        content: unseal(record),
        submission: record.submission,
      };
    },
    async listDrafts(actor: string, input: DepartmentDraftList) {
      check(DepartmentDraftListSchema, input);
      return root(
        async (scope) =>
          (
            await sql<{
              r: {
                items: Array<
                  DepartmentDraftSaved & { kind: string; campus: string }
                >;
                nextCursor: string | null;
              };
            }>`select department_master.workspace_list(${actor},${input.after ?? null}::uuid,${input.limit ?? 50}) r`.execute(
              scope,
            )
          ).rows[0]!.r,
      );
    },
    async discardDraft(actor: string, input: DepartmentDraftAction) {
      check(DepartmentDraftActionSchema, input);
      const record = await read(actor, input.id);
      return save(actor, { ...unseal(record), ...input }, "DISCARDED");
    },
    async submitDraft(
      actor: string,
      input: DepartmentDraftAction,
    ): Promise<DepartmentDraftSubmission> {
      check(DepartmentDraftActionSchema, input);
      input = structuredClone(input);
      return root(async (scope) => {
        const record = (
          await sql<{
            r: Stored;
          }>`select department_master.workspace_read(${actor},${input.id}::uuid) r`.execute(
            scope,
          )
        ).rows[0]!.r;
        if (record.submission) {
          if (
            record.submission.requestId !== input.requestId ||
            record.submission.expectedVersion !== input.expectedVersion
          )
            throw new Error("REQUEST_CONFLICT");
          return record.submission;
        }
        if (
          record.state !== "EDITING" ||
          record.version !== input.expectedVersion
        )
          throw new Error("STALE_HEAD");
        const content = unseal(record);
        if (content.profile === "FULL") throw new Error("BLOCKED_DEPENDENCY");
        if (content.kind === "HIERARCHY") {
          if (content.transport) throw new Error("CLOSED_INPUT_REQUIRED");
          if (content.attachment) {
            const bytes = Buffer.from(content.attachment.bytesBase64, "base64");
            try {
              const parsed = await parseHierarchyCoreFile(bytes);
              if (
                !parsed.payload ||
                canonicalPlan(parsed.payload) !== canonicalPlan(content.payload)
              )
                throw new Error("FILE_PAYLOAD_MISMATCH");
            } finally {
              bytes.fill(0);
            }
          }
          const command = {
            ...content.payload,
            requestId: part(input.requestId, "stage"),
            profile: "CORE",
          };
          check(HierarchyCandidateSchema, command);
          const value = command as HierarchyCandidateInput,
            commands = hierarchy.commandsInTransaction(scope);
          if (value.viewId === null) {
            const header = Object.fromEntries(
              Object.keys(CreateHierarchyViewSchema.properties)
                .filter((key) => Object.hasOwn(value, key))
                .map((key) => [key, Reflect.get(value, key)]),
            );
            header["requestId"] = part(input.requestId, "view");
            check(CreateHierarchyViewSchema, header);
            const created = await commands.createHierarchyView(
              actor,
              header as CreateHierarchyViewInput,
            );
            value.viewId = created.viewId;
          }
          const candidate = await commands.importHierarchyCandidate(
            actor,
            value,
          );
          if (candidate.candidateId === null || candidate.decision !== "PASS")
            throw Object.assign(
              new Error(candidate.issues[0]?.code ?? "CLOSED_INPUT_REQUIRED"),
              { field: candidate.issues[0]?.field },
            );
          return link(scope, actor, content, input, {
            kind: "HIERARCHY",
            draftId: input.id,
            requestId: input.requestId,
            expectedVersion: input.expectedVersion,
            viewId: value.viewId,
            candidateId: candidate.candidateId,
            digest: candidate.digest,
            publicationRequestId: value.requestId,
          });
        }
        if (content.kind === "IMPACT") {
          if (content.transport || content.attachment)
            throw new Error("CLOSED_INPUT_REQUIRED");
          const command = {
            ...content.payload,
            campus: content.campus,
            requestId: part(input.requestId, "disposition"),
          };
          check(workspaceStages.IMPACT, command);
          const proposed = await evolution
            .commandsInTransaction(scope)
            .recordDisposition(actor, command as RecordDispositionInput);
          return link(scope, actor, content, input, {
            kind: "IMPACT",
            draftId: input.id,
            requestId: input.requestId,
            expectedVersion: input.expectedVersion,
            digest: planBinding(
              provider,
              "DEPARTMENT_WORKSPACE_IMPACT_V1",
              command,
            ),
            caseId: proposed.caseId,
            proposalEventId: proposed.eventId,
            head: proposed.head,
          });
        }
        if (!content.transport) throw new Error("BLOCKED_DEPENDENCY");
        const jobCommand = {
          action: "CREATE",
          scope: "SYNTHETIC",
          requestId: part(input.requestId, "job"),
          reason: "DEPARTMENT_WORKSPACE",
          ...content.transport,
          profile: "CORE",
          input: {
            kind: "METADATA_ONLY",
            declaredSha256: planBinding(
              provider,
              "DEPARTMENT_WORKSPACE_TRANSPORT_V1",
              input,
            ),
          },
        };
        const job = (
          await sql<{
            r: { id: string; revisionId: string };
          }>`select governance_catalog.import_job_command(${actor},${JSON.stringify(jobCommand)}::jsonb) r`.execute(
            scope,
          )
        ).rows[0]!.r;
        const command = structuredClone({
          ...content.payload,
          requestId: part(input.requestId, "stage"),
          jobId: job.id,
          revisionId: job.revisionId,
          campus: content.campus,
          profile: "CORE",
        });
        if (content.attachment) {
          const bytes = Buffer.from(content.attachment.bytesBase64, "base64");
          try {
            if (
              !bytes.length ||
              bytes.length > 1048576 ||
              bytes.toString("base64") !== content.attachment.bytesBase64
            )
              throw new Error("FILE_SIZE_OR_ENCODING");
            const stored = await protectedArtifacts(
              scope,
              provider,
            ).storeProtectedArtifact(
              actor,
              {
                scope: "SYNTHETIC",
                campus: content.campus,
                purpose: "IDENTITY_VERIFY",
                requestId: part(input.requestId, "evidence"),
                jobId: job.id,
                revisionId: job.revisionId,
                kind: "RAW_FILE",
                retentionSeconds: 86400,
              },
              bytes,
            );
            const fill = (value: unknown, key: string) => {
              if (!value || typeof value !== "object")
                throw new Error("CLOSED_INPUT_REQUIRED");
              if (Reflect.get(value, key))
                throw new Error("EVIDENCE_SELECTION_CONFLICT");
              Reflect.set(value, key, stored.artifactId);
            };
            if (
              content.kind === "DEPARTMENT" ||
              content.kind === "MAPPING" ||
              content.kind === "IDENTIFIER"
            ) {
              const entries = Reflect.get(command, "entries");
              if (!Array.isArray(entries))
                throw new Error("CLOSED_INPUT_REQUIRED");
              for (const entry of entries) fill(entry, "evidenceId");
            } else if (content.kind === "LIFECYCLE") {
              const commands = Reflect.get(command, "commands"),
                impacts = Reflect.get(command, "impacts");
              if (!Array.isArray(commands) || !Array.isArray(impacts))
                throw new Error("CLOSED_INPUT_REQUIRED");
              for (const item of [...commands, ...impacts])
                fill(item, "evidenceId");
            } else {
              fill(command, "decisionEvidenceId");
              const impacts = Reflect.get(command, "impacts");
              if (!Array.isArray(impacts))
                throw new Error("CLOSED_INPUT_REQUIRED");
              for (const item of impacts) fill(item, "evidenceId");
            }
          } finally {
            bytes.fill(0);
          }
        }
        check(workspaceStages[content.kind], command);
        let staged: { inputId: string; revisionId: string; digest: string };
        switch (content.kind) {
          case "DEPARTMENT":
            staged = await department
              .commandsInTransaction(scope)
              .stage(actor, command as StageInput);
            break;
          case "MAPPING":
            staged = await mapping
              .commandsInTransaction(scope)
              .stage(actor, command as OrganizationMappingStageInput);
            break;
          case "IDENTIFIER":
            staged = await identifier
              .commandsInTransaction(scope)
              .stage(actor, command as OrganizationIdentifierStageInput);
            break;
          case "EVOLUTION":
            staged = await evolution
              .commandsInTransaction(scope)
              .stage(actor, command as EvolutionStageInput);
            break;
          case "LIFECYCLE":
            staged = await lifecycle
              .commandsInTransaction(scope)
              .stage(actor, command as DepartmentLifecycleStageInput);
            break;
        }
        const submission: DepartmentDraftSubmission = {
          draftId: input.id,
          requestId: input.requestId,
          expectedVersion: input.expectedVersion,
          kind: content.kind,
          ...staged,
          jobId: job.id,
          jobRevisionId: job.revisionId,
        };
        return link(scope, actor, content, input, submission);
      });
    },
    close: async () => {
      await Promise.all([
        department.close(),
        hierarchy.close(),
        mapping.close(),
        identifier.close(),
        evolution.close(),
        lifecycle.close(),
      ]);
      await db.destroy();
    },
  };
}
