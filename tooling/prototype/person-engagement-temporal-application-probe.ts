import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { setTimeout as delay } from 'node:timers/promises';
import { configureControlledPublicationFault } from '../../apps/governance-api/src/platform/fault-injection/controlled-faults.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementPolicyApplication } from '../../apps/governance-api/src/composition/create-engagement-policy-application.js';
import { createEngagementLifecycleApplication, createEngagementEffectiveReader } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { segmentRules, segmentFailure, type TemporalRule } from '../../apps/governance-api/src/modules/person-master/engagement-rule-segments.js';
import type { EngagementEffectiveContext, EngagementOverlapDecision } from '../../apps/governance-api/src/modules/person-master/index.js';
import { personContext, personCreation, PERSON_FIXTURE } from './person-subject-fixture.js';
import { engagementContext } from './person-engagement-fixture.js';
import { engagementPolicyContext } from './person-engagement-policy-fixture.js';
import { engagementLifecycleContext, ENGAGEMENT_LIFECYCLE_FIXTURE } from './person-engagement-lifecycle-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('ENGAGEMENT_TEMPORAL_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 24, connectionTimeoutMillis: 5000,
  application_name: 'hdi-pv006-b04-application' });
const runId = randomUUID();
const directory = `.runtime/pv006-b04/${runId}`;
const checks: Record<string, boolean> = {};
const observations: unknown[] = [];
const recover = process.argv.includes('--recover');
const scope = { governanceObjectId: PERSON_FIXTURE.objectId };
const core = (request = randomUUID()) => createEngagementApplication(handle.database, engagementContext(request));
const policy = () => createEngagementPolicyApplication(handle.database, engagementPolicyContext(randomUUID()));
const lifecycle = () => createEngagementLifecycleApplication(handle.database, engagementLifecycleContext(randomUUID()));
const reader = (actor = ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleCompositeOwnerId as string) =>
  createEngagementEffectiveReader(handle.database, personContext(randomUUID(), actor));
const person = async () => (await createPersonApplication(handle.database, personContext())
  .createPersonSubject({ ...personCreation, facts: { canonicalName: 'SYNTHETIC B04 PERSON', birthDate: null } })).personId;
const create = (personId: string, type: string, from: string, to: string | null, request = randomUUID()) =>
  core(request).createEngagement({ ...scope, personId, engagementTypeCode: type,
    relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS', businessValidFrom: from, businessValidTo: to });
const Jan = '2026-01-01T00:00:00', Jun = '2026-06-01T00:00:00', Jul = '2026-07-01T00:00:00';
const Aug = '2026-08-01T00:00:00', Sep = '2026-09-01T00:00:00';
const old = '2025-01-01T00:00:00';
const futureRecord = '2100-01-01T00:00:00';
type RuleSpec = readonly [string, string | null, EngagementOverlapDecision];
interface RecoveryReceipt {
  task: 'PV-006-B-04'; mode: 'RECOVERY'; runId: string; database: string; databaseOid: string;
  baselineCommit: string;
  endpoint: { host: string; port: string; role: string };
  startedAt: string; contexts: EngagementEffectiveContext[]; versionIds: string[]; versionDigest: string;
  rules: RuleRecovery[];
  auditIds: string[];
  auditDigest: string;
}
interface RuleRecovery {
  key: { governanceObjectId: string; leftEngagementTypeCode: string; rightEngagementTypeCode: string };
  from: string; to: string | null; recordAsOf: string;
  segments: ReturnType<typeof segmentRules>;
}
const recoveryRules: RuleRecovery[] = [];
const contexts: EngagementEffectiveContext[] = [];
const versionIds: string[] = [];
let failure: unknown;
await mkdir(directory, { recursive: false });
try {
  if (recover) await recoverEvidence();
  else await exercise();
} catch (error) { failure = error; process.exitCode = 1; }
finally {
  await handle.close();
  const evidence = { task: 'PV-006-B-04', runId, mode: recover ? 'RECOVERY' : 'APPLICATION',
    classification: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY', timeZone: 'Asia/Shanghai',
    status: failure ? 'FAILED' : 'PASSED', checks, observations, poolClosed: true,
    error: failure instanceof Error ? failure.message.replace(/postgres(?:ql)?:\/\/\S+/gu, '[DATABASE_URL]').slice(0, 500) : null };
  await writeFile(`${directory}/application.json`, JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...evidence, observations: undefined, evidenceDirectory: directory }));
}

