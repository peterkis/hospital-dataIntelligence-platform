import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { PERSON_FIXTURE, seedPersonScope } from './person-subject-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_PROBE_DATABASE_REQUIRED');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], application_name: 'hdi-person-constraint-probe', max: 2 });
const checks: Record<string, boolean> = {};
const rollback = new Error('ROLLBACK_SYNTHETIC_PROBE');
type Fixture = { personId: string; versionId: string };
try {
  const result = await sql<{ present: boolean }>`select to_regclass('person_master.person_subject') is not null as present`.execute(handle.database);
  assert.equal(result.rows[0]?.present, true, 'PERSON_SUBJECT_TABLE_REQUIRED');
  await seedPersonScope(handle.database);
  const count = await sql<{ count: string }>`select count(*) from platform.schema_migration`.execute(handle.database);
  assert.equal(count.rows[0]?.count, '20'); checks['migrationCount20'] = true;

  await rejected('stableIdentityNeverReused', ['23505'], async (tx, f) => {
    await tx.insertInto('person_master.person_subject').values({ person_id: f.personId, governance_object_id: PERSON_FIXTURE.objectId,
      creation_request_id: randomUUID(), created_by: PERSON_FIXTURE.ownerId }).execute();
  });
  await rejected('stableIdentityNeverReassigned', ['55000'], async (tx, f) => {
    await sql`update person_master.person_subject set person_id = uuidv7() where person_id = ${f.personId}::uuid`.execute(tx);
  });
  await rejected('stableIdentityPhysicalDeleteRejected', ['55000'], async (tx, f) => {
    await sql`delete from person_master.person_subject where person_id = ${f.personId}::uuid`.execute(tx);
  });
  await rejected('versionFactsImmutable', ['55000'], async (tx, f) => {
    await sql`update person_master.person_subject_version set canonical_name = 'SYNTHETIC OVERWRITE' where person_version_id = ${f.versionId}::uuid`.execute(tx);
  });
  await rejected('versionRecordTimeImmutable', ['55000'], async (tx, f) => {
    await sql`update person_master.person_subject_version set recorded_from = '2020-01-01' where person_version_id = ${f.versionId}::uuid`.execute(tx);
  });
  await rejected('versionDeleteRejected', ['55000'], async (tx, f) => {
    await sql`delete from person_master.person_subject_version where person_version_id = ${f.versionId}::uuid`.execute(tx);
  });
  await rejected('truncateRejected', ['55000'], async (tx) => { await sql`truncate person_master.person_subject_version`.execute(tx); });
  await rejected('versionNumberDuplicateRejected', ['23514', '23505'], async (tx, f) => { await insertVersion(tx, f.personId, { version_no: '1' }); });
  await rejected('versionNumberSkipRejected', ['23514'], async (tx, f) => { await insertVersion(tx, f.personId, { version_no: '3' }); });
  await rejected('versionIdentityUnique', ['23505'], async (tx, f) => { await insertVersion(tx, f.personId, { person_version_id: f.versionId }); });
  await rejected('foreignKeyIntegrity', ['23503'], async (tx) => { await insertVersion(tx, randomUUID(), { version_no: '1' }); });
  await rejected('governanceScopeRejected', ['23514', '23503'], async (tx, f) => { await insertVersion(tx, f.personId, { governance_object_id: '74000000-0000-7000-8000-000000000001' }); });
  await rejected('futureBirthDateRejected', ['23514'], async (tx, f) => { await insertVersion(tx, f.personId, { birth_date: '2999-01-01' }); });
  await rejected('invalidCalendarDateRejected', ['22008'], async (tx, f) => { await insertVersion(tx, f.personId, { birth_date: '2001-02-29' }); });
  await rejected('blankNameRejected', ['23514'], async (tx, f) => { await insertVersion(tx, f.personId, { canonical_name: '   ' }); });
  await rejected('untrimmedNameRejected', ['23514'], async (tx, f) => { await insertVersion(tx, f.personId, { canonical_name: ' SYNTHETIC ' }); });
  await rejected('overlongNameRejected', ['22001'], async (tx, f) => { await insertVersion(tx, f.personId, { canonical_name: 'S'.repeat(257) }); });
  await rejected('invalidBusinessPeriodRejected', ['22000', '23514'], async (tx, f) => {
    await insertVersion(tx, f.personId, { business_valid_to: '2019-01-01T00:00:00' });
  });
  await rejected('recordTimeRegressionRejected', ['23514'], async (tx, f) => { await insertVersion(tx, f.personId, { recorded_from: '2000-01-01T00:00:00' }); });
  await rejected('firstVersionRequired', ['23514'], async (tx) => {
    await tx.insertInto('person_master.person_subject').values({ governance_object_id: PERSON_FIXTURE.objectId,
      creation_request_id: randomUUID(), created_by: PERSON_FIXTURE.ownerId }).execute();
    await sql`set constraints all immediate`.execute(tx);
  });

  const columns = await sql<{ table_name: string; column_name: string; data_type: string }>`select table_name, column_name, data_type from information_schema.columns where table_schema = 'person_master' order by table_name, ordinal_position`.execute(handle.database);
  const names = columns.rows.map((row) => row.column_name);
  const groups = {
    employmentFactsAbsent: ['employment_status', 'employment_type', 'engagement_type', 'active', 'is_active'],
    assignmentFactsAbsent: ['department_id', 'campus_id', 'job_code', 'position_code', 'role_code'],
    credentialFactsAbsent: ['credential', 'license'], identifierFactsAbsent: ['employee_no', 'source_system_code', 'phone', 'email'],
    iamFactsAbsent: ['oidc_sub', 'keycloak_user_id', 'service_principal_id'], patientFactsAbsent: ['patient_id', 'empi_id', 'medical_record_no'],
  };
  for (const [name, forbidden] of Object.entries(groups)) {
    assert.ok(forbidden.every((column) => !names.includes(column))); checks[name] = true;
  }
  assert.equal(columns.rows.find((row) => row.column_name === 'birth_date')?.data_type, 'date');
  checks['birthDateIsDateOnly'] = true;
  assert.equal(columns.rows.filter((row) => ['timestamp with time zone', 'time with time zone', 'tstzrange'].includes(row.data_type)).length, 0);
  checks['forbiddenTimezoneTypesZero'] = true;
  const orphan = await sql<{ count: string }>`select count(*) from person_master.person_subject s where not exists (select 1 from person_master.person_subject_version v where v.person_id=s.person_id and v.version_no=1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0'); checks['noOrphanSubjects'] = true;
} finally { await handle.close(); }
checks['databasePoolClosed'] = true;
assert.ok(Object.values(checks).every(Boolean));
console.log(JSON.stringify({ task: 'PV-006-A-01', status: 'PASSED', classification: PERSON_FIXTURE.classification, timeZone: PERSON_FIXTURE.timeZone, checks }));

async function insertVersion(tx: Transaction<DB>, personId: string, overrides: Partial<import('kysely').Insertable<DB['person_master.person_subject_version']>> = {}) {
  return tx.insertInto('person_master.person_subject_version').values({ person_id: personId, governance_object_id: PERSON_FIXTURE.objectId,
    version_no: '2', canonical_name: 'SYNTHETIC CONSTRAINT PERSON', birth_date: null,
    business_valid_from: '2020-01-01T00:00:00', business_valid_to: null, created_by: PERSON_FIXTURE.ownerId,
    request_id: randomUUID(), operation_hash: Buffer.alloc(32, 1), ...overrides,
  }).returning('person_version_id').executeTakeFirstOrThrow();
}

async function rejected(name: string, codes: readonly string[], mutation: (tx: Transaction<DB>, fixture: Fixture) => Promise<void>) {
  let observed: unknown;
  try {
    await handle.database.transaction().execute(async (tx) => {
      const subject = await tx.insertInto('person_master.person_subject').values({ governance_object_id: PERSON_FIXTURE.objectId,
        creation_request_id: randomUUID(), created_by: PERSON_FIXTURE.ownerId }).returning('person_id').executeTakeFirstOrThrow();
      const first = await insertVersion(tx, subject.person_id, { version_no: '1' });
      await mutation(tx, { personId: subject.person_id, versionId: first.person_version_id });
      throw rollback;
    });
  } catch (error) { observed = error; }
  assert.ok(observed !== rollback && observed && typeof observed === 'object' && 'code' in observed && codes.includes(String(observed.code)), name);
  checks[name] = true;
}
