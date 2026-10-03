import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { prepareWorkspaceDeployment } from "./p1-06-deployment.mjs";
import { peer, identitySQL, quote } from "./lineage.mjs";
import {
  DEPARTMENT_FUNCTIONS,
  assertDepartmentProvisioned,
} from "./department-provisioning.mjs";
import { startWorkbench } from "./workbench-runtime.mjs";
import { createDepartmentWorkspaceClient } from "../../packages/generated-api-client/src/index.ts";
if (process.argv.length !== 2) throw new Error("CLOSED_COMMAND_REQUIRED");
const deployment = await prepareWorkspaceDeployment({ evidenceTask: "p2-07" });
const { receipt, connection, provider, evidence } = deployment;
const service = JSON.parse(
  readFileSync(".runtime/vnext/p0-09/owner-service.json", "utf8"),
);
peer(
  receipt.name,
  identitySQL(receipt) +
    ` BEGIN;SELECT pg_advisory_xact_lock(901002);DO $$ BEGIN IF (SELECT oid::text FROM pg_roles WHERE rolname=${quote(service.role)}) IS DISTINCT FROM ${quote(service.roleOid)} THEN RAISE EXCEPTION 'OWNER_ROLE_IDENTITY_MISMATCH';END IF;END $$;GRANT EXECUTE ON FUNCTION ${DEPARTMENT_FUNCTIONS.map((name) => "department_master." + name).join(",")} TO ${service.role};COMMIT;`,
);
await assertDepartmentProvisioned(connection, provider);
const requestPath = ".runtime/vnext/p2-07/persistent-draft-request.json";
let draft;
if (existsSync(requestPath)) {
  const prior = JSON.parse(readFileSync(requestPath, "utf8"));
  assert.equal(prior.databaseOid, receipt.oid);
  assert.equal(prior.databaseRequestId, receipt.requestId);
  draft = prior.value;
} else {
  draft = {
    requestId: randomUUID(),
    kind: "DEPARTMENT",
    campus: "NORTH",
    profile: "CORE",
    payload: {
      entries: [{ row: { org_name: "TEST P2-07 private partial draft" } }],
    },
  };
  writeFileSync(
    requestPath,
    JSON.stringify({
      databaseOid: receipt.oid,
      databaseRequestId: receipt.requestId,
      value: draft,
    }),
    { flag: "wx" },
  );
}
let runtime;
const checked = async (request) => {
  const result = await request;
  assert.equal(result.response.status, 200, JSON.stringify(result.error));
  return result.data;
};
try {
  runtime = await startWorkbench({ persistent: true });
  assert.equal(
    (await fetch(runtime.url + "/admin/vnext/departments")).status,
    200,
  );
  const client = createDepartmentWorkspaceClient(runtime.url, "maker");
  const saved = await checked(client.save(draft));
  assert.equal(saved.state, "EDITING");
  const restored = await checked(client.read(saved.id));
  assert.deepEqual(restored.content, draft);
  assert.equal((await checked(client.recover(draft.requestId))).id, saved.id);
  assert.equal(
    (
      await checked(
        createDepartmentWorkspaceClient(runtime.url, "maker-alias").read(
          saved.id,
        ),
      )
    ).id,
    saved.id,
  );
  assert.equal(
    (
      await createDepartmentWorkspaceClient(runtime.url, "outsider").read(
        saved.id,
      )
    ).response.status,
    403,
  );
  await deployment.complete();
  writeFileSync(
    evidence + ".http.json",
    JSON.stringify(
      {
        status: "P2_07_PERSISTENT_HTTP_PASSED",
        databaseOid: receipt.oid,
        actualPersistentWorkbench: true,
        generatedClient: true,
        privatePartialDraft: true,
        originalIdentityRecovery: true,
        currentPermissionDenial: true,
        formalAcceptance: "NOT_RUN",
        fullHierarchy: "BLOCKED_DEPENDENCY",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: "P2_07_PERSISTENT_HTTP_PASSED",
      evidence: evidence + ".http.json",
    }),
  );
} finally {
  await runtime?.close();
}
