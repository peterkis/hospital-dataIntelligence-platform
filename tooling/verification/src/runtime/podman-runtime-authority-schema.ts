export const PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION = 3 as const;
export const PODMAN_RUNTIME_AUTHORITY_ID = 'phase-01.podman-runtime-authority.v1' as const;
export const FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SCHEMA_VERSION =
  'phase-01.formal-runtime-authority-snapshot.v1' as const;

export interface PodmanRuntimeAuthorityHost {
  readonly distribution: string;
  readonly osId: string;
  readonly osVersion: string;
  readonly architecture: 'x86_64';
  readonly timezone: 'Asia/Shanghai';
  readonly initProcess: 'systemd';
  readonly processorCount: number;
  readonly memoryBytes: number;
  readonly memoryToleranceBytes: number;
  readonly swapBytes: 0;
  readonly rootFilesystemBytes: number;
  readonly rootFilesystemToleranceBytes: number;
  readonly minimumRootAvailableBytes: number;
  readonly minimumHostAvailableBytes: number;
  readonly wslConfigMemoryValues: readonly string[];
  readonly wslConfigSwapValues: readonly string[];
}

export interface PodmanRuntimeAuthorityPodman {
  readonly version: '4.9.4-rhel';
  readonly packageNevra: string;
  readonly conmonNevra: string;
  readonly containersCommonNevra: string;
  readonly rootless: false;
  readonly socketPath: '/run/podman/podman.sock';
  readonly storageDriver: 'overlay';
  readonly graphRoot: '/var/lib/containers/storage';
  readonly runRoot: '/run/containers/storage';
  readonly ociRuntime: 'runc';
  readonly ociRuntimeNevra: string;
  readonly networkBackend: 'cni';
  readonly networkPluginsNevra: string;
  readonly logDriver: 'k8s-file';
  readonly cgroupManager: 'systemd';
  readonly eventsBackend: 'file';
  readonly restartPolicy: 'no';
}

export interface PodmanRuntimeAuthorityPorts {
  readonly postgresRuntime: number;
  readonly postgresIntegration: number;
  readonly keycloakHttp: number;
  readonly keycloakManagement: number;
  readonly governanceApi: number;
  readonly consumerA: number;
  readonly consumerB: number;
}

export interface PodmanRuntimeAuthorityNetwork {
  readonly managedContainerMode: 'host';
  readonly bridgeNetworkingAllowed: false;
  readonly portPublishingAllowed: false;
  readonly bindAddress: '127.0.0.1';
  readonly ports: PodmanRuntimeAuthorityPorts;
}

export interface PodmanRuntimeAuthorityImage {
  readonly declaredVersion: string;
  readonly runtimeReference: string;
  readonly architecture: 'amd64';
  readonly os: 'linux';
}

export interface PodmanRuntimeAuthorityLabels {
  readonly static: {
    readonly 'hdi.repository': 'hospital-data-intelligence-platform';
    readonly 'hdi.phase': '01';
    readonly 'hdi.managed-by': 'formal-abg';
  };
  readonly dynamic: readonly ['hdi.run-id', 'hdi.run-sequence'];
}

export interface PodmanRuntimeDockerExclusion {
  readonly forbiddenExecutableNames: readonly string[];
  readonly forbiddenSocketPaths: readonly string[];
  readonly forbiddenSystemdUnits: readonly string[];
  readonly forbiddenProcessNames: readonly string[];
  readonly forbiddenTcpPorts: readonly number[];
  readonly allowedCompatibilityEnvironment: Readonly<{
    DOCKER_HOST: 'unix:///run/podman/podman.sock';
  }>;
}

export interface PodmanRuntimeAuthority {
  readonly host: PodmanRuntimeAuthorityHost;
  readonly podman: PodmanRuntimeAuthorityPodman;
  readonly network: PodmanRuntimeAuthorityNetwork;
  readonly images: Readonly<{
    postgresql: PodmanRuntimeAuthorityImage;
    keycloak: PodmanRuntimeAuthorityImage;
  }>;
  readonly labels: PodmanRuntimeAuthorityLabels;
  readonly dockerExclusion: PodmanRuntimeDockerExclusion;
}

export interface PodmanRuntimeObservations {
  readonly capturedLocalDateTime: string;
  readonly kernel: string;
  readonly tools: Readonly<{
    node: Readonly<{ version: string; sourceArchive: string; sourceSha256: string }>;
    npm: Readonly<{ version: string }>;
    git: Readonly<{ packageNevra: string }>;
  }>;
  readonly podman: Readonly<{
    socketEnabled: boolean;
    socketActive: boolean;
    dockerCliPresent: boolean;
  }>;
  readonly images: Readonly<{
    postgresql: Readonly<{
      discoveryTag: string;
      imageId: string;
      imageSizeBytes: number;
      reportedVersion: string;
    }>;
    keycloak: Readonly<{
      discoveryTag: string;
      imageId: string;
      imageSizeBytes: number;
      reportedVersion: string;
      reportedJvm: string;
    }>;
  }>;
  readonly rootFilesystemObservedBytes: number;
  readonly rootFilesystemUsedBytes: number;
  readonly rootFilesystemAvailableBytes: number;
  readonly migration: Readonly<{
    dockerPackagesRemoved: boolean;
    dockerDataPathRetained: string;
    preRemovalImageArchivePath: string;
    preRemovalImageArchiveSha256: string;
    preRemovalImageArchiveSizeBytes: number;
  }>;
  readonly receipt: Readonly<{
    path: string;
    sha256: string;
  }>;
}

export interface PodmanRuntimeAuthorityDocument {
  readonly schemaVersion: typeof PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION;
  readonly authorityId: typeof PODMAN_RUNTIME_AUTHORITY_ID;
  readonly authority: PodmanRuntimeAuthority;
  readonly observations: PodmanRuntimeObservations;
  readonly rules: readonly string[];
}

export interface LoadedPodmanRuntimeAuthority {
  readonly authority: PodmanRuntimeAuthority;
  readonly runtimeAuthoritySha256: string;
  readonly runtimeAuthoritySemanticDigest: string;
}

export interface FormalRuntimeAuthoritySnapshot {
  readonly schemaVersion: typeof FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SCHEMA_VERSION;
  readonly authoritySchemaVersion: typeof PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION;
  readonly authorityId: typeof PODMAN_RUNTIME_AUTHORITY_ID;
  readonly runIdentity: Readonly<{
    runId: string;
    runSequence: number;
    runtimeNamespace: string;
    gitCommitSha: string;
  }>;
  readonly runtimeAuthoritySha256: string;
  readonly runtimeAuthoritySemanticDigest: string;
  readonly authority: PodmanRuntimeAuthority;
}
