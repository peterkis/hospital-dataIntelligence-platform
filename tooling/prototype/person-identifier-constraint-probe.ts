import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql, type Insertable, type Transaction } from 'kysely';
import type { DB } from '../../apps/governance-api/src/platform/database/database-types.generated.js';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { IDENTIFIER_FIXTURE, seedIdentifierScope } from './person-identifier-fixture.js';

if (!process.env['DATABASE_URL']) throw new Error('PERSON_IDENTIFIER_DATABASE_REQUIRED');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], application_name: 'hdi-identifier-constraint-probe', max: 2 });
const checks: Record<string, boolean> = {};
const rollback = new Error('ROLLBACK_SYNTHETIC_PROBE');
type Stable = Insertable<DB['person_master.person_identifier']>;
type Version = Insertable<DB['person_master.person_identifier_version']>;
type Fixture = { id: string; personId: string; requestId: string; stable: Stable; version: Version };
try {
  const persons = await seedIdentifierScope(handle.database);
  const count = await sql<{ count: string }>`select count(*) from platform.schema_migration`.execute(handle.database);
  assert.ok(Number(count.rows[0]?.count) >= 21); checks['identifierMigrationPresent'] = true;
  const registryMigration = await handle.database.selectFrom('platform.schema_migration').select('migration_id')
    .where('migration_id', '=', '0021_person_identifier_registry').executeTakeFirst();
  assert.equal(registryMigration?.migration_id, '0021_person_identifier_registry');
  const metadata = await sql<{ version: string; timezone: string }>`select current_setting('server_version') as version, current_setting('TimeZone') as timezone`.execute(handle.database);
  assert.match(metadata.rows[0]!.version, /^18\./u); assert.equal(metadata.rows[0]!.timezone, 'Asia/Shanghai');

  await rejected('fullHistoryExactUnique', ['23505'], (tx, f) => tx.insertInto('person_master.person_identifier').values({ ...f.stable, person_id: persons[1]!, creation_request_id: randomUUID() }).execute());
  await rejected('duplicateSamePersonBlocked', ['23505'], (tx, f) => tx.insertInto('person_master.person_identifier').values({ ...f.stable, creation_request_id: randomUUID() }).execute());
  await rejected('creationRequestUnique', ['23505'], (tx, f) => tx.insertInto('person_master.person_identifier').values({ ...f.stable, identifier_value: 'SYN-PN-OTHER' }).execute());
  await rejected('unknownPersonForeignKey', ['23503'], (tx, f) => tx.insertInto('person_master.person_identifier').values({ ...f.stable, person_id: randomUUID(), creation_request_id: randomUUID(), identifier_value: 'SYN-PN-UNKNOWN' }).execute());
  for (const column of ['person_id', 'identifier_system', 'identifier_value'] as const) {
    await rejected(`stable_${column}_immutable`, ['55000'], (tx, f) => tx.updateTable('person_master.person_identifier')
      .set({ [column]: column === 'person_id' ? persons[1]! : 'SYNTHETIC' }).where('person_identifier_id', '=', f.id).execute());
  }
  await rejected('stableDeleteBlocked', ['55000'], (tx, f) => tx.deleteFrom('person_master.person_identifier').where('person_identifier_id', '=', f.id).execute());
  await rejected('stableTruncateBlocked', ['55000'], async (tx) => { await sql`set constraints all immediate`.execute(tx); await sql`truncate person_master.person_identifier cascade`.execute(tx); });
  await rejected('versionUpdateBlocked', ['55000'], (tx, f) => tx.updateTable('person_master.person_identifier_version').set({ assertion_status: 'RETRACTED' }).where('person_identifier_id', '=', f.id).execute());
  await rejected('versionDeleteBlocked', ['55000'], (tx, f) => tx.deleteFrom('person_master.person_identifier_version').where('person_identifier_id', '=', f.id).execute());
  await rejected('versionTruncateBlocked', ['55000'], async (tx) => { await sql`set constraints all immediate`.execute(tx); await sql`truncate person_master.person_identifier_version`.execute(tx); });
  const invalidVersions: Array<[string, Partial<Version>, string[]]> = [
    ['versionDuplicate', { version_no: '1' }, ['23514', '23505']], ['versionSkip', { version_no: '3' }, ['23514']],
    ['versionZero', { version_no: '0' }, ['23514']], ['assertionClosedSet', { assertion_status: 'CANDIDATE' }, ['23514']],
    ['recordTimeRegression', { recorded_from: '2000-01-01T00:00:00' }, ['23514']],
    ['recordTimeFuture', { recorded_from: '2999-01-01T00:00:00' }, ['23514']],
    ['businessPeriodEmpty', { business_valid_to: '2020-01-01T00:00:00' }, ['23514']],
    ['businessPeriodInverted', { business_valid_to: '2019-01-01T00:00:00' }, ['23514', '22000']],
    ['versionPersonBinding', { person_id: persons[1]! }, ['23503']],
    ['versionScopeBinding', { governance_object_id: '74000000-0000-7000-8000-000000000001' }, ['23503', '23514']],
  ];
  for (const [name, invalid, codes] of invalidVersions) await rejected(name, codes, (tx, f) => tx.insertInto('person_master.person_identifier_version')
    .values({ ...f.version, version_no: '2', request_id: randomUUID(), ...invalid }).execute());
  await rejected('versionRequestUnique', ['23505'], (tx, f) => tx.insertInto('person_master.person_identifier_version').values({ ...f.version, version_no: '2' }).execute());
  await rejected('missingFirstVersion', ['23514'], async (tx, f) => {
    await tx.insertInto('person_master.person_identifier').values({ ...f.stable, creation_request_id: randomUUID(), identifier_value: 'SYN-PN-ORPHAN' }).execute();
    await sql`set constraints all immediate`.execute(tx);
  });
  await rejected('initialRetractionBlocked', ['23514'], async (tx, f) => {
    const requestId = randomUUID();
    const added = await tx.insertInto('person_master.person_identifier').values({ ...f.stable, creation_request_id: requestId, identifier_value: 'SYN-PN-INITIAL' }).returning('person_identifier_id').executeTakeFirstOrThrow();
    await tx.insertInto('person_master.person_identifier_version').values({ ...f.version, request_id: requestId, person_identifier_id: added.person_identifier_id, assertion_status: 'RETRACTED' }).execute();
  });
  await rejected('retractionDoesNotReleaseUniqueBinding', ['23505'], async (tx, f) => {
    await tx.insertInto('person_master.person_identifier_version').values({ ...f.version, version_no: '2', request_id: randomUUID(), assertion_status: 'RETRACTED' }).execute();
    await tx.insertInto('person_master.person_identifier').values({ ...f.stable, person_id: persons[1]!, creation_request_id: randomUUID() }).execute();
  });
  await rejected('expiryDoesNotReleaseUniqueBinding', ['23505'], async (tx, f) => {
    await tx.insertInto('person_master.person_identifier_version').values({ ...f.version, version_no: '2', request_id: randomUUID(), business_valid_to: '2021-01-01T00:00:00' }).execute();
    await tx.insertInto('person_master.person_identifier').values({ ...f.stable, person_id: persons[1]!, creation_request_id: randomUUID() }).execute();
  });
  for (const [name, invalid] of [
    ['emptySystem', { identifier_system: '' }], ['relativeSystem', { identifier_system: 'local' }], ['systemSpace', { identifier_system: ' urn:test:x' }],
    ['overlongSystem', { identifier_system: `urn:${'x'.repeat(509)}` }], ['emptyValue', { identifier_value: '' }],
    ['unicodeOuterWhitespace', { identifier_value: '\u3000SYN' }], ['controlValue', { identifier_value: 'SYN\nX' }],
    ['c1ControlValue', { identifier_value: 'SYN\u0085X' }], ['overlongValue', { identifier_value: '𠮷'.repeat(257) }],
  ] as const) await rejected(name, ['23514', '22001'], (tx, f) => tx.insertInto('person_master.person_identifier').values({ ...f.stable, creation_request_id: randomUUID(), ...invalid }).execute());
  const forbidden = await sql<{ count: string }>`select count(*) from information_schema.columns where table_schema not in ('pg_catalog','information_schema')
    and (data_type in ('timestamp with time zone','time with time zone') or udt_name = 'tstzrange')`.execute(handle.database);
  assert.equal(forbidden.rows[0]?.count, '0'); checks['forbiddenTimezoneTypeCountZero'] = true;
  const orphan = await sql<{ count: string }>`select count(*) from person_master.person_identifier i where not exists
    (select 1 from person_master.person_identifier_version v where v.person_identifier_id=i.person_identifier_id and v.version_no=1)`.execute(handle.database);
  assert.equal(orphan.rows[0]?.count, '0'); checks['orphanIdentifiersZero'] = true;

  async function rejected(name: string, codes: readonly string[], mutation: (tx: Transaction<DB>, f: Fixture) => Promise<unknown>) {
    let observed: unknown;
    try {
      await handle.database.transaction().execute(async (tx) => {
        const requestId = randomUUID();
        const stable: Stable = { person_id: persons[0]!, governance_object_id: IDENTIFIER_FIXTURE.objectId,
          identifier_system: IDENTIFIER_FIXTURE.systems[0], identifier_value: `SYN-PN-${requestId}`,
          creation_request_id: requestId, created_by: IDENTIFIER_FIXTURE.identifierOwnerId };
        const row = await tx.insertInto('person_master.person_identifier').values(stable).returning('person_identifier_id').executeTakeFirstOrThrow();
        const version: Version = { person_identifier_id: row.person_identifier_id, person_id: persons[0]!, governance_object_id: IDENTIFIER_FIXTURE.objectId,
          version_no: '1', assertion_status: 'ASSERTED', business_valid_from: '2020-01-01T00:00:00', business_valid_to: null,
          created_by: IDENTIFIER_FIXTURE.identifierOwnerId, request_id: requestId, operation_hash: Buffer.alloc(32, 1) };
        await tx.insertInto('person_master.person_identifier_version').values(version).execute();
        await mutation(tx, { id: row.person_identifier_id, personId: persons[0]!, requestId, stable, version });
        throw rollback;
      });
    } catch (error) { observed = error; }
    assert.ok(observed !== rollback && observed && typeof observed === 'object' && 'code' in observed && codes.includes(String(observed.code)), name);
    checks[name] = true;
  }
} finally { await handle.close(); }
checks['databasePoolClosed'] = true;
console.log(JSON.stringify({ task: 'PV-006-A-02A', classification: IDENTIFIER_FIXTURE.classification, timeZone: IDENTIFIER_FIXTURE.timeZone, status: 'PASSED', checks }));
