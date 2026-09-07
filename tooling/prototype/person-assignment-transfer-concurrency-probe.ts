import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Kysely, PostgresDialect, sql, type Driver, type Transaction } from 'kysely';
import { Pool } from 'pg';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentTransferApplication } from '../../apps/governance-api/src/composition/create-assignment-transfer-application.js';
import { assertTransferUnchanged } from './person-assignment-transfer-behavior-probe.js';
import { Jan, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import type { TransferFixture, TransferCheck } from './person-assignment-transfer-fixture.js';

type Settled<T> = { ok: true; value: T } | { ok: false; code: string; sqlState: string | null };
async function settle<T>(work: Promise<T>): Promise<Settled<T>> {
  try { return { ok: true, value: await work }; }
  catch (error) { return { ok: false, code: error instanceof Error ? error.message : 'UNKNOWN',
    sqlState: error && typeof error === 'object' && 'code' in error ? String(error.code) : null }; }
}
function success<T>(value: Settled<T>): T { assert.ok(value.ok, JSON.stringify(value)); return value.value; }
function refusal(value: Settled<unknown>, code: string) { assert.ok(!value.ok); assert.equal(value.code, code); }

export async function runAssignmentTransferConcurrency(database: Kysely<DB>, f: TransferFixture, check: TransferCheck) {
  const current = (await sql<{ name: string; oid: string; owner: string }>`select datname as name, oid::text as oid,
    pg_get_userbyid(datdba) as owner from pg_database where datname=current_database()`.execute(database)).rows[0]!;
  const retained = current.name === 'hdi_prototype';
  if (!retained) {
    const receiptPath = process.env['C0302_FRESH_OWNERSHIP_RECEIPT'];
    assert.ok(receiptPath, 'C0302_FRESH_OWNERSHIP_REQUIRED');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    assert.equal(receipt.task, 'PV-006-C-03-02'); assert.equal(receipt.mode, 'FRESH_INSTALL');
    assert.equal(receipt.databaseName, `pv006_c0302_${receipt.runId.replaceAll('-', '')}`);
    assert.equal(receipt.databaseName, current.name); assert.deepEqual(receipt.identity, { oid: current.oid, owner: current.owner, name: current.name });
    assert.equal(current.owner, 'hdi_prototype'); assert.equal(receipt.sourceDatabase, 'hdi_prototype');
    assert.equal(receipt.createdByPeerRole, 'postgres');
    const endpoint = new URL(process.env['DATABASE_URL']!);
    assert.deepEqual(receipt.endpoint, { host: endpoint.hostname, port: endpoint.port, role: decodeURIComponent(endpoint.username) });
    assert.equal(endpoint.pathname, `/${current.name}`);
  }
  const definitionRows = () => database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
    .where('governance_object_id', '=', f.scope.governanceObjectId).orderBy('term_version_id').execute();
  const definitionsBefore = await definitionRows();
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
      const rows = (await sql<{ pid: number; wait_event: string; blockers: number[] }>`select pid,wait_event,pg_blocking_pids(pid) as blockers
        from pg_stat_activity where datname=current_database() and application_name='hdi-pv006-c0302-application'
          and cardinality(pg_blocking_pids(pid))>0 order by pid`.execute(database)).rows;
      const chain = new Set([pid]);
      for (let depth = 0; depth < rows.length; depth++) for (const row of rows) if (row.blockers.some(blocker => chain.has(blocker))) chain.add(row.pid);
      const descendants = rows.filter(row => row.pid !== pid && chain.has(row.pid));
      if (descendants.length >= count) return descendants;
      await delay(10);
    }
    throw new Error('C0302_EXPECTED_LOCK_QUEUE_NOT_OBSERVED');
  }
  const engagementGate = (id: string) => gate(tx => tx.selectFrom('person_master.engagement').select('engagement_id').where('engagement_id', '=', id).forUpdate().execute());
  const auditGate = () => gate(tx => sql`select pg_advisory_xact_lock(hashtextextended(${f.scope.governanceObjectId},47))`.execute(tx));
  async function ordered<T, U>(engagementId: string, first: () => Promise<T>, second: () => Promise<U>) {
    const held = await engagementGate(engagementId), a = settle(first());
    let b: Promise<Settled<U>> | undefined, waits;
    try { await blockedBy(held.pid); b = settle(second()); waits = await blockedBy(held.pid, 2); }
    finally { await held.close(); }
    assert.ok(b); return { first: await a, second: await b, waits };
  }
  async function bounded<T>(work: Promise<T>) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('C0302_INDEPENDENT_PROGRESS_TIMEOUT')), 15000); })]); }
    finally { clearTimeout(timer); }
  }
  const source = async () => {
    const e = await f.createEngagement(), s = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId))).coreVersion;
    return { e, s };
  };
  await check(['CC-01'], 'Two transfer writers visibly serialize at source/Engagement and create exactly one target', async () => {
    const { e, s } = await source();
    const result = await ordered(e.engagementId, () => f.transfer().transferAssignment(f.transferCommand(s)),
      () => f.transfer().transferAssignment(f.transferCommand(s, { effectiveAt: Dec })));
    const first = success(result.first); refusal(result.second, 'ASSIGNMENT_ALREADY_CLOSED');
    assert.equal((await database.selectFrom('person_master.assignment').select('assignment_id').where('engagement_id', '=', e.engagementId).execute()).length, 2);
    assert.equal((await database.selectFrom('person_master.assignment_transfer').select('transfer_id').where('source_assignment_id', '=', s.assignmentId).execute()).length, 1);
    return { ...result, target: first.targetAssignmentId };
  });
  await check(['CC-02', 'CC-03'], 'END, classified period revision and semantic correction compete with transfer in both controlled orders', async () => {
    const observations = [];
    for (const operation of ['END', 'REVISE', 'CORRECT'] as const) for (const transferFirst of [true, false]) {
      const { e, s } = await source();
      const transfer = () => f.transfer().transferAssignment(f.transferCommand(s));
      const other = async () => {
        if (operation === 'END') return f.closure().endAssignment(f.endCommand(s, Aug));
        if (operation === 'REVISE') return (await f.semantics().reviseClassifiedAssignmentPeriod({ ...f.scope, assignmentId: s.assignmentId,
          expectedCurrentVersionId: s.assignmentVersionId, businessValidFrom: Jan, businessValidTo: Dec, reasonCode: 'VALIDITY_CORRECTION' })).coreVersion;
        return (await f.semantics().correctAssignmentSemantics({ ...f.scope, assignmentId: s.assignmentId, expectedCurrentVersionId: s.assignmentVersionId,
          purposeCode: 'CLINICAL_PRACTICE', modeCode: 'PRIMARY_AFFILIATION', reasonCode: 'PURPOSE_CORRECTION' })).coreVersion;
      };
      const result = transferFirst ? await ordered(e.engagementId, transfer, other) : await ordered(e.engagementId, other, transfer);
      assert.ok(result.first.ok); refusal(result.second, transferFirst || operation === 'END' ? 'ASSIGNMENT_ALREADY_CLOSED' : 'ASSIGNMENT_STALE_VERSION');
      observations.push({ operation, transferFirst, ...result });
    }
    return observations;
  });
  await check(['CC-04'], 'A competing PRIMARY create sees either the old source or committed target under the same Engagement fence', async () => {
    const observations = [];
    for (const transferFirst of [true, false]) {
      const { e, s } = await source();
      const transfer = () => f.transfer().transferAssignment(f.transferCommand(s));
      const competing = () => f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { businessValidFrom: Aug }));
      if (transferFirst) {
        const result = await ordered(e.engagementId, transfer, competing); success(result.first); refusal(result.second, 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT');
        observations.push({ transferFirst, ...result });
      } else {
        const result = await ordered(e.engagementId, competing, transfer); refusal(result.first, 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT'); success(result.second);
        observations.push({ transferFirst, ...result });
      }
    }
    return observations;
  });
  await check(['CC-05'], 'Engagement end and suspension have complete old/new authority in both queue orders and never auto-migrate assignments', async () => {
    const observations = [];
    for (const operation of ['END', 'SUSPEND'] as const) for (const transferFirst of [true, false]) {
      const { e, s } = await source();
      const transfer = () => f.transfer().transferAssignment(f.transferCommand(s));
      const upstream = async () => operation === 'END'
        ? f.lifecycle().endEngagement({ ...f.scope, engagementId: e.engagementId, expectedCurrentEngagementVersionId: e.engagementVersionId,
          businessEffectiveAt: Jul, reasonCode: 'SYNTHETIC_C0302_END_RACE' })
        : f.lifecycle().suspendEngagement({ ...f.scope, engagementId: e.engagementId, expectedLifecycleSequence: '0',
          businessEffectiveAt: Jul, reasonCode: 'SYNTHETIC_C0302_SUSPEND_RACE' });
      if (transferFirst) {
        const result = await ordered(e.engagementId, transfer, upstream); const completed = success(result.first); success(result.second);
        assert.deepEqual(await f.transfer().getAssignmentTransfer({ ...f.scope, transferId: completed.transferId }), completed);
        observations.push({ operation, transferFirst, ...result });
      } else {
        const result = await ordered(e.engagementId, upstream, transfer); success(result.first);
        refusal(result.second, operation === 'END' ? 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' : 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED');
        observations.push({ operation, transferFirst, ...result });
      }
    }
    return observations;
  });
  await check(['CC-06'], 'Target publication fence yields old evidence or a bounded same-root retry after a real publication switch', async () => {
    const observations = [];
    for (const transferFirst of [true, false]) {
      const { e, s } = await source(), d = await f.createDepartment(`C0302-PUBLISH-${transferFirst}`);
      const draft = await f.reviseDepartment(d.departmentId, 'ACTIVE', 'SYNTHETIC C0302 NEW PUBLICATION', null, false);
      const root = randomUUID(), command = f.transferCommand(s, { targetPlacement: { scope: 'DEPARTMENT',
        departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: d.departmentId } });
      if (transferFirst) {
        const held = await auditGate(), transferring = settle(f.transfer(root).transferAssignment(command));
        let publishing, waits;
        try { await blockedBy(held.pid); publishing = settle(f.publishDepartment(draft)); waits = await blockedBy(held.pid, 2); }
        finally { await held.close(); }
        assert.ok(publishing); const completed = success(await transferring); success(await publishing);
        assert.equal(completed.targetAdmission.acceptanceEvidence.department.departmentVersionId, d.departmentVersionId);
        observations.push({ transferFirst, waits, transferId: completed.transferId, selected: d.departmentVersionId });
      } else {
        const held = await gate(tx => tx.selectFrom('department_master.department_version').select('department_version_id')
          .where('department_version_id', '=', d.departmentVersionId).forUpdate().execute());
        const publishing = settle(f.publishDepartment(draft)); let transferring, waits;
        try { await blockedBy(held.pid); transferring = settle(f.transfer(root).transferAssignment(command)); waits = await blockedBy(held.pid, 2); }
        finally { await held.close(); }
        success(await publishing); assert.ok(transferring); const first = await transferring;
        let completed;
        if (!first.ok) {
          assert.equal(first.code, 'DEPENDENCY_CHANGED_DURING_VALIDATION');
          await assertTransferUnchanged(database, f, s, root, 1, false);
          completed = await f.transfer(root).transferAssignment(command);
        } else completed = first.value;
        assert.equal(completed.targetAdmission.acceptanceEvidence.department.departmentVersionId, draft.departmentVersionId);
        assert.ok(completed.transferRecordedFrom >= completed.targetAdmission.acceptanceEvidence.department.publishedAt);
        observations.push({ transferFirst, waits, first, transferId: completed.transferId, selected: draft.departmentVersionId });
      }
      void e;
    }
    return observations;
  });
  if (retained) await check(['CC-06'], 'Definition mutation is restricted to receipt-owned fresh databases', async () =>
    ({ database: current.name, reason: 'Shared retained definition authority must remain unchanged; use fresh CC-06 evidence' }), 'SKIPPED_BY_SCOPE');
  else await check(['CC-06'], 'Definition updates and transfer share stable ordered fences and freeze a complete old or new version', async () => {
    const observations = [];
    for (const transferFirst of [true, false]) {
      const { s } = await source();
      const term = await f.semantics().findAssignmentSemanticTermAsOf({ ...f.scope, dimension: 'PURPOSE', code: 'ORGANIZATIONAL_AFFILIATION', recordAsOf: await f.now() });
      assert.ok(term);
      const append = () => f.semantics().appendAssignmentSemanticTermVersion({ ...f.scope, termId: term.termId, expectedCurrentVersionId: term.termVersionId,
        label: 'SYNTHETIC C0302 DEFINITION RACE', definitionState: 'ENABLED', businessValidFrom: Jan, businessValidTo: null, reasonCode: 'LABEL_CORRECTION' });
      if (transferFirst) {
        const held = await auditGate(), transferring = settle(f.transfer().transferAssignment(f.transferCommand(s))); let updating, waits;
        try { await blockedBy(held.pid); updating = settle(append()); waits = await blockedBy(held.pid, 2); }
        finally { await held.close(); }
        assert.ok(updating); const result = success(await transferring), updated = success(await updating);
        assert.equal(result.targetSemantics.purpose.termVersionId, term.termVersionId);
        assert.notEqual(updated.termVersionId, term.termVersionId); observations.push({ transferFirst, waits, result: result.transferId, definition: updated.termVersionId });
      } else {
        const held = await gate(tx => tx.selectFrom('person_master.assignment_semantic_term').select('term_id').where('term_id', '=', term.termId).forUpdate().execute());
        const updating = settle(append()); let transferring, waits;
        try { await blockedBy(held.pid); transferring = settle(f.transfer().transferAssignment(f.transferCommand(s))); waits = await blockedBy(held.pid, 2); }
        finally { await held.close(); }
        const updated = success(await updating); assert.ok(transferring); const result = success(await transferring);
        assert.equal(result.targetSemantics.purpose.termVersionId, updated.termVersionId);
        assert.ok(result.transferRecordedFrom >= updated.recordedFrom); observations.push({ transferFirst, waits, result: result.transferId, definition: updated.termVersionId });
      }
    }
    return observations;
  });
  await check(['CC-08'], 'Unrelated Engagement progresses while another transfer waits; a real deadlock victim leaves no permanent root', async () => {
    const first = await source(), independent = await source(), held = await engagementGate(first.e.engagementId);
    const waiting = settle(f.transfer().transferAssignment(f.transferCommand(first.s))); let waits, separate;
    try { waits = await blockedBy(held.pid); separate = await bounded(f.transfer().transferAssignment(f.transferCommand(independent.s))); }
    finally { await held.close(); }
    success(await waiting); assert.ok(separate);
    const attempts = []; let transferVictim = false;
    for (let trial = 0; trial < 3 && !transferVictim; trial++) {
      const { e, s } = await source(), root = randomUUID();
      let entered!: (pid: number) => void, failed!: (error: unknown) => void, startCycle!: () => void;
      const ready = new Promise<number>((resolve, reject) => { entered = resolve; failed = reject; });
      const cycle = new Promise<void>(resolve => { startCycle = resolve; });
      const lockOnly = database.transaction().execute(async tx => {
        await tx.selectFrom('person_master.engagement').select('engagement_id').where('engagement_id', '=', e.engagementId).forUpdate().execute();
        entered((await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(tx)).rows[0]!.pid); await cycle;
        await tx.selectFrom('person_master.assignment').select('assignment_id').where('assignment_id', '=', s.assignmentId).forUpdate().execute();
        return 'LOCK_ONLY';
      });
      void lockOnly.catch(failed); const locked = settle(lockOnly), pid = await ready;
      const transfer = settle(f.transfer(root).transferAssignment(f.transferCommand(s))); let queue;
      try { queue = await blockedBy(pid); } finally { startCycle(); }
      const [a, b] = await Promise.all([transfer, locked]);
      assert.equal([a, b].filter(result => !result.ok && result.sqlState === '40P01').length, 1);
      if (!a.ok) {
        assert.equal(a.sqlState, '40P01'); transferVictim = true;
        await assertTransferUnchanged(database, f, s, root, 1, false);
        const retried = await f.transfer(root).transferAssignment(f.transferCommand(s));
        assert.deepEqual(await f.transfer(root).transferAssignment(f.transferCommand(s)), retried);
      }
      attempts.push({ queue, transfer: a, lockOnly: b });
    }
    assert.equal(transferVictim, true, 'REAL_TRANSFER_DEADLOCK_ROLLBACK_NOT_OBSERVED');
    return { independentWaits: waits, independentTransfer: separate.transferId, attempts, transferVictim, maximumAttempts: 3 };
  });
  await check(['RQ-09'], 'Terminating the isolated backend after source write but before COMMIT leaves no half-pair or permanent refusal', async () => {
    const { s } = await source(), root = randomUUID(), command = f.transferCommand(s), transportErrors: string[] = [];
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1, application_name: 'hdi-pv006-c0302-application' });
    pool.on('connect', client => client.on('error', error => transportErrors.push(error.message)));
    pool.on('error', error => transportErrors.push(error.message));
    const isolated = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
    try {
      const ownedPid = (await sql<{ pid: number }>`select pg_backend_pid() as pid`.execute(isolated)).rows[0]!.pid;
      const held = await auditGate(), transferring = settle(createAssignmentTransferApplication(isolated, f.context(f.actor, root)).transferAssignment(command)); let waits;
      try {
        waits = await blockedBy(held.pid); assert.equal(waits.length, 1); assert.equal(waits[0]!.pid, ownedPid);
        const terminated = (await sql<{ terminated: boolean }>`select pg_terminate_backend(pid) as terminated from pg_stat_activity
          where pid=${ownedPid} and application_name='hdi-pv006-c0302-application' and datname=current_database()
            and usename=current_user and ${held.pid}=any(pg_blocking_pids(pid))`.execute(database)).rows;
        assert.deepEqual(terminated, [{ terminated: true }]);
      } finally { await held.close(); }
      const lost = await transferring; assert.ok(!lost.ok);
      assert.ok(lost.sqlState === '57P01' || /connection.*(?:terminated|error)|not queryable/iu.test(lost.code));
      const rollback = await assertTransferUnchanged(database, f, s, root, 1, false);
      const retried = await f.transfer(root).transferAssignment(command);
      return { waits, lost, transportErrors, rollback, retryTransfer: retried.transferId, isolatedPool: true };
    } finally { await isolated.destroy(); }
  });
  await check(['RQ-10'], 'Real COMMIT acknowledgement followed by a test-local response loss is recovered by querying the same root', async () => {
    const { s } = await source(), root = randomUUID(), command = f.transferCommand(s); let commitAcknowledged = false;
    class LostResponseDialect extends PostgresDialect {
      override createDriver(): Driver {
        const actual = super.createDriver();
        return { init: options => actual.init(options), acquireConnection: options => actual.acquireConnection(options),
          beginTransaction: (connection, settings) => actual.beginTransaction(connection, settings),
          async commitTransaction(connection) { await actual.commitTransaction(connection); commitAcknowledged = true; throw new Error('C0302_COMMIT_ACK_RESPONSE_LOST'); },
          rollbackTransaction: connection => actual.rollbackTransaction(connection), releaseConnection: (connection, options) => actual.releaseConnection(connection, options),
          destroy: options => actual.destroy(options) };
      }
    }
    const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1, application_name: 'hdi-pv006-c0302-lost-response' });
    const isolated = new Kysely<DB>({ dialect: new LostResponseDialect({ pool }) });
    try { await assert.rejects(createAssignmentTransferApplication(isolated, f.context(f.actor, root)).transferAssignment(command), { message: 'C0302_COMMIT_ACK_RESPONSE_LOST' }); }
    finally { await isolated.destroy(); }
    assert.equal(commitAcknowledged, true);
    const outcome = await database.selectFrom('person_master.assignment_command_outcome').selectAll().where('request_id', '=', root).executeTakeFirstOrThrow();
    assert.ok(outcome.transfer_id); assert.equal(outcome.rejection_code, null);
    const recovered = await f.transfer(root).transferAssignment(command);
    assert.equal(recovered.transferId, outcome.transfer_id);
    assert.equal((await database.selectFrom('person_master.assignment_transfer').select('transfer_id').where('root_request_id', '=', root).execute()).length, 1);
    assert.equal((await database.selectFrom('person_master.assignment').select('assignment_id').where('creation_request_id', '=', recovered.targetRequestId).execute()).length, 1);
    return { commitAcknowledged, simulatedResponseLossAfterRealAck: true, root, recoveredTransfer: recovered.transferId, exactTarget: recovered.targetAssignmentId };
  });
  await check(['CC-10'], 'Concurrent RR receipt readers close snapshots before contending on their read-audit stream', async () => {
    const { s } = await source(), value = await f.transfer().transferAssignment(f.transferCommand(s)), held = await auditGate();
    const a = settle(f.transfer().getAssignmentTransfer({ ...f.scope, transferId: value.transferId }));
    const b = settle(f.transfer().getAssignmentTransfer({ ...f.scope, transferId: value.transferId })); let waits;
    try { waits = await blockedBy(held.pid, 2); } finally { await held.close(); }
    assert.deepEqual(success(await a), value); assert.deepEqual(success(await b), value); return { waits, consistentReads: 2 };
  });
  if (retained) assert.deepEqual(await definitionRows(), definitionsBefore, 'C0302_SHARED_DEFINITION_CHANGED');
}
