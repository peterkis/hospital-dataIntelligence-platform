import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tooling/vnext/p0-10-gate.test.ts", "tooling/vnext/p0-10-evidence.test.ts", "apps/governance-api/src/modules/governance-catalog/p0-10-parser.test.ts"],
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--import", "tsx"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
