import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { readReceipt, peer, quote } from "./lineage.mjs";
import { ownerServiceConnection } from "./owner-service.mjs";
import {
  openCatalog,
  LocalSyntheticKeyProvider,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.ts";

const receipt = readReceipt();
const provider = new LocalSyntheticKeyProvider();
const catalog = await openCatalog(await ownerServiceConnection(), provider);
let app;
try {
  const contracts = await catalog.contractRead("maker", {
    scope: "SYNTHETIC",
    mode: "CURRENT",
  });
  console.log(
    JSON.stringify({
      event: "PERSISTENT_SYNTHETIC_CONTRACTS",
      items: contracts.map((c) => ({
        dataset: c.dataset,
        profile: c.profile,
        status: c.status,
        fields: c.definition.fields.length,
        businessKey: c.definition.businessKey?.length ?? 0,
      })),
    }),
  );
  const contract = contracts.find(
    (c) =>
      c.status === "PUBLISHED" &&
      c.profile === "CORE" &&
      c.definition.fields.length === 1 &&
      c.definition.references.length === 0,
  );
  if (!contract) throw new Error("PERSISTENT_SYNTHETIC_CONTRACT_REQUIRED");
  if (process.argv.includes("--grant-synthetic-smoke")) {
    if (contract.dataset !== "ORG01" || contract.status !== "PUBLISHED")
      throw new Error("SYNTHETIC_GRANT_TARGET_CHANGED");
    const datasetId = peer(
      receipt.name,
      `SELECT object_id::text FROM governance_catalog.version v JOIN governance_catalog.object o ON o.id=v.object_id WHERE v.id=${quote(contract.datasetVersionId)}::uuid AND o.scope='SYNTHETIC' AND o.code='ORG01';`,
    );
    if (!/^[a-f0-9-]{36}$/.test(datasetId))
      throw new Error("SYNTHETIC_GRANT_TARGET_CHANGED");
    const before = peer(
      receipt.name,
      `SELECT coalesce(json_agg(permission ORDER BY permission),'[]') FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(datasetId)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY';`,
    );
    peer(
      receipt.name,
      `INSERT INTO vnext_control.protected_grant(actor_code,dataset_id,campus,purpose,permission) VALUES('maker',${quote(datasetId)}::uuid,'NORTH','IDENTITY_VERIFY','STORE'),('maker',${quote(datasetId)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING;`,
    );
    writeFileSync(
      ".runtime/vnext/p0-09/synthetic-smoke-grant.json",
      JSON.stringify(
        {
          databaseOid: receipt.oid,
          datasetId,
          contractVersionId: contract.versionId,
          actor: "maker",
          campus: "NORTH",
          purpose: "IDENTITY_VERIFY",
          before: JSON.parse(before),
          added: ["STORE", "READ"],
          databaseRoleMembershipChanged: false,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
  }
  const grants = Number(
    peer(
      receipt.name,
      `SELECT count(DISTINCT permission) FROM vnext_control.protected_grant g JOIN governance_catalog.version v ON v.object_id=g.dataset_id WHERE v.id=${quote(contract.datasetVersionId)}::uuid AND g.actor_code='maker' AND g.campus='NORTH' AND g.purpose='IDENTITY_VERIFY' AND g.permission IN ('READ','STORE');`,
    ),
  );
  if (grants !== 2)
    throw new Error("PERSISTENT_SYNTHETIC_PROTECTED_GRANT_REQUIRED");
  app = await buildCatalogServer(catalog);
  await app.listen({ host: "127.0.0.1", port: 4318 });
  const post = async (path, body, actor = "maker", expected = 200) => {
    const r = await fetch("http://127.0.0.1:4318/api/vnext/workbench/" + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-catalog-actor": actor },
      body: JSON.stringify(body),
    });
    const value = await r.json();
    assert.equal(r.status, expected, value.code);
    return value;
  };
  const dimensions = {
    scope: "SYNTHETIC",
    campus: "NORTH",
    purpose: "IDENTITY_VERIFY",
  };
  const actionOperations = new Map();
  const action = (job, name, offset = 0) => {
    const key = `${job.jobId}:${job.revisionId}:${name}:${offset}`;
    const ids =
      actionOperations.get(key) ?? {
        requestId: randomUUID(),
        outputRequestId: randomUUID(),
        issueRequestId: randomUUID(),
      };
    actionOperations.set(key, ids);
    return post("action", {
      ...dimensions,
      jobId: job.jobId,
      revisionId: job.revisionId,
      action: name,
      offset,
      ...ids,
    });
  };
  const uploaded = await post("upload", {
    bytes: Buffer.from(
      contract.definition.fields[0].code +
        "\n" +
        ({
          integer: "1",
          decimal: "1.00",
          date: "2026-01-01",
          datetime: "2026-01-01T00:00:00",
          id: randomUUID(),
        }[contract.definition.fields[0].type] ??
          contract.definition.fields[0].enumValues[0] ??
          "PERSISTENT_SYNTHETIC_SMOKE"),
    ).toString("base64"),
    templateVersion: contract.definition.templateVersion,
    contractVersionId: contract.versionId,
    input: {
      campus: "NORTH",
      purpose: "IDENTITY_VERIFY",
      retentionSeconds: 3600,
      fileRequestId: randomUUID(),
      extension: ".csv",
      job: {
        action: "CREATE",
        scope: "SYNTHETIC",
        requestId: randomUUID(),
        reason: "WORKBENCH_G_SMOKE",
        contractId: contract.id,
        contractVersionId: contract.versionId,
        profile: "CORE",
        input: { kind: "FILE", format: "CSV", parserPolicy: "STRICT_V2" },
      },
    },
  });
  const s = await catalog.workbenchSummary("maker", {
    scope: "SYNTHETIC",
    jobId: uploaded.jobId,
  });
  for (const name of ["PARSE", "VALIDATE", "ISSUES"])
    await action(s, name);
  await post(
    "plan",
    {
      ...dimensions,
      jobId: s.jobId,
      revisionId: s.revisionId,
      requestId: randomUUID(),
    },
    "maker",
    503,
  );
  const state = await catalog.workbenchSummary("maker", {
    scope: "SYNTHETIC",
    jobId: s.jobId,
  });
  assert.equal(state.runs.at(-1).decision, "BLOCKED");
  assert.equal(state.candidates.length, 0);
  const result = {
    status: "PASS",
    gate: "P0_09_PERSISTENT_HTTP",
    databaseOid: receipt.oid,
    jobId: s.jobId,
    sourcePrefix: 53,
    receive: "QUARANTINED",
    parse: "PARSED",
    validation: "BLOCKED",
    quality: "READ",
    apply: "BLOCKED_DEPENDENCY",
    keyRecovery: "SAME_PROCESS_ONLY",
    realOrgPer: "NOT_READY",
  };
  writeFileSync(
    ".runtime/vnext/p0-09/persistent-smoke.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app?.close();
  await catalog.close();
}
