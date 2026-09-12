import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = requireEnvironment('DATABASE_URL');
// pg resolves URL query overrides and PGDATABASE defaults before connecting.
const effectiveDatabase = new pg.Client({ connectionString: databaseUrl }).connectionParameters.database;
if (effectiveDatabase.startsWith('hdi_mc_vnext_')) {
  throw new Error('VNEXT_LEGACY_LINEAGE_FORBIDDEN');
}

const migrationDirectory = resolve(process.argv[2] ?? 'db/migrations');
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
  .sort((left, right) => left.localeCompare(right));
if (migrationFiles.length === 0) throw new Error('NO_DATABASE_MIGRATIONS_FOUND');

const pool = new pg.Pool({
  connectionString: databaseUrl,
  application_name: 'hdi-phase01-migration-runner',
  max: 1,
});
const client = await pool.connect();
try {
  for (const migrationFile of migrationFiles) {
    const migrationId = migrationFile.replace(/\.sql$/u, '');
    const registryExists = await client.query(
      "select to_regclass('platform.schema_migration') is not null as exists",
    );
    if (registryExists.rows[0]?.exists) {
      const applied = await client.query(
        'select 1 from platform.schema_migration where migration_id = $1',
        [migrationId],
      );
      if (applied.rowCount === 1) continue;
    }
    await client.query(await readFile(resolve(migrationDirectory, migrationFile), 'utf8'));
    process.stdout.write(`Applied ${migrationId}\n`);
  }
} finally {
  client.release();
  await pool.end();
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`REQUIRED_ENVIRONMENT_MISSING:${name}`);
  return value;
}
