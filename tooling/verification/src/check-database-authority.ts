import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface TableOwnership {
  readonly schemas: Readonly<Record<string, string>>;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '../../..');
const MIGRATIONS = join(ROOT, 'db/migrations');
const MODULES = join(ROOT, 'apps/governance-api/src/modules');
const GENERATED_TYPES = join(
  ROOT,
  'apps/governance-api/src/platform/database/database-types.generated.ts',
);

export const DATABASE_AUTHORITY_WORKSPACE =
  '@hospital-data-intelligence/governance-api' as const;
export const DATABASE_AUTHORITY_VERIFY_SCRIPT = 'db:types:verify' as const;

export interface DatabaseAuthoritySpawnResult {
  readonly status: number | null;
  readonly stdout: string | Buffer | null;
  readonly stderr: string | Buffer | null;
}

export type DatabaseAuthoritySpawn = (
  executable: string,
  args: string[],
  options: { readonly cwd: string; readonly encoding: 'utf8'; readonly env: NodeJS.ProcessEnv },
) => DatabaseAuthoritySpawnResult;

export function runDatabaseAuthorityCheck(): void {
  const ownership = JSON.parse(
    readFileSync(join(ROOT, 'db/table-ownership.json'), 'utf8'),
  ) as TableOwnership;
  const migrationFiles = readdirSync(MIGRATIONS)
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();
  assert.ok(migrationFiles.length > 0, 'At least one migration is required.');
  for (const [index, name] of migrationFiles.entries()) {
    assert.equal(
      name.slice(0, 4),
      String(index + 1).padStart(4, '0'),
      `Migration sequence gap: ${name}`,
    );
  }

  const migrationManifest = migrationFiles.map((name) => {
    const bytes = readFileSync(join(MIGRATIONS, name));
    const source = bytes.toString('utf8');
    assert.equal(/\btimestamp\s+with\s+time\s+zone\b/iu.test(source), false, `${name} contains timestamp with time zone`);
    assert.equal(/\btimestamptz\b/iu.test(source), false, `${name} contains timestamptz`);
    assert.equal(/\btime\s+with\s+time\s+zone\b/iu.test(source), false, `${name} contains time with time zone`);
    return { file: name, sha256: createHash('sha256').update(bytes).digest('hex') };
  });

  const generatedTypes = readFileSync(GENERATED_TYPES, 'utf8');
  for (const { file } of migrationManifest) {
    const source = readFileSync(join(MIGRATIONS, file), 'utf8');
    for (const match of source.matchAll(/\bcreate\s+table\s+([a-z_]+\.[a-z_]+)/giu)) {
      const tableName = match[1];
      if (tableName) {
        assert.ok(
          generatedTypes.includes(`"${tableName}"`),
          `Generated database types are missing ${tableName}`,
        );
      }
    }
  }

  const ownerByModule = new Map(
    Object.entries(ownership.schemas).map(([schema, module]) => [module, schema]),
  );
  for (const entry of readdirSync(MODULES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const ownedSchema = ownerByModule.get(entry.name);
    assert.ok(ownedSchema, `Module has no declared schema ownership: ${entry.name}`);
    for (const file of collectTypeScriptFiles(join(MODULES, entry.name))) {
      const content = readFileSync(file, 'utf8');
      const patterns = [
        /\.(?:selectFrom|innerJoin|leftJoin|rightJoin|fullJoin|insertInto|updateTable|deleteFrom)\(['"]([a-z_]+)\./gu,
        /\b(?:from|join|insert\s+into|update|delete\s+from)\s+([a-z_]+)\./giu,
      ];
      for (const pattern of patterns) {
        for (const match of content.matchAll(pattern)) {
          assert.equal(
            match[1],
            ownedSchema,
            `Cross-module SQL access in ${relative(ROOT, file)}: ${match[1]} is not owned by ${entry.name}`,
          );
        }
      }
    }
  }

  runDatabaseTypeVerification({
    repositoryRoot: ROOT,
    npmCli: process.env['npm_execpath'],
    inheritedEnvironment: process.env,
  });
  const schemaFingerprint = createHash('sha256')
    .update(migrationManifest.map((entry) => `${entry.file}:${entry.sha256}`).join('\n'))
    .digest('hex');
  process.stdout.write(`${JSON.stringify({
    gate: 'database-authority',
    migrationCount: migrationManifest.length,
    schemaFingerprint,
    status: 'PASSED',
  })}\n`);
}

export function runDatabaseTypeVerification(input: {
  readonly repositoryRoot: string;
  readonly npmCli: string | undefined;
  readonly inheritedEnvironment: Readonly<NodeJS.ProcessEnv>;
  readonly spawn?: DatabaseAuthoritySpawn;
}): void {
  assert.ok(input.npmCli, 'npm_execpath is required for database type verification.');
  const databaseUrl = requireDatabaseAuthorityDatabaseUrl(input.inheritedEnvironment);
  const spawn = input.spawn ?? ((executable, args, options) =>
    spawnSync(executable, args, options));
  const generatedTypeVerification = spawn(
    process.execPath,
    [
      input.npmCli,
      'run',
      DATABASE_AUTHORITY_VERIFY_SCRIPT,
      '--workspace',
      DATABASE_AUTHORITY_WORKSPACE,
    ],
    {
      cwd: input.repositoryRoot,
      encoding: 'utf8',
      env: databaseAuthorityChildEnvironment(input.inheritedEnvironment),
    },
  );
  assert.equal(
    generatedTypeVerification.status,
    0,
    [
      'Generated database types drift from the migrated PostgreSQL schema.',
      redactDatabaseAuthorityOutput(
        String(generatedTypeVerification.stdout ?? ''),
        databaseUrl,
      ),
      redactDatabaseAuthorityOutput(
        String(generatedTypeVerification.stderr ?? ''),
        databaseUrl,
      ),
    ].filter(Boolean).join('\n'),
  );
}

export function databaseAuthorityChildEnvironment(
  inheritedEnvironment: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const databaseUrl = requireDatabaseAuthorityDatabaseUrl(inheritedEnvironment);
  const environment = Object.fromEntries(Object.entries(inheritedEnvironment).filter(
    ([name, value]) =>
      name.toUpperCase() !== 'NODE_OPTIONS' &&
      name.toUpperCase() !== 'DATABASE_URL' &&
      value !== undefined,
  ));
  environment['DATABASE_URL'] = databaseUrl;
  return environment;
}

export function requireDatabaseAuthorityDatabaseUrl(
  environment: Readonly<NodeJS.ProcessEnv>,
): string {
  const matches = Object.entries(environment).filter(
    ([name]) => name.toUpperCase() === 'DATABASE_URL',
  );
  if (matches.length !== 1 || (matches[0]?.[1] ?? '').length === 0) {
    throw new Error('DATABASE_AUTHORITY_DATABASE_URL_MISSING');
  }
  return matches[0]![1]!;
}

function redactDatabaseAuthorityOutput(value: string, databaseUrl: string): string {
  const json = JSON.stringify(databaseUrl);
  const variants = [...new Set([
    databaseUrl,
    encodeURIComponent(databaseUrl),
    json,
    json.slice(1, -1),
    Buffer.from(databaseUrl, 'utf8').toString('base64'),
    Buffer.from(databaseUrl, 'utf8').toString('base64url'),
    `'${databaseUrl.replaceAll("'", `'"'"'`)}'`,
    `'${databaseUrl.replaceAll("'", "''")}'`,
  ])].sort((left, right) => right.length - left.length);
  let redacted = value;
  for (const variant of variants) redacted = redacted.replaceAll(variant, '[REDACTED]');
  return redacted.replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/giu, '[REDACTED]');
}

function collectTypeScriptFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptFiles(path);
    return extname(entry.name) === '.ts' ? [path] : [];
  });
}

if (resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url))) {
  runDatabaseAuthorityCheck();
}
