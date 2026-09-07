import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { normalizeSchemaManifest } from './person-engagement-temporal-schema.mjs';

// Run only inside prototype:db:with. Peer administration is limited to the
// task-owned database; the application role receives no new cluster privileges.
if (!process.env.DATABASE_URL) throw new Error('ASSIGNMENT_DATABASE_REQUIRED');
const sourceUrl = new URL(process.env.DATABASE_URL);
assert.equal(decodeURIComponent(sourceUrl.pathname.slice(1)), 'hdi_prototype');
assert.equal(decodeURIComponent(sourceUrl.username), 'hdi_prototype');
assert.equal(sourceUrl.hostname, '127.0.0.1');
assert.equal(sourceUrl.port, '55434');
const runId = randomUUID();
const semantics = process.argv.includes('--assignment-semantics');
assert.ok(process.argv.slice(2).length === 0 || (semantics && process.argv.slice(2).length === 1), 'ASSIGNMENT_FRESH_MODE_INVALID');
const task = semantics ? 'PV-006-C-02' : 'PV-006-C-01';
const prefix = semantics ? 'pv006_c02' : 'pv006_c01';
const databaseName = `${prefix}_${runId.replaceAll('-', '')}`;
const directory = `.runtime/${semantics ? 'pv006-c02' : 'pv006-c01'}/${runId}`;
assert.equal(execFileSync('git', ['check-ignore', `${directory}/ownership.json`],
  { encoding: 'utf8' }).trim(), `${directory}/ownership.json`);
await mkdir(directory, { recursive: false });
const result = { task, runId, mode: 'FRESH_INSTALL',
  baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  classification: 'SYNTHETIC / NON_PRODUCTION', databaseName, created: false,
  migrationsPassed: false, temporaryDatabaseRemoved: false, commands: [] };
const sourcePool = new pg.Pool({ connectionString: sourceUrl.toString(), max: 1,
  application_name: 'hdi-pv006-c01-fresh-source' });
