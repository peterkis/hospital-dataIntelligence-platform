import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { assignmentScope, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { SemanticAppFactory, SemanticCheck, SemanticCommandFactory, SemanticFixture } from './person-assignment-semantics-test-support.js';

type Settled<T> = { ok: true; value: T } | { ok: false; code: string };
async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await work }; }
  catch (error) { return { ok: false, code: error instanceof Error ? error.message : 'UNKNOWN' }; }
}
function success<T>(value: Settled<T>): T {
  assert.equal(value.ok, true, JSON.stringify(value));
  if (!value.ok) throw new Error('C02_EXPECTED_SUCCESS');
  return value.value;
}

export async function runAssignmentSemanticConcurrency(database: Kysely<DB>, f: SemanticFixture,
  app: SemanticAppFactory, command: SemanticCommandFactory, check: SemanticCheck) {
  async function gate(lock: (tx: Transaction<DB>) => Promise<unknown>) {
    let release!: () => void, entered!: (pid: number) => void, failed!: (error: unknown) => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const acquired = new Promise<number>((resolve, reject) => { entered = resolve; failed = reject; });
    const completed = database.transaction().execute(async tx => {
      await lock(tx);
      entered((await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid);
      await released;
    });
    void completed.catch(failed);
    return { pid: await acquired, async close() { release(); await completed; } };
  }
  async function blockedBy(pid: number, count = 1) {
    const start = performance.now();
    while (performance.now() - start < 15000) {
      const rows = (await sql<{ pid: number; wait_event: string; blockers: number[] }>`
        select pid,wait_event,pg_blocking_pids(pid) as blockers from pg_stat_activity
        where datname=current_database() and cardinality(pg_blocking_pids(pid))>0 order by pid`.execute(database)).rows;
      const chain = new Set([pid]);
      for (let depth = 0; depth < rows.length; depth++)
        for (const row of rows) if (row.blockers.some(blocker => chain.has(blocker))) chain.add(row.pid);
      const descendants = rows.filter(row => row.pid !== pid && chain.has(row.pid));
      if (descendants.length >= count) return descendants;
      await delay(10);
    }
    throw new Error('C02_EXPECTED_LOCK_WAIT_NOT_OBSERVED');
  }
  const engagementGate = (id: string) => gate(tx => tx.selectFrom('person_master.engagement').select('engagement_id')
    .where('engagement_id', '=', id).forUpdate().execute());
  async function ordered<T, U>(engagementId: string, first: () => Promise<T>, second: () => Promise<U>) {
    const held = await engagementGate(engagementId);
    const a = settle(first());
    let b: Promise<Settled<U>> | undefined, waits;
    try { await blockedBy(held.pid); b = settle(second()); waits = await blockedBy(held.pid, 2); }
    finally { await held.close(); }
    assert.ok(b);
    return { first: await a, second: await b, waits };
  }
  const resolve = (engagementId: string) => f.now().then(recordAsOf => app().resolvePrimaryAffiliation({ ...assignmentScope,
    engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION', scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt: Jul, recordAsOf }));

  await check(['TX-03'], 'two READ COMMITTED primary creates visibly wait; exactly one commits', async () => {
    const e = await f.createEngagement(), firstId = randomUUID(), secondId = randomUUID();
    const result = await ordered(e.engagementId, () => app(firstId).createClassifiedAssignment(command(e.engagementId)),
      () => app(secondId).createClassifiedAssignment(command(e.engagementId)));
    const winning = success(result.first);
    assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
    const versions = await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
      .where('engagement_id', '=', e.engagementId).execute();
    assert.deepEqual(versions.map(v => v.assignment_version_id), [winning.coreVersion.assignmentVersionId]);
    const outcomes = await database.selectFrom('person_master.assignment_command_outcome').select(['request_id', 'rejection_code'])
      .where('request_id', 'in', [firstId, secondId]).execute();
    assert.equal(outcomes.length, 2);
    assert.equal(outcomes.filter(o => o.rejection_code !== null).length, 1);
    return { ...result, outcomes, persistedVersions: versions.length };
  });

  await check(['TX-04'], 'two raw adoptions serialize and both refuse unresolved other raw facts', async () => {
    const e = await f.createEngagement();
    const { purposeCode, modeCode, ...raw } = command(e.engagementId);
    const a = await f.app().createAssignment(raw), b = await f.app().createAssignment(raw);
    const adoption = (v: typeof a) => ({ ...assignmentScope, assignmentId: v.assignmentId,
      expectedCurrentVersionId: v.assignmentVersionId, purposeCode, modeCode });
    const result = await ordered(e.engagementId, () => app().adoptAssignmentSemantics(adoption(a)),
      () => app().adoptAssignmentSemantics(adoption(b)));
    assert.deepEqual(result.first, { ok: false, code: 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' });
    assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' });
    assert.equal((await database.selectFrom('person_master.assignment_version').select('assignment_version_id')
      .where('engagement_id', '=', e.engagementId).execute()).length, 2);
    await app().adoptAssignmentSemantics({ ...adoption(a), modeCode: 'STANDING_CONCURRENT' });
    await app().adoptAssignmentSemantics(adoption(b));
    assert.equal((await resolve(e.engagementId)).resolution, 'UNIQUE');
    return result;
  });

  await check(['TX-05'], 'period extension and later primary cannot write skew in either queue order', async () => {
    const observations = [];
    for (const extensionFirst of [true, false]) {
      const e = await f.createEngagement();
      const created = await app().createClassifiedAssignment(command(e.engagementId, { businessValidTo: Aug }));
      const extend = () => app().reviseClassifiedAssignmentPeriod({ ...assignmentScope, assignmentId: created.coreVersion.assignmentId,
        expectedCurrentVersionId: created.coreVersion.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Dec, reasonCode: 'CONTINUATION_EXTENSION' });
      const create = () => app().createClassifiedAssignment(command(e.engagementId, { businessValidFrom: Aug }));
      const result = extensionFirst ? await ordered(e.engagementId, extend, create) : await ordered(e.engagementId, create, extend);
      success(result.first);
      assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
      observations.push({ extensionFirst, ...result });
    }
    const e = await f.createEngagement();
    const created = await app().createClassifiedAssignment(command(e.engagementId));
    const revise = () => app().reviseClassifiedAssignmentPeriod({ ...assignmentScope, assignmentId: created.coreVersion.assignmentId,
      expectedCurrentVersionId: created.coreVersion.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' });
    const result = await ordered(e.engagementId, revise, revise);
    success(result.first); assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_STALE_VERSION' });
    return { observations, sameExpected: result };
  });

  await check(['TX-06'], 'mode and purpose corrections share the same fence as new primary creation', async () => {
    const observations = [];
    for (const initialMode of ['STANDING_CONCURRENT', 'PRIMARY_AFFILIATION'] as const) {
      const e = await f.createEngagement();
      const created = await app().createClassifiedAssignment(command(e.engagementId, { modeCode: initialMode }));
      const result = await ordered(e.engagementId, () => app().correctAssignmentSemantics({ ...assignmentScope,
        assignmentId: created.coreVersion.assignmentId, expectedCurrentVersionId: created.coreVersion.assignmentVersionId,
        purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: initialMode === 'PRIMARY_AFFILIATION' ? 'STANDING_CONCURRENT' : 'PRIMARY_AFFILIATION',
        reasonCode: 'MODE_CORRECTION' }), () => app().createClassifiedAssignment(command(e.engagementId)));
      success(result.first);
      if (initialMode === 'PRIMARY_AFFILIATION') success(result.second);
      else assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
      observations.push({ initialMode, ...result });
    }
    const e = await f.createEngagement();
    const created = await app().createClassifiedAssignment(command(e.engagementId, { purposeCode: 'CLINICAL_PRACTICE' }));
    const result = await ordered(e.engagementId, () => app().correctAssignmentSemantics({ ...assignmentScope,
      assignmentId: created.coreVersion.assignmentId, expectedCurrentVersionId: created.coreVersion.assignmentVersionId,
      purposeCode: 'ORGANIZATIONAL_AFFILIATION', modeCode: 'PRIMARY_AFFILIATION', reasonCode: 'PURPOSE_CORRECTION' }),
    () => app().createClassifiedAssignment(command(e.engagementId)));
    success(result.first); assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
    return { observations, purposeCorrection: result };
  });

  await check(['TX-07'], 'raw create versus primary preserves completeness in both actual queue orders', async () => {
    const observations = [];
    for (const rawFirst of [true, false]) {
      const e = await f.createEngagement();
      const c = command(e.engagementId), { purposeCode, modeCode, ...raw } = c; void purposeCode; void modeCode;
      const createRaw = () => f.app().createAssignment(raw), createPrimary = () => app().createClassifiedAssignment(c);
      if (rawFirst) {
        const result = await ordered(e.engagementId, createRaw, createPrimary);
        success(result.first); assert.deepEqual(result.second, { ok: false, code: 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' });
        observations.push({ rawFirst, ...result });
      } else {
        const result = await ordered(e.engagementId, createPrimary, createRaw);
        success(result.first); success(result.second); observations.push({ rawFirst, ...result });
      }
      assert.equal((await resolve(e.engagementId)).resolution, 'UNKNOWN');
    }
    return observations;
  });

  await check(['TX-08'], 'independent Engagement progresses while another Engagement is fenced', async () => {
    const a = await f.createEngagement(), b = await f.createEngagement();
    const held = await engagementGate(a.engagementId);
    const waiting = settle(app().createClassifiedAssignment(command(a.engagementId)));
    let waits, independent;
    try {
      waits = await blockedBy(held.pid);
      independent = await app().createClassifiedAssignment(command(b.engagementId));
      assert.ok(independent.coreVersion.assignmentVersionId);
    } finally { await held.close(); }
    success(await waiting);
    return { waits, independentVersion: independent!.coreVersion.assignmentVersionId };
  });

  await check(['TX-09', 'PA-12'], 'classified mutation pins upstream before end, suspension and Department publication', async () => {
    const observations = [];
    for (const operation of ['END', 'SUSPEND', 'PUBLISH'] as const) {
      const e = await f.createEngagement(), dept = await f.createDepartment(`C02-${operation}`);
      const draft = operation === 'PUBLISH' ? await f.reviseDepartment(dept.departmentId, 'SUSPENDED', 'SYNTHETIC C02 PUBLICATION', null, false) : null;
      const held = operation === 'PUBLISH'
        ? await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${assignmentScope.governanceObjectId},47))`.execute(tx))
        : await gate(tx => tx.selectFrom('department_master.department_version').select('department_version_id')
          .where('department_version_id', '=', dept.departmentVersionId).forUpdate().execute());
      const created = settle(app().createClassifiedAssignment(command(e.engagementId, { placement: { scope: 'DEPARTMENT',
        departmentGovernanceObjectId: command(e.engagementId).placement.departmentGovernanceObjectId, departmentId: dept.departmentId } })));
      let mutation: Promise<Settled<unknown>> | undefined, upstreamWait, initialWait;
      try {
        initialWait = await blockedBy(held.pid);
        mutation = settle<unknown>(operation === 'END' ? f.lifecycle().endEngagement({ ...assignmentScope, engagementId: e.engagementId,
          expectedCurrentEngagementVersionId: e.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C02_RACE' })
          : operation === 'SUSPEND' ? f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: e.engagementId,
            expectedLifecycleSequence: '0', businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C02_RACE' }) : f.publishDepartment(draft!));
        upstreamWait = await blockedBy(initialWait[0]!.pid);
      } finally { await held.close(); }
      const accepted = success(await created); assert.ok(mutation); success(await mutation);
      const assessment = await f.app().assessAssignmentDependencies({ ...assignmentScope, assignmentId: accepted.coreVersion.assignmentId,
        assignmentVersionId: accepted.coreVersion.assignmentVersionId, recordAsOf: await f.now() });
      assert.notEqual(assessment.constraintResult, 'SATISFIED');
      assert.equal((await resolve(e.engagementId)).resolution, 'UNIQUE');
      observations.push({ operation, initialWait, upstreamWait, constraintResult: assessment.constraintResult });
    }
    return observations;
  });

  await check(['TX-14'], 'concurrent RR reads close snapshots before waiting on the read audit stream', async () => {
    const e = await f.createEngagement();
    await app().createClassifiedAssignment(command(e.engagementId));
    const held = await gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${assignmentScope.governanceObjectId},47))`.execute(tx));
    const a = settle(resolve(e.engagementId)), b = settle(resolve(e.engagementId));
    let waits;
    try { waits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    assert.equal(success(await a).resolution, 'UNIQUE'); assert.equal(success(await b).resolution, 'UNIQUE');
    return { waits, bothReadAuditsCommitted: true };
  });
}
