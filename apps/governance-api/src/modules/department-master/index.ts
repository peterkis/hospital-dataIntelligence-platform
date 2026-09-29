import { sql, type Selectable, type Transaction } from 'kysely';
import { Type, type Static } from 'typebox';
import type { DB } from '../../platform/database/database-types.generated.js';
import type { CampusReferenceReader } from '../../platform/campus/campus-reference-reader.js';
import { canonicalSha256, digestHex } from '../../platform/hashing/canonical-hash.js';
import { LOCAL_DATE_TIME_JSON_PATTERN, parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';
import { hitControlledPublicationFault } from '../../platform/fault-injection/controlled-faults.js';
import type { AuditEventService } from '../audit/index.js';
import {
  createDepartmentGovernanceAudit,
  type DepartmentAssignmentAuditSnapshot,
  type DepartmentGovernanceAudit,
} from './department-audit.js';

export const DEPARTMENT_MASTER_MODULE_ID = 'department-master' as const;
export const DEPARTMENT_MASTER_PROJECTION_TYPE = 'hdi.department-master' as const;
export const DEPARTMENT_HIERARCHY_PROJECTION_TYPE = 'hdi.department-hierarchy' as const;
export const DEPARTMENT_PROJECTION_SCHEMA_VERSION = '1' as const;

export type DepartmentType = 'CLINICAL' | 'MEDICAL_TECHNOLOGY' | 'AUXILIARY' | 'ADMINISTRATIVE';
export type DepartmentBusinessStatus = 'ACTIVE' | 'SUSPENDED' | 'DEPRECATED' | 'SUPERSEDED';
export type SubjectMappingApplicability = 'REQUIRED_OUTPATIENT' | 'REQUIRED_CLINICAL_SERVICE' | 'EXEMPT_MEDICAL_TECHNOLOGY' | 'EXEMPT_AUXILIARY' | 'PENDING_DETERMINATION';
export type DepartmentSourceMatchMethod = 'DIRECT' | 'MANUAL' | 'SUGGESTED';
export type DepartmentSourceMappingStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';
export type DepartmentHierarchyViewType = 'ADMINISTRATIVE' | 'OPERATIONAL' | 'MEDICAL_RECORD' | 'FINANCE' | 'STATISTICAL';

const Uuid = Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' });
const LocalDateTime = Type.String({ pattern: LOCAL_DATE_TIME_JSON_PATTERN });
export const DepartmentMasterProjectionSchema = Type.Object({
  departmentCode: Type.String(), departmentId: Uuid, departmentVersionId: Uuid,
  versionNo: Type.String(), standardName: Type.String(), shortName: Type.Union([Type.String(), Type.Null()]),
  departmentType: Type.String(), clinicalFlag: Type.Boolean(), managementFlag: Type.Boolean(),
  subjectMappingApplicability: Type.String(), businessStatus: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]), businessValidFrom: LocalDateTime,
  businessValidTo: Type.Union([LocalDateTime, Type.Null()]), recordedFrom: LocalDateTime,
  contentHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
}, { additionalProperties: false });
export const DepartmentHierarchyProjectionSchema = Type.Object({
  hierarchyViewId: Uuid, hierarchyViewVersionId: Uuid, viewCode: Type.String(), viewType: Type.String(),
  versionNo: Type.String(), businessValidFrom: LocalDateTime, businessValidTo: Type.Union([LocalDateTime, Type.Null()]),
  recordedFrom: LocalDateTime, contentHash: Type.String({ pattern: '^[0-9a-f]{64}$' }),
  nodes: Type.Array(Type.Object({
    nodeId: Uuid, parentNodeId: Type.Union([Uuid, Type.Null()]), nodeKind: Type.String(),
    departmentId: Type.Union([Uuid, Type.Null()]), departmentVersionId: Type.Union([Uuid, Type.Null()]),
    groupId: Type.Union([Uuid, Type.Null()]), groupVersionId: Type.Union([Uuid, Type.Null()]),
    displayName: Type.String(), sortOrder: Type.Number(),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type DepartmentMasterProjection = Static<typeof DepartmentMasterProjectionSchema>;
export type DepartmentHierarchyProjection = Static<typeof DepartmentHierarchyProjectionSchema>;

export interface DepartmentVersionContent {
  readonly standardName: string; readonly shortName: string | null; readonly departmentType: DepartmentType;
  readonly clinicalFlag: boolean; readonly managementFlag: boolean; readonly subjectMappingApplicability: SubjectMappingApplicability;
  readonly businessStatus: DepartmentBusinessStatus; readonly description: string | null;
  readonly businessValidFrom: string; readonly businessValidTo: string | null;
}
export interface DepartmentVersion extends DepartmentVersionContent {
  readonly id: string; readonly departmentId: string; readonly versionNo: string;
  readonly governanceStatus: 'DRAFT' | 'PUBLISHED'; readonly recordedFrom: string;
  readonly recordedTo: string | null; readonly releaseId: string | null; readonly contentHash: Buffer;
}
export interface DepartmentIdentity {
  readonly id: string;
  readonly governanceObjectId: string;
  readonly departmentCode: string;
}
export interface DepartmentSourceMapping {
  readonly id: string; readonly departmentId: string; readonly sourceSystem: string;
  readonly sourceDepartmentCode: string; readonly sourceDepartmentName: string;
  readonly matchMethod: DepartmentSourceMatchMethod; readonly mappingStatus: DepartmentSourceMappingStatus;
}
export interface DepartmentCampusAssignment {
  readonly id: string; readonly departmentId: string; readonly campusId: string;
  readonly businessValidFrom: string; readonly businessValidTo: string | null;
  readonly recordedFrom: string; readonly recordedTo: string | null; readonly contentHash: Buffer;
}
export interface PublishedDepartmentProjection {
  readonly id: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly departmentCode: string;
  readonly standardName: string;
  readonly departmentType: DepartmentType;
  readonly subjectMappingApplicability: SubjectMappingApplicability;
  readonly campuses: readonly string[];
  readonly hierarchies: Readonly<Record<string, string>>;
  readonly qualityScore: string | null;
  readonly publishedReleaseId: string;
  readonly publishedAt: string;
  readonly supersededAt: string | null;
  readonly contentHash: Buffer;
  readonly createdAt: string;
}
export type PublishedDepartmentProjectionSnapshot = Omit<
  PublishedDepartmentProjection,
  'id' | 'supersededAt' | 'createdAt'
>;
export interface DepartmentHierarchyView {
  readonly id: string; readonly governanceObjectId: string; readonly viewCode: string;
  readonly viewName: string; readonly viewType: DepartmentHierarchyViewType; readonly operationalEnabled: boolean;
}
export interface DepartmentHierarchyViewVersion {
  readonly id: string; readonly hierarchyViewId: string; readonly versionNo: string;
  readonly governanceStatus: 'DRAFT' | 'PUBLISHED'; readonly businessValidFrom: string;
  readonly businessValidTo: string | null; readonly recordedFrom: string; readonly recordedTo: string | null;
  readonly releaseId: string | null; readonly contentHash: Buffer;
}
export type HierarchyNodeInput =
  | { readonly nodeKey: string; readonly parentNodeKey: string | null; readonly nodeKind: 'DEPARTMENT'; readonly departmentId: string; readonly departmentVersionId: string; readonly displayName: string; readonly sortOrder: number }
  | { readonly nodeKey: string; readonly parentNodeKey: string | null; readonly nodeKind: 'GROUP'; readonly groupId: string; readonly groupVersionId: string; readonly displayName: string; readonly sortOrder: number };
export type DepartmentHierarchyNode = { readonly id: string; readonly parentNodeId: string | null; readonly displayName: string; readonly sortOrder: number } & (
  | { readonly nodeKind: 'DEPARTMENT'; readonly departmentId: string; readonly departmentVersionId: string; readonly groupId: null; readonly groupVersionId: null }
  | { readonly nodeKind: 'GROUP'; readonly departmentId: null; readonly departmentVersionId: null; readonly groupId: string; readonly groupVersionId: string }
);
export interface DepartmentHierarchySnapshot { readonly view: DepartmentHierarchyView; readonly version: DepartmentHierarchyViewVersion; readonly nodes: readonly DepartmentHierarchyNode[] }
export interface PreparedDepartmentPublication { readonly departmentId: string; readonly departmentVersionId: string; readonly contentHash: Buffer; readonly projection: DepartmentMasterProjection }
export interface PreparedHierarchyPublication { readonly hierarchyViewId: string; readonly hierarchyViewVersionId: string; readonly contentHash: Buffer; readonly projection: DepartmentHierarchyProjection }

export interface DepartmentMasterModule {
  createDepartment(command: DepartmentVersionContent & { readonly governanceObjectId: string; readonly departmentCode: string; readonly recordedFrom: string; readonly actorPrincipalId: string }): Promise<DepartmentVersion>;
  createDepartmentVersion(command: DepartmentVersionContent & { readonly governanceObjectId: string; readonly departmentId: string; readonly recordedFrom: string; readonly actorPrincipalId: string }): Promise<DepartmentVersion>;
  getDepartmentIdentity(command: { readonly governanceObjectId: string; readonly departmentId: string }): Promise<DepartmentIdentity>;
  getDepartmentVersion(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly departmentVersionId: string }): Promise<DepartmentVersion>;
  listDepartmentVersions(command: { readonly governanceObjectId: string; readonly departmentId: string }): Promise<readonly DepartmentVersion[]>;
  updateDepartmentDraft(command: DepartmentVersionContent & { readonly governanceObjectId: string; readonly departmentId: string; readonly departmentVersionId: string; readonly actorPrincipalId: string }): Promise<DepartmentVersion>;
  prepareDepartmentPublication(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly departmentVersionId: string }): Promise<PreparedDepartmentPublication>;
  confirmDepartmentPublication(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly departmentVersionId: string; readonly releaseId: string; readonly recordedFrom: string; readonly actorPrincipalId: string }): Promise<void>;
  addAlias(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly sourceSystem: string; readonly sourceCode: string; readonly sourceName: string; readonly confidenceScore: string | null }): Promise<void>;
  addSourceMapping(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly sourceSystem: string; readonly sourceDepartmentCode: string; readonly sourceDepartmentName: string; readonly matchMethod: DepartmentSourceMatchMethod }): Promise<DepartmentSourceMapping>;
  listSourceMappings(command: { readonly governanceObjectId: string; readonly departmentId: string }): Promise<readonly DepartmentSourceMapping[]>;
  confirmSourceMapping(command: { readonly governanceObjectId: string; readonly mappingId: string }): Promise<DepartmentSourceMapping>;
  rejectSourceMapping(command: { readonly governanceObjectId: string; readonly mappingId: string; readonly reason: string }): Promise<DepartmentSourceMapping>;
  recordDepartmentCampusAssignment(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly campusId: string; readonly businessValidFrom: string; readonly businessValidTo: string | null; readonly recordedFrom: string; readonly actorPrincipalId: string }): Promise<DepartmentCampusAssignment>;
  listDepartmentCampusAssignments(command: { readonly governanceObjectId: string; readonly departmentId: string }): Promise<readonly DepartmentCampusAssignment[]>;
  findDepartmentCampusAssignmentsAsOf(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly businessAt: string; readonly recordAsOf: string }): Promise<readonly DepartmentCampusAssignment[]>;
  getPublishedDepartmentProjection(command: { readonly governanceObjectId: string; readonly departmentId: string }): Promise<PublishedDepartmentProjection | null>;
  findDepartmentProjectionAsOf(command: { readonly governanceObjectId: string; readonly departmentId: string; readonly businessAt: string }): Promise<PublishedDepartmentProjection | null>;
  createHierarchyView(command: { readonly governanceObjectId: string; readonly viewCode: string; readonly viewName: string; readonly viewType: DepartmentHierarchyViewType; readonly actorPrincipalId: string }): Promise<DepartmentHierarchyView>;
  createHierarchyGroupVersion(command: { readonly governanceObjectId: string; readonly hierarchyViewId: string; readonly groupCode: string; readonly displayName: string; readonly businessValidFrom: string; readonly businessValidTo: string | null; readonly recordedFrom: string; readonly actorPrincipalId: string }): Promise<{ readonly groupId: string; readonly groupVersionId: string }>;
  createHierarchyViewVersion(command: { readonly governanceObjectId: string; readonly hierarchyViewId: string; readonly businessValidFrom: string; readonly businessValidTo: string | null; readonly recordedFrom: string; readonly actorPrincipalId: string; readonly nodes: readonly HierarchyNodeInput[] }): Promise<DepartmentHierarchySnapshot>;
  updateHierarchyDraft(command: { readonly governanceObjectId: string; readonly hierarchyViewId: string; readonly hierarchyViewVersionId: string; readonly businessValidFrom: string; readonly businessValidTo: string | null; readonly nodes: readonly HierarchyNodeInput[]; readonly actorPrincipalId: string }): Promise<DepartmentHierarchySnapshot>;
  prepareHierarchyPublication(command: { readonly governanceObjectId: string; readonly hierarchyViewId: string; readonly hierarchyViewVersionId: string }): Promise<PreparedHierarchyPublication>;
  confirmHierarchyPublication(command: { readonly governanceObjectId: string; readonly hierarchyViewId: string; readonly hierarchyViewVersionId: string; readonly releaseId: string; readonly recordedFrom: string; readonly actorPrincipalId: string }): Promise<void>;
  getHierarchySnapshot(command: { readonly governanceObjectId: string; readonly hierarchyViewVersionId: string }): Promise<DepartmentHierarchySnapshot | null>;
}

