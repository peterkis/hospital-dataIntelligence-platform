import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import { sql, type Kysely } from "kysely";
import type { DB } from "../../platform/database/vnext-types.generated.js";
import { ImportJobReadSchema } from "./import-job.js";
const Id = Type.String({ format: "uuid" });
const text = Type.String();
const closed = { additionalProperties: false } as const;
export const WorkbenchAccessInputSchema = Type.Object(
  {
    scope: Type.Literal("SYNTHETIC"),
    contractVersionId: Id,
    campus: Type.Enum(["NORTH", "SOUTH"]),
    purpose: Type.Enum(["IDENTITY_VERIFY", "CONTACT_VERIFY", "HR_RESTRICTED"]),
  },
  closed,
);
export const WorkbenchAccessSchema = Type.Object(
  {
    canReceive: Type.Boolean(),
    canReadProtected: Type.Boolean(),
    canWriteContract: Type.Boolean(),
  },
  closed,
);
export const WorkbenchSummarySchema = Type.Object(
  {
    jobId: Id,
    revisionId: Id,
    status: text,
    contractId: Id,
    contractVersionId: Id,
    templateVersion: text,
    canWrite: Type.Boolean(),
    artifacts: Type.Array(
      Type.Object(
        {
          artifactId: Id,
          revisionId: Id,
          kind: text,
          campus: text,
          purpose: text,
          status: text,
          structuralStatus: Type.Union([text, Type.Null()]),
        },
        closed,
      ),
    ),
    runs: Type.Array(
      Type.Object(
        {
          runId: Id,
          revisionId: Id,
          decision: text,
          issueCount: Type.Integer(),
        },
        closed,
      ),
    ),
    candidates: Type.Array(
      Type.Object(
        {
          candidateId: Id,
          revisionId: Id,
          requestId: Id,
          approved: Type.Boolean(),
          committed: Type.Boolean(),
        },
        closed,
      ),
    ),
  },
  closed,
);
export type WorkbenchSummary = Static<typeof WorkbenchSummarySchema>;
export function workbench(db: Kysely<DB>) {
  return {
    async workbenchFileAccess(
      actor: string,
      input: Static<typeof WorkbenchAccessInputSchema>,
    ): Promise<Static<typeof WorkbenchAccessSchema>> {
      if (!Check(WorkbenchAccessInputSchema, input))
        throw new Error("CLOSED_INPUT_REQUIRED");
      return (
        await sql<{
          result: Static<typeof WorkbenchAccessSchema>;
        }>`select governance_catalog.import_workbench_file_access(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(
          db,
        )
      ).rows[0]!.result;
    },
    async workbenchSummary(
      actor: string,
      input: Static<typeof ImportJobReadSchema>,
    ): Promise<WorkbenchSummary> {
      if (!Check(ImportJobReadSchema, input))
        throw new Error("CLOSED_INPUT_REQUIRED");
      return (
        await sql<{
          result: WorkbenchSummary;
        }>`select governance_catalog.import_workbench_summary(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(
          db,
        )
      ).rows[0]!.result;
    },
  };
}
