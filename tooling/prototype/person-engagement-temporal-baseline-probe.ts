import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementPolicyApplication } from '../../apps/governance-api/src/composition/create-engagement-policy-application.js';
import { createEngagementLifecycleApplication } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { personContext, personCreation, PERSON_FIXTURE } from './person-subject-fixture.js';
import { engagementContext } from './person-engagement-fixture.js';
import { engagementPolicyContext } from './person-engagement-policy-fixture.js';
import { engagementLifecycleContext } from './person-engagement-lifecycle-fixture.js';

// Baseline-only evidence: this probe intentionally returns RED when the real
// create path accepts a crossing FORBID. It does not implement the B-04 reader.
const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(baselineCommit, 'fa61dc79f0f4298629e4d5c6340f99455c99be98', 'BASELINE_HEAD_CHANGED');
assert.equal(execFileSync('git', ['diff', 'c1abe02edab1a7ebfc64c207a96e3bfc5526620e', '--',
  'apps/governance-api/src', 'db/migrations'], { encoding: 'utf8' }), '', 'BASELINE_RUNTIME_CHANGED');
if (!process.env['DATABASE_URL']) throw new Error('ENGAGEMENT_TEMPORAL_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const runId = randomUUID();
const evidenceDirectory = `.runtime/pv006-b04/${runId}`;
assert.equal(execFileSync('git', ['check-ignore', `${evidenceDirectory}/baseline.json`],
  { encoding: 'utf8' }).trim(), `${evidenceDirectory}/baseline.json`);
await mkdir(evidenceDirectory, { recursive: false });
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-pv006-b04-baseline', max: 4 });
const records: Record<string, unknown>[] = [];
const evidence: Record<string, unknown> = { task: 'PV-006-B-04', runId, baselineCommit,
  domainAuthorityCommit: 'c1abe02edab1a7ebfc64c207a96e3bfc5526620e',
  classification: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY', timeZone: 'Asia/Shanghai',
  mode: 'BASELINE', records };
let red = false;
try {
  const target = (await sql<{ database: string; can_create_database: boolean; migrations: number }>`
    select current_database() as database,
      (select rolcreatedb or rolsuper from pg_roles where rolname=current_user) as can_create_database,
      (select count(*)::int from platform.schema_migration) as migrations
  `.execute(handle.database)).rows[0]!;
  assert.equal(target.database, 'hdi_prototype', 'SYNTHETIC_TARGET_REQUIRED');
  assert.equal(target.migrations, 30);
  const object = await handle.database.selectFrom('platform.governance_object')
    .select(['object_code', 'object_type']).where('governance_object_id', '=', PERSON_FIXTURE.objectId)
    .executeTakeFirstOrThrow();
  assert.equal(object.object_code, 'PROTOTYPE-SYNTHETIC-PERSON-MASTER');
  assert.equal(object.object_type, 'PERSON_MASTER');
  evidence['environment'] = target;
  evidence['freshInstallGate'] = target.can_create_database ? 'NOT_RUN' : 'BLOCKED_CLEAN_INSTALL_VALIDATION';

  // A new canonical pair isolates this run from every pre-existing default rule.
  const typeCodes = [`B04_${runId.replaceAll('-', '').toUpperCase()}_A`,
    `B04_${runId.replaceAll('-', '').toUpperCase()}_B`] as const;
  const scope = { governanceObjectId: PERSON_FIXTURE.objectId };
  const policy = () => createEngagementPolicyApplication(handle.database, engagementPolicyContext(randomUUID()));
  const core = () => createEngagementApplication(handle.database, engagementContext());
  const lifecycle = () => createEngagementLifecycleApplication(handle.database, engagementLifecycleContext(randomUUID()));
  for (const typeCode of typeCodes) {
    await policy().appendEngagementTypeVersion({ ...scope, typeCode, expectedCurrentVersionId: null,
      categoryCode: 'LABOR_OR_HR', displayName: 'SYNTHETIC B04 BASELINE TYPE',
      businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null });
  }
  const pair = { ...scope, leftEngagementTypeCode: typeCodes[0], rightEngagementTypeCode: typeCodes[1] };
  const r1 = await policy().appendEngagementOverlapRuleVersion({ ...pair, expectedCurrentVersionId: null,
    decision: 'ALLOW', businessValidFrom: '2025-01-01T00:00:00', businessValidTo: null });
  const r2 = await policy().appendEngagementOverlapRuleVersion({ ...pair,
    expectedCurrentVersionId: r1.engagementOverlapRuleVersionId,
    decision: 'FORBID', businessValidFrom: '2026-07-01T00:00:00', businessValidTo: null });
  const point = await policy().findEngagementOverlapRuleAsOf({ ...pair,
    businessAt: '2026-08-01T00:00:00', recordAsOf: r2.recordedFrom });
  assert.equal(point?.engagementOverlapRuleVersionId, r2.engagementOverlapRuleVersionId);
  assert.equal(point.decision, 'FORBID');
  const person = async () => (await createPersonApplication(handle.database, personContext())
    .createPersonSubject({ ...personCreation, facts: { canonicalName: 'SYNTHETIC B04 BASELINE PERSON', birthDate: null } })).personId;
  const create = (personId: string, engagementTypeCode: string, from: string, to: string | null) =>
    core().createEngagement({ ...scope, personId, engagementTypeCode,
      relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS', businessValidFrom: from, businessValidTo: to });
  const personId = await person();
  await create(personId, typeCodes[0], '2026-06-01T00:00:00', '2026-09-01T00:00:00');
  let mutationError: string | null = null;
  let createdVersionId: string | null = null;
  try {
    createdVersionId = (await create(personId, typeCodes[1], '2026-06-01T00:00:00',
      '2026-09-01T00:00:00')).engagementVersionId;
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'ENGAGEMENT_OVERLAP_FORBIDDEN') throw error;
    mutationError = error.message;
  }
  try { assert.equal(mutationError, 'ENGAGEMENT_OVERLAP_FORBIDDEN'); }
  catch { red = true; }
  records.push({ scenarioIds: ['RP-01', 'IN-01'], status: red ? 'RED' : 'RISK_NOT_REPRODUCED',
    expected: 'CREATE_REJECTED_ENGAGEMENT_OVERLAP_FORBIDDEN', mutationError, createdVersionId,
    pointRule: point, originalAllowRule: r1, personId,
    intersection: { from: '2026-06-01T00:00:00', to: '2026-09-01T00:00:00' } });

  const ended = await create(await person(), typeCodes[0], '2025-01-01T00:00:00', null);
  const v1Before = await handle.database.selectFrom('person_master.engagement_version').selectAll()
    .where('engagement_version_id', '=', ended.engagementVersionId).executeTakeFirstOrThrow();
  const v2 = await lifecycle().endEngagement({ ...scope, engagementId: ended.engagementId,
    expectedCurrentEngagementVersionId: ended.engagementVersionId,
    businessEffectiveAt: '2026-08-01T00:00:00', reasonCode: 'SYNTHETIC_B04_END' });
  const query = { ...scope, engagementId: ended.engagementId,
    businessAt: '2026-09-01T00:00:00', recordAsOf: v2.recordedFrom };
  const historical = await core().findEngagementAsOf(query);
  const state = await lifecycle().getEngagementBusinessStateAsOf(query);
  assert.equal(historical?.engagementVersionId, ended.engagementVersionId);
  assert.equal(state.engagementVersionId, v2.engagementVersionId);
  assert.equal(state.businessState, 'ENDED');
  assert.deepEqual(await handle.database.selectFrom('person_master.engagement_version').selectAll()
    .where('engagement_version_id', '=', ended.engagementVersionId).executeTakeFirstOrThrow(), v1Before);
  const oldState = await lifecycle().getEngagementBusinessStateAsOf({ ...query, recordAsOf: ended.recordedFrom });
  assert.equal(oldState.businessState, 'ACTIVE');
  assert.equal(oldState.engagementVersionId, ended.engagementVersionId);
  records.push({ scenarioIds: ['EA-01', 'EA-02'], status: 'BASELINE_OBSERVED', query,
    historicalVersionId: historical.engagementVersionId, state, oldRecordAsOf: ended.recordedFrom,
    oldState, v1Unchanged: true, effectiveReaderAcceptance: 'NOT_RUN' });

  const original = await create(await person(), typeCodes[0], '2025-01-01T00:00:00', null);
  const shortened = await core().reviseEngagement({ ...scope, engagementId: original.engagementId,
    expectedCurrentVersionId: original.engagementVersionId, reasonCode: 'VALIDITY_CORRECTION',
    businessValidFrom: '2025-03-01T00:00:00', businessValidTo: '2025-12-01T00:00:00' });
  for (const [businessAt, expectedState] of [['2025-02-01T00:00:00', 'PLANNED'],
    ['2025-12-01T00:00:00', 'ENDED']] as const) {
    const q = { ...scope, engagementId: original.engagementId, businessAt, recordAsOf: shortened.recordedFrom };
    const history = await core().findEngagementAsOf(q);
    const current = await lifecycle().getEngagementBusinessStateAsOf(q);
    assert.equal(history?.engagementVersionId, original.engagementVersionId);
    assert.equal(current.engagementVersionId, shortened.engagementVersionId);
    assert.equal(current.businessState, expectedState);
    records.push({ scenarioIds: [expectedState === 'PLANNED' ? 'EA-03' : 'EA-04'],
      status: 'BASELINE_OBSERVED', query: q, historicalVersionId: history.engagementVersionId,
      state: current, effectiveReaderAcceptance: 'NOT_RUN' });
  }
  evidence['status'] = red ? 'BASELINE_RED' : 'BASELINE_RISK_NOT_REPRODUCED';
  process.exitCode = red || !target.can_create_database ? 1 : 0;
} catch (error) {
  evidence['status'] = 'ENVIRONMENT_OR_PROBE_FAILURE';
  evidence['errorCode'] = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
    ? error.message : 'BASELINE_PROBE_FAILED';
  process.exitCode = 1;
} finally {
  await handle.close();
  evidence['poolClosed'] = true;
  await writeFile(`${evidenceDirectory}/baseline.json`, JSON.stringify(evidence, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...evidence, evidenceDirectory }));
}
