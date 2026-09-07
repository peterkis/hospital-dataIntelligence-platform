import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { createAssignmentClosureApplication } from '../../apps/governance-api/src/composition/create-assignment-closure-application.js';
import { createAssignmentSemanticsApplication } from '../../apps/governance-api/src/composition/create-assignment-semantics-application.js';
import { assignmentSemanticDatabaseIdentity } from './person-assignment-semantics-recovery-support.js';
import { assignmentClosureRecoveryFingerprint, type ClosureRecoveryReceipt } from './person-assignment-closure-recovery-support.js';

const directory = `.runtime/pv006-c0301/${randomUUID()}`;
await mkdir(directory, { recursive: false });
let handle: ReturnType<typeof createDatabase> | undefined, failure: unknown, observation: unknown;
try {
  assert.deepEqual(process.argv.slice(2), ['--recover'], 'C0301_RECOVERY_MODE_REQUIRED');
  const path = process.env['ASSIGNMENT_CLOSURE_RECOVERY_RECEIPT'], expectedRunId = process.env['ASSIGNMENT_CLOSURE_RECOVERY_RUN_ID'];
  assert.ok(path, 'C0301_RECOVERY_RECEIPT_REQUIRED'); assert.ok(expectedRunId, 'C0301_RECOVERY_RUN_ID_REQUIRED');
  const original = await readFile(path), receipt: ClosureRecoveryReceipt = JSON.parse(original.toString('utf8'));
  assert.equal(receipt.task, 'PV-006-C-03-01', 'C0301_RECEIPT_TASK_INVALID'); assert.equal(receipt.mode, 'RECOVERY', 'C0301_RECEIPT_MODE_INVALID');
  assert.equal(receipt.runId, expectedRunId, 'C0301_RECEIPT_RUN_ID_INVALID');
  assert.match(receipt.runId, /^[a-f0-9-]{36}$/u, 'C0301_RECEIPT_RUN_ID_INVALID');
  assert.ok(process.env['DATABASE_URL'], 'MANAGED_DATABASE_REQUIRED');
  const endpoint = new URL(process.env['DATABASE_URL']);
  assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434'); assert.equal(endpoint.pathname, '/hdi_prototype');
  handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 4, application_name: 'hdi-pv006-c0301-recovery' });
  const current = await assignmentSemanticDatabaseIdentity(handle.database);
  for (const [key, message] of [['database', 'DATABASE'], ['oid', 'OID'], ['address', 'ENDPOINT'], ['port', 'ENDPOINT'], ['role', 'ROLE']] as const)
    assert.equal(current[key], receipt.identity[key], `C0301_RECEIPT_${message}_INVALID`);
  assert.equal(current.migrations, receipt.identity.migrations, 'C0301_RECEIPT_MIGRATIONS_INVALID');
  assert.notEqual(current.startedAt, receipt.identity.startedAt, 'C0301_POSTMASTER_NOT_RESTARTED');
  const context = () => { const requestId = randomUUID(); return { actorPrincipalId: receipt.actor, requestId, correlationId: requestId, occurredAt: '2026-09-07T12:00:00' }; };
  for (const expected of receipt.versions) {
    const actual = await createAssignmentApplication(handle.database, context()).getAssignmentVersion({ governanceObjectId: expected.governanceObjectId,
      assignmentId: expected.assignmentId, assignmentVersionId: expected.assignmentVersionId });
    assert.deepEqual(actual, expected);
    if (expected.recordKind === 'CLOSURE') assert.deepEqual(await createAssignmentClosureApplication(handle.database, context()).getAssignmentClosure({
      governanceObjectId: expected.governanceObjectId, assignmentId: expected.assignmentId, closureVersionId: expected.assignmentVersionId }), expected);
  }
  for (const snapshot of receipt.declaredReads) assert.deepEqual(await createAssignmentClosureApplication(handle.database, context()).getAssignmentDeclaredPeriodAsOf(snapshot.query), snapshot.value);
  for (const snapshot of receipt.semanticReads) assert.deepEqual(await createAssignmentSemanticsApplication(handle.database, context()).getAssignmentSemanticsAsOf(snapshot.query), snapshot.value);
  for (const snapshot of receipt.primaryReads) assert.deepEqual(await createAssignmentSemanticsApplication(handle.database, context()).resolvePrimaryAffiliation(snapshot.query), snapshot.value);
  for (const replay of receipt.endReplays) assert.deepEqual(await createAssignmentClosureApplication(handle.database, replay.context).endAssignment(replay.command), replay.value);
  for (const replay of receipt.sourceReplays) assert.deepEqual(replay.kind === 'RAW'
    ? await createAssignmentApplication(handle.database, replay.context).createAssignment(replay.command)
    : await createAssignmentSemanticsApplication(handle.database, replay.context).createClassifiedAssignment(replay.command), replay.value);
  const fingerprint = await assignmentClosureRecoveryFingerprint(handle.database, receipt.versionIds, receipt.requestIds);
  assert.deepEqual(fingerprint, receipt.fingerprint, 'C0301_RECOVERY_FACTS_CHANGED');
  assert.deepEqual(await readFile(path), original, 'C0301_RECEIPT_OVERWRITTEN');
  observation = { oldIdentity: receipt.identity, current, fingerprint, versions: receipt.versions.length,
    declaredReads: receipt.declaredReads.length, semanticReads: receipt.semanticReads.length, primaryReads: receipt.primaryReads.length,
    endReplays: receipt.endReplays.length, sourceReplays: receipt.sourceReplays.length, originalReceiptSha256: createHash('sha256').update(original).digest('hex') };
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  if (handle) await handle.close();
  const result = { task: 'PV-006-C-03-01', mode: 'RECOVERY', status: failure ? 'FAILED' : 'PASS', poolClosed: true, observation,
    error: failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]').slice(0, 600) : null,
    argv: process.argv.slice(1), cwd: process.cwd() };
  await writeFile(`${directory}/recovery-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, observation: undefined, directory }));
}
