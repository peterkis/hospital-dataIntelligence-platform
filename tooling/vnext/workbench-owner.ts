import { sql } from "kysely";
import type {
  ApplyOwnerPort,
  ObservedOwnerUnit,
  OwnerFact,
} from "../../apps/governance-api/src/modules/governance-catalog/apply-coordinator.js";
import type { KeyProviderPort } from "../../apps/governance-api/src/modules/governance-catalog/protected-artifact.js";
import { createValidationEvidenceReader } from "../../apps/governance-api/src/modules/governance-catalog/validation.js";
import { workbench } from "../../apps/governance-api/src/modules/governance-catalog/workbench.js";
import type { CatalogTransactionScope } from "../../apps/governance-api/src/modules/governance-catalog/transaction-scope.js";

/** Explicit finite test authority: one approved synthetic contract, maker-owned files only.
 * Reviewer consumes those inputs through this registered service, not impersonation at HTTP.
 * Original ORG/PER BLOCKED runs and domain issues are never rewritten or used as ORG/PER PASS.
 */
export function fileOwner(
  provider: KeyProviderPort,
  contractVersionId: string,
): ApplyOwnerPort {
  const reader = createValidationEvidenceReader(provider);
  const summary = async (scope: CatalogTransactionScope, jobId: string) =>
    (
      await sql<{
        result: Awaited<
          ReturnType<ReturnType<typeof workbench>["workbenchSummary"]>
        >;
      }>`select governance_catalog.import_workbench_summary('maker',${JSON.stringify({ scope: "SYNTHETIC", jobId })}::jsonb) as result`.execute(
        scope,
      )
    ).rows[0]!.result;
  const owner: ApplyOwnerPort = {
    async authorize(scope, actor, input, permission) {
      if (
        !["maker", "maker-alias", "reviewer"].includes(actor) ||
        input.scope !== "SYNTHETIC" ||
        input.campus !== "NORTH" ||
        input.purpose !== "IDENTITY_VERIFY"
      )
        throw new Error("ACCESS_DENIED");
      await sql`select vnext_control.authorize(${actor},'SYNTHETIC',${permission})`.execute(
        scope,
      );
      await sql`select governance_catalog.contract_require_access(${actor},'SYNTHETIC',${contractVersionId}::uuid,${permission})`.execute(
        scope,
      );
      if (permission === "WRITE")
        await sql`select governance_catalog.import_job_read(${actor},${JSON.stringify({ scope: "SYNTHETIC", jobId: input.jobId })}::jsonb)`.execute(
          scope,
        );
      if (permission === "REVIEW" || permission === "WRITE") {
        const access = (
          await sql<{
            result: { canReadProtected: boolean };
          }>`select governance_catalog.import_workbench_file_access(${actor},${JSON.stringify({ scope: "SYNTHETIC", contractVersionId, campus: input.campus, purpose: input.purpose })}::jsonb) as result`.execute(
            scope,
          )
        ).rows[0]!.result;
        if (!access.canReadProtected) throw new Error("ACCESS_DENIED");
      }
      const s = await summary(scope, input.jobId);
      if (s.contractVersionId !== contractVersionId)
        throw new Error("BLOCKED_DEPENDENCY");
    },
    async observe(scope, actor, input): Promise<ObservedOwnerUnit> {
      await owner.authorize(scope, actor, input, "READ");
      await sql`select p0_09_owner.read_source(${actor},${JSON.stringify(input)}::jsonb,${contractVersionId}::uuid)`.execute(
        scope,
      );
      const s = await summary(scope, input.jobId);
      if (s.revisionId !== input.revisionId)
        throw new Error("STALE_VALIDATION");
      const run = s.runs
        .filter((r) => r.revisionId === input.revisionId)
        .at(-1);
      if (!run) throw new Error("BLOCKED_DEPENDENCY");
      const evidence = await reader.readInTransaction(
        scope,
        "maker",
        {
          scope: input.scope,
          campus: input.campus,
          purpose: input.purpose,
          runId: run.runId,
        },
        run.runId,
        true,
      );
      const rows = evidence.parsed?.rows;
      const duplicates = new Set(
        (evidence.evaluation.duplicates ?? []).map((row) => row.row),
      );
      // Finite scope only: actual structural/field checks and every declared rule must pass.
      // Missing real ORG/PER layers remain BLOCKED and do not become finite target rules.
      if (
        !rows?.length ||
        rows.length > 100 ||
        evidence.evaluation.issues.some((i) => i.status !== "PASS") ||
        evidence.evaluation.evidenceRequirements.length ||
        evidence.evaluation.dependencies.length ||
        !evidence.evaluation.executionCoverage ||
        evidence.evaluation.executionCoverage.checks.some(
          (c) =>
            c.layer < 8 &&
            c.status !== "PASS" &&
            !(
              c.status === "NOT_EVALUATED" &&
              c.code === "DUPLICATE_EXACT_ROW" &&
              c.rows.every((row) => duplicates.has(row))
            ),
        ) ||
        evidence.job.contract.versionId !== contractVersionId
      )
        throw new Error("BLOCKED_DEPENDENCY");
      const current = (
        await sql<{
          result: Array<{ versionId: string; status: string }>;
        }>`select governance_catalog.contract_read('maker',${JSON.stringify({ scope: "SYNTHETIC", mode: "CURRENT", target: evidence.job.contract.id })}::jsonb) as result`.execute(
          scope,
        )
      ).rows[0]!.result;
      if (
        !current.some(
          (c) => c.versionId === contractVersionId && c.status === "PUBLISHED",
        )
      )
        throw new Error("STALE_VALIDATION");
      const quality = (
        await sql<{
          result: {
            items: Array<{ sourceKind: string; status: string }>;
            total: number;
          };
        }>`select governance_catalog.quality_issue_read('maker',${JSON.stringify({ scope: input.scope, campus: input.campus, purpose: input.purpose, jobId: input.jobId, pageSize: 100, offset: 0 })}::jsonb) as result`.execute(
          scope,
        )
      ).rows[0]!.result;
      if (
        quality.total > 100 ||
        quality.items.some(
          (i) => i.sourceKind === "RULE" && i.status !== "RESOLVED",
        )
      )
        throw new Error("BLOCKED_DEPENDENCY");
      const commands = rows
        .map((value, i) => ({
          owner: "FINITE_FILE_ROW",
          row: i + 1,
          intent: "CREATE" as const,
          target: null,
          aliases: [],
          value,
        }))
        .filter((command) => !duplicates.has(command.row));
      return {
        input,
        atomicRule: "FINITE_FILE_ALL_ROWS_V1",
        commands,
        diff: commands,
        basis: {
          scope: "FINITE_E2E_ONLY",
          sourceArtifactId: evidence.run.sourceArtifactId,
          parseArtifactId: evidence.run.parseArtifactId,
          revisionId: input.revisionId,
          runId: run.runId,
          contractVersionId,
          ruleVersion: evidence.run.ruleVersion,
          parserPolicy: evidence.run.parserPolicy,
          mapping: "EACH_NON_DUPLICATE_CANONICAL_ROW_TO_FINITE_FILE_ROW_V1",
          deduplicationPolicy: evidence.evaluation.deduplicationPolicy,
          ignoredRows: [...duplicates],
          quality,
          originalDomainDecision: evidence.run.decision,
          originalDomainReadiness: "NOT_READY",
        },
      };
    },
    async validate(scope, actor, unit) {
      await owner.authorize(scope, actor, unit.input, "READ");
      if (
        unit.atomicRule !== "FINITE_FILE_ALL_ROWS_V1" ||
        unit.commands.some(
          (c) => c.owner !== "FINITE_FILE_ROW" || c.intent !== "CREATE",
        )
      )
        throw new Error("BLOCKED_DEPENDENCY");
    },
    async apply(scope, _actor, command) {
      const fact = (
        await sql<{
          fact: OwnerFact;
        }>`select p0_09_owner.write_fact(${JSON.stringify(command)}::jsonb) as fact`.execute(
          scope,
        )
      ).rows[0]!.fact;
      return { ok: true, fact };
    },
    async exactRead(scope, actor, input, fact) {
      await owner.authorize(scope, actor, input, "READ");
      return (
        await sql<{
          fact: OwnerFact | null;
        }>`select p0_09_owner.exact_fact(${JSON.stringify(fact)}::jsonb) as fact`.execute(
          scope,
        )
      ).rows[0]!.fact;
    },
  };
  return owner;
}
