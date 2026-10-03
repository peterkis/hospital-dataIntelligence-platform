import { readFileSync } from "node:fs";
import { departmentTestKeys } from "./p2-07-test-keys.mjs";
import { createDepartmentTestServer } from "./p2-07-http.mjs";
if (process.argv.length !== 2 || !process.send)
  throw new Error("CLOSED_COMMAND_REQUIRED");
const connection = process.env.VNEXT_VALIDATION_OWNER_URL,
  port = Number(process.env.P2_07_HTTP_PORT ?? "0");
if (!connection || !Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("SERVER_CONTEXT_REQUIRED");
const server = await createDepartmentTestServer(
  connection,
  departmentTestKeys(
    JSON.parse(readFileSync(process.env.VNEXT_TEST_RECEIPT, "utf8")),
  ),
);
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  await server.close();
  process.exitCode = 0;
  process.disconnect();
};
process.on("message", (message) => {
  if (message === "SHUTDOWN") void close().catch(() => process.exit(1));
});
process.on("SIGTERM", () => void close().catch(() => process.exit(1)));
process.on("disconnect", () => {
  if (!closing) void close();
});
const url = await server.app.listen({ host: "127.0.0.1", port });
process.send({ status: "READY", pid: process.pid, url });
