import pg from 'pg';

const pool = new pg.Pool({
  connectionString: requireEnvironment('DATABASE_URL'),
  application_name: 'hdi-prototype-database-check',
  max: 1,
});

try {
  const connection = await pool.query(`
    select
      version() as version,
      current_database() as database,
      current_user as "user",
      current_schema() as schema,
      to_regclass('platform.schema_migration') is not null as "migrationTableExists"
  `);
  const observation = connection.rows[0];
  const majorVersion = /^PostgreSQL\s+(\d+)/u.exec(observation?.version ?? '')?.[1];
  if (!observation || !majorVersion) throw new Error('POSTGRESQL_VERSION_UNRECOGNIZED');
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    databaseConnected: true,
    postgresqlMajorVersion: Number(majorVersion),
    database: observation.database,
    user: observation.user,
    schema: observation.schema,
    migrationTableExists: observation.migrationTableExists,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    databaseConnected: false,
    errorCode: safeErrorCode(error, 'PROTOTYPE_DATABASE_CHECK_FAILED'),
  })}\n`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
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
