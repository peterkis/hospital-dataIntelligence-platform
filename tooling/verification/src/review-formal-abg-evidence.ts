import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  realpath,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';
import { ABG_GATES } from './abg-catalog.js';
import { getAbgProducerProtocolIdentityDigest } from './abg-gate-proof.js';
import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  validateAbgCoverageMatrix,
  type AbgCoverageMatrixEntry,
  type AbgFrozenInputKind,
  type AbgProducerId,
} from './abg-coverage-matrix.js';
import {
  PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
} from './evidence/protocol.js';
import {
  createFormalRunSeed,
  FORMAL_REQUIRED_SECRET_NAMES,
  formalRuntimeAuthority,
  formalRuntimePorts,
} from './runtime/formal-runtime-contract.js';
import {
  canonicalRuntimeAuthorityJson,
  parseFormalRuntimeAuthoritySnapshot,
  parsePodmanRuntimeAuthority,
  RUNTIME_AUTHORITY_RELATIVE_PATH,
} from './runtime/podman-runtime-authority.js';
import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  EVIDENCE_MANIFEST_SCHEMA_VERSION,
  GATE_RESULT_SCHEMA_VERSION,
  REVIEW_FINDINGS_SCHEMA_VERSION,
  REVIEW_MANIFEST_SCHEMA_VERSION,
  REVIEW_SCHEMA_VERSION,
  REVIEWER_TOOL_SCHEMA_VERSION,
  RUN_PLAN_AUTHORITY_ID,
  RUN_PLAN_SCHEMA_VERSION,
  RUN_SUMMARY_SCHEMA_VERSION,
  RUNTIME_OUTCOME_SCHEMA_VERSION,
  TERMINAL_CONCLUSION_SCHEMA_VERSION,
  type EvidenceContractIdentity,
} from './verification-contract-versions.js';
import {
  assessReviewerCompatibility,
  type EvidenceContractTuple,
} from './provenance/reviewer-compatibility.js';
import {
  canonicalVerificationSourceManifestBytes,
  createSourceManifestBuilder,
  defaultSourceManifestDependencies,
  sourceManifestSha256,
  type GitObjectReader,
  type RepositoryStateReader,
  type SourceManifestBuilder,
  type WorkspaceSourceReader,
} from './provenance/source-manifest.js';
import {
  parseVerificationSourceManifest,
  type ProducerVerificationSourceManifest,
  type ReviewerVerificationSourceManifest,
} from './provenance/source-manifest-schema.js';

const CONCLUSION_SCOPE =
  'Phase 01 POC executable architecture baseline only; not full POC or production readiness.';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const LOCAL_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u;
const SENSITIVE_KEY_PATTERN =
  /(?:access[_-]?token|refresh[_-]?token|id[_-]?token|password|client[_-]?secret|authorization|cookie)/iu;
const SENSITIVE_VALUE_PATTERNS = [
  /(?:^|\s)bearer\s+[A-Za-z0-9._~+/-]+/iu,
  /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password)\s*[=:]/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u,
] as const;
const repositoryRoot = resolve(import.meta.dirname, '../../..');

const HELP = `Usage:
  npm run verify:phase-01:evidence -- \\
    --evidence-dir <directory> \\
    --review-output-dir <directory>

Reviews an existing formal Phase 01 ABG evidence package without starting the
application, PostgreSQL, Keycloak, a browser, or any network client.
`;

export interface ReviewFormalAbgEvidenceInput {
  readonly evidenceDirectory: string;
  readonly reviewOutputDirectory: string;
  /** Test seam for proving that concurrent source mutation fails closed. */
  readonly beforeFinalSourceIdentityCapture?: () => Promise<void>;
  /** Public test seam for Git/worktree/source identity without host-state coupling. */
  readonly dependencies?: ReviewFormalAbgEvidenceDependencies;
}

export interface ReviewFormalAbgEvidenceDependencies {
  readonly repositoryRoot: string;
  readonly git: GitObjectReader;
  readonly repository: RepositoryStateReader;
  readonly workspace: WorkspaceSourceReader;
  readonly clock: () => string;
  readonly sourceManifestBuilder?: SourceManifestBuilder;
}

export interface ReviewFinding {
  readonly code: string;
  readonly severity: 'ERROR';
  readonly location?: string;
}

export interface ReviewerToolIdentity {
  readonly toolId: 'phase-01.formal-abg-evidence-reviewer';
  readonly schemaVersion: typeof REVIEWER_TOOL_SCHEMA_VERSION;
  readonly sourceSha256: string;
  readonly gateResultSchemaVersion: typeof GATE_RESULT_SCHEMA_VERSION;
  readonly producerEvidenceSchemaVersion: typeof PRODUCER_EVIDENCE_SCHEMA_VERSION;
  readonly producerEvidenceIndexSchemaVersion: typeof PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION;
}

export interface FormalAbgEvidenceReview {
  readonly schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  readonly sourceEvidenceDirectory: string;
  readonly sourceManifestSha256: string | null;
  readonly sourceEvidenceDigestBefore: string;
  readonly sourceEvidenceDigestAfter: string;
  readonly producerGitCommitSha: string | null;
  readonly producerSourceManifestSha256: string | null;
  readonly reviewerGitCommitSha: string | null;
  readonly reviewerSourceManifestSha256: string | null;
  readonly evidenceContractIdentity: EvidenceContractTuple | null;
  readonly reviewerSupportedContractIdentity: EvidenceContractIdentity;
  readonly evidenceIntegrityStatus: 'PASSED' | 'FAILED';
  readonly producerProvenanceStatus: 'VERIFIED' | 'INVALID' | 'UNVERIFIABLE';
  readonly reviewerContractStatus: 'EXACT' | 'COMPATIBLE' | 'INCOMPATIBLE';
  readonly definitionDriftStatus: 'NONE' | 'DRIFTED' | 'UNRESOLVED';
  readonly reviewerWorktreeStatus: 'CLEAN' | 'DIRTY' | 'UNAVAILABLE';
  readonly reviewStatus: 'PASSED' | 'FAILED';
  readonly terminalConclusionSchemaVersion: string | null;
  readonly runtimeOutcomeSchemaVersion: string | null;
  readonly reviewedAt: string;
  readonly reviewerToolIdentity: ReviewerToolIdentity;
  readonly coverageMatrixDigest: string;
  readonly status: 'PASSED' | 'FAILED';
  readonly checkCount: number;
  readonly passedCheckCount: number;
  readonly failedCheckCount: number;
  readonly findingsDigest: string;
}

interface CliArguments {
  readonly evidenceDirectory: string;
  readonly reviewOutputDirectory: string;
}

interface FileRecord {
  readonly absolutePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface SnapshotFileIdentity {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface EvidenceSnapshot {
  readonly root: string;
  readonly files: ReadonlyMap<string, FileRecord>;
  readonly directories: ReadonlySet<string>;
}

interface ManifestEntry {
  readonly path: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface ManifestState {
  readonly entries: ReadonlyMap<string, ManifestEntry>;
  readonly sourceManifestSha256: string | null;
}

interface ProducerSourceManifestState {
  readonly manifest: ProducerVerificationSourceManifest | null;
  readonly sha256: string | null;
}

interface ProducerProvenanceVerification {
  readonly status: 'VERIFIED' | 'INVALID' | 'UNVERIFIABLE';
  readonly verifiedSourceBytes: ReadonlyMap<string, Buffer>;
}

interface ContractExtractionState {
  readonly identity: EvidenceContractTuple | null;
  readonly terminalConclusionSchemaVersion: string | null;
  readonly runtimeOutcomeSchemaVersion: string | null;
  readonly complete: boolean;
}

interface ReviewerSourceCapture {
  readonly manifest: ReviewerVerificationSourceManifest | null;
  readonly sha256: string | null;
  readonly gitCommitSha: string | null;
  readonly worktreeStatus: 'CLEAN' | 'DIRTY' | 'UNAVAILABLE';
}

interface CurrentAuthorityIdentity {
  readonly coverageMatrixDigest: string;
  readonly coverageMatrixSourceSha256: string;
  readonly producerProtocolIdentityDigest: string;
  readonly producerProtocolSourceSha256: string;
  readonly gateProofSourceSha256: string;
}

interface PlanState {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly planDigest: string;
  readonly runSequence: number | null;
  readonly frozenInputs: Readonly<Record<string, unknown>> | null;
  readonly authorityIdentity: Readonly<Record<string, unknown>> | null;
  readonly setupCommands: readonly Readonly<Record<string, unknown>>[];
  readonly gateCommands: readonly Readonly<Record<string, unknown>>[];
}

interface SummaryState {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly runId: string | null;
  readonly runSequence: number | null;
}

interface ProducerIndexEntryState {
  readonly producerId: AbgProducerId;
  readonly resolvedRelativePath: string;
  readonly sha256: string;
  readonly status: string;
  readonly scenarioCount: number;
  readonly assertionCount: number;
}

interface ProducerIndexState {
  readonly digest: string;
  readonly entries: ReadonlyMap<AbgProducerId, ProducerIndexEntryState>;
}

interface ProducerEvidenceState {
  readonly raw: Readonly<Record<string, unknown>>;
  readonly producerId: AbgProducerId | null;
  readonly frozenInputRefs: Readonly<Record<string, unknown>>;
  readonly scenarios: Readonly<Record<string, unknown>>;
  readonly scenarioCount: number;
  readonly assertionCount: number;
  readonly status: string | null;
}

interface SelectedClaimState {
  readonly evidence: ProducerEvidenceState;
  readonly scenario: Readonly<Record<string, unknown>>;
}

class ReviewChecks {
  private total = 0;
  private readonly failures: ReviewFinding[] = [];

  check(condition: boolean, code: string, location?: string): boolean {
    this.total += 1;
    if (!condition) {
      this.failures.push({
        code,
        severity: 'ERROR',
        ...(location === undefined ? {} : { location }),
      });
    }
    return condition;
  }

  fail(code: string, location?: string): void {
    this.check(false, code, location);
  }

  get checkCount(): number {
    return this.total;
  }

  get findings(): readonly ReviewFinding[] {
    return this.failures;
  }
}

export async function reviewFormalAbgEvidence(
  input: ReviewFormalAbgEvidenceInput,
): Promise<FormalAbgEvidenceReview> {
  const sourceDirectory = resolve(input.evidenceDirectory);
  const outputDirectory = resolve(input.reviewOutputDirectory);
  const dependencies = input.dependencies ?? defaultReviewDependencies();
  const checks = new ReviewChecks();

  const sourceEvidenceDigestBefore = await captureTreeIdentity(sourceDirectory);
  const snapshot = await scanEvidenceDirectory(sourceDirectory, checks);
  await validateEvidenceSecretLeaks(snapshot, checks);
  const manifest = await validateManifest(snapshot, checks);
  validateRequiredLifecycleEnvelope(snapshot, manifest, checks);
  const producer = await validateProducerSourceManifest(snapshot, manifest, checks);
  const contract = await extractEvidenceContractIdentity(snapshot, manifest, checks);
  const producerProvenance = await verifyProducerProvenance(
    producer.manifest,
    dependencies,
    checks,
  );
  let producerProvenanceStatus = producerProvenance.status;

  const currentIdentity = await readCurrentAuthorityIdentity();
  const reviewerToolIdentity = await readReviewerToolIdentity();
  validateCurrentDefinitions(currentIdentity, checks);
  const reviewerCapture = await captureReviewerSourceManifest(dependencies, checks);

  if (
    producer.manifest !== null &&
    reviewerCapture.manifest !== null &&
    producer.manifest.repositoryFullName !== reviewerCapture.manifest.repositoryFullName
  ) {
    checks.fail('PRODUCER_REPOSITORY_IDENTITY_MISMATCH', 'repositoryFullName');
    producerProvenanceStatus = 'INVALID';
  }
  const drift = compareSourceDefinitions(
    producer.manifest,
    reviewerCapture.manifest,
    checks,
  );
  const compatibility = contract.identity === null
    ? {
        compatibilityLevel: 'INCOMPATIBLE' as const,
      }
    : assessReviewerCompatibility({
      evidenceContractIdentity: contract.identity,
        definitionsMatch: drift === 'NONE',
      });
  if (compatibility.compatibilityLevel === 'INCOMPATIBLE') {
    checks.fail('REVIEWER_CONTRACT_VERSION_UNKNOWN', 'evidence-contract');
    checks.fail('REVIEWER_CONTRACT_INCOMPATIBLE', 'evidence-contract');
  } else if (compatibility.compatibilityLevel === 'COMPATIBLE') {
    checks.fail('REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED', 'evidence-contract');
  }

  await validateProducerSourceManifestReferences(snapshot, producer, contract, checks);
  await validateRuntimeAuthorityProducerBinding(
    snapshot,
    producer,
    producerProvenance,
    checks,
  );
  if (compatibility.compatibilityLevel === 'EXACT') {
    const plan = await validateRunPlan(snapshot, manifest, currentIdentity, checks);
    const summary = await validateRunSummary(
      snapshot,
      manifest,
      plan,
      currentIdentity,
      checks,
    );
    if (summary !== null) {
      await validateFormalLifecycle(snapshot, manifest, summary, checks);
      await validateTopLevelRunIdentities(snapshot, manifest, summary, checks);
    }
  }

  await input.beforeFinalSourceIdentityCapture?.();
  const sourceEvidenceDigestAfter = await captureTreeIdentity(sourceDirectory);
  checks.check(
    sourceEvidenceDigestBefore === sourceEvidenceDigestAfter,
    'SOURCE_EVIDENCE_CHANGED_DURING_REVIEW',
    '.',
  );
  const reviewerCaptureAfter = await captureReviewerSourceManifest(dependencies, checks);
  const reviewerStability = validateReviewerCaptureStable(
    reviewerCapture,
    reviewerCaptureAfter,
    checks,
  );
  await prepareExclusiveOutputDirectory(sourceDirectory, outputDirectory);

  const reviewerWorktreeStatus = combineReviewerWorktreeStatus(
    reviewerCapture.worktreeStatus,
    reviewerCaptureAfter.worktreeStatus,
  );
  const definitionDriftStatus = producerProvenanceStatus === 'VERIFIED' &&
      reviewerStability.sourceDefinitionsStable
    ? drift
    : 'UNRESOLVED';
  const reviewerContractStatus = compatibility.compatibilityLevel === 'EXACT' &&
      !reviewerStability.sourceDefinitionsStable
    ? 'COMPATIBLE'
    : compatibility.compatibilityLevel;
  if (reviewerContractStatus !== 'EXACT') {
    checks.fail('REVIEWER_CONTRACT_EXACT_MATCH_REQUIRED', 'evidence-contract');
  }
  const findings = [...checks.findings];
  const findingsDigest = digestJson(findings);
  const failedCheckCount = findings.length;
  const evidenceIntegrityStatus = findings.some((finding) =>
    isEvidenceIntegrityFinding(finding.code, drift === 'DRIFTED'))
    ? 'FAILED'
    : 'PASSED';
  const reviewPassed = failedCheckCount === 0 &&
    evidenceIntegrityStatus === 'PASSED' &&
    producerProvenanceStatus === 'VERIFIED' &&
    reviewerContractStatus === 'EXACT' &&
    definitionDriftStatus === 'NONE' &&
    reviewerWorktreeStatus === 'CLEAN' &&
    sourceEvidenceDigestBefore === sourceEvidenceDigestAfter;
  const review: FormalAbgEvidenceReview = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourceEvidenceDirectory: sourceDirectory,
    sourceManifestSha256: manifest.sourceManifestSha256,
    sourceEvidenceDigestBefore,
    sourceEvidenceDigestAfter,
    producerGitCommitSha: producer.manifest?.producerGitCommitSha ?? null,
    producerSourceManifestSha256: producer.sha256,
    reviewerGitCommitSha: reviewerCapture.manifest?.reviewerGitCommitSha ??
      reviewerCapture.gitCommitSha,
    reviewerSourceManifestSha256: reviewerCapture.sha256,
    evidenceContractIdentity: contract.identity,
    reviewerSupportedContractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    evidenceIntegrityStatus,
    producerProvenanceStatus,
    reviewerContractStatus,
    definitionDriftStatus,
    reviewerWorktreeStatus,
    reviewStatus: reviewPassed ? 'PASSED' : 'FAILED',
    terminalConclusionSchemaVersion: contract.terminalConclusionSchemaVersion,
    runtimeOutcomeSchemaVersion: contract.runtimeOutcomeSchemaVersion,
    reviewedAt: dependencies.clock(),
    reviewerToolIdentity,
    coverageMatrixDigest: currentIdentity.coverageMatrixDigest,
    status: reviewPassed ? 'PASSED' : 'FAILED',
    checkCount: checks.checkCount,
    passedCheckCount: checks.checkCount - failedCheckCount,
    failedCheckCount,
    findingsDigest,
  };
  await writeReviewOutputs(
    outputDirectory,
    review,
    findings,
    reviewerCapture.manifest,
  );
  return review;
}

function defaultReviewDependencies(): ReviewFormalAbgEvidenceDependencies {
  const sourceDependencies = defaultSourceManifestDependencies();
  return {
    repositoryRoot,
    ...sourceDependencies,
    sourceManifestBuilder: createSourceManifestBuilder(sourceDependencies),
  };
}

function validateRequiredLifecycleEnvelope(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  checks: ReviewChecks,
): void {
  for (const [path, code] of [
    ['runtime/preflight.json', 'FORMAL_LIFECYCLE_PREFLIGHT_MISSING'],
    ['runtime/runtime-authority-snapshot.json', 'FORMAL_LIFECYCLE_RUNTIME_AUTHORITY_SNAPSHOT_MISSING'],
    ['runtime/resources-started.json', 'FORMAL_LIFECYCLE_RESOURCES_STARTED_MISSING'],
    ['runtime/producer-evidence-snapshot.json', 'FORMAL_LIFECYCLE_PRODUCER_EVIDENCE_SNAPSHOT_MISSING'],
    ['runtime/failure-summary.json', 'FORMAL_LIFECYCLE_FAILURE_SUMMARY_MISSING'],
    ['runtime/resources-final.json', 'FORMAL_LIFECYCLE_RESOURCES_FINAL_MISSING'],
    ['runtime/cleanup.json', 'FORMAL_LIFECYCLE_CLEANUP_MISSING'],
    ['runtime/terminal-conclusion.json', 'FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING'],
    ['runtime/final-outcome.json', 'FORMAL_LIFECYCLE_FINAL_OUTCOME_MISSING'],
  ] as const) {
    if (!snapshot.files.has(path) || !manifest.entries.has(path)) checks.fail(code, path);
  }
}

async function captureReviewerSourceManifest(
  dependencies: ReviewFormalAbgEvidenceDependencies,
  checks: ReviewChecks,
): Promise<ReviewerSourceCapture> {
  let gitCommitSha: string | null = null;
  let worktreeStatus: ReviewerSourceCapture['worktreeStatus'] = 'UNAVAILABLE';
  try {
    const state = await dependencies.repository.readState(dependencies.repositoryRoot);
    gitCommitSha = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(state.gitCommitSha)
      ? state.gitCommitSha
      : null;
    if (gitCommitSha === null) {
      checks.fail('REVIEWER_GIT_COMMIT_UNAVAILABLE', 'reviewer-repository');
    }
    worktreeStatus = state.worktreeStatus;
    if (state.worktreeStatus === 'DIRTY') {
      checks.fail('REVIEWER_WORKTREE_DIRTY', 'reviewer-repository');
    } else if (state.worktreeStatus === 'UNAVAILABLE') {
      checks.fail('REVIEWER_GIT_COMMIT_UNAVAILABLE', 'reviewer-repository');
    }
  } catch {
    checks.fail('REVIEWER_GIT_COMMIT_UNAVAILABLE', 'reviewer-repository');
  }
  let built: ReviewerVerificationSourceManifest;
  try {
    const builder = dependencies.sourceManifestBuilder ?? createSourceManifestBuilder({
      git: dependencies.git,
      repository: dependencies.repository,
      workspace: dependencies.workspace,
      clock: dependencies.clock,
    });
    built = await builder.buildReviewer(dependencies.repositoryRoot);
  } catch {
    checks.fail('REVIEWER_SOURCE_MANIFEST_GENERATION_FAILED', 'reviewer-source-manifest');
    return { manifest: null, sha256: null, gitCommitSha, worktreeStatus };
  }
  try {
    const digest = sourceManifestSha256(built);
    return {
      manifest: built,
      sha256: digest,
      gitCommitSha: built.reviewerGitCommitSha,
      worktreeStatus: built.reviewerWorktreeState,
    };
  } catch {
    checks.fail('REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH', 'reviewer-source-manifest');
    return { manifest: null, sha256: null, gitCommitSha, worktreeStatus };
  }
}

function validateReviewerCaptureStable(
  before: ReviewerSourceCapture,
  after: ReviewerSourceCapture,
  checks: ReviewChecks,
): {
  readonly repositoryStateStable: boolean;
  readonly sourceDefinitionsStable: boolean;
} {
  const repositoryStateStable = before.gitCommitSha === after.gitCommitSha &&
    before.worktreeStatus === after.worktreeStatus &&
    before.manifest !== null &&
    after.manifest !== null &&
    before.manifest.repositoryFullName === after.manifest.repositoryFullName &&
    before.manifest.reviewerGitCommitSha === after.manifest.reviewerGitCommitSha &&
    before.manifest.reviewerBranch === after.manifest.reviewerBranch &&
    before.manifest.reviewerWorktreeState === after.manifest.reviewerWorktreeState;
  if (!repositoryStateStable) {
    checks.fail(
      'REVIEWER_REPOSITORY_STATE_CHANGED_DURING_REVIEW',
      'reviewer-repository',
    );
  }
  const sourceDefinitionsStable = before.manifest !== null &&
    after.manifest !== null &&
    jsonEqual(
      reviewerDefinitionStableIdentity(before.manifest),
      reviewerDefinitionStableIdentity(after.manifest),
    );
  if (!sourceDefinitionsStable) {
    checks.fail('REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH', 'reviewer-source-manifest');
    const changedPaths = changedReviewerSourcePaths(before.manifest, after.manifest);
    if (changedPaths.length > 0) {
      checks.fail('REVIEWER_TOOL_DEFINITION_DRIFT', changedPaths.join(','));
    }
  }
  return { repositoryStateStable, sourceDefinitionsStable };
}

function reviewerDefinitionStableIdentity(
  manifest: ReviewerVerificationSourceManifest,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: manifest.schemaVersion,
    manifestRole: manifest.manifestRole,
    reviewerContractIdentity: manifest.reviewerContractIdentity,
    sourceFiles: manifest.sourceFiles,
    sourceFileCount: manifest.sourceFileCount,
    sourceFilesDigest: manifest.sourceFilesDigest,
  };
}

function changedReviewerSourcePaths(
  before: ReviewerVerificationSourceManifest | null,
  after: ReviewerVerificationSourceManifest | null,
): readonly string[] {
  if (before === null || after === null) return [];
  const beforeEntries = new Map(before.sourceFiles.map((entry) => [entry.path, entry]));
  const afterEntries = new Map(after.sourceFiles.map((entry) => [entry.path, entry]));
  return [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])]
    .filter((path) => {
      const left = beforeEntries.get(path);
      const right = afterEntries.get(path);
      return left === undefined || right === undefined ||
        left.role !== right.role || left.sha256 !== right.sha256;
    })
    .sort((left, right) => left.localeCompare(right));
}

