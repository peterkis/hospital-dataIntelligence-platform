import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSharedAbgCommandPlan, type SharedCommand } from './shared-abg-command-plan.js';
import { loadPodmanRuntimeAuthority } from './runtime/podman-runtime-authority.js';
import {
  executeSharedCommand,
  resolveSharedRuntimeEnvironmentBindings,
  type SharedRuntimeEnvironmentBindings,
} from './shared-command-executor.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const canonicalDatabaseUrl =
  'postgresql://hdi_phase01:password@127.0.0.1:55432/hdi_phase01';
const bindings: SharedRuntimeEnvironmentBindings = {
  FORMAL_RUNTIME_DATABASE_URL: { DATABASE_URL: canonicalDatabaseUrl },
  FORMAL_LIVE_RUNTIME: {
    GOVERNANCE_API_BASE_URL: 'http://127.0.0.1:3000',
    KEYCLOAK_ISSUER_URL: 'http://127.0.0.1:18080/realms/hdi-phase01',
  },
  FORMAL_BROWSER_RUNTIME: { PHASE01_E2E_BASE_URL: 'http://127.0.0.1:3000' },
};
const runtimeAuthority = loadPodmanRuntimeAuthority(repositoryRoot).authority;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })));
});

describe('shared runtime environment binding resolution', () => {
  it('injects the canonical URL only into database authority and live', async () => {
    const commands = await buildSharedAbgCommandPlan(repositoryRoot);
    const environmentFor = (id: string) => resolveSharedRuntimeEnvironmentBindings(
      commands.find((command) => command.id === id)!,
      bindings,
      runtimeAuthority,
    );
    expect(environmentFor('database-authority')).toEqual({ DATABASE_URL: canonicalDatabaseUrl });
    expect(environmentFor('live')).toMatchObject({ DATABASE_URL: canonicalDatabaseUrl });
    for (const id of [
      'runtime', 'repo-layout', 'module-boundaries', 'typecheck', 'build',
      'contract-lint', 'integration', 'browser',
    ]) {
      expect(environmentFor(id)['DATABASE_URL']).toBeUndefined();
    }
  });

  it('fails closed when the required database binding is missing or empty', async () => {
    const command = (await buildSharedAbgCommandPlan(repositoryRoot)).find(
      (candidate) => candidate.id === 'database-authority',
    )!;
    expect(() => resolveSharedRuntimeEnvironmentBindings(command, {}, runtimeAuthority))
      .toThrow('SHARED_RUNTIME_DATABASE_BINDING_MISSING');
    expect(() => resolveSharedRuntimeEnvironmentBindings(command, {
      FORMAL_RUNTIME_DATABASE_URL: { DATABASE_URL: '' },
    }, runtimeAuthority)).toThrow('SHARED_RUNTIME_DATABASE_BINDING_MISSING');
  });

  it('rejects DATABASE_URL hidden in another binding and duplicate environment names', () => {
    const browser: SharedCommand = {
      id: 'browser',
      producerIds: ['browser'],
      executable: 'node',
      args: [],
      workingDirectory: '.',
      runtimeEnvironmentBindings: ['FORMAL_BROWSER_RUNTIME'],
    };
    expect(() => resolveSharedRuntimeEnvironmentBindings(browser, {
      FORMAL_BROWSER_RUNTIME: { DATABASE_URL: canonicalDatabaseUrl },
    }, runtimeAuthority)).toThrow('SHARED_RUNTIME_DATABASE_BINDING_UNAUTHORIZED');

    const live: SharedCommand = {
      id: 'live',
      producerIds: ['live'],
      executable: 'node',
      args: [],
      workingDirectory: '.',
      runtimeEnvironmentBindings: [
        'FORMAL_RUNTIME_DATABASE_URL',
        'FORMAL_LIVE_RUNTIME',
      ],
    };
    expect(() => resolveSharedRuntimeEnvironmentBindings(live, {
      FORMAL_RUNTIME_DATABASE_URL: { DATABASE_URL: canonicalDatabaseUrl },
      FORMAL_LIVE_RUNTIME: { database_url: canonicalDatabaseUrl },
    }, runtimeAuthority)).toThrow('SHARED_RUNTIME_ENVIRONMENT_BINDING_VALUE_DUPLICATE');
  });

  it.each(['integration', 'typecheck'])(
    'does not expose an inherited runtime DATABASE_URL to an actual %s child process',
    async (id) => {
      const root = await mkdtemp(join(tmpdir(), 'hdi-shared-db-env-'));
      temporaryRoots.push(root);
      const sharedDirectory = join(root, 'shared');
      const stagingDirectory = join(root, 'staging');
      const observationPath = join(root, id + '-observation.json');
      const probePath = join(root, 'probe.mjs');
      await Promise.all([
        mkdir(sharedDirectory),
        mkdir(stagingDirectory),
        writeFile(probePath, [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync(process.env.SYNTHETIC_OBSERVATION_PATH, JSON.stringify({",
          "  databaseUrl: process.env.DATABASE_URL ?? null,",
          "}));",
        ].join('\n')),
      ]);
      const result = await executeSharedCommand({
        command: {
          id,
          producerIds: id === 'integration' ? ['integration'] : ['static'],
          executable: process.execPath,
          args: [probePath],
          workingDirectory: '.',
          environment: { SYNTHETIC_OBSERVATION_PATH: observationPath },
        },
        repositoryRoot,
        stagingDirectory,
        sharedDirectory,
        runId: 'synthetic-database-isolation',
        inheritedEnvironment: {
          ...process.env,
          Database_Url: 'postgresql://operator-wrong-target',
        },
        runtimeEnvironmentBindings: bindings,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(await readFile(observationPath, 'utf8'))).toEqual({ databaseUrl: null });
    },
  );
});
