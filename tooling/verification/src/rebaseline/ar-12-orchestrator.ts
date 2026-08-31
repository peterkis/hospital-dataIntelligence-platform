import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  readFile,
  readdir,
  realpath,
  stat,
  unlink,
} from 'node:fs/promises';
import {
  basename,
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  AR12_EXECUTION_WORKSPACE_MARKER,
  Ar12ExecutionWorkspaceCreationError,
  Ar12ExecutionWorkspaceError,
  assertRepositoryNotContaminatedByExecutionWorkspace,
  cleanupAr12ExecutionWorkspace,
  createAr12ExecutionWorkspace,
  loadAr12ExecutionWorkspaceMarker,
  retainAr12ExecutionWorkspaceAfterFailure,
  verifyAr12ExecutionWorkspace,
  type Ar12ExecutionWorkspaceMarker,
  type Ar12ExecutionWorkspaceCreationFailureStage,
  type Ar12ExecutionWorkspaceTerminalIdentity,
  type AssertAr12ExecutionWorkspaceCleanupTargetOptions,
  type CreateAr12ExecutionWorkspaceInput,
  type CreatedAr12ExecutionWorkspace,
} from './ar-12-execution-workspace.js';
import {
  AR12_HISTORY_EVIDENCE_CONTRACT,
  assertAr12HistoryEvidenceStable,
  captureAr12HistoryEvidenceBaseline,
  type Ar12HistoryEvidenceBaseline,
} from './ar-12-history-evidence-contract.js';

type RunKind = 'initial' | 'final';
type CommandCategory =
  | 'LOCKFILE_INSTALL'
  | 'SAFE_STATIC'
  | 'SAFE_UNIT'
  | 'SAFE_SYNTHETIC_RUNTIME';
type SkipPolicy = 'NONE' | 'FOCUSED_SELECTION' | 'REAL_RUNTIME_BOUNDARY';

export interface Ar12CommandSpec {
  readonly id: string;
  readonly category: CommandCategory;
  readonly executable: 'npm' | 'node' | 'bash' | 'git';
  readonly args: readonly string[];
  readonly cwd: string;
  readonly expectedExitCodes: readonly [0];
  readonly suiteKey?: SuiteKey;
  readonly minimumFilesPassed?: number;
  readonly minimumTestsPassed?: number;
  readonly expectedTestsSkipped?: number;
  readonly skipPolicy: SkipPolicy;
  readonly standaloneCheckIds?: readonly number[];
  readonly captureAdversarialSummary?: true;
}

type CommandSpec = Ar12CommandSpec;

export interface Ar12InitializeInput {
  readonly repositoryRoot: string;
  readonly sourceRepositoryRoot: string;
  readonly outputRoot: string;
  readonly runDirectory: string;
  readonly expectedBranch: string;
  readonly expectedCommit: string;
  readonly runKind: RunKind;
}

export interface Ar12RunCommandsOptions {
  readonly contaminationRepositoryRoot: string;
}

export interface Ar12ExternalExecutionWorkspaceRunInput {
  readonly sourceRepositoryRoot: string;
  readonly outputRoot: string;
  readonly runDirectory: string;
  readonly expectedBranch: string;
  readonly expectedCommit: string;
  readonly runKind: RunKind;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
}

export interface Ar12RetainedWorkspaceReceipt {
  readonly schemaVersion: 'phase-01.ar-12-retained-workspace.v1';
  readonly status: 'RETAINED';
  readonly failureCode: string;
  readonly workspacePathDigest: string;
  readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity;
  readonly evidenceRecordStatus: 'RECORDED' | 'OUTPUT_ONLY';
}

export interface Ar12PartialCreationReceipt {
  readonly schemaVersion: 'phase-01.ar-12-partial-creation.v1';
  readonly status: 'PARTIAL_RETAINED' | 'NO_PARTIAL_RETAINED';
  readonly failureCode: string;
  readonly failureStage: Ar12ExecutionWorkspaceCreationFailureStage;
  readonly workspacePathDigest: string;
  readonly partialRetained: boolean;
  readonly terminalIdentity: {
    readonly gitCommitSha: string;
    readonly branch: string;
    readonly worktreeState: 'CLEAN' | 'DIRTY';
  } | null;
  readonly identityUnavailable: boolean;
  readonly identityFailureCode: 'AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH' | null;
  readonly evidenceRecordStatus: 'OUTPUT_ONLY';
}

export interface Ar12SuccessfulWorkspaceReceipt {
  readonly schemaVersion: 'phase-01.ar-12-workspace-terminal.v1';
  readonly status: 'VERIFIED_FOR_CLEANUP';
  readonly workspacePathDigest: string;
  readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity;
  readonly cleanupStatus: 'PENDING';
}

export interface Ar12ExternalExecutionWorkspaceRunResult {
  readonly status: 'PASSED';
  readonly workspacePathDigest: string;
  readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity;
  readonly cleanupStatus: 'CLEANED';
  readonly runDirectory: string;
}

export interface Ar12RepositoryBoundaryResult {
  readonly schemaVersion: 'phase-01.ar-12-repository-boundary.v1';
  readonly repositoryContaminationGuard: 'PASSED';
  readonly repoLayoutStatus: 'PASSED';
  readonly historyEvidenceStable: boolean;
  readonly openingHistoryEvidenceDigest: string;
  readonly endingHistoryEvidenceDigest: string;
  readonly protectedHistoryEntryCount: number;
  readonly historyEvidenceContractDigest: string;
  readonly historicalEvidenceSetDigest: string;
  readonly requiredHistoryCount: 6;
  readonly requiredHistoryPassedCount: 6;
  readonly checkedAt: string;
}

export type Ar12HistoryEvidenceSnapshot = Ar12HistoryEvidenceBaseline;

export interface Ar12RepositoryBoundaryInput {
  readonly sourceRepositoryRoot: string;
  readonly outputRoot: string;
  readonly runDirectory: string;
  readonly openingHistoryEvidence: Ar12HistoryEvidenceSnapshot;
  readonly checkedAt: string;
}

export interface Ar12RepositoryBoundaryDependencies {
  assertRepositoryNotContaminatedByExecutionWorkspace(repositoryRoot: string): Promise<void>;
  verifyRepositoryLayout(repositoryRoot: string): Promise<void>;
  captureHistoryEvidenceSnapshot(
    outputRoot: string,
    currentRunDirectory: string,
  ): Promise<Ar12HistoryEvidenceSnapshot>;
}

