import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Ar12HistoryClassification =
  | 'INIT_ONLY_HISTORY'
  | 'DEPENDENCY_INSTALL_FAILURE_HISTORY'
  | 'TOOL_DISCOVERY_FAILURE_HISTORY'
  | 'INITIAL_REBASELINE_PASSED_HISTORY'
  | 'CLOSEOUT_FINAL_FAILURE_HISTORY'
  | 'SUMMARY_CONTRACT_FAILED_HISTORY';

export interface Ar12RequiredHistoryArtifact {
  readonly relativePath: string;
  readonly sha256?: string;
}

export interface Ar12RequiredHistoryEvidence {
  readonly historyId: string;
  readonly relativeDirectory: string;
  readonly classification: Ar12HistoryClassification;
  readonly required: true;
  readonly formalAcceptanceEligible: false;
  readonly requiredArtifacts: readonly Ar12RequiredHistoryArtifact[];
}

export interface Ar12HistoryEvidenceContract {
  readonly schemaVersion: 'phase-01.ar-12-history-evidence-contract.v1';
  readonly requiredHistories: readonly Ar12RequiredHistoryEvidence[];
  readonly recoveryArtifact: {
    readonly relativePath: string;
    readonly sha256: string;
  };
  readonly staleCloneRelativePath: string;
}

export interface Ar12HistoryEvidenceBaseline {
  readonly schemaVersion: 'phase-01.ar-12-history-evidence-baseline.v1';
  readonly historyContractDigest: string;
  readonly requiredHistoryCount: 6;
  readonly requiredHistoryPassedCount: 6;
  readonly requiredHistories: readonly {
    readonly historyId: string;
    readonly relativeDirectory: string;
    readonly classification: Ar12HistoryClassification;
    readonly formalAcceptanceEligible: false;
    readonly contractDisposition: 'ACCEPTED' | 'REJECTED';
    readonly rejectionClassification: 'SUMMARY_CONTRACT_FAILED_HISTORY' | null;
    readonly directoryTreeDigest: string;
    readonly fileCount: number;
    readonly requiredArtifacts: readonly {
      readonly relativePath: string;
      readonly sha256: string;
      readonly status: 'PASSED';
    }[];
    readonly requiredArtifactStatus: 'PASSED';
  }[];
  readonly recoveryArtifact: {
    readonly relativePath: string;
    readonly sha256: string;
    readonly status: 'PASSED';
    readonly treeDigestBefore: string;
    readonly treeDigestAfter: string;
    readonly failedFinalEvidencePreserved: true;
  };
  readonly staleCloneStatus: 'ABSENT';
  readonly requiredEntriesStatus: 'PASSED';
  readonly discoveredAdditionalHistories: readonly {
    readonly relativeDirectory: string;
    readonly fileCount: number;
    readonly directoryTreeDigest: string;
  }[];
  readonly entries: readonly {
    readonly relativePath: string;
    readonly kind: 'DIRECTORY' | 'FILE';
    readonly fileCount: number;
    readonly digest: string;
  }[];
  readonly historicalEvidenceSetDigest: string;
  readonly digest: string;
  readonly capturedAt: string;
}

const EXPECTED_REQUIRED_HISTORY_IDENTITIES = [
  ['ar12-20260830-db57406-precloseout', '20260830-db57406-precloseout', 'INIT_ONLY_HISTORY'],
  ['ar12-20260830-db57406-precloseout-r2', '20260830-db57406-precloseout-r2', 'DEPENDENCY_INSTALL_FAILURE_HISTORY'],
  ['ar12-20260830-db57406-precloseout-r3', '20260830-db57406-precloseout-r3', 'TOOL_DISCOVERY_FAILURE_HISTORY'],
  ['ar12-20260830-db57406-precloseout-r4', '20260830-db57406-precloseout-r4', 'INITIAL_REBASELINE_PASSED_HISTORY'],
  ['ar12-20260830-4dca3ca-final', '20260830-4dca3ca-final', 'CLOSEOUT_FINAL_FAILURE_HISTORY'],
  ['ar12-20260831-1d1204a-precloseout-r2', '20260831-1d1204a-precloseout-r2', 'SUMMARY_CONTRACT_FAILED_HISTORY'],
] as const;

