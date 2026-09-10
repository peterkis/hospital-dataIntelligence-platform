import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, Kysely, PostgresDialect, type Transaction } from 'kysely';
import { Pool } from 'pg';
import { createAssignmentClosureApplication } from '../../apps/governance-api/src/composition/create-assignment-closure-application.js';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { Jan, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import type { ClosureFixture, ClosureCheck } from './person-assignment-closure-fixture.js';

type Settled<T> = { ok: true; value: T } | { ok: false; code: string; sqlState: string | null };
async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await work }; }
  catch (error) { return { ok: false, code: error instanceof Error ? error.message : 'UNKNOWN',
    sqlState: error && typeof error === 'object' && 'code' in error ? String(error.code) : null }; }
}
function success<T>(value: Settled<T>): T {
  assert.ok(value.ok, JSON.stringify(value)); return value.value;
}
function refusal(value: Settled<unknown>, expected: string) { assert.ok(!value.ok); assert.equal(value.code, expected); }

export async function runAssignmentClosureConcurrency(database: Kysely<DB>, f: ClosureFixture, check: ClosureCheck) {
  async function gate(lock: (tx: Transaction<DB>) => Promise<unknown>) {
    let release!: () => void, entered!: (pid: number) => void, failed!: (error: unknown) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<number>((resolve, reject) => { entered = resolve; failed = reject; });
    const completed = database.transaction().execute(async tx => {
      await lock(tx); entered((await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid); await released;
    });
    void completed.catch(failed);
    return { pid: await acquired, async close() { release(); await completed; } };
  }
  async function blockedBy(pid: number, count = 1) {
    const started = performance.now();
    while (performance.now() - started < 15000) {
      const rows = (await sql<{ pid: number; wait_event: string; blockers: number[] }>`
        select pid,wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity
        where datname=current_database() and application_name='hdi-pv006-c0301-application'
          and cardinality(pg_blocking_pids(pid))>0 order by pid`.execute(database)).rows;
      const chain = new Set([pid]);
      for (let depth = 0; depth < rows.length; depth++)
        for (const row of rows) if (row.blockers.some(blocker => chain.has(blocker))) chain.add(row.pid);
      const descendants = rows.filter(row => row.pid !== pid && chain.has(row.pid));
      if (descendants.length >= count) return descendants;
      await delay(10);
    }
    throw new Error('C0301_EXPECTED_LOCK_QUEUE_NOT_OBSERVED');
  }
  const engagementGate = (id: string) => gate(tx => tx.selectFrom('person_master.engagement').select('engagement_id')
    .where('engagement_id', '=', id).forUpdate().execute());
  async function ordered<T, U>(id: string, first: () => Promise<T>, second: () => Promise<U>) {
    const held = await engagementGate(id), a = settle(first());
    let b: Promise<Settled<U>> | undefined, waits;
    try { await blockedBy(held.pid); b = settle(second()); waits = await blockedBy(held.pid, 2); }
    finally { await held.close(); }
    assert.ok(b); return { first: await a, second: await b, waits };
  }

  await check(['ID-01', 'ID-09'], 'Two END writers visibly serialize; same-request replay yields one closure and one success audit', async () => {
    const source = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId));
    const stable = await f.app().getAssignment({ ...f.scope, assignmentId: source.assignmentId });
    const result = await ordered(stable.engagementId, () => f.closure().endAssignment(f.endCommand(source, Aug)),
      () => f.closure().endAssignment(f.endCommand(source, Dec)));
    success(result.first); refusal(result.second, 'ASSIGNMENT_ALREADY_CLOSED');
    const next = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId));
    const request = randomUUID(), input = f.endCommand(next, Aug);
    const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${`ASSIGNMENT:${f.scope.governanceObjectId}:${request}`},0))`.execute(tx));
    const a = settle(f.closure(request).endAssignment(input)), b = settle(f.closure(request).endAssignment(input));
    let duplicateWaits;
    try { duplicateWaits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    assert.deepEqual(success(await a), success(await b));
    const events = await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', request).where('action', '=', 'PERSON_ASSIGNMENT_ENDED').execute();
    assert.equal(events.length, 1);
    return { result, duplicateWaits, successAudits: events.length };
  });

  await check(['ID-10'], 'Core and classified revision compete with END in both observed queue orders', async () => {
    const observations = [];
    for (const classified of [false, true]) for (const endFirst of [false, true]) {
      const e = await f.createEngagement();
      const source = classified ? (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId))).coreVersion
        : await f.app().createAssignment(f.command(e.engagementId));
      const input = { ...f.scope, assignmentId: source.assignmentId, expectedCurrentVersionId: source.assignmentVersionId,
        businessValidFrom: Jan, businessValidTo: Dec, reasonCode: 'VALIDITY_CORRECTION' as const };
      const end = () => f.closure().endAssignment(f.endCommand(source, Aug));
      const revise = async () => classified ? (await f.semantics().reviseClassifiedAssignmentPeriod(input)).coreVersion : f.app().reviseAssignment(input);
      const result = endFirst ? await ordered(e.engagementId, end, revise) : await ordered(e.engagementId, revise, end);
      assert.ok(result.first.ok); refusal(result.second, endFirst ? 'ASSIGNMENT_ALREADY_CLOSED' : 'ASSIGNMENT_STALE_VERSION');
      observations.push({ classified, endFirst, ...result });
    }
    return observations;
  });

  await check(['ID-11', 'PR-02', 'PR-04'], 'END first frees only the tail; PRIMARY first refuses old overlap and must use a fresh request after closure', async () => {
    const observations = [];
    for (const endFirst of [true, false]) {
      const e = await f.createEngagement(), source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
      const request = randomUUID(), input = f.classifiedCommand(e.engagementId, { businessValidFrom: Aug });
      const end = () => f.closure().endAssignment(f.endCommand(source.coreVersion, Aug));
      const create = () => f.semantics(request).createClassifiedAssignment(input);
      const result = endFirst ? await ordered(e.engagementId, end, create) : await ordered(e.engagementId, create, end);
      if (endFirst) { assert.ok(result.first.ok); assert.ok(result.second.ok); }
      else {
        refusal(result.first, 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT'); assert.ok(result.second.ok);
        await assert.rejects(create(), { message: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
        await f.semantics().createClassifiedAssignment(input);
      }
      observations.push({ endFirst, ...result });
    }
    return observations;
  });

  await check(['ID-12'], 'Upstream end and suspension serialize with Assignment END in both real queue orders', async () => {
    const observations = [];
    for (const operation of ['END', 'SUSPEND'] as const) for (const closureFirst of [true, false]) {
      const e = await f.createEngagement(), source = await f.app().createAssignment(f.command(e.engagementId));
      const end = () => f.closure().endAssignment(f.endCommand(source, Aug));
      const upstream = async () => operation === 'END'
        ? f.lifecycle().endEngagement({ ...f.scope, engagementId: e.engagementId, expectedCurrentEngagementVersionId: e.engagementVersionId,
          businessEffectiveAt: Jul, reasonCode: 'SYNTHETIC_C0301_UPSTREAM_END' })
        : f.lifecycle().suspendEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: '0',
          businessEffectiveAt: Jul, reasonCode: 'SYNTHETIC_C0301_UPSTREAM_SUSPEND' });
      const result = closureFirst ? await ordered(e.engagementId, end, upstream) : await ordered(e.engagementId, upstream, end);
      assert.ok(result.first.ok); assert.ok(result.second.ok);
      assert.deepEqual(await f.app().getAssignmentVersion({ ...f.scope, assignmentId: source.assignmentId, assignmentVersionId: source.assignmentVersionId }), source);
      observations.push({ operation, closureFirst, ...result });
    }
    return observations;
  });

  async function bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('C0301_INDEPENDENT_PROGRESS_TIMEOUT')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  await check(['ID-12', 'SC-06'], 'Department publication and END progress independently without a publication pin or reverse lock order', async () => {
    const observations = [];
    for (const closureFirst of [true, false]) {
      const e = await f.createEngagement(), d = await f.createDepartment(`C0301-PUBLISH-${closureFirst}`);
      const source = await f.app().createAssignment(f.command(e.engagementId, { placement: { scope: 'DEPARTMENT',
        departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: d.departmentId } }));
      const draft = await f.reviseDepartment(d.departmentId, 'SUSPENDED', 'SYNTHETIC C0301 PUBLISHED SUSPENSION', null, false);
      if (closureFirst) {
        const held = await gate(tx => tx.selectFrom('department_master.department_version').select('department_version_id')
          .where('department_version_id', '=', d.departmentVersionId).forUpdate().execute());
        const publishing = settle(f.publishDepartment(draft));
        let waits, closed;
        try { waits = await blockedBy(held.pid); closed = await bounded(f.closure().endAssignment(f.endCommand(source, Aug))); }
        finally { await held.close(); }
        success(await publishing); observations.push({ closureFirst, waits, closed: closed?.assignmentVersionId });
      } else {
        const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${f.scope.governanceObjectId},47))`.execute(tx));
        const closing = settle(f.closure().endAssignment(f.endCommand(source, Aug)));
        let waits;
        try { waits = await blockedBy(held.pid); await bounded(f.publishDepartment(draft)); }
        finally { await held.close(); }
        const closed = success(await closing); observations.push({ closureFirst, waits, closed: closed.assignmentVersionId });
      }
    }
    return observations;
  });

  await check(['ID-14'], 'A real deadlock victim rolls back END request authority and retries the same request once', async () => {
    const attempts = [];
    let closureVictim = false;
    for (let trial = 0; trial < 3 && !closureVictim; trial++) {
      const e = await f.createEngagement(), source = await f.app().createAssignment(f.command(e.engagementId));
      const request = randomUUID(), input = f.endCommand(source, Aug);
      let entered!: (pid: number) => void, failed!: (error: unknown) => void, startCycle!: () => void;
      const ready = new Promise<number>((resolve, reject) => { entered = resolve; failed = reject; });
      const cycle = new Promise<void>(resolve => { startCycle = resolve; });
      const lockOnly = database.transaction().execute(async tx => {
        await tx.selectFrom('person_master.engagement').select('engagement_id').where('engagement_id', '=', e.engagementId).forUpdate().execute();
        entered((await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid);
        await cycle;
        await tx.selectFrom('person_master.assignment').select('assignment_id').where('assignment_id', '=', source.assignmentId).forUpdate().execute();
        return 'LOCK_ONLY';
      });
      void lockOnly.catch(failed); const lockResult = settle(lockOnly), pid = await ready;
      const ending = settle(f.closure(request).endAssignment(input));
      let waits;
      try { waits = await blockedBy(pid); } finally { startCycle(); }
      const [a, b] = await Promise.all([ending, lockResult]);
      assert.equal([a, b].filter(r => !r.ok && r.sqlState === '40P01').length, 1);
      if (!a.ok) {
        assert.equal(a.sqlState, '40P01'); closureVictim = true;
        assert.equal((await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', '=', request).execute()).length, 0);
        assert.equal((await database.selectFrom('person_master.assignment_closure_evidence').selectAll().where('assignment_id', '=', source.assignmentId).execute()).length, 0);
        const retried = await f.closure(request).endAssignment(input);
        assert.deepEqual(await f.closure(request).endAssignment(input), retried);
      }
      attempts.push({ waits, closure: a, lockOnly: b });
    }
    assert.equal(closureVictim, true, 'REAL_CLOSURE_DEADLOCK_ROLLBACK_NOT_OBSERVED');
    return { attempts, closureVictim, maximumAttempts: 3 };
  });

  await check(['ID-14'], 'Terminating only the observed task-owned waiting backend loses no facts and stores no permanent refusal', async () => {
    const e = await f.createEngagement(), source = await f.app().createAssignment(f.command(e.engagementId));
    const request = randomUUID(), input = f.endCommand(source, Aug);
    // Expected transport error events belong to this one test-owned pool. Do not
    // change platform-wide error handling or let an EventEmitter abort the receipt.
    const transportErrors: string[] = [];
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1, application_name: 'hdi-pv006-c0301-application' });
    pool.on('connect', client => client.on('error', error => transportErrors.push(error.message)));
    pool.on('error', error => transportErrors.push(error.message));
    const isolated = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    try {
      const ownedPid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(isolated)).rows[0]!.pid;
      const held = await engagementGate(e.engagementId);
      const ending = settle(createAssignmentClosureApplication(isolated, f.context(f.actor, request)).endAssignment(input));
      let waits;
      try {
        waits = await blockedBy(held.pid); assert.equal(waits.length, 1); assert.equal(waits[0]!.pid, ownedPid);
        const terminated = (await sql<{ terminated: boolean }>`select pg_terminate_backend(pid) as terminated from pg_stat_activity
          where pid=${ownedPid} and application_name='hdi-pv006-c0301-application' and datname=current_database()
            and usename=current_user and ${held.pid}=any(pg_blocking_pids(pid))`.execute(database)).rows;
        assert.deepEqual(terminated, [{ terminated: true }]);
      } finally { await held.close(); }
      const failure = await ending; assert.ok(!failure.ok);
      assert.ok(failure.sqlState === '57P01' || /connection.*(?:terminated|error)|not queryable/iu.test(failure.code), 'CONNECTION_FAILURE_REQUIRED');
      assert.equal((await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', '=', request).execute()).length, 0);
      const closed = await f.closure(request).endAssignment(input);
      assert.deepEqual(await f.closure(request).endAssignment(input), closed);
      return { waits, failure, transportErrors, retryVersion: closed.assignmentVersionId, outcomeCountAfterFailure: 0, isolatedPool: true };
    } finally { await isolated.destroy(); }
  });

  await check(['ID-13'], 'Concurrent RR closure and declaration reads close snapshots before serializing audit', async () => {
    const e = await f.createEngagement(), source = await f.app().createAssignment(f.command(e.engagementId));
    const closed = await f.closure().endAssignment(f.endCommand(source, Aug));
    const query = { ...f.scope, assignmentId: source.assignmentId, businessAt: Jul, recordAsOf: await f.now() };
    const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${f.scope.governanceObjectId},47))`.execute(tx));
    const a = settle(f.closure().getAssignmentDeclaredPeriodAsOf(query)), b = settle(f.closure().getAssignmentClosure({ ...f.scope,
      assignmentId: source.assignmentId, closureVersionId: closed.assignmentVersionId }));
    let waits;
    try { waits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    assert.equal(success(await a).isWithinDeclaredPeriod, true); assert.deepEqual(success(await b), closed);
    return { waits, consistentReads: 2 };
  });
}