export function ar12SummaryRepositoryBoundaryFields(
  result: Ar12RepositoryBoundaryResult,
): {
  readonly repositoryContaminationGuard: 'PASSED';
  readonly repoLayoutStatus: 'PASSED';
  readonly historyEvidenceStable: true;
} {
  if (
    result.schemaVersion !== 'phase-01.ar-12-repository-boundary.v1' ||
    result.repositoryContaminationGuard !== 'PASSED' ||
    result.repoLayoutStatus !== 'PASSED' ||
    result.historyEvidenceStable !== true ||
    !/^[0-9a-f]{64}$/u.test(result.openingHistoryEvidenceDigest) ||
    result.endingHistoryEvidenceDigest !== result.openingHistoryEvidenceDigest ||
    !Number.isSafeInteger(result.protectedHistoryEntryCount) ||
    result.protectedHistoryEntryCount < 0 ||
    !/^[0-9a-f]{64}$/u.test(result.historyEvidenceContractDigest) ||
    !/^[0-9a-f]{64}$/u.test(result.historicalEvidenceSetDigest) ||
    result.requiredHistoryCount !== 6 ||
    result.requiredHistoryPassedCount !== 6 ||
    Number.isNaN(Date.parse(result.checkedAt))
  ) fail('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
  return {
    repositoryContaminationGuard: 'PASSED',
    repoLayoutStatus: 'PASSED',
    historyEvidenceStable: true,
  };
}

export function validateAr12RepositoryBoundaryArtifact(input: {
  readonly result: Ar12RepositoryBoundaryResult;
  readonly artifactBytes: Buffer;
  readonly expectedSha256: unknown;
  readonly openingHistoryEvidence: Ar12HistoryEvidenceSnapshot;
}): ReturnType<typeof ar12SummaryRepositoryBoundaryFields> {
  if (
    typeof input.expectedSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(input.expectedSha256) ||
    sha256(input.artifactBytes) !== input.expectedSha256 ||
    input.result.openingHistoryEvidenceDigest !== input.openingHistoryEvidence.digest ||
    input.result.protectedHistoryEntryCount !== input.openingHistoryEvidence.entries.length ||
    input.result.historyEvidenceContractDigest !== input.openingHistoryEvidence.historyContractDigest ||
    input.result.historicalEvidenceSetDigest !== input.openingHistoryEvidence.historicalEvidenceSetDigest ||
    input.result.requiredHistoryCount !== input.openingHistoryEvidence.requiredHistoryCount ||
    input.result.requiredHistoryPassedCount !== input.openingHistoryEvidence.requiredHistoryPassedCount
  ) fail('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
  return ar12SummaryRepositoryBoundaryFields(input.result);
}

async function verifyAr12RepositoryLayout(repositoryRoot: string): Promise<void> {
  const root = await assertPhysicalDirectory(repositoryRoot, 'AR12_REPOSITORY_ROOT_UNSAFE');
  await assertSafeRegularFile(root, 'tooling/verification/src/check-repo-layout.mjs');
  const modules = await loadAuthorityModules(root);
  const runner = new modules.runner.SpawnRuntimeCommandRunner();
  const invocation = await runtimeInvocation('npm', ['run', 'check:repo:layout'], root);
  const result = await runner.run({
    executable: invocation.executable,
    args: invocation.args,
    cwd: root,
  });
  const outputLines = result.stdout.trim().split(/\r?\n/u);
  if (
    result.exitCode !== 0 ||
    result.signal !== null ||
    outputLines.at(-1) !==
      'Repository topology verified: 8 workspaces, one Git root, one npm lock.'
  ) fail('AR12_REPOSITORY_LAYOUT_FAILED');
}

export async function verifyAr12RepositoryBoundary(
  input: Ar12RepositoryBoundaryInput,
  dependencies: Ar12RepositoryBoundaryDependencies = {
    assertRepositoryNotContaminatedByExecutionWorkspace,
    verifyRepositoryLayout: verifyAr12RepositoryLayout,
    captureHistoryEvidenceSnapshot: captureAr12HistoryEvidenceSnapshot,
  },
): Promise<Ar12RepositoryBoundaryResult> {
  if (
    input.openingHistoryEvidence.schemaVersion !==
      'phase-01.ar-12-history-evidence-baseline.v1' ||
    !/^[0-9a-f]{64}$/u.test(input.openingHistoryEvidence.digest) ||
    Number.isNaN(Date.parse(input.checkedAt))
  ) fail('AR12_HISTORY_EVIDENCE_SNAPSHOT_INVALID');
  await dependencies.assertRepositoryNotContaminatedByExecutionWorkspace(
    input.sourceRepositoryRoot,
  );
  await dependencies.verifyRepositoryLayout(input.sourceRepositoryRoot);
  const endingHistoryEvidence = await dependencies.captureHistoryEvidenceSnapshot(
    input.outputRoot,
    input.runDirectory,
  );
  assertAr12HistoryEvidenceStable(input.openingHistoryEvidence, endingHistoryEvidence);
  return passedAr12RepositoryBoundaryResult(
    input.openingHistoryEvidence,
    input.checkedAt,
  );
}

function passedAr12RepositoryBoundaryResult(
  openingHistoryEvidence: Ar12HistoryEvidenceSnapshot,
  checkedAt: string,
): Ar12RepositoryBoundaryResult {
  return {
    schemaVersion: 'phase-01.ar-12-repository-boundary.v1',
    repositoryContaminationGuard: 'PASSED',
    repoLayoutStatus: 'PASSED',
    historyEvidenceStable: true,
    openingHistoryEvidenceDigest: openingHistoryEvidence.digest,
    endingHistoryEvidenceDigest: openingHistoryEvidence.digest,
    protectedHistoryEntryCount: openingHistoryEvidence.entries.length,
    historyEvidenceContractDigest: openingHistoryEvidence.historyContractDigest,
    historicalEvidenceSetDigest: openingHistoryEvidence.historicalEvidenceSetDigest,
    requiredHistoryCount: openingHistoryEvidence.requiredHistoryCount,
    requiredHistoryPassedCount: openingHistoryEvidence.requiredHistoryPassedCount,
    checkedAt,
  };
}

function repositoryBoundaryArtifactBytes(result: Ar12RepositoryBoundaryResult): Buffer {
  return Buffer.from(JSON.stringify(result, null, 2) + '\n', 'utf8');
}

export class Ar12ExternalExecutionWorkspaceRunError extends Error {
  readonly code: string;
  readonly retainedWorkspace: Ar12RetainedWorkspaceReceipt | undefined;
  readonly partialCreation: Ar12PartialCreationReceipt | undefined;
  readonly retentionFailureCode: string | undefined;

  constructor(input: {
    readonly code: string;
    readonly cause: unknown;
    readonly retainedWorkspace?: Ar12RetainedWorkspaceReceipt;
    readonly partialCreation?: Ar12PartialCreationReceipt;
    readonly retentionFailureCode?: string;
  }) {
    super(input.code, { cause: input.cause });
    this.name = 'Ar12ExternalExecutionWorkspaceRunError';
    this.code = input.code;
    this.retainedWorkspace = input.retainedWorkspace;
    this.partialCreation = input.partialCreation;
    this.retentionFailureCode = input.retentionFailureCode;
  }
}

export interface Ar12ExternalExecutionWorkspaceDependencies {
  assertRepositoryNotContaminatedByExecutionWorkspace(repositoryRoot: string): Promise<void>;
  preflightAr12RunOutput(
    sourceRepositoryRoot: string,
    outputRoot: string,
    runDirectory: string,
  ): Promise<void>;
  validateHistoryEvidencePreflight(
    outputRoot: string,
    runDirectory: string,
  ): Promise<Ar12HistoryEvidenceBaseline>;
  createAr12ExecutionWorkspace(
    input: CreateAr12ExecutionWorkspaceInput,
  ): Promise<CreatedAr12ExecutionWorkspace>;
  loadAr12ExecutionWorkspaceMarker(workspacePath: string): Promise<Ar12ExecutionWorkspaceMarker>;
  initialize(input: Ar12InitializeInput): Promise<void>;
  runCommands(
    repositoryRoot: string,
    runDirectory: string,
    options: Ar12RunCommandsOptions,
  ): Promise<void>;
  finalize(repositoryRoot: string, runDirectory: string): Promise<void>;
  verifyAr12ExecutionWorkspace(
    workspacePath: string,
    expectedMarker: Ar12ExecutionWorkspaceMarker,
  ): Promise<Ar12ExecutionWorkspaceTerminalIdentity>;
  recordSuccessfulWorkspace(
    repositoryRoot: string,
    runDirectory: string,
    receipt: Ar12SuccessfulWorkspaceReceipt,
  ): Promise<void>;
  cleanupAr12ExecutionWorkspace(
    workspacePath: string,
    expectedMarker: Ar12ExecutionWorkspaceMarker,
    options: AssertAr12ExecutionWorkspaceCleanupTargetOptions,
  ): Promise<void>;
  retainAr12ExecutionWorkspaceAfterFailure(
    workspacePath: string,
    expectedMarker: Ar12ExecutionWorkspaceMarker,
  ): Promise<{
    readonly retained: true;
    readonly terminalIdentity: Ar12ExecutionWorkspaceTerminalIdentity;
  }>;
  recordRetainedWorkspace(
    repositoryRoot: string,
    runDirectory: string,
    receipt: Ar12RetainedWorkspaceReceipt,
  ): Promise<void>;
}

type SuiteKey =
  | 'verification'
  | 'lifecycle'
  | 'podmanRuntime'
  | 'provenance'
  | 'testcontainersGuard'
  | 'standaloneTeardown';

interface TestCounts {
  readonly filesPassed: number;
  readonly filesFailed: number;
  readonly filesSkipped: number;
  readonly testsPassed: number;
  readonly testsFailed: number;
  readonly testsSkipped: number;
  readonly testsTodo: number;
}

export function isAr12AdversarialFloorSatisfied(counts: {
  readonly mutationCount: number;
  readonly detectedCount: number;
  readonly survivedCount: number;
}): boolean {
  return counts.mutationCount >= 158 &&
    counts.detectedCount === counts.mutationCount &&
    counts.survivedCount === 0;
}

interface BaselineIdentity {
  readonly schemaVersion: 'phase-01.ar-12-baseline-identity.v1';
  readonly purpose: 'AR-12_REBASELINE';
  readonly formalAcceptanceEligible: false;
  readonly realServicesStarted: false;
  readonly sharedReadinessExecuted: false;
  readonly formalAbgExecuted: false;
  readonly branch: string;
  readonly gitCommitSha: string;
  readonly worktreeState: 'CLEAN';
  readonly nodeVersion: string;
  readonly npmVersion: string;
  readonly npmCliPath: string;
  readonly npmCliSha256: string;
  readonly npmPackageJsonSha256: string;
  readonly packageJsonSha256: string;
  readonly lockfileSha256: string;
  readonly contractIdentity: Readonly<Record<string, unknown>>;
  readonly coverageMatrixDigest: string;
  readonly producerProtocolIdentityDigest: string;
  readonly verificationAuthorityIdentity: Readonly<Record<string, string>>;
  readonly sourceManifestFileCount: number;
  readonly sourceManifestDigest: string;
  readonly sourceManifestSha256: string;
  readonly runtimeAuthoritySchemaVersion: number;
  readonly runtimeAuthorityId: string;
  readonly runtimeAuthoritySha256: string;
  readonly runtimeAuthoritySemanticDigest: string;
  readonly phase01CompletionTreeFileCount: number;
  readonly phase01CompletionTreeFingerprint: string;
  readonly orchestratorSha256: string;
  readonly startedAt: string;
}

interface RunContext {
  readonly schemaVersion: 'phase-01.ar-12-run-context.v1';
  readonly repositoryRoot: string;
  readonly sourceRepositoryRoot: string;
  readonly outputRoot: string;
  readonly runDirectory: string;
  readonly expectedBranch: string;
  readonly expectedCommit: string;
  readonly runKind: RunKind;
  readonly baselineIdentitySha256: string;
  readonly commandPlanSha256: string;
  readonly producerSourceManifestSha256: string;
  readonly openingHistoryEvidenceSha256: string;
  readonly expectedRepositoryBoundaryResultSha256: string;
  readonly initializedAt: string;
}

interface RecorderModule {
  createEvidenceOutputDirectory(directory: string): Promise<void>;
  createEvidenceSubdirectory(root: string, relativeDirectory: string): Promise<string>;
  writeRedactedTextArtifact(
    root: string,
    relativePath: string,
    text: string,
  ): Promise<{ readonly relativePath: string; readonly sha256: string }>;
  writeRedactedJsonArtifact(
    root: string,
    relativePath: string,
    value: unknown,
  ): Promise<{ readonly relativePath: string; readonly sha256: string }>;
  redactSensitiveText(text: string): string;
}

interface RuntimeCommandResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunnerModule {
  SpawnRuntimeCommandRunner: new () => {
    run(command: {
      readonly executable: string;
      readonly args: readonly string[];
      readonly cwd?: string;
      readonly environment?: Readonly<Record<string, string>>;
    }): Promise<RuntimeCommandResult>;
  };
  FORMAL_REQUIRED_SECRET_NAMES: readonly string[];
}

interface AuthorityModules {
  readonly recorder: RecorderModule;
  readonly runner: RunnerModule;
  readonly contractIdentity: Readonly<Record<string, unknown>>;
  readonly readVerificationAuthorityIdentity: (
    repositoryRoot: string,
  ) => Promise<Readonly<Record<string, string>>>;
  readonly sourceManifest: {
    defaultSourceManifestDependencies(): Record<string, unknown>;
    createSourceManifestBuilder(dependencies: Record<string, unknown>): {
      buildProducer(repositoryRoot: string): Promise<Record<string, unknown>>;
    };
    sourceManifestSha256(manifest: Record<string, unknown>): string;
    writeProducerSourceManifest(
      evidenceDirectory: string,
      manifest: Record<string, unknown>,
    ): Promise<{ readonly sha256: string }>;
    verifyProducerSourceManifestStable(
      evidenceDirectory: string,
      expectedSha256: string,
    ): Promise<boolean>;
  };
  readonly loadPodmanRuntimeAuthority: (repositoryRoot: string) => {
    readonly authority: Readonly<Record<string, unknown>>;
    readonly runtimeAuthoritySha256: string;
    readonly runtimeAuthoritySemanticDigest: string;
  };
  readonly runtimeAuthoritySchemaVersion: number;
  readonly runtimeAuthorityId: string;
}

interface NpmCliIdentity {
  readonly version: string;
  readonly cliPath: string;
  readonly cliSha256: string;
  readonly packageJsonSha256: string;
}

const MODES = new Set(['execute-in-workspace', 'init', 'run-commands', 'finalize']);
const SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,79}$/u;
const DENIED_EXECUTABLES = [
  'podman',
  'docker',
  'dockerd',
  'systemctl',
  'wsl',
  'curl',
  'wget',
] as const;
const BASELINE_FILE = 'baseline-identity.json';
const PLAN_FILE = 'command-plan.json';
const CONTEXT_FILE = 'run-context.json';
const OPENING_HISTORY_EVIDENCE_FILE = 'opening-history-evidence.json';
const ENDING_HISTORY_EVIDENCE_FILE = 'ending-history-evidence.json';
const REPOSITORY_BOUNDARY_FILE = 'repository-boundary-result.json';
const DENY_LOG_FILE = 'side-effect-invocations.log';
const FIXED_ADVERSARIAL_SUMMARY = '.runtime/test-results/verification-adversarial-summary.json';
const AR10_TAMPER_STANDALONE_SCRIPT = String.raw`
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildValidEvidenceFixture,
  rebuildFixtureManifest,
} from './src/testing/build-valid-evidence-fixture.ts';
import { reviewFormalAbgEvidence } from './src/review-formal-abg-evidence.ts';

const root = await mkdtemp(join(tmpdir(), 'hdi-ar12-evidence-tamper-'));
try {
  const fixture = await buildValidEvidenceFixture({ rootDirectory: root });
  const artifactPath = join(fixture.evidenceDirectory, 'shared', 'raw', 'fault.json');
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
  artifact.status = 'FAILED';
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2) + '\n', { flag: 'w' });
  await rebuildFixtureManifest(fixture.evidenceDirectory);
  const result = await reviewFormalAbgEvidence({
    evidenceDirectory: fixture.evidenceDirectory,
    reviewOutputDirectory: fixture.reviewOutputDirectory,
    dependencies: fixture.reviewerDependencies,
  });
  const observation = {
    evidenceIntegrityStatus: result.evidenceIntegrityStatus,
    producerProvenanceStatus: result.producerProvenanceStatus,
    reviewStatus: result.reviewStatus,
  };
  if (
    observation.evidenceIntegrityStatus !== 'FAILED' ||
    typeof observation.producerProvenanceStatus !== 'string' ||
    observation.producerProvenanceStatus === 'UNVERIFIABLE' ||
    observation.reviewStatus !== 'FAILED'
  ) throw new Error('AR12_STANDALONE_EVIDENCE_TAMPER_ASSERTION_FAILED');
  process.stdout.write(JSON.stringify(observation) + '\n');
} finally {
  await rm(root, { recursive: true, force: true });
}
`;

const AR09_AR10_FOCUSED = [
  {
    id: 'ar09-valid-terminal-fixture',
    title: 'accepts a complete synthetic 40-gate package and leaves every source byte unchanged',
    standalone: 1,
  },
  {
    id: 'ar09-cleanup-failed-fixture',
    title: 'returns a stable cleanup code for a cleanup-failed v4 fixture',
    standalone: 2,
  },
  {
    id: 'ar09-terminal-missing-fixture',
    title: 'returns a stable code when terminal conclusion is missing',
    standalone: 3,
  },
  {
    id: 'ar10-exact-contract-fixture',
    title: 'accepts the exact contract through the public reviewer seam without host Git coupling',
    standalone: 4,
  },
  {
    id: 'ar10-commit-unavailable-fixture',
    title: 'distinguishes an unavailable producer commit from evidence tampering',
    standalone: 6,
  },
  {
    id: 'ar10-compatible-drift-fixture',
    title: 'classifies parseable definition drift as compatible but never passed',
    standalone: 7,
  },
  {
    id: 'ar10-incompatible-tuple-fixture',
    title: 'limits an unknown tuple to incompatible envelope review',
    standalone: 8,
  },
] as const;

const AR11_FOCUSED = [
  {
    id: 'ar11-docker-socket-alias',
    file: 'src/runtime/formal-preflight.test.ts',
    title: 'fails closed when Docker socket alias is detected',
    standalone: 10,
  },
  {
    id: 'ar11-persistent-restart',
    file: 'src/runtime/podman-runtime-authority.test.ts',
    title: 'rejects persistent restart',
    standalone: 11,
  },
  {
    id: 'ar11-keycloak-create-failure',
    file: 'src/runtime/podman-runtime-shell.test.ts',
    title: 'fails KEYCLOAK_CONTAINER_CREATE closed, records PODMAN_KEYCLOAK_CONTAINER_CREATE_FAILED, and removes only exact current-run residues',
    standalone: 12,
  },
  {
    id: 'ar11-bootstrap-migration-failure',
    file: 'src/runtime/podman-runtime-shell.test.ts',
    title: 'cleans the runtime after BOOTSTRAP_MIGRATION and retains BOOTSTRAP_MIGRATION_FAILED',
    standalone: 13,
  },
  {
    id: 'ar11-exact-source-provenance',
    file: 'src/testing/build-valid-evidence-fixture.test.ts',
    title: 'generates byte-identical, gate-specific evidence that all validation layers accept',
    standalone: 14,
  },
] as const;

function command(
  input: Omit<CommandSpec, 'expectedExitCodes' | 'skipPolicy'> & {
    readonly skipPolicy?: SkipPolicy;
  },
): CommandSpec {
  return {
    ...input,
    expectedExitCodes: [0],
    skipPolicy: input.skipPolicy ?? 'NONE',
  };
}

function createCommandSpecs(): readonly CommandSpec[] {
  const npm = (id: string, category: CommandCategory, args: readonly string[], extras = {}) =>
    command({ id, category, executable: 'npm', args, cwd: '.', ...extras });
  const directVitest = (
    id: string,
    file: string,
    title: string,
    standaloneCheckIds: readonly number[],
  ) => command({
    id,
    category: 'SAFE_SYNTHETIC_RUNTIME',
    executable: 'node',
    args: [
      '../../node_modules/vitest/vitest.mjs',
      'run',
      file,
      `--testNamePattern=${title}`,
    ],
    cwd: 'tooling/verification',
    minimumTestsPassed: 1,
    skipPolicy: 'FOCUSED_SELECTION',
    standaloneCheckIds,
  });

  const commands: CommandSpec[] = [
    npm('npm-ci', 'LOCKFILE_INSTALL', ['ci', '--ignore-scripts', '--no-audit', '--no-fund']),
    npm('check-runtime', 'SAFE_STATIC', ['run', 'check:runtime']),
    npm('check-repo-layout', 'SAFE_STATIC', ['run', 'check:repo:layout']),
    npm('check-module-boundaries', 'SAFE_STATIC', ['run', 'check:module-boundaries']),
    npm('typecheck-root', 'SAFE_STATIC', ['run', 'typecheck']),
    npm('typecheck-governance-api', 'SAFE_STATIC', [
      'run', 'typecheck', '--workspace', '@hospital-data-intelligence/governance-api',
    ]),
    npm('typecheck-verification-tooling', 'SAFE_STATIC', [
      'run', 'typecheck', '--workspace', '@hospital-data-intelligence/verification-tooling',
    ]),
    npm('build', 'SAFE_STATIC', ['run', 'build']),
    npm('contract-lint', 'SAFE_STATIC', ['run', 'contract:lint']),
    npm('verify-abg-coverage', 'SAFE_STATIC', ['run', 'verify:abg-coverage']),
    npm('verify-source-manifest', 'SAFE_STATIC', ['run', 'verify:verification-source-manifest']),
    npm('verify-podman-authority', 'SAFE_STATIC', ['run', 'verify:podman-runtime-authority'], {
      standaloneCheckIds: [9],
    }),
    npm('e2e-list', 'SAFE_STATIC', ['run', 'test:e2e:list']),
    ...[
      'bootstrap-phase-01-runtime.sh',
      'bootstrap-phase-01.sh',
      'configure-podman-proxy.sh',
      'podman-phase-01-runtime.sh',
      'verify-phase-01-runtime.sh',
    ].map((file) => command({
      id: `bash-syntax-${file.replace(/\.sh$/u, '').replaceAll('_', '-')}`,
      category: 'SAFE_STATIC',
      executable: 'bash',
      args: ['-n', `phase-plan/environment/anolis-8.9-wsl2/${file}`],
      cwd: '.',
    })),
    npm('ar01-coverage-focused', 'SAFE_UNIT', [
      'run', 'test', '--workspace', '@hospital-data-intelligence/verification-tooling', '--',
      'src/abg-coverage-matrix.test.ts',
    ], { minimumFilesPassed: 1, minimumTestsPassed: 8 }),
    npm('ar02-evidence-focused', 'SAFE_UNIT', [
      'run', 'test', '--workspace', '@hospital-data-intelligence/verification-tooling', '--',
      'src/evidence',
    ], { minimumFilesPassed: 3, minimumTestsPassed: 16 }),
    npm('ar03-gate-proof-focused', 'SAFE_UNIT', [
      'run', 'test', '--workspace', '@hospital-data-intelligence/verification-tooling', '--',
      'src/abg-gate-proof.test.ts',
    ], { minimumFilesPassed: 1, minimumTestsPassed: 7 }),
    npm('verification-full', 'SAFE_UNIT', [
      'run', 'test', '--workspace', '@hospital-data-intelligence/verification-tooling',
    ], { suiteKey: 'verification', minimumFilesPassed: 22, minimumTestsPassed: 495 }),
    npm('verification-lifecycle', 'SAFE_SYNTHETIC_RUNTIME', [
      'run', 'test:verification:lifecycle',
    ], { suiteKey: 'lifecycle', minimumFilesPassed: 10, minimumTestsPassed: 217 }),
    npm('verification-adversarial', 'SAFE_SYNTHETIC_RUNTIME', [
      'run', 'test:verification:adversarial',
    ], {
      minimumFilesPassed: 1,
      minimumTestsPassed: 142,
      captureAdversarialSummary: true,
    }),
    npm('verification-provenance', 'SAFE_SYNTHETIC_RUNTIME', [
      'run', 'test:verification:provenance',
    ], { suiteKey: 'provenance', minimumFilesPassed: 4, minimumTestsPassed: 93 }),
    npm('verification-podman-runtime', 'SAFE_SYNTHETIC_RUNTIME', [
      'run', 'test:verification:podman-runtime',
    ], { suiteKey: 'podmanRuntime', minimumFilesPassed: 5, minimumTestsPassed: 173 }),
    command({
      id: 'testcontainers-synthetic-guard',
      category: 'SAFE_SYNTHETIC_RUNTIME',
      executable: 'node',
      args: [
        '../../node_modules/vitest/vitest.mjs',
        'run',
        'src/composition/phase-01-vertical-slice.integration.test.ts',
        '--testNamePattern=Testcontainers Podman lifecycle guard',
      ],
      cwd: 'apps/governance-api',
      suiteKey: 'testcontainersGuard',
      minimumFilesPassed: 1,
      minimumTestsPassed: 8,
      expectedTestsSkipped: 3,
      skipPolicy: 'REAL_RUNTIME_BOUNDARY',
    }),
    command({
      id: 'standalone-teardown-snapshot',
      category: 'SAFE_SYNTHETIC_RUNTIME',
      executable: 'node',
      args: [
        '../../node_modules/vitest/vitest.mjs',
        'run',
        'src/runtime/formal-teardown-cli.test.ts',
      ],
      cwd: 'tooling/verification',
      suiteKey: 'standaloneTeardown',
      minimumFilesPassed: 1,
      minimumTestsPassed: 6,
    }),
    ...AR09_AR10_FOCUSED.map((item) => directVitest(
      item.id,
      'src/review-formal-abg-evidence.test.ts',
      item.title,
      [item.standalone],
    )),
    command({
      id: 'ar10-evidence-tamper-observed',
      category: 'SAFE_SYNTHETIC_RUNTIME',
      executable: 'node',
      args: [
        '--import',
        'tsx',
        '--input-type=module',
        '--eval',
        AR10_TAMPER_STANDALONE_SCRIPT,
      ],
      cwd: 'tooling/verification',
      standaloneCheckIds: [5],
    }),
    ...AR11_FOCUSED.map((item) => directVitest(
      item.id,
      item.file,
      item.title,
      [item.standalone],
    )),
    command({
      id: 'git-diff-check',
      category: 'SAFE_STATIC',
      executable: 'git',
      args: ['diff', '--check'],
      cwd: '.',
    }),
  ];
  assertAr12CommandPlanSafety(commands);
  return Object.freeze(commands.map((item) => Object.freeze(item)));
}

export const createAr12CommandSpecs = createCommandSpecs;

export function assertAr12CommandPlanSafety(
  commands: readonly Ar12CommandSpec[],
): void {
  const repositoryLayoutGate = commands[2];
  if (
    repositoryLayoutGate === undefined ||
    repositoryLayoutGate.id !== 'check-repo-layout' ||
    repositoryLayoutGate.category !== 'SAFE_STATIC' ||
    repositoryLayoutGate.executable !== 'npm' ||
    repositoryLayoutGate.cwd !== '.' ||
    repositoryLayoutGate.skipPolicy !== 'NONE' ||
    repositoryLayoutGate.args.length !== 2 ||
    repositoryLayoutGate.args[0] !== 'run' ||
    repositoryLayoutGate.args[1] !== 'check:repo:layout' ||
    repositoryLayoutGate.expectedExitCodes.length !== 1 ||
    repositoryLayoutGate.expectedExitCodes[0] !== 0
  ) {
    fail('AR12_REPO_LAYOUT_GATE_BYPASS_FORBIDDEN');
  }
  if (commands.length !== 42) fail('AR12_COMMAND_PLAN_LENGTH_INVALID');
  assertStrictCommandAllowlist(commands);
}

function assertStrictCommandAllowlist(commands: readonly CommandSpec[]): void {
  const seen = new Set<string>();
  for (const item of commands) {
    if (!SAFE_ID_PATTERN.test(item.id) || seen.has(item.id)) fail('AR12_COMMAND_ID_INVALID');
    seen.add(item.id);
    if (item.expectedExitCodes.length !== 1 || item.expectedExitCodes[0] !== 0) {
      fail('AR12_COMMAND_EXIT_POLICY_INVALID');
    }
    if (isAbsolute(item.cwd) || escapesRoot(item.cwd)) fail('AR12_COMMAND_CWD_INVALID');
    const rendered = [item.executable, ...item.args].join(' ');
    const forbiddenRootNpm = item.executable === 'npm' && (
      (item.args.length === 1 && item.args[0] === 'test') ||
      (item.args[0] === 'run' && ['test', 'check'].includes(item.args[1] ?? '') &&
        !item.args.includes('--workspace'))
    );
    if (
      DENIED_EXECUTABLES.includes(item.executable as (typeof DENIED_EXECUTABLES)[number]) ||
      /verify:phase-01:(?:live|formal|preflight|teardown)/u.test(rendered) ||
      /run-shared-abg-verification/u.test(rendered) ||
      /npm\s+exec\s+--yes/u.test(rendered) ||
      forbiddenRootNpm
    ) {
      fail('AR12_COMMAND_ALLOWLIST_FORBIDDEN_ENTRY');
    }
    if (item.executable === 'bash' && item.args[0] !== '-n') {
      fail('AR12_BASH_COMMAND_NOT_SYNTAX_ONLY');
    }
  }
}

async function importFromRepository<T>(
  repositoryRoot: string,
  relativePath: string,
): Promise<T> {
  const physicalRoot = await assertPhysicalDirectory(
    repositoryRoot,
    'AR12_MODULE_REPOSITORY_ROOT_UNSAFE',
  );
  const absolutePath = await assertSafeRegularFile(physicalRoot, relativePath);
  const physicalPath = await realpath(absolutePath);
  const rel = relative(physicalRoot, physicalPath);
  if (!samePath(absolutePath, physicalPath) || rel === '' || escapesRoot(rel)) {
    fail('AR12_MODULE_PHYSICAL_CONTAINMENT_INVALID');
  }
  return await import(pathToFileURL(physicalPath).href) as T;
}

async function loadAuthorityModules(repositoryRoot: string): Promise<AuthorityModules> {
  const [recorder, runner, contract, plan, sourceManifest, runtime, schema] = await Promise.all([
    importFromRepository<RecorderModule>(
      repositoryRoot,
      'tooling/verification/src/evidence/recorder.ts',
    ),
    importFromRepository<RunnerModule>(
      repositoryRoot,
      'tooling/verification/src/runtime/formal-runtime-contract.ts',
    ),
    importFromRepository<{ CURRENT_EVIDENCE_CONTRACT_IDENTITY: Readonly<Record<string, unknown>> }>(
      repositoryRoot,
      'tooling/verification/src/verification-contract-versions.ts',
    ),
    importFromRepository<{
      readVerificationAuthorityIdentity(
        repositoryRoot: string,
      ): Promise<Readonly<Record<string, string>>>;
    }>(repositoryRoot, 'tooling/verification/src/authoritative-abg-plan.ts'),
    importFromRepository<AuthorityModules['sourceManifest']>(
      repositoryRoot,
      'tooling/verification/src/provenance/source-manifest.ts',
    ),
    importFromRepository<{
      loadPodmanRuntimeAuthority: AuthorityModules['loadPodmanRuntimeAuthority'];
    }>(repositoryRoot, 'tooling/verification/src/runtime/podman-runtime-authority.ts'),
    importFromRepository<{
      PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION: number;
      PODMAN_RUNTIME_AUTHORITY_ID: string;
    }>(repositoryRoot, 'tooling/verification/src/runtime/podman-runtime-authority-schema.ts'),
  ]);
  return {
    recorder,
    runner,
    contractIdentity: contract.CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    readVerificationAuthorityIdentity: plan.readVerificationAuthorityIdentity,
    sourceManifest,
    loadPodmanRuntimeAuthority: runtime.loadPodmanRuntimeAuthority,
    runtimeAuthoritySchemaVersion: schema.PODMAN_RUNTIME_AUTHORITY_SCHEMA_VERSION,
    runtimeAuthorityId: schema.PODMAN_RUNTIME_AUTHORITY_ID,
  };
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) fail('AR12_CANONICAL_JSON_UNSUPPORTED');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`,
    ).join(',')}}`;
  }
  fail('AR12_CANONICAL_JSON_UNSUPPORTED');
}

