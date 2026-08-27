import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { ABG_GATES } from './abg-catalog.js';
import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  type AbgProducerId,
} from './abg-coverage-matrix.js';
import {
  getAbgCoverageMatrixDigest,
  getAbgProducerProtocolIdentityDigest,
  writeAbgGateProof,
  type AbgGateResult,
} from './abg-gate-proof.js';
import { readVerificationAuthorityIdentity } from './authoritative-abg-plan.js';
import { buildMatrixProducerEvidence } from './evidence/adapters.js';
import {
  createEvidenceItemFromFile,
  createEvidenceOutputDirectory,
  sha256,
  writeProducerEvidence,
  writeProducerEvidenceIndex,
  writeRedactedJsonArtifact,
} from './evidence/recorder.js';
import { PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION } from './evidence/protocol.js';
import { reviewFormalAbgEvidence } from './review-formal-abg-evidence.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const reviewerPath = resolve(import.meta.dirname, 'review-formal-abg-evidence.ts');
const tsxCliPath = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
const roots: string[] = [];
const RUN_ID = 'synthetic-formal-abg-review-0001';
const RUN_SEQUENCE = 17;
const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('formal ABG evidence reviewer CLI', () => {
  it('prints help without requiring an evidence package or runtime services', async () => {
    const result = await execFileAsync(process.execPath, [
      tsxCliPath,
      reviewerPath,
      '--help',
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('verify:phase-01:evidence');
    expect(result.stdout).toContain('--evidence-dir <directory>');
    expect(result.stdout).toContain('--review-output-dir <directory>');
  });

  it('returns a nonzero process exit while retaining machine-readable findings', async () => {
    const fixture = await createFormalEvidenceFixture();
    await writeFile(
      join(fixture.evidenceDirectory, 'manifest.sha256'),
      '0'.repeat(64) + '  manifest.json\n',
      { flag: 'w' },
    );

    let exitCode: number | string | undefined;
    try {
      await execFileAsync(process.execPath, [
        tsxCliPath,
        reviewerPath,
        '--evidence-dir',
        fixture.evidenceDirectory,
        '--review-output-dir',
        fixture.reviewOutputDirectory,
      ], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        windowsHide: true,
      });
    } catch (error) {
      exitCode = error instanceof Error && 'code' in error
        ? error.code as number | string | undefined
        : undefined;
    }

    expect(exitCode).toBe(1);
    const findings = JSON.parse(await readFile(
      join(fixture.reviewOutputDirectory, 'review-findings.json'),
      'utf8',
    )) as { readonly findings: readonly { readonly code: string }[] };
    expect(findings.findings.map((finding) => finding.code)).toContain('MANIFEST_SHA256_MISMATCH');
  });

  it('runs the standalone CLI successfully against a valid synthetic package', async () => {
    const fixture = await createFormalEvidenceFixture();
    const before = await treeDigest(fixture.evidenceDirectory);

    const result = await execFileAsync(process.execPath, [
      tsxCliPath,
      reviewerPath,
      '--evidence-dir',
      fixture.evidenceDirectory,
      '--review-output-dir',
      fixture.reviewOutputDirectory,
    ], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout) as { readonly status: string }).toMatchObject({
      status: 'PASSED',
    });
    expect(await treeDigest(fixture.evidenceDirectory)).toBe(before);
  });

  it('accepts a complete synthetic 40-gate package and leaves every source byte unchanged', async () => {
    const fixture = await createFormalEvidenceFixture();
    const before = await treeDigest(fixture.evidenceDirectory);

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
    });
    const findings = JSON.parse(await readFile(
      join(fixture.reviewOutputDirectory, 'review-findings.json'),
      'utf8',
    )) as { readonly findings: readonly unknown[] };

    expect(result.status, JSON.stringify(findings.findings)).toBe('PASSED');
    expect(result.failedCheckCount).toBe(0);
    expect(result.passedCheckCount).toBe(result.checkCount);
    expect(result.sourceEvidenceDigestBefore).toBe(result.sourceEvidenceDigestAfter);
    expect(await treeDigest(fixture.evidenceDirectory)).toBe(before);
    expect((await readdir(fixture.reviewOutputDirectory)).sort()).toEqual([
      'review-findings.json',
      'review.json',
      'review.sha256',
    ]);
    expect(findings.findings).toEqual([]);
  });
});

