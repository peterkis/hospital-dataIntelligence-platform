import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DATABASE_AUTHORITY_VERIFY_SCRIPT,
  DATABASE_AUTHORITY_WORKSPACE,
  assertMigrationDateTimeTypesAllowed,
  databaseAuthorityChildEnvironment,
  findForbiddenDatabaseColumns,
  requireDatabaseAuthorityDatabaseUrl,
  runDatabaseTypeVerification,
  type DatabaseAuthoritySpawn,
} from './check-database-authority.js';
import { executeFormalCommand } from './formal-command-executor.js';
import { buildFormalRuntimeDatabaseUrl } from './runtime/formal-runtime-database-connection.js';
import { loadPodmanRuntimeAuthority } from './runtime/podman-runtime-authority.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const canonicalDatabaseUrl =
  'postgresql://hdi_phase01:synthetic-password@127.0.0.1:55432/hdi_phase01';

describe('database local date-time type authority', () => {
  it.each([
    ['timestamp precision', 'create table platform.example (value timestamp(6) with time zone);'],
    ['timestamp alias', 'create table platform.example (value timestamptz);'],
    ['time precision', 'create table platform.example (value time(3) with time zone);'],
    ['time alias', 'create table platform.example (value timetz);'],
    ['time-zone range', 'create table platform.example (value tstzrange);'],
    ['time-zone multirange', 'create table platform.example (value tstzmultirange);'],
  ])('rejects the %s SQL spelling', (_case, source) => {
    expect(() => assertMigrationDateTimeTypesAllowed('0001_example.sql', source))
      .toThrow(/0001_example\.sql contains/u);
  });

  it('allows the project-owned date and local date-time SQL types', () => {
    expect(() => assertMigrationDateTimeTypesAllowed('0001_example.sql', `
      create table platform.example (
        local_date date,
        local_time time(6) without time zone,
        local_timestamp timestamp(6) without time zone,
        local_period tsrange
      );
    `)).not.toThrow();
  });

  it('queries owned PostgreSQL schemas and returns only safe forbidden column facts', async () => {
    const calls: Array<{ queryText: string; values: readonly unknown[] }> = [];
    const findings = await findForbiddenDatabaseColumns(async (queryText, values) => {
      calls.push({ queryText, values });
      return {
        rows: [{
          schemaName: 'price_list',
          tableName: 'unsafe_example',
          columnName: 'recorded_at',
          dataType: 'timestamp(6) with time zone',
        }],
      };
    }, ['platform', 'price_list']);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.queryText).toContain('pg_catalog.pg_attribute');
    expect(calls[0]?.values).toEqual([['platform', 'price_list']]);
    expect(findings).toEqual([{
      schemaName: 'price_list',
      tableName: 'unsafe_example',
      columnName: 'recorded_at',
      dataType: 'timestamp(6) with time zone',
    }]);
    expect(JSON.stringify(findings)).not.toContain('postgresql://');
  });
});

