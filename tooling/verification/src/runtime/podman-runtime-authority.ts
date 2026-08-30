import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
  PODMAN_RUNTIME_AUTHORITY_ID,
  PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION,
  type FormalRuntimeAuthoritySnapshot,
  type LoadedPodmanRuntimeAuthority,
  type PodmanRuntimeAuthority,
  type PodmanRuntimeAuthorityDocument,
} from './podman-runtime-authority-schema.js';

export const RUNTIME_AUTHORITY_RELATIVE_PATH =
  'phase-plan/environment/anolis-8.9-wsl2/runtime-baseline.lock.json' as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const IMAGE_DIGEST_PATTERN = /^[a-z0-9.-]+(?::[0-9]+)?\/[A-Za-z0-9._/-]+@sha256:[0-9a-f]{64}$/u;

export function loadPodmanRuntimeAuthority(
  repositoryRoot: string = resolve(import.meta.dirname, '../../../..'),
): LoadedPodmanRuntimeAuthority {
  let bytes: Buffer;
  try {
    bytes = readFileSync(resolve(repositoryRoot, RUNTIME_AUTHORITY_RELATIVE_PATH));
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') throw new Error('RUNTIME_AUTHORITY_MISSING');
    throw new Error('RUNTIME_AUTHORITY_READ_FAILED');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('RUNTIME_AUTHORITY_JSON_INVALID');
  }
  const document = parsePodmanRuntimeAuthority(raw);
  return {
    authority: document.authority,
    runtimeAuthoritySha256: sha256(bytes),
    runtimeAuthoritySemanticDigest: sha256(
      Buffer.from(canonicalRuntimeAuthorityJson(document.authority), 'utf8'),
    ),
  };
}

export function parsePodmanRuntimeAuthority(value: unknown): PodmanRuntimeAuthorityDocument {
  const root = exactRecord(value, '', ['schemaVersion', 'authorityId', 'authority', 'observations', 'rules']);
  literal(root['schemaVersion'], PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION, 'schemaVersion');
  literal(root['authorityId'], PODMAN_RUNTIME_AUTHORITY_ID, 'authorityId');
  validateAuthority(root['authority']);
  validateObservations(root['observations']);
  stringArray(root['rules'], 'rules', true);
  return value as PodmanRuntimeAuthorityDocument;
}

export function canonicalRuntimeAuthorityJson(value: PodmanRuntimeAuthority): string {
  return canonicalJson(value);
}

export function createFormalRuntimeAuthoritySnapshot(input: {
  readonly runIdentity: FormalRuntimeAuthoritySnapshot['runIdentity'];
  readonly runtimeAuthority: LoadedPodmanRuntimeAuthority;
}): FormalRuntimeAuthoritySnapshot {
  const snapshot: FormalRuntimeAuthoritySnapshot = {
    schemaVersion: FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    authoritySchemaVersion: PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION,
    authorityId: PODMAN_RUNTIME_AUTHORITY_ID,
    runIdentity: input.runIdentity,
    runtimeAuthoritySha256: input.runtimeAuthority.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: input.runtimeAuthority.runtimeAuthoritySemanticDigest,
    authority: input.runtimeAuthority.authority,
  };
  return parseFormalRuntimeAuthoritySnapshot(snapshot);
}

export function parseFormalRuntimeAuthoritySnapshot(value: unknown): FormalRuntimeAuthoritySnapshot {
  const root = exactRecord(value, '', [
    'schemaVersion', 'authoritySchemaVersion', 'authorityId', 'runIdentity',
    'runtimeAuthoritySha256', 'runtimeAuthoritySemanticDigest', 'authority',
  ]);
  literal(
    root['schemaVersion'],
    FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SCHEMA_VERSION,
    'schemaVersion',
  );
  literal(
    root['authoritySchemaVersion'],
    PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION,
    'authoritySchemaVersion',
  );
  literal(root['authorityId'], PODMAN_RUNTIME_AUTHORITY_ID, 'authorityId');
  validateFormalRunIdentity(root['runIdentity']);
  sha256String(root['runtimeAuthoritySha256'], 'runtimeAuthoritySha256');
  sha256String(root['runtimeAuthoritySemanticDigest'], 'runtimeAuthoritySemanticDigest');
  validateAuthority(root['authority']);
  const computedSemanticDigest = sha256(Buffer.from(
    canonicalRuntimeAuthorityJson(root['authority'] as PodmanRuntimeAuthority),
    'utf8',
  ));
  if (root['runtimeAuthoritySemanticDigest'] !== computedSemanticDigest) {
    throw new Error('RUNTIME_AUTHORITY_SNAPSHOT_SEMANTIC_DIGEST_MISMATCH');
  }
  return value as FormalRuntimeAuthoritySnapshot;
}

