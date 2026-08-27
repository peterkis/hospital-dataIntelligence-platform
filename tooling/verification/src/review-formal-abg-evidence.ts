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

const REVIEW_SCHEMA_VERSION = 'phase-01.formal-abg-evidence-review.v1' as const;
const REVIEW_FINDINGS_SCHEMA_VERSION =
  'phase-01.formal-abg-evidence-review-findings.v1' as const;
const REVIEWER_TOOL_SCHEMA_VERSION =
  'phase-01.formal-abg-evidence-reviewer.v1' as const;
const RUN_PLAN_SCHEMA_VERSION = 'phase-01.abg-run-plan.v3';
const RUN_PLAN_AUTHORITY_ID = 'phase-01.repository-authoritative-plan.v2';
const RUN_SUMMARY_SCHEMA_VERSION = 'phase-01.abg-run.v3';
const GATE_RESULT_SCHEMA_VERSION = 'phase-01.abg-gate-result.v3' as const;
const MANIFEST_SCHEMA_VERSION = 'phase-01.evidence-manifest.v1';
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
  await prepareExclusiveOutputDirectory(sourceDirectory, outputDirectory);

  const checks = new ReviewChecks();
  const sourceEvidenceDigestBefore = await captureTreeIdentity(sourceDirectory);
  const snapshot = await scanEvidenceDirectory(sourceDirectory, checks);
  const currentIdentity = await readCurrentAuthorityIdentity();
  const reviewerToolIdentity = await readReviewerToolIdentity();
  validateCurrentDefinitions(currentIdentity, checks);
  const manifest = await validateManifest(snapshot, checks);
  const plan = await validateRunPlan(snapshot, manifest, currentIdentity, checks);
  const summary = await validateRunSummary(
    snapshot,
    manifest,
    plan,
    currentIdentity,
    checks,
  );
  if (summary !== null) {
    await validateTopLevelRunIdentities(snapshot, manifest, summary, checks);
  }

  const sourceEvidenceDigestAfter = await captureTreeIdentity(sourceDirectory);
  checks.check(
    sourceEvidenceDigestBefore === sourceEvidenceDigestAfter,
    'SOURCE_EVIDENCE_CHANGED_DURING_REVIEW',
    '.',
  );

  const findings = [...checks.findings];
  const findingsDigest = digestJson(findings);
  const failedCheckCount = findings.length;
  const review: FormalAbgEvidenceReview = {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    sourceEvidenceDirectory: sourceDirectory,
    sourceManifestSha256: manifest.sourceManifestSha256,
    sourceEvidenceDigestBefore,
    sourceEvidenceDigestAfter,
    reviewedAt: localNow(),
    reviewerToolIdentity,
    coverageMatrixDigest: currentIdentity.coverageMatrixDigest,
    status: failedCheckCount === 0 ? 'PASSED' : 'FAILED',
    checkCount: checks.checkCount,
    passedCheckCount: checks.checkCount - failedCheckCount,
    failedCheckCount,
    findingsDigest,
  };
  await writeReviewOutputs(outputDirectory, review, findings);
  return review;
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
      manifest['schemaVersion'] === MANIFEST_SCHEMA_VERSION,
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
  if (frozenInputs !== null) validateFrozenInputs(frozenInputs, checks);
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
  for (const field of ['lockfileSha256', 'openapiSha256', 'migrationManifestSha256', 'fixtureIdentity'] as const) {
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
  if (plan !== null) {
    checks.check(runSequence === plan.runSequence, 'RUN_SEQUENCE_MISMATCH', 'abg-results.json#/runSequence');
    checks.check(raw['planDigest'] === plan.planDigest, 'RUN_PLAN_DIGEST_MISMATCH', 'abg-results.json#/planDigest');
    if (plan.frozenInputs !== null) {
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
  checks.check(raw['frozenInputsStable'] === true, 'FROZEN_INPUTS_NOT_STABLE', 'abg-results.json#/frozenInputsStable');
  checks.check(raw['authorityIdentityStable'] === true, 'AUTHORITY_IDENTITY_NOT_STABLE', 'abg-results.json#/authorityIdentityStable');
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
  const derivedStatus = results.length === ABG_GATES.length && failedCount === 0 ? 'PASSED' : 'FAILED';
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
    if (kind.endsWith('Sha256') || kind === 'fixtureIdentity') {
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
  const protocolIdentity = {
    gateResultSchemaVersion: GATE_RESULT_SCHEMA_VERSION,
    producerEvidenceSchemaVersion: PRODUCER_EVIDENCE_SCHEMA_VERSION,
    producerEvidenceIndexSchemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
  };
  return {
    coverageMatrixDigest: digestJson(ABG_COVERAGE_MATRIX),
    coverageMatrixSourceSha256: (await hashFile(join(repositoryRoot, 'tooling/verification/src/abg-coverage-matrix.ts'))).sha256,
    producerProtocolIdentityDigest: digestJson(protocolIdentity),
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
): Promise<void> {
  const findingsValue = {
    schemaVersion: REVIEW_FINDINGS_SCHEMA_VERSION,
    sourceEvidenceDirectory: review.sourceEvidenceDirectory,
    status: review.status,
    findingCount: findings.length,
    findingsDigest: review.findingsDigest,
    findings,
  };
  await writeExclusiveJson(join(outputDirectory, 'review-findings.json'), findingsValue);
  const reviewBytes = Buffer.from(JSON.stringify(review, null, 2) + '\n', 'utf8');
  await writeFile(join(outputDirectory, 'review.json'), reviewBytes, { flag: 'wx', mode: 0o600 });
  await writeFile(
    join(outputDirectory, 'review.sha256'),
    sha256(reviewBytes) + '  review.json\n',
    { flag: 'wx', mode: 0o400 },
  );
}

async function writeExclusiveJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
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

function localNow(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
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

function stringArrayValue(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? value as readonly string[]
    : [];
}

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
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
