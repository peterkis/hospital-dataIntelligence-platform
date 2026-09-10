import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SAFE_IDENTITY_COMPONENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u;

export const AR12_EXECUTION_WORKSPACE_MARKER = '.ar12-execution-workspace.json';
export const AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION = 'phase-01.ar12-execution-workspace.v1';

export type Ar12ExecutionWorkspaceErrorCode =
  | 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'
  | 'AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE'
  | 'AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE'
  | 'AR12_EXECUTION_WORKSPACE_ALREADY_EXISTS'
  | 'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE'
  | 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED'
  | 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'
  | 'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE';

export class Ar12ExecutionWorkspaceError extends Error {
  readonly code: Ar12ExecutionWorkspaceErrorCode;

  constructor(code: Ar12ExecutionWorkspaceErrorCode, detail?: string) {
    super(detail === undefined ? code : code + ': ' + detail);
    this.name = 'Ar12ExecutionWorkspaceError';
    this.code = code;
  }
}

export interface Ar12ExecutionWorkspaceCreationErrorInput {
  readonly workspacePath: string;
  readonly workspacePathDigest: string;
  readonly partialRetained: boolean;
  readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity | null;
  readonly identityFailureCode: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' | null;
  readonly failureCode: Ar12ExecutionWorkspaceErrorCode;
  readonly failureStage?: Ar12ExecutionWorkspaceCreationFailureStage;
}

export type Ar12ExecutionWorkspaceCreationFailureStage =
  | 'ROOT_CREATE'
  | 'CLONE'
  | 'CHECKOUT'
  | 'ORIGIN_RESTORE'
  | 'MARKER'
  | 'VERIFY'
  | 'UNKNOWN';

export class Ar12ExecutionWorkspaceCreationError extends Ar12ExecutionWorkspaceError {
  readonly workspacePath: string;
  readonly workspacePathDigest: string;
  readonly partialRetained: boolean;
  readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity | null;
  readonly identityFailureCode: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' | null;
  readonly failureCode: Ar12ExecutionWorkspaceErrorCode;
  readonly failureStage: Ar12ExecutionWorkspaceCreationFailureStage;

  constructor(input: Ar12ExecutionWorkspaceCreationErrorInput) {
    super(
      'AR12_EXECUTION_WORKSPACE_CREATE_FAILED',
      'partialRetained=' + String(input.partialRetained) +
        '; failureCode=' + input.failureCode +
        '; failureStage=' + (input.failureStage ?? 'UNKNOWN'),
    );
    this.name = 'Ar12ExecutionWorkspaceCreationError';
    this.workspacePath = input.workspacePath;
    this.workspacePathDigest = input.workspacePathDigest;
    this.partialRetained = input.partialRetained;
    this.terminalIdentity = input.terminalIdentity;
    this.identityFailureCode = input.identityFailureCode;
    this.failureCode = input.failureCode;
    this.failureStage = input.failureStage ?? 'UNKNOWN';
  }
}

export type Ar12PathKind = 'MISSING' | 'FILE' | 'DIRECTORY' | 'SYMLINK' | 'OTHER';

export interface Ar12DirectoryEntry {
  readonly name: string;
  readonly kind: Exclude<Ar12PathKind, 'MISSING'>;
}

export interface Ar12ExecutionWorkspaceFileSystem {
  canonicalize(path: string): Promise<string>;
  kind(path: string): Promise<Ar12PathKind>;
  createDirectory(path: string): Promise<void>;
  read(path: string): Promise<Buffer>;
  writeExclusive(path: string, bytes: Uint8Array): Promise<void>;
  append(path: string, bytes: Uint8Array): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  listDirectory(path: string): Promise<readonly Ar12DirectoryEntry[]>;
  readLink(path: string): Promise<string>;
}

export interface Ar12GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface Ar12ExecutionWorkspaceGit {
  run(
    cwd: string,
    arguments_: readonly string[],
    environment?: Readonly<Record<string, string>>,
  ): Promise<Ar12GitCommandResult>;
}

export interface Ar12ExecutionWorkspaceDependencies {
  readonly filesystem: Ar12ExecutionWorkspaceFileSystem;
  readonly git: Ar12ExecutionWorkspaceGit;
  readonly now: () => string;
}

export interface ResolveAr12ExecutionWorkspaceInput {
  readonly repositoryRoot: string;
  readonly runIdentity: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly evidenceDirectories?: readonly string[];
  readonly sourceEvidenceDirectories?: readonly string[];
  readonly reviewOutputDirectories?: readonly string[];
}

export interface ResolvedAr12ExecutionWorkspace {
  readonly repositoryRoot: string;
  readonly canonicalRepositoryRoot: string;
  readonly repositoryId: string;
  readonly externalWorkspaceRoot: string;
  readonly canonicalExternalWorkspaceRoot: string;
  readonly workspacePath: string;
  readonly canonicalWorkspacePath: string;
  readonly runIdentity: string;
}

export interface Ar12ExecutionWorkspaceMarker {
  readonly schemaVersion: typeof AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION;
  readonly repositoryIdentity: string;
  readonly sourceRepositoryRootDigest: string;
  readonly openingGitCommitSha: string;
  readonly targetBranch: string;
  readonly runPurpose: string;
  readonly createdAt: string;
  readonly externalWorkspaceRoot: string;
  readonly formalAcceptanceEligible: false;
}