export const AR12_HISTORY_EVIDENCE_CONTRACT: Ar12HistoryEvidenceContract = deepFreeze({
  schemaVersion: 'phase-01.ar-12-history-evidence-contract.v1',
  requiredHistories: [
    requiredHistory(...EXPECTED_REQUIRED_HISTORY_IDENTITIES[0], []),
    requiredHistory(...EXPECTED_REQUIRED_HISTORY_IDENTITIES[1], []),
    requiredHistory(...EXPECTED_REQUIRED_HISTORY_IDENTITIES[2], []),
    requiredHistory(...EXPECTED_REQUIRED_HISTORY_IDENTITIES[3], []),
    requiredHistory(...EXPECTED_REQUIRED_HISTORY_IDENTITIES[4], [
      artifact('baseline-identity.json', '9d1ab324ba388411316d7a8b043411356a9b5b28f0ce6302ee564a5665219779'),
      artifact('command-plan.json', 'd03e5f60568859a1939285d51f5a55eab6c13bcae9ab31a4ceafb80bf10faede'),
      artifact('init-result.json', 'c08768f3f6deb5af1a3ec70d26d46835c09c7763506f4a321a8ff4506c2f2de1'),
      artifact('run-context.json', '7b9c7f674562a34a6e3b3b3a750a310d746b4cd8f98cbabea129f866cb0a9cd0'),
      artifact('run-commands-result.json', '1130502d8e8b21a3cc7aff6a63ae0807f2d3738df65261d06b713bdb2a754652'),
      artifact('failure-run-commands.json', 'a914596a5b2df9372a3042af2df2cdad6d3216d0318a839e2ea20777f307994c'),
    ]),
    requiredHistory(...EXPECTED_REQUIRED_HISTORY_IDENTITIES[5], [
      artifact('ar-12-rebaseline-summary.json', 'be19b1557dc75dc2adae612fefdd5088116677acc3414f151feddf0d10ad2cff'),
    ]),
  ],
  recoveryArtifact: {
    relativePath: 'recovery/20260830-0267bba/execution-workspace-relocation.json',
    sha256: '735e5ea48cdadecad043573c6e75f263b73f04b411465944fc4d7c215f86f75e',
  },
  staleCloneRelativePath: 'worktrees/db57406-precloseout',
});

export function ar12HistoryEvidenceContractDigest(
  contract: Ar12HistoryEvidenceContract = AR12_HISTORY_EVIDENCE_CONTRACT,
): string {
  validateAr12HistoryEvidenceContract(contract);
  return sha256(Buffer.from(canonicalJson(contract), 'utf8'));
}

