import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, statfs } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrozenInputs } from '../frozen-inputs.ts';
import {
  FORMAL_REPOSITORY_LABEL,
  FORMAL_REQUIRED_SECRET_NAMES,
  FORMAL_RUNTIME_PORTS,
  SpawnRuntimeCommandRunner,
  createFormalRunSeed,
  errorMessage,
  localNowInAsiaShanghai,
  type FormalRunIdentity,
  type FormalRunSeed,
  type RuntimeCommandRunner,
} from './formal-runtime-contract.ts';
import {
  inspectWslHost,
  wslConfigurationMatchesFrozenEnvelope,
  type WslHostEvidence,
} from './formal-wsl-host.ts';
import { FROZEN_WSL_ENVELOPE } from './formal-wsl-envelope.ts';

const EXPECTED_IMAGE_REFERENCES = [
  'docker.io/library/postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382',
  'quay.io/keycloak/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13',
] as const;
const EXPECTED_PODMAN_VERSION = '4.9.4-rhel';
const EXPECTED_PODMAN_SOCKET = '/run/podman/podman.sock';
const EXPECTED_PODMAN_GRAPH_ROOT = '/var/lib/containers/storage';

type PreflightStatus = 'PASSED' | 'FAILED';

export interface FormalPreflightCheck {
  readonly id: string;
  readonly category: 'git' | 'node-npm' | 'wsl' | 'podman' | 'port' | 'secrets';
  readonly status: PreflightStatus;
  readonly errorCode: string | null;
  readonly observed: unknown;
}

export interface SecretPresenceObservation {
  readonly name: (typeof FORMAL_REQUIRED_SECRET_NAMES)[number];
  readonly present: boolean;
  readonly safeLengthRange?: '<16' | '16-31' | '32-63' | '64+';
}

export interface PodmanResourceObservation {
  readonly type: 'container' | 'volume' | 'network';
  readonly id: string;
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly imageReference?: string;
  readonly state?: string;
  readonly ports?: string;
}

export interface PodmanImageObservation {
  readonly reference: string;
  readonly present: boolean;
  readonly imageId: string | null;
  readonly repoDigests: readonly string[];
}

export interface PodmanPreflightObservation {
  readonly podmanVersion: string;
  readonly graphDriverName: string;
  readonly graphRoot: string;
  readonly networkBackend: string;
  readonly logDriver: string;
  readonly ociRuntimeName: string;
  readonly socketPath: string;
  readonly socketActive: boolean;
  readonly rootless: boolean;
  readonly images: readonly PodmanImageObservation[];
  readonly repositoryResources: readonly PodmanResourceObservation[];
}

export interface PortObservation {
  readonly port: number;
  readonly occupied: boolean;
  readonly verificationError: string | null;
}

export interface DiskObservation {
  readonly totalBytes: number;
  readonly availableBytes: number;
}

export interface FormalPreflightReport {
  readonly schemaVersion: 'phase-01.formal-preflight.v1';
  readonly status: PreflightStatus;
  readonly runIdentity: FormalRunIdentity;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly timezone: 'Asia/Shanghai';
  readonly checks: readonly FormalPreflightCheck[];
  readonly secrets: readonly SecretPresenceObservation[];
}

export interface FormalPreflightFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  sha256(path: string): Promise<string>;
  disk(path: string): Promise<DiskObservation>;
}

export interface FormalPreflightContainerRuntimeAdapter {
  inspect(): Promise<PodmanPreflightObservation>;
}

export interface FormalPreflightPortAdapter {
  inspect(ports: readonly number[]): Promise<readonly PortObservation[]>;
}

export interface FormalPreflightHostAdapter {
  inspect(): Promise<WslHostEvidence>;
}

