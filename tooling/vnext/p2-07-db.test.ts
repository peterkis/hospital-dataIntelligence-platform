import { test, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  openDepartmentWorkspace,
  openDepartment,
  openHierarchy,
  openOrganizationEvolutions,
  openOrganizationMappings,
  openOrganizationIdentifiers,
  openDepartmentLifecycle,
} from "../../apps/governance-api/src/modules/department-master/index.js";
import {
  LocalSyntheticKeyProvider,
  openCatalog,
} from "../../apps/governance-api/src/modules/governance-catalog/index.js";
import { departmentFixture } from "./p2-01-fixture.js";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.js";
import { actor } from "../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.js";
import { peer, quote } from "./lineage.mjs";
import { textSheetsWorkbook } from "../../apps/governance-api/src/modules/governance-catalog/index.js";
import { evolutionFixture } from "./p2-05-fixture.js";
import { createDepartmentTestServer } from "./p2-07-http.mjs";

const connection = process.env["VNEXT_VALIDATION_OWNER_URL"]!,
  provider = new LocalSyntheticKeyProvider(),
  owner = openDepartmentWorkspace(connection, provider),
  department = openDepartment(connection, provider),
  catalog = await openCatalog(connection, provider);
let fixture: Awaited<ReturnType<typeof departmentFixture>>;
let domainFixture: Awaited<ReturnType<typeof evolutionFixture>>;
beforeAll(async () => {
  domainFixture = await evolutionFixture(
    JSON.parse(readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8")),
    catalog,
    provider,
    connection,
  );
  fixture = domainFixture.department;
});
afterAll(async () => {
  await owner.close();
  await department.close();
  await catalog.close();
});
test("P2-07 actual multi-Owner HTTP initialization stays within the unchanged eight-connection role budget", async () => {
  const receipt = JSON.parse(
    readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8"),
  );
  const role = new URL(connection).username;
  expect(
    peer(
      receipt.name,
      `SELECT has_function_privilege(${quote(role)},'governance_catalog.department_workspace_application(uuid,uuid)','EXECUTE'),has_function_privilege(${quote(role)},'governance_catalog.department_workspace_impact_access(text,uuid,text,text,uuid,text)','EXECUTE');`,
    ).trim(),
  ).toBe("f|f");
  const server = await createDepartmentTestServer(connection, provider);
  try {
    const url = await server.app.listen({ host: "127.0.0.1", port: 0 }),
      headers = {
        "content-type": "application/json",
        "x-catalog-actor": "maker",
      };
    const calls = [
      ["/api/vnext/department-workspace/drafts/list", { limit: 50 }],
      ["/api/vnext/department-workspace/applications/list", { limit: 50 }],
      ["/api/vnext/departments/list", { limit: 100 }],
      ["/api/vnext/hierarchy/views/list", { limit: 100 }],
      ["/api/vnext/organizations/query", { mode: "LIST", limit: 100 }],
      ["/api/vnext/campuses/list", { limit: 100 }],
      [
        "/api/vnext/organization-mappings/list",
        { campus: "NORTH", limit: 100 },
      ],
      [
        "/api/vnext/organization-identifiers/list",
        { campus: "NORTH", limit: 100 },
      ],
      [
        "/api/vnext/department-workspace/permissions",
        { kind: "DEPARTMENT", campus: "NORTH" },
      ],
      [
        "/api/vnext/department-workspace/permissions",
        { kind: "HIERARCHY", campus: "NORTH" },
      ],
    ] as const;
    const responses = await Promise.all(
      calls.map(([path, body]) =>
        fetch(url + path, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        }),
      ),
    );
    for (const response of responses)
      expect(
        response.status,
        response.url +
          " " +
          (response.ok ? "" : JSON.stringify(await response.json())),
      ).toBe(200);
  } finally {
    await server.close();
  }
});
test("P2-07 CORE hierarchy workbook creates an encrypted recoverable private draft and rejects FULL", async () => {
  const receipt = JSON.parse(
    readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8"),
  );
  peer(
    receipt.name,
    "INSERT INTO department_master.access VALUES('maker','HOSPITAL','WRITE') ON CONFLICT DO NOTHING;",
  );
  const header = {
    viewId: "",
    sourceClientKey: "DEMO_FILE_VIEW",
    viewCode: "DEMO_FILE_VIEW",
    viewName: "DEMO file hierarchy",
    viewType: "ADMINISTRATIVE",
    parentCardinality: "STRICT_TREE",
    purpose: "DEMO frozen reporting",
    aggregationRule: "NONE",
    ownerDepartmentId: "",
    sourceSystemId: fixture.source.id,
    sourceRecordId: "DEMO/ORG05/1",
    sourceVersion: "1",
    validFrom: "2026-01-01T00:00:00",
    validTo: "",
    recordedAt: "2026-01-02T00:00:00",
    recordStatus: "ACTIVE",
    approvalRef: "DEMO_APPROVED",
  };
  const node = {
    nodeKey: "root",
    parentNodeKey: "",
    nodeKind: "GROUP",
    departmentId: "",
    departmentVersionId: "",
    groupCode: "DEMO_GROUP",
    groupId: "",
    groupVersionId: "",
    displayName: "DEMO frozen group",
    relationName: "contains",
    sortOrder: "0",
    isPrimaryPath: "true",
    edge_sourceClientKey: "DEMO_EDGE",
    edge_sourceVersion: "1",
    edge_sourceSystemId: fixture.source.id,
    edge_sourceRecordId: "DEMO/ORG06/1",
    edge_validFrom: "2026-01-01T00:00:00",
    edge_validTo: "",
    edge_recordedAt: "2026-01-02T00:00:00",
    edge_recordStatus: "ACTIVE",
    edge_approvalRef: "DEMO_APPROVED",
  };
  const bytes = textSheetsWorkbook({
      ORG05: [Object.keys(header), Object.values(header)],
      ORG06: [Object.keys(node), Object.values(node)],
    }),
    input = {
      requestId: randomUUID(),
      campus: "NORTH" as const,
      profile: "CORE" as const,
      filename: "synthetic-hierarchy.xlsx",
      bytesBase64: bytes.toString("base64"),
    };
  const result = await owner.receiveHierarchyFile("maker", input);
  expect(result.structuralStatus).toBe("PARSED");
  expect(result.draft?.state).toBe("EDITING");
  const saved = await owner.readDraft("maker", { id: result.draft!.id });
  expect(saved.content.attachment?.bytesBase64).toBe(input.bytesBase64);
  expect(saved.content.payload).toMatchObject({
    viewName: "DEMO file hierarchy",
    nodes: [{ nodeKind: "GROUP", displayName: "DEMO frozen group" }],
  });
  expect(await owner.receiveHierarchyFile("maker", input)).toEqual(result);
  await expect(
    owner.receiveHierarchyFile("maker", { ...input, profile: "FULL" }),
  ).rejects.toThrow("BLOCKED_DEPENDENCY");
  const bad = await owner.receiveHierarchyFile("maker", {
    ...input,
    requestId: randomUUID(),
    bytesBase64: Buffer.from("not a workbook").toString("base64"),
  });
  expect(bad.structuralStatus).toBe("REJECTED");
  expect(bad.draft).toBeNull();
  await expect(owner.receiveHierarchyFile("outsider", input)).rejects.toThrow(
    "ACCESS_DENIED",
  );
});
test("P2-07 private partial draft persists without staging a business command", async () => {
  const input = {
    requestId: randomUUID(),
    kind: "DEPARTMENT" as const,
    campus: "NORTH" as const,
    payload: { entries: [{ row: { org_name: "DEMO partial department" } }] },
  };
  const saved = await owner.saveDraft("maker", input);
  expect(saved).toMatchObject({ version: "1", state: "EDITING" });
  expect((await owner.readDraft("maker", { id: saved.id })).content).toEqual(
    input,
  );
  expect(
    (await owner.listDrafts("maker", {})).items.map((item) => item.id),
  ).toContain(saved.id);
  expect(
    await owner.recoverDraft("maker-alias", { requestId: input.requestId }),
  ).toMatchObject({ id: saved.id, content: input });
  expect(
    await owner.recoverDraft("reviewer", { requestId: input.requestId }),
  ).toBeNull();
  expect(
    await owner.recoverDraft("maker", { requestId: randomUUID() }),
  ).toBeNull();
});
test("P2-07 encrypted draft evidence is bound to the real staged input without rewriting original fields", async () => {
  const { evidenceId: _, ...entry } = fixture.entry();
  const saved = await owner.saveDraft("maker", {
    requestId: randomUUID(),
    kind: "DEPARTMENT",
    campus: "NORTH",
    transport: {
      contractId: fixture.contract.id,
      contractVersionId: fixture.contract.versionId,
    },
    attachment: {
      filename: "synthetic-source.txt",
      bytesBase64: Buffer.from("SYNTHETIC P2-07 evidence").toString("base64"),
    },
    payload: { timePolicy: "LOCAL", entries: [entry] },
  });
  const submitted = await owner.submitDraft("maker", {
    id: saved.id,
    expectedVersion: saved.version,
    requestId: randomUUID(),
  });
  if (submitted.kind !== "DEPARTMENT") throw new Error("WRONG_SUBMISSION_KIND");
  const staged = await department.readInput("maker", {
    inputId: submitted.inputId,
  });
  expect(staged.entries[0]!.evidenceId).toMatch(/^[a-f0-9-]{36}$/);
  const stored = await owner.readDraft("maker", { id: saved.id });
  expect(stored.content.payload["entries"]).toEqual([entry]);
  await department.verify("reviewer", {
    requestId: randomUUID(),
    inputId: submitted.inputId,
    inputDigest: submitted.digest,
    rows: [
      {
        row: 1,
        disposition: "DEPARTMENT",
        historicalException: false,
        reason: "SYNTHETIC attached evidence review",
        evidenceId: staged.entries[0]!.evidenceId,
      },
    ],
  });
  expect(
    (await department.validate("maker", { inputId: submitted.inputId }))
      .decision,
  ).toBe("PASS");
});
test("P2-07 complete draft submission creates one real Owner input and survives same-request retry", async () => {
  const saved = await owner.saveDraft("maker", {
    requestId: randomUUID(),
    kind: "DEPARTMENT",
    campus: "NORTH",
    transport: {
      contractId: fixture.contract.id,
      contractVersionId: fixture.contract.versionId,
    },
    payload: { timePolicy: "LOCAL", entries: [fixture.entry()] },
  });
  const request = {
    id: saved.id,
    expectedVersion: saved.version,
    requestId: randomUUID(),
  };
  const submitted = await owner.submitDraft("maker", request);
  if (submitted.kind !== "DEPARTMENT") throw new Error("WRONG_SUBMISSION_KIND");
  expect(await owner.submitDraft("maker-alias", request)).toEqual(submitted);
  expect(await owner.readDraft("maker", { id: saved.id })).toMatchObject({
    state: "SUBMITTED",
    submission: submitted,
  });
  expect((await owner.listApplications("reviewer", {})).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "DEPARTMENT",
        inputId: submitted.inputId,
        state: "STAGED",
      }),
    ]),
  );
});
test("P2-07 submitted draft reaches the existing verification approval Apply and history seam", async () => {
  const entry = fixture.entry();
  entry.row.org_name = "DEMO P2-07 persisted";
  const saved = await owner.saveDraft("maker", {
    requestId: randomUUID(),
    kind: "DEPARTMENT",
    campus: "NORTH",
    transport: {
      contractId: fixture.contract.id,
      contractVersionId: fixture.contract.versionId,
    },
    payload: { timePolicy: "LOCAL", entries: [entry] },
  });
  const submitted = await owner.submitDraft("maker", {
    id: saved.id,
    expectedVersion: saved.version,
    requestId: randomUUID(),
  });
  if (submitted.kind !== "DEPARTMENT") throw new Error("WRONG_SUBMISSION_KIND");
  expect(
    (await department.readInput("maker", { inputId: submitted.inputId }))
      .entries[0]!.row.org_name,
  ).toBe("DEMO P2-07 persisted");
  await department.verify("reviewer", {
    requestId: randomUUID(),
    inputId: submitted.inputId,
    inputDigest: submitted.digest,
    rows: [
      {
        row: 1,
        disposition: "DEPARTMENT",
        historicalException: false,
        reason: "SYNTHETIC independent materials",
        evidenceId: fixture.artifact.artifactId,
      },
    ],
  });
  const requestId = randomUUID(),
    candidate = await department.plan("maker", {
      inputId: submitted.inputId,
      requestId,
    });
  await expect(
    department.approveApplyUnit("maker-alias", candidate),
  ).rejects.toThrow();
  await department.readApplyCandidate("reviewer", {
    candidateId: candidate.candidateId,
  });
  await department.approveApplyUnit("reviewer", candidate);
  const receipt = JSON.parse(
    readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8"),
  );
  peer(
    receipt.name,
    "DELETE FROM department_master.access WHERE actor='reviewer' AND permission='WRITE';",
  );
  try {
    expect(
      await owner.permissions("reviewer", {
        kind: "DEPARTMENT",
        campus: "NORTH",
      }),
    ).toEqual({ canRead: true, canSave: false });
    await expect(
      department.applyUnit("reviewer", {
        candidateId: candidate.candidateId,
        requestId,
      }),
    ).rejects.toThrow("ACCESS_DENIED");
  } finally {
    peer(
      receipt.name,
      "INSERT INTO department_master.access VALUES('reviewer','NORTH','WRITE') ON CONFLICT DO NOTHING;",
    );
  }
  const outcome = await department.applyUnit("maker", {
    candidateId: candidate.candidateId,
    requestId,
  });
  expect(outcome.status).toBe("COMMITTED");
  if (outcome.status !== "COMMITTED") throw new Error("NOT_COMMITTED");
  expect(
    (await department.history("maker", outcome.facts[0]!.id)).versions[0]!.facts
      .name,
  ).toBe("DEMO P2-07 persisted");
  expect((await owner.listApplications("reviewer", {})).items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inputId: submitted.inputId,
        state: "COMMITTED",
      }),
    ]),
  );
});
test("P2-07 private drafts reject another identity unknown fields and stale writers", async () => {
  const input = {
    requestId: randomUUID(),
    kind: "DEPARTMENT" as const,
    campus: "NORTH" as const,
    payload: {},
  };
  const saved = await owner.saveDraft("maker", input);
  await expect(owner.readDraft("reviewer", { id: saved.id })).rejects.toThrow(
    "ACCESS_DENIED",
  );
  expect((await owner.readDraft("maker-alias", { id: saved.id })).id).toBe(
    saved.id,
  );
  await expect(
    owner.saveDraft("maker", {
      ...input,
      requestId: randomUUID(),
      payload: { unsupported: "value" },
    }),
  ).rejects.toThrow("CLOSED_INPUT_REQUIRED");
  const update = {
    ...input,
    id: saved.id,
    expectedVersion: "1",
    requestId: randomUUID(),
  };
  expect((await owner.saveDraft("maker", update)).version).toBe("2");
  await expect(
    owner.saveDraft("maker", { ...update, requestId: randomUUID() }),
  ).rejects.toThrow("STALE_HEAD");
  await expect(
    owner.submitDraft("maker", {
      id: saved.id,
      expectedVersion: "2",
      requestId: randomUUID(),
    }),
  ).rejects.toThrow("BLOCKED_DEPENDENCY");
  expect((await owner.readDraft("maker", { id: saved.id })).state).toBe(
    "EDITING",
  );
});
test("P2-07 HTTP draft form persists and unauthorized readers receive a bounded 403", async () => {
  const app = await buildCatalogServer(
    catalog,
    "CONTROL_PLANE",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { owner, actor: (r) => actor(r.headers) },
  );
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/vnext/department-workspace/drafts/save",
      headers: { "x-catalog-actor": "maker" },
      payload: {
        requestId: randomUUID(),
        kind: "DEPARTMENT",
        campus: "NORTH",
        payload: {},
      },
    });
    expect(result.statusCode).toBe(200);
    const id = result.json().id;
    const denied = await app.inject({
      method: "POST",
      url: "/api/vnext/department-workspace/drafts/read",
      headers: { "x-catalog-actor": "reviewer" },
      payload: { id },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("ACCESS_DENIED");
    const hierarchy = await app.inject({
      method: "POST",
      url: "/api/vnext/department-workspace/drafts/save",
      headers: { "x-catalog-actor": "maker" },
      payload: {
        requestId: randomUUID(),
        kind: "HIERARCHY",
        campus: "NORTH",
        payload: { nodes: [{ nodeKind: "GROUP", parentNodeKey: null }] },
      },
    });
    expect(hierarchy.statusCode).toBe(200);
    const preserved = await app.inject({
      method: "POST",
      url: "/api/vnext/department-workspace/drafts/read",
      headers: { "x-catalog-actor": "maker" },
      payload: { id: hierarchy.json().id },
    });
    expect(preserved.json().content.payload.nodes[0].parentNodeKey).toBeNull();
  } finally {
    await app.close();
  }
});
test("P2-07 a failure linking a submitted draft rolls back the staged Owner input", async () => {
  const saved = await owner.saveDraft("maker", {
    requestId: randomUUID(),
    kind: "DEPARTMENT",
    campus: "NORTH",
    transport: {
      contractId: fixture.contract.id,
      contractVersionId: fixture.contract.versionId,
    },
    payload: { timePolicy: "LOCAL", entries: [fixture.entry()] },
  });
  const before = await owner.listApplications("maker", {}),
    receipt = JSON.parse(
      readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8"),
    );
  peer(
    receipt.name,
    "CREATE FUNCTION department_master.p207_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state='SUBMITTED' THEN RAISE EXCEPTION 'SYNTHETIC_LINK_FAILURE';END IF;RETURN NEW;END $$;CREATE TRIGGER p207_fault BEFORE INSERT ON department_master.workspace_draft_revision FOR EACH ROW EXECUTE FUNCTION department_master.p207_fault();",
  );
  const request = {
    id: saved.id,
    expectedVersion: saved.version,
    requestId: randomUUID(),
  };
  try {
    await expect(owner.submitDraft("maker", request)).rejects.toThrow(
      "SYNTHETIC_LINK_FAILURE",
    );
  } finally {
    peer(
      receipt.name,
      "DROP TRIGGER p207_fault ON department_master.workspace_draft_revision;DROP FUNCTION department_master.p207_fault();",
    );
  }
  expect(await owner.listApplications("maker", {})).toEqual(before);
  expect((await owner.readDraft("maker", { id: saved.id })).state).toBe(
    "EDITING",
  );
  expect((await owner.submitDraft("maker", request)).draftId).toBe(saved.id);
});
test("P2-07 private hierarchy draft submits through the independent snapshot Owner", async () => {
  const receipt = JSON.parse(
    readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8"),
  );
  peer(
    receipt.name,
    "INSERT INTO department_master.access VALUES('maker','HOSPITAL','WRITE') ON CONFLICT DO NOTHING;",
  );
  const staged = await department.stage("maker", await fixture.input());
  await department.verify("reviewer", {
    requestId: randomUUID(),
    inputId: staged.inputId,
    inputDigest: staged.digest,
    rows: [
      {
        row: 1,
        disposition: "DEPARTMENT",
        historicalException: false,
        reason: "SYNTHETIC view owner",
        evidenceId: fixture.artifact.artifactId,
      },
    ],
  });
  const applyRequest = randomUUID(),
    candidate = await department.plan("maker", {
      inputId: staged.inputId,
      requestId: applyRequest,
    });
  await department.readApplyCandidate("reviewer", {
    candidateId: candidate.candidateId,
  });
  await department.approveApplyUnit("reviewer", candidate);
  const outcome = await department.applyUnit("maker", {
    candidateId: candidate.candidateId,
    requestId: applyRequest,
  });
  if (outcome.status !== "COMMITTED")
    throw new Error("DEPARTMENT_FIXTURE_REQUIRED");
  const payload = {
    viewId: null,
    sourceClientKey: "DEMO_" + randomUUID(),
    viewCode: "DEMO_" + randomUUID(),
    viewName: "DEMO P2-07 view",
    viewType: "ADMINISTRATIVE",
    parentCardinality: "STRICT_TREE",
    purpose: "DEMO reporting",
    aggregationRule: "NONE",
    ownerDepartmentId: outcome.facts[0]!.id,
    sourceSystemId: fixture.source.id,
    sourceRecordId: "DEMO/ORG05/1",
    sourceVersion: "1",
    validFrom: "2026-01-01T00:00:00",
    validTo: null,
    recordedAt: "2026-01-02T00:00:00",
    recordStatus: "ACTIVE",
    approvalRef: "DEMO_APPROVED",
    nodes: [
      {
        nodeKey: "root",
        parentNodeKey: null,
        nodeKind: "GROUP",
        groupCode: "DEMO_ROOT",
        groupId: null,
        groupVersionId: null,
        displayName: "DEMO group",
        relationName: "contains",
        sortOrder: 0,
        isPrimaryPath: true,
        sourceEvidence: {
          sourceClientKey: "edge1",
          sourceVersion: "1",
          sourceSystemId: fixture.source.id,
          sourceRecordId: "DEMO/ORG06/1",
          validFrom: "2026-01-01T00:00:00",
          validTo: null,
          recordedAt: "2026-01-02T00:00:00",
          recordStatus: "ACTIVE",
          approvalRef: "DEMO_APPROVED",
        },
      },
    ],
  };
  const saveRequestId = randomUUID();
  const saved = await owner.saveDraft("maker", {
    requestId: saveRequestId,
    kind: "HIERARCHY",
    campus: "NORTH",
    payload,
  });
  const request = {
      id: saved.id,
      expectedVersion: saved.version,
      requestId: randomUUID(),
    },
    submission = await owner.submitDraft("maker", request);
  expect(submission.kind).toBe("HIERARCHY");
  if (submission.kind !== "HIERARCHY") throw new Error("WRONG_SUBMISSION_KIND");
  const hierarchy = openHierarchy(connection, provider);
  try {
    expect(
      (await owner.readDraft("maker", { id: saved.id })).content.payload,
    ).toEqual(payload);
    expect(
      (await owner.recoverDraft("maker", { requestId: saveRequestId }))
        ?.submission,
    ).toEqual(submission);
    const initialCandidate = (
      await hierarchy.listHierarchyCandidates("maker", {
        viewId: submission.viewId,
      })
    ).items[0]!;
    peer(
      receipt.name,
      `DELETE FROM department_master.hierarchy_grant WHERE actor_code='maker' AND object_id=${quote(submission.viewId)}::uuid AND permission='READ';`,
    );
    try {
      await expect(
        hierarchy.readHierarchyCandidate("maker", {
          candidateId: submission.candidateId,
        }),
      ).rejects.toThrow("ACCESS_DENIED");
      expect
        .soft(
          await owner.readDraft("maker", { id: saved.id }).then(
            () => "READ_ALLOWED",
            (error: Error) => error.message,
          ),
        )
        .toBe("ACCESS_DENIED");
      expect
        .soft(
          await owner.recoverDraft("maker", { requestId: saveRequestId }).then(
            () => "READ_ALLOWED",
            (error: Error) => error.message,
          ),
        )
        .toBe("ACCESS_DENIED");
      expect
        .soft(
          await owner.submitDraft("maker", request).then(
            () => "REPLAY_ALLOWED",
            (error: Error) => error.message,
          ),
        )
        .toBe("ACCESS_DENIED");
    } finally {
      peer(
        receipt.name,
        `INSERT INTO department_master.hierarchy_grant VALUES('maker',${quote(submission.viewId)}::uuid,'READ') ON CONFLICT DO NOTHING;`,
      );
    }
    await expect(
      hierarchy.approveHierarchyCandidate("reviewer", {
        candidateId: submission.candidateId,
        digest: submission.digest,
      }),
    ).rejects.toThrow("ACCESS_DENIED");
    peer(
      receipt.name,
      `INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',${quote(submission.viewId)}::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p ON CONFLICT DO NOTHING;`,
    );
    await hierarchy.approveHierarchyCandidate("reviewer", {
      candidateId: submission.candidateId,
      digest: submission.digest,
    });
    const approvedAt = peer(
      receipt.name,
      `SELECT to_char(approved_at,'YYYY-MM-DD"T"HH24:MI:SS.US') FROM department_master.hierarchy_candidate WHERE id=${quote(submission.candidateId)}::uuid;`,
    ).trim();
    expect(
      (
        await hierarchy.publishHierarchySnapshot("maker", {
          candidateId: submission.candidateId,
          digest: submission.digest,
          requestId: submission.publicationRequestId,
        })
      ).view.viewName,
    ).toBe("DEMO P2-07 view");
    expect(
      (await hierarchy.listHierarchyViews("reviewer", {})).items.map(
        (item) => item.viewId,
      ),
    ).toContain(submission.viewId);
    expect(
      (
        await hierarchy.listHierarchyCandidates("reviewer", {
          viewId: submission.viewId,
        })
      ).items[0]!.status,
    ).toBe("APPLIED");
    expect(
      (
        await hierarchy.listHierarchyCandidates("reviewer", {
          viewId: submission.viewId,
          recordAsOf: initialCandidate.recordedAt,
        })
      ).items[0],
    ).toMatchObject({ status: "VALIDATED", approvedBy: null });
    expect(
      (
        await hierarchy.listHierarchyCandidates("reviewer", {
          viewId: submission.viewId,
          recordAsOf: approvedAt,
        })
      ).items[0],
    ).toMatchObject({ status: "APPROVED", approvedBy: "reviewer" });
    expect(
      (
        await hierarchy.readHierarchyCandidate("reviewer", {
          candidateId: submission.candidateId,
        })
      ).payload,
    ).toMatchObject({ viewName: "DEMO P2-07 view" });
    const versions = await hierarchy.hierarchyHistory("reviewer", {
      viewId: submission.viewId,
    });
    expect(versions.items).toHaveLength(1);
    expect(
      (
        await hierarchy.readHierarchyWindow("reviewer", {
          viewId: submission.viewId,
          validFrom: "2026-05-01T00:00:00",
          validTo: null,
        })
      ).snapshot?.view.viewName,
    ).toBe("DEMO P2-07 view");
    expect(
      (
        await hierarchy.hierarchyHistory("reviewer", {
          viewId: submission.viewId,
          recordAsOf: "2025-01-01T00:00:00",
        })
      ).items,
    ).toEqual([]);
    expect(await owner.submitDraft("maker", request)).toEqual(submission);
    const frozen = versions.items[0]!,
      group = frozen.nodes[0]!;
    const nextPayload = {
      ...payload,
      viewId: submission.viewId,
      viewName: "DEMO later limited view",
      sourceVersion: "2",
      validFrom: "2026-06-01T00:00:00",
      validTo: "2026-07-01T00:00:00",
      nodes: payload.nodes.map((node) => ({
        ...node,
        groupId: group.groupId,
        groupVersionId: group.groupVersionId,
        sourceEvidence: {
          ...node.sourceEvidence,
          sourceVersion: "2",
          validFrom: "2026-06-01T00:00:00",
          validTo: "2026-07-01T00:00:00",
        },
      })),
    };
    const nextDraft = await owner.saveDraft("maker", {
        kind: "HIERARCHY",
        campus: "NORTH",
        requestId: randomUUID(),
        payload: nextPayload,
      }),
      nextSubmission = await owner.submitDraft("maker", {
        id: nextDraft.id,
        expectedVersion: nextDraft.version,
        requestId: randomUUID(),
      });
    if (nextSubmission.kind !== "HIERARCHY")
      throw new Error("HIERARCHY_REQUIRED");
    await hierarchy.approveHierarchyCandidate("reviewer", {
      candidateId: nextSubmission.candidateId,
      digest: nextSubmission.digest,
    });
    const later = await hierarchy.publishHierarchySnapshot("maker", {
      candidateId: nextSubmission.candidateId,
      digest: nextSubmission.digest,
      requestId: nextSubmission.publicationRequestId,
    });
    expect(
      await hierarchy.readHierarchySnapshot("reviewer", {
        viewId: submission.viewId,
        version: frozen.view.version,
      }),
    ).toEqual(frozen);
    expect(
      (
        await hierarchy.readHierarchyWindow("reviewer", {
          viewId: submission.viewId,
          validFrom: "2026-06-01T00:00:00",
          validTo: "2026-07-01T00:00:00",
        })
      ).snapshot?.view.viewName,
    ).toBe("DEMO later limited view");
    expect(
      (
        await hierarchy.readHierarchyWindow("reviewer", {
          viewId: submission.viewId,
          validFrom: "2026-05-01T00:00:00",
          validTo: "2026-08-01T00:00:00",
        })
      ).snapshot,
    ).toBeNull();
    expect(
      (
        await hierarchy.readHierarchyWindow("reviewer", {
          viewId: submission.viewId,
          validFrom: "2026-05-01T00:00:00",
          validTo: "2026-08-01T00:00:00",
          recordAsOf: frozen.recordedFrom,
        })
      ).snapshot?.view.version,
    ).toBe(frozen.view.version);
    expect(
      (
        await hierarchy.diffHierarchySnapshots("reviewer", {
          viewId: submission.viewId,
          fromVersion: frozen.view.version,
          toVersion: later.view.version,
        })
      ).before,
    ).toEqual(frozen);
  } finally {
    await hierarchy.close();
  }
});
test("P2-07 mapping identifier evolution and lifecycle drafts stage at the real existing Owners", async () => {
  const mapping = openOrganizationMappings(connection, provider),
    identifier = openOrganizationIdentifiers(connection, provider),
    evolution = openOrganizationEvolutions(connection, provider),
    lifecycle = openDepartmentLifecycle(connection, provider);
  try {
    const mappingInput = await domainFixture.mappingInput(),
      identifierInput = await domainFixture.identifierInput(
        domainFixture.targetId,
        "2026-01-01T00:00:00",
      ),
      evolutionInput = await domainFixture.input(),
      job = await fixture.input();
    const lifecycleInput = {
      ...job,
      commands: [
        {
          action: "SUSPEND",
          department: {
            owner: "department-master",
            id: domainFixture.targetId,
            expectedVersion: "1",
            expectedLifecycleHead: "0",
          },
          effectiveAt: "2026-08-01T00:00:00",
          reason: "SYNTHETIC current lifecycle",
          evidenceId: fixture.artifact.artifactId,
        },
      ],
      impacts: evolutionInput.impacts,
    };
    const cases = [
      ["MAPPING", mappingInput, mapping],
      ["IDENTIFIER", identifierInput, identifier],
      ["EVOLUTION", evolutionInput, evolution],
      ["LIFECYCLE", lifecycleInput, lifecycle],
    ] as const;
    for (const [kind, raw, domain] of cases) {
      const transport = await catalog.importJobRead("maker", {
        scope: "SYNTHETIC",
        jobId: raw.jobId,
      });
      const {
        requestId: _,
        jobId: __,
        revisionId: ___,
        campus,
        profile: ____,
        ...payload
      } = raw;
      // Lifecycle takes commands/impacts, never the Department source entries/time policy.
      if (kind === "LIFECYCLE") {
        Reflect.deleteProperty(payload, "entries");
        Reflect.deleteProperty(payload, "timePolicy");
      }
      const saved = await owner.saveDraft("maker", {
        requestId: randomUUID(),
        kind,
        campus,
        profile: "CORE",
        transport: {
          contractId: transport.contract.id,
          contractVersionId: transport.contract.versionId,
        },
        payload,
      });
      const action = {
          id: saved.id,
          expectedVersion: saved.version,
          requestId: randomUUID(),
        },
        submission = await owner.submitDraft("maker", action);
      if (submission.kind === "HIERARCHY" || submission.kind === "IMPACT")
        throw new Error("JOB_SUBMISSION_REQUIRED");
      expect(submission.kind).toBe(kind);
      expect(await owner.submitDraft("maker-alias", action)).toEqual(
        submission,
      );
      expect(
        await domain.readInput("maker", { inputId: submission.inputId }),
      ).toMatchObject(payload);
    }
  } finally {
    await mapping.close();
    await identifier.close();
    await evolution.close();
    await lifecycle.close();
  }
});
test("P2-07 workspace transport keeps retired-source retraction available and expansion blocked", async () => {
  const mapping = openOrganizationMappings(connection, provider);
  const source = await domainFixture.newSource();
  domainFixture.grantNamespace(source.id);
  const entry = domainFixture.entry();
  entry.row.from_system_id = source.id;
  const submit = async (entries: (typeof entry)[]) => {
    const saved = await owner.saveDraft("maker", {
      requestId: randomUUID(),
      kind: "MAPPING",
      campus: "NORTH",
      profile: "CORE",
      transport: {
        contractId: domainFixture.contract.id,
        contractVersionId: domainFixture.contract.versionId,
      },
      payload: { entries },
    });
    const staged = await owner.submitDraft("maker", {
      id: saved.id,
      expectedVersion: saved.version,
      requestId: randomUUID(),
    });
    if (staged.kind !== "MAPPING") throw new Error("MAPPING_REQUIRED");
    return staged;
  };
  const apply = async (entries: (typeof entry)[]) => {
    const staged = await submit(entries);
    await mapping.verify("reviewer", {
      requestId: randomUUID(),
      inputId: staged.inputId,
      inputDigest: staged.digest,
      rows: [
        {
          row: 1,
          reason: "DEMO independently verified source namespace",
          evidenceId: entry.evidenceId,
          contextApproved: true,
          sourceKeyReuse: false,
        },
      ],
    });
    const requestId = randomUUID(),
      candidate = await mapping.plan("maker", {
        inputId: staged.inputId,
        requestId,
      });
    await mapping.readApplyCandidate("reviewer", {
      candidateId: candidate.candidateId,
    });
    await mapping.approveApplyUnit("reviewer", candidate);
    const result = await mapping.applyUnit("maker", {
      candidateId: candidate.candidateId,
      requestId,
    });
    if (result.status !== "COMMITTED") throw new Error("COMMIT_REQUIRED");
    return result;
  };
  try {
    const created = await apply([entry]),
      id = created.facts[0]!.id;
    const impact = await catalog.sourceImpact(
      "reviewer",
      "SYNTHETIC",
      source.id,
      "RETIRE",
    );
    await catalog.command("reviewer", {
      action: "RETIRE",
      scope: "SYNTHETIC",
      requestId: randomUUID(),
      reason: "SYNTHETIC_UPSTREAM_RETIRE",
      target: source.id,
      expectedHead: source.head,
      reviewDigest: source.reviewDigest,
      impactDigest: impact.impactDigest,
    });
    const changed = {
      ...entry,
      action: "CORRECT" as const,
      mapping: {
        owner: "department-master/organization-mapping" as const,
        id,
        expectedHead: "1",
      },
      row: { ...entry.row, source_name: "DEMO changed claim" },
    };
    const staged = await submit([changed]);
    expect(
      (await mapping.validate("maker", { inputId: staged.inputId })).issues,
    ).toContainEqual({
      row: 1,
      field: "from_system_id",
      code: "BLOCKED_DEPENDENCY",
      status: "BLOCKED",
    });
    await apply([
      {
        ...entry,
        action: "RETRACT",
        mapping: {
          owner: "department-master/organization-mapping",
          id,
          expectedHead: "1",
        },
        reason: "DEMO evidenced closure after upstream retirement",
      },
    ]);
    expect((await mapping.history("maker", id)).versions.at(-1)?.action).toBe(
      "RETRACT",
    );
  } finally {
    await mapping.close();
  }
});

