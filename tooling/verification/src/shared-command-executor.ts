import { spawn, type ChildProcess } from 'node:child_process';
import { join, resolve } from 'node:path';
import {
  writeRedactedTextArtifact,
} from './evidence/recorder.js';
import { createDeterministicChildEnvironment } from './runtime/node-command-boundary.js';
import type { SharedCommand } from './shared-abg-command-plan.js';

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
  readonly recordRuntimeProcess?: (
    event: 'STARTED' | 'STOPPED',
    child: ChildProcess,
    role: string,
  ) => Promise<void>;
}): Promise<SharedCommandResult> {
  const started = performance.now();
  const environment: Record<string, string> = { ...input.command.environment };
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
    ),
    writeRedactedTextArtifact(
      input.sharedDirectory,
      'raw/commands/' + input.command.id + '.stderr.log',
      Buffer.concat(stderr).toString('utf8'),
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