let freshPool;
let receipt;
try {
  const source = (await sourcePool.query(`select current_database() as database,
    pg_postmaster_start_time()::text as started_at,
    (select count(*)::int from platform.schema_migration) as migration_count`)).rows[0];
  assert.equal(source.migration_count, 34);
  const admin = JSON.parse(peer(`select json_build_object('role',current_user,
    'started_at',pg_postmaster_start_time()::text,'can_create',rolcreatedb or rolsuper,
    'app_createdb',(select rolcreatedb from pg_roles where rolname='hdi_prototype'))
    from pg_roles where rolname=current_user;`));
  assert.equal(admin.role, 'postgres');
  assert.equal(admin.can_create, true);
  // Compare instants, independent of each connection's display TimeZone.
  assert.equal(Date.parse(admin.started_at), Date.parse(source.started_at));
  result.admin = admin;
  assert.equal(peer(`select count(*) from pg_database where datname='${databaseName}';`), '0');
  peer(`create database "${databaseName}" owner hdi_prototype template template0;`);
  result.created = true;
  const identity = JSON.parse(peer(`select json_build_object('oid',oid::text,
    'owner',pg_get_userbyid(datdba),'name',datname) from pg_database where datname='${databaseName}';`));
  assert.equal(identity.owner, 'hdi_prototype');
  receipt = { task: result.task, runId, mode: result.mode, databaseName,
    baselineCommit: result.baselineCommit, identity, sourceDatabase: source.database,
    endpoint: { host: sourceUrl.hostname, port: sourceUrl.port, role: decodeURIComponent(sourceUrl.username) },
    sourceStartedAt: source.started_at, createdByPeerRole: admin.role };
  await writeFile(`${directory}/ownership.json`, JSON.stringify(receipt, null, 2), { flag: 'wx' });
  const freshUrl = new URL(sourceUrl);
  freshUrl.pathname = `/${databaseName}`;
  freshPool = new pg.Pool({ connectionString: freshUrl.toString(), max: 1,
    application_name: 'hdi-pv006-c01-fresh-inspection' });
  const empty = (await freshPool.query(`select count(*)::int as count from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p')
    and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'`)).rows[0];
  assert.equal(empty.count, 0);
  result.emptyBeforeMigrations = true;
  const argv = ['tooling/runtime/apply-migrations.mjs', 'db/migrations'];
  const migrated = spawnSync(process.execPath, argv, { cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: freshUrl.toString() }, windowsHide: true });
  const output = redact(`${migrated.stdout ?? ''}\n${migrated.stderr ?? ''}`);
  await writeFile(`${directory}/migration-output.log`, output, { flag: 'wx' });
  result.commands.push({ command: 'node tooling/runtime/apply-migrations.mjs db/migrations',
    argv, cwd: process.cwd(), executable: process.execPath, target: databaseName, exitCode: migrated.status });
  result.appliedMigrations = [...output.matchAll(/^Applied (\d{4}_[a-z0-9_]+)$/gm)].map(m => m[1]);
  if (migrated.status !== 0) throw new Error('FRESH_MIGRATION_CHAIN_FAILED');
  const schemas = Object.keys(JSON.parse(await readFile('db/table-ownership.json', 'utf8')).schemas);
  const counts = (await freshPool.query(`select
    (select count(*)::int from platform.schema_migration) as migrations,
    (select count(*)::int from information_schema.tables where table_schema=any($1::text[])
     and table_type='BASE TABLE') as tables`, [schemas])).rows[0];
  assert.equal(counts.migrations, 34);
  assert.equal(counts.tables, 88);
  result.counts = counts;
  result.migrationsPassed = true;
  const sourceManifest = await schemaManifest(sourcePool, schemas);
  const freshManifest = await schemaManifest(freshPool, schemas);
  await writeFile(`${directory}/source-schema.json`, JSON.stringify(sourceManifest, null, 2), { flag: 'wx' });
  await writeFile(`${directory}/fresh-schema.json`, JSON.stringify(freshManifest, null, 2), { flag: 'wx' });
  const normalizedSource = normalizeSchemaManifest(sourceManifest);
  const normalizedFresh = normalizeSchemaManifest(freshManifest);
  await writeFile(`${directory}/normalized-source-schema.json`, JSON.stringify(normalizedSource, null, 2), { flag: 'wx' });
  await writeFile(`${directory}/normalized-fresh-schema.json`, JSON.stringify(normalizedFresh, null, 2), { flag: 'wx' });
  assert.deepEqual(normalizedFresh, normalizedSource, 'FRESH_SCHEMA_AUTHORITY_MISMATCH');
  result.schemaEquivalent = true;
  const generated = resolve(directory, 'database-types.generated.ts');
  child('generated-types', ['node_modules/kysely-codegen/dist/cli/bin.js',
    '--config-file', 'apps/governance-api/kysely-codegen.json', '--out-file', generated], freshUrl);
  assert.equal((await readFile(generated, 'utf8')).replaceAll('\r\n', '\n'),
    (await readFile('apps/governance-api/src/platform/database/database-types.generated.ts', 'utf8')).replaceAll('\r\n', '\n'),
    'FRESH_GENERATED_TYPES_MISMATCH');
  result.generatedTypesEquivalent = true;
  child('official-seed', ['--import', 'tsx', 'tooling/prototype/seed-prototype.ts'], freshUrl);
  child('department-seed', ['--import', 'tsx', 'tooling/prototype/seed-department-demo.ts'], freshUrl);
  child('person-seed', ['--import', 'tsx', 'tooling/prototype/person-assignment-fresh-seed.ts'], freshUrl);
  result.seedPassed = true;
  child('focused-application', ['--import', 'tsx', 'tooling/prototype/person-assignment-application-probe.ts'], freshUrl);
  if (semantics) {
    child('semantic-application', ['--import', 'tsx', 'tooling/prototype/person-assignment-semantics-application-probe.ts'], freshUrl);
    child('semantic-sql', ['--import', 'tsx', 'tooling/prototype/person-assignment-semantics-application-probe.ts', '--sql-probe'], freshUrl);
    result.semanticApplicationAndSqlPassed = true;
  }
  result.focusedApplicationPassed = true;
  assert.deepEqual(await schemaManifest(freshPool, schemas), freshManifest, 'SEED_OR_PROBE_CHANGED_SCHEMA');
  result.status = 'FRESH_INSTALL_PASSED';
} catch (error) {
  result.status = 'BLOCKED_CLEAN_INSTALL_VALIDATION';
  result.errorCode = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message : 'FRESH_INSTALL_PROBE_FAILED';
  result.diagnostic = error instanceof Error ? redact(error.message).slice(0, 1000) : null;
  process.exitCode = 1;
} finally {
  if (freshPool) await freshPool.end();
  await sourcePool.end();
  if (receipt) {
    // Re-read the create-exclusive receipt and verify identity before cleanup.
    const stored = JSON.parse(await readFile(`${directory}/ownership.json`, 'utf8'));
    assert.deepEqual(stored, receipt);
    assert.match(stored.databaseName, /^pv006_c0[12]_[a-f0-9]{32}$/);
    function validateCleanup(candidate) {
      assert.ok(candidate, 'C01_CLEANUP_RECEIPT_REQUIRED');
      assert.equal(candidate.task, task); assert.equal(candidate.mode, 'FRESH_INSTALL');
      assert.equal(candidate.databaseName, databaseName);
      assert.deepEqual(candidate.endpoint, { host: '127.0.0.1', port: '55434', role: 'hdi_prototype' });
      const current = JSON.parse(peer(`select json_build_object('oid',oid::text,
        'owner',pg_get_userbyid(datdba),'name',datname) from pg_database where datname='${databaseName}';`));
      assert.deepEqual(current, candidate.identity);
      assert.equal(peer(`select count(*) from pg_stat_activity where datname='${databaseName}';`), '0');
    }
    const negatives = [null, { ...stored, mode: 'APPLICATION' }, { ...stored, databaseName: 'hdi_prototype' },
      { ...stored, identity: { ...stored.identity, oid: '0' } }, { ...stored, endpoint: { ...stored.endpoint, port: '1' } }];
    for (const candidate of negatives) {
      assert.throws(() => validateCleanup(candidate));
      assert.equal(peer(`select count(*) from pg_database where datname='${databaseName}';`), '1');
    }
    result.cleanupNegativeCases = negatives.length;
    validateCleanup(stored);
    const identity = JSON.parse(peer(`select json_build_object('oid',oid::text,
      'owner',pg_get_userbyid(datdba),'name',datname) from pg_database where datname='${databaseName}';`));
    assert.deepEqual(identity, stored.identity);
    assert.equal(peer(`select count(*) from pg_stat_activity where datname='${databaseName}';`), '0');
    peer(`drop database "${databaseName}";`);
    assert.equal(peer(`select count(*) from pg_database where datname='${databaseName}';`), '0');
    result.temporaryDatabaseRemoved = true;
  }
  await writeFile(`${directory}/fresh-install.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ ...result, evidenceDirectory: directory }));
}

function peer(statement) {
  const argv = ['-d', 'Anolis-8.9-HDI-POC', '-u', 'postgres', '--',
    'psql', '-X', '-w', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-p', '55434', '-d', 'postgres'];
  const command = spawnSync('wsl.exe', argv,
  { input: statement, encoding: 'utf8', windowsHide: true });
  result.commands.push({ executable: 'wsl.exe', argv, cwd: process.cwd(), statement, exitCode: command.status });
  if (command.status !== 0) throw new Error('PEER_ADMIN_COMMAND_FAILED');
  return command.stdout.trim();
}

function redact(value) {
  let safe = value.replaceAll(sourceUrl.toString(), '[DATABASE_URL]')
    .replaceAll(process.env.DATABASE_URL, '[DATABASE_URL]');
  const password = decodeURIComponent(sourceUrl.password);
  if (password) safe = safe.replaceAll(password, '[REDACTED]')
    .replaceAll(sourceUrl.password, '[REDACTED]');
  return safe.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu, '[DATABASE_URL]');
}

function child(label, argv, url) {
  const execution = spawnSync(process.execPath, argv, { cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url.toString() }, windowsHide: true });
  result.commands.push({ executable: process.execPath, argv, cwd: process.cwd(), target: databaseName, exitCode: execution.status });
  // Only known tool output; both connection URLs and the configured password are redacted.
  const output = redact(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`);
  // Synchronous write avoids unawaited evidence work during cleanup.
  writeFileSync(`${directory}/${label}.log`, output, { flag: 'wx' });
  if (execution.status !== 0) throw new Error(`FRESH_${label.replaceAll('-', '_').toUpperCase()}_FAILED`);
}

