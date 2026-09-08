import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { validateTemporaryFreshAuthority } from './person-assignment-temporary-fixture-guard.ts';
import { normalizeSchemaManifest } from './person-engagement-temporal-schema.mjs';

const mode = process.argv[2];
assert.ok(process.argv.length === 3 && ['--development', '--full', '--sql-only', '--regression'].includes(mode), 'C04_FRESH_MODE_REQUIRED');
assert.ok(process.env.DATABASE_URL, 'C04_MANAGED_DATABASE_REQUIRED');
const sourceUrl = new URL(process.env.DATABASE_URL);
assert.equal(sourceUrl.hostname, '127.0.0.1'); assert.equal(sourceUrl.port, '55434');
assert.equal(sourceUrl.pathname, '/hdi_prototype'); assert.equal(decodeURIComponent(sourceUrl.username), 'hdi_prototype');
const runId = randomUUID(), databaseName = `pv006_c04_${runId.replaceAll('-', '')}`;
const directory = `.runtime/pv006-c04/${runId}`, startedAt = new Date().toISOString();
assert.equal(execFileSync('git', ['check-ignore', `${directory}/ownership.json`], { encoding: 'utf8' }).trim(), `${directory}/ownership.json`);
await mkdir(directory, { recursive: false });
const result = { task: 'PV-006-C-04', runId, mode: 'FRESH_INSTALL', executionMode: mode, startedAt,
  cwd: process.cwd(), argv: process.argv.slice(1), baselineCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  databaseName, commands: [], created: false, temporaryDatabaseRemoved: false };
