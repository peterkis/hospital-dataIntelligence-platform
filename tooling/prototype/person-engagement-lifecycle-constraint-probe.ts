import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createEngagementApplication } from '../../apps/governance-api/src/composition/create-engagement-application.js';
import { createEngagementLifecycleApplication } from '../../apps/governance-api/src/composition/create-engagement-lifecycle-application.js';
import { createPersonApplication } from '../../apps/governance-api/src/composition/create-person-application.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { engagementContext } from './person-engagement-fixture.js';
import {
  ENGAGEMENT_LIFECYCLE_FIXTURE,
  engagementLifecycleContext,
  seedEngagementLifecycleScope,
} from './person-engagement-lifecycle-fixture.js';
import { PERSON_FIXTURE, personContext, personCreation } from './person-subject-fixture.js';

const handle = createDatabase({ connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-pv006-b03-lifecycle-constraint-probe', max: 6 });
const checks: Record<string, boolean> = {};
const runId = randomUUID();

try {
  await seedEngagementLifecycleScope(handle.database);
  const relation = await sql<{ relation_name: string | null }>`
    select relation_name from unnest(array[
      to_regclass('person_master.engagement_lifecycle_event')::text,
      to_regclass('person_master.engagement_lifecycle_rejection')::text
    ]) as relation_name
  `.execute(handle.database);
  assert.deepEqual(relation.rows.map((row) => row.relation_name), [
    'person_master.engagement_lifecycle_event', 'person_master.engagement_lifecycle_rejection',
  ]);
  checks['appendOnlyLifecycleRelationAvailable'] = true;
  checks['rejectedRequestReplayRelationAvailable'] = true;

  const person = await createPersonApplication(handle.database, personContext()).createPersonSubject({
    ...personCreation,
    facts: { canonicalName: `SYNTHETIC B-03 CONSTRAINT ${runId}`, birthDate: '1980-01-01' },
  });
  const preV1EventRequest = `PV006-B03-PRE-V1-EVENT-${runId}`;
  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    const stable = await tx.insertInto('person_master.engagement').values({
      governance_object_id: PERSON_FIXTURE.objectId, person_id: person.personId,
      creation_request_id: preV1EventRequest,
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
    }).returning('engagement_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.engagement_lifecycle_event').values({
      engagement_id: stable.engagement_id, governance_object_id: PERSON_FIXTURE.objectId,
      event_type: 'SUSPENDED', business_effective_at: '2026-04-01T00:00:00', sequence_no: '1',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: preV1EventRequest,
      reason_code: 'SYNTHETIC_PRE_V1_EVENT', operation_hash: Buffer.alloc(32, 11),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' && error instanceof Error &&
    /ENGAGEMENT_FIRST_VERSION_REQUIRED/u.test(error.message));
  assert.equal((await handle.database.selectFrom('person_master.engagement').select('engagement_id')
    .where('creation_request_id', '=', preV1EventRequest).execute()).length, 0);
  checks['eventBeforeV1RejectedAndRolledBack'] = true;

  const preV1RejectionRequest = `PV006-B03-PRE-V1-REJECTION-${runId}`;
  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    const stable = await tx.insertInto('person_master.engagement').values({
      governance_object_id: PERSON_FIXTURE.objectId, person_id: person.personId,
      creation_request_id: preV1RejectionRequest,
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
    }).returning('engagement_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.engagement_lifecycle_rejection').values({
      engagement_id: stable.engagement_id, governance_object_id: PERSON_FIXTURE.objectId,
      operation_type: 'SUSPEND', rejection_code: 'ENGAGEMENT_NOT_STARTED',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
      request_id: preV1RejectionRequest, operation_hash: Buffer.alloc(32, 12),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' && error instanceof Error &&
    /ENGAGEMENT_FIRST_VERSION_REQUIRED/u.test(error.message));
  assert.equal((await handle.database.selectFrom('person_master.engagement').select('engagement_id')
    .where('creation_request_id', '=', preV1RejectionRequest).execute()).length, 0);
  checks['rejectionBeforeV1RejectedAndRolledBack'] = true;

  const engagement = await createEngagementApplication(handle.database, engagementContext()).createEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, personId: person.personId,
    engagementTypeCode: 'CONTRACT_EMPLOYEE', relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
    businessValidFrom: '2026-01-01T00:00:00', businessValidTo: null,
  });
  const lifecycle = createEngagementLifecycleApplication(handle.database,
    engagementLifecycleContext(`PV006-B03-CONSTRAINT-SUSPEND-${runId}`));
  const suspended = await lifecycle.suspendEngagement({ governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: engagement.engagementId, businessEffectiveAt: '2026-04-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_CONSTRAINT_HOLD' });
  assert.equal(suspended.sequenceNo, '1');
  const rejectedApplication = createEngagementLifecycleApplication(handle.database,
    engagementLifecycleContext(`PV006-B03-CONSTRAINT-REJECTION-${runId}`));
  const rejectedCommand = { governanceObjectId: PERSON_FIXTURE.objectId,
    engagementId: engagement.engagementId, businessEffectiveAt: '2026-05-01T00:00:00',
    expectedLifecycleSequence: '0', reasonCode: 'SYNTHETIC_STALE_REJECTION' } as const;
  await assert.rejects(rejectedApplication.resumeEngagement(rejectedCommand),
    /ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE/u);
  await assert.rejects(rejectedApplication.resumeEngagement(rejectedCommand),
    /ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE/u);
  const rejection = await handle.database.selectFrom('person_master.engagement_lifecycle_rejection')
    .selectAll().where('engagement_id', '=', engagement.engagementId)
    .where('request_id', '=', `PV006-B03-CONSTRAINT-REJECTION-${runId}`).execute();
  assert.equal(rejection.length, 1);
  checks['rejectedRequestOutcomeAppendOnlyAndIdempotent'] = true;

  const columns = await sql<{ column_name: string; data_type: string }>`
    select column_name, data_type from information_schema.columns
    where table_schema = 'person_master' and table_name = 'engagement_lifecycle_event'
    order by ordinal_position
  `.execute(handle.database);
  assert.deepEqual(columns.rows.map((row) => row.column_name), [
    'engagement_lifecycle_event_id', 'engagement_id', 'governance_object_id', 'event_type',
    'business_effective_at', 'recorded_at', 'sequence_no', 'created_by', 'request_id',
    'reason_code', 'operation_hash',
  ]);
  assert.equal(columns.rows.find((row) => row.column_name === 'business_effective_at')?.data_type,
    'timestamp without time zone');
  assert.equal(columns.rows.find((row) => row.column_name === 'recorded_at')?.data_type,
    'timestamp without time zone');
  checks['lifecycleEventShapeBounded'] = true;
  checks['businessEffectiveTimeSeparatedFromRecordTime'] = true;

  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_lifecycle_event').values({
      engagement_id: engagement.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
      event_type: 'PAUSED', business_effective_at: '2026-05-01T00:00:00', sequence_no: '2',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: randomUUID(),
      reason_code: 'SYNTHETIC_INVALID_TYPE', operation_hash: Buffer.alloc(32, 1),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514');
  checks['eventTypeClosedSet'] = true;

  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_lifecycle_event').values({
      engagement_id: engagement.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
      event_type: 'RESUMED', business_effective_at: '2026-05-01T00:00:00', sequence_no: '3',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: randomUUID(),
      reason_code: 'SYNTHETIC_BAD_SEQUENCE', operation_hash: Buffer.alloc(32, 2),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' && error instanceof Error &&
    /ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID/u.test(error.message));
  checks['lifecycleSequenceDatabaseGuarded'] = true;

  const activePerson = await createPersonApplication(handle.database, personContext()).createPersonSubject({
    ...personCreation,
    facts: { canonicalName: `SYNTHETIC B-03 ACTIVE ${runId}`, birthDate: '1981-01-01' },
  });
  const active = await createEngagementApplication(handle.database, engagementContext()).createEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, personId: activePerson.personId,
    engagementTypeCode: 'CONTRACT_EMPLOYEE', relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
    businessValidFrom: '2026-01-01T00:00:00', businessValidTo: '2030-01-01T00:00:00',
  });
  const activeStable = await handle.database.selectFrom('person_master.engagement')
    .select('creation_request_id').where('engagement_id', '=', active.engagementId)
    .executeTakeFirstOrThrow();
  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_lifecycle_event').values({
      engagement_id: active.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
      event_type: 'SUSPENDED', business_effective_at: '2026-04-01T00:00:00', sequence_no: '1',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId,
      request_id: activeStable.creation_request_id,
      reason_code: 'SYNTHETIC_V1_REQUEST_REUSE', operation_hash: Buffer.alloc(32, 13),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23505' && error instanceof Error &&
    /ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT/u.test(error.message));
  checks['v1RequestReuseByLifecycleEventRejected'] = true;
  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_lifecycle_event').values({
      engagement_id: active.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
      event_type: 'RESUMED', business_effective_at: '2026-05-01T00:00:00', sequence_no: '1',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: randomUUID(),
      reason_code: 'SYNTHETIC_RESUME_WITHOUT_HOLD', operation_hash: Buffer.alloc(32, 3),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' && error instanceof Error &&
    /ENGAGEMENT_NOT_SUSPENDED/u.test(error.message));
  checks['resumeTransitionDatabaseGuarded'] = true;

  await assert.rejects(handle.database.transaction().execute(async (tx) => {
    await tx.insertInto('person_master.engagement_version').values({
      engagement_id: active.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
      person_id: active.personId, version_no: '2',
      supersedes_engagement_version_id: active.engagementVersionId,
      revision_reason_code: 'LIFECYCLE_END', business_valid_from: active.businessValidFrom,
      business_valid_to: '2031-01-01T00:00:00',
      created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: randomUUID(),
      operation_hash: Buffer.alloc(32, 4),
    }).execute();
  }), (error: unknown) => databaseCode(error) === '23514' && error instanceof Error &&
    /ENGAGEMENT_LIFECYCLE_END_VERSION_INVALID/u.test(error.message));
  checks['endVersionMustShortenContinuousPeriod'] = true;

  const requestRace = await createConstraintEngagement('REQUEST-RACE');
  const sharedRequestId = `PV006-B03-DIRECT-REQUEST-RACE-${runId}`;
  const requestRaceResults = await Promise.allSettled([
    handle.database.transaction().execute(async (tx) => {
      await tx.insertInto('person_master.engagement_lifecycle_event').values({
        engagement_id: requestRace.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
        event_type: 'SUSPENDED', business_effective_at: '2026-05-01T00:00:00', sequence_no: '1',
        created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: sharedRequestId,
        reason_code: 'SYNTHETIC_DIRECT_REQUEST_RACE', operation_hash: Buffer.alloc(32, 5),
      }).execute();
    }),
    handle.database.transaction().execute(async (tx) => {
      await tx.insertInto('person_master.engagement_version').values({
        engagement_id: requestRace.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
        person_id: requestRace.personId, version_no: '2',
        supersedes_engagement_version_id: requestRace.engagementVersionId,
        revision_reason_code: 'LIFECYCLE_END', business_valid_from: requestRace.businessValidFrom,
        business_valid_to: '2026-06-01T00:00:00',
        created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: sharedRequestId,
        operation_hash: Buffer.alloc(32, 6),
      }).execute();
    }),
  ]);
  assert.equal(requestRaceResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(requestRaceResults.filter((result) => result.status === 'rejected').length, 1);
  checks['directSqlCrossTableRequestRaceSingleWinner'] = true;

  const boundaryRace = await createConstraintEngagement('BOUNDARY-RACE');
  const boundaryRaceResults = await Promise.allSettled([
    handle.database.transaction().execute(async (tx) => {
      await tx.insertInto('person_master.engagement_lifecycle_event').values({
        engagement_id: boundaryRace.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
        event_type: 'SUSPENDED', business_effective_at: '2026-06-01T00:00:00', sequence_no: '1',
        created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: randomUUID(),
        reason_code: 'SYNTHETIC_DIRECT_BOUNDARY_RACE', operation_hash: Buffer.alloc(32, 7),
      }).execute();
    }),
    handle.database.transaction().execute(async (tx) => {
      await tx.insertInto('person_master.engagement_version').values({
        engagement_id: boundaryRace.engagementId, governance_object_id: PERSON_FIXTURE.objectId,
        person_id: boundaryRace.personId, version_no: '2',
        supersedes_engagement_version_id: boundaryRace.engagementVersionId,
        revision_reason_code: 'LIFECYCLE_END', business_valid_from: boundaryRace.businessValidFrom,
        business_valid_to: '2026-06-01T00:00:00',
        created_by: ENGAGEMENT_LIFECYCLE_FIXTURE.lifecycleOwnerId, request_id: randomUUID(),
        operation_hash: Buffer.alloc(32, 8),
      }).execute();
    }),
  ]);
  assert.equal(boundaryRaceResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(boundaryRaceResults.filter((result) => result.status === 'rejected').length, 1);
  checks['directSqlEndEventBoundaryRaceSingleWinner'] = true;

  for (const statement of [
    'update person_master.engagement_lifecycle_event set reason_code = reason_code',
    'delete from person_master.engagement_lifecycle_event',
    'truncate person_master.engagement_lifecycle_event',
    'update person_master.engagement_lifecycle_rejection set rejection_code = rejection_code',
    'delete from person_master.engagement_lifecycle_rejection',
    'truncate person_master.engagement_lifecycle_rejection',
  ]) {
    await assert.rejects(handle.database.transaction().execute(async (tx) => {
      await sql.raw(statement).execute(tx);
    }));
  }
  checks['lifecycleEventUpdateDeleteTruncateBlocked'] = true;

  const constraints = await sql<{ constraints: string; triggers: string; indexes: string;
    rejectionConstraints: string; rejectionTriggers: string; rejectionIndexes: string }>`
    select
      (select count(*) from pg_constraint as constraint_record
        join pg_class as relation_record on relation_record.oid = constraint_record.conrelid
        join pg_namespace as namespace_record on namespace_record.oid = relation_record.relnamespace
        where namespace_record.nspname = 'person_master'
          and relation_record.relname = 'engagement_lifecycle_event')::text as constraints,
      (select count(*) from pg_trigger as trigger_record
        join pg_class as relation_record on relation_record.oid = trigger_record.tgrelid
        join pg_namespace as namespace_record on namespace_record.oid = relation_record.relnamespace
        where namespace_record.nspname = 'person_master' and not trigger_record.tgisinternal
          and relation_record.relname = 'engagement_lifecycle_event')::text as triggers,
      (select count(*) from pg_indexes where schemaname = 'person_master'
        and tablename = 'engagement_lifecycle_event')::text as indexes,
      (select count(*) from pg_constraint as constraint_record
        join pg_class as relation_record on relation_record.oid = constraint_record.conrelid
        join pg_namespace as namespace_record on namespace_record.oid = relation_record.relnamespace
        where namespace_record.nspname = 'person_master'
          and relation_record.relname = 'engagement_lifecycle_rejection')::text as "rejectionConstraints",
      (select count(*) from pg_trigger as trigger_record
        join pg_class as relation_record on relation_record.oid = trigger_record.tgrelid
        join pg_namespace as namespace_record on namespace_record.oid = relation_record.relnamespace
        where namespace_record.nspname = 'person_master' and not trigger_record.tgisinternal
          and relation_record.relname = 'engagement_lifecycle_rejection')::text as "rejectionTriggers",
      (select count(*) from pg_indexes where schemaname = 'person_master'
        and tablename = 'engagement_lifecycle_rejection')::text as "rejectionIndexes"
  `.execute(handle.database);
  assert.ok(Number(constraints.rows[0]!.constraints) >= 12);
  assert.equal(constraints.rows[0]!.triggers, '4');
  assert.ok(Number(constraints.rows[0]!.indexes) >= 5);
  assert.ok(Number(constraints.rows[0]!.rejectionConstraints) >= 12);
  assert.equal(constraints.rows[0]!.rejectionTriggers, '3');
  assert.ok(Number(constraints.rows[0]!.rejectionIndexes) >= 3);
  checks['lifecycleDatabaseConstraintsPresent'] = true;

  const forbiddenColumns = await sql<{ count: string }>`
    select count(*) from information_schema.columns
    where table_schema = 'person_master'
      and table_name in ('person_subject', 'person_subject_version', 'engagement',
        'engagement_version', 'engagement_lifecycle_event', 'engagement_lifecycle_rejection')
      and (
        column_name in ('employment_status', 'staff_status', 'resigned', 'current_state',
          'current_status', 'is_active', 'is_current', 'business_state', 'lifecycle_state')
        or (table_name in ('engagement_lifecycle_event', 'engagement_lifecycle_rejection')
          and column_name in ('person_id', 'department_id', 'role_id'))
      )
  `.execute(handle.database);
  assert.equal(forbiddenColumns.rows[0]?.count, '0');
  checks['personAndStableRelationCurrentStateAbsent'] = true;
  checks['lifecycleEventDoesNotCopyPersonDepartmentRole'] = true;

  const forbiddenTypes = await sql<{ count: string }>`
    select count(*) from information_schema.columns
    where table_schema not in ('pg_catalog', 'information_schema')
      and (data_type in ('timestamp with time zone', 'time with time zone') or udt_name = 'tstzrange')
  `.execute(handle.database);
  assert.equal(forbiddenTypes.rows[0]?.count, '0');
  checks['forbiddenTimezoneTypesZero'] = true;

  const permissions = await sql<{ permission_code: string }>`
    select distinct permission_code from access_control.object_permission_grant
    where permission_code in ('PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ',
      'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE') order by permission_code
  `.execute(handle.database);
  assert.deepEqual(permissions.rows.map((row) => row.permission_code), [
    'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_READ', 'PERSON_MASTER_ENGAGEMENT_LIFECYCLE_WRITE',
  ]);
  checks['lifecyclePermissionsIndependent'] = true;

  process.stdout.write(`${JSON.stringify({ task: 'PV-006-B-03',
    classification: ENGAGEMENT_LIFECYCLE_FIXTURE.classification,
    timeZone: 'Asia/Shanghai', status: 'PASSED', databaseObjects: constraints.rows[0], checks })}\n`);
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

async function createConstraintEngagement(label: string) {
  const person = await createPersonApplication(handle.database, personContext()).createPersonSubject({
    ...personCreation,
    facts: { canonicalName: `SYNTHETIC B-03 ${label} ${runId}`, birthDate: '1982-01-01' },
  });
  return createEngagementApplication(handle.database, engagementContext()).createEngagement({
    governanceObjectId: PERSON_FIXTURE.objectId, personId: person.personId,
    engagementTypeCode: 'CONTRACT_EMPLOYEE', relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS',
    businessValidFrom: '2026-01-01T00:00:00', businessValidTo: null,
  });
}
