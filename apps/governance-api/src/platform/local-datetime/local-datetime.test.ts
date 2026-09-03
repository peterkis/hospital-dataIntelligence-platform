import { describe, expect, it } from 'vitest';
import { parseLocalDateTime } from './local-datetime.js';

describe('platform LocalDateTime', () => {
  it.each([
    '2024-02-29T00:00:00',
    '2026-12-31T23:59:59',
    '2026-12-31T23:59:59.1',
    '2026-12-31T23:59:59.123456',
  ])('accepts a real Asia/Shanghai local calendar value: %s', (value) => {
    const parsed = parseLocalDateTime(value);

    expect(parsed).toBe(value);
    expect(typeof parsed).toBe('string');
    expect(parsed).not.toBeInstanceOf(Date);
  });

  it.each([
    '2026-02-29T00:00:00',
    '2026-02-31T00:00:00',
    '2026-04-31T00:00:00',
    '1900-02-29T00:00:00',
    '2026-12-31T23:59:59.1234567',
    '2026-12-31T23:59:59Z',
    '2026-12-31T23:59:59+08:00',
    '2026-12-31T23:59:59-05:00',
  ])('rejects an invalid or offset-bearing value: %s', (value) => {
    expect(() => parseLocalDateTime(value)).toThrowError('LOCAL_DATETIME_INVALID');
  });
});