const sourcePool = new pg.Pool({ connectionString: sourceUrl.toString(), max: 1, application_name: 'hdi-pv006-c04-fresh-source' });
const freshUrl = new URL(sourceUrl); freshUrl.pathname = `/${databaseName}`;
let freshPool, receipt, receiptBytes;
const endpoint = { host: '127.0.0.1', port: '55434', role: 'hdi_prototype' };
try {
  const source = (await sourcePool.query(`select current_database() as database,
    pg_postmaster_start_time()::text as started_at,(select count(*)::int from platform.schema_migration) as migrations`)).rows[0];
  const migrations = (await readdir('db/migrations')).filter(name => /^\d{4}_.+\.sql$/u.test(name)).sort();
  assert.equal(migrations.length, 39);
  assert.ok(source.migrations === 39 || (mode !== '--full' && source.migrations === 38), 'C04_RETAINED_MIGRATION_DRIFT');
  const admin = JSON.parse(peer(`select json_build_object('role',current_user,'started_at',pg_postmaster_start_time()::text,
    'can_create',rolcreatedb or rolsuper,'app_createdb',(select rolcreatedb from pg_roles where rolname='hdi_prototype'),
    'app_superuser',(select rolsuper from pg_roles where rolname='hdi_prototype')) from pg_roles where rolname=current_user;`));
  assert.equal(admin.role, 'postgres'); assert.equal(admin.can_create, true);
  assert.equal(admin.app_createdb, false); assert.equal(admin.app_superuser, false);
  assert.equal(Date.parse(admin.started_at), Date.parse(source.started_at)); result.admin = admin;
  assert.equal(peer(`select count(*) from pg_database where datname='${databaseName}';`), '0');
  peer(`create database "${databaseName}" owner hdi_prototype template template0;`); result.created = true;
  const identity = JSON.parse(peer(`select json_build_object('name',datname,'oid',oid::text,'owner',pg_get_userbyid(datdba))
    from pg_database where datname='${databaseName}';`));
  receipt = { task: 'PV-006-C-04', runId, mode: 'FRESH_INSTALL', databaseName, identity, endpoint,
    createdByPeerRole: admin.role, baselineCommit: result.baselineCommit, sourceDatabase: source.database, sourceStartedAt: source.started_at };
  validateTemporaryFreshAuthority({ database: databaseName, ...identity, role: 'hdi_prototype', createdb: false, superuser: false, endpoint }, receipt);
  receiptBytes = JSON.stringify(receipt, null, 2);
  await writeFile(`${directory}/ownership.json`, receiptBytes, { flag: 'wx' });
  freshPool = new pg.Pool({ connectionString: freshUrl.toString(), max: 1, application_name: 'hdi-pv006-c04-fresh-inspection' });
  const empty = (await freshPool.query(`select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%'`)).rows[0];
  assert.equal(empty.count, 0); result.emptyBeforeMigrations = true;
  child('migration-chain', ['tooling/runtime/apply-migrations.mjs', 'db/migrations']);
  const counts = (await freshPool.query(`select (select count(*)::int from platform.schema_migration) as migrations,
    (select count(*)::int from information_schema.tables where table_type='BASE TABLE' and table_schema=any($1::text[])) as tables`,
    [Object.keys(JSON.parse(await readFile('db/table-ownership.json', 'utf8')).schemas)])).rows[0];
  assert.deepEqual(counts, { migrations: 39, tables: 91 }); result.counts = counts;
  result.migrationHashes = await Promise.all(migrations.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(`db/migrations/${path}`)).digest('hex') })));
  const schemaBeforeProbes = await schemaManifest(freshPool);
  const generated = resolve(mode === '--development' ? 'apps/governance-api/src/platform/database/database-types.generated.ts'
    : `${directory}/database-types.generated.ts`);
  child('generated-types', ['node_modules/kysely-codegen/dist/cli/bin.js', '--config-file', 'apps/governance-api/kysely-codegen.json', '--out-file', generated]);
  if (mode === '--full') {
    assert.equal((await readFile(generated, 'utf8')).replaceAll('\r\n','\n'),
      (await readFile('apps/governance-api/src/platform/database/database-types.generated.ts','utf8')).replaceAll('\r\n','\n'));
    result.generatedTypesEquivalent = true;
    const sourceSchema = await schemaManifest(sourcePool), freshSchema = schemaBeforeProbes;
    await writeFile(`${directory}/source-schema.json`, JSON.stringify(sourceSchema,null,2), { flag:'wx' });
    await writeFile(`${directory}/fresh-schema.json`, JSON.stringify(freshSchema,null,2), { flag:'wx' });
    assert.deepEqual(normalizeSchemaManifest(freshSchema),normalizeSchemaManifest(sourceSchema)); result.schemaEquivalent = true;
  } else result.schemaEquivalence = 'NOT_CHECKED_DEVELOPMENT_BEFORE_RETAINED_UPGRADE';
  child('official-seed', ['--import', 'tsx', 'tooling/prototype/seed-prototype.ts']);
  child('department-seed', ['--import', 'tsx', 'tooling/prototype/seed-department-demo.ts']);
  child('legacy-person-seed', ['--import', 'tsx', 'tooling/prototype/person-subject-application-probe.ts']);
  // The original B02 probe owns its V1 request id (hyphenated legacy spelling).
  // Run it before shared fixture seeding so its later exact replay remains valid.
  child('legacy-engagement-policy-seed', ['--import', 'tsx', 'tooling/prototype/person-engagement-policy-application-probe.ts']);
  child('person-seed', ['--import', 'tsx', 'tooling/prototype/person-assignment-temporary-fresh-seed.ts']);
  child('missing-definition', ['--import','tsx','tooling/prototype/person-assignment-temporary-missing-definition-probe.ts']);
  child('initial-behavior', ['--import', 'tsx', '--test', 'tooling/prototype/person-assignment-temporary-initial.test.mjs']);
  if (mode === '--regression') {
    child('full-regressions', ['--import','tsx','tooling/prototype/person-assignment-temporary-regressions.mjs']);
  } else if (mode === '--sql-only') {
    child('focused-sql', ['--import','tsx','tooling/prototype/person-assignment-temporary-application-probe.ts','--sql']);
  } else if (mode === '--full') {
    child('focused-application', ['--import','tsx','tooling/prototype/person-assignment-temporary-application-probe.ts']);
    child('full-regressions', ['--import','tsx','tooling/prototype/person-assignment-temporary-regressions.mjs']);
  } else {
    child('focused-core', ['--import','tsx','tooling/prototype/person-assignment-temporary-application-probe.ts','--core']);
    child('focused-concurrency', ['--import','tsx','tooling/prototype/person-assignment-temporary-application-probe.ts','--concurrency']);
    child('focused-sql', ['--import','tsx','tooling/prototype/person-assignment-temporary-application-probe.ts','--sql']);
  }
  const schemaAfterProbes = await schemaManifest(freshPool);
  assert.deepEqual(normalizeSchemaManifest(schemaAfterProbes), normalizeSchemaManifest(schemaBeforeProbes), 'C04_PROBES_CHANGED_NATIVE_SCHEMA');
  result.nativeSchemaUnchangedByProbes = true;
  result.status = 'PASS';
} catch (error) {
  result.status = 'FAILED'; result.error = redact(error instanceof Error ? error.message : 'C04_FRESH_UNKNOWN_FAILURE');
  process.exitCode = 1;
} finally {
  if (freshPool) await freshPool.end();
  await sourcePool.end();
  if (receipt) {
    const storedBytes = await readFile(`${directory}/ownership.json`, 'utf8'); assert.equal(storedBytes, receiptBytes, 'C04_OWNERSHIP_RECEIPT_CHANGED');
    const stored = JSON.parse(storedBytes);
    const identity = JSON.parse(peer(`select json_build_object('name',datname,'oid',oid::text,'owner',pg_get_userbyid(datdba))
      from pg_database where datname='${databaseName}';`));
    const live = { database: databaseName, ...identity, role: 'hdi_prototype', createdb: false, superuser: false, endpoint };
    const negatives = [null, { ...stored, mode: 'RETAINED' }, { ...stored, databaseName: 'hdi_prototype' },
      { ...stored, identity: { ...stored.identity, oid: '0' } }, { ...stored, identity: { ...stored.identity, owner: 'postgres' } },
      { ...stored, endpoint: { ...endpoint, port: '1' } }];
    for (const wrong of negatives) assert.throws(() => validateTemporaryFreshAuthority(live, wrong));
    result.cleanupNegativeCases = negatives.length;
    validateTemporaryFreshAuthority(live, stored);
    assert.equal(peer(`select count(*) from pg_stat_activity where datname='${databaseName}';`), '0');
    peer(`drop database "${databaseName}";`);
    assert.equal(peer(`select count(*) from pg_database where datname='${databaseName}';`), '0'); result.temporaryDatabaseRemoved = true;
  }
  result.finishedAt = new Date().toISOString();
  await writeFile(`${directory}/fresh-install.json`, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ task: result.task, runId, status: result.status, error: result.error, counts: result.counts,
    commands: result.commands.length, temporaryDatabaseRemoved: result.temporaryDatabaseRemoved, directory }));
}
function peer(statement) {
  const argv = ['-d','Anolis-8.9-HDI-POC','-u','postgres','--','psql','-X','-w','-q','-A','-t','-v','ON_ERROR_STOP=1','-p','55434','-d','postgres'];
  const startedAt = new Date().toISOString();
  const execution = spawnSync('wsl.exe', argv, { input: statement, encoding: 'utf8', windowsHide: true });
  result.commands.push({ executable:'wsl.exe', argv, statement, cwd:process.cwd(), startedAt, finishedAt:new Date().toISOString(), exit:execution.status });
  if (execution.status !== 0) throw new Error('C04_PEER_ADMIN_COMMAND_FAILED'); return execution.stdout.trim();
}
function redact(value) {
  let safe = value.replaceAll(sourceUrl.toString(),'[DATABASE_URL]').replaceAll(freshUrl.toString(),'[DATABASE_URL]')
    .replaceAll(process.env.DATABASE_URL,'[DATABASE_URL]');
  for (const password of [sourceUrl.password,decodeURIComponent(sourceUrl.password)]) if (password) safe=safe.replaceAll(password,'[REDACTED]');
  return safe.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gu,'[DATABASE_URL]');
}
function child(label, argv) {
  console.log(JSON.stringify({ runId, phase:label, databaseName }));
  const startedAt = new Date().toISOString();
  const execution = spawnSync(process.execPath, argv, { cwd:process.cwd(), encoding:'utf8', maxBuffer:16*1024*1024, windowsHide:true,
    env:{ ...process.env, DATABASE_URL:freshUrl.toString(), C04_FRESH_OWNERSHIP_RECEIPT:resolve(directory,'ownership.json'),
      npm_config_offline:'true', REDOCLY_TELEMETRY:'off', NO_UPDATE_NOTIFIER:'1' } });
  const log = `${directory}/${label}.log`;
  writeFileSync(log,redact(`${execution.stdout ?? ''}\n${execution.stderr ?? ''}`),{flag:'wx'});
  result.commands.push({ executable:process.execPath, argv, cwd:process.cwd(), databaseName, startedAt, finishedAt:new Date().toISOString(), exit:execution.status, log });
  if (execution.status !== 0) throw new Error(`C04_FRESH_${label.toUpperCase().replaceAll('-','_')}_FAILED`);
}
async function schemaManifest(pool) {
  const schemas = Object.keys(JSON.parse(await readFile('db/table-ownership.json','utf8')).schemas);
  const queries = {
    migrations:'select migration_id from platform.schema_migration order by migration_id',
    columns:`select table_schema,table_name,column_name,ordinal_position,column_default,is_nullable,data_type,udt_schema,udt_name,is_generated,generation_expression
      from information_schema.columns where table_schema=any($1::text[]) order by 1,2,4`,
    constraints:`select n.nspname,c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_get_constraintdef(k.oid) as definition
      from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1::text[]) order by 1,2,3`,
    triggers:`select n.nspname,c.relname,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) as definition from pg_trigger t join pg_class c on c.oid=t.tgrelid
      join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1::text[]) and not t.tgisinternal order by 1,2,3`,
    functions:`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,pg_get_functiondef(p.oid) as definition
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1::text[]) order by 1,2,3`,
    indexes:`select schemaname,tablename,indexname,indexdef from pg_indexes where schemaname=any($1::text[]) order by 1,2,3`,
  };
  const manifest={};
  for(const [key,query] of Object.entries(queries)) manifest[key]=(await pool.query(query,query.includes('$1')?[schemas]:[])).rows;
  return manifest;
}
