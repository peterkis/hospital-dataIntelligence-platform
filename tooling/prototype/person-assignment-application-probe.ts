import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import type { AssignmentVersion, CreateAssignment, AssignmentDependencyAssessment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { createAssignmentFixture, assignmentScope, departmentScope, Jan, Jun, Jul, Aug, Dec } from './person-assignment-fixture.js';
import { runAssignmentConcurrency } from './person-assignment-concurrency-probe.js';
import { runAssignmentConstraints } from './person-assignment-constraint-probe.js';
import { runAssignmentPeriodProbe } from './person-assignment-period-probe.js';
import { runAssignmentAccessProbe } from './person-assignment-access-probe.js';

assert.ok(process.env['DATABASE_URL'], 'ASSIGNMENT_MANAGED_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const runId = randomUUID(), directory = `.runtime/pv006-c01/${runId}`;
await mkdir(directory, { recursive: false });
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 16,
  connectionTimeoutMillis: 5000, application_name: 'hdi-pv006-c01-application' });
const cases: { ids: string[]; name: string; status: string; evidence?: unknown }[] = [];
const recover = process.argv.includes('--recover');
const constraintsOnly = process.argv.includes('--constraints-only');
const accessOnly = process.argv.includes('--access-only');
const concurrencyOnly = process.argv.includes('--concurrency-only');
const periodOnly = process.argv.includes('--period-only');
const versions: AssignmentVersion[] = [];
const assessments: { query: { governanceObjectId: string; assignmentId: string; assignmentVersionId: string; recordAsOf: string };
  result: unknown }[] = [];
