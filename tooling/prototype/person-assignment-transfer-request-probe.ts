import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import type { TransferCheck, TransferFixture } from './person-assignment-transfer-fixture.js';
import { assertTransferUnchanged } from './person-assignment-transfer-behavior-probe.js';
import { Aug, Dec } from './person-assignment-fixture.js';

export async function runAssignmentTransferRequests(database: Kysely<DB>, f: TransferFixture, check: TransferCheck) {
  const permissions = [...f.fullGrants, 'PERSON_MASTER_ASSIGNMENT_TRANSFER', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'];
  await check(['RQ-02', 'RQ-03'], 'One common ledger rejects changed transfer inputs and both directions of cross-entrypoint reuse', async () => {
    const e = await f.createEngagement(), source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
    const root = randomUUID(), command = f.transferCommand(source.coreVersion), value = await f.transfer(root).transferAssignment(command);
    const changed = [ { sourceAssignmentId: randomUUID() }, { expectedSourceVersionId: randomUUID() }, { effectiveAt: Dec },
      { targetPlacement: { ...command.targetPlacement, departmentId: f.department.departmentId } } ];
    for (const changes of changed) await assert.rejects(f.transfer(root).transferAssignment({ ...command, ...changes }), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    const otherActor = await f.principal(permissions);
    await assert.rejects(f.transfer(root, otherActor).transferAssignment(command), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    await assert.rejects(f.closure(root).endAssignment(f.endCommand(source.coreVersion, Aug)), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    await assert.rejects(f.app(root).createAssignment(f.command(e.engagementId)), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    await assert.rejects(f.semantics(root).createClassifiedAssignment(f.classifiedCommand(e.engagementId)), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    await assert.rejects(f.semantics(root).correctAssignmentSemantics({ ...f.scope, assignmentId: source.coreVersion.assignmentId,
      expectedCurrentVersionId: source.coreVersion.assignmentVersionId, purposeCode: 'CLINICAL_PRACTICE', modeCode: 'PRIMARY_AFFILIATION', reasonCode: 'PURPOSE_CORRECTION' }),
      { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    for (const operation of ['CREATE', 'END', 'SEMANTIC'] as const) {
      const next = await f.createEngagement(), request = randomUUID();
      const s = await f.semantics().createClassifiedAssignment(f.classifiedCommand(next.engagementId));
      if (operation === 'CREATE') await f.app(request).createAssignment(f.command((await f.createEngagement()).engagementId));
      else if (operation === 'END') await f.closure(request).endAssignment(f.endCommand(s.coreVersion, Aug));
      else await f.semantics(request).createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId));
      await assert.rejects(f.transfer(request).transferAssignment(f.transferCommand(s.coreVersion)), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    }
    assert.deepEqual(await f.transfer(root).transferAssignment(command), value);
    return { root, transferId: value.transferId, changedCommands: changed.length, crossEntrypointDirections: 7 };
  });
  await check(['TX-03', 'TX-04', 'TX-05', 'TX-06', 'TX-07'], 'Every write and success-audit fault rolls back both sides and permits the same root to retry', async () => {
    const faults: [string, number][] = [
      ['ASSIGNMENT_TRANSFER_HEADER_WRITTEN', 0], ['ASSIGNMENT_TRANSFER_SOURCE_WRITTEN', 0],
      ['ASSIGNMENT_TRANSFER_TARGET_STABLE_WRITTEN', 0], ['ASSIGNMENT_TRANSFER_TARGET_VERSION_WRITTEN', 0],
      ['ASSIGNMENT_TRANSFER_TARGET_SEGMENTS_WRITTEN', 0], ['ASSIGNMENT_TRANSFER_TARGET_SEMANTICS_WRITTEN', 0],
      ['ASSIGNMENT_TRANSFER_OUTCOME_WRITTEN', 0], ['AUDIT_EVENT_WRITTEN', 0], ['AUDIT_EVENT_WRITTEN', 1],
      ['AUDIT_EVENT_WRITTEN', 2], ['AUDIT_EVENT_WRITTEN', 3],
    ];
    const observations = [];
    for (const [point, hits] of faults) {
      const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
      const root = randomUUID(), command = f.transferCommand(source);
      try {
        configureControlledPublicationFault(point, hits);
        await assert.rejects(f.transfer(root).transferAssignment(command), { message: `CONTROLLED_PUBLICATION_FAULT:${point}` });
      } finally { configureControlledPublicationFault(null); }
      const rolledBack = await assertTransferUnchanged(database, f, source, root, 1, false);
      assert.equal((await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', root).execute()).length, 0);
      const retried = await f.transfer(root).transferAssignment(command);
      assert.deepEqual(await f.transfer(root).transferAssignment(command), retried);
      observations.push({ point, hits, rolledBack, retryTransfer: retried.transferId });
    }
    return observations;
  });
  await check(['CC-09', 'RQ-08', 'CC-10'], 'Every composed permission is independently required; current revocation defeats replay and receipt reads remain minimal', async () => {
    const required = ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_END', 'PERSON_MASTER_ASSIGNMENT_WRITE',
      'PERSON_MASTER_ASSIGNMENT_TRANSFER', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
      'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'];
    const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
    const command = f.transferCommand(source), root = randomUUID(), value = await f.transfer(root).transferAssignment(command);
    const missing = [];
    for (const removed of required) {
      const actor = await f.principal(required.filter(permission => permission !== removed));
      await assert.rejects(f.transfer(root, actor).transferAssignment(command), { message: 'OBJECT_PERMISSION_FORBIDDEN' }); missing.push(removed);
    }
    for (const [kind, status] of [['SERVICE', 'ACTIVE'], ['PERSON', 'DISABLED']] as const) {
      const actor = await f.principal(required, kind, status);
      await assert.rejects(f.transfer(root, actor).transferAssignment(command), { message: 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED' });
    }
    const reader = await f.principal(['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ']);
    assert.deepEqual(await f.transfer(randomUUID(), reader).getAssignmentTransfer({ ...f.scope, transferId: value.transferId }), value);
    for (const missingRead of ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ']) {
      const actor = await f.principal(['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ'].filter(permission => permission !== missingRead));
      await assert.rejects(f.transfer(randomUUID(), actor).getAssignmentTransfer({ ...f.scope, transferId: value.transferId }), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    }
    try {
      configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
      await assert.rejects(f.transfer().getAssignmentTransfer({ ...f.scope, transferId: value.transferId }), { message: 'CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN' });
    } finally { configureControlledPublicationFault(null); }
    const payloads = await database.selectFrom('audit.audit_event').select('event_payload')
      .where('request_id', 'in', [root, value.sourceRequestId, value.targetRequestId]).execute();
    assert.doesNotMatch(JSON.stringify(payloads), /canonicalName|birthDate|sourceRecordKey|identifierValue|postgres(?:ql)?:\/\//u);
    const actor = await f.principal(permissions), ownRoot = randomUUID();
    const next = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
    const ownCommand = f.transferCommand(next); await f.transfer(ownRoot, actor).transferAssignment(ownCommand);
    await f.grant(actor, ['PERSON_MASTER_ASSIGNMENT_TRANSFER'], 'DENY', '2');
    await assert.rejects(f.transfer(ownRoot, actor).transferAssignment(ownCommand), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    return { missing, revokedActor: actor, revokedRoot: ownRoot, minimalReceiptReader: reader, privacyPayloadCount: payloads.length };
  });
}
