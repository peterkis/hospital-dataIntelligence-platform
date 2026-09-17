import { test, expect } from "vitest";
import {
  MAX_RAW_FILE_BYTES,
  encodeWorkbenchFile,
} from "../../apps/admin-web/src/vnext/workbench-file.js";

test("P0-09 uses the server raw-byte limit for browser encoding", async () => {
  const exact = new File(
    [new Uint8Array(MAX_RAW_FILE_BYTES)],
    "exact.csv",
    { type: "text/csv" },
  );
  const encoded = await encodeWorkbenchFile(exact, MAX_RAW_FILE_BYTES);
  expect(Buffer.from(encoded, "base64").byteLength).toBe(MAX_RAW_FILE_BYTES);
});

test("P0-09 rejects an input larger than the raw-byte limit before upload", async () => {
  const oversized = new File(
    [new Uint8Array(MAX_RAW_FILE_BYTES + 1)],
    "oversized.csv",
    { type: "text/csv" },
  );
  await expect(
    encodeWorkbenchFile(oversized, MAX_RAW_FILE_BYTES),
  ).rejects.toThrow("FILE_SIZE_OR_ENCODING");
});
