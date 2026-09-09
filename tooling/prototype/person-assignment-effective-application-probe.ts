import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentEffectivePeriodApplication } from '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { createAssignmentTransferApplication } from '../../apps/governance-api/src/composition/create-assignment-transfer-application.js';
import type { AssignmentEffectivePeriodContext, AssignmentEffectivePeriodQuery } from '../../apps/governance-api/src/modules/person-master/index.js';
import { createAssignmentClosureFixture } from './person-assignment-closure-fixture.js';
import { temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';
import { requireEffectiveFixtureTarget } from './person-assignment-effective-fixture-guard.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import { runEffectiveConcurrency } from './person-assignment-effective-concurrency-probe.js';
import { runEffectiveFreshNegatives } from './person-assignment-effective-fresh-negative.js';
import { runEffectiveScopes } from './person-assignment-effective-scope-probe.js';
import { planIndependentChecks } from './person-assignment-effective-consumer.compile.js';

assert.equal(process.argv.length, 2, 'C05_VALIDATE_ARGUMENTS_INVALID');
assert.ok(process.env['DATABASE_URL'], 'C05_MANAGED_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const runId = randomUUID(), directory = `.runtime/pv006-c05/${runId}`;
await mkdir(directory, { recursive: false });
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 14, application_name: 'hdi-pv006-c05-application' });
const db = handle.database;
const cases: { ids: string[]; name: string; status: string; evidence?: unknown; error?: string }[] = [];
const requests: { query: AssignmentEffectivePeriodQuery; result: AssignmentEffectivePeriodContext; actor: string }[] = [];
const startedAt = new Date().toISOString();
const sourcePaths = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard',
  'apps/governance-api/src', 'tooling/prototype', 'db/migrations', 'package.json', 'package-lock.json'], { encoding: 'utf8' }).trim().split(/\r?\n/u))].sort();
