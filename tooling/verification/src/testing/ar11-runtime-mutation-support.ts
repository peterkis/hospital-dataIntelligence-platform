import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FORMAL_REQUIRED_SECRET_NAMES,
  type FormalRunIdentity,
  type RuntimeCommandRunner,
} from '../runtime/formal-runtime-contract.js';
import {
  runFormalPreflight,
  type FormalPreflightAuthorityIsolationObservation,
  type FormalPreflightDependencies,
} from '../runtime/formal-preflight.js';
import {
  RUNTIME_AUTHORITY_RELATIVE_PATH,
  canonicalRuntimeAuthorityJson,
  loadPodmanRuntimeAuthority,
  parsePodmanRuntimeAuthority,
} from '../runtime/podman-runtime-authority.js';
import type {
  LoadedPodmanRuntimeAuthority,
  PodmanRuntimeAuthorityDocument,
} from '../runtime/podman-runtime-authority-schema.js';
import {
  assertFormalRuntimeResourceOwned,
  type RuntimeResourceRecord,
} from '../runtime/formal-teardown.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../..');
const GIT_SHA = 'a'.repeat(40);

export interface RuntimeAuthorityMutationFixture {
  readonly bytes: Buffer;
  readonly document: PodmanRuntimeAuthorityDocument;
  readonly loaded: LoadedPodmanRuntimeAuthority;
}

export function validRuntimeAuthorityMutationFixture(): RuntimeAuthorityMutationFixture {
  const bytes = readFileSync(resolve(REPOSITORY_ROOT, RUNTIME_AUTHORITY_RELATIVE_PATH));
  return {
    bytes,
    document: parsePodmanRuntimeAuthority(JSON.parse(bytes.toString('utf8')) as unknown),
    loaded: loadPodmanRuntimeAuthority(REPOSITORY_ROOT),
  };
}

export function cloneRuntimeAuthorityDocument(
  document: PodmanRuntimeAuthorityDocument,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
}

export function assertRuntimeAuthoritySnapshot(input: {
  readonly bytes: Uint8Array | null;
  readonly expectedSha256: string;
  readonly expectedSemanticDigest: string;
}): void {
  if (input.bytes === null) throw new Error('RUNTIME_AUTHORITY_MISSING');
  const actualSha256 = sha256(input.bytes);
  if (actualSha256 !== input.expectedSha256) throw new Error('RUNTIME_AUTHORITY_SHA_MISMATCH');
  const parsed = parsePodmanRuntimeAuthority(
    JSON.parse(Buffer.from(input.bytes).toString('utf8')) as unknown,
  );
  const actualSemanticDigest = sha256(
    Buffer.from(canonicalRuntimeAuthorityJson(parsed.authority), 'utf8'),
  );
  if (actualSemanticDigest !== input.expectedSemanticDigest) {
    throw new Error('RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH');
  }
}

export function assertRuntimeAuthoritySecondSourceMatches(input: {
  readonly runtimeAuthoritySemanticDigest: string;
  readonly secondSourceSemanticDigest: string;
}): void {
  if (input.runtimeAuthoritySemanticDigest !== input.secondSourceSemanticDigest) {
    throw new Error('RUNTIME_AUTHORITY_SECOND_SOURCE_DRIFT');
  }
}

export function assertRuntimeAuthorityStableAfterCleanup(input: {
  readonly beforeSha256: string;
  readonly beforeSemanticDigest: string;
  readonly afterSha256: string;
  readonly afterSemanticDigest: string;
}): void {
  if (input.beforeSha256 !== input.afterSha256 ||
      input.beforeSemanticDigest !== input.afterSemanticDigest) {
    throw new Error('RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP');
  }
}

export function assertContainerRestartPolicy(input: {
  readonly expected: 'no';
  readonly observed: string | null;
}): void {
  if (input.observed !== input.expected) {
    throw new Error('FORMAL_RUNTIME_CONTAINER_RESTART_POLICY_INVALID');
  }
}

export function assertSyntheticFailureCleanup(input: {
  readonly failureKind: 'partial-startup' | 'bootstrap';
  readonly failureStage: string;
  readonly cleanupSucceeded: boolean;
  readonly identity: FormalRunIdentity;
  readonly resources: readonly RuntimeResourceRecord[];
}): void {
  for (const resource of input.resources) assertFormalRuntimeResourceOwned(resource, input.identity);
  if (!input.cleanupSucceeded) throw new Error('FORMAL_RUNTIME_PARTIAL_STARTUP_CLEANUP_FAILED');
  const residue = input.resources.filter((resource) => resource.present);
  if (residue.length === 0) return;
  if (input.failureKind === 'bootstrap') {
    throw new Error('FORMAL_RUNTIME_BOOTSTRAP_FAILURE_RESIDUE');
  }
  throw new Error('FORMAL_RUNTIME_PARTIAL_STARTUP_RESIDUE');
}

