/** UI forms are selected from the current public OpenAPI contract, not a second DTO. */
export function departmentUiContract(api) {
  const prefixes = [
    "/api/vnext/departments/",
    "/api/vnext/hierarchy/",
    "/api/vnext/organization-mappings/",
    "/api/vnext/organization-identifiers/",
    "/api/vnext/organization-evolutions/",
    "/api/vnext/department-lifecycle/",
    "/api/vnext/department-impacts/",
  ];
  const resolve = (node) => {
    if (!node || typeof node !== "object") return node;
    if (node.$ref) {
      let target = api;
      for (const part of node.$ref.slice(2).split("/")) target = target[part];
      return resolve(target);
    }
    return Object.fromEntries(
      Object.entries(node).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.map(resolve) : resolve(value),
      ]),
    );
  };
  const operations = {};
  for (const [path, methods] of Object.entries(api.paths))
    if (prefixes.some((prefix) => path.startsWith(prefix)))
      for (const [method, operation] of Object.entries(methods))
        if (method === "post" && operation.requestBody)
          operations[operation.operationId] = {
            path,
            schema: resolve(
              operation.requestBody.content["application/json"].schema,
            ),
          };
  const stages = {
    DEPARTMENT: "stageDepartment",
    HIERARCHY: "importHierarchyCandidate",
    MAPPING: "stageOrganizationMappings",
    IDENTIFIER: "stageOrganizationIdentifiers",
    EVOLUTION: "stageOrganizationEvolution",
    LIFECYCLE: "stageDepartmentLifecycle",
    IMPACT: "recordDepartmentImpactDisposition",
  };
  const controls = new Set([
    "requestId",
    "jobId",
    "revisionId",
    "campus",
    "profile",
  ]);
  const drafts = Object.fromEntries(
    Object.entries(stages).map(([kind, operation]) => {
      const schema = structuredClone(operations[operation].schema);
      schema.properties = Object.fromEntries(
        Object.entries(schema.properties).filter(([key]) => !controls.has(key)),
      );
      schema.required = schema.required.filter((key) => !controls.has(key));
      return [kind, schema];
    }),
  );
  return (
    "// Generated from current public OpenAPI. Run vnext:contract:generate.\nexport const departmentForms = " +
    JSON.stringify({ operations, drafts }, null, 2) +
    " as const;\n"
  );
}
