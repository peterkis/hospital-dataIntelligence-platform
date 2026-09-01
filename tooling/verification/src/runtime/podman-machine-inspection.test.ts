import { describe, expect, it } from 'vitest';
import type {
  RuntimeCommandResult,
  RuntimeCommandRunner,
  RuntimeCommandSpec,
} from './formal-runtime-contract.js';
import {
  assertEquivalentPodmanMachineInspections,
  inspectPodmanMachineState,
} from './podman-machine-inspection.js';
import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.js';

const AUTHORITY = loadPodmanRuntimeAuthority().authority;
const NOW = () => '2026-09-01T12:04:15';

describe('shared Podman Machine inspection', () => {
  it('classifies the sequence 10 native rootful rejection as not applicable', async () => {
    const result = await inspectPodmanMachineState(runner({
      machine: commandResult(125, '', 'Error: cannot run command "podman machine list" as root\n'),
    }), AUTHORITY, NOW);
    expect(result).toMatchObject({
      status: 'NOT_APPLICABLE_NATIVE_ROOTFUL',
      applicability: 'NOT_APPLICABLE',
      nativeRuntime: true,
      rootless: false,
      machineCommandSupported: false,
      registeredMachineCount: 0,
      runningMachineCount: 0,
      remoteConnectionCount: 0,
      failureCode: null,
    });
  });

  it('classifies an empty supported machine list as none registered', async () => {
    await expect(inspect({ machine: commandResult(0, '[]', '') })).resolves.toMatchObject({
      status: 'NONE_REGISTERED',
      machineCommandSupported: true,
    });
  });

  it('fails closed for a stopped registered machine', async () => {
    await expect(inspect({ machine: commandResult(0, '[{"Name":"stopped","Running":false}]', '') }))
      .resolves.toMatchObject({
        status: 'REGISTERED_MACHINE_PRESENT',
        registeredMachineCount: 1,
        runningMachineCount: 0,
      });
  });

  it('fails closed for a running machine', async () => {
    await expect(inspect({ machine: commandResult(0, '[{"Name":"active","Running":true}]', '') }))
      .resolves.toMatchObject({
        status: 'RUNNING_MACHINE_PRESENT',
        registeredMachineCount: 1,
        runningMachineCount: 1,
      });
  });

  it('fails closed for any remote Podman connection', async () => {
    await expect(inspect({
      connections: commandResult(0, '[{"URI":"ssh://remote/run/podman/podman.sock"}]', ''),
    })).resolves.toMatchObject({
      status: 'REMOTE_CONNECTION_PRESENT',
      remoteConnectionCount: 1,
    });
  });

  it('fails closed for malformed machine JSON', async () => {
    await expect(inspect({ machine: commandResult(0, '{broken', '') })).resolves.toMatchObject({
      status: 'INSPECTION_FAILED',
      failureCode: 'PODMAN_MACHINE_RESULT_MALFORMED',
    });
  });

  it.each([
    ['permission denied', commandResult(125, '', 'Error: permission denied\n')],
    ['unknown nonzero exit', commandResult(42, '', 'unexpected failure\n')],
  ] as const)('fails closed for %s', async (_name, machine) => {
    await expect(inspect({ machine })).resolves.toMatchObject({
      status: 'INSPECTION_FAILED',
      failureCode: 'PODMAN_MACHINE_COMMAND_FAILED',
    });
  });

  it('fails closed for a local rootless runtime', async () => {
    await expect(inspect({ rootless: true })).resolves.toMatchObject({
      status: 'INSPECTION_FAILED',
      rootless: true,
      failureCode: 'PODMAN_MACHINE_ROOTLESS_RUNTIME_FORBIDDEN',
    });
  });

  it('gives preflight and cleanup the same classification for the same fixture', async () => {
    const options = { machine: commandResult(0, '[]', '') };
    const preflight = await inspect(options);
    const cleanup = await inspect(options);
    expect(() => assertEquivalentPodmanMachineInspections(preflight, cleanup)).not.toThrow();
  });
});

async function inspect(options: RunnerOptions) {
  return inspectPodmanMachineState(runner(options), AUTHORITY, NOW);
}

interface RunnerOptions {
  readonly rootless?: boolean;
  readonly socketPath?: string;
  readonly connections?: RuntimeCommandResult;
  readonly machine?: RuntimeCommandResult;
}

function runner(options: RunnerOptions = {}): RuntimeCommandRunner {
  return {
    async run(command: RuntimeCommandSpec): Promise<RuntimeCommandResult> {
      if (command.args[0] === 'info') {
        return commandResult(0, JSON.stringify({
          host: {
            remoteSocket: { path: options.socketPath ?? AUTHORITY.podman.socketPath },
            security: { rootless: options.rootless ?? false },
          },
        }), '');
      }
      if (command.args[0] === 'system') {
        return options.connections ?? commandResult(0, '[]', '');
      }
      if (command.args[0] === 'machine') {
        return options.machine ?? commandResult(0, '[]', '');
      }
      throw new Error('UNEXPECTED_COMMAND:' + command.args.join(':'));
    },
  };
}

function commandResult(exitCode: number, stdout: string, stderr: string): RuntimeCommandResult {
  return { exitCode, signal: null, stdout, stderr };
}