export interface CreateAr12ExecutionWorkspaceInput extends ResolveAr12ExecutionWorkspaceInput {
  readonly runPurpose: string;
  readonly targetBranch?: string;
  readonly createdAt?: string;
}

export interface CreatedAr12ExecutionWorkspace {
  readonly workspacePath: string;
  readonly resolved: ResolvedAr12ExecutionWorkspace;
  readonly marker: Ar12ExecutionWorkspaceMarker;
}

export interface Ar12ExecutionWorkspaceTerminalIdentity {
  readonly gitCommitSha: string;
  readonly branch: string;
  readonly originUrl: string;
  readonly worktreeState: 'CLEAN' | 'DIRTY';
}

export interface AssertRepositoryNotContaminatedOptions {
  readonly executionWorkspacePath?: string;
  readonly evidenceDirectories?: readonly string[];
  readonly filesystem?: Ar12ExecutionWorkspaceFileSystem;
}

export interface AssertAr12ExecutionWorkspaceCleanupTargetOptions {
  readonly repositoryRoot: string;
  readonly evidenceDirectories: readonly string[];
  readonly filesystem?: Ar12ExecutionWorkspaceFileSystem;
}

export interface RelocateStaleAr12ExecutionWorkspaceInput {
  readonly repositoryRoot: string;
  readonly sourcePath: string;
  readonly allowedStaleWorktreesRoot: string;
  readonly destinationPath: string;
  readonly expectedHead: string;
  readonly expectedBranch: string;
  readonly failedFinalRunDirectory: string;
  readonly initialRunEvidenceDirectories: readonly string[];
  readonly relocatedAt?: string;
}

export interface Ar12ExecutionWorkspaceRelocation {
  readonly schemaVersion: 'phase-01.ar12-execution-workspace-relocation.v1';
  readonly sourceRelativePath: string;
  readonly destinationPathDigest: string;
  readonly expectedHead: string;
  readonly actualHead: string;
  readonly branch: string;
  readonly treeDigestBefore: string;
  readonly treeDigestAfter: string;
  readonly relocationStatus: 'RELOCATED';
  readonly failedFinalRunDirectory: string;
  readonly failedFinalRunDirectoryPreserved: true;
  readonly initialRunEvidenceDirectoriesPreserved: readonly string[];
  readonly relocatedAt: string;
}

export function defaultAr12ExecutionWorkspaceDependencies(): Ar12ExecutionWorkspaceDependencies {
  return {
    filesystem: nodeFileSystem,
    git: nodeGit,
    now: () => new Date().toISOString(),
  };
}

