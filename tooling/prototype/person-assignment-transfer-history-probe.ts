import assert from 'node:assert/strict';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import { afterTransferInsert } from './person-assignment-transfer-behavior-probe.js';
import { Jan, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { TransferFixture, TransferCheck } from './person-assignment-transfer-fixture.js';

export async function runAssignmentTransferHistory(database: Kysely<DB>, f: TransferFixture, check: TransferCheck) {
  await check(['PE-01', 'PE-02', 'PE-04', 'PE-05', 'PE-06', 'BT-04', 'BT-05', 'BT-06', 'BT-09'],
    'Independent integer-microsecond oracle checks finite and unbounded conservation across original historical entrypoints', async () => {
      const cases = []; let assertions = 0;
      const stamp = (microsecond: number) => `2026-01-01T00:00:00.${String(microsecond).padStart(6, '0')}`;
      // Independent finite set arithmetic: no production temporal/period helper or JavaScript Date.
      for (let n = 0; n < 12; n++) {
        const start = n + 1, transferAt = start + (n % 2 ? 1 : 7), end = n % 3 === 0 ? null : transferAt + (n % 2 ? 5 : 1);
        const e = await f.createEngagement();
        const source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, {
          businessValidFrom: stamp(start), businessValidTo: end === null ? null : stamp(end),
        }));
        const result = await f.transfer().transferAssignment(f.transferCommand(source.coreVersion, { effectiveAt: stamp(transferAt) }));
        const adjacent = (await sql<{ before: string; after: string }>`select
          ${result.transferRecordedFrom}::timestamp - interval '1 microsecond' as before,
          ${result.transferRecordedFrom}::timestamp + interval '1 microsecond' as after`.execute(database)).rows[0]!;
        assert.ok(result.transferRecordedFrom > source.coreVersion.recordedFrom);
        const points = [...new Set([start - 1, start, transferAt - 1, transferAt, transferAt + 1, end ?? transferAt + 40])];
        for (const [recordAsOf, transferred] of [[source.coreVersion.recordedFrom, false], [adjacent.before, false],
          [result.transferRecordedFrom, true], [adjacent.after, true]] as const) for (const point of points) {
          const containsOld = point >= start && (end === null || point < end);
          const containsSource = point >= start && (transferred ? point < transferAt : end === null || point < end);
          const containsTarget = transferred && point >= transferAt && (end === null || point < end);
          assert.equal(containsSource || containsTarget, containsOld); assert.equal(containsSource && containsTarget, false);
          const businessAt = stamp(point), selected = containsSource ? (transferred ? result.sourceClosureVersionId : source.coreVersion.assignmentVersionId)
            : containsTarget ? result.targetAdmissionVersionId : null;
          const primary = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: e.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION',
            scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt, recordAsOf });
          assert.equal(primary.selectedAssignmentVersionId, selected); assert.equal(primary.resolution, selected ? 'UNIQUE' : 'NONE');
          const declared = await f.closure().getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: result.sourceAssignmentId, businessAt, recordAsOf });
          assert.equal(declared.explicitClosureKnownAsOf, transferred); assert.equal(declared.isWithinDeclaredPeriod, containsSource);
          const sourceSemantic = await f.semantics().getAssignmentSemanticsAsOf({ ...f.scope, assignmentId: result.sourceAssignmentId, businessAt, recordAsOf });
          assert.equal(sourceSemantic.businessPeriodContainsPoint, containsSource);
          if (transferred) {
            const target = await f.closure().getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: result.targetAssignmentId, businessAt, recordAsOf });
            assert.equal(target.isWithinDeclaredPeriod, containsTarget);
            const targetSemantic = await f.semantics().getAssignmentSemanticsAsOf({ ...f.scope, assignmentId: result.targetAssignmentId, businessAt, recordAsOf });
            assert.equal(targetSemantic.businessPeriodContainsPoint, containsTarget);
          } else {
            await assert.rejects(f.closure().getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: result.targetAssignmentId, businessAt, recordAsOf }),
              { message: 'ASSIGNMENT_NOT_KNOWN_AS_OF' });
            await assert.rejects(f.semantics().getAssignmentSemanticsAsOf({ ...f.scope, assignmentId: result.targetAssignmentId, businessAt, recordAsOf }),
              { message: 'ASSIGNMENT_NOT_KNOWN_AS_OF' });
          }
          assertions++;
        }
        cases.push({ start, transferAt, end, transferId: result.transferId, recordFrom: result.transferRecordedFrom, adjacent, businessPoints: points });
      }
      const e = await f.createEngagement(), source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
      const future = '2032-08-01T00:00:00';
      const transfer = await f.transfer().transferAssignment(f.transferCommand(source.coreVersion, { effectiveAt: future }));
      assert.ok(transfer.transferRecordedFrom < future);
      for (const [businessAt, expected] of [[Jul, transfer.sourceClosureVersionId], [future, transfer.targetAdmissionVersionId]] as const) {
        const primary = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: e.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION',
          scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt, recordAsOf: transfer.transferRecordedFrom });
        assert.equal(primary.selectedAssignmentVersionId, expected); assertions++;
      }
      return { algorithm: 'integer-microsecond half-open finite-set membership with explicit null infinity', cases, assertions, futureTransfer: transfer.transferId };
    });
  await check(['BT-03'], 'A deliberate database delay between source closure and target admission produces no knowledge gap', async () => {
    const e = await f.createEngagement(), source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
    let slept = false; let afterDelay = '';
    const result = await database.transaction().execute(async tx => {
      const observed = afterTransferInsert('audit_event', 'PERSON_ASSIGNMENT_ENDED', async () => {
        await sql`select pg_sleep(0.15)`.execute(tx);
        afterDelay = (await sql<{ now: string }>`select platform.local_now() as now`.execute(tx)).rows[0]!.now; slept = true;
      });
      return (await createAssignmentScope(tx.withPlugin(observed), f.context())).transfer.transferAssignment(f.transferCommand(source.coreVersion));
    });
    assert.ok(result.ok); assert.ok(slept); assert.ok(afterDelay > result.value.transferRecordedFrom);
    assert.equal(result.value.targetAdmission.recordedFrom, result.value.sourceClosure.recordedFrom);
    const p = await f.semantics().resolvePrimaryAffiliation({ ...f.scope, engagementId: e.engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION',
      scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt: Aug, recordAsOf: afterDelay });
    assert.equal(p.selectedAssignmentVersionId, result.value.targetAdmissionVersionId);
    return { deliberateDatabaseDelaySeconds: 0.15, afterDelay, transfer: result.value.transferId, knowledgeTime: result.value.transferRecordedFrom };
  });
  await check(['BT-08', 'RQ-07'], 'A to B to C uses separate exact receipts and later target correction never changes the original transfer result', async () => {
    const e = await f.createEngagement(), source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId));
    const firstCommand = f.transferCommand(source.coreVersion);
    const first = await f.transfer().transferAssignment(firstCommand);
    const revised = await f.semantics().reviseClassifiedAssignmentPeriod({ ...f.scope, assignmentId: first.targetAssignmentId,
      expectedCurrentVersionId: first.targetAdmissionVersionId, businessValidFrom: Aug, businessValidTo: '2030-01-01T00:00:00', reasonCode: 'VALIDITY_CORRECTION' });
    assert.deepEqual(await f.transfer().getAssignmentTransfer({ ...f.scope, transferId: first.transferId }), first);
    assert.deepEqual(await f.transfer(first.rootRequestId).transferAssignment(firstCommand), first);
    const second = await f.transfer().transferAssignment(f.transferCommand(revised.coreVersion, { effectiveAt: Dec,
      targetPlacement: { ...f.transferCommand(source.coreVersion).targetPlacement, departmentId: f.department.departmentId } }));
    assert.equal(second.sourcePreviousVersionId, revised.coreVersion.assignmentVersionId);
    assert.deepEqual(await f.transfer().getAssignmentTransfer({ ...f.scope, transferId: first.transferId }), first);
    assert.deepEqual(await f.transfer().getAssignmentTransfer({ ...f.scope, transferId: second.transferId }), second);
    assert.deepEqual(await f.transfer(first.rootRequestId).transferAssignment(firstCommand), first);
    assert.equal(first.targetAdmission.businessValidTo, null); assert.equal(second.sourceOriginalPeriod.to, '2030-01-01T00:00:00');
    assert.equal(first.sourceOriginalPeriod.from, Jan);
    return { first: first.transferId, intermediateRevision: revised.coreVersion.assignmentVersionId, second: second.transferId };
  });
}
