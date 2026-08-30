import { createHash } from 'node:crypto';
import {
  VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
  type EvidenceContractIdentity,
} from '../verification-contract-versions.js';
import {
  VERIFICATION_SOURCE_FILES,
  type VerificationSourceFileRole,
} from './source-manifest-files.js';

export type VerificationManifestRole = 'PRODUCER' | 'REVIEWER';
export type VerificationWorktreeStatus = 'CLEAN' | 'DIRTY' | 'UNAVAILABLE';

export interface VerificationSourceManifestEntry {
  readonly path: string;
  readonly role: VerificationSourceFileRole;
  readonly sha256: string;
  readonly gitBlobOid: string;
  readonly byteLength: number;
}

export interface VerificationAuthorityIdentity {
  readonly coverageMatrixDigest: string;
  readonly producerProtocolIdentityDigest: string;
  readonly gateProofIdentityDigest: string;
  readonly terminalContractIdentityDigest: string;
  readonly sourceManifestDefinitionDigest: string;
}

interface VerificationSourceManifestBase {
  readonly schemaVersion: typeof VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION;
  readonly manifestRole: VerificationManifestRole;
  readonly repositoryFullName: string;
  readonly generatedAt: string;
  readonly sourceFiles: readonly VerificationSourceManifestEntry[];
  readonly sourceFileCount: number;
  readonly sourceFilesDigest: string;
}

export interface ProducerVerificationSourceManifest extends VerificationSourceManifestBase {
  readonly manifestRole: 'PRODUCER';
  readonly producerGitCommitSha: string;
  readonly producerBranch: string;
  readonly producerWorktreeState: 'CLEAN';
  readonly contractIdentity: EvidenceContractIdentity;
  readonly authorityIdentity: VerificationAuthorityIdentity;
}

export interface ReviewerVerificationSourceManifest extends VerificationSourceManifestBase {
  readonly manifestRole: 'REVIEWER';
  readonly reviewerGitCommitSha: string;
  readonly reviewerBranch: string;
  readonly reviewerWorktreeState: VerificationWorktreeStatus;
  readonly reviewerContractIdentity: EvidenceContractIdentity;
}

export type VerificationSourceManifest =
  | ProducerVerificationSourceManifest
  | ReviewerVerificationSourceManifest;

const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const COMMIT_SHA = GIT_OID;
const SAFE_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/u;

export function parseVerificationSourceManifest(value: unknown): VerificationSourceManifest {
  const record = requireRecord(value, 'PRODUCER_SOURCE_MANIFEST_INVALID');
  const role = requireEnum(record, 'manifestRole', ['PRODUCER', 'REVIEWER'] as const);
  const expectedKeys = role === 'PRODUCER'
    ? ['schemaVersion', 'manifestRole', 'repositoryFullName', 'producerGitCommitSha',
      'producerBranch', 'producerWorktreeState', 'generatedAt', 'contractIdentity',
      'authorityIdentity', 'sourceFiles', 'sourceFileCount', 'sourceFilesDigest']
    : ['schemaVersion', 'manifestRole', 'repositoryFullName', 'reviewerGitCommitSha',
      'reviewerBranch', 'reviewerWorktreeState', 'generatedAt', 'reviewerContractIdentity',
      'sourceFiles', 'sourceFileCount', 'sourceFilesDigest'];
  assertExactKeys(record, expectedKeys, 'PRODUCER_SOURCE_MANIFEST_KEYS_INVALID');
  if (record['schemaVersion'] !== VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION) {
    throw new Error('PRODUCER_SOURCE_MANIFEST_SCHEMA_UNSUPPORTED');
  }
  const repositoryFullName = requireNonemptyString(record, 'repositoryFullName');
  const generatedAt = requireNonemptyString(record, 'generatedAt');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('PRODUCER_SOURCE_MANIFEST_GENERATED_AT_INVALID');
  const sourceFiles = parseSourceFiles(record['sourceFiles']);
  const sourceFileCount = requireNonnegativeInteger(record, 'sourceFileCount');
  if (sourceFileCount !== sourceFiles.length) throw new Error('PRODUCER_SOURCE_MANIFEST_FILE_COUNT_MISMATCH');
  const sourceFilesDigest = requireDigest(record, 'sourceFilesDigest');
  if (sourceFilesDigest !== digestVerificationProvenanceJson(sourceFiles)) {
    throw new Error('PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH');
  }

  if (role === 'PRODUCER') {
    const producerWorktreeState = requireEnum(record, 'producerWorktreeState', ['CLEAN'] as const);
    const authorityIdentity = parseAuthorityIdentity(record['authorityIdentity']);
    if (
      canonicalVerificationProvenanceJson(authorityIdentity) !==
        canonicalVerificationProvenanceJson(deriveVerificationAuthorityIdentity(sourceFiles))
    ) {
      throw new Error('PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH');
    }
    return {
      schemaVersion: VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
      manifestRole: role,
      repositoryFullName,
      producerGitCommitSha: requirePattern(record, 'producerGitCommitSha', COMMIT_SHA),
      producerBranch: requireNonemptyString(record, 'producerBranch'),
      producerWorktreeState,
      generatedAt,
      contractIdentity: parseContractIdentity(record['contractIdentity']),
      authorityIdentity,
      sourceFiles,
      sourceFileCount,
      sourceFilesDigest,
    };
  }
  return {
    schemaVersion: VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
    manifestRole: role,
    repositoryFullName,
    reviewerGitCommitSha: requirePattern(record, 'reviewerGitCommitSha', COMMIT_SHA),
    reviewerBranch: requireNonemptyString(record, 'reviewerBranch'),
    reviewerWorktreeState: requireEnum(
      record,
      'reviewerWorktreeState',
      ['CLEAN', 'DIRTY', 'UNAVAILABLE'] as const,
    ),
    generatedAt,
    reviewerContractIdentity: parseContractIdentity(record['reviewerContractIdentity']),
    sourceFiles,
    sourceFileCount,
    sourceFilesDigest,
  };
}

