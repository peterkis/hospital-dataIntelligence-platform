import { sql, type Kysely } from 'kysely';
import type { DB } from '../../platform/database/database-types.generated.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';

export const DEPARTMENT_MASTER_MODULE_ID = 'department-master' as const;

export type DepartmentType =
  | 'CLINICAL'
  | 'MEDICAL_TECHNOLOGY'
  | 'AUXILIARY'
  | 'ADMINISTRATIVE';
export type DepartmentBusinessStatus = 'ACTIVE' | 'SUSPENDED' | 'DEPRECATED' | 'SUPERSEDED';
export type GovernanceStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED';
export type DepartmentMappingType = 'DIRECT' | 'MANUAL' | 'SUGGESTED';
export type DepartmentMappingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type DepartmentHierarchyViewType =
  | 'ADMINISTRATIVE'
  | 'OPERATIONAL'
  | 'MEDICAL_RECORD'
  | 'FINANCE'
  | 'STATISTICAL';

export interface Department {
  readonly id: string;
  readonly departmentCode: string;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface DepartmentVersion {
  readonly id: string;
  readonly departmentId: string;
  readonly versionNo: string;
  readonly standardName: string;
  readonly shortName: string | null;
  readonly departmentType: DepartmentType;
  readonly clinicalFlag: boolean;
  readonly managementFlag: boolean;
  readonly businessStatus: DepartmentBusinessStatus;
  readonly governanceStatus: GovernanceStatus;
  readonly description: string | null;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly contentHash: Buffer;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface MasterDataSource {
  readonly id: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly systemType: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepartmentAlias {
  readonly id: string;
  readonly departmentId: string;
  readonly sourceSystem: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly mappingStatus: DepartmentMappingStatus;
  readonly confidenceScore: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepartmentMapping {
  readonly id: string;
  readonly departmentId: string;
  readonly sourceSystem: string;
  readonly sourceDepartmentCode: string;
  readonly sourceDepartmentName: string;
  readonly mappingType: DepartmentMappingType;
  readonly mappingStatus: DepartmentMappingStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepartmentQualityScore {
  readonly id: string;
  readonly departmentId: string;
  readonly completenessScore: string;
  readonly uniquenessScore: string;
  readonly standardizationScore: string;
  readonly overallScore: string;
  readonly calculatedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DepartmentHierarchyView {
  readonly id: string;
  readonly viewCode: string;
  readonly viewName: string;
  readonly viewType: DepartmentHierarchyViewType;
  readonly operationalEnabled: boolean;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface DepartmentHierarchyGroupVersion {
  readonly id: string;
  readonly groupId: string;
  readonly hierarchyViewId: string;
  readonly versionNo: string;
  readonly displayName: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly contentHash: Buffer;
}

export interface DepartmentHierarchyViewVersion {
  readonly id: string;
  readonly hierarchyViewId: string;
  readonly versionNo: string;
  readonly governanceStatus: GovernanceStatus;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
  readonly contentHash: Buffer;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

interface DepartmentHierarchyNodeBase {
  readonly id: string;
  readonly hierarchyViewVersionId: string;
  readonly hierarchyViewId: string;
  readonly parentNodeId: string | null;
  readonly displayName: string;
  readonly sortOrder: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DepartmentHierarchyNode = DepartmentHierarchyNodeBase & (
  | {
    readonly nodeKind: 'DEPARTMENT';
    readonly departmentId: string;
    readonly departmentVersionId: string;
    readonly groupId: null;
    readonly groupVersionId: null;
  }
  | {
    readonly nodeKind: 'GROUP';
    readonly departmentId: null;
    readonly departmentVersionId: null;
    readonly groupId: string;
    readonly groupVersionId: string;
  }
);

export interface DepartmentVersionContent {
  readonly standardName: string;
  readonly shortName: string | null;
  readonly departmentType: DepartmentType;
  readonly clinicalFlag: boolean;
  readonly managementFlag: boolean;
  readonly businessStatus: DepartmentBusinessStatus;
  readonly governanceStatus: GovernanceStatus;
  readonly description: string | null;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}

export type HierarchyNodeInput =
  | {
    readonly nodeKey: string;
    readonly parentNodeKey: string | null;
    readonly nodeKind: 'DEPARTMENT';
    readonly departmentId: string;
    readonly departmentVersionId: string;
    readonly displayName: string;
    readonly sortOrder: number;
  }
  | {
    readonly nodeKey: string;
    readonly parentNodeKey: string | null;
    readonly nodeKind: 'GROUP';
    readonly groupId: string;
    readonly groupVersionId: string;
    readonly displayName: string;
    readonly sortOrder: number;
  };

export interface DepartmentHierarchySnapshot {
  readonly view: DepartmentHierarchyView;
  readonly version: DepartmentHierarchyViewVersion;
  readonly nodes: readonly DepartmentHierarchyNode[];
}

export interface DepartmentMasterRepository {
  createDepartment(command: DepartmentVersionContent & {
    readonly departmentCode: string;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<{ readonly department: Department; readonly version: DepartmentVersion }>;
  createDepartmentVersion(command: DepartmentVersionContent & {
    readonly departmentId: string;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<DepartmentVersion>;
  findDepartmentByCode(departmentCode: string): Promise<Department | null>;
  listDepartmentVersions(departmentId: string): Promise<readonly DepartmentVersion[]>;
  findDepartmentVersionAsOf(command: {
    readonly departmentId: string;
    readonly businessAt: string;
    readonly recordAsOf: string;
  }): Promise<DepartmentVersion | null>;
  listSources(): Promise<readonly MasterDataSource[]>;
  addAlias(command: {
    readonly departmentId: string;
    readonly sourceSystem: string;
    readonly sourceCode: string;
    readonly sourceName: string;
    readonly mappingStatus: DepartmentMappingStatus;
    readonly confidenceScore: string | null;
  }): Promise<DepartmentAlias>;
  listAliases(departmentId: string): Promise<readonly DepartmentAlias[]>;
  addMapping(command: {
    readonly departmentId: string;
    readonly sourceSystem: string;
    readonly sourceDepartmentCode: string;
    readonly sourceDepartmentName: string;
    readonly mappingType: DepartmentMappingType;
    readonly mappingStatus: DepartmentMappingStatus;
  }): Promise<DepartmentMapping>;
  listMappings(departmentId: string): Promise<readonly DepartmentMapping[]>;
  recordQualityScore(command: {
    readonly departmentId: string;
    readonly completenessScore: string;
    readonly uniquenessScore: string;
    readonly standardizationScore: string;
    readonly calculatedAt: string;
  }): Promise<DepartmentQualityScore>;
  getLatestQualityScore(departmentId: string): Promise<DepartmentQualityScore | null>;
  createHierarchyView(command: {
    readonly viewCode: string;
    readonly viewName: string;
    readonly viewType: DepartmentHierarchyViewType;
    readonly actorPrincipalId: string;
  }): Promise<DepartmentHierarchyView>;
  createHierarchyGroupVersion(command: {
    readonly hierarchyViewId: string;
    readonly groupCode: string;
    readonly displayName: string;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
  }): Promise<DepartmentHierarchyGroupVersion>;
  createHierarchyViewVersion(command: {
    readonly hierarchyViewId: string;
    readonly governanceStatus: GovernanceStatus;
    readonly businessValidFrom: string;
    readonly businessValidTo: string | null;
    readonly recordedFrom: string;
    readonly actorPrincipalId: string;
    readonly nodes: readonly HierarchyNodeInput[];
  }): Promise<DepartmentHierarchySnapshot>;
  getHierarchySnapshot(hierarchyViewVersionId: string): Promise<DepartmentHierarchySnapshot | null>;
}

export function createDepartmentMasterRepository(database: Kysely<DB>): DepartmentMasterRepository {
  return {
    async createDepartment(command) {
      validateCode(command.departmentCode, 'DEPARTMENT_CODE_INVALID');
      validateDepartmentVersion(command);
      parseLocalDateTime(command.recordedFrom);
      const departmentId = await nextUuid(database);
      const departmentVersionId = await nextUuid(database);
      const versionNo = '1';
      const contentHash = departmentVersionHash({
        ...command,
        departmentId,
        departmentVersionId,
        versionNo,
      });
      const departmentRow = await database
        .insertInto('department_master.department')
        .values({
          department_id: departmentId,
          department_code: command.departmentCode,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const versionRow = await database
        .insertInto('department_master.department_version')
        .values({
          department_version_id: departmentVersionId,
          department_id: departmentId,
          version_no: versionNo,
          standard_name: command.standardName,
          short_name: command.shortName,
          department_type: command.departmentType,
          clinical_flag: command.clinicalFlag,
          management_flag: command.managementFlag,
          business_status: command.businessStatus,
          governance_status: command.governanceStatus,
          description: command.description,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          recorded_to: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return { department: toDepartment(departmentRow), version: toDepartmentVersion(versionRow) };
    },

    async createDepartmentVersion(command) {
      validateDepartmentVersion(command);
      parseLocalDateTime(command.recordedFrom);
      const department = await database
        .selectFrom('department_master.department')
        .select('department_id')
        .where('department_id', '=', command.departmentId)
        .forUpdate()
        .executeTakeFirst();
      if (!department) throw new Error('DEPARTMENT_NOT_FOUND');
      const current = await database
        .selectFrom('department_master.department_version')
        .select(['department_version_id', 'recorded_from', 'version_no'])
        .where('department_id', '=', command.departmentId)
        .where('recorded_to', 'is', null)
        .orderBy('version_no', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (current && command.recordedFrom <= current.recorded_from) {
        throw new Error('DEPARTMENT_RECORDED_TIME_CONFLICT');
      }
      if (current) {
        await database
          .updateTable('department_master.department_version')
          .set({
            recorded_to: command.recordedFrom,
            updated_at: sql<string>`platform.local_now()`,
            updated_by: command.actorPrincipalId,
          })
          .where('department_version_id', '=', current.department_version_id)
          .executeTakeFirstOrThrow();
      }
      const versionNo = String(BigInt(current?.version_no ?? '0') + 1n);
      const departmentVersionId = await nextUuid(database);
      const contentHash = departmentVersionHash({
        ...command,
        departmentId: command.departmentId,
        departmentVersionId,
        versionNo,
      });
      const row = await database
        .insertInto('department_master.department_version')
        .values({
          department_version_id: departmentVersionId,
          department_id: command.departmentId,
          version_no: versionNo,
          standard_name: command.standardName,
          short_name: command.shortName,
          department_type: command.departmentType,
          clinical_flag: command.clinicalFlag,
          management_flag: command.managementFlag,
          business_status: command.businessStatus,
          governance_status: command.governanceStatus,
          description: command.description,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          recorded_to: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await database
        .updateTable('department_master.department')
        .set({ updated_at: command.recordedFrom, updated_by: command.actorPrincipalId })
        .where('department_id', '=', command.departmentId)
        .executeTakeFirstOrThrow();
      return toDepartmentVersion(row);
    },

    async findDepartmentByCode(departmentCode) {
      const row = await database
        .selectFrom('department_master.department')
        .selectAll()
        .where('department_code', '=', departmentCode)
        .executeTakeFirst();
      return row ? toDepartment(row) : null;
    },

    async listDepartmentVersions(departmentId) {
      const rows = await database
        .selectFrom('department_master.department_version')
        .selectAll()
        .where('department_id', '=', departmentId)
        .orderBy('version_no', 'asc')
        .execute();
      return rows.map(toDepartmentVersion);
    },

    async findDepartmentVersionAsOf(command) {
      parseLocalDateTime(command.businessAt);
      parseLocalDateTime(command.recordAsOf);
      const row = await database
        .selectFrom('department_master.department_version')
        .selectAll()
        .where('department_id', '=', command.departmentId)
        .where(sql<boolean>`business_period @> ${command.businessAt}::timestamp`)
        .where(sql<boolean>`recorded_period @> ${command.recordAsOf}::timestamp`)
        .orderBy('version_no', 'desc')
        .executeTakeFirst();
      return row ? toDepartmentVersion(row) : null;
    },

    async listSources() {
      const rows = await database
        .selectFrom('department_master.master_data_source')
        .selectAll()
        .orderBy('source_code')
        .execute();
      return rows.map((row) => ({
        id: row.master_data_source_id,
        sourceCode: row.source_code,
        sourceName: row.source_name,
        systemType: row.system_type,
        enabled: row.enabled,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    async addAlias(command) {
      const row = await database
        .insertInto('department_master.department_alias')
        .values({
          department_id: command.departmentId,
          source_system: command.sourceSystem,
          source_code: command.sourceCode,
          source_name: command.sourceName,
          mapping_status: command.mappingStatus,
          confidence_score: command.confidenceScore,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toAlias(row);
    },

    async listAliases(departmentId) {
      const rows = await database
        .selectFrom('department_master.department_alias')
        .selectAll()
        .where('department_id', '=', departmentId)
        .orderBy('source_system')
        .orderBy('source_code')
        .execute();
      return rows.map(toAlias);
    },

    async addMapping(command) {
      const row = await database
        .insertInto('department_master.department_mapping')
        .values({
          department_id: command.departmentId,
          source_system: command.sourceSystem,
          source_department_code: command.sourceDepartmentCode,
          source_department_name: command.sourceDepartmentName,
          mapping_type: command.mappingType,
          mapping_status: command.mappingStatus,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toMapping(row);
    },

    async listMappings(departmentId) {
      const rows = await database
        .selectFrom('department_master.department_mapping')
        .selectAll()
        .where('department_id', '=', departmentId)
        .orderBy('source_system')
        .orderBy('source_department_code')
        .execute();
      return rows.map(toMapping);
    },

    async recordQualityScore(command) {
      parseLocalDateTime(command.calculatedAt);
      const completeness = qualityComponent(command.completenessScore);
      const uniqueness = qualityComponent(command.uniquenessScore);
      const standardization = qualityComponent(command.standardizationScore);
      const overall = (
        completeness * 0.20 + uniqueness * 0.30 + standardization * 0.50
      ).toFixed(2);
      const row = await database
        .insertInto('department_master.department_quality_score')
        .values({
          department_id: command.departmentId,
          completeness_score: command.completenessScore,
          uniqueness_score: command.uniquenessScore,
          standardization_score: command.standardizationScore,
          overall_score: overall,
          calculated_at: command.calculatedAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toQualityScore(row);
    },

    async getLatestQualityScore(departmentId) {
      const row = await database
        .selectFrom('department_master.department_quality_score')
        .selectAll()
        .where('department_id', '=', departmentId)
        .orderBy('calculated_at', 'desc')
        .executeTakeFirst();
      return row ? toQualityScore(row) : null;
    },

    async createHierarchyView(command) {
      validateCode(command.viewCode, 'DEPARTMENT_HIERARCHY_VIEW_CODE_INVALID');
      const operationalEnabled = operationalViewTypes.has(command.viewType);
      const row = await database
        .insertInto('department_master.department_hierarchy_view')
        .values({
          view_code: command.viewCode,
          view_name: command.viewName,
          view_type: command.viewType,
          operational_enabled: operationalEnabled,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toHierarchyView(row);
    },

    async createHierarchyGroupVersion(command) {
      validateCode(command.groupCode, 'DEPARTMENT_HIERARCHY_GROUP_CODE_INVALID');
      validatePeriod(command.businessValidFrom, command.businessValidTo);
      parseLocalDateTime(command.recordedFrom);
      const groupId = await nextUuid(database);
      const groupVersionId = await nextUuid(database);
      const versionNo = '1';
      const contentHash = canonicalSha256({
        businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo,
        displayName: command.displayName,
        groupCode: command.groupCode,
        groupId,
        groupVersionId,
        hierarchyViewId: command.hierarchyViewId,
        recordedFrom: command.recordedFrom,
        versionNo,
      });
      await database
        .insertInto('department_master.department_hierarchy_group')
        .values({
          department_hierarchy_group_id: groupId,
          department_hierarchy_view_id: command.hierarchyViewId,
          group_code: command.groupCode,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .execute();
      const row = await database
        .insertInto('department_master.department_hierarchy_group_version')
        .values({
          department_hierarchy_group_version_id: groupVersionId,
          department_hierarchy_group_id: groupId,
          department_hierarchy_view_id: command.hierarchyViewId,
          version_no: versionNo,
          display_name: command.displayName,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          recorded_to: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return {
        id: row.department_hierarchy_group_version_id,
        groupId: row.department_hierarchy_group_id,
        hierarchyViewId: row.department_hierarchy_view_id,
        versionNo: row.version_no,
        displayName: row.display_name,
        businessValidFrom: row.business_valid_from,
        businessValidTo: row.business_valid_to,
        recordedFrom: row.recorded_from,
        recordedTo: row.recorded_to,
        contentHash: row.content_hash,
      };
    },

    async createHierarchyViewVersion(command) {
      validatePeriod(command.businessValidFrom, command.businessValidTo);
      parseLocalDateTime(command.recordedFrom);
      validateHierarchyNodes(command.nodes);
      const viewRow = await database
        .selectFrom('department_master.department_hierarchy_view')
        .selectAll()
        .where('department_hierarchy_view_id', '=', command.hierarchyViewId)
        .forUpdate()
        .executeTakeFirst();
      if (!viewRow) throw new Error('DEPARTMENT_HIERARCHY_VIEW_NOT_FOUND');
      if (!viewRow.operational_enabled) {
        throw new Error('DEPARTMENT_HIERARCHY_VIEW_REGISTRATION_ONLY');
      }
      const current = await database
        .selectFrom('department_master.department_hierarchy_view_version')
        .select(['department_hierarchy_view_version_id', 'recorded_from', 'version_no'])
        .where('department_hierarchy_view_id', '=', command.hierarchyViewId)
        .where('recorded_to', 'is', null)
        .orderBy('version_no', 'desc')
        .forUpdate()
        .executeTakeFirst();
      if (current && command.recordedFrom <= current.recorded_from) {
        throw new Error('DEPARTMENT_HIERARCHY_RECORDED_TIME_CONFLICT');
      }
      if (current) {
        await database
          .updateTable('department_master.department_hierarchy_view_version')
          .set({
            recorded_to: command.recordedFrom,
            updated_at: sql<string>`platform.local_now()`,
            updated_by: command.actorPrincipalId,
          })
          .where(
            'department_hierarchy_view_version_id',
            '=',
            current.department_hierarchy_view_version_id,
          )
          .executeTakeFirstOrThrow();
      }
      const versionNo = String(BigInt(current?.version_no ?? '0') + 1n);
      const hierarchyViewVersionId = await nextUuid(database);
      const nodeIds = new Map<string, string>();
      for (const node of command.nodes) nodeIds.set(node.nodeKey, await nextUuid(database));
      const frozenNodes = command.nodes.map((node) => ({
        ...node,
        nodeId: nodeIds.get(node.nodeKey)!,
        parentNodeId: node.parentNodeKey === null ? null : nodeIds.get(node.parentNodeKey)!,
      }));
      const contentHash = canonicalSha256({
        businessValidFrom: command.businessValidFrom,
        businessValidTo: command.businessValidTo,
        governanceStatus: command.governanceStatus,
        hierarchyViewId: command.hierarchyViewId,
        hierarchyViewVersionId,
        nodes: frozenNodes,
        recordedFrom: command.recordedFrom,
        versionNo,
      });
      const versionRow = await database
        .insertInto('department_master.department_hierarchy_view_version')
        .values({
          department_hierarchy_view_version_id: hierarchyViewVersionId,
          department_hierarchy_view_id: command.hierarchyViewId,
          version_no: versionNo,
          governance_status: command.governanceStatus,
          business_valid_from: command.businessValidFrom,
          business_valid_to: command.businessValidTo,
          recorded_from: command.recordedFrom,
          recorded_to: null,
          content_hash: contentHash,
          created_by: command.actorPrincipalId,
          updated_by: command.actorPrincipalId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      for (const node of frozenNodes) {
        await database
          .insertInto('department_master.department_hierarchy_node')
          .values({
            department_hierarchy_node_id: node.nodeId,
            department_hierarchy_view_version_id: hierarchyViewVersionId,
            department_hierarchy_view_id: command.hierarchyViewId,
            parent_node_id: node.parentNodeId,
            node_kind: node.nodeKind,
            department_id: node.nodeKind === 'DEPARTMENT' ? node.departmentId : null,
            department_version_id: node.nodeKind === 'DEPARTMENT' ? node.departmentVersionId : null,
            department_hierarchy_group_id: node.nodeKind === 'GROUP' ? node.groupId : null,
            department_hierarchy_group_version_id:
              node.nodeKind === 'GROUP' ? node.groupVersionId : null,
            display_name: node.displayName,
            sort_order: node.sortOrder,
          })
          .execute();
      }
      const nodes = await selectHierarchyNodes(database, hierarchyViewVersionId);
      return {
        view: toHierarchyView(viewRow),
        version: toHierarchyViewVersion(versionRow),
        nodes,
      };
    },

    async getHierarchySnapshot(hierarchyViewVersionId) {
      const versionRow = await database
        .selectFrom('department_master.department_hierarchy_view_version')
        .selectAll()
        .where('department_hierarchy_view_version_id', '=', hierarchyViewVersionId)
        .executeTakeFirst();
      if (!versionRow) return null;
      const viewRow = await database
        .selectFrom('department_master.department_hierarchy_view')
        .selectAll()
        .where('department_hierarchy_view_id', '=', versionRow.department_hierarchy_view_id)
        .executeTakeFirstOrThrow();
      return {
        view: toHierarchyView(viewRow),
        version: toHierarchyViewVersion(versionRow),
        nodes: await selectHierarchyNodes(database, hierarchyViewVersionId),
      };
    },
  };
}

const operationalViewTypes = new Set<DepartmentHierarchyViewType>([
  'ADMINISTRATIVE',
  'OPERATIONAL',
  'MEDICAL_RECORD',
]);

function validateDepartmentVersion(content: DepartmentVersionContent): void {
  validatePeriod(content.businessValidFrom, content.businessValidTo);
  if (content.standardName.trim().length === 0 || content.standardName.length > 256) {
    throw new Error('DEPARTMENT_STANDARD_NAME_INVALID');
  }
  if (content.shortName !== null && (
    content.shortName.trim().length === 0 || content.shortName.length > 128
  )) {
    throw new Error('DEPARTMENT_SHORT_NAME_INVALID');
  }
  if (content.description !== null && content.description.length > 1000) {
    throw new Error('DEPARTMENT_DESCRIPTION_INVALID');
  }
}

function validatePeriod(from: string, to: string | null): void {
  parseLocalDateTime(from);
  if (to !== null) {
    parseLocalDateTime(to);
    if (to <= from) throw new Error('DEPARTMENT_BUSINESS_PERIOD_INVALID');
  }
}

function validateCode(value: string, errorCode: string): void {
  if (value.trim().length === 0 || value.length > 64) throw new Error(errorCode);
}

function validateHierarchyNodes(nodes: readonly HierarchyNodeInput[]): void {
  const keys = new Set<string>();
  const departments = new Set<string>();
  for (const node of nodes) {
    if (keys.has(node.nodeKey)) throw new Error('DEPARTMENT_HIERARCHY_NODE_KEY_DUPLICATE');
    keys.add(node.nodeKey);
    if (node.nodeKind === 'DEPARTMENT') {
      if (departments.has(node.departmentId)) {
        throw new Error('DEPARTMENT_HIERARCHY_DEPARTMENT_DUPLICATE');
      }
      departments.add(node.departmentId);
    }
  }
  for (const node of nodes) {
    if (node.parentNodeKey !== null && !keys.has(node.parentNodeKey)) {
      throw new Error('DEPARTMENT_HIERARCHY_PARENT_NOT_FOUND');
    }
  }
}

function qualityComponent(value: string): number {
  if (!/^(?:100(?:\.0{1,2})?|\d{1,2}(?:\.\d{1,2})?)$/u.test(value)) {
    throw new Error('DEPARTMENT_QUALITY_SCORE_INVALID');
  }
  return Number(value);
}

function departmentVersionHash(content: DepartmentVersionContent & {
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly recordedFrom: string;
  readonly versionNo: string;
}): Buffer {
  return canonicalSha256({
    businessStatus: content.businessStatus,
    businessValidFrom: content.businessValidFrom,
    businessValidTo: content.businessValidTo,
    clinicalFlag: content.clinicalFlag,
    departmentId: content.departmentId,
    departmentType: content.departmentType,
    departmentVersionId: content.departmentVersionId,
    description: content.description,
    governanceStatus: content.governanceStatus,
    managementFlag: content.managementFlag,
    recordedFrom: content.recordedFrom,
    shortName: content.shortName,
    standardName: content.standardName,
    versionNo: content.versionNo,
  });
}

function toDepartment(row: {
  readonly department_id: string;
  readonly department_code: string;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
  readonly updated_by: string;
}): Department {
  return {
    id: row.department_id,
    departmentCode: row.department_code,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toDepartmentVersion(row: {
  readonly department_version_id: string;
  readonly department_id: string;
  readonly version_no: string;
  readonly standard_name: string;
  readonly short_name: string | null;
  readonly department_type: string;
  readonly clinical_flag: boolean;
  readonly management_flag: boolean;
  readonly business_status: string;
  readonly governance_status: string;
  readonly description: string | null;
  readonly business_valid_from: string;
  readonly business_valid_to: string | null;
  readonly recorded_from: string;
  readonly recorded_to: string | null;
  readonly content_hash: Buffer;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
  readonly updated_by: string;
}): DepartmentVersion {
  return {
    id: row.department_version_id,
    departmentId: row.department_id,
    versionNo: row.version_no,
    standardName: row.standard_name,
    shortName: row.short_name,
    departmentType: row.department_type as DepartmentType,
    clinicalFlag: row.clinical_flag,
    managementFlag: row.management_flag,
    businessStatus: row.business_status as DepartmentBusinessStatus,
    governanceStatus: row.governance_status as GovernanceStatus,
    description: row.description,
    businessValidFrom: row.business_valid_from,
    businessValidTo: row.business_valid_to,
    recordedFrom: row.recorded_from,
    recordedTo: row.recorded_to,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toAlias(row: {
  readonly department_alias_id: string;
  readonly department_id: string;
  readonly source_system: string;
  readonly source_code: string;
  readonly source_name: string;
  readonly mapping_status: string;
  readonly confidence_score: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}): DepartmentAlias {
  return {
    id: row.department_alias_id,
    departmentId: row.department_id,
    sourceSystem: row.source_system,
    sourceCode: row.source_code,
    sourceName: row.source_name,
    mappingStatus: row.mapping_status as DepartmentMappingStatus,
    confidenceScore: row.confidence_score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMapping(row: {
  readonly department_mapping_id: string;
  readonly department_id: string;
  readonly source_system: string;
  readonly source_department_code: string;
  readonly source_department_name: string;
  readonly mapping_type: string;
  readonly mapping_status: string;
  readonly created_at: string;
  readonly updated_at: string;
}): DepartmentMapping {
  return {
    id: row.department_mapping_id,
    departmentId: row.department_id,
    sourceSystem: row.source_system,
    sourceDepartmentCode: row.source_department_code,
    sourceDepartmentName: row.source_department_name,
    mappingType: row.mapping_type as DepartmentMappingType,
    mappingStatus: row.mapping_status as DepartmentMappingStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toQualityScore(row: {
  readonly department_quality_score_id: string;
  readonly department_id: string;
  readonly completeness_score: string;
  readonly uniqueness_score: string;
  readonly standardization_score: string;
  readonly overall_score: string;
  readonly calculated_at: string;
  readonly created_at: string;
  readonly updated_at: string;
}): DepartmentQualityScore {
  return {
    id: row.department_quality_score_id,
    departmentId: row.department_id,
    completenessScore: row.completeness_score,
    uniquenessScore: row.uniqueness_score,
    standardizationScore: row.standardization_score,
    overallScore: row.overall_score,
    calculatedAt: row.calculated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toHierarchyView(row: {
  readonly department_hierarchy_view_id: string;
  readonly view_code: string;
  readonly view_name: string;
  readonly view_type: string;
  readonly operational_enabled: boolean;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
  readonly updated_by: string;
}): DepartmentHierarchyView {
  return {
    id: row.department_hierarchy_view_id,
    viewCode: row.view_code,
    viewName: row.view_name,
    viewType: row.view_type as DepartmentHierarchyViewType,
    operationalEnabled: row.operational_enabled,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toHierarchyViewVersion(row: {
  readonly department_hierarchy_view_version_id: string;
  readonly department_hierarchy_view_id: string;
  readonly version_no: string;
  readonly governance_status: string;
  readonly business_valid_from: string;
  readonly business_valid_to: string | null;
  readonly recorded_from: string;
  readonly recorded_to: string | null;
  readonly content_hash: Buffer;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
  readonly updated_by: string;
}): DepartmentHierarchyViewVersion {
  return {
    id: row.department_hierarchy_view_version_id,
    hierarchyViewId: row.department_hierarchy_view_id,
    versionNo: row.version_no,
    governanceStatus: row.governance_status as GovernanceStatus,
    businessValidFrom: row.business_valid_from,
    businessValidTo: row.business_valid_to,
    recordedFrom: row.recorded_from,
    recordedTo: row.recorded_to,
    contentHash: row.content_hash,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

async function selectHierarchyNodes(
  database: Kysely<DB>,
  hierarchyViewVersionId: string,
): Promise<readonly DepartmentHierarchyNode[]> {
  const rows = await database
    .selectFrom('department_master.department_hierarchy_node')
    .selectAll()
    .where('department_hierarchy_view_version_id', '=', hierarchyViewVersionId)
    .orderBy('sort_order')
    .orderBy('department_hierarchy_node_id')
    .execute();
  return rows.map((row) => {
    const base: DepartmentHierarchyNodeBase = {
      id: row.department_hierarchy_node_id,
      hierarchyViewVersionId: row.department_hierarchy_view_version_id,
      hierarchyViewId: row.department_hierarchy_view_id,
      parentNodeId: row.parent_node_id,
      displayName: row.display_name,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
    if (row.node_kind === 'DEPARTMENT') {
      if (!row.department_id || !row.department_version_id) {
        throw new Error('DEPARTMENT_HIERARCHY_DEPARTMENT_REFERENCE_INVALID');
      }
      return {
        ...base,
        nodeKind: 'DEPARTMENT',
        departmentId: row.department_id,
        departmentVersionId: row.department_version_id,
        groupId: null,
        groupVersionId: null,
      };
    }
    if (!row.department_hierarchy_group_id || !row.department_hierarchy_group_version_id) {
      throw new Error('DEPARTMENT_HIERARCHY_GROUP_REFERENCE_INVALID');
    }
    return {
      ...base,
      nodeKind: 'GROUP',
      departmentId: null,
      departmentVersionId: null,
      groupId: row.department_hierarchy_group_id,
      groupVersionId: row.department_hierarchy_group_version_id,
    };
  });
}

async function nextUuid(database: Kysely<DB>): Promise<string> {
  const result = await database
    .selectNoFrom((expression) => expression.fn<string>('uuidv7', []).as('id'))
    .executeTakeFirstOrThrow();
  return result.id;
}
