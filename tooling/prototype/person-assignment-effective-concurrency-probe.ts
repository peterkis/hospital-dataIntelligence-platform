import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { Kysely, KyselyPlugin } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentEffectivePeriodApplication } from '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import type { ClosureFixture } from './person-assignment-closure-fixture.js';
import type { EffectiveCheck } from './person-assignment-effective-application-probe.js';
import { Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';

/** Driver barrier after an actual target SELECT; no fabricated database fact. */
export async function runEffectiveConcurrency(database: Kysely<DB>, f: ClosureFixture, check: EffectiveCheck) {
  await check(['CS-01','CS-02','CS-03','CS-04'], 'Actual RR target/source/Department observations remain old together while an upstream writer commits', async () => {
    const evidence = [];
    for (const change of ['SOURCE_END','PUBLICATION'] as const) {
      const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId,
        { businessValidTo: Dec }))).coreVersion;
      const department = await f.createDepartment(`C05-CONCURRENT-${change}`);
      const child = await createTemporaryAssignmentApplication(database, f.context()).createSourceLinkedTemporaryAssignment({ ...f.scope,
        sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId,
        targetPlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: department.departmentId },
        businessValidFrom: Jun, businessValidTo: Aug, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' });
      const draft = change === 'PUBLICATION' ? await f.reviseDepartment(department.departmentId, 'SUSPENDED', 'SYNTHETIC C05 BARRIER', null, false) : null;
      let announce!: () => void, release!: () => void, hit = false;
      const entered = new Promise<void>(resolve => { announce = resolve; });
      const released = new Promise<void>(resolve => { release = resolve; });
      const barrier: KyselyPlugin = {
        transformQuery: args => args.node,
        async transformResult(args) {
          if (!hit && args.result.rows.some(row => row['assignment_id'] === child.targetAssignmentId && row['evidence_kind'] === 'ADMISSION')) {
            hit = true; announce(); await released;
          }
          return args.result;
        },
      };
      const query = { ...f.scope, assignmentId: child.targetAssignmentId, requestedFrom: Jun, requestedTo: Aug, recordAsOf: '2099-01-01T00:00:00' };
      const reading = createAssignmentEffectivePeriodApplication(database.withPlugin(barrier), f.context()).getAssignmentEffectivePeriodAsOf(query);
      // Surface rejection rather than leaving the barrier wait unresolved.
      const ready = Promise.race([entered, reading.then(() => { throw new Error('C05_BARRIER_NOT_REACHED'); })]);
      try {
        await Promise.race([ready, delay(15000).then(() => { throw new Error('C05_BARRIER_TIMEOUT'); })]);
        if (draft) await f.publishDepartment(draft);
        else await f.closure().endAssignment(f.endCommand(source, Jul));
      } finally { release(); }
      const old = await reading;
      const next = await createAssignmentEffectivePeriodApplication(database, f.context()).getAssignmentEffectivePeriodAsOf(query);
      assert.equal(old.structuralDependencies.result, 'SATISFIED');
      assert.equal(old.observedEvidenceRefs.sourceAssignmentVersionId, source.assignmentVersionId);
      assert.equal(old.observedEvidenceRefs.targetDepartment?.departmentVersionId, department.departmentVersionId);
      assert.equal(next.structuralDependencies.result, 'NOT_SATISFIED');
      if (draft) assert.equal(next.observedEvidenceRefs.targetDepartment?.departmentVersionId, draft.departmentVersionId);
      else assert.notEqual(next.observedEvidenceRefs.sourceAssignmentVersionId, source.assignmentVersionId);
      assert.equal(next.originalEvidenceRefs.sourceAssignmentVersionId, source.assignmentVersionId);
      evidence.push({ change, barrierReached: hit, old, next, writerCommittedBeforeReaderContinued: true });
    }
    return evidence;
  });
}
