import type { RuntimeCommandRunner } from './formal-runtime-contract.js';
import { localNowInAsiaShanghai } from './formal-runtime-contract.js';
import type { PodmanRuntimeAuthority } from './podman-runtime-authority-schema.js';

export const PODMAN_MACHINE_INSPECTION_STATUSES = [
  'NOT_APPLICABLE_NATIVE_ROOTFUL',
  'NONE_REGISTERED',
  'REGISTERED_MACHINE_PRESENT',
  'RUNNING_MACHINE_PRESENT',
  'REMOTE_CONNECTION_PRESENT',
  'INSPECTION_FAILED',
] as const;

export type PodmanMachineInspectionStatus =
  (typeof PODMAN_MACHINE_INSPECTION_STATUSES)[number];

export interface PodmanMachineInspectionResult {
  readonly status: PodmanMachineInspectionStatus;
  readonly applicability: 'NOT_APPLICABLE' | 'APPLICABLE' | 'UNKNOWN';
  readonly nativeRuntime: boolean | null;
  readonly rootless: boolean | null;
  readonly runtimeSocketPath: string | null;
  readonly machineCommandSupported: boolean | null;
  readonly registeredMachineCount: number;
  readonly runningMachineCount: number;
  readonly remoteConnectionCount: number;
  readonly registeredMachines: readonly string[];
  readonly runningMachines: readonly string[];
  readonly remoteConnections: readonly string[];
  readonly failureCode: string | null;
  readonly observedAt: string;
}

export async function inspectPodmanMachineState(
  runner: RuntimeCommandRunner,
  authority: PodmanRuntimeAuthority,
  now: () => string = localNowInAsiaShanghai,
): Promise<PodmanMachineInspectionResult> {
  const observedAt = now();
  const info = await inspectNativeRuntimeFacts(runner);
  if (!info.ok) return failedInspection(
    observedAt,
    info.failureCode,
    undefined,
    [],
    null,
    authority.podman.socketPath,
  );
  const nativeRuntime =
    info.rootless === false && info.socketPath === authority.podman.socketPath;
  if (info.rootless !== authority.podman.rootless || !nativeRuntime) {
    return failedInspection(
      observedAt,
      info.rootless === true
        ? 'PODMAN_MACHINE_ROOTLESS_RUNTIME_FORBIDDEN'
        : 'PODMAN_MACHINE_NATIVE_RUNTIME_UNRESOLVED',
      info,
      [],
      null,
      authority.podman.socketPath,
    );
  }

  const connections = await inspectPodmanConnections(runner, authority.podman.socketPath);
  if (!connections.ok) {
    return failedInspection(
      observedAt,
      connections.failureCode,
      info,
      [],
      null,
      authority.podman.socketPath,
    );
  }
  if (connections.values.length > 0) {
    return {
      status: 'REMOTE_CONNECTION_PRESENT',
      applicability: 'APPLICABLE',
      nativeRuntime: true,
      rootless: false,
      runtimeSocketPath: info.socketPath,
      machineCommandSupported: null,
      registeredMachineCount: 0,
      runningMachineCount: 0,
      remoteConnectionCount: connections.values.length,
      registeredMachines: [],
      runningMachines: [],
      remoteConnections: connections.values,
      failureCode: null,
      observedAt,
    };
  }

  let machineResult: Awaited<ReturnType<RuntimeCommandRunner['run']>>;
  try {
    machineResult = await runner.run({
      executable: 'podman',
      args: ['machine', 'list', '--format', 'json'],
    });
  } catch {
    return failedInspection(
      observedAt,
      'PODMAN_MACHINE_COMMAND_FAILED',
      info,
      connections.values,
      null,
      authority.podman.socketPath,
    );
  }

  if (machineResult.exitCode !== 0) {
    if (
      machineResult.exitCode === 125 &&
      machineResult.signal === null &&
      machineResult.stdout.trim().length === 0 &&
      nativeRuntime &&
      authority.podman.rootless === false &&
      isNativeRootfulMachineUnsupported(machineResult.stderr)
    ) {
      return {
        status: 'NOT_APPLICABLE_NATIVE_ROOTFUL',
        applicability: 'NOT_APPLICABLE',
        nativeRuntime: true,
        rootless: false,
        runtimeSocketPath: info.socketPath,
        machineCommandSupported: false,
        registeredMachineCount: 0,
        runningMachineCount: 0,
        remoteConnectionCount: 0,
        registeredMachines: [],
        runningMachines: [],
        remoteConnections: [],
        failureCode: null,
        observedAt,
      };
    }
    return failedInspection(
      observedAt,
      'PODMAN_MACHINE_COMMAND_FAILED',
      info,
      connections.values,
      null,
      authority.podman.socketPath,
    );
  }

  const machines = parseMachineList(machineResult.stdout);
  if (!machines.ok) {
    return failedInspection(
      observedAt,
      machines.failureCode,
      info,
      connections.values,
      true,
      authority.podman.socketPath,
    );
  }
  const registeredMachines = machines.values.map((machine) => machine.name);
  const runningMachines = machines.values.filter((machine) => machine.running)
    .map((machine) => machine.name);
  const status: PodmanMachineInspectionStatus = runningMachines.length > 0
      ? 'RUNNING_MACHINE_PRESENT'
      : registeredMachines.length > 0
        ? 'REGISTERED_MACHINE_PRESENT'
        : 'NONE_REGISTERED';
  return {
    status,
    applicability: 'APPLICABLE',
    nativeRuntime: true,
    rootless: false,
    runtimeSocketPath: info.socketPath,
    machineCommandSupported: true,
    registeredMachineCount: registeredMachines.length,
    runningMachineCount: runningMachines.length,
    remoteConnectionCount: connections.values.length,
    registeredMachines,
    runningMachines,
    remoteConnections: connections.values,
    failureCode: null,
    observedAt,
  };
}