function validateFormalRunIdentity(value: unknown): void {
  const identity = exactRecord(value, 'runIdentity', [
    'runId', 'runSequence', 'runtimeNamespace', 'gitCommitSha',
  ]);
  if (typeof identity['runId'] !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9-]{7,127}$/u.test(identity['runId'])) {
    schemaError('runIdentity.runId', 'VALUE_INVALID');
  }
  if (!Number.isSafeInteger(identity['runSequence']) || (identity['runSequence'] as number) <= 0) {
    schemaError('runIdentity.runSequence', 'POSITIVE_INTEGER_REQUIRED');
  }
  nonEmptyString(identity['runtimeNamespace'], 'runIdentity.runtimeNamespace');
  if (typeof identity['gitCommitSha'] !== 'string' ||
      !/^[0-9a-f]{40}$/u.test(identity['gitCommitSha'])) {
    schemaError('runIdentity.gitCommitSha', 'VALUE_INVALID');
  }
}

function validateAuthority(value: unknown): void {
  const authority = exactRecord(value, 'authority', [
    'host', 'podman', 'network', 'images', 'labels', 'dockerExclusion',
  ]);
  validateHost(authority['host']);
  validatePodman(authority['podman']);
  validateNetwork(authority['network']);
  validateImages(authority['images']);
  validateLabels(authority['labels']);
  validateDockerExclusion(authority['dockerExclusion']);
}

function validateHost(value: unknown): void {
  const host = exactRecord(value, 'authority.host', [
    'distribution', 'osId', 'osVersion', 'architecture', 'timezone', 'initProcess',
    'processorCount', 'memoryBytes', 'memoryToleranceBytes', 'swapBytes',
    'rootFilesystemBytes', 'rootFilesystemToleranceBytes', 'minimumRootAvailableBytes',
    'minimumHostAvailableBytes', 'wslConfigMemoryValues', 'wslConfigSwapValues',
  ]);
  nonEmptyString(host['distribution'], 'authority.host.distribution');
  nonEmptyString(host['osId'], 'authority.host.osId');
  nonEmptyString(host['osVersion'], 'authority.host.osVersion');
  literal(host['architecture'], 'x86_64', 'authority.host.architecture');
  literal(host['timezone'], 'Asia/Shanghai', 'authority.host.timezone');
  literal(host['initProcess'], 'systemd', 'authority.host.initProcess');
  for (const key of [
    'processorCount', 'memoryBytes', 'memoryToleranceBytes', 'swapBytes',
    'rootFilesystemBytes', 'rootFilesystemToleranceBytes', 'minimumRootAvailableBytes',
    'minimumHostAvailableBytes',
  ] as const) nonNegativeInteger(host[key], `authority.host.${key}`);
  if (host['processorCount'] === 0 || host['memoryBytes'] === 0 || host['rootFilesystemBytes'] === 0) {
    schemaError('authority.host', 'NON_ZERO_CAPACITY_REQUIRED');
  }
  literal(host['swapBytes'], 0, 'authority.host.swapBytes');
  stringArray(host['wslConfigMemoryValues'], 'authority.host.wslConfigMemoryValues', true);
  stringArray(host['wslConfigSwapValues'], 'authority.host.wslConfigSwapValues', true);
}

