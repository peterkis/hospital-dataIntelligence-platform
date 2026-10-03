import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, openSync, closeSync } from "node:fs";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import { migrate } from "./lineage.mjs";
import { seed } from "./catalog-seed.mjs";
import { grantDepartment } from "./p2-01-validate.mjs";
import { grantOrganization } from "./p1-02-validate.mjs";
import {
  openCatalog,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import {departmentTestKeys,removeDepartmentTestKeys} from './p2-07-test-keys.mjs';
import { departmentFixture } from "./p2-01-fixture.ts";
import {
  createDepartmentClient,
  createDepartmentWorkspaceClient,
} from "../../packages/generated-api-client/src/index.ts";
if (process.argv.length !== 2) throw new Error("CLOSED_COMMAND_REQUIRED");
const directory = ".runtime/vnext/p2-07";
mkdirSync(directory, { recursive: true });
const owned = createTemporary("P2-07");
let session, catalog, child;
const checked = async (request) => {
  const response = await request;
  assert.equal(response.response.status, 200, JSON.stringify(response.error));
  return response.data;
};
const start = async (port) => {
  const fd = openSync(directory + "/restart-process-" + port + ".log", "w");
  let processHandle;
  try {
    processHandle = fork("tooling/vnext/p2-07-http-process.mjs", [], {
      execArgv: ["--import", "tsx"],
      env: {
        ...process.env,
        VNEXT_VALIDATION_OWNER_URL: session.connectionString,
          VNEXT_TEST_RECEIPT:owned.receiptPath,
        P2_07_HTTP_PORT: String(port),
      },
      stdio: ["ignore", fd, fd, "ipc"],
      windowsHide: true,
    });
  } finally {
    closeSync(fd);
  }
  child = processHandle;
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("RESTART_SERVER_READY_TIMEOUT")),
      30000,
    );
    processHandle.once("message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("RESTART_SERVER_EXIT_" + code));
    });
  });
  assert.equal(ready.status, "READY");
  const health = await fetch(ready.url + "/p2-07/ready");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).pid, ready.pid);
  return ready;
};
const stop = async () => {
  if (!child) return;
  const processHandle = child;
  if(processHandle.exitCode!==null||processHandle.signalCode!==null){child=null;return;}
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("RESTART_SERVER_CLOSE_TIMEOUT")),
      30000,
    );
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve()
        : reject(new Error("RESTART_SERVER_CLOSE_" + code));
    });
    processHandle.send("SHUTDOWN");
  });
  child = null;
};
try {
  await migrate(owned.receipt);
  await seed(owned.receipt);
  session = await createValidationOwnerSession(owned.receipt);
  grantDepartment(owned.receipt, session.receipt.role);
  grantOrganization(owned.receipt, session.receipt.role);
  const provider = departmentTestKeys(owned.receipt,{create:true});
  catalog = await openCatalog(session.connectionString, provider);
  const fixture = await departmentFixture(owned.receipt, catalog, provider);
  await catalog.close();
  catalog = null;
  const first = await start(0),
    workspace = createDepartmentWorkspaceClient(first.url, "maker"),
    department = createDepartmentClient(first.url, "maker"),
    reviewer = createDepartmentClient(first.url, "reviewer");
  const content = {
      kind: "DEPARTMENT",
      campus: "NORTH",
      profile: "CORE",
      requestId: randomUUID(),
      payload: {
        entries: [{ row: { org_name: "SYNTHETIC restart private draft" } }],
      },
    },
    partial = await checked(workspace.save(content)),
    beforeDraft = await checked(workspace.read(partial.id));
  const complete = await checked(
      workspace.save({
        kind: "DEPARTMENT",
        campus: "NORTH",
        profile: "CORE",
        requestId: randomUUID(),
        transport: {
          contractId: fixture.contract.id,
          contractVersionId: fixture.contract.versionId,
        },
        payload: { timePolicy: "LOCAL", entries: [fixture.entry()] },
      }),
    ),
    submission = await checked(
      workspace.submit({
        id: complete.id,
        expectedVersion: complete.version,
        requestId: randomUUID(),
      }),
    );
  assert.equal(submission.kind, "DEPARTMENT");
  const input = await checked(
    department.readInput({ inputId: submission.inputId }),
  );
  await checked(
    reviewer.verify({
      requestId: randomUUID(),
      inputId: submission.inputId,
      inputDigest: submission.digest,
      rows: [
        {
          row: 1,
          disposition: "DEPARTMENT",
          historicalException: false,
          reason: "SYNTHETIC restart source review",
          evidenceId: input.entries[0].evidenceId,
        },
      ],
    }),
  );
  const requestId = randomUUID(),
    candidate = await checked(
      department.plan({ inputId: submission.inputId, requestId }),
    );
  await checked(reviewer.review({ candidateId: candidate.candidateId }));
  await checked(reviewer.approve(candidate));
  const action = { candidateId: candidate.candidateId, requestId },
    outcome = await checked(department.apply(action));
  assert.equal(outcome.status, "COMMITTED");
  const history = await checked(
    department.history({ id: outcome.facts[0].id }),
  );
  await stop();
  const second = await start(Number(new URL(first.url).port));
  assert.notEqual(first.pid, second.pid);
  assert.equal(second.url, first.url);
  const restored = createDepartmentWorkspaceClient(second.url, "maker-alias"),
    current = createDepartmentClient(second.url, "maker");
  assert.deepEqual(await checked(restored.read(partial.id)), beforeDraft);
  assert.deepEqual(
    await checked(restored.recover(content.requestId)),
    beforeDraft,
  );
  assert.deepEqual(await checked(current.history({ id: history.id })), history);
  const accepted = (value) => {
    const { responseStatus: _, ...facts } = value;
    return facts;
  };
  assert.deepEqual(
    accepted(await checked(current.resume(action))),
    accepted(outcome),
  );
  assert.deepEqual(
    accepted(await checked(current.apply(action))),
    accepted(outcome),
  );
  const evidence = {
    status: "P2_07_TWO_PROCESS_RESTART_PASSED",
    firstPid: first.pid,
    secondPid: second.pid,
    databaseOid: owned.receipt.oid,
    sameLoopbackUrl: true,
    actualHttp: true,
    privateDraftAndRecoveryPreserved: true,
    departmentHistoryPreserved: true,
    exactAcceptedApplyReplay: true,
    formalAcceptance: "NOT_RUN",
  };
  writeFileSync(directory + "/restart.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  session ??= error.ownerSession;
  throw error;
} finally {
  await stop();
  await catalog?.close();
  dropTemporary(owned.receipt);
  removeDepartmentTestKeys(owned.receipt);
  if (session) dropValidationOwnerSession(session);
}