function exactJsonEqual(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function fail(code: string): never {
  throw new Error(code);
}

function errorCode(error: unknown): string {
  if (error instanceof Ar12ExecutionWorkspaceError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]*(?::[A-Za-z0-9_.-]+)*$/u.test(message)
    ? message.split(':', 1)[0]!
    : 'AR12_ORCHESTRATOR_INTERNAL_ERROR';
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function escapesRoot(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function resolveInside(root: string, path: string, code: string): string {
  const absoluteRoot = resolve(root);
  const output = resolve(absoluteRoot, path);
  const rel = relative(absoluteRoot, output);
  if (rel === '' || escapesRoot(rel)) fail(code);
  return output;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => {
    const resolved = resolve(value).replace(/[\\/]+$/u, '');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

async function assertPhysicalDirectory(path: string, code: string): Promise<string> {
  const absolute = resolve(path);
  const observed = await lstat(absolute);
  if (!observed.isDirectory() || observed.isSymbolicLink()) fail(code);
  const physical = await realpath(absolute);
  if (!samePath(absolute, physical)) fail(code);
  return physical;
}

async function assertNoReparseAncestors(
  root: string,
  candidate: string,
  allowMissingLeaf: boolean,
): Promise<void> {
  const absoluteRoot = await assertPhysicalDirectory(root, 'AR12_PHYSICAL_ROOT_UNSAFE');
  const absoluteCandidate = resolve(candidate);
  const rel = relative(absoluteRoot, absoluteCandidate);
  if (rel === '' || escapesRoot(rel)) fail('AR12_PHYSICAL_CONTAINMENT_INVALID');
  const parts = rel.split(sep).filter((part) => part.length > 0);
  let current = absoluteRoot;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    try {
      const observed = await lstat(current);
      if (observed.isSymbolicLink()) fail('AR12_REPARSE_ANCESTOR_FORBIDDEN');
      if (index < parts.length - 1 && !observed.isDirectory()) {
        fail('AR12_PATH_ANCESTOR_NOT_DIRECTORY');
      }
      if (index === parts.length - 1 && allowMissingLeaf) {
        fail('AR12_RUN_DIRECTORY_ALREADY_EXISTS');
      }
      const physical = await realpath(current);
      if (!samePath(current, physical)) fail('AR12_REPARSE_ANCESTOR_FORBIDDEN');
    } catch (error) {
      if (isMissing(error) && allowMissingLeaf && index === parts.length - 1) return;
      throw error;
    }
  }
}

async function assertSafeRunLayout(
  repositoryRoot: string,
  outputRoot: string,
  runDirectory: string,
  expectAbsent: boolean,
): Promise<{ repositoryRoot: string; outputRoot: string; runDirectory: string }> {
  const repository = await assertPhysicalDirectory(repositoryRoot, 'AR12_REPOSITORY_ROOT_UNSAFE');
  const output = await assertPhysicalDirectory(outputRoot, 'AR12_OUTPUT_ROOT_UNSAFE');
  const run = resolve(runDirectory);
  const rel = relative(output, run);
  if (rel === '' || escapesRoot(rel) || dirname(rel) !== '.') {
    fail('AR12_RUN_DIRECTORY_MUST_BE_DIRECT_OUTPUT_CHILD');
  }
  if (!SAFE_ID_PATTERN.test(basename(run))) fail('AR12_RUN_DIRECTORY_NAME_INVALID');
  await assertNoReparseAncestors(output, run, expectAbsent);
  if (!expectAbsent) await assertPhysicalDirectory(run, 'AR12_RUN_DIRECTORY_UNSAFE');
  return { repositoryRoot: repository, outputRoot: output, runDirectory: run };
}

export async function preflightAr12RunOutput(
  sourceRepositoryRoot: string,
  outputRoot: string,
  runDirectory: string,
): Promise<void> {
  await assertSafeRunLayout(sourceRepositoryRoot, outputRoot, runDirectory, true);
}

async function assertSafeRegularFile(root: string, relativePath: string): Promise<string> {
  const absoluteRoot = await assertPhysicalDirectory(root, 'AR12_READ_ROOT_UNSAFE');
  const output = resolveInside(absoluteRoot, relativePath, 'AR12_READ_PATH_INVALID');
  const parts = relative(absoluteRoot, output).split(sep);
  let current = absoluteRoot;
  for (const part of parts) {
    current = join(current, part);
    const observed = await lstat(current);
    if (observed.isSymbolicLink()) fail('AR12_READ_SYMLINK_FORBIDDEN');
  }
  const observed = await lstat(output);
  if (!observed.isFile() || observed.nlink !== 1) fail('AR12_READ_FILE_UNSAFE');
  return output;
}

async function readJsonFile<T>(root: string, relativePath: string): Promise<T> {
  const path = await assertSafeRegularFile(root, relativePath);
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    fail('AR12_JSON_ARTIFACT_INVALID');
  }
}

async function runReadOnlyCommand(
  modules: AuthorityModules,
  repositoryRoot: string,
  executable: string,
  args: readonly string[],
): Promise<string> {
  const runner = new modules.runner.SpawnRuntimeCommandRunner();
  const invocation = await runtimeInvocation(executable, args, repositoryRoot);
  const result = await runner.run({
    executable: invocation.executable,
    args: invocation.args,
    cwd: repositoryRoot,
  });
  if (result.exitCode !== 0 || result.signal !== null) fail('AR12_READ_COMMAND_FAILED');
  return result.stdout.trim();
}

async function runtimeInvocation(
  executable: string,
  args: readonly string[],
  repositoryRoot: string,
): Promise<{ executable: string; args: readonly string[] }> {
  if (executable === 'node') return { executable: process.execPath, args };
  if (executable !== 'npm' || process.platform !== 'win32') return { executable, args };
  const identity = await selectNpmCli(repositoryRoot);
  return { executable: process.execPath, args: [identity.cliPath, ...args] };
}

async function selectNpmCli(repositoryRoot: string): Promise<NpmCliIdentity> {
  const repositoryPackagePath = await assertSafeRegularFile(repositoryRoot, 'package.json');
  const repositoryPackageBytes = await readFile(repositoryPackagePath);
  let repositoryPackage: Record<string, unknown>;
  try {
    repositoryPackage = JSON.parse(repositoryPackageBytes.toString('utf8')) as Record<string, unknown>;
  } catch {
    fail('AR12_REPOSITORY_PACKAGE_JSON_INVALID');
  }
  const packageManager = repositoryPackage['packageManager'];
  const engines = repositoryPackage['engines'];
  if (
    typeof packageManager !== 'string' ||
    engines === null ||
    typeof engines !== 'object' ||
    Array.isArray(engines)
  ) fail('AR12_NPM_VERSION_AUTHORITY_INVALID');
  const match = /^npm@(\d+\.\d+\.\d+)$/u.exec(packageManager);
  const expectedVersion = match?.[1];
  if (
    expectedVersion === undefined ||
    (engines as Record<string, unknown>)['npm'] !== expectedVersion
  ) fail('AR12_NPM_VERSION_AUTHORITY_INVALID');
  const pathDirectories = (process.env['PATH'] ?? '').split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/gu, ''))
    .filter((entry) => entry.length > 0);
  pathDirectories.push(dirname(process.execPath));
  const candidatePaths = [...new Set(pathDirectories.flatMap((directory) => [
    resolve(directory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(directory, 'node_modules/npm/bin/npm-cli.cjs'),
  ]))];
  for (const candidate of candidatePaths) {
    try {
      const candidateMetadata = await lstat(candidate);
      if (
        !candidateMetadata.isFile() ||
        candidateMetadata.isSymbolicLink() ||
        candidateMetadata.nlink !== 1
      ) continue;
      const physicalCandidate = await realpath(candidate);
      if (!samePath(candidate, physicalCandidate)) continue;
      const npmRoot = resolve(dirname(candidate), '..');
      const packagePath = resolve(npmRoot, 'package.json');
      const packageMetadata = await lstat(packagePath);
      if (
        !packageMetadata.isFile() ||
        packageMetadata.isSymbolicLink() ||
        packageMetadata.nlink !== 1 ||
        !samePath(packagePath, await realpath(packagePath))
      ) continue;
      const [cliBytes, packageBytes] = await Promise.all([
        readFile(physicalCandidate),
        readFile(packagePath),
      ]);
      const npmPackage = JSON.parse(packageBytes.toString('utf8')) as Record<string, unknown>;
      if (npmPackage['name'] !== 'npm' || npmPackage['version'] !== expectedVersion) continue;
      return {
        version: expectedVersion,
        cliPath: physicalCandidate,
        cliSha256: sha256(cliBytes),
        packageJsonSha256: sha256(packageBytes),
      };
    } catch (error) {
      if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
    }
  }
  fail('AR12_LOCKED_NPM_CLI_NOT_FOUND');
}

async function readRepositoryState(
  modules: AuthorityModules,
  repositoryRoot: string,
): Promise<{ branch: string; commit: string; worktreeState: 'CLEAN' }> {
  const branch = await runReadOnlyCommand(modules, repositoryRoot, 'git', [
    'branch', '--show-current',
  ]);
  const commit = await runReadOnlyCommand(modules, repositoryRoot, 'git', ['rev-parse', 'HEAD']);
  const statusOutput = await runReadOnlyCommand(modules, repositoryRoot, 'git', [
    'status', '--porcelain=v1', '--untracked-files=all',
  ]);
  if (!SHA_PATTERN.test(commit)) fail('AR12_GIT_COMMIT_INVALID');
  if (statusOutput.length !== 0) fail('AR12_WORKTREE_NOT_CLEAN');
  return { branch, commit, worktreeState: 'CLEAN' };
}

async function fingerprintTree(root: string): Promise<{ fileCount: number; digest: string }> {
  const physicalRoot = await assertPhysicalDirectory(root, 'AR12_FINGERPRINT_ROOT_UNSAFE');
  const entries: Array<{ path: string; byteLength: number; sha256: string }> = [];
  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const child of children) {
      const path = join(directory, child.name);
      const observed = await lstat(path);
      if (observed.isSymbolicLink()) fail('AR12_FINGERPRINT_SYMLINK_FORBIDDEN');
      if (observed.isDirectory()) {
        await visit(path);
      } else if (observed.isFile()) {
        if (observed.nlink !== 1) fail('AR12_FINGERPRINT_HARDLINK_FORBIDDEN');
        const bytes = await readFile(path);
        entries.push({
          path: relative(physicalRoot, path).split(sep).join('/'),
          byteLength: bytes.byteLength,
          sha256: sha256(bytes),
        });
      } else {
        fail('AR12_FINGERPRINT_NONREGULAR_FILE');
      }
    }
  };
  await visit(physicalRoot);
  return { fileCount: entries.length, digest: sha256(canonicalJson(entries)) };
}

