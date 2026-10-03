import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import { migrate, migrationFiles, inspect, peer, quote } from "./lineage.mjs";
import { seed } from "./catalog-seed.mjs";
import { grantDepartment } from "./p2-01-validate.mjs";
import { grantOrganization } from "./p1-02-validate.mjs";
import { predecessorTables, predecessorDigest } from "./p1-02-preservation.mjs";
import {
  openCatalog,
  LocalSyntheticKeyProvider,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import {
  openDepartmentWorkspace,
  openOrganizationEvolutions,
} from "../../apps/governance-api/src/modules/department-master/index.ts";
import { evolutionFixture } from "./p2-05-fixture.ts";
export async function validateWorkspaceReferencesUpgrade() {
  for (const [prefix, baseline] of [
    [145, "de8e22c9977421a1651cd5219505ae0f06cac93b"],
    [146, "46d2c299a6bd18952bafc0fb8908edc7d8f5b643"],
  ])
    await validatePrefix(prefix, baseline);
}
async function validatePrefix(prefix, baseline) {
  const original =
      "apps/governance-api/src/modules/department-master/vnext/workspace.ts",
    directory = resolve(".runtime/vnext/p2-07/predecessor-" + prefix);
  mkdirSync(directory, { recursive: true });
  const source = execFileSync("git", ["show", baseline + ":" + original], {
      encoding: "utf8",
      windowsHide: true,
    }),
    file = resolve(directory, "workspace.mts");
  writeFileSync(
    file,
    source.replace(
      /from (["'])([.][^"']+)\1/g,
      (_all, mark, specifier) =>
        "from " +
        mark +
        pathToFileURL(
          resolve(dirname(original), specifier.replace(/\.js$/, ".ts")),
        ).href +
        mark,
    ),
  );
  const { openDepartmentWorkspace: openPrevious } = await import(
      pathToFileURL(file).href
    ),
    owned = createTemporary("P2-07"),
    provider = new LocalSyntheticKeyProvider();
  let session, catalog, previous, current, evolution;
  try {
    await migrate(owned.receipt, migrationFiles().slice(0, prefix));
    await seed(owned.receipt);
    session = await createValidationOwnerSession(owned.receipt);
    grantDepartment(owned.receipt, session.receipt.role);
    grantOrganization(owned.receipt, session.receipt.role);
    catalog = await openCatalog(session.connectionString, provider);
    const fixture = await evolutionFixture(
      owned.receipt,
      catalog,
      provider,
      session.connectionString,
    );
    evolution = openOrganizationEvolutions(session.connectionString, provider);
    const raw = await fixture.input(),
      input = await evolution.stage("maker", raw);
    await evolution.verify("reviewer", {
      requestId: randomUUID(),
      inputId: input.inputId,
      inputDigest: input.digest,
      reason: "SYNTHETIC independent baseline reference",
      policyApproved: true,
      materialsAccepted: true,
      impactReviews: fixture.impactReviews,
    });
    const applyRequest = randomUUID(),
      candidate = await evolution.plan("maker", {
        inputId: input.inputId,
        requestId: applyRequest,
      });
    await evolution.readApplyCandidate("reviewer", {
      candidateId: candidate.candidateId,
    });
    await evolution.approveApplyUnit("reviewer", candidate);
    const outcome = await evolution.applyUnit("maker", {
      candidateId: candidate.candidateId,
      requestId: applyRequest,
    });
    assert.equal(outcome.status, "COMMITTED");
    previous = openPrevious(session.connectionString, provider);
    const draft = {
      requestId: randomUUID(),
      kind: "EVOLUTION",
      campus: "NORTH",
      payload: {
        compensatesEvent: {
          owner: "department-master/organization-evolution",
          id: outcome.facts[0].id,
          version: "1",
        },
      },
    };
    const saved = await previous.saveDraft("maker", draft);
    assert.deepEqual(
      (await previous.readDraft("maker", { id: saved.id })).content,
      draft,
    );
    const companionRequest = {
      requestId: randomUUID(),
      kind: "EVOLUTION",
      campus: "NORTH",
      payload: {
        contracts: {
          successionContractId: fixture.successionContract.id,
          successionContractVersionId: fixture.successionContract.versionId,
        },
      },
    };
    const companionSaved = await previous.saveDraft("maker", companionRequest);
    assert.deepEqual(
      (await previous.readDraft("maker", { id: companionSaved.id })).content,
      companionRequest,
    );
    const otherDepartment = await fixture.newDepartment();
    const reorderedRequest = {
      requestId: randomUUID(),
      kind: "EVOLUTION",
      campus: "NORTH",
      payload: {
        successors: [
          { target: { owner: "department-master", id: otherDepartment } },
        ],
        predecessors: [{ owner: "department-master", id: fixture.targetId }],
      },
    };
    const reorderedSaved = await previous.saveDraft("maker", reorderedRequest);
    // The old writer commits this valid payload but its old reader loses reference ordering.
    await assert.rejects(
      previous.readDraft("maker", { id: reorderedSaved.id }),
      /PAYLOAD_UNAVAILABLE/,
    );
    await previous.close();
    previous = null;
    const before = await inspect(owned.receipt),
      tables = predecessorTables(before.tables),
      digest = predecessorDigest(owned.receipt, tables),
      after = await migrate(owned.receipt);
    assert.deepEqual(after.ledger.slice(0, prefix), before.ledger);
    assert.equal(predecessorDigest(owned.receipt, tables), digest);
    current = openDepartmentWorkspace(session.connectionString, provider);
    assert.deepEqual(
      (await current.readDraft("maker", { id: reorderedSaved.id })).content,
      reorderedRequest,
    );
    assert.equal(
      (
        await current.recoverDraft("maker", {
          requestId: reorderedRequest.requestId,
        })
      ).id,
      reorderedSaved.id,
    );

    assert.deepEqual(
      (await current.readDraft("maker", { id: companionSaved.id })).content,
      companionRequest,
    );
    assert.equal(
      (
        await current.recoverDraft("maker", {
          requestId: companionRequest.requestId,
        })
      ).id,
      companionSaved.id,
    );
    const datasetId = peer(
      owned.receipt.name,
      `SELECT dataset_id FROM governance_catalog.import_contract WHERE id=${quote(fixture.successionContract.id)}::uuid;`,
    ).trim();
    const grants = peer(
      owned.receipt.name,
      `SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM vnext_control.object_grant g WHERE actor_code='maker' AND object_id=${quote(datasetId)}::uuid AND permission='READ';`,
    ).trim();
    peer(
      owned.receipt.name,
      `DELETE FROM vnext_control.object_grant WHERE actor_code='maker' AND object_id=${quote(datasetId)}::uuid AND permission='READ';`,
    );
    try {
      await assert.rejects(
        current.readDraft("maker", { id: companionSaved.id }),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        current.recoverDraft("maker", {
          requestId: companionRequest.requestId,
        }),
        /ACCESS_DENIED/,
      );
    } finally {
      peer(
        owned.receipt.name,
        `INSERT INTO vnext_control.object_grant SELECT * FROM jsonb_populate_recordset(NULL::vnext_control.object_grant,${quote(grants)}::jsonb) ON CONFLICT DO NOTHING;`,
      );
    }

    assert.deepEqual(
      (await current.readDraft("maker", { id: saved.id })).content,
      draft,
    );
    assert.deepEqual(
      (await current.recoverDraft("maker", { requestId: draft.requestId }))
        .content,
      draft,
    );
    peer(
      owned.receipt.name,
      `DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(fixture.eventDataset.id)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`,
    );
    try {
      await assert.rejects(
        current.readDraft("maker", { id: saved.id }),
        /ACCESS_DENIED/,
      );
      await assert.rejects(
        current.recoverDraft("maker", { requestId: draft.requestId }),
        /ACCESS_DENIED/,
      );
    } finally {
      peer(
        owned.receipt.name,
        `INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(fixture.eventDataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING;`,
      );
    }
    assert.deepEqual(
      (await current.readDraft("maker", { id: saved.id })).content,
      draft,
    );
    writeFileSync(
      ".runtime/vnext/p2-07/reference-upgrade-" + prefix + ".json",
      JSON.stringify(
        {
          status: "P2_07_REFERENCE_UPGRADE_PASSED",
          baseline,
          prefix,
          current: after.ledger.length,
          originalPrivateCiphertextAndRowsPreserved: true,
          originalRequestRecovery: true,
          currentReferencedOwnerPermission: true,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        status: "P2_07_REFERENCE_UPGRADE_PASSED",
        prefix,
        current: after.ledger.length,
      }),
    );
  } catch (error) {
    session ??= error.ownerSession;
    throw error;
  } finally {
    await previous?.close();
    await current?.close();
    await evolution?.close();
    await catalog?.close();
    dropTemporary(owned.receipt);
    if (session) dropValidationOwnerSession(session);
  }
}