export function deriveVerificationAuthorityIdentity(
  sourceFiles: readonly VerificationSourceManifestEntry[],
): VerificationAuthorityIdentity {
  const byPath = new Map(sourceFiles.map((entry) => [entry.path, entry]));
  return {
    coverageMatrixDigest: requireSourceEntry(byPath, 'tooling/verification/src/abg-coverage-matrix.ts').sha256,
    producerProtocolIdentityDigest: digestEntriesByRoles(sourceFiles, [
      'EVIDENCE_PROTOCOL', 'EVIDENCE_SCHEMA', 'EVIDENCE_RECORDER',
      'EVIDENCE_ADAPTER', 'EVIDENCE_VALIDATOR',
    ]),
    gateProofIdentityDigest: requireSourceEntry(byPath, 'tooling/verification/src/abg-gate-proof.ts').sha256,
    terminalContractIdentityDigest: digestEntriesByRoles(sourceFiles, [
      'TERMINAL_CONTRACT', 'SUMMARY_VALIDATOR', 'RUNTIME_CONTRACT',
    ]),
    sourceManifestDefinitionDigest: digestEntriesByRoles(sourceFiles, [
      'SOURCE_MANIFEST_DEFINITION', 'CONTRACT_VERSION', 'REVIEWER_COMPATIBILITY',
    ]),
  };
}

function digestEntriesByRoles(
  entries: readonly VerificationSourceManifestEntry[],
  roles: readonly VerificationSourceFileRole[],
): string {
  const selected = entries.filter((entry) => roles.includes(entry.role));
  if (selected.length === 0) throw new Error('VERIFICATION_AUTHORITY_SOURCE_ROLE_MISSING');
  return digestVerificationProvenanceJson(selected);
}

function requireSourceEntry(
  entries: ReadonlyMap<string, VerificationSourceManifestEntry>,
  path: string,
): VerificationSourceManifestEntry {
  const entry = entries.get(path);
  if (entry === undefined) throw new Error('VERIFICATION_AUTHORITY_SOURCE_MISSING:' + path);
  return entry;
}