describe('formal ABG evidence manifest tamper detection', () => {
  it('rejects an incorrect manifest.sha256 while preserving findings', async () => {
    const fixture = await createFormalEvidenceFixture();
    await writeFile(
      join(fixture.evidenceDirectory, 'manifest.sha256'),
      '0'.repeat(64) + '  manifest.json\n',
      { flag: 'w' },
    );

    expect(await reviewFailureCodes(fixture)).toContain('MANIFEST_SHA256_MISMATCH');
  });

  it('rejects a forged file digest even when manifest.sha256 is recomputed', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateManifestEntry(fixture.evidenceDirectory, 'run-plan.json', (entry) => {
      entry['sha256'] = '0'.repeat(64);
    });

    expect(await reviewFailureCodes(fixture)).toContain('MANIFEST_FILE_SHA256_MISMATCH');
  });

  it('rejects a forged byteLength even when manifest.sha256 is recomputed', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateManifestEntry(fixture.evidenceDirectory, 'run-plan.json', (entry) => {
      entry['byteLength'] = Number(entry['byteLength']) + 1;
    });

    expect(await reviewFailureCodes(fixture)).toContain('MANIFEST_FILE_BYTE_LENGTH_MISMATCH');
  });

  it('rejects an extra file that is absent from the manifest', async () => {
    const fixture = await createFormalEvidenceFixture();
    await writeFile(join(fixture.evidenceDirectory, 'unlisted.log'), 'tamper\n', { flag: 'wx' });

    expect(await reviewFailureCodes(fixture)).toContain('MANIFEST_UNLISTED_FILE');
  });

  it('rejects a listed file that is missing from the package', async () => {
    const fixture = await createFormalEvidenceFixture();
    await unlink(join(fixture.evidenceDirectory, 'setup', '01', 'stdout.log'));

    expect(await reviewFailureCodes(fixture)).toContain('MANIFEST_FILE_MISSING');
  });

  it('rejects a tampered source artifact even when the manifest is rebuilt', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(
      fixture.evidenceDirectory,
      'shared/raw/fault.json',
      (artifact) => {
        artifact['status'] = 'FAILED';
      },
    );
    await rebuildManifest(fixture.evidenceDirectory);

    const codes = await reviewFailureCodes(fixture);
    expect(codes).toContain('PRODUCER_EVIDENCE_ITEM_SHA256_MISMATCH');
    expect(codes).toContain('PRODUCER_EVIDENCE_ITEM_STATUS_NOT_PASSED');
  });
});

