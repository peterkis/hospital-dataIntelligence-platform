import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Insertable, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import type { AssignmentVersion, CreateAssignment } from '../../apps/governance-api/src/modules/person-master/index.js';
import { createDepartmentPlacementReferenceScope } from '../../apps/governance-api/src/modules/department-master/index.js';
import { createAuthorizationModule } from '../../apps/governance-api/src/modules/authorization/index.js';
import { assignmentScope, Jan, Jul, Aug, Dec, type createAssignmentFixture } from './person-assignment-fixture.js';

type Fixture = Awaited<ReturnType<typeof createAssignmentFixture>>;
type Check = (ids: string[], name: string, work: () => Promise<unknown>) => Promise<void>;
const ROLLBACK = new Error('C01_EXPECTED_PROBE_ROLLBACK');
export async function runAssignmentConstraints(database: Kysely<DB>, f: Fixture,
  command: (engagementId: string, from?: string, to?: string | null, departmentId?: string) => CreateAssignment,
  keep: (v: AssignmentVersion) => AssignmentVersion,
  check: Check) {
  const e = await f.createEngagement(), v = keep(await f.app().createAssignment(command(e.engagementId)));
  const sourceStable = await database.selectFrom('person_master.assignment').selectAll().where('assignment_id', '=', v.assignmentId).executeTakeFirstOrThrow();
  const sourceVersion = await database.selectFrom('person_master.assignment_version').selectAll().where('assignment_version_id', '=', v.assignmentVersionId).executeTakeFirstOrThrow();
  const sourceSegments = await database.selectFrom('person_master.assignment_validation_segment').selectAll().where('assignment_version_id', '=', v.assignmentVersionId).execute();
  const other = await f.createEngagement(), otherDepartment = await f.createDepartment('CONSTRAINT-OTHER');
  const otherEvent = await f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: other.engagementId,
    expectedLifecycleSequence: '0', businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C01_PAIRING' });

  async function probe(work: (tx: Transaction<DB>) => Promise<void>, expected: string | null) {
    let observed: { code: string; message: string } | null = null;
    try {
      await database.transaction().execute(async tx => {
        await work(tx); await sql`set constraints all immediate`.execute(tx); throw ROLLBACK;
      });
    } catch (error) {
      if (error !== ROLLBACK) {
        assert.ok(error !== null && typeof error === 'object' && 'code' in error, 'REAL_POSTGRES_CONSTRAINT_ERROR_REQUIRED');
        observed = { code: String(error.code), message: error instanceof Error ? error.message : 'POSTGRES_ERROR' };
      }
    }
    if (expected === null) assert.equal(observed, null, 'VALID_STRUCTURAL_CONTROL_FAILED');
    else { assert.ok(observed, 'SQL_NEGATIVE_WAS_ACCEPTED'); assert.match(observed.code, new RegExp(expected)); }
    return observed ?? { code: 'ROLLED_BACK_VALID_CONTROL', message: 'VALID_CONTROL' };
  }
  async function candidate(tx: Transaction<DB>, options: {
    stable?: Partial<Insertable<DB['person_master.assignment']>>;
    version?: Partial<Insertable<DB['person_master.assignment_version']>>;
    segments?: readonly { from: string; to: string | null; no: number; eventId?: string; sequence?: string }[];
    omitVersion?: boolean; omitOutcome?: boolean;
  } = {}) {
    const request = randomUUID();
    const { assignment_id: ignoredStableId, created_at: ignoredCreated, ...stableFields } = sourceStable;
    void ignoredStableId; void ignoredCreated;
    const stable = await tx.insertInto('person_master.assignment').values({ ...stableFields,
      creation_request_id: request, ...options.stable }).returningAll().executeTakeFirstOrThrow();
    if (options.omitVersion) return;
    const { assignment_version_id: ignoredVersionId, business_period: ignoredPeriod, recorded_from: ignoredRecorded,
      ...versionFields } = sourceVersion;
    void ignoredVersionId; void ignoredPeriod; void ignoredRecorded;
    const version = await tx.insertInto('person_master.assignment_version').values({ ...versionFields,
      assignment_id: stable.assignment_id, request_id: request, recorded_from: sql<string>`platform.local_now()`, ...options.version,
    }).returningAll().executeTakeFirstOrThrow();
    const segments = options.segments ?? sourceSegments.map(s => ({ from: s.business_valid_from, to: s.business_valid_to,
      no: s.segment_no, eventId: s.last_applicable_lifecycle_event_id ?? undefined, sequence: s.lifecycle_sequence }));
    if (segments.length) await tx.insertInto('person_master.assignment_validation_segment').values(segments.map(s => ({
      assignment_version_id: version.assignment_version_id, engagement_id: version.engagement_id, segment_no: s.no,
      business_valid_from: s.from, business_valid_to: s.to, business_state: 'ACTIVE',
      last_applicable_lifecycle_event_id: s.eventId ?? null, lifecycle_sequence: s.sequence ?? '0',
    }))).execute();
    if (!options.omitOutcome) await tx.insertInto('person_master.assignment_command_outcome').values({
      governance_object_id: version.governance_object_id, request_id: request, created_by: version.created_by,
      operation_type: 'CREATE', operation_hash: version.operation_hash, assignment_version_id: version.assignment_version_id,
      rejection_code: null,
    }).execute();
  }
  await check(['DB-02', 'ID-03'], 'real cross-Person, authority-version, Department and lifecycle reference pairs reject', async () => {
    const controls = await probe(tx => candidate(tx), null);
    const negatives = [];
    negatives.push(await probe(tx => candidate(tx, { stable: { person_id: other.personId } }), '23503'));
    negatives.push(await probe(tx => candidate(tx, { stable: { department_governance_object_id: assignmentScope.governanceObjectId } }), '23503'));
    negatives.push(await probe(tx => candidate(tx, { version: { authority_engagement_version_id: other.engagementVersionId } }), '23503'));
    negatives.push(await probe(tx => candidate(tx, { version: { department_version_id: otherDepartment.departmentVersionId } }), '23503'));
    negatives.push(await probe(tx => candidate(tx, { version: { department_release_id: otherDepartment.departmentId } }), '23503'));
    negatives.push(await probe(tx => candidate(tx, { version: { record_visible_lifecycle_sequence: '1' },
      segments: [{ from: Jul, to: Dec, no: 1, eventId: otherEvent.engagementLifecycleEventId, sequence: '1' }] }), '23503'));
    return { controls, negatives };
  });
  await check(['DB-03'], 'deferred guards reject orphan stable, empty/gapped/overlapping/unordered segments and absent outcome', async () => {
    const cases = [
      { omitVersion: true }, { segments: [] }, { omitOutcome: true },
      { segments: [{ from: Jul, to: Aug, no: 1 }] },
      { segments: [{ from: Jul, to: Aug, no: 1 }, { from: '2026-08-01T00:00:00.000001', to: Dec, no: 2 }] },
      { segments: [{ from: Jul, to: '2026-08-01T00:00:00.000001', no: 1 }, { from: Aug, to: Dec, no: 2 }] },
      { segments: [{ from: Jul, to: Aug, no: 2 }, { from: Aug, to: Dec, no: 1 }] },
    ];
    const outcomes = [];
    for (const c of cases) outcomes.push(await probe(tx => candidate(tx, c), '23514'));
    return outcomes;
  });
  await check(['DB-04'], 'immutable tables reject update/delete/truncate and enforce version and record sequence', async () => {
    const outcomes = [];
    for (const [table, key, id, column] of [
      ['person_master.assignment', 'assignment_id', v.assignmentId, 'placement_scope'],
      ['person_master.assignment_version', 'assignment_version_id', v.assignmentVersionId, 'version_no'],
      ['person_master.assignment_validation_segment', 'assignment_version_id', v.assignmentVersionId, 'segment_no'],
      ['person_master.assignment_command_outcome', 'assignment_version_id', v.assignmentVersionId, 'operation_type'],
    ] as const) {
      outcomes.push(await probe(async tx => { await sql`update ${sql.table(table)} set ${sql.ref(column)}=${sql.ref(column)} where ${sql.ref(key)}=${id}::uuid`.execute(tx); }, '55000'));
      outcomes.push(await probe(async tx => { await sql`delete from ${sql.table(table)} where ${sql.ref(key)}=${id}::uuid`.execute(tx); }, '55000'));
    }
    // Include C02/C0301 FK dependents so this still reaches the immutable trigger,
    // rather than stopping earlier at PostgreSQL's TRUNCATE dependency check.
    outcomes.push(await probe(async tx => { await sql`truncate person_master.assignment,person_master.assignment_version,
      person_master.assignment_validation_segment,person_master.assignment_command_outcome,
      person_master.assignment_version_semantics,person_master.assignment_closure_evidence,person_master.assignment_transfer,
      person_master.assignment_temporary_source`.execute(tx); }, '55000'));
    outcomes.push(await probe(tx => candidate(tx, { version: { version_no: '2' } }), '23514'));
    outcomes.push(await probe(tx => candidate(tx, { version: { recorded_from: Jan } }), '23514'));
    outcomes.push(await probe(tx => candidate(tx, { version: { evaluation_record_as_of: Jan } }), '23514'));
    outcomes.push(await probe(tx => candidate(tx, { version: { classification_type_version_no: null } }), '23514'));
    outcomes.push(await probe(tx => candidate(tx, { version: { classified_at: null } }), '23514'));
    outcomes.push(await probe(tx => candidate(tx, { version: { business_valid_to: null, authority_engagement_valid_to: Dec } }), '23514'));
    return outcomes;
  });
  await check(['EV-08', 'SC-08'], 'read-only assessment and Assignment commands leave upstream facts untouched', async () => {
    const sourceBefore = await database.selectFrom('person_master.engagement_version').selectAll().where('engagement_id', '=', e.engagementId).execute();
    const departmentBefore = await database.selectFrom('department_master.department_version').selectAll().where('department_id', '=', sourceStable.department_id).execute();
    const count = async () => (await sql<{ n: string }>`select
      (select count(*) from person_master.assignment)+(select count(*) from person_master.assignment_version)+
      (select count(*) from person_master.assignment_validation_segment)+(select count(*) from person_master.assignment_command_outcome) as n`.execute(database)).rows[0]!.n;
    const before = await count();
    const assessment = await f.app().assessAssignmentDependencies({ ...assignmentScope, assignmentId: v.assignmentId,
      assignmentVersionId: v.assignmentVersionId, recordAsOf: await f.now() });
    assert.equal(assessment.constraintResult, 'SATISFIED'); assert.equal(await count(), before);
    assert.deepEqual(await database.selectFrom('person_master.engagement_version').selectAll().where('engagement_id', '=', e.engagementId).execute(), sourceBefore);
    assert.deepEqual(await database.selectFrom('department_master.department_version').selectAll().where('department_id', '=', sourceStable.department_id).execute(), departmentBefore);
    return { assignmentBusinessCountBefore: before, assignmentBusinessCountAfter: await count(), upstreamFactsUnchanged: true };
  });
  await check(['DP-07'], 'rollback-only ambiguous Department reference fixture fails closed without composing periods', async () => {
    // Deliberately malformed source configuration, never a claimed workflow publication.
    // It uses disjoint business periods permitted by the source exclusion constraint.
    let refusal = false;
    try {
      await database.transaction().setIsolationLevel('repeatable read').execute(async tx => {
        const original = await tx.selectFrom('department_master.department_version').selectAll()
          .where('department_version_id', '=', sourceVersion.department_version_id).executeTakeFirstOrThrow();
        const publication = await tx.selectFrom('department_master.department_published_projection').selectAll()
          .where('department_version_id', '=', original.department_version_id).executeTakeFirstOrThrow();
        const release = await tx.selectFrom('release_distribution.governance_release').selectAll()
          .where('release_id', '=', publication.published_release_id).executeTakeFirstOrThrow();
        const { release_id: ignoredRelease, ...releaseFields } = release; void ignoredRelease;
        const last = await tx.selectFrom('release_distribution.governance_release').select('release_no')
          .where('governance_object_id', '=', release.governance_object_id).orderBy('release_no', 'desc').limit(1).executeTakeFirstOrThrow();
        const clonedRelease = await tx.insertInto('release_distribution.governance_release').values({ ...releaseFields,
          release_no: String(BigInt(last.release_no) + 1n), change_reason: 'SYNTHETIC C01 ROLLBACK ONLY INVALID REFERENCE FIXTURE' })
          .returning('release_id').executeTakeFirstOrThrow();
        const { department_version_id: ignoredVersion, business_period: ignoredBusiness, recorded_period: ignoredRecord,
          ...versionFields } = original; void ignoredVersion; void ignoredBusiness; void ignoredRecord;
        const clonedVersion = await tx.insertInto('department_master.department_version').values({ ...versionFields,
          version_no: String(BigInt(original.version_no) + 1n), release_id: clonedRelease.release_id,
          business_valid_from: '2025-01-01T00:00:00', business_valid_to: Jan,
        }).returning('department_version_id').executeTakeFirstOrThrow();
        const { department_published_projection_id: ignoredProjection, updated_at: ignoredProjectionUpdate,
          ...projectionFields } = publication; void ignoredProjection; void ignoredProjectionUpdate;
        await tx.insertInto('department_master.department_published_projection').values({ ...projectionFields,
          department_version_id: clonedVersion.department_version_id, published_release_id: clonedRelease.release_id,
          campuses: sql`${JSON.stringify(publication.campuses)}::jsonb`,
          hierarchies: sql`${JSON.stringify(publication.hierarchies)}::jsonb`,
          superseded_at: '2100-01-01T00:00:00', created_at: sql<string>`platform.local_now()`,
        }).execute();
        const reader = createDepartmentPlacementReferenceScope(tx, createAuthorizationModule(tx, f.context()), async objectId => {
          const scope = await tx.selectFrom('platform.governance_object').select(['object_type', 'status'])
            .where('governance_object_id', '=', objectId).executeTakeFirstOrThrow();
          assert.equal(scope.object_type, 'DEPARTMENT_MASTER'); assert.equal(scope.status, 'ACTIVE');
        });
        const recordAsOf = (await sql<{ now: string }>`select platform.local_now() as now`.execute(tx)).rows[0]!.now;
        await assert.rejects(reader.getDepartmentPlacementReferenceAsOf({ departmentGovernanceObjectId: sourceStable.department_governance_object_id,
          departmentId: sourceStable.department_id, recordAsOf }), { message: 'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED' });
        refusal = true;
        await sql`set constraints all immediate`.execute(tx);
        throw ROLLBACK;
      });
    } catch (error) { if (error !== ROLLBACK) throw error; }
    assert.equal(refusal, true);
    return { fixtureMode: 'ROLLBACK_ONLY_AMBIGUOUS_REFERENCE', refusal, sourceRowsCommitted: 0 };
  });
}
