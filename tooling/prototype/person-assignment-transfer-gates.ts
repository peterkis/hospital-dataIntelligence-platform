import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { sql } from 'kysely';
import { createDatabase } from '../../apps/governance-api/src/platform/database/create-database.js';
import { checkDepartmentConsumerCanonical } from './check-department-consumer-canonical.js';

assert.ok(process.env['DATABASE_URL'], 'C0302_MANAGED_DATABASE_REQUIRED');
const endpoint = new URL(process.env['DATABASE_URL']);
assert.equal(endpoint.hostname, '127.0.0.1'); assert.equal(endpoint.port, '55434'); assert.equal(endpoint.pathname, '/hdi_prototype');
const authority = '7666716dd24320dbba28cd02400755318e9bee7f';
const directory = `.runtime/pv006-c0302/${randomUUID()}`;
await mkdir(directory, { recursive: false });
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const handle = createDatabase({ connectionString: process.env['DATABASE_URL'], max: 1, application_name: 'hdi-pv006-c0302-gates' });
try {
  const ownership = JSON.parse(await readFile('db/table-ownership.json', 'utf8'));
  const schemas = Object.keys(ownership.schemas);
  const catalog = (await sql<{ migrations: number; tables: number; forbidden: number; superuser: boolean; createdb: boolean }>`select
    (select count(*)::int from platform.schema_migration) as migrations,
    (select count(*)::int from information_schema.tables where table_schema=any(${schemas}::text[]) and table_type='BASE TABLE') as tables,
    (select count(*)::int from information_schema.columns where table_schema=any(${schemas}::text[])
      and udt_name in ('timestamptz','timetz','tstzrange','tstzmultirange')) as forbidden,
    (select rolsuper from pg_roles where rolname=current_user) as superuser,
    (select rolcreatedb from pg_roles where rolname=current_user) as createdb`.execute(handle.database)).rows[0]!;
  assert.deepEqual(catalog, { migrations: 38, tables: 90, forbidden: 0, superuser: false, createdb: false });
  const functions = (await sql<{ name: string; arguments: string; definitionSha256: string }>`select p.proname as name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    encode(digest(pg_get_functiondef(p.oid),'sha256'),'hex') as "definitionSha256"
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='person_master'
      and p.proname in ('assignment_transfer_child','guard_assignment_transfer_header',
        'guard_assignment_transfer_participant','guard_assignment_transfer_complete') order by p.proname`.execute(handle.database)).rows;
  assert.deepEqual(functions.map(row => row.name), ['assignment_transfer_child', 'guard_assignment_transfer_complete',
    'guard_assignment_transfer_header', 'guard_assignment_transfer_participant']);
  const pairs = (await sql<{ transfers: number; invalid: number }>`select count(*)::int as transfers,
    count(*) filter (where c.recorded_from is distinct from t.recorded_from or v.recorded_from is distinct from t.recorded_from
      or a.created_at is distinct from t.recorded_from or s.semantic_recorded_from is distinct from t.recorded_from
      or v.evaluation_record_as_of is distinct from t.recorded_from or o.transfer_id is distinct from t.transfer_id
      or c.business_valid_to is distinct from t.effective_at or v.business_valid_from is distinct from t.effective_at
      or v.business_valid_to is distinct from t.source_original_to)::int as invalid
    from person_master.assignment_transfer t
    left join person_master.assignment_version c on c.assignment_version_id=t.source_closure_version_id
    left join person_master.assignment_version v on v.assignment_version_id=t.target_admission_version_id
    left join person_master.assignment a on a.assignment_id=t.target_assignment_id
    left join person_master.assignment_version_semantics s on s.assignment_version_id=t.target_admission_version_id
    left join person_master.assignment_command_outcome o on o.governance_object_id=t.governance_object_id and o.request_id=t.root_request_id`.execute(handle.database)).rows[0]!;
  assert.ok(pairs.transfers > 0); assert.equal(pairs.invalid, 0);
  const tables = (await sql<{ table: string; columns: number; constraints: number; triggers: number; indexes: number }>`select c.relname as table,
    (select count(*)::int from information_schema.columns a where a.table_schema=n.nspname and a.table_name=c.relname) as columns,
    (select count(*)::int from pg_constraint k where k.conrelid=c.oid) as constraints,
    (select count(*)::int from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as triggers,
    (select count(*)::int from pg_index i where i.indrelid=c.oid) as indexes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='person_master' and c.relkind='r'
      and c.relname like 'assignment%' order by c.relname`.execute(handle.database)).rows;
  const protectedPaths = ['contracts/openapi/phase-01.openapi.json', 'packages/generated-api-client', 'apps/admin-web',
    'tooling/prototype/fixtures/department-consumer-baseline.json'];
  assert.equal(execFileSync('git', ['diff', authority, '--', ...protectedPaths], { encoding: 'utf8' }), '', 'C0302_FROZEN_SURFACE_CHANGED');
  assert.equal(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all', '--', ...protectedPaths], { encoding: 'utf8' }), '', 'C0302_FROZEN_SURFACE_DIRTY');
  const apiBytes = await readFile(protectedPaths[0]!);
  assert.equal(hash(apiBytes), 'f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035');
  const api = JSON.parse(apiBytes.toString('utf8'));
  assert.equal(Object.keys(api.paths).filter(path => path.includes('department')).length, 15);
  const originalMigrations = [];
  for (const name of (await readdir('db/migrations')).filter(name => /^\d{4}_.*\.sql$/u.test(name) && Number(name.slice(0, 4)) <= 35).sort()) {
    const path = `db/migrations/${name}`, actual = await readFile(path);
    // core.autocrlf=true is an existing checkout setting. Compare Git's clean
    // content without rewriting either working bytes or the frozen migration.
    const originalBlob = execFileSync('git', ['rev-parse', `${authority}:${path}`], { encoding: 'utf8' }).trim();
    const workingBlob = execFileSync('git', ['hash-object', '--path', path, path], { encoding: 'utf8' }).trim();
    assert.equal(workingBlob, originalBlob, `APPLIED_MIGRATION_CHANGED:${name}`);
    originalMigrations.push({ name, workingSha256: hash(actual), originalBlob, workingBlob });
  }
  assert.equal(originalMigrations.length, 35);
  const canonical = checkDepartmentConsumerCanonical(); assert.equal(canonical.contracts.length, 7);
  const result = { task: 'PV-006-C-03-02', status: 'PASS', authority, catalog, tables, functions, pairs, originalMigrations,
    openApiSha256: hash(apiBytes), departmentPaths: 15, generatedClientAndBrowserUnchanged: true, canonical,
    argv: process.argv.slice(1), cwd: process.cwd() };
  await writeFile(`${directory}/gates.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: result.task, status: result.status, catalog, tables, originalMigrations: originalMigrations.length,
    newFunctions: functions.length, pairs, canonicalContracts: canonical.contracts.length, openApiSha256: result.openApiSha256, directory }));
} finally { await handle.close(); }