export interface FormalPreflightDependencies {
  readonly commandRunner: RuntimeCommandRunner;
  readonly fileSystem: FormalPreflightFileSystem;
  readonly containerRuntime: FormalPreflightContainerRuntimeAdapter;
  readonly ports: FormalPreflightPortAdapter;
  readonly host: FormalPreflightHostAdapter;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly nodeVersion: string;
  readonly readFrozenInputs: (
    repositoryRoot: string,
    producerSourceManifestSha256: string,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly now: () => string;
}

export function createDefaultFormalPreflightDependencies(): FormalPreflightDependencies {
  const commandRunner = new SpawnRuntimeCommandRunner();
  return {
    commandRunner,
    fileSystem: new NodePreflightFileSystem(),
    containerRuntime: new PodmanCliPreflightAdapter(commandRunner),
    ports: new BindPreflightPortAdapter(),
    host: new WindowsWslHostAdapter(commandRunner),
    environment: process.env,
    nodeVersion: process.version,
    readFrozenInputs,
    now: localNowInAsiaShanghai,
  };
}

export async function runFormalPreflight(
  input: {
    readonly repositoryRoot: string;
    readonly outputDirectory: string;
    readonly run: FormalRunSeed;
    readonly producerSourceManifestSha256: string;
  },
  dependencies: FormalPreflightDependencies = createDefaultFormalPreflightDependencies(),
): Promise<FormalPreflightReport> {
  const startedAt = dependencies.now();
  const checks: FormalPreflightCheck[] = [];
  let gitCommitSha: string | null = null;

  const gitStatus = await runText(dependencies.commandRunner, input.repositoryRoot, 'git', [
    'status', '--porcelain=v1',
  ]);
  if (gitStatus.ok && gitStatus.value.trim().length === 0) {
    checks.push(passed('git-worktree-clean', 'git', { clean: true }));
  } else {
    checks.push(failed(
      'git-worktree-clean',
      'git',
      gitStatus.ok ? 'FORMAL_PREFLIGHT_GIT_WORKTREE_DIRTY' : 'FORMAL_PREFLIGHT_GIT_STATUS_UNAVAILABLE',
      { clean: false },
    ));
  }

  const head = await runText(dependencies.commandRunner, input.repositoryRoot, 'git', [
    'rev-parse', 'HEAD',
  ]);
  if (head.ok && /^[0-9a-f]{40}$/u.test(head.value.trim())) {
    gitCommitSha = head.value.trim();
    checks.push(passed('git-head', 'git', { gitCommitSha }));
  } else {
    checks.push(failed('git-head', 'git', 'FORMAL_PREFLIGHT_GIT_HEAD_UNRESOLVED', {
      resolved: false,
    }));
  }

  const branch = await runText(dependencies.commandRunner, input.repositoryRoot, 'git', [
    'branch', '--show-current',
  ]);
  if (branch.ok && branch.value.trim().length > 0) {
    checks.push(passed('git-branch', 'git', { branch: branch.value.trim() }));
  } else {
    checks.push(failed('git-branch', 'git', 'FORMAL_PREFLIGHT_GIT_BRANCH_UNRESOLVED', {
      resolved: false,
    }));
  }

  try {
    const frozenInputs = await dependencies.readFrozenInputs(
      input.repositoryRoot,
      input.producerSourceManifestSha256,
    );
    checks.push(passed('git-frozen-inputs-readable', 'git', {
      readable: true,
      inputNames: Object.keys(frozenInputs).sort(),
      inputs: frozenInputs,
    }));
  } catch (error) {
    checks.push(failed('git-frozen-inputs-readable', 'git', 'FORMAL_PREFLIGHT_FROZEN_INPUT_UNREADABLE', {
      readable: false,
      errorCode: stableObservedError(error),
    }));
  }

  try {
    const exists = await dependencies.fileSystem.exists(input.outputDirectory);
    checks.push(exists
      ? failed('git-output-directory-absent', 'git', 'FORMAL_PREFLIGHT_OUTPUT_ALREADY_EXISTS', {
        outputDirectoryExists: true,
      })
      : passed('git-output-directory-absent', 'git', { outputDirectoryExists: false }));
  } catch (error) {
    checks.push(failed('git-output-directory-absent', 'git', 'FORMAL_PREFLIGHT_OUTPUT_CHECK_UNAVAILABLE', {
      errorCode: stableObservedError(error),
    }));
  }

  await appendNodeAndNpmChecks(input.repositoryRoot, checks, dependencies);
  await appendWslChecks(checks, dependencies);
  const podmanObservation = await appendPodmanChecks(checks, dependencies);
  await appendPortChecks(checks, dependencies, podmanObservation?.repositoryResources ?? []);
  const secrets = appendSecretChecks(checks, dependencies.environment);

  return {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: checks.every((check) => check.status === 'PASSED') ? 'PASSED' : 'FAILED',
    runIdentity: { ...input.run, gitCommitSha },
    startedAt,
    completedAt: dependencies.now(),
    timezone: 'Asia/Shanghai',
    checks,
    secrets,
  };
}

async function appendNodeAndNpmChecks(
  repositoryRoot: string,
  checks: FormalPreflightCheck[],
  dependencies: FormalPreflightDependencies,
): Promise<void> {
  let packageJson: {
    readonly engines?: { readonly node?: string; readonly npm?: string };
  } | undefined;
  try {
    packageJson = JSON.parse(
      await dependencies.fileSystem.readText(resolve(repositoryRoot, 'package.json')),
    ) as typeof packageJson;
  } catch (error) {
    checks.push(failed('node-package-engines', 'node-npm', 'FORMAL_PREFLIGHT_PACKAGE_JSON_UNREADABLE', {
      errorCode: stableObservedError(error),
    }));
  }
  const expectedNode = packageJson?.engines?.node;
  const actualNode = dependencies.nodeVersion.replace(/^v/u, '');
  checks.push(expectedNode !== undefined && actualNode === expectedNode
    ? passed('node-version', 'node-npm', { expected: expectedNode, actual: actualNode })
    : failed('node-version', 'node-npm', 'FORMAL_PREFLIGHT_NODE_VERSION_MISMATCH', {
      expected: expectedNode ?? null,
      actual: actualNode,
    }));

  const npm = await runText(dependencies.commandRunner, repositoryRoot, 'npm', ['--version']);
  const expectedNpm = packageJson?.engines?.npm;
  checks.push(npm.ok && expectedNpm !== undefined && npm.value.trim() === expectedNpm
    ? passed('npm-version', 'node-npm', { expected: expectedNpm, actual: npm.value.trim() })
    : failed('npm-version', 'node-npm', 'FORMAL_PREFLIGHT_NPM_VERSION_MISMATCH', {
      expected: expectedNpm ?? null,
      actual: npm.ok ? npm.value.trim() : null,
    }));

  const lockfile = resolve(repositoryRoot, 'package-lock.json');
  try {
    if (!(await dependencies.fileSystem.exists(lockfile))) {
      checks.push(failed('npm-lockfile', 'node-npm', 'FORMAL_PREFLIGHT_LOCKFILE_MISSING', {
        present: false,
      }));
      return;
    }
    checks.push(passed('npm-lockfile', 'node-npm', {
      present: true,
      sha256: await dependencies.fileSystem.sha256(lockfile),
      mutationPolicy: 'READ_ONLY',
    }));
  } catch (error) {
    checks.push(failed('npm-lockfile', 'node-npm', 'FORMAL_PREFLIGHT_LOCKFILE_UNREADABLE', {
      errorCode: stableObservedError(error),
    }));
  }
}

async function appendWslChecks(
  checks: FormalPreflightCheck[],
  dependencies: FormalPreflightDependencies,
): Promise<void> {
  const distribution = dependencies.environment['WSL_DISTRO_NAME'];
  checks.push(distribution === FROZEN_WSL_ENVELOPE.distribution
    ? passed('wsl-distribution', 'wsl', { distribution })
    : failed('wsl-distribution', 'wsl', 'FORMAL_PREFLIGHT_WSL_DISTRO_MISMATCH', {
      expected: FROZEN_WSL_ENVELOPE.distribution,
      actual: distribution ?? null,
    }));

  try {
    const release = parseOsRelease(await dependencies.fileSystem.readText('/etc/os-release'));
    checks.push(
      release['ID'] === FROZEN_WSL_ENVELOPE.osId &&
      release['VERSION_ID'] === FROZEN_WSL_ENVELOPE.osVersion
      ? passed('wsl-os-release', 'wsl', { id: release['ID'], versionId: release['VERSION_ID'] })
      : failed('wsl-os-release', 'wsl', 'FORMAL_PREFLIGHT_WSL_OS_RELEASE_MISMATCH', {
        id: release['ID'] ?? null,
        versionId: release['VERSION_ID'] ?? null,
      }));
  } catch (error) {
    checks.push(failed('wsl-os-release', 'wsl', 'FORMAL_PREFLIGHT_WSL_OS_RELEASE_UNAVAILABLE', {
      errorCode: stableObservedError(error),
    }));
  }

  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-architecture', 'wsl',
    'uname', ['-m'], FROZEN_WSL_ENVELOPE.architecture, 'FORMAL_PREFLIGHT_WSL_ARCH_MISMATCH');
  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-pid-one', 'wsl',
    'ps', ['-p', '1', '-o', 'comm='], FROZEN_WSL_ENVELOPE.initProcess,
    'FORMAL_PREFLIGHT_WSL_PID1_NOT_SYSTEMD');
  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-timezone', 'wsl',
    'timedatectl', ['show', '--property=Timezone', '--value'], FROZEN_WSL_ENVELOPE.timezone,
    'FORMAL_PREFLIGHT_WSL_TIMEZONE_MISMATCH');
  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-cpu', 'wsl',
    'nproc', [], String(FROZEN_WSL_ENVELOPE.processorCount),
    'FORMAL_PREFLIGHT_WSL_CPU_MISMATCH');

  try {
    const memory = parseMemInfo(await dependencies.fileSystem.readText('/proc/meminfo'));
    const memoryMatches = Math.abs(memory.memTotalBytes - FROZEN_WSL_ENVELOPE.memoryBytes) <=
      FROZEN_WSL_ENVELOPE.memoryToleranceBytes;
    checks.push(memoryMatches
      ? passed('wsl-memory', 'wsl', {
        expectedBytes: FROZEN_WSL_ENVELOPE.memoryBytes,
        actualBytes: memory.memTotalBytes,
        toleranceBytes: FROZEN_WSL_ENVELOPE.memoryToleranceBytes,
      })
      : failed('wsl-memory', 'wsl', 'FORMAL_PREFLIGHT_WSL_MEMORY_MISMATCH', {
        expectedBytes: FROZEN_WSL_ENVELOPE.memoryBytes,
        actualBytes: memory.memTotalBytes,
        toleranceBytes: FROZEN_WSL_ENVELOPE.memoryToleranceBytes,
      }));
    checks.push(memory.swapTotalBytes === FROZEN_WSL_ENVELOPE.swapBytes
      ? passed('wsl-swap', 'wsl', { swapTotalBytes: FROZEN_WSL_ENVELOPE.swapBytes })
      : failed('wsl-swap', 'wsl', 'FORMAL_PREFLIGHT_WSL_SWAP_NONZERO', {
        swapTotalBytes: memory.swapTotalBytes,
      }));
  } catch (error) {
    checks.push(failed('wsl-memory', 'wsl', 'FORMAL_PREFLIGHT_WSL_MEMORY_UNAVAILABLE', {
      errorCode: stableObservedError(error),
    }));
    checks.push(failed('wsl-swap', 'wsl', 'FORMAL_PREFLIGHT_WSL_SWAP_UNAVAILABLE', {
      errorCode: stableObservedError(error),
    }));
  }

  await appendDiskCheck(checks, dependencies.fileSystem, '/', 'wsl-root-disk', {
    expectedTotalBytes: FROZEN_WSL_ENVELOPE.rootDeviceBytes,
    totalToleranceBytes: FROZEN_WSL_ENVELOPE.rootSizeToleranceBytes,
    minimumAvailableBytes: FROZEN_WSL_ENVELOPE.minimumRootAvailableBytes,
    mismatchCode: 'FORMAL_PREFLIGHT_WSL_ROOT_DISK_UNSAFE',
  });
  await appendDiskCheck(checks, dependencies.fileSystem, '/mnt/d', 'wsl-mnt-d-disk', {
    minimumAvailableBytes: FROZEN_WSL_ENVELOPE.minimumMntDAvailableBytes,
    mismatchCode: 'FORMAL_PREFLIGHT_WSL_MNT_D_DISK_UNSAFE',
  });

  try {
    const host = await dependencies.host.inspect();
    const running = host.runningDistributions;
    checks.push(running.length === 1 && running[0] === FROZEN_WSL_ENVELOPE.distribution
      ? passed('wsl-host-running-distributions', 'wsl', { running })
      : failed(
        'wsl-host-running-distributions',
        'wsl',
        'FORMAL_PREFLIGHT_WSL_RUNNING_SET_MISMATCH',
        { expected: [FROZEN_WSL_ENVELOPE.distribution], running },
      ));
    checks.push(wslConfigurationMatchesFrozenEnvelope(host.configuration)
      ? passed('wsl-host-configuration', 'wsl', host.configuration)
      : failed(
        'wsl-host-configuration',
        'wsl',
        'FORMAL_PREFLIGHT_WSLCONFIG_MISMATCH',
        host.configuration,
      ));
  } catch (error) {
    checks.push(failed(
      'wsl-host-running-distributions',
      'wsl',
      'FORMAL_PREFLIGHT_WSL_HOST_AUDIT_UNAVAILABLE',
      { errorCode: stableObservedError(error) },
    ));
    checks.push(failed(
      'wsl-host-configuration',
      'wsl',
      'FORMAL_PREFLIGHT_WSLCONFIG_AUDIT_UNAVAILABLE',
      { errorCode: stableObservedError(error) },
    ));
  }
}

