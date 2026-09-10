import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertAuthoritativeCommandPlanSafety,
  authoritativeCommandDigest,
  buildAuthoritativeCommandPlan,
  type AuthoritativeCommandPlan,
} from './authoritative-abg-plan.js';
import { REPOSITORY_NODE_LOADER_PATH } from './runtime/node-command-boundary.js';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('authoritative ABG command plan loader boundary', () => {
  it('uses one explicit loader model for setup 03 and all 40 gate producers', async () => {
    const plan = await buildAuthoritativeCommandPlan(repositoryRoot);
    expect(plan.setupCommands).toHaveLength(3);
    expect(plan.gates).toHaveLength(40);
    expect(plan.setupCommands[2]).toEqual({
      executable: 'node',
      args: [
        '--loader',
        REPOSITORY_NODE_LOADER_PATH,
        'tooling/verification/src/run-shared-abg-verification.ts',
      ],
      workingDirectory: '.',
    });
    for (const gate of plan.gates) {
      expect(gate).toMatchObject({
        executable: 'node',
        args: [
          '--loader',
          REPOSITORY_NODE_LOADER_PATH,
          'tooling/verification/src/produce-abg-gate.ts',
        ],
        workingDirectory: '.',
      });
    }
    expect(JSON.stringify(plan)).not.toContain('NODE_OPTIONS');
    expect(JSON.stringify(plan)).not.toContain('DATABASE_URL');
    expect(JSON.stringify(plan)).not.toContain('postgresql://');
    expect(JSON.stringify(plan)).not.toMatch(/(?:\/mnt\/[a-z]\/|[A-Za-z]:\\)/u);
  });

  it('binds loader argv and workingDirectory into the command digest', async () => {
    const command = (await buildAuthoritativeCommandPlan(repositoryRoot)).setupCommands[2]!;
    const digest = authoritativeCommandDigest(command);
    expect(authoritativeCommandDigest({
      ...command,
      args: [...command.args.slice(0, 1), 'different-loader.mjs', ...command.args.slice(2)],
    })).not.toBe(digest);
    expect(authoritativeCommandDigest({ ...command, workingDirectory: 'tooling/verification' }))
      .not.toBe(digest);
  });

  it('fails closed for command-declared NODE_OPTIONS', async () => {
    const plan = await mutablePlan();
    plan.setupCommands[2] = {
      ...plan.setupCommands[2]!,
      environment: { NODE_OPTIONS: '--loader=relative-loader.mjs' },
    };
    await expect(assertAuthoritativeCommandPlanSafety(repositoryRoot, plan))
      .rejects.toThrow('FORMAL_COMMAND_NODE_OPTIONS_FORBIDDEN');
  });

  it('fails closed for command-declared DATABASE_URL in any casing', async () => {
    const plan = await mutablePlan();
    plan.setupCommands[0] = {
      ...plan.setupCommands[0]!,
      environment: { Database_Url: 'postgresql://forbidden' },
    };
    await expect(assertAuthoritativeCommandPlanSafety(repositoryRoot, plan))
      .rejects.toThrow('FORMAL_COMMAND_DATABASE_URL_DECLARATION_FORBIDDEN');
  });

  it('rejects loader drift and a script path escape', async () => {
    const loaderDrift = await mutablePlan();
    loaderDrift.gates[0] = {
      ...loaderDrift.gates[0]!,
      args: ['--loader', '/mnt/d/host/node-ts-loader.mjs', loaderDrift.gates[0]!.args[2]!],
    };
    await expect(assertAuthoritativeCommandPlanSafety(repositoryRoot, loaderDrift))
      .rejects.toThrow('REPOSITORY_NODE_LOADER_PATH_INVALID');

    const scriptEscape = await mutablePlan();
    scriptEscape.gates[0] = {
      ...scriptEscape.gates[0]!,
      args: ['--loader', REPOSITORY_NODE_LOADER_PATH, '../produce-abg-gate.ts'],
    };
    await expect(assertAuthoritativeCommandPlanSafety(repositoryRoot, scriptEscape))
      .rejects.toThrow('REPOSITORY_TYPESCRIPT_ENTRY_PATH_INVALID');
  });
});

async function mutablePlan(): Promise<{
  setupCommands: Array<AuthoritativeCommandPlan['setupCommands'][number]>;
  gates: Array<AuthoritativeCommandPlan['gates'][number]>;
}> {
  const plan = await buildAuthoritativeCommandPlan(repositoryRoot);
  return { setupCommands: [...plan.setupCommands], gates: [...plan.gates] };
}
