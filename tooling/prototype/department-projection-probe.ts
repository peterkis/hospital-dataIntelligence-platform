import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createScopedModules, type ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import type { DepartmentHierarchySnapshot, DepartmentVersion, PreparedDepartmentPublication } from '../../apps/governance-api/src/modules/department-master/index.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

process.env['NODE_ENV'] = 'test';
const DEPARTMENT_OBJECT = '74000000-0000-7000-8000-000000000001';
const ADMIN_HIERARCHY_OBJECT = '74100000-0000-7000-8000-000000000001';
const ADMIN_HIERARCHY_VIEW = '73000000-0000-7000-8000-000000000001';
const SECOND_CAMPUS = '71000000-0000-7000-8000-000000000002';
const handle = createDatabase({ connectionString: requireEnvironment('DATABASE_URL'), max: 2, application_name: 'hdi-department-projection-probe' });
const database = handle.database;
const runner = createTransactionRunner<ScopedModules>(database, (transaction, context) => createScopedModules(transaction, context, database));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const checks: Record<string, boolean> = {};
let probeDate = '2026-09-03';
const context = (action: string) => ({ actorPrincipalId: PROTOTYPE_FIXTURE.approverPrincipalId, requestId: `PV005-PROJECTION-${suffix}-${action}`, correlationId: `PV005-PROJECTION-${suffix}`, occurredAt: `${probeDate}T20:00:00` });
const departmentCode = `PV005-PROJECTION-${suffix}`;