async function appendPodmanChecks(
  checks: FormalPreflightCheck[],
  dependencies: FormalPreflightDependencies,
): Promise<PodmanPreflightObservation | undefined> {
  try {
    const observation = await dependencies.containerRuntime.inspect();
    const baselineMatches =
      observation.podmanVersion === EXPECTED_PODMAN_VERSION &&
      observation.graphDriverName === 'overlay' &&
      observation.graphRoot === EXPECTED_PODMAN_GRAPH_ROOT &&
      observation.networkBackend === 'cni' &&
      observation.logDriver === 'k8s-file' &&
      observation.ociRuntimeName === 'runc' &&
      observation.socketPath === EXPECTED_PODMAN_SOCKET &&
      observation.socketActive &&
      !observation.rootless;
    checks.push(baselineMatches
      ? passed('podman-runtime', 'podman', observation)
      : failed('podman-runtime', 'podman', 'FORMAL_PREFLIGHT_PODMAN_BASELINE_MISMATCH', {
        expected: {
          podmanVersion: EXPECTED_PODMAN_VERSION,
          graphDriverName: 'overlay',
          graphRoot: EXPECTED_PODMAN_GRAPH_ROOT,
          networkBackend: 'cni',
          logDriver: 'k8s-file',
          ociRuntimeName: 'runc',
          socketPath: EXPECTED_PODMAN_SOCKET,
          socketActive: true,
          rootless: false,
        },
        actual: observation,
      }));
    for (const image of observation.images) {
      checks.push(image.present
        ? passed('podman-image-' + image.reference.split('@', 1)[0], 'podman', image)
        : failed(
          'podman-image-' + image.reference.split('@', 1)[0],
          'podman',
          'FORMAL_PREFLIGHT_PODMAN_IMAGE_MISSING',
          image,
        ));
    }
    checks.push(observation.repositoryResources.length === 0
      ? passed('podman-repository-residue', 'podman', { resources: [] })
      : failed(
        'podman-repository-residue',
        'podman',
        'FORMAL_PREFLIGHT_PODMAN_REPOSITORY_RESIDUE',
        { resources: observation.repositoryResources },
      ));
    const dockerPaths = [
      '/usr/bin/docker',
      '/usr/local/bin/docker',
      '/usr/sbin/docker',
      '/bin/docker',
      '/sbin/docker',
    ];
    const presentDockerPaths: string[] = [];
    for (const path of dockerPaths) {
      if (await dependencies.fileSystem.exists(path)) presentDockerPaths.push(path);
    }
    checks.push(presentDockerPaths.length === 0
      ? passed('podman-docker-cli-absent', 'podman', { paths: [] })
      : failed('podman-docker-cli-absent', 'podman', 'FORMAL_PREFLIGHT_DOCKER_CLI_PRESENT', {
        paths: presentDockerPaths,
      }));
    return observation;
  } catch (error) {
    checks.push(failed('podman-runtime', 'podman', 'FORMAL_PREFLIGHT_PODMAN_UNAVAILABLE', {
      errorCode: stableObservedError(error),
    }));
    return undefined;
  }
}