export async function captureAr12HistoryEvidenceSnapshot(
  outputRoot: string,
  currentRunDirectory: string,
  contract = AR12_HISTORY_EVIDENCE_CONTRACT,
): Promise<Ar12HistoryEvidenceSnapshot> {
  return captureAr12HistoryEvidenceBaseline(outputRoot, currentRunDirectory, contract);
}

async function buildProducerManifest(
  modules: AuthorityModules,
  repositoryRoot: string,
  startedAt: string,
): Promise<Record<string, unknown>> {
  const dependencies = modules.sourceManifest.defaultSourceManifestDependencies();
  const builder = modules.sourceManifest.createSourceManifestBuilder({
    ...dependencies,
    clock: () => startedAt,
  });
  return await builder.buildProducer(repositoryRoot);
}

async function captureBaselineIdentity(
  modules: AuthorityModules,
  repositoryRoot: string,
  startedAt: string,
  expectedBranch: string,
  expectedCommit: string,
): Promise<{ identity: BaselineIdentity; manifest: Record<string, unknown> }> {
  const state = await readRepositoryState(modules, repositoryRoot);
  if (state.branch !== expectedBranch) fail('AR12_BRANCH_MISMATCH');
  if (state.commit !== expectedCommit) fail('AR12_COMMIT_MISMATCH');
  const [
    packageJson,
    lockfile,
    npmVersion,
    npmCliIdentity,
    authorityIdentity,
    manifest,
    completionTree,
  ] = await Promise.all([
    readFile(await assertSafeRegularFile(repositoryRoot, 'package.json')),
    readFile(await assertSafeRegularFile(repositoryRoot, 'package-lock.json')),
    runReadOnlyCommand(modules, repositoryRoot, 'npm', ['--version']),
    selectNpmCli(repositoryRoot),
    modules.readVerificationAuthorityIdentity(repositoryRoot),
    buildProducerManifest(modules, repositoryRoot, startedAt),
    fingerprintTree(resolve(repositoryRoot, '.scratch/phase-01-completion')),
  ]);
  const runtimeAuthority = modules.loadPodmanRuntimeAuthority(repositoryRoot);
  const orchestratorSha256 = await currentOrchestratorSha256();
  const sourceManifestSha256 = modules.sourceManifest.sourceManifestSha256(manifest);
  const sourceFileCount = manifest['sourceFileCount'];
  const sourceFilesDigest = manifest['sourceFilesDigest'];
  const coverageMatrixDigest = authorityIdentity['coverageMatrixDigest'];
  const producerProtocolIdentityDigest = authorityIdentity['producerProtocolIdentityDigest'];
  if (
    typeof sourceFileCount !== 'number' ||
    typeof sourceFilesDigest !== 'string' ||
    typeof coverageMatrixDigest !== 'string' ||
    typeof producerProtocolIdentityDigest !== 'string'
  ) fail('AR12_AUTHORITY_IDENTITY_INVALID');
  if (npmVersion !== npmCliIdentity.version) fail('AR12_NPM_VERSION_MISMATCH');
  const identity: BaselineIdentity = {
    schemaVersion: 'phase-01.ar-12-baseline-identity.v1',
    purpose: 'AR-12_REBASELINE',
    formalAcceptanceEligible: false,
    realServicesStarted: false,
    sharedReadinessExecuted: false,
    formalAbgExecuted: false,
    branch: state.branch,
    gitCommitSha: state.commit,
    worktreeState: state.worktreeState,
    nodeVersion: process.versions.node,
    npmVersion,
    npmCliPath: npmCliIdentity.cliPath,
    npmCliSha256: npmCliIdentity.cliSha256,
    npmPackageJsonSha256: npmCliIdentity.packageJsonSha256,
    packageJsonSha256: sha256(packageJson),
    lockfileSha256: sha256(lockfile),
    contractIdentity: modules.contractIdentity,
    coverageMatrixDigest,
    producerProtocolIdentityDigest,
    verificationAuthorityIdentity: authorityIdentity,
    sourceManifestFileCount: sourceFileCount,
    sourceManifestDigest: sourceFilesDigest,
    sourceManifestSha256,
    runtimeAuthoritySchemaVersion: modules.runtimeAuthoritySchemaVersion,
    runtimeAuthorityId: modules.runtimeAuthorityId,
    runtimeAuthoritySha256: runtimeAuthority.runtimeAuthoritySha256,
    runtimeAuthoritySemanticDigest: runtimeAuthority.runtimeAuthoritySemanticDigest,
    phase01CompletionTreeFileCount: completionTree.fileCount,
    phase01CompletionTreeFingerprint: completionTree.digest,
    orchestratorSha256,
    startedAt,
  };
  return { identity, manifest };
}

async function currentOrchestratorSha256(): Promise<string> {
  const orchestratorPath = fileURLToPath(import.meta.url);
  const orchestratorMetadata = await lstat(orchestratorPath);
  if (
    !orchestratorMetadata.isFile() ||
    orchestratorMetadata.isSymbolicLink() ||
    orchestratorMetadata.nlink !== 1
  ) fail('AR12_ORCHESTRATOR_FILE_UNSAFE');
  const physicalPath = await realpath(orchestratorPath);
  if (!samePath(orchestratorPath, physicalPath)) fail('AR12_ORCHESTRATOR_FILE_UNSAFE');
  return sha256(await readFile(physicalPath));
}

function commandPlan(runKind: RunKind): Record<string, unknown> {
  return {
    schemaVersion: 'phase-01.ar-12-command-plan.v1',
    purpose: 'AR-12_REBASELINE',
    runKind,
    formalAcceptanceEligible: false,
    realServicesStarted: false,
    sharedReadinessExecuted: false,
    formalAbgExecuted: false,
    executionPolicy: {
      shell: false,
      sequential: true,
      stopOnUnexpectedNonzero: true,
      denyShimExecutables: DENIED_EXECUTABLES,
      arbitraryCommandsAccepted: false,
      forbiddenRootScripts: [
        'check',
        'check:database-authority',
        'test',
        'test:e2e',
        'verify:phase-01:live',
        'verify:phase-01:formal',
        'verify:phase-01:preflight',
        'verify:phase-01:teardown',
      ],
    },
    commands: createCommandSpecs(),
  };
}

async function createDenyShims(
  recorder: RecorderModule,
  runDirectory: string,
): Promise<void> {
  await recorder.createEvidenceSubdirectory(runDirectory, 'deny-shims');
  await recorder.writeRedactedTextArtifact(runDirectory, DENY_LOG_FILE, '');
  for (const executable of DENIED_EXECUTABLES) {
    const shellRelative = `deny-shims/${executable}`;
    await recorder.writeRedactedTextArtifact(
      runDirectory,
      shellRelative,
      [
        '#!/usr/bin/env bash',
        'if [[ -n "${HDI_AR12_DENY_LOG:-}" ]]; then',
        `  printf '%s\\n' '${executable}' >> "${'${HDI_AR12_DENY_LOG}'}"`,
        'fi',
        'exit 197',
        '',
      ].join('\n'),
    );
    await chmod(await assertSafeRegularFile(runDirectory, shellRelative), 0o700);
    await recorder.writeRedactedTextArtifact(
      runDirectory,
      `deny-shims/${executable}.cmd`,
      [
        '@echo off',
        `if defined HDI_AR12_DENY_LOG >>"%HDI_AR12_DENY_LOG%" echo ${executable}`,
        'exit /b 197',
        '',
      ].join('\r\n'),
    );
    await recorder.writeRedactedTextArtifact(
      runDirectory,
      `deny-shims/${executable}.ps1`,
      [
        `if ($env:HDI_AR12_DENY_LOG) { Add-Content -LiteralPath $env:HDI_AR12_DENY_LOG -Value '${executable}' }`,
        'exit 197',
        '',
      ].join('\r\n'),
    );
  }
}

async function writeFailure(
  recorder: RecorderModule,
  runDirectory: string,
  stage: 'init' | 'run-commands' | 'finalize',
  code: string,
  details: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  try {
    await recorder.writeRedactedJsonArtifact(runDirectory, `failure-${stage}.json`, {
      schemaVersion: 'phase-01.ar-12-orchestrator-failure.v1',
      status: 'FAILED',
      stage,
      code,
      ...details,
      recordedAt: new Date().toISOString(),
    });
  } catch {
    // The primary failure remains authoritative; exclusive evidence is never overwritten.
  }
}

async function initialize(input: Ar12InitializeInput): Promise<void> {
  if (!SHA_PATTERN.test(input.expectedCommit)) fail('AR12_EXPECTED_COMMIT_INVALID');
  if (input.expectedBranch.length === 0) fail('AR12_EXPECTED_BRANCH_INVALID');
  const layout = await assertSafeRunLayout(
    input.repositoryRoot,
    input.outputRoot,
    input.runDirectory,
    true,
  );
  const sourceRepositoryRoot = await assertPhysicalDirectory(
    input.sourceRepositoryRoot,
    'AR12_SOURCE_REPOSITORY_ROOT_UNSAFE',
  );
  const modules = await loadAuthorityModules(layout.repositoryRoot);
  const startedAt = new Date().toISOString();
  const openingHistoryEvidence = await captureAr12HistoryEvidenceSnapshot(
    layout.outputRoot,
    layout.runDirectory,
  );
  const expectedRepositoryBoundaryResultSha256 = sha256(repositoryBoundaryArtifactBytes(
    passedAr12RepositoryBoundaryResult(openingHistoryEvidence, startedAt),
  ));
  await modules.recorder.createEvidenceOutputDirectory(layout.runDirectory);
  try {
    const captured = await captureBaselineIdentity(
      modules,
      layout.repositoryRoot,
      startedAt,
      input.expectedBranch,
      input.expectedCommit,
    );
    const manifestWrite = await modules.sourceManifest.writeProducerSourceManifest(
      layout.runDirectory,
      captured.manifest,
    );
    if (manifestWrite.sha256 !== captured.identity.sourceManifestSha256) {
      fail('AR12_PERSISTED_SOURCE_MANIFEST_IDENTITY_MISMATCH');
    }
    const baselineWrite = await modules.recorder.writeRedactedJsonArtifact(
      layout.runDirectory,
      BASELINE_FILE,
      captured.identity,
    );
    const plan = commandPlan(input.runKind);
    const planWrite = await modules.recorder.writeRedactedJsonArtifact(
      layout.runDirectory,
      PLAN_FILE,
      plan,
    );
    const openingHistoryEvidenceWrite = await modules.recorder.writeRedactedJsonArtifact(
      layout.runDirectory,
      OPENING_HISTORY_EVIDENCE_FILE,
      openingHistoryEvidence,
    );
    await createDenyShims(modules.recorder, layout.runDirectory);
    const context: RunContext = {
      schemaVersion: 'phase-01.ar-12-run-context.v1',
      repositoryRoot: layout.repositoryRoot,
      sourceRepositoryRoot,
      outputRoot: layout.outputRoot,
      runDirectory: layout.runDirectory,
      expectedBranch: input.expectedBranch,
      expectedCommit: input.expectedCommit,
      runKind: input.runKind,
      baselineIdentitySha256: baselineWrite.sha256,
      commandPlanSha256: planWrite.sha256,
      producerSourceManifestSha256: manifestWrite.sha256,
      openingHistoryEvidenceSha256: openingHistoryEvidenceWrite.sha256,
      expectedRepositoryBoundaryResultSha256,
      initializedAt: new Date().toISOString(),
    };
    await modules.recorder.writeRedactedJsonArtifact(
      layout.runDirectory,
      CONTEXT_FILE,
      context,
    );
    await modules.recorder.writeRedactedJsonArtifact(
      layout.runDirectory,
      'init-result.json',
      {
        schemaVersion: 'phase-01.ar-12-init-result.v1',
        status: 'PASSED',
        runKind: input.runKind,
        gitCommitSha: input.expectedCommit,
        baselineIdentitySha256: baselineWrite.sha256,
        commandPlanSha256: planWrite.sha256,
        producerSourceManifestSha256: manifestWrite.sha256,
        openingHistoryEvidenceSha256: openingHistoryEvidenceWrite.sha256,
        expectedRepositoryBoundaryResultSha256,
        commandCount: createCommandSpecs().length,
        completedAt: new Date().toISOString(),
      },
    );
  } catch (error) {
    await writeFailure(
      modules.recorder,
      layout.runDirectory,
      'init',
      errorCode(error),
    );
    throw error;
  }
}

async function loadAndValidateRun(
  repositoryRoot: string,
  runDirectory: string,
): Promise<{
  readonly modules: AuthorityModules;
  readonly context: RunContext;
  readonly baseline: BaselineIdentity;
  readonly plan: Record<string, unknown>;
  readonly openingHistoryEvidence: Ar12HistoryEvidenceSnapshot;
}> {
  const repository = await assertPhysicalDirectory(repositoryRoot, 'AR12_REPOSITORY_ROOT_UNSAFE');
  const run = await assertPhysicalDirectory(runDirectory, 'AR12_RUN_DIRECTORY_UNSAFE');
  const modules = await loadAuthorityModules(repository);
  const context = await readJsonFile<RunContext>(run, CONTEXT_FILE);
  if (
    context.schemaVersion !== 'phase-01.ar-12-run-context.v1' ||
    !samePath(context.repositoryRoot, repository) ||
    !samePath(
      context.sourceRepositoryRoot,
      await assertPhysicalDirectory(
        context.sourceRepositoryRoot,
        'AR12_SOURCE_REPOSITORY_ROOT_UNSAFE',
      ),
    ) ||
    !samePath(context.runDirectory, run)
  ) fail('AR12_RUN_CONTEXT_MISMATCH');
  await assertSafeRunLayout(repository, context.outputRoot, run, false);
  const [
    baseline,
    plan,
    openingHistoryEvidence,
    baselineBytes,
    planBytes,
    openingHistoryEvidenceBytes,
  ] = await Promise.all([
    readJsonFile<BaselineIdentity>(run, BASELINE_FILE),
    readJsonFile<Record<string, unknown>>(run, PLAN_FILE),
    readJsonFile<Ar12HistoryEvidenceSnapshot>(run, OPENING_HISTORY_EVIDENCE_FILE),
    readFile(await assertSafeRegularFile(run, BASELINE_FILE)),
    readFile(await assertSafeRegularFile(run, PLAN_FILE)),
    readFile(await assertSafeRegularFile(run, OPENING_HISTORY_EVIDENCE_FILE)),
  ]);
  if (
    sha256(baselineBytes) !== context.baselineIdentitySha256 ||
    sha256(planBytes) !== context.commandPlanSha256 ||
    sha256(openingHistoryEvidenceBytes) !== context.openingHistoryEvidenceSha256 ||
    !/^[0-9a-f]{64}$/u.test(context.expectedRepositoryBoundaryResultSha256) ||
    sha256(repositoryBoundaryArtifactBytes(
      passedAr12RepositoryBoundaryResult(openingHistoryEvidence, baseline.startedAt),
    )) !== context.expectedRepositoryBoundaryResultSha256 ||
    openingHistoryEvidence.schemaVersion !==
      'phase-01.ar-12-history-evidence-baseline.v1' ||
    !/^[0-9a-f]{64}$/u.test(openingHistoryEvidence.digest) ||
    baseline.sourceManifestSha256 !== context.producerSourceManifestSha256 ||
    baseline.gitCommitSha !== context.expectedCommit ||
    baseline.branch !== context.expectedBranch ||
    baseline.orchestratorSha256 !== await currentOrchestratorSha256() ||
    !exactJsonEqual(plan, commandPlan(context.runKind))
  ) fail('AR12_RUN_ARTIFACT_IDENTITY_MISMATCH');
  return { modules, context, baseline, plan, openingHistoryEvidence };
}