describe('formal ABG gate, selector, and summary tamper detection', () => {
  it('rejects a duplicate gateId', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      const results = recordArray(summary['results']);
      results[1]!['gateId'] = results[0]!['gateId'];
    });

    expect(await reviewFailureCodes(fixture)).toContain('GATE_ID_DUPLICATE');
  });

  it('rejects a missing gate', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      recordArray(summary['results']).pop();
    });

    const codes = await reviewFailureCodes(fixture);
    expect(codes).toContain('GATE_RESULT_COUNT_INVALID');
    expect(codes).toContain('GATE_RESULT_MISSING');
  });

  it('rejects a gate proof with its gate-specific assertion removed', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateGateProof(fixture, 'ABG-16', (proof) => {
      proof['assertionIds'] = [];
    });

    expect(await reviewFailureCodes(fixture)).toContain('GATE_ASSERTIONS_MISMATCH');
  });

  it('rejects a selector that no longer exists in a gate proof', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateGateProof(fixture, 'ABG-16', (proof) => {
      recordArray(proof['evidenceRefs']).shift();
    });

    expect(await reviewFailureCodes(fixture)).toContain('GATE_SELECTOR_MISSING');
  });

  it('rejects a selector whose resolved claim belongs to another gate', async () => {
    const fixture = await createFormalEvidenceFixture();
    const assertionId = assertionFor('ABG-16');
    await mutateProducerEvidenceFile(fixture, 'fault', (evidence) => {
      assertionRecord(evidence, assertionId)['gateId'] = 'ABG-15';
    });

    expect(await reviewFailureCodes(fixture)).toContain('CLAIM_GATE_ID_MISMATCH');
  });

  it('rejects a selected claim whose status is FAILED', async () => {
    const fixture = await createFormalEvidenceFixture();
    const assertionId = assertionFor('ABG-16');
    await mutateProducerEvidenceFile(fixture, 'fault', (evidence) => {
      const assertion = assertionRecord(evidence, assertionId);
      assertion['status'] = 'FAILED';
      assertion['failureCode'] = 'SYNTHETIC_FAILURE';
    });

    expect(await reviewFailureCodes(fixture)).toContain('CLAIM_STATUS_NOT_PASSED');
  });

  it('rejects a forged selectedClaimDigest', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateGateProof(fixture, 'ABG-16', (proof) => {
      recordArray(proof['evidenceRefs'])[0]!['selectedClaimDigest'] = '0'.repeat(64);
    });

    expect(await reviewFailureCodes(fixture)).toContain('SELECTED_CLAIM_DIGEST_MISMATCH');
  });

  it('rejects a forged frozenInputsDigest', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      summary['frozenInputsDigest'] = '0'.repeat(64);
    });

    expect(await reviewFailureCodes(fixture)).toContain('FROZEN_INPUTS_DIGEST_MISMATCH');
  });

  it('rejects a forged passedCount', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      summary['passedCount'] = 39;
    });

    expect(await reviewFailureCodes(fixture)).toContain('PASSED_COUNT_MISMATCH');
  });

  it('rejects a forged overall status', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      summary['status'] = 'FAILED';
    });

    expect(await reviewFailureCodes(fixture)).toContain('RUN_STATUS_MISMATCH');
  });

  it('rejects a producer evidence runId that differs from the formal run', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateProducerEvidenceFile(fixture, 'fault', (evidence) => {
      evidence['runId'] = 'different-formal-run';
    });

    expect(await reviewFailureCodes(fixture)).toContain('PRODUCER_EVIDENCE_RUN_ID_MISMATCH');
  });
});

describe('formal ABG evidence directory and output safety', () => {
  it('rejects a manifest path traversal', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateManifestEntry(fixture.evidenceDirectory, 'run-plan.json', (entry) => {
      entry['path'] = '../run-plan.json';
    });

    expect(await reviewFailureCodes(fixture)).toContain('MANIFEST_PATH_UNSAFE');
  });

  it('rejects a symbolic link anywhere inside the evidence package', async () => {
    const fixture = await createFormalEvidenceFixture();
    const external = join(resolve(fixture.evidenceDirectory, '..'), 'external');
    await mkdir(external, { recursive: false });
    await symlink(
      external,
      join(fixture.evidenceDirectory, 'linked-evidence'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(await reviewFailureCodes(fixture)).toContain('EVIDENCE_SYMLINK_FORBIDDEN');
  });

  it('refuses a review output directory that already exists', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mkdir(fixture.reviewOutputDirectory, { recursive: false });

    await expect(reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
    })).rejects.toThrow('REVIEW_OUTPUT_ALREADY_EXISTS');
  });

  it('refuses to place review output inside the source evidence package', async () => {
    const fixture = await createFormalEvidenceFixture();
    const unsafeOutput = join(fixture.evidenceDirectory, 'review-output');
    const before = await treeDigest(fixture.evidenceDirectory);

    await expect(reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: unsafeOutput,
    })).rejects.toThrow('REVIEW_OUTPUT_INSIDE_SOURCE_EVIDENCE');
    expect(await treeDigest(fixture.evidenceDirectory)).toBe(before);
  });

  it('resolves an existing symlinked output ancestor before creating any directory', async () => {
    const fixture = await createFormalEvidenceFixture();
    const parent = resolve(fixture.evidenceDirectory, '..');
    const sourceAlias = join(parent, 'source-evidence-alias');
    const unsafeOutput = join(sourceAlias, 'injected-parent', 'review');
    const beforeFiles = await treeDigest(fixture.evidenceDirectory);
    const beforeEntries = (await readdir(fixture.evidenceDirectory)).sort();
    await symlink(
      fixture.evidenceDirectory,
      sourceAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: unsafeOutput,
    })).rejects.toThrow('REVIEW_OUTPUT_INSIDE_SOURCE_EVIDENCE');
    expect((await readdir(fixture.evidenceDirectory)).sort()).toEqual(beforeEntries);
    expect(await treeDigest(fixture.evidenceDirectory)).toBe(beforeFiles);
  });

  it('rejects 40 gate results that reuse one selector set', async () => {
    const fixture = await createFormalEvidenceFixture();
    const summaryPath = join(fixture.evidenceDirectory, 'abg-results.json');
    const summary = record(JSON.parse(await readFile(summaryPath, 'utf8')) as unknown);
    const results = recordArray(summary['results']);
    const sharedRefs = record(recordArray(results)[0]!['proof'])['evidenceRefs'];
    for (const result of results) {
      const proof = record(result['proof']);
      proof['evidenceRefs'] = JSON.parse(JSON.stringify(sharedRefs)) as unknown;
      await writeFile(
        join(fixture.evidenceDirectory, String(result['proofPath'])),
        JSON.stringify(proof, null, 2) + '\n',
        { flag: 'w' },
      );
    }
    await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', { flag: 'w' });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain('GATE_SELECTOR_SETS_NOT_DISTINCT');
  });
});