async function appendPortChecks(
  checks: FormalPreflightCheck[],
  dependencies: FormalPreflightDependencies,
  repositoryResources: readonly PodmanResourceObservation[],
): Promise<void> {
  try {
    const observations = await dependencies.ports.inspect(FORMAL_RUNTIME_PORTS);
    const byPort = new Map(observations.map((observation) => [observation.port, observation]));
    for (const port of FORMAL_RUNTIME_PORTS) {
      const observation = byPort.get(port);
      const matchingResources = repositoryResources.filter((resource) =>
        resource.ports?.includes(String(port)) ?? false,
      );
      if (observation === undefined || observation.verificationError !== null) {
        checks.push(failed('port-' + port, 'port', 'FORMAL_PREFLIGHT_PORT_CHECK_UNAVAILABLE', {
          port,
          verificationError: observation?.verificationError ?? 'MISSING_OBSERVATION',
        }));
      } else if (observation.occupied) {
        checks.push(failed('port-' + port, 'port', 'FORMAL_PREFLIGHT_PORT_OCCUPIED', {
          port,
          repositoryResources: matchingResources,
        }));
      } else {
        checks.push(passed('port-' + port, 'port', { port, occupied: false }));
      }
    }
  } catch (error) {
    for (const port of FORMAL_RUNTIME_PORTS) {
      checks.push(failed('port-' + port, 'port', 'FORMAL_PREFLIGHT_PORT_CHECK_UNAVAILABLE', {
        port,
        errorCode: stableObservedError(error),
      }));
    }
  }
}