function parseSourceFiles(value: unknown): readonly VerificationSourceManifestEntry[] {
  if (!Array.isArray(value)) throw new Error('PRODUCER_SOURCE_MANIFEST_FILES_INVALID');
  const entries = value.map((item) => {
    const record = requireRecord(item, 'PRODUCER_SOURCE_MANIFEST_ENTRY_INVALID');
    assertExactKeys(record, ['path', 'role', 'sha256', 'gitBlobOid', 'byteLength'], 'PRODUCER_SOURCE_MANIFEST_ENTRY_KEYS_INVALID');
    const path = requirePattern(record, 'path', SAFE_PATH);
    if (path.includes('\\') || path.includes('//') || path.startsWith('./')) {
      throw new Error('PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE:' + path);
    }
    const role = requireNonemptyString(record, 'role');
    if (!new Set(VERIFICATION_SOURCE_FILES.map((entry) => entry.role)).has(role as VerificationSourceFileRole)) {
      throw new Error('PRODUCER_SOURCE_MANIFEST_ROLE_INVALID:' + role);
    }
    return {
      path,
      role: role as VerificationSourceFileRole,
      sha256: requirePattern(record, 'sha256', SHA256),
      gitBlobOid: requirePattern(record, 'gitBlobOid', GIT_OID),
      byteLength: requireNonnegativeInteger(record, 'byteLength'),
    };
  });
  const paths = entries.map((entry) => entry.path);
  if (new Set(paths).size !== paths.length) throw new Error('PRODUCER_SOURCE_MANIFEST_ENTRY_DUPLICATE');
  const sorted = [...paths].sort();
  if (paths.some((path, index) => path !== sorted[index])) {
    throw new Error('PRODUCER_SOURCE_MANIFEST_ORDER_INVALID');
  }
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  for (const required of VERIFICATION_SOURCE_FILES) {
    if (byPath.get(required.path)?.role !== required.role) {
      throw new Error('PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH');
    }
  }
  return entries;
}

export function digestVerificationProvenanceJson(value: unknown): string {
  return createHash('sha256')
    .update(Buffer.from(canonicalVerificationProvenanceJson(value), 'utf8'))
    .digest('hex');
}

export function canonicalVerificationProvenanceJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalVerificationProvenanceJson).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalVerificationProvenanceJson(record[key]),
    ).join(',') + '}';
  }
  throw new Error('PRODUCER_SOURCE_MANIFEST_JSON_INVALID');
}

function parseContractIdentity(value: unknown): EvidenceContractIdentity {
  const record = requireRecord(value, 'EVIDENCE_CONTRACT_IDENTITY_INVALID');
  const keys = [
    'runPlanSchemaVersion', 'runPlanAuthorityId', 'producerEvidenceSchemaVersion',
    'producerEvidenceIndexSchemaVersion', 'gateResultSchemaVersion', 'runSummarySchemaVersion',
    'terminalConclusionSchemaVersion', 'runtimeOutcomeSchemaVersion', 'evidenceManifestSchemaVersion',
  ] as const;
  assertExactKeys(record, keys, 'EVIDENCE_CONTRACT_IDENTITY_KEYS_INVALID');
  return Object.fromEntries(keys.map((key) => [key, requireNonemptyString(record, key)])) as unknown as EvidenceContractIdentity;
}

function parseAuthorityIdentity(value: unknown): VerificationAuthorityIdentity {
  const record = requireRecord(value, 'VERIFICATION_AUTHORITY_IDENTITY_INVALID');
  const keys = [
    'coverageMatrixDigest', 'producerProtocolIdentityDigest', 'gateProofIdentityDigest',
    'terminalContractIdentityDigest', 'sourceManifestDefinitionDigest',
  ] as const;
  assertExactKeys(record, keys, 'VERIFICATION_AUTHORITY_IDENTITY_KEYS_INVALID');
  return Object.fromEntries(keys.map((key) => [key, requireDigest(record, key)])) as unknown as VerificationAuthorityIdentity;
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[], code: string): void {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) throw new Error(code);
}

function requireNonemptyString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error('PRODUCER_SOURCE_MANIFEST_FIELD_INVALID:' + key);
  return value;
}

function requirePattern(record: Record<string, unknown>, key: string, pattern: RegExp): string {
  const value = requireNonemptyString(record, key);
  if (!pattern.test(value)) throw new Error(key === 'path' ? 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE:' + value : 'PRODUCER_SOURCE_MANIFEST_FIELD_INVALID:' + key);
  return value;
}

function requireDigest(record: Record<string, unknown>, key: string): string {
  return requirePattern(record, key, SHA256);
}

function requireNonnegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('PRODUCER_SOURCE_MANIFEST_FIELD_INVALID:' + key);
  return value as number;
}

function requireEnum<const T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] {
  const value = record[key];
  if (typeof value !== 'string' || !allowed.includes(value)) throw new Error('PRODUCER_SOURCE_MANIFEST_FIELD_INVALID:' + key);
  return value as T[number];
}
