import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import { migrate, readReceipt } from "./lineage.mjs";
import { seed } from "./catalog-seed.mjs";
import { grantDepartment } from "./p2-01-validate.mjs";
import { grantOrganization } from "./p1-02-validate.mjs";
import { validateDepartmentWorkspaceUpgrade } from "./p2-07-upgrade.mjs";
import { validateWorkspaceReferencesUpgrade } from "./p2-07-reference-upgrade.mjs";

const args = process.argv.slice(2);
if (args[0] === "--dispose-owned") {
  if (args.length !== 2) throw new Error("CLOSED_COMMAND_REQUIRED");
  const prior = readReceipt(args[1]);
  if (prior.taskId !== "P2-07" || prior.purpose !== "TEMPORARY_VALIDATION")
    throw new Error("DISPOSAL_NOT_AUTHORIZED");
  dropTemporary(prior);
  process.exit(0);
}
if (
  args.some((arg) => !["--generate", "--upgrade"].includes(arg)) ||
  new Set(args).size !== args.length
)
  throw new Error("CLOSED_COMMAND_REQUIRED");
if (args.includes("--upgrade")) {
  await validateDepartmentWorkspaceUpgrade();
  await validateWorkspaceReferencesUpgrade();
}
const owned = createTemporary("P2-07");
let session;
try {
  await migrate(owned.receipt);
  await seed(owned.receipt);
  session = await createValidationOwnerSession(owned.receipt);
  grantDepartment(owned.receipt, session.receipt.role);
  grantOrganization(owned.receipt, session.receipt.role);
  if (args.includes("--generate"))
    assert.equal(
      spawnSync(
        process.execPath,
        ["tooling/vnext/managed.mjs", "types-generate", owned.receiptPath],
        { stdio: "inherit", windowsHide: true },
      ).status,
      0,
    );
  assert.equal(
    spawnSync(
      process.execPath,
      ["tooling/vnext/authority.mjs", owned.receiptPath],
      { stdio: "inherit", windowsHide: true },
    ).status,
    0,
  );
  const run = spawnSync(
    process.execPath,
    [
      "node_modules/vitest/vitest.mjs",
      "run",
      "--config",
      "tooling/vnext/vitest.p2-07-db.config.ts",
    ],
    {
      env: {
        ...process.env,
        VNEXT_VALIDATION_OWNER_URL: session.connectionString,
        VNEXT_TEST_RECEIPT: owned.receiptPath,
        VNEXT_CONNECTION_STEP: "P2-07",
      },
      stdio: "inherit",
      windowsHide: true,
    },
  );
  process.exitCode = run.status ?? 1;
} catch (error) {
  session ??= error.ownerSession;
  throw error;
} finally {
  dropTemporary(owned.receipt);
  if (session) dropValidationOwnerSession(session);
}
