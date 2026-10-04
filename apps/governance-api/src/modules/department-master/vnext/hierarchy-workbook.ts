import { Type, type Static } from "typebox";
import { Check } from "typebox/value";
import {
  parseHierarchyWorkbookBounded,
  textSheetsWorkbook,
  type ParserField,
  type HierarchySheet,
} from "../../governance-catalog/index.js";
import {
  HierarchyCandidateSchema,
  HierarchyEdgeEvidenceSchema,
} from "./hierarchy.js";
import { Id } from "./contracts.js";
const closed = { additionalProperties: false } as const;
export const HierarchyWorkspaceFileSchema = Type.Object(
  {
    requestId: Id,
    campus: Type.Enum(["NORTH", "SOUTH"]),
    profile: Type.Enum(["CORE", "FULL"]),
    filename: Type.String({ minLength: 1, maxLength: 256 }),
    bytesBase64: Type.String({
      maxLength: 1398104,
      pattern:
        "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
    }),
  },
  closed,
);
export type HierarchyWorkspaceFile = Static<
  typeof HierarchyWorkspaceFileSchema
>;
export const HierarchyWorkspaceTemplateSchema = Type.Object(
  {
    campus: Type.Enum(["NORTH", "SOUTH"]),
    profile: Type.Enum(["CORE", "FULL"]),
  },
  closed,
);
const PayloadSchema = Type.Omit(HierarchyCandidateSchema, [
  "requestId",
  "profile",
  "dependencies",
]);
const viewColumns = Object.keys(PayloadSchema.properties).filter(
  (key) => key !== "nodes",
);
const nodeColumns = [
  "nodeKey",
  "parentNodeKey",
  "nodeKind",
  "departmentId",
  "departmentVersionId",
  "groupCode",
  "groupId",
  "groupVersionId",
  "displayName",
  "relationName",
  "sortOrder",
  "isPrimaryPath",
  ...Object.keys(HierarchyEdgeEvidenceSchema.properties).map(
    (key) => "edge_" + key,
  ),
];
const fields: Record<HierarchySheet, ParserField[]> = {
  ORG05: viewColumns.map((code) => ({ code, type: "string" })),
  ORG06: nodeColumns.map((code) => ({ code, type: "string" })),
};
export function hierarchyCoreTemplate() {
  return textSheetsWorkbook({ ORG05: [viewColumns], ORG06: [nodeColumns] });
}
export async function parseHierarchyCoreFile(bytes: Uint8Array) {
  const parsed = await parseHierarchyWorkbookBounded(bytes, fields);
  const fail = (sheet: string, row: number, code: string) => ({
    structuralStatus: "REJECTED" as const,
    payload: null,
    issues: [{ sheet, row, column: 0, code }],
  });
  if (parsed.structuralStatus === "REJECTED")
    return {
      structuralStatus: parsed.structuralStatus,
      payload: null,
      issues: parsed.issues,
    };
  if (parsed.sheets.ORG05.rows.length !== 1)
    return fail("ORG05", 2, "ONE_COMPLETE_VIEW_REQUIRED");
  const header = { ...parsed.sheets.ORG05.rows[0]! } as Record<string, unknown>;
  for (const key of ["viewId", "ownerDepartmentId", "validTo"])
    if (header[key] === "") header[key] = null;
  const nodes: Record<string, unknown>[] = [];
  for (const [index, row] of parsed.sheets.ORG06.rows.entries()) {
    const group = row["nodeKind"] === "GROUP";
    if (
      group
        ? [row["departmentId"], row["departmentVersionId"]].some(Boolean)
        : [row["groupCode"], row["groupId"], row["groupVersionId"]].some(
            Boolean,
          )
    )
      return fail("ORG06", index + 2, "NODE_KIND_FIELDS");
    if (
      !/^(0|[1-9][0-9]*)$/.test(row["sortOrder"] ?? "") ||
      !["true", "false"].includes(row["isPrimaryPath"] ?? "")
    )
      return fail("ORG06", index + 2, "CLOSED_INPUT_REQUIRED");
    const common = {
      nodeKey: row["nodeKey"],
      parentNodeKey: row["parentNodeKey"] || null,
      nodeKind: row["nodeKind"],
      displayName: row["displayName"],
      relationName: row["relationName"],
      sortOrder: Number(row["sortOrder"]),
      isPrimaryPath: row["isPrimaryPath"] === "true",
      sourceEvidence: Object.fromEntries(
        Object.keys(HierarchyEdgeEvidenceSchema.properties).map((key) => [
          key,
          key === "validTo" ? row["edge_" + key] || null : row["edge_" + key],
        ]),
      ),
    };
    nodes.push(
      group
        ? {
            ...common,
            groupCode: row["groupCode"],
            groupId: row["groupId"] || null,
            groupVersionId: row["groupVersionId"] || null,
          }
        : {
            ...common,
            departmentId: row["departmentId"],
            departmentVersionId: row["departmentVersionId"],
          },
    );
  }
  const payload = { ...header, nodes };
  if (!Check(PayloadSchema, payload))
    return fail("ORG05", 2, "CLOSED_INPUT_REQUIRED");
  return { structuralStatus: "PARSED" as const, payload, issues: [] };
}
