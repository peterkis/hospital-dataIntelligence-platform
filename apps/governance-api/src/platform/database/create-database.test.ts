import { types as postgresTypes } from 'pg';
import { expect, it } from 'vitest';
import './create-database.js';

const POSTGRES_DATE_OID = 1082;
const POSTGRES_TIME_WITHOUT_TIME_ZONE_OID = 1083;
const POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID = 1114;

it('keeps PostgreSQL date, local time, and local timestamp values as strings', () => {
  const decodeDate = postgresTypes.getTypeParser(POSTGRES_DATE_OID, 'text');
  const decodeTime = postgresTypes.getTypeParser(
    POSTGRES_TIME_WITHOUT_TIME_ZONE_OID,
    'text',
  );
  const decodeTimestamp = postgresTypes.getTypeParser(
    POSTGRES_TIMESTAMP_WITHOUT_TIME_ZONE_OID,
    'text',
  );

  const values = [
    decodeDate('2026-08-08'),
    decodeTime('09:00:00.123456'),
    decodeTimestamp('2026-08-08 09:00:00'),
    decodeTimestamp('2026-08-08 09:00:00.123456'),
  ];
  expect(values).toEqual([
    '2026-08-08',
    '09:00:00.123456',
    '2026-08-08T09:00:00',
    '2026-08-08T09:00:00.123456',
  ]);
  for (const value of values) {
    expect(typeof value).toBe('string');
    expect(value).not.toBeInstanceOf(Date);
  }
  expect(() => decodeTimestamp('2026-08-08T09:00:00')).toThrowError(
    'POSTGRES_LOCAL_DATETIME_INVALID',
  );
});