async function schemaManifest(pool, schemas) {
  // Exclude database identity, OIDs and record timestamps, not semantic DDL.
  const queries = {
    migrations: 'select migration_id from platform.schema_migration order by migration_id',
    tables: `select table_schema,table_name,table_type from information_schema.tables where table_schema=any($1::text[]) order by 1,2`,
    columns: `select table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,
      character_maximum_length,numeric_precision,numeric_scale,datetime_precision,udt_schema,udt_name,is_identity,is_generated,generation_expression
      from information_schema.columns where table_schema=any($1::text[]) order by 1,2,4`,
    constraints: `select n.nspname,c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,
      pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1::text[]) order by 1,2,3`,
    triggers: `select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition
      from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=any($1::text[]) and not t.tgisinternal order by 1,2,3`,
    functions: `select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
      pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=any($1::text[]) order by 1,2,3`,
    indexes: `select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname=any($1::text[]) order by 1,2,3`,
    types: `select n.nspname,t.typname,t.typtype,format_type(t.typbasetype,t.typtypmod) as base,
      (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) as labels
      from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname=any($1::text[]) and t.typtype in ('d','e') order by 1,2`,
    extensions: `select e.extname,e.extversion,n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1`,
  };
  const manifest = {};
  for (const [key, query] of Object.entries(queries)) manifest[key] = (await pool.query(query, query.includes('$1') ? [schemas] : [])).rows;
  return manifest;
}