function validatePodman(value: unknown): void {
  const podman = exactRecord(value, 'authority.podman', [
    'version', 'packageNevra', 'conmonNevra', 'containersCommonNevra', 'rootless',
    'socketPath', 'storageDriver', 'graphRoot', 'runRoot', 'ociRuntime', 'ociRuntimeNevra',
    'networkBackend', 'networkPluginsNevra', 'logDriver', 'cgroupManager', 'eventsBackend',
    'restartPolicy',
  ]);
  if (podman['rootless'] !== false) throw new Error('RUNTIME_AUTHORITY_ROOTLESS_FORBIDDEN');
  if (typeof podman['socketPath'] === 'string' && /^(?:tcp|http|https):/u.test(podman['socketPath'])) {
    throw new Error('RUNTIME_AUTHORITY_SOCKET_MUST_BE_UNIX');
  }
  if (podman['socketPath'] !== '/run/podman/podman.sock') {
    throw new Error('RUNTIME_AUTHORITY_SOCKET_PATH_INVALID');
  }
  if (podman['version'] !== '4.9.4-rhel') throw new Error('RUNTIME_AUTHORITY_PODMAN_VERSION_INVALID');
  for (const key of [
    'packageNevra', 'conmonNevra', 'containersCommonNevra', 'ociRuntimeNevra',
    'networkPluginsNevra',
  ] as const) nonEmptyString(podman[key], `authority.podman.${key}`);
  if (podman['storageDriver'] !== 'overlay') throw new Error('RUNTIME_AUTHORITY_STORAGE_DRIVER_INVALID');
  literal(podman['graphRoot'], '/var/lib/containers/storage', 'authority.podman.graphRoot');
  literal(podman['runRoot'], '/run/containers/storage', 'authority.podman.runRoot');
  if (podman['ociRuntime'] !== 'runc') throw new Error('RUNTIME_AUTHORITY_OCI_RUNTIME_INVALID');
  if (podman['networkBackend'] !== 'cni') throw new Error('RUNTIME_AUTHORITY_NETWORK_BACKEND_INVALID');
  if (podman['logDriver'] !== 'k8s-file') throw new Error('RUNTIME_AUTHORITY_LOG_DRIVER_INVALID');
  literal(podman['cgroupManager'], 'systemd', 'authority.podman.cgroupManager');
  literal(podman['eventsBackend'], 'file', 'authority.podman.eventsBackend');
  if (podman['restartPolicy'] !== 'no') throw new Error('RUNTIME_AUTHORITY_RESTART_POLICY_INVALID');
}

function validateNetwork(value: unknown): void {
  const network = exactRecord(value, 'authority.network', [
    'managedContainerMode', 'bridgeNetworkingAllowed', 'portPublishingAllowed', 'bindAddress', 'ports',
  ]);
  literal(network['managedContainerMode'], 'host', 'authority.network.managedContainerMode');
  if (network['bridgeNetworkingAllowed'] !== false) {
    throw new Error('RUNTIME_AUTHORITY_BRIDGE_NETWORKING_FORBIDDEN');
  }
  if (network['portPublishingAllowed'] !== false) {
    throw new Error('RUNTIME_AUTHORITY_PORT_PUBLISHING_FORBIDDEN');
  }
  if (network['bindAddress'] !== '127.0.0.1') throw new Error('RUNTIME_AUTHORITY_BIND_ADDRESS_INVALID');
  const ports = exactRecord(network['ports'], 'authority.network.ports', [
    'postgresRuntime', 'postgresIntegration', 'keycloakHttp', 'keycloakManagement',
    'governanceApi', 'consumerA', 'consumerB',
  ]);
  const values = Object.entries(ports).map(([key, port]) => {
    portNumber(port, `authority.network.ports.${key}`);
    return port as number;
  });
  if (new Set(values).size !== values.length) throw new Error('RUNTIME_AUTHORITY_PORT_DUPLICATE');
}

function validateImages(value: unknown): void {
  const images = exactRecord(value, 'authority.images', ['postgresql', 'keycloak']);
  for (const name of ['postgresql', 'keycloak'] as const) {
    const image = exactRecord(images[name], `authority.images.${name}`, [
      'declaredVersion', 'runtimeReference', 'architecture', 'os',
    ]);
    nonEmptyString(image['declaredVersion'], `authority.images.${name}.declaredVersion`);
    if (typeof image['runtimeReference'] !== 'string' || !IMAGE_DIGEST_PATTERN.test(image['runtimeReference'])) {
      throw new Error(`RUNTIME_AUTHORITY_IMAGE_DIGEST_REQUIRED:${name}`);
    }
    literal(image['architecture'], 'amd64', `authority.images.${name}.architecture`);
    literal(image['os'], 'linux', `authority.images.${name}.os`);
  }
}

function validateLabels(value: unknown): void {
  const labels = exactRecord(value, 'authority.labels', ['static', 'dynamic']);
  const staticLabels = exactRecord(labels['static'], 'authority.labels.static', [
    'hdi.repository', 'hdi.phase', 'hdi.managed-by',
  ]);
  literal(staticLabels['hdi.repository'], 'hospital-data-intelligence-platform', 'authority.labels.static.hdi.repository');
  literal(staticLabels['hdi.phase'], '01', 'authority.labels.static.hdi.phase');
  literal(staticLabels['hdi.managed-by'], 'formal-abg', 'authority.labels.static.hdi.managed-by');
  const dynamic = labels['dynamic'];
  if (!Array.isArray(dynamic) || dynamic.length !== 2 ||
      dynamic[0] !== 'hdi.run-id' || dynamic[1] !== 'hdi.run-sequence') {
    schemaError('authority.labels.dynamic', 'VALUE_INVALID');
  }
}

