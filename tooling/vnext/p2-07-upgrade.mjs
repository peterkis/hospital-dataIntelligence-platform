import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import { migrate, migrationFiles, inspect, peer } from "./lineage.mjs";
import { seed } from "./catalog-seed.mjs";
import { predecessorTables, predecessorDigest } from "./p1-02-preservation.mjs";
import { grantDepartment } from "./p2-01-validate.mjs";
import { grantOrganization } from "./p1-02-validate.mjs";
import {
  openCatalog,
  LocalSyntheticKeyProvider,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import {
  openDepartment,
  openDepartmentWorkspace,
} from "../../apps/governance-api/src/modules/department-master/index.ts";
import { departmentFixture } from "./p2-01-fixture.ts";
const BASELINE = "bb3e3509887bca8159a7401d45505fdb2a8a329a";
export async function validateDepartmentWorkspaceUpgrade() {
  const names = [
      "index.ts",
      "department-lifecycle.ts",
      "organization-evolution.ts",
      "organization-mapping.ts",
      "organization-identifier.ts",
      "hierarchy.ts",
      "department-impact-cases.ts",
    ],
    original = "apps/governance-api/src/modules/department-master/vnext",
    directory = resolve(".runtime/vnext/p2-07/predecessor-143");
  mkdirSync(directory, { recursive: true });
  const sources = new Map(
      names.map((name) => [
        resolve(original, name),
        execFileSync("git", ["show", BASELINE + ":" + original + "/" + name], {
          encoding: "utf8",
          windowsHide: true,
        }),
      ]),
    ),
    frozen = new Map(
      names.map((name) => [
        resolve(original, name),
        resolve(directory, name.replace(/\.ts$/, ".mts")),
      ]),
    );
  for (const [file, source] of sources)
    writeFileSync(
      frozen.get(file),
      source.replace(
        /from '([.][^']+)'/g,
        (_all, specifier) =>
          "from '" +
          pathToFileURL(
            frozen.get(
              resolve(dirname(file), specifier.replace(/\.js$/, ".ts")),
            ) ?? resolve(dirname(file), specifier.replace(/\.js$/, ".ts")),
          ).href +
          "'",
      ),
    );
  const { openDepartment: openPredecessor } = await import(
      pathToFileURL(frozen.get(resolve(original, "index.ts"))).href
    ),
    owned = createTemporary("P2-07"),
    provider = new LocalSyntheticKeyProvider();
  let session, catalog, old, current, workspace;
  try {
    await migrate(owned.receipt, migrationFiles().slice(0, 143));
    await seed(owned.receipt);
    session = await createValidationOwnerSession(owned.receipt);
    grantDepartment(owned.receipt, session.receipt.role);
    grantOrganization(owned.receipt, session.receipt.role);
    catalog = await openCatalog(session.connectionString, provider);
    const fixture = await departmentFixture(owned.receipt, catalog, provider);
    old = openPredecessor(session.connectionString, provider);
    const prepare = async () => {
      const staged = await old.stage("maker", await fixture.input());
      await old.verify("reviewer", {
        requestId: randomUUID(),
        inputId: staged.inputId,
        inputDigest: staged.digest,
        rows: [
          {
            row: 1,
            disposition: "DEPARTMENT",
            historicalException: false,
            reason: "SYNTHETIC predecessor independent source",
            evidenceId: fixture.artifact.artifactId,
          },
        ],
      });
      const requestId = randomUUID(),
        candidate = await old.plan("maker", {
          inputId: staged.inputId,
          requestId,
        });
      await old.readApplyCandidate("reviewer", {
        candidateId: candidate.candidateId,
      });
      await old.approveApplyUnit("reviewer", candidate);
      return { candidateId: candidate.candidateId, requestId };
    };
    const request = await prepare(),
      outcome = await old.applyUnit("maker", request);
    assert.equal(outcome.status, "COMMITTED");
    const departmentId = outcome.facts[0].id,
      history = await old.history("maker", departmentId),
      pending = await prepare();
    await old.close();
    old = null;
    const before = await inspect(owned.receipt),
      tables = predecessorTables(before.tables),
      digest = predecessorDigest(owned.receipt, tables),
      after = await migrate(owned.receipt);
    assert.equal(after.identity.oid, before.identity.oid);
    assert.deepEqual(after.ledger.slice(0, 143), before.ledger);
    assert.equal(predecessorDigest(owned.receipt, tables), digest);
    grantDepartment(owned.receipt, session.receipt.role);
    current = openDepartment(session.connectionString, provider);
    workspace = openDepartmentWorkspace(session.connectionString, provider);
    assert.deepEqual(await current.history("maker", departmentId), history);
    assert.deepEqual(await current.applyUnit("maker", request), outcome);
    assert.equal(
      (await current.applyUnit("maker", pending)).status,
      "COMMITTED",
    );
    const content = {
        requestId: randomUUID(),
        kind: "DEPARTMENT",
        campus: "NORTH",
        payload: {
          entries: [{ row: { org_name: "SYNTHETIC upgraded private draft" } }],
        },
      },
      saved = await workspace.saveDraft("maker", content);
    assert.deepEqual(
      (
        await workspace.recoverDraft("maker-alias", {
          requestId: content.requestId,
        })
      ).content,
      content,
    );
    const evidence = {
      status: "P2_07_UPGRADE_PASSED",
      baseline: BASELINE,
      prefix: 143,
      current: after.ledger.length,
      sourceFiles: names,
      sourceDigest: createHash("sha256")
        .update(JSON.stringify([...sources]))
        .digest("hex"),
      rowsAndKeysPreserved: true,
      originalLedgerPreserved: true,
      originalDepartmentHistoryPreserved: true,
      committedReplay: true,
      compatiblePendingApprovalApplied: true,
      newPrivateDraftRecovery: true,
    };
    writeFileSync(
      ".runtime/vnext/p2-07/upgrade.json",
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    session ??= error.ownerSession;
    throw error;
  } finally {
    await old?.close();
    await workspace?.close();
    await current?.close();
    await catalog?.close();
    dropTemporary(owned.receipt);
    if (session) dropValidationOwnerSession(session);
  }
}