export function validateAr12HistoryEvidenceContract(
  contract: Ar12HistoryEvidenceContract,
): void {
  if (contract.schemaVersion !== 'phase-01.ar-12-history-evidence-contract.v1') {
    fail('AR12_HISTORY_CONTRACT_INVALID');
  }
  if (!Array.isArray(contract.requiredHistories) || contract.requiredHistories.length !== 6) {
    fail('AR12_HISTORY_CONTRACT_INVALID');
  }
  const paths = contract.requiredHistories.map((entry) => entry.relativeDirectory);
  if (new Set(paths).size !== paths.length) fail('AR12_HISTORY_ENTRY_DUPLICATE');
  const expectedPaths = EXPECTED_REQUIRED_HISTORY_IDENTITIES.map((entry) => entry[1]);
  if (paths.length === expectedPaths.length &&
    paths.every((path) => expectedPaths.includes(path as (typeof expectedPaths)[number])) &&
    !paths.every((path, index) => path === expectedPaths[index])) {
    fail('AR12_HISTORY_ENTRY_ORDER_INVALID');
  }
  for (const [index, entry] of contract.requiredHistories.entries()) {
    assertSafeRelativePath(entry.relativeDirectory);
    if (entry.required !== true || entry.formalAcceptanceEligible !== false) {
      fail('AR12_HISTORY_CONTRACT_INVALID');
    }
    const expected = EXPECTED_REQUIRED_HISTORY_IDENTITIES[index];
    if (expected === undefined || entry.historyId !== expected[0] || entry.relativeDirectory !== expected[1]) {
      fail('AR12_HISTORY_CONTRACT_INVALID');
    }
    if (entry.classification !== expected[2]) fail('AR12_HISTORY_CLASSIFICATION_MISMATCH');
    const artifactPaths = entry.requiredArtifacts.map(
      (candidate: Ar12RequiredHistoryArtifact) => candidate.relativePath,
    );
    if (new Set(artifactPaths).size !== artifactPaths.length) fail('AR12_HISTORY_ENTRY_DUPLICATE');
    for (const requiredArtifact of entry.requiredArtifacts) {
      assertSafeRelativePath(requiredArtifact.relativePath);
      if (requiredArtifact.sha256 !== undefined && !isSha256(requiredArtifact.sha256)) {
        fail('AR12_HISTORY_CONTRACT_INVALID');
      }
    }
  }
  const sixth = contract.requiredHistories[5];
  const sixthSummary = sixth?.requiredArtifacts.find(
    (candidate: Ar12RequiredHistoryArtifact) =>
      candidate.relativePath === 'ar-12-rebaseline-summary.json',
  );
  if (
    sixth?.classification !== 'SUMMARY_CONTRACT_FAILED_HISTORY' ||
    sixthSummary?.sha256 === undefined ||
    (contract === AR12_HISTORY_EVIDENCE_CONTRACT &&
      sixthSummary.sha256 !== 'be19b1557dc75dc2adae612fefdd5088116677acc3414f151feddf0d10ad2cff')
  ) fail('AR12_HISTORY_SUMMARY_CONTRACT_FAILURE_NOT_BOUND');
  assertSafeRelativePath(contract.recoveryArtifact.relativePath);
  assertSafeRelativePath(contract.staleCloneRelativePath);
  if (!isSha256(contract.recoveryArtifact.sha256)) fail('AR12_HISTORY_CONTRACT_INVALID');
}

