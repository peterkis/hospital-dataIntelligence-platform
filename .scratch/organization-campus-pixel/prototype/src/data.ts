import type { Node, Edge } from "@xyflow/react";

export type EntityKind = "机构主体" | "院区" | "部门" | "服务单元";
export type EntityData = {
  name: string;
  code: string;
  kind: EntityKind;
  status: string;
  draft?: boolean;
  campus?: string;
  unitType?: string;
};
export type EntityNode = Node<EntityData, "entity">;
export type RelationData = {
  label: string;
  from: string;
  to?: string;
  purpose: string;
};
export type RelationEdge = Edge<RelationData, "relation">;

export function initialNodes(): EntityNode[] {
  return [
    {
      id: "org-1",
      type: "entity",
      position: { x: 220, y: 137 },
      data: {
        kind: "机构主体",
        name: "澄川医院",
        code: "ORG-0001",
        status: "示例持证登记",
      },
    },
    {
      id: "north",
      type: "entity",
      position: { x: 665, y: 46 },
      data: {
        kind: "院区",
        name: "北院区",
        code: "CAMPUS-N",
        status: "运行",
        campus: "north",
      },
    },
    {
      id: "south",
      type: "entity",
      position: { x: 665, y: 227 },
      data: {
        kind: "院区",
        name: "南院区",
        code: "CAMPUS-S",
        status: "运行",
        campus: "south",
      },
    },
    {
      id: "org-2",
      type: "entity",
      position: { x: 220, y: 417 },
      data: {
        kind: "机构主体",
        name: "澄川医院康复服务中心",
        code: "ORG-0002",
        status: "新建草稿",
        draft: true,
      },
    },
    {
      id: "east",
      type: "entity",
      position: { x: 665, y: 407 },
      data: {
        kind: "院区",
        name: "东院区",
        code: "CAMPUS-E",
        status: "筹建",
        campus: "east",
      },
    },
  ];
}

export const unitNodes: EntityNode[] = [
  {
    id: "dept-respiratory",
    type: "entity",
    position: { x: 440, y: 70 },
    data: { kind: "部门", name: "呼吸内科", code: "DEPT-RESP", status: "运行" },
  },
  {
    id: "unit-outpatient",
    type: "entity",
    position: { x: 755, y: 60 },
    data: {
      kind: "服务单元",
      name: "北院区呼吸门诊单元",
      code: "UNIT-RESP-OP",
      status: "运行",
      campus: "north",
      unitType: "门诊单元",
    },
  },
  {
    id: "unit-inpatient",
    type: "entity",
    position: { x: 755, y: 230 },
    data: {
      kind: "服务单元",
      name: "南院区呼吸住院单元",
      code: "UNIT-RESP-IP",
      status: "运行",
      campus: "south",
      unitType: "住院单元",
    },
  },
];

function relation(
  id: string,
  source: string,
  target: string,
  label: string,
  from: string,
  purpose: string,
): RelationEdge {
  return {
    id,
    source,
    target,
    sourceHandle: "right",
    targetHandle: "left",
    type: "relation",
    data: { label, from, purpose },
  };
}
export const baseRelations = [
  relation(
    "operate-north",
    "org-1",
    "north",
    "运营 · 主运营方",
    "2024-01-01",
    "澄川医院作为北院区的主运营方。",
  ),
  relation(
    "operate-south",
    "org-1",
    "south",
    "运营 · 主运营方",
    "2025-06-01",
    "澄川医院作为南院区的主运营方。",
  ),
];
export const unitRelations = [
  relation(
    "department-ownership",
    "org-1",
    "dept-respiratory",
    "组织归属",
    "2024-01-01",
    "部门承担稳定的组织与专业责任。",
  ),
  relation(
    "outpatient-ownership",
    "dept-respiratory",
    "unit-outpatient",
    "组织归属 · 门诊单元",
    "2024-01-01",
    "呼吸内科在北院区开展门诊业务。",
  ),
  relation(
    "inpatient-ownership",
    "dept-respiratory",
    "unit-inpatient",
    "组织归属 · 住院单元",
    "2025-06-01",
    "呼吸内科在南院区开展住院业务；病区和床位范围另行表达。",
  ),
];