function commandDirectory(ordinal: number, id: string): string {
  return `commands/${String(ordinal).padStart(2, '0')}-${id}`;
}

function parseTestCounts(stdout: string, stderr: string): TestCounts | null {
  const text = stripAnsi(`${stdout}\n${stderr}`);
  const filesLine = text.split(/\r?\n/u).find((line) => /Test Files\s+/u.test(line));
  const testsLine = text.split(/\r?\n/u).find((line) => /^\s*Tests\s+/u.test(line));
  if (filesLine === undefined && testsLine === undefined) return null;
  const parse = (line: string | undefined) => {
    const values = { passed: 0, failed: 0, skipped: 0, todo: 0 };
    if (line === undefined) return values;
    for (const match of line.matchAll(/(\d+)\s+(passed|failed|skipped|todo)\b/gu)) {
      values[match[2] as keyof typeof values] = Number.parseInt(match[1]!, 10);
    }
    return values;
  };
  const files = parse(filesLine);
  const tests = parse(testsLine);
  return {
    filesPassed: files.passed,
    filesFailed: files.failed,
    filesSkipped: files.skipped,
    testsPassed: tests.passed,
    testsFailed: tests.failed,
    testsSkipped: tests.skipped,
    testsTodo: tests.todo,
  };
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '');
}

function parseLastJsonObject(stdout: string, code: string): Record<string, unknown> {
  const lines = stripAnsi(stdout).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const candidate = lines.at(-1);
  if (candidate === undefined) fail(code);
  try {
    const value = JSON.parse(candidate) as unknown;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
    return value as Record<string, unknown>;
  } catch {
    fail(code);
  }
}

async function captureAdversarialSummary(
  modules: AuthorityModules,
  repositoryRoot: string,
  runDirectory: string,
  commandRelativeDirectory: string,
  commandStartedMs: number,
): Promise<Readonly<Record<string, unknown>>> {
  const fixedPath = await assertSafeRegularFile(repositoryRoot, FIXED_ADVERSARIAL_SUMMARY);
  const metadata = await stat(fixedPath);
  if (metadata.mtimeMs + 2_000 < commandStartedMs) fail('AR12_ADVERSARIAL_SUMMARY_NOT_FRESH');
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(await readFile(fixedPath, 'utf8')) as Record<string, unknown>;
  } catch {
    fail('AR12_ADVERSARIAL_SUMMARY_INVALID');
  }
  if (summary['schemaVersion'] !== 'phase-01.verification-adversarial-summary.v1') {
    fail('AR12_ADVERSARIAL_SUMMARY_SCHEMA_INVALID');
  }
  await modules.recorder.writeRedactedJsonArtifact(
    runDirectory,
    `${commandRelativeDirectory}/verification-adversarial-summary.json`,
    summary,
  );
  return summary;
}

async function removePriorAdversarialSummary(repositoryRoot: string): Promise<void> {
  const fixedPath = resolveInside(
    repositoryRoot,
    FIXED_ADVERSARIAL_SUMMARY,
    'AR12_ADVERSARIAL_SUMMARY_PATH_INVALID',
  );
  try {
    const metadata = await lstat(fixedPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
      fail('AR12_ADVERSARIAL_SUMMARY_PREEXISTING_FILE_UNSAFE');
    }
    const physicalPath = await realpath(fixedPath);
    if (!samePath(fixedPath, physicalPath)) {
      fail('AR12_ADVERSARIAL_SUMMARY_PREEXISTING_FILE_UNSAFE');
    }
    await unlink(fixedPath);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}

async function assertNpmCiPostconditions(
  modules: AuthorityModules,
  repositoryRoot: string,
  baseline: BaselineIdentity,
): Promise<void> {
  const state = await readRepositoryState(modules, repositoryRoot);
  const [packageJson, lockfile] = await Promise.all([
    readFile(await assertSafeRegularFile(repositoryRoot, 'package.json')),
    readFile(await assertSafeRegularFile(repositoryRoot, 'package-lock.json')),
  ]);
  if (
    state.branch !== baseline.branch ||
    state.commit !== baseline.gitCommitSha ||
    sha256(packageJson) !== baseline.packageJsonSha256 ||
    sha256(lockfile) !== baseline.lockfileSha256
  ) fail('AR12_NPM_CI_FROZEN_INPUT_DRIFT');
}

export async function runAfterAr12ExecutionWorkspaceGate<T>(
  repositoryRoot: string,
  executeCommands: () => Promise<T>,
  assertNotContaminated: (repositoryRoot: string) => Promise<void> =
    assertRepositoryNotContaminatedByExecutionWorkspace,
): Promise<T> {
  await assertNotContaminated(repositoryRoot);
  return await executeCommands();
}

async function runCommandsCore(
  repositoryRoot: string,
  runDirectory: string,
  options: Ar12RunCommandsOptions,
): Promise<void> {
  const loaded = await loadAndValidateRun(repositoryRoot, runDirectory);
  const { modules, context, baseline, openingHistoryEvidence } = loaded;
  const commands = createCommandSpecs();
  assertAr12CommandPlanSafety(commands);
  const runner = new modules.runner.SpawnRuntimeCommandRunner();
  const denyShimDirectory = resolve(context.runDirectory, 'deny-shims');
  const denyLogPath = resolve(context.runDirectory, DENY_LOG_FILE);
  const environment = {
    PATH: `${denyShimDirectory}${delimiter}${process.env['PATH'] ?? ''}`,
    HDI_AR12_DENY_LOG: denyLogPath,
    CI: '1',
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true',
    REDOCLY_TELEMETRY: 'off',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
    PUPPETEER_SKIP_DOWNLOAD: 'true',
    CYPRESS_INSTALL_BINARY: '0',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    DOCKER_HOST: 'ar12-forbidden://no-container-runtime',
    CONTAINER_HOST: 'ar12-forbidden://no-container-runtime',
    PODMAN_HOST: 'ar12-forbidden://no-container-runtime',
    TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE: '/__ar12_forbidden_no_socket__',
    DATABASE_URL: 'ar12-forbidden://no-database',
    KEYCLOAK_URL: 'ar12-forbidden://no-keycloak',
    AR12_REAL_SERVICE_POLICY: 'FORBIDDEN',
  };
  const results: Record<string, unknown>[] = [];
  let repositoryBoundaryResultSha256: string | null = null;
  const runState: {
    failure: { code: string; commandId: string; exitCode: number | null } | null;
  } = { failure: null };
  try {
    await runAfterAr12ExecutionWorkspaceGate(options.contaminationRepositoryRoot, async () => {
      for (const [index, spec] of commands.entries()) {
      const ordinal = index + 1;
      const relativeDirectory = commandDirectory(ordinal, spec.id);
      await modules.recorder.createEvidenceOutputDirectory(
        resolveInside(context.runDirectory, relativeDirectory, 'AR12_COMMAND_DIRECTORY_INVALID'),
      );
      if (spec.captureAdversarialSummary === true) {
        await removePriorAdversarialSummary(context.repositoryRoot);
      }
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      await modules.recorder.writeRedactedJsonArtifact(
        context.runDirectory,
        `${relativeDirectory}/command.json`,
        {
          schemaVersion: 'phase-01.ar-12-command.v1',
          ordinal,
          id: spec.id,
          category: spec.category,
          executable: spec.executable,
          args: spec.args,
          cwd: spec.cwd,
          expectedExitCodes: spec.expectedExitCodes,
          shell: false,
          environmentKeys: Object.keys(environment).sort(),
          startedAt,
        },
      );
      let commandResult: RuntimeCommandResult;
      let runnerFailureCode: string | null = null;
      try {
        const invocation = await runtimeInvocation(
          spec.executable,
          spec.args,
          context.repositoryRoot,
        );
        commandResult = await runner.run({
          executable: invocation.executable,
          args: invocation.args,
          cwd: spec.cwd === '.'
            ? context.repositoryRoot
            : resolveInside(context.repositoryRoot, spec.cwd, 'AR12_COMMAND_CWD_INVALID'),
          environment,
        });
      } catch (error) {
        runnerFailureCode = errorCode(error);
        commandResult = { exitCode: null, signal: null, stdout: '', stderr: '' };
      }
      const finishedAt = new Date().toISOString();
      const testCounts = parseTestCounts(commandResult.stdout, commandResult.stderr);
      const evidenceStdout = redactDerivedSecrets(modules, commandResult.stdout);
      const evidenceStderr = redactDerivedSecrets(modules, commandResult.stderr);
      await modules.recorder.writeRedactedTextArtifact(
        context.runDirectory,
        `${relativeDirectory}/stdout.log`,
        evidenceStdout,
      );
      await modules.recorder.writeRedactedTextArtifact(
        context.runDirectory,
        `${relativeDirectory}/stderr.log`,
        evidenceStderr,
      );
      let postconditionFailureCode: string | null = null;
      let adversarialSummary: Readonly<Record<string, unknown>> | null = null;
      let standaloneObservation: Readonly<Record<string, unknown>> | null = null;
      if (
        runnerFailureCode === null &&
        commandResult.exitCode === 0 &&
        commandResult.signal === null
      ) {
        try {
          if (spec.id === 'npm-ci') {
            await assertNpmCiPostconditions(modules, context.repositoryRoot, baseline);
          }
          if (spec.captureAdversarialSummary === true) {
            adversarialSummary = await captureAdversarialSummary(
              modules,
              context.repositoryRoot,
              context.runDirectory,
              relativeDirectory,
              startedMs,
            );
          }
          if (spec.id === 'verify-podman-authority') {
            const observed = parseLastJsonObject(
              commandResult.stdout,
              'AR12_RUNTIME_AUTHORITY_OBSERVATION_INVALID',
            );
            if (
              observed['status'] !== 'PASSED' ||
              observed['rootless'] !== false ||
              observed['restartPolicy'] !== 'no' ||
              observed['runtimeAuthoritySha256'] !== baseline.runtimeAuthoritySha256 ||
              observed['runtimeAuthoritySemanticDigest'] !==
                baseline.runtimeAuthoritySemanticDigest
            ) fail('AR12_RUNTIME_AUTHORITY_OBSERVATION_MISMATCH');
            standaloneObservation = observed;
          }
          if (spec.id === 'ar10-evidence-tamper-observed') {
            const observed = parseLastJsonObject(
              commandResult.stdout,
              'AR12_EVIDENCE_TAMPER_OBSERVATION_INVALID',
            );
            if (
              observed['evidenceIntegrityStatus'] !== 'FAILED' ||
              typeof observed['producerProvenanceStatus'] !== 'string' ||
              observed['producerProvenanceStatus'] === 'UNVERIFIABLE' ||
              observed['reviewStatus'] !== 'FAILED'
            ) fail('AR12_EVIDENCE_TAMPER_OBSERVATION_MISMATCH');
            standaloneObservation = observed;
          }
        } catch (error) {
          postconditionFailureCode = errorCode(error);
        }
      }
      const passed =
        runnerFailureCode === null &&
        postconditionFailureCode === null &&
        commandResult.exitCode === 0 &&
        commandResult.signal === null;
      const result = {
        schemaVersion: 'phase-01.ar-12-command-result.v1',
        ordinal,
        id: spec.id,
        status: passed ? 'PASSED' : 'FAILED',
        exitCode: commandResult.exitCode,
        signal: commandResult.signal,
        runnerFailureCode,
        postconditionFailureCode,
        testCounts,
        adversarialCounts: adversarialSummary === null ? null : {
          mutationCount: adversarialSummary['mutationCount'],
          detectedCount: adversarialSummary['detectedCount'],
          survivedCount: adversarialSummary['survivedCount'],
        },
        standaloneObservation,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startedMs,
      };
      await modules.recorder.writeRedactedJsonArtifact(
        context.runDirectory,
        `${relativeDirectory}/result.json`,
        result,
      );
      results.push(result);
        if (!passed) {
          runState.failure = {
            code: runnerFailureCode ?? postconditionFailureCode ?? 'AR12_COMMAND_EXIT_UNEXPECTED',
            commandId: spec.id,
            exitCode: commandResult.exitCode,
          };
          break;
        }
      }
    });
    if (runState.failure === null && results.length === commands.length) {
      const repositoryBoundary = await verifyAr12RepositoryBoundary({
        sourceRepositoryRoot: options.contaminationRepositoryRoot,
        outputRoot: context.outputRoot,
        runDirectory: context.runDirectory,
        openingHistoryEvidence,
        checkedAt: baseline.startedAt,
      });
      const endingHistoryEvidence = await captureAr12HistoryEvidenceSnapshot(
        context.outputRoot,
        context.runDirectory,
      );
      assertAr12HistoryEvidenceStable(openingHistoryEvidence, endingHistoryEvidence);
      await modules.recorder.writeRedactedJsonArtifact(
        context.runDirectory,
        ENDING_HISTORY_EVIDENCE_FILE,
        endingHistoryEvidence,
      );
      const repositoryBoundaryWrite = await modules.recorder.writeRedactedJsonArtifact(
        context.runDirectory,
        REPOSITORY_BOUNDARY_FILE,
        repositoryBoundary,
      );
      if (
        repositoryBoundaryWrite.sha256 !== context.expectedRepositoryBoundaryResultSha256
      ) fail('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
      repositoryBoundaryResultSha256 = repositoryBoundaryWrite.sha256;
    }
    await modules.recorder.writeRedactedJsonArtifact(
      context.runDirectory,
      'run-commands-result.json',
      {
        schemaVersion: 'phase-01.ar-12-run-commands-result.v1',
        status: runState.failure === null && results.length === commands.length
          ? 'PASSED'
          : 'FAILED',
        commandCount: commands.length,
        executedCommandCount: results.length,
        passedCommandCount: results.filter((item) => item['status'] === 'PASSED').length,
        failedCommandCount: results.filter((item) => item['status'] === 'FAILED').length,
        skippedCommandCount: commands.length - results.length,
        repositoryBoundaryResultSha256,
        failure: runState.failure,
        completedAt: new Date().toISOString(),
      },
    );
    if (runState.failure !== null || results.length !== commands.length) {
      await writeFailure(modules.recorder, context.runDirectory, 'run-commands',
        runState.failure?.code ?? 'AR12_COMMAND_SEQUENCE_INCOMPLETE', runState.failure ?? {});
      fail('AR12_COMMAND_SEQUENCE_FAILED');
    }
  } catch (error) {
    if (runState.failure === null) {
      await writeFailure(
        modules.recorder,
        context.runDirectory,
        'run-commands',
        errorCode(error),
      );
    }
    throw error;
  }
}

async function runCommands(
  repositoryRoot: string,
  runDirectory: string,
  options: Ar12RunCommandsOptions,
): Promise<void> {
  try {
    await runCommandsCore(repositoryRoot, runDirectory, options);
  } catch (error) {
    try {
      const run = await assertPhysicalDirectory(runDirectory, 'AR12_RUN_DIRECTORY_UNSAFE');
      const modules = await loadAuthorityModules(repositoryRoot);
      await writeFailure(modules.recorder, run, 'run-commands', errorCode(error));
    } catch {
      // Preserve the primary failure if even the existing authority cannot record it.
    }
    throw error;
  }
}

interface CollectedCommand {
  readonly spec: CommandSpec;
  readonly ordinal: number;
  readonly relativeDirectory: string;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly testCounts: TestCounts | null;
}

async function collectCommandResults(
  runDirectory: string,
  commands: readonly CommandSpec[],
): Promise<readonly CollectedCommand[]> {
  const collected: CollectedCommand[] = [];
  for (const [index, spec] of commands.entries()) {
    const ordinal = index + 1;
    const relativeDirectory = commandDirectory(ordinal, spec.id);
    let result: Readonly<Record<string, unknown>> | null = null;
    let commandArtifact: Readonly<Record<string, unknown>> | null = null;
    try {
      result = await readJsonFile<Record<string, unknown>>(
        runDirectory,
        `${relativeDirectory}/result.json`,
      );
      commandArtifact = await readJsonFile<Record<string, unknown>>(
        runDirectory,
        `${relativeDirectory}/command.json`,
      );
      await Promise.all([
        assertSafeRegularFile(runDirectory, `${relativeDirectory}/stdout.log`),
        assertSafeRegularFile(runDirectory, `${relativeDirectory}/stderr.log`),
      ]);
    } catch (error) {
      if (errorCode(error) !== 'AR12_ORCHESTRATOR_INTERNAL_ERROR') throw error;
      result = null;
      commandArtifact = null;
    }
    if (result !== null && (
      result['schemaVersion'] !== 'phase-01.ar-12-command-result.v1' ||
      result['ordinal'] !== ordinal ||
      result['id'] !== spec.id
    )) fail('AR12_COMMAND_RESULT_IDENTITY_INVALID');
    if (commandArtifact !== null && (
      commandArtifact['schemaVersion'] !== 'phase-01.ar-12-command.v1' ||
      commandArtifact['ordinal'] !== ordinal ||
      commandArtifact['id'] !== spec.id ||
      commandArtifact['executable'] !== spec.executable ||
      !exactJsonEqual(commandArtifact['args'], spec.args) ||
      commandArtifact['cwd'] !== spec.cwd ||
      commandArtifact['shell'] !== false
    )) fail('AR12_COMMAND_ARTIFACT_IDENTITY_INVALID');
    const counts = result?.['testCounts'];
    collected.push({
      spec,
      ordinal,
      relativeDirectory,
      result,
      testCounts: isTestCounts(counts) ? counts : null,
    });
  }
  return collected;
}

function isTestCounts(value: unknown): value is TestCounts {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return [
    'filesPassed', 'filesFailed', 'filesSkipped', 'testsPassed',
    'testsFailed', 'testsSkipped', 'testsTodo',
  ].every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0);
}

function evaluateCommandResults(collected: readonly CollectedCommand[]): {
  readonly passedCommandCount: number;
  readonly failedCommandCount: number;
  readonly skippedCommandCount: number;
  readonly testCounts: Readonly<Partial<Record<SuiteKey, TestCounts>>>;
  readonly unexpectedSkippedCount: number;
  readonly skipClassifications: readonly Readonly<Record<string, unknown>>[];
  readonly floorFailures: readonly string[];
} {
  let passedCommandCount = 0;
  let failedCommandCount = 0;
  let skippedCommandCount = 0;
  let unexpectedSkippedCount = 0;
  const testCounts: Partial<Record<SuiteKey, TestCounts>> = {};
  const skipClassifications: Record<string, unknown>[] = [];
  const floorFailures: string[] = [];
  for (const item of collected) {
    if (item.result === null) {
      skippedCommandCount += 1;
      continue;
    }
    if (item.result['status'] === 'PASSED' && item.result['exitCode'] === 0) {
      passedCommandCount += 1;
    } else {
      failedCommandCount += 1;
    }
    if (item.spec.suiteKey !== undefined && item.testCounts !== null) {
      testCounts[item.spec.suiteKey] = item.testCounts;
    }
    if (item.spec.minimumFilesPassed !== undefined && (
      item.testCounts === null || item.testCounts.filesPassed < item.spec.minimumFilesPassed
    )) floorFailures.push(`${item.spec.id}:files`);
    if (item.spec.minimumTestsPassed !== undefined && (
      item.testCounts === null || item.testCounts.testsPassed < item.spec.minimumTestsPassed
    )) floorFailures.push(`${item.spec.id}:tests`);
    if (item.testCounts !== null) {
      const skipped = item.testCounts.testsSkipped + item.testCounts.testsTodo;
      if (item.spec.skipPolicy === 'FOCUSED_SELECTION' && item.testCounts.testsPassed !== 1) {
        floorFailures.push(`${item.spec.id}:focused-selection-cardinality`);
      }
      if (item.spec.skipPolicy === 'NONE' && skipped !== 0) {
        unexpectedSkippedCount += skipped;
      }
      if (item.spec.skipPolicy === 'NONE' && item.testCounts.filesSkipped !== 0) {
        unexpectedSkippedCount += item.testCounts.filesSkipped;
      }
      if (item.spec.skipPolicy === 'REAL_RUNTIME_BOUNDARY') {
        const expected = item.spec.expectedTestsSkipped ?? 0;
        if (item.testCounts.testsSkipped !== expected || item.testCounts.testsTodo !== 0) {
          unexpectedSkippedCount += Math.abs(item.testCounts.testsSkipped - expected) +
            item.testCounts.testsTodo;
          floorFailures.push(`${item.spec.id}:real-runtime-skip-count`);
        }
      }
      if (skipped > 0 || item.spec.skipPolicy !== 'NONE') {
        skipClassifications.push({
          commandId: item.spec.id,
          policy: item.spec.skipPolicy,
          testsSkipped: item.testCounts.testsSkipped,
          testsTodo: item.testCounts.testsTodo,
          classification: item.spec.skipPolicy === 'FOCUSED_SELECTION'
            ? 'EXPECTED_FOCUSED_SELECTION'
            : item.spec.skipPolicy === 'REAL_RUNTIME_BOUNDARY'
              ? 'EXPECTED_REAL_RUNTIME_FORBIDDEN'
              : 'UNEXPECTED',
        });
      }
    }
  }
  return {
    passedCommandCount,
    failedCommandCount,
    skippedCommandCount,
    testCounts,
    unexpectedSkippedCount,
    skipClassifications,
    floorFailures,
  };
}

async function readAdversarialCounts(
  runDirectory: string,
  collected: readonly CollectedCommand[],
): Promise<{
  readonly mutationCount: number;
  readonly detectedCount: number;
  readonly survivedCount: number;
  readonly embeddedScriptMutationDetected: boolean;
}> {
  const command = collected.find((item) => item.spec.id === 'verification-adversarial');
  if (command === undefined) fail('AR12_ADVERSARIAL_COMMAND_MISSING');
  const summary = await readJsonFile<Record<string, unknown>>(
    runDirectory,
    `${command.relativeDirectory}/verification-adversarial-summary.json`,
  );
  const mutationCount = summary['mutationCount'];
  const detectedCount = summary['detectedCount'];
  const survivedCount = summary['survivedCount'];
  const mutations = summary['mutations'];
  if (
    summary['schemaVersion'] !== 'phase-01.verification-adversarial-summary.v1' ||
    !Number.isSafeInteger(mutationCount) ||
    !Number.isSafeInteger(detectedCount) ||
    !Number.isSafeInteger(survivedCount) ||
    !Array.isArray(mutations)
  ) fail('AR12_ADVERSARIAL_COUNTS_INVALID');
  const embedded = mutations.find((item) =>
    item !== null &&
    typeof item === 'object' &&
    (item as Record<string, unknown>)['mutationId'] === 'EVIDENCE_EMBEDDED_SCRIPT_NOT_EXECUTED'
  ) as Record<string, unknown> | undefined;
  return {
    mutationCount: mutationCount as number,
    detectedCount: detectedCount as number,
    survivedCount: survivedCount as number,
    embeddedScriptMutationDetected: embedded?.['detected'] === true,
  };
}

function secretTransforms(value: string): readonly { name: string; value: string }[] {
  const jsonEncoded = JSON.stringify(value);
  const shellSingleQuoted = `'${value.replaceAll("'", "'\\''")}'`;
  const powerShellSingleQuoted = `'${value.replaceAll("'", "''")}'`;
  const powerShellDoubleQuoted = `"${value
    .replaceAll('`', '``')
    .replaceAll('$', '`$')
    .replaceAll('"', '`"')}"`;
  return [
    { name: 'RAW', value },
    { name: 'URL_ENCODED', value: encodeURIComponent(value) },
    { name: 'URL_FORM_ENCODED', value: encodeURIComponent(value).replaceAll('%20', '+') },
    { name: 'BASE64', value: Buffer.from(value, 'utf8').toString('base64') },
    { name: 'BASE64URL', value: Buffer.from(value, 'utf8').toString('base64url') },
    { name: 'JSON_ESCAPED', value: jsonEncoded.slice(1, -1) },
    { name: 'JSON_STRING', value: jsonEncoded },
    { name: 'SHELL_SINGLE_QUOTED', value: shellSingleQuoted },
    { name: 'POWERSHELL_SINGLE_QUOTED', value: powerShellSingleQuoted },
    { name: 'POWERSHELL_DOUBLE_QUOTED', value: powerShellDoubleQuoted },
  ];
}