export async function captureAr12HistoryEvidenceBaseline(
  outputRoot: string,
  currentRunDirectory: string,
  contract: Ar12HistoryEvidenceContract = AR12_HISTORY_EVIDENCE_CONTRACT,
  clock: () => string = () => new Date().toISOString(),
): Promise<Ar12HistoryEvidenceBaseline> {
  validateAr12HistoryEvidenceContract(contract);
  const root = await assertPhysicalDirectory(outputRoot, 'AR12_HISTORY_CONTRACT_INVALID');
  const currentRun = resolve(currentRunDirectory);
  const currentRelative = relative(root, currentRun);
  if (currentRelative === '' || escapesRoot(currentRelative) || relative(root, currentRun).split(sep).length !== 1) {
    fail('AR12_HISTORY_CONTRACT_INVALID');
  }
  const children = await safeChildren(root);
  const requiredNames = new Set(contract.requiredHistories.map((entry) => entry.relativeDirectory));
  const missing = contract.requiredHistories.filter(
    (entry) => !children.some((child) => child.name === entry.relativeDirectory && child.isDirectory()),
  );
  if (missing.length > 0) {
    const extras = children.filter((child) =>
      child.isDirectory() &&
      child.name !== 'recovery' &&
      child.name !== 'worktrees' &&
      !requiredNames.has(child.name) &&
      !samePath(join(root, child.name), currentRun));
    fail(extras.length > 0
      ? 'AR12_HISTORY_EXTRA_DIRECTORY_CANNOT_SUBSTITUTE_REQUIRED'
      : 'AR12_HISTORY_REQUIRED_DIRECTORY_MISSING');
  }

  const requiredHistories: Ar12HistoryEvidenceBaseline['requiredHistories'][number][] = [];
  for (const entry of contract.requiredHistories) {
    const directory = await assertPhysicalDirectory(
      resolveInside(root, entry.relativeDirectory),
      'AR12_HISTORY_REQUIRED_DIRECTORY_MISSING',
    );
    const tree = await fingerprintTree(directory);
    const artifacts: Ar12HistoryEvidenceBaseline['requiredHistories'][number]['requiredArtifacts'][number][] = [];
    for (const requiredArtifact of entry.requiredArtifacts) {
      const artifactPath = resolveInside(directory, requiredArtifact.relativePath);
      const bytes = await readRequiredArtifact(artifactPath);
      const observedSha256 = sha256(bytes);
      if (requiredArtifact.sha256 !== undefined && observedSha256 !== requiredArtifact.sha256) {
        fail('AR12_HISTORY_REQUIRED_ARTIFACT_SHA256_MISMATCH');
      }
      if (
        entry.classification === 'SUMMARY_CONTRACT_FAILED_HISTORY' &&
        requiredArtifact.relativePath === 'ar-12-rebaseline-summary.json'
      ) assertRejectedSummaryContract(bytes);
      artifacts.push({
        relativePath: requiredArtifact.relativePath,
        sha256: observedSha256,
        status: 'PASSED',
      });
    }
    const rejected = entry.classification === 'SUMMARY_CONTRACT_FAILED_HISTORY';
    requiredHistories.push({
      historyId: entry.historyId,
      relativeDirectory: entry.relativeDirectory,
      classification: entry.classification,
      formalAcceptanceEligible: false,
      contractDisposition: rejected ? 'REJECTED' : 'ACCEPTED',
      rejectionClassification: rejected ? 'SUMMARY_CONTRACT_FAILED_HISTORY' : null,
      directoryTreeDigest: tree.digest,
      fileCount: tree.fileCount,
      requiredArtifacts: artifacts,
      requiredArtifactStatus: 'PASSED',
    });
  }

  const recoveryPath = resolveInside(root, contract.recoveryArtifact.relativePath);
  const recoveryBytes = await readRequiredArtifact(recoveryPath);
  if (sha256(recoveryBytes) !== contract.recoveryArtifact.sha256) {
    fail('AR12_RECOVERY_ARTIFACT_SHA256_MISMATCH');
  }
  const recovery = parseRecord(recoveryBytes, 'AR12_HISTORY_CONTRACT_INVALID');
  if (
    recovery['treeDigestBefore'] !== recovery['treeDigestAfter'] ||
    recovery['failedFinalRunDirectoryPreserved'] !== true
  ) fail('AR12_HISTORY_CONTRACT_INVALID');
  try {
    await lstat(resolveInside(root, contract.staleCloneRelativePath));
    fail('AR12_STALE_EXECUTION_CLONE_REAPPEARED');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const entries: Ar12HistoryEvidenceBaseline['entries'][number][] = [];
  const additional: Ar12HistoryEvidenceBaseline['discoveredAdditionalHistories'][number][] = [];
  for (const child of children) {
    const path = join(root, child.name);
    if (samePath(path, currentRun)) continue;
    await assertNoReparse(path, 'AR12_HISTORY_CONTRACT_INVALID');
    if (child.isDirectory()) {
      const tree = await fingerprintTree(path);
      entries.push({ relativePath: child.name, kind: 'DIRECTORY', fileCount: tree.fileCount, digest: tree.digest });
      if (!requiredNames.has(child.name) && child.name !== 'recovery' && child.name !== 'worktrees') {
        additional.push({
          relativeDirectory: child.name,
          fileCount: tree.fileCount,
          directoryTreeDigest: tree.digest,
        });
      }
    } else if (child.isFile()) {
      const bytes = await readRequiredArtifact(path);
      entries.push({ relativePath: child.name, kind: 'FILE', fileCount: 1, digest: sha256(bytes) });
    } else {
      fail('AR12_HISTORY_CONTRACT_INVALID');
    }
  }
  const historyContractDigest = ar12HistoryEvidenceContractDigest(contract);
  const historicalEvidenceSetDigest = sha256(Buffer.from(canonicalJson({
    historyContractDigest,
    requiredHistories,
    recoveryArtifact: {
      relativePath: contract.recoveryArtifact.relativePath,
      sha256: contract.recoveryArtifact.sha256,
      treeDigestBefore: recovery['treeDigestBefore'],
      treeDigestAfter: recovery['treeDigestAfter'],
      failedFinalEvidencePreserved: true,
    },
    staleCloneStatus: 'ABSENT',
    additional,
    entries,
  }), 'utf8'));
  return {
    schemaVersion: 'phase-01.ar-12-history-evidence-baseline.v1',
    historyContractDigest,
    requiredHistoryCount: 6,
    requiredHistoryPassedCount: 6,
    requiredHistories,
    recoveryArtifact: {
      relativePath: contract.recoveryArtifact.relativePath,
      sha256: contract.recoveryArtifact.sha256,
      status: 'PASSED',
      treeDigestBefore: String(recovery['treeDigestBefore']),
      treeDigestAfter: String(recovery['treeDigestAfter']),
      failedFinalEvidencePreserved: true,
    },
    staleCloneStatus: 'ABSENT',
    requiredEntriesStatus: 'PASSED',
    discoveredAdditionalHistories: additional,
    entries,
    historicalEvidenceSetDigest,
    digest: historicalEvidenceSetDigest,
    capturedAt: clock(),
  };
}

export function assertAr12HistoryEvidenceStable(
  opening: Ar12HistoryEvidenceBaseline,
  ending: Ar12HistoryEvidenceBaseline,
): true {
  if (
    opening.requiredHistoryCount !== 6 ||
    opening.requiredHistoryPassedCount !== 6 ||
    ending.requiredHistoryCount !== 6 ||
    ending.requiredHistoryPassedCount !== 6 ||
    opening.requiredHistories.length !== 6 ||
    ending.requiredHistories.length !== 6 ||
    opening.requiredEntriesStatus !== 'PASSED' ||
    ending.requiredEntriesStatus !== 'PASSED'
  ) fail('AR12_HISTORY_CONTRACT_INVALID');
  if (opening.historyContractDigest !== ending.historyContractDigest) {
    fail('AR12_HISTORY_EVIDENCE_SET_DRIFT');
  }
  for (const openingEntry of opening.requiredHistories) {
    const endingEntry = ending.requiredHistories.find(
      (candidate) => candidate.historyId === openingEntry.historyId,
    );
    if (endingEntry === undefined) fail('AR12_HISTORY_REQUIRED_DIRECTORY_MISSING');
    if (endingEntry.classification !== openingEntry.classification) {
      fail('AR12_HISTORY_CLASSIFICATION_MISMATCH');
    }
    if (endingEntry.directoryTreeDigest !== openingEntry.directoryTreeDigest) {
      fail('AR12_HISTORY_REQUIRED_DIRECTORY_TREE_DRIFT');
    }
  }
  if (opening.recoveryArtifact.sha256 !== ending.recoveryArtifact.sha256) {
    fail('AR12_RECOVERY_ARTIFACT_SHA256_MISMATCH');
  }
  if (ending.staleCloneStatus !== 'ABSENT') fail('AR12_STALE_EXECUTION_CLONE_REAPPEARED');
  if (opening.historicalEvidenceSetDigest !== ending.historicalEvidenceSetDigest) {
    fail('AR12_HISTORY_EVIDENCE_SET_DRIFT');
  }
  return true;
}

function assertRejectedSummaryContract(bytes: Buffer): void {
  const summary = parseRecord(bytes, 'AR12_HISTORY_CONTRACT_INVALID');
  if (summary['status'] !== 'PASSED') fail('AR12_HISTORY_CONTRACT_INVALID');
  if (
    Object.hasOwn(summary, 'repositoryContaminationGuard') ||
    Object.hasOwn(summary, 'repoLayoutStatus') ||
    Object.hasOwn(summary, 'historyEvidenceStable')
  ) fail('AR12_HISTORY_SUMMARY_CONTRACT_FAILURE_NOT_BOUND');
}

async function fingerprintTree(root: string): Promise<{ readonly fileCount: number; readonly digest: string }> {
  const physicalRoot = await assertPhysicalDirectory(root, 'AR12_HISTORY_CONTRACT_INVALID');
  const entries: Array<Record<string, unknown>> = [];
  let fileCount = 0;
  const visit = async (directory: string): Promise<void> => {
    const children = await safeChildren(directory);
    for (const child of children) {
      const path = join(directory, child.name);
      await assertNoReparse(path, 'AR12_HISTORY_CONTRACT_INVALID');
      const relativePath = relative(physicalRoot, path).split(sep).join('/');
      if (child.isDirectory()) {
        entries.push({ path: relativePath, kind: 'DIRECTORY' });
        await visit(path);
      } else if (child.isFile()) {
        const bytes = await readRequiredArtifact(path);
        entries.push({ path: relativePath, kind: 'FILE', byteLength: bytes.byteLength, sha256: sha256(bytes) });
        fileCount += 1;
      } else {
        fail('AR12_HISTORY_CONTRACT_INVALID');
      }
    }
  };
  await visit(physicalRoot);
  return { fileCount, digest: sha256(Buffer.from(canonicalJson(entries), 'utf8')) };
}

async function readRequiredArtifact(path: string): Promise<Buffer> {
  try {
    const observed = await lstat(path);
    if (observed.isSymbolicLink() || !observed.isFile() || observed.nlink !== 1) {
      fail('AR12_HISTORY_REQUIRED_ARTIFACT_MISSING');
    }
    await assertNoReparse(path, 'AR12_HISTORY_REQUIRED_ARTIFACT_MISSING');
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) fail('AR12_HISTORY_REQUIRED_ARTIFACT_MISSING');
    throw error;
  }
}