export async function resolveAr12ExecutionWorkspace(
  input: ResolveAr12ExecutionWorkspaceInput,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<ResolvedAr12ExecutionWorkspace> {
  if (!SAFE_IDENTITY_COMPONENT.test(input.runIdentity)) {
    fail('AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE', 'run identity is not a safe path component');
  }
  const repositoryRoot = resolve(input.repositoryRoot);
  const canonicalRepositoryRoot = await requireCanonicalDirectory(
    repositoryRoot,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
  );
  const repositoryId = safeRepositoryId(basename(canonicalRepositoryRoot));
  const configuredRoot = input.environment?.['AR12_EXECUTION_WORKSPACE_ROOT'];
  const externalWorkspaceRoot = configuredRoot === undefined || configuredRoot.trim() === ''
    ? join(dirname(repositoryRoot), '.hdi-ar12-execution-workspaces', repositoryId)
    : resolveConfiguredRoot(configuredRoot, dirname(repositoryRoot));
  const canonicalExternalWorkspaceRoot = await canonicalizeOrFail(
    externalWorkspaceRoot,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
  );
  const workspacePath = join(externalWorkspaceRoot, input.runIdentity);
  const canonicalWorkspacePath = await canonicalizeOrFail(
    workspacePath,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
  );
  const rootKind = await dependencies.filesystem.kind(externalWorkspaceRoot);
  if (rootKind === 'SYMLINK') {
    fail('AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE', 'external root is a symlink or reparse point');
  }

  await assertExternalBoundary(
    externalWorkspaceRoot,
    canonicalExternalWorkspaceRoot,
    canonicalRepositoryRoot,
    input,
    dependencies.filesystem,
  );
  await assertExternalBoundary(
    workspacePath,
    canonicalWorkspacePath,
    canonicalRepositoryRoot,
    input,
    dependencies.filesystem,
  );

  if (rootKind !== 'MISSING' && rootKind !== 'DIRECTORY') {
    fail('AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE', 'external root is not a directory');
  }
  if (await dependencies.filesystem.kind(workspacePath) !== 'MISSING') {
    fail('AR12_EXECUTION_WORKSPACE_ALREADY_EXISTS', 'run directory already exists');
  }
  return {
    repositoryRoot,
    canonicalRepositoryRoot,
    repositoryId,
    externalWorkspaceRoot,
    canonicalExternalWorkspaceRoot,
    workspacePath,
    canonicalWorkspacePath,
    runIdentity: input.runIdentity,
  };
}

export async function createAr12ExecutionWorkspace(
  input: CreateAr12ExecutionWorkspaceInput,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<CreatedAr12ExecutionWorkspace> {
  const resolvedWorkspace = await resolveAr12ExecutionWorkspace(input, dependencies);
  const sourceState = await readGitIdentity(resolvedWorkspace.repositoryRoot, dependencies.git);
  if (!GIT_COMMIT_PATTERN.test(sourceState.gitCommitSha) || sourceState.worktreeState !== 'CLEAN') {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'source checkout must have a valid clean HEAD');
  }
  const targetBranch = input.targetBranch ?? sourceState.branch;
  if (!validBranch(targetBranch) || targetBranch !== sourceState.branch) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'target branch must equal the opening branch');
  }
  const repositoryIdentity = repositoryIdentityFromGitHubOrigin(sourceState.originUrl);
  const createdAt = requireTimestamp(input.createdAt ?? dependencies.now());
  const marker: Ar12ExecutionWorkspaceMarker = {
    schemaVersion: AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION,
    repositoryIdentity,
    sourceRepositoryRootDigest: sha256(canonicalDigestPath(resolvedWorkspace.canonicalRepositoryRoot)),
    openingGitCommitSha: sourceState.gitCommitSha,
    targetBranch,
    runPurpose: requireNonEmpty(input.runPurpose, 'run purpose'),
    createdAt,
    externalWorkspaceRoot: resolvedWorkspace.canonicalExternalWorkspaceRoot,
    formalAcceptanceEligible: false,
  };

  let failureStage: Ar12ExecutionWorkspaceCreationFailureStage = 'ROOT_CREATE';
  try {
    await dependencies.filesystem.createDirectory(resolvedWorkspace.externalWorkspaceRoot);
    const postCreateCanonicalRoot = await dependencies.filesystem.canonicalize(
      resolvedWorkspace.externalWorkspaceRoot,
    );
    if (!samePath(postCreateCanonicalRoot, resolvedWorkspace.canonicalExternalWorkspaceRoot)) {
      fail('AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE', 'external root changed identity during creation');
    }
    failureStage = 'CLONE';
    await dependencies.git.run(dirname(resolvedWorkspace.workspacePath), gitWithHooksDisabled([
      'clone',
      '--template=',
      '--local',
      '--no-hardlinks',
      '--no-checkout',
      '--',
      resolvedWorkspace.repositoryRoot,
      resolvedWorkspace.workspacePath,
    ]), localOnlyGitEnvironment());
    failureStage = 'CHECKOUT';
    await dependencies.git.run(resolvedWorkspace.workspacePath, gitWithHooksDisabled([
      'checkout',
      '-B',
      targetBranch,
      sourceState.gitCommitSha,
    ]), localOnlyGitEnvironment());
    failureStage = 'ORIGIN_RESTORE';
    await dependencies.git.run(resolvedWorkspace.workspacePath, gitWithHooksDisabled([
      'remote',
      'set-url',
      'origin',
      sourceState.originUrl,
    ]), localOnlyGitEnvironment());
    failureStage = 'MARKER';
    await excludeWorkspaceMarker(resolvedWorkspace.workspacePath, dependencies.filesystem);
    await dependencies.filesystem.writeExclusive(
      join(resolvedWorkspace.workspacePath, AR12_EXECUTION_WORKSPACE_MARKER),
      Buffer.from(JSON.stringify(marker, null, 2) + '\n', 'utf8'),
    );
    failureStage = 'VERIFY';
    await verifyAr12ExecutionWorkspace(resolvedWorkspace.workspacePath, marker, dependencies);
  } catch (error: unknown) {
    if (error instanceof Ar12ExecutionWorkspaceCreationError) throw error;
    throw await buildCreationError(
      error,
      resolvedWorkspace.workspacePath,
      resolvedWorkspace.canonicalWorkspacePath,
      failureStage,
      dependencies,
    );
  }
  return { workspacePath: resolvedWorkspace.workspacePath, resolved: resolvedWorkspace, marker };
}

