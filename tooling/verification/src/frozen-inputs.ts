import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Read the immutable inputs shared by formal preflight and the authoritative run plan.
 * This module intentionally has no repository-local runtime dependencies so Node can
 * execute the preflight directly inside the frozen WSL environment.
 */
export async function readFrozenInputs(
  repositoryRoot: string,
): Promise<Readonly<Record<string, string>>> {
  const gitCommitSha = (await executeGit(repositoryRoot, ['rev-parse', 'HEAD'])).trim();
  const worktree = (await executeGit(repositoryRoot, ['status', '--porcelain=v1'])).trim();
  if (worktree.length > 0) throw new Error('ABG_WORKTREE_NOT_CLEAN');
  const lockfileSha256 = await fileSha256(join(repositoryRoot, 'package-lock.json'));
  const openapiPath = join(repositoryRoot, 'contracts/openapi/phase-01.openapi.json');
  const openapiSha256 = await fileSha256(openapiPath);
  const declaredOpenapiDigest = (await readFile(
    join(repositoryRoot, 'contracts/openapi/phase-01.openapi.sha256'),
    'utf8',
  )).trim().split(/\s+/u)[0];
  if (declaredOpenapiDigest !== openapiSha256) {
    throw new Error('ABG_OPENAPI_SHA256_DRIFT');
  }
  const migrations = (await readdir(join(repositoryRoot, 'db/migrations')))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort((left, right) => left.localeCompare(right));
  const migrationManifest = await Promise.all(
    migrations.map(async (name) => ({
      path: `db/migrations/${name}`,
      sha256: await fileSha256(join(repositoryRoot, 'db/migrations', name)),
    })),
  );
  const runtimeBaseline = JSON.parse(await readFile(
    join(repositoryRoot, 'phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json'),
    'utf8',
  )) as unknown;
  const compose = await readFile(
    join(repositoryRoot, 'phase-plan/environment/anolis-8.9-wsl2/compose.phase-01.yml'),
    'utf8',
  );
  const postgresImage = requireImage(compose, 'postgres');
  const keycloakImage = requireImage(compose, 'quay.io/keycloak/keycloak');
  const fixtureIdentity = sha256(Buffer.from(canonicalJson({
    runtimeBaseline,
    realmRendererSha256: await fileSha256(
      join(repositoryRoot, 'tooling/runtime/render-keycloak-realm.ts'),
    ),
    seedSha256: await fileSha256(join(repositoryRoot, 'tooling/runtime/seed-phase-01.ts')),
  }), 'utf8'));
  const browserPackage = JSON.parse(await readFile(
    join(repositoryRoot, 'tests/e2e/package.json'),
    'utf8',
  )) as { readonly devDependencies?: Readonly<Record<string, string>> };
  const browserVersion = browserPackage.devDependencies?.['@playwright/test'];
  if (!browserVersion) throw new Error('ABG_BROWSER_VERSION_MISSING');
  return {
    gitCommitSha,
    workingTreeState: 'CLEAN',
    lockfileSha256,
    openapiSha256,
    migrationManifestSha256: sha256(Buffer.from(canonicalJson(migrationManifest), 'utf8')),
    fixtureIdentity,
    nodeVersion: process.version,
    postgresImage,
    keycloakImage,
    browserVersion,
  };
}

async function executeGit(repositoryRoot: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', [...args], {
    cwd: repositoryRoot,
    windowsHide: true,
    encoding: 'utf8',
  });
  return result.stdout;
}

async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function requireImage(compose: string, imageName: string): string {
  const line = compose.split(/\r?\n/u).find((candidate) =>
    candidate.trim().startsWith(`image: ${imageName}`),
  );
  if (!line) throw new Error(`ABG_IMAGE_IDENTITY_MISSING:${imageName}`);
  return line.trim().slice('image: '.length);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(',')}}`;
  }
  throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
