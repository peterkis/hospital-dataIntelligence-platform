import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { AssignmentVersion, CreateSourceLinkedTemporaryAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { createTemporaryAssignmentApplication } from '../../apps/governance-api/src/composition/create-assignment-temporary-application.js';
import { createAssignmentTransferApplication } from '../../apps/governance-api/src/composition/create-assignment-transfer-application.js';
import { createAssignmentClosureFixture } from './person-assignment-closure-fixture.js';
import { requireTemporaryFixtureTarget } from './person-assignment-temporary-fixture-guard.js';
import { assignmentScope, departmentScope, Jan, Jul, Aug } from './person-assignment-fixture.js';

export type TemporaryCheck = (ids: string[], name: string, work: () => Promise<unknown>, status?: 'SKIPPED_BY_SCOPE') => Promise<void>;
export type TemporaryFixture = Awaited<ReturnType<typeof createTemporaryAssignmentFixture>>;
export async function createTemporaryAssignmentFixture(database: Kysely<DB>, runId: string) {
  const ownership = await requireTemporaryFixtureTarget(database, 'COHORT');
  const oldDefinitions = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
    .where('code', '!=', 'SECONDMENT').orderBy('term_version_id').execute();
  if (ownership.mode === 'RETAINED') {
    for (const code of ['ORGANIZATIONAL_AFFILIATION', 'CLINICAL_PRACTICE', 'TRAINING_LEARNING', 'PRIMARY_AFFILIATION', 'STANDING_CONCURRENT'])
      assert.ok(oldDefinitions.some(d => d.governance_object_id === assignmentScope.governanceObjectId && d.code === code), 'C04_RETAINED_OLD_DEFINITION_MISSING');
  }
  const observedSecondment = await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
    .where('governance_object_id', '=', assignmentScope.governanceObjectId).where('dimension', '=', 'MODE').where('code', '=', 'SECONDMENT')
    .orderBy('version_no', 'desc').limit(1).executeTakeFirst();
  if (observedSecondment) {
    assert.equal(observedSecondment.label, 'SYNTHETIC SECONDMENT'); assert.equal(observedSecondment.definition_state, 'ENABLED');
    assert.equal(observedSecondment.business_valid_from, Jan); assert.equal(observedSecondment.business_valid_to, null);
    if (ownership.mode === 'RETAINED') assert.equal(observedSecondment.version_no, '1');
  }
  const base = await createAssignmentClosureFixture(database, runId);
  await base.grant(base.actor, ['PERSON_MASTER_ASSIGNMENT_TEMPORARY_CREATE', 'PERSON_MASTER_ASSIGNMENT_TRANSFER']);
  const existing = await base.semantics().findAssignmentSemanticTermAsOf({ ...base.scope, dimension: 'MODE', code: 'SECONDMENT', recordAsOf: await base.now() });
  const definition = existing ?? await base.semantics().registerAssignmentSemanticTerm({ ...base.scope,
    dimension: 'MODE', code: 'SECONDMENT', label: 'SYNTHETIC SECONDMENT', definitionState: 'ENABLED', businessValidFrom: Jan, businessValidTo: null });
  assert.equal(definition.code, 'SECONDMENT'); assert.equal(definition.dimension, 'MODE');
  assert.equal(definition.label, 'SYNTHETIC SECONDMENT'); assert.equal(definition.definitionState, 'ENABLED');
  assert.equal(definition.businessValidFrom, Jan); assert.equal(definition.businessValidTo, null);
  if (ownership.mode === 'RETAINED') {
    assert.equal(definition.versionNo, '1');
    assert.deepEqual(await database.selectFrom('person_master.assignment_semantic_term_version').selectAll()
      .where('code', '!=', 'SECONDMENT').orderBy('term_version_id').execute(), oldDefinitions, 'C04_RETAINED_OLD_DEFINITION_CHANGED');
  }
  const directory = `.runtime/pv006-c04/${runId}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/secondment-seed.json`, JSON.stringify({ task: 'PV-006-C-04', runId, ownership,
    status: existing ? 'ALREADY_EXISTS' : 'CREATED', definition }, null, 2), { flag: 'wx' });
  const target = await base.createDepartment('C04-TARGET');
  const temporaryCommand = (source: AssignmentVersion, changes: Partial<CreateSourceLinkedTemporaryAssignment> = {}): CreateSourceLinkedTemporaryAssignment => ({
    ...base.scope, sourceAssignmentId: source.assignmentId, expectedSourceVersionId: source.assignmentVersionId,
    targetPlacement: { scope: 'DEPARTMENT', departmentGovernanceObjectId: departmentScope.governanceObjectId, departmentId: target.departmentId },
    businessValidFrom: Jul, businessValidTo: Aug, reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT', ...changes });
  return { ...base, target, ownership, definition, temporaryCommand,
    temporary: (requestId: string = randomUUID(), actor = base.actor) => createTemporaryAssignmentApplication(database, base.context(actor, requestId)),
    transfer: (requestId: string = randomUUID(), actor = base.actor) => createAssignmentTransferApplication(database, base.context(actor, requestId)),
  };
}
