import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createDeterministicChildEnvironment,
  REPOSITORY_NODE_LOADER_PATH,
  repositoryTypeScriptCommand,
} from './node-command-boundary.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('repository Node command boundary', () => {
  it('builds and starts a registered TypeScript entry with an explicit repository loader', async () => {
    const root = await syntheticRepository();
    const command = await repositoryTypeScriptCommand(
      root,
      'tooling/verification/src/produce-abg-gate.ts',
      ['argument'],
    );
    expect(command).toEqual({
      executable: 'node',
      args: [
        '--loader',
        REPOSITORY_NODE_LOADER_PATH,
        'tooling/verification/src/produce-abg-gate.ts',
        'argument',
      ],
      workingDirectory: '.',
    });
    const result = spawnSync(command.executable, [...command.args], {
      cwd: root,
      encoding: 'utf8',
      env: createDeterministicChildEnvironment({
        inheritedEnvironment: process.env,
        nodeOptionsForbiddenCode: 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN',
      }),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('EXPLICIT_LOADER_OK:argument');
  });

  it.each([
    ['absolute', 'C:/host/produce-abg-gate.ts', 'REPOSITORY_TYPESCRIPT_ENTRY_PATH_INVALID'],
    ['parent escape', '../produce-abg-gate.ts', 'REPOSITORY_TYPESCRIPT_ENTRY_PATH_INVALID'],
    ['non-TypeScript', 'tooling/verification/src/produce-abg-gate.js', 'REPOSITORY_TYPESCRIPT_ENTRY_UNREGISTERED'],
    ['unregistered', 'tooling/verification/src/unregistered.ts', 'REPOSITORY_TYPESCRIPT_ENTRY_UNREGISTERED'],
  ] as const)('rejects a %s entry path', async (_name, path, code) => {
    const root = await syntheticRepository();
    await expect(repositoryTypeScriptCommand(root, path)).rejects.toThrow(code);
  });

  it('rejects a registered entry whose physical path escapes through a junction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'hdi-node-command-root-'));
    const external = await mkdtemp(join(tmpdir(), 'hdi-node-command-external-'));
    roots.push(root, external);
    await mkdir(join(root, 'tooling/verification'), { recursive: true });
    await writeLoader(root);
    await writeFile(join(external, 'produce-abg-gate.ts'), 'process.stdout.write("escape");\n');
    await symlink(
      external,
      join(root, 'tooling/verification/src'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(repositoryTypeScriptCommand(
      root,
      'tooling/verification/src/produce-abg-gate.ts',
    )).rejects.toThrow('REPOSITORY_TYPESCRIPT_ENTRY_SYMLINK_ESCAPE');
  });

  it('removes inherited NODE_OPTIONS while preserving formal identity, npm, and secrets', () => {
    const environment = createDeterministicChildEnvironment({
      inheritedEnvironment: {
        PATH: 'controlled-path',
        HOME: 'controlled-home',
        npm_execpath: 'controlled-npm-cli',
        NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
        ABG_RUN_ID: 'formal-run-id',
        DOCKER_HOST: 'unix:///controlled/podman.sock',
        HDI_POSTGRES_PASSWORD: 'retained-secret',
      },
      injectedEnvironment: { ABG_RUN_SEQUENCE: '12' },
      nodeOptionsForbiddenCode: 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN',
    });
    expect(environment).toMatchObject({
      PATH: 'controlled-path',
      HOME: 'controlled-home',
      npm_execpath: 'controlled-npm-cli',
      ABG_RUN_ID: 'formal-run-id',
      ABG_RUN_SEQUENCE: '12',
      DOCKER_HOST: 'unix:///controlled/podman.sock',
      HDI_POSTGRES_PASSWORD: 'retained-secret',
    });
    expect(environment['NODE_OPTIONS']).toBeUndefined();
  });

  it.each([
    ['FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN', 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN'],
    ['SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN', 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN'],
  ] as const)('rejects command-declared NODE_OPTIONS at the %s boundary', (boundary, code) => {
    expect(() => createDeterministicChildEnvironment({
      inheritedEnvironment: process.env,
      commandEnvironment: { NODE_OPTIONS: '--loader=relative-loader.mjs' },
      nodeOptionsForbiddenCode: boundary,
    })).toThrow(code);
  });

  it('reproduces the sequence 11 child-cwd loader failure and removes it at the fixed boundary', async () => {
    const root = await syntheticWorkspace();
    const npmExecutable = process.platform === 'win32'
      ? process.env['ComSpec'] ?? 'cmd.exe'
      : 'npm';
    const inheritedEnvironment = {
      ...process.env,
      NODE_OPTIONS: '--loader=./tooling/verification/node-ts-loader.mjs',
    };
    const args = [
      'run',
      'probe',
      '--workspace',
      '@hospital-data-intelligence/governance-api',
    ];
    const npmArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', ['npm', ...args].join(' ')]
      : args;
    const contaminated = spawnSync(npmExecutable, npmArgs, {
      cwd: root,
      encoding: 'utf8',
      env: inheritedEnvironment,
    });
    expect(contaminated.status).not.toBe(0);
    const contaminatedError = (contaminated.stderr ?? '').replaceAll('\\', '/');
    expect(contaminatedError).toContain('ERR_MODULE_NOT_FOUND');
    expect(contaminatedError).toContain(
      'apps/governance-api/tooling/verification/node-ts-loader.mjs',
    );

    const formalIsolated = spawnSync(npmExecutable, npmArgs, {
      cwd: root,
      encoding: 'utf8',
      env: createDeterministicChildEnvironment({
        inheritedEnvironment,
        nodeOptionsForbiddenCode: 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN',
      }),
    });
    expect(formalIsolated.status, formalIsolated.stderr).toBe(0);
    expect(readWorkspaceObservation(formalIsolated.stdout)).toMatchObject({
      nodeOptions: null,
    });

    const sharedIsolated = spawnSync(npmExecutable, npmArgs, {
      cwd: root,
      encoding: 'utf8',
      env: createDeterministicChildEnvironment({
        inheritedEnvironment,
        nodeOptionsForbiddenCode: 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN',
      }),
    });
    expect(sharedIsolated.status, sharedIsolated.stderr).toBe(0);
    const observation = readWorkspaceObservation(sharedIsolated.stdout);
    expect(observation.cwd.replaceAll('\\', '/')).toMatch(/apps\/governance-api$/u);
    expect(observation.nodeOptions).toBeNull();
  }, 30_000);
});

async function syntheticRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hdi-node-command-'));
  roots.push(root);
  await mkdir(join(root, 'tooling/verification/src'), { recursive: true });
  await writeLoader(root);
  await writeFile(
    join(root, 'tooling/verification/src/produce-abg-gate.ts'),
    "const message: string = 'EXPLICIT_LOADER_OK:' + (process.argv[2] ?? '');\n" +
      'process.stdout.write(message);\n',
  );
  return root;
}

async function syntheticWorkspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hdi-sequence11-loader-'));
  roots.push(root);
  const workspace = join(root, 'apps/governance-api');
  await mkdir(workspace, { recursive: true });
  await writeLoader(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({
    name: 'sequence-11-loader-subject',
    private: true,
    workspaces: ['apps/*'],
  }));
  await writeFile(join(workspace, 'package.json'), JSON.stringify({
    name: '@hospital-data-intelligence/governance-api',
    private: true,
    scripts: { probe: 'node probe.mjs' },
  }));
  await writeFile(
    join(workspace, 'probe.mjs'),
    'process.stdout.write(JSON.stringify({cwd:process.cwd(),nodeOptions:process.env.NODE_OPTIONS??null}));\n',
  );
  return root;
}

async function writeLoader(root: string): Promise<void> {
  const path = resolve(root, REPOSITORY_NODE_LOADER_PATH.slice(2));
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(
    path,
    'export async function resolve(specifier, context, nextResolve) {\n' +
      '  return nextResolve(specifier, context);\n' +
      '}\n',
  );
}

function readWorkspaceObservation(stdout: string): {
  readonly cwd: string;
  readonly nodeOptions: string | null;
} {
  const observationLine = stdout.split(/\r?\n/u).find((line) =>
    line.startsWith('{"cwd":'));
  if (observationLine === undefined) throw new Error('WORKSPACE_OBSERVATION_MISSING');
  return JSON.parse(observationLine) as {
    readonly cwd: string;
    readonly nodeOptions: string | null;
  };
}