function appendSecretChecks(
  checks: FormalPreflightCheck[],
  environment: Readonly<NodeJS.ProcessEnv>,
): readonly SecretPresenceObservation[] {
  const observations = FORMAL_REQUIRED_SECRET_NAMES.map((name): SecretPresenceObservation => {
    const value = environment[name];
    return value === undefined || value.length === 0
      ? { name, present: false }
      : { name, present: true, safeLengthRange: safeLengthRange(value.length) };
  });
  const missing = observations.filter((observation) => !observation.present)
    .map((observation) => observation.name);
  checks.push(missing.length === 0
    ? passed('secrets-presence', 'secrets', { missing: [] })
    : failed('secrets-presence', 'secrets', 'FORMAL_PREFLIGHT_SECRETS_MISSING', { missing }));
  return observations;
}

class NodePreflightFileSystem implements FormalPreflightFileSystem {
  async exists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async readText(path: string): Promise<string> {
    return readFile(path, 'utf8');
  }

  async sha256(path: string): Promise<string> {
    return createHash('sha256').update(await readFile(path)).digest('hex');
  }

  async disk(path: string): Promise<DiskObservation> {
    const stats = await statfs(path, { bigint: true });
    return {
      totalBytes: Number(stats.bsize * stats.blocks),
      availableBytes: Number(stats.bsize * stats.bavail),
    };
  }
}

