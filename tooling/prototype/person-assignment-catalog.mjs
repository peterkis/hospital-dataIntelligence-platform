import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

assert.ok(process.env.DATABASE_URL, 'ASSIGNMENT_MANAGED_DATABASE_REQUIRED');
const directory = `.runtime/pv006-c01/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'hdi-pv006-c01-catalog' });
try {
  const identity = (await pool.query(`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid, current_user as role,
    (select rolcreatedb from pg_roles where rolname=current_user) as createdb,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    (select count(*)::int from platform.schema_migration) as migrations,
    to_char(platform.local_now(),'YYYY-MM-DD"T"HH24:MI:SS.US') as observed_at`)).rows[0];
  const tables = (await pool.query(`select c.relname,
    (select count(*)::int from pg_constraint k where k.conrelid=c.oid) as constraints,
    (select count(*)::int from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as triggers,
    (select count(*)::int from pg_index i where i.indrelid=c.oid) as indexes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='person_master' and c.relname in
      ('assignment','assignment_version','assignment_validation_segment','assignment_command_outcome') order by c.relname`)).rows;
  const constraints = (await pool.query(`select c.relname,k.conname,pg_get_constraintdef(k.oid) as definition
    from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='person_master' and c.relname like 'assignment%' order by 1,2`)).rows;
  const forbidden = (await pool.query(`select count(*)::int as count from information_schema.columns
    where table_schema not in ('pg_catalog','information_schema')
    and udt_name in ('timestamptz','timetz','tstzrange','tstzmultirange')`)).rows[0].count;
  assert.equal(identity.database, 'hdi_prototype'); assert.equal(identity.migrations, 35);
  assert.equal(identity.createdb, false); assert.equal(identity.superuser, false); assert.equal(forbidden, 0); assert.equal(tables.length, 4);
  const result = { task: 'PV-006-C-01', status: 'PASSED', identity, tables, constraints, forbiddenTimezoneTypes: forbidden };
  await writeFile(`${directory}/catalog.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, constraints: undefined, evidenceDirectory: directory }));
} finally { await pool.end(); }
