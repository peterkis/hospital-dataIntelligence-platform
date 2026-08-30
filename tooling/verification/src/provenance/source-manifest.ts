import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
} from '../verification-contract-versions.js';
import { VERIFICATION_SOURCE_FILES } from './source-manifest-files.js';
import {
  canonicalVerificationProvenanceJson,
  deriveVerificationAuthorityIdentity,
  digestVerificationProvenanceJson,
  parseVerificationSourceManifest,
  type ProducerVerificationSourceManifest,
  type ReviewerVerificationSourceManifest,
  type VerificationSourceManifest,
  type VerificationSourceManifestEntry,
  type VerificationWorktreeStatus,
} from './source-manifest-schema.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const GIT_COMMIT_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REGULAR_GIT_MODES = new Set(['100644', '100755']);

export interface GitBlob {
  readonly mode: string;
  readonly oid: string;
  readonly bytes: Uint8Array;
}

export interface GitObjectReader {
  commitExists(repositoryRoot: string, commitSha: string): Promise<boolean>;
  readBlob(repositoryRoot: string, commitSha: string, path: string): Promise<GitBlob | null>;
}

export interface RepositoryState {
  readonly repositoryFullName: string;
  readonly gitCommitSha: string;
  readonly branch: string;
  readonly worktreeStatus: VerificationWorktreeStatus;
}

export interface RepositoryStateReader {
  readState(repositoryRoot: string): Promise<RepositoryState>;
}

export interface WorkspaceSourceFile {
  readonly kind: 'REGULAR' | 'SYMLINK' | 'OTHER' | 'MISSING';
  readonly bytes?: Uint8Array;
}

export interface WorkspaceSourceReader {
  readSourceFile(repositoryRoot: string, path: string): Promise<WorkspaceSourceFile>;
}

export interface SourceManifestDependencies {
  readonly git: GitObjectReader;
  readonly repository: RepositoryStateReader;
  readonly workspace: WorkspaceSourceReader;
  readonly clock: () => string;
}

export interface SourceManifestWriteResult {
  readonly relativePath: 'provenance/producer-source-manifest.json';
  readonly sha256RelativePath: 'provenance/producer-source-manifest.sha256';
  readonly sha256: string;
  readonly byteLength: number;
}

export interface SourceManifestBuilder {
  buildProducer(repositoryRoot: string): Promise<ProducerVerificationSourceManifest>;
  buildReviewer(repositoryRoot: string): Promise<ReviewerVerificationSourceManifest>;
}

export function createSourceManifestBuilder(
  dependencies: SourceManifestDependencies = defaultSourceManifestDependencies(),
): SourceManifestBuilder {
  return {
    buildProducer: (repositoryRoot) => buildProducerSourceManifest(repositoryRoot, dependencies),
    buildReviewer: (repositoryRoot) => buildReviewerSourceManifest(repositoryRoot, dependencies),
  };
}

export async function buildProducerSourceManifest(
  repositoryRoot: string,
  dependencies: SourceManifestDependencies = defaultSourceManifestDependencies(),
): Promise<ProducerVerificationSourceManifest> {
  const state = await dependencies.repository.readState(repositoryRoot);
  assertRepositoryState(state);
  if (state.worktreeStatus !== 'CLEAN') {
    throw new Error('PRODUCER_WORKTREE_NOT_CLEAN_AT_PRODUCTION');
  }
  const sourceFiles = await buildSourceFileEntries(
    repositoryRoot,
    state.gitCommitSha,
    dependencies,
    true,
  );
  const authorityIdentity = deriveVerificationAuthorityIdentity(sourceFiles);
  return {
    schemaVersion: VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
    manifestRole: 'PRODUCER',
    repositoryFullName: state.repositoryFullName,
    producerGitCommitSha: state.gitCommitSha,
    producerBranch: state.branch,
    producerWorktreeState: 'CLEAN',
    generatedAt: requireTimestamp(dependencies.clock()),
    contractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    authorityIdentity,
    sourceFiles,
    sourceFileCount: sourceFiles.length,
    sourceFilesDigest: digestVerificationProvenanceJson(sourceFiles),
  };
}

export async function buildReviewerSourceManifest(
  repositoryRoot: string,
  dependencies: SourceManifestDependencies = defaultSourceManifestDependencies(),
): Promise<ReviewerVerificationSourceManifest> {
  const state = await dependencies.repository.readState(repositoryRoot);
  assertRepositoryState(state);
  const sourceFiles = await buildSourceFileEntries(
    repositoryRoot,
    state.gitCommitSha,
    dependencies,
    state.worktreeStatus === 'CLEAN',
  );
  return {
    schemaVersion: VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
    manifestRole: 'REVIEWER',
    repositoryFullName: state.repositoryFullName,
    reviewerGitCommitSha: state.gitCommitSha,
    reviewerBranch: state.branch,
    reviewerWorktreeState: state.worktreeStatus,
    generatedAt: requireTimestamp(dependencies.clock()),
    reviewerContractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    sourceFiles,
    sourceFileCount: sourceFiles.length,
    sourceFilesDigest: digestVerificationProvenanceJson(sourceFiles),
  };
}

