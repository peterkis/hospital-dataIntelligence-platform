import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createAssignmentClosureFixture } from './person-assignment-closure-fixture.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { Jan, Jun, Jul, Aug, Dec, departmentScope } from './person-assignment-fixture.js';

// Each test first reaches the missing public factory. In the baseline, all
// subsequent fixture and behavioral assertions are explicitly NOT_REACHED.
async function factory() {
  const path = '../../apps/governance-api/src/composition/create-assignment-effective-period-application.js';
  const module = await import(path);
  assert.equal(typeof module.createAssignmentEffectivePeriodApplication, 'function');
  return module.createAssignmentEffectivePeriodApplication;
}
async function fixture(work: (f: Awaited<ReturnType<typeof createAssignmentClosureFixture>>,
  db: ReturnType<typeof createDatabase>['database'], create: Awaited<ReturnType<typeof factory>>) => Promise<void>) {
  const create = await factory();
  assert.ok(process.env['DATABASE_URL'], 'C05_MANAGED_DATABASE_REQUIRED');
  const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 4 });
  try {
    // Only new cohort facts; existing shared definitions are read and preserved.
    const before = await handle.database.selectFrom('person_master.assignment_semantic_term_version').selectAll().orderBy('term_version_id').execute();
    assert.ok(before.some(row => row.code === 'SECONDMENT'), 'C05_EXISTING_DEFINITIONS_REQUIRED');
    const f = await createAssignmentClosureFixture(handle.database, randomUUID());
    await work(f, handle.database, create);
    assert.deepEqual(await handle.database.selectFrom('person_master.assignment_semantic_term_version').selectAll().orderBy('term_version_id').execute(), before);
  } finally { await handle.close(); }
}

test('SC-02: public effective period factory and read-only contract exist', async () => {
  await factory();
});
test('DC-01: latest CLOSURE never falls back to the old open admission', async () => fixture(async (f, db, create) => {
  const e = await f.createEngagement();
  const v1 = await f.app().createAssignment(f.command(e.engagementId));
  const v2 = await f.closure().endAssignment(f.endCommand(v1, Jul));
  const result = await create(db, f.context()).getAssignmentEffectivePeriodAsOf({ ...f.scope,
    assignmentId: v1.assignmentId, requestedFrom: Aug, requestedTo: Dec, recordAsOf: v2.recordedFrom });
  assert.equal(result.selectedAssignmentVersionId, v2.assignmentVersionId);
  assert.equal(result.declaredCoverage, 'NONE');
  assert.equal(result.structuralDependencies.result, 'NOT_EVALUATED');
}));
test('WP-01: old full assessment fails while an explicit earlier subwindow satisfies', async () => fixture(async (f, db, create) => {
  const e = await f.createEngagement();
  const v1 = await f.app().createAssignment(f.command(e.engagementId, { businessValidTo: Dec }));
  const end = await f.core().reviseEngagement({ ...f.scope, engagementId: e.engagementId,
    expectedCurrentVersionId: e.engagementVersionId, businessValidFrom: Jan, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' });
  const full = await f.app().assessAssignmentDependencies({ ...f.scope, assignmentId: v1.assignmentId,
    assignmentVersionId: v1.assignmentVersionId, recordAsOf: end.recordedFrom });
  assert.equal(full.constraintResult, 'NOT_SATISFIED');
  const result = await create(db, f.context()).getAssignmentEffectivePeriodAsOf({ ...f.scope,
    assignmentId: v1.assignmentId, requestedFrom: Jun, requestedTo: Jul, recordAsOf: end.recordedFrom });
  assert.equal(result.declaredCoverage, 'FULL');
  assert.equal(result.structuralDependencies.result, 'SATISFIED');
}));
test('TS-02: SECONDMENT observes latest stable source without reparenting the immutable link', async () => fixture(async (f, db, create) => {
  await f.grant(f.actor, ['PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE']);
  const e = await f.createEngagement();
  const source = (await f.semantics().createClassifiedAssignment(f.classifiedCommand(e.engagementId, { businessValidTo: Dec }))).coreVersion;
  const target = await f.createDepartment('C05-INITIAL-TARGET');
  const temporary = () => createTemporaryAssignmentApplication(db, f.context());
  const child = await temporary().createSourceLinkedTemporaryAssignment({ ...f.scope,
    sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId,
    targetPlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: target.departmentId },
    businessValidFrom: Jun, businessValidTo: Aug, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' });
  const closed = await f.closure().endAssignment(f.endCommand(source, Jul));
  const result = await create(db, f.context()).getAssignmentEffectivePeriodAsOf({ ...f.scope,
    assignmentId: child.targetAssignmentId, requestedFrom: Jun, requestedTo: Jul, recordAsOf: closed.recordedFrom });
  assert.equal(result.structuralDependencies.result, 'SATISFIED');
  assert.equal(result.observedEvidenceRefs.sourceAssignmentVersionId, closed.assignmentVersionId);
  assert.equal(result.originalEvidenceRefs.sourceAssignmentVersionId, source.assignmentVersionId);
  assert.deepEqual((await temporary().getTemporaryAssignment({ ...f.scope, targetAssignmentId: child.targetAssignmentId })).sourceLink, child.sourceLink);
}));
