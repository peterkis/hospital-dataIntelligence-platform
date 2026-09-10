import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types as postgresTypes, type PoolConfig } from 'pg';
import type { DB } from './database-types.generated.js';
import { parseLocalDateTime } from '../local-datetime/local-datetime.js';

const POSTGRES_INT8_OID = 20;
const POSTGRES_NUMERIC_OID = 1700;
const POSTGRES_DATE_OID = 1082;
const POSTGRES_TIME_WITHOUT_TIME_ZONE_OID = 1083;
const POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;

function decodePostgresLocalDateTime(value: string) {
  if (value[10] !== ' ') {
    throw new Error('POSTGRES_LOCAL_DATETIME_INVALID');
  }
  return parseLocalDateTime(`${value.slice(0, 10)}T${value.slice(11)}`);
}

postgresTypes.setTypeParser(POSTGRES_INT8_OID, (value) => value);
postgresTypes.setTypeParser(POSTGRES_NUMERIC_OID, (value) => value);
postgresTypes.setTypeParser(POSTGRES_DATE_OID, (value) => value);
postgresTypes.setTypeParser(POSTGRES_TIME_WITHOUT_TIME_ZONE_OID, (value) => value);
postgresTypes.setTypeParser(
  POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID,
  decodePostgresLocalDateTime,
);

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
