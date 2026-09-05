import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { sql } from 'kysely';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementPolicyApplication } from '../../apps/governance-api/src/composition/create-engagement-policy-application.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { ENGAGEMENT_FIXTURE, engagementContext } from './person-engagement-fixture.js';
import {
  ENGAGEMENT_POLICY_FIXTURE,
  engagementPolicyContext,
  seedSyntheticEngagementPolicy,
} from './person-engagement-policy-fixture.js';
import { PERSON_FIXTURE, personContext, personCreation } from './person-subject-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_ENGAGEMENT_DATABASE_REQUIRED');
process.env['NODE_ENV'] = 'test';
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-pv006-b02-overlap-application-probe', max: 12 });
const checks: Record<string, boolean> = {};
const runId = randomUUID();
const persistencePath = process.env['PERSON_ENGAGEMENT_POLICY_PERSISTENCE_FILE'];
const recoveryMode = process.argv.includes('--recover');

interface PersistenceReceipt {
  readonly databaseStartedAt: string;
  readonly engagementId: string;
  readonly personId: string;
  readonly engagementTypeCode: string;
  readonly engagementTypeVersionId: string;
  readonly ruleVersionId: string;
  readonly ruleRecordedFrom: string;
  readonly counts: {
    readonly typeDefinitions: string;
    readonly typeVersions: string;
    readonly rules: string;
    readonly ruleVersions: string;
    readonly engagements: string;
    readonly classifications: string;
  };
}

