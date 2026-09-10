import {
  assertCommandEnvironmentDoesNotDeclareDatabaseUrl,
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
  readonly runtimeEnvironmentBindings?: readonly SharedRuntimeEnvironmentBinding[];
}

export const SHARED_RUNTIME_ENVIRONMENT_BINDINGS = Object.freeze([
  'FORMAL_RUNTIME_DATABASE_URL',
  'FORMAL_LIVE_RUNTIME',
  'FORMAL_BROWSER_RUNTIME',
] as const);

export type SharedRuntimeEnvironmentBinding =
  (typeof SHARED_RUNTIME_ENVIRONMENT_BINDINGS)[number];

export const SHARED_RUNTIME_ENVIRONMENT_BINDING_MATRIX = Object.freeze({
  'database-authority': Object.freeze(['FORMAL_RUNTIME_DATABASE_URL'] as const),
  live: Object.freeze([
    'FORMAL_RUNTIME_DATABASE_URL',
    'FORMAL_LIVE_RUNTIME',
  ] as const),
  browser: Object.freeze(['FORMAL_BROWSER_RUNTIME'] as const),
}) satisfies Readonly<Record<string, readonly SharedRuntimeEnvironmentBinding[]>>;

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
    command(
      'database-authority',
      ['database'],
      'npm',
      ['run', 'check:database-authority'],
      ['FORMAL_RUNTIME_DATABASE_URL'],
    ),
    command('typecheck', ['static'], 'npm', ['run', 'typecheck']),
    command('build', ['static'], 'npm', ['run', 'build']),
    command('contract-lint', ['static'], 'npm', ['run', 'contract:lint']),
    command('integration', ['database', 'integration', 'fault', 'consumer', 'capacity'], 'npm', [
      'exec', '--workspace', '@hospital-data-intelligence/governance-api', '--',
      'vitest', 'run', 'src/composition/phase-01-vertical-slice.integration.test.ts',
      '--reporter=json',
    ]),
    {
      id: 'live',
      producerIds: ['live'],
      ...live,
      workingDirectory: '.',
      runtimeEnvironmentBindings: [
        'FORMAL_RUNTIME_DATABASE_URL',
        'FORMAL_LIVE_RUNTIME',
      ],
    },
    {
      id: 'browser',
      producerIds: ['browser'],
      ...browser,
      workingDirectory: '.',
      runtimeEnvironmentBindings: ['FORMAL_BROWSER_RUNTIME'],
    },
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
    assertCommandEnvironmentDoesNotDeclareDatabaseUrl(
      command.environment,
      'SHARED_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN',
    );
    assertSharedRuntimeEnvironmentBindingDeclaration(command);
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

export function assertSharedRuntimeEnvironmentBindingDeclaration(
  command: SharedCommand,
): void {
  const bindings = command.runtimeEnvironmentBindings ?? [];
  if (new Set(bindings).size !== bindings.length) {
    throw new Error('SHARED_RUNTIME_ENVIRONMENT_BINDING_DUPLICATE');
  }
  if (bindings.some((binding) =>
    !(SHARED_RUNTIME_ENVIRONMENT_BINDINGS as readonly string[]).includes(binding))) {
    throw new Error('SHARED_RUNTIME_ENVIRONMENT_BINDING_UNREGISTERED');
  }
  const matrix: Readonly<Record<string, readonly SharedRuntimeEnvironmentBinding[]>> =
    SHARED_RUNTIME_ENVIRONMENT_BINDING_MATRIX;
  const allowed = matrix[command.id] ?? [];
  if (
    bindings.length !== allowed.length ||
    bindings.some((binding, index) => binding !== allowed[index])
  ) {
    throw new Error(
      bindings.includes('FORMAL_RUNTIME_DATABASE_URL')
        ? 'SHARED_RUNTIME_DATABASE_BINDING_UNAUTHORIZED'
        : 'SHARED_RUNTIME_ENVIRONMENT_BINDING_UNAUTHORIZED',
    );
  }
}

function command(
  id: string,
  producerIds: readonly AbgProducerId[],
  executable: string,
  args: readonly string[],
  runtimeEnvironmentBindings?: readonly SharedRuntimeEnvironmentBinding[],
): SharedCommand {
  return {
    id,
    producerIds,
    executable,
    args,
    workingDirectory: '.',
    ...(runtimeEnvironmentBindings === undefined ? {} : { runtimeEnvironmentBindings }),
  };
}
