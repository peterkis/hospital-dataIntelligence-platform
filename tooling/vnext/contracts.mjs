import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.ts";
import { verifyCurrentContract,verifyVNextCallerRegistration } from "./current-contract.mjs";
import { departmentUiContract } from "./department-ui-contract.mjs";
import { careUiContract,careOperationClient } from './care-ui-contract.mjs';
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check"))
  throw new Error("CLOSED_COMMAND_REQUIRED");
const verify = args[0] === "--check";
const app = await buildCatalogServer();
await app.ready();
const current = app.swagger(),
  directory = resolve(".runtime/vnext/current-contract", randomUUID());
verifyVNextCallerRegistration(current,JSON.parse(readFileSync('docs/vnext/current-callers.json','utf8')),path=>existsSync(resolve(path)));
const uiPath = "apps/admin-web/src/vnext/department-forms.generated.ts",
  ui = departmentUiContract(current);
if (verify) {
  if (!existsSync(uiPath) || readFileSync(uiPath, "utf8") !== ui)
    throw new Error("CURRENT_UI_CONTRACT_DRIFT");
} else writeFileSync(uiPath, ui);
const careUiPath='apps/admin-web/src/vnext/care-forms.generated.ts',careUi=careUiContract(current);
if(verify){if(!existsSync(careUiPath)||readFileSync(careUiPath,'utf8')!==careUi)throw new Error('CURRENT_CARE_UI_CONTRACT_DRIFT');}else writeFileSync(careUiPath,careUi);
const careClientPath='packages/generated-api-client/src/care-operation-client.generated.ts',careClient=careOperationClient(current);
if(verify){if(!existsSync(careClientPath)||readFileSync(careClientPath,'utf8')!==careClient)throw new Error('CURRENT_CARE_OPERATION_CLIENT_DRIFT');}else writeFileSync(careClientPath,careClient);
if (verify) mkdirSync(directory, { recursive: true });
const apiPath = verify
  ? resolve(directory, "openapi.json")
  : "contracts/openapi/vnext-catalog.openapi.json";
const clientPath = verify
  ? resolve(directory, "client.ts")
  : "packages/generated-api-client/src/vnext-schema.generated.ts";
writeFileSync(apiPath, JSON.stringify(current, null, 2) + "\n");
await app.close();
// The generator requires TypeScript 5; its locked tooling workspace keeps the
// application's TypeScript 7 compiler independent and needs no machine cache.
const generatorRequire = createRequire(
  resolve("tooling/openapi-generator/package.json"),
);
const cli = resolve(
  dirname(generatorRequire.resolve("openapi-typescript")),
  "../bin/cli.js",
);
if (!existsSync(cli)) throw new Error("LOCAL_OPENAPI_GENERATOR_MISSING");
const result = spawnSync(process.execPath, [cli, apiPath, "-o", clientPath], {
  stdio: "inherit",
  windowsHide: true,
});
if (result.status !== 0) process.exitCode = 1;
else if (verify)
  console.log(
    JSON.stringify(
      verifyCurrentContract(
        current,
        JSON.parse(
          readFileSync("contracts/openapi/vnext-catalog.openapi.json", "utf8"),
        ),
        readFileSync(clientPath, "utf8"),
        readFileSync(
          "packages/generated-api-client/src/vnext-schema.generated.ts",
          "utf8",
        ),
      ),
    ),
  );
