import { randomUUID } from 'node:crypto';
import { createScopedModules, type ScopedModules } from '../../apps/governance-api/src/composition/create-scoped-modules.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { createTransactionRunner } from '../../apps/governance-api/src/platform/transaction/transaction-runner.js';
import { createWorkflowApplication } from '../../apps/governance-api/src/modules/workflow/index.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

process.env['NODE_ENV'] = 'test';
const DEPARTMENT_OBJECT = '74000000-0000-7000-8000-000000000001';
const ADMIN_HIERARCHY_OBJECT = '74100000-0000-7000-8000-000000000001';
const ADMIN_VIEW = '73000000-0000-7000-8000-000000000001';
const handle = createDatabase({ connectionString: requireEnvironment('DATABASE_URL'), max: 2, application_name: 'hdi-department-repository-probe' });
const database = handle.database;
const runner = createTransactionRunner<ScopedModules>(database, (transaction, context) => createScopedModules(transaction, context, database));
const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
const checks: Record<string, boolean> = {};
const context = (action: string, actor: string = PROTOTYPE_FIXTURE.actorPrincipalId) => ({ actorPrincipalId: actor, requestId: `PV005-${suffix}-${action}`, correlationId: `PV005-${suffix}`, occurredAt: '2026-09-03T16:00:00' });
const departmentContent = { standardName: `事务探针科室-${suffix}`, shortName: '事务探针', departmentType: 'CLINICAL' as const, clinicalFlag: true, managementFlag: false, subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE' as const, businessStatus: 'ACTIVE' as const, description: 'PROTOTYPE SYNTHETIC TRANSACTION PROBE', businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null };

try {
  const initialCode = `PV005-INITIAL-${suffix}`;
  try {
    await runner.run(context('INITIAL-ROLLBACK'), async (modules) => {
      await modules.departmentMaster.createDepartment({ ...departmentContent, description: 'X'.repeat(1001), governanceObjectId: DEPARTMENT_OBJECT, departmentCode: initialCode, recordedFrom: '2026-09-03T15:00:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    });
  } catch { /* expected */ }
  checks['createDepartmentRollback'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', initialCode).executeTakeFirst());

  const beforeVersions = await countVersions('72000000-0000-7000-8000-000000000001');
  try {
    await runner.run(context('VERSION-ROLLBACK'), async (modules) => {
      await modules.departmentMaster.createDepartmentVersion({ ...departmentContent, description: 'X'.repeat(1001), governanceObjectId: DEPARTMENT_OBJECT, departmentId: '72000000-0000-7000-8000-000000000001', recordedFrom: '2026-09-03T15:10:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    });
  } catch { /* expected */ }
  checks['createDepartmentVersionRollback'] = await countVersions('72000000-0000-7000-8000-000000000001') === beforeVersions;
  const original = await database.selectFrom('department_master.department_version').select('recorded_to').where('department_version_id', '=', '72100000-0000-7000-8000-000000000001').executeTakeFirstOrThrow();
  checks['oldVersionRecordPeriodUnaffected'] = original.recorded_to === null;

  const beforeHierarchy = await countHierarchyVersions();
  try {
    await runner.run(context('HIERARCHY-ROLLBACK'), async (modules) => {
      await modules.departmentMaster.createHierarchyViewVersion({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, hierarchyViewId: ADMIN_VIEW, businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, recordedFrom: '2026-09-03T15:20:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId, nodes: [
        { nodeKey: 'valid', parentNodeKey: null, nodeKind: 'GROUP', groupId: '73200000-0000-7000-8000-000000000001', groupVersionId: '73300000-0000-7000-8000-000000000001', displayName: '有效节点', sortOrder: 1 },
        { nodeKey: 'invalid', parentNodeKey: null, nodeKind: 'GROUP', groupId: '73200000-0000-7000-8000-000000000002', groupVersionId: '73300000-0000-7000-8000-000000000002', displayName: '跨视图节点', sortOrder: 2 },
      ] });
    });
  } catch { /* expected */ }
  checks['createHierarchyViewVersionRollback'] = await countHierarchyVersions() === beforeHierarchy;

  const publishCode = `PV005-PUBLISH-${suffix}`;
  try {
    await runner.run(context('PUBLISH-ROLLBACK'), async (modules) => {
      const draft = await modules.departmentMaster.createDepartment({ ...departmentContent, governanceObjectId: DEPARTMENT_OBJECT, departmentCode: publishCode, recordedFrom: '2026-09-03T15:30:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
      const prepared = await modules.departmentMaster.prepareDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id });
      const publication = await modules.releaseDistribution.registerPublication({ governanceObjectId: DEPARTMENT_OBJECT, aggregateType: 'DEPARTMENT_MASTER', businessValidFrom: prepared.projection.businessValidFrom, businessValidTo: prepared.projection.businessValidTo, recordedFrom: '2026-09-03T16:00:00', submittedBy: PROTOTYPE_FIXTURE.actorPrincipalId, approvedBy: PROTOTYPE_FIXTURE.approverPrincipalId, approvedAt: '2026-09-03T16:00:00', changeReason: 'PROTOTYPE SYNTHETIC PUBLICATION PROBE', projection: { projectionType: 'hdi.department-master', schemaVersion: '1', payload: prepared.projection, itemCount: 1 }, member: { kind: 'DEPARTMENT', stableId: prepared.departmentId, versionId: prepared.departmentVersionId, snapshotName: prepared.projection.standardName, memberHash: prepared.contentHash } });
      await modules.departmentMaster.confirmDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id, releaseId: publication.releaseId, recordedFrom: '2026-09-03T16:00:00', actorPrincipalId: PROTOTYPE_FIXTURE.approverPrincipalId });
      const published = await modules.departmentMaster.getDepartmentVersion({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id });
      checks['draftToPublishedObserved'] = published.governanceStatus === 'PUBLISHED' && published.releaseId === publication.releaseId;
      try { await modules.departmentMaster.updateDepartmentDraft({ ...departmentContent, standardName: '禁止覆盖', governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id, actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId }); }
      catch (error) { checks['publishedVersionImmutable'] = error instanceof Error && error.message === 'DEPARTMENT_VERSION_IMMUTABLE'; }
      await modules.audit.append({ auditStreamId: DEPARTMENT_OBJECT, governanceObjectId: DEPARTMENT_OBJECT, entityType: 'DEPARTMENT_VERSION', stableEntityId: draft.departmentId, entityVersionId: draft.id, action: 'PUBLISHED', afterHash: draft.contentHash, authorityScope: 'PROBE' });
      throw new Error('PROBE_ROLLBACK');
    });
  } catch (error) { if (!(error instanceof Error) || error.message !== 'PROBE_ROLLBACK') throw error; }
  checks['publicationTransactionRollback'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', publishCode).executeTakeFirst())
    && await countAuditEventsByRequest(`PV005-${suffix}-PUBLISH-ROLLBACK`) === 0;

  const workflowCode = `PV005-WORKFLOW-${suffix}`;
  try {
    await database.transaction().execute(async (transaction) => {
      const scopedRunner = {
        run<Result>(requestContext: ReturnType<typeof context>, work: (modules: ScopedModules) => Promise<Result>) {
          return work(createScopedModules(transaction, requestContext, transaction));
        },
      };
      const submitModules = createScopedModules(transaction, context('WORKFLOW-CREATE'), transaction);
      const draft = await submitModules.departmentMaster.createDepartment({ ...departmentContent, governanceObjectId: DEPARTMENT_OBJECT, departmentCode: workflowCode, recordedFrom: '2026-09-03T15:50:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
      const workflow = createWorkflowApplication(scopedRunner);
      const submitted = await workflow.submit(context('WORKFLOW-SUBMIT'), { governanceObjectId: DEPARTMENT_OBJECT, entityType: 'DEPARTMENT_VERSION', stableEntityId: draft.departmentId, entityVersionId: draft.id, changeKind: 'INITIAL_PUBLICATION', riskClassification: 'NORMAL', submittedContentDigest: draft.contentHash.toString('hex'), changeReason: 'PROTOTYPE SYNTHETIC WORKFLOW PROBE', campusId: null, frozenEvidence: {} });
      await workflow.act(context('WORKFLOW-REVIEW', PROTOTYPE_FIXTURE.reviewerPrincipalId), { changeRequestId: submitted.changeRequestId, stageType: 'PROFESSIONAL_REVIEW', actionResult: 'APPROVED', reason: 'PROTOTYPE SYNTHETIC REVIEW', seenContentDigest: draft.contentHash.toString('hex'), campusId: null });
      const approved = await workflow.act(context('WORKFLOW-APPROVE', PROTOTYPE_FIXTURE.approverPrincipalId), { changeRequestId: submitted.changeRequestId, stageType: 'OWNER_FINAL_APPROVAL', actionResult: 'APPROVED', reason: 'PROTOTYPE SYNTHETIC OWNER APPROVAL', seenContentDigest: draft.contentHash.toString('hex'), campusId: null });
      const published = await submitModules.departmentMaster.getDepartmentVersion({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id });
      checks['workflowAtomicPublicationObserved'] = approved.publication !== null && published.governanceStatus === 'PUBLISHED' && published.releaseId === approved.publication.releaseId;
      const departmentAuditEvents = await transaction.selectFrom('audit.audit_event').select(['action', 'event_payload', 'occurred_at', 'recorded_at']).where('correlation_id', '=', `PV005-${suffix}`).where('action', 'like', 'DEPARTMENT_%').execute();
      const actions = new Set(departmentAuditEvents.map((event) => event.action));
      checks['workflowDepartmentAuditEventsObserved'] = ['DEPARTMENT_CREATED', 'DEPARTMENT_VERSION_CREATED', 'DEPARTMENT_SUBMITTED', 'DEPARTMENT_REVIEWED', 'DEPARTMENT_APPROVED', 'DEPARTMENT_PUBLISHED'].every((action) => actions.has(action));
      checks['departmentAuditPayloadMinimal'] = departmentAuditEvents.every((event) => event.event_payload !== null && !/DATABASE_URL|password|token|Cookie|Secret|request_body/iu.test(JSON.stringify(event.event_payload)));
      checks['departmentAuditLocalDateTimes'] = departmentAuditEvents.every((event) => isLocalDateTime(event.occurred_at) && event.recorded_at !== null && isLocalDateTime(event.recorded_at));
      throw new Error('PROBE_ROLLBACK');
    });
  } catch (error) { if (!(error instanceof Error) || error.message !== 'PROBE_ROLLBACK') throw error; }
  checks['workflowPublicationRollbackClean'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', workflowCode).executeTakeFirst())
    && await countAuditEventsByCorrelation(`PV005-${suffix}`) === 0;

  const failureCode = `PV005-AUDIT-FAIL-${suffix}`;
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try {
    await runner.run(context('AUDIT-FAILURE'), async (modules) => {
      const draft = await modules.departmentMaster.createDepartment({ ...departmentContent, governanceObjectId: DEPARTMENT_OBJECT, departmentCode: failureCode, recordedFrom: '2026-09-03T15:40:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
      const prepared = await modules.departmentMaster.prepareDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id });
      const publication = await modules.releaseDistribution.registerPublication({ governanceObjectId: DEPARTMENT_OBJECT, aggregateType: 'DEPARTMENT_MASTER', businessValidFrom: prepared.projection.businessValidFrom, businessValidTo: null, recordedFrom: '2026-09-03T16:00:00', submittedBy: PROTOTYPE_FIXTURE.actorPrincipalId, approvedBy: PROTOTYPE_FIXTURE.approverPrincipalId, approvedAt: '2026-09-03T16:00:00', changeReason: 'PROTOTYPE SYNTHETIC FAILURE PROBE', projection: { projectionType: 'hdi.department-master', schemaVersion: '1', payload: prepared.projection, itemCount: 1 }, member: { kind: 'DEPARTMENT', stableId: prepared.departmentId, versionId: prepared.departmentVersionId, snapshotName: prepared.projection.standardName, memberHash: prepared.contentHash } });
      await modules.departmentMaster.confirmDepartmentPublication({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: draft.departmentId, departmentVersionId: draft.id, releaseId: publication.releaseId, recordedFrom: '2026-09-03T16:00:00', actorPrincipalId: PROTOTYPE_FIXTURE.approverPrincipalId });
      await modules.audit.append({ auditStreamId: DEPARTMENT_OBJECT, governanceObjectId: DEPARTMENT_OBJECT, entityType: 'DEPARTMENT_VERSION', stableEntityId: draft.departmentId, entityVersionId: draft.id, action: 'PUBLISHED', afterHash: draft.contentHash, authorityScope: 'PROBE' });
    });
  } catch { /* expected controlled fault */ } finally { configureControlledPublicationFault(null); }
  checks['auditFailureRollback'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', failureCode).executeTakeFirst())
    && await countAuditEventsByRequest(`PV005-${suffix}-AUDIT-FAILURE`) === 0;

  await runner.run(context('MAPPING'), async (modules) => {
    const mapping = await modules.departmentMaster.addSourceMapping({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: '72000000-0000-7000-8000-000000000003', sourceSystem: 'LIS', sourceDepartmentCode: `PROBE-${suffix}`, sourceDepartmentName: '检验探针', matchMethod: 'MANUAL' });
    const confirmed = await modules.departmentMaster.confirmSourceMapping({ governanceObjectId: DEPARTMENT_OBJECT, mappingId: mapping.id });
    checks['mappingPendingToConfirmed'] = confirmed.mappingStatus === 'CONFIRMED';
    checks['mappingConfirmationAudited'] = (await modules.audit.query({ governanceObjectId: DEPARTMENT_OBJECT, action: 'DEPARTMENT_SOURCE_MAPPING_CONFIRMED', requestId: `PV005-${suffix}-MAPPING`, limit: 10 })).length === 1;
    try { await modules.departmentMaster.rejectSourceMapping({ governanceObjectId: DEPARTMENT_OBJECT, mappingId: mapping.id, reason: 'PROTOTYPE SYNTHETIC TERMINAL TRANSITION PROBE' }); } catch (error) { checks['mappingTerminalImmutable'] = error instanceof Error && error.message === 'DEPARTMENT_SOURCE_MAPPING_TRANSITION_INVALID'; }
    throw new Error('PROBE_ROLLBACK');
  }).catch((error) => { if (!(error instanceof Error) || error.message !== 'PROBE_ROLLBACK') throw error; });

  const campusChangeCode = `PV005-CAMPUS-${suffix}`;
  await runner.run(context('CAMPUS-CHANGE'), async (modules) => {
    const department = await modules.departmentMaster.createDepartment({ ...departmentContent, governanceObjectId: DEPARTMENT_OBJECT, departmentCode: campusChangeCode, recordedFrom: '2026-09-03T14:00:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    await modules.departmentMaster.recordDepartmentCampusAssignment({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: department.departmentId, campusId: '71000000-0000-7000-8000-000000000001', businessValidFrom: '2026-09-01T00:00:00', businessValidTo: null, recordedFrom: '2026-09-03T14:10:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    await modules.departmentMaster.recordDepartmentCampusAssignment({ governanceObjectId: DEPARTMENT_OBJECT, departmentId: department.departmentId, campusId: '71000000-0000-7000-8000-000000000001', businessValidFrom: '2026-10-01T00:00:00', businessValidTo: null, recordedFrom: '2026-09-03T14:20:00', actorPrincipalId: PROTOTYPE_FIXTURE.actorPrincipalId });
    const changed = await modules.audit.query({ governanceObjectId: DEPARTMENT_OBJECT, action: 'DEPARTMENT_CAMPUS_CHANGED', requestId: `PV005-${suffix}-CAMPUS-CHANGE`, limit: 10 });
    checks['campusChangeAudited'] = changed.length === 1 && 'oldAssignment' in changed[0]!.payload && 'newAssignment' in changed[0]!.payload;
    throw new Error('PROBE_ROLLBACK');
  }).catch((error) => { if (!(error instanceof Error) || error.message !== 'PROBE_ROLLBACK') throw error; });
  checks['campusChangeRollbackClean'] = !(await database.selectFrom('department_master.department').select('department_id').where('department_code', '=', campusChangeCode).executeTakeFirst())
    && await countAuditEventsByRequest(`PV005-${suffix}-CAMPUS-CHANGE`) === 0;

  await runner.run(context('SCOPE'), async (modules) => {
    try { await modules.departmentMaster.getDepartmentVersion({ governanceObjectId: ADMIN_HIERARCHY_OBJECT, departmentId: '72000000-0000-7000-8000-000000000001', departmentVersionId: '72100000-0000-7000-8000-000000000001' }); }
    catch (error) { checks['governanceObjectIsolation'] = error instanceof Error && error.message === 'DEPARTMENT_VERSION_NOT_FOUND'; }
  });

  const overlapRejected = await runner.run(context('CAMPUS-OVERLAP'), async () => {
    try {
      await database.insertInto('department_master.department_campus_assignment').values({ department_id: '72000000-0000-7000-8000-000000000001', campus_id: '71000000-0000-7000-8000-000000000001', business_valid_from: '2026-09-01T00:00:00', business_valid_to: null, recorded_from: '2026-09-03T09:00:00', recorded_to: null, content_hash: Buffer.alloc(32), created_by: PROTOTYPE_FIXTURE.actorPrincipalId, updated_by: PROTOTYPE_FIXTURE.actorPrincipalId }).execute(); return false;
    } catch (error) { return error instanceof Error && 'code' in error && error.code === '23P01'; }
  });
  checks['campusAssignmentOverlapRejected'] = overlapRejected;

  if (Object.values(checks).some((value) => value !== true)) throw new Error(`DEPARTMENT_REPOSITORY_PROBE_FAILED:${JSON.stringify(checks)}`);
  process.stdout.write(`${JSON.stringify({ status: 'PASSED', checks })}\n`);
} finally {
  configureControlledPublicationFault(null);
  await handle.close();
}

async function countVersions(departmentId: string): Promise<string> { return (await database.selectFrom('department_master.department_version').select(({ fn }) => fn.countAll<string>().as('count')).where('department_id', '=', departmentId).executeTakeFirstOrThrow()).count; }
async function countHierarchyVersions(): Promise<string> { return (await database.selectFrom('department_master.department_hierarchy_view_version').select(({ fn }) => fn.countAll<string>().as('count')).where('department_hierarchy_view_id', '=', ADMIN_VIEW).executeTakeFirstOrThrow()).count; }
async function countAuditEventsByRequest(requestId: string): Promise<number> { return Number((await database.selectFrom('audit.audit_event').select(({ fn }) => fn.countAll<string>().as('count')).where('request_id', '=', requestId).executeTakeFirstOrThrow()).count); }
async function countAuditEventsByCorrelation(correlationId: string): Promise<number> { return Number((await database.selectFrom('audit.audit_event').select(({ fn }) => fn.countAll<string>().as('count')).where('correlation_id', '=', correlationId).executeTakeFirstOrThrow()).count); }
function isLocalDateTime(value: string): boolean { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u.test(value); }
function requireEnvironment(name: string): string { const value = process.env[name]; if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`); return value; }