try {
  if (recoveryMode) {
    await recoverPersistence();
  } else {
  const policy = await seedSyntheticEngagementPolicy(handle.database);
  const people = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    createScenarioPerson(index + 1)));

  const noOverlapFirst = await createEngagement(people[0]!, 'CONTRACT_EMPLOYEE',
    '2026-01-01T00:00:00', '2026-06-01T00:00:00');
  const noOverlapSecond = await createEngagement(people[0]!, 'PERMANENT_EMPLOYEE',
    '2026-06-01T00:00:00', '2026-12-01T00:00:00');
  assert.notEqual(noOverlapFirst.engagementId, noOverlapSecond.engagementId);
  checks['samePersonNoTemporalOverlapAllowed'] = true;
  checks['overlapBusinessTimeAware'] = true;

  const allowFirst = await createEngagement(people[1]!, 'CONTRACT_EMPLOYEE',
    '2026-01-01T00:00:00', null);
  const allowSecond = await createEngagement(people[1]!, 'CONTRACT_EMPLOYEE',
    '2035-01-01T00:00:00', null);
  assert.equal(allowFirst.engagementTypeCode, 'CONTRACT_EMPLOYEE');
  assert.equal(allowSecond.engagementTypeCode, 'CONTRACT_EMPLOYEE');
  checks['overlapAllowWorks'] = true;
  checks['sameTypePairSupported'] = true;
  checks['openEndedOverlapWorks'] = true;

  const forbiddenBase = await createEngagement(people[2]!, 'CONTRACT_EMPLOYEE',
    '2026-01-01T00:00:00', '2027-01-01T00:00:00');
  const forbiddenBefore = await personEngagementCount(people[2]!);
  await assert.rejects(createEngagement(people[2]!, 'PERMANENT_EMPLOYEE',
    '2026-04-01T00:00:00', '2026-08-01T00:00:00'), /ENGAGEMENT_OVERLAP_FORBIDDEN/u);
  assert.equal(await personEngagementCount(people[2]!), forbiddenBefore);
  assert.equal(forbiddenBase.engagementTypeCode, 'CONTRACT_EMPLOYEE');
  checks['overlapForbidBlocks'] = true;

  await createEngagement(people[3]!, 'CONTRACT_EMPLOYEE',
    '2026-01-01T00:00:00', '2027-01-01T00:00:00');
  const reviewBefore = await personEngagementCount(people[3]!);
  await assert.rejects(createEngagement(people[3]!, 'CONSULTATION_EXPERT',
    '2026-04-01T00:00:00', '2026-08-01T00:00:00'),
  /ENGAGEMENT_OVERLAP_REVIEW_REQUIRED/u);
  assert.equal(await personEngagementCount(people[3]!), reviewBefore);
  checks['overlapReviewRequiredFailsClosed'] = true;

  await createEngagement(people[4]!, 'INTERN',
    '2026-01-01T00:00:00', '2027-01-01T00:00:00');
  const missingBefore = await personEngagementCount(people[4]!);
  await assert.rejects(createEngagement(people[4]!, 'REEMPLOYED_PERSONNEL',
    '2026-04-01T00:00:00', '2026-08-01T00:00:00'),
  /ENGAGEMENT_OVERLAP_RULE_MISSING/u);
  assert.equal(await personEngagementCount(people[4]!), missingBefore);
  checks['overlapMissingRuleFailsClosed'] = true;

  const independent = await Promise.all([
    createEngagement(people[5]!, 'CONTRACT_EMPLOYEE',
      '2026-01-01T00:00:00', '2027-01-01T00:00:00'),
    createEngagement(people[6]!, 'PERMANENT_EMPLOYEE',
      '2026-01-01T00:00:00', '2027-01-01T00:00:00'),
  ]);
  assert.notEqual(independent[0].personId, independent[1].personId);
  checks['differentPersonsIndependent'] = true;

  const revisionTarget = await createEngagement(people[7]!, 'PERMANENT_EMPLOYEE',
    '2026-07-01T00:00:00', '2027-01-01T00:00:00');
  await createEngagement(people[7]!, 'CONTRACT_EMPLOYEE',
    '2026-01-01T00:00:00', '2026-07-01T00:00:00');
  const revisionApplication = createEngagementApplication(handle.database, engagementContext());
  await assert.rejects(revisionApplication.reviseEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: revisionTarget.engagementId,
    expectedCurrentVersionId: revisionTarget.engagementVersionId,
    businessValidFrom: '2026-06-01T00:00:00', businessValidTo: '2027-01-01T00:00:00',
    reasonCode: 'VALIDITY_CORRECTION',
  }), /ENGAGEMENT_OVERLAP_FORBIDDEN/u);
  assert.deepEqual(await revisionApplication.listEngagementVersions({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: revisionTarget.engagementId,
  }), [revisionTarget]);
  checks['periodRevisionOverlapRejected'] = true;
  checks['engagementCoreHistoryPreserved'] = true;

  const resident = await createEngagement(people[8]!, 'RESIDENT_TRAINEE',
    '2026-01-01T00:00:00', '2029-01-01T00:00:00');
  assert.equal(resident.engagementTypeVersionId,
    policy.types.get('RESIDENT_TRAINEE')?.[0]?.engagementTypeVersionId);
  const residentApplication = createEngagementApplication(handle.database, engagementContext());
  await assert.rejects(residentApplication.reviseEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: resident.engagementId,
    expectedCurrentVersionId: resident.engagementVersionId,
    businessValidFrom: resident.businessValidFrom, businessValidTo: resident.businessValidTo,
    reasonCode: 'FACT_CORRECTION', engagementTypeCode: 'INTERN',
  } as Parameters<typeof residentApplication.reviseEngagement>[0]), /PERSON_INPUT_INVALID/u);
  const residentRead = await residentApplication.getEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: resident.engagementId,
  });
  assert.equal(residentRead.engagementTypeVersionId, resident.engagementTypeVersionId);
  assert.equal(residentRead.engagementTypeCode, 'RESIDENT_TRAINEE');
  checks['engagementClassificationFrozen'] = true;
  checks['engagementTypeMutationOnSameIdBlocked'] = true;

  const backfilled = await sql<{
    engagement_id: string; business_valid_from: string; recorded_from: string;
  }>`
    select relation.engagement_id, version.business_valid_from, version.recorded_from
    from person_master.engagement as relation
    join person_master.engagement_version as version
      on version.engagement_id = relation.engagement_id and version.version_no = 1
    join person_master.engagement_classification as classification
      on classification.engagement_id = relation.engagement_id
    where version.recorded_from < classification.classified_at
    order by version.recorded_from
    limit 1
  `.execute(handle.database);
  if (backfilled.rows[0]) {
    const historical = await residentApplication.findEngagementAsOf({
      governanceObjectId: PERSON_FIXTURE.objectId,
      engagementId: backfilled.rows[0].engagement_id,
      businessAt: backfilled.rows[0].business_valid_from,
      recordAsOf: backfilled.rows[0].recorded_from,
    });
    assert.ok(historical);
    assert.equal(historical.engagementTypeCode, null);
    assert.equal(historical.engagementTypeVersionId, null);
    assert.equal(historical.classificationRecordedAt, null);
    checks['backfillDoesNotRewriteRecordTimeHistory'] = true;
  }

  const concurrentCommands = [
    ['CONTRACT_EMPLOYEE', randomUUID()],
    ['PERMANENT_EMPLOYEE', randomUUID()],
  ] as const;
  const concurrent = await Promise.allSettled(concurrentCommands.map(([engagementTypeCode, requestId]) =>
    createEngagementApplication(handle.database, engagementContext(requestId)).createEngagement({
      governanceObjectId: PERSON_FIXTURE.objectId, personId: people[9]!, engagementTypeCode,
      relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
      businessValidFrom: '2026-01-01T00:00:00', businessValidTo: null,
    })));
  assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter((result) => result.status === 'rejected' &&
    result.reason instanceof Error && result.reason.message === 'ENGAGEMENT_OVERLAP_FORBIDDEN').length, 1);
  assert.equal(await personEngagementCount(people[9]!), 1);
  checks['overlapConcurrencySafe'] = true;

  const policyWriterDenied = createEngagementPolicyApplication(handle.database,
    engagementPolicyContext(`PV006-B02-POLICY-SEPARATION-${runId}`));
  const engagementWriterDenied = createEngagementPolicyApplication(handle.database,
    engagementContext(`PV006-B02-ENGAGEMENT-WRITER-DENIED-${runId}`));
  await assert.rejects(engagementWriterDenied.appendEngagementOverlapRuleVersion({
    governanceObjectId: PERSON_FIXTURE.objectId,
    leftEngagementTypeCode: 'DISPATCHED_PERSONNEL', rightEngagementTypeCode: 'EXTERNAL_EXPERT',
    expectedCurrentVersionId: null, decision: 'ALLOW',
    businessValidFrom: '2020-01-01T00:00:00', businessValidTo: null,
  }), /OBJECT_PERMISSION_FORBIDDEN/u);
  await assert.rejects(createEngagementApplication(handle.database,
    engagementPolicyContext(`PV006-B02-POLICY-OWNER-DENIED-${runId}`)).createEngagement({
      governanceObjectId: PERSON_FIXTURE.objectId, personId: people[0]!,
      engagementTypeCode: 'CONTRACT_EMPLOYEE',
      relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
      businessValidFrom: '2040-01-01T00:00:00', businessValidTo: '2041-01-01T00:00:00',
    }), /OBJECT_PERMISSION_FORBIDDEN/u);
  assert.equal((await policyWriterDenied.listEngagementOverlapRuleVersions({
    governanceObjectId: PERSON_FIXTURE.objectId,
    leftEngagementTypeCode: 'CONTRACT_EMPLOYEE', rightEngagementTypeCode: 'PERMANENT_EMPLOYEE',
  })).length, 1);
  checks['policyOwnerBoundarySeparated'] = true;

  const audit = await sql<{ action: string; event_payload: unknown }>`
    select action, event_payload
    from audit.audit_event
    where governance_object_id = ${PERSON_FIXTURE.objectId}::uuid
      and action in (
        'PERSON_ENGAGEMENT_CLASSIFIED', 'PERSON_ENGAGEMENT_OVERLAP_EVALUATED',
        'PERSON_ENGAGEMENT_OVERLAP_REJECTED', 'ENGAGEMENT_TYPE_VERSION_CREATED',
        'ENGAGEMENT_OVERLAP_RULE_VERSION_CREATED'
      )
  `.execute(handle.database);
  assert.ok(audit.rows.some((row) => row.action === 'PERSON_ENGAGEMENT_CLASSIFIED'));
  assert.ok(audit.rows.some((row) => row.action === 'PERSON_ENGAGEMENT_OVERLAP_EVALUATED'));
  assert.ok(audit.rows.some((row) => row.action === 'PERSON_ENGAGEMENT_OVERLAP_REJECTED'));
  const auditText = JSON.stringify(audit.rows);
  assert.ok(!/basisReference|contractNo|employeeNo|CONFIRMED_DISTINCT_RELATION_BASIS/u.test(auditText));
  checks['overlapAuditBounded'] = true;
  checks['sensitiveBasisAbsentFromAudit'] = true;
  checks['syntheticPolicyOnly'] = true;

  if (persistencePath) {
    const forbiddenRule = policy.rules.get('CONTRACT_EMPLOYEE/PERMANENT_EMPLOYEE')?.[0];
    if (!forbiddenRule) throw new Error('SYNTHETIC_FORBID_RULE_REQUIRED');
    assert.ok(forbiddenBase.engagementTypeVersionId);
    const receipt: PersistenceReceipt = {
      databaseStartedAt: await databaseStartedAt(),
      engagementId: forbiddenBase.engagementId,
      personId: forbiddenBase.personId,
      engagementTypeCode: forbiddenBase.engagementTypeCode,
      engagementTypeVersionId: forbiddenBase.engagementTypeVersionId,
      ruleVersionId: forbiddenRule.engagementOverlapRuleVersionId,
      ruleRecordedFrom: forbiddenRule.recordedFrom,
      counts: await persistedCounts(),
    };
    await mkdir(dirname(persistencePath), { recursive: true });
    await writeFile(persistencePath, JSON.stringify(receipt, null, 2));
  }

  process.stdout.write(`${JSON.stringify({ task: 'PV-006-B-02',
    classification: ENGAGEMENT_POLICY_FIXTURE.classification,
    policyBoundary: ENGAGEMENT_POLICY_FIXTURE.policyBoundary,
    timeZone: 'Asia/Shanghai', status: 'PASSED', checks })}\n`);
  }
} finally {
  await handle.close();
}

