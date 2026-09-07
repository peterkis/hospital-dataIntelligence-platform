import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentSemanticsApplication } from '../../apps/governance-api/src/composition/create-assignment-semantics-application.js';
import { createAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { assignmentSemanticDatabaseIdentity, assignmentSemanticRecoveryFingerprint } from './person-assignment-semantics-recovery-support.js';

const directory = `.runtime/pv006-c02/${randomUUID()}`;
await mkdir(directory, { recursive: false });
let handle: ReturnType<typeof createDatabase> | undefined;
let failure: unknown, observation: unknown;
try {
  assert.deepEqual(process.argv.slice(2), ['--recover'], 'C02_RECOVERY_MODE_REQUIRED');
  const path = process.env['ASSIGNMENT_SEMANTIC_RECOVERY_RECEIPT'];
  assert.ok(path, 'C02_RECOVERY_RECEIPT_REQUIRED');
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(receipt.task, 'PV-006-C-02', 'C02_RECEIPT_TASK_INVALID');
  assert.equal(receipt.mode, 'RECOVERY', 'C02_RECEIPT_MODE_INVALID');
  assert.ok(process.env['DATABASE_URL'], 'C02_DATABASE_REQUIRED');
  const endpoint = new URL(process.env['DATABASE_URL']);
  assert.equal(endpoint.hostname, '127.0.0.1', 'C02_LOCAL_ENDPOINT_REQUIRED');
  assert.equal(endpoint.port, '55434', 'C02_LOCAL_ENDPOINT_REQUIRED');
  assert.equal(endpoint.pathname, '/hdi_prototype', 'C02_LOCAL_DATABASE_REQUIRED');
  handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 4, application_name: 'hdi-pv006-c02-recovery' });
  const current = await assignmentSemanticDatabaseIdentity(handle.database);
  assert.equal(current.database, receipt.identity.database, 'C02_RECEIPT_DATABASE_INVALID');
  assert.equal(current.oid, receipt.identity.oid, 'C02_RECEIPT_OID_INVALID');
  assert.equal(current.address, receipt.identity.address, 'C02_RECEIPT_ENDPOINT_INVALID');
  assert.equal(current.port, receipt.identity.port, 'C02_RECEIPT_ENDPOINT_INVALID');
  assert.equal(current.role, receipt.identity.role, 'C02_RECEIPT_ROLE_INVALID');
  assert.notEqual(current.startedAt, receipt.identity.startedAt, 'C02_POSTMASTER_NOT_RESTARTED');
  const data = receipt.recovery;
  const context = (requestId = randomUUID()) => ({ actorPrincipalId: data.actor, requestId,
    correlationId: requestId, occurredAt: '2026-09-07T12:00:00' });
  const app = () => createAssignmentSemanticsApplication(handle!.database, context());
  for (const snapshot of data.semanticReads) assert.deepEqual(await app().getAssignmentSemanticsAsOf(snapshot.query), snapshot.value);
  for (const snapshot of data.primaryReads) assert.deepEqual(await app().resolvePrimaryAffiliation(snapshot.query), snapshot.value);
  const core = createAssignmentApplication(handle.database, context());
  for (const value of [data.rawVersion, data.adopted.coreVersion, data.frozen.coreVersion]) {
    assert.deepEqual(await core.getAssignmentVersion({ governanceObjectId: value.governanceObjectId,
      assignmentId: value.assignmentId, assignmentVersionId: value.assignmentVersionId }), value);
  }
  assert.deepEqual(await createAssignmentSemanticsApplication(handle.database, context(data.successfulRequest))
    .createClassifiedAssignment(data.frozenCommand), data.frozen);
  const fingerprint = await assignmentSemanticRecoveryFingerprint(handle.database, receipt.versionIds, receipt.requestIds);
  assert.deepEqual(fingerprint, receipt.fingerprint, 'C02_RECOVERY_ROWS_CHANGED');
  observation = { oldIdentity: receipt.identity, current, versions: receipt.versionIds.length, fingerprint,
    semanticReads: data.semanticReads.length, primaryReads: data.primaryReads.length, frozenReplay: true };
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  if (handle) await handle.close();
  const result = { task: 'PV-006-C-02', mode: 'RECOVERY', status: failure ? 'FAILED' : 'PASSED', poolClosed: true, observation,
    error: failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]').slice(0, 600) : null,
    argv: process.argv.slice(1), cwd: process.cwd() };
  await writeFile(`${directory}/recovery-result.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, observation: undefined, evidenceDirectory: directory }));
}
