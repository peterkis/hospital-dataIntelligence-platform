import { sql, type Transaction } from 'kysely';
import type { CampusReferenceReader } from '../../platform/campus/campus-reference-reader.js';
import type { DB } from '../../platform/database/database-types.generated.js';
import {
  parseLocalDateTime,
  type LocalDateTime,
} from '../../platform/local-datetime/local-datetime.js';
import type {
  DepartmentBusinessStatus,
  DepartmentHierarchyViewType,
  DepartmentSourceMappingStatus,
  DepartmentType,
  SubjectMappingApplicability,
} from './index.js';

export interface DepartmentPublishedReadModel {
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly standardName: string;
  readonly shortName: string | null;
  readonly departmentType: DepartmentType;
  readonly subjectMappingApplicability: SubjectMappingApplicability;
  readonly lifecycleStatus: DepartmentBusinessStatus;
  readonly campuses: readonly DepartmentCampusReadModel[];
  readonly hierarchyViews: readonly DepartmentHierarchyViewReadModel[];
  readonly sourceMappings: readonly DepartmentSourceMappingReadModel[];
  readonly qualityScore: string | null;
  readonly publishedReleaseId: string;
  readonly publishedAt: LocalDateTime;
  readonly contentHash: string;
}

export interface DepartmentCampusReadModel {
  readonly campusId: string;
  readonly campusCode: string;
  readonly campusName: string;
}

export interface DepartmentHierarchyViewReadModel {
  readonly viewType: DepartmentHierarchyViewType;
  readonly hierarchyPath: readonly DepartmentHierarchyPathNodeReadModel[];
}

export interface DepartmentHierarchyPathNodeReadModel {
  readonly nodeId: string;
  readonly displayName: string;
}

export interface DepartmentSourceMappingReadModel {
  readonly sourceSystem: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly mappingStatus: DepartmentSourceMappingStatus;
}

export interface DepartmentSearchCriteria {
  readonly departmentCode?: string;
  readonly standardName?: string;
  readonly departmentType?: DepartmentType;
  readonly campusId?: string;
  readonly hierarchyViewType?: DepartmentHierarchyViewType;
}

export interface DepartmentPublishedReadSource {
  readonly sourceGovernanceStatus: string;
  readonly projection: {
    readonly departmentId: string;
    readonly departmentCode: string;
    readonly standardName: string;
    readonly departmentType: DepartmentType;
    readonly subjectMappingApplicability: SubjectMappingApplicability;
    readonly qualityScore: string | null;
    readonly publishedReleaseId: string;
    readonly publishedAt: string;
    readonly contentHash: Buffer;
  };
  readonly versionSnapshot: {
    readonly shortName: string | null;
    readonly lifecycleStatus: DepartmentBusinessStatus;
  };
  readonly campusSnapshot: readonly DepartmentCampusReadModel[];
  readonly hierarchySnapshots: readonly DepartmentHierarchyViewReadModel[];
  readonly sourceMappings: readonly DepartmentSourceMappingReadModel[];
}

export class DepartmentReadModelMapper {
  toReadModel(source: DepartmentPublishedReadSource): DepartmentPublishedReadModel | null {
    if (source.sourceGovernanceStatus !== 'PUBLISHED') return null;

    return Object.freeze({
      departmentId: source.projection.departmentId,
      departmentCode: source.projection.departmentCode,
      standardName: source.projection.standardName,
      shortName: source.versionSnapshot.shortName,
      departmentType: source.projection.departmentType,
      subjectMappingApplicability: source.projection.subjectMappingApplicability,
      lifecycleStatus: source.versionSnapshot.lifecycleStatus,
      campuses: freezeCampuses(source.campusSnapshot),
      hierarchyViews: freezeHierarchyViews(source.hierarchySnapshots),
      sourceMappings: freezeSourceMappings(source.sourceMappings),
      qualityScore: source.projection.qualityScore,
      publishedReleaseId: source.projection.publishedReleaseId,
      publishedAt: parseLocalDateTime(source.projection.publishedAt),
      contentHash: source.projection.contentHash.toString('hex'),
    });
  }
}

