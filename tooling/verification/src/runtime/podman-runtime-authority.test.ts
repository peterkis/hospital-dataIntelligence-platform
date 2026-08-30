import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  canonicalRuntimeAuthorityJson,
  loadPodmanRuntimeAuthority,
  parsePodmanRuntimeAuthority,
  RUNTIME_AUTHORITY_RELATIVE_PATH,
} from './podman-runtime-authority.js';

const VALID_AUTHORITY = {
  schemaVersion: 3,
  authorityId: 'phase-01.podman-runtime-authority.v1',
  authority: {
    host: {
      distribution: 'Anolis-8.9-HDI-POC',
      osId: 'anolis',
      osVersion: '8.9',
      architecture: 'x86_64',
      timezone: 'Asia/Shanghai',
      initProcess: 'systemd',
      processorCount: 8,
      memoryBytes: 4_294_967_296,
      memoryToleranceBytes: 402_653_184,
      swapBytes: 0,
      rootFilesystemBytes: 10_737_418_240,
      rootFilesystemToleranceBytes: 536_870_912,
      minimumRootAvailableBytes: 2_147_483_648,
      minimumHostAvailableBytes: 5_368_709_120,
      wslConfigMemoryValues: ['4GB', '4096MB'],
      wslConfigSwapValues: ['0', '0B', '0GB', '0MB'],
    },
    podman: {
      version: '4.9.4-rhel',
      packageNevra: 'podman-4:4.9.4-34.0.1.module+an8.10.0+11435+30029c08.x86_64',
      conmonNevra: 'conmon-3:2.1.10-1.module+an8.10.0+11427+f88b498a.x86_64',
      containersCommonNevra: 'containers-common-2:1-82.0.1.module+an8.10.0+11427+f88b498a.x86_64',
      rootless: false,
      socketPath: '/run/podman/podman.sock',
      storageDriver: 'overlay',
      graphRoot: '/var/lib/containers/storage',
      runRoot: '/run/containers/storage',
      ociRuntime: 'runc',
      ociRuntimeNevra: 'runc-4:1.2.9-4.module+an8.10.0+11427+f88b498a.x86_64',
      networkBackend: 'cni',
      networkPluginsNevra: 'containernetworking-plugins-1:1.4.0-8.0.1.module+an8.10.0+11427+f88b498a.x86_64',
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
        postgresRuntime: 55_432,
        postgresIntegration: 55_433,
        keycloakHttp: 18_080,
        keycloakManagement: 19_000,
        governanceApi: 3_000,
        consumerA: 4_101,
        consumerB: 4_102,
      },
    },
    images: {
      postgresql: {
        declaredVersion: '18.4',
        runtimeReference: 'docker.io/library/postgres@sha256:882236b897e39051d2368c5ccc6cda944904723506b2dfc97f2a8f5bc9afa382',
        architecture: 'amd64',
        os: 'linux',
      },
      keycloak: {
        declaredVersion: '26.7.0',
        runtimeReference: 'quay.io/keycloak/keycloak@sha256:0f198be292568439d700cdbfb893e69a6009bb43a94a06a945b1d3d506c76b13',
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
      forbiddenTcpPorts: [2_375, 2_376],
      allowedCompatibilityEnvironment: {
        DOCKER_HOST: 'unix:///run/podman/podman.sock',
      },
    },
  },
  observations: {
    capturedLocalDateTime: '2026-08-30 01:40:03',
    kernel: '6.6.87.2-microsoft-standard-WSL2',
    tools: {
      node: {
        version: '24.18.0',
        sourceArchive: 'node-v24.18.0-linux-x64.tar.xz',
        sourceSha256: '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742',
      },
      npm: { version: '11.9.0' },
      git: { packageNevra: 'git-2.43.7-1.0.1.an8.x86_64' },
    },
    podman: {
      socketEnabled: true,
      socketActive: true,
      dockerCliPresent: false,
    },
    images: {
      postgresql: {
        discoveryTag: 'postgres:18.4-bookworm',
        imageId: '526573c93ea530a230b553cc513075ab9d70b63bfd2300ef5eb5ad1cafbbc595',
        imageSizeBytes: 447_920_702,
        reportedVersion: 'postgres (PostgreSQL) 18.4 (Debian 18.4-1.pgdg12+1)',
      },
      keycloak: {
        discoveryTag: 'quay.io/keycloak/keycloak:26.7.0',
        imageId: '60e153026e8f53ee2c3877b23aa664a6fb24ea99c57085b40cbb77ca2be01e3d',
        imageSizeBytes: 479_483_731,
        reportedVersion: 'Keycloak 26.7.0',
        reportedJvm: '21.0.12+8-LTS',
      },
    },
    rootFilesystemObservedBytes: 10_464_022_528,
    rootFilesystemUsedBytes: 3_913_121_792,
    rootFilesystemAvailableBytes: 5_997_252_608,
    migration: {
      dockerPackagesRemoved: true,
      dockerDataPathRetained: '/var/lib/docker',
      preRemovalImageArchivePath: '.runtime/podman-migration/frozen-phase-01-images.docker-archive.tar',
      preRemovalImageArchiveSha256: '27a29f742d506a094101aaf7eb0f2ac79ec8383ecc5a7dafe00dee5bc77069b9',
      preRemovalImageArchiveSizeBytes: 927_429_632,
    },
    receipt: {
      path: 'phase-plan/environment/anolis-8.9-wsl2/receipt-20260830-podman.json',
      sha256: '7aafa362c37b6974c834a92ac94e84a22f5e46c1cb81dc49ffbb072aacfce5d9',
    },
  },
  rules: [
    'Runtime and tests use digest references.',
    'Managed containers use host networking and loopback binding.',
  ],
} as const;

