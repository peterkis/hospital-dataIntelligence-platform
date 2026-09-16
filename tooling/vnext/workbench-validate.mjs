import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { startWorkbench } from "./workbench-runtime.mjs";
import { peer, quote, inspect } from "./lineage.mjs";
const upgrade = process.argv.includes("--upgrade");
const runtime = await startWorkbench({ finite: true, upgrade });
try {
  writeFileSync(
    ".runtime/vnext/p0-09/server.json",
    JSON.stringify({
      url: runtime.url,
      setup: runtime.setup,
      receipt: runtime.receiptPath,
    }),
  );
  await import("./workbench-http.mjs");
  if (process.exitCode) throw new Error("HTTP_VALIDATION_FAILED");
  const http = JSON.parse(
    readFileSync(".runtime/vnext/p0-09/http-result.json", "utf8"),
  );
  const count = () =>
    Number(
      peer(runtime.receipt.name, "SELECT count(*) FROM p0_09_owner.fact;"),
    );
  assert.equal(count(), 2);
  const dimensions = {
    scope: "SYNTHETIC",
    campus: "NORTH",
    purpose: "IDENTITY_VERIFY",
  };
  const c = runtime.setup.contract;
  const post = async (path, body, actor = "maker", status = 200) => {
    const r = await fetch(runtime.url + "/api/vnext/workbench/" + path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-catalog-actor": actor },
      body: JSON.stringify(body),
    });
    const v = await r.json();
    assert.equal(r.status, status, `${path}:${v.code ?? v.status}`);
    return v;
  };
  const receive = (text, job) => ({
    bytes: Buffer.from(text).toString("base64"),
    templateVersion: c.definition.templateVersion,
    contractVersionId: c.versionId,
    input: {
      campus: "NORTH",
      purpose: "IDENTITY_VERIFY",
      retentionSeconds: 3600,
      fileRequestId: randomUUID(),
      extension: ".csv",
      job: {
        scope: "SYNTHETIC",
        requestId: randomUUID(),
        reason: "HTTP_COUNTEREXAMPLE",
        input: { kind: "FILE", format: "CSV", parserPolicy: "STRICT_V2" },
        ...job,
      },
    },
  });
  const upload = await post(
    "upload",
    receive(runtime.setup.field + "\nORIGINAL", {
      action: "CREATE",
      contractId: c.id,
      contractVersionId: c.versionId,
      profile: "CORE",
    }),
  );
  const s = await runtime.catalog.workbenchSummary("maker", {
    scope: "SYNTHETIC",
    jobId: upload.jobId,
  });
  const accessInput = { ...dimensions, contractVersionId: c.versionId };
  const datasetId = peer(
    runtime.receipt.name,
    `SELECT object_id::text FROM governance_catalog.version WHERE id=${quote(c.datasetVersionId)}::uuid;`,
  );
  peer(
    runtime.receipt.name,
    `DELETE FROM vnext_control.protected_grant WHERE actor_code='maker' AND dataset_id=${quote(datasetId)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='STORE';`,
  );
  assert.equal((await post("file-access", accessInput)).canReceive, false);
  await post(
    "upload",
    receive(runtime.setup.field + "\nDENIED", {
      action: "CREATE",
      contractId: c.id,
      contractVersionId: c.versionId,
      profile: "CORE",
    }),
    "maker",
    403,
  );
  peer(
    runtime.receipt.name,
    `INSERT INTO vnext_control.protected_grant VALUES('maker',${quote(datasetId)}::uuid,'NORTH','IDENTITY_VERIFY','STORE');`,
  );
  const correction = {
    input: {
      ...dimensions,
      issueId: randomUUID(),
      jobId: s.jobId,
      sourceRunId: randomUUID(),
      expectedCurrentRevision: s.revisionId,
      requestId: randomUUID(),
      receiveRequestId: randomUUID(),
      reason: "CORRECTION_POLICY",
      format: "CSV",
      parserPolicy: "STRICT_V1",
      retentionSeconds: 3600,
    },
    bytes: Buffer.from(runtime.setup.field + "\nCHANGED").toString("base64"),
    contractVersionId: c.versionId,
    templateVersion: c.definition.templateVersion,
  };
  assert.equal(
    (await post("correction", correction, "maker", 409)).code,
    "TEMPLATE_VERSION_MISMATCH",
  );
  for (const action of ["PARSE", "VALIDATE"])
    await post("action", {
      ...dimensions,
      jobId: s.jobId,
      revisionId: s.revisionId,
      action,
    });
  const frozen = await post("plan", {
    ...dimensions,
    jobId: s.jobId,
    revisionId: s.revisionId,
    requestId: randomUUID(),
  });
  await post("review", { candidateId: frozen.candidateId }, "reviewer");
  await post(
    "upload",
    receive(runtime.setup.field + "\nCHANGED", {
      action: "REVISE",
      jobId: s.jobId,
      expectedCurrentRevision: s.revisionId,
    }),
  );
  const stale = await post(
    "approve",
    { candidateId: frozen.candidateId, digest: frozen.digest },
    "reviewer",
    409,
  );
  assert.equal(stale.code, "STALE_VALIDATION");
  assert.equal(count(), 2);
  const oversize = receive("x".repeat(1048577), {
    action: "CREATE",
    contractId: c.id,
    contractVersionId: c.versionId,
    profile: "CORE",
  });
  await post("upload", oversize, "maker", 413);
  const huge = await fetch(runtime.url + "/api/vnext/workbench/upload", {
    method: "POST",
    headers: { "content-type": "application/json", "x-catalog-actor": "maker" },
    body: JSON.stringify({ ...oversize, bytes: "x".repeat(1500000) }),
  });
  assert.equal(huge.status, 413);
  const large = await post(
    "upload",
    receive(runtime.setup.field + "\n" + "A".repeat(400000), {
      action: "CREATE",
      contractId: c.id,
      contractVersionId: c.versionId,
      profile: "CORE",
    }),
  );
  assert.equal(large.status, "QUARANTINED");
  const duplicateFile = await post(
    "upload",
    receive(runtime.setup.field + "\nSAME\nSAME", {
      action: "CREATE",
      contractId: c.id,
      contractVersionId: c.versionId,
      profile: "CORE",
    }),
  );
  const duplicateJob = await runtime.catalog.workbenchSummary("maker", {
    scope: "SYNTHETIC",
    jobId: duplicateFile.jobId,
  });
  for (const action of ["PARSE", "VALIDATE"])
    await post("action", {
      ...dimensions,
      jobId: duplicateJob.jobId,
      revisionId: duplicateJob.revisionId,
      action,
    });
  const duplicatePreview = await post("action", {
    ...dimensions,
    jobId: duplicateJob.jobId,
    revisionId: duplicateJob.revisionId,
    action: "PREVIEW",
  });
  const duplicateUnit = JSON.parse(duplicatePreview.text).unit;
  assert.equal(duplicateUnit.commands.length, 1);
  assert.deepEqual(duplicateUnit.basis.ignoredRows, [2]);
  assert.equal(count(), 2);
  const prior = { candidateId: http.candidateId, requestId: http.requestId };
  peer(
    runtime.receipt.name,
    `DELETE FROM vnext_control.protected_grant WHERE actor_code IN ('maker','reviewer','maker-alias') AND dataset_id=${quote(datasetId)}::uuid AND campus='NORTH' AND purpose='IDENTITY_VERIFY' AND permission='READ';`,
  );
  await post("review", { candidateId: http.candidateId }, "reviewer", 403);
  const deniedCandidateAccess = await post(
    "candidate-access",
    { candidateId: http.candidateId },
    "reviewer",
  );
  assert.equal(deniedCandidateAccess.canReview, false);
  assert.equal(deniedCandidateAccess.canExecute, false);
  assert.equal((await post("resume", prior, "maker")).status, "COMMITTED");
  await post(
    "plan",
    {
      ...dimensions,
      jobId: duplicateJob.jobId,
      revisionId: duplicateJob.revisionId,
      requestId: randomUUID(),
    },
    "maker-alias",
    403,
  );
  await post(
    "action",
    {
      ...dimensions,
      jobId: duplicateJob.jobId,
      revisionId: duplicateJob.revisionId,
      action: "PREVIEW",
    },
    "maker-alias",
    403,
  );
  assert.ok(
    Number(
      peer(
        runtime.receipt.name,
        "SELECT count(*) FROM vnext_control.audit WHERE actor_code='reviewer' AND action='FINITE_FILE_SOURCE_READ';",
      ),
    ) > 0,
  );
  peer(
    runtime.receipt.name,
    "DELETE FROM vnext_control.actor_grant WHERE actor_code='maker' AND scope='SYNTHETIC' AND permission='WRITE';",
  );
  assert.equal((await post("resume", prior)).status, "COMMITTED");
  assert.equal((await post("file-access", accessInput)).canReceive, false);
  await post(
    "plan",
    {
      ...dimensions,
      jobId: s.jobId,
      revisionId: s.revisionId,
      requestId: randomUUID(),
    },
    "maker",
    403,
  );
  assert.equal(count(), 2);
  const boundary = JSON.parse(
    peer(
      runtime.receipt.name,
      `SELECT json_build_object('acceptance',has_function_privilege('hdi_prototype','governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)','EXECUTE'),'apply',has_function_privilege('hdi_prototype','governance_catalog.apply_record(text,text,jsonb)','EXECUTE'));`,
    ),
  );
  assert.deepEqual(boundary, { acceptance: false, apply: false });
  const result = {
    status: "PASS",
    mode: upgrade ? "52_TO_53" : "FRESH",
    receipt: runtime.receiptPath,
    http: http.evidence,
    changedBytesInvalidateCandidate: true,
    illegalAndStaleTargetWrites: 0,
    readOnlyResume: true,
    uploadLimits: true,
    exactParserPolicy: true,
    filePermissionCapability: true,
    fullFilePreviewAndDeduplication: true,
    requesterPurposeReadAndSourceMaker: true,
    sensitiveSourceUseAudited: true,
    ordinaryInternalDenial: boundary,
    facts: count(),
  };
  writeFileSync(
    `.runtime/vnext/p0-09/${upgrade ? "upgrade" : "fresh"}-result.json`,
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await runtime.close();
}
