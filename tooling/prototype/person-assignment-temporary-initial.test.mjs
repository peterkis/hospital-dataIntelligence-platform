import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.ts';
import { createTemporaryAssignmentFixture } from './person-assignment-temporary-fixture.ts';
import { assignmentScope, departmentScope, Jan, Jul, Aug, Dec } from './person-assignment-fixture.ts';

// Public application seam plus immutable database observations explicitly required
// by C04. These tests are recorded on the unchanged C03 runtime before implementation.
const endpoint = new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname, '127.0.0.1');
assert.equal(endpoint.port, '55434');
assert.match(endpoint.pathname, /^\/(hdi_prototype|pv006_c04_[a-f0-9]{32})$/u);
const handle = createDatabase({ connectionString: process.env.DATABASE_URL, max: 4,
  application_name: 'hdi-pv006-c04-initial-tests' });
const db = handle.database;
let fixture, target, factory;
let definitionsBefore;
const definitions = () => db.selectFrom('person_master.assignment_semantic_term_version')
  .selectAll().where('code', '!=', 'SECONDMENT').orderBy('term_version_id').execute();
before(async () => {
  // Guard the reused fixture: retained definitions must already exist; it must
  // never enter its missing-old-definition registration branches on this database.
  definitionsBefore = await definitions();
  if (endpoint.pathname === '/hdi_prototype') for (const code of ['ORGANIZATIONAL_AFFILIATION', 'CLINICAL_PRACTICE', 'TRAINING_LEARNING',
    'PRIMARY_AFFILIATION', 'STANDING_CONCURRENT'])
    assert.ok(definitionsBefore.some(d => d.governance_object_id === assignmentScope.governanceObjectId && d.code === code),
      'C04_RETAINED_OLD_DEFINITION_MISSING');
  fixture = await createTemporaryAssignmentFixture(db, randomUUID());
  target = fixture.target;
  if (fixture.ownership.mode === 'OWNED_FRESH') definitionsBefore = await definitions();
  try {
    const module = await import('../../apps/governance-api/src/composition/create-assignment-temporary-application.ts');
    factory = module.createTemporaryAssignmentApplication;
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
});
after(async () => {
  try { assert.deepEqual(await definitions(), definitionsBefore, 'C04_INITIAL_RED_CHANGED_SHARED_DEFINITIONS'); }
  finally { await handle.close(); }
});
function application(request = randomUUID()) {
  assert.equal(typeof factory, 'function', 'C04_MISSING_SOURCE_LINKED_TEMPORARY_APPLICATION');
  return factory(db, fixture.context(fixture.actor, request));
}
async function source(to = Dec) {
  const engagement = await fixture.createEngagement();
  return fixture.semantics().createClassifiedAssignment(fixture.classifiedCommand(engagement.engagementId,
    { businessValidTo: to }));
}
function command(version) {
  return { ...fixture.scope, sourceAssignmentId: version.assignmentId,
    expectedSourceVersionId: version.assignmentVersionId, targetPlacement: {
      scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId,
      departmentId: target.departmentId }, businessValidFrom: Jul, businessValidTo: Aug,
    reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT' };
}
async function sourceRows(id) {
  return {
    stable: await db.selectFrom('person_master.assignment').selectAll().where('assignment_id', '=', id).execute(),
    versions: await db.selectFrom('person_master.assignment_version').selectAll().where('assignment_id', '=', id).orderBy('version_no').execute(),
    semantics: await db.selectFrom('person_master.assignment_version_semantics').selectAll().where('assignment_id', '=', id).orderBy('assignment_version_id').execute(),
  };
}
test('C04 initial 1: dedicated SECONDMENT creation capability exists', async () => {
  assert.equal(typeof application().createSourceLinkedTemporaryAssignment, 'function');
});
test('C04 initial 2: legal start with tail outside current source period is rejected', async () => {
  const original = await source(Aug);
  const app = application();
  await assert.rejects(app.createSourceLinkedTemporaryAssignment({ ...command(original.coreVersion), businessValidTo: Dec }),
    /ASSIGNMENT_TEMPORARY_SOURCE_PERIOD_NOT_COVERED/u);
});
test('C04 initial 3: temporary creation preserves source rows, full period and PRIMARY', async () => {
  const original = await source();
  const before = await sourceRows(original.coreVersion.assignmentId);
  const result = await application().createSourceLinkedTemporaryAssignment(command(original.coreVersion));
  assert.notEqual(result.targetAssignmentId, original.coreVersion.assignmentId);
  assert.equal(result.targetSemantics.mode.code, 'SECONDMENT');
  assert.deepEqual(await sourceRows(original.coreVersion.assignmentId), before);
  assert.equal(before.versions[0].business_valid_from, Jan);
  assert.equal(before.versions[0].business_valid_to, Dec);
  assert.equal(before.semantics[0].mode_code, 'PRIMARY_AFFILIATION');
});
test('C04 initial 4: generic classified create cannot create a sourceless SECONDMENT', async () => {
  const engagement = await fixture.createEngagement();
  await assert.rejects(fixture.semantics().createClassifiedAssignment(fixture.classifiedCommand(engagement.engagementId,
    { modeCode: 'SECONDMENT', businessValidTo: Aug })), /ASSIGNMENT_MODE_NOT_SUPPORTED_IN_SLICE/u);
});
test('C04 initial 5: late source END leaves child receipt fixed and makes full assessment fail', async () => {
  const original = await source();
  const app = application();
  const result = await app.createSourceLinkedTemporaryAssignment(command(original.coreVersion));
  const before = await sourceRows(result.targetAssignmentId);
  const closed = await fixture.closure().endAssignment(fixture.endCommand(original.coreVersion, Jul));
  const observed = await app.assessTemporaryAssignmentDependencies({ ...fixture.scope,
    targetAssignmentId: result.targetAssignmentId, assignmentVersionId: result.targetAdmissionVersionId,
    recordAsOf: closed.recordedFrom });
  assert.equal(observed.referenceComparison, 'CHANGED');
  assert.equal(observed.constraintResult, 'NOT_SATISFIED');
  assert.deepEqual(await sourceRows(result.targetAssignmentId), before);
  const historical = await app.getTemporaryAssignment({ ...fixture.scope, targetAssignmentId: result.targetAssignmentId });
  assert.deepEqual(historical.sourceLink, result.sourceLink);
});