function redactDerivedSecrets(modules: AuthorityModules, value: string): string {
  let redacted = modules.recorder.redactSensitiveText(value);
  const derivatives = modules.runner.FORMAL_REQUIRED_SECRET_NAMES.flatMap((name) => {
    const secret = process.env[name];
    return secret === undefined || secret.length === 0
      ? []
      : secretTransforms(secret).map((item) => item.value);
  });
  for (const derivative of [...new Set(derivatives)].sort((left, right) => right.length - left.length)) {
    if (derivative.length > 0) redacted = redacted.replaceAll(derivative, '[REDACTED]');
  }
  return modules.recorder.redactSensitiveText(redacted);
}

async function listRegularFiles(root: string): Promise<readonly string[]> {
  const physicalRoot = await assertPhysicalDirectory(root, 'AR12_SCAN_ROOT_UNSAFE');
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      const path = join(directory, child.name);
      const observed = await lstat(path);
      if (observed.isSymbolicLink()) fail('AR12_SCAN_SYMLINK_FORBIDDEN');
      if (observed.isDirectory()) await visit(path);
      else if (observed.isFile() && observed.nlink === 1) files.push(path);
      else fail('AR12_SCAN_NONREGULAR_FILE');
    }
  };
  await visit(physicalRoot);
  return files;
}

