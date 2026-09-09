import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Kysely, KyselyPlugin } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentEffectivePeriodApplication } from '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { requireEffectiveFixtureTarget } from './person-assignment-effective-fixture-guard.js';
import { temporarySourceSnapshot } from './person-assignment-temporary-test-support.js';
import type { ClosureFixture } from './person-assignment-closure-fixture.js';
import type { EffectiveCheck } from './person-assignment-effective-application-probe.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';
import { planIndependentChecks } from './person-assignment-effective-consumer.compile.js';

export async function runEffectiveFreshNegatives(database: Kysely<DB>, f: ClosureFixture, check: EffectiveCheck) {
  await requireEffectiveFixtureTarget(database, 'CORRUPTION');
  await check(['WP-09','SC-06'], 'Fresh-only current definition retirement preserves frozen historical classification', async () => {
    const a = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId))).coreVersion;
    const current = await f.semantics().findAssignmentSemanticTermAsOf({ ...f.scope, dimension: 'MODE', code: 'PRIMARY_AFFILIATION', recordAsOf: await f.now() });
    assert.ok(current);
    const retired = await f.semantics().appendAssignmentSemanticTermVersion({ ...f.scope, termId: current.termId,
      expectedCurrentVersionId: current.termVersionId, label: current.label, definitionState: 'RETIRED',
      businessValidFrom: current.businessValidFrom, businessValidTo: current.businessValidTo, reasonCode: 'RETIREMENT' });
    try {
      const result = await createAssignmentEffectivePeriodApplication(database, f.context()).getAssignmentEffectivePeriodAsOf({ ...f.scope,
        assignmentId: a.assignmentId, requestedFrom: Jun, requestedTo: Jul, recordAsOf: retired.recordedFrom });
      assert.equal(result.structuralDependencies.result, 'SATISFIED');
      assert.equal(result.assignmentSemantics.modeTermVersionId, current.termVersionId);
      return { current: current.termVersionId, retired: retired.termVersionId, result };
    } finally {
      await f.semantics().appendAssignmentSemanticTermVersion({ ...f.scope, termId: current.termId, expectedCurrentVersionId: retired.termVersionId,
        label: current.label, definitionState: current.definitionState, businessValidFrom: current.businessValidFrom,
        businessValidTo: current.businessValidTo, reasonCode: 'APPLICABILITY_CORRECTION' });
    }
  });
  await check(['TS-05','TS-06','TS-10','CS-06','AU-06','AU-08'], 'Controlled returned candidates distinguish conflict/unknown/outside-window/limit; native writers reject illegal facts', async () => {
    const e = await f.createEngagement();
    const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { businessValidTo: Dec }))).coreVersion;
    await assert.rejects(f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId)), /ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT/u);
    const target = await f.createDepartment('C05-NEGATIVE');
    const child = await createTemporaryAssignmentApplication(database, f.context()).createSourceLinkedTemporaryAssignment({ ...f.scope,
      sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId,
      targetPlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: target.departmentId },
      businessValidFrom: Jun, businessValidTo: Aug, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' });
    const before = await temporarySourceSnapshot(database, child.targetAssignmentId);
    const query = { ...f.scope, assignmentId: child.targetAssignmentId, requestedFrom: Jun, requestedTo: Jul, recordAsOf: await f.now() };
    const observations = [];
    for (const mode of ['PRIMARY','UNKNOWN','SECONDMENT_INSIDE','SECONDMENT_OUTSIDE','BOUNDARY','LIMIT'] as const) {
      let injected = false;
      const plugin: KyselyPlugin = { transformQuery: args => args.node,
        async transformResult(args) {
          if (args.result.rows.some(row => row['assignmentId'] === source.assignmentId && 'purposeCode' in row)) {
            injected = true;
            const extra = { assignmentId: randomUUID(), assignmentVersionId: randomUUID(), businessValidFrom: mode === 'SECONDMENT_OUTSIDE' ? Jul : Jun,
              businessValidTo: Aug, purposeCode: mode === 'UNKNOWN' ? null : 'ORGANIZATIONAL_AFFILIATION',
              modeCode: mode === 'UNKNOWN' ? null : mode === 'BOUNDARY' ? 'STANDING_CONCURRENT' : mode.startsWith('SECONDMENT') ? 'SECONDMENT' : 'PRIMARY_AFFILIATION' };
            return { ...args.result, rows: [...args.result.rows, ...Array.from({ length: mode === 'LIMIT' ? 65 : mode === 'BOUNDARY' ? 63 : 1 }, () => ({ ...extra, assignmentId: randomUUID() }))] };
          }
          return args.result;
        } };
      const context = f.context();
      const result = await createAssignmentEffectivePeriodApplication(database.withPlugin(plugin), context).getAssignmentEffectivePeriodAsOf(query);
      assert.equal(injected, true);
      assert.equal(result.structuralDependencies.result, mode === 'UNKNOWN' || mode === 'LIMIT' ? 'UNKNOWN'
        : mode === 'SECONDMENT_OUTSIDE' || mode === 'BOUNDARY' ? 'SATISFIED' : 'NOT_SATISFIED');
      assert.equal(planIndependentChecks(result), mode === 'SECONDMENT_OUTSIDE' || mode === 'BOUNDARY' ? 'INDEPENDENT_CHECKS_REQUIRED' : 'INSUFFICIENT_CONTEXT');
      if (mode === 'LIMIT') assert.ok(result.structuralDependencies.boundedReasons.includes('ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT'));
      const audit = await database.selectFrom('audit.audit_event').select(['entity_version_id','event_payload'])
        .where('request_id', '=', context.requestId).where('action', '=', 'PERSON_ASSIGNMENT_READ').executeTakeFirstOrThrow();
      assert.equal(audit.entity_version_id, result.selectedAssignmentVersionId);
      assert.ok(audit.event_payload && typeof audit.event_payload === 'object' && !Array.isArray(audit.event_payload));
      assert.equal(audit.event_payload['structuralDependencyResult'], result.structuralDependencies.result);
      assert.equal(audit.event_payload['contextFingerprint'], result.contextFingerprint);
      observations.push({ mode, evidenceType: 'TEST_LOCAL_RETURNED_CANDIDATE_NOT_PERSISTED', result });
    }
    for (const corrupted of ['MODE','FUTURE_LINK','PROOF'] as const) {
      let injected = false;
      const plugin: KyselyPlugin = { transformQuery: args => args.node,
        async transformResult(args) {
          const rows = args.result.rows.map(row => {
            if (row['target_assignment_id'] !== child.targetAssignmentId || !('source_link_fingerprint' in row)) return row;
            injected = true;
            return corrupted === 'MODE' ? { ...row, temporary_mode_code: 'ROTATION' }
              : corrupted === 'FUTURE_LINK' ? { ...row, recorded_from: '2099-01-01T00:00:00' }
                : { ...row, source_window_validation_evidence: { unexpected: true } };
          });
          return { ...args.result, rows };
        } };
      await assert.rejects(createAssignmentEffectivePeriodApplication(database.withPlugin(plugin), f.context()).getAssignmentEffectivePeriodAsOf(query),
        corrupted === 'FUTURE_LINK' ? /ASSIGNMENT_NOT_KNOWN_AS_OF/u : /EVIDENCE_INVALID|INPUT_INVALID/u);
      assert.equal(injected, true);
    }
    await assert.rejects(createTemporaryAssignmentApplication(database, f.context()).createSourceLinkedTemporaryAssignment({ ...f.scope,
      sourceAssignmentId: child.targetAssignmentId, expectedSourceVersionId: child.targetAdmissionVersionId, targetPlacement: child.sourceLink.sourcePlacement,
      businessValidFrom: Jun, businessValidTo: Jul, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' }), /ASSIGNMENT_TEMPORARY_SOURCE_CHAIN_NOT_SUPPORTED/u);
    // Native immutability is exercised in a real rollback-only transaction.
    await assert.rejects(database.transaction().execute(tx => tx.updateTable('person_master.assignment_temporary_source')
      .set({ temporary_to: Dec }).where('target_assignment_id', '=', child.targetAssignmentId).execute()));
    assert.deepEqual(await temporarySourceSnapshot(database, child.targetAssignmentId), before);
    return { observations, nativeRejections: ['PRIMARY_CONFLICT','TEMPORARY_CHAIN','IMMUTABLE_LINK'], unchanged: before };
  });
  await check(['AU-07','SC-04'], 'Read audit failure propagates after observation and cannot commit a delivered read or business mutation', async () => {
    const a = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId));
    const before = await temporarySourceSnapshot(database, a.assignmentId), requests = [];
    for (const recordAsOf of [await f.now(), Jan]) {
      const request = randomUUID(); requests.push(request);
      configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
      try { await assert.rejects(createAssignmentEffectivePeriodApplication(database, f.context(f.actor, request)).getAssignmentEffectivePeriodAsOf({ ...f.scope,
        assignmentId: a.assignmentId, requestedFrom: Jun, requestedTo: Jul, recordAsOf }), /CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN/u); }
      finally { configureControlledPublicationFault(null); }
      assert.equal((await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', request).execute()).length, 0);
    }
    assert.deepEqual(await temporarySourceSnapshot(database, a.assignmentId), before);
    return { requests, selectedAndUnknownReadAuditFailurePropagates: true, failedReadAuditRolledBack: true, businessUnchanged: before };
  });
}