export async function verifyAr12ExecutionWorkspace(
  workspacePath: string,
  expectedMarker: Ar12ExecutionWorkspaceMarker,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<Ar12ExecutionWorkspaceTerminalIdentity> {
  return verifyAr12ExecutionWorkspaceIdentity(workspacePath, expectedMarker, true, dependencies);
}

async function buildCreationError(
  error: unknown,
  workspacePath: string,
  canonicalWorkspacePath: string,
  failureStage: Ar12ExecutionWorkspaceCreationFailureStage,
  dependencies: Ar12ExecutionWorkspaceDependencies,
): Promise<Ar12ExecutionWorkspaceCreationError> {
  const failureCode = error instanceof Ar12ExecutionWorkspaceError
    ? error.code
    : 'AR12_EXECUTION_WORKSPACE_CREATE_FAILED';
  let partialRetained = false;
  let terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity | null = null;
  let identityFailureCode: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' | null =
    failureCode === 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'
      ? 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH'
      : null;
  try {
    partialRetained = await dependencies.filesystem.kind(workspacePath) === 'DIRECTORY';
  } catch {
    partialRetained = false;
  }
  if (partialRetained) {
    try {
      if (await dependencies.filesystem.kind(join(workspacePath, '.git')) !== 'MISSING') {
        terminalIdentity = await readGitIdentity(workspacePath, dependencies.git);
      }
    } catch {
      identityFailureCode = 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH';
    }
  }
  return new Ar12ExecutionWorkspaceCreationError({
    workspacePath,
    workspacePathDigest: sha256(canonicalDigestPath(canonicalWorkspacePath)),
    partialRetained,
    terminalIdentity,
    identityFailureCode,
    failureCode,
    failureStage,
  });
}

export async function loadAr12ExecutionWorkspaceMarker(
  workspacePath: string,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<Ar12ExecutionWorkspaceMarker> {
  const canonicalWorkspace = await requireCanonicalDirectory(
    resolve(workspacePath),
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  const marker = await readMarker(workspacePath, dependencies.filesystem);
  const canonicalExternalRoot = await requireCanonicalDirectory(
    resolve(marker.externalWorkspaceRoot),
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  if (
    samePath(canonicalWorkspace, canonicalExternalRoot) ||
    !isPathWithin(canonicalExternalRoot, canonicalWorkspace) ||
    !GIT_COMMIT_PATTERN.test(marker.openingGitCommitSha) ||
    !/^[0-9a-f]{64}$/u.test(marker.sourceRepositoryRootDigest) ||
    !validBranch(marker.targetBranch) ||
    !/^[a-z0-9._-]+\/[a-z0-9._-]+$/u.test(marker.repositoryIdentity) ||
    !isAbsolute(marker.externalWorkspaceRoot)
  ) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'marker semantic identity differs');
  }
  requireTimestamp(marker.createdAt);
  requireNonEmpty(marker.runPurpose, 'run purpose');
  return marker;
}

async function verifyAr12ExecutionWorkspaceIdentity(
  workspacePath: string,
  expectedMarker: Ar12ExecutionWorkspaceMarker,
  requireClean: boolean,
  dependencies: Ar12ExecutionWorkspaceDependencies,
): Promise<Ar12ExecutionWorkspaceTerminalIdentity> {
  const canonicalWorkspace = await canonicalizeOrFail(
    workspacePath,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  const canonicalExternalRoot = await canonicalizeOrFail(
    expectedMarker.externalWorkspaceRoot,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  if (!isPathWithin(canonicalExternalRoot, canonicalWorkspace) || samePath(canonicalExternalRoot, canonicalWorkspace)) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'workspace is outside the marked external root');
  }
  const actualMarker = await loadAr12ExecutionWorkspaceMarker(workspacePath, dependencies);
  if (canonicalJson(actualMarker) !== canonicalJson(expectedMarker)) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'marker identity differs');
  }
  const state = await readGitIdentity(workspacePath, dependencies.git);
  if (
    state.gitCommitSha !== expectedMarker.openingGitCommitSha ||
    state.branch !== expectedMarker.targetBranch ||
    repositoryIdentityFromGitHubOrigin(state.originUrl) !== expectedMarker.repositoryIdentity ||
    (requireClean && state.worktreeState !== 'CLEAN')
  ) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'terminal Git identity differs');
  }
  return state;
}

