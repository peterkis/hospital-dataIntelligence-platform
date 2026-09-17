import { Type, type Static } from "typebox";
import type { FastifyInstance } from "fastify";
import type { Catalog } from "../../modules/governance-catalog/index.js";
import {
  ReceiveFileSchema,
  ProposeCorrectionSchema,
  AssignIssueSchema,
  ResolveWithEvidenceSchema,
  ApproveApplyUnitSchema,
  ApplyUnitSchema,
  PlanOwnerUnitSchema,
  CompareValidationSchema,
  QualityIssueDetailSchema,
} from "../../modules/governance-catalog/index.js";
import {
  WorkbenchSummarySchema,
  WorkbenchAccessSchema,
  WorkbenchAccessInputSchema,
  textWorkbook,
} from "../../modules/governance-catalog/index.js";
import { actor } from "./vnext-catalog-routes.js";
const closed = { additionalProperties: false } as const;
const Id = Type.String({ format: "uuid" });
const Text = Type.String();
const Bytes = Type.String({
  maxLength: 1398104,
  pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
});
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
  422: ErrorSchema,
  500: ErrorSchema,
  503: ErrorSchema,
};
const Issue = Type.Object(
  {
    id: Id,
    runId: Id,
    revisionId: Id,
    row: Type.Integer(),
    field: Type.Union([Text, Type.Null()]),
    code: Text,
    status: Text,
    classification: Text,
  },
  closed,
);
const Result = Type.Object(
  {
    status: Text,
    responseStatus: Type.Optional(
      Type.Enum(["DELIVERED", "POST_COMMIT_FAILED"]),
    ),
    jobId: Type.Optional(Id),
    candidateId: Type.Optional(Id),
    requestId: Type.Optional(Id),
    runId: Type.Optional(Id),
    resultArtifactId: Type.Optional(Id),
    digest: Type.Optional(Text),
    head: Type.Optional(Text),
    text: Type.Optional(Type.String({ maxLength: 1048576 })),
    download: Type.Optional(Bytes),
    filename: Type.Optional(Text),
    issues: Type.Optional(Type.Array(Issue)),
    total: Type.Optional(Type.Integer()),
  },
  closed,
);
const ReceivedResult = Type.Object(
  { status: Type.Literal("QUARANTINED"), jobId: Id },
  closed,
);
const PlanResult = Type.Object(
  {
    status: Type.Literal("FROZEN"),
    candidateId: Id,
    requestId: Id,
    digest: Text,
  },
  closed,
);
const ReviewResult = Type.Object(
  {
    status: Type.Literal("READ_READY"),
    candidateId: Id,
    digest: Text,
    text: Type.String({ maxLength: 1048576 }),
  },
  closed,
);
const ApprovedResult = Type.Object(
  { status: Type.Literal("APPROVED"), candidateId: Id },
  closed,
);
const TemplateResult = Type.Object(
  {
    status: Type.Literal("EXACT_TEMPLATE"),
    download: Bytes,
    filename: Text,
    text: Text,
    dataset: Text,
    profile: Type.Enum(["CORE", "FULL"]),
    contractVersionId: Id,
    templateVersion: Text,
    parserPolicy: Type.Literal("STRICT_V2"),
  },
  closed,
);
const Dimensions = {
  scope: Type.Literal("SYNTHETIC"),
  campus: Type.Enum(["NORTH", "SOUTH"]),
  purpose: Type.Enum(["IDENTITY_VERIFY", "CONTACT_VERIFY", "HR_RESTRICTED"]),
};
const Action = Type.Object(
  {
    ...Dimensions,
    jobId: Id,
    revisionId: Id,
    action: Type.Enum([
      "PARSE",
      "VALIDATE",
      "ISSUES",
      "EXPLAIN",
      "ERROR_WORKBOOK",
      "PREVIEW",
    ]),
    requestId: Id,
    outputRequestId: Id,
    issueRequestId: Id,
    offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100000 })),
  },
  closed,
);
const Upload = Type.Object(
  {
    input: ReceiveFileSchema,
    bytes: Bytes,
    templateVersion: Text,
    contractVersionId: Id,
  },
  closed,
);
const Correction = Type.Object(
  {
    input: ProposeCorrectionSchema,
    bytes: Bytes,
    contractVersionId: Id,
    templateVersion: Text,
  },
  closed,
);
const Template = Type.Object(
  { contractId: Id, versionId: Id, format: Type.Enum(["CSV", "JSON", "XLSX"]) },
  closed,
);
const Candidate = Type.Object({ candidateId: Id }, closed);
function decode(text: string) {
  const bytes = Buffer.from(text, "base64");
  if (
    bytes.length < 1 ||
    bytes.length > 1048576 ||
    bytes.toString("base64") !== text
  )
    throw new Error("FILE_SIZE_OR_ENCODING");
  return bytes;
}
export async function registerWorkbenchRoutes(
  app: FastifyInstance,
  catalog?: Catalog,
  mode: "CONTROL_PLANE" | "FINITE_E2E" = "CONTROL_PLANE",
) {
  const owner = () => {
    if (!catalog) throw new Error("CATALOG_RUNTIME_REQUIRED");
    return catalog;
  };
  app.post<{ Body: Static<typeof WorkbenchAccessInputSchema> }>(
    "/api/vnext/workbench/file-access",
    {
      schema: {
        operationId: "readImportFileAccess",
        body: WorkbenchAccessInputSchema,
        response: { 200: WorkbenchAccessSchema, ...errors },
      },
    },
    (request) =>
      owner().workbenchFileAccess(actor(request.headers), request.body),
  );
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/vnext/workbench"))
      reply.header("cache-control", "no-store");
    return payload;
  });
  app.get(
    "/api/vnext/workbench/capabilities",
    {
      schema: {
        operationId: "importWorkbenchCapabilities",
        response: {
          200: Type.Object(
            {
              mode: Type.Enum(["CONTROL_PLANE", "FINITE_E2E"]),
              orgPer: Type.Literal("NOT_READY"),
              rawByteLimit: Type.Literal(1048576),
            },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) => {
      actor(request.headers);
      return {
        mode,
        orgPer: "NOT_READY" as const,
        rawByteLimit: 1048576 as const,
      };
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/vnext/workbench/jobs/:id",
    {
      schema: {
        operationId: "readWorkbenchJob",
        params: Type.Object({ id: Id }, closed),
        response: { 200: WorkbenchSummarySchema, ...errors },
      },
    },
    (request) =>
      owner().workbenchSummary(actor(request.headers), {
        scope: "SYNTHETIC",
        jobId: request.params.id,
      }),
  );
  app.post<{ Body: Static<typeof Template> }>(
    "/api/vnext/workbench/template",
    {
      schema: {
        operationId: "downloadImportTemplate",
        body: Template,
        response: { 200: TemplateResult, ...errors },
      },
    },
    async (request) => {
      const input = request.body;
      const c = (
        await owner().contractRead(actor(request.headers), {
          scope: "SYNTHETIC",
          mode: "HISTORY",
          target: input.contractId,
          versionId: input.versionId,
        })
      ).findLast(
        (item) =>
          item.versionId === input.versionId && item.status === "PUBLISHED",
      );
      if (!c || c.versionId !== input.versionId || c.status !== "PUBLISHED")
        throw new Error("EXACT_CONTRACT_UNAVAILABLE");
      const fields = c.definition.fields.map((f) => f.code);
      const bytes =
        input.format === "XLSX"
          ? textWorkbook([fields])
          : Buffer.from(
              input.format === "JSON"
                ? JSON.stringify(
                    [Object.fromEntries(fields.map((f) => [f, ""]))],
                    null,
                    2,
                  )
                : fields.join(",") + "\r\n",
            );
      return {
        status: "EXACT_TEMPLATE",
        filename: `${c.dataset}-${c.profile}-${c.versionId}.${input.format.toLowerCase()}`,
        download: bytes.toString("base64"),
        text: JSON.stringify({
          dataset: c.dataset,
          profile: c.profile,
          contractVersionId: c.versionId,
          templateVersion: c.definition.templateVersion,
          parserPolicy: "STRICT_V2",
          xlsxSupport: "TEXT_SUBSET_ONLY_NO_OFFICE_ROUNDTRIP_CLAIM",
        }),
        dataset: c.dataset,
        profile: c.profile,
        contractVersionId: c.versionId,
        templateVersion: c.definition.templateVersion,
        parserPolicy: "STRICT_V2" as const,
      };
    },
  );
  app.post<{ Body: Static<typeof Upload> }>(
    "/api/vnext/workbench/upload",
    {
      bodyLimit: 1450000,
      schema: {
        operationId: "uploadImportFile",
        body: Upload,
        response: { 200: ReceivedResult, ...errors },
      },
    },
    async (request) => {
      const { input, bytes, templateVersion, contractVersionId } = request.body;
      const a = actor(request.headers);
      const c =
        input.job.action === "CREATE"
          ? (
              await owner().contractRead(a, {
                scope: "SYNTHETIC",
                mode: "HISTORY",
                target: input.job.contractId,
                versionId: input.job.contractVersionId,
              })
            )[0]
          : (
              await owner().importJobRead(a, {
                scope: "SYNTHETIC",
                jobId: input.job.jobId,
              })
            ).contract;
      if (
        !c ||
        c.versionId !== contractVersionId ||
        c.definition.templateVersion !== templateVersion ||
        input.job.input.kind !== "FILE" ||
        input.job.input.parserPolicy !== "STRICT_V2"
      )
        throw new Error("TEMPLATE_VERSION_MISMATCH");
      const raw = decode(bytes);
      try {
        const result = await owner().receiveFile(a, input, raw);
        return { status: "QUARANTINED", jobId: result.job.id };
      } finally {
        raw.fill(0);
      }
    },
  );
  app.post<{ Body: Static<typeof Action> }>(
    "/api/vnext/workbench/action",
    {
      schema: {
        operationId: "importWorkbenchAction",
        body: Action,
        response: { 200: Result, ...errors },
      },
    },
    async (request) => {
      const input = request.body,
        a = actor(request.headers),
        o = owner();
      const s = await o.workbenchSummary(a, {
        scope: "SYNTHETIC",
        jobId: input.jobId,
      });
      if (s.revisionId !== input.revisionId) throw new Error("STALE_REVISION");
      const dimensions = {
        scope: input.scope,
        campus: input.campus,
        purpose: input.purpose,
      };
      const artifact = s.artifacts
        .filter(
          (x) =>
            x.revisionId === input.revisionId &&
            x.campus === input.campus &&
            x.purpose === input.purpose &&
            x.kind === (input.action === "PARSE" ? "RAW_FILE" : "RAW_CELL"),
        )
        .at(-1);
      const run = s.runs
        .filter((x) => x.revisionId === input.revisionId)
        .at(-1);
      if (input.action === "ISSUES") {
        const page = await o.qualityIssueRead(a, {
          ...dimensions,
          jobId: input.jobId,
          offset: input.offset ?? 0,
          pageSize: 20,
        });
        return {
          status: "QUALITY_ITEMS",
          total: page.total,
          issues: page.items.map((i) => ({
            id: i.id,
            runId: i.runId,
            revisionId: i.revisionId,
            row: i.row,
            field: i.field,
            code: i.boundedCode,
            status: i.status,
            classification: i.classification,
          })),
        };
      }
      if (["EXPLAIN", "PREVIEW"].includes(input.action)) {
        if (!run) throw new Error("VALIDATION_REQUIRED");
        if (input.action === "EXPLAIN")
          return {
            status: "RESTRICTED_EXPLANATION",
            text: JSON.stringify(
              await o.explainIssue(a, { ...dimensions, runId: run.runId }),
            ),
          };
        if (mode === "FINITE_E2E")
          return {
            status: "FINITE_PREVIEW",
            text: JSON.stringify(
              await o.previewOwnerUnit(a, {
                ...dimensions,
                jobId: input.jobId,
                revisionId: input.revisionId,
                requestId: input.requestId,
              }),
            ),
          };
        const preview = await o.previewFileCreates(a, {
          ...dimensions,
          jobId: input.jobId,
          revisionId: input.revisionId,
          runId: run.runId,
        });
        return { status: "BLOCKED", text: JSON.stringify(preview) };
      }
      if (!artifact) throw new Error("FILE_OR_PARSE_REQUIRED");
      const p = {
        ...dimensions,
        jobId: input.jobId,
        revisionId: input.revisionId,
        artifactId: artifact.artifactId,
        requestId: input.requestId,
        outputRequestId: input.outputRequestId,
        retentionSeconds: 3600,
      };
      if (input.action === "PARSE") {
        const result = await o.parseFile(a, p);
        return { status: result.structuralStatus, requestId: input.requestId };
      }
      if (input.action === "VALIDATE") {
        const result = await o.validateRevision(a, p);
        await o.openIssue(a, {
          ...dimensions,
          runId: result.runId,
          requestId: input.issueRequestId,
          reason: "WORKBENCH_VALIDATION",
        });
        return {
          status: result.decision,
          requestId: input.requestId,
          runId: result.runId,
          resultArtifactId: result.resultArtifactId,
          text: JSON.stringify({
            decision: result.decision,
            issueCount: result.issueCount,
            adapterReadiness: result.adapterReadiness,
            securityScan: result.securityScan,
          }),
        };
      }
      const report = await o.exportIssueWorkbook(a, p);
      const raw = await o.authorizeSensitiveRead(a, {
        ...dimensions,
        artifactId: report.artifactId,
        requestId: input.issueRequestId,
      });
      try {
        return {
          status: "RESTRICTED_REPORT",
          requestId: input.requestId,
          filename: "import-errors.xlsx",
          download: Buffer.from(raw).toString("base64"),
        };
      } finally {
        raw.fill(0);
      }
    },
  );
  app.post<{ Body: Static<typeof Correction> }>(
    "/api/vnext/workbench/correction",
    {
      bodyLimit: 1450000,
      schema: {
        operationId: "correctImportFile",
        body: Correction,
        response: { 200: ReceivedResult, ...errors },
      },
    },
    async (request) => {
      const c = (
        await owner().importJobRead(actor(request.headers), {
          scope: "SYNTHETIC",
          jobId: request.body.input.jobId,
        })
      ).contract;
      if (
        c.versionId !== request.body.contractVersionId ||
        c.definition.templateVersion !== request.body.templateVersion ||
        request.body.input.parserPolicy !== "STRICT_V2"
      )
        throw new Error("TEMPLATE_VERSION_MISMATCH");
      const raw = decode(request.body.bytes);
      try {
        const result = await owner().proposeCorrection(
          actor(request.headers),
          request.body.input,
          raw,
        );
        return { status: "QUARANTINED", jobId: result.jobId };
      } finally {
        raw.fill(0);
      }
    },
  );
  app.post<{ Body: Static<typeof AssignIssueSchema> }>(
    "/api/vnext/workbench/assign",
    {
      schema: {
        operationId: "assignImportIssue",
        body: AssignIssueSchema,
        response: { 200: Result, ...errors },
      },
    },
    async (request) => ({
      status: "ASSIGNED",
      text: JSON.stringify(
        await owner().assignIssue(actor(request.headers), request.body),
      ),
    }),
  );
  app.post<{ Body: Static<typeof ResolveWithEvidenceSchema> }>(
    "/api/vnext/workbench/resolve",
    {
      schema: {
        operationId: "resolveImportIssue",
        body: ResolveWithEvidenceSchema,
        response: { 200: Result, ...errors },
      },
    },
    async (request) => ({
      status: "RESOLVED",
      text: JSON.stringify(
        await owner().resolveWithEvidence(actor(request.headers), request.body),
      ),
    }),
  );
  app.post<{ Body: Static<typeof CompareValidationSchema> }>(
    "/api/vnext/workbench/compare",
    {
      schema: {
        operationId: "compareImportValidation",
        body: CompareValidationSchema,
        response: { 200: Result, ...errors },
      },
    },
    async (request) => ({
      status: "VALIDATION_COMPARISON",
      text: JSON.stringify(
        await owner().compareValidationRuns(
          actor(request.headers),
          request.body,
        ),
      ),
    }),
  );
  app.post<{ Body: Static<typeof QualityIssueDetailSchema> }>(
    "/api/vnext/workbench/issue",
    {
      schema: {
        operationId: "readImportIssue",
        body: QualityIssueDetailSchema,
        response: { 200: Result, ...errors },
      },
    },
    async (request) => {
      const detail = await owner().qualityIssueDetail(
        actor(request.headers),
        request.body,
      );
      return {
        status: detail.evidenceStatus,
        head: detail.history.at(-1)?.head ?? "0",
        text: JSON.stringify(detail),
      };
    },
  );
  app.post<{ Body: Static<typeof PlanOwnerUnitSchema> }>(
    "/api/vnext/workbench/plan",
    {
      schema: {
        operationId: "planImportApply",
        body: PlanOwnerUnitSchema,
        response: { 200: PlanResult, ...errors },
      },
    },
    async (request) => ({
      status: "FROZEN",
      ...(await owner().planOwnerUnit(actor(request.headers), request.body)),
      requestId: request.body.requestId,
    }),
  );
  app.post<{ Body: Static<typeof Candidate> }>(
    "/api/vnext/workbench/candidate-access",
    {
      schema: {
        operationId: "readImportCandidateAccess",
        body: Candidate,
        response: {
          200: Type.Object(
            {
              candidateId: Id,
              canReview: Type.Boolean(),
              canExecute: Type.Boolean(),
            },
            closed,
          ),
          ...errors,
        },
      },
    },
    (request) =>
      owner().readApplyCandidateAccess(actor(request.headers), request.body),
  );
  app.post<{ Body: Static<typeof Candidate> }>(
    "/api/vnext/workbench/review",
    {
      schema: {
        operationId: "readImportCandidate",
        body: Candidate,
        response: { 200: ReviewResult, ...errors },
      },
    },
    async (request) => {
      const r = await owner().readApplyCandidate(
        actor(request.headers),
        request.body,
      );
      return {
        status: "READ_READY",
        candidateId: r.candidateId,
        digest: r.digest,
        text: JSON.stringify(r.unit),
      };
    },
  );
  app.post<{ Body: Static<typeof ApproveApplyUnitSchema> }>(
    "/api/vnext/workbench/approve",
    {
      schema: {
        operationId: "approveImportCandidate",
        body: ApproveApplyUnitSchema,
        response: { 200: ApprovedResult, ...errors },
      },
    },
    async (request) => ({
      status: "APPROVED",
      ...(await owner().approveApplyUnit(actor(request.headers), request.body)),
    }),
  );
  for (const action of ["apply", "resume", "reconcile"] as const)
    app.post<{ Body: Static<typeof ApplyUnitSchema> }>(
      `/api/vnext/workbench/${action}`,
      {
        schema: {
          operationId: action + "ImportOutcome",
          body: ApplyUnitSchema,
          response: { 200: Result, ...errors },
        },
      },
      async (request) => {
        const o = owner(),
          a = actor(request.headers);
        const r =
          action === "apply"
            ? await o.applyUnit(a, request.body)
            : action === "resume"
              ? await o.resumeOutcome(a, request.body)
              : await o.reconcileCommittedUnit(a, request.body);
        return {
          status: r?.status ?? "NOT_COMMITTED",
          ...(r && "responseStatus" in r
            ? { responseStatus: r.responseStatus }
            : {}),
          text: JSON.stringify(r),
          ...request.body,
        };
      },
    );
}