async function createScenarioPerson(index: number): Promise<string> {
  const version = await createPersonApplication(handle.database, personContext()).createPersonSubject({
    ...personCreation,
    facts: { canonicalName: `SYNTHETIC B-02 PERSON ${runId} ${index}`, birthDate: '1980-01-01' },
  });
  return version.personId;
}

async function createEngagement(
  personId: string,
  engagementTypeCode: string,
  businessValidFrom: string,
  businessValidTo: string | null,
) {
  return createEngagementApplication(handle.database, engagementContext()).createEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, personId, engagementTypeCode,
    relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS', businessValidFrom, businessValidTo,
  });
}

async function personEngagementCount(personId: string): Promise<number> {
  return (await createEngagementApplication(handle.database, engagementContext()).listPersonEngagements({
    governanceObjectId: PERSON_FIXTURE.objectId, personId,
  })).length;
}

async function recoverPersistence(): Promise<void> {
  if (!persistencePath) throw new Error('PERSON_ENGAGEMENT_POLICY_PERSISTENCE_FILE_REQUIRED');
  const receipt = JSON.parse(await readFile(persistencePath, 'utf8')) as PersistenceReceipt;
  const restartedAt = await databaseStartedAt();
  assert.notEqual(restartedAt, receipt.databaseStartedAt);
  const engagement = await createEngagementApplication(handle.database, engagementContext()).getEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, engagementId: receipt.engagementId,
  });
  assert.equal(engagement.personId, receipt.personId);
  assert.equal(engagement.engagementTypeCode, receipt.engagementTypeCode);
  assert.equal(engagement.engagementTypeVersionId, receipt.engagementTypeVersionId);

  const policy = createEngagementPolicyApplication(handle.database,
    engagementPolicyContext(`PV006-B02-RECOVERY-${randomUUID()}`));
  const rule = await policy.findEngagementOverlapRuleAsOf({
    governanceObjectId: PERSON_FIXTURE.objectId,
    leftEngagementTypeCode: 'PERMANENT_EMPLOYEE', rightEngagementTypeCode: 'CONTRACT_EMPLOYEE',
    businessAt: '2026-04-01T00:00:00', recordAsOf: receipt.ruleRecordedFrom,
  });
  assert.equal(rule?.engagementOverlapRuleVersionId, receipt.ruleVersionId);
  assert.equal(rule?.decision, 'FORBID');

  const before = await persistedCounts();
  assert.deepEqual(before, receipt.counts);
  await assert.rejects(createEngagement(receipt.personId, 'PERMANENT_EMPLOYEE',
    '2026-04-01T00:00:00', '2026-08-01T00:00:00'), /ENGAGEMENT_OVERLAP_FORBIDDEN/u);
  assert.deepEqual(await persistedCounts(), receipt.counts);
  process.stdout.write(`${JSON.stringify({ task: 'PV-006-B-02', status: 'PASSED', mode: 'RECOVERY',
    databaseRestartObserved: true,
    classificationRecovered: true, typeDefinitionVersionRecovered: true,
    ruleVersionRecovered: true, overlapDecisionRecovered: true,
    mutationCountUnchanged: true })}\n`);
}

async function databaseStartedAt(): Promise<string> {
  const result = await sql<{ started_at: string }>`
    select (pg_postmaster_start_time() at time zone 'Asia/Shanghai')::text as started_at
  `.execute(handle.database);
  return result.rows[0]!.started_at;
}

async function persistedCounts(): Promise<PersistenceReceipt['counts']> {
  const result = await sql<PersistenceReceipt['counts']>`
    select
      (select count(*) from person_master.engagement_type)::text as "typeDefinitions",
      (select count(*) from person_master.engagement_type_version)::text as "typeVersions",
      (select count(*) from person_master.engagement_overlap_rule)::text as rules,
      (select count(*) from person_master.engagement_overlap_rule_version)::text as "ruleVersions",
      (select count(*) from person_master.engagement)::text as engagements,
      (select count(*) from person_master.engagement_classification)::text as classifications
  `.execute(handle.database);
  return result.rows[0]!;
}