async function assertPhysicalDirectory(path: string, code: string): Promise<string> {
  try {
    const observed = await lstat(path);
    if (!observed.isDirectory() || observed.isSymbolicLink()) fail(code);
    const physical = await realpath(path);
    if (!samePath(path, physical)) fail(code);
    return physical;
  } catch (error) {
    if (isMissing(error)) fail(code);
    throw error;
  }
}

async function assertNoReparse(path: string, code: string): Promise<void> {
  const observed = await lstat(path);
  if (observed.isSymbolicLink() || !samePath(path, await realpath(path))) fail(code);
}

async function safeChildren(path: string): Promise<Dirent<string>[]> {
  const children = await readdir(path, { withFileTypes: true });
  children.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  return children;
}

function requiredHistory(
  historyId: string,
  relativeDirectory: string,
  classification: Ar12HistoryClassification,
  requiredArtifacts: readonly Ar12RequiredHistoryArtifact[],
): Ar12RequiredHistoryEvidence {
  return { historyId, relativeDirectory, classification, required: true, formalAcceptanceEligible: false, requiredArtifacts };
}

function artifact(relativePath: string, sha256Value: string): Ar12RequiredHistoryArtifact {
  return { relativePath, sha256: sha256Value };
}

function assertSafeRelativePath(path: string): void {
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  ) fail('AR12_HISTORY_CONTRACT_INVALID');
}

