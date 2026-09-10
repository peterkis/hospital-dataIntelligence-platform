import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { assignmentScope, Jan, Jul, Aug, Dec } from './person-assignment-fixture.js';
import type { SemanticAppFactory, SemanticCheck, SemanticCommandFactory, SemanticFixture } from './person-assignment-semantics-test-support.js';

/** Observable application contracts, with native range queries as an independent oracle. */
export async function runAssignmentSemanticBehavior(database: Kysely<DB>, f: SemanticFixture,
  app: SemanticAppFactory, command: SemanticCommandFactory, check: SemanticCheck) {
  const e = await f.createEngagement();
  const base = command(e.engagementId);
  const { purposeCode, modeCode, ...raw } = base;
  const reference = (v: { assignmentId: string; assignmentVersionId: string }) => ({ ...assignmentScope,
    assignmentId: v.assignmentId, assignmentVersionId: v.assignmentVersionId });
  const query = (engagementId: string, recordAsOf: string, businessAt = Jul) => ({ ...assignmentScope,
    engagementId, purposeCode, scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS' as const, businessAt, recordAsOf });

  await check(['AS-02', 'AS-03', 'AS-04', 'DF-01', 'DF-06'], 'closed independent axes and bounded policy-only output', async () => {
    const cases = ['doctor', 'nurse', 'director', 'campusId', 'isPrimary', 'recordAsOf', 'sourceAssignmentId', 'override'];
    for (const key of cases) await assert.rejects(app().createClassifiedAssignment({ ...base, [key]: 'SYNTHETIC_CANARY' }),
      { message: 'PERSON_INPUT_INVALID' });
    for (const mode of ['PART_TIME', 'SECONDMENT', 'ROTATION', 'TEMPORARY_SUPPORT', 'UNKNOWN']) {
      await assert.rejects(app().createClassifiedAssignment(JSON.parse(JSON.stringify({ ...base, modeCode: mode }))),
        { message: 'ASSIGNMENT_MODE_NOT_SUPPORTED_IN_SLICE' });
    }
    await assert.rejects(app().createClassifiedAssignment(JSON.parse(JSON.stringify({ ...base, purposeCode: 'doctor' }))),
      { message: 'ASSIGNMENT_UNKNOWN_PURPOSE' });
    await assert.rejects(app().registerAssignmentSemanticTerm({ ...assignmentScope, dimension: 'PURPOSE', code: 'PRIMARY_AFFILIATION',
      label: 'SYNTHETIC', definitionState: 'ENABLED', businessValidFrom: Jan, businessValidTo: null }),
    { message: 'ASSIGNMENT_TERM_WRONG_DIMENSION' });
    const clinical = await app().createClassifiedAssignment({ ...base, purposeCode: 'CLINICAL_PRACTICE' });
    assert.equal(clinical.semantics.classificationScope, 'STRUCTURAL_ASSIGNMENT_SEMANTICS_ONLY');
    assert.equal(clinical.semantics.policyLabel, 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY');
    for (const key of ['canPractice', 'credentialApproval', 'role', 'iam']) assert.equal(key in clinical, false);
    return { extraFieldsRejected: cases, unsupportedModesRejected: 5, clinicalVersion: clinical.coreVersion.assignmentVersionId };
  });

  const rawRequest = randomUUID();
  const rawVersion = await f.app(rawRequest).createAssignment(raw);
  const beforeAdoption = await f.now();
  const adopt = { ...assignmentScope, assignmentId: rawVersion.assignmentId,
    expectedCurrentVersionId: rawVersion.assignmentVersionId, purposeCode, modeCode };
  let adopted: Awaited<ReturnType<ReturnType<SemanticAppFactory>['adoptAssignmentSemantics']>>;
  await check(['HV-01', 'HV-02', 'HV-03', 'HV-05', 'HV-10', 'UK-06'], 'exact raw history, explicit adoption and operation-specific closed inputs', async () => {
    assert.equal((await app().getAssignmentVersionSemantics(reference(rawVersion))).classification, 'UNCLASSIFIED');
    await assert.rejects(app().getAssignmentSemanticsAsOf({ ...assignmentScope, assignmentId: rawVersion.assignmentId,
      businessAt: Jul, recordAsOf: Jan }), { message: 'ASSIGNMENT_NOT_KNOWN_AS_OF' });
    for (const key of ['businessValidFrom', 'placement', 'engagementId']) await assert.rejects(
      app().adoptAssignmentSemantics({ ...adopt, [key]: base[key as keyof typeof base] }),
      { message: key === 'placement' ? 'ASSIGNMENT_INPUT_INVALID' : 'PERSON_INPUT_INVALID' });
    adopted = await app().adoptAssignmentSemantics(adopt);
    assert.notEqual(adopted.coreVersion.assignmentVersionId, rawVersion.assignmentVersionId);
    assert.equal(adopted.coreVersion.businessValidFrom, rawVersion.businessValidFrom);
    assert.equal(adopted.coreVersion.businessValidTo, rawVersion.businessValidTo);
    await assert.rejects(app().adoptAssignmentSemantics(adopt), { message: 'ASSIGNMENT_STALE_VERSION' });
    await assert.rejects(app().adoptAssignmentSemantics({ ...adopt, expectedCurrentVersionId: adopted.coreVersion.assignmentVersionId }),
      { message: 'ASSIGNMENT_ALREADY_CLASSIFIED' });
    const revision = { ...assignmentScope, assignmentId: rawVersion.assignmentId,
      expectedCurrentVersionId: adopted.coreVersion.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Aug,
      reasonCode: 'VALIDITY_CORRECTION' as const };
    await assert.rejects(app().reviseClassifiedAssignmentPeriod({ ...revision, ...{ purposeCode } }), { message: 'PERSON_INPUT_INVALID' });
    await assert.rejects(app().correctAssignmentSemantics({ ...adopt, expectedCurrentVersionId: adopted.coreVersion.assignmentVersionId,
      reasonCode: 'MODE_CORRECTION', ...{ businessValidTo: Aug } }), { message: 'PERSON_INPUT_INVALID' });
    const historical = await app().getAssignmentSemanticsAsOf({ ...assignmentScope, assignmentId: rawVersion.assignmentId,
      businessAt: Jul, recordAsOf: beforeAdoption });
    assert.equal(historical.semantics.classification, 'UNCLASSIFIED');
    return { beforeAdoption, oldVersion: rawVersion.assignmentVersionId, adoptedVersion: adopted.coreVersion.assignmentVersionId };
  });

  await check(['UK-01', 'UK-02', 'UK-03', 'UK-04', 'UK-05', 'PA-04', 'PA-05', 'TX-11', 'TX-12'],
    'unknown is explicit, refusals replay after resolution, request entrypoints cannot be repurposed', async () => {
      const other = await f.createEngagement();
      const c = command(other.engagementId);
      const { purposeCode: ignoredPurpose, modeCode: ignoredMode, ...rawInput } = c;
      void ignoredPurpose; void ignoredMode;
      const rawId = randomUUID();
      const unclassified = await f.app(rawId).createAssignment(rawInput);
      const deniedId = randomUUID();
      await assert.rejects(app(deniedId).createClassifiedAssignment(c), { message: 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' });
      let resolution = await app().resolvePrimaryAffiliation(query(other.engagementId, await f.now()));
      assert.equal(resolution.resolution, 'UNKNOWN'); assert.equal(resolution.knownPrimaryAssignmentVersionRefs.length, 0);
      assert.equal(resolution.selectedAssignmentVersionId, null);
      await app().adoptAssignmentSemantics({ ...assignmentScope, assignmentId: unclassified.assignmentId,
        expectedCurrentVersionId: unclassified.assignmentVersionId, purposeCode, modeCode: 'STANDING_CONCURRENT' });
      await app().createClassifiedAssignment({ ...c, modeCode: 'STANDING_CONCURRENT' });
      assert.equal((await app().resolvePrimaryAffiliation(query(other.engagementId, await f.now()))).resolution, 'NONE');
      await assert.rejects(app(deniedId).createClassifiedAssignment(c), { message: 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' });
      const acceptedId = randomUUID();
      const accepted = await app(acceptedId).createClassifiedAssignment(c);
      assert.equal((await app().resolvePrimaryAffiliation(query(other.engagementId, await f.now()))).resolution, 'UNIQUE');
      const collisionId = randomUUID();
      await assert.rejects(app(collisionId).createClassifiedAssignment(c), { message: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
      const correction = { ...assignmentScope, assignmentId: accepted.coreVersion.assignmentId,
        expectedCurrentVersionId: accepted.coreVersion.assignmentVersionId, purposeCode,
        modeCode: 'STANDING_CONCURRENT' as const, reasonCode: 'MODE_CORRECTION' as const };
      await assert.rejects(app(acceptedId).correctAssignmentSemantics(correction), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
      await app().correctAssignmentSemantics(correction);
      await assert.rejects(app(collisionId).createClassifiedAssignment(c), { message: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
      const replacement = await app().createClassifiedAssignment(c);
      await f.app().createAssignment(rawInput);
      resolution = await app().resolvePrimaryAffiliation(query(other.engagementId, await f.now()));
      assert.equal(resolution.resolution, 'UNKNOWN'); assert.equal(resolution.knownPrimaryAssignmentVersionRefs.length, 1);
      assert.equal(resolution.selectedAssignmentVersionId, null);
      await assert.rejects(app(rawId).createClassifiedAssignment(c), { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
      await assert.rejects(app(rawId).adoptAssignmentSemantics({ ...assignmentScope, assignmentId: unclassified.assignmentId,
        expectedCurrentVersionId: unclassified.assignmentVersionId, purposeCode, modeCode: 'STANDING_CONCURRENT' }),
      { message: 'ASSIGNMENT_OPERATION_CONFLICT' });
      assert.deepEqual(await f.app(rawId).createAssignment(rawInput), unclassified);
      return { refusedRequestId: deniedId, collisionRequestId: collisionId, acceptedVersion: replacement.coreVersion.assignmentVersionId, resolution };
    });

  await check(['PA-06', 'PA-07', 'PA-08'], 'native range oracle verifies touching boundaries, interior microseconds and infinity', async () => {
    const other = await f.createEngagement();
    const tinyFrom = '2026-07-01T00:00:00.000001', tinyTo = '2026-07-01T00:00:00.000002';
    await app().createClassifiedAssignment(command(other.engagementId, { businessValidFrom: tinyFrom, businessValidTo: tinyTo }));
    await assert.rejects(app().createClassifiedAssignment(command(other.engagementId)), { message: 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' });
    const touching = await app().createClassifiedAssignment(command(other.engagementId, { businessValidFrom: tinyTo, businessValidTo: null }));
    const recordAsOf = await f.now();
    for (const point of [Jul, tinyFrom, tinyTo, '9999-12-31T23:59:59.999999']) {
      const oracle = (await sql<{ count: number }>`select count(*)::int as count from (
        select distinct on (assignment_id) assignment_version_id,business_period from person_master.assignment_version
        where engagement_id=${other.engagementId}::uuid and recorded_from<=${recordAsOf}::timestamp
        order by assignment_id,version_no desc) v join person_master.assignment_version_semantics s using(assignment_version_id)
        where v.business_period @> ${point}::timestamp and s.purpose_code=${purposeCode} and s.mode_code='PRIMARY_AFFILIATION'`.execute(database)).rows[0]!.count;
      const value = await app().resolvePrimaryAffiliation(query(other.engagementId, recordAsOf, point));
      assert.equal(value.knownPrimaryAssignmentVersionRefs.length, oracle);
      assert.equal(value.resolution, point === Jul ? 'NONE' : 'UNIQUE');
    }
    return { interiorMicrosecondRejected: true, infiniteVersion: touching.coreVersion.assignmentVersionId, oraclePoints: 4 };
  });

  await check(['PA-03'], 'the same Person may have a primary in each already lawful Engagement', async () => {
    const first = await f.createEngagement();
    const second = await f.createEngagement(Jan, null, first.personId);
    assert.equal(first.personId, second.personId); assert.notEqual(first.engagementId, second.engagementId);
    const a = await app().createClassifiedAssignment(command(first.engagementId));
    const b = await app().createClassifiedAssignment(command(second.engagementId));
    assert.equal((await app().resolvePrimaryAffiliation(query(first.engagementId, await f.now()))).selectedAssignmentVersionId, a.coreVersion.assignmentVersionId);
    assert.equal((await app().resolvePrimaryAffiliation(query(second.engagementId, await f.now()))).selectedAssignmentVersionId, b.coreVersion.assignmentVersionId);
    return { personId: first.personId, firstEngagement: first.engagementId, secondEngagement: second.engagementId };
  });

  const successfulRequest = randomUUID();
  const frozen = await app(successfulRequest).createClassifiedAssignment(command((await f.createEngagement()).engagementId));
  const frozenCommand = command(frozen.semantics.evaluation.bucket.engagementId);
  await check(['DF-02', 'DF-03', 'DF-04', 'DF-05', 'TX-10'], 'latest complete definition, retirement, frozen labels and successful replay', async () => {
    let current = await app().findAssignmentSemanticTermAsOf({ ...assignmentScope, dimension: 'PURPOSE', code: purposeCode, recordAsOf: await f.now() });
    assert.ok(current);
    const original = current;
    const append = async (definitionState: 'ENABLED' | 'RETIRED', businessValidTo: string | null, label: string) => {
      const requestId = randomUUID();
      const input = { ...assignmentScope, termId: current!.termId, expectedCurrentVersionId: current!.termVersionId,
        label, definitionState, businessValidFrom: Jan, businessValidTo, reasonCode: 'APPLICABILITY_CORRECTION' as const };
      const next = await app(requestId).appendAssignmentSemanticTermVersion(input);
      assert.equal(next.supersedesTermVersionId, current!.termVersionId);
      assert.ok(next.recordedFrom > current!.recordedFrom);
      assert.deepEqual(await app(requestId).appendAssignmentSemanticTermVersion(input), next);
      await assert.rejects(app(requestId).appendAssignmentSemanticTermVersion({ ...input, label: 'SYNTHETIC DIFFERENT' }),
        { message: 'ASSIGNMENT_TERM_OPERATION_CONFLICT' });
      current = next;
      return next;
    };
    try {
      await append('ENABLED', Aug, 'SYNTHETIC C02 NARROW');
      await assert.rejects(app().createClassifiedAssignment(command((await f.createEngagement()).engagementId)),
        { message: 'ASSIGNMENT_TERM_NOT_APPLICABLE' });
      const revised = await app().reviseClassifiedAssignmentPeriod({ ...assignmentScope, assignmentId: frozen.coreVersion.assignmentId,
        expectedCurrentVersionId: frozen.coreVersion.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Aug,
        reasonCode: 'VALIDITY_CORRECTION' });
      assert.equal(revised.semantics.purpose.termVersionId, current.termVersionId);
      assert.equal(revised.semantics.purpose.label, 'SYNTHETIC C02 NARROW');
      assert.equal(revised.semantics.purpose.code, frozen.semantics.purpose.code);
      assert.equal(revised.semantics.mode.code, frozen.semantics.mode.code);
      await append('RETIRED', null, 'SYNTHETIC C02 RETIRED');
      await assert.rejects(app().reviseClassifiedAssignmentPeriod({ ...assignmentScope, assignmentId: frozen.coreVersion.assignmentId,
        expectedCurrentVersionId: revised.coreVersion.assignmentVersionId, businessValidFrom: Jul, businessValidTo: Dec,
        reasonCode: 'VALIDITY_CORRECTION' }), { message: 'ASSIGNMENT_TERM_NOT_APPLICABLE' });
      assert.deepEqual(await app().getAssignmentSemanticTermVersion({ ...assignmentScope, termVersionId: original.termVersionId }), original);
      assert.deepEqual(await app().getAssignmentVersionSemantics(reference(frozen.coreVersion)), frozen.semantics);
      const beforeCount = (await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', successfulRequest).execute()).length;
      assert.deepEqual(await app(successfulRequest).createClassifiedAssignment(frozenCommand), frozen);
      assert.equal((await database.selectFrom('audit.audit_event').select('audit_event_id').where('request_id', '=', successfulRequest).execute()).length, beforeCount);
    } finally {
      // Append a restoration of this C02 definition; never update/delete historical rows.
      await append('ENABLED', original.businessValidTo, original.label);
    }
    return { frozenVersion: frozen.coreVersion.assignmentVersionId, frozenTerm: frozen.semantics.purpose.termVersionId,
      restoredHead: current.termVersionId, successfulRequest };
  });

  await check(['PA-12'], 'upstream suspension changes dependency assessment without releasing the declaration', async () => {
    const other = await f.createEngagement();
    const created = await app().createClassifiedAssignment(command(other.engagementId));
    await f.lifecycle().suspendEngagement({ ...assignmentScope, engagementId: other.engagementId, expectedLifecycleSequence: '0',
      businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_C02_SUSPENSION' });
    const recordAsOf = await f.now();
    assert.equal((await app().resolvePrimaryAffiliation(query(other.engagementId, recordAsOf, Aug))).resolution, 'UNIQUE');
    const assessment = await f.app().assessAssignmentDependencies({ ...reference(created.coreVersion), recordAsOf });
    assert.equal(assessment.constraintResult, 'REVIEW_REQUIRED');
    return { declarationVersion: created.coreVersion.assignmentVersionId, constraintResult: assessment.constraintResult };
  });

  await check(['UK-07', 'PA-08'], 'max plus one candidates fails closed without truncating into a unique result', async () => {
    const other = await f.createEngagement();
    const { purposeCode: p, modeCode: m, ...input } = command(other.engagementId); void p; void m;
    for (let index = 0; index < 65; index++) await f.app().createAssignment(input);
    await assert.rejects(app().resolvePrimaryAffiliation(query(other.engagementId, await f.now())),
      { message: 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT' });
    await assert.rejects(app().createClassifiedAssignment(command(other.engagementId)),
      { message: 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT' });
    return { currentCandidateCount: 65, readAndWriteRefused: true };
  });
  const semanticReads = [], primaryReads = [];
  for (const recordAsOf of [beforeAdoption, await f.now()]) {
    const semanticQuery = { ...assignmentScope, assignmentId: rawVersion.assignmentId, businessAt: Jul, recordAsOf };
    semanticReads.push({ query: semanticQuery, value: await app().getAssignmentSemanticsAsOf(semanticQuery) });
    const primaryQuery = query(e.engagementId, recordAsOf);
    primaryReads.push({ query: primaryQuery, value: await app().resolvePrimaryAffiliation(primaryQuery) });
  }
  return { actor: f.actor, beforeAdoption, rawVersion, adopted: adopted!, frozen, successfulRequest, frozenCommand,
    semanticReads, primaryReads };
}