export interface DepartmentPublishedReadRepository {
  getPublishedDepartment(id: string): Promise<DepartmentPublishedReadSource | null>;
  findPublishedDepartments(): Promise<readonly DepartmentPublishedReadSource[]>;
  findDepartmentAsOf(
    id: string,
    time: { readonly businessAt: LocalDateTime; readonly recordAsOf: LocalDateTime },
  ): Promise<DepartmentPublishedReadSource | null>;
}

export class DepartmentQueryService {
  constructor(
    private readonly repository: DepartmentPublishedReadRepository,
    private readonly mapper = new DepartmentReadModelMapper(),
  ) {}

  async getPublishedDepartment(id: string): Promise<DepartmentPublishedReadModel | null> {
    const source = await this.repository.getPublishedDepartment(id);
    return source ? this.mapper.toReadModel(source) : null;
  }

  async findPublishedDepartments(
    criteria: DepartmentSearchCriteria = {},
  ): Promise<readonly DepartmentPublishedReadModel[]> {
    const sources = await this.repository.findPublishedDepartments();
    return Object.freeze(sources
      .map((source) => this.mapper.toReadModel(source))
      .filter((model): model is DepartmentPublishedReadModel => model !== null)
      .filter((model) => matchesCriteria(model, criteria)));
  }

  async findDepartmentAsOf(
    id: string,
    localDateTime: string,
  ): Promise<DepartmentPublishedReadModel | null> {
    const asOf = parseLocalDateTime(localDateTime);
    const source = await this.repository.findDepartmentAsOf(id, {
      businessAt: asOf,
      recordAsOf: asOf,
    });
    return source ? this.mapper.toReadModel(source) : null;
  }
}

export function createDepartmentQueryService(
  database: Transaction<DB>,
  campusReferences: CampusReferenceReader,
): DepartmentQueryService {
  return new DepartmentQueryService(
    new KyselyDepartmentPublishedReadRepository(database, campusReferences),
  );
}

class KyselyDepartmentPublishedReadRepository implements DepartmentPublishedReadRepository {
  constructor(
    private readonly database: Transaction<DB>,
    private readonly campusReferences: CampusReferenceReader,
  ) {}

  async getPublishedDepartment(id: string): Promise<DepartmentPublishedReadSource | null> {
    const row = await basePublishedQuery(this.database)
      .where('projection.department_id', '=', id)
      .where('projection.superseded_at', 'is', null)
      .executeTakeFirst();
    return row ? this.hydrate(row) : null;
  }

  async findPublishedDepartments(): Promise<readonly DepartmentPublishedReadSource[]> {
    const rows = await basePublishedQuery(this.database)
      .where('projection.superseded_at', 'is', null)
      .orderBy('projection.department_code')
      .execute();
    const sources: DepartmentPublishedReadSource[] = [];
    for (const row of rows) sources.push(await this.hydrate(row));
    return sources;
  }

  async findDepartmentAsOf(
    id: string,
    time: { readonly businessAt: LocalDateTime; readonly recordAsOf: LocalDateTime },
  ): Promise<DepartmentPublishedReadSource | null> {
    const row = await basePublishedQuery(this.database)
      .where('projection.department_id', '=', id)
      .where(sql<boolean>`version.business_period @> ${time.businessAt}::timestamp`)
      .where(sql<boolean>`version.recorded_period @> ${time.recordAsOf}::timestamp`)
      .where('projection.published_at', '<=', time.recordAsOf)
      .where((expression) => expression.or([
        expression('projection.superseded_at', 'is', null),
        expression('projection.superseded_at', '>', time.recordAsOf),
      ]))
      .orderBy('projection.published_at', 'desc')
      .executeTakeFirst();
    return row ? this.hydrate(row) : null;
  }

