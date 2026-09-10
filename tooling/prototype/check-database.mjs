import pg from 'pg';
import { readFile } from 'node:fs/promises';

const ownership = JSON.parse(await readFile(
  new URL('../../db/table-ownership.json', import.meta.url),
  'utf8',
));

const pool = new pg.Pool({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-prototype-database-check',
  max: 1,
});

let observation;
let forbiddenDatabaseTypes = [];
let failure;
try {
  const connection = await pool.query(`
    select
      version() as version,
      current_schema() as schema,
      to_regclass('platform.schema_migration') is not null as "migrationTableExists"
  `);
  observation = connection.rows[0];
  const majorVersion = /^PostgreSQL\s+(\d+)/u.exec(observation?.version ?? '')?.[1];
  if (!observation || !majorVersion) throw new Error('POSTGRESQL_VERSION_UNRECOGNIZED');
  forbiddenDatabaseTypes = await findForbiddenDatabaseTypes(
    pool,
    Object.keys(ownership.schemas),
  );
  if (forbiddenDatabaseTypes.length !== 0) {
    throw new Error('PROTOTYPE_DATABASE_FORBIDDEN_TYPES');
  }
  observation.postgresqlMajorVersion = Number(majorVersion);
} catch (error) {
  failure = error;
}

try {
  await pool.end();
} catch (error) {
  failure ??= error;
}

if (!failure) {
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    databaseConnected: true,
    postgresqlMajorVersion: observation.postgresqlMajorVersion,
    schema: observation.schema,
    migrationTableExists: observation.migrationTableExists,
    forbiddenDatabaseTypeCount: forbiddenDatabaseTypes.length,
    forbiddenDatabaseTypes,
  })}\n`);
} else {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    databaseConnected: observation !== undefined,
    errorCode: safeErrorCode(failure, 'PROTOTYPE_DATABASE_CHECK_FAILED'),
    forbiddenDatabaseTypes,
  })}\n`);
  process.exitCode = 1;
}

async function findForbiddenDatabaseTypes(database, schemaNames) {
  const result = await database.query(`
    select
      namespace.nspname as "schemaName",
      relation.relname as "tableName",
      attribute.attname as "columnName",
      pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) as "dataType"
    from pg_catalog.pg_attribute as attribute
    inner join pg_catalog.pg_class as relation
      on relation.oid = attribute.attrelid
    inner join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    inner join pg_catalog.pg_type as data_type
      on data_type.oid = attribute.atttypid
    where namespace.nspname::text = any($1::text[])
      and relation.relkind in ('r', 'p', 'v', 'm', 'f')
      and attribute.attnum > 0
      and not attribute.attisdropped
      and data_type.typname in ('timestamptz', 'timetz', 'tstzrange', 'tstzmultirange')
    order by namespace.nspname, relation.relname, attribute.attname
  `, [schemaNames]);
  return result.rows.map((row) => ({
    schemaName: safeCatalogIdentifier(row.schemaName),
    tableName: safeCatalogIdentifier(row.tableName),
    columnName: safeCatalogIdentifier(row.columnName),
    dataType: safeCatalogType(row.dataType),
  }));
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', errorCode: `REQUIRED_ENVIRONMENT_MISSING:${name}` })}\n`);
    process.exit(1);
  }
  return value;
}

function safeErrorCode(error, fallback) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (/^[A-Z0-9_]+$/u.test(code)) return code;
  }
  if (error instanceof Error && /^[A-Z0-9_:.-]+$/u.test(error.message)) return error.message;
  return fallback;
}

function safeCatalogIdentifier(value) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/u.test(value)) {
    throw new Error('DATABASE_CATALOG_IDENTIFIER_INVALID');
  }
  return value;
}

function safeCatalogType(value) {
  if (
    typeof value !== 'string' ||
    !/^(?:timestamp|time)(?:\(\d+\))? with time zone$|^(?:timestamptz|timetz|tstzrange|tstzmultirange)$/u.test(value)
  ) {
    throw new Error('DATABASE_CATALOG_TYPE_INVALID');
  }
  return value;
}