test("P2-07 private impact draft records one real disposition proposal without a second approval ledger", async () => {
  const evolution = openOrganizationEvolutions(connection, provider),
    receipt = JSON.parse(
      readFileSync(process.env["VNEXT_TEST_RECEIPT"]!, "utf8"),
    );
  try {
    const raw = await domainFixture.input(),
      staged = await evolution.stage("maker", raw);
    await evolution.verify("reviewer", {
      requestId: randomUUID(),
      inputId: staged.inputId,
      inputDigest: staged.digest,
      reason: "SYNTHETIC independent impact review",
      policyApproved: true,
      materialsAccepted: true,
      impactReviews: domainFixture.impactReviews,
    });
    const requestId = randomUUID(),
      candidate = await evolution.plan("maker", {
        inputId: staged.inputId,
        requestId,
      });
    await evolution.readApplyCandidate("reviewer", {
      candidateId: candidate.candidateId,
    });
    await evolution.approveApplyUnit("reviewer", candidate);
    const outcome = await evolution.applyUnit("maker", {
      candidateId: candidate.candidateId,
      requestId,
    });
    if (outcome.status !== "COMMITTED") throw new Error("COMMIT_REQUIRED");
    const cases = await evolution.listImpactCases("maker", {
        eventId: outcome.facts[0]!.id,
        campus: "NORTH",
      }),
      item = cases.items.find(
        (item) =>
          item.obligation.kind === "REFERENCE" &&
          item.obligation.owner === "IDENTIFIER",
      );
    if (!item) throw new Error("REFERENCE_CASE_REQUIRED");
    peer(
      receipt.name,
      "INSERT INTO department_master.identifier_access SELECT a,'SYNTHETIC_DEPARTMENT_CODE','NORTH',p FROM unnest(ARRAY['maker','maker-alias','reviewer']) a CROSS JOIN unnest(ARRAY['WRITE','REVIEW']) p ON CONFLICT DO NOTHING;",
    );
    const draft = await catalog.command("maker", {
        action: "CREATE",
        scope: "SYNTHETIC",
        requestId: randomUUID(),
        reason: "RESPONSIBILITY",
        kind: "RESPONSIBILITY",
        code: "IMPACT_" + randomUUID().replaceAll("-", "").toUpperCase(),
        values: {
          dataset: "ORG23",
          authorityScope: "ALL",
          fieldGroup: "ALL",
          role: "OWNER",
          assigneeRole: "SYNTHETIC_OWNER_A",
        },
        validFrom: "2026-01-01T00:00:00",
      }),
      submitted = await catalog.command("maker", {
        action: "SUBMIT",
        scope: "SYNTHETIC",
        requestId: randomUUID(),
        reason: "RESPONSIBILITY",
        target: draft.id,
        expectedHead: draft.head,
      }),
      responsibility = await catalog.command("reviewer", {
        action: "PUBLISH",
        scope: "SYNTHETIC",
        requestId: randomUUID(),
        reason: "RESPONSIBILITY",
        target: draft.id,
        expectedHead: submitted.head,
        reviewDigest: submitted.reviewDigest,
      });
    const assigned = await evolution.assignImpactCase("maker", {
      caseId: item.id,
      campus: "NORTH",
      expectedHead: item.head,
      requestId: randomUUID(),
      reason: "SYNTHETIC explicit responsibility",
      responsibilityId: responsibility.id,
    });
    const saved = await owner.saveDraft("maker", {
        kind: "IMPACT",
        campus: "NORTH",
        requestId: randomUUID(),
        payload: {
          caseId: item.id,
          expectedHead: assigned.head,
          reason: "SYNTHETIC retain frozen label history",
          disposition: {
            kind: "KEEP_HISTORY",
            evidenceId: domainFixture.material.artifactId,
          },
        },
      }),
      action = {
        id: saved.id,
        expectedVersion: saved.version,
        requestId: randomUUID(),
      },
      proposal = await owner.submitDraft("maker", action);
    expect(proposal.kind).toBe("IMPACT");
    if (proposal.kind !== "IMPACT") throw new Error("IMPACT_PROPOSAL_REQUIRED");
    expect(await owner.submitDraft("maker-alias", action)).toEqual(proposal);
    const before = await evolution.readImpactCase("maker", {
      caseId: item.id,
      campus: "NORTH",
    });
    expect(
      before.history.filter((event) => event.kind === "PROPOSE"),
    ).toHaveLength(1);
    expect(before.history.at(-1)?.eventId).toBe(proposal.proposalEventId);
    await expect(owner.readDraft("reviewer", { id: saved.id })).rejects.toThrow(
      "ACCESS_DENIED",
    );
    await evolution.approveDisposition("reviewer", {
      caseId: item.id,
      campus: "NORTH",
      expectedHead: proposal.head,
      proposalEventId: proposal.proposalEventId,
      requestId: randomUUID(),
      reason: "SYNTHETIC independent proposal approval",
    });
    expect(
      (
        await evolution.readImpactCase("reviewer", {
          caseId: item.id,
          campus: "NORTH",
        })
      ).history.at(-1)?.kind,
    ).toBe("APPROVE");
  } finally {
    await evolution.close();
  }
});
