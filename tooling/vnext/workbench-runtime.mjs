import {assertWardNursingProvisioned} from './p3-05-provisioning.mjs';
import {wardNursingUpstreamPorts} from '../../apps/governance-api/src/composition/ward-nursing-dependencies.ts';
import {assertUnitWardProvisioned} from './p3-04-provisioning.mjs';
import {unitWardUpstreamPorts} from '../../apps/governance-api/src/composition/unit-ward-dependencies.ts';
import {unitCapabilityUpstreamPorts} from '../../apps/governance-api/src/composition/unit-capability-dependencies.ts';
import {assertUnitCapabilityProvisioned} from './p3-08-provisioning.mjs';
import {assertSubjectsProvisioned} from './p3-09-provisioning.mjs';
import {openSubjectCodes} from '../../apps/governance-api/src/modules/governance-catalog/index.ts';
import {openSubjectPermissions} from '../../apps/governance-api/src/modules/care-organization/index.ts';
import {wardUpstreamPorts} from '../../apps/governance-api/src/composition/ward-dependencies.ts';
import {assertWardProvisioned} from './p3-02-provisioning.mjs';
import {withCareOrganizationImpacts,nursingUpstreamPorts} from '../../apps/governance-api/src/composition/nursing-unit-dependencies.ts';
import {assertNursingUnitProvisioned} from './p3-03-provisioning.mjs';
import {openBusinessUnit,openNursingUnit,openWard,openUnitCapabilities,openUnitWardRelations,openWardNursingCoverage} from '../../apps/governance-api/src/modules/care-organization/index.ts';
import {assertBusinessUnitProvisioned} from './p3-01-provisioning.mjs';
import {openLocation,openLocationUsageTypes,openLocationUse} from '../../apps/governance-api/src/modules/location-master/index.ts';
import {locationUseUpstreamPorts} from '../../apps/governance-api/src/composition/location-use-dependencies.ts';
import {assertLocationUseProvisioned} from './p3-07-provisioning.mjs';
import pg from 'pg';
import {assertLocationProvisioned} from './p3-06-provisioning.mjs';
import {assertDepartmentLifecycleProvisioned} from './department-lifecycle-provisioning.mjs';
import {assertDepartmentImpactsProvisioned} from './department-impact-provisioning.mjs';
import {openDepartment,openDepartmentWorkspace,openHierarchy,openOrganizationMappings,openOrganizationIdentifiers,openOrganizationEvolutions,openDepartmentLifecycle} from '../../apps/governance-api/src/modules/department-master/index.ts';
import {assertOrganizationEvolutionsProvisioned} from './organization-evolution-provisioning.mjs';
import {assertOrganizationIdentifiersProvisioned} from './organization-identifier-provisioning.mjs';
import {assertOrganizationMappingsProvisioned} from './organization-mapping-provisioning.mjs';
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import staticPlugin from "@fastify/static";
import { createTemporary, dropTemporary } from "./fresh.mjs";
import {
  createValidationOwnerSession,
  dropValidationOwnerSession,
} from "./validation-owner-session.mjs";
import {
  readReceipt,
  migrate,
  migrationFiles,
  peer,
  quote,
  root,
  inspect,
  resolveTarget,
  identitySQL,
} from "./lineage.mjs";
import { workspaceStartupPrefix } from "./workspace-migrations.mjs";
import { ownerServiceConnection } from "./owner-service.mjs";
import { seed } from "./catalog-seed.mjs";
import {
  openCatalog,
  openParameterValues,
  LocalSyntheticKeyProvider,
} from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.ts";
import { fixture } from "./protected-fixture.ts";
import { fileOwner } from "./workbench-owner.ts";
import {organizationKeys} from './organization-keys.mjs';
import {assertDepartmentProvisioned} from './department-provisioning.mjs';
import {grantHierarchyFunctions,assertHierarchyProvisioned} from './hierarchy-provisioning.mjs';
import {openOrganization,openCampus,openOperatingRelations,openOrganizationImport,openOrganizationWorkspace} from '../../apps/governance-api/src/modules/organization-master/index.ts';
import {actor as syntheticActor} from '../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts';