export async function runSyntheticPreflightPolicyMutation(
  mutate: (input: {
    readonly observation: FormalPreflightAuthorityIsolationObservation;
    readonly environment: NodeJS.ProcessEnv;
  }) => void,
): Promise<readonly string[]> {
  const loaded = loadPodmanRuntimeAuthority(REPOSITORY_ROOT);
  const authority = loaded.authority;
  const observation = passingIsolationObservation(authority.podman.socketPath);
  const environment: NodeJS.ProcessEnv = { WSL_DISTRO_NAME: authority.host.distribution };
  for (const [index, name] of FORMAL_REQUIRED_SECRET_NAMES.entries()) {
    environment[name] = `synthetic-secret-${index}-present`;
  }
  mutate({ observation, environment });
  const report = await runFormalPreflight({
    repositoryRoot: 'D:/synthetic-repository',
    outputDirectory: 'D:/synthetic-evidence/new-run',
    run: {
      runId: 'ar11-runtime-mutation-run',
      runSequence: 111,
      runtimeNamespace: 'hdi_phase01_abg_111_ar11runtime',
    },
    producerSourceManifestSha256: 'b'.repeat(64),
  }, passingPreflightDependencies(loaded, observation, environment));
  return report.checks.flatMap((check) => check.errorCode === null ? [] : [check.errorCode]);
}

function passingPreflightDependencies(
  loaded: LoadedPodmanRuntimeAuthority,
  observation: FormalPreflightAuthorityIsolationObservation,
  environment: NodeJS.ProcessEnv,
): FormalPreflightDependencies {
  const authority = loaded.authority;
  const commandRunner: RuntimeCommandRunner = {
    async run(command) {
      const output = command.executable === 'git' && command.args[0] === 'status' ? ''
        : command.executable === 'git' && command.args[0] === 'rev-parse' ? `${GIT_SHA}\n`
        : command.executable === 'git' && command.args[0] === 'branch' ? 'phase-01-acceptance-readiness\n'
        : command.executable === 'npm' ? '11.9.0\n'
        : command.executable === 'uname' ? `${authority.host.architecture}\n`
        : command.executable === 'ps' ? `${authority.host.initProcess}\n`
        : command.executable === 'timedatectl' ? `${authority.host.timezone}\n`
        : command.executable === 'nproc' ? `${authority.host.processorCount}\n`
        : '';
      return { exitCode: 0, signal: null, stdout: output, stderr: '' };
    },
  };
  return {
    commandRunner,
    fileSystem: {
      async exists(path) {
        return path.replaceAll('\\', '/').endsWith('/package-lock.json');
      },
      async readText(path) {
        if (path.replaceAll('\\', '/').endsWith('/package.json')) {
          return JSON.stringify({ engines: { node: '24.18.0', npm: '11.9.0' } });
        }
        if (path === '/etc/os-release') {
          return `ID=${authority.host.osId}\nVERSION_ID="${authority.host.osVersion}"\n`;
        }
        if (path === '/proc/meminfo') {
          return `MemTotal: ${authority.host.memoryBytes / 1024} kB\nSwapTotal: 0 kB\n`;
        }
        throw new Error(`SYNTHETIC_PREFLIGHT_READ_UNEXPECTED:${path}`);
      },
      async sha256() { return 'c'.repeat(64); },
      async disk(path) {
        return path === '/'
          ? { totalBytes: authority.host.rootFilesystemBytes, availableBytes: authority.host.minimumRootAvailableBytes }
          : { totalBytes: authority.host.minimumHostAvailableBytes * 2, availableBytes: authority.host.minimumHostAvailableBytes };
      },
    },
    containerRuntime: {
      async inspect() {
        return {
          podmanVersion: authority.podman.version,
          graphDriverName: authority.podman.storageDriver,
          graphRoot: authority.podman.graphRoot,
          runRoot: authority.podman.runRoot,
          networkBackend: authority.podman.networkBackend,
          logDriver: authority.podman.logDriver,
          ociRuntimeName: authority.podman.ociRuntime,
          cgroupManager: authority.podman.cgroupManager,
          eventsBackend: authority.podman.eventsBackend,
          socketPath: authority.podman.socketPath,
          socketActive: true,
          rootless: authority.podman.rootless,
          images: Object.values(authority.images).map((image, index) => ({
            reference: image.runtimeReference,
            present: true,
            imageId: `sha256:${String(index + 1).repeat(64)}`,
            repoDigests: [image.runtimeReference],
          })),
          repositoryResources: [],
        };
      },
    },
    authorityIsolation: { async inspect() { return observation; } },
    ports: {
      async inspect(ports) {
        return ports.map((port) => ({ port, occupied: false, verificationError: null }));
      },
    },
    host: {
      async inspect() {
        return {
          runningDistributions: [authority.host.distribution],
          configuration: {
            present: true,
            processors: String(authority.host.processorCount),
            memory: '4GB',
            swap: '0',
          },
        };
      },
    },
    environment,
    nodeVersion: 'v24.18.0',
    async readFrozenInputs(_repositoryRoot, producerSourceManifestSha256) {
      return { gitCommitSha: GIT_SHA, producerSourceManifestSha256 };
    },
    async loadRuntimeAuthority() { return loaded; },
    now: () => '2026-08-30T12:00:00',
  };
}

function passingIsolationObservation(
  socketPath: string,
): FormalPreflightAuthorityIsolationObservation {
  return {
    dockerExecutablePaths: [],
    forbiddenSockets: [],
    systemdUnits: [],
    forbiddenProcesses: [],
    forbiddenTcpListeners: [],
    unexpectedContainerApiEndpoints: [],
    podmanConnections: [],
    podmanMachines: [],
    rootlessSocketPaths: [],
    otherWslBackends: [],
    podmanSocket: {
      path: socketPath,
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

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
