import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import {
  writeRedactedTextArtifact,
} from './evidence/recorder.js';
import type { AuthoritativeCommandSpec } from './authoritative-abg-plan.js';
import { createDeterministicChildEnvironment } from './runtime/node-command-boundary.js';

export interface FormalCommandExecutionContext {
  readonly signal: AbortSignal;
  trackChild(child: ChildProcess): () => void;
  throwIfAborted(): void;
}

export async function executeFormalCommand(input: {
  readonly repositoryRoot: string;
  readonly command: AuthoritativeCommandSpec;
  readonly evidenceDirectory: string;
  readonly injectedEnvironment: Readonly<Record<string, string>>;
  readonly context?: FormalCommandExecutionContext | undefined;
}): Promise<{ readonly exitCode: number | null; readonly elapsedMilliseconds: number }> {
  await mkdir(input.evidenceDirectory, { recursive: true });
  const started = performance.now();
  const workingDirectory = resolveInsideRepository(
    input.repositoryRoot,
    input.command.workingDirectory ?? '.',
  );
  const child = spawn(input.command.executable, [...input.command.args], {
    cwd: workingDirectory,
    env: createDeterministicChildEnvironment({
      inheritedEnvironment: process.env,
      commandEnvironment: input.command.environment,
      injectedEnvironment: input.injectedEnvironment,
      nodeOptionsForbiddenCode: 'FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN',
      databaseUrlDeclarationForbiddenCode:
        'FORMAL_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN',
    }),
    shell: false,
    windowsHide: true,
  });
  const untrack = input.context?.trackChild(child);
  let forceKill: NodeJS.Timeout | undefined;
  const abort = () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5_000);
      forceKill.unref();
    }
  };
  input.context?.signal.addEventListener('abort', abort, { once: true });
  if (input.context?.signal.aborted === true) abort();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const completion = await new Promise<{
    readonly exitCode: number | null;
    readonly spawnError: Error | null;
  }>((resolveExit) => {
    child.once('error', (error) => resolveExit({ exitCode: null, spawnError: error }));
    child.once('close', (exitCode) => resolveExit({ exitCode, spawnError: null }));
  });
  try {
    await Promise.all([
      writeRedactedTextArtifact(
        input.evidenceDirectory,
        'stdout.log',
        Buffer.concat(stdout).toString('utf8'),
      ),
      writeRedactedTextArtifact(
        input.evidenceDirectory,
        'stderr.log',
        Buffer.concat(stderr).toString('utf8'),
      ),
    ]);
  } finally {
    if (forceKill !== undefined) clearTimeout(forceKill);
    input.context?.signal.removeEventListener('abort', abort);
    untrack?.();
  }
  if (completion.spawnError !== null) throw completion.spawnError;
  input.context?.throwIfAborted();
  return {
    exitCode: completion.exitCode,
    elapsedMilliseconds: Math.round(performance.now() - started),
  };
}

function resolveInsideRepository(repositoryRoot: string, path: string): string {
  const resolved = resolve(repositoryRoot, path);
  const relativePath = relative(repositoryRoot, resolved);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error('ABG_COMMAND_WORKDIR_OUTSIDE_REPOSITORY');
  }
  return resolved;
}