class PodmanCliPreflightAdapter implements FormalPreflightContainerRuntimeAdapter {
  private readonly runner: RuntimeCommandRunner;

  constructor(runner: RuntimeCommandRunner) {
    this.runner = runner;
  }

  async inspect(): Promise<PodmanPreflightObservation> {
    const rawInfo = JSON.parse(await requireCommandText(this.runner, 'podman', [
      'info', '--format', 'json',
    ])) as unknown;
    if (!isRecord(rawInfo)) throw new Error('FORMAL_PREFLIGHT_PODMAN_INFO_INVALID');
    const version = isRecord(rawInfo['version']) ? rawInfo['version'] : {};
    const store = isRecord(rawInfo['store']) ? rawInfo['store'] : {};
    const host = isRecord(rawInfo['host']) ? rawInfo['host'] : {};
    const ociRuntime = isRecord(host['ociRuntime']) ? host['ociRuntime'] : {};
    const socket = isRecord(host['remoteSocket']) ? host['remoteSocket'] : {};
    const security = isRecord(host['security']) ? host['security'] : {};
    const socketState = await requireCommandText(this.runner, 'systemctl', [
      'is-active', 'podman.socket',
    ]);
    const images = await Promise.all(EXPECTED_IMAGE_REFERENCES.map(async (reference) => {
      const result = await this.runner.run({ executable: 'podman', args: ['image', 'inspect', reference] });
      if (result.exitCode !== 0) {
        return { reference, present: false, imageId: null, repoDigests: [] };
      }
      const inspected = JSON.parse(result.stdout) as unknown;
      const first = Array.isArray(inspected) ? inspected[0] : undefined;
      const record = isRecord(first) ? first : {};
      const repoDigests = Array.isArray(record['RepoDigests'])
        ? record['RepoDigests'].filter((value): value is string => typeof value === 'string')
        : [];
      const requiredDigest = reference.split('@')[1];
      const digestPresent = requiredDigest !== undefined && repoDigests.some((digest) =>
        digest.endsWith('@' + requiredDigest),
      );
      return {
        reference,
        present: digestPresent,
        imageId: typeof record['Id'] === 'string' ? record['Id'] : null,
        repoDigests,
      };
    }));
    const resources = [
      ...await this.listResources('container', ['container', 'ls', '--all', '--format', '{{json .}}']),
      ...await this.listResources('volume', ['volume', 'ls', '--format', '{{json .}}']),
      ...await this.listResources('network', ['network', 'ls', '--format', '{{json .}}']),
    ].filter(isRepositoryPodmanResource);
    return {
      podmanVersion: stringField(version, 'Version'),
      graphDriverName: stringField(store, 'graphDriverName'),
      graphRoot: stringField(store, 'graphRoot'),
      networkBackend: stringField(host, 'networkBackend'),
      logDriver: stringField(host, 'logDriver'),
      ociRuntimeName: stringField(ociRuntime, 'name'),
      socketPath: stringField(socket, 'path'),
      socketActive: socketState.trim() === 'active' && socket['exists'] === true,
      rootless: security['rootless'] === true,
      images,
      repositoryResources: resources,
    };
  }

