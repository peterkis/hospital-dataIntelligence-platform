import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, statfs } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrozenInputs } from '../frozen-inputs.ts';
import {
  FORMAL_REQUIRED_SECRET_NAMES,
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
  type WslHostEvidence,
} from './formal-wsl-host.ts';
import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.ts';
import { PODMAN_RUNTIME_AUTHORITY_ID } from './podman-runtime-authority-schema.ts';

export type LoadedRuntimeAuthority = Awaited<ReturnType<typeof loadPodmanRuntimeAuthority>>;
type RuntimeAuthority = LoadedRuntimeAuthority['authority'];

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
  readonly restartPolicy?: string | null;
}

export interface PodmanImageObservation {
  readonly reference: string;
  readonly present: boolean;
  readonly imageId: string | null;
  readonly repoDigests: readonly string[];
}

export interface PodmanPreflightObservation {
  readonly podmanVersion: string;
  readonly packageNevras: Readonly<{
    podman: string | null;
    conmon: string | null;
    containersCommon: string | null;
    runc: string | null;
    networkPlugins: string | null;
  }>;
  readonly graphDriverName: string;
  readonly graphRoot: string;
  readonly runRoot: string;
  readonly networkBackend: string;
  readonly logDriver: string;
  readonly ociRuntimeName: string;
  readonly cgroupManager: string;
  readonly eventsBackend: string;
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
  readonly runtimeAuthoritySha256: string | null;
  readonly runtimeAuthoritySemanticDigest: string | null;
  readonly checks: readonly FormalPreflightCheck[];
  readonly secrets: readonly SecretPresenceObservation[];
}

export interface FrozenFormalPreflightResult {
  readonly report: FormalPreflightReport;
  readonly runtimeAuthority: LoadedRuntimeAuthority | null;
}

export interface FormalPreflightFileSystem {
  exists(path: string): Promise<boolean>;
  readText(path: string): Promise<string>;
  sha256(path: string): Promise<string>;
  disk(path: string): Promise<DiskObservation>;
}

export interface FormalPreflightContainerRuntimeAdapter {
  inspect(authority?: RuntimeAuthority): Promise<PodmanPreflightObservation>;
}

export interface FormalPreflightAuthorityIsolationObservation {
  readonly dockerExecutablePaths: readonly string[];
  readonly forbiddenSockets: readonly {
    readonly path: string;
    readonly kind: 'missing' | 'socket' | 'file' | 'directory' | 'symbolic-link' | 'other';
    readonly symbolicLink: boolean;
    readonly target: string | null;
  }[];
  readonly systemdUnits: readonly {
    readonly name: string;
    readonly loadState: string;
    readonly activeState: string;
    readonly unitFileState: string;
    readonly subState: string;
  }[];
  readonly forbiddenProcesses: readonly { readonly pid: number; readonly name: string }[];
  readonly forbiddenTcpListeners: readonly {
    readonly address: string;
    readonly port: number;
    readonly process: string | null;
  }[];
  readonly unexpectedContainerApiEndpoints: readonly string[];
  readonly podmanConnections: readonly string[];
  readonly podmanMachines: readonly string[];
  readonly rootlessSocketPaths: readonly string[];
  readonly otherWslBackends: readonly string[];
  readonly podmanSocket: {
    readonly path: string;
    readonly kind: 'missing' | 'socket' | 'file' | 'directory' | 'symbolic-link' | 'other';
    readonly symbolicLink: boolean;
    readonly uid: number | null;
    readonly gid: number | null;
    readonly mode: string | null;
    readonly systemdActive: boolean;
    readonly tcpEndpoints: readonly string[];
    readonly rootless: boolean | null;
  };
  readonly inspectionFailures: readonly string[];
}

