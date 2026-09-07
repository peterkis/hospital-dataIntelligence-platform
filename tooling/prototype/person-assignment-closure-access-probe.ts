import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { Jan, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import type { ClosureFixture, ClosureCheck } from './person-assignment-closure-fixture.js';

export async function runAssignmentClosureAccess(database: Kysely<DB>, f: ClosureFixture, check: ClosureCheck) {
  const closeGrants = ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_END'];
  await check(['SC-03', 'SC-04', 'SC-06', 'ID-01', 'ID-06'],
    'Independent READ+END can close without positive WRITE or upstream permissions; current revoked permissions defeat replay', async () => {
      const engagement = await f.createEngagement(), raw = await f.app().createAssignment(f.command(engagement.engagementId));
      const writerWithoutEnd = await f.principal(['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE']);
      await assert.rejects(f.closure(randomUUID(), writerWithoutEnd).endAssignment(f.endCommand(raw, Aug)), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      const closer = await f.principal(closeGrants), request = randomUUID(), command = f.endCommand(raw, Aug);
      const closed = await f.closure(request, closer).endAssignment(command);
      const auditCount = async () => (await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', request).execute()).length;
      const before = await auditCount();
      assert.deepEqual(await f.closure(request, closer).endAssignment(command), closed);
      assert.deepEqual(await f.closure(request, closer).endAssignment({ ...command, endedAt: `${Aug}.000000` }), closed);
      assert.equal(await auditCount(), before);
      await assert.rejects(f.app(randomUUID(), closer).createAssignment(f.command(engagement.engagementId)), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      await assert.rejects(f.app(randomUUID(), closer).reviseAssignment({ ...f.scope, assignmentId: raw.assignmentId,
        expectedCurrentVersionId: closed.assignmentVersionId, businessValidFrom: Jan, businessValidTo: null, reasonCode: 'CONTINUATION_EXTENSION' }),
        { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      const e2 = await f.createEngagement(), classified = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e2.engagementId));
      await assert.rejects(f.closure(randomUUID(), closer).endAssignment(f.endCommand(classified.coreVersion, Aug)), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      const semanticCloser = await f.principal([...closeGrants, 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ']);
      const classifiedClosed = await f.closure(randomUUID(), semanticCloser).endAssignment(f.endCommand(classified.coreVersion, Aug));
      for (const read of [
        () => f.closure(randomUUID(), closer).getAssignmentClosure({ ...f.scope, assignmentId: classifiedClosed.assignmentId, closureVersionId: classifiedClosed.assignmentVersionId }),
        () => f.app(randomUUID(), closer).getAssignmentVersion({ ...f.scope, assignmentId: classifiedClosed.assignmentId, assignmentVersionId: classifiedClosed.assignmentVersionId }),
        () => f.closure(randomUUID(), closer).getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: classifiedClosed.assignmentId, businessAt: Jan, recordAsOf: classifiedClosed.recordedFrom }),
      ]) await assert.rejects(read(), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      await f.grant(closer, ['PERSON_MASTER_ASSIGNMENT_END'], 'DENY', '2');
      await assert.rejects(f.closure(request, closer).endAssignment(command), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      const legacyWriter = await f.principal(['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_WRITE',
        'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ']);
      const legacyRequest = randomUUID(), legacyCommand = f.command((await f.createEngagement()).engagementId);
      const legacy = await f.app(legacyRequest, legacyWriter).createAssignment(legacyCommand);
      await f.closure().endAssignment(f.endCommand(legacy, Aug));
      await f.grant(legacyWriter, ['PERSON_MASTER_ASSIGNMENT_WRITE'], 'DENY', '2');
      await assert.rejects(f.app(legacyRequest, legacyWriter).createAssignment(legacyCommand), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
      return { minimalRawGrants: closeGrants, minimalClassifiedGrants: [...closeGrants, 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ'],
        rawClosure: closed.assignmentVersionId, classifiedClosure: classifiedClosed.assignmentVersionId, replaySuccessAuditCount: before, revokedReplayDenied: true };
    });

  await check(['SC-05'], 'Inactive human, service actor, wrong scope and transaction-local suspended Person authority fail closed', async () => {
    const source = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId));
    for (const [kind, status] of [['PERSON', 'DISABLED'], ['SERVICE', 'ACTIVE']]) {
      const actor = await f.principal(closeGrants, kind, status);
      await assert.rejects(f.closure(randomUUID(), actor).endAssignment(f.endCommand(source, Aug)), { message: 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED' });
    }
    await assert.rejects(f.closure().endAssignment({ ...f.endCommand(source, Aug), governanceObjectId: departmentScope.governanceObjectId }),
      { message: 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID' });
    const original = await database.selectFrom('platform.governance_object').selectAll().where('governance_object_id', '=', f.scope.governanceObjectId).executeTakeFirstOrThrow();
    await assert.rejects(database.transaction().execute(async tx => {
      await tx.updateTable('platform.governance_object').set({ status: 'GOVERNANCE_SUSPENDED' }).where('governance_object_id', '=', f.scope.governanceObjectId).execute();
      await (await createAssignmentScope(tx, f.context())).assignment.endAssignment(f.endCommand(source, Aug));
    }), { message: 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID' });
    assert.deepEqual(await database.selectFrom('platform.governance_object').selectAll().where('governance_object_id', '=', f.scope.governanceObjectId).executeTakeFirstOrThrow(), original);
    return { disabledActor: true, serviceActor: true, wrongScope: true, suspendedScopeRolledBack: true };
  });

  await check(['ID-02', 'ID-03', 'ID-05', 'ID-08'], 'Every legacy request shares END authority while old success replay differs from new reopening', async () => {
    const e = await f.createEngagement(), create = f.command(e.engagementId), createRequest = randomUUID();
    const raw = await f.app(createRequest).createAssignment(create);
    const revise = { ...f.scope, assignmentId: raw.assignmentId, expectedCurrentVersionId: raw.assignmentVersionId,
      businessValidFrom: Jan, businessValidTo: Dec, reasonCode: 'VALIDITY_CORRECTION' as const }, reviseRequest = randomUUID();
    const revised = await f.app(reviseRequest).reviseAssignment(revise);
    const adopt = { ...f.scope, assignmentId: raw.assignmentId, expectedCurrentVersionId: revised.assignmentVersionId,
      purposeCode: 'ORGANIZATIONAL_AFFILIATION' as const, modeCode: 'STANDING_CONCURRENT' as const }, adoptRequest = randomUUID();
    const adopted = await f.semantics(adoptRequest).adoptAssignmentSemantics(adopt);
    const period = { ...revise, expectedCurrentVersionId: adopted.coreVersion.assignmentVersionId }, periodRequest = randomUUID();
    const periodVersion = await f.semantics(periodRequest).reviseClassifiedAssignmentPeriod(period);
    const correct = { ...adopt, expectedCurrentVersionId: periodVersion.coreVersion.assignmentVersionId,
      purposeCode: 'CLINICAL_PRACTICE' as const, reasonCode: 'PURPOSE_CORRECTION' as const }, correctRequest = randomUUID();
    const corrected = await f.semantics(correctRequest).correctAssignmentSemantics(correct);
    const classifiedCreate = f.classifiedCommand((await f.createEngagement()).engagementId), classifiedRequest = randomUUID();
    const classified = await f.semantics(classifiedRequest).createClassifiedAssignment(classifiedCreate);
    const endRequest = randomUUID(), end = f.endCommand(corrected.coreVersion, Aug), closed = await f.closure(endRequest).endAssignment(end);
    const oldRequests = [createRequest, reviseRequest, adoptRequest, periodRequest, correctRequest, classifiedRequest];
    for (const request of oldRequests) await assert.rejects(f.closure(request).endAssignment(end), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    const legacy = [
      { request: createRequest, value: raw, run: (r: string) => f.app(r).createAssignment(create) },
      { request: reviseRequest, value: revised, run: (r: string) => f.app(r).reviseAssignment(revise) },
      { request: adoptRequest, value: adopted, run: (r: string) => f.semantics(r).adoptAssignmentSemantics(adopt) },
      { request: periodRequest, value: periodVersion, run: (r: string) => f.semantics(r).reviseClassifiedAssignmentPeriod(period) },
      { request: correctRequest, value: corrected, run: (r: string) => f.semantics(r).correctAssignmentSemantics(correct) },
      { request: classifiedRequest, value: classified, run: (r: string) => f.semantics(r).createClassifiedAssignment(classifiedCreate) },
    ];
    for (const operation of legacy) {
      await assert.rejects(operation.run(endRequest), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
      assert.deepEqual(await operation.run(operation.request), operation.value);
    }
    for (const change of [{ endedAt: Dec }, { reasonCode: 'ADMINISTRATIVE_CLOSURE' as const }, { expectedCurrentVersionId: closed.assignmentVersionId }])
      await assert.rejects(f.closure(endRequest).endAssignment({ ...end, ...change }), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    const another = await f.principal([...closeGrants, 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ']);
    await assert.rejects(f.closure(endRequest, another).endAssignment(end), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    for (const reopening of [
      () => f.app().reviseAssignment({ ...revise, expectedCurrentVersionId: closed.assignmentVersionId }),
      () => f.semantics().reviseClassifiedAssignmentPeriod({ ...period, expectedCurrentVersionId: closed.assignmentVersionId }),
      () => f.semantics().adoptAssignmentSemantics({ ...adopt, expectedCurrentVersionId: closed.assignmentVersionId }),
      () => f.semantics().correctAssignmentSemantics({ ...correct, expectedCurrentVersionId: closed.assignmentVersionId }),
    ]) await assert.rejects(reopening(), { message: 'ASSIGNMENT_ALREADY_CLOSED' });
    return { oldOperationsReplayed: 6, crossOperationRefusals: 12, changedPayloadRefusals: 3, changedActorRefusal: true, reopeningRefusals: 4 };
  });

  await check(['ID-04'], 'A refused END keeps its original refusal after later positive revision makes a fresh closure possible', async () => {
    const source = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId, { businessValidTo: Aug }));
    const request = randomUUID(), input = f.endCommand(source, Dec);
    await assert.rejects(f.closure(request).endAssignment(input), { message: 'ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN' });
    const expanded = await f.app().reviseAssignment({ ...f.scope, assignmentId: source.assignmentId, expectedCurrentVersionId: source.assignmentVersionId,
      businessValidFrom: Jan, businessValidTo: Dec, reasonCode: 'CONTINUATION_EXTENSION' });
    await assert.rejects(f.closure(request).endAssignment(input), { message: 'ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN' });
    const closed = await f.closure().endAssignment(f.endCommand(expanded, Dec));
    return { refusedRequest: request, expanded: expanded.assignmentVersionId, freshClosed: closed.assignmentVersionId };
  });

  await check(['DE-10', 'ID-14'], 'Faults after version, proof, outcome and audit roll back every closure effect and permit bounded same-request retry', async () => {
    const observations = [];
    for (const point of ['ASSIGNMENT_CLOSURE_VERSION_WRITTEN', 'ASSIGNMENT_CLOSURE_EVIDENCE_WRITTEN', 'ASSIGNMENT_CLOSURE_OUTCOME_WRITTEN', 'AUDIT_EVENT_WRITTEN']) {
      const source = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId));
      const request = randomUUID(), input = f.endCommand(source, Aug);
      configureControlledPublicationFault(point);
      try { await assert.rejects(f.closure(request).endAssignment(input), { message: `CONTROLLED_PUBLICATION_FAULT:${point}` }); }
      finally { configureControlledPublicationFault(null); }
      const counts = (await sql<{ versions: number; evidence: number; outcomes: number; audit: number }>`select
        (select count(*)::int from person_master.assignment_version where assignment_id=${source.assignmentId}::uuid) as versions,
        (select count(*)::int from person_master.assignment_closure_evidence where assignment_id=${source.assignmentId}::uuid) as evidence,
        (select count(*)::int from person_master.assignment_command_outcome where request_id=${request}) as outcomes,
        (select count(*)::int from audit.audit_event where request_id=${request}) as audit`.execute(database)).rows[0]!;
      assert.deepEqual(counts, { versions: 1, evidence: 0, outcomes: 0, audit: 0 });
      const closed = await f.closure(request).endAssignment(input);
      assert.deepEqual(await f.closure(request).endAssignment(input), closed);
      observations.push({ point, rollback: counts, retryVersion: closed.assignmentVersionId });
    }
    return observations;
  });
}
