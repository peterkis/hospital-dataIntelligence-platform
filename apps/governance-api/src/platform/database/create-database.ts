import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types as postgresTypes, type PoolConfig } from 'pg';
import type { DB } from './database-types.generated.js';

const POSTGRES_INT8_OID = 20;
const POSTGRES_NUMERIC_OID = 1700;
const POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;

postgresTypes.setTypeParser(POSTGRES_INT8_OID, (value) => value);
postgresTypes.setTypeParser(POSTGRES_NUMERIC_OID, (value) => value);
postgresTypes.setTypeParser(POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID, (value) => value);

export interface DatabaseHandle {
  readonly database: Kysely<DB>;
  close(): Promise<void>;
}

export function createDatabase(config: PoolConfig): DatabaseHandle {
  const pool = new Pool({
    ...config,
    application_name: config.application_name ?? 'hdi-governance-api',
    max: config.max ?? 10,
  });
  const database = new Kysely<DB>({
    dialect: new PostgresDialect({ pool }),
  });

  return {
    database,
    async close() {
      await database.destroy();
    },
  };
}
