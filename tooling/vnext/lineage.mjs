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
      !['P0-00', 'P0-01', 'P0-02', 'P0-03', 'P0-04', 'P0-05', 'P0-06', 'P0-07', 'P0-08', 'P0-09', 'P0-10', 'P0-11', 'P1-01', 'P1-02','P1-03','P1-04','P1-05','P1-06','P1-07','P2-01'].includes(receipt.taskId) || !/^[a-f0-9-]{36}$/u.test(receipt.requestId)) throw new Error('RECEIPT_INVALID');
  if (Object.keys(env).some(key => /^PG[A-Z_]*$/iu.test(key) && env[key])) throw new Error('OVERRIDE_FORBIDDEN');
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
// These are the only approved historical bytes installed in the persistent
// database before the forward P1-07 repair. Department migrations remain
// canonical and are never accepted under alternate digests.
export const historicalMigrationDigests = Object.freeze({
  '0079_campus_retirement_disposition': 'e4d7a7d333ed0830f5db6e93a242c5613adcc3768a62d91a7674ee469392b229',
  '0083_campus_retirement_history_repair': '1def3e683f80d4763f8e79622e20121932603b7464152248ddee7504ac969f97',
});
export function migrationDigestMatches(file, digest) {
  return file.sha256 === digest || historicalMigrationDigests[file.id] === digest;
}
export function checkPrefix(files, ledger) {
  files.forEach((file, i) => { if (!new RegExp(`^${String(i + 1).padStart(4, '0')}_[a-z0-9_]+$`).test(file.id)) throw new Error('MIGRATION_ORDER'); });
  if (ledger.length > files.length || ledger.some((entry, i) => entry.id !== files[i]?.id || !migrationDigestMatches(files[i], entry.sha256))) throw new Error('LINEAGE_MISMATCH');
  return ledger.length;
}
export function peer(name, sql, {sensitive=false}={}) {
  if (!/^(?:postgres|hdi_mc_vnext_[a-f0-9]{16})$/u.test(name)) throw new Error('PEER_TARGET_INVALID');
  const cleanPgEnvironment=['PGHOST','PGHOSTADDR','PGPORT','PGDATABASE','PGUSER','PGSERVICE','PGSERVICEFILE','PGOPTIONS','PGPASSFILE'].flatMap(key=>['-u',key]);
  if(sensitive)sql="SET log_statement='none'; SET log_min_error_statement='panic'; SET log_min_duration_statement=-1; SET log_duration=off; SET log_min_duration_sample=-1; SET log_transaction_sample_rate=0; "+sql;
  const result = spawnSync('wsl.exe', ['-d', 'Anolis-8.9-HDI-POC', '-u', 'postgres', '--', 'env', ...cleanPgEnvironment, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-p', '55434', '-d', name, '-At'], { input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    // Local synthetic DDL diagnostics only; never contains a connection string.
    writeFileSync(resolve(root, '.runtime/vnext/last-admin-error.log'), sensitive ? 'SENSITIVE_ADMIN_COMMAND_FAILED' : result.stderr ?? 'NO_STDERR');
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
    if (namespaces.some(name => !['vnext_control', 'governance_catalog', 'organization_master','department_master'].includes(name))) throw new Error('UNKNOWN_LINEAGE');
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
    const relations=(await pool.query("select n.nspname||'.'||c.relname as name,c.relkind from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('vnext_control','governance_catalog','organization_master','department_master') and c.relkind in ('r','p','v','m','f','S') order by 1")).rows;
    const allowed=new Set(ledger.length===0?[]:[...(ledger.length>=84?["department_master.access","department_master.input","department_master.verification","department_master.department","department_master.version","vnext_control.department_write_authority"]:[]),...(ledger.length>=71?['organization_master.workspace_draft_revision']:[]),...(ledger.length>=68?['organization_master.bundle_child']:[]),...(ledger.length>=67?['vnext_control.bundle_write_authority','organization_master.bundle_administrator','organization_master.bundle_control_event','organization_master.bundle_control_event_sequence_seq']:[]),...(ledger.length>=66?['organization_master.bundle_revision']:[]),...(ledger.length>=63?['organization_master.operating_object','organization_master.operating_version','organization_master.operating_input','organization_master.operating_access','vnext_control.operating_write_authority']:[]),...(ledger.length>=60?['vnext_control.campus_write_authority']:[]),...(ledger.length>=57?['organization_master.campus','organization_master.campus_event','organization_master.campus_version','organization_master.campus_code','organization_master.campus_plan','organization_master.campus_operation']:[]),...(ledger.length>=55?['vnext_control.organization_key_binding']:[]),...(ledger.length>=54?['organization_master.subject','organization_master.access','organization_master.input','organization_master.input_request','organization_master.withdrawal','organization_master.version','organization_master.identifier','organization_master.license','organization_master.license_version','organization_master.verification']:[]),...(ledger.length>=49?['governance_catalog.apply_candidate','governance_catalog.apply_approval','governance_catalog.apply_commit']:[]),...(ledger.length>=38?['governance_catalog.quality_issue','governance_catalog.issue_disposition']:[]),...(ledger.length>=33?['governance_catalog.validation_run']:[]),...(ledger.length>=31?['governance_catalog.parse_provenance']:[]),...(ledger.length>=23?['governance_catalog.protected_artifact','governance_catalog.protected_payload','vnext_control.protected_grant']:[]),...(ledger.length>=21?['governance_catalog.import_job','governance_catalog.import_input_revision']:[]),...(ledger.length>=14?['governance_catalog.parameter','governance_catalog.parameter_version','governance_catalog.parameter_approval','governance_catalog.parameter_grant']:[]),...(ledger.length>=13?['governance_catalog.contract_impact_event']:[]),...(ledger.length>=12?['governance_catalog.import_contract','governance_catalog.import_contract_version','governance_catalog.import_contract_event','governance_catalog.import_contract_event_head_seq']:[]),...(ledger.length>=10?['governance_catalog.source_assessment']:[]),'vnext_control.migration','vnext_control.actor','vnext_control.actor_grant','vnext_control.outcome','vnext_control.audit',...(ledger.length>=3?['vnext_control.request_identity']:[]),...(ledger.length>=4?['vnext_control.audit_chain']:[]),...(ledger.length>=6?['governance_catalog.impact_event']:[]),...(ledger.length>=7?['vnext_control.object_grant','vnext_control.creation_policy','vnext_control.audit_stream_grant']:[]),...(ledger.length>=2?['governance_catalog.source_snapshot','governance_catalog.object','governance_catalog.version','governance_catalog.event','governance_catalog.event_head_seq']:[])]);
    if(relations.length!==allowed.size||relations.some(row=>!allowed.has(row.name)))throw new Error('UNKNOWN_SCHEMA_OBJECT');
    const routines=(await pool.query("select n.nspname||'.'||p.proname as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('vnext_control','governance_catalog','organization_master','department_master') order by 1")).rows;
    const allowedRoutines=new Set(ledger.length===0?[]:[...(ledger.length>=84?["department_master.authorize","department_master.input_read","department_master.snapshot","department_master.list","department_master.code_conflict","department_master.mutate","department_master.evidence","department_master.job_read","department_master.audit_access"]:[]),...(ledger.length>=87?['governance_catalog.import_job_context','department_master.committed_row']:[]),...(ledger.length>=79?['organization_master.campus_impact','organization_master.campus_admission']:[]),...(ledger.length>=71?['organization_master.workspace_authorize','organization_master.workspace_save','organization_master.workspace_read','organization_master.workspace_list','organization_master.workspace_capabilities','organization_master.workspace_application_access','organization_master.workspace_applications','organization_master.workspace_object_context','organization_master.workspace_version_source','organization_master.workspace_transport_authorize','organization_master.workspace_bundles','organization_master.workspace_preview_access']:[]),...(ledger.length>=68?['organization_master.bundle_authorize','organization_master.bundle_require_stage','organization_master.bundle_plan_request','organization_master.bundle_context','organization_master.bundle_bind_child','organization_master.bundle_require_command','organization_master.bundle_materialize_pair','organization_master.bundle_committed_facts']:[]),...(ledger.length>=67?['organization_master.bundle_admin_audit','organization_master.bundle_control_state','organization_master.bundle_control']:[]),...(ledger.length>=66?['organization_master.bundle_artifact','organization_master.bundle_dimension_access','organization_master.bundle_register','organization_master.bundle_read','organization_master.require_bundle_revision']:[]),...(ledger.length>=63?['organization_master.operating_authorize','organization_master.operating_stage','organization_master.operating_input_read','organization_master.operating_plan','organization_master.operating_withdraw','organization_master.operating_snapshot','organization_master.operating_pair','organization_master.operating_primary_conflict','organization_master.operating_write']:[]),...(ledger.length>=62?['governance_catalog.operating_catalog']:[]),...(ledger.length>=60?['organization_master.campus_write_approved']:[]),...(ledger.length>=59?['organization_master.plan_input_for','organization_master.withdraw_for']:[]),...(ledger.length>=57?['governance_catalog.campus_division','organization_master.input_target_guard','organization_master.campus_conflict','organization_master.campus_snapshot','organization_master.campus_write','organization_master.campus_list']:[]),...(ledger.length>=54?['organization_master.allowed','organization_master.authorize','organization_master.stage','organization_master.input_read','organization_master.evidence','organization_master.snapshot','organization_master.conflict','organization_master.write','organization_master.read','organization_master.withdraw','organization_master.qualification_snapshot','organization_master.audit_access','organization_master.plan_input','governance_catalog.registration_evidence']:[]),...(ledger.length>=53?['governance_catalog.import_workbench_file_access']:[]),...(ledger.length>=52?['governance_catalog.import_workbench_summary']:[]),...(ledger.length>=49?['governance_catalog.apply_record']:[]),...(ledger.length>=42?['governance_catalog.quality_resolution_prior']:[]),...(ledger.length>=41?['governance_catalog.quality_issue_open_prior']:[]),...(ledger.length>=38?['governance_catalog.quality_issue_ingest','governance_catalog.quality_issue_read','governance_catalog.quality_issue_detail','governance_catalog.quality_issue_assign','governance_catalog.quality_correction_prior','governance_catalog.quality_issue_record_correction','governance_catalog.quality_issue_resolve','governance_catalog.import_job_reject','governance_catalog.quality_batch_reject','governance_catalog.quality_eligibility','governance_catalog.quality_candidate_frame','governance_catalog.quality_candidate_digest','governance_catalog.quality_eligibility_digest']:[]),...(ledger.length>=33?['governance_catalog.accept_validation','governance_catalog.validation_prior','governance_catalog.read_validation']:[]),...(ledger.length>=32?['governance_catalog.validation_rules_valid']:[]),...(ledger.length>=31?['governance_catalog.register_parse','governance_catalog.read_parse']:[]),...(ledger.length>=28?['governance_catalog.require_file_original']:[]),...(ledger.length>=27?['governance_catalog.guard_file_original','governance_catalog.file_receive_denial']:[]),...(ledger.length>=26?['governance_catalog.protected_digest_denial']:[]),...(ledger.length>=25?['governance_catalog.guard_protected_revision_digest']:[]),...(ledger.length>=23?['governance_catalog.protected_command','vnext_control.audit_protected_grant']:[]),...(ledger.length>=21?['governance_catalog.import_job_command','governance_catalog.import_job_read']:[]),...(ledger.length>=20?['governance_catalog.contract_enum_types_valid']:[]),...(ledger.length>=19?['governance_catalog.allocate_contract_sequence']:[]),...(ledger.length>=14?['governance_catalog.audit_parameter_grant','governance_catalog.parameter_require_access','governance_catalog.parameter_require_reference','governance_catalog.parameter_command','governance_catalog.parameter_read']:[]),...(ledger.length>=13?['governance_catalog.contract_source_versions','governance_catalog.contract_depends_on','governance_catalog.contract_supported_spans','governance_catalog.source_proposed_impact_sources','vnext_control.require_assessment_access_sources','governance_catalog.contract_impact_context','governance_catalog.contract_change_impact','governance_catalog.record_contract_source_impact','governance_catalog.record_contract_impact_closure','governance_catalog.contract_impact_cases','governance_catalog.impact_cases_sources']:[]),...(ledger.length>=12?['governance_catalog.contract_definition','governance_catalog.contract_command','governance_catalog.contract_read','governance_catalog.contract_time','governance_catalog.contract_schemas','governance_catalog.contract_require_access']:[]),...(ledger.length>=11?['governance_catalog.impact_obligation']:[]),...(ledger.length>=10?['governance_catalog.source_projected_span','governance_catalog.source_projected_valid_spans','governance_catalog.source_proposed_impact','vnext_control.require_assessment_access']:[]),...(ledger.length>=9?['vnext_control.require_source_reference','governance_catalog.source_valid_spans','governance_catalog.source_covering_version','governance_catalog.assert_source_period_chain']:[]),...(ledger.length>=8?['vnext_control.definition_allowed']:[]),'vnext_control.immutable','vnext_control.authorize',...(ledger.length>=7?['vnext_control.lock_authorization_change','vnext_control.audit_object_grant','vnext_control.object_dimensions','vnext_control.object_allowed','vnext_control.require_object','vnext_control.bootstrap_catalog_grants','vnext_control.grant_created_object','vnext_control.require_source_access','vnext_control.require_impact_access','governance_catalog.definition_spans','governance_catalog.command_raw','governance_catalog.read_catalog_raw','governance_catalog.history_raw','governance_catalog.resolve_source_raw','governance_catalog.change_impact_raw','governance_catalog.impact_cases_raw','governance_catalog.filter_catalog']:[]),...(ledger.length>=6?['governance_catalog.source_impact','governance_catalog.change_impact','governance_catalog.record_source_impact','governance_catalog.impact_cases']:[]),...(ledger.length>=5?['governance_catalog.read_effective']:[]),...(ledger.length>=4?['vnext_control.audit_hash','vnext_control.append_audit_chain','vnext_control.verify_audit','governance_catalog.assert_source_chain']:[]),...(ledger.length>=2?['governance_catalog.local_time','governance_catalog.read_catalog','governance_catalog.history','governance_catalog.command','governance_catalog.resolve_source']:[])]);
    if(routines.length!==allowedRoutines.size||routines.some(row=>!allowedRoutines.has(row.name)))throw new Error('UNKNOWN_SCHEMA_OBJECT');
    const extraTypes=(await pool.query("select count(*) as count from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('vnext_control','governance_catalog','organization_master','department_master') and t.typrelid=0 and t.typelem=0")).rows[0].count;
    if(Number(extraTypes))throw new Error('UNKNOWN_SCHEMA_OBJECT');
    const structure=(await pool.query("select n.nspname,c.relname,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) as type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) as default_expression from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where n.nspname in ('vnext_control','governance_catalog','organization_master','department_master') and c.relkind='r' and a.attnum>0 and not a.attisdropped order by n.nspname,c.relname,a.attnum")).rows;
    const schemaFingerprint=createHash('sha256').update(JSON.stringify(structure)).digest('hex');
    return { identity: actual, ledger, namespaces, schemaFingerprint,
      tables: relations.filter(row => row.relkind === 'r').map(row => row.name) };
  } finally { await pool.end(); }
}
export async function migrate(receipt, files = migrationFiles()) {
  const before = await inspect(receipt);
  checkPrefix(files, before.ledger);
  // One peer session holds the session lock; each file and receipt commits atomically.
  let sql = `SELECT pg_advisory_lock(901001);\n${identitySQL(receipt)}\n`;
  sql += `CREATE TEMP TABLE expected_migration(id text primary key,sha256 text);\n`;
  for (const file of files) sql += `INSERT INTO expected_migration VALUES (${quote(file.id)},${quote(file.sha256)});\n`;
  const historicalSql=Object.entries(historicalMigrationDigests).map(([id,digest])=>`(m.id=${quote(id)} AND m.sha256=${quote(digest)})`).join(' OR ');
  sql += `DO $prefix$ BEGIN IF to_regclass('vnext_control.migration') IS NOT NULL THEN IF EXISTS (SELECT 1 FROM vnext_control.migration m LEFT JOIN expected_migration e USING(id) WHERE e.id IS NULL OR (e.sha256<>m.sha256 AND NOT (${historicalSql})) OR m.lineage<>'HDIP-MC-VNEXT') THEN RAISE EXCEPTION 'LINEAGE_MISMATCH'; END IF; ELSIF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND left(nspname,3)<>'pg_') OR EXISTS(SELECT 1 FROM pg_class WHERE relnamespace='public'::regnamespace) THEN RAISE EXCEPTION 'UNKNOWN_LINEAGE'; END IF; END $prefix$;\n`;
  for (const file of files) {
    let tag='$apply$';while(file.sql.includes(tag))tag=tag.slice(0,-1)+'x$';
    sql += `BEGIN;\nDO ${tag} BEGIN IF to_regclass('vnext_control.migration') IS NULL THEN EXECUTE ${quote(file.sql)}; INSERT INTO vnext_control.migration(lineage,id,sha256,runner_version) VALUES ('HDIP-MC-VNEXT',${quote(file.id)},${quote(file.sha256)},'P0-01'); ELSIF NOT EXISTS(SELECT 1 FROM vnext_control.migration WHERE id=${quote(file.id)}) THEN EXECUTE ${quote(file.sql)}; INSERT INTO vnext_control.migration(lineage,id,sha256,runner_version) VALUES ('HDIP-MC-VNEXT',${quote(file.id)},${quote(file.sha256)},'P0-01'); END IF; END ${tag};\nCOMMIT;\n`;
  }
  peer(receipt.name, sql);
  const after = await inspect(receipt);
  checkPrefix(files, after.ledger);
  return after;
}
