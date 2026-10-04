import { Type, type Static, type TSchema } from "typebox";
import { StageSchema, Id } from "./contracts.js";
import { HierarchyCandidateSchema } from "./hierarchy.js";
import { OrganizationMappingStageSchema } from "./organization-mapping-contracts.js";
import { OrganizationIdentifierStageSchema } from "./organization-identifier-contracts.js";
import { EvolutionStageSchema } from "./organization-evolution-contracts.js";
import { DepartmentLifecycleStageSchema } from "./department-lifecycle-contracts.js";
import { RecordDispositionSchema } from "./department-impact-contracts.js";
import { partialEditingSchema } from "./editing-schema.js";

const closed = { additionalProperties: false } as const;
export const workspaceStages = {
  DEPARTMENT: StageSchema,
  HIERARCHY: HierarchyCandidateSchema,
  MAPPING: OrganizationMappingStageSchema,
  IDENTIFIER: OrganizationIdentifierStageSchema,
  EVOLUTION: EvolutionStageSchema,
  LIFECYCLE: DepartmentLifecycleStageSchema,
  IMPACT: RecordDispositionSchema,
} as const;
export type DepartmentDraftKind = keyof typeof workspaceStages;
// Partial editing relaxes presence, never the vocabulary or field types.
type SchemaNode = TSchema & {
  properties?: Record<string, TSchema>;
  required?: string[];
  items?: TSchema;
  minItems?: number;
  anyOf?: TSchema[];
};
const controlKeys = new Set([
  "requestId",
  "jobId",
  "revisionId",
  "campus",
  "profile",
]);
const branches = Object.entries(workspaceStages).map(([kind, schema]) => {
  const payload = structuredClone(schema) as SchemaNode;
  payload.properties = Object.fromEntries(
    Object.entries(payload.properties!).filter(
      ([key]) => !controlKeys.has(key),
    ),
  );
  payload.required = payload.required!.filter((key) => !controlKeys.has(key));
  return Type.Object(
    {
      kind: Type.Literal(kind),
      campus: Type.Enum(["NORTH", "SOUTH"]),
      profile: Type.Optional(Type.Enum(["CORE", "FULL"])),
      transport: Type.Optional(
        Type.Object({ contractId: Id, contractVersionId: Id }, closed),
      ),
      attachment: Type.Optional(
        Type.Object(
          {
            filename: Type.String({ minLength: 1, maxLength: 256 }),
            bytesBase64: Type.String({
              minLength: 4,
              maxLength: 1398104,
              pattern:
                "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
            }),
          },
          closed,
        ),
      ),
      payload: partialEditingSchema(payload),
    },
    closed,
  );
});
export const DepartmentWorkspaceContentSchema = Type.Union(branches);
export interface DepartmentWorkspaceContent {
  kind: DepartmentDraftKind;
  campus: "NORTH" | "SOUTH";
  profile?: "CORE" | "FULL";
  transport?: { contractId: string; contractVersionId: string };
  attachment?: { filename: string; bytesBase64: string };
  payload: Record<string, unknown>;
}
export const SaveDepartmentDraftSchema = Type.Union(
  branches.map((branch) =>
    Type.Object(
      {
        ...branch.properties,
        requestId: Id,
        id: Type.Optional(Id),
        expectedVersion: Type.Optional(
          Type.String({ pattern: "^[1-9][0-9]*$" }),
        ),
      },
      closed,
    ),
  ),
);
export interface SaveDepartmentDraft extends DepartmentWorkspaceContent {
  requestId: string;
  id?: string;
  expectedVersion?: string;
}
export const DepartmentDraftActionSchema = Type.Object(
  {
    id: Id,
    expectedVersion: Type.String({ pattern: "^[1-9][0-9]*$" }),
    requestId: Id,
  },
  closed,
);
export type DepartmentDraftAction = Static<typeof DepartmentDraftActionSchema>;
export const DepartmentDraftListSchema = Type.Object(
  {
    after: Type.Optional(Id),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  closed,
);
export type DepartmentDraftList = Static<typeof DepartmentDraftListSchema>;
export const DepartmentApplicationListSchema = Type.Object(
  { ...DepartmentDraftListSchema.properties, inputId: Type.Optional(Id) },
  closed,
);
export type DepartmentApplicationList = Static<
  typeof DepartmentApplicationListSchema
>;
export const DepartmentWorkspacePermissionSchema = Type.Object(
  {
    kind: Type.Enum(Object.keys(workspaceStages) as DepartmentDraftKind[]),
    campus: Type.Enum(["NORTH", "SOUTH"]),
  },
  closed,
);
export type DepartmentWorkspacePermission = Static<
  typeof DepartmentWorkspacePermissionSchema
>;
export interface DepartmentDraftSaved {
  id: string;
  version: string;
  state: "EDITING" | "DISCARDED" | "SUBMITTED";
  recordedAt: string;
}
interface SubmissionBase {
  draftId: string;
  requestId: string;
  expectedVersion: string;
  digest: string;
}
export interface DepartmentJobSubmission extends SubmissionBase {
  kind: "DEPARTMENT" | "MAPPING" | "IDENTIFIER" | "EVOLUTION" | "LIFECYCLE";
  inputId: string;
  revisionId: string;
  jobId: string;
  jobRevisionId: string;
}
export interface DepartmentHierarchySubmission extends SubmissionBase {
  kind: "HIERARCHY";
  viewId: string;
  candidateId: string;
  publicationRequestId: string;
}
export interface DepartmentImpactSubmission extends SubmissionBase {
  kind: "IMPACT";
  caseId: string;
  proposalEventId: string;
  head: string;
}
export type DepartmentDraftSubmission =
  | DepartmentJobSubmission
  | DepartmentHierarchySubmission
  | DepartmentImpactSubmission;
export interface DepartmentApplication {
  kind: DepartmentDraftKind;
  inputId: string;
  revisionId: string;
  inputDigest: string;
  campus: "NORTH" | "SOUTH";
  maker: string;
  state: "STAGED" | "CANDIDATE" | "APPROVED" | "COMMITTED";
  candidateId: string | null;
  requestId: string | null;
  candidateDigest: string | null;
  approvedBy: string | null;
  recordedAt: string;
  access: {
    canRead: boolean;
    canWrite: boolean;
    canReview: boolean;
    canVerify: boolean;
    canPlan: boolean;
    canApply: boolean;
  };
}