  private async listResources(
    type: PodmanResourceObservation['type'],
    args: readonly string[],
  ): Promise<readonly PodmanResourceObservation[]> {
    const output = await requireCommandText(this.runner, 'podman', args);
    return output.split(/\r?\n/u).filter((line) => line.trim().length > 0).map((line) => {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) throw new Error('FORMAL_PREFLIGHT_PODMAN_LIST_INVALID');
      const labels = parsePodmanLabels(value['Labels'] ?? value['labels']);
      return {
        type,
        id: type === 'volume'
          ? stringField(value, 'Name')
          : stringField(value, type === 'network' ? 'id' : 'ID'),
        name: type === 'container'
          ? stringField(value, 'Names')
          : stringField(value, type === 'network' ? 'name' : 'Name'),
        labels,
        ...(typeof value['Image'] === 'string' ? { imageReference: value['Image'] } : {}),
        ...(typeof value['State'] === 'string' ? { state: value['State'] } : {}),
        ...(typeof value['Ports'] === 'string' ? { ports: value['Ports'] } : {}),
      };
    });
  }
}

class BindPreflightPortAdapter implements FormalPreflightPortAdapter {
  async inspect(ports: readonly number[]): Promise<readonly PortObservation[]> {
    return Promise.all(ports.map((port) => inspectPort(port)));
  }
}

class WindowsWslHostAdapter implements FormalPreflightHostAdapter {
  private readonly runner: RuntimeCommandRunner;

  constructor(runner: RuntimeCommandRunner) {
    this.runner = runner;
  }

  async inspect(): Promise<WslHostEvidence> {
    return inspectWslHost(this.runner);
  }
}

async function appendExactCommandCheck(
  checks: FormalPreflightCheck[],
  runner: RuntimeCommandRunner,
  id: string,
  category: FormalPreflightCheck['category'],
  executable: string,
  args: readonly string[],
  expected: string,
  mismatchCode: string,
): Promise<void> {
  const result = await runText(runner, undefined, executable, args);
  const actual = result.ok ? result.value.trim() : null;
  checks.push(actual === expected
    ? passed(id, category, { expected, actual })
    : failed(id, category, mismatchCode, { expected, actual }));
}

async function appendDiskCheck(
  checks: FormalPreflightCheck[],
  fileSystem: FormalPreflightFileSystem,
  path: string,
  id: string,
  policy: {
    readonly expectedTotalBytes?: number;
    readonly totalToleranceBytes?: number;
    readonly minimumAvailableBytes: number;
    readonly mismatchCode: string;
  },
): Promise<void> {
  try {
    const disk = await fileSystem.disk(path);
    const totalMatches = policy.expectedTotalBytes === undefined ||
      Math.abs(disk.totalBytes - policy.expectedTotalBytes) <= (policy.totalToleranceBytes ?? 0);
    const availableMatches = disk.availableBytes >= policy.minimumAvailableBytes;
    const observed = {
      path,
      ...disk,
      expectedTotalBytes: policy.expectedTotalBytes ?? null,
      totalToleranceBytes: policy.totalToleranceBytes ?? null,
      minimumAvailableBytes: policy.minimumAvailableBytes,
    };
    checks.push(totalMatches && availableMatches
      ? passed(id, 'wsl', observed)
      : failed(id, 'wsl', policy.mismatchCode, observed));
  } catch (error) {
    checks.push(failed(id, 'wsl', policy.mismatchCode, {
      path,
      errorCode: stableObservedError(error),
    }));
  }
}

async function inspectPort(port: number): Promise<PortObservation> {
  return new Promise<PortObservation>((resolveInspection) => {
    const server = createServer();
    server.unref();
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolveInspection({
        port,
        occupied: error.code === 'EADDRINUSE' || error.code === 'EACCES',
        verificationError: error.code === 'EADDRINUSE' || error.code === 'EACCES'
          ? null
          : (error.code ?? 'PORT_BIND_ERROR'),
      });
    });
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) => resolveInspection({
        port,
        occupied: false,
        verificationError: error === undefined ? null : 'PORT_CLOSE_ERROR',
      }));
    });
  });
}

