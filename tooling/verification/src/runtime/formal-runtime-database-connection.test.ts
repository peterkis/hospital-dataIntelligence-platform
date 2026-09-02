import { describe, expect, it } from 'vitest';
import {
  assertFormalRuntimeDatabaseTarget,
  buildFormalRuntimeDatabaseUrl,
  describeFormalRuntimeDatabaseTarget,
  FORMAL_RUNTIME_DATABASE_NAME,
  FORMAL_RUNTIME_DATABASE_USERNAME,
} from './formal-runtime-database-connection.js';
import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.js';

const authority = loadPodmanRuntimeAuthority().authority;

describe('formal runtime database connection boundary', () => {
  it('builds the fixed Phase 01 target from the frozen runtime authority', () => {
    const url = buildFormalRuntimeDatabaseUrl(authority, 'ordinary-password');
    expect(url).toBe(
      'postgresql://hdi_phase01:ordinary-password@127.0.0.1:55432/hdi_phase01',
    );
    expect(describeFormalRuntimeDatabaseTarget(url)).toEqual({
      protocol: 'postgresql:',
      username: FORMAL_RUNTIME_DATABASE_USERNAME,
      host: authority.network.bindAddress,
      port: authority.network.ports.postgresRuntime,
      database: FORMAL_RUNTIME_DATABASE_NAME,
      passwordPresent: true,
    });
  });

  it.each([
    ['reserved characters', '@:/?#%[] +', '%40%3A%2F%3F%23%25%5B%5D%20%2B'],
    ['Unicode', '医院密码✨', '%E5%8C%BB%E9%99%A2%E5%AF%86%E7%A0%81%E2%9C%A8'],
    ['literal percent is encoded once', 'already%40encoded', 'already%2540encoded'],
  ] as const)('encodes %s exactly once', (_name, password, encoded) => {
    const url = buildFormalRuntimeDatabaseUrl(authority, password);
    expect(url).toContain(':' + encoded + '@');
    expect(decodeURIComponent(new URL(url).password)).toBe(password);
  });

  it('fails closed for an empty password', () => {
    expect(() => buildFormalRuntimeDatabaseUrl(authority, ''))
      .toThrow('FORMAL_RUNTIME_DATABASE_PASSWORD_MISSING');
  });

  it('uses runtime PostgreSQL 55432 and rejects integration PostgreSQL 55433', () => {
    const url = buildFormalRuntimeDatabaseUrl(authority, 'password');
    expect(new URL(url).port).toBe('55432');
    expect(() => assertFormalRuntimeDatabaseTarget(
      url.replace(':55432/', ':55433/'),
      authority,
    )).toThrow('FORMAL_RUNTIME_DATABASE_TARGET_INVALID');
  });

  it.each([
    'postgresql://hdi_phase01:password@external.example:55432/hdi_phase01',
    'postgresql://hdi_phase01:password@127.0.0.1:55432/hdi_phase01?sslmode=require',
    'postgresql://hdi_phase01:password@127.0.0.1:55432/hdi_phase01#fragment',
    'postgresql://hdi_phase01@127.0.0.1:55432/hdi_phase01',
    'postgresql:///hdi_phase01?host=/var/run/postgresql',
  ])('rejects a non-canonical target without disclosing it', (subject) => {
    expect(() => assertFormalRuntimeDatabaseTarget(subject, authority))
      .toThrow('FORMAL_RUNTIME_DATABASE_TARGET_INVALID');
  });

  it('returns only safe target fields', () => {
    const password = 'not-safe-to-describe';
    const url = buildFormalRuntimeDatabaseUrl(authority, password);
    const description = describeFormalRuntimeDatabaseTarget(url);
    const serialized = JSON.stringify(description);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(encodeURIComponent(password));
    expect(serialized).not.toContain(url);
    expect(Object.keys(description)).toEqual([
      'protocol', 'username', 'host', 'port', 'database', 'passwordPresent',
    ]);
  });
});
