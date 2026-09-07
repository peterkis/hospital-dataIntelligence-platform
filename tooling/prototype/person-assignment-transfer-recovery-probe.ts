import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentTransferApplication } from '../../apps/governance-api/src/composition/create-assignment-transfer-application.js';
import { createAssignmentClosureApplication } from '../../apps/governance-api/src/composition/create-assignment-closure-application.js';
import { createAssignmentSemanticsApplication } from '../../apps/governance-api/src/composition/create-assignment-semantics-application.js';
import { createAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { assignmentSemanticDatabaseIdentity } from './person-assignment-semantics-recovery-support.js';
import { assignmentTransferRecoveryFingerprint, type TransferRecoveryReceipt } from './person-assignment-transfer-recovery-support.js';
import { canonicalSha256 } from '../../apps/governance-api/src/platform/hashing/canonical-hash.js';

const directory = `.runtime/pv006-c0302/${randomUUID()}`;
await mkdir(directory, { recursive: false });
let handle: ReturnType<typeof createDatabase> | undefined, failure: unknown, observation: unknown;
try {
  assert.deepEqual(process.argv.slice(2), ['--recover'], 'C0302_RECOVERY_MODE_REQUIRED');
  const path = process.env['ASSIGNMENT_TRANSFER_RECOVERY_RECEIPT'], runId = process.env['ASSIGNMENT_TRANSFER_RECOVERY_RUN_ID'];
  assert.ok(path, 'C0302_RECOVERY_RECEIPT_REQUIRED'); assert.ok(runId, 'C0302_RECOVERY_RUN_ID_REQUIRED');
  const original = await readFile(path), receipt: TransferRecoveryReceipt = JSON.parse(original.toString('utf8'));
  assert.equal(receipt.task, 'PV-006-C-03-02', 'C0302_RECEIPT_TASK_INVALID'); assert.equal(receipt.mode, 'RECOVERY', 'C0302_RECEIPT_MODE_INVALID');
  assert.equal(receipt.runId, runId, 'C0302_RECEIPT_RUN_ID_INVALID'); assert.match(runId, /^[a-f0-9-]{36}$/u);
  assert.ok(process.env['DATABASE_URL'], 'MANAGED_DATABASE_REQUIRED');
  const endpoint = new URL(process.env['DATABASE_URL']);
  assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434'); assert.equal(endpoint.pathname, '/hdi_prototype');
  handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 4, application_name: 'hdi-pv006-c0302-recovery' });
  const db = handle.database, identity = await assignmentSemanticDatabaseIdentity(db);
  for (const key of ['database', 'oid', 'role', 'address', 'port', 'migrations'] as const)
    assert.equal(identity[key], receipt.identity[key], `C0302_RECEIPT_${key.toUpperCase()}_INVALID`);
  assert.notEqual(identity.startedAt, receipt.identity.startedAt, 'C0302_POSTMASTER_NOT_RESTARTED');
  assert.equal(receipt.transfers.length, 4, 'C0302_RECEIPT_TRANSFERS_INVALID');
  assert.deepEqual(receipt.transferIds, receipt.transfers.map(item => item.value.transferId), 'C0302_TRANSFER_REFS_INVALID');
  // Validate every source/target/root mapping and the full original fingerprint
  // before any application replay or read audit. Invalid receipts cannot create a cohort.
  for (const item of receipt.transfers) {
    assert.equal(item.command.sourceAssignmentId, item.value.sourceAssignmentId, 'C0302_SOURCE_REF_INVALID');
    assert.equal(item.command.expectedSourceVersionId, item.value.sourcePreviousVersionId, 'C0302_SOURCE_VERSION_REF_INVALID');
    assert.equal(item.context.requestId, item.value.rootRequestId, 'C0302_ROOT_REF_INVALID');
    const t = await db.selectFrom('person_master.assignment_transfer').selectAll().where('transfer_id', '=', item.value.transferId).executeTakeFirstOrThrow();
    assert.equal(t.source_assignment_id, item.value.sourceAssignmentId, 'C0302_SOURCE_REF_INVALID');
    assert.equal(t.target_assignment_id, item.value.targetAssignmentId, 'C0302_TARGET_REF_INVALID');
    assert.equal(t.source_previous_version_id, item.value.sourcePreviousVersionId, 'C0302_SOURCE_VERSION_REF_INVALID');
    assert.equal(t.source_closure_version_id, item.value.sourceClosureVersionId, 'C0302_CLOSURE_REF_INVALID');
    assert.equal(t.target_admission_version_id, item.value.targetAdmissionVersionId, 'C0302_TARGET_VERSION_REF_INVALID');
    assert.equal(t.root_request_id, item.context.requestId, 'C0302_ROOT_REF_INVALID');
    assert.equal(t.created_by, item.context.actorPrincipalId, 'C0302_ACTOR_REF_INVALID');
    assert.equal(t.governance_object_id, item.command.governanceObjectId, 'C0302_SCOPE_REF_INVALID');
  }
  for (const item of receipt.sourceReplays) {
    const v = await db.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id', '=', item.value.coreVersion.assignmentVersionId).executeTakeFirstOrThrow();
    assert.ok(receipt.versionIds.includes(v.assignment_version_id), 'C0302_SOURCE_REPLAY_REF_INVALID');
    assert.equal(v.request_id, item.context.requestId, 'C0302_SOURCE_REPLAY_ROOT_INVALID');
    assert.equal(v.created_by, item.context.actorPrincipalId, 'C0302_SOURCE_REPLAY_ACTOR_INVALID');
  }
  for (const item of receipt.refusals) {
    const o = await db.selectFrom('person_master.assignment_command_outcome').selectAll()
      .where('governance_object_id', '=', item.command.governanceObjectId).where('request_id', '=', item.context.requestId).executeTakeFirstOrThrow();
    assert.equal(o.operation_type, 'TRANSFER'); assert.equal(o.rejection_code, item.code); assert.equal(o.transfer_id, null);
    assert.equal(o.created_by, item.context.actorPrincipalId, 'C0302_REFUSAL_ACTOR_INVALID');
  }
  const { contentHash, ...body } = receipt;
  assert.equal(canonicalSha256(body).toString('hex'), contentHash, 'C0302_RECEIPT_CONTENT_INVALID');
  assert.deepEqual(await assignmentTransferRecoveryFingerprint(db, receipt.versionIds, receipt.transferIds, receipt.requestIds), receipt.fingerprint, 'C0302_RECOVERY_FACTS_CHANGED');
  const context = () => { const requestId = randomUUID(); return { actorPrincipalId: receipt.actor, requestId, correlationId: requestId, occurredAt: '2026-09-08T00:00:00' }; };
  for (const item of receipt.transfers) {
    assert.deepEqual(await createAssignmentTransferApplication(db, context()).getAssignmentTransfer({ governanceObjectId: item.command.governanceObjectId, transferId: item.value.transferId }), item.value);
    assert.deepEqual(await createAssignmentTransferApplication(db, item.context).transferAssignment(item.command), item.value);
    for (const version of [item.value.sourceClosure, item.value.targetAdmission]) assert.deepEqual(await createAssignmentApplication(db, context()).getAssignmentVersion({
      governanceObjectId: version.governanceObjectId, assignmentId: version.assignmentId, assignmentVersionId: version.assignmentVersionId }), version);
  }
  for (const item of receipt.sourceReplays) assert.deepEqual(await createAssignmentSemanticsApplication(db, item.context).createClassifiedAssignment(item.command), item.value);
  for (const item of receipt.refusals) await assert.rejects(createAssignmentTransferApplication(db, item.context).transferAssignment(item.command), { message: item.code });
  for (const item of receipt.declaredReads) assert.deepEqual(await createAssignmentClosureApplication(db, context()).getAssignmentDeclaredPeriodAsOf(item.query), item.value);
  for (const item of receipt.semanticReads) assert.deepEqual(await createAssignmentSemanticsApplication(db, context()).getAssignmentSemanticsAsOf(item.query), item.value);
  for (const item of receipt.primaryReads) assert.deepEqual(await createAssignmentSemanticsApplication(db, context()).resolvePrimaryAffiliation(item.query), item.value);
  const fingerprint = await assignmentTransferRecoveryFingerprint(db, receipt.versionIds, receipt.transferIds, receipt.requestIds);
  assert.deepEqual(fingerprint, receipt.fingerprint, 'C0302_RECOVERY_FACTS_CHANGED');
  assert.deepEqual(await readFile(path), original, 'C0302_ORIGINAL_RECEIPT_CHANGED');
  observation = { identity, oldIdentity: receipt.identity, transfers: receipt.transfers.length, sourceReplays: receipt.sourceReplays.length,
    refusals: receipt.refusals.length, declaredReads: receipt.declaredReads.length, semanticReads: receipt.semanticReads.length,
    primaryReads: receipt.primaryReads.length, fingerprint, originalReceiptSha256: createHash('sha256').update(original).digest('hex') };
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  if (handle) await handle.close();
  const result = { task: 'PV-006-C-03-02', mode: 'RECOVERY', status: failure ? 'FAILED' : 'PASS', observation, poolClosed: true,
    error: failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]').slice(0, 650) : null,
    argv: process.argv.slice(1), cwd: process.cwd() };
  await writeFile(`${directory}/recovery-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, observation: undefined, directory }));
}