export function assertPodmanMachineInspectionConsistent(
  result: PodmanMachineInspectionResult,
): void {
  const expectedStatus: PodmanMachineInspectionStatus = result.failureCode !== null
    ? 'INSPECTION_FAILED'
    : result.remoteConnectionCount > 0
      ? 'REMOTE_CONNECTION_PRESENT'
      : result.runningMachineCount > 0
        ? 'RUNNING_MACHINE_PRESENT'
        : result.registeredMachineCount > 0
          ? 'REGISTERED_MACHINE_PRESENT'
          : result.machineCommandSupported === false && result.nativeRuntime === true &&
              result.rootless === false
            ? 'NOT_APPLICABLE_NATIVE_ROOTFUL'
            : 'NONE_REGISTERED';
  if (result.status !== expectedStatus) {
    throw new Error('PODMAN_MACHINE_CLASSIFICATION_INCONSISTENT');
  }
  if (
    result.registeredMachineCount !== result.registeredMachines.length ||
    result.runningMachineCount !== result.runningMachines.length ||
    result.remoteConnectionCount !== result.remoteConnections.length ||
    result.runningMachineCount > result.registeredMachineCount
  ) throw new Error('PODMAN_MACHINE_CLASSIFICATION_INCONSISTENT');
}

export function assertEquivalentPodmanMachineInspections(
  preflight: PodmanMachineInspectionResult,
  cleanup: PodmanMachineInspectionResult,
): void {
  const identity = (value: PodmanMachineInspectionResult) => JSON.stringify({
    status: value.status,
    applicability: value.applicability,
    nativeRuntime: value.nativeRuntime,
    rootless: value.rootless,
    runtimeSocketPath: value.runtimeSocketPath,
    machineCommandSupported: value.machineCommandSupported,
    registeredMachineCount: value.registeredMachineCount,
    runningMachineCount: value.runningMachineCount,
    remoteConnectionCount: value.remoteConnectionCount,
    registeredMachines: value.registeredMachines,
    runningMachines: value.runningMachines,
    remoteConnections: value.remoteConnections,
    failureCode: value.failureCode,
  });
  if (identity(preflight) !== identity(cleanup)) {
    throw new Error('PREFLIGHT_CLEANUP_MACHINE_CLASSIFICATION_DRIFT');
  }
}

function isNativeRootfulMachineUnsupported(stderr: string): boolean {
  return stderr.trim() === 'Error: cannot run command "podman machine list" as root';
}

async function inspectNativeRuntimeFacts(runner: RuntimeCommandRunner): Promise<
  | { readonly ok: true; readonly socketPath: string; readonly rootless: boolean }
  | { readonly ok: false; readonly failureCode: string }
