import type { PodmanRuntimeAuthority } from './podman-runtime-authority-schema.js';

export const FORMAL_RUNTIME_DATABASE_USERNAME = 'hdi_phase01' as const;
export const FORMAL_RUNTIME_DATABASE_NAME = 'hdi_phase01' as const;

export interface FormalRuntimeDatabaseTargetDescription {
  readonly protocol: 'postgresql:';
  readonly username: typeof FORMAL_RUNTIME_DATABASE_USERNAME;
  readonly host: string;
  readonly port: number;
  readonly database: typeof FORMAL_RUNTIME_DATABASE_NAME;
  readonly passwordPresent: boolean;
}

export function buildFormalRuntimeDatabaseUrl(
  authority: PodmanRuntimeAuthority,
  rawPassword: string,
): string {
  if (rawPassword.length === 0) {
    throw new Error('FORMAL_RUNTIME_DATABASE_PASSWORD_MISSING');
  }
  const url = 'postgresql://' + FORMAL_RUNTIME_DATABASE_USERNAME + ':' +
    encodeURIComponent(rawPassword) + '@' + authority.network.bindAddress + ':' +
    String(authority.network.ports.postgresRuntime) + '/' + FORMAL_RUNTIME_DATABASE_NAME;
  assertFormalRuntimeDatabaseTarget(url, authority);
  return url;
}

export function describeFormalRuntimeDatabaseTarget(
  databaseUrl: string,
): FormalRuntimeDatabaseTargetDescription {
  const parsed = parseDatabaseUrl(databaseUrl);
  if (
    parsed.protocol !== 'postgresql:' ||
    parsed.username !== FORMAL_RUNTIME_DATABASE_USERNAME ||
    parsed.hostname.length === 0 ||
    !/^[1-9][0-9]*$/u.test(parsed.port) ||
    parsed.pathname !== '/' + FORMAL_RUNTIME_DATABASE_NAME ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0
  ) {
    throw new Error('FORMAL_RUNTIME_DATABASE_TARGET_INVALID');
  }
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error('FORMAL_RUNTIME_DATABASE_TARGET_INVALID');
  }
  return Object.freeze({
    protocol: 'postgresql:',
    username: FORMAL_RUNTIME_DATABASE_USERNAME,
    host: parsed.hostname,
    port,
    database: FORMAL_RUNTIME_DATABASE_NAME,
    passwordPresent: parsed.password.length > 0,
  });
}

export function assertFormalRuntimeDatabaseTarget(
  databaseUrl: string,
  authority: PodmanRuntimeAuthority,
): void {
  const target = describeFormalRuntimeDatabaseTarget(databaseUrl);
  if (
    !target.passwordPresent ||
    target.host !== authority.network.bindAddress ||
    target.port !== authority.network.ports.postgresRuntime
  ) {
    throw new Error('FORMAL_RUNTIME_DATABASE_TARGET_INVALID');
  }
}

function parseDatabaseUrl(databaseUrl: string): URL {
  try {
    return new URL(databaseUrl);
  } catch {
    throw new Error('FORMAL_RUNTIME_DATABASE_TARGET_INVALID');
  }
}
