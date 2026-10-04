import { randomBytes, createSecretKey } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
function pathFor(receipt) {
  if (
    receipt.taskId !== "P2-07" ||
    receipt.purpose !== "TEMPORARY_VALIDATION" ||
    !/^hdi_mc_vnext_[a-f0-9]{16}$/.test(receipt.name) ||
    !/^[a-f0-9-]{36}$/.test(receipt.requestId)
  )
    throw new Error("TEST_KEY_RECEIPT_REQUIRED");
  return resolve(".runtime/vnext/p2-07", receipt.name + ".keys.secret.json");
}
/** Ignored, receipt-bound synthetic keys; shared across the two actual server processes. */
export function departmentTestKeys(receipt, { create = false } = {}) {
  const path = pathFor(receipt);
  if (create) {
    mkdirSync(resolve(".runtime/vnext/p2-07"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        databaseOid: receipt.oid,
        requestId: receipt.requestId,
        payload: randomBytes(32).toString("hex"),
        lookup: randomBytes(32).toString("hex"),
      }),
      { flag: "wx", mode: 0o600 },
    );
  }
  const input = JSON.parse(readFileSync(path, "utf8"));
  if (
    input.databaseOid !== receipt.oid ||
    input.requestId !== receipt.requestId ||
    !["payload", "lookup"].every((key) => /^[a-f0-9]{64}$/.test(input[key]))
  )
    throw new Error("TEST_KEY_RECEIPT_MISMATCH");
  const payload = createSecretKey(Buffer.from(input.payload, "hex")),
    lookup = createSecretKey(Buffer.from(input.lookup, "hex"));
  return {
    current: () => ({ id: "LOCAL_1", key: payload }),
    payload: (id) => {
      if (id !== "LOCAL_1") throw new Error("KEY_UNAVAILABLE");
      return payload;
    },
    lookup: () => lookup,
  };
}
export function removeDepartmentTestKeys(receipt) {
  const path = pathFor(receipt);
  if (existsSync(path)) unlinkSync(path);
}