async function scanRunArtifacts(
  modules: AuthorityModules,
  runDirectory: string,
): Promise<{
  readonly status: 'PASSED' | 'FAILED';
  readonly scannedFileCount: number;
  readonly configuredSecretCount: number;
  readonly transformedSecretFindingCount: number;
  readonly sensitiveAssignmentFindingCount: number;
  readonly findings: readonly Readonly<Record<string, string>>[];
}> {
  const files = await listRegularFiles(runDirectory);
  const configuredSecrets = modules.runner.FORMAL_REQUIRED_SECRET_NAMES.flatMap((name) => {
    const value = process.env[name];
    return value === undefined || value.length === 0 ? [] : [{ name, value }];
  });
  const findings: Record<string, string>[] = [];
  let transformedSecretFindingCount = 0;
  let sensitiveAssignmentFindingCount = 0;
  for (const file of files) {
    const bytes = await readFile(file);
    const text = bytes.toString('utf8');
    const relativePath = relative(runDirectory, file).split(sep).join('/');
    for (const secret of configuredSecrets) {
      for (const transform of secretTransforms(secret.value)) {
        if (transform.value.length > 0 && text.includes(transform.value)) {
          findings.push({
            type: 'CONFIGURED_SECRET_DERIVATIVE',
            file: relativePath,
            secretName: secret.name,
            transform: transform.name,
          });
          transformedSecretFindingCount += 1;
        }
      }
    }
    const assignmentPattern = /\b(?:password|client[_-]?secret|session[_-]?secret|authorization|cookie|database_url)\b\s*[=:]\s*(?!\s*(?:\[REDACTED\]|null|true|false|PRESENT\b|ABSENT\b))[^\s,;}]+/giu;
    if (assignmentPattern.test(text)) {
      findings.push({ type: 'NONREDACTED_SENSITIVE_ASSIGNMENT', file: relativePath });
      sensitiveAssignmentFindingCount += 1;
    }
    if (/"Env"\s*:\s*\[/u.test(text) || /\bEnv\s*=\s*\[/u.test(text)) {
      findings.push({ type: 'COMPLETE_CONTAINER_ENV_SERIALIZED', file: relativePath });
      sensitiveAssignmentFindingCount += 1;
    }
  }
  return {
    status: findings.length === 0 ? 'PASSED' : 'FAILED',
    scannedFileCount: files.length,
    configuredSecretCount: configuredSecrets.length,
    transformedSecretFindingCount,
    sensitiveAssignmentFindingCount,
    findings,
  };
}

async function findSentinelFiles(repositoryRoot: string): Promise<readonly string[]> {
  const found: string[] = [];
  const root = await assertPhysicalDirectory(repositoryRoot, 'AR12_SENTINEL_SCAN_ROOT_UNSAFE');
  const visit = async (directory: string): Promise<void> => {
    for (const child of await readdir(directory, { withFileTypes: true })) {
      if (child.name === '.git' || child.name === 'node_modules') continue;
      const path = join(directory, child.name);
      const observed = await lstat(path);
      if (observed.isSymbolicLink()) continue;
      if (observed.isDirectory()) await visit(path);
      else if (
        observed.isFile() &&
        /(?:unlisted|listed)-script-executed\.txt$/u.test(child.name)
      ) found.push(relative(root, path).split(sep).join('/'));
    }
  };
  await visit(root);
  return found.sort();
}

async function scanSideEffects(
  repositoryRoot: string,
  runDirectory: string,
  embeddedScriptMutationDetected: boolean,
): Promise<{
  readonly status: 'PASSED' | 'FAILED';
  readonly denyShimInvocationCount: number;
  readonly denyShimInvocations: readonly string[];
  readonly sentinelFiles: readonly string[];
  readonly embeddedEvidenceScriptNotExecuted: boolean;
}> {
  const denyLog = await readFile(await assertSafeRegularFile(runDirectory, DENY_LOG_FILE), 'utf8');
  const invocations = denyLog.split(/\r?\n/u).filter((line) => line.length > 0);
  const unexpectedInvocation = invocations.some((name) =>
    !DENIED_EXECUTABLES.includes(name as (typeof DENIED_EXECUTABLES)[number])
  );
  const sentinelFiles = await findSentinelFiles(repositoryRoot);
  const passed =
    invocations.length === 0 &&
    !unexpectedInvocation &&
    sentinelFiles.length === 0 &&
    embeddedScriptMutationDetected;
  return {
    status: passed ? 'PASSED' : 'FAILED',
    denyShimInvocationCount: invocations.length,
    denyShimInvocations: [...new Set(invocations)].sort(),
    sentinelFiles,
    embeddedEvidenceScriptNotExecuted: embeddedScriptMutationDetected,
  };
}

const STANDALONE_EXPECTATIONS: Readonly<Record<number, Readonly<Record<string, unknown>>>> = {
  1: { ticket: 'AR-09', scenario: 'valid terminal fixture', expected: 'PASSED; failedCheckCount=0' },
  2: { ticket: 'AR-09', scenario: 'cleanup FAILED', expected: 'FORMAL_CLEANUP_STATUS_NOT_PASSED' },
  3: { ticket: 'AR-09', scenario: 'terminal conclusion missing', expected: 'FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING' },
  4: { ticket: 'AR-10', scenario: 'EXACT', expected: 'PASSED/VERIFIED/EXACT/NONE/CLEAN' },
  5: { ticket: 'AR-10', scenario: 'evidence internal tamper', expected: 'integrity FAILED; provenance not UNVERIFIABLE' },
  6: { ticket: 'AR-10', scenario: 'producer commit unavailable', expected: 'UNVERIFIABLE/PRODUCER_COMMIT_UNAVAILABLE' },
  7: { ticket: 'AR-10', scenario: 'compatible definition drift', expected: 'FAILED/VERIFIED/COMPATIBLE/DRIFTED/CLEAN' },
  8: { ticket: 'AR-10', scenario: 'unsupported tuple', expected: 'INCOMPATIBLE/FAILED' },
  9: { ticket: 'AR-11', scenario: 'valid runtime authority', expected: 'exit 0/rootful/restart=no' },
  10: { ticket: 'AR-11', scenario: 'Docker socket alias', expected: 'FORMAL_PREFLIGHT_DOCKER_SOCKET_PRESENT' },
  11: { ticket: 'AR-11', scenario: 'persistent restart', expected: 'RUNTIME_AUTHORITY_RESTART_POLICY_INVALID' },
  12: { ticket: 'AR-11', scenario: 'Keycloak create failure', expected: 'primary error retained; exact four-resource cleanup; unrelated preserved' },
  13: { ticket: 'AR-11', scenario: 'bootstrap migration failure', expected: 'stable exit; primary and cleanup evidence retained' },
  14: { ticket: 'AR-11', scenario: 'source provenance exact', expected: 'VERIFIED/EXACT/NONE/CLEAN/PASSED' },
};

function buildStandaloneChecks(collected: readonly CollectedCommand[]): readonly Record<string, unknown>[] {
  return Object.keys(STANDALONE_EXPECTATIONS).map((key) => Number.parseInt(key, 10)).map((id) => {
    const commandResult = collected.find((item) => item.spec.standaloneCheckIds?.includes(id));
    return {
      id,
      ...STANDALONE_EXPECTATIONS[id],
      commandId: commandResult?.spec.id ?? null,
      assertedByTestTitle: commandResult?.spec.args.find((arg) =>
        arg.startsWith('--testNamePattern='))?.slice('--testNamePattern='.length) ?? null,
      observed: commandResult?.result === null || commandResult?.result === undefined
        ? null
        : {
            wrapperExitCode: commandResult.result['exitCode'] ?? null,
            testFilesPassed: commandResult.testCounts?.filesPassed ?? null,
            testsPassed: commandResult.testCounts?.testsPassed ?? null,
            assertionObservation: commandResult.result['standaloneObservation'] ?? null,
          },
      status: commandResult?.result?.['status'] === 'PASSED' ? 'PASSED' : 'FAILED',
    };
  });
}

async function finalizeCore(repositoryRoot: string, runDirectory: string): Promise<void> {
  const loaded = await loadAndValidateRun(repositoryRoot, runDirectory);
  const { modules, context, baseline, openingHistoryEvidence } = loaded;
  if (baseline.schemaVersion !== 'phase-01.ar-12-baseline-identity.v1') {
    fail('AR12_BASELINE_SCHEMA_INVALID');
  }
  const commands = createCommandSpecs();
  const failures: string[] = [];
  let repositoryBoundaryResult: Ar12RepositoryBoundaryResult | null = null;
  let repositoryBoundaryFields: {
    readonly repositoryContaminationGuard: 'PASSED' | 'FAILED';
    readonly repoLayoutStatus: 'PASSED' | 'FAILED';
    readonly historyEvidenceStable: boolean;
  } = {
    repositoryContaminationGuard: 'FAILED',
    repoLayoutStatus: 'FAILED',
    historyEvidenceStable: false,
  };
  try {
    const persistedRepositoryBoundaryResult = await readJsonFile<Ar12RepositoryBoundaryResult>(
      context.runDirectory,
      REPOSITORY_BOUNDARY_FILE,
    );
    const repositoryBoundaryBytes = await readFile(await assertSafeRegularFile(
      context.runDirectory,
      REPOSITORY_BOUNDARY_FILE,
    ));
    const runCommandsResult = await readJsonFile<Record<string, unknown>>(
      context.runDirectory,
      'run-commands-result.json',
    );
    const expectedBoundarySha256 = runCommandsResult['repositoryBoundaryResultSha256'];
    if (expectedBoundarySha256 !== context.expectedRepositoryBoundaryResultSha256) {
      fail('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
    }
    validateAr12RepositoryBoundaryArtifact({
      result: persistedRepositoryBoundaryResult,
      artifactBytes: repositoryBoundaryBytes,
      expectedSha256: context.expectedRepositoryBoundaryResultSha256,
      openingHistoryEvidence,
    });
    const persistedEndingHistoryEvidence = await readJsonFile<Ar12HistoryEvidenceBaseline>(
      context.runDirectory,
      ENDING_HISTORY_EVIDENCE_FILE,
    );
    assertAr12HistoryEvidenceStable(openingHistoryEvidence, persistedEndingHistoryEvidence);
    repositoryBoundaryResult = await verifyAr12RepositoryBoundary({
      sourceRepositoryRoot: context.sourceRepositoryRoot,
      outputRoot: context.outputRoot,
      runDirectory: context.runDirectory,
      openingHistoryEvidence,
      checkedAt: baseline.startedAt,
    });
    repositoryBoundaryFields = ar12SummaryRepositoryBoundaryFields(repositoryBoundaryResult);
  } catch {
    failures.push('AR12_REPOSITORY_BOUNDARY_RESULT_INVALID');
  }
  let endingIdentity: BaselineIdentity | null = null;
  let identityFailureCode: string | null = null;
  try {
    endingIdentity = (await captureBaselineIdentity(
      modules,
      context.repositoryRoot,
      baseline.startedAt,
      context.expectedBranch,
      context.expectedCommit,
    )).identity;
  } catch (error) {
    identityFailureCode = errorCode(error);
    failures.push(identityFailureCode);
  }
  await modules.recorder.writeRedactedJsonArtifact(
    context.runDirectory,
    'ending-baseline-identity.json',
    endingIdentity ?? {
      schemaVersion: 'phase-01.ar-12-ending-identity-failure.v1',
      status: 'FAILED',
      failureCode: identityFailureCode,
      startedAt: baseline.startedAt,
      capturedAt: new Date().toISOString(),
    },
  );

  let persistedSourceManifestStable = false;
  try {
    persistedSourceManifestStable = await modules.sourceManifest.verifyProducerSourceManifestStable(
      context.runDirectory,
      baseline.sourceManifestSha256,
    );
  } catch {
    persistedSourceManifestStable = false;
  }
  if (!persistedSourceManifestStable) failures.push('AR12_PERSISTED_SOURCE_MANIFEST_DRIFT');

  const collected = await collectCommandResults(context.runDirectory, commands);
  const commandEvaluation = evaluateCommandResults(collected);
  if (
    commandEvaluation.failedCommandCount !== 0 ||
    commandEvaluation.skippedCommandCount !== 0 ||
    commandEvaluation.passedCommandCount !== commands.length
  ) failures.push('AR12_COMMAND_RESULTS_INCOMPLETE_OR_FAILED');
  if (commandEvaluation.floorFailures.length !== 0) failures.push('AR12_TEST_COUNT_FLOOR_FAILED');
  if (commandEvaluation.unexpectedSkippedCount !== 0) failures.push('AR12_UNEXPECTED_SKIPPED_TESTS');

  let adversarialCounts = {
    mutationCount: 0,
    detectedCount: 0,
    survivedCount: 0,
    embeddedScriptMutationDetected: false,
  };
  try {
    adversarialCounts = await readAdversarialCounts(context.runDirectory, collected);
  } catch (error) {
    failures.push(errorCode(error));
  }
  if (!isAr12AdversarialFloorSatisfied(adversarialCounts)) {
    failures.push('AR12_ADVERSARIAL_FLOOR_FAILED');
  }

  let secretScan: Awaited<ReturnType<typeof scanRunArtifacts>>;
  try {
    secretScan = await scanRunArtifacts(modules, context.runDirectory);
  } catch (error) {
    failures.push(errorCode(error));
    secretScan = {
      status: 'FAILED',
      scannedFileCount: 0,
      configuredSecretCount: 0,
      transformedSecretFindingCount: 0,
      sensitiveAssignmentFindingCount: 0,
      findings: [{ type: 'SCAN_FAILED', file: '', transform: errorCode(error) }],
    };
  }
  if (secretScan.status !== 'PASSED') failures.push('AR12_SECRET_SCAN_FAILED');
  await modules.recorder.writeRedactedJsonArtifact(
    context.runDirectory,
    'secret-scan.json',
    {
      schemaVersion: 'phase-01.ar-12-secret-scan.v1',
      ...secretScan,
      scannedAt: new Date().toISOString(),
    },
  );

  let sideEffectScan: Awaited<ReturnType<typeof scanSideEffects>>;
  try {
    sideEffectScan = await scanSideEffects(
      context.repositoryRoot,
      context.runDirectory,
      adversarialCounts.embeddedScriptMutationDetected,
    );
  } catch (error) {
    failures.push(errorCode(error));
    sideEffectScan = {
      status: 'FAILED',
      denyShimInvocationCount: 0,
      denyShimInvocations: [],
      sentinelFiles: [],
      embeddedEvidenceScriptNotExecuted: false,
    };
  }
  if (sideEffectScan.status !== 'PASSED') failures.push('AR12_SIDE_EFFECT_SCAN_FAILED');
  await modules.recorder.writeRedactedJsonArtifact(
    context.runDirectory,
    'side-effect-scan.json',
    {
      schemaVersion: 'phase-01.ar-12-side-effect-scan.v1',
      ...sideEffectScan,
      scannedAt: new Date().toISOString(),
    },
  );

  const identityStable = endingIdentity !== null && exactJsonEqual(baseline, endingIdentity);
  const worktreeClean = endingIdentity?.worktreeState === 'CLEAN';
  const packageJsonStable = endingIdentity?.packageJsonSha256 === baseline.packageJsonSha256;
  const lockfileStable = endingIdentity?.lockfileSha256 === baseline.lockfileSha256;
  const contractIdentityStable = endingIdentity !== null &&
    exactJsonEqual(endingIdentity.contractIdentity, baseline.contractIdentity) &&
    exactJsonEqual(
      endingIdentity.verificationAuthorityIdentity,
      baseline.verificationAuthorityIdentity,
    ) &&
    endingIdentity.coverageMatrixDigest === baseline.coverageMatrixDigest &&
    endingIdentity.producerProtocolIdentityDigest === baseline.producerProtocolIdentityDigest;
  const runtimeAuthorityStable = endingIdentity?.runtimeAuthoritySha256 ===
      baseline.runtimeAuthoritySha256 &&
    endingIdentity?.runtimeAuthoritySemanticDigest === baseline.runtimeAuthoritySemanticDigest &&
    endingIdentity?.runtimeAuthoritySchemaVersion === baseline.runtimeAuthoritySchemaVersion &&
    endingIdentity?.runtimeAuthorityId === baseline.runtimeAuthorityId;
  const sourceManifestIdentityStable = endingIdentity?.sourceManifestSha256 ===
      baseline.sourceManifestSha256 &&
    endingIdentity?.sourceManifestDigest === baseline.sourceManifestDigest &&
    endingIdentity?.sourceManifestFileCount === baseline.sourceManifestFileCount;
  const phase01CompletionTreeStable = endingIdentity?.phase01CompletionTreeFingerprint ===
      baseline.phase01CompletionTreeFingerprint &&
    endingIdentity?.phase01CompletionTreeFileCount === baseline.phase01CompletionTreeFileCount;
  const orchestratorStable = endingIdentity?.orchestratorSha256 === baseline.orchestratorSha256;
  const sourceTreeStable =
    identityStable &&
    persistedSourceManifestStable &&
    sourceManifestIdentityStable &&
    phase01CompletionTreeStable;
  if (!identityStable) failures.push('AR12_ENDING_IDENTITY_DRIFT');
  if (!worktreeClean) failures.push('AR12_ENDING_WORKTREE_NOT_CLEAN');
  if (!packageJsonStable) failures.push('AR12_PACKAGE_JSON_DRIFT');
  if (!lockfileStable) failures.push('AR12_LOCKFILE_DRIFT');
  if (!contractIdentityStable) failures.push('AR12_CONTRACT_IDENTITY_DRIFT');
  if (!runtimeAuthorityStable) failures.push('AR12_RUNTIME_AUTHORITY_DRIFT');
  if (!sourceManifestIdentityStable) failures.push('AR12_SOURCE_MANIFEST_IDENTITY_DRIFT');
  if (!phase01CompletionTreeStable) failures.push('AR12_PHASE_01_COMPLETION_TREE_DRIFT');
  if (!orchestratorStable) failures.push('AR12_ORCHESTRATOR_DRIFT');

  const standaloneChecks = buildStandaloneChecks(collected);
  if (standaloneChecks.some((item) => item['status'] !== 'PASSED')) {
    failures.push('AR12_STANDALONE_CHECK_FAILED');
  }
  const uniqueFailures = [...new Set(failures)];
  const passed = uniqueFailures.length === 0;
  const summaryName = context.runKind === 'initial'
    ? 'ar-12-rebaseline-summary.json'
    : 'ar-12-final-rebaseline-summary.json';
  const summary = {
    schemaVersion: 'phase-01.ar-12-rebaseline-summary.v1',
    purpose: 'AR-12_REBASELINE',
    runKind: context.runKind,
    formalAcceptanceEligible: false,
    realServicesStarted: false,
    sharedReadinessExecuted: false,
    formalAbgExecuted: false,
    ...repositoryBoundaryFields,
    historyEvidenceContractDigest: openingHistoryEvidence.historyContractDigest,
    historicalEvidenceSetDigest: openingHistoryEvidence.historicalEvidenceSetDigest,
    requiredHistoryCount: openingHistoryEvidence.requiredHistoryCount,
    requiredHistoryPassedCount: openingHistoryEvidence.requiredHistoryPassedCount,
    historyEvidenceBaselinePath: OPENING_HISTORY_EVIDENCE_FILE,
    historyEvidenceFinalPath: ENDING_HISTORY_EVIDENCE_FILE,
    repositoryBoundaryIdentity: repositoryBoundaryResult,
    baselineIdentity: baseline,
    endingIdentity,
    commandCount: commands.length,
    passedCommandCount: commandEvaluation.passedCommandCount,
    failedCommandCount: commandEvaluation.failedCommandCount,
    skippedCommandCount: commandEvaluation.skippedCommandCount,
    expectedRealRuntimeSkippedCount: 3,
    unexpectedSkippedCount: commandEvaluation.unexpectedSkippedCount,
    skippedClassifications: commandEvaluation.skipClassifications,
    testCounts: commandEvaluation.testCounts,
    testFloorFailures: commandEvaluation.floorFailures,
    commands: collected.map((item) => ({
      ordinal: item.ordinal,
      id: item.spec.id,
      category: item.spec.category,
      evidenceDirectory: item.relativeDirectory,
      status: item.result?.['status'] ?? 'SKIPPED',
      exitCode: item.result?.['exitCode'] ?? null,
      signal: item.result?.['signal'] ?? null,
      testCounts: item.testCounts,
    })),
    mutationCount: adversarialCounts.mutationCount,
    detectedCount: adversarialCounts.detectedCount,
    survivedCount: adversarialCounts.survivedCount,
    sourceManifestIdentity: {
      sourceFileCount: baseline.sourceManifestFileCount,
      sourceFilesDigest: baseline.sourceManifestDigest,
      manifestSha256: baseline.sourceManifestSha256,
      persistedBytesStable: persistedSourceManifestStable,
      rebuiltIdentityStable: sourceManifestIdentityStable,
    },
    runtimeAuthorityIdentity: {
      schemaVersion: baseline.runtimeAuthoritySchemaVersion,
      authorityId: baseline.runtimeAuthorityId,
      runtimeAuthoritySha256: baseline.runtimeAuthoritySha256,
      runtimeAuthoritySemanticDigest: baseline.runtimeAuthoritySemanticDigest,
      stable: runtimeAuthorityStable,
    },
    contractIdentity: baseline.contractIdentity,
    verificationAuthorityIdentity: {
      ...baseline.verificationAuthorityIdentity,
      stable: contractIdentityStable,
    },
    standaloneChecks,
    standaloneTeardownPassedCount:
      commandEvaluation.testCounts.standaloneTeardown?.testsPassed ?? 0,
    testcontainersSyntheticGuard: commandEvaluation.testCounts.testcontainersGuard ?? null,
    sourceTreeStable,
    worktreeClean,
    packageJsonStable,
    lockfileStable,
    contractIdentityStable,
    runtimeAuthorityStable,
    phase01CompletionTreeStable,
    orchestratorSha256: baseline.orchestratorSha256,
    orchestratorStable,
    originalPhase01CompletionTicketsModified: !phase01CompletionTreeStable,
    secretScan,
    sideEffectScan,
    architectureStopLineTriggered: passed ? false : null,
    failureCodes: uniqueFailures,
    status: passed ? 'PASSED' : 'FAILED',
    completedAt: new Date().toISOString(),
  };
  const summaryWrite = await modules.recorder.writeRedactedJsonArtifact(
    context.runDirectory,
    summaryName,
    summary,
  );
  await modules.recorder.writeRedactedTextArtifact(
    context.runDirectory,
    `${summaryName.replace(/\.json$/u, '')}.sha256`,
    `${summaryWrite.sha256}  ${summaryName}\n`,
  );
  if (!passed) {
    await writeFailure(
      modules.recorder,
      context.runDirectory,
      'finalize',
      'AR12_FINALIZATION_FAILED',
      { failureCodes: uniqueFailures, summaryName, summarySha256: summaryWrite.sha256 },
    );
    fail('AR12_FINALIZATION_FAILED');
  }
}

async function finalize(repositoryRoot: string, runDirectory: string): Promise<void> {
  try {
    await finalizeCore(repositoryRoot, runDirectory);
  } catch (error) {
    try {
      const run = await assertPhysicalDirectory(runDirectory, 'AR12_RUN_DIRECTORY_UNSAFE');
      const modules = await loadAuthorityModules(repositoryRoot);
      await writeFailure(modules.recorder, run, 'finalize', errorCode(error));
    } catch {
      // Preserve the primary failure if even the existing authority cannot record it.
    }
    throw error;
  }
}

async function recordRetainedWorkspace(
  repositoryRoot: string,
  runDirectory: string,
  receipt: Ar12RetainedWorkspaceReceipt,
): Promise<void> {
  const modules = await loadAuthorityModules(repositoryRoot);
  await modules.recorder.writeRedactedJsonArtifact(
    runDirectory,
    'execution-workspace-retention.json',
    receipt,
  );
}

async function recordSuccessfulWorkspace(
  repositoryRoot: string,
  runDirectory: string,
  receipt: Ar12SuccessfulWorkspaceReceipt,
): Promise<void> {
  const modules = await loadAuthorityModules(repositoryRoot);
  await modules.recorder.writeRedactedJsonArtifact(
    runDirectory,
    'execution-workspace-terminal.json',
    receipt,
  );
}

function defaultAr12ExternalExecutionWorkspaceDependencies():
Ar12ExternalExecutionWorkspaceDependencies {
  return {
    assertRepositoryNotContaminatedByExecutionWorkspace,
    preflightAr12RunOutput,
    validateHistoryEvidencePreflight: captureAr12HistoryEvidenceBaseline,
    createAr12ExecutionWorkspace,
    loadAr12ExecutionWorkspaceMarker,
    initialize,
    runCommands,
    finalize,
    verifyAr12ExecutionWorkspace,
    recordSuccessfulWorkspace,
    cleanupAr12ExecutionWorkspace,
    retainAr12ExecutionWorkspaceAfterFailure,
    recordRetainedWorkspace,
  };
}

export async function runAr12InExternalExecutionWorkspace(
  input: Ar12ExternalExecutionWorkspaceRunInput,
  dependencies: Ar12ExternalExecutionWorkspaceDependencies =
    defaultAr12ExternalExecutionWorkspaceDependencies(),
): Promise<Ar12ExternalExecutionWorkspaceRunResult> {
  if (!SHA_PATTERN.test(input.expectedCommit)) fail('AR12_EXPECTED_COMMIT_INVALID');
  if (input.expectedBranch.length === 0) fail('AR12_EXPECTED_BRANCH_INVALID');
  const sourceRepositoryRoot = resolve(input.sourceRepositoryRoot);
  const outputRoot = resolve(input.outputRoot);
  const runDirectory = resolve(input.runDirectory);
  const runIdentity = basename(runDirectory);
  const evidenceDirectories = [outputRoot, runDirectory];

  await dependencies.assertRepositoryNotContaminatedByExecutionWorkspace(
    sourceRepositoryRoot,
  );
  await dependencies.preflightAr12RunOutput(
    sourceRepositoryRoot,
    outputRoot,
    runDirectory,
  );
  await dependencies.validateHistoryEvidencePreflight(outputRoot, runDirectory);
  let created: CreatedAr12ExecutionWorkspace | undefined;
  let marker: Ar12ExecutionWorkspaceMarker | undefined;
  let evidenceDirectoryOwned = false;
  try {
    created = await dependencies.createAr12ExecutionWorkspace({
      repositoryRoot: sourceRepositoryRoot,
      runIdentity,
      runPurpose: 'AR-12_REBASELINE',
      targetBranch: input.expectedBranch,
      environment: input.environment ?? process.env,
      evidenceDirectories,
    });
    marker = await dependencies.loadAr12ExecutionWorkspaceMarker(created.workspacePath);
    if (
      !exactJsonEqual(marker, created.marker) ||
      marker.openingGitCommitSha !== input.expectedCommit ||
      marker.targetBranch !== input.expectedBranch
    ) fail('AR12_EXECUTION_WORKSPACE_IDENTITY_MISMATCH');

    await dependencies.initialize({
      repositoryRoot: created.workspacePath,
      sourceRepositoryRoot,
      outputRoot,
      runDirectory,
      expectedBranch: input.expectedBranch,
      expectedCommit: input.expectedCommit,
      runKind: input.runKind,
    });
    evidenceDirectoryOwned = true;
    await dependencies.runCommands(created.workspacePath, runDirectory, {
      contaminationRepositoryRoot: sourceRepositoryRoot,
    });
    await dependencies.finalize(created.workspacePath, runDirectory);
    const terminalIdentity = await dependencies.verifyAr12ExecutionWorkspace(
      created.workspacePath,
      marker,
    );
    const workspacePathDigest = sha256(created.resolved.canonicalWorkspacePath);
    await dependencies.recordSuccessfulWorkspace(sourceRepositoryRoot, runDirectory, {
      schemaVersion: 'phase-01.ar-12-workspace-terminal.v1',
      status: 'VERIFIED_FOR_CLEANUP',
      workspacePathDigest,
      terminalIdentity,
      cleanupStatus: 'PENDING',
    });
    await dependencies.cleanupAr12ExecutionWorkspace(created.workspacePath, marker, {
      repositoryRoot: sourceRepositoryRoot,
      evidenceDirectories,
    });
    return {
      status: 'PASSED',
      workspacePathDigest,
      terminalIdentity,
      cleanupStatus: 'CLEANED',
      runDirectory,
    };
  } catch (error) {
    if (created === undefined) {
      if (!(error instanceof Ar12ExecutionWorkspaceCreationError)) throw error;
      const outputOnlyReceipt: Ar12PartialCreationReceipt = {
        schemaVersion: 'phase-01.ar-12-partial-creation.v1',
        status: error.partialRetained ? 'PARTIAL_RETAINED' : 'NO_PARTIAL_RETAINED',
        failureCode: error.failureCode,
        failureStage: error.failureStage,
        workspacePathDigest: error.workspacePathDigest,
        partialRetained: error.partialRetained,
        terminalIdentity: error.terminalIdentity === null ? null : {
          gitCommitSha: error.terminalIdentity.gitCommitSha,
          branch: error.terminalIdentity.branch,
          worktreeState: error.terminalIdentity.worktreeState,
        },
        identityUnavailable: error.terminalIdentity === null,
        identityFailureCode: error.identityFailureCode,
        evidenceRecordStatus: 'OUTPUT_ONLY',
      };
      throw new Ar12ExternalExecutionWorkspaceRunError({
        code: error.code,
        cause: new Error(error.code),
        partialCreation: outputOnlyReceipt,
      });
    }
    const failureCode = errorCode(error);
    const workspacePathDigest = sha256(created.resolved.canonicalWorkspacePath);
    try {
      const retained = await dependencies.retainAr12ExecutionWorkspaceAfterFailure(
        created.workspacePath,
        marker ?? created.marker,
      );
      const recordedReceipt: Ar12RetainedWorkspaceReceipt = {
        schemaVersion: 'phase-01.ar-12-retained-workspace.v1',
        status: 'RETAINED',
        failureCode,
        workspacePathDigest,
        terminalIdentity: retained.terminalIdentity,
        evidenceRecordStatus: evidenceDirectoryOwned ? 'RECORDED' : 'OUTPUT_ONLY',
      };
      if (!evidenceDirectoryOwned) {
        throw new Ar12ExternalExecutionWorkspaceRunError({
          code: failureCode,
          cause: error,
          retainedWorkspace: recordedReceipt,
        });
      }
      try {
        await dependencies.recordRetainedWorkspace(
          sourceRepositoryRoot,
          runDirectory,
          recordedReceipt,
        );
        throw new Ar12ExternalExecutionWorkspaceRunError({
          code: failureCode,
          cause: error,
          retainedWorkspace: recordedReceipt,
        });
      } catch (recordError) {
        if (recordError instanceof Ar12ExternalExecutionWorkspaceRunError) throw recordError;
        throw new Ar12ExternalExecutionWorkspaceRunError({
          code: failureCode,
          cause: error,
          retainedWorkspace: {
            ...recordedReceipt,
            evidenceRecordStatus: 'OUTPUT_ONLY',
          },
          retentionFailureCode: errorCode(recordError),
        });
      }
    } catch (retentionError) {
      if (retentionError instanceof Ar12ExternalExecutionWorkspaceRunError) throw retentionError;
      throw new Ar12ExternalExecutionWorkspaceRunError({
        code: failureCode,
        cause: error,
        retentionFailureCode: errorCode(retentionError),
      });
    }
  }
}

interface ParsedCli {
  readonly mode: 'execute-in-workspace' | 'init' | 'run-commands' | 'finalize';
  readonly options: ReadonlyMap<string, string>;
}

export interface Ar12OrchestratorCliDependencies {
  runAr12InExternalExecutionWorkspace(
    input: Ar12ExternalExecutionWorkspaceRunInput,
  ): Promise<Ar12ExternalExecutionWorkspaceRunResult>;
  initialize(input: Ar12InitializeInput): Promise<void>;
  runCommands(
    repositoryRoot: string,
    runDirectory: string,
    options: Ar12RunCommandsOptions,
  ): Promise<void>;
  finalize(repositoryRoot: string, runDirectory: string): Promise<void>;
  repositoryContainsExecutionWorkspaceMarker(repositoryRoot: string): Promise<boolean>;
  loadAr12ExecutionWorkspaceMarker(repositoryRoot: string): Promise<Ar12ExecutionWorkspaceMarker>;
}

async function repositoryContainsExecutionWorkspaceMarker(
  repositoryRoot: string,
): Promise<boolean> {
  try {
    await lstat(join(resolve(repositoryRoot), AR12_EXECUTION_WORKSPACE_MARKER));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function defaultAr12OrchestratorCliDependencies(): Ar12OrchestratorCliDependencies {
  return {
    runAr12InExternalExecutionWorkspace,
    initialize,
    runCommands,
    finalize,
    repositoryContainsExecutionWorkspaceMarker,
    loadAr12ExecutionWorkspaceMarker,
  };
}

export function parseAr12CliArguments(args: readonly string[]): ParsedCli {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    process.stdout.write([
      'Usage:',
      '  npm run rebaseline:ar-12 -- --source-repository-root <path> --output-root <path> --run-dir <path> --expected-branch <branch> --expected-commit <sha> --run-kind <initial|final>',
      '',
      'Recovery-only low-level modes:',
      '  npm run rebaseline:ar-12:recovery -- init --repository-root <external-clone> --source-repository-root <source> --output-root <path> --run-dir <path> --expected-branch <branch> --expected-commit <sha> --run-kind <initial|final>',
      '  npm run rebaseline:ar-12:recovery -- run-commands --repository-root <external-clone> --source-repository-root <source> --run-dir <path>',
      '  npm run rebaseline:ar-12:recovery -- finalize --repository-root <external-clone> --run-dir <path>',
      '',
    ].join('\n'));
    process.exitCode = 0;
    throw new Error('AR12_HELP_PRINTED');
  }
  const mode = args[0];
  if (mode === undefined || !MODES.has(mode)) fail('AR12_MODE_INVALID');
  const options = new Map<string, string>();
  const aliases: Readonly<Record<string, string>> = {
    '--run-directory': '--run-dir',
    '--kind': '--run-kind',
    '--phase': '--run-kind',
  };
  const allowed = new Set([
    '--source-repository-root',
    '--repository-root',
    '--output-root',
    '--run-dir',
    '--expected-branch',
    '--expected-commit',
    '--run-kind',
  ]);
  for (let index = 1; index < args.length; index += 2) {
    const rawName = args[index];
    const value = args[index + 1];
    if (rawName === undefined || value === undefined || !rawName.startsWith('--')) {
      fail('AR12_ARGUMENTS_INVALID');
    }
    const name = aliases[rawName] ?? rawName;
    if (!allowed.has(name) || options.has(name) || value.length === 0 || value.startsWith('--')) {
      fail('AR12_ARGUMENTS_INVALID');
    }
    options.set(name, value);
  }
  return { mode: mode as ParsedCli['mode'], options };
}

function requiredOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined) fail('AR12_REQUIRED_ARGUMENT_MISSING');
  return value;
}

export async function runAr12OrchestratorCli(
  args: readonly string[] = process.argv.slice(2),
  dependencyOverrides: Partial<Ar12OrchestratorCliDependencies> = {},
): Promise<void> {
  const dependencies = {
    ...defaultAr12OrchestratorCliDependencies(),
    ...dependencyOverrides,
  };
  let parsed: ParsedCli;
  try {
    parsed = parseAr12CliArguments(args);
  } catch (error) {
    if (error instanceof Error && error.message === 'AR12_HELP_PRINTED') return;
    throw error;
  }
  const runDirectory = requiredOption(parsed.options, '--run-dir');
  if (parsed.mode === 'execute-in-workspace') {
    const runKind = requiredOption(parsed.options, '--run-kind');
    if (runKind !== 'initial' && runKind !== 'final') fail('AR12_RUN_KIND_INVALID');
    const result = await dependencies.runAr12InExternalExecutionWorkspace({
      sourceRepositoryRoot: requiredOption(parsed.options, '--source-repository-root'),
      outputRoot: requiredOption(parsed.options, '--output-root'),
      runDirectory,
      expectedBranch: requiredOption(parsed.options, '--expected-branch'),
      expectedCommit: requiredOption(parsed.options, '--expected-commit'),
      runKind,
      environment: process.env,
    });
    process.stdout.write(JSON.stringify({
      mode: parsed.mode,
      ...result,
    }) + '\n');
    return;
  }
  const repositoryRoot = requiredOption(parsed.options, '--repository-root');
  const hasExecutionMarker = await dependencies.repositoryContainsExecutionWorkspaceMarker(
    repositoryRoot,
  );
  if (!hasExecutionMarker) fail('AR12_RECOVERY_EXECUTION_WORKSPACE_MARKER_REQUIRED');
  await dependencies.loadAr12ExecutionWorkspaceMarker(repositoryRoot);
  if (parsed.mode === 'init') {
    const runKind = requiredOption(parsed.options, '--run-kind');
    if (runKind !== 'initial' && runKind !== 'final') fail('AR12_RUN_KIND_INVALID');
    await dependencies.initialize({
      repositoryRoot,
      sourceRepositoryRoot: requiredOption(parsed.options, '--source-repository-root'),
      outputRoot: requiredOption(parsed.options, '--output-root'),
      runDirectory,
      expectedBranch: requiredOption(parsed.options, '--expected-branch'),
      expectedCommit: requiredOption(parsed.options, '--expected-commit'),
      runKind,
    });
  } else if (parsed.mode === 'run-commands') {
    const sourceRepositoryRoot = parsed.options.get('--source-repository-root');
    if (sourceRepositoryRoot === undefined) fail('AR12_SOURCE_REPOSITORY_ROOT_REQUIRED');
    await dependencies.runCommands(repositoryRoot, runDirectory, {
      contaminationRepositoryRoot: sourceRepositoryRoot,
    });
  } else {
    await dependencies.finalize(repositoryRoot, runDirectory);
  }
  process.stdout.write(JSON.stringify({
    status: 'PASSED',
    mode: parsed.mode,
    runDirectory: resolve(runDirectory),
  }) + '\n');
}

export function isAr12OrchestratorDirectInvocation(
  invokedPath: string | undefined = process.argv[1],
  moduleUrl: string = import.meta.url,
): boolean {
  return invokedPath !== undefined && samePath(invokedPath, fileURLToPath(moduleUrl));
}

export function ar12CliFailurePayload(error: unknown): Readonly<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    status: 'FAILED',
    code: errorCode(error),
  };
  if (error instanceof Ar12ExternalExecutionWorkspaceRunError) {
    if (error.retainedWorkspace !== undefined) {
      payload['retainedWorkspace'] = error.retainedWorkspace;
    }
    if (error.partialCreation !== undefined) {
      payload['partialCreation'] = error.partialCreation;
    }
    if (error.retentionFailureCode !== undefined) {
      payload['retentionFailureCode'] = error.retentionFailureCode;
    }
  }
  return payload;
}

if (isAr12OrchestratorDirectInvocation()) {
  try {
    await runAr12OrchestratorCli();
  } catch (error) {
    process.stderr.write(JSON.stringify(ar12CliFailurePayload(error)) + '\n');
    process.exitCode = 1;
  }
}