export function canonicalVerificationSourceManifestBytes(
  manifest: VerificationSourceManifest,
): Buffer {
  const parsed = parseVerificationSourceManifest(manifest);
  return Buffer.from(canonicalVerificationProvenanceJson(parsed) + '\n', 'utf8');
}

export function sourceManifestSha256(manifest: VerificationSourceManifest): string {
  return sha256(canonicalVerificationSourceManifestBytes(manifest));
}

export async function writeProducerSourceManifest(
  evidenceDirectory: string,
  manifest: ProducerVerificationSourceManifest,
): Promise<SourceManifestWriteResult> {
  const bytes = canonicalVerificationSourceManifestBytes(manifest);
  const digest = sha256(bytes);
  const root = await assertSafeExistingDirectory(evidenceDirectory, 'PRODUCER_SOURCE_MANIFEST_ROOT_UNSAFE');
  const provenanceDirectory = await ensureSafeProvenanceDirectory(root);
  const manifestPath = join(provenanceDirectory, 'producer-source-manifest.json');
  const sidecarPath = join(provenanceDirectory, 'producer-source-manifest.sha256');
  await assertPathAbsent(manifestPath, 'PRODUCER_SOURCE_MANIFEST_ALREADY_EXISTS');
  await assertPathAbsent(sidecarPath, 'PRODUCER_SOURCE_MANIFEST_SHA256_ALREADY_EXISTS');
  await writeFile(manifestPath, bytes, { flag: 'wx', mode: 0o600 });
  await writeFile(
    sidecarPath,
    `${digest}  producer-source-manifest.json\n`,
    { flag: 'wx', mode: 0o600 },
  );
  return {
    relativePath: 'provenance/producer-source-manifest.json',
    sha256RelativePath: 'provenance/producer-source-manifest.sha256',
    sha256: digest,
    byteLength: bytes.byteLength,
  };
}

/**
 * Re-hashes persisted bytes and their sidecar. This never rebuilds or rewrites
 * the manifest, so setup/cleanup checks cannot silently change producer identity.
 */
export async function verifyProducerSourceManifestStable(
  evidenceDirectory: string,
  expectedSha256: string,
): Promise<boolean> {
  if (!SHA256_PATTERN.test(expectedSha256)) return false;
  try {
    const root = await assertSafeExistingDirectory(evidenceDirectory, 'PRODUCER_SOURCE_MANIFEST_ROOT_UNSAFE');
    const provenance = await assertSafeExistingDirectory(
      join(root, 'provenance'),
      'PRODUCER_SOURCE_MANIFEST_DIRECTORY_UNSAFE',
    );
    const manifestPath = await assertSafeRegularFile(
      provenance,
      'producer-source-manifest.json',
      'PRODUCER_SOURCE_MANIFEST_FILE_UNSAFE',
    );
    const sidecarPath = await assertSafeRegularFile(
      provenance,
      'producer-source-manifest.sha256',
      'PRODUCER_SOURCE_MANIFEST_SHA256_FILE_UNSAFE',
    );
    const bytes = await readFile(manifestPath);
    const sidecar = await readFile(sidecarPath, 'utf8');
    const match = /^([0-9a-f]{64})  producer-source-manifest\.json\n$/u.exec(sidecar);
    if (match?.[1] !== expectedSha256 || sha256(bytes) !== expectedSha256) return false;
    parseVerificationSourceManifest(JSON.parse(bytes.toString('utf8')) as unknown);
    return canonicalVerificationSourceManifestBytes(
      parseVerificationSourceManifest(JSON.parse(bytes.toString('utf8')) as unknown),
    ).equals(bytes);
  } catch {
    return false;
  }
}

export function defaultSourceManifestDependencies(): SourceManifestDependencies {
  return {
    git: new LocalGitObjectReader(),
    repository: new LocalRepositoryStateReader(),
    workspace: new LocalWorkspaceSourceReader(),
    clock: () => new Date().toISOString(),
  };
}

/** Compatibility aliases used by the formal lifecycle integration seam. */
export const createDefaultSourceManifestBuilderDependencies = defaultSourceManifestDependencies;
export const writeProducerSourceManifestExclusive = writeProducerSourceManifest;
export const verifySourceManifestBytesStable = verifyProducerSourceManifestStable;

