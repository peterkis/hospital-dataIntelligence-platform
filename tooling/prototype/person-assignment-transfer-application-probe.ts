import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentTransferFixture, type TransferCheck } from './person-assignment-transfer-fixture.js';
import { Jan, Aug, Dec } from './person-assignment-fixture.js';
import { runAssignmentTransferBehavior } from './person-assignment-transfer-behavior-probe.js';
import { runAssignmentTransferHistory } from './person-assignment-transfer-history-probe.js';
import { runAssignmentTransferRequests } from './person-assignment-transfer-request-probe.js';
import { runAssignmentTransferSql } from './person-assignment-transfer-sql-probe.js';
import { runAssignmentTransferConcurrency } from './person-assignment-transfer-concurrency-probe.js';
import { prepareAssignmentTransferRecovery } from './person-assignment-transfer-recovery-support.js';
import { assignmentSemanticDatabaseIdentity } from './person-assignment-semantics-recovery-support.js';
import { runAssignmentTransferScope } from './person-assignment-transfer-scope-probe.js';

assert.ok(process.env['DATABASE_URL'], 'MANAGED_DATABASE_REQUIRED');
const endpoint = new URL(process.env['DATABASE_URL']);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434');
const mode = process.argv[2] ?? 'APPLICATION';
assert.ok(process.argv.length === 2 || (process.argv.length === 3 && ['--sql-probe', '--history-probe', '--request-probe', '--concurrency-probe', '--scope-probe', '--prepare-recovery'].includes(mode)), 'C0302_APPLICATION_MODE_INVALID');
process.env['NODE_ENV'] = 'test';
const runId = randomUUID(), directory = `.runtime/pv006-c0302/${runId}`;
await mkdir(directory, { recursive: true });
console.log(JSON.stringify({ task: 'PV-006-C-03-02', runId, mode, directory }));
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 12, application_name: 'hdi-pv006-c0302-application' });
const cases: { ids: string[]; name: string; status: string; evidence?: unknown }[] = [];
let failure: unknown;
let identity: Awaited<ReturnType<typeof assignmentSemanticDatabaseIdentity>> | undefined;
const check: TransferCheck = async (ids, name, work, status) => {
  console.log(JSON.stringify({ caseStarted: ids, name }));
  try { cases.push({ ids, name, status: status ?? 'PASS', evidence: await work() }); }
  catch (error) { cases.push({ ids, name, status: 'FAILED' }); throw error; }
  finally { await writeFile(`${directory}/case-${String(cases.length).padStart(2, '0')}.json`, JSON.stringify(cases.at(-1), null, 2), { flag: 'wx' }); }
};
try {
  const db = handle.database;
  identity = await assignmentSemanticDatabaseIdentity(db);
  assert.match(identity.database, /^(hdi_prototype|pv006_c0(?:302|4)_[a-f0-9]{32})$/u);
  if (identity.database.startsWith('pv006_c04_')) await (await import('./person-assignment-temporary-fixture-guard.js')).requireTemporaryFixtureTarget(db, 'SHARED_DEFINITION_MUTATION');
  assert.equal(identity.role, 'hdi_prototype'); assert.equal(identity.migrations, 39);
  const f = await createAssignmentTransferFixture(db, runId);
  const definitionRows = () => db.selectFrom('person_master.assignment_semantic_term_version').selectAll()
    .where('governance_object_id', '=', f.scope.governanceObjectId).orderBy('term_version_id').execute();
  const definitionsBefore = await definitionRows();
  if (mode === 'APPLICATION') await check(['TX-01', 'PC-01', 'RQ-01', 'BT-01'], 'Real finite PRIMARY transfer commits exact pair with one database knowledge time', async () => {
    const e = await f.createEngagement();
    const source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { businessValidTo: Dec }));
    const root = randomUUID(), command = f.transferCommand(source.coreVersion), app = f.transfer(root);
    const result = await app.transferAssignment(command);
    assert.equal(result.sourceClosure.recordKind, 'CLOSURE');
    assert.deepEqual(result.sourceOriginalPeriod, { from: Jan, to: Dec });
    assert.deepEqual(result.sourceClosedPeriod, { from: Jan, to: Aug });
    assert.deepEqual(result.targetPeriod, { from: Aug, to: Dec });
    assert.equal(result.sourceClosure.recordedFrom, result.transferRecordedFrom);
    assert.equal(result.targetAdmission.recordedFrom, result.transferRecordedFrom);
    assert.equal(result.targetSemantics.semanticRecordedFrom, result.transferRecordedFrom);
    assert.equal(result.targetAdmission.acceptanceEvidence.evaluationRecordAsOf, result.transferRecordedFrom);
    const identity = await f.app().getAssignment({ ...f.scope, assignmentId: result.targetAssignmentId });
    assert.equal(identity.createdAt, result.transferRecordedFrom);
    assert.equal(identity.personId, source.coreVersion.acceptanceEvidence.engagement.personId);
    assert.equal(identity.engagementId, e.engagementId);
    assert.equal(identity.placement.departmentId, f.target.departmentId);
    const auditBefore = (await sql<{ count: string }>`select count(*)::text as count from audit.audit_event
      where request_id in (${result.rootRequestId},${result.sourceRequestId},${result.targetRequestId})`.execute(db)).rows[0]!.count;
    assert.deepEqual(await app.transferAssignment(command), result);
    const auditAfter = (await sql<{ count: string }>`select count(*)::text as count from audit.audit_event
      where request_id in (${result.rootRequestId},${result.sourceRequestId},${result.targetRequestId})`.execute(db)).rows[0]!.count;
    assert.equal(auditAfter, auditBefore);
    assert.deepEqual(await f.transfer().getAssignmentTransfer({ ...f.scope, transferId: result.transferId }), result);
    for (const [businessAt, selected] of [[Jan, result.sourceClosureVersionId], [Aug, result.targetAdmissionVersionId], [Dec, null]] as const) {
      const primary = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: e.engagementId,
        purposeCode: 'ORGANIZATIONAL_AFFILIATION', scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt, recordAsOf: result.transferRecordedFrom });
      assert.equal(primary.selectedAssignmentVersionId, selected);
    }
    return { command, source, result, auditCount: auditAfter };
  });
  if (mode === 'APPLICATION') await runAssignmentTransferBehavior(db, f, check);
  if (mode === 'APPLICATION' || mode === '--request-probe') await runAssignmentTransferRequests(db, f, check);
  if (mode === 'APPLICATION' || mode === '--history-probe') await runAssignmentTransferHistory(db, f, check);
  if (mode === 'APPLICATION' || mode === '--sql-probe') await runAssignmentTransferSql(db, f, check);
  if (mode === 'APPLICATION' || mode === '--concurrency-probe') await runAssignmentTransferConcurrency(db, f, check);
  if (mode === 'APPLICATION' || mode === '--scope-probe') await runAssignmentTransferScope(db, f, check);
  if (mode === 'APPLICATION' || mode === '--prepare-recovery') {
    const recovery = await prepareAssignmentTransferRecovery(db, f, runId);
    await writeFile(`${directory}/recovery.json`, JSON.stringify(recovery, null, 2), { flag: 'wx' });
  }
  if (identity.database === 'hdi_prototype') {
    assert.deepEqual(await definitionRows(), definitionsBefore, 'C0302_RETAINED_SHARED_DEFINITION_CHANGED');
    await writeFile(`${directory}/definition-preservation.json`, JSON.stringify({ status: 'PASS',
      sharedDefinitionRows: definitionsBefore.length, unchanged: true }), { flag: 'wx' });
  }
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  await handle.close();
  const error = failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]') : null;
  await writeFile(`${directory}/application.json`, JSON.stringify({ task: 'PV-006-C-03-02', runId, mode, identity, cases,
    error, status: failure ? 'FAILED' : 'PASS', argv: process.argv.slice(1), cwd: process.cwd(), poolClosed: true }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-03-02', runId, status: failure ? 'FAILED' : 'PASS', cases: cases.length, error, poolClosed: true, directory }));
}