export async function cleanupAr12ExecutionWorkspace(
  workspacePath: string,
  expectedMarker: Ar12ExecutionWorkspaceMarker,
  options: AssertAr12ExecutionWorkspaceCleanupTargetOptions,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<void> {
  await assertAr12ExecutionWorkspaceCleanupTarget(workspacePath, {
    ...options,
    filesystem: dependencies.filesystem,
  });
  await verifyAr12ExecutionWorkspace(workspacePath, expectedMarker, dependencies);
  await dependencies.filesystem.removeDirectory(workspacePath);
}

export async function assertAr12ExecutionWorkspaceCleanupTarget(
  workspacePath: string,
  options: AssertAr12ExecutionWorkspaceCleanupTargetOptions,
): Promise<void> {
  const filesystem = options.filesystem ?? nodeFileSystem;
  const canonicalWorkspace = await canonicalizeOrFail(
    workspacePath,
    filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  const canonicalRepository = await requireCanonicalDirectory(
    options.repositoryRoot,
    filesystem,
    'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
  );
  if (pathsOverlap(canonicalRepository, canonicalWorkspace)) {
    fail('AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY', 'cleanup target overlaps repository');
  }
  for (const evidenceDirectory of options.evidenceDirectories) {
    const canonicalEvidence = await requireCanonicalDirectory(
      evidenceDirectory,
      filesystem,
      'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
    );
    if (pathsOverlap(canonicalEvidence, canonicalWorkspace)) {
      fail('AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE', 'cleanup target overlaps evidence');
    }
  }
}

export async function retainAr12ExecutionWorkspaceAfterFailure(
  workspacePath: string,
  expectedMarker: Ar12ExecutionWorkspaceMarker,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<{ readonly retained: true; readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity }> {
  const terminalIdentity = await verifyAr12ExecutionWorkspaceIdentity(
    workspacePath,
    expectedMarker,
    false,
    dependencies,
  );
  return { retained: true, terminalIdentity };
}

export async function assertRepositoryNotContaminatedByExecutionWorkspace(
  repositoryRoot: string,
  options: AssertRepositoryNotContaminatedOptions = {},
): Promise<void> {
  const filesystem = options.filesystem ?? nodeFileSystem;
  const root = resolve(repositoryRoot);
  const canonicalRoot = await requireCanonicalDirectory(
    root,
    filesystem,
    'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE',
  );
  if (options.executionWorkspacePath !== undefined) {
    const canonicalExecution = await canonicalizeOrFail(
      options.executionWorkspacePath,
      filesystem,
      'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE',
    );
    if (pathsOverlap(canonicalRoot, canonicalExecution)) {
      fail(
        'AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE',
        'execution workspace overlaps repository',
      );
    }
  }
  const evidenceDirectories = await Promise.all((options.evidenceDirectories ?? []).map(
    (path) => filesystem.canonicalize(resolve(path)),
  ));
  const contamination = await findRepositoryContamination(
    root,
    root,
    evidenceDirectories,
    filesystem,
  );
  if (contamination !== null) {
    fail('AR12_REPOSITORY_CONTAMINATED_BY_EXECUTION_WORKSPACE', contamination);
  }
}

export async function relocateStaleAr12ExecutionWorkspace(
  input: RelocateStaleAr12ExecutionWorkspaceInput,
  dependencies: Ar12ExecutionWorkspaceDependencies = defaultAr12ExecutionWorkspaceDependencies(),
): Promise<Ar12ExecutionWorkspaceRelocation> {
  const repositoryRoot = await requireCanonicalDirectory(
    resolve(input.repositoryRoot),
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  const allowedRoot = await requireCanonicalDirectory(
    resolve(input.allowedStaleWorktreesRoot),
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  const sourcePath = resolve(input.sourcePath);
  const canonicalSource = await requireCanonicalDirectory(
    sourcePath,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  if (
    !isPathWithin(allowedRoot, canonicalSource) ||
    samePath(allowedRoot, canonicalSource) ||
    !samePath(dirname(canonicalSource), allowedRoot) ||
    !isPathWithin(repositoryRoot, canonicalSource)
  ) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'source is not an exact stale-worktrees child');
  }
  const destinationPath = resolve(input.destinationPath);
  const canonicalDestination = await canonicalizeOrFail(
    destinationPath,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
  );
  if (pathsOverlap(repositoryRoot, canonicalDestination)) {
    fail('AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY', 'archive destination overlaps repository');
  }
  if (await dependencies.filesystem.kind(destinationPath) !== 'MISSING') {
    fail('AR12_EXECUTION_WORKSPACE_ALREADY_EXISTS', 'archive destination already exists');
  }
  if (
    await dependencies.filesystem.kind(join(sourcePath, '.git')) === 'MISSING' ||
    await dependencies.filesystem.kind(join(sourcePath, 'package-lock.json')) !== 'FILE' ||
    looksLikeEvidenceRunDirectory(basename(sourcePath)) ||
    await containsFormalEvidencePackage(sourcePath, dependencies.filesystem)
  ) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'source is not the expected disposable clone');
  }
  const identity = await readGitIdentity(sourcePath, dependencies.git);
  const repositoryIdentity = await readGitIdentity(repositoryRoot, dependencies.git);
  if (
    identity.gitCommitSha !== input.expectedHead ||
    identity.branch !== input.expectedBranch ||
    identity.worktreeState !== 'CLEAN' ||
    repositoryIdentityFromGitHubOrigin(identity.originUrl) !==
      repositoryIdentityFromGitHubOrigin(repositoryIdentity.originUrl)
  ) {
    fail(
      'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
      'stale clone Git identity differs: head=' + identity.gitCommitSha +
        ', branch=' + identity.branch + ', worktree=' + identity.worktreeState,
    );
  }
  const evidence = await validateRelocationEvidenceDirectories(
    repositoryRoot,
    input.failedFinalRunDirectory,
    input.initialRunEvidenceDirectories,
    dependencies.filesystem,
  );
  const protectedEvidenceBefore = await snapshotProtectedEvidence(
    evidence.canonicalDirectories,
    dependencies.filesystem,
  );
  const treeDigestBefore = await digestPhysicalTree(sourcePath, dependencies.filesystem);
  await dependencies.filesystem.createDirectory(dirname(destinationPath));
  const postCreateCanonicalDestination = await canonicalizeOrFail(
    destinationPath,
    dependencies.filesystem,
    'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
  );
  if (!samePath(postCreateCanonicalDestination, canonicalDestination)) {
    fail('AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE', 'archive destination changed identity during parent creation');
  }
  if (pathsOverlap(repositoryRoot, postCreateCanonicalDestination)) {
    fail('AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE', 'archive destination resolves into repository');
  }
  for (const evidenceDirectory of evidence.canonicalDirectories) {
    const canonicalEvidence = await canonicalizeOrFail(
      evidenceDirectory,
      dependencies.filesystem,
      'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
    );
    if (pathsOverlap(canonicalEvidence, postCreateCanonicalDestination)) {
      fail('AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE', 'archive destination overlaps protected evidence');
    }
  }
  try {
    await dependencies.filesystem.rename(sourcePath, destinationPath);
  } catch (error: unknown) {
    fail('AR12_EXECUTION_WORKSPACE_CREATE_FAILED', 'stale clone relocation failed: ' + errorMessage(error));
  }
  const treeDigestAfter = await digestPhysicalTree(destinationPath, dependencies.filesystem);
  if (treeDigestAfter !== treeDigestBefore) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'tree identity changed during relocation');
  }
  await assertProtectedEvidenceUnchanged(protectedEvidenceBefore, dependencies.filesystem);
  return {
    schemaVersion: 'phase-01.ar12-execution-workspace-relocation.v1',
    sourceRelativePath: toPortablePath(relative(repositoryRoot, canonicalSource)),
    destinationPathDigest: sha256(canonicalDigestPath(canonicalDestination)),
    expectedHead: input.expectedHead,
    actualHead: identity.gitCommitSha,
    branch: identity.branch,
    treeDigestBefore,
    treeDigestAfter,
    relocationStatus: 'RELOCATED',
    failedFinalRunDirectory: evidence.failedFinalRelativePath,
    failedFinalRunDirectoryPreserved: true,
    initialRunEvidenceDirectoriesPreserved: evidence.initialRelativePaths,
    relocatedAt: requireTimestamp(input.relocatedAt ?? dependencies.now()),
  };
}

