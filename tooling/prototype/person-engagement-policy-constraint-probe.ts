import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { ENGAGEMENT_FIXTURE } from './person-engagement-fixture.js';
import { ENGAGEMENT_POLICY_FIXTURE, seedSyntheticEngagementPolicy } from './person-engagement-policy-fixture.js';

const handle = createDatabase({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-pv006-b02-constraint-probe',
  max: 4,
});
const checks: Record<string, boolean> = {};

try {
  const policy = await seedSyntheticEngagementPolicy(handle.database);
  const relations = await sql<{ relation_name: string | null }>`
    select relation_name
    from unnest(array[
      to_regclass('person_master.engagement_type')::text,
      to_regclass('person_master.engagement_type_version')::text,
      to_regclass('person_master.engagement_classification')::text,
      to_regclass('person_master.engagement_overlap_rule')::text,
      to_regclass('person_master.engagement_overlap_rule_version')::text
    ]) as relation_name
  `.execute(handle.database);
  assert.deepEqual(relations.rows.map((row) => row.relation_name), [
    'person_master.engagement_type',
    'person_master.engagement_type_version',
    'person_master.engagement_classification',
    'person_master.engagement_overlap_rule',
    'person_master.engagement_overlap_rule_version',
  ]);
  checks['versionedPolicyRelationsAvailable'] = true;

  assert.equal(policy.types.size, 9);
  assert.deepEqual(new Set([...policy.types.values()].map((history) => history[0]!.categoryCode)),
    new Set(['LABOR_OR_HR', 'DISPATCH_OR_SERVICE', 'EXTERNAL_PROFESSIONAL', 'TRAINING_OR_LEARNING']));
  checks['fourTopLevelCategoriesRepresented'] = true;
  checks['representativeSecondaryTypesVersioned'] = true;

  const decisions = await sql<{ decision: string }>`
    select distinct decision from person_master.engagement_overlap_rule_version
    order by decision
  `.execute(handle.database);
  assert.deepEqual(decisions.rows.map((row) => row.decision), ['ALLOW', 'FORBID', 'REVIEW_REQUIRED']);
  const nonCanonical = await sql<{ count: string }>`
    select count(*) from person_master.engagement_overlap_rule
    where left_type_code > right_type_code
  `.execute(handle.database);
  assert.equal(nonCanonical.rows[0]?.count, '0');
  checks['overlapDecisionClosedSetRepresented'] = true;
  checks['overlapPairCanonical'] = true;

  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_type').values({
      governance_object_id: '74000000-0000-7000-8000-000000000001',
      type_code: 'SYNTHETIC_INVALID_SCOPE', creation_request_id: randomUUID(),
      created_by: ENGAGEMENT_POLICY_FIXTURE.policyOwnerId,
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' && error instanceof Error &&
    /person governance scope required/u.test(error.message));
  checks['policyDatabaseScopeGuarded'] = true;

  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_overlap_rule').values({
      governance_object_id: ENGAGEMENT_POLICY_FIXTURE.objectId,
      left_type_code: 'PERMANENT_EMPLOYEE', right_type_code: 'CONTRACT_EMPLOYEE',
      creation_request_id: randomUUID(), created_by: ENGAGEMENT_POLICY_FIXTURE.policyOwnerId,
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514');
  checks['reversePairRejectedByDatabase'] = true;

  const typeVersion = policy.types.get('CONTRACT_EMPLOYEE')?.[0];
  assert.ok(typeVersion);
  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_type_version').values({
      engagement_type_id: typeVersion.engagementTypeId,
      governance_object_id: typeVersion.governanceObjectId,
      version_no: '99', supersedes_engagement_type_version_id: typeVersion.engagementTypeVersionId,
      category_code: 'LABOR_OR_HR', display_name: 'SYNTHETIC INVALID SEQUENCE',
      business_valid_from: '2020-01-01T00:00:00', business_valid_to: null,
      created_by: ENGAGEMENT_POLICY_FIXTURE.policyOwnerId,
      request_id: randomUUID(), operation_hash: Buffer.alloc(32, 9),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514');
  checks['typeVersionSequenceGuarded'] = true;

  const immutableMutations = [
    "update person_master.engagement_type set type_code = type_code",
    "update person_master.engagement_type_version set display_name = display_name",
    "update person_master.engagement_classification set classified_by = classified_by",
    "update person_master.engagement_overlap_rule set left_type_code = left_type_code",
    "update person_master.engagement_overlap_rule_version set decision = decision",
    "delete from person_master.engagement_type_version",
    "delete from person_master.engagement_classification",
    "delete from person_master.engagement_overlap_rule_version",
    "truncate person_master.engagement_overlap_rule_version",
  ] as const;
  for (const statement of immutableMutations) {
    await assert.rejects(handle.database.transaction().execute(async (tx) => {
      await sql.raw(statement).execute(tx);
    }));
  }
  checks['typeDefinitionsImmutable'] = true;
  checks['classificationsImmutable'] = true;
  checks['overlapRulesImmutable'] = true;
  checks['ruleUpdateDeleteTruncateBlocked'] = true;

  const person = await handle.database.selectFrom('person_master.person_subject').select('person_id')
    .where('governance_object_id', '=', ENGAGEMENT_POLICY_FIXTURE.objectId)
    .orderBy('person_id').executeTakeFirstOrThrow();
  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    const requestId = randomUUID();
    const relation = await tx.insertInto('person_master.engagement').values({
      governance_object_id: ENGAGEMENT_POLICY_FIXTURE.objectId,
      person_id: person.person_id, creation_request_id: requestId,
      created_by: ENGAGEMENT_FIXTURE.engagementOwnerId,
    }).returning('engagement_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.engagement_version').values({
      engagement_id: relation.engagement_id,
      governance_object_id: ENGAGEMENT_POLICY_FIXTURE.objectId,
      person_id: person.person_id, version_no: '1', supersedes_engagement_version_id: null,
      revision_reason_code: null, business_valid_from: '2040-01-01T00:00:00',
      business_valid_to: null, created_by: ENGAGEMENT_FIXTURE.engagementOwnerId,
      request_id: requestId, operation_hash: Buffer.alloc(32, 7),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' &&
    error instanceof Error && /ENGAGEMENT_CLASSIFICATION_REQUIRED/u.test(error.message));
  checks['newEngagementRequiresClassification'] = true;

  const unclassified = await sql<{ count: string }>`
    select count(*) from person_master.engagement as relation
    left join person_master.engagement_classification as classification
      on classification.engagement_id = relation.engagement_id
    where classification.engagement_id is null
  `.execute(handle.database);
  assert.equal(unclassified.rows[0]?.count, '0');
  checks['existingEngagementsClassified'] = true;

  const forbiddenColumns = await sql<{ count: string }>`
    select count(*) from information_schema.columns
    where table_schema = 'person_master'
      and table_name in ('person_subject', 'person_subject_version', 'engagement', 'engagement_version')
      and column_name in (
        'employment_type', 'current_engagement_type', 'employment_status', 'is_active', 'is_current',
        'business_state', 'lifecycle_state', 'department_id', 'campus_id', 'job_code', 'role_code'
      )
  `.execute(handle.database);
  assert.equal(forbiddenColumns.rows[0]?.count, '0');
  checks['personCoreUnchanged'] = true;
  checks['businessLifecycleAbsent'] = true;
  checks['assignmentAbsent'] = true;

  const forbiddenTypes = await sql<{ count: string }>`
    select count(*) from information_schema.columns
    where table_schema not in ('pg_catalog', 'information_schema')
      and (data_type in ('timestamp with time zone', 'time with time zone') or udt_name = 'tstzrange')
  `.execute(handle.database);
  assert.equal(forbiddenTypes.rows[0]?.count, '0');
  checks['forbiddenTimezoneTypesZero'] = true;

  const databaseObjects = await sql<{
    constraints: string; triggers: string; indexes: string; classifications: string;
  }>`
    select
      (select count(*) from pg_constraint as c
        join pg_class as relation on relation.oid = c.conrelid
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'person_master'
          and relation.relname in ('engagement_type', 'engagement_type_version',
            'engagement_classification', 'engagement_overlap_rule',
            'engagement_overlap_rule_version'))::text as constraints,
      (select count(*) from pg_trigger as t
        join pg_class as relation on relation.oid = t.tgrelid
        join pg_namespace as namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'person_master' and not t.tgisinternal
          and relation.relname in ('engagement_type', 'engagement_type_version',
            'engagement_classification', 'engagement_overlap_rule',
            'engagement_overlap_rule_version'))::text as triggers,
      (select count(*) from pg_indexes where schemaname = 'person_master'
        and tablename in ('engagement_type', 'engagement_type_version',
          'engagement_classification', 'engagement_overlap_rule',
          'engagement_overlap_rule_version'))::text as indexes,
      (select count(*) from person_master.engagement_classification)::text as classifications
  `.execute(handle.database);
  process.stdout.write(`${JSON.stringify({ task: 'PV-006-B-02',
    classification: ENGAGEMENT_POLICY_FIXTURE.classification,
    policyBoundary: ENGAGEMENT_POLICY_FIXTURE.policyBoundary,
    timeZone: 'Asia/Shanghai', status: 'PASSED', databaseObjects: databaseObjects.rows[0], checks })}\n`);
} finally {
  await handle.close();
}

function databaseCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
