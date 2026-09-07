import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createAssignmentScope } from '../../apps/governance-api/src/composition/create-assignment-application.js';
import type { AssignmentVersion } from '../../apps/governance-api/src/modules/person-master/index.js';
import { Jan, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { ClosureFixture, ClosureCheck } from './person-assignment-closure-fixture.js';

export async function runAssignmentClosureBehavior(database: Kysely<DB>, f: ClosureFixture, check: ClosureCheck) {
  const ref = (v: AssignmentVersion) => ({ ...f.scope, assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId });
  const primary = (engagementId: string, businessAt: string, recordAsOf: string) => f.semantics().resolvePrimaryAffiliation({ ...f.scope,
    engagementId, purposeCode: 'ORGANIZATIONAL_AFFILIATION', scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', businessAt, recordAsOf });

  await check(['TM-02', 'TM-03', 'TM-04', 'TM-05', 'TM-07', 'TM-08', 'ID-07', 'SE-06', 'SE-08', 'SE-09'],
    'Finite contraction, historical equal-end confirmation and future closure retain distinct declared-period facts', async () => {
      const assertions = [];
      for (const [priorEnd, endedAt] of [[Dec, Aug], [Aug, Aug], [null, '2027-02-01T00:00:00']] as const) {
        const engagement = await f.createEngagement();
        const source = await f.app().createAssignment(f.command(engagement.engagementId, { businessValidTo: priorEnd }));
        const oldR = await f.now();
        const closed = await f.closure().endAssignment(f.endCommand(source, endedAt, 'HISTORICAL_END_RECORDED'));
        assert.equal(closed.businessValidFrom, source.businessValidFrom);
        assert.equal(closed.businessValidTo, endedAt);
        assert.ok(closed.recordedFrom > source.recordedFrom);
        assert.equal(closed.closureEvidence.isPeriodPreservingEndConfirmation, priorEnd === endedAt);
        assert.equal(closed.reasonCode, 'LIFECYCLE_END');
        assert.deepEqual(await f.closure().getAssignmentClosure({ ...f.scope, assignmentId: source.assignmentId, closureVersionId: closed.assignmentVersionId }), closed);
        assert.deepEqual(await f.app().getAssignmentVersion(ref(closed)), closed);
        assert.deepEqual(await f.app().listAssignmentVersions({ ...f.scope, assignmentId: source.assignmentId, afterVersionNo: '0', limit: 20 }), [source, closed]);
        const read = (businessAt: string, recordAsOf: string) => f.closure().getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: source.assignmentId, businessAt, recordAsOf });
        const currentR = await f.now();
        assert.equal((await read(Jul, currentR)).isWithinDeclaredPeriod, true);
        assert.equal((await read(endedAt, currentR)).endBoundaryReached, true);
        assert.equal((await read(endedAt, oldR)).explicitClosureKnownAsOf, false);
        await assert.rejects(read(Jul, Jan), { message: 'ASSIGNMENT_NOT_KNOWN_AS_OF' });
        await assert.rejects(f.closure().endAssignment(f.endCommand(closed, endedAt)), { message: 'ASSIGNMENT_ALREADY_CLOSED' });
        assertions.push({ sourceVersion: source.assignmentVersionId, closureVersion: closed.assignmentVersionId, priorEnd, endedAt, oldR, currentR });
      }
      const engagement = await f.createEngagement(), source = await f.app().createAssignment(f.command(engagement.engagementId, { businessValidTo: Aug }));
      for (const [endedAt, message] of [[Jan, 'ASSIGNMENT_CLOSURE_PERIOD_INVALID'], ['2025-12-31T23:59:59.999999', 'ASSIGNMENT_CLOSURE_PERIOD_INVALID'],
        ['2026-08-01T00:00:00.000001', 'ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN']])
        await assert.rejects(f.closure().endAssignment(f.endCommand(source, endedAt!)), { message });
      assert.deepEqual(await f.app().listAssignmentVersions({ ...f.scope, assignmentId: source.assignmentId, afterVersionNo: '0', limit: 20 }), [source]);
      return { assertions, nonExpansionRefusals: 3 };
    });

  await check(['SE-01', 'PR-02', 'PR-03', 'PR-06', 'ID-04'],
    'Raw UNKNOWN survives before its end, releases at the boundary and does not obstruct closing a classified neighbor', async () => {
      const engagement = await f.createEngagement();
      const classified = await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId));
      const raw = await f.app().createAssignment(f.command(engagement.engagementId));
      const oldR = await f.now();
      assert.equal((await primary(engagement.engagementId, Jul, oldR)).resolution, 'UNKNOWN');
      const a = await f.closure().endAssignment(f.endCommand(classified.coreVersion, Aug));
      const b = await f.closure().endAssignment(f.endCommand(raw, Aug));
      assert.equal(b.closureEvidence.semanticInheritance, 'UNCLASSIFIED');
      assert.equal(b.closureEvidence.sourceSemanticsVersionId, null); assert.equal(b.closureEvidence.sourceSemanticFingerprint, null);
      assert.deepEqual(await f.semantics().getAssignmentVersionSemantics(ref(b)), { classification: 'UNCLASSIFIED', assignmentVersionId: b.assignmentVersionId });
      const newR = await f.now();
      const july = await primary(engagement.engagementId, Jul, newR);
      assert.equal(july.resolution, 'UNKNOWN'); assert.equal(july.unclassifiedCandidateCount, 1);
      assert.equal(july.knownPrimaryAssignmentVersionRefs[0]!.assignmentVersionId, a.assignmentVersionId);
      assert.equal((await primary(engagement.engagementId, Aug, newR)).resolution, 'NONE');
      assert.equal((await primary(engagement.engagementId, Dec, oldR)).resolution, 'UNKNOWN');
      await assert.rejects(f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId,
        { businessValidFrom: '2026-07-31T23:59:59.999999' })), { message: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
      const next = await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId, { businessValidFrom: Aug }));
      assert.equal(next.coreVersion.businessValidFrom, Aug);
      return { rawClosure: b.assignmentVersionId, primaryClosure: a.assignmentVersionId, successor: next.coreVersion.assignmentVersionId, oldR, newR };
    });

  await check(['SE-03', 'SE-07', 'PR-08', 'PR-09'],
    'Ended Engagement does not auto-release declarations and closure never turns source assessment into a new admission', async () => {
      const engagement = await f.createEngagement();
      const source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId, { modeCode: 'STANDING_CONCURRENT' }));
      const beforeEnd = await f.now();
      await f.lifecycle().endEngagement({ ...f.scope, engagementId: engagement.engagementId,
        expectedCurrentEngagementVersionId: engagement.engagementVersionId, businessEffectiveAt: Jul, reasonCode: 'SYNTHETIC_C0301_END' });
      const stillDeclared = await f.closure().getAssignmentDeclaredPeriodAsOf({ ...f.scope, assignmentId: source.coreVersion.assignmentId,
        businessAt: Dec, recordAsOf: await f.now() });
      assert.equal(stillDeclared.isWithinDeclaredPeriod, true); assert.equal(stillDeclared.explicitClosureKnownAsOf, false);
      const closed = await f.closure().endAssignment(f.endCommand(source.coreVersion, Aug));
      const inherited = await f.semantics().getAssignmentVersionSemantics(ref(closed));
      assert.ok(inherited.classification === 'CLASSIFIED' && inherited.semanticRole === 'INHERITED_FOR_CLOSURE');
      assert.equal(inherited.mode.code, 'STANDING_CONCURRENT'); assert.equal(inherited.primaryEvaluation, 'NOT_REEVALUATED_NON_EXPANSIVE');
      assert.equal('evaluation' in inherited, false);
      await assert.rejects(f.app().assessAssignmentDependencies({ ...ref(closed), recordAsOf: await f.now() }),
        { message: 'ASSIGNMENT_CLOSURE_NOT_ADMISSION_VERSION' });
      assert.equal((await f.app().assessAssignmentDependencies({ ...ref(source.coreVersion), recordAsOf: beforeEnd })).constraintResult, 'SATISFIED');
      const current = await f.app().assessAssignmentDependencies({ ...ref(source.coreVersion), recordAsOf: await f.now() });
      assert.equal(current.constraintResult, 'NOT_SATISFIED'); assert.equal(current.baselineEvidence.engagement.requestedTo, null);
      await assert.rejects(f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId, { businessValidFrom: Aug })),
        { message: 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED' });
      return { closed: closed.assignmentVersionId, sourceAcceptance: closed.closureEvidence.sourceAcceptanceVersionId, current };
    });

  await check(['SE-04', 'DE-04', 'PR-06', 'SC-06'],
    'Retired current definition and an overlapping UNKNOWN do not require new positive semantic approval for END', async () => {
      const engagement = await f.createEngagement();
      const source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId));
      await f.app().createAssignment(f.command(engagement.engagementId));
      const term = await f.semantics().findAssignmentSemanticTermAsOf({ ...f.scope, dimension: 'PURPOSE', code: 'ORGANIZATIONAL_AFFILIATION', recordAsOf: await f.now() });
      assert.ok(term);
      const rollback = new Error('C0301_OWNED_TERM_PROBE_ROLLBACK');
      let evidence: unknown;
      await assert.rejects(database.transaction().setIsolationLevel('read committed').execute(async tx => {
        const definitions = (await createAssignmentScope(tx, f.context())).definitions;
        const retired = await definitions.appendAssignmentSemanticTermVersion({ ...f.scope, termId: term.termId,
          expectedCurrentVersionId: term.termVersionId, label: 'SYNTHETIC C0301 RETIRED', definitionState: 'RETIRED',
          businessValidFrom: Jan, businessValidTo: Jul, reasonCode: 'RETIREMENT' });
        const refused = await (await createAssignmentScope(tx, f.context())).assignment.reviseClassifiedAssignmentPeriod({ ...f.scope,
          assignmentId: source.coreVersion.assignmentId, expectedCurrentVersionId: source.coreVersion.assignmentVersionId,
          businessValidFrom: Jan, businessValidTo: Aug, reasonCode: 'VALIDITY_CORRECTION' });
        assert.ok(!refused.ok); assert.equal(refused.code, 'ASSIGNMENT_TERM_NOT_APPLICABLE');
        const module = (await createAssignmentScope(tx, f.context())).assignment;
        const outcome = await module.endAssignment(f.endCommand(source.coreVersion, Aug));
        assert.ok(outcome.ok);
        const inherited = await module.readAssignmentSemanticsSnapshot(ref(outcome.value));
        assert.ok(inherited.classification === 'CLASSIFIED' && inherited.semanticRole === 'INHERITED_FOR_CLOSURE');
        assert.deepEqual(inherited.purpose, source.semantics.purpose); assert.deepEqual(inherited.mode, source.semantics.mode);
        assert.equal(inherited.sourceSemanticFingerprint, source.semantics.semanticFingerprint);
        await sql`set constraints all immediate`.execute(tx);
        evidence = { retiredVersion: retired.termVersionId, closureVersion: outcome.value.assignmentVersionId,
          sourceVersion: source.coreVersion.assignmentVersionId, unchangedFrozenPurpose: inherited.purpose.termVersionId,
          transactionProbesPassed: true, committed: false };
        throw rollback;
      }), error => error === rollback);
      assert.deepEqual(await f.semantics().findAssignmentSemanticTermAsOf({ ...f.scope, dimension: 'PURPOSE', code: 'ORGANIZATIONAL_AFFILIATION', recordAsOf: await f.now() }), term);
      assert.deepEqual(await f.app().getAssignmentVersion(ref(source.coreVersion)), source.coreVersion);
      return evidence;
    });

  await check(['PR-07'], 'Closing one relation does not rescan an unrelated candidate set beyond the positive admission budget', async () => {
    const engagement = await f.createEngagement();
    const source = await f.semantics().createClassifiedAssignment(f.classifiedCommand(engagement.engagementId));
    for (let i = 0; i < 65; i++) await f.app().createAssignment(f.command(engagement.engagementId));
    await assert.rejects(primary(engagement.engagementId, Jul, await f.now()), { message: 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT' });
    const closed = await f.closure().endAssignment(f.endCommand(source.coreVersion, Aug));
    assert.equal(closed.recordKind, 'CLOSURE');
    return { otherRawCandidates: 65, closed: closed.assignmentVersionId, bucketCompletenessNotClaimed: true };
  });

  await check(['SC-07', 'DE-08'], 'END preserves Person, Engagement and Department facts and does not create a new stable Assignment', async () => {
    const e = await f.createEngagement(), source = await f.app().createAssignment(f.command(e.engagementId));
    const upstream = async () => (await sql<{ count: number; digest: string }>`select count(*)::int as count,
      encode(digest(string_agg(j,'' order by kind,j),'sha256'),'hex') as digest from (
        select 'person' as kind,to_jsonb(p)::text as j from person_master.person_subject p where person_id=${e.personId}::uuid
        union all select 'person-version',to_jsonb(v)::text from person_master.person_subject_version v where person_id=${e.personId}::uuid
        union all select 'engagement',to_jsonb(v)::text from person_master.engagement v where engagement_id=${e.engagementId}::uuid
        union all select 'engagement-version',to_jsonb(v)::text from person_master.engagement_version v where engagement_id=${e.engagementId}::uuid
        union all select 'lifecycle',to_jsonb(v)::text from person_master.engagement_lifecycle_event v where engagement_id=${e.engagementId}::uuid
        union all select 'department',to_jsonb(v)::text from department_master.department v where department_id=${f.department.departmentId}::uuid
        union all select 'department-version',to_jsonb(v)::text from department_master.department_version v where department_id=${f.department.departmentId}::uuid
        union all select 'department-publication',to_jsonb(v)::text from department_master.department_published_projection v where department_id=${f.department.departmentId}::uuid
      ) source_facts`.execute(database)).rows[0]!;
    const before = await upstream();
    const closed = await f.closure().endAssignment(f.endCommand(source, Aug));
    assert.deepEqual(await upstream(), before);
    const stableIds = await database.selectFrom('person_master.assignment').select('assignment_id').where('engagement_id', '=', e.engagementId).execute();
    assert.deepEqual(stableIds, [{ assignment_id: source.assignmentId }]);
    return { upstream: before, stableCountAfterEnd: stableIds.length, closureVersion: closed.assignmentVersionId };
  });
}
