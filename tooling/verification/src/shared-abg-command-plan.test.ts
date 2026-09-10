import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSharedAbgCommandPlanSafety,
  buildSharedAbgCommandPlan,
  type SharedCommand,
} from './shared-abg-command-plan.js';
import { REPOSITORY_NODE_LOADER_PATH } from './runtime/node-command-boundary.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('shared ABG child command plan', () => {
  it('uses explicit loaders only for live and browser TypeScript entries', async () => {
    const commands = await buildSharedAbgCommandPlan(repositoryRoot);
    const live = commands.find((command) => command.id === 'live');
    const browser = commands.find((command) => command.id === 'browser');
    expect(live).toMatchObject({
      executable: 'node',
      args: [
        '--loader',
        REPOSITORY_NODE_LOADER_PATH,
        'tooling/verification/src/verify-phase-01-live.ts',
      ],
      workingDirectory: '.',
    });
    expect(browser).toMatchObject({
      executable: 'node',
      args: [
        '--loader',
        REPOSITORY_NODE_LOADER_PATH,
        'tests/e2e/run-playwright.ts',
      ],
      workingDirectory: '.',
    });
  });

  it('keeps database authority, integration, and ordinary npm commands loader-free', async () => {
    const commands = await buildSharedAbgCommandPlan(repositoryRoot);
    for (const id of [
      'runtime', 'repo-layout', 'module-boundaries', 'database-authority',
      'typecheck', 'build', 'contract-lint', 'integration',
    ]) {
      const command = commands.find((candidate) => candidate.id === id)!;
      expect(command.executable).toBe('npm');
      expect(command.args).not.toContain('--loader');
      expect(command.args.join(' ')).not.toContain('node-ts-loader.mjs');
    }
    expect(commands.find((command) => command.id === 'database-authority')?.args)
      .toEqual(['run', 'check:database-authority']);
    expect(commands.find((command) => command.id === 'integration')?.args.slice(0, 4))
      .toEqual(['exec', '--workspace', '@hospital-data-intelligence/governance-api', '--']);
  });

  it('declares the strict least-privilege runtime binding matrix without values', async () => {
    const commands = await buildSharedAbgCommandPlan(repositoryRoot);
    expect(commands.find((command) => command.id === 'database-authority')
      ?.runtimeEnvironmentBindings).toEqual(['FORMAL_RUNTIME_DATABASE_URL']);
    expect(commands.find((command) => command.id === 'live')
      ?.runtimeEnvironmentBindings).toEqual([
        'FORMAL_RUNTIME_DATABASE_URL',
        'FORMAL_LIVE_RUNTIME',
      ]);
    expect(commands.find((command) => command.id === 'browser')
      ?.runtimeEnvironmentBindings).toEqual(['FORMAL_BROWSER_RUNTIME']);
    for (const id of [
      'runtime', 'repo-layout', 'module-boundaries', 'typecheck', 'build',
      'contract-lint', 'integration',
    ]) {
      expect(commands.find((command) => command.id === id)?.runtimeEnvironmentBindings)
        .toBeUndefined();
    }
    expect(JSON.stringify(commands)).not.toContain('postgresql://');
    expect(JSON.stringify(commands)).not.toContain('HDI_POSTGRES_PASSWORD');
  });

  it('fails closed for NODE_OPTIONS leakage and loader contamination', async () => {
    const commands = await mutableCommands();
    const databaseIndex = commands.findIndex((command) => command.id === 'database-authority');
    commands[databaseIndex] = {
      ...commands[databaseIndex]!,
      environment: { NODE_OPTIONS: '--loader=relative-loader.mjs' },
    };
    await expect(assertSharedAbgCommandPlanSafety(repositoryRoot, commands))
      .rejects.toThrow('SHARED_COMMAND_NODE_OPTIONS_FORBIDDEN');

    const contaminated = await mutableCommands();
    const integrationIndex = contaminated.findIndex((command) => command.id === 'integration');
    contaminated[integrationIndex] = {
      ...contaminated[integrationIndex]!,
      args: [...contaminated[integrationIndex]!.args, '--loader', REPOSITORY_NODE_LOADER_PATH],
    };
    await expect(assertSharedAbgCommandPlanSafety(repositoryRoot, contaminated))
      .rejects.toThrow('SHARED_COMMAND_NODE_LOADER_CONTAMINATION');
  });

  it('rejects a TypeScript entry without the explicit loader', async () => {
    const commands = await mutableCommands();
    const liveIndex = commands.findIndex((command) => command.id === 'live');
    commands[liveIndex] = {
      ...commands[liveIndex]!,
      args: ['tooling/verification/src/verify-phase-01-live.ts'],
    };
    await expect(assertSharedAbgCommandPlanSafety(repositoryRoot, commands))
      .rejects.toThrow('REPOSITORY_TYPESCRIPT_ENTRY_WITHOUT_EXPLICIT_LOADER');
  });

  it('fails closed for direct, duplicate, and unauthorized database bindings', async () => {
    const direct = await mutableCommands();
    direct[0] = { ...direct[0]!, environment: { Database_Url: 'forbidden' } };
    await expect(assertSharedAbgCommandPlanSafety(repositoryRoot, direct))
      .rejects.toThrow('SHARED_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN');

    const duplicate = await mutableCommands();
    const databaseIndex = duplicate.findIndex((command) => command.id === 'database-authority');
    duplicate[databaseIndex] = {
      ...duplicate[databaseIndex]!,
      runtimeEnvironmentBindings: [
        'FORMAL_RUNTIME_DATABASE_URL',
        'FORMAL_RUNTIME_DATABASE_URL',
      ],
    };
    await expect(assertSharedAbgCommandPlanSafety(repositoryRoot, duplicate))
      .rejects.toThrow('SHARED_RUNTIME_ENVIRONMENT_BINDING_DUPLICATE');

    const unauthorized = await mutableCommands();
    const integrationIndex = unauthorized.findIndex((command) => command.id === 'integration');
    unauthorized[integrationIndex] = {
      ...unauthorized[integrationIndex]!,
      runtimeEnvironmentBindings: ['FORMAL_RUNTIME_DATABASE_URL'],
    };
    await expect(assertSharedAbgCommandPlanSafety(repositoryRoot, unauthorized))
      .rejects.toThrow('SHARED_RUNTIME_DATABASE_BINDING_UNAUTHORIZED');
  });
});

async function mutableCommands(): Promise<SharedCommand[]> {
  return [...await buildSharedAbgCommandPlan(repositoryRoot)];
}