async function assertExternalBoundary(
  lexicalPath: string,
  canonicalPath: string,
  canonicalRepositoryRoot: string,
  input: ResolveAr12ExecutionWorkspaceInput,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<void> {
  const lexicalInsideRepository = isPathWithin(canonicalRepositoryRoot, resolve(lexicalPath));
  const canonicalInsideRepository = isPathWithin(canonicalRepositoryRoot, canonicalPath);
  if (canonicalInsideRepository) {
    fail(
      lexicalInsideRepository
        ? 'AR12_EXECUTION_WORKSPACE_INSIDE_REPOSITORY'
        : 'AR12_EXECUTION_WORKSPACE_SYMLINK_ESCAPE',
      'execution workspace resolves inside repository',
    );
  }
  if (isPathWithin(canonicalPath, canonicalRepositoryRoot)) {
    fail('AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE', 'execution root contains repository');
  }
  const evidencePaths = [
    ...(input.evidenceDirectories ?? []),
    ...(input.sourceEvidenceDirectories ?? []),
    ...(input.reviewOutputDirectories ?? []),
  ];
  for (const evidencePath of evidencePaths) {
    const canonicalEvidence = await canonicalizeOrFail(
      resolve(evidencePath),
      filesystem,
      'AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE',
    );
    if (pathsOverlap(canonicalEvidence, canonicalPath)) {
      fail('AR12_EXECUTION_WORKSPACE_INSIDE_EVIDENCE', 'execution workspace overlaps evidence');
    }
  }
}

async function readGitIdentity(
  repositoryRoot: string,
  git: Ar12ExecutionWorkspaceGit,
): Promise<Ar12ExecutionWorkspaceTerminalIdentity> {
  try {
    const [head, branch, origin, status] = await Promise.all([
      git.run(repositoryRoot, gitWithIdentityIsolation(['rev-parse', 'HEAD']), localOnlyGitEnvironment()),
      git.run(repositoryRoot, gitWithIdentityIsolation(['branch', '--show-current']), localOnlyGitEnvironment()),
      git.run(repositoryRoot, gitWithIdentityIsolation(['config', '--get', 'remote.origin.url']), localOnlyGitEnvironment()),
      git.run(repositoryRoot, gitWithIdentityIsolation([
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ]), localOnlyGitEnvironment()),
    ]);
    return {
      gitCommitSha: head.stdout.trim(),
      branch: branch.stdout.trim(),
      originUrl: origin.stdout.trim(),
      worktreeState: status.stdout.trim() === '' ? 'CLEAN' : 'DIRTY',
    };
  } catch (error: unknown) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'Git identity unavailable: ' + errorMessage(error));
  }
}

async function readMarker(
  workspacePath: string,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<Ar12ExecutionWorkspaceMarker> {
  let value: unknown;
  try {
    value = JSON.parse((await filesystem.read(join(workspacePath, AR12_EXECUTION_WORKSPACE_MARKER))).toString('utf8'));
  } catch (error: unknown) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'marker unavailable: ' + errorMessage(error));
  }
  if (!isRecord(value)) fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'marker is not an object');
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    'createdAt',
    'externalWorkspaceRoot',
    'formalAcceptanceEligible',
    'openingGitCommitSha',
    'repositoryIdentity',
    'runPurpose',
    'schemaVersion',
    'sourceRepositoryRootDigest',
    'targetBranch',
  ].sort();
  if (canonicalJson(keys) !== canonicalJson(expectedKeys)) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'marker fields differ');
  }
  if (
    value['schemaVersion'] !== AR12_EXECUTION_WORKSPACE_SCHEMA_VERSION ||
    value['formalAcceptanceEligible'] !== false ||
    typeof value['repositoryIdentity'] !== 'string' ||
    typeof value['sourceRepositoryRootDigest'] !== 'string' ||
    typeof value['openingGitCommitSha'] !== 'string' ||
    typeof value['targetBranch'] !== 'string' ||
    typeof value['runPurpose'] !== 'string' ||
    typeof value['createdAt'] !== 'string' ||
    typeof value['externalWorkspaceRoot'] !== 'string'
  ) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'marker schema differs');
  }
  return value as unknown as Ar12ExecutionWorkspaceMarker;
}

