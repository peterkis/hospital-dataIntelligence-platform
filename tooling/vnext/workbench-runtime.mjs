import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import staticPlugin from "@fastify/static";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import {
  readReceipt,
  migrate,
  migrationFiles,
  peer,
  quote,
  root,
  inspect,
  resolveTarget,
  identitySQL,
} from "./lineage.mjs";
import { ownerServiceConnection } from "./owner-service.mjs";
import { seed } from "./catalog-seed.mjs";
import {
  openCatalog,
  LocalSyntheticKeyProvider,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.ts";
import { fixture } from "./protected-fixture.ts";
import { fileOwner } from "./workbench-owner.ts";
import {organizationKeys} from './organization-keys.mjs';
import {openOrganization,openCampus} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {actor as syntheticActor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';

export async function startWorkbench({
  persistent = false,
  upgrade = false,
  finite = false,
} = {}) {
  if (persistent && finite) throw new Error("FINITE_OWNER_TEMPORARY_ONLY");
  const owned = persistent ? null : createTemporary("P0-09");
  const receipt = owned?.receipt ?? readReceipt();
  let session, catalog, app, organization, campus;
  const close = async () => {
    await app?.close();
    await organization?.close();
    await campus?.close();
    await catalog?.close();
    if (owned) {
      if (finite)
        peer(
          receipt.name,
          identitySQL(receipt) + " DROP SCHEMA IF EXISTS p0_09_owner CASCADE;",
        );
      dropTemporary(receipt);
      if (session) dropValidationOwnerSession(session);
    }
  };
  try {
    if (owned) {
      if (upgrade) {
        await migrate(receipt, migrationFiles().slice(0, 52));
        await seed(receipt);
      }
      const before = upgrade ? await inspect(receipt) : null;
      await migrate(receipt);
      await seed(receipt);
      if (before)
        assert.deepEqual(
          (await inspect(receipt)).ledger.slice(0, 52),
          before.ledger,
        );
      session = await createValidationOwnerSession(receipt);
      const types = spawnSync(
        process.execPath,
        ["tooling/vnext/managed.mjs", "types-verify", owned.receiptPath],
        { cwd: root, env: process.env, encoding: "utf8", windowsHide: true },
      );
      if (types.status !== 0) throw new Error("WORKBENCH_TYPES_FAILED");
    }
    const connection = owned
      ? session.connectionString
      : await ownerServiceConnection();
    // An installed persistent Owner must never silently fall back to fresh keys.
    const organizationReady=persistent;
    const provider = organizationReady?organizationKeys(receipt):new LocalSyntheticKeyProvider();
    if(organizationReady){organization=openOrganization(connection,provider);campus=openCampus(connection,provider);}
    catalog = await openCatalog(connection, provider);
    let setup;
    if (owned) {
      const f = await fixture(catalog, {
        businessKey: true,
        textField: true,
        ruleVersion: finite ? "FINITE_FILE_E2E_V1" : "WORKBENCH_CONTROL_V1",
      });
      const contract = (
        await catalog.contractRead("maker", {
          scope: "SYNTHETIC",
          mode: "HISTORY",
          target: f.contract.id,
          versionId: f.contract.versionId,
        })
      )[0];
      for (const actor of ["maker", "maker-alias"])
        for (const permission of ["STORE", "READ"])
          peer(
            receipt.name,
            `INSERT INTO vnext_control.protected_grant VALUES(${quote(actor)},${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`,
          );
      setup = { contract, field: contract.definition.fields[0].code };
      if (finite) {
        peer(
          receipt.name,
          `INSERT INTO vnext_control.protected_grant VALUES('reviewer',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING;`,
        );
        peer(
          receipt.name,
          readFileSync(
            resolve(root, "tooling/vnext/workbench-owner.sql"),
            "utf8",
          ),
        );
        peer(
          receipt.name,
          `GRANT USAGE ON SCHEMA p0_09_owner TO ${session.receipt.role}; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA p0_09_owner TO ${session.receipt.role}; GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb),vnext_control.authorize(text,text,text),governance_catalog.contract_require_access(text,text,uuid,text) TO ${session.receipt.role};`,
        );
        await catalog.close();
        catalog = await openCatalog(
          connection,
          provider,
          fileOwner(provider, contract.versionId),
        );
      }
    }
    app = await buildCatalogServer(
      catalog,
      finite ? "FINITE_E2E" : "CONTROL_PLANE",
      organization?{owner:organization,actor:r=>syntheticActor(r.headers)}:undefined,
      campus?{owner:campus,references:campus.references,actor:r=>syntheticActor(r.headers)}:undefined,
    );
    await app.register(staticPlugin, {
      root: resolve(root, "apps/admin-web/dist-vnext"),
      prefix: "/admin/vnext/",
    });
    for (const path of [
      "catalog",
      "contracts",
      "parameter-definitions",
      "imports",
    ])
      app.get("/admin/vnext/" + path, (_req, reply) =>
        reply.sendFile("vnext.html"),
      );
    await app.listen({ host: "127.0.0.1", port: 4317 });
    return {
      app,
      catalog,
      provider,
      receipt,
      receiptPath: owned?.receiptPath,
      setup,
      close,
      url: "http://127.0.0.1:4317",
      finite,
    };
  } catch (error) {
    session ??= error.ownerSession;
    await close();
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const args = process.argv.slice(2);
  if (args.some((a) => !["--persistent", "--upgrade", "--finite"].includes(a)))
    throw new Error("CLOSED_COMMAND_REQUIRED");
  const runtime = await startWorkbench({
    persistent: args.includes("--persistent"),
    upgrade: args.includes("--upgrade"),
    finite: args.includes("--finite"),
  });
  const stopFile = resolve(root, ".runtime/vnext/p0-09/stop-" + process.pid);
  try {
    writeFileSync(
      resolve(root, ".runtime/vnext/p0-09/server.json"),
      JSON.stringify({
        url: runtime.url,
        stopFile,
        finite: runtime.finite,
        receipt: runtime.receiptPath ?? ".runtime/vnext/creation.json",
        setup: runtime.setup,
      }),
    );
    console.log(
      JSON.stringify({
        status: "WORKBENCH_READY",
        url: runtime.url + "/admin/vnext/imports",
        finite: runtime.finite,
      }),
    );
    while (!existsSync(stopFile)) await delay(500);
  } finally {
    await runtime.close();
  }
}
