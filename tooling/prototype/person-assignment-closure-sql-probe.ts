import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type InsertObject, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { ASSIGNMENT_CLOSURE_POLICY, ASSIGNMENT_CLOSURE_POLICY_DIGEST } from '../../apps/governance-api/src/modules/person-master/index.js';
import { Jan, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { ClosureFixture, ClosureCheck } from './person-assignment-closure-fixture.js';

type Version = Selectable<DB['person_master.assignment_version']>;
type Tx = Transaction<DB>;
const ROLLBACK = new Error('C0301_SQL_PROBE_ROLLBACK');

export async function runAssignmentClosureSql(database: Kysely<DB>, f: ClosureFixture, check: ClosureCheck) {
  const source = await f.app().createAssignment(f.command((await f.createEngagement()).engagementId, { businessValidTo: Dec }));
  const parent = await database.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id', '=', source.assignmentVersionId).executeTakeFirstOrThrow();
  const stable = await database.selectFrom('person_master.assignment').selectAll().where('assignment_id', '=', source.assignmentId).executeTakeFirstOrThrow();
  const segments = await database.selectFrom('person_master.assignment_validation_segment').selectAll().where('assignment_version_id', '=', source.assignmentVersionId).execute();
  const observations: { name: string; code: string; message: string }[] = [];
  async function probe(name: string, work: (tx: Tx) => Promise<unknown>, expected = '23514', isolation: 'read committed' | 'repeatable read' = 'read committed') {
    let observed: { name: string; code: string; message: string } | undefined;
    try {
      await database.transaction().setIsolationLevel(isolation).execute(async tx => {
        await work(tx); await sql`set constraints all immediate`.execute(tx); throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) {
        assert.ok(error && typeof error === 'object' && 'code' in error, `${name}: REAL_POSTGRES_ERROR_REQUIRED`);
        observed = { name, code: String(error.code), message: error instanceof Error ? error.message : 'POSTGRES_ERROR' };
      }
    }
    assert.ok(observed, `${name}: SQL_NEGATIVE_ACCEPTED`); assert.match(observed.code, new RegExp(expected));
    observations.push(observed); return observed;
  }
  async function admission(tx: Tx, changes: Partial<InsertObject<DB, 'person_master.assignment_version'>> = {}) {
    const { assignment_version_id, business_period, recorded_from, ...fields } = parent;
    void assignment_version_id; void business_period; void recorded_from;
    return tx.insertInto('person_master.assignment_version').values({ ...fields, version_no: '2',
      supersedes_assignment_version_id: parent.assignment_version_id, reason_code: 'VALIDITY_CORRECTION',
      recorded_from: sql`platform.local_now()`, request_id: randomUUID(), ...changes }).returningAll().executeTakeFirstOrThrow();
  }
  async function closure(tx: Tx, previous = parent, changes: Partial<InsertObject<DB, 'person_master.assignment_version'>> = {}) {
    return tx.insertInto('person_master.assignment_version').values({ evidence_kind: 'CLOSURE',
      assignment_id: previous.assignment_id, governance_object_id: previous.governance_object_id,
      engagement_id: previous.engagement_id, department_id: previous.department_id,
      version_no: String(BigInt(previous.version_no) + 1n), supersedes_assignment_version_id: previous.assignment_version_id,
      reason_code: 'LIFECYCLE_END', business_valid_from: previous.business_valid_from, business_valid_to: Aug,
      created_by: f.actor, request_id: randomUUID(), operation_hash: Buffer.alloc(32, 3), ...changes,
    }).returningAll().executeTakeFirstOrThrow();
  }
  async function evidence(tx: Tx, version: Version, previous = parent,
    changes: Partial<InsertObject<DB, 'person_master.assignment_closure_evidence'>> = {}) {
    assert.ok(previous.dependency_fingerprint !== null); assert.ok(version.business_valid_to !== null);
    const semantic = await tx.selectFrom('person_master.assignment_version_semantics').selectAll()
      .where('assignment_version_id', '=', previous.assignment_version_id).executeTakeFirst();
    return tx.insertInto('person_master.assignment_closure_evidence').values({
      closure_assignment_version_id: version.assignment_version_id, assignment_id: version.assignment_id, governance_object_id: version.governance_object_id,
      previous_assignment_version_id: previous.assignment_version_id, previous_version_no: previous.version_no,
      previous_business_valid_from: previous.business_valid_from, previous_business_valid_to: previous.business_valid_to,
      ended_at: version.business_valid_to, closure_recorded_from: version.recorded_from, reason_code: 'PLACEMENT_ENDED',
      closure_policy_code: ASSIGNMENT_CLOSURE_POLICY.policyCode, closure_policy_version: 1,
      closure_policy_digest: Buffer.from(ASSIGNMENT_CLOSURE_POLICY_DIGEST, 'hex'), proof_kind: 'NON_EXPANSIVE_CLOSURE',
      is_period_preserving_end_confirmation: previous.business_valid_to === version.business_valid_to,
      source_acceptance_version_id: previous.assignment_version_id, source_acceptance_dependency_fingerprint: previous.dependency_fingerprint,
      source_semantics_version_id: semantic?.assignment_version_id ?? null, source_semantic_fingerprint: semantic?.semantic_fingerprint ?? null,
      semantic_inheritance: semantic ? 'CLASSIFIED' : 'UNCLASSIFIED', created_by: version.created_by,
      request_id: version.request_id, operation_hash: version.operation_hash,
      // These deliberately rejected, rollback-only SQL fixtures are never application results.
      closure_evidence_fingerprint: Buffer.alloc(32, 4), ...changes,
    }).execute();
  }
  const outcome = (tx: Tx, v: Version, operation = 'END') => tx.insertInto('person_master.assignment_command_outcome').values({
    governance_object_id: v.governance_object_id, request_id: v.request_id, created_by: v.created_by,
    operation_type: operation, operation_hash: v.operation_hash, assignment_version_id: v.assignment_version_id, rejection_code: null,
  }).execute();

  await check(['DE-01', 'DE-05', 'DE-07'], 'ADMISSION still rejects each missing required field, partial classifications and empty ACTIVE coverage', async () => {
    const fields = ['validation_policy_code', 'evaluation_record_as_of', 'authority_engagement_version_id', 'authority_engagement_version_no',
      'authority_engagement_recorded_from', 'authority_engagement_valid_from', 'record_visible_lifecycle_sequence', 'department_version_id',
      'department_version_no', 'department_content_hash', 'department_recorded_from', 'department_release_id', 'department_publication_projection_id',
      'department_published_at', 'department_business_status', 'department_valid_from', 'dependency_fingerprint'];
    for (const field of fields) await probe(`admission missing ${field}`, tx => admission(tx, { [field]: null }));
    await probe('admission zero segments', async tx => { await outcome(tx, await admission(tx), 'REVISE'); });
    await probe('admission partial type number', tx => admission(tx, { classification_type_version_no: null }));
    await probe('admission missing classification clock', tx => admission(tx, { classified_at: null }));
    await probe('null record kind', tx => admission(tx, { evidence_kind: sql`null` }), '23502');
    await probe('unknown record kind', tx => admission(tx, { evidence_kind: 'UNKNOWN' }));
    return { requiredFields: fields, observations: observations.slice() };
  });

  await check(['DE-03', 'DE-04', 'DE-06', 'DE-07', 'SE-05'], 'Closure proof rejects forged parent, acceptance, semantics, request and null pairings', async () => {
    const start = observations.length;
    for (const changes of [
      { previous_assignment_version_id: randomUUID() }, { previous_version_no: '99' }, { previous_business_valid_from: Jul },
      { previous_business_valid_to: null }, { ended_at: Dec }, { closure_recorded_from: Jan },
      { source_acceptance_version_id: randomUUID() }, { source_acceptance_dependency_fingerprint: Buffer.alloc(32, 8) },
      { is_period_preserving_end_confirmation: true }, { semantic_inheritance: 'CLASSIFIED' },
      { source_semantics_version_id: randomUUID() }, { source_semantic_fingerprint: Buffer.alloc(32, 7) },
      { assignment_id: randomUUID() }, { request_id: randomUUID() }, { created_by: randomUUID() }, { operation_hash: Buffer.alloc(32, 9) },
    ]) await probe(`invalid raw proof ${Object.keys(changes).join()}`, async tx => evidence(tx, await closure(tx), parent, changes), '23514|23503');
    const classified = await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId));
    const corrected = await f.semantics().correctAssignmentSemantics({ ...f.scope, assignmentId: classified.coreVersion.assignmentId,
      expectedCurrentVersionId: classified.coreVersion.assignmentVersionId, purposeCode: 'CLINICAL_PRACTICE', modeCode: 'PRIMARY_AFFILIATION', reasonCode: 'PURPOSE_CORRECTION' });
    const p = await database.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id', '=', corrected.coreVersion.assignmentVersionId).executeTakeFirstOrThrow();
    const other = await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId));
    for (const changes of [
      { source_semantics_version_id: null }, { source_semantic_fingerprint: null },
      { semantic_inheritance: 'UNCLASSIFIED', source_semantics_version_id: null, source_semantic_fingerprint: null },
      { source_semantics_version_id: classified.coreVersion.assignmentVersionId, source_semantic_fingerprint: Buffer.from(classified.semantics.semanticFingerprint, 'hex') },
      { source_semantics_version_id: other.coreVersion.assignmentVersionId, source_semantic_fingerprint: Buffer.from(other.semantics.semanticFingerprint, 'hex') },
    ]) await probe(`invalid classified proof ${Object.keys(changes).join()}`, async tx => evidence(tx, await closure(tx, p), p, changes));
    return observations.slice(start);
  });

  await check(['DE-05', 'DE-06'], 'Closure completeness is exclusive with positive segments, semantics and admission outcomes', async () => {
    const start = observations.length;
    await probe('closure cannot carry positive policy', tx => closure(tx, parent, { validation_policy_code: 'ASSIGNMENT_DEPARTMENT_CORE_V1' }));
    await probe('closure without proof cannot commit', tx => closure(tx));
    await probe('closure proof cannot attach to admission', async tx => evidence(tx, await admission(tx, { business_valid_to: Aug })));
    await probe('closure has no success outcome', async tx => evidence(tx, await closure(tx)));
    await probe('closure cannot use REVISE outcome', async tx => { const v = await closure(tx); await evidence(tx, v); await outcome(tx, v, 'REVISE'); });
    await probe('closure audit is required', async tx => { const v = await closure(tx); await evidence(tx, v); await outcome(tx, v); });
    await probe('closure cannot have ACTIVE validation segments', async tx => {
      const v = await closure(tx); await evidence(tx, v); await outcome(tx, v);
      await tx.insertInto('person_master.assignment_validation_segment').values(segments.map(s => ({ ...s, assignment_version_id: v.assignment_version_id,
        business_valid_to: Aug }))).execute();
    });
    const classified = await f.semantics().createClassifiedAssignment(f.classifiedCommand((await f.createEngagement()).engagementId));
    const paired = await database.selectFrom('person_master.assignment_version_semantics').selectAll()
      .where('assignment_version_id', '=', classified.coreVersion.assignmentVersionId).executeTakeFirstOrThrow();
    await probe('closure cannot have new positive semantic evaluation', async tx => {
      const v = await closure(tx);
      await tx.insertInto('person_master.assignment_version_semantics').values({ ...paired, assignment_version_id: v.assignment_version_id,
        assignment_id: v.assignment_id, engagement_id: v.engagement_id, request_id: v.request_id, created_by: v.created_by, operation_hash: v.operation_hash }).execute();
    });
    await probe('admission cannot use END outcome', async tx => {
      const v = await admission(tx);
      await tx.insertInto('person_master.assignment_validation_segment').values(segments.map(s => ({ ...s, assignment_version_id: v.assignment_version_id }))).execute();
      await outcome(tx, v);
    });
    return observations.slice(start);
  });

  await check(['DE-02', 'DE-03', 'TM-07', 'TM-08', 'ID-08', 'ID-13'], 'Native closure enforces direct head, finite non-expansion, non-V1 and READ COMMITTED', async () => {
    const start = observations.length;
    for (const change of [{ business_valid_from: Jul }, { business_valid_to: null }, { business_valid_to: Jan },
      { business_valid_to: '2027-01-01T00:00:00' }, { business_valid_to: 'infinity' },
      { supersedes_assignment_version_id: randomUUID() }, { version_no: '3' }])
      await probe(`invalid closure header ${Object.keys(change).join()}`, tx => closure(tx, parent, change));
    await probe('closure cannot be V1', async tx => {
      const { assignment_id, created_at, ...fields } = stable; void assignment_id; void created_at;
      const request = randomUUID();
      const next = await tx.insertInto('person_master.assignment').values({ ...fields, creation_request_id: request }).returningAll().executeTakeFirstOrThrow();
      await closure(tx, parent, { assignment_id: next.assignment_id, request_id: request, version_no: '1', supersedes_assignment_version_id: null });
    });
    await probe('closure RR write prohibited', tx => closure(tx), '0A000', 'repeatable read');
    const ended = await f.closure().endAssignment(f.endCommand(source, Aug));
    await probe('native admission cannot reopen closed head', tx => admission(tx, { version_no: '3', supersedes_assignment_version_id: ended.assignmentVersionId }));
    return observations.slice(start);
  });

  await check(['DE-08', 'DE-09', 'SC-07'], 'Closure and original Assignment tables remain append-only and original accepted JSON is unchanged', async () => {
    const start = observations.length;
    for (const [table, key, value] of [
      ['person_master.assignment', 'assignment_id', source.assignmentId],
      ['person_master.assignment_version', 'assignment_id', source.assignmentId],
      ['person_master.assignment_validation_segment', 'assignment_version_id', source.assignmentVersionId],
      ['person_master.assignment_closure_evidence', 'assignment_id', source.assignmentId],
    ]) {
      await probe(`${table} UPDATE`, tx => sql`update ${sql.table(table!)} set ${sql.ref(key!)}=${value!}::uuid where ${sql.ref(key!)}=${value!}::uuid`.execute(tx), '55000');
      await probe(`${table} DELETE`, tx => sql`delete from ${sql.table(table!)} where ${sql.ref(key!)}=${value!}::uuid`.execute(tx), '55000');
      await probe(`${table} TRUNCATE`, tx => sql`truncate ${sql.table(table!)} cascade`.execute(tx), '55000');
    }
    assert.deepEqual(await f.app().getAssignmentVersion({ ...f.scope, assignmentId: source.assignmentId, assignmentVersionId: source.assignmentVersionId }), source);
    return { observations: observations.slice(start), originalAdmissionUnchanged: true };
  });
  return observations;
}