async function excludeWorkspaceMarker(
  workspacePath: string,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<void> {
  const excludePath = join(workspacePath, '.git', 'info', 'exclude');
  await filesystem.createDirectory(dirname(excludePath));
  await filesystem.append(excludePath, Buffer.from('\n/' + AR12_EXECUTION_WORKSPACE_MARKER + '\n', 'utf8'));
}

async function findRepositoryContamination(
  path: string,
  repositoryRoot: string,
  evidenceDirectories: readonly string[],
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<string | null> {
  const canonical = await filesystem.canonicalize(path);
  if (evidenceDirectories.some((evidence) => pathsOverlap(evidence, canonical) && isPathWithin(evidence, canonical))) {
    return null;
  }
  const entries = await filesystem.listDirectory(path);
  for (const entry of entries) {
    const child = join(path, entry.name);
    const relativePath = toPortablePath(relative(repositoryRoot, child));
    if (relativePath === '.git' || relativePath.startsWith('.git/') || entry.name === 'node_modules') continue;
    if (entry.name === AR12_EXECUTION_WORKSPACE_MARKER) return relativePath;
    if (entry.name === '.git') return relativePath;
    if (entry.name === 'package-lock.json' && !samePath(child, join(repositoryRoot, 'package-lock.json'))) {
      return relativePath;
    }
    if (entry.kind === 'DIRECTORY') {
      const nested = await findRepositoryContamination(child, repositoryRoot, evidenceDirectories, filesystem);
      if (nested !== null) return nested;
    }
  }
  return null;
}

async function containsFormalEvidencePackage(
  root: string,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<boolean> {
  const formalMarkers = [
    'formal-abg-summary.json',
    'formal-run-summary.json',
    'producer-source-manifest.json',
    'reviewer-source-manifest.json',
  ];
  for (const marker of formalMarkers) {
    if (await filesystem.kind(join(root, marker)) !== 'MISSING') return true;
  }
  return false;
}

async function snapshotProtectedEvidence(
  directories: readonly string[],
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  for (const directory of directories) {
    const canonical = await requireCanonicalDirectory(
      resolve(directory),
      filesystem,
      'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    );
    snapshot.set(canonical, await digestPhysicalTree(canonical, filesystem));
  }
  return snapshot;
}

interface ValidatedRelocationEvidence {
  readonly canonicalDirectories: readonly string[];
  readonly failedFinalRelativePath: string;
  readonly initialRelativePaths: readonly string[];
}

async function validateRelocationEvidenceDirectories(
  repositoryRoot: string,
  failedFinalRunDirectory: string,
  initialRunEvidenceDirectories: readonly string[],
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<ValidatedRelocationEvidence> {
  const runRoot = await requireCanonicalDirectory(
    join(repositoryRoot, '.runtime', 'rebaseline', 'ar-12'),
    filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  const failedFinal = await requireCanonicalDirectory(
    resolve(failedFinalRunDirectory),
    filesystem,
    'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
  );
  if (
    !samePath(dirname(failedFinal), runRoot) ||
    !/^\d{8}-[0-9a-f]{7,64}-final$/u.test(basename(failedFinal))
  ) {
    fail(
      'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
      'failed-final evidence is not an exact AR-12 final run directory',
    );
  }
  if (initialRunEvidenceDirectories.length === 0) {
    fail(
      'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
      'at least one actual initial precloseout evidence directory is required',
    );
  }

  const initialDirectories: string[] = [];
  const seen = new Set<string>([normalizeForComparison(failedFinal)]);
  for (const directory of initialRunEvidenceDirectories) {
    const canonical = await requireCanonicalDirectory(
      resolve(directory),
      filesystem,
      'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
    );
    const comparison = normalizeForComparison(canonical);
    if (
      !samePath(dirname(canonical), runRoot) ||
      !/^\d{8}-[0-9a-f]{7,64}-precloseout(?:-r[1-9]\d*)?$/u.test(basename(canonical)) ||
      seen.has(comparison)
    ) {
      fail(
        'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH',
        'initial evidence is not a unique exact AR-12 precloseout run directory',
      );
    }
    seen.add(comparison);
    initialDirectories.push(canonical);
  }
  return {
    canonicalDirectories: [failedFinal, ...initialDirectories],
    failedFinalRelativePath: toPortablePath(relative(repositoryRoot, failedFinal)),
    initialRelativePaths: initialDirectories.map(
      (directory) => toPortablePath(relative(repositoryRoot, directory)),
    ),
  };
}

async function assertProtectedEvidenceUnchanged(
  before: ReadonlyMap<string, string>,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<void> {
  for (const [path, digest] of before) {
    if (await digestPhysicalTree(path, filesystem) !== digest) {
      fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'protected evidence changed during relocation');
    }
  }
}

async function digestPhysicalTree(
  root: string,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
): Promise<string> {
  const hash = createHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = [...await filesystem.listDirectory(path)].sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = join(path, entry.name);
      const relativePath = toPortablePath(relative(root, absolute));
      hash.update(entry.kind + '\0' + relativePath + '\0');
      if (entry.kind === 'DIRECTORY') await visit(absolute);
      else if (entry.kind === 'FILE') hash.update(await filesystem.read(absolute));
      else if (entry.kind === 'SYMLINK') hash.update(await filesystem.readLink(absolute));
      else fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'unsupported tree entry: ' + relativePath);
      hash.update('\0');
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function requireCanonicalDirectory(
  path: string,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
  code: Ar12ExecutionWorkspaceErrorCode,
): Promise<string> {
  if (await filesystem.kind(path) !== 'DIRECTORY') fail(code, 'directory is missing or unsafe');
  return canonicalizeOrFail(path, filesystem, code);
}

async function canonicalizeOrFail(
  path: string,
  filesystem: Ar12ExecutionWorkspaceFileSystem,
  code: Ar12ExecutionWorkspaceErrorCode,
): Promise<string> {
  try {
    return resolve(await filesystem.canonicalize(resolve(path)));
  } catch (error: unknown) {
    fail(code, 'canonicalization failed: ' + errorMessage(error));
  }
}

function resolveConfiguredRoot(value: string, base: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('\0')) fail('AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE', 'root contains NUL');
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(base, trimmed);
}

function safeRepositoryId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '');
  if (!SAFE_IDENTITY_COMPONENT.test(normalized)) {
    fail('AR12_EXECUTION_WORKSPACE_ROOT_UNSAFE', 'repository id is unsafe');
  }
  return normalized;
}

function repositoryIdentityFromGitHubOrigin(originUrl: string): string {
  const normalized = originUrl.trim().replaceAll('\\', '/').replace(/\.git$/u, '');
  const match = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+)$/u.exec(normalized);
  if (match?.[1] === undefined) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'origin is not a GitHub repository URL');
  }
  return match[1].toLowerCase();
}