interface FormalEvidenceFixture {
  readonly evidenceDirectory: string;
  readonly reviewOutputDirectory: string;
}

async function reviewFailureCodes(fixture: FormalEvidenceFixture): Promise<readonly string[]> {
  const result = await reviewFormalAbgEvidence({
    evidenceDirectory: fixture.evidenceDirectory,
    reviewOutputDirectory: fixture.reviewOutputDirectory,
  });
  expect(result.status).toBe('FAILED');
  const findings = JSON.parse(await readFile(
    join(fixture.reviewOutputDirectory, 'review-findings.json'),
    'utf8',
  )) as { readonly findings: readonly { readonly code: string }[] };
  expect(findings.findings.length).toBeGreaterThan(0);
  return findings.findings.map((finding) => finding.code);
}

async function mutateManifestEntry(
  evidenceDirectory: string,
  relativePath: string,
  mutate: (entry: Record<string, unknown>) => void,
): Promise<void> {
  const manifestPath = join(evidenceDirectory, 'manifest.json');
  const manifest = record(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  const files = recordArray(manifest['files']);
  const entry = files.find((candidate) => candidate['path'] === relativePath);
  if (entry === undefined) throw new Error('fixture manifest entry missing:' + relativePath);
  mutate(entry);
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(manifestPath, bytes, { flag: 'w' });
  await writeFile(
    join(evidenceDirectory, 'manifest.sha256'),
    sha256(bytes) + '  manifest.json\n',
    { flag: 'w' },
  );
}

async function mutateSummary(
  fixture: FormalEvidenceFixture,
  mutate: (summary: Record<string, unknown>) => void,
): Promise<void> {
  await mutateJsonFile(fixture.evidenceDirectory, 'abg-results.json', mutate);
  await rebuildManifest(fixture.evidenceDirectory);
}

async function mutateGateProof(
  fixture: FormalEvidenceFixture,
  gateId: string,
  mutate: (proof: Record<string, unknown>) => void,
): Promise<void> {
  const summaryPath = join(fixture.evidenceDirectory, 'abg-results.json');
  const summary = record(JSON.parse(await readFile(summaryPath, 'utf8')) as unknown);
  const result = recordArray(summary['results']).find((candidate) => candidate['gateId'] === gateId);
  if (result === undefined) throw new Error('fixture gate result missing:' + gateId);
  const proof = record(result['proof']);
  mutate(proof);
  const proofPath = String(result['proofPath']);
  await writeFile(
    join(fixture.evidenceDirectory, proofPath),
    JSON.stringify(proof, null, 2) + '\n',
    { flag: 'w' },
  );
  await writeFile(summaryPath, JSON.stringify(summary, null, 2) + '\n', { flag: 'w' });
  await rebuildManifest(fixture.evidenceDirectory);
}

async function mutateProducerEvidenceFile(
  fixture: FormalEvidenceFixture,
  producerId: AbgProducerId,
  mutate: (evidence: Record<string, unknown>) => void,
): Promise<void> {
  const relativePath = producerId === 'formal-run'
    ? 'formal-run/producer-evidence.json'
    : 'shared/' + producerId + '/producer-evidence.json';
  await mutateJsonFile(fixture.evidenceDirectory, relativePath, mutate);
  await rebuildManifest(fixture.evidenceDirectory);
}

async function mutateJsonFile(
  evidenceDirectory: string,
  relativePath: string,
  mutate: (value: Record<string, unknown>) => void,
): Promise<void> {
  const path = join(evidenceDirectory, relativePath);
  const value = record(JSON.parse(await readFile(path, 'utf8')) as unknown);
  mutate(value);
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'w' });
}

