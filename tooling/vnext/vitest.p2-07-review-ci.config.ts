import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: {
    alias: {
      "@hospital-data-intelligence/generated-api-client": fileURLToPath(
        new URL(
          "../../packages/generated-api-client/src/index.ts",
          import.meta.url,
        ),
      ),
    },
  },
  test: {
    include: ["tooling/vnext/p2-07-db.test.ts"],
    fileParallelism: false,
    execArgv: ["--import", "tsx"],
    setupFiles: ["tooling/vnext/p2-07-review-ci.setup.ts"],
    sequence: { hooks: "stack" },
    testTimeout: 90000,
    hookTimeout: 120000,
  },
});
