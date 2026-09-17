import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { startWorkbench } from "./workbench-runtime.mjs";
const runtime = await startWorkbench();
try {
  const c = runtime.setup.contract,
    field = runtime.setup.field;
  const dimensions = {
    scope: "SYNTHETIC",
    campus: "NORTH",
    purpose: "IDENTITY_VERIFY",
  };
  const post = async (path, body, status = 200) => {
    const r = await fetch(runtime.url + "/api/vnext/workbench/" + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-catalog-actor": "maker",
      },
      body: JSON.stringify(body),
    });
    const v = await r.json();
    assert.equal(r.status, status, v.code);
    return v;
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
  const file = await post("upload", {
    bytes: Buffer.from(field + "\nCONTROL_A\nCONTROL_B").toString("base64"),
    contractVersionId: c.versionId,
    templateVersion: c.definition.templateVersion,
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
        reason: "CONTROL_PLANE_PREVIEW",
        contractId: c.id,
        contractVersionId: c.versionId,
        profile: "CORE",
        input: { kind: "FILE", format: "CSV", parserPolicy: "STRICT_V2" },
      },
    },
  });
  const job = await runtime.catalog.workbenchSummary("maker", {
    scope: "SYNTHETIC",
    jobId: file.jobId,
  });
  for (const name of ["PARSE", "VALIDATE", "ISSUES"])
    await action(job, name);
  const preview = await action(job, "PREVIEW");
  assert.equal(preview.status, "BLOCKED");
  const details = JSON.parse(preview.text);
  assert.equal(details.rowCount, 2);
  assert.equal(details.domainWriteCount, 0);
  assert.equal(
    (
      await post(
        "plan",
        {
          ...dimensions,
          jobId: job.jobId,
          revisionId: job.revisionId,
          requestId: randomUUID(),
        },
        503,
      )
    ).code,
    "BLOCKED_DEPENDENCY",
  );
  const result = {
    status: "PASS",
    mode: "CONTROL_PLANE",
    rowCount: details.rowCount,
    domainWriteCount: 0,
    apply: "BLOCKED_DEPENDENCY",
    receipt: runtime.receiptPath,
  };
  writeFileSync(
    ".runtime/vnext/p0-09/control-plane-result.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await runtime.close();
}
