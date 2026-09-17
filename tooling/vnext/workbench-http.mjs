import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
const server = JSON.parse(
  readFileSync(".runtime/vnext/p0-09/server.json", "utf8"),
);
const base = server.url;
const c = server.setup.contract;
const field = server.setup.field;
const dimensions = {
  scope: "SYNTHETIC",
  campus: "NORTH",
  purpose: "IDENTITY_VERIFY",
};
const evidence = [];
async function post(path, body, actor = "maker", expected = 200) {
  const r = await fetch(base + "/api/vnext/workbench/" + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-catalog-actor": actor },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  assert.equal(r.status, expected, `${path}: ${value.code ?? value.status}`);
  return value;
}
const summary = async (jobId) => {
  const r = await fetch(base + "/api/vnext/workbench/jobs/" + jobId, {
    headers: { "x-catalog-actor": "maker" },
  });
  assert.equal(r.status, 200);
  return r.json();
};
const upload = (text) => ({
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
      action: "CREATE",
      scope: "SYNTHETIC",
      requestId: randomUUID(),
      reason: "HTTP_ACCEPTANCE",
      contractId: c.id,
      contractVersionId: c.versionId,
      profile: c.profile,
      input: { kind: "FILE", format: "CSV", parserPolicy: "STRICT_V2" },
    },
  },
});
try {
  const capabilitiesResponse = await fetch(base + "/api/vnext/workbench/capabilities", {
    headers: { "x-catalog-actor": "maker" },
  });
  assert.equal(capabilitiesResponse.status, 200);
  const capabilities = await capabilitiesResponse.json();
  assert.equal(capabilities.rawByteLimit, 1048576);
  evidence.push("RAW_FILE_LIMIT_1_MIB");
  const template = await post("template", {
    contractId: c.id,
    versionId: c.versionId,
    format: "XLSX",
  });
  assert.ok(template.download);
  assert.equal(template.dataset, c.dataset);
  assert.equal(template.profile, c.profile);
  assert.equal(template.contractVersionId, c.versionId);
  assert.equal(template.templateVersion, c.definition.templateVersion);
  assert.equal(template.parserPolicy, "STRICT_V2");
  evidence.push("EXACT_XLSX_TEMPLATE");
  const exactLimitBody = upload("placeholder");
  exactLimitBody.bytes = Buffer.alloc(capabilities.rawByteLimit, 65).toString(
    "base64",
  );
  assert.equal(
    (await post("upload", exactLimitBody)).status,
    "QUARANTINED",
  );
  const overLimitBody = upload("placeholder");
  overLimitBody.bytes = Buffer.alloc(
    capabilities.rawByteLimit + 1,
    65,
  ).toString("base64");
  await post("upload", overLimitBody, "maker", 413);
  evidence.push("RAW_FILE_LIMIT_BOUNDARY");
  await post(
    "upload",
    { ...upload(`${field}\nA`), templateVersion: "WRONG_VERSION" },
    "maker",
    409,
  );
  evidence.push("TEMPLATE_VERSION_MISMATCH");
  const downgrade = upload(`${field}\nA`);
  downgrade.input.job.input.parserPolicy = "STRICT_V1";
  await post("upload", downgrade, "maker", 409);
  const access = await post("file-access", {
    ...dimensions,
    contractVersionId: c.versionId,
  });
  assert.equal(access.canReceive, true);
  await post("upload", upload(`${field}\nA`), "outsider", 403);
  evidence.push("FORBIDDEN_HTTP_403");
  const file = await post(
    "upload",
    upload(`${field}\nSYNTHETIC_A\nSYNTHETIC_B`),
  );
  let s = await summary(file.jobId);
  const action = (action) =>
    post("action", {
      ...dimensions,
      jobId: s.jobId,
      revisionId: s.revisionId,
      action,
    });
  assert.equal((await action("PARSE")).status, "PARSED");
  assert.equal((await action("VALIDATE")).status, "BLOCKED");
  const explanation = await action("EXPLAIN");
  writeFileSync(".runtime/vnext/p0-09/http-explanation.json", explanation.text);
  await action("ISSUES");
  const preview = await action("PREVIEW");
  assert.equal(preview.status, "FINITE_PREVIEW");
  assert.equal(JSON.parse(preview.text).unit.commands.length, 2);
  const p = {
    ...dimensions,
    jobId: s.jobId,
    revisionId: s.revisionId,
    requestId: randomUUID(),
  };
  const candidate = await post("plan", p);
  const reviewerAccess = await post(
    "candidate-access",
    { candidateId: candidate.candidateId },
    "reviewer",
  );
  assert.equal(reviewerAccess.canReview, true);
  assert.equal(reviewerAccess.canExecute, false);
  await post("plan", { ...p, requestId: randomUUID() }, "reviewer", 403);
  await post(
    "approve",
    { candidateId: candidate.candidateId, digest: candidate.digest },
    "reviewer",
    400,
  );
  for (const who of ["maker", "maker-alias"]) {
    const review = await post(
      "review",
      { candidateId: candidate.candidateId },
      who,
    );
    await post(
      "approve",
      { candidateId: candidate.candidateId, digest: review.digest },
      who,
      400,
    );
  }
  const review = await post(
    "review",
    { candidateId: candidate.candidateId },
    "reviewer",
  );
  assert.ok(review.text.includes("SYNTHETIC_A"));
  assert.ok(review.text.includes("SYNTHETIC_B"));
  assert.ok(review.text.includes("sourceArtifactId"));
  await post(
    "approve",
    { candidateId: candidate.candidateId, digest: review.digest },
    "reviewer",
  );
  const apply = { candidateId: candidate.candidateId, requestId: p.requestId };
  assert.equal((await post("apply", apply)).status, "COMMITTED");
  assert.equal((await post("resume", apply)).status, "COMMITTED");
  assert.equal((await post("reconcile", apply)).status, "MATCHED");
  s = await summary(file.jobId);
  assert.equal(s.candidates[0].committed, true);
  evidence.push("REAL_HTTP_FILE_TO_ATOMIC_COMMIT_AND_RECOVERY");
  assert.ok(!JSON.stringify(s).includes("SYNTHETIC_A"));
  evidence.push("TECHNICAL_SUMMARY_NO_RAW_VALUES");
  await post(
    "action",
    {
      ...dimensions,
      jobId: s.jobId,
      revisionId: s.revisionId,
      action: "ERROR_WORKBOOK",
    },
    "outsider",
    403,
  );
  evidence.push("REPORT_DENIAL_NO_PLAINTEXT");
  const bad = await post("upload", upload(`${field}\n"UNTERMINATED`));
  const badSummary = await summary(bad.jobId);
  const parsed = await post("action", {
    ...dimensions,
    jobId: bad.jobId,
    revisionId: badSummary.revisionId,
    action: "PARSE",
  });
  assert.notEqual(parsed.status, "PARSED");
  await post(
    "plan",
    {
      ...dimensions,
      jobId: bad.jobId,
      revisionId: badSummary.revisionId,
      requestId: randomUUID(),
    },
    "maker",
    503,
  );
  evidence.push("ILLEGAL_FILE_NO_CANDIDATE");
  console.log(JSON.stringify({ status: "PASS", evidence }));
  writeFileSync(
    ".runtime/vnext/p0-09/http-result.json",
    JSON.stringify(
      {
        status: "PASS",
        evidence,
        jobId: file.jobId,
        candidateId: candidate.candidateId,
        requestId: p.requestId,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