describe('Podman runtime authority', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('accepts the complete Phase 01 runtime authority', () => {
    expect(parsePodmanRuntimeAuthority(VALID_AUTHORITY)).toEqual(VALID_AUTHORITY);
    expect(canonicalRuntimeAuthorityJson(VALID_AUTHORITY.authority)).toContain('"restartPolicy":"no"');
    expect(loadPodmanRuntimeAuthority().authority.podman.version).toBe('4.9.4-rhel');
  });

  it('rejects a missing authority id and unknown fields', () => {
    const missing = copyAuthority();
    delete objectAt(missing)['authorityId'];
    expect(() => parsePodmanRuntimeAuthority(missing))
      .toThrow('RUNTIME_AUTHORITY_SCHEMA_INVALID:authorityId:FIELD_REQUIRED');
    const extended = copyAuthority();
    objectAt(extended, 'authority')['secondAuthority'] = {};
    expect(() => parsePodmanRuntimeAuthority(extended))
      .toThrow('RUNTIME_AUTHORITY_SCHEMA_INVALID:authority.secondAuthority:UNKNOWN_FIELD');
  });

  it.each([
    ['rootless Podman', ['authority', 'podman', 'rootless'], true, 'RUNTIME_AUTHORITY_ROOTLESS_FORBIDDEN'],
    ['unexpected socket', ['authority', 'podman', 'socketPath'], '/var/run/podman.sock', 'RUNTIME_AUTHORITY_SOCKET_PATH_INVALID'],
    ['TCP socket', ['authority', 'podman', 'socketPath'], 'tcp://127.0.0.1:8080', 'RUNTIME_AUTHORITY_SOCKET_MUST_BE_UNIX'],
    ['storage drift', ['authority', 'podman', 'storageDriver'], 'vfs', 'RUNTIME_AUTHORITY_STORAGE_DRIVER_INVALID'],
    ['OCI drift', ['authority', 'podman', 'ociRuntime'], 'crun', 'RUNTIME_AUTHORITY_OCI_RUNTIME_INVALID'],
    ['network drift', ['authority', 'podman', 'networkBackend'], 'netavark', 'RUNTIME_AUTHORITY_NETWORK_BACKEND_INVALID'],
    ['log drift', ['authority', 'podman', 'logDriver'], 'journald', 'RUNTIME_AUTHORITY_LOG_DRIVER_INVALID'],
    ['persistent restart', ['authority', 'podman', 'restartPolicy'], 'unless-stopped', 'RUNTIME_AUTHORITY_RESTART_POLICY_INVALID'],
    ['bridge permission', ['authority', 'network', 'bridgeNetworkingAllowed'], true, 'RUNTIME_AUTHORITY_BRIDGE_NETWORKING_FORBIDDEN'],
    ['port publishing', ['authority', 'network', 'portPublishingAllowed'], true, 'RUNTIME_AUTHORITY_PORT_PUBLISHING_FORBIDDEN'],
    ['non-loopback binding', ['authority', 'network', 'bindAddress'], '0.0.0.0', 'RUNTIME_AUTHORITY_BIND_ADDRESS_INVALID'],
  ] as const)('rejects %s', (_case, path, value, errorCode) => {
    const document = copyAuthority();
    setAt(document, path, value);
    expect(() => parsePodmanRuntimeAuthority(document)).toThrow(errorCode);
  });

  it('rejects image references without a registry digest', () => {
    const document = copyAuthority();
    objectAt(document, 'authority', 'images', 'postgresql')['runtimeReference'] = 'postgres:18.4-bookworm';
    expect(() => parsePodmanRuntimeAuthority(document))
      .toThrow('RUNTIME_AUTHORITY_IMAGE_DIGEST_REQUIRED:postgresql');
  });

  it('rejects duplicate managed ports', () => {
    const document = copyAuthority();
    objectAt(document, 'authority', 'network', 'ports')['consumerB'] = 4_101;
    expect(() => parsePodmanRuntimeAuthority(document)).toThrow('RUNTIME_AUTHORITY_PORT_DUPLICATE');
  });

  it.each([
    [
      'Docker CLI exclusion',
      ['authority', 'dockerExclusion', 'forbiddenExecutableNames'],
      ['dockerd', 'docker-proxy'],
      'RUNTIME_AUTHORITY_DOCKER_EXECUTABLE_EXCLUSION_INCOMPLETE',
    ],
    [
      'Docker socket exclusion',
      ['authority', 'dockerExclusion', 'forbiddenSocketPaths'],
      ['/run/docker.sock'],
      'RUNTIME_AUTHORITY_DOCKER_SOCKET_EXCLUSION_INCOMPLETE',
    ],
    [
      'Docker systemd exclusion',
      ['authority', 'dockerExclusion', 'forbiddenSystemdUnits'],
      ['docker.service'],
      'RUNTIME_AUTHORITY_DOCKER_SYSTEMD_EXCLUSION_INCOMPLETE',
    ],
    [
      'Docker process exclusion',
      ['authority', 'dockerExclusion', 'forbiddenProcessNames'],
      ['dockerd'],
      'RUNTIME_AUTHORITY_DOCKER_PROCESS_EXCLUSION_INCOMPLETE',
    ],
    [
      'Docker TCP exclusion',
      ['authority', 'dockerExclusion', 'forbiddenTcpPorts'],
      [2_375],
      'RUNTIME_AUTHORITY_DOCKER_TCP_EXCLUSION_INCOMPLETE',
    ],
    [
      'exact compatibility endpoint',
      ['authority', 'dockerExclusion', 'allowedCompatibilityEnvironment', 'DOCKER_HOST'],
      'unix:///var/run/podman.sock',
      'RUNTIME_AUTHORITY_COMPATIBILITY_ENDPOINT_INVALID',
    ],
  ] as const)('requires the %s minimum', (_case, path, replacement, errorCode) => {
    const document = copyAuthority();
    setAt(document, path, replacement);
    expect(() => parsePodmanRuntimeAuthority(document)).toThrow(errorCode);
  });

  it('canonicalizes authority objects deterministically regardless of key order', () => {
    const parsed = parsePodmanRuntimeAuthority(copyAuthority());
    const reverseOrdered = Object.fromEntries(Object.entries(parsed.authority).reverse());
    expect(canonicalRuntimeAuthorityJson(reverseOrdered as typeof parsed.authority))
      .toBe(canonicalRuntimeAuthorityJson(parsed.authority));
  });

  it('keeps observation changes out of the semantic digest but binds authority changes', async () => {
    const repositoryRoot = await createRepositoryAuthority(copyAuthority());
    const original = loadPodmanRuntimeAuthority(repositoryRoot);

    const observationChange = copyAuthority();
    objectAt(observationChange, 'observations')['kernel'] = 'new-observation-only-kernel';
    await writeAuthority(repositoryRoot, observationChange);
    const observed = loadPodmanRuntimeAuthority(repositoryRoot);
    expect(observed.runtimeAuthoritySha256).not.toBe(original.runtimeAuthoritySha256);
    expect(observed.runtimeAuthoritySemanticDigest).toBe(original.runtimeAuthoritySemanticDigest);

    const observationWhitespace = `${JSON.stringify(observationChange)}   \n`;
    await writeAuthorityBytes(repositoryRoot, observationWhitespace);
    const whitespaceChanged = loadPodmanRuntimeAuthority(repositoryRoot);
    expect(whitespaceChanged.runtimeAuthoritySha256).not.toBe(observed.runtimeAuthoritySha256);
    expect(whitespaceChanged.runtimeAuthoritySemanticDigest).toBe(original.runtimeAuthoritySemanticDigest);

    const authorityChange = copyAuthority();
    objectAt(authorityChange, 'authority', 'host')['memoryToleranceBytes'] = 402_653_185;
    await writeAuthority(repositoryRoot, authorityChange);
    const changed = loadPodmanRuntimeAuthority(repositoryRoot);
    expect(changed.runtimeAuthoritySemanticDigest).not.toBe(original.runtimeAuthoritySemanticDigest);
    expect(changed.runtimeAuthoritySha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(changed.runtimeAuthoritySemanticDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(changed.authority.podman.restartPolicy).toBe('no');
  });

  it('uses stable missing and malformed authority errors', async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'phase-01-runtime-authority-missing-'));
    temporaryDirectories.push(repositoryRoot);
    expect(() => loadPodmanRuntimeAuthority(repositoryRoot)).toThrow('RUNTIME_AUTHORITY_MISSING');
    await writeAuthorityBytes(repositoryRoot, '{broken');
    expect(() => loadPodmanRuntimeAuthority(repositoryRoot)).toThrow('RUNTIME_AUTHORITY_JSON_INVALID');
  });

  async function createRepositoryAuthority(value: unknown): Promise<string> {
    const repositoryRoot = await mkdtemp(join(tmpdir(), 'phase-01-runtime-authority-'));
    temporaryDirectories.push(repositoryRoot);
    await writeAuthority(repositoryRoot, value);
    return repositoryRoot;
  }
});

async function writeAuthority(repositoryRoot: string, value: unknown): Promise<void> {
  await writeAuthorityBytes(repositoryRoot, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAuthorityBytes(repositoryRoot: string, value: string): Promise<void> {
  const path = join(repositoryRoot, RUNTIME_AUTHORITY_RELATIVE_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function copyAuthority(): unknown {
  return JSON.parse(JSON.stringify(VALID_AUTHORITY)) as unknown;
}

function objectAt(value: unknown, ...path: readonly string[]): Record<string, unknown> {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) {
      throw new Error(`TEST_FIXTURE_PATH_INVALID:${path.join('.')}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === null || typeof current !== 'object' || Array.isArray(current)) {
    throw new Error(`TEST_FIXTURE_PATH_INVALID:${path.join('.')}`);
  }
  return current as Record<string, unknown>;
}

function setAt(value: unknown, path: readonly string[], replacement: unknown): void {
  const parent = objectAt(value, ...path.slice(0, -1));
  const key = path.at(-1);
  if (key === undefined) throw new Error('TEST_FIXTURE_PATH_EMPTY');
  parent[key] = replacement;
}
