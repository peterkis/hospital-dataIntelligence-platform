import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Insertable, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { ENGAGEMENT_FIXTURE, seedEngagementScope } from './person-engagement-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_ENGAGEMENT_DATABASE_REQUIRED');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-person-engagement-constraint-probe', max: 2 });
const checks: Record<string, boolean> = {};
let databaseSummary = { newTables: 0, newConstraints: 0, newTriggers: 0, newIndexes: 0 };
const rollback = new Error('ROLLBACK_SYNTHETIC_PROBE');
type Stable = Insertable<DB['person_master.engagement']>;
type Version = Insertable<DB['person_master.engagement_version']>;
type VersionRow = Selectable<DB['person_master.engagement_version']>;
type Fixture = { id: string; stable: Stable; first: VersionRow; next: Version };

try {
  const people = await seedEngagementScope(handle.database);
  const migrations = await sql<{ count: string }>`select count(*) from platform.schema_migration`.execute(handle.database);
  assert.equal(migrations.rows[0]?.count, '23');
  checks['migrationCount23'] = true;
  const metadata = await sql<{ version: string; timezone: string }>`
    select current_setting('server_version') as version, current_setting('TimeZone') as timezone
  `.execute(handle.database);
  assert.match(metadata.rows[0]!.version, /^18\./u);
  assert.equal(metadata.rows[0]!.timezone, 'Asia/Shanghai');
  checks['postgresql18AsiaShanghai'] = true;

  await rejected('stablePersonForeignKey', ['23503'], (tx, f) =>
    tx.insertInto('person_master.engagement').values({ ...f.stable, person_id: randomUUID(),
      creation_request_id: randomUUID() }).execute());
  await rejected('crossGovernancePersonRejected', ['23503', '23514'], (tx, f) =>
    tx.insertInto('person_master.engagement').values({ ...f.stable,
      governance_object_id: PROTOTYPE_FIXTURE.departmentMasterObjectId,
      creation_request_id: randomUUID() }).execute());
  await rejected('creationRequestUnique', ['23505'], (tx, f) =>
    tx.insertInto('person_master.engagement').values({ ...f.stable }).execute());
  await rejected('stableEngagementPrimaryKey', ['23505'], (tx, f) =>
    tx.insertInto('person_master.engagement').values({ ...f.stable,
      engagement_id: f.id, creation_request_id: randomUUID() }).execute());
  await rejected('stablePersonTransferBlocked', ['55000'], (tx, f) =>
    tx.updateTable('person_master.engagement').set({ person_id: people[1]! })
      .where('engagement_id', '=', f.id).execute());
  await rejected('stableUpdateBlocked', ['55000'], (tx, f) =>
    tx.updateTable('person_master.engagement').set({ creation_request_id: randomUUID() })
      .where('engagement_id', '=', f.id).execute());
  await rejected('stableDeleteBlocked', ['55000'], (tx, f) =>
    tx.deleteFrom('person_master.engagement').where('engagement_id', '=', f.id).execute());
  await rejected('stableTruncateBlocked', ['55000'], async (tx) => {
    await sql`set constraints all immediate`.execute(tx);
    await sql`truncate person_master.engagement cascade`.execute(tx);
  });
  await rejected('versionPersonTransferBlocked', ['23503', '55000'], (tx, f) =>
    tx.insertInto('person_master.engagement_version').values({ ...f.next, person_id: people[1]! }).execute());
  await rejected('versionUpdateBlocked', ['55000'], (tx, f) =>
    tx.updateTable('person_master.engagement_version').set({ business_valid_to: '2027-01-01T00:00:00' })
      .where('engagement_version_id', '=', f.first.engagement_version_id).execute());
  await rejected('versionDeleteBlocked', ['55000'], (tx, f) =>
    tx.deleteFrom('person_master.engagement_version')
      .where('engagement_version_id', '=', f.first.engagement_version_id).execute());
  await rejected('versionTruncateBlocked', ['55000'], async (tx) => {
    await sql`set constraints all immediate`.execute(tx);
    await sql`truncate person_master.engagement_version`.execute(tx);
  });

  await rejected('missingFirstVersionBlocked', ['23514'], async (tx, f) => {
    await tx.insertInto('person_master.engagement').values({ ...f.stable,
      creation_request_id: randomUUID() }).execute();
    await sql`set constraints all immediate`.execute(tx);
  });
  await rejected('firstVersionShapeGuard', ['23514'], async (tx, f) => {
    const requestId = randomUUID();
    const stable = await tx.insertInto('person_master.engagement').values({ ...f.stable,
      creation_request_id: requestId }).returning('engagement_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.engagement_version').values({ ...f.next,
      engagement_id: stable.engagement_id, version_no: '1',
      supersedes_engagement_version_id: f.first.engagement_version_id,
      revision_reason_code: 'FACT_CORRECTION', request_id: requestId }).execute();
  });

  for (const [name, invalid, codes] of [
    ['versionSequence', { version_no: '3' }, ['23514']],
    ['supersedesRequired', { supersedes_engagement_version_id: null }, ['23514']],
    ['revisionReasonRequired', { revision_reason_code: null }, ['23514']],
    ['revisionReasonClosedSet', { revision_reason_code: 'REHIRE' }, ['23514']],
    ['recordTimeRegression', { recorded_from: '2000-01-01T00:00:00' }, ['23514']],
    ['recordTimeFuture', { recorded_from: '2999-01-01T00:00:00' }, ['23514']],
    ['businessPeriodEmpty', { business_valid_to: '2026-01-01T00:00:00' }, ['23514']],
    ['businessPeriodInverted', { business_valid_to: '2025-12-01T00:00:00' }, ['23514', '22000']],
  ] as const) await rejected(name, codes, (tx, f) =>
    tx.insertInto('person_master.engagement_version').values({ ...f.next, ...invalid }).execute());

  await rejected('versionNumberUnique', ['23505', '23514'], (tx, f) =>
    tx.insertInto('person_master.engagement_version').values({ ...f.next, version_no: '1' }).execute());
  await rejected('versionRequestIdUnique', ['23505'], (tx, f) =>
    tx.insertInto('person_master.engagement_version').values({ ...f.next,
      request_id: f.first.request_id }).execute());
  await rejected('supersedesSameEngagement', ['23503', '23514'], async (tx, f) => {
    const requestId = randomUUID();
    const other = await tx.insertInto('person_master.engagement').values({ ...f.stable,
      creation_request_id: requestId }).returningAll().executeTakeFirstOrThrow();
    const otherFirst = await tx.insertInto('person_master.engagement_version').values({
      engagement_id: other.engagement_id, governance_object_id: other.governance_object_id,
      person_id: other.person_id, version_no: '1', supersedes_engagement_version_id: null,
      revision_reason_code: null, business_valid_from: '2026-01-01T00:00:00',
      business_valid_to: null, created_by: other.created_by, request_id: requestId,
      operation_hash: Buffer.alloc(32, 3),
    }).returning('engagement_version_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.engagement_version').values({ ...f.next,
      supersedes_engagement_version_id: otherFirst.engagement_version_id }).execute();
  });

  const columns = await sql<{ table_name: string; column_name: string }>`
    select table_name, column_name from information_schema.columns
    where table_schema = 'person_master' and table_name in ('engagement', 'engagement_version')
  `.execute(handle.database);
  const names = columns.rows.map((row) => row.column_name);
  for (const forbidden of ['engagement_type', 'engagement_category', 'employment_status', 'business_state',
    'lifecycle_state', 'department_id', 'campus_id', 'job_code', 'role_code', 'credential_id',
    'basis_reference', 'contract_no', 'employee_no']) assert.ok(!names.includes(forbidden), forbidden);
  checks['classificationLifecycleAssignmentCredentialAbsent'] = true;

  const objectCounts = await sql<{ tables: string; constraints: string; triggers: string; indexes: string }>`
    select
      (select count(*) from information_schema.tables where table_schema = 'person_master'
        and table_name in ('engagement', 'engagement_version'))::text as tables,
      (select count(*) from pg_constraint c join pg_class r on r.oid = c.conrelid
        join pg_namespace n on n.oid = r.relnamespace where n.nspname = 'person_master'
        and r.relname in ('engagement', 'engagement_version'))::text as constraints,
      (select count(*) from pg_trigger t join pg_class r on r.oid = t.tgrelid
        join pg_namespace n on n.oid = r.relnamespace where n.nspname = 'person_master'
        and not t.tgisinternal and r.relname in ('engagement', 'engagement_version'))::text as triggers,
      (select count(*) from pg_indexes where schemaname = 'person_master'
        and tablename in ('engagement', 'engagement_version'))::text as indexes
  `.execute(handle.database);
  const counts = objectCounts.rows[0]!;
  databaseSummary = { newTables: Number(counts.tables), newConstraints: Number(counts.constraints),
    newTriggers: Number(counts.triggers), newIndexes: Number(counts.indexes) };
  assert.equal(databaseSummary.newTables, 2);
  const ids = await sql<{ engagement_v7: boolean; version_v7: boolean }>`
    select uuid_extract_version(uuidv7()) = 7 as engagement_v7,
      uuid_extract_version(uuidv7()) = 7 as version_v7
  `.execute(handle.database);
  assert.equal(ids.rows[0]?.engagement_v7, true);
  assert.equal(ids.rows[0]?.version_v7, true);
  checks['stableAndVersionIdsUuidV7'] = true;
  const forbidden = await sql<{ count: string }>`select count(*) from information_schema.columns
    where table_schema not in ('pg_catalog','information_schema')
      and (data_type in ('timestamp with time zone','time with time zone') or udt_name = 'tstzrange')`.execute(handle.database);
  assert.equal(forbidden.rows[0]?.count, '0');
  checks['forbiddenTimezoneTypeCountZero'] = true;
  const orphan = await sql<{ count: string }>`select count(*) from person_master.engagement e
    where not exists (select 1 from person_master.engagement_version v
      where v.engagement_id = e.engagement_id and v.version_no = 1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0');
  checks['orphanEngagementsZero'] = true;

  async function rejected(name: string, codes: readonly string[],
    mutation: (tx: Transaction<DB>, fixture: Fixture) => Promise<unknown>) {
    let observed: unknown;
    try {
      await handle.database.transaction().execute(async (tx) => {
        const requestId = randomUUID();
        const stable: Stable = { governance_object_id: ENGAGEMENT_FIXTURE.objectId,
          person_id: people[0]!, creation_request_id: requestId,
          created_by: ENGAGEMENT_FIXTURE.engagementOwnerId };
        const relation = await tx.insertInto('person_master.engagement').values(stable)
          .returning('engagement_id').executeTakeFirstOrThrow();
        const first = await tx.insertInto('person_master.engagement_version').values({
          engagement_id: relation.engagement_id, governance_object_id: ENGAGEMENT_FIXTURE.objectId,
          person_id: people[0]!, version_no: '1', supersedes_engagement_version_id: null,
          revision_reason_code: null, business_valid_from: '2026-01-01T00:00:00',
          business_valid_to: null, created_by: ENGAGEMENT_FIXTURE.engagementOwnerId,
          request_id: requestId, operation_hash: Buffer.alloc(32, 1),
        }).returningAll().executeTakeFirstOrThrow();
        const next: Version = { engagement_id: relation.engagement_id,
          governance_object_id: ENGAGEMENT_FIXTURE.objectId, person_id: people[0]!, version_no: '2',
          supersedes_engagement_version_id: first.engagement_version_id,
          revision_reason_code: 'VALIDITY_CORRECTION', business_valid_from: '2026-01-01T00:00:00',
          business_valid_to: null, created_by: ENGAGEMENT_FIXTURE.engagementOwnerId,
          request_id: randomUUID(), operation_hash: Buffer.alloc(32, 2) };
        await mutation(tx, { id: relation.engagement_id, stable, first, next });
        throw rollback;
      });
    } catch (error) { observed = error; }
    assert.ok(observed !== rollback && observed && typeof observed === 'object' && 'code' in observed &&
      codes.includes(String(observed.code)), name);
    checks[name] = true;
  }
} finally { await handle.close(); }

checks['databasePoolClosed'] = true;
console.log(JSON.stringify({ task: 'PV-006-B-01', classification: ENGAGEMENT_FIXTURE.classification,
  timeZone: ENGAGEMENT_FIXTURE.timeZone, status: 'PASSED', databaseSummary, checks }));
