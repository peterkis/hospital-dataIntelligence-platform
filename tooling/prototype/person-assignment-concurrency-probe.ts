import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { AssignmentVersion, CreateAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { assignmentScope, Jul, Aug, Dec, type createAssignmentFixture } from './person-assignment-fixture.js';

type Fixture = Awaited<ReturnType<typeof createAssignmentFixture>>;
type Check = (ids: string[], name: string, work: () => Promise<unknown>) => Promise<void>;
type Settled<T> = { ok: true; value: T } | { ok: false; code: string; sqlState: string | null };
const settle = async <T>(work: Promise<T>): Promise<Settled<T>> => {
  try { return { ok: true, value: await work }; }
  catch (error) { return { ok: false, code: error instanceof Error ? error.message : 'UNKNOWN',
    sqlState: error !== null && typeof error === 'object' && 'code' in error ? String(error.code) : null }; }
};
function success<T>(r: Settled<T>): T { assert.equal(r.ok, true, JSON.stringify(r)); if (!r.ok) throw new Error('UNREACHABLE'); return r.value; }

export async function runAssignmentConcurrency(database: Kysely<DB>, f: Fixture,
  command: (engagementId: string, from?: string, to?: string | null, departmentId?: string) => CreateAssignment,
  keep: (v: AssignmentVersion) => AssignmentVersion, check: Check) {
  async function gate(lock: (tx: Transaction<DB>) => Promise<unknown>) {
    let release!: () => void, entered!: (pid: number) => void, failed!: (error: unknown) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<number>((resolve, reject) => { entered = resolve; failed = reject; });
    const completed = database.transaction().execute(async tx => {
      await lock(tx);
      const pid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid;
      entered(pid); await released;
    });
    void completed.catch(failed);
    return { pid: await acquired, async close() { release(); await completed; } };
  }
  async function blockedBy(pid: number, count = 1) {
    const start = performance.now();
    while (performance.now() - start < 15000) {
      const rows = (await sql<{ pid: number; wait_event_type: string; wait_event: string; blockers: number[] }>`
        select pid,wait_event_type,wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity
        where cardinality(pg_blocking_pids(pid))>0 and datname=current_database()
        order by pid
      `.execute(database)).rows;
      // PostgreSQL can queue the second writer behind the first tuple waiter,
      // rather than directly behind the original transaction. Inspect that chain.
      const chain = new Set([pid]);
      for (let depth = 0; depth < rows.length; depth++)
        for (const row of rows) if (row.blockers.some(blocker => chain.has(blocker))) chain.add(row.pid);
      const descendants = rows.filter(row => row.pid !== pid && chain.has(row.pid));
      if (descendants.length >= count) return descendants;
    }
    throw new Error('ASSIGNMENT_EXPECTED_LOCK_WAIT_NOT_OBSERVED');
  }
  const deptGate = (version: string) => gate(tx => tx.selectFrom('department_master.department_version')
    .select('department_version_id').where('department_version_id', '=', version).forUpdate().execute());
  const engagementGate = (id: string) => gate(tx => tx.selectFrom('person_master.engagement').select('engagement_id')
    .where('engagement_id', '=', id).forUpdate().execute());

  await check(['TX-01'], 'two same requests wait on actual request lock and commit only one outcome/audit', async () => {
    const e = await f.createEngagement(), request = randomUUID(), c = command(e.engagementId);
    const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT:${assignmentScope.governanceObjectId}:${request}`},0))`.execute(tx));
    const first = settle(f.app(request).createAssignment(c)), second = settle(f.app(request).createAssignment(c));
    let waits;
    try { waits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    const a = success(await first), b = success(await second); assert.deepEqual(a,b); keep(a);
    const audit = await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', request).execute();
    assert.equal(audit.length, 1);
    return { blocker: held.pid, waits, versionId: a.assignmentVersionId, successAuditCount: audit.length };
  });
  await check(['TX-05'], 'two expected-version writers visibly queue then one succeeds and one is stale', async () => {
    const e = await f.createEngagement(), v1 = keep(await f.app().createAssignment(command(e.engagementId)));
    const held = await gate(tx => tx.selectFrom('person_master.assignment').select('assignment_id')
      .where('assignment_id', '=', v1.assignmentId).forUpdate().execute());
    const revise = { ...assignmentScope, assignmentId: v1.assignmentId, expectedCurrentVersionId: v1.assignmentVersionId,
      businessValidFrom: Jul, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' as const };
    const first = settle(f.app().reviseAssignment(revise)), second = settle(f.app().reviseAssignment(revise));
    let waits;
    try { waits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    const outcomes = await Promise.all([first, second]);
    assert.equal(outcomes.filter(o => o.ok).length, 1);
    assert.equal(outcomes.filter(o => !o.ok && o.code === 'ASSIGNMENT_STALE_VERSION').length, 1);
    for (const o of outcomes) if (o.ok) { keep(o.value); assert.equal(o.value.supersedesAssignmentVersionId, v1.assignmentVersionId); }
    assert.deepEqual(await f.app().getAssignmentVersion({ ...assignmentScope, assignmentId: v1.assignmentId, assignmentVersionId: v1.assignmentVersionId }), v1);
    return { waits, outcomes };
  });
  await check(['TX-06', 'SC-04'], 'Assignment pins Engagement before end; real end waits and later assessment changes', async () => {
    const e = await f.createEngagement(), dept = await f.createDepartment('RACE-END');
    const held = await deptGate(dept.departmentVersionId), order: string[] = [];
    const created = settle(f.app().createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId))
      .then(value => { order.push('ASSIGNMENT_COMMITTED'); return value; }));
    let placementWait, endWait, ended;
    try {
      placementWait = await blockedBy(held.pid);
      ended = settle(f.lifecycle().endEngagement({ ...assignmentScope, engagementId: e.engagementId,
        expectedCurrentEngagementVersionId: e.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_RACE_END' })
        .then(value => { order.push('END_COMMITTED'); return value; }));
      endWait = await blockedBy(placementWait[0]!.pid);
    } finally { await held.close(); }
    const v = keep(success(await created)); assert.ok(ended); success(await ended);
    assert.deepEqual(order, ['ASSIGNMENT_COMMITTED', 'END_COMMITTED']);
    const assessment = await f.app().assessAssignmentDependencies({ ...assignmentScope, assignmentId: v.assignmentId,
      assignmentVersionId: v.assignmentVersionId, recordAsOf: await f.now() });
    assert.equal(assessment.constraintResult, 'NOT_SATISFIED');
    return { placementWait, endWait, order, assessment };
  });
  await check(['TX-06'], 'end is first in the real stable-row queue and later Assignment refuses', async () => {
    const e = await f.createEngagement(), held = await engagementGate(e.engagementId), order: string[] = [];
    const ended = settle(f.lifecycle().endEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedCurrentEngagementVersionId: e.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_END_FIRST' })
      .then(value => { order.push('END_COMMITTED'); return value; }));
    let endWait, assignmentWait, created;
    try {
      endWait = await blockedBy(held.pid);
      created = settle(f.app().createAssignment(command(e.engagementId)).catch(error => { order.push('ASSIGNMENT_REFUSED'); throw error; }));
      assignmentWait = await blockedBy(held.pid, 2);
    } finally { await held.close(); }
    success(await ended); assert.ok(created); const r = await created;
    assert.equal(r.ok, false); if (!r.ok) assert.equal(r.code, 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED');
    assert.deepEqual(order, ['END_COMMITTED', 'ASSIGNMENT_REFUSED']);
    return { endWait, assignmentWait, order, outcome: r };
  });
  await check(['TX-07'], 'publication waits for Assignment pinned version then changes only later assessment', async () => {
    const e = await f.createEngagement(), dept = await f.createDepartment('RACE-PUB');
    const draft = await f.reviseDepartment(dept.departmentId, 'SUSPENDED', 'SYNTHETIC C01 RACE', null, false);
    // The existing Person audit lock creates an observable pause after all dependency pins.
    const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${assignmentScope.governanceObjectId},47))`.execute(tx));
    const order: string[] = [];
    const created = settle(f.app().createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId))
      .then(v => { order.push('ASSIGNMENT_COMMITTED'); return v; }));
    let assignmentWait, publicationWait, published;
    try {
      assignmentWait = await blockedBy(held.pid);
      published = settle(f.publishDepartment(draft).then(v => { order.push('PUBLICATION_COMMITTED'); return v; }));
      publicationWait = await blockedBy(assignmentWait[0]!.pid);
    } finally { await held.close(); }
    const v = keep(success(await created)); assert.ok(published); success(await published);
    assert.deepEqual(order, ['ASSIGNMENT_COMMITTED', 'PUBLICATION_COMMITTED']);
    const assessment = await f.app().assessAssignmentDependencies({ ...assignmentScope, assignmentId: v.assignmentId,
      assignmentVersionId: v.assignmentVersionId, recordAsOf: await f.now() });
    assert.equal(assessment.constraintResult, 'NOT_SATISFIED');
    assert.deepEqual(await f.app().getAssignmentVersion({ ...assignmentScope, assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId }), v);
    return { assignmentWait, publicationWait, order, assessment };
  });
  await check(['TX-06'], 'Assignment-first suspension queue preserves acceptance then requires review', async () => {
    const e = await f.createEngagement(), dept = await f.createDepartment('RACE-SUSPEND');
    const held = await deptGate(dept.departmentVersionId), order: string[] = [];
    const created = settle(f.app().createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId))
      .then(value => { order.push('ASSIGNMENT_COMMITTED'); return value; }));
    let placementWait, suspensionWait, suspended;
    try {
      placementWait = await blockedBy(held.pid);
      suspended = settle(f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: e.engagementId,
        expectedLifecycleSequence: '0', businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_RACE_SUSPEND' })
        .then(value => { order.push('SUSPEND_COMMITTED'); return value; }));
      suspensionWait = await blockedBy(placementWait[0]!.pid);
    } finally { await held.close(); }
    const v = keep(success(await created)); assert.ok(suspended); success(await suspended);
    assert.deepEqual(order, ['ASSIGNMENT_COMMITTED', 'SUSPEND_COMMITTED']);
    const assessment = await f.app().assessAssignmentDependencies({ ...assignmentScope, assignmentId: v.assignmentId,
      assignmentVersionId: v.assignmentVersionId, recordAsOf: await f.now() });
    assert.equal(assessment.constraintResult, 'REVIEW_REQUIRED');
    assert.deepEqual(await f.app().getAssignmentVersion({ ...assignmentScope, assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId }), v);
    return { placementWait, suspensionWait, order, assessment };
  });
  await check(['TX-06'], 'suspension-first stable-row queue refuses later Assignment', async () => {
    const e = await f.createEngagement(), held = await engagementGate(e.engagementId), order: string[] = [];
    const suspended = settle(f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: e.engagementId,
      expectedLifecycleSequence: '0', businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_SUSPEND_FIRST' })
      .then(value => { order.push('SUSPEND_COMMITTED'); return value; }));
    let suspensionWait, assignmentWait, created;
    try {
      suspensionWait = await blockedBy(held.pid);
      created = settle(f.app().createAssignment(command(e.engagementId)).catch(error => { order.push('ASSIGNMENT_REFUSED'); throw error; }));
      assignmentWait = await blockedBy(held.pid, 2);
    } finally { await held.close(); }
    success(await suspended); assert.ok(created); const outcome = await created;
    assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(outcome.code, 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED');
    assert.deepEqual(order, ['SUSPEND_COMMITTED', 'ASSIGNMENT_REFUSED']);
    return { suspensionWait, assignmentWait, order, outcome };
  });
  await check(['TX-07'], 'publication wins queue; Assignment never accepts cached old ACTIVE version', async () => {
    const e = await f.createEngagement(), dept = await f.createDepartment('PUB-FIRST');
    const draft = await f.reviseDepartment(dept.departmentId, 'SUSPENDED', 'SYNTHETIC C01 PUB FIRST', null, false);
    const held = await deptGate(dept.departmentVersionId), published = settle(f.publishDepartment(draft));
    let publicationWait, assignmentWait, created;
    try {
      publicationWait = await blockedBy(held.pid);
      created = settle(f.app().createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId)));
      assignmentWait = await blockedBy(held.pid, 2);
    } finally { await held.close(); }
    success(await published); assert.ok(created); const outcome = await created;
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.ok(['DEPENDENCY_CHANGED_DURING_VALIDATION','ASSIGNMENT_PLACEMENT_NOT_ACTIVE'].includes(outcome.code));
    await assert.rejects(f.app().createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId)), { message: 'ASSIGNMENT_PLACEMENT_NOT_ACTIVE' });
    return { publicationWait, assignmentWait, outcome };
  });
  await check(['TX-08'], 'actual PostgreSQL deadlock is propagated and never persisted as a terminal business rejection', async () => {
    const attempts = [];
    let assignmentWasVictim = false;
    for (let trial = 0; trial < 3 && !assignmentWasVictim; trial++) {
      const e = await f.createEngagement(), dept = await f.createDepartment(`DEADLOCK-${trial}`), request = randomUUID();
      let ready!: (pid: number) => void, enterCycle!: () => void, startFailed!: (error: unknown) => void;
      const cycle = new Promise<void>(resolve => { enterCycle = resolve; });
      const acquired = new Promise<number>((resolve, reject) => { ready = resolve; startFailed = reject; });
      const lockOnlyTransaction = database.transaction().execute(async tx => {
        await tx.selectFrom('department_master.department_version').select('department_version_id')
          .where('department_version_id', '=', dept.departmentVersionId).forUpdate().execute();
        ready((await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid);
        await cycle;
        await tx.selectFrom('person_master.engagement').select('engagement_id').where('engagement_id', '=', e.engagementId).forUpdate().execute();
        return 'LOCK_ONLY_TRANSACTION_COMMITTED';
      });
      void lockOnlyTransaction.catch(startFailed);
      const lockOutcome = settle(lockOnlyTransaction), pid = await acquired;
      const assignment = settle(f.app(request).createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId)));
      let wait;
      try { wait = await blockedBy(pid); } finally { enterCycle(); }
      const [a, b] = await Promise.all([assignment, lockOutcome]);
      assert.equal([a,b].filter(o => !o.ok && o.sqlState === '40P01').length, 1);
      if (!a.ok) {
        assert.equal(a.sqlState, '40P01'); assignmentWasVictim = true;
        assert.equal((await database.selectFrom('person_master.assignment').select('assignment_id').where('creation_request_id', '=', request).execute()).length, 0);
        assert.equal((await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', '=', request).execute()).length, 0);
        keep(await f.app(request).createAssignment(command(e.engagementId, Jul, Dec, dept.departmentId)));
      } else keep(a.value);
      attempts.push({ wait, assignment: a.ok ? { ok: true, versionId: a.value.assignmentVersionId } : a, lockOnly: b });
    }
    assert.equal(assignmentWasVictim, true, 'ASSIGNMENT_DEADLOCK_ROLLBACK_NOT_OBSERVED');
    return { attempts, assignmentWasVictim, retryUsedSameRequest: true };
  });
  await check(['EV-08', 'SC-04'], 'concurrent read assessments keep one snapshot each and serialize audit safely', async () => {
    const e = await f.createEngagement(), v = keep(await f.app().createAssignment(command(e.engagementId)));
    const query = { ...assignmentScope, assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId, recordAsOf: await f.now() };
    const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${assignmentScope.governanceObjectId},47))`.execute(tx));
    const first = settle(f.app().assessAssignmentDependencies(query)), second = settle(f.app().assessAssignmentDependencies(query));
    let waits;
    try { waits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    const a = success(await first), b = success(await second);
    assert.deepEqual(a,b); assert.equal(a.constraintResult, 'SATISFIED');
    return { waits, identicalSnapshots: true, bothAuditsCommitted: true };
  });
}
