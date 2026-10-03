import { test, expect } from "vitest";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.js";
import { verifyCurrentContract } from "./current-contract.mjs";
test("P2-07 current API edits require a matching current client artifact", async () => {
  const app = await buildCatalogServer();
  try {
    await app.ready();
    const current = app.swagger(),
      changed = structuredClone(current);
    changed.info.version = "SYNTHETIC_CONTRACT_CHANGE";
    expect(() =>
      verifyCurrentContract(
        changed,
        current,
        "current-client",
        "current-client",
      ),
    ).toThrow("CURRENT_API_CONTRACT_DRIFT");
    expect(() =>
      verifyCurrentContract(current, current, "new-client", "old-client"),
    ).toThrow("CURRENT_CLIENT_CONTRACT_DRIFT");
    expect(
      verifyCurrentContract(changed, changed, "new-client", "new-client")
        .status,
    ).toBe("PASS");
  } finally {
    await app.close();
  }
});