function assertionFor(gateId: string): string {
  const assertionId = ABG_COVERAGE_MATRIX.find((entry) => entry.gateId === gateId)?.assertionIds[0];
  if (assertionId === undefined) throw new Error('fixture assertion missing:' + gateId);
  return assertionId;
}

function assertionRecord(
  evidence: Record<string, unknown>,
  assertionId: string,
): Record<string, unknown> {
  for (const scenario of Object.values(record(evidence['scenarios']))) {
    const assertions = record(record(scenario)['assertions']);
    if (Object.hasOwn(assertions, assertionId)) return record(assertions[assertionId]);
  }
  throw new Error('fixture assertion record missing:' + assertionId);
}

async function createFormalEvidenceFixture(): Promise<FormalEvidenceFixture> {
  const parent = await mkdtemp(join(tmpdir(), 'hdi-formal-abg-review-'));
  roots.push(parent);
  const evidenceDirectory = join(parent, 'evidence');
  const reviewOutputDirectory = join(parent, 'review');
  const sharedDirectory = join(evidenceDirectory, 'shared');
  await createEvidenceOutputDirectory(evidenceDirectory);
  await createEvidenceOutputDirectory(sharedDirectory);

  const frozenInputs = fixtureFrozenInputs();
  const sharedEntries = [];
  for (const producerId of ABG_PRODUCER_IDS.filter((candidate) => candidate !== 'formal-run')) {
    sharedEntries.push(await writeFixtureProducer({
      producerId,
      evidenceRoot: sharedDirectory,
      frozenInputs,
      rawArtifactPath: 'raw/' + producerId + '.json',
      evidencePath: producerId + '/producer-evidence.json',
    }));
  }
  await writeProducerEvidenceIndex(sharedDirectory, 'producer-evidence-index.json', {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    producers: sharedEntries,
  });

  await writeJson(join(evidenceDirectory, 'formal-run/preliminary-conclusion.json'), {
    schemaVersion: 'phase-01.abg-preconclusion.v1',
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    status: 'PASSED',
    coverageMatrixDigest: getAbgCoverageMatrixDigest(),
    producerProtocolIdentityDigest: getAbgProducerProtocolIdentityDigest(),
    gates: ABG_GATES.slice(0, 39).map((gate) => ({ gateId: gate.gateId, status: 'PASSED' })),
  });
  const formalEntry = await writeFixtureProducer({
    producerId: 'formal-run',
    evidenceRoot: evidenceDirectory,
    frozenInputs,
    rawArtifactPath: 'formal-run/preliminary-conclusion.json',
    evidencePath: 'formal-run/producer-evidence.json',
  });
  await writeProducerEvidenceIndex(evidenceDirectory, 'producer-evidence-index.json', {
    schemaVersion: PRODUCER_EVIDENCE_INDEX_SCHEMA_VERSION,
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    producers: [
      ...sharedEntries.map((entry) => ({ ...entry, relativePath: 'shared/' + entry.relativePath })),
      formalEntry,
    ],
  });

  const proofs: AbgGateResult[] = [];
  for (const entry of ABG_COVERAGE_MATRIX) {
    const resultRelativePath = 'gates/' + entry.gateId + '/producer/result.json';
    proofs.push(await writeAbgGateProof({
      gateId: entry.gateId,
      runId: RUN_ID,
      runSequence: RUN_SEQUENCE,
      evidenceRoot: evidenceDirectory,
      producerEvidenceIndexRelativePath: entry.gateId === 'ABG-40'
        ? 'producer-evidence-index.json'
        : 'shared/producer-evidence-index.json',
      resultRelativePath,
    }));
  }

  const setupCommands = [1, 2, 3].map((ordinal) => ({
    executable: 'synthetic-setup',
    args: ['step-' + ordinal],
  }));
  const gateCommands = ABG_GATES.map((gate) => ({
    gateId: gate.gateId,
    executable: 'node',
    args: ['tooling/verification/src/produce-abg-gate.ts'],
  }));
  const authorityIdentity = await readVerificationAuthorityIdentity(repositoryRoot);
  const plan = {
    schemaVersion: 'phase-01.abg-run-plan.v3',
    authorityId: 'phase-01.repository-authoritative-plan.v2',
    runSequence: RUN_SEQUENCE,
    frozenInputs,
    authorityIdentity,
    setupCommands,
    gates: gateCommands,
  };
  const planBytes = Buffer.from(JSON.stringify(plan, null, 2) + '\n', 'utf8');
  await writeFile(join(evidenceDirectory, 'run-plan.json'), planBytes, { flag: 'wx' });
  for (const ordinal of [1, 2, 3]) {
    const directory = join(evidenceDirectory, 'setup', String(ordinal).padStart(2, '0'));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'stdout.log'), 'synthetic setup passed\n', { flag: 'wx' });
    await writeFile(join(directory, 'stderr.log'), '', { flag: 'wx' });
  }

  const results = ABG_GATES.map((gate, index) => ({
    ...gate,
    ordinal: index + 1,
    runId: RUN_ID,
    status: 'PASSED',
    producerExitCode: 0,
    producerCommandDigest: digestJson(gateCommands[index]),
    elapsedMilliseconds: 1,
    proofPath: 'gates/' + gate.gateId + '/producer/result.json',
    proof: proofs[index],
  }));
  await writeJson(join(evidenceDirectory, 'abg-results.json'), {
    schemaVersion: 'phase-01.abg-run.v3',
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    planDigest: sha256(planBytes),
    frozenInputs,
    frozenInputsDigest: digestJson(frozenInputs),
    coverageMatrixDigest: authorityIdentity.coverageMatrixDigest,
    producerProtocolIdentityDigest: authorityIdentity.producerProtocolIdentityDigest,
    authorityIdentity,
    frozenInputsStable: true,
    authorityIdentityStable: true,
    selectorSetsDistinct: true,
    status: 'PASSED',
    startedAt: '2026-08-27T10:00:00',
    completedAt: '2026-08-27T10:01:00',
    timezone: 'Asia/Shanghai',
    setupResults: setupCommands.map((command, index) => ({
      ordinal: index + 1,
      commandDigest: digestJson(command),
      exitCode: 0,
      elapsedMilliseconds: 1,
    })),
    gateCount: 40,
    passedCount: 40,
    failedCount: 0,
    conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
    results,
  });
  await rebuildManifest(evidenceDirectory);
  return { evidenceDirectory, reviewOutputDirectory };
}