export async function startWorkbench({
  persistent = false,
  upgrade = false,
  finite = false,
  port = 4317,
  validationContext,
} = {}) {
  if(validationContext&&(persistent||upgrade||finite))throw new Error('VALIDATION_CONTEXT_EXCLUSIVE');
  if (persistent && finite) throw new Error("FINITE_OWNER_TEMPORARY_ONLY");
  const owned = persistent||validationContext ? null : createTemporary("P0-09");
  const receipt = validationContext?.receipt??owned?.receipt ?? readReceipt();
  if(validationContext){
    if(receipt.purpose!=='TEMPORARY_VALIDATION'||!/^hdi_mc_vnext_[a-f0-9]{16}$/u.test(receipt.name))throw new Error('TEMPORARY_VALIDATION_REQUIRED');
    if(JSON.stringify(readReceipt(resolve(root,'.runtime/vnext/fresh',receipt.name+'.json')))!==JSON.stringify(receipt))throw new Error('RECEIPT_IDENTITY_MISMATCH');
    if(!/^hdi_validation_[a-f0-9]{16}$/u.test(decodeURIComponent(new URL(validationContext.connection).username)))throw new Error('TEMPORARY_VALIDATION_OWNER_REQUIRED');
  }
  let unitWard;
  let wardNursing;
  let locationUsageTypes,locationUse;
  let session, catalog, app, organization, campus, operating, organizationImport, organizationWorkspace, department, hierarchy, mapping, identifiers, evolutions, departmentLifecycle, departmentWorkspace, location, businessUnit, nursingUnit, ward, parameterValues, unitCapabilities, subjectCodes, subjectPermissions;
  const close = async () => {
    await app?.close();
    await locationUse?.close();
    await locationUsageTypes?.close();
    await organization?.close();
    await campus?.close();
    await operating?.close();
    await organizationImport?.close();
    await organizationWorkspace?.close();
    await departmentWorkspace?.close();
    await department?.close();
    await hierarchy?.close();
    await mapping?.close();
    await identifiers?.close();
    await evolutions?.close();
    await departmentLifecycle?.close();
    await location?.close();
    await unitCapabilities?.close();
    await wardNursing?.close();
    await unitWard?.close();
    await subjectPermissions?.close();
    await subjectCodes?.close();
    await parameterValues?.close();
    await ward?.close();
    await nursingUnit?.close();
    await businessUnit?.close();
    await catalog?.close();
    if (owned) {
      if (finite)
        peer(
          receipt.name,
          identitySQL(receipt) + " DROP SCHEMA IF EXISTS p0_09_owner CASCADE;",
        );
      dropTemporary(receipt);
      if (session) dropValidationOwnerSession(session);
    }
  };
  try {
    // Inspect once, before loading credentials/keys, constructing Owners or
    // listening. Never expose workspace routes backed by unrepaired SQL.
    const suppliedInspection=validationContext?await inspect(receipt):null;
    const persistentPrefix = persistent||validationContext
      ? workspaceStartupPrefix(migrationFiles(), (suppliedInspection??await inspect(receipt)).ledger)
      : 0;
    if (owned) {
      if (upgrade) {
        await migrate(receipt, migrationFiles().slice(0, 52));
        await seed(receipt);
      }
      const before = upgrade ? await inspect(receipt) : null;
      await migrate(receipt);
      await seed(receipt);
      if (before)
        assert.deepEqual(
          (await inspect(receipt)).ledger.slice(0, 52),
          before.ledger,
        );
      session = await createValidationOwnerSession(receipt);
      grantHierarchyFunctions(receipt,session.receipt);
      const types = spawnSync(
        process.execPath,
        ["tooling/vnext/managed.mjs", "types-verify", owned.receiptPath],
        { cwd: root, env: process.env, encoding: "utf8", windowsHide: true },
      );
      if (types.status !== 0) throw new Error("WORKBENCH_TYPES_FAILED");
    }
    const connection = validationContext?.connection??(owned
      ? session.connectionString
      : await ownerServiceConnection());
    // An installed persistent Owner must never silently fall back to fresh keys.
    const organizationReady=persistent;
    const provider = validationContext?.provider??(organizationReady?organizationKeys(receipt):new LocalSyntheticKeyProvider());
    if(validationContext){
      const connectionCheck=new pg.Pool({connectionString:connection,max:1});
      try{await connectionCheck.query(identitySQL(receipt));assert.deepEqual((await connectionCheck.query('select id,sha256 from vnext_control.migration order by id')).rows,suppliedInspection.ledger);}
      finally{await connectionCheck.end();}
      await assertLocationUseProvisioned(connection,provider);
      if(!validationContext.locationUse?.usageTypes)throw new Error('BLOCKED_DEPENDENCY');
    }
    if(persistent&&persistentPrefix>=174)await assertUnitCapabilityProvisioned(connection,provider);
    if(persistent&&persistentPrefix>=188)await assertUnitWardProvisioned(connection,provider);
    if(persistent&&persistentPrefix>=198)await assertWardNursingProvisioned(connection,provider);
    if(persistent&&persistentPrefix>=201)await assertLocationUseProvisioned(connection,provider);
    if(persistent&&persistentPrefix>=178)await assertSubjectsProvisioned(connection,provider);
    if(persistent&&persistentPrefix>=167)await assertWardProvisioned(connection,provider);
    if(organizationReady){organization=openOrganization(connection,provider);campus=openCampus(connection,provider,{owners:['BUSINESS_UNIT','NURSING_UNIT','WARD','UNIT_CAPABILITY','UNIT_WARD_RELATION','WARD_NURSING_COVERAGE'],readInTransaction:(s,a,i)=>{if(!businessUnit)throw new Error('BLOCKED_DEPENDENCY');return Promise.all([businessUnit.readCampusDependenciesInTransaction(s,a,i),nursingUnit?.readCampusDependenciesInTransaction(s,a,i)??[],ward?.readCampusDependenciesInTransaction(s,a,i)??[],unitCapabilities?.readCampusDependenciesInTransaction(s,a,i)??[],unitWard?.readCampusDependenciesInTransaction(s,a,i)??[],wardNursing?.readCampusDependenciesInTransaction(s,a,i)??[]]).then(parts=>parts.flat());;}});operating=openOperatingRelations(connection,provider);}
    if(persistent&&persistentPrefix>=69)organizationImport=openOrganizationImport(connection,provider);
    if(persistent&&persistentPrefix>=71)organizationWorkspace=openOrganizationWorkspace(connection,provider);
    if(persistent&&persistentPrefix>=144)departmentWorkspace=openDepartmentWorkspace(connection,provider);
    if(persistent&&persistentPrefix>=87){await assertDepartmentProvisioned(connection,provider);department=openDepartment(connection,provider);}
    if(owned||persistentPrefix>=109){await assertHierarchyProvisioned(connection);hierarchy=openHierarchy(connection,provider);}
    if(persistent&&persistentPrefix>=112){await assertOrganizationMappingsProvisioned(connection,provider);mapping=openOrganizationMappings(connection,provider);}
    if(persistent&&persistentPrefix>=116){await assertOrganizationIdentifiersProvisioned(connection,provider);identifiers=openOrganizationIdentifiers(connection,provider);}
    if(persistent&&persistentPrefix>=122)await assertDepartmentImpactsProvisioned(connection);
    if(persistent&&persistentPrefix>=118){await assertOrganizationEvolutionsProvisioned(connection,provider);evolutions=openOrganizationEvolutions(connection,provider,withCareOrganizationImpacts(()=>businessUnit,()=>nursingUnit,()=>ward,()=>unitCapabilities,()=>unitWard,()=>wardNursing));}
    if(persistent&&persistentPrefix>=139){await assertDepartmentLifecycleProvisioned(connection);departmentLifecycle=openDepartmentLifecycle(connection,provider,withCareOrganizationImpacts(()=>businessUnit,()=>nursingUnit,()=>ward,()=>unitCapabilities,()=>unitWard,()=>wardNursing));}
    if(persistent&&persistentPrefix>=150){await assertLocationProvisioned(connection,provider);location=openLocation(connection,provider,campus.references);}
    if(persistent&&persistentPrefix>=154){await assertBusinessUnitProvisioned(connection,provider);businessUnit=openBusinessUnit(connection,provider,{departmentCoverage:departmentLifecycle.readUnitBindingCoverageInTransaction,departmentBoundaries:departmentLifecycle.readUnitBindingBoundariesInTransaction,referenceAccess:departmentLifecycle.authorizeUnitReferenceInTransaction,operatingWindow:operating.evaluateOperatingWindowInTransaction});}
    if(persistent&&persistentPrefix>=163){await assertNursingUnitProvisioned(connection,provider);nursingUnit=openNursingUnit(connection,provider,nursingUpstreamPorts,{wardNursingCoveragesAvailable:()=>!!wardNursing});}
    if(persistent&&persistentPrefix>=167){ward=openWard(connection,provider,wardUpstreamPorts(businessUnit),{wardNursingCoveragesAvailable:()=>!!wardNursing});}
    if(persistent&&persistentPrefix>=174){parameterValues=openParameterValues(connection);unitCapabilities=openUnitCapabilities(connection,provider,unitCapabilityUpstreamPorts(businessUnit,parameterValues));}
    if(persistent&&persistentPrefix>=188){unitWard=openUnitWardRelations(connection,provider,unitWardUpstreamPorts(businessUnit,ward));}
    if(persistent&&persistentPrefix>=198){wardNursing=openWardNursingCoverage(connection,provider,wardNursingUpstreamPorts(ward,nursingUnit,businessUnit));}
    if(persistent&&persistentPrefix>=201){locationUsageTypes=openLocationUsageTypes(connection,provider);}
    if(persistent&&persistentPrefix>=203){if(!location||!departmentLifecycle||!businessUnit||!ward||!nursingUnit||!locationUsageTypes)throw new Error('BLOCKED_DEPENDENCY');locationUse=openLocationUse(connection,provider,locationUseUpstreamPorts(location,departmentLifecycle,businessUnit,ward,nursingUnit),locationUsageTypes);}
    if(persistent&&persistentPrefix>=178){subjectCodes=openSubjectCodes(connection,provider);subjectPermissions=openSubjectPermissions(connection,provider,{operatingWindow:operating.evaluateOperatingWindowInTransaction});}
    catalog = await openCatalog(connection, provider);
    let setup;
    if (owned) {
      const f = await fixture(catalog, {
        businessKey: true,
        textField: true,
        ruleVersion: finite ? "FINITE_FILE_E2E_V1" : "WORKBENCH_CONTROL_V1",
      });
      const contract = (
        await catalog.contractRead("maker", {
          scope: "SYNTHETIC",
          mode: "HISTORY",
          target: f.contract.id,
          versionId: f.contract.versionId,
        })
      )[0];
      for (const actor of ["maker", "maker-alias"])
        for (const permission of ["STORE", "READ"])
          peer(
            receipt.name,
            `INSERT INTO vnext_control.protected_grant VALUES(${quote(actor)},${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY',${quote(permission)}) ON CONFLICT DO NOTHING;`,
          );
      setup = { contract, field: contract.definition.fields[0].code };
      if (finite) {
        peer(
          receipt.name,
          `INSERT INTO vnext_control.protected_grant VALUES('reviewer',${quote(f.dataset.id)}::uuid,'NORTH','IDENTITY_VERIFY','READ') ON CONFLICT DO NOTHING;`,
        );
        peer(
          receipt.name,
          readFileSync(
            resolve(root, "tooling/vnext/workbench-owner.sql"),
            "utf8",
          ),
        );
        peer(
          receipt.name,
          `GRANT USAGE ON SCHEMA p0_09_owner TO ${session.receipt.role}; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA p0_09_owner TO ${session.receipt.role}; GRANT EXECUTE ON FUNCTION governance_catalog.apply_record(text,text,jsonb),vnext_control.authorize(text,text,text),governance_catalog.contract_require_access(text,text,uuid,text) TO ${session.receipt.role};`,
        );
        await catalog.close();
        catalog = await openCatalog(
          connection,
          provider,
          fileOwner(provider, contract.versionId),
        );
      }
    }
    app = await buildCatalogServer(
      catalog,
      finite ? "FINITE_E2E" : "CONTROL_PLANE",
      organization?{owner:organization,actor:r=>syntheticActor(r.headers)}:undefined,
      campus?{owner:campus,references:campus.references,actor:r=>syntheticActor(r.headers)}:undefined,
      operating?{owner:operating,actor:r=>syntheticActor(r.headers)}:undefined,
      organizationImport?{owner:organizationImport,actor:r=>syntheticActor(r.headers)}:undefined,
      organizationWorkspace?{owner:organizationWorkspace,actor:r=>syntheticActor(r.headers)}:undefined,
      department?{owner:department,actor:r=>syntheticActor(r.headers)}:undefined,
      hierarchy?{owner:hierarchy,actor:r=>syntheticActor(r.headers)}:undefined,
      mapping?{owner:mapping,actor:r=>syntheticActor(r.headers)}:undefined,
      identifiers?{owner:identifiers,actor:r=>syntheticActor(r.headers)}:undefined,
      evolutions?{owner:evolutions,actor:r=>syntheticActor(r.headers)}:undefined,
      departmentLifecycle?{owner:departmentLifecycle,actor:r=>syntheticActor(r.headers)}:undefined,
      departmentWorkspace?{owner:departmentWorkspace,actor:r=>syntheticActor(r.headers)}:undefined,
      location?{owner:location,actor:r=>syntheticActor(r.headers)}:undefined,
      businessUnit?{owner:businessUnit,actor:r=>syntheticActor(r.headers)}:undefined,
      nursingUnit?{owner:nursingUnit,actor:r=>syntheticActor(r.headers)}:undefined,
      ward?{owner:ward,actor:r=>syntheticActor(r.headers)}:undefined,
      parameterValues?{owner:parameterValues,actor:r=>syntheticActor(r.headers)}:undefined,
      unitCapabilities?{owner:unitCapabilities,actor:r=>syntheticActor(r.headers)}:undefined,
      subjectCodes?{owner:subjectCodes,actor:r=>syntheticActor(r.headers)}:undefined,
      subjectPermissions?{owner:subjectPermissions,actor:r=>syntheticActor(r.headers)}:undefined,
      unitWard?{owner:unitWard,actor:r=>syntheticActor(r.headers)}:undefined,
      wardNursing?{owner:wardNursing,actor:r=>syntheticActor(r.headers)}:undefined,
      validationContext?.locationUse??(locationUsageTypes?{owner:locationUse,usageTypes:locationUsageTypes,actor:r=>syntheticActor(r.headers)}:undefined),
    );
    await app.register(staticPlugin, {
      root: resolve(root, "apps/admin-web/dist-vnext"),
      prefix: "/admin/vnext/",
    });
    for (const path of [
      "catalog",
      "contracts",
      "parameter-definitions",
      "imports",
      "organizations",
      "departments",
      "location-usage-types",
    ])
      app.get("/admin/vnext/" + path, (_req, reply) =>
        reply.sendFile("vnext.html"),
      );
    if(validationContext?.beforeListen)await validationContext.beforeListen(app);
    const url=await app.listen({ host: "127.0.0.1", port });
    return {
      app,
      catalog,
      provider,
      receipt,
      receiptPath: owned?.receiptPath,
      setup,
      close,
      url,
      finite,
    };
  } catch (error) {
    session ??= error.ownerSession;
    await close();
    throw error;
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  const args = process.argv.slice(2);
  if (args.some((a) => !["--persistent", "--upgrade", "--finite"].includes(a)))
    throw new Error("CLOSED_COMMAND_REQUIRED");
  const runtime = await startWorkbench({
    persistent: args.includes("--persistent"),
    upgrade: args.includes("--upgrade"),
    finite: args.includes("--finite"),
  });
  const stopFile = resolve(root, ".runtime/vnext/p0-09/stop-" + process.pid);
  try {
    writeFileSync(
      resolve(root, ".runtime/vnext/p0-09/server.json"),
      JSON.stringify({
        url: runtime.url,
        stopFile,
        finite: runtime.finite,
        receipt: runtime.receiptPath ?? ".runtime/vnext/creation.json",
        setup: runtime.setup,
      }),
    );
    console.log(
      JSON.stringify({
        status: "WORKBENCH_READY",
        url: runtime.url + "/admin/vnext/imports",
        finite: runtime.finite,
      }),
    );
    while (!existsSync(stopFile)) await delay(500);
  } finally {
    await runtime.close();
  }
}