try {
  // The probe rolls back, but must follow any persisted administrative publication.
  // Keep its original intraday intervals without rewriting published fixture history.
  const chronology = await sql<{ probe_date: string }>`
    select greatest('2026-09-03'::date,
      coalesce(max(recorded_from)::date + 1, '2026-09-03'::date))::text as probe_date
    from department_master.department_hierarchy_view_version
    where department_hierarchy_view_id = ${ADMIN_HIERARCHY_VIEW}::uuid
      and governance_status = 'PUBLISHED'
  `.execute(database);
  probeDate = chronology.rows[0]!.probe_date;
  await runner.run(context('HISTORY'), async (modules) => {
    const first = await modules.departmentMaster.createDepartment({
      standardName: `投影探针科室-${suffix}`,
      shortName: '投影探针',
      departmentType: 'CLINICAL',
      clinicalFlag: true,
      managementFlag: false,
      subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
      businessStatus: 'ACTIVE',
      description: 'PROTOTYPE SYNTHETIC PROJECTION PROBE',
      businessValidFrom: '2026-09-01T00:00:00',
      businessValidTo: '2026-10-01T00:00:00',
      governanceObjectId: DEPARTMENT_OBJECT,
      departmentCode,
      recordedFrom: `${probeDate}T16:00:00`,
      actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId,
    });
    checks['draftDoesNotProduceProjection'] = await modules.departmentMaster.getPublishedDepartmentProjection({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId }) === null;
    await modules.departmentMaster.recordDepartmentCampusAssignment({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId, campusId: PROTOTYPE_FIXTURE.campusId, businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, recordedFrom: `${probeDate}T16:05:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });

    const firstGroup = await modules.departmentMaster.createHierarchyGroupVersion({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: ADMIN_HIERARCHY_VIEW, groupCode: `G1-${suffix}`, displayName: '内科系统', businessValidFrom: '2026-09-01T00:00:00', businessValidTo: '2026-10-01T00:00:00', recordedFrom: `${probeDate}T16:10:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    const firstHierarchy = await modules.departmentMaster.createHierarchyViewVersion({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: ADMIN_HIERARCHY_VIEW, businessValidFrom: '2026-09-01T00:00:00', businessValidTo: '2026-10-01T00:00:00', recordedFrom: `${probeDate}T16:20:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId, nodes: hierarchyNodes(first, firstGroup, '内科系统') });
    await publishHierarchy(modules, firstHierarchy, `${probeDate}T16:20:00`);
    const firstPrepared = await modules.departmentMaster.prepareDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId, departmentVersionId: first.id });
    await publishDepartment(modules, firstPrepared, `${probeDate}T16:30:00`);
    const original = await modules.departmentMaster.getPublishedDepartmentProjection({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId });
    if (!original) throw new Error('DEPARTMENT_PROJECTION_NOT_CREATED');
    const frozenCampuses = JSON.stringify(original.campuses);
    const frozenHierarchies = JSON.stringify(original.hierarchies);
    checks['publishedHasProjection'] = original.departmentVersionId === first.id;
    checks['projectionHashMatchesSource'] = original.contentHash.equals(first.contentHash);
    checks['publishedHierarchySnapshotUsed'] = original.hierarchies['ADMINISTRATIVE'] === '内科系统';
    checks['campusSnapshotCaptured'] = original.campuses.length === 1;

    await modules.departmentMaster.recordDepartmentCampusAssignment({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId, campusId: SECOND_CAMPUS, businessValidFrom: '2026-10-01T00:00:00', businessValidTo: null, recordedFrom: `${probeDate}T17:00:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    const secondGroup = await modules.departmentMaster.createHierarchyGroupVersion({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: ADMIN_HIERARCHY_VIEW, groupCode: `G2-${suffix}`, displayName: '肺病中心', businessValidFrom: '2026-10-01T00:00:00', businessValidTo: null, recordedFrom: `${probeDate}T17:05:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    const second = await modules.departmentMaster.createDepartmentVersion({ standardName: `投影探针科室二版-${suffix}`, shortName: '投影探针', departmentType: 'CLINICAL', clinicalFlag: true, managementFlag: false, subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE', businessStatus: 'ACTIVE', description: 'PROTOTYPE SYNTHETIC PROJECTION PROBE V2', businessValidFrom: '2026-10-01T00:00:00', businessValidTo: null, governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId, recordedFrom: `${probeDate}T17:10:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    const secondHierarchy = await modules.departmentMaster.createHierarchyViewVersion({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: ADMIN_HIERARCHY_VIEW, businessValidFrom: '2026-10-01T00:00:00', businessValidTo: null, recordedFrom: `${probeDate}T17:20:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId, nodes: hierarchyNodes(second, secondGroup, '肺病中心') });
    await publishHierarchy(modules, secondHierarchy, `${probeDate}T17:20:00`);
    const unchangedBeforeSecondDepartmentRelease = await modules.departmentMaster.getPublishedDepartmentProjection({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId });
    checks['hierarchyChangeDoesNotMutateOldProjection'] = unchangedBeforeSecondDepartmentRelease !== null && JSON.stringify(unchangedBeforeSecondDepartmentRelease.hierarchies) === frozenHierarchies;
    checks['campusChangeDoesNotMutateOldProjection'] = unchangedBeforeSecondDepartmentRelease !== null && JSON.stringify(unchangedBeforeSecondDepartmentRelease.campuses) === frozenCampuses;

    const secondPrepared = await modules.departmentMaster.prepareDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: second.departmentId, departmentVersionId: second.id });
    await publishDepartment(modules, secondPrepared, `${probeDate}T17:40:00`);
    const current = await modules.departmentMaster.getPublishedDepartmentProjection({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId });
    const historical = await modules.departmentMaster.findDepartmentProjectionAsOf({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: first.departmentId, businessAt: `${probeDate}T17:00:00` });
    checks['newProjectionSupersedesOld'] = current?.departmentVersionId === second.id && current.hierarchies['ADMINISTRATIVE'] === '肺病中心' && current.campuses.length === 2;
    checks['historicalProjectionUnchanged'] = historical?.id === original.id && JSON.stringify(historical.hierarchies) === frozenHierarchies && JSON.stringify(historical.campuses) === frozenCampuses;
    throw new Error('PROJECTION_PROBE_ROLLBACK');
  }).catch((error) => { if (!(error instanceof Error) || error.message !== 'PROJECTION_PROBE_ROLLBACK') throw error; });
  checks['historyProbeRollbackClean'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', departmentCode).executeTakeFirst());

  const failureCode = `PV005-PROJECTION-FAIL-${suffix}`;
  let failedVersionId = '';
  try {
    await runner.run(context('FAILURE'), async (modules) => {
      const draft = await modules.departmentMaster.createDepartment({ standardName: `失败投影科室-${suffix}`, shortName: null, departmentType: 'CLINICAL', clinicalFlag: true, managementFlag: false, subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE', businessStatus: 'ACTIVE', description: null, businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, governanceObjectId: DEPARTMENT_OBJECT, departmentCode: failureCode, recordedFrom: `${probeDate}T18:00:00`, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
      failedVersionId = draft.id;
      const prepared = await modules.departmentMaster.prepareDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id });
      const publication = await registerDepartmentPublication(modules, prepared, `${probeDate}T18:10:00`);
      configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
      await modules.departmentMaster.confirmDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id, releaseId: publication.releaseId, recordedFrom: `${probeDate}T18:10:00`, actorPrincipalId: PROTOTYPE_FIXTURE.approverPrincipalId });
    });
  } catch { /* expected controlled failure after projection insertion */ } finally { configureControlledPublicationFault(null); }
  checks['publicationFailureLeavesNoProjection'] = !(await database.selectFrom('department_master.department_published_projection').select('department_published_projection_id').where('department_version_id', '=', failedVersionId).executeTakeFirst());
  checks['publicationFailureRollsBackVersion'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', failureCode).executeTakeFirst());
  const missing = await database.selectFrom('department_master.department_version as version').leftJoin('department_master.department_published_projection as projection', 'projection.department_version_id', 'version.department_version_id').select('version.department_version_id').where('version.governance_status', '=', 'PUBLISHED').where('projection.department_published_projection_id', 'is', null).limit(1).executeTakeFirst();
  checks['everyPublishedVersionHasProjection'] = missing === undefined;

  if (Object.values(checks).some((value) => value !== true)) throw new Error(`DEPARTMENT_PROJECTION_PROBE_FAILED:${JSON.stringify(checks)}`);
  process.stdout.write(`${JSON.stringify({ status: 'PASSED', checks })}\n`);
} finally {
  configureControlledPublicationFault(null);
  await handle.close();
}

function hierarchyNodes(department: DepartmentVersion, group: { readonly groupId: string; readonly groupVersionId: string }, displayName: string) {
  return [
    { nodeKey: 'root', parentNodeKey: null, nodeKind: 'GROUP' as const, groupId: group.groupId, groupVersionId: group.groupVersionId, displayName, sortOrder: 0 },
    { nodeKey: 'department', parentNodeKey: 'root', nodeKind: 'DEPARTMENT' as const, departmentId: department.departmentId, departmentVersionId: department.id, displayName: department.standardName, sortOrder: 1 },
  ];
}

async function publishHierarchy(modules: ScopedModules, snapshot: DepartmentHierarchySnapshot, publishedAt: string): Promise<void> {
  const prepared = await modules.departmentMaster.prepareHierarchyPublication({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: snapshot.view.id, hierarchyViewVersionId: snapshot.version.id });
  const publication = await modules.releaseDistribution.registerPublication({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, aggregateType: 'DEPARTMENT_HIERARCHY', businessValidFrom: prepared.projection.businessValidFrom, businessValidTo: prepared.projection.businessValidTo, recordedFrom: publishedAt, submittedBy: PROTOTYPE_FIXTURE.actorPrincipalId, approvedBy: PROTOTYPE_FIXTURE.approverPrincipalId, approvedAt: publishedAt, changeReason: 'PROTOTYPE SYNTHETIC HIERARCHY PROJECTION PROBE', projection: { projectionType: 'hdi.department-hierarchy', schemaVersion: '1', payload: prepared.projection, itemCount: prepared.projection.nodes.length }, member: { kind: 'DEPARTMENT_HIERARCHY', stableId: prepared.hierarchyViewId, versionId: prepared.hierarchyViewVersionId, snapshotName: prepared.projection.viewCode, memberHash: prepared.contentHash } });
  await modules.departmentMaster.confirmHierarchyPublication({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: prepared.hierarchyViewId, hierarchyViewVersionId: prepared.hierarchyViewVersionId, releaseId: publication.releaseId, recordedFrom: publishedAt, actorPrincipalId: PROTOTYPE_FIXTURE.approverPrincipalId });
}

async function registerDepartmentPublication(modules: ScopedModules, prepared: PreparedDepartmentPublication, publishedAt: string) {
  return modules.releaseDistribution.registerPublication({ governanceObjectId: DEPARTMENT_OBJECT, aggregateType: 'DEPARTMENT_MASTER', businessValidFrom: prepared.projection.businessValidFrom, businessValidTo: prepared.projection.businessValidTo, recordedFrom: publishedAt, submittedBy: PROTOTYPE_FIXTURE.actorPrincipalId, approvedBy: PROTOTYPE_FIXTURE.approverPrincipalId, approvedAt: publishedAt, changeReason: 'PROTOTYPE SYNTHETIC DEPARTMENT PROJECTION PROBE', projection: { projectionType: 'hdi.department-master', schemaVersion: '1', payload: prepared.projection, itemCount: 1 }, member: { kind: 'DEPARTMENT', stableId: prepared.departmentId, versionId: prepared.departmentVersionId, snapshotName: prepared.projection.standardName, memberHash: prepared.contentHash } });
}

async function publishDepartment(modules: ScopedModules, prepared: PreparedDepartmentPublication, publishedAt: string): Promise<void> {
  const publication = await registerDepartmentPublication(modules, prepared, publishedAt);
  await modules.departmentMaster.confirmDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: prepared.departmentId, departmentVersionId: prepared.departmentVersionId, releaseId: publication.releaseId, recordedFrom: publishedAt, actorPrincipalId: PROTOTYPE_FIXTURE.approverPrincipalId });
}

function requireEnvironment(name: string): string { const value = process.env[name]; if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`); return value; }