export function createDepartmentMasterModule(
  database: Transaction<DB>,
  audit: AuditEventService,
  context: RequestContext,
  campusReferences: CampusReferenceReader,
): DepartmentMasterModule {
  const governanceAudit = createDepartmentGovernanceAudit(audit, context);
  const module: DepartmentMasterModule = {
    async createDepartment(command) {
      validateDepartmentVersionContent(command); assertEvolutionSupported(command.businessStatus); parseLocalDateTime(command.recordedFrom);
      const departmentId = await nextUuid(database); const versionId = await nextUuid(database);
      const hash = departmentSemanticHash({ ...command, departmentId, departmentVersionId: versionId, versionNo: '1' });
      await database.insertInto('department_master.department').values({ department_id: departmentId, governance_object_id: command.governanceObjectId, department_code: command.departmentCode, created_by: command.actorPrincipalId, updated_by: command.actorPrincipalId }).execute();
      await insertVersion(database, { ...command, departmentId, departmentVersionId: versionId, versionNo: '1', contentHash: hash });
      await governanceAudit.departmentCreated({ governanceObjectId: command.governanceObjectId, departmentId, creator: command.actorPrincipalId });
      await governanceAudit.departmentVersionCreated({ governanceObjectId: command.governanceObjectId, departmentId, departmentVersionId: versionId, versionNo: '1', contentHash: hash });
      return getVersion(database, command.governanceObjectId, departmentId, versionId);
    },
    async createDepartmentVersion(command) {
      validateDepartmentVersionContent(command); assertEvolutionSupported(command.businessStatus); parseLocalDateTime(command.recordedFrom);
      await requireDepartment(database, command.governanceObjectId, command.departmentId, true);
      const last = await database.selectFrom('department_master.department_version').select('version_no').where('department_id', '=', command.departmentId).orderBy('version_no', 'desc').limit(1).executeTakeFirst();
      const versionNo = String(BigInt(last?.version_no ?? '0') + 1n); const versionId = await nextUuid(database);
      const hash = departmentSemanticHash({ ...command, departmentVersionId: versionId, versionNo });
      await insertVersion(database, { ...command, departmentVersionId: versionId, versionNo, contentHash: hash });
      await governanceAudit.departmentVersionCreated({ governanceObjectId: command.governanceObjectId, departmentId: command.departmentId, departmentVersionId: versionId, versionNo, contentHash: hash });
      return getVersion(database, command.governanceObjectId, command.departmentId, versionId);
    },
    async getDepartmentIdentity(command) {
      const row = await requireDepartment(
        database,
        command.governanceObjectId,
        command.departmentId,
      );
      return {
        id: row.department_id,
        governanceObjectId: row.governance_object_id,
        departmentCode: row.department_code,
      };
    },
    getDepartmentVersion(command) { return getVersion(database, command.governanceObjectId, command.departmentId, command.departmentVersionId); },
    async listDepartmentVersions(command) {
      await requireDepartment(database, command.governanceObjectId, command.departmentId);
      return (await database
        .selectFrom('department_master.department_version')
        .selectAll()
        .where('department_id', '=', command.departmentId)
        .orderBy('version_no')
        .execute()).map(toVersion);
    },
    async updateDepartmentDraft(command) {
      validateDepartmentVersionContent(command); assertEvolutionSupported(command.businessStatus);
      const current = await getVersion(database, command.governanceObjectId, command.departmentId, command.departmentVersionId, true);
      if (current.governanceStatus !== 'DRAFT') throw new Error('DEPARTMENT_VERSION_IMMUTABLE');
      const hash = departmentSemanticHash({ ...command, versionNo: current.versionNo, recordedFrom: current.recordedFrom });
      await database.updateTable('department_master.department_version').set({ standard_name: command.standardName, short_name: command.shortName, department_type: command.departmentType, clinical_flag: command.clinicalFlag, management_flag: command.managementFlag, subject_mapping_applicability: command.subjectMappingApplicability, business_status: command.businessStatus, description: command.description, business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo, content_hash: hash, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_version_id', '=', command.departmentVersionId).executeTakeFirstOrThrow();
      await governanceAudit.departmentVersionUpdated({ governanceObjectId: command.governanceObjectId, departmentVersionId: command.departmentVersionId, beforeContentHash: current.contentHash, afterContentHash: hash });
      return getVersion(database, command.governanceObjectId, command.departmentId, command.departmentVersionId);
    },
    async prepareDepartmentPublication(command) {
      const version = await getVersion(database, command.governanceObjectId, command.departmentId, command.departmentVersionId, true);
      if (version.governanceStatus !== 'DRAFT') throw new Error('DEPARTMENT_PUBLICATION_STATE_CONFLICT'); assertEvolutionSupported(version.businessStatus);
      const code = (await requireDepartment(database, command.governanceObjectId, command.departmentId)).department_code;
      return { departmentId: version.departmentId, departmentVersionId: version.id, contentHash: version.contentHash, projection: departmentProjection(code, version) };
    },
    async confirmDepartmentPublication(command) {
      const version = await getVersion(database, command.governanceObjectId, command.departmentId, command.departmentVersionId, true);
      if (version.governanceStatus !== 'DRAFT') throw new Error('DEPARTMENT_PUBLICATION_STATE_CONFLICT'); assertEvolutionSupported(version.businessStatus);
      const old = await database.selectFrom('department_master.department_version').select(['department_version_id', 'recorded_from']).where('department_id', '=', command.departmentId).where('governance_status', '=', 'PUBLISHED').where('recorded_to', 'is', null).forUpdate().executeTakeFirst();
      if (old) { if (command.recordedFrom <= old.recorded_from) throw new Error('DEPARTMENT_RECORDED_TIME_CONFLICT'); await database.updateTable('department_master.department_version').set({ recorded_to: command.recordedFrom, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_version_id', '=', old.department_version_id).executeTakeFirstOrThrow(); }
      const result = await database.updateTable('department_master.department_version').set({ governance_status: 'PUBLISHED', release_id: command.releaseId, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_version_id', '=', command.departmentVersionId).where('governance_status', '=', 'DRAFT').executeTakeFirst();
      if (result.numUpdatedRows !== 1n) throw new Error('DEPARTMENT_PUBLICATION_STATE_CONFLICT');
      const code = (await requireDepartment(database, command.governanceObjectId, command.departmentId)).department_code;
      const snapshot = await buildPublishedProjectionSnapshot(database, campusReferences, {
        ...version,
        governanceStatus: 'PUBLISHED',
        releaseId: command.releaseId,
      }, code, command.releaseId, command.recordedFrom);
      const closed = await database.updateTable('department_master.department_published_projection').set({ superseded_at: command.recordedFrom }).where('department_id', '=', command.departmentId).where('superseded_at', 'is', null).executeTakeFirst();
      if (old && closed.numUpdatedRows !== 1n) throw new Error('DEPARTMENT_PROJECTION_CURRENT_NOT_FOUND');
      if (!old && closed.numUpdatedRows !== 0n) throw new Error('DEPARTMENT_PROJECTION_STATE_CONFLICT');
      await database.insertInto('department_master.department_published_projection').values({ department_id: snapshot.departmentId, department_version_id: snapshot.departmentVersionId, department_code: snapshot.departmentCode, standard_name: snapshot.standardName, department_type: snapshot.departmentType, subject_mapping_applicability: snapshot.subjectMappingApplicability, campuses: sql`${JSON.stringify(snapshot.campuses)}::jsonb`, hierarchies: sql`${JSON.stringify(snapshot.hierarchies)}::jsonb`, quality_score: snapshot.qualityScore, published_release_id: snapshot.publishedReleaseId, published_at: snapshot.publishedAt, content_hash: snapshot.contentHash }).execute();
      hitControlledPublicationFault('DOMAIN_CANDIDATE_CONFIRMED');
      await governanceAudit.departmentPublished({ governanceObjectId: command.governanceObjectId, departmentVersionId: command.departmentVersionId, releaseId: command.releaseId, publishedAt: command.recordedFrom, contentHash: version.contentHash });
    },
    async addAlias(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); await database.insertInto('department_master.department_alias').values({ department_id: command.departmentId, source_system: command.sourceSystem, source_code: command.sourceCode, source_name: command.sourceName, mapping_status: 'CONFIRMED', confidence_score: command.confidenceScore }).execute(); },
    async addSourceMapping(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); const mapping = toMapping(await database.insertInto('department_master.department_source_mapping').values({ department_id: command.departmentId, source_system: command.sourceSystem, source_department_code: command.sourceDepartmentCode, source_department_name: command.sourceDepartmentName, match_method: command.matchMethod, mapping_status: 'PENDING' }).returningAll().executeTakeFirstOrThrow()); await governanceAudit.sourceMappingCreated({ governanceObjectId: command.governanceObjectId, mappingId: mapping.id, sourceSystem: command.sourceSystem, sourceCode: command.sourceDepartmentCode, departmentId: command.departmentId }); return mapping; },
    async listSourceMappings(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); return (await database.selectFrom('department_master.department_source_mapping').selectAll().where('department_id', '=', command.departmentId).orderBy('source_system').execute()).map(toMapping); },
    async confirmSourceMapping(command) { const mapping = await transitionMapping(database, command, 'CONFIRMED'); await governanceAudit.sourceMappingConfirmed({ governanceObjectId: command.governanceObjectId, mappingId: mapping.id, operator: context.actorPrincipalId }); return mapping; },
    async rejectSourceMapping(command) { if (!command.reason.trim()) throw new Error('DEPARTMENT_SOURCE_MAPPING_REJECTION_REASON_REQUIRED'); const mapping = await transitionMapping(database, command, 'REJECTED'); await governanceAudit.sourceMappingRejected({ governanceObjectId: command.governanceObjectId, mappingId: mapping.id, reason: command.reason }); return mapping; },
    async recordDepartmentCampusAssignment(command) {
      await requireDepartment(database, command.governanceObjectId, command.departmentId); validatePeriod(command.businessValidFrom, command.businessValidTo); parseLocalDateTime(command.recordedFrom);
      const current = await database.selectFrom('department_master.department_campus_assignment').selectAll().where('department_id', '=', command.departmentId).where('campus_id', '=', command.campusId).where('recorded_to', 'is', null).forUpdate().executeTakeFirst();
      if (current) { if (command.recordedFrom <= current.recorded_from) throw new Error('DEPARTMENT_CAMPUS_RECORDED_TIME_CONFLICT'); await database.updateTable('department_master.department_campus_assignment').set({ recorded_to: command.recordedFrom, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_campus_assignment_id', '=', current.department_campus_assignment_id).executeTakeFirstOrThrow(); }
      const id = await nextUuid(database); const hash = canonicalSha256({ assignmentId: id, departmentId: command.departmentId, campusId: command.campusId, businessValidFrom: command.businessValidFrom, businessValidTo: command.businessValidTo, recordedFrom: command.recordedFrom });
      const assignment = toAssignment(await database.insertInto('department_master.department_campus_assignment').values({ department_campus_assignment_id: id, department_id: command.departmentId, campus_id: command.campusId, business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo, recorded_from: command.recordedFrom, recorded_to: null, content_hash: hash, created_by: command.actorPrincipalId, updated_by: command.actorPrincipalId }).returningAll().executeTakeFirstOrThrow());
      if (current) await governanceAudit.campusChanged({ governanceObjectId: command.governanceObjectId, assignmentId: assignment.id, oldAssignment: assignmentAuditSnapshot({ ...toAssignment(current), recordedTo: command.recordedFrom }), newAssignment: assignmentAuditSnapshot(assignment), contentHash: hash });
      else await governanceAudit.campusAssigned({ governanceObjectId: command.governanceObjectId, assignmentId: assignment.id, departmentId: command.departmentId, campusId: command.campusId, contentHash: hash });
      return assignment;
    },
    async listDepartmentCampusAssignments(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); return (await database.selectFrom('department_master.department_campus_assignment').selectAll().where('department_id', '=', command.departmentId).orderBy('recorded_from').execute()).map(toAssignment); },
    async findDepartmentCampusAssignmentsAsOf(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); parseLocalDateTime(command.businessAt); parseLocalDateTime(command.recordAsOf); return (await database.selectFrom('department_master.department_campus_assignment').selectAll().where('department_id', '=', command.departmentId).where(sql<boolean>`business_period @> ${command.businessAt}::timestamp`).where(sql<boolean>`recorded_period @> ${command.recordAsOf}::timestamp`).orderBy('campus_id').execute()).map(toAssignment); },
    async getPublishedDepartmentProjection(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); const row = await database.selectFrom('department_master.department_published_projection').selectAll().where('department_id', '=', command.departmentId).where('superseded_at', 'is', null).executeTakeFirst(); return row ? toPublishedProjection(row) : null; },
    async findDepartmentProjectionAsOf(command) { await requireDepartment(database, command.governanceObjectId, command.departmentId); parseLocalDateTime(command.businessAt); const row = await database.selectFrom('department_master.department_published_projection').selectAll().where('department_id', '=', command.departmentId).where('published_at', '<=', command.businessAt).where((expression) => expression.or([expression('superseded_at', 'is', null), expression('superseded_at', '>', command.businessAt)])).orderBy('published_at', 'desc').limit(1).executeTakeFirst(); return row ? toPublishedProjection(row) : null; },
    async createHierarchyView(command) { const row = await database.insertInto('department_master.department_hierarchy_view').values({ governance_object_id: command.governanceObjectId, view_code: command.viewCode, view_name: command.viewName, view_type: command.viewType, operational_enabled: operationalViews.has(command.viewType), created_by: command.actorPrincipalId, updated_by: command.actorPrincipalId }).returningAll().executeTakeFirstOrThrow(); const view = toView(row); await governanceAudit.hierarchyViewCreated({ governanceObjectId: command.governanceObjectId, viewId: view.id, viewType: view.viewType }); return view; },
    async createHierarchyGroupVersion(command) { await requireView(database, command.governanceObjectId, command.hierarchyViewId); const groupId = await nextUuid(database); const versionId = await nextUuid(database); await database.insertInto('department_master.department_hierarchy_group').values({ department_hierarchy_group_id: groupId, department_hierarchy_view_id: command.hierarchyViewId, group_code: command.groupCode, created_by: command.actorPrincipalId, updated_by: command.actorPrincipalId }).execute(); await database.insertInto('department_master.department_hierarchy_group_version').values({ department_hierarchy_group_version_id: versionId, department_hierarchy_group_id: groupId, department_hierarchy_view_id: command.hierarchyViewId, version_no: '1', display_name: command.displayName, business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo, recorded_from: command.recordedFrom, recorded_to: null, content_hash: canonicalSha256(command), created_by: command.actorPrincipalId, updated_by: command.actorPrincipalId }).execute(); return { groupId, groupVersionId: versionId }; },
    async createHierarchyViewVersion(command) {
      const view = await requireView(database, command.governanceObjectId, command.hierarchyViewId, true); if (!view.operational_enabled) throw new Error('DEPARTMENT_HIERARCHY_VIEW_REGISTRATION_ONLY'); validateHierarchyNodeInput(command.nodes); validatePeriod(command.businessValidFrom, command.businessValidTo); parseLocalDateTime(command.recordedFrom);
      const last = await database.selectFrom('department_master.department_hierarchy_view_version').select('version_no').where('department_hierarchy_view_id', '=', command.hierarchyViewId).orderBy('version_no', 'desc').limit(1).executeTakeFirst(); const versionNo = String(BigInt(last?.version_no ?? '0') + 1n); const versionId = await nextUuid(database); const nodes = await freezeNodes(database, command.nodes); const hash = hierarchyHash(command.hierarchyViewId, versionId, versionNo, command.businessValidFrom, command.businessValidTo, command.recordedFrom, nodes);
      await database.insertInto('department_master.department_hierarchy_view_version').values({ department_hierarchy_view_version_id: versionId, department_hierarchy_view_id: command.hierarchyViewId, version_no: versionNo, governance_status: 'DRAFT', business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo, recorded_from: command.recordedFrom, recorded_to: null, release_id: null, content_hash: hash, created_by: command.actorPrincipalId, updated_by: command.actorPrincipalId }).execute(); await insertNodes(database, command.hierarchyViewId, versionId, nodes); await governanceAudit.hierarchyVersionCreated({ governanceObjectId: command.governanceObjectId, viewId: command.hierarchyViewId, viewVersionId: versionId, contentHash: hash }); return (await module.getHierarchySnapshot({ governanceObjectId: command.governanceObjectId, hierarchyViewVersionId: versionId }))!;
    },
    async updateHierarchyDraft(command) { const row = await getHierarchyRow(database, command.governanceObjectId, command.hierarchyViewVersionId, true); if (!row || row.department_hierarchy_view_id !== command.hierarchyViewId) throw new Error('DEPARTMENT_HIERARCHY_VERSION_NOT_FOUND'); if (row.governance_status !== 'DRAFT') throw new Error('DEPARTMENT_HIERARCHY_VERSION_IMMUTABLE'); validatePeriod(command.businessValidFrom, command.businessValidTo); validateHierarchyNodeInput(command.nodes); const nodes = await freezeNodes(database, command.nodes); const hash = hierarchyHash(command.hierarchyViewId, command.hierarchyViewVersionId, row.version_no, command.businessValidFrom, command.businessValidTo, row.recorded_from, nodes); await database.deleteFrom('department_master.department_hierarchy_node').where('department_hierarchy_view_version_id', '=', command.hierarchyViewVersionId).execute(); await database.updateTable('department_master.department_hierarchy_view_version').set({ business_valid_from: command.businessValidFrom, business_valid_to: command.businessValidTo, content_hash: hash, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_hierarchy_view_version_id', '=', command.hierarchyViewVersionId).executeTakeFirstOrThrow(); await insertNodes(database, command.hierarchyViewId, command.hierarchyViewVersionId, nodes); return (await module.getHierarchySnapshot({ governanceObjectId: command.governanceObjectId, hierarchyViewVersionId: command.hierarchyViewVersionId }))!; },
    async prepareHierarchyPublication(command) { const snapshot = await module.getHierarchySnapshot({ governanceObjectId: command.governanceObjectId, hierarchyViewVersionId: command.hierarchyViewVersionId }); if (!snapshot || snapshot.version.hierarchyViewId !== command.hierarchyViewId) throw new Error('DEPARTMENT_HIERARCHY_VERSION_NOT_FOUND'); if (snapshot.version.governanceStatus !== 'DRAFT') throw new Error('DEPARTMENT_HIERARCHY_PUBLICATION_STATE_CONFLICT'); return { hierarchyViewId: command.hierarchyViewId, hierarchyViewVersionId: command.hierarchyViewVersionId, contentHash: snapshot.version.contentHash, projection: hierarchyProjection(snapshot) }; },
    async confirmHierarchyPublication(command) { const row = await getHierarchyRow(database, command.governanceObjectId, command.hierarchyViewVersionId, true); if (!row || row.governance_status !== 'DRAFT' || row.department_hierarchy_view_id !== command.hierarchyViewId) throw new Error('DEPARTMENT_HIERARCHY_PUBLICATION_STATE_CONFLICT'); const old = await database.selectFrom('department_master.department_hierarchy_view_version').select(['department_hierarchy_view_version_id', 'recorded_from']).where('department_hierarchy_view_id', '=', command.hierarchyViewId).where('governance_status', '=', 'PUBLISHED').where('recorded_to', 'is', null).forUpdate().executeTakeFirst(); if (old) { if (command.recordedFrom <= old.recorded_from) throw new Error('DEPARTMENT_HIERARCHY_RECORDED_TIME_CONFLICT'); await database.updateTable('department_master.department_hierarchy_view_version').set({ recorded_to: command.recordedFrom, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_hierarchy_view_version_id', '=', old.department_hierarchy_view_version_id).executeTakeFirstOrThrow(); } const result = await database.updateTable('department_master.department_hierarchy_view_version').set({ governance_status: 'PUBLISHED', release_id: command.releaseId, updated_at: sql<string>`platform.local_now()`, updated_by: command.actorPrincipalId }).where('department_hierarchy_view_version_id', '=', command.hierarchyViewVersionId).where('governance_status', '=', 'DRAFT').executeTakeFirst(); if (result.numUpdatedRows !== 1n) throw new Error('DEPARTMENT_HIERARCHY_PUBLICATION_STATE_CONFLICT'); await governanceAudit.hierarchyPublished({ governanceObjectId: command.governanceObjectId, viewId: command.hierarchyViewId, viewVersionId: command.hierarchyViewVersionId, releaseId: command.releaseId, contentHash: row.content_hash }); if (old) await recordHierarchyNodeMoves(database, governanceAudit, command.governanceObjectId, row.view_type, old.department_hierarchy_view_version_id, command.hierarchyViewVersionId); },
    async getHierarchySnapshot(command) { const row = await getHierarchyRow(database, command.governanceObjectId, command.hierarchyViewVersionId); return row ? { view: toView(row), version: toHierarchyVersion(row), nodes: await selectNodes(database, command.hierarchyViewVersionId) } : null; },
  };
  return module;
}

export function createPublishedProjectionSnapshot(input: {
  readonly sourceGovernanceStatus: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly departmentCode: string;
  readonly standardName: string;
  readonly departmentType: DepartmentType;
  readonly subjectMappingApplicability: SubjectMappingApplicability;
  readonly campuses: readonly string[];
  readonly hierarchies: Readonly<Record<string, string>>;
  readonly qualityScore: string | null;
  readonly publishedReleaseId: string;
  readonly publishedAt: string;
  readonly contentHash: Buffer;
}): PublishedDepartmentProjectionSnapshot {
  if (input.sourceGovernanceStatus !== 'PUBLISHED') {
    throw new Error('DEPARTMENT_PROJECTION_REQUIRES_PUBLISHED_VERSION');
  }
  parseLocalDateTime(input.publishedAt);
  return Object.freeze({
    departmentId: input.departmentId,
    departmentVersionId: input.departmentVersionId,
    departmentCode: input.departmentCode,
    standardName: input.standardName,
    departmentType: input.departmentType,
    subjectMappingApplicability: input.subjectMappingApplicability,
    campuses: Object.freeze([...input.campuses]),
    hierarchies: Object.freeze({ ...input.hierarchies }),
    qualityScore: input.qualityScore,
    publishedReleaseId: input.publishedReleaseId,
    publishedAt: input.publishedAt,
    contentHash: Buffer.from(input.contentHash),
  });
}

async function buildPublishedProjectionSnapshot(
  db: Transaction<DB>,
  campusReferences: CampusReferenceReader,
  version: DepartmentVersion,
  departmentCode: string,
  publishedReleaseId: string,
  publishedAt: string,
): Promise<PublishedDepartmentProjectionSnapshot> {
  const assignments = await db
    .selectFrom('department_master.department_campus_assignment')
    .select('campus_id')
    .where('department_id', '=', version.departmentId)
    .where(sql<boolean>`business_period @> ${version.businessValidFrom}::timestamp`)
    .where(sql<boolean>`recorded_period @> ${publishedAt}::timestamp`)
    .orderBy('campus_id')
    .execute();
  const campuses = await campusReferences.getDisplayNames(assignments.map((row) => row.campus_id));
  const hierarchyRows = await db
    .selectFrom('department_master.department_hierarchy_view_version as hierarchy_version')
    .innerJoin('department_master.department_hierarchy_view as hierarchy_view', 'hierarchy_view.department_hierarchy_view_id', 'hierarchy_version.department_hierarchy_view_id')
    .innerJoin('department_master.department_hierarchy_node as department_node', 'department_node.department_hierarchy_view_version_id', 'hierarchy_version.department_hierarchy_view_version_id')
    .select(['hierarchy_version.department_hierarchy_view_version_id', 'hierarchy_view.view_code', 'hierarchy_view.view_type', 'department_node.department_hierarchy_node_id'])
    .where('hierarchy_version.governance_status', '=', 'PUBLISHED')
    .where('department_node.department_id', '=', version.departmentId)
    .where(sql<boolean>`hierarchy_version.business_period @> ${version.businessValidFrom}::timestamp`)
    .where(sql<boolean>`hierarchy_version.recorded_period @> ${publishedAt}::timestamp`)
    .orderBy('hierarchy_view.view_type')
    .orderBy('hierarchy_view.view_code')
    .execute();
  const hierarchies: Record<string, string> = {};
  for (const row of hierarchyRows) {
    if (row.view_type in hierarchies) {
      throw new Error('DEPARTMENT_PROJECTION_HIERARCHY_TYPE_AMBIGUOUS');
    }
    const nodes = await selectNodes(db, row.department_hierarchy_view_version_id);
    const node = nodes.find((candidate) => candidate.id === row.department_hierarchy_node_id);
    if (!node) throw new Error('DEPARTMENT_PROJECTION_HIERARCHY_NODE_NOT_FOUND');
    hierarchies[row.view_type] = hierarchySnapshotPath(nodes, node);
  }
  const quality = await db
    .selectFrom('department_master.department_quality_score')
    .select('overall_score')
    .where('department_id', '=', version.departmentId)
    .where('calculated_at', '<=', publishedAt)
    .orderBy('calculated_at', 'desc')
    .orderBy('department_quality_score_id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return createPublishedProjectionSnapshot({
    sourceGovernanceStatus: version.governanceStatus,
    departmentId: version.departmentId,
    departmentVersionId: version.id,
    departmentCode,
    standardName: version.standardName,
    departmentType: version.departmentType,
    subjectMappingApplicability: version.subjectMappingApplicability,
    campuses,
    hierarchies,
    qualityScore: quality?.overall_score ?? null,
    publishedReleaseId,
    publishedAt,
    contentHash: version.contentHash,
  });
}

function hierarchySnapshotPath(
  nodes: readonly DepartmentHierarchyNode[],
  departmentNode: DepartmentHierarchyNode,
): string {
  const labels: string[] = [];
  let parentId = departmentNode.parentNodeId;
  const visited = new Set<string>();
  while (parentId !== null) {
    if (visited.has(parentId)) throw new Error('DEPARTMENT_PROJECTION_HIERARCHY_CYCLE');
    visited.add(parentId);
    const parent = nodes.find((candidate) => candidate.id === parentId);
    if (!parent) throw new Error('DEPARTMENT_PROJECTION_HIERARCHY_PARENT_NOT_FOUND');
    labels.unshift(parent.displayName);
    parentId = parent.parentNodeId;
  }
  return labels.length === 0 ? departmentNode.displayName : labels.join(' / ');
}

export function departmentSemanticHash(value: DepartmentVersionContent & { readonly departmentId: string; readonly departmentVersionId: string; readonly versionNo: string; readonly recordedFrom: string }): Buffer { return canonicalSha256({ departmentId: value.departmentId, departmentVersionId: value.departmentVersionId, versionNo: value.versionNo, standardName: value.standardName, shortName: value.shortName, departmentType: value.departmentType, clinicalFlag: value.clinicalFlag, managementFlag: value.managementFlag, subjectMappingApplicability: value.subjectMappingApplicability, businessStatus: value.businessStatus, description: value.description, businessValidFrom: value.businessValidFrom, businessValidTo: value.businessValidTo, recordedFrom: value.recordedFrom }); }
export function validateDepartmentVersionContent(value: DepartmentVersionContent): void { validatePeriod(value.businessValidFrom, value.businessValidTo); if (!value.standardName.trim()) throw new Error('DEPARTMENT_STANDARD_NAME_INVALID'); if (value.clinicalFlag && value.subjectMappingApplicability.startsWith('EXEMPT_')) throw new Error('CLINICAL_DEPARTMENT_CANNOT_BE_EXEMPT'); if (value.subjectMappingApplicability === 'EXEMPT_MEDICAL_TECHNOLOGY' && value.departmentType !== 'MEDICAL_TECHNOLOGY') throw new Error('MEDICAL_TECHNOLOGY_EXEMPTION_REQUIRES_MEDICAL_TECHNOLOGY_TYPE'); if (value.subjectMappingApplicability === 'EXEMPT_AUXILIARY' && value.departmentType !== 'AUXILIARY') throw new Error('AUXILIARY_EXEMPTION_REQUIRES_AUXILIARY_TYPE'); }
export function assertEvolutionSupported(status: DepartmentBusinessStatus): void { if (status === 'SUPERSEDED') throw new Error('DEPARTMENT_EVOLUTION_RELATION_REQUIRED'); }
export function assertSourceMappingTransition(from: DepartmentSourceMappingStatus, to: DepartmentSourceMappingStatus): void { if (from !== 'PENDING' || (to !== 'CONFIRMED' && to !== 'REJECTED')) throw new Error('DEPARTMENT_SOURCE_MAPPING_TRANSITION_INVALID'); }
export function validateHierarchyNodeInput(nodes: readonly HierarchyNodeInput[]): void { const keys = new Set<string>(); const departments = new Set<string>(); const groups = new Set<string>(); for (const node of nodes) { if (keys.has(node.nodeKey)) throw new Error('DEPARTMENT_HIERARCHY_NODE_KEY_DUPLICATE'); keys.add(node.nodeKey); const ids = node.nodeKind === 'DEPARTMENT' ? departments : groups; const id = node.nodeKind === 'DEPARTMENT' ? node.departmentId : node.groupId; if (ids.has(id)) throw new Error(node.nodeKind === 'DEPARTMENT' ? 'DEPARTMENT_HIERARCHY_DEPARTMENT_DUPLICATE' : 'DEPARTMENT_HIERARCHY_GROUP_DUPLICATE'); ids.add(id); } const parents = new Map(nodes.map((node) => [node.nodeKey, node.parentNodeKey])); for (const node of nodes) { if (node.parentNodeKey !== null && !keys.has(node.parentNodeKey)) throw new Error('DEPARTMENT_HIERARCHY_PARENT_NOT_FOUND'); const seen = new Set<string>(); let key: string | null = node.nodeKey; while (key !== null) { if (seen.has(key)) throw new Error('DEPARTMENT_HIERARCHY_CYCLE'); seen.add(key); key = parents.get(key) ?? null; } } }

type FrozenNode = HierarchyNodeInput & { readonly nodeId: string; readonly parentNodeId: string | null };
async function insertVersion(db: Transaction<DB>, value: DepartmentVersionContent & { departmentId: string; departmentVersionId: string; versionNo: string; recordedFrom: string; actorPrincipalId: string; contentHash: Buffer }): Promise<void> { await db.insertInto('department_master.department_version').values({ department_version_id: value.departmentVersionId, department_id: value.departmentId, version_no: value.versionNo, standard_name: value.standardName, short_name: value.shortName, department_type: value.departmentType, clinical_flag: value.clinicalFlag, management_flag: value.managementFlag, subject_mapping_applicability: value.subjectMappingApplicability, business_status: value.businessStatus, governance_status: 'DRAFT', description: value.description, business_valid_from: value.businessValidFrom, business_valid_to: value.businessValidTo, recorded_from: value.recordedFrom, recorded_to: null, release_id: null, content_hash: value.contentHash, created_by: value.actorPrincipalId, updated_by: value.actorPrincipalId }).execute(); }
async function getVersion(db: Transaction<DB>, objectId: string, departmentId: string, versionId: string, lock = false): Promise<DepartmentVersion> { let query = db.selectFrom('department_master.department_version as version').innerJoin('department_master.department as department', 'department.department_id', 'version.department_id').selectAll('version').where('department.governance_object_id', '=', objectId).where('version.department_id', '=', departmentId).where('version.department_version_id', '=', versionId); if (lock) query = query.forUpdate(); const row = await query.executeTakeFirst(); if (!row) throw new Error('DEPARTMENT_VERSION_NOT_FOUND'); return toVersion(row); }
async function requireDepartment(db: Transaction<DB>, objectId: string, departmentId: string, lock = false) { let query = db.selectFrom('department_master.department').selectAll().where('governance_object_id', '=', objectId).where('department_id', '=', departmentId); if (lock) query = query.forUpdate(); const row = await query.executeTakeFirst(); if (!row) throw new Error('DEPARTMENT_NOT_FOUND'); return row; }
async function transitionMapping(db: Transaction<DB>, command: { governanceObjectId: string; mappingId: string }, next: 'CONFIRMED' | 'REJECTED'): Promise<DepartmentSourceMapping> { const current = await db.selectFrom('department_master.department_source_mapping as mapping').innerJoin('department_master.department as department', 'department.department_id', 'mapping.department_id').selectAll('mapping').where('department.governance_object_id', '=', command.governanceObjectId).where('mapping.department_mapping_id', '=', command.mappingId).forUpdate().executeTakeFirst(); if (!current) throw new Error('DEPARTMENT_SOURCE_MAPPING_NOT_FOUND'); assertSourceMappingTransition(current.mapping_status as DepartmentSourceMappingStatus, next); return toMapping(await db.updateTable('department_master.department_source_mapping').set({ mapping_status: next, updated_at: sql<string>`platform.local_now()` }).where('department_mapping_id', '=', command.mappingId).returningAll().executeTakeFirstOrThrow()); }
async function requireView(db: Transaction<DB>, objectId: string, viewId: string, lock = false) { let query = db.selectFrom('department_master.department_hierarchy_view').selectAll().where('governance_object_id', '=', objectId).where('department_hierarchy_view_id', '=', viewId); if (lock) query = query.forUpdate(); const row = await query.executeTakeFirst(); if (!row) throw new Error('DEPARTMENT_HIERARCHY_VIEW_NOT_FOUND'); return row; }
async function getHierarchyRow(db: Transaction<DB>, objectId: string, versionId: string, lock = false) { let query = db.selectFrom('department_master.department_hierarchy_view_version as version').innerJoin('department_master.department_hierarchy_view as view', 'view.department_hierarchy_view_id', 'version.department_hierarchy_view_id').selectAll('version').selectAll('view').where('view.governance_object_id', '=', objectId).where('version.department_hierarchy_view_version_id', '=', versionId); if (lock) query = query.forUpdate(); return query.executeTakeFirst(); }
async function freezeNodes(db: Transaction<DB>, input: readonly HierarchyNodeInput[]): Promise<readonly FrozenNode[]> { const ids = new Map<string, string>(); for (const node of input) ids.set(node.nodeKey, await nextUuid(db)); return input.map((node) => ({ ...node, nodeId: ids.get(node.nodeKey)!, parentNodeId: node.parentNodeKey === null ? null : ids.get(node.parentNodeKey)! })); }
async function insertNodes(db: Transaction<DB>, viewId: string, versionId: string, nodes: readonly FrozenNode[]): Promise<void> { for (const node of nodes) await db.insertInto('department_master.department_hierarchy_node').values({ department_hierarchy_node_id: node.nodeId, department_hierarchy_view_version_id: versionId, department_hierarchy_view_id: viewId, parent_node_id: node.parentNodeId, node_kind: node.nodeKind, department_id: node.nodeKind === 'DEPARTMENT' ? node.departmentId : null, department_version_id: node.nodeKind === 'DEPARTMENT' ? node.departmentVersionId : null, department_hierarchy_group_id: node.nodeKind === 'GROUP' ? node.groupId : null, department_hierarchy_group_version_id: node.nodeKind === 'GROUP' ? node.groupVersionId : null, display_name: node.displayName, sort_order: node.sortOrder }).execute(); }
async function selectNodes(db: Transaction<DB>, versionId: string): Promise<readonly DepartmentHierarchyNode[]> { return (await db.selectFrom('department_master.department_hierarchy_node').selectAll().where('department_hierarchy_view_version_id', '=', versionId).orderBy('sort_order').execute()).map((row) => row.node_kind === 'DEPARTMENT' ? { id: row.department_hierarchy_node_id, parentNodeId: row.parent_node_id, displayName: row.display_name, sortOrder: row.sort_order, nodeKind: 'DEPARTMENT' as const, departmentId: row.department_id!, departmentVersionId: row.department_version_id!, groupId: null, groupVersionId: null } : { id: row.department_hierarchy_node_id, parentNodeId: row.parent_node_id, displayName: row.display_name, sortOrder: row.sort_order, nodeKind: 'GROUP' as const, departmentId: null, departmentVersionId: null, groupId: row.department_hierarchy_group_id!, groupVersionId: row.department_hierarchy_group_version_id! }); }
function hierarchyHash(viewId: string, versionId: string, versionNo: string, from: string, to: string | null, recorded: string, nodes: readonly FrozenNode[]): Buffer { return canonicalSha256({ hierarchyViewId: viewId, hierarchyViewVersionId: versionId, versionNo, businessValidFrom: from, businessValidTo: to, recordedFrom: recorded, nodes }); }
function departmentProjection(code: string, v: DepartmentVersion): DepartmentMasterProjection { return { departmentCode: code, departmentId: v.departmentId, departmentVersionId: v.id, versionNo: v.versionNo, standardName: v.standardName, shortName: v.shortName, departmentType: v.departmentType, clinicalFlag: v.clinicalFlag, managementFlag: v.managementFlag, subjectMappingApplicability: v.subjectMappingApplicability, businessStatus: v.businessStatus, description: v.description, businessValidFrom: v.businessValidFrom, businessValidTo: v.businessValidTo, recordedFrom: v.recordedFrom, contentHash: digestHex(v.contentHash) }; }
function hierarchyProjection(s: DepartmentHierarchySnapshot): DepartmentHierarchyProjection { return { hierarchyViewId: s.view.id, hierarchyViewVersionId: s.version.id, viewCode: s.view.viewCode, viewType: s.view.viewType, versionNo: s.version.versionNo, businessValidFrom: s.version.businessValidFrom, businessValidTo: s.version.businessValidTo, recordedFrom: s.version.recordedFrom, contentHash: digestHex(s.version.contentHash), nodes: s.nodes.map((n) => ({ nodeId: n.id, parentNodeId: n.parentNodeId, nodeKind: n.nodeKind, departmentId: n.departmentId, departmentVersionId: n.departmentVersionId, groupId: n.groupId, groupVersionId: n.groupVersionId, displayName: n.displayName, sortOrder: n.sortOrder })) }; }
function toVersion(row: Selectable<DB['department_master.department_version']>): DepartmentVersion { return { id: row.department_version_id, departmentId: row.department_id, versionNo: row.version_no, standardName: row.standard_name, shortName: row.short_name, departmentType: row.department_type as DepartmentType, clinicalFlag: row.clinical_flag, managementFlag: row.management_flag, subjectMappingApplicability: row.subject_mapping_applicability as SubjectMappingApplicability, businessStatus: row.business_status as DepartmentBusinessStatus, governanceStatus: row.governance_status as 'DRAFT' | 'PUBLISHED', description: row.description, businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to, recordedFrom: row.recorded_from, recordedTo: row.recorded_to, releaseId: row.release_id, contentHash: row.content_hash }; }
function toMapping(row: Selectable<DB['department_master.department_source_mapping']>): DepartmentSourceMapping { return { id: row.department_mapping_id, departmentId: row.department_id, sourceSystem: row.source_system, sourceDepartmentCode: row.source_department_code, sourceDepartmentName: row.source_department_name, matchMethod: row.match_method as DepartmentSourceMatchMethod, mappingStatus: row.mapping_status as DepartmentSourceMappingStatus }; }
function toAssignment(row: Selectable<DB['department_master.department_campus_assignment']>): DepartmentCampusAssignment { return { id: row.department_campus_assignment_id, departmentId: row.department_id, campusId: row.campus_id, businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to, recordedFrom: row.recorded_from, recordedTo: row.recorded_to, contentHash: row.content_hash }; }
function toPublishedProjection(row: Selectable<DB['department_master.department_published_projection']>): PublishedDepartmentProjection { return { id: row.department_published_projection_id, departmentId: row.department_id, departmentVersionId: row.department_version_id, departmentCode: row.department_code, standardName: row.standard_name, departmentType: row.department_type as DepartmentType, subjectMappingApplicability: row.subject_mapping_applicability as SubjectMappingApplicability, campuses: readStringArray(row.campuses, 'DEPARTMENT_PROJECTION_CAMPUSES_INVALID'), hierarchies: readStringRecord(row.hierarchies, 'DEPARTMENT_PROJECTION_HIERARCHIES_INVALID'), qualityScore: row.quality_score, publishedReleaseId: row.published_release_id, publishedAt: row.published_at, supersededAt: row.superseded_at, contentHash: row.content_hash, createdAt: row.created_at }; }
function toView(row: Selectable<DB['department_master.department_hierarchy_view']>): DepartmentHierarchyView { return { id: row.department_hierarchy_view_id, governanceObjectId: row.governance_object_id, viewCode: row.view_code, viewName: row.view_name, viewType: row.view_type as DepartmentHierarchyViewType, operationalEnabled: row.operational_enabled }; }
function toHierarchyVersion(row: Selectable<DB['department_master.department_hierarchy_view_version']>): DepartmentHierarchyViewVersion { return { id: row.department_hierarchy_view_version_id, hierarchyViewId: row.department_hierarchy_view_id, versionNo: row.version_no, governanceStatus: row.governance_status as 'DRAFT' | 'PUBLISHED', businessValidFrom: row.business_valid_from, businessValidTo: row.business_valid_to, recordedFrom: row.recorded_from, recordedTo: row.recorded_to, releaseId: row.release_id, contentHash: row.content_hash }; }
function assignmentAuditSnapshot(assignment: DepartmentCampusAssignment): DepartmentAssignmentAuditSnapshot { return { assignmentId: assignment.id, campusId: assignment.campusId, businessValidFrom: assignment.businessValidFrom, businessValidTo: assignment.businessValidTo, recordedFrom: assignment.recordedFrom, recordedTo: assignment.recordedTo }; }
async function recordHierarchyNodeMoves(db: Transaction<DB>, audit: DepartmentGovernanceAudit, governanceObjectId: string, viewType: string, oldVersionId: string, newVersionId: string): Promise<void> { const oldNodes = await selectNodes(db, oldVersionId); const newNodes = await selectNodes(db, newVersionId); const oldByDepartment = new Map(oldNodes.filter((node) => node.nodeKind === 'DEPARTMENT').map((node) => [node.departmentId, node])); for (const node of newNodes) { if (node.nodeKind !== 'DEPARTMENT') continue; const oldNode = oldByDepartment.get(node.departmentId); if (!oldNode || parentSemanticIdentity(oldNodes, oldNode) === parentSemanticIdentity(newNodes, node)) continue; await audit.nodeMoved({ governanceObjectId, viewVersionId: newVersionId, departmentId: node.departmentId, oldParentNodeId: oldNode.parentNodeId, newParentNodeId: node.parentNodeId, hierarchyViewType: viewType }); } }
function parentSemanticIdentity(nodes: readonly DepartmentHierarchyNode[], node: DepartmentHierarchyNode): string | null { if (node.parentNodeId === null) return null; const parent = nodes.find((candidate) => candidate.id === node.parentNodeId); if (!parent) throw new Error('DEPARTMENT_HIERARCHY_PARENT_NOT_FOUND'); return parent.nodeKind === 'DEPARTMENT' ? `DEPARTMENT:${parent.departmentId}` : `GROUP:${parent.groupId}`; }
function readStringArray(value: unknown, errorCode: string): readonly string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(errorCode); return Object.freeze([...value]); }
function readStringRecord(value: unknown, errorCode: string): Readonly<Record<string, string>> { if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error(errorCode); const entries = Object.entries(value); if (entries.some(([, item]) => typeof item !== 'string')) throw new Error(errorCode); return Object.freeze(Object.fromEntries(entries) as Record<string, string>); }
function validatePeriod(from: string, to: string | null): void { parseLocalDateTime(from); if (to !== null) { parseLocalDateTime(to); if (to <= from) throw new Error('DEPARTMENT_BUSINESS_PERIOD_INVALID'); } }
const operationalViews = new Set<DepartmentHierarchyViewType>(['ADMINISTRATIVE', 'OPERATIONAL', 'MEDICAL_RECORD']);
async function nextUuid(db: Transaction<DB>): Promise<string> { return (await db.selectNoFrom((e) => e.fn<string>('uuidv7', []).as('id')).executeTakeFirstOrThrow()).id; }

export * from './department-audit.js';
export * from './application.js';
export * from './department-contracts.js';
export * from './read-model.js';
export * from './placement-reference.js';

// Current vNext Department Owner; the legacy assembly is not mounted in vNext.
export {openDepartment} from './vnext/index.js';
export {StageSchema as DepartmentStageSchema,StoredStageSchema as DepartmentStoredStageSchema,VerifySchema as DepartmentVerifySchema,PlanSchema as DepartmentPlanSchema,ReadSchema as DepartmentReadSchema,CoverageSchema as DepartmentCoverageSchema,ReceiveSchema as DepartmentReceiveSchema,StoredEntrySchema as DepartmentEntrySchema,Id as DepartmentId,ORG04_FIELDS,validateORG04,type StageInput as DepartmentStageInput} from './vnext/contracts.js';
export {openHierarchy,validateHierarchyForest,HierarchyCandidateSchema,HierarchyNodeSchema,HierarchyEdgeEvidenceSchema,HierarchyClosureSchema,CreateHierarchyViewSchema,HierarchyPublishSchema,HierarchySnapshotInputSchema,HierarchyId,HierarchyLocalTime,HierarchyNullableLocalTime} from './vnext/hierarchy.js';
export type {HierarchyCandidateInput,CreateHierarchyViewInput,HierarchyPublishInput,HierarchySnapshot,HierarchyIssue,ForestValidation} from './vnext/hierarchy.js';
