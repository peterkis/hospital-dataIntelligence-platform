import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tooling/vnext/workbench-status.test.ts",
      "tooling/vnext/workbench-file.test.ts",
    ],
    pool: "forks",
    fileParallelism: false,
    execArgv: ["--import", "tsx"],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
