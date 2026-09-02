import {
  assertCommandEnvironmentDoesNotDeclareNodeOptions,
  assertRepositoryTypeScriptCommand,
  commandContainsRepositoryLoader,
  repositoryTypeScriptCommand,
  type RepositoryCommandSpec,
} from './runtime/node-command-boundary.js';
import type { AbgProducerId } from './abg-coverage-matrix.js';

export interface SharedCommand extends RepositoryCommandSpec {
  readonly id: string;
  readonly producerIds: readonly AbgProducerId[];
  readonly workingDirectory: '.';
}

export async function buildSharedAbgCommandPlan(
  repositoryRoot: string,
): Promise<readonly SharedCommand[]> {
  const [live, browser] = await Promise.all([
    repositoryTypeScriptCommand(
      repositoryRoot,
      'tooling/verification/src/verify-phase-01-live.ts',
    ),
    repositoryTypeScriptCommand(repositoryRoot, 'tests/e2e/run-playwright.ts'),
  ]);
  const commands: readonly SharedCommand[] = [
    command('runtime', ['static'], 'npm', ['run', 'check:runtime']),
    command('repo-layout', ['static'], 'npm', ['run', 'check:repo:layout']),
    command('module-boundaries', ['static'], 'npm', ['run', 'check:module-boundaries']),
    command('database-authority', ['database'], 'npm', ['run', 'check:database-authority']),
    command('typecheck', ['static'], 'npm', ['run', 'typecheck']),
    command('build', ['static'], 'npm', ['run', 'build']),
    command('contract-lint', ['static'], 'npm', ['run', 'contract:lint']),
    command('integration', ['database', 'integration', 'fault', 'consumer', 'capacity'], 'npm', [
      'exec', '--workspace', '@hospital-data-intelligence/governance-api', '--',
      'vitest', 'run', 'src/composition/phase-01-vertical-slice.integration.test.ts',
      '--reporter=json',
    ]),
    { id: 'live', producerIds: ['live'], ...live, workingDirectory: '.' },
    { id: 'browser', producerIds: ['browser'], ...browser, workingDirectory: '.' },
  ];
  await assertSharedAbgCommandPlanSafety(repositoryRoot, commands);
  return Object.freeze(commands.map((entry) => Object.freeze(entry)));
}

export async function assertSharedAbgCommandPlanSafety(
  repositoryRoot: string,
  commands: readonly SharedCommand[],
): Promise<void> {
  const expectedIds = [
    'runtime',
    'repo-layout',
    'module-boundaries',
    'database-authority',
    'typecheck',
    'build',
    'contract-lint',
    'integration',
    'live',
    'browser',
  ];
  if (commands.map((entry) => entry.id).join('\0') !== expectedIds.join('\0')) {
    throw new Error('SHARED_COMMAND_PLAN_INVALID');
  }
  for (const command of commands) {
    assertCommandEnvironmentDoesNotDeclareNodeOptions(
      command.environment,
      'SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN',
    );
    if (command.workingDirectory !== '.') {
      throw new Error('SHARED_COMMAND_WORKING_DIRECTORY_INVALID');
    }
    if (command.id === 'live' || command.id === 'browser') {
      await assertRepositoryTypeScriptCommand(repositoryRoot, command);
    } else if (commandContainsRepositoryLoader(command)) {
      throw new Error('SHARED_COMMAND_NODE_LOADER_CONTAMINATION');
    }
  }
}

function command(
  id: string,
  producerIds: readonly AbgProducerId[],
  executable: string,
  args: readonly string[],
): SharedCommand {
  return { id, producerIds, executable, args, workingDirectory: '.' };
}