function combineReviewerWorktreeStatus(
  before: ReviewerSourceCapture['worktreeStatus'],
  after: ReviewerSourceCapture['worktreeStatus'],
): ReviewerSourceCapture['worktreeStatus'] {
  if (before === 'DIRTY' || after === 'DIRTY') return 'DIRTY';
  return before === 'CLEAN' && after === 'CLEAN' ? 'CLEAN' : 'UNAVAILABLE';
}

async function validateProducerSourceManifest(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  checks: ReviewChecks,
): Promise<ProducerSourceManifestState> {
  const path = 'provenance/producer-source-manifest.json';
  const sidecarPath = 'provenance/producer-source-manifest.sha256';
  checks.check(manifest.entries.has(path), 'PRODUCER_SOURCE_MANIFEST_MISSING', path);
  checks.check(
    manifest.entries.has(sidecarPath),
    'PRODUCER_SOURCE_MANIFEST_SHA256_MISSING',
    sidecarPath,
  );
  const bytes = await readSnapshotBytes(snapshot, path, checks, 'PRODUCER_SOURCE_MANIFEST_MISSING');
  const sidecar = await readSnapshotBytes(
    snapshot,
    sidecarPath,
    checks,
    'PRODUCER_SOURCE_MANIFEST_SHA256_MISSING',
  );
  const digest = bytes === null ? null : sha256(bytes);
  if (sidecar !== null && digest !== null) {
    const match = /^([0-9a-f]{64})  producer-source-manifest\.json\r?\n$/u.exec(
      sidecar.toString('utf8'),
    );
    checks.check(
      match !== null && match[1] === digest,
      'PRODUCER_SOURCE_MANIFEST_SHA256_MISMATCH',
      sidecarPath,
    );
  }
  if (bytes === null) return { manifest: null, sha256: digest };
  let parsed: ProducerVerificationSourceManifest | null = null;
  try {
    const raw = JSON.parse(bytes.toString('utf8')) as unknown;
    const rawRecord = asRecord(raw);
    if (rawRecord !== null && rawRecord['producerWorktreeState'] !== 'CLEAN') {
      checks.fail(
        'PRODUCER_WORKTREE_NOT_CLEAN_AT_PRODUCTION',
        path + '#/producerWorktreeState',
      );
    }
    const candidate = parseVerificationSourceManifest(raw);
    if (candidate.manifestRole !== 'PRODUCER') {
      checks.fail('PRODUCER_SOURCE_MANIFEST_SCHEMA_UNSUPPORTED', path);
    } else {
      parsed = candidate;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const code = /^[A-Z0-9_]+/u.exec(message)?.[0] ?? '';
    const supported = new Set([
      'PRODUCER_SOURCE_MANIFEST_SCHEMA_UNSUPPORTED',
      'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE',
      'PRODUCER_SOURCE_MANIFEST_ENTRY_DUPLICATE',
      'PRODUCER_SOURCE_MANIFEST_ORDER_INVALID',
      'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH',
      'PRODUCER_COMMIT_INVALID',
    ]);
    const mapped = code === 'PRODUCER_SOURCE_MANIFEST_FIELD_INVALID' &&
      message.endsWith(':sourceFilesDigest')
      ? 'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH'
      : code === 'PRODUCER_SOURCE_MANIFEST_FIELD_INVALID' &&
          message.endsWith(':producerGitCommitSha')
      ? 'PRODUCER_COMMIT_INVALID'
      : code;
    checks.fail(
      supported.has(mapped) ? mapped : 'PRODUCER_SOURCE_MANIFEST_SCHEMA_UNSUPPORTED',
      path,
    );
  }
  if (parsed !== null) {
    checks.check(
      digestJson(parsed.sourceFiles) === parsed.sourceFilesDigest,
      'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH',
      path + '#/sourceFilesDigest',
    );
    checks.check(
      canonicalVerificationSourceManifestBytes(parsed).equals(bytes),
      'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH',
      path,
    );
    checks.check(
      parsed.producerWorktreeState === 'CLEAN',
      'PRODUCER_WORKTREE_NOT_CLEAN_AT_PRODUCTION',
      path + '#/producerWorktreeState',
    );
  }
  return { manifest: parsed, sha256: digest };
}

async function extractEvidenceContractIdentity(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  checks: ReviewChecks,
): Promise<ContractExtractionState> {
  const manifestRecord = await readContractRecord(snapshot, 'manifest.json');
  const plan = await readContractRecord(snapshot, 'run-plan.json');
  const summary = await readContractRecord(snapshot, 'abg-results.json');
  const terminal = await readContractRecord(snapshot, 'runtime/terminal-conclusion.json');
  const outcome = await readContractRecord(snapshot, 'runtime/final-outcome.json');
  const producerVersions = await collectContractVersions(
    snapshot,
    [...manifest.entries.keys()].filter((path) => path.endsWith('/producer-evidence.json')),
  );
  const indexVersions = await collectContractVersions(
    snapshot,
    [...manifest.entries.keys()].filter((path) => path.endsWith('producer-evidence-index.json')),
  );
  const gateVersions = await collectContractVersions(
    snapshot,
    [...manifest.entries.keys()].filter((path) => /^gates\/ABG-\d{2}\/producer\/result\.json$/u.test(path)),
  );
  const producerEvidenceSchemaVersion = uniqueContractVersion(
    producerVersions,
    'REVIEWER_CONTRACT_VERSION_MIXED',
    checks,
    'producer-evidence',
  );
  const producerEvidenceIndexSchemaVersion = uniqueContractVersion(
    indexVersions,
    'REVIEWER_CONTRACT_VERSION_MIXED',
    checks,
    'producer-evidence-index',
  );
  const gateResultSchemaVersion = uniqueContractVersion(
    gateVersions,
    'REVIEWER_CONTRACT_VERSION_MIXED',
    checks,
    'gate-results',
  );
  const values = {
    runPlanSchemaVersion: stringField(plan ?? {}, 'schemaVersion'),
    runPlanAuthorityId: stringField(plan ?? {}, 'authorityId'),
    producerEvidenceSchemaVersion,
    producerEvidenceIndexSchemaVersion,
    gateResultSchemaVersion,
    runSummarySchemaVersion: stringField(summary ?? {}, 'schemaVersion'),
    terminalConclusionSchemaVersion: stringField(terminal ?? {}, 'schemaVersion'),
    runtimeOutcomeSchemaVersion: stringField(outcome ?? {}, 'schemaVersion'),
    evidenceManifestSchemaVersion: stringField(manifestRecord ?? {}, 'schemaVersion'),
  };
  const complete = Object.values(values).every((value) => typeof value === 'string');
  if (!complete) checks.fail('EVIDENCE_CONTRACT_TUPLE_INCONSISTENT', 'evidence-contract');
  return {
    identity: complete ? values as EvidenceContractTuple : null,
    terminalConclusionSchemaVersion: values.terminalConclusionSchemaVersion,
    runtimeOutcomeSchemaVersion: values.runtimeOutcomeSchemaVersion,
    complete,
  };
}

async function readContractRecord(
  snapshot: EvidenceSnapshot,
  path: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const file = snapshot.files.get(path);
  if (file === undefined) return null;
  try {
    return asRecord(JSON.parse((await readFile(file.absolutePath)).toString('utf8')) as unknown);
  } catch {
    return null;
  }
}

async function collectContractVersions(
  snapshot: EvidenceSnapshot,
  paths: readonly string[],
): Promise<readonly (string | null)[]> {
  const versions: (string | null)[] = [];
  for (const path of [...paths].sort()) {
    const record = await readContractRecord(snapshot, path);
    versions.push(record === null ? null : stringField(record, 'schemaVersion'));
  }
  return versions;
}

function uniqueContractVersion(
  values: readonly (string | null)[],
  mixedCode: string,
  checks: ReviewChecks,
  location: string,
): string | null {
  if (values.length === 0 || values.some((value) => value === null)) {
    checks.fail('EVIDENCE_CONTRACT_TUPLE_INCONSISTENT', location);
    return null;
  }
  const unique = new Set(values as readonly string[]);
  if (unique.size !== 1) {
    checks.fail(mixedCode, location);
    return null;
  }
  return values[0]!;
}

async function verifyProducerProvenance(
  manifest: ProducerVerificationSourceManifest | null,
  dependencies: ReviewFormalAbgEvidenceDependencies,
  checks: ReviewChecks,
): Promise<ProducerProvenanceVerification> {
  const verifiedSourceBytes = new Map<string, Buffer>();
  if (manifest === null) return { status: 'INVALID', verifiedSourceBytes };
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(manifest.producerGitCommitSha)) {
    checks.fail('PRODUCER_COMMIT_INVALID', 'producer-source-manifest');
    return { status: 'INVALID', verifiedSourceBytes };
  }
  if (!await dependencies.git.commitExists(
    dependencies.repositoryRoot,
    manifest.producerGitCommitSha,
  )) {
    checks.fail('PRODUCER_COMMIT_UNAVAILABLE', manifest.producerGitCommitSha);
    return { status: 'UNVERIFIABLE', verifiedSourceBytes };
  }
  let valid = true;
  for (const entry of manifest.sourceFiles) {
    let blob;
    try {
      blob = await dependencies.git.readBlob(
        dependencies.repositoryRoot,
        manifest.producerGitCommitSha,
        entry.path,
      );
    } catch {
      blob = null;
    }
    if (blob === null) {
      checks.fail('PRODUCER_SOURCE_PATH_MISSING_AT_COMMIT', entry.path);
      valid = false;
      continue;
    }
    let entryValid = true;
    if (blob.mode !== '100644' && blob.mode !== '100755') {
      checks.fail('PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE', entry.path);
      valid = false;
      entryValid = false;
    }
    const bytes = Buffer.from(blob.bytes);
    if (blob.oid !== entry.gitBlobOid) {
      checks.fail('PRODUCER_SOURCE_BLOB_ID_MISMATCH', entry.path);
      valid = false;
      entryValid = false;
    }
    if (bytes.byteLength !== entry.byteLength) {
      checks.fail('PRODUCER_SOURCE_BYTE_LENGTH_MISMATCH', entry.path);
      valid = false;
      entryValid = false;
    }
    if (sha256(bytes) !== entry.sha256) {
      checks.fail('PRODUCER_SOURCE_SHA256_MISMATCH', entry.path);
      valid = false;
      entryValid = false;
    }
    if (entryValid) verifiedSourceBytes.set(entry.path, bytes);
  }
  return { status: valid ? 'VERIFIED' : 'INVALID', verifiedSourceBytes };
}

async function validateProducerSourceManifestReferences(
  snapshot: EvidenceSnapshot,
  producer: ProducerSourceManifestState,
  contract: ContractExtractionState,
  checks: ReviewChecks,
): Promise<void> {
  if (producer.manifest === null || producer.sha256 === null) return;
  const expectedDigest = producer.sha256;
  const expectedCommit = producer.manifest.producerGitCommitSha;
  const references = [
    ['run-plan.json', 'producerSourceManifestSha256'],
    ['runtime/terminal-conclusion.json', 'producerSourceManifestSha256'],
    ['abg-results.json', 'producerSourceManifestSha256'],
    ['runtime/final-outcome.json', 'producerSourceManifestSha256'],
  ] as const;
  for (const [path, field] of references) {
    const record = await readContractRecord(snapshot, path);
    if (record !== null) {
      checks.check(
        record[field] === expectedDigest,
        'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
        path + '#/' + field,
      );
      if (path === 'run-plan.json') {
        checks.check(record['producerSourceManifestPath'] === 'provenance/producer-source-manifest.json', 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH', path + '#/producerSourceManifestPath');
        checks.check(record['producerGitCommitSha'] === expectedCommit, 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH', path + '#/producerGitCommitSha');
        checks.check(jsonEqual(record['contractIdentity'], contract.identity), 'EVIDENCE_CONTRACT_TUPLE_INCONSISTENT', path + '#/contractIdentity');
        const frozen = asRecord(record['frozenInputs']);
        checks.check(frozen?.['producerSourceManifestSha256'] === expectedDigest, 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH', path + '#/frozenInputs/producerSourceManifestSha256');
      }
    } else {
      checks.fail('PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH', path);
    }
  }
  checks.check(
    jsonEqual(producer.manifest.contractIdentity, contract.identity),
    'EVIDENCE_CONTRACT_TUPLE_INCONSISTENT',
    'provenance/producer-source-manifest.json#/contractIdentity',
  );
}

async function validateRuntimeAuthorityProducerBinding(
  snapshot: EvidenceSnapshot,
  producer: ProducerSourceManifestState,
  producerProvenance: ProducerProvenanceVerification,
  checks: ReviewChecks,
): Promise<void> {
  const code = 'FORMAL_RUNTIME_AUTHORITY_PRODUCER_BINDING_MISMATCH';
  const preflight = await readContractRecord(snapshot, 'runtime/preflight.json');
  const rawAuthoritySnapshot = await readContractRecord(
    snapshot,
    'runtime/runtime-authority-snapshot.json',
  );
  if (
    preflight === null ||
    rawAuthoritySnapshot === null ||
    producer.manifest === null ||
    producer.sha256 === null
  ) {
    checks.fail(code, 'runtime-authority-producer-binding');
    return;
  }

  let authoritySnapshot;
  try {
    authoritySnapshot = parseFormalRuntimeAuthoritySnapshot(rawAuthoritySnapshot);
  } catch {
    checks.fail(code, 'runtime/runtime-authority-snapshot.json');
    return;
  }
  const frozenChecks = Array.isArray(preflight['checks'])
    ? preflight['checks'].filter((candidate) =>
      asRecord(candidate)?.['id'] === 'git-frozen-inputs-readable',
    )
    : [];
  const frozenCheck = frozenChecks.length === 1 ? asRecord(frozenChecks[0]) : null;
  const observed = asRecord(frozenCheck?.['observed']);
  const frozenInputs = asRecord(observed?.['inputs']);
  const preflightIdentity = asRecord(preflight['runIdentity']);
  const frozenManifestSha256 = stringField(
    frozenInputs ?? {},
    'producerSourceManifestSha256',
  );
  const runGitCommitSha = stringField(preflightIdentity ?? {}, 'gitCommitSha');
  const referencesValid =
    frozenCheck?.['status'] === 'PASSED' &&
    frozenManifestSha256 === producer.sha256 &&
    frozenInputs?.['gitCommitSha'] === runGitCommitSha &&
    frozenInputs?.['runtimeAuthoritySha256'] === authoritySnapshot.runtimeAuthoritySha256 &&
    frozenInputs?.['runtimeAuthoritySemanticDigest'] ===
      authoritySnapshot.runtimeAuthoritySemanticDigest &&
    producer.manifest.producerGitCommitSha === runGitCommitSha &&
    runGitCommitSha === authoritySnapshot.runIdentity.gitCommitSha;
  checks.check(
    referencesValid,
    code,
    'runtime/preflight.json#/checks/git-frozen-inputs-readable',
  );
  if (!referencesValid || runGitCommitSha === null) return;
  // Reuse the bytes authenticated during producer provenance verification.
  // A second Git lookup here would create a TOCTOU window where provenance was
  // marked VERIFIED but the authority comparison could be skipped.
  if (producerProvenance.status !== 'VERIFIED') return;
  const authorityEntries = producer.manifest.sourceFiles.filter(
    (entry) => entry.path === RUNTIME_AUTHORITY_RELATIVE_PATH,
  );
  const authorityEntry = authorityEntries.length === 1 ? authorityEntries[0] : undefined;
  const committedAuthorityBytes = producerProvenance.verifiedSourceBytes.get(
    RUNTIME_AUTHORITY_RELATIVE_PATH,
  );
  if (
    authorityEntry === undefined ||
    authorityEntry.role !== 'RUNTIME_AUTHORITY' ||
    authorityEntry.sha256 !== authoritySnapshot.runtimeAuthoritySha256 ||
    committedAuthorityBytes === undefined
  ) {
    checks.fail(code, RUNTIME_AUTHORITY_RELATIVE_PATH);
    return;
  }
  try {
    const document = parsePodmanRuntimeAuthority(JSON.parse(
      committedAuthorityBytes.toString('utf8'),
    ) as unknown);
    const committedAuthorityJson = canonicalRuntimeAuthorityJson(document.authority);
    checks.check(
      sha256(Buffer.from(committedAuthorityJson, 'utf8')) ===
          authoritySnapshot.runtimeAuthoritySemanticDigest &&
        committedAuthorityJson === canonicalRuntimeAuthorityJson(authoritySnapshot.authority),
      code,
      RUNTIME_AUTHORITY_RELATIVE_PATH,
    );
  } catch {
    checks.fail(code, RUNTIME_AUTHORITY_RELATIVE_PATH);
  }
}

function compareSourceDefinitions(
  producer: ProducerVerificationSourceManifest | null,
  reviewer: ReviewerVerificationSourceManifest | null,
  checks: ReviewChecks,
): 'NONE' | 'DRIFTED' | 'UNRESOLVED' {
  if (producer === null || reviewer === null) return 'UNRESOLVED';
  const producerEntries = new Map(producer.sourceFiles.map((entry) => [entry.path, entry]));
  const reviewerEntries = new Map(reviewer.sourceFiles.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...producerEntries.keys(), ...reviewerEntries.keys()])].sort();
  const changed = paths.filter((path) => {
    const left = producerEntries.get(path);
    const right = reviewerEntries.get(path);
    return left === undefined || right === undefined ||
      left.role !== right.role || left.sha256 !== right.sha256;
  });
  if (changed.length === 0) return 'NONE';
  checks.fail('REVIEWER_DEFINITION_DRIFT', changed.join(','));
  for (const path of changed) {
    const role = producerEntries.get(path)?.role ?? reviewerEntries.get(path)?.role;
    if (role === 'COVERAGE_MATRIX') {
      checks.fail('COVERAGE_MATRIX_DEFINITION_DRIFT', path);
    } else if (role !== undefined && [
      'EVIDENCE_PROTOCOL', 'EVIDENCE_SCHEMA', 'EVIDENCE_RECORDER',
      'EVIDENCE_ADAPTER', 'EVIDENCE_VALIDATOR',
    ].includes(role)) {
      checks.fail('PRODUCER_PROTOCOL_DEFINITION_DRIFT', path);
    } else if (role === 'GATE_PROOF') {
      checks.fail('GATE_PROOF_DEFINITION_DRIFT', path);
    } else if (role !== undefined && [
      'TERMINAL_CONTRACT', 'SUMMARY_VALIDATOR', 'RUNTIME_CONTRACT',
      'RUNTIME_AUTHORITY', 'RUNTIME_AUTHORITY_LOADER', 'RUNTIME_AUTHORITY_SCHEMA',
      'RUNTIME_SCRIPT',
    ].includes(role)) {
      checks.fail('TERMINAL_CONTRACT_DEFINITION_DRIFT', path);
    }
    if (role === 'REVIEWER' || role === 'REVIEWER_COMPATIBILITY') {
      checks.fail('REVIEWER_TOOL_DEFINITION_DRIFT', path);
    }
  }
  return 'DRIFTED';
}

function isEvidenceIntegrityFinding(code: string, definitionsDrifted: boolean): boolean {
  if (definitionsDrifted && [
    'VALIDATION_DEFINITION_IDENTITY_MISMATCH',
    'RUN_AUTHORITY_IDENTITY_MISMATCH',
    'COVERAGE_MATRIX_DIGEST_MISMATCH',
    'PRODUCER_PROTOCOL_DIGEST_MISMATCH',
    'GATE_PROOF_COVERAGE_DIGEST_MISMATCH',
  ].includes(code)) return false;
  return ![
    'PRODUCER_COMMIT_INVALID',
    'PRODUCER_COMMIT_UNAVAILABLE',
    'PRODUCER_SOURCE_PATH_MISSING_AT_COMMIT',
    'PRODUCER_SOURCE_BLOB_ID_MISMATCH',
    'PRODUCER_SOURCE_BYTE_LENGTH_MISMATCH',
    'PRODUCER_SOURCE_SHA256_MISMATCH',
    'PRODUCER_REPOSITORY_IDENTITY_MISMATCH',
    'REVIEWER_GIT_COMMIT_UNAVAILABLE',
    'REVIEWER_WORKTREE_DIRTY',
    'REVIEWER_SOURCE_MANIFEST_GENERATION_FAILED',
    'REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH',
    'REVIEWER_REPOSITORY_STATE_CHANGED_DURING_REVIEW',
    'REVIEWER_CONTRACT_EXACT_MATCH_REQUIRED',
    'REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED',
    'REVIEWER_CONTRACT_INCOMPATIBLE',
    'REVIEWER_CONTRACT_VERSION_UNKNOWN',
    'REVIEWER_DEFINITION_DRIFT',
    'COVERAGE_MATRIX_DEFINITION_DRIFT',
    'PRODUCER_PROTOCOL_DEFINITION_DRIFT',
    'GATE_PROOF_DEFINITION_DRIFT',
    'TERMINAL_CONTRACT_DEFINITION_DRIFT',
    'REVIEWER_TOOL_DEFINITION_DRIFT',
  ].includes(code);
}

function parseCliArguments(arguments_: readonly string[]): CliArguments | 'help' {
  if (arguments_.includes('--help') || arguments_.includes('-h')) return 'help';
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      (name !== '--evidence-dir' && name !== '--review-output-dir') ||
      value === undefined ||
      value.startsWith('--') ||
      values.has(name)
    ) {
      throw new Error('FORMAL_ABG_REVIEW_ARGUMENTS_INVALID');
    }
    values.set(name, value);
  }
  const evidenceDirectory = values.get('--evidence-dir');
  const reviewOutputDirectory = values.get('--review-output-dir');
  if (evidenceDirectory === undefined || reviewOutputDirectory === undefined) {
    throw new Error('FORMAL_ABG_REVIEW_ARGUMENTS_INVALID');
  }
  return { evidenceDirectory, reviewOutputDirectory };
}

async function main(): Promise<void> {
  try {
    const arguments_ = parseCliArguments(process.argv.slice(2));
    if (arguments_ === 'help') {
      process.stdout.write(HELP);
      return;
    }
    const review = await reviewFormalAbgEvidence(arguments_);
    process.stdout.write(JSON.stringify({
      status: review.status,
      checkCount: review.checkCount,
      failedCheckCount: review.failedCheckCount,
      reviewOutputDirectory: resolve(arguments_.reviewOutputDirectory),
    }) + '\n');
    if (review.status !== 'PASSED') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(stableThrownCode(error) + '\n');
    process.exitCode = 1;
  }
}

