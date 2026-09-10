import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  writeRedactedTextArtifact,
} from './evidence/recorder.js';
import { createDeterministicChildEnvironment } from './runtime/node-command-boundary.js';
import { assertFormalRuntimeDatabaseTarget } from './runtime/formal-runtime-database-connection.js';
import { loadPodmanRuntimeAuthority } from './runtime/podman-runtime-authority.js';
import type { PodmanRuntimeAuthority } from './runtime/podman-runtime-authority-schema.js';
import {
  assertSharedRuntimeEnvironmentBindingDeclaration,
  type SharedCommand,
  type SharedRuntimeEnvironmentBinding,
} from './shared-abg-command-plan.js';

export type SharedRuntimeEnvironmentBindings = Readonly<Partial<Record<
  SharedRuntimeEnvironmentBinding,
  Readonly<Record<string, string>>
>>>;

export interface SharedCommandResult {
  readonly id: string;
  readonly producerIds: SharedCommand['producerIds'];
  readonly exitCode: number | null;
  readonly elapsedMilliseconds: number;
  readonly error: string | null;
}

export async function executeSharedCommand(input: {
  readonly command: SharedCommand;
  readonly repositoryRoot: string;
  readonly stagingDirectory: string;
  readonly sharedDirectory: string;
  readonly runId: string;
  readonly inheritedEnvironment: Readonly<NodeJS.ProcessEnv>;
  readonly runtimeEnvironmentBindings: SharedRuntimeEnvironmentBindings;
  readonly recordRuntimeProcess?: (
    event: 'STARTED' | 'STOPPED',
    child: ChildProcess,
    role: string,
  ) => Promise<void>;
}): Promise<SharedCommandResult> {
  const started = performance.now();
  const runtimeEnvironment = resolveSharedRuntimeEnvironmentBindings(
    input.command,
    input.runtimeEnvironmentBindings,
    loadPodmanRuntimeAuthority(input.repositoryRoot).authority,
  );
  const environment: Record<string, string> = { ...runtimeEnvironment };
  if (input.command.id === 'integration') {
    environment['PHASE01_INTEGRATION_EVIDENCE_PATH'] = join(
      input.stagingDirectory,
      'integration-observations.json',
    );
    environment['VITEST_OUTPUT_FILE'] = join(input.stagingDirectory, 'vitest-results.json');
    environment['NO_COLOR'] = '1';
  }
  const args = input.command.id === 'integration'
    ? [...input.command.args, '--outputFile=' + environment['VITEST_OUTPUT_FILE']]
    : input.command.args;
  if (input.command.id === 'live') {
    environment['EVIDENCE_OUTPUT_DIR'] = join(input.stagingDirectory, 'live');
  }
  if (input.command.id === 'browser') {
    environment['PHASE01_E2E_RUN_ID'] = 'abg-' + input.runId;
    environment['PHASE01_E2E_BROWSER'] = 'chrome';
  }
  const child = spawn(input.command.executable, [...args], {
    cwd: resolve(input.repositoryRoot, input.command.workingDirectory),
    env: createDeterministicChildEnvironment({
      inheritedEnvironment: input.inheritedEnvironment,
      commandEnvironment: input.command.environment,
      injectedEnvironment: environment,
      nodeOptionsForbiddenCode: 'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN',
      databaseUrlDeclarationForbiddenCode:
        'SHARED_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN',
      databaseUrlInjectionAuthorized: input.command.runtimeEnvironmentBindings?.includes(
        'FORMAL_RUNTIME_DATABASE_URL',
      ) === true,
      databaseUrlInjectionUnauthorizedCode:
        'SHARED_RUNTIME_DATABASE_BINDING_UNAUTHORIZED',
    }),
    shell: false,
    windowsHide: true,
  });
  await input.recordRuntimeProcess?.('STARTED', child, 'producer-' + input.command.id);
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const completion = await new Promise<{
    readonly exitCode: number | null;
    readonly error: string | null;
  }>((resolveCompletion) => {
    child.once('error', (error) => resolveCompletion({
      exitCode: null,
      error: error instanceof Error ? error.message : String(error),
    }));
    child.once('close', (exitCode) => resolveCompletion({ exitCode, error: null }));
  });
  await Promise.all([
    writeRedactedTextArtifact(
      input.sharedDirectory,
      'raw/commands/' + input.command.id + '.stdout.log',
      Buffer.concat(stdout).toString('utf8'),
      { sensitiveValues: databaseUrlValues(runtimeEnvironment) },
    ),
    writeRedactedTextArtifact(
      input.sharedDirectory,
      'raw/commands/' + input.command.id + '.stderr.log',
      Buffer.concat(stderr).toString('utf8'),
      { sensitiveValues: databaseUrlValues(runtimeEnvironment) },
    ),
  ]);
  await input.recordRuntimeProcess?.('STOPPED', child, 'producer-' + input.command.id);
  return {
    id: input.command.id,
    producerIds: input.command.producerIds,
    exitCode: completion.exitCode,
    elapsedMilliseconds: Math.round(performance.now() - started),
    error: completion.error,
  };
}

export function resolveSharedRuntimeEnvironmentBindings(
  command: SharedCommand,
  bindings: SharedRuntimeEnvironmentBindings,
  runtimeAuthority: PodmanRuntimeAuthority,
): Readonly<Record<string, string>> {
  assertSharedRuntimeEnvironmentBindingDeclaration(command);
  const requested = command.runtimeEnvironmentBindings ?? [];
  const environment: Record<string, string> = {};
  const environmentNames = new Set<string>();
  for (const binding of requested) {
    const values = bindings[binding];
    if (values === undefined) {
      throw new Error(
        binding === 'FORMAL_RUNTIME_DATABASE_URL'
          ? 'SHARED_RUNTIME_DATABASE_BINDING_MISSING'
          : 'SHARED_RUNTIME_ENVIRONMENT_BINDING_MISSING',
      );
    }
    for (const [name, value] of Object.entries(values)) {
      const canonicalName = name.toUpperCase();
      if (environmentNames.has(canonicalName)) {
        throw new Error('SHARED_RUNTIME_ENVIRONMENT_BINDING_VALUE_DUPLICATE');
      }
      if (
        canonicalName === 'DATABASE_URL' &&
        binding !== 'FORMAL_RUNTIME_DATABASE_URL'
      ) {
        throw new Error('SHARED_RUNTIME_DATABASE_BINDING_UNAUTHORIZED');
      }
      environmentNames.add(canonicalName);
      environment[canonicalName === 'DATABASE_URL' ? 'DATABASE_URL' : name] = value;
    }
  }
  const databaseUrl = environment['DATABASE_URL'];
  if (
    requested.includes('FORMAL_RUNTIME_DATABASE_URL') &&
    (databaseUrl === undefined || databaseUrl.length === 0)
  ) {
    throw new Error('SHARED_RUNTIME_DATABASE_BINDING_MISSING');
  }
  if (databaseUrl !== undefined) {
    assertFormalRuntimeDatabaseTarget(databaseUrl, runtimeAuthority);
  }
  return Object.freeze(environment);
}

function databaseUrlValues(environment: Readonly<Record<string, string>>): readonly string[] {
  const value = environment['DATABASE_URL'];
  return value === undefined ? [] : [value];
}
