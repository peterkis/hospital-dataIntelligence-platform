import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentEffectivePeriodApplication } from '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';

assert.ok(process.env['C05_REVIEW_RECEIPT'] && process.env['DATABASE_URL'], 'C05_REVIEW_RECEIPT_AND_MANAGED_DATABASE_REQUIRED');
const receipt = JSON.parse(await readFile(process.env['C05_REVIEW_RECEIPT'], 'utf8'));
assert.equal(receipt.task, 'PV-006-C-05'); assert.equal(receipt.mode, 'RECOVERY');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 1 });
after(() => handle.close());
for (const reason of ['ASSIGNMENT_NOT_KNOWN_AS_OF','ASSIGNMENT_NOT_FOUND']) {
  test(`AU-06: ${reason} appends bounded denial audit with validated query and no fabricated version`, async () => {
    const requestId = randomUUID(), base = receipt.requests[0].query;
    const query = { governanceObjectId: base.governanceObjectId,
      assignmentId: reason === 'ASSIGNMENT_NOT_FOUND' ? randomUUID() : base.assignmentId,
      requestedFrom: '2026-06-01T00:00:00', requestedTo: '2026-07-01T00:00:00', recordAsOf: '2026-01-01T00:00:00' };
    const app = createAssignmentEffectivePeriodApplication(handle.database, { actorPrincipalId: receipt.actor,
      requestId, correlationId: requestId, occurredAt: '2026-09-09T00:00:00' });
    await assert.rejects(app.getAssignmentEffectivePeriodAsOf(query), { message: reason });
    const rows = await handle.database.selectFrom('audit.audit_event').selectAll().where('request_id', '=', requestId).execute();
    assert.equal(rows.length, 1, 'C05_UNKNOWN_READ_DENIAL_AUDIT_MISSING');
    const audit = rows[0]!;
    assert.equal(audit.action, 'PERSON_ASSIGNMENT_ACCESS_DENIED'); assert.equal(audit.entity_version_id, null);
    const payload = audit.event_payload;
    assert.ok(payload && typeof payload === 'object' && !Array.isArray(payload));
    assert.equal(payload['reason'], reason); assert.equal(payload['assignmentId'], query.assignmentId);
    assert.equal(payload['requestedFrom'], '2026-06-01T00:00:00.000000');
    assert.equal(payload['requestedTo'], '2026-07-01T00:00:00.000000');
    assert.equal(payload['recordAsOf'], '2026-01-01T00:00:00.000000');
  });
}