function parseOsRelease(value: string): Readonly<Record<string, string>> {
  return Object.fromEntries(value.split(/\r?\n/u).flatMap((line) => {
    const match = /^([A-Z0-9_]+)=(.*)$/u.exec(line);
    if (!match) return [];
    const raw = match[2] ?? '';
    return [[match[1]!, raw.replace(/^['"]|['"]$/gu, '')]];
  }));
}

function parseMemInfo(value: string): { readonly memTotalBytes: number; readonly swapTotalBytes: number } {
  const readKilobytes = (name: string): number => {
    const match = new RegExp('^' + name + ':\\s+(\\d+)\\s+kB$', 'mu').exec(value);
    if (!match?.[1]) throw new Error('MEMINFO_FIELD_MISSING:' + name);
    return Number(match[1]) * 1024;
  };
  return { memTotalBytes: readKilobytes('MemTotal'), swapTotalBytes: readKilobytes('SwapTotal') };
}

function parsePodmanLabels(value: unknown): Readonly<Record<string, string>> {
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).flatMap(([name, item]) =>
      typeof item === 'string' ? [[name, item]] : [],
    ));
  }
  if (typeof value !== 'string') return {};
  return Object.fromEntries(value.split(',').flatMap((item) => {
    const separator = item.indexOf('=');
    if (separator <= 0) return [];
    return [[item.slice(0, separator), item.slice(separator + 1)]];
  }));
}

export function isRepositoryPodmanResource(resource: PodmanResourceObservation): boolean {
  return resource.labels['hdi.repository'] === FORMAL_REPOSITORY_LABEL ||
    resource.name.startsWith('hdi_phase01_');
}

function stringField(value: Readonly<Record<string, unknown>>, key: string): string {
  const field = value[key];
  return typeof field === 'string' ? field : '';
}

async function runText(
  runner: RuntimeCommandRunner,
  cwd: string | undefined,
  executable: string,
  args: readonly string[],
): Promise<{ readonly ok: true; readonly value: string } | { readonly ok: false }> {
  try {
    const result = await runner.run({ executable, args, ...(cwd === undefined ? {} : { cwd }) });
    return result.exitCode === 0 ? { ok: true, value: result.stdout } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function requireCommandText(
  runner: RuntimeCommandRunner,
  executable: string,
  args: readonly string[],
): Promise<string> {
  const result = await runner.run({ executable, args });
  if (result.exitCode !== 0) throw new Error('COMMAND_FAILED:' + executable + ':' + args[0]);
  return result.stdout;
}

function passed(
  id: string,
  category: FormalPreflightCheck['category'],
  observed: unknown,
): FormalPreflightCheck {
  return { id, category, status: 'PASSED', errorCode: null, observed };
}

function failed(
  id: string,
  category: FormalPreflightCheck['category'],
  errorCode: string,
  observed: unknown,
): FormalPreflightCheck {
  return { id, category, status: 'FAILED', errorCode, observed };
}

function safeLengthRange(
  length: number,
): Exclude<SecretPresenceObservation['safeLengthRange'], undefined> {
  if (length < 16) return '<16';
  if (length < 32) return '16-31';
  if (length < 64) return '32-63';
  return '64+';
}

function stableObservedError(error: unknown): string {
  const message = errorMessage(error);
  const stable = /^[A-Z0-9_:-]+$/u.test(message) ? message : error instanceof Error
    ? error.name.toUpperCase()
    : 'UNKNOWN_ERROR';
  return stable.slice(0, 160);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function runCli(): Promise<void> {
  if (!process.argv.includes('--dry-run')) throw new Error('FORMAL_PREFLIGHT_DRY_RUN_REQUIRED');
  const repositoryRoot = resolve(import.meta.dirname, '../../../..');
  const runSequenceArgument = readArgument('--run-sequence');
  const runSequence = Number(runSequenceArgument ?? process.env['ABG_RUN_SEQUENCE'] ?? '1');
  const run = createFormalRunSeed(runSequence);
  const outputDirectory = resolve(
    readArgument('--output-dir') ??
      process.env['EVIDENCE_OUTPUT_DIR'] ??
      resolve(repositoryRoot, '.runtime/evidence/preflight-' + run.runId),
  );
  const producerSourceManifestSha256 = readArgument('--producer-source-manifest-sha256');
  if (producerSourceManifestSha256 === undefined) {
    throw new Error('PRODUCER_SOURCE_MANIFEST_SHA256_REQUIRED');
  }
  const report = await runFormalPreflight({
    repositoryRoot,
    outputDirectory,
    run,
    producerSourceManifestSha256,
  });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.status !== 'PASSED') process.exitCode = 1;
}

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await runCli();
}
