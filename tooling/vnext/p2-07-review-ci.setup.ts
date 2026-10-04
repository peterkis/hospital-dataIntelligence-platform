import { vi, afterAll } from "vitest";
// Replace only WSL administrative transport; keep real SQL roles, crypto,
// public Owners, transactions and HTTP requests in the isolated CI database.
vi.mock("./lineage.mjs", async (importOriginal) => {
  const original = await importOriginal<typeof import("./lineage.mjs")>();
  const ci = await import("./review-ci-database.mjs");
  return {
    ...original,
    peer: ci.peer,
    inspect: ci.inspect,
    resolveTarget: ci.resolveTarget,
  };
});
const { provision, peer } = await import("./review-ci-database.mjs");
const database = await provision();
afterAll(async () => {
  await database.close();
});
const { seed } = await import("./catalog-seed.mjs");
await seed(database.receipt);
const role = new URL(process.env["VNEXT_VALIDATION_OWNER_URL"]!).username;
const { grantDepartment } = await import("./p2-01-validate.mjs");
const { grantOrganization } = await import("./p1-02-validate.mjs");
grantDepartment(database.receipt, role);
grantOrganization(database.receipt, role);
peer(database.receipt.name, `ALTER ROLE ${role} CONNECTION LIMIT 8;`);