function resolveInside(root: string, relativePath: string): string {
  assertSafeRelativePath(relativePath);
  const output = resolve(root, relativePath);
  const rel = relative(root, output);
  if (rel === '' || escapesRoot(rel)) fail('AR12_HISTORY_CONTRACT_INVALID');
  return output;
}

function parseRecord(bytes: Buffer, code: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) fail(code);
    throw error;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  fail('AR12_HISTORY_CONTRACT_INVALID');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}

function escapesRoot(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function fail(code: string): never {
  throw new Error(code);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

async function main(): Promise<void> {
  const repositoryRoot = resolve(import.meta.dirname, '../../../..');
  const outputArgumentIndex = process.argv.indexOf('--output-root');
  const outputRoot = outputArgumentIndex === -1
    ? join(repositoryRoot, '.runtime/rebaseline/ar-12')
    : resolve(process.argv[outputArgumentIndex + 1] ?? fail('AR12_HISTORY_CONTRACT_INVALID'));
  const baseline = await captureAr12HistoryEvidenceBaseline(
    outputRoot,
    join(outputRoot, 'ar12-history-contract-readonly-subject'),
  );
  process.stdout.write(`${JSON.stringify({
    status: 'PASSED',
    historyContractDigest: baseline.historyContractDigest,
    historicalEvidenceSetDigest: baseline.historicalEvidenceSetDigest,
    requiredHistoryCount: baseline.requiredHistoryCount,
    requiredHistoryPassedCount: baseline.requiredHistoryPassedCount,
    requiredHistories: baseline.requiredHistories.map((entry) => ({
      historyId: entry.historyId,
      relativeDirectory: entry.relativeDirectory,
      classification: entry.classification,
      contractDisposition: entry.contractDisposition,
      rejectionClassification: entry.rejectionClassification,
      directoryTreeDigest: entry.directoryTreeDigest,
      requiredArtifacts: entry.requiredArtifacts,
    })),
    recoveryArtifact: baseline.recoveryArtifact,
    staleCloneStatus: baseline.staleCloneStatus,
    discoveredAdditionalHistories: baseline.discoveredAdditionalHistories,
  }, null, 2)}\n`);
}

const invoked = process.argv[1] === undefined ? false :
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
