import { describe, expect, it } from 'vitest';
import {
  FORMAL_REQUIRED_SECRET_NAMES,
  FORMAL_RUNTIME_PORTS,
  createFormalRunSeed,
  formalRuntimeLabels,
  type RuntimeCommandResult,
  type RuntimeCommandRunner,
  type RuntimeCommandSpec,
} from './formal-runtime-contract.js';
import {
  isRepositoryPodmanResource,
  parseRegisteredWslBackends,
  parsePodmanContainerRestartPolicy,
  runFormalPreflight,
  type FormalPreflightAuthorityIsolationObservation,
  type FormalPreflightDependencies,
} from './formal-preflight.js';
import type { PodmanRuntimeAuthority } from './podman-runtime-authority-schema.js';

const GIT_SHA = 'a'.repeat(40);
const LOCK_SHA = 'b'.repeat(64);
const PRODUCER_SOURCE_MANIFEST_SHA256 = 'c'.repeat(64);
const RUNTIME_AUTHORITY_SHA256 = 'e'.repeat(64);
const RUNTIME_AUTHORITY_SEMANTIC_DIGEST = 'f'.repeat(64);
const RUN = createFormalRunSeed(5, () => '12345678-1234-1234-1234-123456789abc');

describe('formal ABG preflight', () => {
  it('passes a fully matching injected environment without exposing secret values', async () => {
    const dependencies = passingDependencies();
    const report = await execute(dependencies);

    expect(report.status).toBe('PASSED');
    expect(report.runIdentity).toEqual({ ...RUN, gitCommitSha: GIT_SHA });
    expect(report.runtimeAuthoritySha256).toBe(RUNTIME_AUTHORITY_SHA256);
    expect(report.runtimeAuthoritySemanticDigest).toBe(RUNTIME_AUTHORITY_SEMANTIC_DIGEST);
    expect(report.checks.find((check) => check.id === 'git-frozen-inputs-readable')?.observed)
      .toMatchObject({
        inputs: { producerSourceManifestSha256: PRODUCER_SOURCE_MANIFEST_SHA256 },
      });
    expect(report.secrets.every((secret) => secret.present)).toBe(true);
    for (const secret of Object.values(dependencies.environment)) {
      if (secret?.startsWith('formal-secret-') === true) {
        expect(JSON.stringify(report)).not.toContain(secret);
      }
    }
  });

  it('fails closed on a port conflict', async () => {
    const dependencies = passingDependencies();
    await expectFailure({
      ...dependencies,
      ports: {
        async inspect(ports) {
          return ports.map((port) => ({
            port,
            occupied: port === 55432,
            verificationError: null,
          }));
        },
      },
    }, 'FORMAL_PREFLIGHT_PORT_OCCUPIED');
  });

  it('fails closed when Node or npm differs from package.json engines', async () => {
    const nodeDependencies = passingDependencies();
    await expectFailure({ ...nodeDependencies, nodeVersion: 'v24.17.0' },
      'FORMAL_PREFLIGHT_NODE_VERSION_MISMATCH');

    const npmDependencies = passingDependencies();
    await expectFailure({
      ...npmDependencies,
      commandRunner: commandRunner({ npmVersion: '11.8.0' }),
    }, 'FORMAL_PREFLIGHT_NPM_VERSION_MISMATCH');
  });

  it('fails closed for the wrong WSL distribution or non-zero swap', async () => {
    const distributionDependencies = passingDependencies();
    await expectFailure({
      ...distributionDependencies,
      environment: { ...distributionDependencies.environment, WSL_DISTRO_NAME: 'Ubuntu-24.04' },
    }, 'FORMAL_PREFLIGHT_WSL_DISTRO_MISMATCH');

    const swapDependencies = passingDependencies();
    await expectFailure({
      ...swapDependencies,
      fileSystem: {
        ...swapDependencies.fileSystem,
        async readText(path) {
          if (path === '/proc/meminfo') return memInfo(1024);
          return swapDependencies.fileSystem.readText(path);
        },
      },
    }, 'FORMAL_PREFLIGHT_WSL_SWAP_NONZERO');
  });

  it('fails closed when the host .wslconfig summary drifts', async () => {
    const dependencies = passingDependencies();
    await expectFailure({
      ...dependencies,
      host: {
        async inspect() {
          return {
            runningDistributions: ['Anolis-8.9-HDI-POC'],
            configuration: { present: true, processors: '4', memory: '4GB', swap: '0' },
          };
        },
      },
    }, 'FORMAL_PREFLIGHT_WSLCONFIG_MISMATCH');
  });

  it('fails closed when a frozen disk threshold is not met', async () => {
    const dependencies = passingDependencies();
    await expectFailure({
      ...dependencies,
      fileSystem: {
        ...dependencies.fileSystem,
        async disk(path) {
          if (path === '/') return { totalBytes: 10 * 1024 ** 3, availableBytes: 1024 ** 3 };
          return dependencies.fileSystem.disk(path);
        },
      },
    }, 'FORMAL_PREFLIGHT_WSL_ROOT_DISK_UNSAFE');
  });

  it('fails closed when a required secret is absent', async () => {
    const dependencies = passingDependencies();
    const environment = { ...dependencies.environment };
    delete environment['SESSION_CSRF_SECRET'];
    const report = await execute({ ...dependencies, environment });

    expect(errorCodes(report)).toContain('FORMAL_PREFLIGHT_SECRETS_MISSING');
    expect(report.secrets.find((secret) => secret.name === 'SESSION_CSRF_SECRET')).toEqual({
      name: 'SESSION_CSRF_SECRET',
      present: false,
    });
  });

  it('fails closed and reports identified residue from this repository', async () => {
    const dependencies = passingDependencies();
    await expectFailure({
      ...dependencies,
      containerRuntime: {
        async inspect() {
          return {
            ...(await dependencies.containerRuntime.inspect()),
            repositoryResources: [{
              type: 'container',
              id: 'residual-container',
              name: 'residual-container',
              labels: {
                'hdi.repository': 'hospital-data-intelligence-platform',
                'hdi.run-id': 'older-run-id',
              },
              ports: '127.0.0.1:55432->5432/tcp',
            }],
          };
        },
      },
    }, 'FORMAL_PREFLIGHT_PODMAN_REPOSITORY_RESIDUE');
  });

  it('projects Podman resource labels to the five governed keys before recording evidence', async () => {
    const dependencies = passingDependencies();
    const sensitiveValue = 'database-password-that-must-not-enter-evidence';
    const report = await execute({
      ...dependencies,
      containerRuntime: {
        async inspect() {
          return {
            ...(await dependencies.containerRuntime.inspect()),
            repositoryResources: [{
              type: 'container',
              id: 'residual-container',
              name: `${RUN.runtimeNamespace}_postgres`,
              labels: {
                ...formalRuntimeLabels(RUN),
                'third-party.sensitive-label': sensitiveValue,
              },
            }],
          };
        },
      },
    });

    const evidence = JSON.stringify(report);
    expect(evidence).toContain(`\"hdi.run-id\":\"${RUN.runId}\"`);
    expect(evidence).not.toContain('third-party.sensitive-label');
    expect(evidence).not.toContain(sensitiveValue);
  });

  it('recognizes an HDI runtime namespace even when labels are damaged', () => {
    expect(isRepositoryPodmanResource({
      type: 'volume',
      id: 'hdi_phase01_manual_probe_postgres_data',
      name: 'hdi_phase01_manual_probe_postgres_data',
      labels: {},
    })).toBe(true);
  });

  it.each([
    ['Docker CLI', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      dockerExecutablePaths: ['/usr/bin/docker'],
    }), 'FORMAL_PREFLIGHT_DOCKER_CLI_PRESENT'],
    ['/run/docker.sock', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenSockets: [{ path: '/run/docker.sock', kind: 'socket', symbolicLink: false, target: null }],
    }), 'FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT'],
    ['Docker socket alias', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenSockets: [{
        path: '/var/run/docker.sock',
        kind: 'symbolic-link',
        symbolicLink: true,
        target: '/run/podman/podman.sock',
      }],
    }), 'FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT'],
    ['docker.service', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      systemdUnits: [{ name: 'docker.service', loadState: 'loaded', activeState: 'active', unitFileState: 'enabled', subState: 'running' }],
    }), 'FORMAL_PREFLIGHT_DOCKER_SYSTEMD_UNIT_PRESENT'],
    ['docker.socket', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      systemdUnits: [{ name: 'docker.socket', loadState: 'loaded', activeState: 'active', unitFileState: 'enabled', subState: 'listening' }],
    }), 'FORMAL_PREFLIGHT_DOCKER_SYSTEMD_UNIT_PRESENT'],
    ['dockerd', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenProcesses: [{ pid: 88, name: 'dockerd' }],
    }), 'FORMAL_PREFLIGHT_DOCKER_PROCESS_PRESENT'],
    ['docker-proxy', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenProcesses: [{ pid: 89, name: 'docker-proxy' }],
    }), 'FORMAL_PREFLIGHT_DOCKER_PROCESS_PRESENT'],
    ['TCP 2375', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenTcpListeners: [{ address: '127.0.0.1', port: 2375, process: 'dockerd' }],
    }), 'FORMAL_PREFLIGHT_CONTAINER_API_TCP_PRESENT'],
    ['TCP 2376', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      forbiddenTcpListeners: [{ address: '0.0.0.0', port: 2376, process: 'dockerd' }],
    }), 'FORMAL_PREFLIGHT_CONTAINER_API_TCP_PRESENT'],
    ['Podman TCP service', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      unexpectedContainerApiEndpoints: ['tcp://127.0.0.1:8888'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_ENDPOINT_PRESENT'],
    ['remote Podman connection', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      podmanConnections: ['ssh://runtime.example/run/podman/podman.sock'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_ENDPOINT_PRESENT'],
    ['Podman machine', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      podmanMachines: ['podman-machine-default'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'],
    ['rootless socket', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      rootlessSocketPaths: ['/run/user/1000/podman/podman.sock'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'],
    ['second WSL backend', (value: FormalPreflightAuthorityIsolationObservation) => ({
      ...value,
      otherWslBackends: ['docker-desktop'],
    }), 'FORMAL_PREFLIGHT_SECOND_RUNTIME_AUTHORITY_PRESENT'],
  ] as const)('fails closed when %s is detected', async (_name, mutate, errorCode) => {
    const dependencies = passingDependencies();
    const baseline = await dependencies.authorityIsolation.inspect();
    await expectFailure({
      ...dependencies,
      authorityIsolation: {
        async inspect() {
          return mutate(baseline) as FormalPreflightAuthorityIsolationObservation;
        },
      },
    }, errorCode);
  });

  it.each([
    [{ DOCKER_HOST: 'tcp://127.0.0.1:2375' }, 'FORMAL_PREFLIGHT_DOCKER_HOST_INVALID'],
    [{ DOCKER_HOST: 'unix:///run/docker.sock' }, 'FORMAL_PREFLIGHT_DOCKER_HOST_INVALID'],
    [{ DOCKER_CONTEXT: 'desktop-linux' }, 'FORMAL_PREFLIGHT_DOCKER_CONTEXT_PRESENT'],
    [{ DOCKER_TLS_VERIFY: '1' }, 'FORMAL_PREFLIGHT_DOCKER_TLS_PRESENT'],
    [{ DOCKER_CERT_PATH: '/unsafe/certs' }, 'FORMAL_PREFLIGHT_DOCKER_TLS_PRESENT'],
    [{ CONTAINER_HOST: 'ssh://runtime.example' }, 'FORMAL_PREFLIGHT_CONTAINER_HOST_INVALID'],
    [{ TESTCONTAINERS_HOST_OVERRIDE: 'runtime.example' }, 'FORMAL_PREFLIGHT_TESTCONTAINERS_HOST_OVERRIDE_INVALID'],
  ])('fails closed for incompatible container environment %o', async (environment, errorCode) => {
    const dependencies = passingDependencies();
    await expectFailure({
      ...dependencies,
      environment: { ...dependencies.environment, ...environment },
    }, errorCode);
  });

  it('allows only the exact Podman compatibility DOCKER_HOST without treating docker.io images as Docker Engine', async () => {
    const dependencies = passingDependencies();
    const report = await execute({
      ...dependencies,
      environment: {
        ...dependencies.environment,
        DOCKER_HOST: 'unix:///run/podman/podman.sock',
      },
    });
    expect(report.status).toBe('PASSED');
    expect(JSON.stringify(report)).toContain('docker.io/library/postgres@sha256');
    expect(errorCodes(report)).not.toContain('FORMAL_PREFLIGHT_DOCKER_CLI_PRESENT');
  });

  it.each([
    [{ symbolicLink: true }, 'FORMAL_PREFLIGHT_PODMAN_SOCKET_SYMLINK'],
    [{ kind: 'file' as const }, 'FORMAL_PREFLIGHT_PODMAN_SOCKET_NOT_UNIX'],
    [{ path: '/run/user/1000/podman/podman.sock' }, 'FORMAL_PREFLIGHT_PODMAN_SOCKET_PATH_MISMATCH'],
    [{ systemdActive: false }, 'FORMAL_PREFLIGHT_PODMAN_SOCKET_INACTIVE'],
    [{ tcpEndpoints: ['tcp://127.0.0.1:9999'] }, 'FORMAL_PREFLIGHT_PODMAN_SOCKET_TCP_EXPOSED'],
    [{ rootless: true }, 'FORMAL_PREFLIGHT_PODMAN_ROOTFUL_REQUIRED'],
  ])('fails closed for rootful Podman socket drift %o', async (drift, errorCode) => {
    const dependencies = passingDependencies();
    const baseline = await dependencies.authorityIsolation.inspect();
    await expectFailure({
      ...dependencies,
      authorityIsolation: {
        async inspect() {
          return { ...baseline, podmanSocket: { ...baseline.podmanSocket, ...drift } };
        },
      },
    }, errorCode);
  });

  it('parses all registered WSL backends and excludes only the authority distribution', () => {
    expect(parseRegisteredWslBackends(
      'Anolis-8.9-HDI-POC\0\r\ndocker-desktop\0\r\nPodman-Machine\0\r\n',
      'Anolis-8.9-HDI-POC',
    )).toEqual(['docker-desktop', 'Podman-Machine']);
  });

  it('reads legacy-container restart policy from HostConfig rather than Config', () => {
    expect(parsePodmanContainerRestartPolicy({
      Config: { RestartPolicy: { Name: 'always' } },
      HostConfig: { RestartPolicy: { Name: 'no' } },
    })).toBe('no');
    expect(parsePodmanContainerRestartPolicy({ Config: { RestartPolicy: { Name: 'always' } } }))
      .toBeNull();
  });
});

async function execute(dependencies: FormalPreflightDependencies) {
  return runFormalPreflight({
    repositoryRoot: 'D:/repository',
    outputDirectory: 'D:/evidence/new-run',
    run: RUN,
    producerSourceManifestSha256: PRODUCER_SOURCE_MANIFEST_SHA256,
  }, dependencies);
}

async function expectFailure(
  dependencies: FormalPreflightDependencies,
  errorCode: string,
): Promise<void> {
  const report = await execute(dependencies);
  expect(report.status).toBe('FAILED');
  expect(errorCodes(report)).toContain(errorCode);
}

function errorCodes(report: Awaited<ReturnType<typeof execute>>): readonly (string | null)[] {
  return report.checks.map((check) => check.errorCode);
}

function passingDependencies(): FormalPreflightDependencies {
  const environment: NodeJS.ProcessEnv = { WSL_DISTRO_NAME: 'Anolis-8.9-HDI-POC' };
  for (const [index, name] of FORMAL_REQUIRED_SECRET_NAMES.entries()) {
    environment[name] = `formal-secret-${index}-value-that-must-not-leak`;
  }
  const fileSystem: FormalPreflightDependencies['fileSystem'] = {
    async exists(path) {
      return path.replaceAll('\\', '/').endsWith('/package-lock.json');
    },
    async readText(path) {
      if (path.replaceAll('\\', '/').endsWith('/package.json')) {
        return JSON.stringify({ engines: { node: '24.18.0', npm: '11.9.0' } });
      }
      if (path === '/etc/os-release') return 'ID=anolis\nVERSION_ID="8.9"\n';
      if (path === '/proc/meminfo') return memInfo(0);
      throw new Error('UNEXPECTED_READ:' + path);
    },
    async sha256() {
      return LOCK_SHA;
    },
    async disk(path) {
      return path === '/'
        ? { totalBytes: 10 * 1024 ** 3, availableBytes: 3 * 1024 ** 3 }
        : { totalBytes: 100 * 1024 ** 3, availableBytes: 6 * 1024 ** 3 };
    },
  };
  return {
    commandRunner: commandRunner(),
    fileSystem,
    containerRuntime: {
      async inspect() {
        return {
          podmanVersion: '4.9.4-rhel',
          graphDriverName: 'overlay',
          graphRoot: '/var/lib/containers/storage',
          runRoot: '/run/containers/storage',
          networkBackend: 'cni',
          logDriver: 'k8s-file',
          ociRuntimeName: 'runc',
          cgroupManager: 'systemd',
          eventsBackend: 'file',
          socketPath: '/run/podman/podman.sock',
          socketActive: true,
          rootless: false,
          images: [
            {
              reference: 'docker.io/library/postgres@sha256:' + '1'.repeat(64),
              present: true,
              imageId: 'sha256:' + '2'.repeat(64),
              repoDigests: ['docker.io/library/postgres@sha256:' + '1'.repeat(64)],
            },
            {
              reference: 'quay.io/keycloak/keycloak@sha256:' + '3'.repeat(64),
              present: true,
              imageId: 'sha256:' + '4'.repeat(64),
              repoDigests: ['quay.io/keycloak/keycloak@sha256:' + '3'.repeat(64)],
            },
          ],
          repositoryResources: [],
        };
      },
    },
    authorityIsolation: {
      async inspect() {
        return passingIsolationObservation();
      },
    },
    ports: {
      async inspect(ports) {
        return ports.map((port) => ({ port, occupied: false, verificationError: null }));
      },
    },
    host: {
      async inspect() {
        return {
          runningDistributions: ['Anolis-8.9-HDI-POC'],
          configuration: { present: true, processors: '8', memory: '4GB', swap: '0' },
        };
      },
    },
    environment,
    nodeVersion: 'v24.18.0',
    async readFrozenInputs(_repositoryRoot, producerSourceManifestSha256) {
      return { gitCommitSha: GIT_SHA, producerSourceManifestSha256 };
    },
    async loadRuntimeAuthority() {
      return {
        authority: TEST_AUTHORITY,
        runtimeAuthoritySha256: RUNTIME_AUTHORITY_SHA256,
        runtimeAuthoritySemanticDigest: RUNTIME_AUTHORITY_SEMANTIC_DIGEST,
      };
    },
    now: () => '2026-08-27T12:00:00',
  };
}

const TEST_AUTHORITY = {
  host: {
    distribution: 'Anolis-8.9-HDI-POC',
    osId: 'anolis',
    osVersion: '8.9',
    architecture: 'x86_64',
    timezone: 'Asia/Shanghai',
    initProcess: 'systemd',
    processorCount: 8,
    memoryBytes: 4 * 1024 ** 3,
    memoryToleranceBytes: 384 * 1024 ** 2,
    swapBytes: 0,
    rootFilesystemBytes: 10 * 1024 ** 3,
    rootFilesystemToleranceBytes: 512 * 1024 ** 2,
    minimumRootAvailableBytes: 2 * 1024 ** 3,
    minimumHostAvailableBytes: 5 * 1024 ** 3,
    wslConfigMemoryValues: ['4GB'],
    wslConfigSwapValues: ['0'],
  },
  podman: {
    version: '4.9.4-rhel',
    packageNevra: 'podman-4.9.4-rhel',
    conmonNevra: 'conmon',
    containersCommonNevra: 'containers-common',
    rootless: false,
    socketPath: '/run/podman/podman.sock',
    storageDriver: 'overlay',
    graphRoot: '/var/lib/containers/storage',
    runRoot: '/run/containers/storage',
    ociRuntime: 'runc',
    ociRuntimeNevra: 'runc',
    networkBackend: 'cni',
    networkPluginsNevra: 'containernetworking-plugins',
    logDriver: 'k8s-file',
    cgroupManager: 'systemd',
    eventsBackend: 'file',
    restartPolicy: 'no',
  },
  network: {
    managedContainerMode: 'host',
    bridgeNetworkingAllowed: false,
    portPublishingAllowed: false,
    bindAddress: '127.0.0.1',
    ports: {
      postgresRuntime: 55432,
      postgresIntegration: 55433,
      keycloakHttp: 18080,
      keycloakManagement: 19000,
      governanceApi: 3000,
      consumerA: 4101,
      consumerB: 4102,
    },
  },
  images: {
    postgresql: {
      declaredVersion: '16.11',
      runtimeReference: 'docker.io/library/postgres@sha256:' + '1'.repeat(64),
      architecture: 'amd64',
      os: 'linux',
    },
    keycloak: {
      declaredVersion: '26.5.1',
      runtimeReference: 'quay.io/keycloak/keycloak@sha256:' + '3'.repeat(64),
      architecture: 'amd64',
      os: 'linux',
    },
  },
  labels: {
    static: {
      'hdi.repository': 'hospital-data-intelligence-platform',
      'hdi.phase': '01',
      'hdi.managed-by': 'formal-abg',
    },
    dynamic: ['hdi.run-id', 'hdi.run-sequence'],
  },
  dockerExclusion: {
    forbiddenExecutableNames: ['docker'],
    forbiddenSocketPaths: ['/run/docker.sock', '/var/run/docker.sock'],
    forbiddenSystemdUnits: ['docker.service', 'docker.socket'],
    forbiddenProcessNames: ['dockerd', 'docker-proxy'],
    forbiddenTcpPorts: [2375, 2376],
    allowedCompatibilityEnvironment: { DOCKER_HOST: 'unix:///run/podman/podman.sock' },
  },
} as const satisfies PodmanRuntimeAuthority;

function passingIsolationObservation(): FormalPreflightAuthorityIsolationObservation {
  return {
    dockerExecutablePaths: [],
    forbiddenSockets: [],
    systemdUnits: [
      { name: 'docker.service', loadState: 'not-found', activeState: 'inactive', unitFileState: 'disabled', subState: 'dead' },
      { name: 'docker.socket', loadState: 'not-found', activeState: 'inactive', unitFileState: 'disabled', subState: 'dead' },
    ],
    forbiddenProcesses: [],
    forbiddenTcpListeners: [],
    unexpectedContainerApiEndpoints: [],
    podmanConnections: [],
    podmanMachines: [],
    rootlessSocketPaths: [],
    otherWslBackends: [],
    podmanSocket: {
      path: '/run/podman/podman.sock',
      kind: 'socket',
      symbolicLink: false,
      uid: 0,
      gid: 0,
      mode: '0660',
      systemdActive: true,
      tcpEndpoints: [],
      rootless: false,
    },
    inspectionFailures: [],
  };
}

function commandRunner(options: { readonly npmVersion?: string } = {}): RuntimeCommandRunner {
  return {
    async run(command: RuntimeCommandSpec): Promise<RuntimeCommandResult> {
      const output = commandOutput(command, options);
      return { exitCode: 0, signal: null, stdout: output, stderr: '' };
    },
  };
}

function commandOutput(
  command: RuntimeCommandSpec,
  options: { readonly npmVersion?: string },
): string {
  if (command.executable === 'git' && command.args[0] === 'status') return '';
  if (command.executable === 'git' && command.args[0] === 'rev-parse') return GIT_SHA + '\n';
  if (command.executable === 'git' && command.args[0] === 'branch') return 'phase-01-acceptance-readiness\n';
  if (command.executable === 'npm') return (options.npmVersion ?? '11.9.0') + '\n';
  if (command.executable === 'uname') return 'x86_64\n';
  if (command.executable === 'ps') return 'systemd\n';
  if (command.executable === 'timedatectl') return 'Asia/Shanghai\n';
  if (command.executable === 'nproc') return '8\n';
  throw new Error('UNEXPECTED_COMMAND:' + command.executable + ':' + command.args.join(':'));
}

function memInfo(swapKilobytes: number): string {
  return `MemTotal:       4194304 kB\nSwapTotal:      ${swapKilobytes} kB\n`;
}

expect(FORMAL_RUNTIME_PORTS).toEqual([55432, 55433, 18080, 19000, 3000, 4101, 4102]);