  private async hydrate(row: PublishedQueryRow): Promise<DepartmentPublishedReadSource> {
    const campusIds = await loadCampusSnapshotIds(
      this.database,
      row.department_id,
      row.business_valid_from,
      row.published_at,
    );
    const campusReferences = await this.campusReferences.getReferences(campusIds);
    const campusSnapshot = campusReferences.map((reference) => ({
      campusId: reference.campusId,
      campusCode: reference.campusCode,
      campusName: reference.displayName,
    }));
    const hierarchySnapshots = await loadHierarchySnapshots(
      this.database,
      row.department_id,
      row.business_valid_from,
      row.published_at,
    );
    const sourceMappings = await loadSourceMappings(this.database, row.department_id);

    return {
      sourceGovernanceStatus: row.governance_status,
      projection: {
        departmentId: row.department_id,
        departmentCode: row.department_code,
        standardName: row.standard_name,
        departmentType: row.department_type as DepartmentType,
        subjectMappingApplicability: row.subject_mapping_applicability as SubjectMappingApplicability,
        qualityScore: row.quality_score,
        publishedReleaseId: row.published_release_id,
        publishedAt: row.published_at,
        contentHash: row.content_hash,
      },
      versionSnapshot: {
        shortName: row.short_name,
        lifecycleStatus: row.business_status as DepartmentBusinessStatus,
      },
      campusSnapshot,
      hierarchySnapshots,
      sourceMappings,
    };
  }
}

function basePublishedQuery(database: Transaction<DB>) {
  return database
    .selectFrom('department_master.department_published_projection as projection')
    .innerJoin(
      'department_master.department_version as version',
      'version.department_version_id',
      'projection.department_version_id',
    )
    .select([
      'projection.department_id',
      'projection.department_code',
      'projection.standard_name',
      'projection.department_type',
      'projection.subject_mapping_applicability',
      'projection.quality_score',
      'projection.published_release_id',
      'projection.published_at',
      'projection.content_hash',
      'version.short_name',
      'version.business_status',
      'version.business_valid_from',
      'version.governance_status',
    ])
    .where('version.governance_status', '=', 'PUBLISHED');
}

type PublishedQueryRow = Awaited<ReturnType<ReturnType<typeof basePublishedQuery>['executeTakeFirstOrThrow']>>;

async function loadCampusSnapshotIds(
  database: Transaction<DB>,
  departmentId: string,
  businessAt: string,
  recordAsOf: string,
): Promise<readonly string[]> {
  const rows = await database
    .selectFrom('department_master.department_campus_assignment as assignment')
    .select('assignment.campus_id')
    .where('assignment.department_id', '=', departmentId)
    .where(sql<boolean>`assignment.business_period @> ${businessAt}::timestamp`)
    .where(sql<boolean>`assignment.recorded_period @> ${recordAsOf}::timestamp`)
    .orderBy('assignment.campus_id')
    .execute();
  return rows.map((row) => row.campus_id);
}

async function loadHierarchySnapshots(
  database: Transaction<DB>,
  departmentId: string,
  businessAt: string,
  recordAsOf: string,
): Promise<readonly DepartmentHierarchyViewReadModel[]> {
  const memberships = await database
    .selectFrom('department_master.department_hierarchy_view_version as version')
    .innerJoin(
      'department_master.department_hierarchy_view as view',
      'view.department_hierarchy_view_id',
      'version.department_hierarchy_view_id',
    )
    .innerJoin(
      'department_master.department_hierarchy_node as node',
      'node.department_hierarchy_view_version_id',
      'version.department_hierarchy_view_version_id',
    )
    .select([
      'version.department_hierarchy_view_version_id',
      'view.view_code',
      'view.view_type',
      'node.department_hierarchy_node_id',
    ])
    .where('version.governance_status', '=', 'PUBLISHED')
    .where('node.department_id', '=', departmentId)
    .where(sql<boolean>`version.business_period @> ${businessAt}::timestamp`)
    .where(sql<boolean>`version.recorded_period @> ${recordAsOf}::timestamp`)
    .orderBy('view.view_type')
    .orderBy('view.view_code')
    .execute();

  const seenTypes = new Set<string>();
  const snapshots: DepartmentHierarchyViewReadModel[] = [];
  for (const membership of memberships) {
    if (seenTypes.has(membership.view_type)) {
      throw new Error('DEPARTMENT_READ_MODEL_HIERARCHY_TYPE_AMBIGUOUS');
    }
    seenTypes.add(membership.view_type);
    const nodes = await database
      .selectFrom('department_master.department_hierarchy_node')
      .select(['department_hierarchy_node_id', 'parent_node_id', 'display_name'])
      .where(
        'department_hierarchy_view_version_id',
        '=',
        membership.department_hierarchy_view_version_id,
      )
      .execute();
    snapshots.push({
      viewType: membership.view_type as DepartmentHierarchyViewType,
      hierarchyPath: buildHierarchyPath(nodes, membership.department_hierarchy_node_id),
    });
  }
  return snapshots;
}

