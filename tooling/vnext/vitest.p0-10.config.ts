import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tooling/vnext/p0-10-gate.test.ts"],
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--import", "tsx"],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
