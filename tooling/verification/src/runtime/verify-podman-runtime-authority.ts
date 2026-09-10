import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPodmanRuntimeAuthority } from './podman-runtime-authority.js';

export interface VerifyPodmanRuntimeAuthorityResult {
  readonly schemaVersion: 'phase-01.podman-runtime-authority-verification.v1';
  readonly status: 'PASSED';
  readonly rootless: false;
  readonly socketPath: string;
  readonly restartPolicy: 'no';
  readonly runtimeAuthoritySha256: string;
  readonly runtimeAuthoritySemanticDigest: string;
}

export async function verifyPodmanRuntimeAuthority(
  repositoryRoot = resolve(import.meta.dirname, '../../../..'),
): Promise<VerifyPodmanRuntimeAuthorityResult> {
  const loaded = await loadPodmanRuntimeAuthority(repositoryRoot);
  return {
    schemaVersion: 'phase-01.podman-runtime-authority-verification.v1',
    status: 'PASSED',
    rootless: loaded.authority.podman.rootless,
    socketPath: loaded.authority.podman.socketPath,
    restartPolicy: loaded.authority.podman.restartPolicy,
    runtimeAuthoritySha256: loaded.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: loaded.runtimeAuthoritySemanticDigest,
  };
}

function readRepositoryRoot(arguments_: readonly string[]): string {
  if (arguments_.length === 0) return resolve(import.meta.dirname, '../../../..');
  if (arguments_.length !== 2 || arguments_[0] !== '--repository-root' || !arguments_[1]) {
    throw new Error('PODMAN_RUNTIME_AUTHORITY_ARGUMENTS_INVALID');
  }
  return resolve(arguments_[1]);
}

async function main(): Promise<void> {
  try {
    const result = await verifyPodmanRuntimeAuthority(readRepositoryRoot(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /^[A-Z0-9_:-]+$/u.test(message)
      ? message
      : 'PODMAN_RUNTIME_AUTHORITY_INTERNAL_ERROR';
    process.stderr.write(code + '\n');
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main();
}