function buildHierarchyPath(
  nodes: readonly {
    readonly department_hierarchy_node_id: string;
    readonly parent_node_id: string | null;
    readonly display_name: string;
  }[],
  leafNodeId: string,
): readonly DepartmentHierarchyPathNodeReadModel[] {
  const byId = new Map(nodes.map((node) => [node.department_hierarchy_node_id, node]));
  const path: DepartmentHierarchyPathNodeReadModel[] = [];
  const visited = new Set<string>();
  let nodeId: string | null = leafNodeId;
  while (nodeId !== null) {
    if (visited.has(nodeId)) throw new Error('DEPARTMENT_READ_MODEL_HIERARCHY_CYCLE');
    visited.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) throw new Error('DEPARTMENT_READ_MODEL_HIERARCHY_NODE_NOT_FOUND');
    path.unshift({ nodeId: node.department_hierarchy_node_id, displayName: node.display_name });
    nodeId = node.parent_node_id;
  }
  return path;
}

async function loadSourceMappings(
  database: Transaction<DB>,
  departmentId: string,
): Promise<readonly DepartmentSourceMappingReadModel[]> {
  const rows = await database
    .selectFrom('department_master.department_source_mapping')
    .select(['source_system', 'source_department_code', 'source_department_name', 'mapping_status'])
    .where('department_id', '=', departmentId)
    .orderBy('source_system')
    .orderBy('source_department_code')
    .execute();
  return rows.map((row) => ({
    sourceSystem: row.source_system,
    sourceCode: row.source_department_code,
    sourceName: row.source_department_name,
    mappingStatus: row.mapping_status as DepartmentSourceMappingStatus,
  }));
}

function freezeCampuses(
  campuses: readonly DepartmentCampusReadModel[],
): readonly DepartmentCampusReadModel[] {
  return Object.freeze(campuses.map((campus) => Object.freeze({ ...campus })));
}

function freezeHierarchyViews(
  hierarchyViews: readonly DepartmentHierarchyViewReadModel[],
): readonly DepartmentHierarchyViewReadModel[] {
  return Object.freeze(hierarchyViews.map((view) => Object.freeze({
    viewType: view.viewType,
    hierarchyPath: Object.freeze(view.hierarchyPath.map((node) => Object.freeze({ ...node }))),
  })));
}

function freezeSourceMappings(
  mappings: readonly DepartmentSourceMappingReadModel[],
): readonly DepartmentSourceMappingReadModel[] {
  return Object.freeze(mappings.map((mapping) => Object.freeze({ ...mapping })));
}

function matchesCriteria(
  model: DepartmentPublishedReadModel,
  criteria: DepartmentSearchCriteria,
): boolean {
  return (criteria.departmentCode === undefined || model.departmentCode === criteria.departmentCode)
    && (criteria.standardName === undefined || model.standardName.includes(criteria.standardName))
    && (criteria.departmentType === undefined || model.departmentType === criteria.departmentType)
    && (criteria.campusId === undefined
      || model.campuses.some((campus) => campus.campusId === criteria.campusId))
    && (criteria.hierarchyViewType === undefined
      || model.hierarchyViews.some((view) => view.viewType === criteria.hierarchyViewType));
}