export class LocalGitObjectReader implements GitObjectReader {
  async commitExists(repositoryRoot: string, commitSha: string): Promise<boolean> {
    if (!GIT_COMMIT_PATTERN.test(commitSha)) return false;
    try {
      await executeGitText(repositoryRoot, ['cat-file', '-e', `${commitSha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  async readBlob(repositoryRoot: string, commitSha: string, path: string): Promise<GitBlob | null> {
    assertSafeRegistryPath(path);
    let output: string;
    try {
      output = await executeGitText(repositoryRoot, ['ls-tree', '-z', commitSha, '--', path]);
    } catch (error) {
      if (isGitLookupFailure(error)) return null;
      throw error;
    }
    if (output.length === 0) return null;
    const records = output.split('\0').filter((record) => record.length > 0);
    if (records.length !== 1) throw new Error('PRODUCER_SOURCE_PATH_AMBIGUOUS_AT_COMMIT:' + path);
    const match = /^(\d{6}) blob ([0-9a-f]{40}|[0-9a-f]{64})\t(.+)$/u.exec(records[0]!);
    if (match === null || match[3] !== path) {
      throw new Error('PRODUCER_SOURCE_GIT_OBJECT_INVALID:' + path);
    }
    return {
      mode: match[1]!,
      oid: match[2]!,
      bytes: await executeGitBytes(repositoryRoot, ['cat-file', 'blob', match[2]!]),
    };
  }
}

export class LocalRepositoryStateReader implements RepositoryStateReader {
  async readState(repositoryRoot: string): Promise<RepositoryState> {
    const [commit, branch, status, remote] = await Promise.all([
      executeGitText(repositoryRoot, ['rev-parse', 'HEAD']),
      executeGitText(repositoryRoot, ['branch', '--show-current']),
      executeGitText(repositoryRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
      executeGitText(repositoryRoot, ['config', '--get', 'remote.origin.url']),
    ]);
    return {
      repositoryFullName: repositoryFullNameFromRemote(remote.trim()),
      gitCommitSha: commit.trim(),
      branch: branch.trim(),
      worktreeStatus: status.trim().length === 0 ? 'CLEAN' : 'DIRTY',
    };
  }
}

export class LocalWorkspaceSourceReader implements WorkspaceSourceReader {
  async readSourceFile(repositoryRoot: string, path: string): Promise<WorkspaceSourceFile> {
    assertSafeRegistryPath(path);
    const root = await realpath(resolve(repositoryRoot));
    const absolutePath = resolveInside(root, path);
    try {
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink()) return { kind: 'SYMLINK' };
      if (!stat.isFile()) return { kind: 'OTHER' };
      return { kind: 'REGULAR', bytes: await readFile(absolutePath) };
    } catch (error) {
      if (isMissing(error)) return { kind: 'MISSING' };
      throw error;
    }
  }
}

async function buildSourceFileEntries(
  repositoryRoot: string,
  commitSha: string,
  dependencies: SourceManifestDependencies,
  requireWorkspaceCommitMatch: boolean,
): Promise<readonly VerificationSourceManifestEntry[]> {
  assertRegistry();
  if (!await dependencies.git.commitExists(repositoryRoot, commitSha)) {
    throw new Error('PRODUCER_COMMIT_UNAVAILABLE');
  }
  const entries: VerificationSourceManifestEntry[] = [];
  for (const definition of VERIFICATION_SOURCE_FILES) {
    const workspace = await dependencies.workspace.readSourceFile(repositoryRoot, definition.path);
    if (workspace.kind === 'SYMLINK') throw new Error('PRODUCER_SOURCE_MANIFEST_SYMLINK:' + definition.path);
    if (workspace.kind === 'MISSING') throw new Error('PRODUCER_SOURCE_FILE_MISSING:' + definition.path);
    if (workspace.kind !== 'REGULAR' || workspace.bytes === undefined) {
      throw new Error('PRODUCER_SOURCE_FILE_NOT_REGULAR:' + definition.path);
    }
    const blob = await dependencies.git.readBlob(repositoryRoot, commitSha, definition.path);
    if (blob === null) throw new Error('PRODUCER_SOURCE_PATH_MISSING_AT_COMMIT:' + definition.path);
    if (!REGULAR_GIT_MODES.has(blob.mode)) {
      throw new Error('PRODUCER_SOURCE_GIT_MODE_NOT_REGULAR:' + definition.path);
    }
    const workspaceBytes = Buffer.from(workspace.bytes);
    const blobBytes = Buffer.from(blob.bytes);
    if (gitBlobOid(blobBytes, blob.oid.length) !== blob.oid) {
      throw new Error('PRODUCER_SOURCE_BLOB_ID_MISMATCH:' + definition.path);
    }
    if (requireWorkspaceCommitMatch && !workspaceBytes.equals(blobBytes)) {
      throw new Error('PRODUCER_SOURCE_WORKSPACE_BLOB_MISMATCH:' + definition.path);
    }
    entries.push({
      path: definition.path,
      role: definition.role,
      sha256: sha256(workspaceBytes),
      gitBlobOid: blob.oid,
      byteLength: workspaceBytes.byteLength,
    });
  }
  return entries;
}

function assertRegistry(): void {
  const paths = VERIFICATION_SOURCE_FILES.map((entry) => entry.path);
  for (const path of paths) assertSafeRegistryPath(path);
  if (new Set(paths).size !== paths.length) throw new Error('VERIFICATION_SOURCE_REGISTRY_DUPLICATE');
  const sorted = [...paths].sort();
  if (paths.some((path, index) => path !== sorted[index])) {
    throw new Error('VERIFICATION_SOURCE_REGISTRY_ORDER_INVALID');
  }
}

function assertSafeRegistryPath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes('\\') ||
    path.includes('//') ||
    path.startsWith('./') ||
    path.split('/').includes('..')
  ) {
    throw new Error('PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE:' + path);
  }
}

function assertRepositoryState(state: RepositoryState): void {
  if (!GIT_COMMIT_PATTERN.test(state.gitCommitSha)) throw new Error('REPOSITORY_GIT_COMMIT_INVALID');
  if (state.repositoryFullName.length === 0) throw new Error('REPOSITORY_FULL_NAME_UNAVAILABLE');
  if (state.branch.length === 0) throw new Error('REPOSITORY_BRANCH_UNAVAILABLE');
}

function requireTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('SOURCE_MANIFEST_TIMESTAMP_INVALID');
  return value;
}

function repositoryFullNameFromRemote(remote: string): string {
  const normalized = remote.replaceAll('\\', '/').replace(/\.git$/u, '');
  const match = /(?:[:/])([^/:]+\/[^/]+)$/u.exec(normalized);
  if (match?.[1] === undefined) throw new Error('REPOSITORY_FULL_NAME_UNAVAILABLE');
  return match[1];
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitBlobOid(bytes: Uint8Array, oidLength: number): string {
  const algorithm = oidLength === 40 ? 'sha1' : oidLength === 64 ? 'sha256' : null;
  if (algorithm === null) throw new Error('PRODUCER_SOURCE_BLOB_ID_INVALID');
  return createHash(algorithm)
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

async function executeGitText(repositoryRoot: string, args: readonly string[]): Promise<string> {
  return (await executeGit(repositoryRoot, args, 'utf8')) as string;
}

async function executeGitBytes(repositoryRoot: string, args: readonly string[]): Promise<Buffer> {
  return (await executeGit(repositoryRoot, args, 'buffer')) as Buffer;
}

function executeGit(
  repositoryRoot: string,
  args: readonly string[],
  encoding: 'utf8' | 'buffer',
): Promise<string | Buffer> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      'git',
      [...args],
      { cwd: repositoryRoot, windowsHide: true, encoding: encoding === 'buffer' ? null : encoding },
      (error, stdout, stderr) => {
        if (error !== null) {
          rejectPromise(Object.assign(error, { stderr: String(stderr) }));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

async function assertSafeExistingDirectory(path: string, code: string): Promise<string> {
  const absolute = resolve(path);
  const stat = await lstat(absolute);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(code);
  return realpath(absolute);
}

async function ensureSafeProvenanceDirectory(root: string): Promise<string> {
  const path = join(root, 'provenance');
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PRODUCER_SOURCE_MANIFEST_DIRECTORY_UNSAFE');
  } catch (error) {
    if (!isMissing(error)) throw error;
    await mkdir(path, { recursive: false, mode: 0o700 });
  }
  return realpath(path);
}

async function assertPathAbsent(path: string, code: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  throw new Error(code);
}

async function assertSafeRegularFile(root: string, path: string, code: string): Promise<string> {
  const absolute = resolveInside(root, path);
  const stat = await lstat(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(code);
  return absolute;
}

function resolveInside(root: string, path: string): string {
  const absolute = resolve(root, path);
  const relativePath = relative(root, absolute);
  if (
    relativePath.length === 0 ||
    relativePath === '..' ||
    relativePath.startsWith('..' + sep) ||
    isAbsolute(relativePath)
  ) throw new Error('PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE:' + path);
  return absolute;
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isGitLookupFailure(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code !== 'ENOENT';
}
