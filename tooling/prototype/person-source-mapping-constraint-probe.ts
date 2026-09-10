import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Insertable, type Selectable, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { SOURCE_MAPPING_FIXTURE, seedSourceMappingScope } from './person-source-mapping-fixture.js';
import { PROTOTYPE_FIXTURE } from './prototype-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_SOURCE_MAPPING_DATABASE_REQUIRED');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'],
  application_name: 'hdi-source-mapping-constraint-probe', max: 2 });
const checks: Record<string, boolean> = {};
let databaseSummary = { newTables: 0, newConstraints: 0, newTriggers: 0, newIndexes: 0 };
const rollback = new Error('ROLLBACK_SYNTHETIC_PROBE');
type Stable = Insertable<DB['person_master.person_source_mapping']>;
type Version = Insertable<DB['person_master.person_source_mapping_version']>;
type VersionRow = Selectable<DB['person_master.person_source_mapping_version']>;
type Fixture = { id: string; stable: Stable; first: VersionRow; next: Version };

try {
  const people = await seedSourceMappingScope(handle.database);
  const migrations = await sql<{ count: string; source_mapping_present: boolean }>`select
    count(*)::text as count,
    bool_or(migration_id = '0022_person_source_record_mapping') as source_mapping_present
    from platform.schema_migration`.execute(handle.database);
  assert.equal(migrations.rows[0]?.source_mapping_present, true);
  assert.ok(Number(migrations.rows[0]?.count) >= 22);
  checks['sourceMappingMigrationPresent'] = true;
  const metadata = await sql<{ version: string; timezone: string }>`
    select current_setting('server_version') as version, current_setting('TimeZone') as timezone
  `.execute(handle.database);
  assert.match(metadata.rows[0]!.version, /^18\./u);
  assert.equal(metadata.rows[0]!.timezone, 'Asia/Shanghai');

  await rejected('stableSourceIdentityUnique', ['23505'], (tx, f) =>
    tx.insertInto('person_master.person_source_mapping').values({ ...f.stable,
      creation_request_id: randomUUID() }).execute());
  await rejected('creationRequestUnique', ['23505'], (tx, f) =>
    tx.insertInto('person_master.person_source_mapping').values({ ...f.stable,
      source_record_key: `SYN-${randomUUID()}` }).execute());
  await rejected('unknownPersonRejected', ['23503'], (tx, f) =>
    tx.insertInto('person_master.person_source_mapping_version').values({ ...f.next,
      person_id: randomUUID() }).execute());
  await rejected('crossGovernancePersonRejected', ['23503', '23514'], (tx, f) =>
    tx.insertInto('person_master.person_source_mapping_version').values({ ...f.next,
      governance_object_id: PROTOTYPE_FIXTURE.departmentMasterObjectId }).execute());

  for (const column of ['source_system', 'source_entity', 'source_record_key'] as const) {
    await rejected(`stable_${column}_immutable`, ['55000'], (tx, f) =>
      tx.updateTable('person_master.person_source_mapping').set({ [column]: 'SYNTHETIC_CHANGED' })
        .where('person_source_mapping_id', '=', f.id).execute());
  }
  await rejected('stableDeleteBlocked', ['55000'], (tx, f) =>
    tx.deleteFrom('person_master.person_source_mapping').where('person_source_mapping_id', '=', f.id).execute());
  await rejected('stableTruncateBlocked', ['55000'], async (tx) => {
    await sql`set constraints all immediate`.execute(tx);
    await sql`truncate person_master.person_source_mapping cascade`.execute(tx);
  });
  await rejected('versionPersonUpdateBlocked', ['55000'], (tx, f) =>
    tx.updateTable('person_master.person_source_mapping_version').set({ person_id: people[1]! })
      .where('person_source_mapping_version_id', '=', f.first.person_source_mapping_version_id).execute());
  await rejected('versionDeleteBlocked', ['55000'], (tx, f) =>
    tx.deleteFrom('person_master.person_source_mapping_version')
      .where('person_source_mapping_version_id', '=', f.first.person_source_mapping_version_id).execute());
  await rejected('versionTruncateBlocked', ['55000'], async (tx) => {
    await sql`set constraints all immediate`.execute(tx);
    await sql`truncate person_master.person_source_mapping_version`.execute(tx);
  });
  checks['sourceMappingVersionImmutable'] = true;
  checks['silentRepointingBlocked'] = true;
  checks['physicalDeleteAbsent'] = true;

  await rejected('missingFirstVersionBlocked', ['23514'], async (tx, f) => {
    await tx.insertInto('person_master.person_source_mapping').values({ ...f.stable,
      creation_request_id: randomUUID(), source_record_key: `SYN-ORPHAN-${randomUUID()}` }).execute();
    await sql`set constraints all immediate`.execute(tx);
  });
  await rejected('firstVersionMustBeRegistered', ['23514'], async (tx, f) => {
    const requestId = randomUUID();
    const stable = await tx.insertInto('person_master.person_source_mapping').values({ ...f.stable,
      creation_request_id: requestId, source_record_key: `SYN-FIRST-${randomUUID()}` })
      .returning('person_source_mapping_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.person_source_mapping_version').values({ ...f.next,
      person_source_mapping_id: stable.person_source_mapping_id, version_no: '1',
      change_kind: 'CORRECTED', supersedes_mapping_version_id: null,
      request_id: requestId }).execute();
  });

  const invalidNext: Array<[string, Partial<Version>, readonly string[]]> = [
    ['versionSequence', { version_no: '3' }, ['23514']],
    ['supersedesRequired', { supersedes_mapping_version_id: null }, ['23514']],
    ['laterRegisteredBlocked', { change_kind: 'REGISTERED', reason_code: null }, ['23514']],
    ['correctionReasonRequired', { reason_code: null }, ['23514']],
    ['correctionMustBeMapped', { mapping_status: 'RETRACTED' }, ['23514']],
    ['personChangeRequiresCorrection', { person_id: people[1]!, change_kind: 'RETRACTED', mapping_status: 'RETRACTED' }, ['23514']],
    ['retractionKeepsPerson', { person_id: people[1]!, change_kind: 'RETRACTED', mapping_status: 'RETRACTED' }, ['23514']],
    ['retractionStatusGuard', { change_kind: 'RETRACTED', mapping_status: 'MAPPED' }, ['23514']],
    ['changeKindClosedSet', { change_kind: 'UPDATED' }, ['23514']],
    ['mappingStatusClosedSet', { mapping_status: 'ACTIVE' }, ['23514']],
    ['reasonClosedSet', { reason_code: 'FREE_TEXT' }, ['23514']],
    ['recordTimeRegression', { recorded_from: '2000-01-01T00:00:00' }, ['23514']],
    ['recordTimeFuture', { recorded_from: '2999-01-01T00:00:00' }, ['23514']],
    ['businessPeriodEmpty', { business_valid_to: '2025-01-01T00:00:00' }, ['23514']],
    ['businessPeriodInverted', { business_valid_to: '2024-01-01T00:00:00' }, ['23514', '22000']],
  ];
  for (const [name, invalid, codes] of invalidNext) await rejected(name, codes, (tx, f) =>
    tx.insertInto('person_master.person_source_mapping_version').values({ ...f.next, ...invalid }).execute());

  await rejected('supersedesSameAggregate', ['23503', '23514'], async (tx, f) => {
    const requestId = randomUUID();
    const other = await tx.insertInto('person_master.person_source_mapping').values({ ...f.stable,
      creation_request_id: requestId, source_record_key: `SYN-OTHER-${randomUUID()}` })
      .returning('person_source_mapping_id').executeTakeFirstOrThrow();
    const otherVersion = await tx.insertInto('person_master.person_source_mapping_version').values({
      ...f.next, person_source_mapping_id: other.person_source_mapping_id, version_no: '1',
      change_kind: 'REGISTERED', mapping_status: 'MAPPED', supersedes_mapping_version_id: null,
      reason_code: null, request_id: requestId,
    }).returning('person_source_mapping_version_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.person_source_mapping_version').values({ ...f.next,
      supersedes_mapping_version_id: otherVersion.person_source_mapping_version_id }).execute();
  });

  for (const [name, invalid] of [
    ['emptySourceSystem', { source_system: '' }],
    ['sourceSystemOuterWhitespace', { source_system: ' SYNTHETIC_HR' }],
    ['sourceEntityControl', { source_entity: 'PERSON\nRECORD' }],
    ['sourceKeyOuterWhitespace', { source_record_key: 'SYN-KEY\u3000' }],
    ['sourceKeyControl', { source_record_key: 'SYN\nKEY' }],
    ['sourceKeyOverlong', { source_record_key: '𠮷'.repeat(257) }],
  ] as const) await rejected(name, ['23514', '22001'], (tx, f) =>
    tx.insertInto('person_master.person_source_mapping').values({ ...f.stable,
      creation_request_id: randomUUID(), ...invalid }).execute());

  const stableColumns = await sql<{ column_name: string }>`select column_name from information_schema.columns
    where table_schema = 'person_master' and table_name = 'person_source_mapping' order by ordinal_position`.execute(handle.database);
  const names = stableColumns.rows.map((row) => row.column_name);
  assert.ok(!names.includes('person_id') && !names.includes('current_person_id') &&
    !names.includes('current_version') && !names.includes('current_mapping_status'));
  checks['personTargetAbsentFromStableRow'] = true;
  const objectCounts = await sql<{ tables: string; constraints: string; triggers: string; indexes: string }>`
    select
      (select count(*) from information_schema.tables
        where table_schema = 'person_master'
          and table_name in ('person_source_mapping', 'person_source_mapping_version'))::text as tables,
      (select count(*) from pg_constraint c join pg_class r on r.oid = c.conrelid
        join pg_namespace n on n.oid = r.relnamespace
        where n.nspname = 'person_master'
          and r.relname in ('person_source_mapping', 'person_source_mapping_version'))::text as constraints,
      (select count(*) from pg_trigger t join pg_class r on r.oid = t.tgrelid
        join pg_namespace n on n.oid = r.relnamespace
        where n.nspname = 'person_master' and not t.tgisinternal
          and r.relname in ('person_source_mapping', 'person_source_mapping_version'))::text as triggers,
      (select count(*) from pg_indexes
        where schemaname = 'person_master'
          and tablename in ('person_source_mapping', 'person_source_mapping_version'))::text as indexes
  `.execute(handle.database);
  const objectCount = objectCounts.rows[0]!;
  databaseSummary = { newTables: Number(objectCount.tables), newConstraints: Number(objectCount.constraints),
    newTriggers: Number(objectCount.triggers), newIndexes: Number(objectCount.indexes) };
  assert.equal(databaseSummary.newTables, 2);
  const forbidden = await sql<{ count: string }>`select count(*) from information_schema.columns
    where table_schema not in ('pg_catalog','information_schema')
      and (data_type in ('timestamp with time zone','time with time zone') or udt_name = 'tstzrange')`.execute(handle.database);
  assert.equal(forbidden.rows[0]?.count, '0');
  checks['forbiddenTimezoneTypeCountZero'] = true;
  const orphan = await sql<{ count: string }>`select count(*) from person_master.person_source_mapping m
    where not exists (select 1 from person_master.person_source_mapping_version v
      where v.person_source_mapping_id = m.person_source_mapping_id and v.version_no = 1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0');
  checks['orphanMappingsZero'] = true;

  async function rejected(name: string, codes: readonly string[],
    mutation: (tx: Transaction<DB>, fixture: Fixture) => Promise<unknown>) {
    let observed: unknown;
    try {
      await handle.database.transaction().execute(async (tx) => {
        const requestId = randomUUID();
        const stable: Stable = { governance_object_id: SOURCE_MAPPING_FIXTURE.objectId,
          source_system: SOURCE_MAPPING_FIXTURE.sourceSystems[0],
          source_entity: SOURCE_MAPPING_FIXTURE.sourceEntities[0],
          source_record_key: `SYN-CONSTRAINT-${requestId}`, creation_request_id: requestId,
          created_by: SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId };
        const mapping = await tx.insertInto('person_master.person_source_mapping').values(stable)
          .returning('person_source_mapping_id').executeTakeFirstOrThrow();
        const first = await tx.insertInto('person_master.person_source_mapping_version').values({
          person_source_mapping_id: mapping.person_source_mapping_id,
          governance_object_id: SOURCE_MAPPING_FIXTURE.objectId, person_id: people[0]!, version_no: '1',
          mapping_status: 'MAPPED', change_kind: 'REGISTERED', supersedes_mapping_version_id: null,
          reason_code: null, business_valid_from: '2025-01-01T00:00:00', business_valid_to: null,
          created_by: SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId, request_id: requestId,
          operation_hash: Buffer.alloc(32, 1),
        }).returningAll().executeTakeFirstOrThrow();
        const next: Version = { person_source_mapping_id: mapping.person_source_mapping_id,
          governance_object_id: SOURCE_MAPPING_FIXTURE.objectId, person_id: people[0]!, version_no: '2',
          mapping_status: 'MAPPED', change_kind: 'CORRECTED',
          supersedes_mapping_version_id: first.person_source_mapping_version_id,
          reason_code: 'BUSINESS_VALIDITY_CORRECTION', business_valid_from: '2025-01-01T00:00:00',
          business_valid_to: null, created_by: SOURCE_MAPPING_FIXTURE.sourceMappingOwnerId,
          request_id: randomUUID(), operation_hash: Buffer.alloc(32, 2) };
        await mutation(tx, { id: mapping.person_source_mapping_id, stable, first, next });
        throw rollback;
      });
    } catch (error) { observed = error; }
    assert.ok(observed !== rollback && observed && typeof observed === 'object' && 'code' in observed &&
      codes.includes(String(observed.code)), name);
    checks[name] = true;
  }
} finally { await handle.close(); }

checks['databasePoolClosed'] = true;
console.log(JSON.stringify({ task: 'PV-006-A-02B', classification: SOURCE_MAPPING_FIXTURE.classification,
  timeZone: SOURCE_MAPPING_FIXTURE.timeZone, status: 'PASSED', databaseSummary, checks }));
