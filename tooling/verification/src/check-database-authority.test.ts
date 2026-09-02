import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DATABASE_AUTHORITY_VERIFY_SCRIPT,
  DATABASE_AUTHORITY_WORKSPACE,
  databaseAuthorityChildEnvironment,
  runDatabaseTypeVerification,
  type DatabaseAuthoritySpawn,
} from './check-database-authority.js';
import { executeFormalCommand } from './formal-command-executor.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('database authority nested workspace command boundary', () => {
  it('removes inherited NODE_OPTIONS and preserves npm, PATH, and required secrets', () => {
    const environment = databaseAuthorityChildEnvironment({
      PATH: 'controlled-path',
      npm_execpath: 'controlled-npm-cli',
      NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
      HDI_POSTGRES_PASSWORD: 'retained-secret',
      ABG_RUN_ID: 'formal-run-id',
    });
    expect(environment).toMatchObject({
      PATH: 'controlled-path',
      npm_execpath: 'controlled-npm-cli',
      HDI_POSTGRES_PASSWORD: 'retained-secret',
      ABG_RUN_ID: 'formal-run-id',
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
  });

  it('passes only on exit zero and fails closed with original output on nonzero exit', () => {
    expect(() => runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: {},
      spawn: () => ({ status: 0, stdout: 'verified', stderr: '' }),
    })).not.toThrow();
    expect(() => runDatabaseTypeVerification({
      repositoryRoot: 'repository-root',
      npmCli: 'locked-npm-cli.js',
      inheritedEnvironment: {},
      spawn: () => ({ status: 7, stdout: 'verify-stdout', stderr: 'verify-stderr' }),
    })).toThrow(/verify-stdout[\s\S]*verify-stderr/u);
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
    const requiredSecret = 'synthetic-retained-secret-value';
    const originalNodeOptions = process.env['NODE_OPTIONS'];
    const originalRequiredSecret = process.env['HDI_POSTGRES_PASSWORD'];
    try {
      await Promise.all([
        mkdir(dirname(loaderPath), { recursive: true }),
        mkdir(dirname(databaseSubjectPath), { recursive: true }),
        mkdir(workspaceDirectory, { recursive: true }),
      ]);
      await copyFile(resolve(repositoryRoot, 'tooling/verification/node-ts-loader.mjs'), loaderPath);
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
          "};",
          "writeFileSync(process.env.SYNTHETIC_OBSERVATION_PATH, JSON.stringify(observation));",
          "process.stdout.write(JSON.stringify(observation) + '\\n');",
          "if (!observation.cwdIsWorkspace || observation.nodeOptions !== null ||",
          "    !observation.secretPresent || !observation.runId || !observation.dockerHost) {",
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
          "  },",
          "  repositoryRoot: process.cwd(),",
          "  stagingDirectory,",
          "  sharedDirectory,",
          "  runId: process.env.ABG_RUN_ID ?? 'missing-run-id',",
          "  inheritedEnvironment: process.env,",
          "});",
          "process.stdout.write(JSON.stringify(result) + '\\n');",
          "if (result.exitCode !== 0) process.exitCode = result.exitCode ?? 20;",
        ].join('\n')),
      ]);

      process.env['NODE_OPTIONS'] = '--loader=./tooling/verification/node-ts-loader.mjs';
      process.env['HDI_POSTGRES_PASSWORD'] = requiredSecret;
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
        },
      });

      const [formalStdout, formalStderr] = await Promise.all([
        readFile(join(formalEvidence, 'stdout.log'), 'utf8'),
        readFile(join(formalEvidence, 'stderr.log'), 'utf8'),
      ]);
      expect(execution.exitCode, formalStdout + formalStderr).toBe(0);
      const [databaseStdout, databaseStderr, workspaceObservationBytes] = await Promise.all([
        readFile(join(fixtureRoot, 'shared-evidence/raw/commands/database-authority.stdout.log'), 'utf8'),
        readFile(join(fixtureRoot, 'shared-evidence/raw/commands/database-authority.stderr.log'), 'utf8'),
        readFile(join(fixtureRoot, 'workspace-observation.json'), 'utf8'),
      ]);
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
      });
      expect(databaseStderr).not.toContain('ERR_MODULE_NOT_FOUND');
    } finally {
      if (originalNodeOptions === undefined) delete process.env['NODE_OPTIONS'];
      else process.env['NODE_OPTIONS'] = originalNodeOptions;
      if (originalRequiredSecret === undefined) delete process.env['HDI_POSTGRES_PASSWORD'];
      else process.env['HDI_POSTGRES_PASSWORD'] = originalRequiredSecret;
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