> {
  let result: Awaited<ReturnType<RuntimeCommandRunner['run']>>;
  try {
    result = await runner.run({ executable: 'podman', args: ['info', '--format', 'json'] });
  } catch {
    return { ok: false, failureCode: 'PODMAN_MACHINE_RUNTIME_INFO_FAILED' };
  }
  if (result.exitCode !== 0) {
    return { ok: false, failureCode: 'PODMAN_MACHINE_RUNTIME_INFO_FAILED' };
  }
  try {
    const value = JSON.parse(result.stdout) as unknown;
    if (!isRecord(value)) throw new Error('INVALID');
    const host = isRecord(value['host']) ? value['host'] : null;
    const socket = host !== null && isRecord(host['remoteSocket']) ? host['remoteSocket'] : null;
    const security = host !== null && isRecord(host['security']) ? host['security'] : null;
    if (
      socket === null || security === null ||
      typeof socket['path'] !== 'string' ||
      typeof security['rootless'] !== 'boolean'
    ) throw new Error('INVALID');
    return { ok: true, socketPath: socket['path'], rootless: security['rootless'] };
  } catch {
    return { ok: false, failureCode: 'PODMAN_MACHINE_RUNTIME_INFO_MALFORMED' };
  }
}

async function inspectPodmanConnections(
  runner: RuntimeCommandRunner,
  socketPath: string,
): Promise<
  | { readonly ok: true; readonly values: readonly string[] }
  | { readonly ok: false; readonly failureCode: string }
> {
  let result: Awaited<ReturnType<RuntimeCommandRunner['run']>>;
  try {
    result = await runner.run({
      executable: 'podman',
      args: ['system', 'connection', 'list', '--format', 'json'],
    });
  } catch {
    return { ok: false, failureCode: 'PODMAN_MACHINE_CONNECTION_INSPECTION_FAILED' };
  }
  if (result.exitCode !== 0) {
    return { ok: false, failureCode: 'PODMAN_MACHINE_CONNECTION_INSPECTION_FAILED' };
  }
  try {
    const values = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(values)) throw new Error('INVALID');
    const allowed = 'unix://' + socketPath;
    const remote = values.flatMap((value) => {
      if (!isRecord(value)) throw new Error('INVALID');
      const uri = value['URI'] ?? value['Uri'] ?? value['uri'];
      if (typeof uri !== 'string' || uri.length === 0) throw new Error('INVALID');
      return uri === allowed ? [] : [uri];
    });
    return { ok: true, values: [...new Set(remote)].sort() };
  } catch {
    return { ok: false, failureCode: 'PODMAN_MACHINE_CONNECTION_RESULT_MALFORMED' };
  }
}

function parseMachineList(stdout: string):
  | { readonly ok: true; readonly values: readonly { readonly name: string; readonly running: boolean }[] }
  | { readonly ok: false; readonly failureCode: string } {
  try {
    const values = JSON.parse(stdout) as unknown;
    if (!Array.isArray(values)) throw new Error('INVALID');
    const machines = values.map((value) => {
      if (!isRecord(value)) throw new Error('INVALID');
      const name = value['Name'] ?? value['name'];
      if (typeof name !== 'string' || name.length === 0) throw new Error('INVALID');
      const runningValue = value['Running'] ?? value['running'];
      const stateValue = value['State'] ?? value['state'];
      const running = typeof runningValue === 'boolean'
        ? runningValue
        : typeof stateValue === 'string'
          ? stateValue.toLowerCase() === 'running'
          : false;
      return { name, running };
    });
    return { ok: true, values: machines };
  } catch {
    return { ok: false, failureCode: 'PODMAN_MACHINE_RESULT_MALFORMED' };
  }
}

function failedInspection(
  observedAt: string,
  failureCode: string,
  info?: { readonly socketPath: string; readonly rootless: boolean },
  remoteConnections: readonly string[] = [],
  machineCommandSupported: boolean | null = null,
  expectedSocketPath?: string,
): PodmanMachineInspectionResult {
  return {
    status: 'INSPECTION_FAILED',
    applicability: 'UNKNOWN',
    nativeRuntime: info === undefined
      ? null
      : info.rootless === false && info.socketPath === expectedSocketPath,
    rootless: info?.rootless ?? null,
    runtimeSocketPath: info?.socketPath ?? null,
    machineCommandSupported,
    registeredMachineCount: 0,
    runningMachineCount: 0,
    remoteConnectionCount: remoteConnections.length,
    registeredMachines: [],
    runningMachines: [],
    remoteConnections,
    failureCode,
    observedAt,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