export interface FormalPreflightAuthorityIsolationAdapter {
  inspect(authority?: RuntimeAuthority): Promise<FormalPreflightAuthorityIsolationObservation>;
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
  readonly authorityIsolation: FormalPreflightAuthorityIsolationAdapter;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly nodeVersion: string;
  readonly readFrozenInputs: (
    repositoryRoot: string,
    producerSourceManifestSha256: string,
    runtimeAuthority: LoadedRuntimeAuthority,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly loadRuntimeAuthority: (
    repositoryRoot: string,
  ) => LoadedRuntimeAuthority | Promise<LoadedRuntimeAuthority>;
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
    authorityIsolation: createFormalRuntimeAuthorityIsolationAdapter(commandRunner, process.env),
    environment: process.env,
    nodeVersion: process.version,
    readFrozenInputs,
    loadRuntimeAuthority: loadPodmanRuntimeAuthority,
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
  let loadedAuthority: LoadedRuntimeAuthority | null = null;

  try {
    loadedAuthority = await dependencies.loadRuntimeAuthority(input.repositoryRoot);
    checks.push(passed('runtime-authority', 'podman', {
      authorityId: PODMAN_RUNTIME_AUTHORITY_ID,
      runtimeAuthoritySha256: loadedAuthority.runtimeAuthoritySha256,
      runtimeAuthoritySemanticDigest: loadedAuthority.runtimeAuthoritySemanticDigest,
    }));
  } catch (error) {
    checks.push(failed('runtime-authority', 'podman', 'FORMAL_PREFLIGHT_RUNTIME_AUTHORITY_INVALID', {
      errorCode: stableObservedError(error),
    }));
  }

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
    if (loadedAuthority === null) throw new Error('RUNTIME_AUTHORITY_UNAVAILABLE');
    const frozenInputs = await dependencies.readFrozenInputs(
      input.repositoryRoot,
      input.producerSourceManifestSha256,
      loadedAuthority,
    );
    checks.push(passed('git-frozen-inputs-readable', 'git', {
      readable: true,
      inputNames: Object.keys(frozenInputs).sort(),
      inputs: frozenInputs,
    }));
    const frozenAuthorityMatches =
      frozenInputs['runtimeAuthoritySha256'] === loadedAuthority.runtimeAuthoritySha256 &&
      frozenInputs['runtimeAuthoritySemanticDigest'] ===
        loadedAuthority.runtimeAuthoritySemanticDigest;
    checks.push(frozenAuthorityMatches
      ? passed('runtime-authority-frozen-input-binding', 'podman', {
        runtimeAuthoritySha256: loadedAuthority.runtimeAuthoritySha256,
        runtimeAuthoritySemanticDigest: loadedAuthority.runtimeAuthoritySemanticDigest,
      })
      : failed(
        'runtime-authority-frozen-input-binding',
        'podman',
        'FORMAL_PREFLIGHT_FROZEN_RUNTIME_AUTHORITY_MISMATCH',
        { matched: false },
      ));
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
  if (loadedAuthority !== null) {
    await appendWslChecks(checks, dependencies, loadedAuthority.authority);
  }
  const podmanObservation = loadedAuthority === null
    ? undefined
    : await appendPodmanChecks(checks, dependencies, loadedAuthority.authority);
  if (loadedAuthority !== null) {
    await appendAuthorityIsolationChecks(checks, dependencies, loadedAuthority.authority);
    await appendPortChecks(
      checks,
      dependencies,
      Object.values(loadedAuthority.authority.network.ports),
      podmanObservation?.repositoryResources ?? [],
    );
  }
  const secrets = appendSecretChecks(checks, dependencies.environment);

  return {
    schemaVersion: 'phase-01.formal-preflight.v1',
    status: checks.every((check) => check.status === 'PASSED') ? 'PASSED' : 'FAILED',
    runIdentity: { ...input.run, gitCommitSha },
    startedAt,
    completedAt: dependencies.now(),
    timezone: 'Asia/Shanghai',
    runtimeAuthoritySha256: loadedAuthority?.runtimeAuthoritySha256 ?? null,
    runtimeAuthoritySemanticDigest: loadedAuthority?.runtimeAuthoritySemanticDigest ?? null,
    checks,
    secrets,
  };
}

export async function runFormalPreflightWithFrozenAuthority(
  input: {
    readonly repositoryRoot: string;
    readonly outputDirectory: string;
    readonly run: FormalRunSeed;
    readonly producerSourceManifestSha256: string;
  },
  dependencies: FormalPreflightDependencies = createDefaultFormalPreflightDependencies(),
): Promise<FrozenFormalPreflightResult> {
  let runtimeAuthority: LoadedRuntimeAuthority | null = null;
  const report = await runFormalPreflight(input, {
    ...dependencies,
    async loadRuntimeAuthority(repositoryRoot) {
      runtimeAuthority = await dependencies.loadRuntimeAuthority(repositoryRoot);
      return runtimeAuthority;
    },
  });
  return { report, runtimeAuthority };
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
  authority: RuntimeAuthority,
): Promise<void> {
  const hostAuthority = authority.host;
  const distribution = dependencies.environment['WSL_DISTRO_NAME'];
  checks.push(distribution === hostAuthority.distribution
    ? passed('wsl-distribution', 'wsl', { distribution })
    : failed('wsl-distribution', 'wsl', 'FORMAL_PREFLIGHT_WSL_DISTRO_MISMATCH', {
      expected: hostAuthority.distribution,
      actual: distribution ?? null,
    }));

  try {
    const release = parseOsRelease(await dependencies.fileSystem.readText('/etc/os-release'));
    checks.push(
      release['ID'] === hostAuthority.osId &&
      release['VERSION_ID'] === hostAuthority.osVersion
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
    'uname', ['-m'], hostAuthority.architecture, 'FORMAL_PREFLIGHT_WSL_ARCH_MISMATCH');
  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-pid-one', 'wsl',
    'ps', ['-p', '1', '-o', 'comm='], hostAuthority.initProcess,
    'FORMAL_PREFLIGHT_WSL_PID1_NOT_SYSTEMD');
  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-timezone', 'wsl',
    'timedatectl', ['show', '--property=Timezone', '--value'], hostAuthority.timezone,
    'FORMAL_PREFLIGHT_WSL_TIMEZONE_MISMATCH');
  await appendExactCommandCheck(checks, dependencies.commandRunner, 'wsl-cpu', 'wsl',
    'nproc', [], String(hostAuthority.processorCount),
    'FORMAL_PREFLIGHT_WSL_CPU_MISMATCH');

  try {
    const memory = parseMemInfo(await dependencies.fileSystem.readText('/proc/meminfo'));
    const memoryMatches = Math.abs(memory.memTotalBytes - hostAuthority.memoryBytes) <=
      hostAuthority.memoryToleranceBytes;
    checks.push(memoryMatches
      ? passed('wsl-memory', 'wsl', {
        expectedBytes: hostAuthority.memoryBytes,
        actualBytes: memory.memTotalBytes,
        toleranceBytes: hostAuthority.memoryToleranceBytes,
      })
      : failed('wsl-memory', 'wsl', 'FORMAL_PREFLIGHT_WSL_MEMORY_MISMATCH', {
        expectedBytes: hostAuthority.memoryBytes,
        actualBytes: memory.memTotalBytes,
        toleranceBytes: hostAuthority.memoryToleranceBytes,
      }));
    checks.push(memory.swapTotalBytes === hostAuthority.swapBytes
      ? passed('wsl-swap', 'wsl', { swapTotalBytes: hostAuthority.swapBytes })
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
    expectedTotalBytes: hostAuthority.rootFilesystemBytes,
    totalToleranceBytes: hostAuthority.rootFilesystemToleranceBytes,
    minimumAvailableBytes: hostAuthority.minimumRootAvailableBytes,
    mismatchCode: 'FORMAL_PREFLIGHT_WSL_ROOT_DISK_UNSAFE',
  });
  await appendDiskCheck(checks, dependencies.fileSystem, '/mnt/d', 'wsl-mnt-d-disk', {
    minimumAvailableBytes: hostAuthority.minimumHostAvailableBytes,
    mismatchCode: 'FORMAL_PREFLIGHT_WSL_MNT_D_DISK_UNSAFE',
  });