describe('database authority nested workspace command boundary', () => {
  it('removes inherited NODE_OPTIONS and preserves the canonical database URL, npm, PATH, and required secrets', () => {
    const environment = databaseAuthorityChildEnvironment({
      PATH: 'controlled-path',
      npm_execpath: 'controlled-npm-cli',
      NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
      HDI_POSTGRES_PASSWORD: 'retained-secret',
      ABG_RUN_ID: 'formal-run-id',
      DATABASE_URL: canonicalDatabaseUrl,
    });
    expect(environment).toMatchObject({
      PATH: 'controlled-path',
      npm_execpath: 'controlled-npm-cli',
      HDI_POSTGRES_PASSWORD: 'retained-secret',
      ABG_RUN_ID: 'formal-run-id',
      DATABASE_URL: canonicalDatabaseUrl,
    });
    expect(environment['NODE_OPTIONS']).toBeUndefined();
  });

  it('uses the current npm CLI, exact workspace, root cwd, and unchanged verify script', () => {
    const calls: Array<Parameters<DatabaseAuthoritySpawn>> = [];
    const spawn: DatabaseAuthoritySpawn = (...args) => {
      calls.push(args);
      return { status: 0, stdout: '', stderr: '' };
    };
    runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: {
        NODE_OPTIONS: '--loader=relative-loader.mjs',
        PATH: 'controlled-path',
        DATABASE_URL: canonicalDatabaseUrl,
      },
      spawn,
    });
    expect(calls).toHaveLength(1);
    const [executable, args, options] = calls[0]!;
    expect(executable).toBe(process.execPath);
    expect(args).toEqual([
      'locked-npm-cli.js',
      'run',
      DATABASE_AUTHORITY_VERIFY_SCRIPT,
      '--workspace',
      DATABASE_AUTHORITY_WORKSPACE,
    ]);
    expect(options).toMatchObject({ cwd: 'repository-root', encoding: 'utf8' });
    expect(options.env['NODE_OPTIONS']).toBeUndefined();
    expect(options.env['DATABASE_URL']).toBe(canonicalDatabaseUrl);
  });

  it('fails with a stable code before nested npm when DATABASE_URL is missing or empty', () => {
    expect(() => requireDatabaseAuthorityDatabaseUrl({}))
      .toThrow('DATABASE_AUTHORITY_DATABASE_URL_MISSING');
    expect(() => runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: { DATABASE_URL: '' },
      spawn: () => { throw new Error('nested npm must not start'); },
    })).toThrow('DATABASE_AUTHORITY_DATABASE_URL_MISSING');
  });

  it('passes only on exit zero and fails closed with original output on nonzero exit', () => {
    expect(() => runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: { DATABASE_URL: canonicalDatabaseUrl },
      spawn: () => ({ status: 0, stdout: 'verified', stderr: '' }),
    })).not.toThrow();
    expect(() => runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: { DATABASE_URL: canonicalDatabaseUrl },
      spawn: () => ({ status: 7, stdout: 'verify-stdout', stderr: 'verify-stderr' }),
    })).toThrow(/verify-stdout[\s\S]*verify-stderr/u);
  });

  it('redacts a failed nested npm connection string without changing the failure', () => {
    expect(() => runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: { DATABASE_URL: canonicalDatabaseUrl },
      spawn: () => ({
        status: 7,
        stdout: '',
        stderr: 'connection failed: ' + canonicalDatabaseUrl,
      }),
    })).toThrow(/\[REDACTED\]/u);
    try {
      runDatabaseTypeVerification({
        repositoryRoot: 'repository-root',
        npmCli: 'locked-npm-cli.js',
        inheritedEnvironment: { DATABASE_URL: canonicalDatabaseUrl },
        spawn: () => ({ status: 7, stdout: '', stderr: canonicalDatabaseUrl }),
      });
    } catch (error) {
      expect(String(error)).not.toContain(canonicalDatabaseUrl);
    }
  });

  it('regresses the sequence 12 missing-DATABASE_URL stderr with the canonical binding', async () => {
    const sequence12StderrSubject = await readFile(
      resolve(
        repositoryRoot,
        'tooling/verification/src/testing/fixtures/' +
          'sequence-12-database-authority-stderr.subject.txt',
      ),
      'utf8',
    );
    expect(sequence12StderrSubject).toContain(
      "Environment variable 'DATABASE_URL' could not be found.",
    );
    expect(sequence12StderrSubject).not.toContain('ERR_MODULE_NOT_FOUND');
    expect(sequence12StderrSubject).not.toContain('EEXIST');

    const authority = loadPodmanRuntimeAuthority(repositoryRoot).authority;
    const canonical = buildFormalRuntimeDatabaseUrl(authority, 'sequence12@regression%');
    let observedEnvironment: NodeJS.ProcessEnv | undefined;
    expect(() => runDatabaseTypeVerification({
      repositoryRoot,
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: {
        DATABASE_URL: canonical,
        NODE_OPTIONS: '--loader=relative-loader.mjs',
      },
      spawn: (_executable, _args, options) => {
        observedEnvironment = options.env;
        return { status: 0, stdout: 'verified', stderr: '' };
      },
    })).not.toThrow();
    expect(observedEnvironment?.['DATABASE_URL']).toBe(canonical);
    expect(observedEnvironment?.['NODE_OPTIONS']).toBeUndefined();
  });

  it('executes the formal setup 03, shared command, and nested npm workspace production chain', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'hdi-loader-chain-'));
    const formalEvidence = join(fixtureRoot, 'formal-evidence');
    const loaderPath = join(fixtureRoot, 'tooling/verification/node-ts-loader.mjs');
    const databaseSubjectPath = join(
      fixtureRoot,
      'tooling/verification/src/check-database-authority.ts',
    );
    const sharedRunnerPath = join(fixtureRoot, 'synthetic-shared-runner.ts');
    const workspaceDirectory = join(fixtureRoot, 'apps/governance-api');
    const runtimeAuthorityPath = join(
      fixtureRoot,
      'phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json',
    );
    const requiredSecret = 'synthetic-retained-secret-value';
    const runtimeDatabaseUrl =
      'postgresql://hdi_phase01:synthetic-retained-secret-value@127.0.0.1:55432/hdi_phase01';
    const originalNodeOptions = process.env['NODE_OPTIONS'];
    const originalRequiredSecret = process.env['HDI_POSTGRES_PASSWORD'];
    const originalDatabaseUrl = process.env['DATABASE_URL'];
    try {
      await Promise.all([
        mkdir(dirname(loaderPath), { recursive: true }),
        mkdir(dirname(databaseSubjectPath), { recursive: true }),
        mkdir(workspaceDirectory, { recursive: true }),
        mkdir(dirname(runtimeAuthorityPath), { recursive: true }),
      ]);
      await copyFile(resolve(repositoryRoot, 'tooling/verification/node-ts-loader.mjs'), loaderPath);
      await copyFile(
        resolve(
          repositoryRoot,
          'phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json',
        ),
        runtimeAuthorityPath,
      );
      const databaseAuthorityModule = pathToFileURL(
        resolve(repositoryRoot, 'tooling/verification/src/check-database-authority.ts'),
      ).href;
      const sharedExecutorModule = pathToFileURL(
        resolve(repositoryRoot, 'tooling/verification/src/shared-command-executor.ts'),
      ).href;
      await Promise.all([
        writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
          private: true,
          type: 'module',
          workspaces: ['apps/governance-api'],
          scripts: {
            'check:database-authority':
              'node tooling/verification/src/check-database-authority.ts',
          },
        })),
        writeFile(join(workspaceDirectory, 'package.json'), JSON.stringify({
          name: DATABASE_AUTHORITY_WORKSPACE,
          private: true,
          type: 'module',
          scripts: {
            [DATABASE_AUTHORITY_VERIFY_SCRIPT]: 'node verify-probe.mjs',
          },
        })),
        writeFile(join(workspaceDirectory, 'verify-probe.mjs'), [
          "import { writeFileSync } from 'node:fs';",
          "const observation = {",
          "  cwdIsWorkspace: process.cwd().replaceAll('\\\\', '/').endsWith('/apps/governance-api'),",
          "  nodeOptions: process.env.NODE_OPTIONS ?? null,",
          "  runId: process.env.ABG_RUN_ID ?? null,",
          `  secretPresent: process.env.HDI_POSTGRES_PASSWORD === ${JSON.stringify(requiredSecret)},`,
          "  dockerHost: process.env.DOCKER_HOST ?? null,",
          `  databaseUrlPresent: process.env.DATABASE_URL === ${JSON.stringify(runtimeDatabaseUrl)},`,
          "};",
          "writeFileSync(process.env.SYNTHETIC_OBSERVATION_PATH, JSON.stringify(observation));",
          "process.stdout.write(JSON.stringify(observation) + '\\n');",
          "if (!observation.cwdIsWorkspace || observation.nodeOptions !== null ||",
          "    !observation.secretPresent || !observation.runId || !observation.dockerHost ||",
          "    !observation.databaseUrlPresent) {",
          "  process.exitCode = 19;",
          "}",
        ].join('\n')),
        writeFile(databaseSubjectPath, [
          `import { runDatabaseTypeVerification } from ${JSON.stringify(databaseAuthorityModule)};`,
          "runDatabaseTypeVerification({",
          "  repositoryRoot: process.cwd(),",
          "  npmCli: process.env.npm_execpath,",
          "  inheritedEnvironment: process.env,",
          "});",
          "process.stdout.write('DATABASE_AUTHORITY_SYNTHETIC_PASSED\\n');",
        ].join('\n')),
        writeFile(sharedRunnerPath, [
          "import { mkdir } from 'node:fs/promises';",
          "import { resolve } from 'node:path';",
          `import { executeSharedCommand } from ${JSON.stringify(sharedExecutorModule)};`,
          "const sharedDirectory = resolve('shared-evidence');",
          "const stagingDirectory = resolve('staging');",
          "await Promise.all([",
          "  mkdir(sharedDirectory, { recursive: true }),",
          "  mkdir(stagingDirectory, { recursive: true }),",
          "]);",
          "const result = await executeSharedCommand({",
          "  command: {",
          "    id: 'database-authority',",
          "    producerIds: ['database'],",
          "    executable: process.execPath,",
          "    args: [process.env.SYNTHETIC_NPM_CLI, 'run', 'check:database-authority'],",
          "    workingDirectory: '.',",
          "    runtimeEnvironmentBindings: ['FORMAL_RUNTIME_DATABASE_URL'],",
          "  },",
          "  repositoryRoot: process.cwd(),",
          "  stagingDirectory,",
          "  sharedDirectory,",
          "  runId: process.env.ABG_RUN_ID ?? 'missing-run-id',",
          "  inheritedEnvironment: process.env,",
          "  runtimeEnvironmentBindings: {",
          "    FORMAL_RUNTIME_DATABASE_URL: { DATABASE_URL: process.env.SYNTHETIC_DATABASE_URL },",
          "  },",
          "});",
          "process.stdout.write(JSON.stringify(result) + '\\n');",
          "if (result.exitCode !== 0) process.exitCode = result.exitCode ?? 20;",
        ].join('\n')),
      ]);

      process.env['NODE_OPTIONS'] = '--loader=./tooling/verification/node-ts-loader.mjs';
      process.env['HDI_POSTGRES_PASSWORD'] = requiredSecret;
      process.env['DATABASE_URL'] =
        'postgresql://wrong:wrong@external.invalid:9999/wrong';
      const execution = await executeFormalCommand({
        repositoryRoot: fixtureRoot,
        command: {
          executable: 'node',
          args: [
            '--loader',
            './tooling/verification/node-ts-loader.mjs',
            'synthetic-shared-runner.ts',
          ],
          workingDirectory: '.',
        },
        evidenceDirectory: formalEvidence,
        injectedEnvironment: {
          ABG_RUN_ID: 'synthetic-sequence-11-regression',
          ABG_RUN_SEQUENCE: '12',
          DOCKER_HOST: 'unix:///controlled/podman.sock',
          HDI_POSTGRES_PASSWORD: requiredSecret,
          SYNTHETIC_NPM_CLI: resolve(
            dirname(process.execPath),
            'node_modules/npm/bin/npm-cli.js',
          ),
          SYNTHETIC_OBSERVATION_PATH: join(fixtureRoot, 'workspace-observation.json'),
          SYNTHETIC_DATABASE_URL: runtimeDatabaseUrl,
        },
      });

      const [formalStdout, formalStderr, databaseStdout, databaseStderr] = await Promise.all([
        readFile(join(formalEvidence, 'stdout.log'), 'utf8'),
        readFile(join(formalEvidence, 'stderr.log'), 'utf8'),
        readFile(join(fixtureRoot, 'shared-evidence/raw/commands/database-authority.stdout.log'), 'utf8'),
        readFile(join(fixtureRoot, 'shared-evidence/raw/commands/database-authority.stderr.log'), 'utf8'),
      ]);
      expect(execution.exitCode, formalStdout + formalStderr + databaseStdout + databaseStderr)
        .toBe(0);
      const workspaceObservationBytes = await readFile(
        join(fixtureRoot, 'workspace-observation.json'),
        'utf8',
      );
      const workspaceObservation = JSON.parse(workspaceObservationBytes) as Readonly<
        Record<string, unknown>
      >;
      expect(formalStdout).toContain('"id":"database-authority"');
      expect(formalStdout).toContain('"exitCode":0');
      expect(formalStderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(databaseStdout).toContain('DATABASE_AUTHORITY_SYNTHETIC_PASSED');
      expect(workspaceObservation).toEqual({
        cwdIsWorkspace: true,
        nodeOptions: null,
        runId: 'synthetic-sequence-11-regression',
        secretPresent: true,
        dockerHost: 'unix:///controlled/podman.sock',
        databaseUrlPresent: true,
      });
      expect(databaseStderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(formalStdout).not.toContain(runtimeDatabaseUrl);
      expect(formalStderr).not.toContain(runtimeDatabaseUrl);
      expect(databaseStdout).not.toContain(runtimeDatabaseUrl);
      expect(databaseStderr).not.toContain(runtimeDatabaseUrl);
    } finally {
      if (originalNodeOptions === undefined) delete process.env['NODE_OPTIONS'];
      else process.env['NODE_OPTIONS'] = originalNodeOptions;
      if (originalRequiredSecret === undefined) delete process.env['HDI_POSTGRES_PASSWORD'];
      else process.env['HDI_POSTGRES_PASSWORD'] = originalRequiredSecret;
      if (originalDatabaseUrl === undefined) delete process.env['DATABASE_URL'];
      else process.env['DATABASE_URL'] = originalDatabaseUrl;
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('keeps Kysely codegen loader-free and cannot omit db:types:verify', async () => {
    const packageDefinition = JSON.parse(await readFile(
      resolve(repositoryRoot, 'apps/governance-api/package.json'),
      'utf8',
    )) as { readonly scripts: Readonly<Record<string, string>> };
    expect(packageDefinition.scripts[DATABASE_AUTHORITY_VERIFY_SCRIPT])
      .toBe('kysely-codegen --config-file kysely-codegen.json --verify');
    expect(packageDefinition.scripts[DATABASE_AUTHORITY_VERIFY_SCRIPT]).not.toContain('--loader');
  });
});
