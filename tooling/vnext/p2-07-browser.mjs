import {
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import { migrate, root, peer, quote } from "./lineage.mjs";
import { seed } from "./catalog-seed.mjs";
import { grantDepartment } from "./p2-01-validate.mjs";
import { grantOrganization } from "./p1-02-validate.mjs";
import { evolutionFixture } from "./p2-05-fixture.ts";
import {
  LocalSyntheticKeyProvider,
  openCatalog,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import { createDepartmentTestServer } from "./p2-07-http.mjs";
if (process.argv.slice(2).length) throw new Error("CLOSED_COMMAND_REQUIRED");
const owned = createTemporary("P2-07");
let session, catalog, server;
try {
  await migrate(owned.receipt);
  await seed(owned.receipt);
  session = await createValidationOwnerSession(owned.receipt);
  grantDepartment(owned.receipt, session.receipt.role);
  grantOrganization(owned.receipt, session.receipt.role);
  const provider = new LocalSyntheticKeyProvider(),
    connection = session.connectionString;
  catalog = await openCatalog(connection, provider);
  const fixture = await evolutionFixture(
    owned.receipt,
    catalog,
    provider,
    connection,
  );
  peer(
    owned.receipt.name,
    "DELETE FROM department_master.access WHERE actor='reviewer' AND permission='WRITE';INSERT INTO department_master.access VALUES('maker','HOSPITAL','WRITE') ON CONFLICT DO NOTHING;",
  );
  server = await createDepartmentTestServer(connection, provider);
  await server.app.listen({ host: "127.0.0.1", port: 0 });
  const address = server.app.server.address();
  if (!address || typeof address === "string")
    throw new Error("BROWSER_SERVER_ADDRESS_REQUIRED");
  const directory = resolve(root, ".runtime/vnext/p2-07");
  mkdirSync(directory, { recursive: true });
  const stopFile = resolve(directory, "stop-" + process.pid),
    grantFile = resolve(directory, "grant-view-" + process.pid + ".json"),
    url = `http://127.0.0.1:${address.port}/admin/vnext/departments`;
  writeFileSync(
    resolve(directory, "browser-server.json"),
    JSON.stringify({
      url,
      stopFile,
      grantFile,
      receipt: owned.receiptPath,
      scope: "SYNTHETIC_OWNED_TEMPORARY",
    }),
  );
  writeFileSync(
    resolve(directory, "browser-fixtures.json"),
    JSON.stringify(
      {
        departmentId: fixture.targetId,
        sourceId: fixture.source.id,
        departmentEvidenceId: fixture.department.artifact.artifactId,
        decisionEvidenceId: fixture.material.artifactId,
        eventContract: fixture.eventContract,
        successionContract: fixture.successionContract,
        departmentContract: fixture.department.contract,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ status: "P2_07_BROWSER_READY", url, stopFile, grantFile }),
  );
  while (!existsSync(stopFile)) {
    if (existsSync(grantFile)) {
      const request = JSON.parse(readFileSync(grantFile, "utf8"));
      if (
        Object.keys(request).join(",") !== "viewId" ||
        !/^[a-f0-9-]{36}$/.test(request.viewId)
      )
        throw new Error("CLOSED_FIXTURE_GRANT_REQUIRED");
      const views = await server.hierarchy.listHierarchyViews("maker", {
        limit: 100,
      });
      if (
        !views.items.some(
          (view) => view.viewId === request.viewId && view.canWrite,
        )
      )
        throw new Error("OWNED_VIEW_FIXTURE_REQUIRED");
      // Explicit per-view fixture authority. Domain creation never grants blanket review access.
      peer(
        owned.receipt.name,
        `INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',${quote(request.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p ON CONFLICT DO NOTHING;`,
      );
      unlinkSync(grantFile);
      console.log(
        JSON.stringify({
          status: "SYNTHETIC_EXACT_VIEW_REVIEW_GRANTED",
          viewId: request.viewId,
        }),
      );
    }
    await delay(500);
  }
} catch (error) {
  session ??= error.ownerSession;
  throw error;
} finally {
  await server?.close();
  await catalog?.close();
  dropTemporary(owned.receipt);
  if (session) dropValidationOwnerSession(session);
}