let failure: unknown;
try {
  if (recover) await recoverEvidence(); else await exercise();
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  configureControlledPublicationFault(null);
  await handle.close();
  const output = { task: 'PV-006-C-01', mode: recover ? 'RECOVERY' : constraintsOnly ? 'CONSTRAINTS' : accessOnly ? 'ACCESS' : concurrencyOnly ? 'CONCURRENCY' : periodOnly ? 'PERIOD' : 'APPLICATION', runId,
    classification: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY', timeZone: 'Asia/Shanghai',
    argv: process.argv.slice(1), cwd: process.cwd(), status: failure ? 'FAILED' : 'PASSED', cases, poolClosed: true,
    error: failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]').slice(0, 600) : null,
    frames: failure instanceof Error ? failure.stack?.split('\n').filter(line => /^\s+at /u.test(line)).slice(0, 7) : undefined };
  await writeFile(`${directory}/application.json`, JSON.stringify(output, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...output, cases: cases.map(c => ({ ...c, evidence: undefined })), evidenceDirectory: directory }));
}
async function check(ids: string[], name: string, work: () => Promise<unknown>) {
  console.log(JSON.stringify({ caseStarted: ids, name }));
  try { const evidence = await work(); cases.push({ ids, name, status: 'PASSED', evidence }); }
  catch (error) { cases.push({ ids, name, status: 'FAILED' }); throw error; }
}
async function identity() {
  return (await sql<{ database: string; oid: string; role: string; startedAt: string; migrations: number; address: string; port: number }>`
    select current_database() as database, (select oid::text from pg_database where datname=current_database()) as oid,
      current_user as role, inet_server_addr()::text as address, inet_server_port() as port,
      pg_postmaster_start_time()::text as "startedAt",
      (select count(*)::int from platform.schema_migration) as migrations
  `.execute(handle.database)).rows[0]!;
}
async function exercise() {
  const target = await identity();
  assert.match(target.database, /^(hdi_prototype|pv006_c0[12]_[a-f0-9]{32})$/u);
  assert.equal(target.role, 'hdi_prototype');
  assert.equal(target.migrations, 34);
  const f = await createAssignmentFixture(handle.database, runId);
  const department = await f.createDepartment('PRIMARY');
  const command = (engagementId: string, from = Jul, to: string | null = Dec, departmentId = department.departmentId): CreateAssignment => ({
    ...assignmentScope, engagementId, relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT',
    placement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId },
    businessValidFrom: from, businessValidTo: to,
  });
  const count = async () => (await sql<{ n: number }>`select count(*)::int as n from person_master.assignment`.execute(handle.database)).rows[0]!.n;
  const keep = (v: AssignmentVersion) => { versions.push(v); return v; };
  const assessment = async (v: AssignmentVersion, recordAsOf = '') => {
    const query = { ...assignmentScope, assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId,
      recordAsOf: recordAsOf || await f.now() };
    const result = await f.app().assessAssignmentDependencies(query); assessments.push({ query, result }); return result;
  };
  if (constraintsOnly) { await runAssignmentConstraints(handle.database, f, command, keep, check); return; }
  if (accessOnly) { await runAssignmentAccessProbe(handle.database, f, command, keep, check); return; }
  if (concurrencyOnly) { await runAssignmentConcurrency(handle.database, f, command, keep, check); return; }
  if (periodOnly) { await runAssignmentPeriodProbe(handle.database, f, command, keep, check); return; }

  await check(['TM-01'], 'start valid but tail outside authority rejects whole mutation', async () => {
    const e = await f.createEngagement(Jan, Aug), before = await count();
    await assert.rejects(f.app().createAssignment(command(e.engagementId)), { message: 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' });
    assert.equal(await count(), before); return { authorityVersion: e.engagementVersionId, created: 0 };
  });
  await check(['TM-07', 'SC-02'], 'latest ended version defeats historical open assertion', async () => {
    const e = await f.createEngagement();
    const ended = await f.lifecycle().endEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedCurrentEngagementVersionId: e.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_END' });
    const historical = await f.core().findEngagementPeriodAssertionAsOf({ ...assignmentScope, engagementId: e.engagementId,
      businessAt: Dec, recordAsOf: await f.now() });
    assert.equal(historical?.engagementVersionId, e.engagementVersionId);
    const view = await f.periodReader().getEngagementEffectivePeriodAsOf({ ...assignmentScope, engagementId: e.engagementId,
      requestedFrom: Jul, requestedTo: Dec, recordAsOf: await f.now() });
    assert.equal(view.authorityEngagementVersionId, ended.engagementVersionId);
    const before = await count();
    await assert.rejects(f.app().createAssignment(command(e.engagementId)), { message: 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' });
    assert.equal(await count(), before); return view;
  });
  await check(['TM-08', 'TM-09', 'TM-10'], 'actual one-microsecond suspension survives resume and record-time filtering', async () => {
    const e = await f.createEngagement(), oldR = await f.now();
    const start = '2026-07-02T00:00:00.000001', end = '2026-07-02T00:00:00.000002';
    await f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedLifecycleSequence: '0', businessEffectiveAt: start, reasonCode: 'SYNTHETIC_C01_SUSPEND' });
    await f.lifecycle().resumeEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedLifecycleSequence: '1', businessEffectiveAt: end, reasonCode: 'SYNTHETIC_C01_RESUME' });
    const query = { ...assignmentScope, engagementId: e.engagementId, requestedFrom: Jul, requestedTo: Aug };
    const old = await f.periodReader().getEngagementEffectivePeriodAsOf({ ...query, recordAsOf: oldR });
    const current = await f.periodReader().getEngagementEffectivePeriodAsOf({ ...query, recordAsOf: await f.now() });
    assert.deepEqual(old.stateSegments.map(s => s.businessState), ['ACTIVE']);
    assert.deepEqual(current.stateSegments.map(s => s.businessState), ['ACTIVE', 'SUSPENDED', 'ACTIVE']);
    assert.equal(current.stateSegments[1]!.from, start); assert.equal(current.stateSegments[1]!.to, end);
    const before = await count();
    await assert.rejects(f.app().createAssignment(command(e.engagementId, Jul, Aug)), { message: 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED' });
    assert.equal(await count(), before);
    keep(await f.app().createAssignment(command(e.engagementId, Jul, start)));
    await assert.rejects(f.app().createAssignment(command(e.engagementId, start, Aug)), { message: 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED' });
    return { old, current };
  });
  await check(['DP-02'], 'draft published later cannot become known at its earlier record time', async () => {
    const draft = await f.createDepartment('DRAFT', false), oldR = await f.now();
    const q = { departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: draft.departmentId };
    await assert.rejects(f.departmentReader().getDepartmentPlacementReferenceAsOf({ ...q, recordAsOf: oldR }),
      { message: 'ASSIGNMENT_PLACEMENT_UNPUBLISHED' });
    await f.publishDepartment(draft);
    await assert.rejects(f.departmentReader().getDepartmentPlacementReferenceAsOf({ ...q, recordAsOf: oldR }),
      { message: 'ASSIGNMENT_PLACEMENT_UNPUBLISHED' });
    const published = await f.departmentReader().getDepartmentPlacementReferenceAsOf({ ...q, recordAsOf: await f.now() });
    assert.equal(published.departmentVersionId, draft.departmentVersionId); return { oldR, published };
  });
  await check(['ID-01', 'DP-01', 'DP-05', 'EV-01', 'EV-02', 'EV-03', 'TX-03'], 'acceptance survives later end, replay remains original and assessment changes', async () => {
    const e = await f.createEngagement(), request = randomUUID(), c = command(e.engagementId);
    const v = keep(await f.app(request).createAssignment(c));
    assert.equal(v.acceptanceEvidence.engagement.personId, e.personId);
    assert.equal(v.acceptanceEvidence.department.departmentId, department.departmentId);
    assert.notEqual(v.governanceObjectId, v.acceptanceEvidence.department.departmentGovernanceObjectId);
    assert.equal(v.acceptanceEvidence.validationPolicyCode, 'ASSIGNMENT_DEPARTMENT_CORE_V1');
    const initial = await assessment(v);
    assert.equal(initial.referenceComparison, 'UNCHANGED'); assert.equal(initial.constraintResult, 'SATISFIED');
    await f.lifecycle().endEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedCurrentEngagementVersionId: e.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_END' });
    const changed = await assessment(v);
    assert.equal(changed.referenceComparison, 'CHANGED'); assert.equal(changed.constraintResult, 'NOT_SATISFIED');
    assert.deepEqual(await f.app(request).createAssignment(c), v);
    assert.deepEqual(await f.app().getAssignmentVersion(vref(v)), v);
    const old = await assessment(v, v.recordedFrom);
    assert.equal(old.referenceComparison, 'UNCHANGED'); assert.equal(old.constraintResult, 'SATISFIED');
    return { v, initial, changed, old };
  });

  await check(['EV-05', 'EV-06', 'EV-08'], 'actual rename then suspension changes comparison without rewriting acceptance', async () => {
    const dept = await f.createDepartment('EVOLUTION'), e = await f.createEngagement();
    const v = keep(await f.app().createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId)));
    await f.reviseDepartment(dept.departmentId);
    const renamed = await assessment(v);
    assert.equal(renamed.referenceComparison, 'CHANGED'); assert.equal(renamed.constraintResult, 'SATISFIED');
    await f.reviseDepartment(dept.departmentId, 'SUSPENDED');
    const stopped = await assessment(v);
    assert.equal(stopped.referenceComparison, 'CHANGED'); assert.equal(stopped.constraintResult, 'NOT_SATISFIED');
    assert.deepEqual(await f.app().getAssignmentVersion(vref(v)), v);
    return { renamed, stopped };
  });

  await check(['TM-02', 'TM-03', 'TM-04', 'TM-05', 'TM-06'], 'complete finite/unbounded and future half-open periods', async () => {
    const e = await f.createEngagement(Jun, Aug);
    keep(await f.app().createAssignment(command(e.engagementId, Jun, Aug)));
    for (const [from, to] of [[Aug, Dec], [Jan, Jul], [Jul, null]] as const)
      await assert.rejects(f.app().createAssignment(command(e.engagementId, from, to)), { message: 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' });
    const open = await f.createEngagement();
    keep(await f.app().createAssignment(command(open.engagementId, Jul, null)));
    const future = await f.createEngagement('2027-01-01T00:00:00');
    keep(await f.app().createAssignment(command(future.engagementId, '2027-02-01T00:00:00', null)));
    return { finiteAccepted: 1, finiteRejected: 3, unboundedAccepted: 1, futureAccepted: 1 };
  });
  await check(['ID-02', 'ID-04', 'ID-06', 'DP-03', 'DP-04', 'DP-06'], 'exact IDs and complete ACTIVE published Department coverage', async () => {
    const beforeUnknown = await count();
    await assert.rejects(f.app().createAssignment(command(randomUUID())), { message: 'ENGAGEMENT_NOT_FOUND' });
    assert.equal(await count(), beforeUnknown);
    const e = await f.createEngagement();
    const second = await f.createDepartment('SAME-NAME'), finite = await f.createDepartment('FINITE', true, Aug);
    const a = keep(await f.app().createAssignment(command(e.engagementId)));
    const b = keep(await f.app().createAssignment(command(e.engagementId, Jul, Dec, second.departmentId)));
    assert.notEqual(a.assignmentId, b.assignmentId);
    assert.notEqual(a.acceptanceEvidence.department.departmentId, b.acceptanceEvidence.department.departmentId);
    assert.equal(a.acceptanceEvidence.engagement.personId, b.acceptanceEvidence.engagement.personId);
    await assert.rejects(f.app().createAssignment(command(e.engagementId, Jul, Dec, finite.departmentId)),
      { message: 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED' });
    keep(await f.app().createAssignment(command(e.engagementId, Jul, Aug, finite.departmentId)));
    await assert.rejects(f.app().createAssignment(command(e.engagementId, Jul, Dec, randomUUID())), { message: 'ASSIGNMENT_PLACEMENT_NOT_FOUND' });
    await f.reviseDepartment(second.departmentId, 'DEPRECATED');
    await assert.rejects(f.app().createAssignment(command(e.engagementId, Jul, Dec, second.departmentId)), { message: 'ASSIGNMENT_PLACEMENT_NOT_ACTIVE' });
    return { a: a.assignmentId, b: b.assignmentId, samePerson: true, nameMatchingUsed: false };
  });
  await check(['ID-05', 'EV-07', 'TM-11'], 'complete revised periods preserve old versions and exact old-version assessment', async () => {
    const e = await f.createEngagement(), v1 = keep(await f.app().createAssignment(command(e.engagementId, Jul, null)));
    const v2 = keep(await f.app().reviseAssignment({ ...assignmentScope, assignmentId: v1.assignmentId,
      expectedCurrentVersionId: v1.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' }));
    assert.equal(v2.versionNo, '2'); assert.equal(v2.supersedesAssignmentVersionId, v1.assignmentVersionId);
    assert.deepEqual(await f.app().getAssignmentVersion(vref(v1)), v1);
    const list = await f.app().listAssignmentVersions({ ...assignmentScope, assignmentId: v1.assignmentId, afterVersionNo: '0', limit: 1 });
    assert.deepEqual(list, [v1]);
    assert.deepEqual(await f.app().listAssignmentVersions({ ...assignmentScope, assignmentId: v1.assignmentId, afterVersionNo: '1', limit: 1 }), [v2]);
    const old = await assessment(v1); assert.equal(old.isLatestAssignmentVersionAsOf, false);
    assert.equal(old.evaluatedAssignmentVersionId, v1.assignmentVersionId);
    await assert.rejects(f.app().assessAssignmentDependencies({ ...vref(v2), recordAsOf: v1.recordedFrom }),
      { message: 'ASSIGNMENT_NOT_KNOWN_AS_OF' });
    const forged = { ...command(e.engagementId), recordAsOf: e.recordedFrom };
    await assert.rejects(f.app().createAssignment(forged), { message: 'PERSON_INPUT_INVALID' });
    return { v1, v2, old };
  });
  await check(['EV-04', 'TM-10'], 'late suspension changes assessment to REVIEW_REQUIRED without mutation', async () => {
    const e = await f.createEngagement(), v = keep(await f.app().createAssignment(command(e.engagementId)));
    const before = await assessment(v);
    await f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedLifecycleSequence: '0', businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_LATE' });
    const after = await assessment(v);
    assert.equal(after.referenceComparison, 'CHANGED'); assert.equal(after.constraintResult, 'REVIEW_REQUIRED');
    assert.deepEqual(await f.app().getAssignmentVersion(vref(v)), v);
    const old = await assessment(v, v.recordedFrom); assert.equal(old.constraintResult, 'SATISFIED');
    return { before, after, old };
  });
  await check(['TX-01', 'TX-02', 'TX-04'], 'successful and rejected replay retain actor/command/parameters and current permission', async () => {
    const e = await f.createEngagement(), request = randomUUID(), c = command(e.engagementId);
    const v = keep(await f.app(request).createAssignment(c)), before = await count();
    const auditRows = await handle.database.selectFrom('audit.audit_event').selectAll().where('request_id', '=', request).execute();
    assert.deepEqual(await f.app(request).createAssignment(c), v); assert.equal(await count(), before);
    assert.deepEqual(await handle.database.selectFrom('audit.audit_event').selectAll().where('request_id', '=', request).execute(), auditRows);
    await assert.rejects(f.app(request).createAssignment({ ...c, businessValidTo: Aug }), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    await assert.rejects(f.app(request).reviseAssignment({ ...assignmentScope, assignmentId: v.assignmentId,
      expectedCurrentVersionId: v.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' }),
      { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    const other = await createAssignmentFixture(handle.database, `${runId}-OTHER`);
    await assert.rejects(other.app(request).createAssignment(c), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    const lostRequest = randomUUID();
    keep(await other.app(lostRequest).createAssignment(c));
    await handle.database.insertInto('access_control.object_permission_grant').values({ ...{
      governance_object_id: assignmentScope.governanceObjectId, security_principal_id: other.actor,
      permission_code: 'PERSON_MASTER_ASSIGNMENT_WRITE', grant_effect: 'DENY', grant_sequence: '2',
      granted_by: f.actor, reason: 'SYNTHETIC C01 REVOKED TEST GRANT', valid_from: Jan, valid_to: null,
      scope_level: 'HOSPITAL', campus_id: null } }).execute();
    await assert.rejects(other.app(lostRequest).createAssignment(c), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    const finite = await f.createEngagement(Jan, Aug), deniedRequest = randomUUID();
    await assert.rejects(f.app(deniedRequest).createAssignment(command(finite.engagementId)), { message: 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' });
    await f.core().reviseEngagement({ ...assignmentScope, engagementId: finite.engagementId,
      expectedCurrentVersionId: finite.engagementVersionId, businessValidFrom: Jan, businessValidTo: null, reasonCode: 'VALIDITY_CORRECTION' });
    await assert.rejects(f.app(deniedRequest).createAssignment(command(finite.engagementId)), { message: 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' });
    keep(await f.app().createAssignment(command(finite.engagementId)));
    return { successfulAuditCount: auditRows.length, rejectedReplayStableAfterDependencyCorrection: true };
  });
  await check(['TX-08', 'SC-08'], 'audit failure rolls back stable/version/segments/outcome atomically', async () => {
    const e = await f.createEngagement(), before = await count(), request = randomUUID();
    configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
    try { await assert.rejects(f.app(request).createAssignment(command(e.engagementId)), { message: 'CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN' }); }
    finally { configureControlledPublicationFault(null); }
    assert.equal(await count(), before);
    assert.equal((await handle.database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', '=', request).execute()).length, 0);
    assert.equal((await handle.database.selectFrom('person_master.assignment_version').selectAll().where('request_id', '=', request).execute()).length, 0);
    keep(await f.app(request).createAssignment(command(e.engagementId)));
    return { rolledBack: true, sameRequestRetryAccepted: true };
  });

  await runAssignmentConcurrency(handle.database, f, command, keep, check);
  await runAssignmentConstraints(handle.database, f, command, keep, check);
  await runAssignmentPeriodProbe(handle.database, f, command, keep, check);
  await runAssignmentAccessProbe(handle.database, f, command, keep, check);
  for (const version of versions) {
    await assessment(version, version.recordedFrom);
    await assessment(version);
  }
  await writeFile(`${directory}/recovery.json`, JSON.stringify({ task: 'PV-006-C-01', mode: 'RECOVERY', runId,
    identity: target, actor: f.actor, versions, assessments, rowFingerprint: await rowFingerprint(versions) }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ recoveryReceipt: `${directory}/recovery.json` }));
}
function vref(v: AssignmentVersion) { return { ...assignmentScope, assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId }; }
async function recoverEvidence() {
  const path = process.env['ASSIGNMENT_RECOVERY_RECEIPT'];
  assert.ok(path, 'ASSIGNMENT_RECOVERY_RECEIPT_REQUIRED');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(receipt.task, 'PV-006-C-01', 'ASSIGNMENT_RECEIPT_TASK_INVALID');
  assert.equal(receipt.mode, 'RECOVERY', 'ASSIGNMENT_RECEIPT_MODE_INVALID');
  const current = await identity();
  assert.equal(current.database, receipt.identity.database, 'ASSIGNMENT_RECEIPT_DATABASE_INVALID');
  assert.equal(current.oid, receipt.identity.oid, 'ASSIGNMENT_RECEIPT_OID_INVALID');
  assert.equal(current.address, receipt.identity.address, 'ASSIGNMENT_RECEIPT_ENDPOINT_INVALID');
  assert.equal(current.port, receipt.identity.port, 'ASSIGNMENT_RECEIPT_ENDPOINT_INVALID');
  assert.equal(current.role, receipt.identity.role, 'ASSIGNMENT_RECEIPT_ROLE_INVALID');
  assert.notEqual(current.startedAt, receipt.identity.startedAt, 'ASSIGNMENT_POSTMASTER_NOT_RESTARTED');
  const f = await createAssignmentFixture(handle.database, receipt.runId, receipt.actor);
  await check(['DB-07'], 'new pool after actual postmaster restart reproduces all versions and assessments', async () => {
    for (const v of receipt.versions) assert.deepEqual(await f.app().getAssignmentVersion(vref(v)), v);
    const closingMetadata = [];
    for (const a of receipt.assessments) {
      const actual = await f.app().assessAssignmentDependencies(a.query);
      const beforeClosing = a.result.observedEvidence?.department.recordedTo ?? null;
      const afterClosing = actual.observedEvidence?.department.recordedTo ?? null;
      if (beforeClosing !== afterClosing) {
        assert.equal(beforeClosing, null); assert.ok(afterClosing);
        const key = (value: string) => `${value.slice(0, 19)}.${(value.split('.')[1] ?? '').padEnd(6, '0')}`;
        assert.ok(key(afterClosing) > key(a.query.recordAsOf));
        closingMetadata.push({ assignmentVersionId: a.query.assignmentVersionId, recordAsOf: a.query.recordAsOf,
          beforeClosing, afterClosing });
      }
      // Only observed Department closure metadata may evolve. Original acceptance
      // evidence and every other semantic/reference field remain exact comparisons.
      assert.deepEqual(withoutObservedClosing(actual), withoutObservedClosing(a.result));
    }
    assert.deepEqual(await rowFingerprint(receipt.versions), receipt.rowFingerprint, 'ASSIGNMENT_RECOVERY_ROWS_CHANGED');
    return { oldIdentity: receipt.identity, current, versions: receipt.versions.length, assessments: receipt.assessments.length,
      closingMetadata, rowFingerprint: receipt.rowFingerprint };
  });
}

function withoutObservedClosing(result: AssignmentDependencyAssessment) {
  return { ...result, observedEvidence: result.observedEvidence === null ? null : { ...result.observedEvidence,
    department: { ...result.observedEvidence.department, recordedTo: null } } };
}

async function rowFingerprint(input: readonly AssignmentVersion[]) {
  const ids = input.map(v => v.assignmentVersionId), relations = [...new Set(input.map(v => v.assignmentId))];
  return (await sql<{ count: number; digest: string }>`
    select count(*)::int as count, encode(digest(string_agg(j,'' order by kind,j),'sha256'),'hex') as digest from (
      select 'stable' as kind,to_jsonb(t)::text as j from person_master.assignment t where assignment_id=any(${relations}::uuid[])
      union all select 'version',to_jsonb(t)::text from person_master.assignment_version t where assignment_version_id=any(${ids}::uuid[])
      union all select 'segment',to_jsonb(t)::text from person_master.assignment_validation_segment t where assignment_version_id=any(${ids}::uuid[])
      union all select 'outcome',to_jsonb(t)::text from person_master.assignment_command_outcome t where assignment_version_id=any(${ids}::uuid[])
    ) rows
  `.execute(handle.database)).rows[0]!;
}
