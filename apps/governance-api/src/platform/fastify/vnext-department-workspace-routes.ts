import { Type } from "typebox";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {TypeBoxValidatorCompiler} from '@fastify/type-provider-typebox';
import {
  HierarchyWorkspaceFileSchema,
  HierarchyWorkspaceTemplateSchema,
  type HierarchyWorkspaceFile,
} from "../../modules/department-master/index.js";
import {
  DepartmentApplicationListSchema,
  type DepartmentApplicationList,
} from "../../modules/department-master/index.js";
import {
  DepartmentId as Id,
  SaveDepartmentDraftSchema,
  DepartmentDraftActionSchema,
  DepartmentDraftListSchema,
  DepartmentWorkspacePermissionSchema,
  type DepartmentWorkspacePermission,
  type SaveDepartmentDraft,
  type DepartmentDraftAction,
  type DepartmentDraftList,
  type openDepartmentWorkspace,
} from "../../modules/department-master/index.js";
const closed = { additionalProperties: false } as const,
  Text = Type.String();
const ErrorSchema = Type.Object(
  { code: Text, message: Text, field: Type.Optional(Text) },
  closed,
);
const errors = {
  400: ErrorSchema,
  403: ErrorSchema,
  404: ErrorSchema,
  409: ErrorSchema,
  413: ErrorSchema,
  500: ErrorSchema,
  503: ErrorSchema,
};
const Saved = Type.Object(
  {
    id: Id,
    version: Text,
    state: Type.Enum(["EDITING", "DISCARDED", "SUBMITTED"]),
    recordedAt: Text,
  },
  closed,
);
const Submission = Type.Union([
  Type.Object(
    {
      draftId: Id,
      requestId: Id,
      expectedVersion: Text,
      kind: Type.Enum([
        "DEPARTMENT",
        "MAPPING",
        "IDENTIFIER",
        "EVOLUTION",
        "LIFECYCLE",
      ]),
      inputId: Id,
      revisionId: Id,
      jobId: Id,
      jobRevisionId: Id,
      digest: Text,
    },
    closed,
  ),
  Type.Object(
    {
      draftId: Id,
      requestId: Id,
      expectedVersion: Text,
      kind: Type.Literal("HIERARCHY"),
      viewId: Id,
      candidateId: Id,
      publicationRequestId: Id,
      digest: Text,
    },
    closed,
  ),
  Type.Object(
    {
      draftId: Id,
      requestId: Id,
      expectedVersion: Text,
      kind: Type.Literal("IMPACT"),
      caseId: Id,
      proposalEventId: Id,
      head: Text,
      digest: Text,
    },
    closed,
  ),
]);
const NullableText = Type.Union([Text, Type.Null()]);
const Application = Type.Object(
  {
    kind: Text,
    inputId: Id,
    revisionId: Id,
    inputDigest: Text,
    campus: Type.Enum(["NORTH", "SOUTH"]),
    maker: Text,
    state: Type.Enum(["STAGED", "CANDIDATE", "APPROVED", "COMMITTED"]),
    candidateId: Type.Union([Id, Type.Null()]),
    requestId: Type.Union([Id, Type.Null()]),
    candidateDigest: NullableText,
    approvedBy: NullableText,
    recordedAt: Text,
    access: Type.Object(
      {
        canRead: Type.Boolean(),
        canWrite: Type.Boolean(),
        canReview: Type.Boolean(),
        canVerify: Type.Boolean(),
        canPlan: Type.Boolean(),
        canApply: Type.Boolean(),
      },
      closed,
    ),
  },
  closed,
);
export interface DepartmentWorkspaceHttpContext {
  owner: ReturnType<typeof openDepartmentWorkspace>;
  actor: (request: FastifyRequest) => string;
}
export function registerDepartmentWorkspaceRoutes(
  app: FastifyInstance,
  context?: DepartmentWorkspaceHttpContext,
) {
  const owner = () => {
    if (!context) throw new Error("BLOCKED_DEPENDENCY");
    return context.owner;
  };
  const actor = (request: FastifyRequest) => {
    if (!context) throw new Error("BLOCKED_DEPENDENCY");
    return context.actor(request);
  };
  const base = "/api/vnext/department-workspace";
  const ReadDraft = Type.Object(
    {
      ...Saved.properties,
      content: SaveDepartmentDraftSchema,
      submission: Type.Union([Submission, Type.Null()]),
    },
    closed,
  );
  app.post<{ Body: { campus: "NORTH" | "SOUTH"; profile: "CORE" | "FULL" } }>(
    "/api/vnext/hierarchy/files/template",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "getHierarchyWorkspaceTemplate",
        body: HierarchyWorkspaceTemplateSchema,
        response: {
          200: Type.Object(
            {
              filename: Text,
              bytesBase64: Text,
              profile: Type.Literal("CORE"),
              parserPolicy: Type.Literal("STRICT_HIERARCHY_CORE_V1"),
            },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) => owner().hierarchyFileTemplate(actor(request), request.body),
  );
  app.post<{ Body: HierarchyWorkspaceFile }>(
    "/api/vnext/hierarchy/files",
    {
      bodyLimit: 2000000,
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "receiveHierarchyWorkspaceFile",
        body: HierarchyWorkspaceFileSchema,
        response: {
          200: Type.Object(
            {
              structuralStatus: Type.Enum(["PARSED", "REJECTED"]),
              issues: Type.Array(
                Type.Object(
                  {
                    sheet: Type.Optional(Text),
                    row: Type.Integer(),
                    column: Type.Integer(),
                    code: Text,
                  },
                  closed,
                ),
              ),
              draft: Type.Union([Saved, Type.Null()]),
            },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) => owner().receiveHierarchyFile(actor(request), request.body),
  );
  app.post<{ Body: { requestId: string } }>(
    base + "/drafts/recover",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "recoverDepartmentDraft",
        body: Type.Object({ requestId: Id }, closed),
        response: { 200: Type.Union([ReadDraft, Type.Null()]), ...errors },
      },
    },
    (request) => owner().recoverDraft(actor(request), request.body),
  );
  app.post<{ Body: DepartmentWorkspacePermission }>(
    base + "/permissions",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "departmentWorkspacePermissions",
        body: DepartmentWorkspacePermissionSchema,
        response: {
          200: Type.Object(
            { canRead: Type.Boolean(), canSave: Type.Boolean() },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) => owner().permissions(actor(request), request.body),
  );
  app.post<{ Body: DepartmentApplicationList }>(
    base + "/applications/list",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "listDepartmentApplications",
        body: DepartmentApplicationListSchema,
        response: {
          200: Type.Object(
            {
              items: Type.Array(Application),
              nextCursor: Type.Union([Id, Type.Null()]),
            },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) => owner().listApplications(actor(request), request.body),
  );
  app.post<{ Body: SaveDepartmentDraft }>(
    base + "/drafts/save",
    {
      bodyLimit: 2000000,
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "saveDepartmentDraft",
        body: SaveDepartmentDraftSchema,
        response: { 200: Saved, ...errors },
      },
    },
    (request) => owner().saveDraft(actor(request), request.body),
  );
  app.post<{ Body: { id: string } }>(
    base + "/drafts/read",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "readDepartmentDraft",
        body: Type.Object({ id: Id }, closed),
        response: { 200: ReadDraft, ...errors },
      },
    },
    (request) => owner().readDraft(actor(request), request.body),
  );
  app.post<{ Body: DepartmentDraftList }>(
    base + "/drafts/list",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "listDepartmentDrafts",
        body: DepartmentDraftListSchema,
        response: {
          200: Type.Object(
            {
              items: Type.Array(
                Type.Object(
                  { ...Saved.properties, kind: Text, campus: Text },
                  closed,
                ),
              ),
              nextCursor: Type.Union([Id, Type.Null()]),
            },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) => owner().listDrafts(actor(request), request.body),
  );
  app.post<{ Body: DepartmentDraftAction }>(
    base + "/drafts/discard",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "discardDepartmentDraft",
        body: DepartmentDraftActionSchema,
        response: { 200: Saved, ...errors },
      },
    },
    (request) => owner().discardDraft(actor(request), request.body),
  );
  app.post<{ Body: DepartmentDraftAction }>(
    base + "/drafts/submit",
    {
      validatorCompiler:TypeBoxValidatorCompiler,
      schema: {
        operationId: "submitDepartmentDraft",
        body: DepartmentDraftActionSchema,
        response: { 200: Submission, ...errors },
      },
    },
    (request) => owner().submitDraft(actor(request), request.body),
  );
}
