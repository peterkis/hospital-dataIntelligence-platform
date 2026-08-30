import { describe, expect, it } from 'vitest';
import {
  FORMAL_REQUIRED_SECRET_NAMES,
  FORMAL_RUNTIME_PORTS,
  createFormalRunSeed,
  type RuntimeCommandResult,
  type RuntimeCommandRunner,
  type RuntimeCommandSpec,
} from './formal-runtime-contract.js';
import {
  isRepositoryPodmanResource,
  runFormalPreflight,
  type FormalPreflightDependencies,
} from './formal-preflight.js';

const GIT_SHA = 'a'.repeat(40);
const LOCK_SHA = 'b'.repeat(64);
const PRODUCER_SOURCE_MANIFEST_SHA256 = 'c'.repeat(64);
const RUN = createFormalRunSeed(5, () => '12345678-1234-1234-1234-123456789abc');

describe('formal ABG preflight', () => {
  it('passes a fully matching injected environment without exposing secret values', async () => {
    const dependencies = passingDependencies();
    const report = await execute(dependencies);

    expect(report.status).toBe('PASSED');
    expect(report.runIdentity).toEqual({ ...RUN, gitCommitSha: GIT_SHA });
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

  it('recognizes an HDI runtime namespace even when labels are damaged', () => {
    expect(isRepositoryPodmanResource({
      type: 'volume',
      id: 'hdi_phase01_manual_probe_postgres_data',
      name: 'hdi_phase01_manual_probe_postgres_data',
      labels: {},
    })).toBe(true);
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
          networkBackend: 'cni',
          logDriver: 'k8s-file',
          ociRuntimeName: 'runc',
          socketPath: '/run/podman/podman.sock',
          socketActive: true,
          rootless: false,
          images: [
            {
              reference: 'postgres@sha256:' + '1'.repeat(64),
              present: true,
              imageId: 'sha256:' + '2'.repeat(64),
              repoDigests: ['postgres@sha256:' + '1'.repeat(64)],
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
    now: () => '2026-08-27T12:00:00',
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
