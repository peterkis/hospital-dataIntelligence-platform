// Local P0-00 administration only. Never runs migrations or disposal SQL.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { saveExclusiveReceipt as save } from './receipt.mjs';
import { localDatabaseUrl } from './connection.mjs';

const receiptPath = resolve('.runtime/vnext/creation.json');
const intentPath = resolve('.runtime/vnext/creation-intent.json');
const distro = 'Anolis-8.9-HDI-POC';
const owner = 'hdi_prototype';
const lineage = 'HDIP-MC-VNEXT';
function peer(database, sql) {
  const result = spawnSync('wsl.exe', ['-d', distro, '-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-p', '55434', '-d', database, '-At'], {
    input: sql, encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error('LOCAL_PEER_COMMAND_FAILED');
  return result.stdout.trim();
}
function catalog(name) {
  return JSON.parse(peer('postgres', `select coalesce(json_agg(x),'[]'::json) from (select d.oid::text as oid, datname as name, pg_get_userbyid(datdba) as owner from pg_database d where datname='${name}') x;`));
}
function empty(name) {
  return Number(peer(name, "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%';")) === 0;
}

try {
  const [command, ...extra] = process.argv.slice(2);
  if (!['inspect', 'create', 'verify'].includes(command) || extra.length) throw new Error('CLOSED_DATABASE_COMMAND_REQUIRED');
  const url = localDatabaseUrl(process.env.DATABASE_URL);
  const pool = new pg.Pool({ connectionString: url.href, max: 1, application_name: 'hdi-p000-read-only', options: '-c default_transaction_read_only=on' });
  let observation;
  try {
    const identity = (await pool.query('select current_database() as name, (select oid::text from pg_database where datname=current_database()) as oid, current_user as role')).rows[0];
    const migrations = (await pool.query('select migration_id from platform.schema_migration order by migration_id')).rows.map(row => row.migration_id);
    const files = readdirSync('db/migrations').filter(file => /^\d{4}_.+\.sql$/u.test(file)).sort();
    if (JSON.stringify(migrations) !== JSON.stringify(files.map(file => file.slice(0, -4)))) throw new Error('OLD_LINEAGE_MISMATCH');
    observation = { identity, migrations, migrationChecksumsStoredInDatabase: false,
      sourceManifest: files.map(file => ({ file, sha256: createHash('sha256').update(readFileSync(`db/migrations/${file}`)).digest('hex') })),
      readOnly: true };
  } finally { await pool.end(); }
  if (command === 'inspect') {
    console.log(JSON.stringify({ status: 'PASS', observation }));
  } else if (command === 'create') {
    if (existsSync(receiptPath) || existsSync(intentPath)) throw new Error('CREATION_RECORD_EXISTS');
    const roles = JSON.parse(peer('postgres', "select json_agg(x) from (select rolname, rolcreatedb, rolsuper, rolcanlogin from pg_roles where rolname in ('postgres','hdi_prototype') order by rolname) x;"));
    if (!roles.some(role => role.rolname === owner && role.rolcanlogin && !role.rolsuper && !role.rolcreatedb)) throw new Error('APPLICATION_ROLE_DRIFT');
    const name = `hdi_mc_vnext_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    if (catalog(name).length !== 0) throw new Error('DATABASE_ALREADY_EXISTS');
    const intent = { taskId: 'P0-00', lineage, name, owner, distro, port: 55434, requestId: randomUUID(), recordedAt: new Date().toISOString(), roles, oldDatabase: observation };
    save(intentPath, intent);
    peer('postgres', `CREATE DATABASE ${name} OWNER ${owner} TEMPLATE template0;`);
    const actual = catalog(name)[0];
    if (!actual || actual.owner !== owner || !empty(name)) throw new Error('CREATION_VERIFICATION_FAILED');
    save(receiptPath, { ...intent, oid: actual.oid, status: 'CREATED_EMPTY', disposalAuthorized: false });
    console.log(JSON.stringify({ status: 'PASS', name, oid: actual.oid, owner, lineage, empty: true, receiptPath }));
  } else {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (!/^hdi_mc_vnext_[a-f0-9]{16}$/u.test(receipt.name) || receipt.lineage !== lineage || receipt.owner !== owner || receipt.distro !== distro || receipt.port !== 55434) throw new Error('OWNERSHIP_RECEIPT_INVALID');
    const actual = catalog(receipt.name)[0];
    if (!actual || actual.oid !== receipt.oid || actual.owner !== receipt.owner || !empty(receipt.name)) throw new Error('DATABASE_IDENTITY_OR_EMPTY_CHECK_FAILED');
    if (JSON.stringify(receipt.oldDatabase) !== JSON.stringify(observation)) throw new Error('OLD_BASELINE_CHANGED');
    console.log(JSON.stringify({ status: 'PASS', name: actual.name, oid: actual.oid, empty: true, oldLineageUnchanged: true }));
  }
} catch (error) {
  const code = /^[A-Z][A-Z0-9_]+$/u.test(error.message) ? error.message : 'DATABASE_BASELINE_FAILED';
  console.log(JSON.stringify({ status: 'BLOCKED', code }));
  process.exitCode = 1;
}