async function writeFixtureProducer(input: {
  readonly producerId: AbgProducerId;
  readonly evidenceRoot: string;
  readonly frozenInputs: Readonly<Record<string, string>>;
  readonly rawArtifactPath: string;
  readonly evidencePath: string;
}) {
  if (input.producerId !== 'formal-run') {
    await writeRedactedJsonArtifact(input.evidenceRoot, input.rawArtifactPath, {
      producerId: input.producerId,
      status: 'PASSED',
    });
  }
  const item = await createEvidenceItemFromFile(input.evidenceRoot, {
    artifactId: 'fixture-' + input.producerId + '-source',
    relativePath: input.rawArtifactPath,
    mediaType: 'application/json',
    jsonPointer: '/status',
    claim: { producerId: input.producerId, status: 'PASSED' },
  });
  const outcomes = Object.fromEntries(ABG_COVERAGE_MATRIX.flatMap((entry) =>
    entry.evidenceSelectors
      .filter((selector) => selector.producerId === input.producerId)
      .map((selector) => [selector.assertionId, {
        status: 'PASSED' as const,
        description: 'Synthetic gate-specific reviewer fixture assertion.',
        expected: { status: 'PASSED' },
        actual: { status: 'PASSED', assertionId: selector.assertionId },
      }]),
  ));
  const evidence = buildMatrixProducerEvidence({
    producerId: input.producerId,
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    startedAt: '2026-08-27T10:00:00',
    completedAt: '2026-08-27T10:00:01',
    processStatus: 'PASSED',
    commandIdentity: {
      executable: 'synthetic-fixture',
      arguments: [input.producerId],
      workingDirectory: 'repository-root',
      commandDigest: sha256(Buffer.from('synthetic-fixture:' + input.producerId, 'utf8')),
    },
    environmentRefs: { CI: DIGEST },
    frozenInputRefs: Object.fromEntries(ABG_FROZEN_INPUT_KINDS.map((kind) => [
      kind,
      input.frozenInputs[kind],
    ])),
    defaultEvidenceItems: [item],
    defaultReferences: {
      requestIds: ['request-' + input.producerId],
      principalIds: ['principal-' + input.producerId],
      governanceObjectIds: ['governance-object-' + input.producerId],
      versionIds: ['version-' + input.producerId],
      ruleVersions: ['rule-version-' + input.producerId],
      artifactDigests: [item.sha256],
    },
    outcomes,
  });
  return writeProducerEvidence(input.evidenceRoot, input.evidencePath, evidence);
}