function validBranch(branch: string): boolean {
  return branch.length > 0 && !branch.startsWith('-') && !/[\s~^:?*[\\]/u.test(branch) && !branch.includes('..');
}

function looksLikeEvidenceRunDirectory(name: string): boolean {
  return /^\d{8}-.*(?:precloseout|final)/u.test(name);
}

function localOnlyGitEnvironment(): Readonly<Record<string, string>> {
  const nullDevice = gitNullDevice();
  return {
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_CONFIG_COUNT: '0',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_PARAMETERS: '',
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_TEMPLATE_DIR: '',
  };
}

function gitWithHooksDisabled(arguments_: readonly string[]): readonly string[] {
  return ['-c', 'core.hooksPath=' + gitNullDevice(), ...arguments_];
}

function gitWithIdentityIsolation(arguments_: readonly string[]): readonly string[] {
  return [
    '-c',
    'core.hooksPath=' + gitNullDevice(),
    '-c',
    'core.fsmonitor=false',
    ...arguments_,
  ];
}

function gitNullDevice(): string {
  return process.platform === 'win32' ? 'NUL' : '/dev/null';
}

function canonicalDigestPath(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/').replace(/\/+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isPathWithin(parent: string, child: string): boolean {
  const relativePath = relative(normalizeForComparison(parent), normalizeForComparison(child));
  return relativePath === '' || (!relativePath.startsWith('..' + sep) && relativePath !== '..' && !isAbsolute(relativePath));
}

function pathsOverlap(left: string, right: string): boolean {
  return isPathWithin(left, right) || isPathWithin(right, left);
}

function samePath(left: string, right: string): boolean {
  return normalizeForComparison(left) === normalizeForComparison(right);
}

function normalizeForComparison(path: string): string {
  const normalized = stripWindowsExtendedPrefix(resolve(path)).replace(/[\\/]+$/u, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function stripWindowsExtendedPrefix(path: string): string {
  return path.startsWith('\\\\?\\UNC\\')
    ? '\\\\' + path.slice(8)
    : path.startsWith('\\\\?\\')
      ? path.slice(4)
      : path;
}

function toPortablePath(path: string): string {
  return path.replaceAll('\\', '/');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value)) || !value.endsWith('Z')) {
    fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', 'timestamp must be UTC ISO-8601');
  }
  return value;
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === '') fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH', label + ' is empty');
  return trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(code: Ar12ExecutionWorkspaceErrorCode, detail?: string): never {
  throw new Ar12ExecutionWorkspaceError(code, detail);
}

const nodeGit: Ar12ExecutionWorkspaceGit = {
  async run(cwd, arguments_, environment) {
    const result = await execFileAsync('git', [...arguments_], {
      cwd,
      encoding: 'utf8',
      env: sanitizedGitProcessEnvironment(environment),
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function sanitizedGitProcessEnvironment(
  explicitEnvironment: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const inheritedNonGitEnvironment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^GIT_/iu.test(key) && value !== undefined) inheritedNonGitEnvironment[key] = value;
  }
  return { ...inheritedNonGitEnvironment, ...explicitEnvironment };
}

const nodeFileSystem: Ar12ExecutionWorkspaceFileSystem = {
  canonicalize: canonicalizeExistingOrNearest,
  async kind(path) {
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return 'SYMLINK';
      if (stat.isDirectory()) return 'DIRECTORY';
      if (stat.isFile()) return 'FILE';
      return 'OTHER';
    } catch (error: unknown) {
      if (isMissingError(error)) return 'MISSING';
      throw error;
    }
  },
  async createDirectory(path) {
    await mkdir(path, { recursive: true });
  },
  read: readFile,
  async writeExclusive(path, bytes) {
    await writeFile(path, bytes, { flag: 'wx' });
  },
  async append(path, bytes) {
    await appendFile(path, bytes);
  },
  async removeDirectory(path) {
    await rm(path, { recursive: true, force: false });
  },
  async rename(source, destination) {
    await rename(source, destination);
  },
  async listDirectory(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry): Ar12DirectoryEntry => ({
      name: entry.name,
      kind: entry.isSymbolicLink()
        ? 'SYMLINK'
        : entry.isDirectory()
          ? 'DIRECTORY'
          : entry.isFile()
            ? 'FILE'
            : 'OTHER',
    }));
  },
  readLink: readlink,
};

async function canonicalizeExistingOrNearest(path: string): Promise<string> {
  const absolute = resolve(path);
  let ancestor = absolute;
  const missingComponents: string[] = [];
  while (true) {
    try {
      const canonicalAncestor = await realpath(ancestor);
      return resolve(canonicalAncestor, ...missingComponents.reverse());
    } catch (error: unknown) {
      if (!isMissingError(error)) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missingComponents.push(basename(ancestor));
      ancestor = parent;
    }
  }
}

function isMissingError(error: unknown): boolean {
  return isRecord(error) && (error['code'] === 'ENOENT' || error['code'] === 'ENOTDIR');
}
