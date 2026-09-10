import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';

const directory = '.runtime/pv006-c01/20260906T232526';
const mode = process.argv[2];
assert.ok(mode === 'baseline' || mode === 'verify', 'ASSIGNMENT_PRESERVATION_MODE_REQUIRED');
assert.ok(process.env.DATABASE_URL, 'MANAGED_DATABASE_REQUIRED');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1,
  application_name: 'hdi-pv006-c01-preservation' });
const tables = {
  person_subject: 'created_at', person_subject_version: 'recorded_from',
  person_identifier: 'created_at', person_identifier_version: 'recorded_from',
  person_source_mapping: 'created_at', person_source_mapping_version: 'recorded_from',
  engagement: 'created_at', engagement_version: 'recorded_from',
  engagement_type: 'created_at', engagement_type_version: 'recorded_from',
  engagement_classification: 'classified_at', engagement_overlap_rule: 'created_at',
  engagement_overlap_rule_version: 'recorded_from', engagement_lifecycle_event: 'recorded_at',
  engagement_lifecycle_rejection: 'recorded_at',
};
try {
  const identity = (await pool.query(`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid,
    current_user as role, (select rolcreatedb from pg_roles where rolname=current_user) as can_create_database,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    (select count(*)::int from platform.schema_migration) as migrations,
    to_char(platform.local_now(),'YYYY-MM-DD"T"HH24:MI:SS.US') as cutoff`)).rows[0];
  assert.equal(identity.database, 'hdi_prototype');
  assert.equal(identity.superuser, false);
  const before = mode === 'verify' ? JSON.parse(await readFile(`${directory}/immutable-before.json`, 'utf8')) : null;
  const cutoff = before?.identity.cutoff ?? identity.cutoff;
  const manifest = {};
  for (const [table, column] of Object.entries(tables)) {
    // Fixed local allowlist, never caller-controlled SQL names. Only hashes leave PostgreSQL.
    manifest[table] = (await pool.query(`select count(*)::int as count,
      encode(digest(coalesce(string_agg(j,'' order by j),''),'sha256'),'hex') as digest
      from (select to_jsonb(t)::text as j from person_master.${table} t where ${column} <= $1::timestamp) rows`, [cutoff])).rows[0];
  }
  if (before) {
    assert.equal(identity.oid, before.identity.oid);
    assert.deepEqual(manifest, before.manifest, 'PREEXISTING_IMMUTABLE_ROWS_CHANGED');
  }
  await writeFile(`${directory}/immutable-${mode === 'baseline' ? 'before' : 'after'}.json`,
    JSON.stringify({ task: 'PV-006-C-01', mode, identity, manifest }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: 'PV-006-C-01', mode, status: 'PASSED', identity, protectedTables: Object.keys(manifest).length }));
} finally { await pool.end(); }
