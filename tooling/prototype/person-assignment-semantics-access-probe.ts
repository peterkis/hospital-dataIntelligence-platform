import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { assignmentScope, departmentScope, Jan, Jul } from './person-assignment-fixture.js';
import type { SemanticAppFactory, SemanticCheck, SemanticCommandFactory, SemanticFixture } from './person-assignment-semantics-test-support.js';

export async function runAssignmentSemanticAccess(database: Kysely<DB>, f: SemanticFixture,
  app: SemanticAppFactory, command: SemanticCommandFactory, check: SemanticCheck) {
  const writes = ['PERSON_MASTER_ASSIGNMENT_WRITE', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE',
    'PERSON_MASTER_ENGAGEMENT_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'DEPARTMENT_MASTER_PLACEMENT_REFERENCE_READ'];
  const reads = ['PERSON_MASTER_ASSIGNMENT_READ', 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_READ'];
  async function principal(grants: readonly string[], kind = 'PERSON', status = 'ACTIVE') {
    const actor = (await sql<{ id: string }>`select uuidv7() as id`.execute(database)).rows[0]!.id;
    await database.transaction().execute(async tx => {
      await tx.insertInto('platform.security_principal').values({ security_principal_id: actor,
        principal_code: `SYNTHETIC-C02-${actor}`, principal_kind: kind, status }).execute();
      for (const permission of grants) await tx.insertInto('access_control.object_permission_grant').values({
        governance_object_id: permission.startsWith('DEPARTMENT') ? departmentScope.governanceObjectId : assignmentScope.governanceObjectId,
        security_principal_id: actor, permission_code: permission, grant_effect: 'ALLOW', grant_sequence: '1',
        granted_by: f.actor, reason: 'SYNTHETIC C02 ACCESS', valid_from: Jan, valid_to: null, scope_level: 'HOSPITAL', campus_id: null,
      }).execute();
    });
    return actor;
  }
  const e = await f.createEngagement(), c = command(e.engagementId, { modeCode: 'STANDING_CONCURRENT' });
  const request = randomUUID(), writer = await principal([...writes, ...reads]);
  const accepted = await app(request, writer).createClassifiedAssignment(c);
  const reference = { ...assignmentScope, assignmentId: accepted.coreVersion.assignmentId,
    assignmentVersionId: accepted.coreVersion.assignmentVersionId };

  await check(['DF-07', 'TX-13'], 'definition and operational grants remain separate; current authorization precedes replay', async () => {
    const term = await app().findAssignmentSemanticTermAsOf({ ...assignmentScope, dimension: 'PURPOSE',
      code: 'ORGANIZATIONAL_AFFILIATION', recordAsOf: await f.now() });
    assert.ok(term);
    await assert.rejects(app(randomUUID(), writer).appendAssignmentSemanticTermVersion({ ...assignmentScope,
      termId: term.termId, expectedCurrentVersionId: term.termVersionId, label: 'SYNTHETIC', definitionState: 'ENABLED',
      businessValidFrom: Jan, businessValidTo: null, reasonCode: 'LABEL_CORRECTION' }), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    const definitionWriter = await principal(['PERSON_MASTER_ASSIGNMENT_SEMANTIC_DEFINITION_WRITE']);
    await assert.rejects(app(randomUUID(), definitionWriter).createClassifiedAssignment(c), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    for (const missing of writes) {
      const actor = await principal(writes.filter(permission => permission !== missing));
      await assert.rejects(app(randomUUID(), actor).createClassifiedAssignment(c), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    }
    for (const missing of reads) {
      const actor = await principal(reads.filter(permission => permission !== missing));
      await assert.rejects(app(randomUUID(), actor).getAssignmentVersionSemantics(reference), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    }
    for (const [kind, status] of [['SERVICE', 'ACTIVE'], ['PERSON', 'DISABLED']]) {
      const actor = await principal([...writes, ...reads], kind, status);
      await assert.rejects(app(randomUUID(), actor).createClassifiedAssignment(c), { message: 'ASSIGNMENT_HUMAN_ACTOR_REQUIRED' });
    }
    const anotherActor = await principal(writes);
    await assert.rejects(app(request, anotherActor).createClassifiedAssignment(c), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
    await assert.rejects(app().getAssignmentVersionSemantics({ ...reference, governanceObjectId: departmentScope.governanceObjectId }),
      { message: 'ASSIGNMENT_GOVERNANCE_SCOPE_INVALID' });
    await database.insertInto('access_control.object_permission_grant').values({
      governance_object_id: assignmentScope.governanceObjectId, security_principal_id: writer,
      permission_code: 'PERSON_MASTER_ASSIGNMENT_SEMANTICS_WRITE', grant_effect: 'DENY', grant_sequence: '2',
      granted_by: f.actor, reason: 'SYNTHETIC C02 REVOKE', valid_from: Jan, valid_to: null, scope_level: 'HOSPITAL', campus_id: null,
    }).execute();
    await assert.rejects(app(request, writer).createClassifiedAssignment(c), { message: 'OBJECT_PERMISSION_FORBIDDEN' });
    assert.deepEqual(await app(randomUUID(), writer).getAssignmentVersionSemantics(reference), accepted.semantics);
    return { missingWriteGrants: writes, missingReadGrants: reads, revokedReplayDenied: true, actorIsolation: true };
  });

  async function counts() {
    return (await sql<{ stable: string; versions: string; segments: string; semantics: string; outcomes: string }>`select
      (select count(*) from person_master.assignment) as stable,
      (select count(*) from person_master.assignment_version) as versions,
      (select count(*) from person_master.assignment_validation_segment) as segments,
      (select count(*) from person_master.assignment_version_semantics) as semantics,
      (select count(*) from person_master.assignment_command_outcome) as outcomes`.execute(database)).rows[0]!;
  }
  await check(['TX-01', 'TX-02', 'TX-14'], 'faults after either success audit roll back every business row and outcome; read fault propagates', async () => {
    const observations = [];
    for (const hits of [0, 1]) {
      const target = await f.createEngagement();
      const input = command(target.engagementId);
      const { purposeCode, modeCode, ...raw } = input;
      const rawVersion = await f.app().createAssignment(raw);
      const adopted = await app().adoptAssignmentSemantics({ ...assignmentScope, assignmentId: rawVersion.assignmentId,
        expectedCurrentVersionId: rawVersion.assignmentVersionId, purposeCode, modeCode: 'STANDING_CONCURRENT' });
      const rawOther = await f.app().createAssignment(raw);
      const operations = [
        { name: 'CREATE', run: (id: string) => app(id).createClassifiedAssignment({ ...input, modeCode: 'STANDING_CONCURRENT' }) },
        { name: 'ADOPT', run: (id: string) => app(id).adoptAssignmentSemantics({ ...assignmentScope,
          assignmentId: rawOther.assignmentId, expectedCurrentVersionId: rawOther.assignmentVersionId, purposeCode, modeCode: 'STANDING_CONCURRENT' }) },
        { name: 'CORRECT', run: (id: string) => app(id).correctAssignmentSemantics({ ...assignmentScope,
          assignmentId: adopted.coreVersion.assignmentId, expectedCurrentVersionId: adopted.coreVersion.assignmentVersionId,
          purposeCode: 'CLINICAL_PRACTICE', modeCode: 'STANDING_CONCURRENT', reasonCode: 'PURPOSE_CORRECTION' }) },
      ];
      for (const operation of operations) {
        const before = await counts(), id = randomUUID();
        configureControlledPublicationFault('AUDIT_EVENT_WRITTEN', hits);
        try { await assert.rejects(operation.run(id), { message: 'CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN' }); }
        finally { configureControlledPublicationFault(null); }
        assert.deepEqual(await counts(), before);
        assert.equal((await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', id).execute()).length, 0);
        observations.push({ operation: operation.name, hits, allBusinessCountsUnchanged: true, noAudit: true });
      }
    }
    const before = await counts();
    configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
    try { await assert.rejects(app().getAssignmentVersionSemantics(reference), { message: 'CONTROLLED_PUBLICATION_FAULT:AUDIT_EVENT_WRITTEN' }); }
    finally { configureControlledPublicationFault(null); }
    assert.deepEqual(await counts(), before);
    return { observations, readFaultPropagated: true };
  });
}
