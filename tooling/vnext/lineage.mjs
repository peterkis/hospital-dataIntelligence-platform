import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { localDatabaseUrl } from './connection.mjs';

export const root = resolve(import.meta.dirname, '../..');
export const migrationsPath = resolve(root, 'db/vnext/migrations');
export const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
export function resolveTarget(receipt, env = process.env) {
  if (!receipt) throw new Error('RECEIPT_REQUIRED');
  if (!/^hdi_mc_vnext_[a-f0-9]{16}$/u.test(receipt.name) || !/^\d+$/u.test(receipt.oid) ||
      receipt.owner !== 'hdi_prototype' || receipt.lineage !== 'HDIP-MC-VNEXT' ||
      receipt.distro !== 'Anolis-8.9-HDI-POC' || receipt.port !== 55434 ||
      !['P0-00', 'P0-01'].includes(receipt.taskId) || !/^[a-f0-9-]{36}$/u.test(receipt.requestId)) throw new Error('RECEIPT_INVALID');
  if (Object.keys(env).some(key => /^PG(?:DATABASE|SERVICE|SERVICEFILE|HOST|HOSTADDR|PORT|USER|OPTIONS)$/u.test(key) && env[key])) throw new Error('OVERRIDE_FORBIDDEN');
  let url;
  try { url = localDatabaseUrl(env.DATABASE_URL); } catch { throw new Error('OVERRIDE_FORBIDDEN'); }
  if (decodeURIComponent(url.username) !== receipt.owner) throw new Error('ROLE_MISMATCH');
  url.pathname = '/' + receipt.name;
  return url.href;
}
export function readReceipt(path = resolve(root, '.runtime/vnext/creation.json')) {
  const absolute = resolve(path);
  if (!absolute.startsWith(resolve(root, '.runtime/vnext') + '/') && !absolute.startsWith(resolve(root, '.runtime/vnext') + '\\')) throw new Error('RECEIPT_PATH_INVALID');
  if (lstatSync(absolute).isSymbolicLink()) throw new Error('RECEIPT_PATH_INVALID');
  return JSON.parse(readFileSync(absolute, 'utf8'));
}
export function migrationFiles(directory = migrationsPath) {
  return readdirSync(directory).sort().map(name => {
    if (!/^\d{4}_[a-z0-9_]+\.sql$/u.test(name) || lstatSync(resolve(directory, name)).isSymbolicLink()) throw new Error('MIGRATION_PATH_INVALID');
    const bytes = readFileSync(resolve(directory, name));
    return { id: name.slice(0, -4), sha256: createHash('sha256').update(bytes).digest('hex'), sql: bytes.toString('utf8') };
  });
}
export function checkPrefix(files, ledger) {
  files.forEach((file, i) => { if (!new RegExp(`^${String(i + 1).padStart(4, '0')}_[a-z0-9_]+$`).test(file.id)) throw new Error('MIGRATION_ORDER'); });
  if (ledger.length > files.length || ledger.some((entry, i) => entry.id !== files[i]?.id || entry.sha256 !== files[i]?.sha256)) throw new Error('LINEAGE_MISMATCH');
  return ledger.length;
}
export function peer(name, sql) {
  if (!/^(?:postgres|hdi_mc_vnext_[a-f0-9]{16})$/u.test(name)) throw new Error('PEER_TARGET_INVALID');
  const cleanPgEnvironment=['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSFILE'].flatMap(key=>['-u',key]);
  const result = spawnSync('wsl.exe', ['-d', 'Anolis-8.9-HDI-POC', '-u', 'postgres', '--', 'env', ...cleanPgEnvironment, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-p', '55434', '-d', name, '-At'], { input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    // Local synthetic DDL diagnostics only; never contains a connection string.
    writeFileSync(resolve(root, '.runtime/vnext/last-admin-error.log'), result.stderr ?? 'NO_STDERR');
    const code = /(?:ERROR:\s+)([A-Z][A-Z0-9_]+)(?:\r?\n|$)/u.exec(result.stderr ?? '')?.[1];
    throw new Error(code ?? 'VNEXT_ADMIN_COMMAND_FAILED');
  }
  return result.stdout.trim();
}
export function identitySQL(receipt) {
  return `DO $identity$ BEGIN IF current_database()<>${quote(receipt.name)} OR NOT EXISTS (SELECT 1 FROM pg_database WHERE datname=current_database() AND oid::text=${quote(receipt.oid)} AND pg_get_userbyid(datdba)=${quote(receipt.owner)}) THEN RAISE EXCEPTION 'RECEIPT_IDENTITY_MISMATCH'; END IF; END $identity$;`;
}
export async function inspect(receipt, env = process.env) {
  const pool = new pg.Pool({ connectionString: resolveTarget(receipt, env), options: '-c default_transaction_read_only=on', max: 1 });
  try {
    const actual = (await pool.query("select current_database() as name, d.oid::text as oid, pg_get_userbyid(d.datdba) as owner, inet_server_port() as port, pg_postmaster_start_time()::text as postmaster from pg_database d where datname=current_database()" )).rows[0];
    for (const key of ['name', 'oid', 'owner', 'port']) if (actual[key] !== receipt[key]) throw new Error('RECEIPT_IDENTITY_MISMATCH');
    const namespaces = (await pool.query("select nspname from pg_namespace where nspname not in ('public','information_schema') and left(nspname,3)<>'pg_' order by nspname")).rows.map(row => row.nspname);
    if (namespaces.some(name => !['vnext_control', 'governance_catalog'].includes(name))) throw new Error('UNKNOWN_LINEAGE');
    const publicObjects = (await pool.query("select count(*)::int as count from pg_class where relnamespace='public'::regnamespace")).rows[0].count;
    const publicOther=(await pool.query("select (select count(*) from pg_proc where pronamespace='public'::regnamespace)+(select count(*) from pg_type where typnamespace='public'::regnamespace) as count")).rows[0].count;
    if (publicObjects || Number(publicOther)) throw new Error('UNKNOWN_OBJECTS');
    let ledger = [];
    if (namespaces.length) {
      const table = (await pool.query("select to_regclass('vnext_control.migration')::text as value")).rows[0].value;
      if (!table) throw new Error('UNKNOWN_LINEAGE');
      const rows = (await pool.query('select lineage,id,sha256 from vnext_control.migration order by id')).rows;
      if (!rows.length || rows.some(row => row.lineage !== 'HDIP-MC-VNEXT')) throw new Error('UNKNOWN_LINEAGE');
      ledger = rows.map(({id,sha256}) => ({id,sha256}));
    }
    const relations=(await pool.query("select n.nspname||'.'||c.relname as name,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('vnext_control','governance_catalog') and c.relkind in ('r','p','v','m','f','S') order by 1")).rows;
    const allowed=new Set(ledger.length===0?[]:['vnext_control.migration','vnext_control.actor','vnext_control.actor_grant','vnext_control.outcome','vnext_control.audit',...(ledger.length>=3?['vnext_control.request_identity']:[]),...(ledger.length>=2?['governance_catalog.source_snapshot','governance_catalog.object','governance_catalog.version','governance_catalog.event','governance_catalog.event_head_seq']:[])]);
    if(relations.length!==allowed.size||relations.some(row=>!allowed.has(row.name)))throw new Error('UNKNOWN_SCHEMA_OBJECT');
    const routines=(await pool.query("select n.nspname||'.'||p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('vnext_control','governance_catalog') order by 1")).rows;
    const allowedRoutines=new Set(ledger.length===0?[]:['vnext_control.immutable','vnext_control.authorize',...(ledger.length>=2?['governance_catalog.local_time','governance_catalog.read_catalog','governance_catalog.history','governance_catalog.command','governance_catalog.resolve_source']:[])]);
    if(routines.length!==allowedRoutines.size||routines.some(row=>!allowedRoutines.has(row.name)))throw new Error('UNKNOWN_SCHEMA_OBJECT');
    const extraTypes=(await pool.query("select count(*) as count from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('vnext_control','governance_catalog') and t.typrelid=0 and t.typelem=0")).rows[0].count;
    if(Number(extraTypes))throw new Error('UNKNOWN_SCHEMA_OBJECT');
    const structure=(await pool.query("select n.nspname,c.relname,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) as default_expression from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ('vnext_control','governance_catalog') and c.relkind='r' and a.attnum>0 and not a.attisdropped order by n.nspname,c.relname,a.attnum")).rows;
    const schemaFingerprint=createHash('sha256').update(JSON.stringify(structure)).digest('hex');
    return { identity: actual, ledger, namespaces, schemaFingerprint };
  } finally { await pool.end(); }
}
export async function migrate(receipt, files = migrationFiles()) {
  const before = await inspect(receipt);
  checkPrefix(files, before.ledger);
  // One peer session holds the session lock; each file and receipt commits atomically.
  let sql = `SELECT pg_advisory_lock(901001);\n${identitySQL(receipt)}\n`;
  sql += `CREATE TEMP TABLE expected_migration(id text primary key,sha256 text);\n`;
  for (const file of files) sql += `INSERT INTO expected_migration VALUES (${quote(file.id)},${quote(file.sha256)});\n`;
  sql += `DO $prefix$ BEGIN IF to_regclass('vnext_control.migration') IS NOT NULL THEN IF EXISTS (SELECT 1 FROM vnext_control.migration m LEFT JOIN expected_migration e USING(id) WHERE e.id IS NULL OR e.sha256<>m.sha256 OR m.lineage<>'HDIP-MC-VNEXT') THEN RAISE EXCEPTION 'LINEAGE_MISMATCH'; END IF; ELSIF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3)<>'pg_') OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace) THEN RAISE EXCEPTION 'UNKNOWN_LINEAGE'; END IF; END $prefix$;\n`;
  for (const file of files) {
    let tag='$apply$';while(file.sql.includes(tag))tag=tag.slice(0,-1)+'x$';
    sql += `BEGIN;\nDO ${tag} BEGIN IF to_regclass('vnext_control.migration') IS NULL THEN EXECUTE ${quote(file.sql)}; INSERT INTO vnext_control.migration(lineage,id,sha256,runner_version) VALUES ('HDIP-MC-VNEXT',${quote(file.id)},${quote(file.sha256)},'P0-01'); ELSIF NOT EXISTS(SELECT 1 FROM vnext_control.migration WHERE id=${quote(file.id)}) THEN EXECUTE ${quote(file.sql)}; INSERT INTO vnext_control.migration(lineage,id,sha256,runner_version) VALUES ('HDIP-MC-VNEXT',${quote(file.id)},${quote(file.sha256)},'P0-01'); END IF; END ${tag};\nCOMMIT;\n`;
  }
  peer(receipt.name, sql);
  const after = await inspect(receipt);
  checkPrefix(files, after.ledger);
  return after;
}