  try {
    const host = await dependencies.host.inspect();
    const running = host.runningDistributions;
    checks.push(running.length === 1 && running[0] === hostAuthority.distribution
      ? passed('wsl-host-running-distributions', 'wsl', { running })
      : failed(
        'wsl-host-running-distributions',
        'wsl',
        'FORMAL_PREFLIGHT_WSL_RUNNING_SET_MISMATCH',
        { expected: [hostAuthority.distribution], running },
      ));
    checks.push(wslConfigurationMatchesAuthority(host.configuration, hostAuthority)
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
  authority: RuntimeAuthority,
): Promise<PodmanPreflightObservation | undefined> {
  try {
    const rawObservation = await dependencies.containerRuntime.inspect(authority);
    const observation: PodmanPreflightObservation = {
      ...rawObservation,
      repositoryResources: rawObservation.repositoryResources.map((resource) => ({
        ...resource,
        labels: projectGovernedRuntimeLabels(resource.labels),
      })),
    };
    const expectedPodman = authority.podman;
    appendPodmanPackageNevraChecks(checks, observation.packageNevras, expectedPodman);
    const baselineMatches =
      observation.podmanVersion === expectedPodman.version &&
      observation.graphDriverName === expectedPodman.storageDriver &&
      observation.graphRoot === expectedPodman.graphRoot &&
      observation.runRoot === expectedPodman.runRoot &&
      observation.networkBackend === expectedPodman.networkBackend &&
      observation.logDriver === expectedPodman.logDriver &&
      observation.ociRuntimeName === expectedPodman.ociRuntime &&
      observation.cgroupManager === expectedPodman.cgroupManager &&
      observation.eventsBackend === expectedPodman.eventsBackend &&
      observation.socketPath === expectedPodman.socketPath &&
      observation.socketActive &&
      observation.rootless === expectedPodman.rootless;
    checks.push(baselineMatches
      ? passed('podman-runtime', 'podman', observation)
      : failed('podman-runtime', 'podman', 'FORMAL_PREFLIGHT_PODMAN_BASELINE_MISMATCH', {
        expected: {
          podmanVersion: expectedPodman.version,
          graphDriverName: expectedPodman.storageDriver,
          graphRoot: expectedPodman.graphRoot,
          runRoot: expectedPodman.runRoot,
          networkBackend: expectedPodman.networkBackend,
          logDriver: expectedPodman.logDriver,
          ociRuntimeName: expectedPodman.ociRuntime,
          cgroupManager: expectedPodman.cgroupManager,
          eventsBackend: expectedPodman.eventsBackend,
          socketPath: expectedPodman.socketPath,
          socketActive: true,
          rootless: expectedPodman.rootless,
        },
        actual: observation,
      }));
    const expectedImages = [authority.images.postgresql.runtimeReference, authority.images.keycloak.runtimeReference];
    for (const reference of expectedImages) {
      const image = observation.images.find((candidate) => candidate.reference === reference);
      checks.push(image?.present === true && image.repoDigests.includes(reference)
        ? passed('podman-image-' + image.reference.split('@', 1)[0], 'podman', image)
        : failed(
          'podman-image-' + reference.split('@', 1)[0],
          'podman',
          'FORMAL_PREFLIGHT_PODMAN_IMAGE_MISSING',
          image ?? { reference, present: false, imageId: null, repoDigests: [] },
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
  ports: readonly number[],
  repositoryResources: readonly PodmanResourceObservation[],
): Promise<void> {
  try {
    const observations = await dependencies.ports.inspect(ports);
    const byPort = new Map(observations.map((observation) => [observation.port, observation]));
    for (const port of ports) {
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
    for (const port of ports) {
      checks.push(failed('port-' + port, 'port', 'FORMAL_PREFLIGHT_PORT_CHECK_UNAVAILABLE', {
        port,
        errorCode: stableObservedError(error),
      }));
    }
  }
}

async function appendAuthorityIsolationChecks(
  checks: FormalPreflightCheck[],
  dependencies: FormalPreflightDependencies,
  authority: RuntimeAuthority,
): Promise<void> {
  let observation: FormalPreflightAuthorityIsolationObservation;
  try {
    observation = await dependencies.authorityIsolation.inspect(authority);
  } catch (error) {
    checks.push(failed('runtime-authority-isolation', 'podman', 'FORMAL_PREFLIGHT_AUTHORITY_ISOLATION_UNAVAILABLE', {
      errorCode: stableObservedError(error),
    }));
    return;
  }
  checks.push(...evaluateFormalRuntimeAuthorityIsolation(
    observation,
    dependencies.environment,
    authority,
  ));
}

export function evaluateFormalRuntimeAuthorityIsolation(
  observation: FormalPreflightAuthorityIsolationObservation,
  environment: Readonly<NodeJS.ProcessEnv>,
  authority: RuntimeAuthority,
): readonly FormalPreflightCheck[] {
  const checks: FormalPreflightCheck[] = [];
  const addAbsence = (
    id: string,
    findings: readonly unknown[],
    errorCode: string,
  ): void => {
    checks.push(findings.length === 0
      ? passed(id, 'podman', { findings: [] })
      : failed(id, 'podman', errorCode, { findings }));
  };

  addAbsence('docker-cli-absent', observation.dockerExecutablePaths, 'FORMAL_PREFLIGHT_DOCKER_CLI_PRESENT');
  addAbsence('docker-sockets-absent', observation.forbiddenSockets, 'FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT');
  addAbsence('docker-systemd-units-absent', observation.systemdUnits.filter((unit) =>
    unit.loadState !== 'not-found' ||
    unit.activeState !== 'inactive' ||
    unit.subState === 'listening' ||
    !['disabled', 'not-found'].includes(unit.unitFileState),
  ), 'FORMAL_PREFLIGHT_DOCKER_SYSTEMD_UNIT_PRESENT');
  addAbsence('docker-processes-absent', observation.forbiddenProcesses, 'FORMAL_PREFLIGHT_DOCKER_PROCESS_PRESENT');
  addAbsence('container-api-tcp-absent', observation.forbiddenTcpListeners, 'FORMAL_PREFLIGHT_CONTAINER_API_TCP_PRESENT');
  addAbsence('container-api-endpoints-absent', [
    ...observation.unexpectedContainerApiEndpoints,
    ...observation.podmanConnections,
  ], 'FORMAL_PREFLIGHT_SECOND_RUNTIME_ENDPOINT_PRESENT');
  addAbsence('second-runtime-authority-absent', [
    ...observation.podmanMachines,
    ...observation.rootlessSocketPaths,
    ...observation.otherWslBackends,
  ], 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT');
  addAbsence('runtime-isolation-inspection-complete', observation.inspectionFailures,
    'FORMAL_PREFLIGHT_AUTHORITY_ISOLATION_UNAVAILABLE');

  const expectedSocketPath = authority.podman.socketPath;
  const socket = observation.podmanSocket;
  checks.push(socket.path === expectedSocketPath
    ? passed('podman-socket-path', 'podman', { expected: expectedSocketPath, actual: socket.path })
    : failed('podman-socket-path', 'podman', 'FORMAL_PREFLIGHT_PODMAN_SOCKET_PATH_MISMATCH', {
      expected: expectedSocketPath,
      actual: socket.path,
    }));
  checks.push(!socket.symbolicLink
    ? passed('podman-socket-not-symlink', 'podman', { symbolicLink: false })
    : failed('podman-socket-not-symlink', 'podman', 'FORMAL_PREFLIGHT_PODMAN_SOCKET_SYMLINK', {
      symbolicLink: true,
    }));
  checks.push(socket.kind === 'socket'
    ? passed('podman-socket-type', 'podman', {
      kind: socket.kind,
      uid: socket.uid,
      gid: socket.gid,
      mode: socket.mode,
    })
    : failed('podman-socket-type', 'podman', 'FORMAL_PREFLIGHT_PODMAN_SOCKET_NOT_UNIX', {
      kind: socket.kind,
    }));
  checks.push(socket.systemdActive
    ? passed('podman-socket-systemd-active', 'podman', { active: true })
    : failed('podman-socket-systemd-active', 'podman', 'FORMAL_PREFLIGHT_PODMAN_SOCKET_INACTIVE', {
      active: false,
    }));
  checks.push(socket.tcpEndpoints.length === 0
    ? passed('podman-socket-not-tcp', 'podman', { endpoints: [] })
    : failed('podman-socket-not-tcp', 'podman', 'FORMAL_PREFLIGHT_PODMAN_SOCKET_TCP_EXPOSED', {
      endpoints: socket.tcpEndpoints,
    }));
  checks.push(socket.rootless === false
    ? passed('podman-runtime-rootful', 'podman', { rootless: false })
    : failed('podman-runtime-rootful', 'podman', 'FORMAL_PREFLIGHT_PODMAN_ROOTFUL_REQUIRED', {
      rootless: socket.rootless,
    }));

  const expectedDockerHost = authority.dockerExclusion.allowedCompatibilityEnvironment.DOCKER_HOST;
  const dockerHost = environment['DOCKER_HOST'];
  checks.push(dockerHost === undefined || dockerHost === expectedDockerHost
    ? passed('container-environment-docker-host', 'podman', {
      present: dockerHost !== undefined,
      compatibilityEndpoint: dockerHost === expectedDockerHost,
    })
    : failed('container-environment-docker-host', 'podman', 'FORMAL_PREFLIGHT_DOCKER_HOST_INVALID', {
      scheme: endpointScheme(dockerHost),
    }));
  appendEnvironmentAbsenceCheck(checks, environment, 'DOCKER_CONTEXT',
    'container-environment-docker-context', 'FORMAL_PREFLIGHT_DOCKER_CONTEXT_PRESENT');
  const tlsNames = ['DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'] as const;
  const presentTlsNames = tlsNames.filter((name) => nonEmpty(environment[name]));
  addAbsence('container-environment-docker-tls', presentTlsNames, 'FORMAL_PREFLIGHT_DOCKER_TLS_PRESENT');
  const containerHost = environment['CONTAINER_HOST'];
  checks.push(!nonEmpty(containerHost)
    ? passed('container-environment-container-host', 'podman', { present: false })
    : failed('container-environment-container-host', 'podman', 'FORMAL_PREFLIGHT_CONTAINER_HOST_INVALID', {
      scheme: endpointScheme(containerHost),
    }));
  appendEnvironmentAbsenceCheck(checks, environment, 'TESTCONTAINERS_HOST_OVERRIDE',
    'container-environment-testcontainers-host-override',
    'FORMAL_PREFLIGHT_TESTCONTAINERS_HOST_OVERRIDE_INVALID');
  return checks;
}

function appendEnvironmentAbsenceCheck(
  checks: FormalPreflightCheck[],
  environment: Readonly<NodeJS.ProcessEnv>,
  name: string,
  id: string,
  errorCode: string,
): void {
  const present = nonEmpty(environment[name]);
  checks.push(!present
    ? passed(id, 'podman', { present: false })
    : failed(id, 'podman', errorCode, { present: true }));
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

  async inspect(authority?: RuntimeAuthority): Promise<PodmanPreflightObservation> {
    if (authority === undefined) throw new Error('FORMAL_PREFLIGHT_RUNTIME_AUTHORITY_REQUIRED');
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
    const expectedImageReferences = [
      authority.images.postgresql.runtimeReference,
      authority.images.keycloak.runtimeReference,
    ];
    const images = await Promise.all(expectedImageReferences.map(async (reference) => {
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
    ].filter((resource) => isRepositoryPodmanResource(
      resource,
      authority.labels.static['hdi.repository'],
    ));
    const [podmanNevra, conmonNevra, containersCommonNevra, runcNevra, networkPluginsNevra] =
      await Promise.all([
        inspectRpmNevra(this.runner, 'podman'),
        inspectRpmNevra(this.runner, 'conmon'),
        inspectRpmNevra(this.runner, 'containers-common'),
        inspectRpmNevra(this.runner, 'runc'),
        inspectRpmNevra(this.runner, 'containernetworking-plugins'),
      ]);
    return {
      podmanVersion: stringField(version, 'Version'),
      packageNevras: {
        podman: podmanNevra,
        conmon: conmonNevra,
        containersCommon: containersCommonNevra,
        runc: runcNevra,
        networkPlugins: networkPluginsNevra,
      },
      graphDriverName: stringField(store, 'graphDriverName'),
      graphRoot: stringField(store, 'graphRoot'),
      runRoot: stringField(store, 'runRoot'),
      networkBackend: stringField(host, 'networkBackend'),
      logDriver: stringField(host, 'logDriver'),
      ociRuntimeName: stringField(ociRuntime, 'name'),
      cgroupManager: stringField(host, 'cgroupManager'),
      eventsBackend: stringField(host, 'eventLogger') || stringField(host, 'eventsBackend'),
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
    return Promise.all(output.split(/\r?\n/u).filter((line) => line.trim().length > 0).map(async (line) => {
      const value = JSON.parse(line) as unknown;
      if (!isRecord(value)) throw new Error('FORMAL_PREFLIGHT_PODMAN_LIST_INVALID');
      const labels = parsePodmanLabels(value['Labels'] ?? value['labels']);
      const id = type === 'volume'
        ? stringField(value, 'Name')
        : stringField(value, type === 'network' ? 'id' : 'ID');
      let restartPolicy: string | null | undefined;
      if (type === 'container' && id.length > 0) {
        const rawInspect = JSON.parse(await requireCommandText(this.runner, 'podman', [
          'container', 'inspect', id,
        ])) as unknown;
        const inspected = Array.isArray(rawInspect) ? rawInspect[0] : rawInspect;
        restartPolicy = parsePodmanContainerRestartPolicy(inspected);
      }
      return {
        type,
        id,
        name: type === 'container'
          ? stringField(value, 'Names')
          : stringField(value, type === 'network' ? 'name' : 'Name'),
        labels,
        ...(typeof value['Image'] === 'string' ? { imageReference: value['Image'] } : {}),
        ...(typeof value['State'] === 'string' ? { state: value['State'] } : {}),
        ...(typeof value['Ports'] === 'string' ? { ports: value['Ports'] } : {}),
        ...(restartPolicy === undefined ? {} : { restartPolicy }),
      };
    }));
  }
}

type PodmanPackageNevraObservation = PodmanPreflightObservation['packageNevras'];
type GovernedPodmanAuthority = RuntimeAuthority['podman'];

const GOVERNED_PODMAN_PACKAGE_CHECKS = [
  {
    observationKey: 'podman',
    authorityKey: 'packageNevra',
    packageName: 'podman',
    checkId: 'podman-package-nevra-podman',
    unavailableCode: 'FORMAL_PREFLIGHT_PODMAN_PACKAGE_NEVRA_UNAVAILABLE',
    mismatchCode: 'FORMAL_PREFLIGHT_PODMAN_PACKAGE_NEVRA_MISMATCH',
  },
  {
    observationKey: 'conmon',
    authorityKey: 'conmonNevra',
    packageName: 'conmon',
    checkId: 'podman-package-nevra-conmon',
    unavailableCode: 'FORMAL_PREFLIGHT_CONMON_NEVRA_UNAVAILABLE',
    mismatchCode: 'FORMAL_PREFLIGHT_CONMON_NEVRA_MISMATCH',
  },
  {
    observationKey: 'containersCommon',
    authorityKey: 'containersCommonNevra',
    packageName: 'containers-common',
    checkId: 'podman-package-nevra-containers-common',
    unavailableCode: 'FORMAL_PREFLIGHT_CONTAINERS_COMMON_NEVRA_UNAVAILABLE',
    mismatchCode: 'FORMAL_PREFLIGHT_CONTAINERS_COMMON_NEVRA_MISMATCH',
  },
  {
    observationKey: 'runc',
    authorityKey: 'ociRuntimeNevra',
    packageName: 'runc',
    checkId: 'podman-package-nevra-runc',
    unavailableCode: 'FORMAL_PREFLIGHT_RUNC_NEVRA_UNAVAILABLE',
    mismatchCode: 'FORMAL_PREFLIGHT_RUNC_NEVRA_MISMATCH',
  },
  {
    observationKey: 'networkPlugins',
    authorityKey: 'networkPluginsNevra',
    packageName: 'containernetworking-plugins',
    checkId: 'podman-package-nevra-containernetworking-plugins',
    unavailableCode: 'FORMAL_PREFLIGHT_NETWORK_PLUGINS_NEVRA_UNAVAILABLE',
    mismatchCode: 'FORMAL_PREFLIGHT_NETWORK_PLUGINS_NEVRA_MISMATCH',
  },
] as const;

function appendPodmanPackageNevraChecks(
  checks: FormalPreflightCheck[],
  actualNevras: PodmanPackageNevraObservation,
  authority: GovernedPodmanAuthority,
): void {
  for (const governedPackage of GOVERNED_PODMAN_PACKAGE_CHECKS) {
    const actual = actualNevras[governedPackage.observationKey];
    const expected = authority[governedPackage.authorityKey];
    const observed = { packageName: governedPackage.packageName, expected, actual };
    checks.push(actual === null
      ? failed(
        governedPackage.checkId,
        'podman',
        governedPackage.unavailableCode,
        observed,
      )
      : actual === expected
        ? passed(governedPackage.checkId, 'podman', observed)
        : failed(governedPackage.checkId, 'podman', governedPackage.mismatchCode, observed));
  }
}

export async function inspectRpmNevra(
  runner: RuntimeCommandRunner,
  packageName: string,
): Promise<string | null> {
  const result = await runText(runner, undefined, 'rpm', [
    '-q',
    '--qf',
    '%{NAME}-%{EPOCHNUM}:%{VERSION}-%{RELEASE}.%{ARCH}',
    packageName,
  ]);
  if (!result.ok) return null;
  const nevra = result.value.trim();
  return nevra.length > 0 ? nevra : null;
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

export function createFormalRuntimeAuthorityIsolationAdapter(
  runner: RuntimeCommandRunner,
  environment: Readonly<NodeJS.ProcessEnv>,
): FormalPreflightAuthorityIsolationAdapter {
  return new HostAuthorityIsolationAdapter(runner, environment);
}

class HostAuthorityIsolationAdapter implements FormalPreflightAuthorityIsolationAdapter {
  constructor(
    private readonly runner: RuntimeCommandRunner,
    private readonly environment: Readonly<NodeJS.ProcessEnv>,
  ) {}

  async inspect(authority?: RuntimeAuthority): Promise<FormalPreflightAuthorityIsolationObservation> {
    if (authority === undefined) throw new Error('FORMAL_PREFLIGHT_RUNTIME_AUTHORITY_REQUIRED');
    const failures: string[] = [];
    const dockerExecutablePaths = new Set<string>();
    for (const name of authority.dockerExclusion.forbiddenExecutableNames) {
      const resolved = await runText(this.runner, undefined, 'sh', ['-lc', 'command -v -- "$1"', 'sh', name]);
      if (resolved.ok && resolved.value.trim().length > 0) dockerExecutablePaths.add(resolved.value.trim());
    }
    for (const path of ['/usr/bin/docker', '/usr/local/bin/docker', '/usr/sbin/docker', '/bin/docker', '/sbin/docker']) {
      try {
        await lstat(path);
        dockerExecutablePaths.add(path);
      } catch (error) {
        if (!isMissing(error)) failures.push('DOCKER_EXECUTABLE_INSPECTION_FAILED');
      }
    }

    const forbiddenSockets = (await Promise.all(
      authority.dockerExclusion.forbiddenSocketPaths.map((path) => inspectSocketPath(path)),
    )).filter((candidate) => candidate.kind !== 'missing');
    const systemdUnits = await Promise.all(authority.dockerExclusion.forbiddenSystemdUnits.map(
      (name) => inspectSystemdUnit(this.runner, name),
    ));
    const forbiddenProcesses = await inspectForbiddenProcesses(
      authority.dockerExclusion.forbiddenProcessNames,
      failures,
    );
    const listeners = await inspectTcpListeners(this.runner, failures);
    const forbiddenPortSet = new Set(authority.dockerExclusion.forbiddenTcpPorts);
    const forbiddenTcpListeners = listeners.filter((listener) => forbiddenPortSet.has(listener.port));
    const podmanTcpListeners = listeners.filter((listener) => listener.process?.includes('podman') === true)
      .map((listener) => `tcp://${listener.address}:${listener.port}`);
    const podmanConnections = await inspectPodmanConnections(this.runner, failures);
    const podmanMachines = await inspectPodmanMachines(this.runner, failures);
    const rootlessSocketPaths = await inspectRootlessPodmanSockets(failures);
    const socketPath = authority.podman.socketPath;
    const socketObservation = await inspectSocketPath(socketPath);
    const podmanInfo = await inspectIsolationPodmanInfo(this.runner, failures);
    const otherWslBackends = await inspectRegisteredWslBackends(
      this.runner,
      authority.host.distribution,
      failures,
    );
    const podmanSocketActive = await runText(this.runner, undefined, 'systemctl', [
      'is-active', 'podman.socket',
    ]);
    if (!podmanSocketActive.ok) failures.push('PODMAN_SOCKET_SYSTEMD_INSPECTION_FAILED');
    const allowedEndpoint = authority.dockerExclusion.allowedCompatibilityEnvironment.DOCKER_HOST;
    const unexpectedContainerApiEndpoints = [...new Set([
      ...podmanTcpListeners,
      ...podmanConnections.filter((endpoint) => endpoint !== allowedEndpoint),
      ...environmentRemoteEndpoints(this.environment, socketPath),
    ])];
    return {
      dockerExecutablePaths: [...dockerExecutablePaths].sort(),
      forbiddenSockets,
      systemdUnits,
      forbiddenProcesses,
      forbiddenTcpListeners,
      unexpectedContainerApiEndpoints,
      podmanConnections: podmanConnections.filter((endpoint) => endpoint !== allowedEndpoint),
      podmanMachines,
      rootlessSocketPaths,
      otherWslBackends,
      podmanSocket: {
        path: podmanInfo.socketPath ?? '',
        kind: socketObservation.kind,
        symbolicLink: socketObservation.symbolicLink,
        uid: socketObservation.uid,
        gid: socketObservation.gid,
        mode: socketObservation.mode,
        systemdActive: podmanSocketActive.ok && podmanSocketActive.value.trim() === 'active',
        tcpEndpoints: podmanTcpListeners,
        rootless: podmanInfo.rootless,
      },
      inspectionFailures: [...new Set(failures)].sort(),
    };
  }
}

async function inspectIsolationPodmanInfo(
  runner: RuntimeCommandRunner,
  failures: string[],
): Promise<{ readonly socketPath: string | null; readonly rootless: boolean | null }> {
  const result = await runText(runner, undefined, 'podman', ['info', '--format', 'json']);
  if (!result.ok) {
    failures.push('PODMAN_INFO_INSPECTION_FAILED');
    return { socketPath: null, rootless: null };
  }
  try {
    const value = JSON.parse(result.value) as unknown;
    if (!isRecord(value)) throw new Error('INVALID');
    const host = isRecord(value['host']) ? value['host'] : {};
    const remoteSocket = isRecord(host['remoteSocket']) ? host['remoteSocket'] : {};
    const security = isRecord(host['security']) ? host['security'] : {};
    return {
      socketPath: typeof remoteSocket['path'] === 'string' ? remoteSocket['path'] : null,
      rootless: typeof security['rootless'] === 'boolean' ? security['rootless'] : null,
    };
  } catch {
    failures.push('PODMAN_INFO_INSPECTION_INVALID');
    return { socketPath: null, rootless: null };
  }
}

async function inspectRegisteredWslBackends(
  runner: RuntimeCommandRunner,
  expectedDistribution: string,
  failures: string[],
): Promise<readonly string[]> {
  const result = await runText(runner, undefined, 'wsl.exe', ['--list', '--quiet']);
  if (!result.ok) {
    failures.push('WSL_REGISTERED_BACKEND_INSPECTION_FAILED');
    return [];
  }
  return parseRegisteredWslBackends(result.value, expectedDistribution);
}

export function parseRegisteredWslBackends(
  output: string,
  expectedDistribution: string,
): readonly string[] {
  return [...new Set(output.replaceAll('\0', '').split(/\r?\n/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== expectedDistribution))];
}

async function inspectSocketPath(path: string): Promise<{
  readonly path: string;
  readonly kind: FormalPreflightAuthorityIsolationObservation['podmanSocket']['kind'];
  readonly symbolicLink: boolean;
  readonly target: string | null;
  readonly uid: number | null;
  readonly gid: number | null;
  readonly mode: string | null;
}> {
  try {
    const stats = await lstat(path);
    const symbolicLink = stats.isSymbolicLink();
    return {
      path,
      kind: symbolicLink
        ? 'symbolic-link'
        : stats.isSocket()
          ? 'socket'
          : stats.isFile()
            ? 'file'
            : stats.isDirectory()
              ? 'directory'
              : 'other',
      symbolicLink,
      target: symbolicLink ? await readlink(path) : null,
      uid: stats.uid,
      gid: stats.gid,
      mode: '0' + (stats.mode & 0o777).toString(8),
    };
  } catch (error) {
    if (!isMissing(error)) throw error;
    return { path, kind: 'missing', symbolicLink: false, target: null, uid: null, gid: null, mode: null };
  }
}

async function inspectSystemdUnit(
  runner: RuntimeCommandRunner,
  name: string,
): Promise<FormalPreflightAuthorityIsolationObservation['systemdUnits'][number]> {
  const result = await runText(runner, undefined, 'systemctl', [
    'show', name, '--property=LoadState,ActiveState,UnitFileState,SubState', '--no-pager',
  ]);
  if (!result.ok) {
    return { name, loadState: 'unknown', activeState: 'unknown', unitFileState: 'unknown', subState: 'unknown' };
  }
  const fields = Object.fromEntries(result.value.split(/\r?\n/u).flatMap((line) => {
    const separator = line.indexOf('=');
    return separator > 0 ? [[line.slice(0, separator), line.slice(separator + 1)]] : [];
  }));
  return {
    name,
    loadState: fields['LoadState'] ?? 'unknown',
    activeState: fields['ActiveState'] ?? 'unknown',
    unitFileState: fields['UnitFileState'] ?? 'unknown',
    subState: fields['SubState'] ?? 'unknown',
  };
}

async function inspectForbiddenProcesses(
  forbiddenNames: readonly string[],
  failures: string[],
): Promise<readonly { readonly pid: number; readonly name: string }[]> {
  const forbidden = new Set(forbiddenNames);
  try {
    const entries = await readdir('/proc', { withFileTypes: true });
    const findings = await Promise.all(entries.flatMap((entry) => /^\d+$/u.test(entry.name)
      ? [readFile(join('/proc', entry.name, 'comm'), 'utf8').then((value) => ({
        pid: Number(entry.name),
        name: value.trim(),
      })).catch(() => null)]
      : []));
    return findings.filter((value): value is { readonly pid: number; readonly name: string } =>
      value !== null && forbidden.has(value.name),
    );
  } catch {
    failures.push('PROCESS_INSPECTION_FAILED');
    return [];
  }
}

async function inspectTcpListeners(
  runner: RuntimeCommandRunner,
  failures: string[],
): Promise<readonly FormalPreflightAuthorityIsolationObservation['forbiddenTcpListeners'][number][]> {
  const result = await runText(runner, undefined, 'ss', ['-H', '-ltnp']);
  if (!result.ok) {
    failures.push('TCP_LISTENER_INSPECTION_FAILED');
    return [];
  }
  return result.value.split(/\r?\n/u).flatMap((line) => {
    const endpoint = line.trim().split(/\s+/u)[3];
    const match = /^(.*):(\d+)$/u.exec(endpoint ?? '');
    if (match?.[1] === undefined || match[2] === undefined) return [];
    const processMatch = /users:\(\("([^"]+)"/u.exec(line);
    return [{ address: match[1], port: Number(match[2]), process: processMatch?.[1] ?? null }];
  });
}

async function inspectPodmanConnections(
  runner: RuntimeCommandRunner,
  failures: string[],
): Promise<readonly string[]> {
  const result = await runText(runner, undefined, 'podman', ['system', 'connection', 'list', '--format', 'json']);
  if (!result.ok) {
    failures.push('PODMAN_CONNECTION_INSPECTION_FAILED');
    return [];
  }
  try {
    const values = JSON.parse(result.value) as unknown;
    return Array.isArray(values) ? values.flatMap((value) => {
      if (!isRecord(value)) return [];
      const uri = value['URI'] ?? value['Uri'] ?? value['uri'];
      return typeof uri === 'string' ? [uri] : [];
    }) : [];
  } catch {
    failures.push('PODMAN_CONNECTION_INSPECTION_INVALID');
    return [];
  }
}

async function inspectPodmanMachines(
  runner: RuntimeCommandRunner,
  failures: string[],
): Promise<readonly string[]> {
  const result = await runText(runner, undefined, 'podman', ['machine', 'list', '--format', 'json']);
  if (!result.ok) {
    failures.push('PODMAN_MACHINE_INSPECTION_FAILED');
    return [];
  }
  try {
    const values = JSON.parse(result.value) as unknown;
    return Array.isArray(values) ? values.flatMap((value) => {
      if (!isRecord(value)) return [];
      const name = value['Name'] ?? value['name'];
      return typeof name === 'string' && name.length > 0 ? [name] : [];
    }) : [];
  } catch {
    failures.push('PODMAN_MACHINE_INSPECTION_INVALID');
    return [];
  }
}

async function inspectRootlessPodmanSockets(failures: string[]): Promise<readonly string[]> {
  try {
    const users = await readdir('/run/user', { withFileTypes: true });
    const findings: string[] = [];
    for (const user of users.filter((entry) => entry.isDirectory())) {
      const path = join('/run/user', user.name, 'podman', 'podman.sock');
      const observation = await inspectSocketPath(path);
      if (observation.kind !== 'missing') findings.push(path);
    }
    return findings;
  } catch (error) {
    if (!isMissing(error)) failures.push('ROOTLESS_SOCKET_INSPECTION_FAILED');
    return [];
  }
}

function environmentRemoteEndpoints(environment: Readonly<NodeJS.ProcessEnv>, socketPath: string): readonly string[] {
  const allowed = 'unix://' + socketPath;
  return ['DOCKER_HOST', 'CONTAINER_HOST'].flatMap((name) => {
    const value = environment[name];
    return nonEmpty(value) && value !== allowed ? [value] : [];
  });
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

function wslConfigurationMatchesAuthority(
  configuration: WslHostEvidence['configuration'],
  authority: RuntimeAuthority['host'],
): boolean {
  return configuration.present &&
    configuration.processors === String(authority.processorCount) &&
    configuration.memory !== undefined &&
    authority.wslConfigMemoryValues.some((value) =>
      value.toUpperCase() === configuration.memory?.toUpperCase(),
    ) &&
    configuration.swap !== undefined &&
    authority.wslConfigSwapValues.some((value) => value === configuration.swap);
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
  let labels: Readonly<Record<string, string>>;
  if (isRecord(value)) {
    labels = Object.fromEntries(Object.entries(value).flatMap(([name, item]) =>
      typeof item === 'string' ? [[name, item]] : [],
    ));
  } else if (typeof value === 'string') {
    labels = Object.fromEntries(value.split(',').flatMap((item) => {
      const separator = item.indexOf('=');
      if (separator <= 0) return [];
      return [[item.slice(0, separator), item.slice(separator + 1)]];
    }));
  } else {
    labels = {};
  }
  return projectGovernedRuntimeLabels(labels);
}

const GOVERNED_RUNTIME_LABEL_NAMES = [
  'hdi.repository',
  'hdi.phase',
  'hdi.run-id',
  'hdi.run-sequence',
  'hdi.managed-by',
] as const;

function projectGovernedRuntimeLabels(
  labels: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(GOVERNED_RUNTIME_LABEL_NAMES.flatMap((name) =>
    typeof labels[name] === 'string' ? [[name, labels[name]]] : [],
  ));
}

export function parsePodmanContainerRestartPolicy(inspected: unknown): string | null {
  if (!isRecord(inspected)) return null;
  const hostConfig = isRecord(inspected['HostConfig']) ? inspected['HostConfig'] : {};
  const policy = isRecord(hostConfig['RestartPolicy']) ? hostConfig['RestartPolicy'] : {};
  return stringField(policy, 'Name') || null;
}

export function isRepositoryPodmanResource(
  resource: PodmanResourceObservation,
  repositoryLabel?: string,
): boolean {
  return (repositoryLabel !== undefined && resource.labels['hdi.repository'] === repositoryLabel) ||
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

function nonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function endpointScheme(value: string | undefined): string | null {
  if (!nonEmpty(value)) return null;
  const separator = value.indexOf('://');
  return separator > 0 ? value.slice(0, separator).toLowerCase() : 'unknown';
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