function validateDockerExclusion(value: unknown): void {
  const exclusion = exactRecord(value, 'authority.dockerExclusion', [
    'forbiddenExecutableNames', 'forbiddenSocketPaths', 'forbiddenSystemdUnits',
    'forbiddenProcessNames', 'forbiddenTcpPorts', 'allowedCompatibilityEnvironment',
  ]);
  stringArray(exclusion['forbiddenExecutableNames'], 'authority.dockerExclusion.forbiddenExecutableNames', true);
  stringArray(exclusion['forbiddenSocketPaths'], 'authority.dockerExclusion.forbiddenSocketPaths', true);
  stringArray(exclusion['forbiddenSystemdUnits'], 'authority.dockerExclusion.forbiddenSystemdUnits', true);
  stringArray(exclusion['forbiddenProcessNames'], 'authority.dockerExclusion.forbiddenProcessNames', true);
  requireArrayMembers(
    exclusion['forbiddenExecutableNames'],
    ['docker'],
    'RUNTIME_AUTHORITY_DOCKER_EXECUTABLE_EXCLUSION_INCOMPLETE',
  );
  requireArrayMembers(
    exclusion['forbiddenSocketPaths'],
    ['/run/docker.sock', '/var/run/docker.sock'],
    'RUNTIME_AUTHORITY_DOCKER_SOCKET_EXCLUSION_INCOMPLETE',
  );
  requireArrayMembers(
    exclusion['forbiddenSystemdUnits'],
    ['docker.service', 'docker.socket'],
    'RUNTIME_AUTHORITY_DOCKER_SYSTEMD_EXCLUSION_INCOMPLETE',
  );
  requireArrayMembers(
    exclusion['forbiddenProcessNames'],
    ['dockerd', 'docker-proxy'],
    'RUNTIME_AUTHORITY_DOCKER_PROCESS_EXCLUSION_INCOMPLETE',
  );
  const ports = exclusion['forbiddenTcpPorts'];
  if (!Array.isArray(ports) || ports.length === 0) schemaError('authority.dockerExclusion.forbiddenTcpPorts', 'ARRAY_INVALID');
  for (const [index, port] of (ports as unknown[]).entries()) portNumber(port, `authority.dockerExclusion.forbiddenTcpPorts.${index}`);
  requireArrayMembers(
    ports,
    [2_375, 2_376],
    'RUNTIME_AUTHORITY_DOCKER_TCP_EXCLUSION_INCOMPLETE',
  );
  const allowed = exactRecord(
    exclusion['allowedCompatibilityEnvironment'],
    'authority.dockerExclusion.allowedCompatibilityEnvironment',
    ['DOCKER_HOST'],
  );
  if (allowed['DOCKER_HOST'] !== 'unix:///run/podman/podman.sock') {
    throw new Error('RUNTIME_AUTHORITY_COMPATIBILITY_ENDPOINT_INVALID');
  }
}

