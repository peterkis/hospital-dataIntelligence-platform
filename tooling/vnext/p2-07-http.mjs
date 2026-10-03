import staticPlugin from "@fastify/static";
import { resolve } from "node:path";
import { openCatalog } from "../../apps/governance-api/src/modules/governance-catalog/index.ts";
import {
  openDepartment,
  openDepartmentWorkspace,
  openHierarchy,
  openOrganizationMappings,
  openOrganizationIdentifiers,
  openOrganizationEvolutions,
  openDepartmentLifecycle,
} from "../../apps/governance-api/src/modules/department-master/index.ts";
import {
  openOrganization,
  openCampus,
  openOperatingRelations,
  openOrganizationImport,
  openOrganizationWorkspace,
} from "../../apps/governance-api/src/modules/organization-master/index.ts";
import { buildCatalogServer } from "../../apps/governance-api/src/composition/build-vnext-catalog.ts";
import { actor } from "../../apps/governance-api/src/platform/fastify/vnext-catalog-routes.ts";

/** Same public Owners as the persistent workbench, on an owned synthetic test connection. */
export async function createDepartmentTestServer(connection, provider) {
  const catalog = await openCatalog(connection, provider),
    department = openDepartment(connection, provider),
    workspace = openDepartmentWorkspace(connection, provider),
    hierarchy = openHierarchy(connection, provider),
    mapping = openOrganizationMappings(connection, provider),
    identifier = openOrganizationIdentifiers(connection, provider),
    evolution = openOrganizationEvolutions(connection, provider),
    lifecycle = openDepartmentLifecycle(connection, provider),
    organization = openOrganization(connection, provider),
    campus = openCampus(connection, provider),
    operating = openOperatingRelations(connection, provider),
    organizationImport = openOrganizationImport(connection, provider),
    organizationWorkspace = openOrganizationWorkspace(connection, provider);
  const owners = [
    catalog,
    department,
    workspace,
    hierarchy,
    mapping,
    identifier,
    evolution,
    lifecycle,
    organization,
    campus,
    operating,
    organizationImport,
    organizationWorkspace,
  ];
  let app;
  try {
    const context = (owner) => ({ owner, actor: (r) => actor(r.headers) });
    app = await buildCatalogServer(
      catalog,
      "CONTROL_PLANE",
      context(organization),
      context(campus),
      context(operating),
      context(organizationImport),
      context(organizationWorkspace),
      context(department),
      context(hierarchy),
      context(mapping),
      context(identifier),
      context(evolution),
      context(lifecycle),
      context(workspace),
    );
    await app.register(staticPlugin, {
      root: resolve("apps/admin-web/dist-vnext"),
      prefix: "/admin/vnext/",
    });
    for (const page of ["departments", "catalog", "organizations", "imports"])
      app.get("/admin/vnext/" + page, (_request, reply) =>
        reply.sendFile("vnext.html"),
      );
    app.get("/p2-07/ready", async () => {
      await workspace.permissions("maker", {
        kind: "DEPARTMENT",
        campus: "NORTH",
      });
      return {
        status: "READY",
        scope: "SYNTHETIC_OWNED_TEMPORARY",
        pid: process.pid,
      };
    });
    return {
      app,
      workspace,
      hierarchy,
      async close() {
        await app?.close();
        for (const owner of owners) await owner.close();
      },
    };
  } catch (error) {
    await app?.close();
    for (const owner of owners) await owner.close();
    throw error;
  }
}