const source = await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
export type EffectiveCheck = (ids: string[], name: string, work: () => Promise<unknown>, skip?: boolean) => Promise<void>;
const check: EffectiveCheck = async (ids, name, work, skip = false) => {
  console.log(JSON.stringify({ runId, startedCase: ids, name }));
  try { cases.push({ ids, name, status: skip ? 'SKIPPED_BY_SCOPE' : 'PASS', evidence: await work() }); }
  catch (error) { cases.push({ ids, name, status: 'FAILED', error: error instanceof Error ? error.message : 'UNKNOWN' }); throw error; }
  finally { await writeFile(`${directory}/case-${cases.length}.json`, JSON.stringify(cases.at(-1), null, 2), { flag: 'wx' }); }
};
let status = 'IN_PROGRESS', error: string | undefined;
try {
  const ownership = await requireEffectiveFixtureTarget(db, 'COHORT');
  const definitions = await db.selectFrom('person_master.assignment_semantic_term_version').selectAll().orderBy('term_version_id').execute();
  for (const code of ['PRIMARY_AFFILIATION','STANDING_CONCURRENT','SECONDMENT','ORGANIZATIONAL_AFFILIATION','CLINICAL_PRACTICE','TRAINING_LEARNING'])
    assert.ok(definitions.some(d => d.code === code), 'C05_EXISTING_SHARED_DEFINITION_REQUIRED');
  const f = await createAssignmentClosureFixture(db, runId);
  await f.grant(f.actor, ['PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE', 'PERSON_MASTER_ASSIGNMENT_TRANSFER']);
  async function read(query: AssignmentEffectivePeriodQuery, actor = f.actor) {
    const requestId = randomUUID();
    const result = await createAssignmentEffectivePeriodApplication(db, f.context(actor, requestId)).getAssignmentEffectivePeriodAsOf(query);
    const audit = await db.selectFrom('audit.audit_event').selectAll().where('request_id', '=', requestId)
      .where('action', '=', 'PERSON_ASSIGNMENT_READ').executeTakeFirstOrThrow();
    assert.equal(audit.entity_version_id, result.selectedAssignmentVersionId);
    const payload = audit.event_payload;
    assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
    assert.equal(payload['view'], 'EFFECTIVE_PERIOD_CONTEXT');
    for (const key of ['requestedFrom','requestedTo','recordAsOf','selectedAssignmentVersionId','declaredCoverage','contextFingerprint'] as const)
      assert.equal(payload[key], result[key]);
    assert.equal(payload['structuralDependencyResult'], result.structuralDependencies.result);
    assert.deepEqual(payload['originalEvidenceRefs'], result.originalEvidenceRefs);
    assert.doesNotMatch(JSON.stringify(result), /canonicalName|sourceRecordKey|identifierValue|canAssign|canPractice|ROLE_APPROVED|postgres(?:ql)?:\/\//u);
    requests.push({ query, result, actor }); return result;
  }
  const query = (assignmentId: string, recordAsOf: string, requestedFrom = Jun, requestedTo: string | null = Jul) =>
    ({ ...f.scope, assignmentId, requestedFrom, requestedTo, recordAsOf });
  await check(['DC-01','DC-02','DC-03','DC-05','DC-06','DC-07','DC-08','DC-09','AU-05','AU-06'], 'Latest full declaration, exact differences, unclassified legacy and audit binding', async () => {
    const e = await f.createEngagement(), v1 = await f.app().createAssignment(f.command(e.engagementId));
    const v2 = await f.closure().endAssignment(f.endCommand(v1, Jul));
    const before = await temporarySourceSnapshot(db, v1.assignmentId);
    const vectors = [
      { from: Jun, to: Jul, coverage: 'FULL', gaps: [] },
      { from: Jun, to: Aug, coverage: 'PARTIAL', gaps: [{ from: `${Jul}.000000`, to: `${Aug}.000000` }] },
      { from: Jul, to: Aug, coverage: 'NONE', gaps: [{ from: `${Jul}.000000`, to: `${Aug}.000000` }] },
      { from: '2025-01-01T00:00:00', to: Jan, coverage: 'NONE', gaps: [{ from: '2025-01-01T00:00:00.000000', to: `${Jan}.000000` }] },
      { from: Jun, to: null, coverage: 'PARTIAL', gaps: [{ from: `${Jul}.000000`, to: null }] },
    ];
    for (const vector of vectors) {
      const result = await read(query(v1.assignmentId, v2.recordedFrom, vector.from, vector.to));
      assert.equal(result.selectedAssignmentVersionId, v2.assignmentVersionId);
      assert.equal(result.declaredCoverage, vector.coverage); assert.deepEqual(result.uncoveredPeriods, vector.gaps);
      assert.equal(result.assignmentSemantics.classification, 'UNCLASSIFIED'); assert.equal(result.assignmentSemantics.modeCode, null);
      assert.equal(result.structuralDependencies.result, vector.coverage === 'FULL' ? 'SATISFIED' : 'NOT_EVALUATED');
      assert.equal(planIndependentChecks(result), vector.coverage === 'FULL' ? 'INDEPENDENT_CHECKS_REQUIRED' : 'INSUFFICIENT_CONTEXT');
    }
    assert.equal((await read(query(v1.assignmentId, v1.recordedFrom, Aug, null))).declaredCoverage, 'FULL');
    await assert.rejects(read(query(v1.assignmentId, Jan)), { message: 'ASSIGNMENT_NOT_KNOWN_AS_OF' });
    assert.deepEqual(await temporarySourceSnapshot(db, v1.assignmentId), before);
    return { v1: v1.assignmentVersionId, v2: v2.assignmentVersionId, vectors, unchanged: before };
  });
  await check(['DC-04','DC-06','DC-10','WP-10','SC-03'], 'Delayed start and microsecond boundaries select latest semantics; old exact behavior remains', async () => {
    const e = await f.createEngagement(), v1 = await f.app().createAssignment(f.command(e.engagementId));
    const v2 = await f.app().reviseAssignment({ ...f.scope, assignmentId: v1.assignmentId, expectedCurrentVersionId: v1.assignmentVersionId,
      businessValidFrom: Jun, businessValidTo: `${Jul}.000001`, reasonCode: 'VALIDITY_CORRECTION' });
    assert.equal((await read(query(v1.assignmentId, v2.recordedFrom, Jan, Jul))).declaredCoverage, 'PARTIAL');
    assert.equal((await read(query(v1.assignmentId, v2.recordedFrom, Jul, `${Jul}.000001`))).declaredCoverage, 'FULL');
    assert.equal((await read(query(v1.assignmentId, v2.recordedFrom, `${Jul}.000001`, Aug))).declaredCoverage, 'NONE');
    const classified = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
    const closed = await f.closure().endAssignment(f.endCommand(classified, Dec));
    const past = await read(query(classified.assignmentId, closed.recordedFrom));
    assert.equal(past.assignmentSemantics.semanticRole, 'INHERITED_FOR_CLOSURE');
    assert.equal(past.originalEvidenceRefs.admissionVersionId, classified.assignmentVersionId);
    assert.equal(past.explicitClosureKnown, true); assert.equal(past.structuralDependencies.result, 'SATISFIED');
    await assert.rejects(f.app().assessAssignmentDependencies({ ...f.scope, assignmentId: classified.assignmentId,
      assignmentVersionId: closed.assignmentVersionId, recordAsOf: closed.recordedFrom }), { message: 'ASSIGNMENT_CLOSURE_NOT_ADMISSION_VERSION' });
    const future = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId,
      { businessValidFrom: '2027-01-01T00:00:00', businessValidTo: null }));
    assert.equal((await read(query(future.assignmentId, future.recordedFrom, '2027-02-01T00:00:00', null))).structuralDependencies.result, 'SATISFIED');
    return { delayed: v2.assignmentVersionId, closed: closed.assignmentVersionId, future: future.assignmentVersionId };
  });
  await check(['WP-01','WP-02','WP-03','WP-04','WP-05','WP-06','CS-07'], 'Whole versus window dependency and complete lifecycle segmentation across record knowledge', async () => {
    const e = await f.createEngagement(), a = await f.app().createAssignment(f.command(e.engagementId, { businessValidTo: Dec }));
    const revised = await f.core().reviseEngagement({ ...f.scope, engagementId: e.engagementId, expectedCurrentVersionId: e.engagementVersionId,
      businessValidFrom: Jan, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' });
    const fullQuery = { ...f.scope, assignmentId: a.assignmentId, assignmentVersionId: a.assignmentVersionId, recordAsOf: revised.recordedFrom };
    const full = await f.app().assessAssignmentDependencies(fullQuery); assert.equal(full.constraintResult, 'NOT_SATISFIED');
    assert.equal((await read(query(a.assignmentId, revised.recordedFrom))).structuralDependencies.result, 'SATISFIED');
    assert.equal((await read(query(a.assignmentId, revised.recordedFrom, Jul, Dec))).structuralDependencies.result, 'NOT_SATISFIED');
    const s = await f.lifecycle().suspendEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: '0',
      businessEffectiveAt: `${Jun}.000001`, reasonCode: 'SYNTHETIC_C05_SUSPEND' });
    const prefix = await read(query(a.assignmentId, await f.now(), `${Jun}.000002`, Jul));
    assert.equal(prefix.structuralDependencies.result, 'REVIEW_REQUIRED');
    await f.lifecycle().resumeEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: s.sequenceNo,
      businessEffectiveAt: `${Jun}.000002`, reasonCode: 'SYNTHETIC_C05_RESUME' });
    const r = await f.now(), current = await read(query(a.assignmentId, r));
    assert.equal(current.structuralDependencies.result, 'REVIEW_REQUIRED');
    assert.deepEqual(current.structuralDependencies.engagementSegments.map(s => s.businessState), ['ACTIVE','SUSPENDED','ACTIVE']);
    assert.equal(current.structuralDependencies.engagementSegments[1]?.from, `${Jun}.000001`);
    assert.equal(current.structuralDependencies.engagementSegments[1]?.to, `${Jun}.000002`);
    assert.equal((await read(query(a.assignmentId, revised.recordedFrom))).structuralDependencies.result, 'SATISFIED');
    const canonical = await read(query(a.assignmentId, r, `${Jun}.0`, `${Jul}.000`));
    assert.deepEqual(canonical, current);
    assert.deepEqual(await f.app().assessAssignmentDependencies(fullQuery), full);
    const samePoint = `${Jun}.000003`;
    const suspendedAgain = await f.lifecycle().suspendEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: '2',
      businessEffectiveAt: samePoint, reasonCode: 'SYNTHETIC_C05_SAME_POINT_SUSPEND' });
    const resumedAgain = await f.lifecycle().resumeEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: suspendedAgain.sequenceNo,
      businessEffectiveAt: samePoint, reasonCode: 'SYNTHETIC_C05_SAME_POINT_RESUME' });
    const samePointResult = await read(query(a.assignmentId, await f.now(), samePoint, Jul));
    assert.equal(samePointResult.structuralDependencies.result, 'SATISFIED');
    assert.equal(samePointResult.structuralDependencies.engagementSegments.length, 1);
    assert.equal(samePointResult.structuralDependencies.engagementSegments[0]?.lifecycleSequence, resumedAgain.sequenceNo);
    return { full, current, prefix };
  });
  await check(['WP-07','WP-08'], 'Published Department authority excludes draft/future publication and cannot backfill an old broad period', async () => {
    const department = await f.createDepartment('C05-PUBLISH');
    const a = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId,
      { placement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: department.departmentId } }));
    const oldR = await f.now(), old = await read(query(a.assignmentId, oldR));
    const draft = await f.reviseDepartment(department.departmentId, 'ACTIVE', 'SYNTHETIC C05 DRAFT', Jul, false);
    const beforePublication = await read(query(a.assignmentId, oldR));
    assert.equal(beforePublication.observedEvidenceRefs.targetDepartment?.departmentVersionId, department.departmentVersionId);
    const draftVersion = await db.selectFrom('department_master.department_version').select('recorded_from')
      .where('department_version_id', '=', draft.departmentVersionId).executeTakeFirstOrThrow();
    assert.ok(draftVersion.recorded_from > oldR, 'C05_PUBLICATION_KNOWLEDGE_BOUNDARY_NOT_REACHED');
    // Use the actual version's clock: extending the old record interval beyond
    // this value would overlap two published versions and is natively rejected.
    await f.publishDepartment(draft, draftVersion.recorded_from);
    const afterPublicationAtOldR = await read(query(a.assignmentId, oldR));
    assert.deepEqual(afterPublicationAtOldR, beforePublication);
    assert.equal(afterPublicationAtOldR.observedEvidenceRefs.targetDepartment?.departmentVersionId, department.departmentVersionId);
    const late = await read(query(a.assignmentId, await f.now(), Jun, Aug)); assert.equal(late.structuralDependencies.result, 'NOT_SATISFIED');
    await f.reviseDepartment(department.departmentId, 'SUSPENDED', 'SYNTHETIC C05 SUSPENDED');
    assert.equal((await read(query(a.assignmentId, await f.now()))).structuralDependencies.result, 'NOT_SATISFIED');
    return { old, draftVersion: draft.departmentVersionId, late };
  });
  await check(['TS-01','TS-02','TS-03','TS-04','TS-06','TS-07','TS-08','TS-09','SC-04'], 'Temporary windows, source END/transfer and target END retain exact immutable links', async () => {
    const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId,
      { businessValidTo: Dec }))).coreVersion;
    const target = await f.createDepartment('C05-TEMP');
    const temp = () => createTemporaryAssignmentApplication(db, f.context());
    const child = await temp().createSourceLinkedTemporaryAssignment({ ...f.scope, sourceAssignmentId: source.assignmentId,
      expectedSourceVersionId: source.assignmentVersionId, targetPlacement: { scope: 'DEPARTMENT',
        departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: target.departmentId },
      businessValidFrom: Jun, businessValidTo: Aug, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' });
    const transferred = await createAssignmentTransferApplication(db, f.context()).transferAssignment({ ...f.scope,
      sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId, effectiveAt: Jul,
      targetPlacement: child.sourceLink.targetPlacement, reasonCode: 'ORGANIZATIONAL_TRANSFER' });
    const r = transferred.transferRecordedFrom;
    const before = await temporarySourceSnapshot(db, child.targetAssignmentId);
    const early = await read(query(child.targetAssignmentId, r)); assert.equal(early.structuralDependencies.result, 'SATISFIED');
    assert.equal(early.structuralDependencies.components.length, 6);
    assert.equal(early.originalEvidenceRefs.sourceAssignmentVersionId, source.assignmentVersionId);
    assert.equal(early.observedEvidenceRefs.sourceAssignmentVersionId, transferred.sourceClosureVersionId);
    assert.equal((await read(query(child.targetAssignmentId, r, Jun, Aug))).structuralDependencies.result, 'NOT_SATISFIED');
    const oldFull = await temp().assessTemporaryAssignmentDependencies({ ...f.scope, targetAssignmentId: child.targetAssignmentId,
      assignmentVersionId: child.targetAdmissionVersionId, recordAsOf: r }); assert.equal(oldFull.constraintResult, 'NOT_SATISFIED');
    assert.equal((await read(query(source.assignmentId, r, Jul, Aug))).declaredCoverage, 'NONE');
    assert.equal((await read(query(transferred.targetAssignmentId, r, Jul, Aug))).declaredCoverage, 'FULL');
    await assert.rejects(read(query(transferred.targetAssignmentId, source.recordedFrom, Jul, Aug)), /ASSIGNMENT_NOT_KNOWN_AS_OF/u);
    assert.deepEqual(await temporarySourceSnapshot(db, child.targetAssignmentId), before);
    const closed = await f.closure().endAssignment(f.endCommand(child.targetAdmission, Jul));
    assert.equal((await read(query(child.targetAssignmentId, closed.recordedFrom, Jun, Aug))).declaredCoverage, 'PARTIAL');
    assert.equal((await read(query(child.targetAssignmentId, closed.recordedFrom))).structuralDependencies.result, 'SATISFIED');
    assert.deepEqual((await temp().getTemporaryAssignment({ ...f.scope, targetAssignmentId: child.targetAssignmentId })).sourceLink, child.sourceLink);
    return { early, oldFull, closed: closed.assignmentVersionId, before };
  });
  await check(['AU-01','AU-03','AU-04','AU-08'], 'Each current permission is required even for historical PARTIAL/NONE; disabled/service actors refuse', async () => {
    const a = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId, { businessValidTo: Jul }));
    const permissions = ['PERSON_MASTER_ASSIGNMENT_READ','PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ','PERSON_MASTER_ENGAGEMENT_READ',
      'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ','DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'];
    for (const missing of permissions) {
      const actor = await f.principal(permissions.filter(p => p !== missing));
      for (const [from,to] of [[Jun,Jul],[Jun,Aug],[Jul,Aug]]) await assert.rejects(read(query(a.assignmentId, a.recordedFrom, from, to), actor), /OBJECT_PERMISSION_FORBIDDEN/u);
    }
    const actor = await f.principal(permissions); await read(query(a.assignmentId, a.recordedFrom), actor);
    await f.grant(actor, ['PERSON_MASTER_ASSIGNMENT_READ'], 'DENY', '2');
    await assert.rejects(read(query(a.assignmentId, a.recordedFrom), actor), /OBJECT_PERMISSION_FORBIDDEN/u);
    for (const [kind,state] of [['SERVICE','ACTIVE'],['PERSON','DISABLED']]) {
      const denied = await f.principal(permissions, kind, state);
      await assert.rejects(read(query(a.assignmentId, a.recordedFrom), denied), /ASSIGNMENT_HUMAN_ACTOR_REQUIRED/u);
    }
    const app = createAssignmentEffectivePeriodApplication(db, f.context());
    for (const key of ['expectedValid','approved','assignmentVersionId','role','rawSql'])
      await assert.rejects(Reflect.apply(app.getAssignmentEffectivePeriodAsOf, app, [{ ...query(a.assignmentId, a.recordedFrom), [key]: true }]));
    for (const to of [Jun, '2026-07-01T00:00:00Z', '2026-07-01T00:00:00+08:00', '0000-07-01T00:00:00'])
      await assert.rejects(read(query(a.assignmentId, a.recordedFrom, Jun, to)));
    return { missingPermissions: permissions, coverageBranches: 3, revokedActor: actor };
  });
  await runEffectiveConcurrency(db, f, check);
  await runEffectiveScopes(db, f, check);
  await check(['CS-04','CS-08','SC-05'], 'A one-connection pool supports the read-only public port and separate audit transaction', async () => {
    const a = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId));
    const one = createDatabase({ connectionString: process.env['DATABASE_URL']!, max: 1, application_name: 'hdi-pv006-c05-one-connection' });
    try {
      const app = createAssignmentEffectivePeriodApplication(one.database, f.context());
      assert.deepEqual(Object.keys(app), ['getAssignmentEffectivePeriodAsOf']);
      const result = await app.getAssignmentEffectivePeriodAsOf(query(a.assignmentId, a.recordedFrom));
      assert.equal(result.structuralDependencies.result, 'SATISFIED');
      assert.equal(planIndependentChecks(result), 'INDEPENDENT_CHECKS_REQUIRED');
      return { result, maximumPoolConnections: 1 };
    } finally { await one.close(); }
  });
  if (ownership.mode === 'OWNED_FRESH') await runEffectiveFreshNegatives(db, f, check);
  else await check(['WP-09','TS-05','TS-10','CS-06','AU-07'], 'Destructive / returned-candidate / retirement cases reserved for receipt-owned fresh', async () => ({ requires: 'same-source C05 owned fresh' }), true);
  if (ownership.mode === 'RETAINED') assert.deepEqual(await db.selectFrom('person_master.assignment_semantic_term_version').selectAll().orderBy('term_version_id').execute(), definitions);
  const identity = (await sql<{ database: string; oid: string; role: string }>`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid,current_user as role`.execute(db)).rows[0]!;
  const cohort = [...new Set(requests.map(r => r.result.assignmentId))].sort();
  const hashes = await Promise.all(cohort.map(async id => ({ id, rows: await temporarySourceSnapshot(db, id) })));
  const recoveryRequests = requests.filter(request => request.actor === f.actor);
  const recovery = { task: 'PV-006-C-05', mode: 'RECOVERY', runId, identity, endpoint: ownership.identity.endpoint,
    actor: f.actor, requests: recoveryRequests, hashes, source, inputHash: createHash('sha256').update(JSON.stringify(recoveryRequests)).digest('hex') };
  const recoveryBytes = JSON.stringify(recovery, null, 2);
  await writeFile(`${directory}/recovery.json`, recoveryBytes, { flag: 'wx' });
  await writeFile(`${directory}/recovery-binding.json`, JSON.stringify({ task: 'PV-006-C-05', runId,
    receiptSha256: createHash('sha256').update(recoveryBytes).digest('hex') }, null, 2), { flag: 'wx' });
  status = 'PASS';
} catch (failure) { status = 'FAILED'; error = failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : 'UNKNOWN'; process.exitCode = 1; }
finally {
  await handle.close();
  const after = await Promise.all(sourcePaths.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
  if (JSON.stringify(source) !== JSON.stringify(after)) { status = 'FAILED'; error = 'C05_SOURCE_CHANGED_DURING_RUN'; process.exitCode = 1; }
  await writeFile(`${directory}/application.json`, JSON.stringify({ task: 'PV-006-C-05', runId, status, error, startedAt,
    finishedAt: new Date().toISOString(), cwd: process.cwd(), argv: process.argv.slice(1), cases, source, poolClosed: true }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-05', runId, status, error, cases: cases.length, directory, poolClosed: true }));
}