function validateObservations(value: unknown): void {
  const observations = exactRecord(value, 'observations', [
    'capturedLocalDateTime', 'kernel', 'tools', 'podman', 'images',
    'rootFilesystemObservedBytes', 'rootFilesystemUsedBytes',
    'rootFilesystemAvailableBytes', 'migration', 'receipt',
  ]);
  nonEmptyString(observations['capturedLocalDateTime'], 'observations.capturedLocalDateTime');
  nonEmptyString(observations['kernel'], 'observations.kernel');
  const tools = exactRecord(observations['tools'], 'observations.tools', ['node', 'npm', 'git']);
  const node = exactRecord(tools['node'], 'observations.tools.node', ['version', 'sourceArchive', 'sourceSha256']);
  nonEmptyString(node['version'], 'observations.tools.node.version');
  nonEmptyString(node['sourceArchive'], 'observations.tools.node.sourceArchive');
  sha256String(node['sourceSha256'], 'observations.tools.node.sourceSha256');
  const npm = exactRecord(tools['npm'], 'observations.tools.npm', ['version']);
  nonEmptyString(npm['version'], 'observations.tools.npm.version');
  const git = exactRecord(tools['git'], 'observations.tools.git', ['packageNevra']);
  nonEmptyString(git['packageNevra'], 'observations.tools.git.packageNevra');
  const podman = exactRecord(observations['podman'], 'observations.podman', [
    'socketEnabled', 'socketActive', 'dockerCliPresent',
  ]);
  for (const key of ['socketEnabled', 'socketActive', 'dockerCliPresent'] as const) {
    if (typeof podman[key] !== 'boolean') schemaError(`observations.podman.${key}`, 'BOOLEAN_REQUIRED');
  }
  const images = exactRecord(observations['images'], 'observations.images', ['postgresql', 'keycloak']);
  validateImageObservation(images['postgresql'], 'observations.images.postgresql', false);
  validateImageObservation(images['keycloak'], 'observations.images.keycloak', true);
  nonNegativeInteger(observations['rootFilesystemObservedBytes'], 'observations.rootFilesystemObservedBytes');
  nonNegativeInteger(observations['rootFilesystemUsedBytes'], 'observations.rootFilesystemUsedBytes');
  nonNegativeInteger(observations['rootFilesystemAvailableBytes'], 'observations.rootFilesystemAvailableBytes');
  const migration = exactRecord(observations['migration'], 'observations.migration', [
    'dockerPackagesRemoved', 'dockerDataPathRetained', 'preRemovalImageArchivePath',
    'preRemovalImageArchiveSha256', 'preRemovalImageArchiveSizeBytes',
  ]);
  if (typeof migration['dockerPackagesRemoved'] !== 'boolean') schemaError('observations.migration.dockerPackagesRemoved', 'BOOLEAN_REQUIRED');
  nonEmptyString(migration['dockerDataPathRetained'], 'observations.migration.dockerDataPathRetained');
  nonEmptyString(migration['preRemovalImageArchivePath'], 'observations.migration.preRemovalImageArchivePath');
  sha256String(migration['preRemovalImageArchiveSha256'], 'observations.migration.preRemovalImageArchiveSha256');
  nonNegativeInteger(migration['preRemovalImageArchiveSizeBytes'], 'observations.migration.preRemovalImageArchiveSizeBytes');
  const receipt = exactRecord(observations['receipt'], 'observations.receipt', ['path', 'sha256']);
  nonEmptyString(receipt['path'], 'observations.receipt.path');
  sha256String(receipt['sha256'], 'observations.receipt.sha256');
}

function validateImageObservation(value: unknown, path: string, withJvm: boolean): void {
  const keys = ['discoveryTag', 'imageId', 'imageSizeBytes', 'reportedVersion'];
  if (withJvm) keys.push('reportedJvm');
  const image = exactRecord(value, path, keys);
  nonEmptyString(image['discoveryTag'], `${path}.discoveryTag`);
  sha256String(image['imageId'], `${path}.imageId`);
  nonNegativeInteger(image['imageSizeBytes'], `${path}.imageSizeBytes`);
  nonEmptyString(image['reportedVersion'], `${path}.reportedVersion`);
  if (withJvm) nonEmptyString(image['reportedJvm'], `${path}.reportedJvm`);
}

function exactRecord(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    schemaError(path || 'root', 'OBJECT_REQUIRED');
  }
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) schemaError(pathFor(path, key), 'FIELD_REQUIRED');
  }
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) schemaError(pathFor(path, key), 'UNKNOWN_FIELD');
  }
  return record;
}

function literal(value: unknown, expected: string | number | boolean, path: string): void {
  if (value !== expected) schemaError(path, 'VALUE_INVALID');
}

function nonEmptyString(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length === 0) schemaError(path, 'STRING_REQUIRED');
}

function sha256String(value: unknown, path: string): void {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) schemaError(path, 'SHA256_REQUIRED');
}

function nonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) schemaError(path, 'NON_NEGATIVE_INTEGER_REQUIRED');
}

function portNumber(value: unknown, path: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    schemaError(path, 'PORT_INVALID');
  }
}

function stringArray(value: unknown, path: string, requireNonEmpty: boolean): void {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0) ||
      value.some((item) => typeof item !== 'string' || item.length === 0)) {
    schemaError(path, 'STRING_ARRAY_REQUIRED');
  }
}

function requireArrayMembers(
  value: unknown,
  required: readonly (string | number)[],
  errorCode: string,
): void {
  if (!Array.isArray(value) || required.some((item) => !value.includes(item))) {
    throw new Error(errorCode);
  }
}

function pathFor(parent: string, key: string): string {
  return parent.length === 0 ? key : `${parent}.${key}`;
}

function schemaError(path: string, reason: string): never {
  throw new Error(`RUNTIME_AUTHORITY_SCHEMA_INVALID:${path}:${reason}`);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(',')}}`;
  }
  throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
