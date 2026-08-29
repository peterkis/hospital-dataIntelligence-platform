import { types as postgresTypes } from 'pg';
import { expect, it } from 'vitest';
import './create-database.js';

const POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;

it('decodes PostgreSQL local timestamps as canonical platform local date-time text', () => {
  const decodeTimestamp = postgresTypes.getTypeParser(
    POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID,
    'text',
  );

  expect(decodeTimestamp('2026-08-08 09:00:00')).toBe('2026-08-08T09:00:00');
  expect(decodeTimestamp('2026-08-08 09:00:00.123456')).toBe(
    '2026-08-08T09:00:00.123456',
  );
  expect(() => decodeTimestamp('2026-08-08T09:00:00')).toThrowError(
    'POSTGRES_LOCAL_DATETIME_INVALID',
  );
});
