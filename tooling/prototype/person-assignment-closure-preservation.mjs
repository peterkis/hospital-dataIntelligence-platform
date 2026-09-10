import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const directory = '.runtime/pv006-c0301/local-only-20260907';
const mode = process.argv[2];
assert.ok(mode === 'baseline' || mode === 'verify', 'CLOSURE_PRESERVATION_MODE_REQUIRED');
assert.ok(process.env.DATABASE_URL, 'MANAGED_DATABASE_REQUIRED');
const endpoint = new URL(process.env.DATABASE_URL);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434');
assert.equal(endpoint.pathname, '/hdi_prototype');
const pool = new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,application_name:'hdi-pv006-c0301-preservation'});
const quote = name => `"${name.replaceAll('"','""')}"`;
try {
  await mkdir(directory,{recursive:true});
  const identity = (await pool.query(`select current_database() as database,
    (select oid::text from pg_database where datname=current_database()) as oid,current_user as role,
    (select rolcreatedb from pg_roles where rolname=current_user) as can_create_database,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    (select count(*)::int from platform.schema_migration) as migrations,
    (select count(*)::int from information_schema.tables where table_type='BASE TABLE'
      and table_schema in ('platform','access_control','audit','batch_import','charge_catalog','department_master',
        'emergency_control','person_master','price_list','price_resolution','release_distribution','workflow')) as tables,
    to_char(platform.local_now(),'YYYY-MM-DD"T"HH24:MI:SS.US') as cutoff`)).rows[0];
  assert.equal(identity.database,'hdi_prototype'); assert.equal(identity.superuser,false); assert.equal(identity.can_create_database,false);
  const before = mode === 'verify' ? JSON.parse(await readFile(`${directory}/immutable-before.json`,'utf8')) : null;
  const cutoff = before?.identity.cutoff ?? identity.cutoff;
  const descriptors = before?.descriptors ?? (await pool.query(`select table_name,
    json_agg(column_name::text order by ordinal_position) as columns from information_schema.columns
    where table_schema='person_master' group by table_name order by table_name`)).rows;
  const manifest = {};
  for (const {table_name:table,columns} of descriptors) {
    // Catalog-derived quoted names; freeze the ORIGINAL column list before adding metadata.
    const clock = ['created_at','recorded_from','recorded_at','classified_at'].find(c=>columns.includes(c));
    const select = columns.map(c=>`t.${quote(c)}`).join(',');
    const filter = clock ? `t.${quote(clock)}<=$1::timestamp` :
      'exists (select 1 from person_master.assignment_version v where v.assignment_version_id=t.assignment_version_id and v.recorded_from<=$1::timestamp)';
    manifest[table] = (await pool.query(`select count(*)::int as count,
      encode(digest(coalesce(string_agg(j,'' order by j),''),'sha256'),'hex') as digest
      from (select to_jsonb(original)::text as j from (select ${select} from person_master.${quote(table)} t where ${filter}) original) rows`,[cutoff])).rows[0];
  }
  if (before) {assert.equal(identity.oid,before.identity.oid);assert.deepEqual(manifest,before.manifest,'PREEXISTING_PERSON_FACTS_CHANGED');}
  else {assert.equal(identity.migrations,34);}
  const file = `${directory}/immutable-${mode==='baseline'?'before':`after-${randomUUID()}`}.json`;
  await writeFile(file,JSON.stringify({task:'PV-006-C-03-01',mode,identity,descriptors,manifest},null,2),{flag:'wx'});
  console.log(JSON.stringify({task:'PV-006-C-03-01',mode,status:'PASS',identity,protectedTables:descriptors.length,receipt:file}));
} finally {await pool.end();}