function fixtureFrozenInputs(): Readonly<Record<string, string>> {
  return {
    gitCommitSha: '0123456789abcdef0123456789abcdef01234567',
    workingTreeState: 'CLEAN',
    lockfileSha256: DIGEST,
    openapiSha256: DIGEST,
    migrationManifestSha256: DIGEST,
    fixtureIdentity: DIGEST,
    nodeVersion: 'v24.18.0',
    postgresImage: 'postgres:18.4',
    keycloakImage: 'quay.io/keycloak/keycloak:26.7.0',
    browserVersion: '1.61.0',
  } satisfies Record<(typeof ABG_FROZEN_INPUT_KINDS)[number] | 'workingTreeState', string>;
}

async function rebuildManifest(directory: string): Promise<void> {
  const names = (await collectFiles(directory))
    .filter((name) => name !== 'manifest.json' && name !== 'manifest.sha256')
    .sort((left, right) => left.localeCompare(right));
  const files = await Promise.all(names.map(async (name) => {
    const bytes = await readFile(join(directory, name));
    return {
      path: name.replaceAll('\\', '/'),
      mediaType: mediaType(name),
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    };
  }));
  const manifestBytes = Buffer.from(JSON.stringify({
    schemaVersion: 'phase-01.evidence-manifest.v1',
    files,
  }, null, 2) + '\n', 'utf8');
  await writeFile(join(directory, 'manifest.json'), manifestBytes, { flag: 'w' });
  await writeFile(
    join(directory, 'manifest.sha256'),
    sha256(manifestBytes) + '  manifest.json\n',
    { flag: 'w' },
  );
}

async function collectFiles(directory: string, prefix = ''): Promise<readonly string[]> {
  const names: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      names.push(...await collectFiles(join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      names.push(relativePath);
    }
  }
  return names;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
}

function digestJson(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), 'utf8'));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error('fixture JSON value unsupported');
    return serialized;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).sort().map((key) =>
      JSON.stringify(key) + ':' + canonicalJson(record[key]),
    ).join(',') + '}';
  }
  throw new Error('fixture JSON value unsupported');
}

function mediaType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.json': return 'application/json';
    case '.xml': return 'application/xml';
    case '.html': return 'text/html; charset=utf-8';
    case '.png': return 'image/png';
    case '.zip': return 'application/zip';
    default: return 'text/plain; charset=utf-8';
  }
}

async function treeDigest(directory: string): Promise<string> {
  const hash = createHash('sha256');
  for (const name of [...await collectFiles(directory)].sort((left, right) => left.localeCompare(right))) {
    const bytes = await readFile(join(directory, name));
    const metadata = await stat(join(directory, name));
    hash.update(relative(directory, join(directory, name)).replaceAll('\\', '/'));
    hash.update('\0' + String(metadata.size) + '\0');
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('fixture record expected');
  }
  return value as Record<string, unknown>;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error('fixture record array expected');
  for (const item of value) record(item);
  return value as Record<string, unknown>[];
}