async function pair(label: string, rules: readonly RuleSpec[], sameType = false) {
  const a = `B04_${runId.replaceAll('-', '').slice(0, 16).toUpperCase()}_${label}_A`;
  const b = sameType ? a : a.slice(0, -1) + 'B';
  for (const typeCode of new Set([a, b])) await policy().appendEngagementTypeVersion({ ...scope,
    typeCode, expectedCurrentVersionId: null, categoryCode: 'LABOR_OR_HR',
    displayName: 'SYNTHETIC B04 TYPE', businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null });
  const key = { ...scope, leftEngagementTypeCode: a, rightEngagementTypeCode: b };
  const versions = [];
  let prior: string | null = null;
  for (const [businessValidFrom, businessValidTo, decision] of rules) {
    const version = await policy().appendEngagementOverlapRuleVersion({ ...key,
      expectedCurrentVersionId: prior, decision, businessValidFrom, businessValidTo });
    prior = version.engagementOverlapRuleVersionId; versions.push(version);
  }
  return { a, b, key, versions };
}

async function exercise() {
  const marker = await handle.database.selectFrom('platform.governance_object').select('object_code')
    .where('governance_object_id', '=', scope.governanceObjectId).executeTakeFirstOrThrow();
  assert.equal(marker.object_code, 'PROTOTYPE-SYNTHETIC-PERSON-MASTER');
  const vectors: readonly [string, readonly RuleSpec[], string, string | null, string | null][] = [
    ['RP01', [[old, null, 'ALLOW'], [Jul, null, 'FORBID']], Jun, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP02', [[old, null, 'ALLOW'], [Jul, null, 'REVIEW_REQUIRED']], Jun, Sep, 'ENGAGEMENT_OVERLAP_REVIEW_REQUIRED'],
    ['RP03', [[old, Jul, 'ALLOW'], [Aug, null, 'ALLOW']], Jun, Sep, 'ENGAGEMENT_OVERLAP_RULE_MISSING'],
    ['RP04', [[old, Jul, 'ALLOW'], [Jul, Sep, 'ALLOW']], Jun, Sep, null],
    ['RP05', [[old, null, 'FORBID'], [Jun, Sep, 'ALLOW']], Jun, Sep, null],
    ['RP06', [[old, null, 'FORBID'], [Jul, Sep, 'ALLOW']], Jun, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP07', [[old, null, 'ALLOW'], [Jul, Aug, 'FORBID']], Jun, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP09', [[old, null, 'ALLOW'], [Jul, null, 'FORBID']], Jun, Jul, null],
    ['RP10', [[old, null, 'ALLOW'], [Jul, null, 'FORBID']], Jul, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP11', [[old, Sep, 'ALLOW']], Jun, null, 'ENGAGEMENT_OVERLAP_RULE_MISSING'],
    ['RP12', [[old, null, 'ALLOW'], ['2026-07-01T00:00:00.000001', '2026-07-01T00:00:00.000002', 'FORBID']], Jun, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP14', [[old, null, 'ALLOW'], [Jun, Sep, 'FORBID'], [Jul, Aug, 'ALLOW']], Jun, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP16', [[Jun, Jul, 'REVIEW_REQUIRED'], [Aug, Sep, 'FORBID']], Jun, Sep, 'ENGAGEMENT_OVERLAP_FORBIDDEN'],
    ['RP13', [[old, null, 'ALLOW']], Jun, Sep, null],
  ];
  for (const [id, rules, from, to, error] of vectors) {
    const fixture = await pair(id, rules, id === 'RP13');
    const recordAsOf = fixture.versions.at(-1)!.recordedFrom;
    const candidates: TemporalRule[] = fixture.versions.map(v => ({
      engagement_overlap_rule_id: v.engagementOverlapRuleId,
      engagement_overlap_rule_version_id: v.engagementOverlapRuleVersionId,
      version_no: v.versionNo, decision: v.decision, recorded_from: v.recordedFrom,
      business_valid_from: v.businessValidFrom, business_valid_to: v.businessValidTo }));
    const segments = segmentRules(from, to, recordAsOf, candidates);
    recoveryRules.push({ key: fixture.key, from, to, recordAsOf, segments });
    assert.equal(segmentFailure(segments), error);
    for (const segment of segments) {
      const point = await policy().findEngagementOverlapRuleAsOf({ ...fixture.key,
        leftEngagementTypeCode: fixture.b, rightEngagementTypeCode: fixture.a,
        businessAt: segment.from, recordAsOf });
      assert.equal(point?.engagementOverlapRuleVersionId ?? null, segment.winner?.engagement_overlap_rule_version_id ?? null);
      assert.equal(point?.decision ?? 'MISSING', segment.decision);
    }
    for (const operation of ['CREATE', 'REVISE'] as const) {
      const personId = await person();
      await create(personId, fixture.a, from, to);
      const candidate = operation === 'REVISE' ? await create(personId, fixture.b, Jan, Jun) : null;
      const before = await allPersonVersions(personId);
      const request = randomUUID();
      const mutation = () => candidate ? core(request).reviseEngagement({ ...scope,
        engagementId: candidate.engagementId, expectedCurrentVersionId: candidate.engagementVersionId,
        businessValidFrom: Jan, businessValidTo: to, reasonCode: 'VALIDITY_CORRECTION' })
        : create(personId, fixture.b, from, to, request);
      if (error) { await assert.rejects(mutation(), { message: error }); assert.deepEqual(await allPersonVersions(personId), before); }
      else { const created = await mutation(); assert.equal(created.businessValidFrom, candidate ? Jan : from); }
      const audit = (await sql<{ event_payload: Record<string, unknown> }>`select event_payload from audit.audit_event
        where request_id=${request} and action in ('PERSON_ENGAGEMENT_OVERLAP_EVALUATED','PERSON_ENGAGEMENT_OVERLAP_REJECTED')`
        .execute(handle.database)).rows;
      assert.equal(audit.length, 1);
      assert.deepEqual(audit[0]!.event_payload['segments'], segments);
      assert.ok(audit[0]!.event_payload['otherAuthorityVersionId']);
      assert.ok(!/CONFIRMED_DISTINCT_RELATION_BASIS|contractNo|employeeNo|identifierValue/u.test(JSON.stringify(audit)));
      observations.push({ id, operation, personId, recordAsOf, segments, error });
    }
    checks[id] = true;
    await writeFile(`${directory}/progress.jsonl`, `${JSON.stringify({ id, status: 'PASSED' })}\n`, { flag: 'a' });
  }
  checks['IN01_IN02_IN03_IN11'] = true;
  await effectiveCases();
  await retryAndConcurrency();
  await policyRaceAndAudit();
  await limitCase();
  const db = await identity();
  const auditIds = (await handle.database.selectFrom('audit.audit_event').select('audit_event_id')
    .where('stable_entity_id', 'in', contexts.map(c => c.engagementId)).execute()).map(r => r.audit_event_id);
  const receipt: RecoveryReceipt = { task: 'PV-006-B-04', mode: 'RECOVERY', runId,
    baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), endpoint: endpoint(),
    database: db.database, databaseOid: db.oid, startedAt: db.started_at,
    contexts, versionIds, versionDigest: await digestVersions(versionIds), rules: recoveryRules,
    auditIds, auditDigest: await digestAudit(auditIds) };
  await writeFile(`${directory}/recovery.json`, JSON.stringify(receipt, null, 2), { flag: 'wx' });
}

async function effectiveCases() {
  const fixture = await pair('EA', [[old, null, 'FORBID']]);
  const v1 = await create(await person(), fixture.a, old, null);
  const v2 = await lifecycle().endEngagement({ ...scope, engagementId: v1.engagementId,
    expectedCurrentEngagementVersionId: v1.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_B04_END' });
  const query = { ...scope, engagementId: v1.engagementId, businessAt: Sep, recordAsOf: v2.recordedFrom };
  const effective = await readAligned(query);
  assert.equal(effective.authorityEngagementVersionId, v2.engagementVersionId);
  assert.equal(effective.businessState, 'ENDED'); assert.equal(effective.isWithinBusinessPeriod, false);
  const assertion = await core().findEngagementPeriodAssertionAsOf(query);
  assert.equal(assertion?.engagementVersionId, v1.engagementVersionId);
  assert.equal(assertion.semanticRole, 'HISTORICAL_ASSERTION');
  const { semanticRole: _, ...legacyShape } = assertion;
  assert.deepEqual(await core().findEngagementAsOf(query), legacyShape);
  const historical = await readAligned({ ...query, recordAsOf: v1.recordedFrom });
  assert.equal(historical.authorityEngagementVersionId, v1.engagementVersionId);
  assert.equal(historical.isWithinBusinessPeriod, true);
  contexts.push(effective, historical); versionIds.push(v1.engagementVersionId, v2.engagementVersionId);
  await create(v1.personId, fixture.b, Aug, null);
  checks['EA01_EA02_EA10_EA12_IN06'] = true;

  const initial = await create(await person(), fixture.a, old, null);
  const correction = await core().reviseEngagement({ ...scope, engagementId: initial.engagementId,
    expectedCurrentVersionId: initial.engagementVersionId, businessValidFrom: '2025-03-01T00:00:00',
    businessValidTo: '2025-12-01T00:00:00', reasonCode: 'VALIDITY_CORRECTION' });
  for (const [businessAt, state] of [['2025-02-01T00:00:00', 'PLANNED'], ['2025-12-01T00:00:00', 'ENDED']] as const) {
    const e = await readAligned({ ...scope, engagementId: initial.engagementId, businessAt, recordAsOf: correction.recordedFrom });
    assert.equal(e.businessState, state); assert.equal(e.isWithinBusinessPeriod, false);
    assert.equal(e.authorityEngagementVersionId, correction.engagementVersionId); contexts.push(e);
    assert.equal((await reader().getEngagementEffectiveAsOf({ ...scope, engagementId: initial.engagementId,
      businessAt, recordAsOf: initial.recordedFrom })).isWithinBusinessPeriod, true);
  }
  checks['EA03_EA04'] = true;
  const errorEnd = await create(await person(), fixture.a, Jan, Jun);
  const fixedEnd = await core().reviseEngagement({ ...scope, engagementId: errorEnd.engagementId,
    expectedCurrentVersionId: errorEnd.engagementVersionId, businessValidFrom: Jan, businessValidTo: Aug,
    reasonCode: 'VALIDITY_CORRECTION' });
  const prior = await readAligned({ ...scope, engagementId: errorEnd.engagementId, businessAt: Jul, recordAsOf: errorEnd.recordedFrom });
  const corrected = await readAligned({ ...scope, engagementId: errorEnd.engagementId, businessAt: Jul, recordAsOf: fixedEnd.recordedFrom });
  assert.equal(prior.businessState, 'ENDED'); assert.equal(corrected.businessState, 'ACTIVE');
  assert.notEqual(prior.authorityEngagementVersionId, corrected.authorityEngagementVersionId);
  contexts.push(prior, corrected); checks['EA05'] = true;

  const micro = await create(await person(), fixture.a, '2026-07-01T00:00:00.000001', '2026-07-01T00:00:00.000002');
  assert.equal((await reader().getEngagementEffectiveAsOf({ ...scope, engagementId: micro.engagementId,
    businessAt: micro.businessValidFrom, recordAsOf: micro.recordedFrom })).isWithinBusinessPeriod, true);
  assert.equal((await reader().getEngagementEffectiveAsOf({ ...scope, engagementId: micro.engagementId,
    businessAt: micro.businessValidTo!, recordAsOf: micro.recordedFrom })).isWithinBusinessPeriod, false);
  checks['EA06'] = true;
  const active = await create(await person(), fixture.a, Jan, null);
  const suspended = await lifecycle().suspendEngagement({ ...scope, engagementId: active.engagementId,
    businessEffectiveAt: Jul, expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_B04_HOLD' });
  const held = await readAligned({ ...scope, engagementId: active.engagementId, businessAt: Jul, recordAsOf: suspended.recordedAt });
  assert.equal(held.businessState, 'SUSPENDED'); assert.equal(held.isWithinBusinessPeriod, true);
  assert.equal(held.lastApplicableLifecycleEventId, suspended.engagementLifecycleEventId);
  assert.equal(held.recordVisibleLifecycleSequence, '1');
  assert.ok(!('canAssign' in held)); assert.ok(!('canPractice' in held));
  await assert.rejects(create(active.personId, fixture.b, Jul, Sep), { message: 'ENGAGEMENT_OVERLAP_FORBIDDEN' });
  const resumed = await lifecycle().resumeEngagement({ ...scope, engagementId: active.engagementId,
    businessEffectiveAt: Aug, expectedLifecycleSequence: '1', reasonCode: 'SYNTHETIC_B04_RESUME' });
  const restored = await readAligned({ ...scope, engagementId: active.engagementId, businessAt: Aug, recordAsOf: resumed.recordedAt });
  assert.equal(restored.businessState, 'ACTIVE'); assert.equal(restored.isWithinBusinessPeriod, true);
  contexts.push(held, restored); checks['EA07_EA15_IN07'] = true;
  await assert.rejects(reader().getEngagementEffectiveAsOf({ ...query, recordAsOf: old }), { message: 'ENGAGEMENT_NOT_KNOWN_AS_OF' });
  checks['EA08'] = true;
  for (const actor of ['76040000-0000-7000-8000-000000000001', ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
    ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleServiceId, PERSON_FIXTURE.inactiveActorId]) {
    await assert.rejects(reader(actor).getEngagementEffectiveAsOf(query), /OBJECT_PERMISSION_FORBIDDEN|PERSON_HUMAN_ACTOR_REQUIRED/u);
  }
  await assert.rejects(reader().getEngagementEffectiveAsOf({ ...query, governanceObjectId: randomUUID() }), /PERSON_GOVERNANCE_SCOPE_INVALID/u);
  assert.equal((await lifecycle().getEngagementBusinessStateAsOf(query)).businessState, 'ENDED');
  checks['EA13'] = true;
  const backfill = (await sql<{ engagement_id: string; business_valid_from: string; recorded_from: string }>`
    select v.engagement_id,v.business_valid_from,v.recorded_from from person_master.engagement_version v
    join person_master.engagement_classification c on c.engagement_id=v.engagement_id
    where v.recorded_from < c.classified_at order by v.recorded_from limit 1`.execute(handle.database)).rows[0];
  if (backfill) {
    const q = { ...scope, engagementId: backfill.engagement_id, businessAt: backfill.business_valid_from, recordAsOf: backfill.recorded_from };
    assert.equal((await reader().getEngagementEffectiveAsOf(q)).classification, null);
    assert.equal((await core().findEngagementPeriodAssertionAsOf(q))!.engagementTypeVersionId, null);
    checks['EA09'] = true;
  }
}

async function retryAndConcurrency() {
  const fixture = await pair('RETRY', [[old, null, 'ALLOW']]);
  const personId = await person(); await create(personId, fixture.a, Jan, null);
  const request = randomUUID(); const success = await create(personId, fixture.b, Jun, Sep, request);
  const successAudit = await handle.database.selectFrom('audit.audit_event').selectAll()
    .where('request_id', '=', request).orderBy('audit_event_id').execute();
  const denied = await policy().appendEngagementOverlapRuleVersion({ ...fixture.key,
    expectedCurrentVersionId: fixture.versions[0]!.engagementOverlapRuleVersionId,
    decision: 'FORBID', businessValidFrom: Jul, businessValidTo: null });
  const oldPoint = await policy().findEngagementOverlapRuleAsOf({ ...fixture.key, businessAt: Aug, recordAsOf: fixture.versions[0]!.recordedFrom });
  const newPoint = await policy().findEngagementOverlapRuleAsOf({ ...fixture.key, businessAt: Aug, recordAsOf: denied.recordedFrom });
  assert.equal(oldPoint!.decision, 'ALLOW'); assert.equal(newPoint!.decision, 'FORBID');
  const history = [...fixture.versions, denied].map(toTemporalRule);
  for (const recordAsOf of [fixture.versions[0]!.recordedFrom, denied.recordedFrom]) {
    recoveryRules.push({ key: fixture.key, from: Jun, to: Sep, recordAsOf,
      segments: segmentRules(Jun, Sep, recordAsOf, history) });
  }
  assert.deepEqual(await create(personId, fixture.b, Jun, Sep, request), success);
  assert.deepEqual(await handle.database.selectFrom('audit.audit_event').selectAll()
    .where('request_id', '=', request).orderBy('audit_event_id').execute(), successAudit);
  await assert.rejects(createEngagementApplication(handle.database, engagementContext(request, PERSON_FIXTURE.inactiveActorId))
    .createEngagement({ ...scope, personId, engagementTypeCode: fixture.b,
      relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS', businessValidFrom: Jun, businessValidTo: Sep }),
  { message: 'PERSON_HUMAN_ACTOR_REQUIRED' });
  await assert.rejects(create(personId, fixture.b, Jul, Sep, request), { message: 'ENGAGEMENT_OPERATION_CONFLICT' });
  checks['RP08_IN08_IN09'] = true;
  const concurrentPerson = await person();
  const concurrent = await Promise.allSettled([create(concurrentPerson, fixture.a, Jul, Sep), create(concurrentPerson, fixture.b, Jul, Sep)]);
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(r => r.status === 'rejected' && r.reason.message === 'ENGAGEMENT_OVERLAP_FORBIDDEN').length, 1);
  checks['IN04'] = true;
  const separate = await Promise.all([create(await person(), fixture.a, Jul, Sep), create(await person(), fixture.b, Jul, Sep)]);
  assert.notEqual(separate[0].personId, separate[1].personId);
  const adjacent = await person(); await create(adjacent, fixture.a, Jan, Jul); await create(adjacent, fixture.b, Jul, Sep);
  checks['RP15'] = true;
  const endTarget = await create(await person(), fixture.a, Jan, null);
  const q = { ...scope, engagementId: endTarget.engagementId, businessAt: Sep, recordAsOf: futureRecord };
  const views = await Promise.all([...(Array.from({ length: 6 }, () => reader().getEngagementEffectiveAsOf(q))),
    lifecycle().endEngagement({ ...scope, engagementId: endTarget.engagementId,
      expectedCurrentEngagementVersionId: endTarget.engagementVersionId, businessEffectiveAt: Aug, reasonCode: 'SYNTHETIC_B04_RACE' })]);
  for (const view of views) if ('semanticRole' in view) {
    if (view.authorityEngagementVersionId === endTarget.engagementVersionId) {
      assert.equal(view.businessState, 'ACTIVE'); assert.equal(view.authoritativeBusinessValidTo, null);
    } else { assert.equal(view.businessState, 'ENDED'); assert.equal(view.authoritativeBusinessValidTo, Aug); }
  }
  checks['EA14'] = true;
  const eventTarget = await create(await person(), fixture.a, Jan, null);
  const eventQuery = { ...scope, engagementId: eventTarget.engagementId, businessAt: Sep, recordAsOf: futureRecord };
  const beforeEvent = await reader().getEngagementEffectiveAsOf(eventQuery);
  const duringEvent = await Promise.all([
    ...Array.from({ length: 6 }, () => reader().getEngagementEffectiveAsOf(eventQuery)),
    lifecycle().suspendEngagement({ ...scope, engagementId: eventTarget.engagementId,
      businessEffectiveAt: Aug, expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_B04_EVENT_RACE' }),
  ]);
  const afterEvent = await reader().getEngagementEffectiveAsOf(eventQuery);
  for (const view of [beforeEvent, ...duringEvent, afterEvent]) if ('semanticRole' in view) {
    assert.equal(view.authorityEngagementVersionId, eventTarget.engagementVersionId);
    if (view.recordVisibleLifecycleSequence === '0') {
      assert.equal(view.businessState, 'ACTIVE'); assert.equal(view.lastApplicableLifecycleEventId, null);
    } else {
      assert.equal(view.recordVisibleLifecycleSequence, '1'); assert.equal(view.businessState, 'SUSPENDED');
      assert.equal(view.lastApplicableLifecycleEventId, afterEvent.lastApplicableLifecycleEventId);
    }
  }
  assert.equal(beforeEvent.recordVisibleLifecycleSequence, '0');
  assert.equal(afterEvent.recordVisibleLifecycleSequence, '1');
  checks['EA14_EVENT_SEQUENCE_SNAPSHOT'] = true;
}

async function limitCase() {
  const fixture = await pair('LIMIT', Array.from({ length: 33 }, () => [old, null, 'ALLOW'] as const));
  const personId = await person(); await create(personId, fixture.a, Jan, null);
  const before = await allPersonVersions(personId);
  await assert.rejects(create(personId, fixture.b, Jun, Sep), { message: 'ENGAGEMENT_TEMPORAL_EVALUATION_LIMIT_EXCEEDED' });
  assert.deepEqual(await allPersonVersions(personId), before); checks['RP17_CANDIDATE_LIMIT'] = true;
  const micro = (n: number) => `2026-07-01T00:00:00.${String(n).padStart(6, '0')}`;
  const fragmented = await pair('SEGMENTLIMIT', Array.from({ length: 32 }, (_, i) =>
    [micro(i * 2 + 1), micro(i * 2 + 2), 'ALLOW'] as const));
  const fragmentedPerson = await person(); await create(fragmentedPerson, fragmented.a, Jan, null);
  await assert.rejects(create(fragmentedPerson, fragmented.b, Jun, Sep), { message: 'ENGAGEMENT_TEMPORAL_EVALUATION_LIMIT_EXCEEDED' });
  checks['RP17_SEGMENT_LIMIT'] = true;
  const budget = await pair('AUDITLIMIT', Array.from({ length: 20 }, (_, i) =>
    [micro(i * 2), micro(i * 2 + 1), 'ALLOW'] as const));
  // Supply a same-type ALLOW so all existing relations are legal to create.
  await policy().appendEngagementOverlapRuleVersion({ ...scope,
    leftEngagementTypeCode: budget.a, rightEngagementTypeCode: budget.a,
    expectedCurrentVersionId: null, decision: 'ALLOW', businessValidFrom: old, businessValidTo: null });
  const crowded = await person();
  for (let i = 0; i < 8; i++) await create(crowded, budget.a, Jun, Sep);
  const crowdedBefore = await allPersonVersions(crowded);
  await assert.rejects(create(crowded, budget.b, Jun, Sep), { message: 'ENGAGEMENT_TEMPORAL_EVALUATION_LIMIT_EXCEEDED' });
  assert.deepEqual(await allPersonVersions(crowded), crowdedBefore);
  checks['RP17_AUDIT_BUDGET'] = true;
}

async function policyRaceAndAudit() {
  for (const operation of ['CREATE', 'REVISE'] as const) {
    const fixture = await pair(`RACE${operation}`, [[old, null, 'ALLOW']]);
    const p = await person(); await create(p, fixture.a, Jun, Sep);
    const candidate = operation === 'REVISE' ? await create(p, fixture.b, Jan, Jun) : null;
    let release!: () => void;
    let locked!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { locked = resolve; });
    const blocker = handle.database.transaction().execute(async tx => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`person-engagement-policy:${scope.governanceObjectId}`},0))`.execute(tx);
      locked(); await released;
    });
    await ready;
    const append = policy().appendEngagementOverlapRuleVersion({ ...fixture.key,
      expectedCurrentVersionId: fixture.versions[0]!.engagementOverlapRuleVersionId,
      decision: 'FORBID', businessValidFrom: Jul, businessValidTo: null });
    try {
      await waiting('pg_advisory_xact_lock(');
      const mutation = candidate ? core().reviseEngagement({ ...scope, engagementId: candidate.engagementId,
        expectedCurrentVersionId: candidate.engagementVersionId, businessValidFrom: Jan,
        businessValidTo: Sep, reasonCode: 'VALIDITY_CORRECTION' }) : create(p, fixture.b, Jun, Sep);
      const rejected = assert.rejects(mutation, { message: 'ENGAGEMENT_OVERLAP_FORBIDDEN' });
      await waiting('pg_advisory_xact_lock_shared(');
      release(); await blocker; await append; await rejected;
    } finally { release(); await blocker; await append; }
  }
  checks['IN05'] = true;
  const fixture = await pair('AUDITROLLBACK', [[old, Jul, 'ALLOW'], [Jul, null, 'ALLOW']]);
  const p = await person(); await create(p, fixture.a, Jun, Sep);
  const before = await allPersonVersions(p);
  const request = randomUUID();
  configureControlledPublicationFault('AUDIT_EVENT_WRITTEN');
  try { await assert.rejects(create(p, fixture.b, Jun, Sep, request), { message: 'ENGAGEMENT_OPERATION_FAILED' }); }
  finally { configureControlledPublicationFault(null); }
  assert.deepEqual(await allPersonVersions(p), before);
  assert.equal((await handle.database.selectFrom('person_master.engagement').select('engagement_id')
    .where('creation_request_id', '=', request).execute()).length, 0);
  checks['IN10'] = true;
}

async function waiting(fragment: string) {
  for (let i = 0; i < 500; i++) {
    const count = (await sql<{ count: number }>`select count(*)::int as count from pg_stat_activity
      where application_name='hdi-pv006-b04-application' and wait_event='advisory'
        and position(${fragment} in query)>0`.execute(handle.database)).rows[0]!.count;
    if (count > 0) return;
    await delay(10);
  }
  throw new Error('POLICY_RACE_BARRIER_TIMEOUT');
}

async function allPersonVersions(personId: string) {
  return handle.database.selectFrom('person_master.engagement_version').selectAll()
    .where('person_id', '=', personId).orderBy('engagement_version_id').execute();
}
async function readAligned(query: Parameters<ReturnType<typeof reader>['getEngagementEffectiveAsOf']>[0]) {
  const context = await reader().getEngagementEffectiveAsOf(query);
  const state = await lifecycle().getEngagementBusinessStateAsOf(query);
  assert.equal(context.authorityEngagementVersionId, state.engagementVersionId);
  assert.equal(context.businessState, state.businessState);
  assert.equal(context.lastApplicableLifecycleEventId, state.lastApplicableLifecycleEventId);
  assert.equal(context.recordVisibleLifecycleSequence, state.lifecycleSequence);
  return context;
}
async function identity() {
  return (await sql<{ database: string; oid: string; started_at: string }>`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid,
    (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started_at`.execute(handle.database)).rows[0]!;
}
async function digestVersions(ids: string[]) {
  const rows = await handle.database.selectFrom('person_master.engagement_version').selectAll()
    .where('engagement_version_id', 'in', ids).orderBy('engagement_version_id').execute();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
async function digestAudit(ids: string[]) {
  const rows = await handle.database.selectFrom('audit.audit_event').selectAll()
    .where('audit_event_id', 'in', ids).orderBy('audit_event_id').execute();
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}
function toTemporalRule(v: { engagementOverlapRuleId: string; engagementOverlapRuleVersionId: string;
  versionNo: string; recordedFrom: string; decision: EngagementOverlapDecision; businessValidFrom: string; businessValidTo: string | null }): TemporalRule {
  return { engagement_overlap_rule_id: v.engagementOverlapRuleId, engagement_overlap_rule_version_id: v.engagementOverlapRuleVersionId,
    version_no: v.versionNo, recorded_from: v.recordedFrom, decision: v.decision,
    business_valid_from: v.businessValidFrom, business_valid_to: v.businessValidTo };
}
function endpoint() {
  const url = new URL(process.env['DATABASE_URL']!);
  return { host: url.hostname, port: url.port, role: decodeURIComponent(url.username) };
}
async function recoverEvidence() {
  const path = process.env['PERSON_ENGAGEMENT_TEMPORAL_RECEIPT'];
  if (!path) throw new Error('ENGAGEMENT_TEMPORAL_RECEIPT_REQUIRED');
  const receipt = JSON.parse(await readFile(path, 'utf8')) as RecoveryReceipt;
  assert.equal(receipt.task, 'PV-006-B-04'); assert.equal(receipt.mode, 'RECOVERY');
  assert.match(receipt.baselineCommit, /^[a-f0-9]{40}$/u);
  assert.deepEqual(receipt.endpoint, endpoint());
  const db = await identity();
  assert.equal(db.database, receipt.database); assert.equal(db.oid, receipt.databaseOid);
  assert.notEqual(db.started_at, receipt.startedAt, 'ACTUAL_POSTGRESQL_RESTART_REQUIRED');
  for (const expected of receipt.contexts) {
    const query = { ...scope, engagementId: expected.engagementId, businessAt: expected.businessAt, recordAsOf: expected.recordAsOf };
    assert.deepEqual(await readAligned(query), expected);
  }
  assert.equal(await digestVersions(receipt.versionIds), receipt.versionDigest);
  assert.equal(await digestAudit(receipt.auditIds), receipt.auditDigest);
  for (const expected of receipt.rules) {
    const versions = await policy().listEngagementOverlapRuleVersions(expected.key);
    const segments = segmentRules(expected.from, expected.to, expected.recordAsOf, versions.map(toTemporalRule));
    assert.deepEqual(segments, expected.segments);
    for (const segment of segments) {
      const point = await policy().findEngagementOverlapRuleAsOf({ ...expected.key, businessAt: segment.from, recordAsOf: expected.recordAsOf });
      assert.equal(point?.engagementOverlapRuleVersionId ?? null, segment.winner?.engagement_overlap_rule_version_id ?? null);
    }
  }
  checks['RESTART_EFFECTIVE_OLD_NEW_R'] = true;
  checks['RESTART_SEGMENTS_OLD_NEW_R_AUDIT_IMMUTABLE'] = true;
  observations.push({ oldPostmasterStart: receipt.startedAt, newPostmasterStart: db.started_at, contexts: receipt.contexts.length });
}