async function prepareExclusiveOutputDirectory(
  sourceDirectory: string,
  outputDirectory: string,
): Promise<void> {
  try {
    await lstat(outputDirectory);
    throw new Error('REVIEW_OUTPUT_ALREADY_EXISTS');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  if (isInside(sourceDirectory, outputDirectory)) {
    throw new Error('REVIEW_OUTPUT_INSIDE_SOURCE_EVIDENCE');
  }
  const canonicalOutput = await canonicalizeMissingPath(outputDirectory);
  try {
    const canonicalSource = await realpath(sourceDirectory);
    if (isInside(canonicalSource, canonicalOutput)) {
      throw new Error('REVIEW_OUTPUT_INSIDE_SOURCE_EVIDENCE');
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  await mkdir(dirname(canonicalOutput), { recursive: true });
  try {
    await mkdir(canonicalOutput, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (isAlreadyExists(error)) throw new Error('REVIEW_OUTPUT_ALREADY_EXISTS');
    throw error;
  }
}

async function canonicalizeMissingPath(path: string): Promise<string> {
  const missingSegments: string[] = [];
  let existingAncestor = path;
  while (true) {
    try {
      await lstat(existingAncestor);
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      missingSegments.push(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
  return join(
    await realpath(existingAncestor),
    ...missingSegments.reverse(),
  );
}

function isInside(parent: string, candidate: string): boolean {
  const value = relative(parent, candidate);
  return value === '' || (
    value !== '..' &&
    !value.startsWith('..' + sep) &&
    !isAbsolute(value)
  );
}

async function scanEvidenceDirectory(
  sourceDirectory: string,
  checks: ReviewChecks,
): Promise<EvidenceSnapshot> {
  const files = new Map<string, FileRecord>();
  const directories = new Set<string>();
  let rootStat: Awaited<ReturnType<typeof lstat>>;
  try {
    rootStat = await lstat(sourceDirectory);
  } catch (error) {
    checks.fail(
      isMissing(error) ? 'SOURCE_EVIDENCE_DIRECTORY_MISSING' : 'SOURCE_EVIDENCE_DIRECTORY_UNREADABLE',
      '.',
    );
    return { root: sourceDirectory, files, directories };
  }
  const rootSafe = checks.check(
    rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    rootStat.isSymbolicLink()
      ? 'SOURCE_EVIDENCE_ROOT_SYMLINK_FORBIDDEN'
      : 'SOURCE_EVIDENCE_ROOT_NOT_DIRECTORY',
    '.',
  );
  if (!rootSafe) return { root: sourceDirectory, files, directories };
  const root = await realpath(sourceDirectory);

  async function visit(directory: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      checks.fail('SOURCE_EVIDENCE_DIRECTORY_UNREADABLE', prefix || '.');
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix.length === 0 ? entry.name : prefix + '/' + entry.name;
      const absolutePath = join(directory, entry.name);
      if (!checks.check(isSafeRelativePath(relativePath), 'EVIDENCE_PATH_UNSAFE', relativePath)) {
        continue;
      }
      let entryStat;
      try {
        entryStat = await lstat(absolutePath);
      } catch {
        checks.fail('EVIDENCE_ENTRY_UNREADABLE', relativePath);
        continue;
      }
      if (entryStat.isSymbolicLink()) {
        checks.fail('EVIDENCE_SYMLINK_FORBIDDEN', relativePath);
        continue;
      }
      if (entryStat.isDirectory()) {
        directories.add(relativePath);
        await visit(absolutePath, relativePath);
        continue;
      }
      if (!entryStat.isFile()) {
        checks.fail('EVIDENCE_IRREGULAR_FILE_FORBIDDEN', relativePath);
        continue;
      }
      try {
        const digest = await hashFile(absolutePath);
        checks.check(
          digest.byteLength === entryStat.size,
          'EVIDENCE_FILE_CHANGED_WHILE_READING',
          relativePath,
        );
        files.set(relativePath, {
          absolutePath,
          byteLength: digest.byteLength,
          sha256: digest.sha256,
        });
      } catch {
        checks.fail('EVIDENCE_FILE_UNREADABLE', relativePath);
      }
    }
  }

  await visit(root, '');
  return { root, files, directories };
}

async function captureTreeIdentity(sourceDirectory: string): Promise<string> {
  const entries: Record<string, unknown>[] = [];
  async function visit(path: string, prefix: string): Promise<void> {
    let pathStat;
    try {
      pathStat = await lstat(path);
    } catch (error) {
      entries.push({ path: prefix || '.', kind: isMissing(error) ? 'MISSING' : 'UNREADABLE' });
      return;
    }
    if (pathStat.isSymbolicLink()) {
      let target = 'UNREADABLE';
      try {
        target = await readlink(path);
      } catch {
        // Keep the stable marker when the target itself cannot be read.
      }
      entries.push({ path: prefix || '.', kind: 'SYMLINK', target });
      return;
    }
    if (pathStat.isDirectory()) {
      entries.push({ path: prefix || '.', kind: 'DIRECTORY' });
      let children;
      try {
        children = await readdir(path, { withFileTypes: true });
      } catch {
        entries.push({ path: prefix || '.', kind: 'DIRECTORY_UNREADABLE' });
        return;
      }
      children.sort((left, right) => left.name.localeCompare(right.name));
      for (const child of children) {
        await visit(
          join(path, child.name),
          prefix.length === 0 ? child.name : prefix + '/' + child.name,
        );
      }
      return;
    }
    if (pathStat.isFile()) {
      try {
        const digest = await hashFile(path);
        entries.push({
          path: prefix || '.',
          kind: 'FILE',
          byteLength: digest.byteLength,
          sha256: digest.sha256,
        });
      } catch {
        entries.push({ path: prefix || '.', kind: 'FILE_UNREADABLE' });
      }
      return;
    }
    entries.push({ path: prefix || '.', kind: 'IRREGULAR' });
  }
  await visit(sourceDirectory, '');
  return digestJson(entries);
}

async function validateManifest(
  snapshot: EvidenceSnapshot,
  checks: ReviewChecks,
): Promise<ManifestState> {
  const entries = new Map<string, ManifestEntry>();
  const manifestBytes = await readSnapshotBytes(snapshot, 'manifest.json', checks, 'MANIFEST_JSON_MISSING');
  const digestBytes = await readSnapshotBytes(snapshot, 'manifest.sha256', checks, 'MANIFEST_SHA256_MISSING');
  const sourceManifestSha256 = manifestBytes === null ? null : sha256(manifestBytes);
  if (manifestBytes !== null && digestBytes !== null) {
    const match = /^([0-9a-f]{64})  manifest\.json\r?\n$/u.exec(digestBytes.toString('utf8'));
    checks.check(match !== null, 'MANIFEST_SHA256_FORMAT_INVALID', 'manifest.sha256');
    if (match !== null) {
      checks.check(
        match[1] === sourceManifestSha256,
        'MANIFEST_SHA256_MISMATCH',
        'manifest.sha256',
      );
    }
  }
  const manifest = manifestBytes === null
    ? null
    : parseJsonRecord(manifestBytes, checks, 'MANIFEST_JSON_INVALID', 'manifest.json');
  if (manifest !== null) {
    checks.check(
      manifest['schemaVersion'] === EVIDENCE_MANIFEST_SCHEMA_VERSION,
      'MANIFEST_SCHEMA_VERSION_INVALID',
      'manifest.json',
    );
    const filesValue = manifest['files'];
    if (!checks.check(Array.isArray(filesValue), 'MANIFEST_FILES_INVALID', 'manifest.json') || !Array.isArray(filesValue)) {
      return { entries, sourceManifestSha256 };
    }
    let previousPath: string | null = null;
    for (const [index, candidate] of filesValue.entries()) {
      const location = 'manifest.json#/files/' + index;
      const record = asRecord(candidate);
      if (!checks.check(record !== null, 'MANIFEST_ENTRY_INVALID', location) || record === null) continue;
      const path = stringField(record, 'path');
      const mediaTypeValue = stringField(record, 'mediaType');
      const byteLength = integerField(record, 'byteLength');
      const digest = stringField(record, 'sha256');
      const pathValid = checks.check(
        path !== null && isSafeRelativePath(path),
        'MANIFEST_PATH_UNSAFE',
        location,
      );
      if (!pathValid || path === null) continue;
      checks.check(
        path !== 'manifest.json' && path !== 'manifest.sha256',
        'MANIFEST_SELF_REFERENCE_FORBIDDEN',
        path,
      );
      checks.check(!entries.has(path), 'MANIFEST_PATH_DUPLICATE', path);
      checks.check(
        previousPath === null || previousPath.localeCompare(path) < 0,
        'MANIFEST_PATH_ORDER_INVALID',
        path,
      );
      previousPath = path;
      checks.check(mediaTypeValue !== null, 'MANIFEST_MEDIA_TYPE_INVALID', path);
      checks.check(byteLength !== null && byteLength >= 0, 'MANIFEST_BYTE_LENGTH_INVALID', path);
      checks.check(digest !== null && isSha256(digest), 'MANIFEST_FILE_SHA256_INVALID', path);
      if (mediaTypeValue === null || byteLength === null || digest === null) continue;
      const entry: ManifestEntry = { path, mediaType: mediaTypeValue, byteLength, sha256: digest };
      if (!entries.has(path)) entries.set(path, entry);
      const actual = snapshot.files.get(path);
      checks.check(actual !== undefined, 'MANIFEST_FILE_MISSING', path);
      if (actual !== undefined) {
        checks.check(actual.byteLength === byteLength, 'MANIFEST_FILE_BYTE_LENGTH_MISMATCH', path);
        checks.check(actual.sha256 === digest, 'MANIFEST_FILE_SHA256_MISMATCH', path);
      }
      checks.check(mediaTypeValue === mediaTypeFor(path), 'MANIFEST_MEDIA_TYPE_MISMATCH', path);
    }
  }
  for (const path of snapshot.files.keys()) {
    if (path === 'manifest.json' || path === 'manifest.sha256') continue;
    checks.check(entries.has(path), 'MANIFEST_UNLISTED_FILE', path);
  }
  return { entries, sourceManifestSha256 };
}

async function validateRunPlan(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  currentIdentity: CurrentAuthorityIdentity,
  checks: ReviewChecks,
): Promise<PlanState | null> {
  checks.check(manifest.entries.has('run-plan.json'), 'RUN_PLAN_NOT_MANIFESTED', 'run-plan.json');
  const bytes = await readSnapshotBytes(snapshot, 'run-plan.json', checks, 'RUN_PLAN_MISSING');
  if (bytes === null) return null;
  const raw = parseJsonRecord(bytes, checks, 'RUN_PLAN_JSON_INVALID', 'run-plan.json');
  if (raw === null) return null;
  checks.check(raw['schemaVersion'] === RUN_PLAN_SCHEMA_VERSION, 'RUN_PLAN_SCHEMA_VERSION_INVALID', 'run-plan.json');
  checks.check(raw['authorityId'] === RUN_PLAN_AUTHORITY_ID, 'RUN_PLAN_AUTHORITY_ID_INVALID', 'run-plan.json');
  const runSequence = positiveIntegerField(raw, 'runSequence');
  checks.check(runSequence !== null, 'RUN_PLAN_SEQUENCE_INVALID', 'run-plan.json');
  const frozenInputs = asRecord(raw['frozenInputs']);
  checks.check(frozenInputs !== null, 'RUN_PLAN_FROZEN_INPUTS_INVALID', 'run-plan.json');
  if (frozenInputs !== null) {
    validateFrozenInputs(frozenInputs, checks);
    checks.check(
      raw['runtimeAuthoritySha256'] === frozenInputs['runtimeAuthoritySha256'],
      'RUNTIME_AUTHORITY_SHA_MISMATCH',
      'run-plan.json#/runtimeAuthoritySha256',
    );
    checks.check(
      raw['runtimeAuthoritySemanticDigest'] === frozenInputs['runtimeAuthoritySemanticDigest'],
      'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH',
      'run-plan.json#/runtimeAuthoritySemanticDigest',
    );
  }
  const authorityIdentity = asRecord(raw['authorityIdentity']);
  checks.check(authorityIdentity !== null, 'RUN_PLAN_AUTHORITY_IDENTITY_INVALID', 'run-plan.json');
  if (authorityIdentity !== null) {
    validateAuthorityIdentity(authorityIdentity, currentIdentity, checks, 'run-plan.json#/authorityIdentity');
  }
  const setupCommands = parseCommandArray(raw['setupCommands'], checks, 'RUN_PLAN_SETUP_COMMANDS_INVALID', 'run-plan.json#/setupCommands');
  checks.check(setupCommands.length > 0, 'RUN_PLAN_SETUP_COMMANDS_EMPTY', 'run-plan.json#/setupCommands');
  const gateCommands = parseCommandArray(raw['gates'], checks, 'RUN_PLAN_GATES_INVALID', 'run-plan.json#/gates');
  checks.check(gateCommands.length === ABG_GATES.length, 'RUN_PLAN_GATE_COUNT_INVALID', 'run-plan.json#/gates');
  for (const [index, gate] of ABG_GATES.entries()) {
    const command = gateCommands[index];
    if (command === undefined) continue;
    checks.check(command['gateId'] === gate.gateId, 'RUN_PLAN_GATE_ORDER_INVALID', 'run-plan.json#/gates/' + index);
  }
  return {
    raw,
    planDigest: sha256(bytes),
    runSequence,
    frozenInputs,
    authorityIdentity,
    setupCommands,
    gateCommands,
  };
}

function validateFrozenInputs(
  frozenInputs: Readonly<Record<string, unknown>>,
  checks: ReviewChecks,
): void {
  const required = [...ABG_FROZEN_INPUT_KINDS, 'workingTreeState'] as const;
  for (const field of required) {
    const value = frozenInputs[field];
    checks.check(
      typeof value === 'string' && value.trim().length > 0,
      'RUN_PLAN_FROZEN_INPUT_MISSING',
      'run-plan.json#/frozenInputs/' + field,
    );
  }
  checks.check(frozenInputs['workingTreeState'] === 'CLEAN', 'RUN_PLAN_WORKTREE_STATE_INVALID', 'run-plan.json#/frozenInputs/workingTreeState');
  const gitIdentity = frozenInputs['gitCommitSha'];
  checks.check(
    typeof gitIdentity === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(gitIdentity),
    'RUN_PLAN_GIT_IDENTITY_INVALID',
    'run-plan.json#/frozenInputs/gitCommitSha',
  );
  for (const field of [
    'lockfileSha256',
    'openapiSha256',
    'migrationManifestSha256',
    'fixtureIdentity',
    'runtimeAuthoritySha256',
    'runtimeAuthoritySemanticDigest',
  ] as const) {
    const value = frozenInputs[field];
    checks.check(
      typeof value === 'string' && isSha256(value),
      'RUN_PLAN_FROZEN_DIGEST_INVALID',
      'run-plan.json#/frozenInputs/' + field,
    );
  }
}

function validateAuthorityIdentity(
  actual: Readonly<Record<string, unknown>>,
  expected: CurrentAuthorityIdentity,
  checks: ReviewChecks,
  location: string,
): void {
  for (const [field, value] of Object.entries(expected)) {
    checks.check(
      actual[field] === value,
      'VALIDATION_DEFINITION_IDENTITY_MISMATCH',
      location + '/' + field,
    );
  }
}

function parseCommandArray(
  value: unknown,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly Readonly<Record<string, unknown>>[] {
  if (!checks.check(Array.isArray(value), code, location) || !Array.isArray(value)) return [];
  const commands: Readonly<Record<string, unknown>>[] = [];
  for (const [index, candidate] of value.entries()) {
    const record = asRecord(candidate);
    if (!checks.check(record !== null, code, location + '/' + index) || record === null) continue;
    checks.check(
      typeof record['executable'] === 'string' && record['executable'].trim().length > 0,
      'RUN_PLAN_COMMAND_EXECUTABLE_INVALID',
      location + '/' + index,
    );
    checks.check(
      Array.isArray(record['args']) && record['args'].every((argument) => typeof argument === 'string'),
      'RUN_PLAN_COMMAND_ARGUMENTS_INVALID',
      location + '/' + index,
    );
    if (record['workingDirectory'] !== undefined) {
      checks.check(
        typeof record['workingDirectory'] === 'string' && isSafeRelativePath(record['workingDirectory']),
        'RUN_PLAN_COMMAND_DIRECTORY_INVALID',
        location + '/' + index,
      );
    }
    commands.push(record);
  }
  return commands;
}

async function validateRunSummary(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  plan: PlanState | null,
  currentIdentity: CurrentAuthorityIdentity,
  checks: ReviewChecks,
): Promise<SummaryState | null> {
  const requiredRuntimePorts = formalRuntimePorts(formalRuntimeAuthority().authority);
  checks.check(manifest.entries.has('abg-results.json'), 'RUN_SUMMARY_NOT_MANIFESTED', 'abg-results.json');
  const bytes = await readSnapshotBytes(snapshot, 'abg-results.json', checks, 'RUN_SUMMARY_MISSING');
  if (bytes === null) return null;
  const raw = parseJsonRecord(bytes, checks, 'RUN_SUMMARY_JSON_INVALID', 'abg-results.json');
  if (raw === null) return null;
  checks.check(raw['schemaVersion'] === RUN_SUMMARY_SCHEMA_VERSION, 'RUN_SUMMARY_SCHEMA_VERSION_INVALID', 'abg-results.json');
  const runId = meaningfulStringField(raw, 'runId');
  checks.check(runId !== null, 'RUN_ID_INVALID', 'abg-results.json#/runId');
  const runSequence = positiveIntegerField(raw, 'runSequence');
  checks.check(runSequence !== null, 'RUN_SEQUENCE_INVALID', 'abg-results.json#/runSequence');
  const gitCommitSha = meaningfulStringField(raw, 'gitCommitSha');
  checks.check(
    gitCommitSha !== null && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(gitCommitSha),
    'FORMAL_SUMMARY_GIT_COMMIT_INVALID',
    'abg-results.json#/gitCommitSha',
  );
  const runtimeNamespace = meaningfulStringField(raw, 'runtimeNamespace');
  let derivedRuntimeNamespace: string | null = null;
  if (runId !== null && runSequence !== null) {
    try {
      derivedRuntimeNamespace = createFormalRunSeed(runSequence, () => runId).runtimeNamespace;
    } catch {
      derivedRuntimeNamespace = null;
    }
  }
  checks.check(
    runtimeNamespace !== null && runtimeNamespace === derivedRuntimeNamespace,
    'FORMAL_RUNTIME_NAMESPACE_MISMATCH',
    'abg-results.json#/runtimeNamespace',
  );
  if (plan !== null) {
    checks.check(runSequence === plan.runSequence, 'RUN_SEQUENCE_MISMATCH', 'abg-results.json#/runSequence');
    checks.check(raw['planDigest'] === plan.planDigest, 'RUN_PLAN_DIGEST_MISMATCH', 'abg-results.json#/planDigest');
    if (plan.frozenInputs !== null) {
      checks.check(
        gitCommitSha !== null && gitCommitSha === plan.frozenInputs['gitCommitSha'],
        'FORMAL_SUMMARY_GIT_COMMIT_MISMATCH',
        'abg-results.json#/gitCommitSha',
      );
      checks.check(
        raw['frozenInputsDigest'] === digestJson(plan.frozenInputs),
        'FROZEN_INPUTS_DIGEST_MISMATCH',
        'abg-results.json#/frozenInputsDigest',
      );
      checks.check(
        jsonEqual(raw['frozenInputs'], plan.frozenInputs),
        'FROZEN_INPUTS_MISMATCH',
        'abg-results.json#/frozenInputs',
      );
      checks.check(
        raw['runtimeAuthoritySha256'] === plan.frozenInputs['runtimeAuthoritySha256'],
        'RUNTIME_AUTHORITY_SHA_MISMATCH',
        'abg-results.json#/runtimeAuthoritySha256',
      );
      checks.check(
        raw['runtimeAuthoritySemanticDigest'] ===
          plan.frozenInputs['runtimeAuthoritySemanticDigest'],
        'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH',
        'abg-results.json#/runtimeAuthoritySemanticDigest',
      );
    }
    if (plan.authorityIdentity !== null) {
      checks.check(
        jsonEqual(raw['authorityIdentity'], plan.authorityIdentity),
        'RUN_AUTHORITY_IDENTITY_MISMATCH',
        'abg-results.json#/authorityIdentity',
      );
    }
  }
  checks.check(raw['coverageMatrixDigest'] === currentIdentity.coverageMatrixDigest, 'COVERAGE_MATRIX_DIGEST_MISMATCH', 'abg-results.json#/coverageMatrixDigest');
  checks.check(raw['producerProtocolIdentityDigest'] === currentIdentity.producerProtocolIdentityDigest, 'PRODUCER_PROTOCOL_DIGEST_MISMATCH', 'abg-results.json#/producerProtocolIdentityDigest');
  checks.check(raw['preflightStatus'] === 'PASSED', 'FORMAL_SUMMARY_PREFLIGHT_STATUS_NOT_PASSED', 'abg-results.json#/preflightStatus');
  checks.check(raw['setupStatus'] === 'PASSED', 'FORMAL_SUMMARY_SETUP_STATUS_NOT_PASSED', 'abg-results.json#/setupStatus');
  checks.check(raw['nonFormalGateStatus'] === 'PASSED', 'FORMAL_SUMMARY_NON_FORMAL_STATUS_NOT_PASSED', 'abg-results.json#/nonFormalGateStatus');
  checks.check(raw['producerEvidenceStatus'] === 'PASSED', 'FORMAL_SUMMARY_PRODUCER_EVIDENCE_STATUS_NOT_PASSED', 'abg-results.json#/producerEvidenceStatus');
  checks.check(raw['producerEvidencePersistedBeforeCleanup'] === true, 'FORMAL_SUMMARY_PRODUCER_EVIDENCE_NOT_PERSISTED', 'abg-results.json#/producerEvidencePersistedBeforeCleanup');
  checks.check(positiveIntegerField(raw, 'producerProtocolEvidenceCount') !== null, 'FORMAL_SUMMARY_PRODUCER_EVIDENCE_EMPTY', 'abg-results.json#/producerProtocolEvidenceCount');
  checks.check(raw['cleanupStatus'] === 'PASSED', 'FORMAL_SUMMARY_CLEANUP_STATUS_NOT_PASSED', 'abg-results.json#/cleanupStatus');
  checks.check(raw['residualResourceCount'] === 0, 'FORMAL_SUMMARY_RESIDUAL_RESOURCES_PRESENT', 'abg-results.json#/residualResourceCount');
  checks.check(raw['residualContainerCount'] === 0, 'FORMAL_SUMMARY_RESIDUAL_CONTAINER_PRESENT', 'abg-results.json#/residualContainerCount');
  checks.check(raw['residualVolumeCount'] === 0, 'FORMAL_SUMMARY_RESIDUAL_VOLUME_PRESENT', 'abg-results.json#/residualVolumeCount');
  checks.check(raw['residualNetworkCount'] === 0, 'FORMAL_SUMMARY_RESIDUAL_NETWORK_PRESENT', 'abg-results.json#/residualNetworkCount');
  const occupiedRequiredPorts = parseNumberArray(
    raw['occupiedRequiredPorts'],
    checks,
    'FORMAL_SUMMARY_OCCUPIED_REQUIRED_PORTS_INVALID',
    'abg-results.json#/occupiedRequiredPorts',
  );
  checks.check(occupiedRequiredPorts.length === 0, 'FORMAL_SUMMARY_REQUIRED_PORT_OCCUPIED', 'abg-results.json#/occupiedRequiredPorts');
  const requiredPortsObserved = parseNumberArray(
    raw['requiredPortsObserved'],
    checks,
    'FORMAL_SUMMARY_REQUIRED_PORTS_OBSERVED_INVALID',
    'abg-results.json#/requiredPortsObserved',
  );
  checks.check(
    numberArrayEqual(requiredPortsObserved, requiredRuntimePorts),
    'FORMAL_SUMMARY_REQUIRED_PORT_OBSERVATION_MISSING',
    'abg-results.json#/requiredPortsObserved',
  );
  checks.check(raw['pruneCommandsInvoked'] === false, 'FORMAL_SUMMARY_PRUNE_COMMAND_INVOKED', 'abg-results.json#/pruneCommandsInvoked');
  checks.check(raw['frozenInputsStableAfterCleanup'] === true, 'FROZEN_INPUTS_NOT_STABLE', 'abg-results.json#/frozenInputsStableAfterCleanup');
  checks.check(raw['authorityIdentityStableAfterCleanup'] === true, 'AUTHORITY_IDENTITY_NOT_STABLE', 'abg-results.json#/authorityIdentityStableAfterCleanup');
  checks.check(
    raw['runtimeAuthorityStableAfterCleanup'] === true,
    'RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP',
    'abg-results.json#/runtimeAuthorityStableAfterCleanup',
  );
  checks.check(raw['outputDirectoryExclusive'] === true, 'FORMAL_SUMMARY_OUTPUT_DIRECTORY_NOT_EXCLUSIVE', 'abg-results.json#/outputDirectoryExclusive');
  checks.check(raw['terminalConclusionStatus'] === 'PASSED', 'FORMAL_SUMMARY_TERMINAL_STATUS_NOT_PASSED', 'abg-results.json#/terminalConclusionStatus');
  checks.check(raw['sealEligibilityStatus'] === 'PASSED', 'FORMAL_SUMMARY_SEAL_STATUS_NOT_PASSED', 'abg-results.json#/sealEligibilityStatus');
  checks.check(raw['lifecycleStatus'] === 'PASSED', 'FORMAL_SUMMARY_LIFECYCLE_STATUS_NOT_PASSED', 'abg-results.json#/lifecycleStatus');
  const summaryFailureCodes = parseStringArray(
    raw['failureCodes'],
    checks,
    'FORMAL_SUMMARY_FAILURE_CODES_INVALID',
    'abg-results.json#/failureCodes',
  );
  checks.check(summaryFailureCodes.length === 0, 'FORMAL_SUMMARY_PASSED_WITH_FAILURE_CODES', 'abg-results.json#/failureCodes');
  checks.check(raw['selectorSetsDistinct'] === true, 'SELECTOR_SETS_NOT_DECLARED_DISTINCT', 'abg-results.json#/selectorSetsDistinct');
  checks.check(raw['timezone'] === 'Asia/Shanghai', 'RUN_TIMEZONE_INVALID', 'abg-results.json#/timezone');
  checks.check(raw['conclusionScope'] === CONCLUSION_SCOPE, 'CONCLUSION_SCOPE_INVALID', 'abg-results.json#/conclusionScope');
  const startedAt = stringField(raw, 'startedAt');
  const completedAt = stringField(raw, 'completedAt');
  checks.check(startedAt !== null && isLocalDateTime(startedAt), 'RUN_STARTED_AT_INVALID', 'abg-results.json#/startedAt');
  checks.check(completedAt !== null && isLocalDateTime(completedAt), 'RUN_COMPLETED_AT_INVALID', 'abg-results.json#/completedAt');
  if (startedAt !== null && completedAt !== null && isLocalDateTime(startedAt) && isLocalDateTime(completedAt)) {
    checks.check(startedAt <= completedAt, 'RUN_TIME_ORDER_INVALID', 'abg-results.json');
  }
  if (plan !== null) validateSetupResults(raw, plan, snapshot, checks);

  const resultsValue = raw['results'];
  const results = Array.isArray(resultsValue)
    ? resultsValue.map(asRecord).filter((candidate): candidate is Readonly<Record<string, unknown>> => candidate !== null)
    : [];
  checks.check(Array.isArray(resultsValue), 'GATE_RESULTS_INVALID', 'abg-results.json#/results');
  checks.check(results.length === ABG_GATES.length, 'GATE_RESULT_COUNT_INVALID', 'abg-results.json#/results');
  checks.check(raw['gateCount'] === ABG_GATES.length, 'GATE_COUNT_INVALID', 'abg-results.json#/gateCount');
  const gateIds = results.map((result) => stringField(result, 'gateId')).filter((value): value is string => value !== null);
  checks.check(new Set(gateIds).size === gateIds.length, 'GATE_ID_DUPLICATE', 'abg-results.json#/results');

  const producerIndexes = new Map<string, Promise<ProducerIndexState | null>>();
  const producerEvidence = new Map<string, Promise<ProducerEvidenceState | null>>();
  const selectorSignatures: string[] = [];
  for (const [index, gate] of ABG_GATES.entries()) {
    const result = results[index];
    if (result === undefined) {
      checks.fail('GATE_RESULT_MISSING', gate.gateId);
      continue;
    }
    checks.check(result['gateId'] === gate.gateId, 'GATE_ORDER_OR_ID_MISMATCH', 'abg-results.json#/results/' + index);
    const entry = ABG_COVERAGE_MATRIX[index];
    if (entry === undefined || plan === null || runId === null || runSequence === null) continue;
    const signature = await validateGateResult({
      result,
      gateIndex: index,
      entry,
      expectedRunId: runId,
      expectedRunSequence: runSequence,
      snapshot,
      manifest,
      plan,
      checks,
      producerIndexes,
      producerEvidence,
    });
    if (signature !== null) selectorSignatures.push(signature);
  }
  if (selectorSignatures.length === ABG_GATES.length) {
    checks.check(
      new Set(selectorSignatures).size === ABG_GATES.length,
      'GATE_SELECTOR_SETS_NOT_DISTINCT',
      'abg-results.json#/results',
    );
  }
  const passedCount = results.filter((result) => result['status'] === 'PASSED').length;
  const failedCount = results.filter((result) => result['status'] === 'FAILED').length;
  checks.check(raw['passedCount'] === passedCount, 'PASSED_COUNT_MISMATCH', 'abg-results.json#/passedCount');
  checks.check(raw['failedCount'] === failedCount, 'FAILED_COUNT_MISMATCH', 'abg-results.json#/failedCount');
  const nonFormalStatus = results.slice(0, 39).length === 39 &&
    results.slice(0, 39).every((result) => result['status'] === 'PASSED')
    ? 'PASSED'
    : 'FAILED';
  checks.check(raw['nonFormalGateStatus'] === nonFormalStatus, 'FORMAL_SUMMARY_NON_FORMAL_STATUS_MISMATCH', 'abg-results.json#/nonFormalGateStatus');
  const derivedLifecycleStatus = raw['preflightStatus'] === 'PASSED' &&
    raw['setupStatus'] === 'PASSED' &&
    nonFormalStatus === 'PASSED' &&
    raw['producerEvidenceStatus'] === 'PASSED' &&
    raw['cleanupStatus'] === 'PASSED' &&
    raw['residualResourceCount'] === 0 &&
    numberArrayValue(raw['occupiedRequiredPorts']).length === 0 &&
    raw['frozenInputsStableAfterCleanup'] === true &&
    raw['authorityIdentityStableAfterCleanup'] === true &&
    raw['runtimeAuthorityStableAfterCleanup'] === true &&
    raw['outputDirectoryExclusive'] === true &&
    raw['terminalConclusionStatus'] === 'PASSED' &&
    raw['sealEligibilityStatus'] === 'PASSED'
    ? 'PASSED'
    : 'FAILED';
  checks.check(raw['lifecycleStatus'] === derivedLifecycleStatus, 'FORMAL_SUMMARY_LIFECYCLE_STATUS_MISMATCH', 'abg-results.json#/lifecycleStatus');
  const derivedStatus = results.length === ABG_GATES.length && failedCount === 0 &&
    derivedLifecycleStatus === 'PASSED'
    ? 'PASSED'
    : 'FAILED';
  checks.check(raw['status'] === derivedStatus, 'RUN_STATUS_MISMATCH', 'abg-results.json#/status');
  checks.check(
    raw['status'] !== 'PASSED' || results.every((result) => result['status'] === 'PASSED'),
    'RUN_PASSED_WITH_NON_PASSED_GATE',
    'abg-results.json#/status',
  );
  return { raw, runId, runSequence };
}

function validateSetupResults(
  summary: Readonly<Record<string, unknown>>,
  plan: PlanState,
  snapshot: EvidenceSnapshot,
  checks: ReviewChecks,
): void {
  const value = summary['setupResults'];
  if (!checks.check(Array.isArray(value), 'SETUP_RESULTS_INVALID', 'abg-results.json#/setupResults') || !Array.isArray(value)) return;
  checks.check(value.length === plan.setupCommands.length, 'SETUP_RESULT_COUNT_MISMATCH', 'abg-results.json#/setupResults');
  for (const [index, command] of plan.setupCommands.entries()) {
    const record = asRecord(value[index]);
    const ordinal = index + 1;
    const directory = 'setup/' + String(ordinal).padStart(2, '0');
    if (!checks.check(record !== null, 'SETUP_RESULT_INVALID', 'abg-results.json#/setupResults/' + index) || record === null) continue;
    checks.check(record['ordinal'] === ordinal, 'SETUP_RESULT_ORDINAL_MISMATCH', directory);
    checks.check(record['commandDigest'] === digestJson(command), 'SETUP_COMMAND_DIGEST_MISMATCH', directory);
    checks.check(record['exitCode'] === 0, 'SETUP_EXIT_CODE_INVALID', directory);
    checks.check(isNonNegativeInteger(record['elapsedMilliseconds']), 'SETUP_ELAPSED_INVALID', directory);
    checks.check(snapshot.directories.has(directory), 'SETUP_LOG_DIRECTORY_MISSING', directory);
    checks.check(snapshot.files.has(directory + '/stdout.log'), 'SETUP_STDOUT_LOG_MISSING', directory);
    checks.check(snapshot.files.has(directory + '/stderr.log'), 'SETUP_STDERR_LOG_MISSING', directory);
  }
  const actualDirectories = [...snapshot.directories].filter((path) => /^setup\/[^/]+$/u.test(path));
  checks.check(actualDirectories.length === value.length, 'SETUP_LOG_DIRECTORY_COUNT_MISMATCH', 'setup');
}

async function validateGateResult(input: {
  readonly result: Readonly<Record<string, unknown>>;
  readonly gateIndex: number;
  readonly entry: AbgCoverageMatrixEntry;
  readonly expectedRunId: string;
  readonly expectedRunSequence: number;
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: ManifestState;
  readonly plan: PlanState;
  readonly checks: ReviewChecks;
  readonly producerIndexes: Map<string, Promise<ProducerIndexState | null>>;
  readonly producerEvidence: Map<string, Promise<ProducerEvidenceState | null>>;
}): Promise<string | null> {
  const { result, entry, checks } = input;
  const gate = ABG_GATES[input.gateIndex];
  if (gate === undefined) return null;
  const location = 'abg-results.json#/results/' + input.gateIndex;
  checks.check(result['title'] === gate.title, 'GATE_TITLE_MISMATCH', location);
  checks.check(result['evidenceClass'] === gate.evidenceClass, 'GATE_EVIDENCE_CLASS_MISMATCH', location);
  checks.check(result['ordinal'] === input.gateIndex + 1, 'GATE_ORDINAL_MISMATCH', location);
  checks.check(result['runId'] === input.expectedRunId, 'GATE_RUN_ID_MISMATCH', location);
  const gateStatus = result['status'];
  checks.check(gateStatus === 'PASSED' || gateStatus === 'FAILED', 'GATE_STATUS_INVALID', location);
  if (gateStatus !== 'PASSED') {
    checks.fail('GATE_STATUS_NOT_PASSED', location);
    if (gateStatus === 'FAILED') {
      checks.check(
        typeof result['failureCode'] === 'string' && result['failureCode'].trim().length > 0,
        'GATE_FAILURE_CODE_REQUIRED',
        location,
      );
      checks.check(result['proofPath'] === null, 'GATE_FAILED_WITH_PROOF_PATH', location);
      checks.check(result['proof'] === null, 'GATE_FAILED_WITH_PROOF', location);
      checks.check(
        result['producerExitCode'] === null || Number.isSafeInteger(result['producerExitCode']),
        'GATE_FAILED_PRODUCER_EXIT_CODE_INVALID',
        location,
      );
    }
    return null;
  }
  checks.check(result['producerExitCode'] === 0, 'GATE_PRODUCER_EXIT_CODE_INVALID', location);
  checks.check(!Object.hasOwn(result, 'failureCode'), 'GATE_PASSED_WITH_FAILURE_CODE', location);
  checks.check(isNonNegativeInteger(result['elapsedMilliseconds']), 'GATE_ELAPSED_INVALID', location);
  const command = input.plan.gateCommands[input.gateIndex];
  if (command !== undefined) {
    checks.check(result['producerCommandDigest'] === digestJson(command), 'GATE_COMMAND_DIGEST_MISMATCH', location);
  }
  const expectedProofPath = 'gates/' + gate.gateId + '/producer/result.json';
  const proofPath = stringField(result, 'proofPath');
  checks.check(proofPath === expectedProofPath, 'GATE_PROOF_PATH_INVALID', location + '/proofPath');
  const embeddedProof = asRecord(result['proof']);
  checks.check(embeddedProof !== null, 'GATE_PROOF_MISSING', location + '/proof');
  if (proofPath === null || embeddedProof === null || !isSafeRelativePath(proofPath)) return null;
  checks.check(input.manifest.entries.has(proofPath), 'GATE_PROOF_NOT_MANIFESTED', proofPath);
  const proofBytes = await readSnapshotBytes(input.snapshot, proofPath, checks, 'GATE_PROOF_FILE_MISSING');
  if (proofBytes === null) return null;
  const fileProof = parseJsonRecord(proofBytes, checks, 'GATE_PROOF_JSON_INVALID', proofPath);
  if (fileProof === null) return null;
  checks.check(jsonEqual(fileProof, embeddedProof), 'GATE_PROOF_EMBEDDED_FILE_MISMATCH', proofPath);
  return validateGateProof({
    proof: fileProof,
    entry,
    expectedRunId: input.expectedRunId,
    expectedRunSequence: input.expectedRunSequence,
    snapshot: input.snapshot,
    manifest: input.manifest,
    plan: input.plan,
    checks,
    producerIndexes: input.producerIndexes,
    producerEvidence: input.producerEvidence,
    proofPath,
  });
}

async function validateGateProof(input: {
  readonly proof: Readonly<Record<string, unknown>>;
  readonly entry: AbgCoverageMatrixEntry;
  readonly expectedRunId: string;
  readonly expectedRunSequence: number;
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: ManifestState;
  readonly plan: PlanState;
  readonly checks: ReviewChecks;
  readonly producerIndexes: Map<string, Promise<ProducerIndexState | null>>;
  readonly producerEvidence: Map<string, Promise<ProducerEvidenceState | null>>;
  readonly proofPath: string;
}): Promise<string | null> {
  const { proof, entry, checks, proofPath } = input;
  checks.check(proof['schemaVersion'] === GATE_RESULT_SCHEMA_VERSION, 'GATE_PROOF_SCHEMA_VERSION_INVALID', proofPath);
  checks.check(proof['gateId'] === entry.gateId, 'GATE_PROOF_GATE_ID_MISMATCH', proofPath);
  checks.check(proof['runId'] === input.expectedRunId, 'GATE_PROOF_RUN_ID_MISMATCH', proofPath);
  checks.check(proof['runSequence'] === input.expectedRunSequence, 'GATE_PROOF_RUN_SEQUENCE_MISMATCH', proofPath);
  checks.check(proof['status'] === 'PASSED', 'GATE_PROOF_STATUS_NOT_PASSED', proofPath);
  checks.check(proof['coverageMatrixDigest'] === digestJson(ABG_COVERAGE_MATRIX), 'GATE_PROOF_COVERAGE_DIGEST_MISMATCH', proofPath);
  const scenarioIds = parseStringArray(proof['scenarioIds'], checks, 'GATE_SCENARIO_IDS_INVALID', proofPath);
  const assertionIds = parseStringArray(proof['assertionIds'], checks, 'GATE_ASSERTION_IDS_INVALID', proofPath);
  checks.check(arrayEqual(scenarioIds, entry.scenarioIds), 'GATE_SCENARIOS_MISMATCH', proofPath);
  checks.check(arrayEqual(assertionIds, entry.assertionIds), 'GATE_ASSERTIONS_MISMATCH', proofPath);
  for (const assertionId of assertionIds) {
    checks.check(
      assertionId.startsWith(entry.gateId + ':') && matrixGateForAssertion(assertionId) === entry.gateId,
      'GATE_ASSERTION_OWNERSHIP_MISMATCH',
      proofPath,
    );
  }
  const indexPath = stringField(proof, 'producerEvidenceIndexPath');
  checks.check(indexPath !== null && isSafeRelativePath(indexPath), 'PRODUCER_INDEX_PATH_UNSAFE', proofPath);
  const indexDigest = stringField(proof, 'producerEvidenceIndexDigest');
  checks.check(indexDigest !== null && isSha256(indexDigest), 'PRODUCER_INDEX_DIGEST_INVALID', proofPath);
  if (indexPath === null || !isSafeRelativePath(indexPath)) return null;
  let indexPromise = input.producerIndexes.get(indexPath);
  if (indexPromise === undefined) {
    indexPromise = validateProducerIndex({
      relativePath: indexPath,
      expectedRunId: input.expectedRunId,
      expectedRunSequence: input.expectedRunSequence,
      snapshot: input.snapshot,
      manifest: input.manifest,
      plan: input.plan,
      checks,
      producerEvidence: input.producerEvidence,
    });
    input.producerIndexes.set(indexPath, indexPromise);
  }
  const index = await indexPromise;
  if (index === null) return null;
  checks.check(index.digest === indexDigest, 'PRODUCER_INDEX_DIGEST_MISMATCH', indexPath);

  const refsValue = proof['evidenceRefs'];
  const refs = Array.isArray(refsValue)
    ? refsValue.map(asRecord).filter((candidate): candidate is Readonly<Record<string, unknown>> => candidate !== null)
    : [];
  checks.check(Array.isArray(refsValue) && refs.length > 0, 'GATE_EVIDENCE_REFS_INVALID', proofPath);
  checks.check(refs.length === entry.evidenceSelectors.length, 'GATE_SELECTOR_COUNT_MISMATCH', proofPath);
  const selectedClaims: SelectedClaimState[] = [];
  for (const selector of entry.evidenceSelectors) {
    const matching = refs.filter((reference) => selectorMatches(reference, selector));
    checks.check(matching.length > 0, 'GATE_SELECTOR_MISSING', proofPath + '#' + selector.assertionId);
    checks.check(matching.length <= 1, 'GATE_SELECTOR_DUPLICATE', proofPath + '#' + selector.assertionId);
    const reference = matching[0];
    if (reference === undefined) continue;
    const selected = await validateEvidenceReference({
      reference,
      selector,
      entry,
      index,
      expectedRunId: input.expectedRunId,
      expectedRunSequence: input.expectedRunSequence,
      snapshot: input.snapshot,
      manifest: input.manifest,
      plan: input.plan,
      checks,
      producerEvidence: input.producerEvidence,
      proofPath,
    });
    if (selected !== null) selectedClaims.push(selected);
  }
  for (const reference of refs) {
    checks.check(
      entry.evidenceSelectors.some((selector) => selectorMatches(reference, selector)),
      'GATE_SELECTOR_UNDECLARED',
      proofPath,
    );
  }
  if (selectedClaims.length === entry.evidenceSelectors.length) {
    validateGateReferences(proof, entry, selectedClaims, input.plan, checks, proofPath);
  }
  return refs.map((reference) => selectorSignature(reference)).sort((left, right) => left.localeCompare(right)).join('|');
}

async function validateProducerIndex(input: {
  readonly relativePath: string;
  readonly expectedRunId: string;
  readonly expectedRunSequence: number;
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: ManifestState;
  readonly plan: PlanState;
  readonly checks: ReviewChecks;
  readonly producerEvidence: Map<string, Promise<ProducerEvidenceState | null>>;
}): Promise<ProducerIndexState | null> {
  const { relativePath, checks } = input;
  checks.check(input.manifest.entries.has(relativePath), 'PRODUCER_INDEX_NOT_MANIFESTED', relativePath);
  const bytes = await readSnapshotBytes(input.snapshot, relativePath, checks, 'PRODUCER_INDEX_MISSING');
  if (bytes === null) return null;
  const raw = parseJsonRecord(bytes, checks, 'PRODUCER_INDEX_JSON_INVALID', relativePath);
  if (raw === null) return null;
  checks.check(raw['schemaVersion'] === PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION, 'PRODUCER_INDEX_SCHEMA_VERSION_INVALID', relativePath);
  checks.check(raw['runId'] === input.expectedRunId, 'PRODUCER_INDEX_RUN_ID_MISMATCH', relativePath);
  checks.check(raw['runSequence'] === input.expectedRunSequence, 'PRODUCER_INDEX_RUN_SEQUENCE_MISMATCH', relativePath);
  const producersValue = raw['producers'];
  if (!checks.check(Array.isArray(producersValue) && producersValue.length > 0, 'PRODUCER_INDEX_ENTRIES_INVALID', relativePath) || !Array.isArray(producersValue)) {
    return { digest: sha256(bytes), entries: new Map() };
  }
  const entries = new Map<AbgProducerId, ProducerIndexEntryState>();
  const base = posix.dirname(relativePath) === '.' ? '' : posix.dirname(relativePath);
  for (const [index, candidate] of producersValue.entries()) {
    const location = relativePath + '#/producers/' + index;
    const record = asRecord(candidate);
    if (!checks.check(record !== null, 'PRODUCER_INDEX_ENTRY_INVALID', location) || record === null) continue;
    const producerIdValue = stringField(record, 'producerId');
    const producerId = isProducerId(producerIdValue) ? producerIdValue : null;
    checks.check(producerId !== null, 'PRODUCER_INDEX_PRODUCER_ID_INVALID', location);
    const childPath = stringField(record, 'relativePath');
    checks.check(childPath !== null && isSafeRelativePath(childPath), 'PRODUCER_INDEX_ENTRY_PATH_UNSAFE', location);
    const digest = stringField(record, 'sha256');
    checks.check(digest !== null && isSha256(digest), 'PRODUCER_INDEX_ENTRY_DIGEST_INVALID', location);
    const status = stringField(record, 'status');
    checks.check(isEvidenceStatus(status), 'PRODUCER_INDEX_ENTRY_STATUS_INVALID', location);
    const scenarioCount = nonNegativeIntegerField(record, 'scenarioCount');
    const assertionCount = nonNegativeIntegerField(record, 'assertionCount');
    checks.check(scenarioCount !== null, 'PRODUCER_INDEX_SCENARIO_COUNT_INVALID', location);
    checks.check(assertionCount !== null, 'PRODUCER_INDEX_ASSERTION_COUNT_INVALID', location);
    if (producerId === null || childPath === null || digest === null || status === null || scenarioCount === null || assertionCount === null) continue;
    checks.check(!entries.has(producerId), 'PRODUCER_INDEX_PRODUCER_DUPLICATE', location);
    const resolvedRelativePath = joinSafeRelative(base, childPath);
    checks.check(resolvedRelativePath !== null, 'PRODUCER_INDEX_ENTRY_PATH_UNSAFE', location);
    if (resolvedRelativePath === null || entries.has(producerId)) continue;
    const entry: ProducerIndexEntryState = {
      producerId,
      resolvedRelativePath,
      sha256: digest,
      status,
      scenarioCount,
      assertionCount,
    };
    entries.set(producerId, entry);
    let evidencePromise = input.producerEvidence.get(resolvedRelativePath);
    if (evidencePromise === undefined) {
      evidencePromise = validateProducerEvidence({
        relativePath: resolvedRelativePath,
        expectedRunId: input.expectedRunId,
        expectedRunSequence: input.expectedRunSequence,
        snapshot: input.snapshot,
        manifest: input.manifest,
        plan: input.plan,
        checks,
      });
      input.producerEvidence.set(resolvedRelativePath, evidencePromise);
    }
    const evidence = await evidencePromise;
    const file = input.snapshot.files.get(resolvedRelativePath);
    if (file !== undefined) checks.check(file.sha256 === digest, 'PRODUCER_EVIDENCE_DIGEST_MISMATCH', resolvedRelativePath);
    if (evidence !== null) {
      checks.check(evidence.producerId === producerId, 'PRODUCER_EVIDENCE_PRODUCER_MISMATCH', resolvedRelativePath);
      checks.check(evidence.status === status, 'PRODUCER_INDEX_STATUS_MISMATCH', resolvedRelativePath);
      checks.check(evidence.scenarioCount === scenarioCount, 'PRODUCER_INDEX_SCENARIO_COUNT_MISMATCH', resolvedRelativePath);
      checks.check(evidence.assertionCount === assertionCount, 'PRODUCER_INDEX_ASSERTION_COUNT_MISMATCH', resolvedRelativePath);
    }
  }
  return { digest: sha256(bytes), entries };
}

async function validateProducerEvidence(input: {
  readonly relativePath: string;
  readonly expectedRunId: string;
  readonly expectedRunSequence: number;
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: ManifestState;
  readonly plan: PlanState;
  readonly checks: ReviewChecks;
}): Promise<ProducerEvidenceState | null> {
  const { relativePath, checks } = input;
  checks.check(input.manifest.entries.has(relativePath), 'PRODUCER_EVIDENCE_NOT_MANIFESTED', relativePath);
  const bytes = await readSnapshotBytes(input.snapshot, relativePath, checks, 'PRODUCER_EVIDENCE_MISSING');
  if (bytes === null) return null;
  const raw = parseJsonRecord(bytes, checks, 'PRODUCER_EVIDENCE_JSON_INVALID', relativePath);
  if (raw === null) return null;
  checks.check(raw['schemaVersion'] === PRODUCER_EVIDENCE_SCHEMA_VERSION, 'PRODUCER_EVIDENCE_SCHEMA_VERSION_INVALID', relativePath);
  const producerIdValue = stringField(raw, 'producerId');
  const producerId = isProducerId(producerIdValue) ? producerIdValue : null;
  checks.check(producerId !== null, 'PRODUCER_EVIDENCE_PRODUCER_ID_INVALID', relativePath);
  checks.check(raw['runId'] === input.expectedRunId, 'PRODUCER_EVIDENCE_RUN_ID_MISMATCH', relativePath);
  checks.check(raw['runSequence'] === input.expectedRunSequence, 'PRODUCER_EVIDENCE_RUN_SEQUENCE_MISMATCH', relativePath);
  const status = stringField(raw, 'status');
  checks.check(isEvidenceStatus(status), 'PRODUCER_EVIDENCE_STATUS_INVALID', relativePath);
  validateTimePair(raw, checks, relativePath);
  validateProducerCommandIdentity(raw['commandIdentity'], checks, relativePath);
  validateEnvironmentRefs(raw['environmentRefs'], checks, relativePath);
  const frozenCandidate = asRecord(raw['frozenInputRefs']);
  const frozenInputRefs = frozenCandidate ?? {};
  checks.check(frozenCandidate !== null, 'PRODUCER_FROZEN_INPUT_REFS_INVALID', relativePath);
  for (const [kind, value] of Object.entries(frozenInputRefs)) {
    checks.check(ABG_FROZEN_INPUT_KINDS.includes(kind as AbgFrozenInputKind), 'PRODUCER_FROZEN_INPUT_KIND_UNKNOWN', relativePath + '#/frozenInputRefs/' + kind);
    checks.check(typeof value === 'string' && value.trim().length > 0, 'PRODUCER_FROZEN_INPUT_INVALID', relativePath + '#/frozenInputRefs/' + kind);
    if (
      kind.endsWith('Sha256') ||
      kind === 'fixtureIdentity' ||
      kind === 'runtimeAuthoritySemanticDigest'
    ) {
      checks.check(typeof value === 'string' && isSha256(value), 'PRODUCER_FROZEN_INPUT_DIGEST_INVALID', relativePath + '#/frozenInputRefs/' + kind);
    }
  }
  const scenariosCandidate = asRecord(raw['scenarios']);
  const scenarios = scenariosCandidate ?? {};
  checks.check(scenariosCandidate !== null, 'PRODUCER_SCENARIOS_INVALID', relativePath);
  const assertionIds = new Set<string>();
  let assertionCount = 0;
  for (const [scenarioKey, candidate] of Object.entries(scenarios)) {
    const scenario = asRecord(candidate);
    const scenarioLocation = relativePath + '#/scenarios/' + scenarioKey;
    if (!checks.check(scenario !== null, 'PRODUCER_SCENARIO_INVALID', scenarioLocation) || scenario === null) continue;
    checks.check(scenario['scenarioId'] === scenarioKey, 'PRODUCER_SCENARIO_ID_MISMATCH', scenarioLocation);
    checks.check(scenario['producerId'] === producerId, 'PRODUCER_SCENARIO_PRODUCER_MISMATCH', scenarioLocation);
    const scenarioStatus = stringField(scenario, 'status');
    checks.check(isEvidenceStatus(scenarioStatus), 'PRODUCER_SCENARIO_STATUS_INVALID', scenarioLocation);
    checks.check(typeof scenario['title'] === 'string' && scenario['title'].trim().length > 0, 'PRODUCER_SCENARIO_TITLE_INVALID', scenarioLocation);
    for (const kind of ['requestIds', 'principalIds', 'governanceObjectIds', 'versionIds', 'ruleVersions'] as const) {
      parseStringArray(scenario[kind], checks, 'PRODUCER_REFERENCE_ARRAY_INVALID', scenarioLocation + '/' + kind);
    }
    const artifactDigests = parseStringArray(scenario['artifactDigests'], checks, 'PRODUCER_ARTIFACT_DIGESTS_INVALID', scenarioLocation + '/artifactDigests');
    for (const digest of artifactDigests) checks.check(isSha256(digest), 'PRODUCER_ARTIFACT_DIGEST_INVALID', scenarioLocation);
    const assertionsCandidate = asRecord(scenario['assertions']);
    const assertions = assertionsCandidate ?? {};
    checks.check(assertionsCandidate !== null, 'PRODUCER_ASSERTIONS_INVALID', scenarioLocation);
    for (const [assertionKey, assertionCandidate] of Object.entries(assertions)) {
      assertionCount += 1;
      const assertion = asRecord(assertionCandidate);
      const assertionLocation = scenarioLocation + '/assertions/' + assertionKey;
      if (!checks.check(assertion !== null, 'PRODUCER_ASSERTION_INVALID', assertionLocation) || assertion === null) continue;
      checks.check(assertion['assertionId'] === assertionKey, 'PRODUCER_ASSERTION_ID_MISMATCH', assertionLocation);
      checks.check(!assertionIds.has(assertionKey), 'PRODUCER_ASSERTION_DUPLICATE', assertionLocation);
      assertionIds.add(assertionKey);
      const gateId = stringField(assertion, 'gateId');
      checks.check(gateId !== null && matrixGateForAssertion(assertionKey) === gateId, 'PRODUCER_ASSERTION_GATE_MISMATCH', assertionLocation);
      const matrixEntry = gateId === null ? undefined : ABG_COVERAGE_MATRIX.find((entry) => entry.gateId === gateId);
      if (matrixEntry !== undefined && producerId !== null) {
        checks.check(matrixEntry.producerIds.includes(producerId), 'PRODUCER_ASSERTION_PRODUCER_MISMATCH', assertionLocation);
        checks.check(matrixEntry.scenarioIds.includes(scenarioKey), 'PRODUCER_ASSERTION_SCENARIO_MISMATCH', assertionLocation);
      }
      const assertionStatus = stringField(assertion, 'status');
      checks.check(isEvidenceStatus(assertionStatus), 'PRODUCER_ASSERTION_STATUS_INVALID', assertionLocation);
      checks.check(typeof assertion['description'] === 'string' && assertion['description'].trim().length > 0, 'PRODUCER_ASSERTION_DESCRIPTION_INVALID', assertionLocation);
      checks.check(!containsSensitiveData(assertion), 'PRODUCER_ASSERTION_SENSITIVE', assertionLocation);
      checks.check(
        assertionStatus !== 'PASSED' || assertion['failureCode'] === null,
        'PRODUCER_ASSERTION_PASSED_WITH_FAILURE_CODE',
        assertionLocation,
      );
      checks.check(
        assertionStatus === 'PASSED' || typeof assertion['failureCode'] === 'string',
        'PRODUCER_ASSERTION_FAILURE_CODE_REQUIRED',
        assertionLocation,
      );
      await validateEvidenceItems({
        value: assertion['evidenceItems'],
        producerEvidencePath: relativePath,
        assertionStatus,
        snapshot: input.snapshot,
        manifest: input.manifest,
        checks,
        location: assertionLocation,
      });
      if (scenarioStatus === 'PASSED') {
        checks.check(assertionStatus === 'PASSED', 'PRODUCER_SCENARIO_PASSED_WITH_FAILED_ASSERTION', assertionLocation);
      }
    }
    if (status === 'PASSED') {
      checks.check(scenarioStatus === 'PASSED', 'PRODUCER_PASSED_WITH_FAILED_SCENARIO', scenarioLocation);
    }
  }
  return {
    raw,
    producerId,
    frozenInputRefs,
    scenarios,
    scenarioCount: Object.keys(scenarios).length,
    assertionCount,
    status,
  };
}

function validateProducerCommandIdentity(value: unknown, checks: ReviewChecks, location: string): void {
  const command = asRecord(value);
  if (!checks.check(command !== null, 'PRODUCER_COMMAND_IDENTITY_INVALID', location) || command === null) return;
  checks.check(typeof command['executable'] === 'string' && command['executable'].trim().length > 0, 'PRODUCER_COMMAND_EXECUTABLE_INVALID', location);
  checks.check(Array.isArray(command['arguments']) && command['arguments'].every((item) => typeof item === 'string'), 'PRODUCER_COMMAND_ARGUMENTS_INVALID', location);
  checks.check(typeof command['workingDirectory'] === 'string' && isSafeRelativePath(command['workingDirectory']), 'PRODUCER_COMMAND_DIRECTORY_INVALID', location);
  checks.check(typeof command['commandDigest'] === 'string' && isSha256(command['commandDigest']), 'PRODUCER_COMMAND_DIGEST_INVALID', location);
  checks.check(!containsSensitiveData(command), 'PRODUCER_COMMAND_SENSITIVE', location);
}

function validateEnvironmentRefs(value: unknown, checks: ReviewChecks, location: string): void {
  const references = asRecord(value);
  if (!checks.check(references !== null, 'PRODUCER_ENVIRONMENT_REFS_INVALID', location) || references === null) return;
  for (const [name, digest] of Object.entries(references)) {
    checks.check(/^[A-Z][A-Z0-9_]*$/u.test(name), 'PRODUCER_ENVIRONMENT_NAME_INVALID', location);
    checks.check(!SENSITIVE_KEY_PATTERN.test(name), 'PRODUCER_ENVIRONMENT_SENSITIVE', location);
    checks.check(typeof digest === 'string' && isSha256(digest), 'PRODUCER_ENVIRONMENT_DIGEST_INVALID', location);
  }
}

async function validateEvidenceItems(input: {
  readonly value: unknown;
  readonly producerEvidencePath: string;
  readonly assertionStatus: string | null;
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: ManifestState;
  readonly checks: ReviewChecks;
  readonly location: string;
}): Promise<void> {
  const { value, checks, location } = input;
  if (!checks.check(Array.isArray(value) && value.length > 0, 'PRODUCER_EVIDENCE_ITEMS_REQUIRED', location) || !Array.isArray(value)) return;
  const identities = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const item = asRecord(candidate);
    const itemLocation = location + '/evidenceItems/' + index;
    if (!checks.check(item !== null, 'PRODUCER_EVIDENCE_ITEM_INVALID', itemLocation) || item === null) continue;
    checks.check(typeof item['artifactId'] === 'string' && item['artifactId'].trim().length > 0, 'PRODUCER_EVIDENCE_ITEM_ARTIFACT_ID_INVALID', itemLocation);
    const path = stringField(item, 'relativePath');
    const pathValid = checks.check(path !== null && isSafeRelativePath(path), 'PRODUCER_EVIDENCE_ITEM_PATH_UNSAFE', itemLocation);
    if (path !== null) checks.check(item['mediaType'] === mediaTypeFor(path), 'PRODUCER_EVIDENCE_ITEM_MEDIA_TYPE_MISMATCH', itemLocation);
    checks.check(isNonNegativeInteger(item['byteLength']), 'PRODUCER_EVIDENCE_ITEM_BYTE_LENGTH_INVALID', itemLocation);
    checks.check(typeof item['sha256'] === 'string' && isSha256(item['sha256']), 'PRODUCER_EVIDENCE_ITEM_SHA256_INVALID', itemLocation);
    const pointer = stringField(item, 'jsonPointer');
    const pointerValid = checks.check(pointer !== null && isStrictJsonPointer(pointer), 'PRODUCER_EVIDENCE_ITEM_POINTER_INVALID', itemLocation);
    checks.check(typeof item['claimDigest'] === 'string' && isSha256(item['claimDigest']), 'PRODUCER_EVIDENCE_ITEM_CLAIM_DIGEST_INVALID', itemLocation);
    const identity = String(item['artifactId']) + '\0' + String(item['jsonPointer']);
    checks.check(!identities.has(identity), 'PRODUCER_EVIDENCE_ITEM_DUPLICATE', itemLocation);
    identities.add(identity);
    if (!pathValid || path === null) continue;

    const resolvedPaths = resolveEvidenceItemPaths(
      input.producerEvidencePath,
      path,
      input.snapshot,
      input.manifest,
    );
    checks.check(resolvedPaths.length > 0, 'PRODUCER_EVIDENCE_ITEM_FILE_MISSING', itemLocation);
    checks.check(resolvedPaths.length <= 1, 'PRODUCER_EVIDENCE_ITEM_PATH_AMBIGUOUS', itemLocation);
    const resolvedPath = resolvedPaths[0];
    if (resolvedPath === undefined || resolvedPaths.length !== 1) continue;
    checks.check(input.manifest.entries.has(resolvedPath), 'PRODUCER_EVIDENCE_ITEM_NOT_MANIFESTED', resolvedPath);
    const file = input.snapshot.files.get(resolvedPath);
    checks.check(file !== undefined, 'PRODUCER_EVIDENCE_ITEM_FILE_MISSING', resolvedPath);
    if (file === undefined) continue;
    checks.check(item['byteLength'] === file.byteLength, 'PRODUCER_EVIDENCE_ITEM_BYTE_LENGTH_MISMATCH', itemLocation);
    checks.check(item['sha256'] === file.sha256, 'PRODUCER_EVIDENCE_ITEM_SHA256_MISMATCH', itemLocation);
    const manifestEntry = input.manifest.entries.get(resolvedPath);
    if (manifestEntry !== undefined) {
      checks.check(item['mediaType'] === manifestEntry.mediaType, 'PRODUCER_EVIDENCE_ITEM_MANIFEST_MEDIA_TYPE_MISMATCH', itemLocation);
      checks.check(item['byteLength'] === manifestEntry.byteLength, 'PRODUCER_EVIDENCE_ITEM_MANIFEST_BYTE_LENGTH_MISMATCH', itemLocation);
      checks.check(item['sha256'] === manifestEntry.sha256, 'PRODUCER_EVIDENCE_ITEM_MANIFEST_SHA256_MISMATCH', itemLocation);
    }
    if (!pointerValid || pointer === null || item['mediaType'] !== 'application/json') continue;
    const bytes = await readSnapshotBytes(
      input.snapshot,
      resolvedPath,
      checks,
      'PRODUCER_EVIDENCE_ITEM_FILE_MISSING',
    );
    if (bytes === null) continue;
    let artifact: unknown;
    try {
      artifact = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      checks.fail('PRODUCER_EVIDENCE_ITEM_JSON_INVALID', resolvedPath);
      continue;
    }
    const resolvedClaim = resolveJsonPointer(artifact, pointer);
    checks.check(resolvedClaim.found, 'PRODUCER_EVIDENCE_ITEM_POINTER_NOT_FOUND', itemLocation);
    if (
      resolvedClaim.found &&
      input.assertionStatus === 'PASSED' &&
      isEvidenceStatusValue(resolvedClaim.value)
    ) {
      checks.check(
        resolvedClaim.value === 'PASSED',
        'PRODUCER_EVIDENCE_ITEM_STATUS_NOT_PASSED',
        itemLocation,
      );
    }
  }
}

function resolveEvidenceItemPaths(
  producerEvidencePath: string,
  itemPath: string,
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
): readonly string[] {
  const prefixes = [''];
  let prefix = posix.dirname(producerEvidencePath);
  while (prefix !== '.' && prefix !== '') {
    prefixes.push(prefix);
    const parent = posix.dirname(prefix);
    if (parent === prefix) break;
    prefix = parent;
  }
  const candidates = new Set<string>();
  for (const candidatePrefix of prefixes) {
    const candidate = joinSafeRelative(candidatePrefix, itemPath);
    if (
      candidate !== null &&
      (snapshot.files.has(candidate) || manifest.entries.has(candidate))
    ) {
      candidates.add(candidate);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

async function validateEvidenceReference(input: {
  readonly reference: Readonly<Record<string, unknown>>;
  readonly selector: AbgCoverageMatrixEntry['evidenceSelectors'][number];
  readonly entry: AbgCoverageMatrixEntry;
  readonly index: ProducerIndexState;
  readonly expectedRunId: string;
  readonly expectedRunSequence: number;
  readonly snapshot: EvidenceSnapshot;
  readonly manifest: ManifestState;
  readonly plan: PlanState;
  readonly checks: ReviewChecks;
  readonly producerEvidence: Map<string, Promise<ProducerEvidenceState | null>>;
  readonly proofPath: string;
}): Promise<SelectedClaimState | null> {
  const { reference, selector, checks } = input;
  const location = input.proofPath + '#' + selector.assertionId;
  const relativePath = stringField(reference, 'relativePath');
  checks.check(relativePath !== null && isSafeRelativePath(relativePath), 'EVIDENCE_REFERENCE_PATH_UNSAFE', location);
  checks.check(reference['artifactId'] === selector.artifactId, 'EVIDENCE_REFERENCE_ARTIFACT_ID_MISMATCH', location);
  checks.check(reference['mediaType'] === 'application/json', 'EVIDENCE_REFERENCE_MEDIA_TYPE_INVALID', location);
  checks.check(isNonNegativeInteger(reference['byteLength']), 'EVIDENCE_REFERENCE_BYTE_LENGTH_INVALID', location);
  checks.check(typeof reference['sha256'] === 'string' && isSha256(reference['sha256']), 'EVIDENCE_REFERENCE_SHA256_INVALID', location);
  checks.check(typeof reference['selectedClaimDigest'] === 'string' && isSha256(reference['selectedClaimDigest']), 'SELECTED_CLAIM_DIGEST_INVALID', location);
  const indexEntry = input.index.entries.get(selector.producerId);
  checks.check(indexEntry !== undefined, 'PRODUCER_INDEX_ENTRY_MISSING', location);
  if (relativePath === null || indexEntry === undefined) return null;
  checks.check(relativePath === indexEntry.resolvedRelativePath, 'EVIDENCE_REFERENCE_SOURCE_MISMATCH', location);
  checks.check(input.manifest.entries.has(relativePath), 'EVIDENCE_REFERENCE_NOT_MANIFESTED', relativePath);
  const file = input.snapshot.files.get(relativePath);
  checks.check(file !== undefined, 'EVIDENCE_REFERENCE_FILE_MISSING', relativePath);
  if (file !== undefined) {
    checks.check(reference['byteLength'] === file.byteLength, 'EVIDENCE_REFERENCE_BYTE_LENGTH_MISMATCH', location);
    checks.check(reference['sha256'] === file.sha256, 'EVIDENCE_REFERENCE_SHA256_MISMATCH', location);
    checks.check(indexEntry.sha256 === file.sha256, 'EVIDENCE_REFERENCE_INDEX_SHA256_MISMATCH', location);
  }
  let evidencePromise = input.producerEvidence.get(relativePath);
  if (evidencePromise === undefined) {
    evidencePromise = validateProducerEvidence({
      relativePath,
      expectedRunId: input.expectedRunId,
      expectedRunSequence: input.expectedRunSequence,
      snapshot: input.snapshot,
      manifest: input.manifest,
      plan: input.plan,
      checks,
    });
    input.producerEvidence.set(relativePath, evidencePromise);
  }
  const evidence = await evidencePromise;
  if (evidence === null) return null;
  checks.check(evidence.producerId === selector.producerId, 'CLAIM_PRODUCER_ID_MISMATCH', location);
  const scenario = asRecord(evidence.scenarios[selector.scenarioId]);
  checks.check(scenario !== null, 'SELECTOR_SCENARIO_NOT_FOUND', location);
  if (scenario === null) return null;
  checks.check(scenario['scenarioId'] === selector.scenarioId, 'CLAIM_SCENARIO_ID_MISMATCH', location);
  checks.check(scenario['producerId'] === selector.producerId, 'CLAIM_SCENARIO_PRODUCER_MISMATCH', location);
  const assertions = asRecord(scenario['assertions']);
  const assertion = assertions === null ? null : asRecord(assertions[selector.assertionId]);
  checks.check(assertion !== null, 'SELECTOR_ASSERTION_NOT_FOUND', location);
  if (assertion === null) return null;
  checks.check(assertion['gateId'] === input.entry.gateId, 'CLAIM_GATE_ID_MISMATCH', location);
  checks.check(assertion['assertionId'] === selector.assertionId, 'CLAIM_ASSERTION_ID_MISMATCH', location);
  checks.check(assertion['status'] === 'PASSED', 'CLAIM_STATUS_NOT_PASSED', location);
  const resolved = resolveJsonPointer(evidence.raw, selector.jsonPointer);
  checks.check(resolved.found, 'SELECTOR_POINTER_NOT_FOUND', location);
  checks.check(resolved.value === 'PASSED', 'SELECTOR_POINTER_STATUS_NOT_PASSED', location);
  const expectedClaimDigest = digestJson({
    producerId: evidence.raw['producerId'],
    gateId: assertion['gateId'],
    scenarioId: scenario['scenarioId'],
    assertionId: assertion['assertionId'],
    status: assertion['status'],
    requestIds: scenario['requestIds'],
    principalIds: scenario['principalIds'],
    governanceObjectIds: scenario['governanceObjectIds'],
    versionIds: scenario['versionIds'],
    ruleVersions: scenario['ruleVersions'],
    artifactDigests: scenario['artifactDigests'],
    frozenInputRefs: evidence.raw['frozenInputRefs'],
    evidenceItems: assertion['evidenceItems'],
  });
  checks.check(reference['selectedClaimDigest'] === expectedClaimDigest, 'SELECTED_CLAIM_DIGEST_MISMATCH', location);
  return { evidence, scenario };
}

function validateGateReferences(
  proof: Readonly<Record<string, unknown>>,
  entry: AbgCoverageMatrixEntry,
  selected: readonly SelectedClaimState[],
  plan: PlanState,
  checks: ReviewChecks,
  location: string,
): void {
  const collected: Record<string, string[]> = {
    requestIds: [],
    principalIds: [],
    governanceObjectIds: [],
    versionIds: [],
    ruleVersions: [],
    artifactDigests: [],
  };
  const frozenInputs: Partial<Record<AbgFrozenInputKind, string>> = {};
  for (const claim of selected) {
    for (const kind of ['requestIds', 'principalIds', 'governanceObjectIds', 'versionIds', 'ruleVersions', 'artifactDigests'] as const) {
      for (const value of stringArrayValue(claim.scenario[kind])) {
        if (!collected[kind]!.includes(value)) collected[kind]!.push(value);
      }
    }
    for (const kind of entry.requiredFrozenInputs) {
      const value = claim.evidence.frozenInputRefs[kind];
      if (typeof value !== 'string') continue;
      const existing = frozenInputs[kind];
      checks.check(existing === undefined || existing === value, 'GATE_FROZEN_INPUT_CONFLICT', location + '#' + kind);
      frozenInputs[kind] = value;
      if (plan.frozenInputs !== null) {
        checks.check(value === plan.frozenInputs[kind], 'GATE_FROZEN_INPUT_PLAN_MISMATCH', location + '#' + kind);
      }
    }
  }
  for (const kind of entry.requiredFrozenInputs) {
    checks.check(typeof frozenInputs[kind] === 'string', 'GATE_FROZEN_INPUT_MISSING', location + '#' + kind);
  }
  const completeFrozenInputs: Partial<Record<AbgFrozenInputKind, string>> = {};
  for (const kind of entry.requiredFrozenInputs) {
    const value = frozenInputs[kind];
    if (value !== undefined) completeFrozenInputs[kind] = value;
  }
  const frozenInputDigests = [...new Set(Object.values(completeFrozenInputs).filter(isSha256))];
  for (const kind of ['requestIds', 'principalIds', 'governanceObjectIds', 'versionIds', 'ruleVersions', 'artifactDigests'] as const) {
    const actual = parseStringArray(proof[kind], checks, 'GATE_REFERENCE_ARRAY_INVALID', location + '#' + kind);
    checks.check(arrayEqual(actual, collected[kind]!), 'GATE_REFERENCE_ARRAY_MISMATCH', location + '#' + kind);
  }
  const actualFrozenDigests = parseStringArray(proof['frozenInputDigests'], checks, 'GATE_FROZEN_INPUT_DIGESTS_INVALID', location);
  checks.check(arrayEqual(actualFrozenDigests, frozenInputDigests), 'GATE_FROZEN_INPUT_DIGESTS_MISMATCH', location);
  const proofFrozenInputs = asRecord(proof['frozenInputs']);
  checks.check(proofFrozenInputs !== null && jsonEqual(proofFrozenInputs, completeFrozenInputs), 'GATE_FROZEN_INPUTS_MISMATCH', location);
  const references: Readonly<Record<string, readonly string[]>> = {
    ...collected,
    frozenInputDigests,
  };
  for (const kind of entry.requiredReferenceKinds) {
    const values = references[kind] ?? [];
    checks.check(values.length > 0, 'GATE_REQUIRED_REFERENCE_MISSING', location + '#' + kind);
    if (kind === 'frozenInputDigests' || kind === 'artifactDigests') {
      for (const value of values) checks.check(isSha256(value), 'GATE_REQUIRED_REFERENCE_DIGEST_INVALID', location + '#' + kind);
    }
  }
}

async function validateFormalLifecycle(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  summary: SummaryState,
  checks: ReviewChecks,
): Promise<void> {
  const requiredRuntimePorts = formalRuntimePorts(formalRuntimeAuthority().authority);
  const requiredFiles = [
    ['runtime/preflight.json', 'FORMAL_LIFECYCLE_PREFLIGHT_MISSING'],
    ['runtime/runtime-authority-snapshot.json', 'FORMAL_LIFECYCLE_RUNTIME_AUTHORITY_SNAPSHOT_MISSING'],
    ['runtime/resources-started.json', 'FORMAL_LIFECYCLE_RESOURCES_STARTED_MISSING'],
    ['runtime/producer-evidence-snapshot.json', 'FORMAL_LIFECYCLE_PRODUCER_EVIDENCE_SNAPSHOT_MISSING'],
    ['runtime/failure-summary.json', 'FORMAL_LIFECYCLE_FAILURE_SUMMARY_MISSING'],
    ['runtime/resources-final.json', 'FORMAL_LIFECYCLE_RESOURCES_FINAL_MISSING'],
    ['runtime/cleanup.json', 'FORMAL_LIFECYCLE_CLEANUP_MISSING'],
    ['runtime/terminal-conclusion.json', 'FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING'],
    ['runtime/final-outcome.json', 'FORMAL_LIFECYCLE_FINAL_OUTCOME_MISSING'],
    ['gates/ABG-40/producer/result.json', 'ABG40_GATE_PROOF_MISSING'],
    ['formal-run/producer-evidence.json', 'ABG40_FORMAL_PRODUCER_EVIDENCE_MISSING'],
    ['producer-evidence-index.json', 'FORMAL_TOP_LEVEL_PRODUCER_INDEX_MISSING'],
  ] as const;
  for (const [path, code] of requiredFiles) {
    checks.check(manifest.entries.has(path), code, path);
  }
  for (const path of [
    'runtime/manifest-failure.json',
    'runtime/final-evidence-failure.json',
    'runtime/pre-cleanup-evidence-failure.json',
  ]) {
    checks.check(!snapshot.files.has(path), 'FORMAL_FAILURE_ARTIFACT_PRESENT', path);
  }
  checks.check(
    !snapshot.files.has('formal-run/preliminary-conclusion.json'),
    'ABG40_PRELIMINARY_CONCLUSION_FORBIDDEN',
    'formal-run/preliminary-conclusion.json',
  );

  const preflight = await readLifecycleRecord(snapshot, 'runtime/preflight.json', checks,
    'FORMAL_LIFECYCLE_PREFLIGHT_MISSING');
  const runtimeAuthoritySnapshot = await readLifecycleRecord(
    snapshot,
    'runtime/runtime-authority-snapshot.json',
    checks,
    'FORMAL_LIFECYCLE_RUNTIME_AUTHORITY_SNAPSHOT_MISSING',
  );
  const startedResources = await readLifecycleRecord(snapshot, 'runtime/resources-started.json', checks,
    'FORMAL_LIFECYCLE_RESOURCES_STARTED_MISSING');
  const producerSnapshot = await readLifecycleRecord(
    snapshot,
    'runtime/producer-evidence-snapshot.json',
    checks,
    'FORMAL_LIFECYCLE_PRODUCER_EVIDENCE_SNAPSHOT_MISSING',
  );
  const failureSummary = await readLifecycleRecord(snapshot, 'runtime/failure-summary.json', checks,
    'FORMAL_LIFECYCLE_FAILURE_SUMMARY_MISSING');
  const finalResources = await readLifecycleRecord(snapshot, 'runtime/resources-final.json', checks,
    'FORMAL_LIFECYCLE_RESOURCES_FINAL_MISSING');
  const cleanup = await readLifecycleRecord(snapshot, 'runtime/cleanup.json', checks,
    'FORMAL_LIFECYCLE_CLEANUP_MISSING');
  const terminal = await readLifecycleRecord(snapshot, 'runtime/terminal-conclusion.json', checks,
    'FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING');
  const finalOutcome = await readLifecycleRecord(snapshot, 'runtime/final-outcome.json', checks,
    'FORMAL_LIFECYCLE_FINAL_OUTCOME_MISSING');
  const formalProducer = await readLifecycleRecord(snapshot, 'formal-run/producer-evidence.json', checks,
    'ABG40_FORMAL_PRODUCER_EVIDENCE_MISSING');
  const abg40Proof = await readLifecycleRecord(snapshot, 'gates/ABG-40/producer/result.json', checks,
    'ABG40_GATE_PROOF_MISSING');

  const expectedIdentity = {
    runId: summary.runId,
    runSequence: summary.runSequence,
    gitCommitSha: stringField(summary.raw, 'gitCommitSha'),
    runtimeNamespace: stringField(summary.raw, 'runtimeNamespace'),
  };
  checks.check(
    expectedIdentity.runId !== null &&
      expectedIdentity.runSequence !== null &&
      expectedIdentity.gitCommitSha !== null &&
      expectedIdentity.runtimeNamespace !== null,
    'FORMAL_SUMMARY_RUN_IDENTITY_INCOMPLETE',
    'abg-results.json',
  );
  for (const [path, record] of [
    ['runtime/preflight.json', preflight],
    ['runtime/runtime-authority-snapshot.json', runtimeAuthoritySnapshot],
    ['runtime/resources-started.json', startedResources],
    ['runtime/producer-evidence-snapshot.json', producerSnapshot],
    ['runtime/failure-summary.json', failureSummary],
    ['runtime/resources-final.json', finalResources],
    ['runtime/cleanup.json', cleanup],
    ['runtime/terminal-conclusion.json', terminal],
    ['runtime/final-outcome.json', finalOutcome],
  ] as const) {
    if (record !== null) validateNestedRunIdentity(record, expectedIdentity, checks, path);
  }

  if (preflight !== null) {
    checks.check(preflight['schemaVersion'] === 'phase-01.formal-preflight.v1', 'FORMAL_PREFLIGHT_SCHEMA_INVALID', 'runtime/preflight.json');
    checks.check(preflight['status'] === 'PASSED', 'FORMAL_PREFLIGHT_STATUS_NOT_PASSED', 'runtime/preflight.json#/status');
    checks.check(
      preflight['runtimeAuthoritySha256'] === summary.raw['runtimeAuthoritySha256'],
      'RUNTIME_AUTHORITY_SHA_MISMATCH',
      'runtime/preflight.json#/runtimeAuthoritySha256',
    );
    checks.check(
      preflight['runtimeAuthoritySemanticDigest'] ===
        summary.raw['runtimeAuthoritySemanticDigest'],
      'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH',
      'runtime/preflight.json#/runtimeAuthoritySemanticDigest',
    );
  }
  if (runtimeAuthoritySnapshot !== null) {
    try {
      const parsedSnapshot = parseFormalRuntimeAuthoritySnapshot(runtimeAuthoritySnapshot);
      checks.check(
        parsedSnapshot.runtimeAuthoritySha256 === preflight?.['runtimeAuthoritySha256'] &&
          parsedSnapshot.runtimeAuthoritySha256 === summary.raw['runtimeAuthoritySha256'],
        'FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SHA_MISMATCH',
        'runtime/runtime-authority-snapshot.json#/runtimeAuthoritySha256',
      );
      checks.check(
        parsedSnapshot.runtimeAuthoritySemanticDigest ===
            preflight?.['runtimeAuthoritySemanticDigest'] &&
          parsedSnapshot.runtimeAuthoritySemanticDigest ===
            summary.raw['runtimeAuthoritySemanticDigest'],
        'FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_SEMANTIC_DIGEST_MISMATCH',
        'runtime/runtime-authority-snapshot.json#/runtimeAuthoritySemanticDigest',
      );
    } catch {
      checks.fail(
        'FORMAL_RUNTIME_AUTHORITY_SNAPSHOT_INVALID',
        'runtime/runtime-authority-snapshot.json',
      );
    }
  }
  if (startedResources !== null) {
    checks.check(startedResources['schemaVersion'] === 'phase-01.formal-runtime-resources.v1', 'FORMAL_RESOURCES_STARTED_SCHEMA_INVALID', 'runtime/resources-started.json');
    parseRuntimeResourceArray(
      startedResources['resources'],
      checks,
      'FORMAL_STARTED_RESOURCES_INVALID',
      'runtime/resources-started.json#/resources',
    );
    parseRuntimePortArray(
      startedResources['ports'],
      checks,
      'FORMAL_STARTED_PORTS_INVALID',
      'runtime/resources-started.json#/ports',
    );
  }
  let producerProtocolEvidenceCount = 0;
  if (producerSnapshot !== null) {
    producerProtocolEvidenceCount = validateProducerEvidenceSnapshot(
      producerSnapshot,
      snapshot,
      manifest,
      checks,
    );
  }
  let producerEvidencePersistedBeforeCleanup = false;
  if (failureSummary !== null) {
    checks.check(failureSummary['schemaVersion'] === 'phase-01.formal-failure-summary.v1', 'FORMAL_FAILURE_SUMMARY_SCHEMA_INVALID', 'runtime/failure-summary.json');
    checks.check(failureSummary['statusBeforeCleanup'] === 'PASSED', 'FORMAL_FAILURE_SUMMARY_STATUS_NOT_PASSED', 'runtime/failure-summary.json#/statusBeforeCleanup');
    producerEvidencePersistedBeforeCleanup = failureSummary['evidencePersistedBeforeCleanup'] === true;
    checks.check(producerEvidencePersistedBeforeCleanup, 'FORMAL_FAILURE_SUMMARY_EVIDENCE_NOT_PERSISTED', 'runtime/failure-summary.json#/evidencePersistedBeforeCleanup');
    const failureSummaryCodes = parseStringArray(
      failureSummary['failureCodes'],
      checks,
      'FORMAL_FAILURE_SUMMARY_CODES_INVALID',
      'runtime/failure-summary.json#/failureCodes',
    );
    checks.check(failureSummaryCodes.length === 0, 'FORMAL_FAILURE_SUMMARY_HAS_FAILURE_CODES', 'runtime/failure-summary.json#/failureCodes');
  }
  let cleanupResidualResources: readonly Readonly<Record<string, unknown>>[] = [];
  let cleanupOccupiedPorts: readonly number[] = [];
  if (cleanup !== null) {
    checks.check(cleanup['schemaVersion'] === 'phase-01.formal-cleanup.v1', 'FORMAL_CLEANUP_SCHEMA_INVALID', 'runtime/cleanup.json');
    checks.check(cleanup['status'] === 'PASSED', 'FORMAL_CLEANUP_STATUS_NOT_PASSED', 'runtime/cleanup.json#/status');
    cleanupResidualResources = parseRuntimeResourceArray(
      cleanup['residualResources'],
      checks,
      'FORMAL_CLEANUP_RESIDUAL_RESOURCES_INVALID',
      'runtime/cleanup.json#/residualResources',
    );
    checks.check(cleanupResidualResources.length === 0, 'FORMAL_CLEANUP_RESIDUAL_RESOURCES_PRESENT', 'runtime/cleanup.json#/residualResources');
    cleanupOccupiedPorts = parseNumberArray(
      cleanup['occupiedPorts'],
      checks,
      'FORMAL_CLEANUP_OCCUPIED_PORTS_INVALID',
      'runtime/cleanup.json#/occupiedPorts',
    );
    checks.check(cleanupOccupiedPorts.length === 0, 'FORMAL_CLEANUP_OCCUPIED_PORTS_PRESENT', 'runtime/cleanup.json#/occupiedPorts');
    checks.check(cleanup['pruneCommandsInvoked'] === false, 'FORMAL_PRUNE_COMMAND_INVOKED', 'runtime/cleanup.json#/pruneCommandsInvoked');
    const cleanupAuthority = asRecord(cleanup['runtimeAuthority']);
    checks.check(
      cleanupAuthority !== null &&
        cleanupAuthority['expectedSha256'] === summary.raw['runtimeAuthoritySha256'] &&
        cleanupAuthority['observedAfterSha256'] === summary.raw['runtimeAuthoritySha256'],
      'RUNTIME_AUTHORITY_SHA_MISMATCH',
      'runtime/cleanup.json#/runtimeAuthority',
    );
    checks.check(
      cleanupAuthority !== null &&
        cleanupAuthority['expectedSemanticDigest'] ===
          summary.raw['runtimeAuthoritySemanticDigest'] &&
        cleanupAuthority['observedAfterSemanticDigest'] ===
          summary.raw['runtimeAuthoritySemanticDigest'],
      'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH',
      'runtime/cleanup.json#/runtimeAuthority',
    );
    checks.check(
      cleanupAuthority?.['stable'] === true,
      'RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP',
      'runtime/cleanup.json#/runtimeAuthority/stable',
    );
    const restartFindings = parseRecordArray(
      cleanup['restartPolicyFindings'],
      checks,
      'FORMAL_CLEANUP_RESTART_POLICY_FINDINGS_INVALID',
      'runtime/cleanup.json#/restartPolicyFindings',
    );
    checks.check(
      restartFindings.every((finding) =>
        finding['expected'] === 'no' && finding['actual'] === 'no' &&
          finding['status'] === 'PASSED'),
      'FORMAL_CLEANUP_RESTART_POLICY_MISMATCH',
      'runtime/cleanup.json#/restartPolicyFindings',
    );
    for (const [field, code] of [
      ['dockerSecondAuthorityFindings', 'FORMAL_CLEANUP_SECOND_RUNTIME_AUTHORITY_PRESENT'],
      ['partialStartupRecoveryFindings', 'FORMAL_CLEANUP_PARTIAL_RECOVERY_INCOMPLETE'],
      ['persistenceFindings', 'FORMAL_CLEANUP_PERSISTENT_UNIT_PRESENT'],
    ] as const) {
      const findings = parseStringArray(
        cleanup[field],
        checks,
        'FORMAL_CLEANUP_FINDINGS_INVALID',
        `runtime/cleanup.json#/${field}`,
      );
      checks.check(findings.length === 0, code, `runtime/cleanup.json#/${field}`);
    }
    checks.check(
      jsonEqual(cleanup['residualCounts'], {
        process: 0,
        container: 0,
        volume: 0,
        network: 0,
      }),
      'FORMAL_CLEANUP_RESIDUAL_COUNTS_NONZERO',
      'runtime/cleanup.json#/residualCounts',
    );
  }
  let finalResourceRecords: readonly Readonly<Record<string, unknown>>[] = [];
  let finalPortRecords: readonly Readonly<Record<string, unknown>>[] = [];
  if (finalResources !== null) {
    checks.check(finalResources['schemaVersion'] === 'phase-01.formal-runtime-resources.v1', 'FORMAL_RESOURCES_FINAL_SCHEMA_INVALID', 'runtime/resources-final.json');
    finalResourceRecords = parseRuntimeResourceArray(
      finalResources['resources'],
      checks,
      'FORMAL_FINAL_RESOURCES_INVALID',
      'runtime/resources-final.json#/resources',
    );
    for (const resourceType of ['container', 'volume', 'network'] as const) {
      checks.check(
        !finalResourceRecords.some((resource) => resource['present'] === true && resource['resourceType'] === resourceType),
        `FORMAL_RESIDUAL_${resourceType.toUpperCase()}_PRESENT`,
        'runtime/resources-final.json#/resources',
      );
    }
    checks.check(
      !finalResourceRecords.some((resource) => resource['present'] === true),
      'FORMAL_RESIDUAL_RESOURCE_PRESENT',
      'runtime/resources-final.json#/resources',
    );
    finalPortRecords = parseRuntimePortArray(
      finalResources['ports'],
      checks,
      'FORMAL_FINAL_PORTS_INVALID',
      'runtime/resources-final.json#/ports',
    );
    for (const port of requiredRuntimePorts) {
      const matches = finalPortRecords.filter((record) => record['port'] === port);
      checks.check(matches.length === 1, 'FORMAL_REQUIRED_PORT_OBSERVATION_MISSING', `runtime/resources-final.json#/ports/${port}`);
      const observation = matches[0];
      if (observation === undefined) continue;
      checks.check(observation['occupied'] === false, 'FORMAL_REQUIRED_PORT_OCCUPIED', `runtime/resources-final.json#/ports/${port}`);
      checks.check(observation['verificationError'] === null, 'FORMAL_REQUIRED_PORT_VERIFICATION_ERROR', `runtime/resources-final.json#/ports/${port}`);
    }
  }
  const residualResources = uniqueLifecycleResources([
    ...cleanupResidualResources,
    ...finalResourceRecords.filter((resource) => resource['present'] === true),
  ]);
  const residualContainerCount = residualResources.filter((resource) =>
    resource['resourceType'] === 'container').length;
  const residualVolumeCount = residualResources.filter((resource) =>
    resource['resourceType'] === 'volume').length;
  const residualNetworkCount = residualResources.filter((resource) =>
    resource['resourceType'] === 'network').length;
  const occupiedPortSet = new Set([
    ...cleanupOccupiedPorts,
    ...finalPortRecords.filter((record) => record['occupied'] === true)
      .map((record) => Number(record['port'])),
  ]);
  const occupiedRequiredPorts = requiredRuntimePorts.filter((port) => occupiedPortSet.has(port));
  const requiredPortsObserved = requiredRuntimePorts.filter((port) =>
    finalPortRecords.some((record) => record['port'] === port));
  const requiredPortObservationFailures = finalPortRecords
    .filter((record) =>
      requiredRuntimePorts.some((port) => port === record['port']) &&
      record['verificationError'] !== null)
    .map((record) => ({
      port: record['port'],
      verificationError: record['verificationError'],
    }));
  const summaryResults = parseRecordArray(
    summary.raw['results'],
    checks,
    'FORMAL_SUMMARY_RESULTS_INVALID',
    'abg-results.json#/results',
  );
  const nonFormalResults = summaryResults.slice(0, 39);
  const nonFormalPassedCount = nonFormalResults.filter((result) => result['status'] === 'PASSED').length;
  const nonFormalFailedCount = nonFormalResults.length - nonFormalPassedCount;
  const terminalLifecycleExpected = {
    preflightStatus: 'PASSED',
    setupStatus: 'PASSED',
    nonFormalPassedCount: 39,
    cleanupStatus: 'PASSED',
    residualResourceCount: 0,
    occupiedRequiredPorts: [],
    requiredPortsObserved: requiredRuntimePorts,
    pruneCommandsInvoked: false,
  };
  const terminalLifecycleActual = {
    preflightStatus: preflight?.['status'] ?? null,
    setupStatus: summary.raw['setupStatus'],
    nonFormalGateCount: nonFormalResults.length,
    nonFormalPassedCount,
    nonFormalFailedCount,
    cleanupStatus: cleanup?.['status'] ?? null,
    residualResourceCount: residualResources.length,
    occupiedRequiredPorts,
    requiredPortsObserved,
    requiredPortObservationFailures,
    pruneCommandsInvoked: cleanup?.['pruneCommandsInvoked'] ?? null,
  };
  const sealEligibilityExpected = {
    producerEvidencePersistedBeforeCleanup: true,
    producerProtocolEvidenceCountMinimum: 1,
    frozenInputsStableAfterCleanup: true,
    authorityIdentityStableAfterCleanup: true,
    runtimeAuthorityDigestValid: true,
    runtimeAuthorityStableAfterCleanup: true,
    producerSourceManifestStableAfterCleanup: true,
    outputDirectoryExclusive: true,
  };
  const sealEligibilityActual = {
    producerEvidencePersistedBeforeCleanup,
    producerProtocolEvidenceCount,
    producerSourceManifestSha256: summary.raw['producerSourceManifestSha256'],
    frozenInputsStableAfterCleanup: summary.raw['frozenInputsStableAfterCleanup'],
    authorityIdentityStableAfterCleanup: summary.raw['authorityIdentityStableAfterCleanup'],
    runtimeAuthoritySha256: summary.raw['runtimeAuthoritySha256'],
    runtimeAuthoritySemanticDigest: summary.raw['runtimeAuthoritySemanticDigest'],
    runtimeAuthorityStableAfterCleanup:
      summary.raw['runtimeAuthorityStableAfterCleanup'],
    producerSourceManifestStableAfterCleanup:
      summary.raw['producerSourceManifestStableAfterCleanup'],
    outputDirectoryExclusive: summary.raw['outputDirectoryExclusive'],
  };
  if (terminal !== null) {
    checks.check(terminal['schemaVersion'] === TERMINAL_CONCLUSION_SCHEMA_VERSION, 'FORMAL_TERMINAL_CONCLUSION_SCHEMA_INVALID', 'runtime/terminal-conclusion.json');
    const terminalStartedAt = stringField(terminal, 'startedAt');
    const terminalCompletedAt = stringField(terminal, 'completedAt');
    checks.check(terminalStartedAt !== null && isLocalDateTime(terminalStartedAt), 'FORMAL_TERMINAL_STARTED_AT_INVALID', 'runtime/terminal-conclusion.json#/startedAt');
    checks.check(terminalCompletedAt !== null && isLocalDateTime(terminalCompletedAt), 'FORMAL_TERMINAL_COMPLETED_AT_INVALID', 'runtime/terminal-conclusion.json#/completedAt');
    if (terminalStartedAt !== null && terminalCompletedAt !== null) {
      checks.check(terminalStartedAt <= terminalCompletedAt, 'FORMAL_TERMINAL_TIME_ORDER_INVALID', 'runtime/terminal-conclusion.json');
      checks.check(terminalStartedAt === summary.raw['startedAt'], 'FORMAL_TERMINAL_STARTED_AT_MISMATCH', 'runtime/terminal-conclusion.json#/startedAt');
      checks.check(terminalCompletedAt <= String(summary.raw['completedAt']), 'FORMAL_TERMINAL_COMPLETED_AT_MISMATCH', 'runtime/terminal-conclusion.json#/completedAt');
    }
    checks.check(terminal['status'] === 'PASSED', 'FORMAL_TERMINAL_CONCLUSION_STATUS_NOT_PASSED', 'runtime/terminal-conclusion.json#/status');
    checks.check(terminal['sealEligible'] === true, 'FORMAL_TERMINAL_SEAL_NOT_ELIGIBLE', 'runtime/terminal-conclusion.json#/sealEligible');
    checks.check(terminal['preflightStatus'] === terminalLifecycleActual.preflightStatus, 'FORMAL_TERMINAL_PREFLIGHT_STATUS_NOT_PASSED', 'runtime/terminal-conclusion.json#/preflightStatus');
    checks.check(terminal['setupStatus'] === terminalLifecycleActual.setupStatus, 'FORMAL_TERMINAL_SETUP_STATUS_NOT_PASSED', 'runtime/terminal-conclusion.json#/setupStatus');
    checks.check(
      terminal['nonFormalGateCount'] === terminalLifecycleActual.nonFormalGateCount &&
        terminal['nonFormalPassedCount'] === terminalLifecycleActual.nonFormalPassedCount &&
        terminal['nonFormalFailedCount'] === terminalLifecycleActual.nonFormalFailedCount,
      'FORMAL_TERMINAL_NON_FORMAL_GATES_INCOMPLETE',
      'runtime/terminal-conclusion.json',
    );
    checks.check(terminal['producerEvidencePersistedBeforeCleanup'] === producerEvidencePersistedBeforeCleanup, 'FORMAL_TERMINAL_PRODUCER_EVIDENCE_NOT_PERSISTED', 'runtime/terminal-conclusion.json#/producerEvidencePersistedBeforeCleanup');
    checks.check(terminal['producerProtocolEvidenceCount'] === producerProtocolEvidenceCount && producerProtocolEvidenceCount > 0, 'FORMAL_TERMINAL_PRODUCER_EVIDENCE_EMPTY', 'runtime/terminal-conclusion.json#/producerProtocolEvidenceCount');
    checks.check(terminal['cleanupStatus'] === terminalLifecycleActual.cleanupStatus, 'FORMAL_TERMINAL_CLEANUP_STATUS_NOT_PASSED', 'runtime/terminal-conclusion.json#/cleanupStatus');
    checks.check(terminal['residualResourceCount'] === residualResources.length, 'FORMAL_TERMINAL_RESIDUAL_RESOURCES_PRESENT', 'runtime/terminal-conclusion.json#/residualResourceCount');
    checks.check(terminal['residualContainerCount'] === residualContainerCount && residualContainerCount === 0, 'FORMAL_TERMINAL_RESIDUAL_CONTAINER_PRESENT', 'runtime/terminal-conclusion.json#/residualContainerCount');
    checks.check(terminal['residualVolumeCount'] === residualVolumeCount && residualVolumeCount === 0, 'FORMAL_TERMINAL_RESIDUAL_VOLUME_PRESENT', 'runtime/terminal-conclusion.json#/residualVolumeCount');
    checks.check(terminal['residualNetworkCount'] === residualNetworkCount && residualNetworkCount === 0, 'FORMAL_TERMINAL_RESIDUAL_NETWORK_PRESENT', 'runtime/terminal-conclusion.json#/residualNetworkCount');
    checks.check(jsonEqual(terminal['occupiedRequiredPorts'], occupiedRequiredPorts), 'FORMAL_TERMINAL_REQUIRED_PORT_OCCUPIED', 'runtime/terminal-conclusion.json#/occupiedRequiredPorts');
    checks.check(jsonEqual(terminal['requiredPortsObserved'], requiredPortsObserved), 'FORMAL_TERMINAL_REQUIRED_PORT_OBSERVATION_MISSING', 'runtime/terminal-conclusion.json#/requiredPortsObserved');
    checks.check(terminal['pruneCommandsInvoked'] === terminalLifecycleActual.pruneCommandsInvoked, 'FORMAL_TERMINAL_PRUNE_COMMAND_INVOKED', 'runtime/terminal-conclusion.json#/pruneCommandsInvoked');
    checks.check(terminal['frozenInputsStableAfterCleanup'] === summary.raw['frozenInputsStableAfterCleanup'], 'FORMAL_TERMINAL_FROZEN_INPUTS_DRIFT', 'runtime/terminal-conclusion.json#/frozenInputsStableAfterCleanup');
    checks.check(terminal['authorityIdentityStableAfterCleanup'] === summary.raw['authorityIdentityStableAfterCleanup'], 'FORMAL_TERMINAL_AUTHORITY_IDENTITY_DRIFT', 'runtime/terminal-conclusion.json#/authorityIdentityStableAfterCleanup');
    checks.check(
      terminal['runtimeAuthoritySha256'] === summary.raw['runtimeAuthoritySha256'],
      'RUNTIME_AUTHORITY_SHA_MISMATCH',
      'runtime/terminal-conclusion.json#/runtimeAuthoritySha256',
    );
    checks.check(
      terminal['runtimeAuthoritySemanticDigest'] ===
        summary.raw['runtimeAuthoritySemanticDigest'],
      'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH',
      'runtime/terminal-conclusion.json#/runtimeAuthoritySemanticDigest',
    );
    checks.check(
      terminal['runtimeAuthorityStableAfterCleanup'] ===
        summary.raw['runtimeAuthorityStableAfterCleanup'],
      'FORMAL_TERMINAL_RUNTIME_AUTHORITY_DRIFT',
      'runtime/terminal-conclusion.json#/runtimeAuthorityStableAfterCleanup',
    );
    checks.check(terminal['producerSourceManifestStableAfterCleanup'] === summary.raw['producerSourceManifestStableAfterCleanup'], 'FORMAL_TERMINAL_PRODUCER_SOURCE_MANIFEST_DRIFT', 'runtime/terminal-conclusion.json#/producerSourceManifestStableAfterCleanup');
    checks.check(terminal['outputDirectoryExclusive'] === summary.raw['outputDirectoryExclusive'], 'FORMAL_TERMINAL_OUTPUT_DIRECTORY_NOT_EXCLUSIVE', 'runtime/terminal-conclusion.json#/outputDirectoryExclusive');
    const terminalFailureCodes = parseStringArray(
      terminal['failureCodes'],
      checks,
      'FORMAL_TERMINAL_FAILURE_CODES_INVALID',
      'runtime/terminal-conclusion.json#/failureCodes',
    );
    checks.check(terminalFailureCodes.length === 0, 'FORMAL_TERMINAL_FAILURE_CODES_PRESENT', 'runtime/terminal-conclusion.json#/failureCodes');
    const assertions = asRecord(terminal['assertions']);
    const lifecycleAssertion = assertions === null ? null : asRecord(assertions['terminalLifecycle']);
    const sealAssertion = assertions === null ? null : asRecord(assertions['sealEligibility']);
    checks.check(
      assertions !== null && arrayEqual(Object.keys(assertions).sort(), ['sealEligibility', 'terminalLifecycle']),
      'FORMAL_TERMINAL_ASSERTION_SET_INVALID',
      'runtime/terminal-conclusion.json#/assertions',
    );
    checks.check(
      jsonEqual(lifecycleAssertion, {
        status: 'PASSED',
        expected: terminalLifecycleExpected,
        actual: terminalLifecycleActual,
        failureCodes: [],
      }),
      'FORMAL_TERMINAL_LIFECYCLE_ASSERTION_INCONSISTENT',
      'runtime/terminal-conclusion.json#/assertions/terminalLifecycle',
    );
    checks.check(
      jsonEqual(sealAssertion, {
        status: 'PASSED',
        expected: sealEligibilityExpected,
        actual: sealEligibilityActual,
        failureCodes: [],
      }),
      'FORMAL_TERMINAL_SEAL_ASSERTION_INCONSISTENT',
      'runtime/terminal-conclusion.json#/assertions/sealEligibility',
    );
  }
  checks.check(
    summary.raw['producerProtocolEvidenceCount'] === producerProtocolEvidenceCount,
    'FORMAL_SUMMARY_PRODUCER_EVIDENCE_COUNT_MISMATCH',
    'abg-results.json#/producerProtocolEvidenceCount',
  );
  validateAbg40TerminalReferences(formalProducer, abg40Proof, checks);
  checks.check(summary.raw['status'] === 'PASSED', 'FORMAL_SUMMARY_STATUS_NOT_PASSED', 'abg-results.json#/status');
  checks.check(summary.raw['cleanupStatus'] === 'PASSED', 'FORMAL_SUMMARY_CLEANUP_STATUS_NOT_PASSED', 'abg-results.json#/cleanupStatus');
  checks.check(summary.raw['terminalConclusionStatus'] === 'PASSED', 'FORMAL_SUMMARY_TERMINAL_STATUS_NOT_PASSED', 'abg-results.json#/terminalConclusionStatus');
  checks.check(summary.raw['sealEligibilityStatus'] === 'PASSED', 'FORMAL_SUMMARY_SEAL_STATUS_NOT_PASSED', 'abg-results.json#/sealEligibilityStatus');

  if (finalOutcome !== null) {
    checks.check(finalOutcome['schemaVersion'] === RUNTIME_OUTCOME_SCHEMA_VERSION, 'FORMAL_FINAL_OUTCOME_SCHEMA_INVALID', 'runtime/final-outcome.json');
    checks.check(finalOutcome['status'] === summary.raw['status'], 'FORMAL_FINAL_OUTCOME_STATUS_MISMATCH', 'runtime/final-outcome.json#/status');
    checks.check(finalOutcome['cleanupStatus'] === summary.raw['cleanupStatus'], 'FORMAL_FINAL_OUTCOME_CLEANUP_STATUS_MISMATCH', 'runtime/final-outcome.json#/cleanupStatus');
    checks.check(finalOutcome['terminalConclusionStatus'] === summary.raw['terminalConclusionStatus'], 'FORMAL_FINAL_OUTCOME_TERMINAL_STATUS_MISMATCH', 'runtime/final-outcome.json#/terminalConclusionStatus');
    checks.check(finalOutcome['sealEligibilityStatus'] === summary.raw['sealEligibilityStatus'], 'FORMAL_FINAL_OUTCOME_SEAL_STATUS_MISMATCH', 'runtime/final-outcome.json#/sealEligibilityStatus');
    checks.check(
      finalOutcome['runtimeAuthoritySha256'] === summary.raw['runtimeAuthoritySha256'],
      'RUNTIME_AUTHORITY_SHA_MISMATCH',
      'runtime/final-outcome.json#/runtimeAuthoritySha256',
    );
    checks.check(
      finalOutcome['runtimeAuthoritySemanticDigest'] ===
        summary.raw['runtimeAuthoritySemanticDigest'],
      'RUNTIME_AUTHORITY_SEMANTIC_DIGEST_MISMATCH',
      'runtime/final-outcome.json#/runtimeAuthoritySemanticDigest',
    );
    checks.check(
      finalOutcome['runtimeAuthorityStableAfterCleanup'] ===
        summary.raw['runtimeAuthorityStableAfterCleanup'],
      'RUNTIME_AUTHORITY_DRIFT_AFTER_CLEANUP',
      'runtime/final-outcome.json#/runtimeAuthorityStableAfterCleanup',
    );
    checks.check(jsonEqual(finalOutcome['failureCodes'], summary.raw['failureCodes']), 'FORMAL_FINAL_OUTCOME_FAILURE_CODES_MISMATCH', 'runtime/final-outcome.json#/failureCodes');
    checks.check(finalOutcome['sealPendingAtWrite'] === true, 'FORMAL_FINAL_OUTCOME_SEAL_PENDING_INVALID', 'runtime/final-outcome.json#/sealPendingAtWrite');
  }
}

async function readLifecycleRecord(
  snapshot: EvidenceSnapshot,
  path: string,
  checks: ReviewChecks,
  missingCode: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const bytes = await readSnapshotBytes(snapshot, path, checks, missingCode);
  return bytes === null ? null : parseJsonRecord(bytes, checks, 'FORMAL_LIFECYCLE_JSON_INVALID', path);
}

function validateProducerEvidenceSnapshot(
  record: Readonly<Record<string, unknown>>,
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  checks: ReviewChecks,
): number {
  const location = 'runtime/producer-evidence-snapshot.json';
  checks.check(
    record['schemaVersion'] === 'phase-01.formal-producer-evidence-snapshot.v1',
    'FORMAL_PRODUCER_SNAPSHOT_SCHEMA_INVALID',
    location,
  );
  checks.check(
    record['statusBeforeCleanup'] === 'PASSED',
    'FORMAL_PRODUCER_SNAPSHOT_STATUS_NOT_PASSED',
    location + '#/statusBeforeCleanup',
  );
  const failureCodes = parseStringArray(
    record['failureCodes'],
    checks,
    'FORMAL_PRODUCER_SNAPSHOT_FAILURE_CODES_INVALID',
    location + '#/failureCodes',
  );
  checks.check(
    failureCodes.length === 0,
    'FORMAL_PRODUCER_SNAPSHOT_HAS_FAILURE_CODES',
    location + '#/failureCodes',
  );
  const discoveredEvidence = parseSnapshotFileIdentities(
    record['discoveredEvidence'],
    snapshot,
    manifest,
    checks,
    'FORMAL_PRODUCER_SNAPSHOT_DISCOVERED_EVIDENCE_INVALID',
    location + '#/discoveredEvidence',
  );
  checks.check(
    record['discoveredEvidenceCount'] === discoveredEvidence.length,
    'FORMAL_PRODUCER_SNAPSHOT_DISCOVERED_COUNT_MISMATCH',
    location + '#/discoveredEvidenceCount',
  );
  const producerEvidence = parseSnapshotFileIdentities(
    record['producerProtocolEvidence'],
    snapshot,
    manifest,
    checks,
    'FORMAL_PRODUCER_SNAPSHOT_PROTOCOL_EVIDENCE_INVALID',
    location + '#/producerProtocolEvidence',
  );
  const producerCount = positiveIntegerField(record, 'producerProtocolEvidenceCount');
  checks.check(
    producerCount !== null && producerCount === producerEvidence.length,
    'FORMAL_PRODUCER_SNAPSHOT_COUNT_MISMATCH',
    location + '#/producerProtocolEvidenceCount',
  );
  checks.check(producerEvidence.length > 0, 'FORMAL_PRODUCER_SNAPSHOT_EMPTY', location);
  checks.check(record['absenceIsNotSuccess'] === false, 'FORMAL_PRODUCER_SNAPSHOT_ABSENCE_POLICY_INVALID', location + '#/absenceIsNotSuccess');
  const recordedAt = stringField(record, 'recordedAt');
  checks.check(
    recordedAt !== null && isLocalDateTime(recordedAt),
    'FORMAL_PRODUCER_SNAPSHOT_RECORDED_AT_INVALID',
    location + '#/recordedAt',
  );
  const discoveredKeys = new Set(discoveredEvidence.map(snapshotIdentityKey));
  for (const identity of producerEvidence) {
    checks.check(
      discoveredKeys.has(snapshotIdentityKey(identity)),
      'FORMAL_PRODUCER_SNAPSHOT_PROTOCOL_NOT_DISCOVERED',
      location + '#/producerProtocolEvidence/' + identity.path,
    );
  }
  const expectedProducerPaths = [...manifest.entries.keys()]
    .filter(isPreCleanupProducerProtocolPath)
    .sort((left, right) => left.localeCompare(right));
  const actualProducerPaths = producerEvidence.map((identity) => identity.path)
    .sort((left, right) => left.localeCompare(right));
  checks.check(
    arrayEqual(actualProducerPaths, expectedProducerPaths),
    'FORMAL_PRODUCER_SNAPSHOT_COVERAGE_MISMATCH',
    location + '#/producerProtocolEvidence',
  );
  return producerCount ?? 0;
}

function parseSnapshotFileIdentities(
  value: unknown,
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly SnapshotFileIdentity[] {
  const records = parseRecordArray(value, checks, code, location);
  const identities: SnapshotFileIdentity[] = [];
  for (const [index, record] of records.entries()) {
    const itemLocation = location + '/' + index;
    const path = meaningfulStringField(record, 'path');
    const byteLength = nonNegativeIntegerField(record, 'byteLength');
    const digest = meaningfulStringField(record, 'sha256');
    checks.check(path !== null && isSafeRelativePath(path), code, itemLocation + '/path');
    checks.check(byteLength !== null, code, itemLocation + '/byteLength');
    checks.check(digest !== null && isSha256(digest), code, itemLocation + '/sha256');
    if (path === null || byteLength === null || digest === null || !isSafeRelativePath(path)) continue;
    const identity = { path, byteLength, sha256: digest };
    identities.push(identity);
    const manifestEntry = manifest.entries.get(path);
    const file = snapshot.files.get(path);
    checks.check(manifestEntry !== undefined, 'FORMAL_PRODUCER_SNAPSHOT_FILE_NOT_MANIFESTED', itemLocation);
    checks.check(file !== undefined, 'FORMAL_PRODUCER_SNAPSHOT_FILE_MISSING', itemLocation);
    checks.check(
      manifestEntry !== undefined &&
        file !== undefined &&
        manifestEntry.byteLength === byteLength &&
        manifestEntry.sha256 === digest &&
        file.byteLength === byteLength &&
        file.sha256 === digest,
      'FORMAL_PRODUCER_SNAPSHOT_FILE_IDENTITY_MISMATCH',
      itemLocation,
    );
  }
  checks.check(
    new Set(identities.map((identity) => identity.path)).size === identities.length,
    code,
    location,
  );
  return identities;
}

function snapshotIdentityKey(identity: SnapshotFileIdentity): string {
  return `${identity.path}:${identity.byteLength}:${identity.sha256}`;
}

function isPreCleanupProducerProtocolPath(path: string): boolean {
  return path === 'shared/producer-evidence-index.json' ||
    (/^shared\/[^/]+\/producer-evidence\.json$/u.test(path) &&
      !path.startsWith('shared/formal-run/'));
}

function parseRuntimeResourceArray(
  value: unknown,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly Readonly<Record<string, unknown>>[] {
  const records = parseRecordArray(value, checks, code, location);
  for (const [index, record] of records.entries()) {
    const itemLocation = location + '/' + index;
    checks.check(
      ['process', 'container', 'volume', 'network'].includes(String(record['resourceType'])),
      code,
      itemLocation + '/resourceType',
    );
    checks.check(meaningfulStringField(record, 'id') !== null, code, itemLocation + '/id');
    checks.check(meaningfulStringField(record, 'name') !== null, code, itemLocation + '/name');
    checks.check(typeof record['present'] === 'boolean', code, itemLocation + '/present');
    if (record['resourceType'] === 'container') {
      checks.check(
        record['restartPolicy'] === 'no',
        'FORMAL_RUNTIME_CONTAINER_RESTART_POLICY_INVALID',
        itemLocation + '/restartPolicy',
      );
    }
  }
  return records;
}

function parseRuntimePortArray(
  value: unknown,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly Readonly<Record<string, unknown>>[] {
  const records = parseRecordArray(value, checks, code, location);
  for (const [index, record] of records.entries()) {
    const itemLocation = location + '/' + index;
    const port = positiveIntegerField(record, 'port');
    checks.check(port !== null && port <= 65_535, code, itemLocation + '/port');
    checks.check(typeof record['occupied'] === 'boolean', code, itemLocation + '/occupied');
    checks.check(
      record['verificationError'] === null || typeof record['verificationError'] === 'string',
      code,
      itemLocation + '/verificationError',
    );
  }
  return records;
}

function uniqueLifecycleResources(
  resources: readonly Readonly<Record<string, unknown>>[],
): readonly Readonly<Record<string, unknown>>[] {
  return [...new Map(resources.map((resource) => [
    `${String(resource['resourceType'])}:${String(resource['id'])}:${String(resource['name'])}`,
    resource,
  ])).values()];
}

function validateNestedRunIdentity(
  record: Readonly<Record<string, unknown>>,
  expected: {
    readonly runId: string | null;
    readonly runSequence: number | null;
    readonly gitCommitSha: string | null;
    readonly runtimeNamespace: string | null;
  },
  checks: ReviewChecks,
  location: string,
): void {
  const identity = asRecord(record['runIdentity']);
  checks.check(identity !== null, 'FORMAL_LIFECYCLE_RUN_IDENTITY_MISSING', location + '#/runIdentity');
  if (identity === null) return;
  checks.check(identity['runId'] === expected.runId, 'FORMAL_LIFECYCLE_RUN_IDENTITY_MISMATCH', location + '#/runIdentity/runId');
  checks.check(identity['runSequence'] === expected.runSequence, 'FORMAL_LIFECYCLE_RUN_IDENTITY_MISMATCH', location + '#/runIdentity/runSequence');
  checks.check(identity['gitCommitSha'] === expected.gitCommitSha, 'FORMAL_LIFECYCLE_RUN_IDENTITY_MISMATCH', location + '#/runIdentity/gitCommitSha');
  checks.check(identity['runtimeNamespace'] === expected.runtimeNamespace, 'FORMAL_LIFECYCLE_RUN_IDENTITY_MISMATCH', location + '#/runIdentity/runtimeNamespace');
}

function validateAbg40TerminalReferences(
  formalProducer: Readonly<Record<string, unknown>> | null,
  proof: Readonly<Record<string, unknown>> | null,
  checks: ReviewChecks,
): void {
  const expectedAssertions = [
    'ABG-40:formal-terminal-lifecycle-complete',
    'ABG-40:formal-evidence-seal-eligible',
  ] as const;
  if (proof !== null) {
    checks.check(
      arrayEqual(stringArrayValue(proof['assertionIds']), expectedAssertions),
      'ABG40_PROOF_ASSERTIONS_INVALID',
      'gates/ABG-40/producer/result.json#/assertionIds',
    );
  }
  if (formalProducer === null) return;
  const scenarios = asRecord(formalProducer['scenarios']);
  const scenario = scenarios === null ? null : asRecord(scenarios['RUN-FORMAL-TERMINAL-LIFECYCLE']);
  const assertions = scenario === null ? null : asRecord(scenario['assertions']);
  const terminalAssertion = assertions === null ? null : asRecord(assertions[expectedAssertions[0]]);
  const sealAssertion = assertions === null ? null : asRecord(assertions[expectedAssertions[1]]);
  checks.check(terminalAssertion !== null, 'ABG40_TERMINAL_ASSERTION_MISSING', 'formal-run/producer-evidence.json');
  checks.check(sealAssertion !== null, 'ABG40_SEAL_ASSERTION_MISSING', 'formal-run/producer-evidence.json');
  for (const [assertion, pointer] of [
    [terminalAssertion, '/assertions/terminalLifecycle/status'],
    [sealAssertion, '/assertions/sealEligibility/status'],
  ] as const) {
    if (assertion === null) continue;
    const items = arrayValue(assertion['evidenceItems']).map(asRecord).filter(
      (value): value is Readonly<Record<string, unknown>> => value !== null,
    );
    checks.check(items.length > 0, 'ABG40_TERMINAL_EVIDENCE_REFERENCE_INVALID', 'formal-run/producer-evidence.json');
    checks.check(items.every((item) =>
      item['relativePath'] === 'runtime/terminal-conclusion.json' && item['jsonPointer'] === pointer
    ), 'ABG40_TERMINAL_EVIDENCE_REFERENCE_INVALID', 'formal-run/producer-evidence.json');
  }
}

async function validateTopLevelRunIdentities(
  snapshot: EvidenceSnapshot,
  manifest: ManifestState,
  summary: SummaryState,
  checks: ReviewChecks,
): Promise<void> {
  if (summary.runId === null || summary.runSequence === null) return;
  for (const entry of manifest.entries.values()) {
    if (entry.mediaType !== 'application/json') continue;
    const bytes = await readSnapshotBytes(snapshot, entry.path, checks, 'JSON_EVIDENCE_FILE_MISSING');
    if (bytes === null) continue;
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString('utf8')) as unknown;
    } catch {
      checks.fail('JSON_EVIDENCE_CONTENT_INVALID', entry.path);
      continue;
    }
    const record = asRecord(value);
    if (record === null) continue;
    if (Object.hasOwn(record, 'runId')) {
      checks.check(record['runId'] === summary.runId, 'TOP_LEVEL_RUN_ID_MISMATCH', entry.path);
    }
    if (Object.hasOwn(record, 'runSequence')) {
      checks.check(record['runSequence'] === summary.runSequence, 'TOP_LEVEL_RUN_SEQUENCE_MISMATCH', entry.path);
    }
  }
}

function validateTimePair(
  record: Readonly<Record<string, unknown>>,
  checks: ReviewChecks,
  location: string,
): void {
  const startedAt = stringField(record, 'startedAt');
  const completedAt = stringField(record, 'completedAt');
  checks.check(startedAt !== null && isLocalDateTime(startedAt), 'PRODUCER_STARTED_AT_INVALID', location);
  checks.check(completedAt !== null && isLocalDateTime(completedAt), 'PRODUCER_COMPLETED_AT_INVALID', location);
  if (startedAt !== null && completedAt !== null && isLocalDateTime(startedAt) && isLocalDateTime(completedAt)) {
    checks.check(startedAt <= completedAt, 'PRODUCER_TIME_ORDER_INVALID', location);
  }
}

function validateCurrentDefinitions(
  identity: CurrentAuthorityIdentity,
  checks: ReviewChecks,
): void {
  try {
    validateAbgCoverageMatrix();
    checks.check(true, 'CURRENT_COVERAGE_MATRIX_INVALID', 'tooling/verification/src/abg-coverage-matrix.ts');
  } catch {
    checks.fail('CURRENT_COVERAGE_MATRIX_INVALID', 'tooling/verification/src/abg-coverage-matrix.ts');
  }
  checks.check(ABG_GATES.length === 40, 'CURRENT_GATE_COUNT_INVALID', 'tooling/verification/src/abg-catalog.ts');
  checks.check(isSha256(identity.coverageMatrixDigest), 'CURRENT_COVERAGE_DIGEST_INVALID');
  checks.check(isSha256(identity.producerProtocolIdentityDigest), 'CURRENT_PROTOCOL_DIGEST_INVALID');
}

async function readCurrentAuthorityIdentity(): Promise<CurrentAuthorityIdentity> {
  return {
    coverageMatrixDigest: digestJson(ABG_COVERAGE_MATRIX),
    coverageMatrixSourceSha256: (await hashFile(join(repositoryRoot, 'tooling/verification/src/abg-coverage-matrix.ts'))).sha256,
    producerProtocolIdentityDigest: getAbgProducerProtocolIdentityDigest(),
    producerProtocolSourceSha256: (await hashFile(join(repositoryRoot, 'tooling/verification/src/evidence/protocol.ts'))).sha256,
    gateProofSourceSha256: (await hashFile(join(repositoryRoot, 'tooling/verification/src/abg-gate-proof.ts'))).sha256,
  };
}

async function readReviewerToolIdentity(): Promise<ReviewerToolIdentity> {
  return {
    toolId: 'phase-01.formal-abg-evidence-reviewer',
    schemaVersion: REVIEWER_TOOL_SCHEMA_VERSION,
    sourceSha256: (await hashFile(fileURLToPath(import.meta.url))).sha256,
    gateResultSchemaVersion: GATE_RESULT_SCHEMA_VERSION,
    producerEvidenceSchemaVersion: PRODUCER_EVIDENCE_SCHEMA_VERSION,
    producerEvidenceIndexSchemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  };
}

async function writeReviewOutputs(
  outputDirectory: string,
  review: FormalAbgEvidenceReview,
  findings: readonly ReviewFinding[],
  reviewerSourceManifest: ReviewerVerificationSourceManifest | null,
): Promise<void> {
  const findingsValue = {
    schemaVersion: REVIEW_FINDINGS_SCHEMA_VERSION,
    sourceEvidenceDirectory: review.sourceEvidenceDirectory,
    status: review.status,
    findingCount: findings.length,
    findingsDigest: review.findingsDigest,
    findings,
  };
  const outputFiles: Array<{
    readonly path: string;
    readonly mediaType: string;
    readonly byteLength: number;
    readonly sha256: string;
  }> = [];
  async function writeTracked(path: string, bytes: Buffer, mode = 0o600): Promise<void> {
    await writeFile(join(outputDirectory, path), bytes, { flag: 'wx', mode });
    outputFiles.push({
      path,
      mediaType: mediaTypeFor(path),
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  if (reviewerSourceManifest !== null) {
    await mkdir(join(outputDirectory, 'provenance'), { recursive: false, mode: 0o700 });
    const reviewerManifestBytes = canonicalVerificationSourceManifestBytes(reviewerSourceManifest);
    await writeTracked('provenance/reviewer-source-manifest.json', reviewerManifestBytes);
    await writeTracked(
      'provenance/reviewer-source-manifest.sha256',
      Buffer.from(
        `${sha256(reviewerManifestBytes)}  reviewer-source-manifest.json\n`,
        'utf8',
      ),
      0o400,
    );
  }
  const findingsBytes = Buffer.from(JSON.stringify(findingsValue, null, 2) + '\n', 'utf8');
  await writeTracked('review-findings.json', findingsBytes);
  const reviewBytes = Buffer.from(JSON.stringify(review, null, 2) + '\n', 'utf8');
  await writeTracked('review.json', reviewBytes);
  await writeTracked(
    'review.sha256',
    Buffer.from(sha256(reviewBytes) + '  review.json\n', 'utf8'),
    0o400,
  );
  const reviewManifest = {
    schemaVersion: REVIEW_MANIFEST_SCHEMA_VERSION,
    files: [...outputFiles].sort((left, right) => left.path.localeCompare(right.path)),
  };
  const reviewManifestBytes = Buffer.from(
    JSON.stringify(reviewManifest, null, 2) + '\n',
    'utf8',
  );
  await writeFile(join(outputDirectory, 'review-manifest.json'), reviewManifestBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  await writeFile(
    join(outputDirectory, 'review-manifest.sha256'),
    sha256(reviewManifestBytes) + '  review-manifest.json\n',
    { flag: 'wx', mode: 0o400 },
  );
}

async function readSnapshotBytes(
  snapshot: EvidenceSnapshot,
  relativePath: string,
  checks: ReviewChecks,
  missingCode: string,
): Promise<Buffer | null> {
  if (!isSafeRelativePath(relativePath)) {
    checks.fail('EVIDENCE_PATH_UNSAFE', relativePath);
    return null;
  }
  const file = snapshot.files.get(relativePath);
  if (file === undefined) {
    checks.fail(missingCode, relativePath);
    return null;
  }
  try {
    const bytes = await readFile(file.absolutePath);
    checks.check(bytes.byteLength === file.byteLength, 'EVIDENCE_FILE_CHANGED_WHILE_READING', relativePath);
    checks.check(sha256(bytes) === file.sha256, 'EVIDENCE_FILE_CHANGED_WHILE_READING', relativePath);
    return bytes;
  } catch {
    checks.fail('EVIDENCE_FILE_UNREADABLE', relativePath);
    return null;
  }
}

function parseJsonRecord(
  bytes: Buffer,
  checks: ReviewChecks,
  code: string,
  location: string,
): Readonly<Record<string, unknown>> | null {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    const record = asRecord(value);
    checks.check(record !== null, code, location);
    return record;
  } catch {
    checks.fail(code, location);
    return null;
  }
}

function selectorMatches(
  reference: Readonly<Record<string, unknown>>,
  selector: AbgCoverageMatrixEntry['evidenceSelectors'][number],
): boolean {
  return reference['artifactId'] === selector.artifactId &&
    reference['producerId'] === selector.producerId &&
    reference['scenarioId'] === selector.scenarioId &&
    reference['assertionId'] === selector.assertionId &&
    reference['jsonPointer'] === selector.jsonPointer;
}

function selectorSignature(reference: Readonly<Record<string, unknown>>): string {
  return [
    reference['artifactId'],
    reference['producerId'],
    reference['scenarioId'],
    reference['assertionId'],
    reference['jsonPointer'],
  ].map(String).join('\0');
}

function matrixGateForAssertion(assertionId: string): string | null {
  return ABG_COVERAGE_MATRIX.find((entry) => entry.assertionIds.includes(assertionId))?.gateId ?? null;
}

function resolveJsonPointer(
  value: unknown,
  pointer: string,
): { readonly found: boolean; readonly value?: unknown } {
  if (!isStrictJsonPointer(pointer)) return { found: false };
  let current = value;
  for (const rawSegment of pointer.slice(1).split('/')) {
    const segment = rawSegment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9]\d*)$/u.test(segment)) return { found: false };
      const index = Number(segment);
      if (!Number.isSafeInteger(index) || index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    const record = asRecord(current);
    if (record === null || !Object.hasOwn(record, segment)) return { found: false };
    current = record[segment];
  }
  return { found: true, value: current };
}

function isStrictJsonPointer(pointer: string): boolean {
  return /^(?:\/(?:[^~/]|~[01])*)+$/u.test(pointer) &&
    !pointer.split('/').slice(1).some((segment) => segment.length === 0);
}

function isSafeRelativePath(value: string): boolean {
  return value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..' || segment.includes(':'));
}

function joinSafeRelative(base: string, child: string): string | null {
  const value = base.length === 0 ? child : base + '/' + child;
  return isSafeRelativePath(value) ? value : null;
}

function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.xml': return 'application/xml';
    case '.html': return 'text/html; charset=utf-8';
    case '.png': return 'image/png';
    case '.zip': return 'application/zip';
    default: return 'text/plain; charset=utf-8';
  }
}

function containsSensitiveData(value: unknown): boolean {
  if (typeof value === 'string') {
    return SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) return value.some(containsSensitiveData);
  const record = asRecord(value);
  if (record === null) return false;
  return Object.entries(record).some(([key, item]) =>
    SENSITIVE_KEY_PATTERN.test(key) || containsSensitiveData(item),
  );
}

async function validateEvidenceSecretLeaks(
  snapshot: EvidenceSnapshot,
  checks: ReviewChecks,
): Promise<void> {
  const configuredSecretValues = FORMAL_REQUIRED_SECRET_NAMES
    .flatMap((name) => name.endsWith('_USERNAME') ? [] : [process.env[name]])
    .filter((value): value is string =>
      value !== undefined && value.length > 0 && value !== '[REDACTED]',
    )
    .sort((left, right) => right.length - left.length);
  for (const [path, file] of snapshot.files) {
    const name = basename(path).toLowerCase();
    if (name !== 'stdout.log' && name !== 'stderr.log' && extname(path).toLowerCase() !== '.json') {
      continue;
    }
    let text: string;
    try {
      text = await readFile(file.absolutePath, 'utf8');
    } catch {
      checks.fail('EVIDENCE_SECRET_SCAN_UNREADABLE', path);
      continue;
    }
    if (name === 'stdout.log') {
      checks.check(
        !containsSensitiveValue(text, configuredSecretValues),
        'EVIDENCE_STDOUT_SECRET_EXPOSED',
        path,
      );
      continue;
    }
    if (name === 'stderr.log') {
      checks.check(
        !containsSensitiveValue(text, configuredSecretValues),
        'EVIDENCE_STDERR_SECRET_EXPOSED',
        path,
      );
      continue;
    }
    const rawTextContainsSecret = containsSensitiveValue(text, configuredSecretValues);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof SyntaxError) {
        checks.check(!rawTextContainsSecret, 'EVIDENCE_JSON_SECRET_EXPOSED', path);
        checks.fail('EVIDENCE_JSON_SECRET_SCAN_INVALID', path);
        continue;
      }
      throw error;
    }
    checks.check(
      !rawTextContainsSecret && !containsSensitiveValue(parsed, configuredSecretValues),
      'EVIDENCE_JSON_SECRET_EXPOSED',
      path,
    );
  }
}

function containsSensitiveValue(
  value: unknown,
  configuredSecretValues: readonly string[],
): boolean {
  if (typeof value === 'string') {
    return configuredSecretValues.some((secret) => value.includes(secret)) ||
      SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveValue(item, configuredSecretValues));
  }
  const record = asRecord(value);
  return record !== null && Object.entries(record).some(([key, item]) =>
    (SENSITIVE_KEY_PATTERN.test(key) && isUnredactedSensitiveKeyValue(item)) ||
    containsSensitiveValue(item, configuredSecretValues)
  );
}

function isUnredactedSensitiveKeyValue(value: unknown): boolean {
  return typeof value === 'string' &&
    value.trim().length > 0 &&
    value !== '[REDACTED]';
}

function isLocalDateTime(value: string): boolean {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return false;
  const [date, time] = value.split('T');
  if (date === undefined || time === undefined) return false;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second] = time.split(':').map(Number);
  if ([year, month, day, hour, minute, second].some((part) => part === undefined || !Number.isInteger(part))) return false;
  const instant = new Date(Date.UTC(year!, month! - 1, day!, hour!, minute!, second!));
  return instant.getUTCFullYear() === year &&
    instant.getUTCMonth() + 1 === month &&
    instant.getUTCDate() === day &&
    instant.getUTCHours() === hour &&
    instant.getUTCMinutes() === minute &&
    instant.getUTCSeconds() === second;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function stringField(record: Readonly<Record<string, unknown>>, field: string): string | null {
  return typeof record[field] === 'string' ? record[field] : null;
}

function meaningfulStringField(record: Readonly<Record<string, unknown>>, field: string): string | null {
  const value = stringField(record, field);
  return value !== null && value.trim().length > 0 ? value : null;
}

function integerField(record: Readonly<Record<string, unknown>>, field: string): number | null {
  const value = record[field];
  return Number.isSafeInteger(value) ? value as number : null;
}

function positiveIntegerField(record: Readonly<Record<string, unknown>>, field: string): number | null {
  const value = integerField(record, field);
  return value !== null && value > 0 ? value : null;
}

function nonNegativeIntegerField(record: Readonly<Record<string, unknown>>, field: string): number | null {
  const value = integerField(record, field);
  return value !== null && value >= 0 ? value : null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseStringArray(
  value: unknown,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly string[] {
  if (!checks.check(Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0), code, location) || !Array.isArray(value)) return [];
  const strings = value as readonly string[];
  checks.check(new Set(strings).size === strings.length, code, location);
  return strings;
}

function parseNumberArray(
  value: unknown,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly number[] {
  if (
    !checks.check(
      Array.isArray(value) && value.every((item) => Number.isSafeInteger(item)),
      code,
      location,
    ) ||
    !Array.isArray(value)
  ) return [];
  const numbers = value as readonly number[];
  checks.check(new Set(numbers).size === numbers.length, code, location);
  return numbers;
}

function parseRecordArray(
  value: unknown,
  checks: ReviewChecks,
  code: string,
  location: string,
): readonly Readonly<Record<string, unknown>>[] {
  if (!checks.check(Array.isArray(value), code, location) || !Array.isArray(value)) return [];
  const records: Readonly<Record<string, unknown>>[] = [];
  for (const [index, item] of value.entries()) {
    const record = asRecord(item);
    checks.check(record !== null, code, location + '/' + index);
    if (record !== null) records.push(record);
  }
  return records;
}

function stringArrayValue(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as readonly string[]
    : [];
}

function numberArrayValue(value: unknown): readonly number[] {
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item))
    ? value as readonly number[]
    : [];
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function numberArrayEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function jsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function isProducerId(value: string | null): value is AbgProducerId {
  return value !== null && ABG_PRODUCER_IDS.includes(value as AbgProducerId);
}

function isEvidenceStatus(value: string | null): boolean {
  return isEvidenceStatusValue(value);
}

function isEvidenceStatusValue(value: unknown): value is 'PASSED' | 'FAILED' | 'BLOCKED' {
  return value === 'PASSED' || value === 'FAILED' || value === 'BLOCKED';
}

function isSha256(value: string): boolean {
  return SHA256_PATTERN.test(value);
}

function digestJson(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
    return serialized;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const record = asRecord(value);
  if (record !== null) {
    return '{' + Object.keys(record).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalJson(record[key]),
    ).join(',') + '}';
  }
  throw new Error('CANONICAL_JSON_VALUE_UNSUPPORTED');
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function hashFile(path: string): Promise<{ readonly byteLength: number; readonly sha256: string }> {
  const hash = createHash('sha256');
  let byteLength = 0;
  await new Promise<void>((resolveRead, rejectRead) => {
    const stream = createReadStream(path);
    stream.on('data', (chunk: string | Buffer) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      byteLength += bytes.byteLength;
      hash.update(bytes);
    });
    stream.once('error', rejectRead);
    stream.once('end', resolveRead);
  });
  return { byteLength, sha256: hash.digest('hex') };
}

function stableThrownCode(error: unknown): string {
  if (error instanceof Error && /^[A-Z0-9_:-]+$/u.test(error.message)) return error.message;
  return 'FORMAL_ABG_REVIEW_INTERNAL_ERROR';
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main();
}
