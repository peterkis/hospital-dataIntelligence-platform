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
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ABG_COVERAGE_MATRIX,
  type AbgProducerId,
} from './abg-coverage-matrix.js';
import { sha256 } from './evidence/recorder.js';
import { createSourceManifestBuilder } from './provenance/source-manifest.js';
import { digestVerificationProvenanceJson } from './provenance/source-manifest-schema.js';
import {
  reviewFormalAbgEvidence,
  type ReviewFormalAbgEvidenceDependencies,
} from './review-formal-abg-evidence.js';
import {
  buildValidEvidenceFixture,
  rebuildFixtureManifest,
} from './testing/build-valid-evidence-fixture.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const reviewerPath = resolve(import.meta.dirname, 'review-formal-abg-evidence.ts');
const tsxCliPath = resolve(repositoryRoot, 'node_modules/tsx/dist/cli.mjs');
const roots: string[] = [];

// These reviews build and hash complete evidence packages. Parallel full-suite
// load can legitimately exceed Vitest's 5 s default without indicating a hang.
vi.setConfig({ testTimeout: 15_000 });

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

  it('retains machine-readable findings when review fails', async () => {
    const fixture = await createFormalEvidenceFixture();
    await writeFile(
      join(fixture.evidenceDirectory, 'manifest.sha256'),
      '0'.repeat(64) + '  manifest.json\n',
      { flag: 'w' },
    );

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });

    expect(result.reviewStatus).toBe('FAILED');
    const findings = JSON.parse(await readFile(
      join(fixture.reviewOutputDirectory, 'review-findings.json'),
      'utf8',
    )) as { readonly findings: readonly { readonly code: string }[] };
    expect(findings.findings.map((finding) => finding.code)).toContain('MANIFEST_SHA256_MISMATCH');
  });

  it('returns process exit 1 while retaining standalone CLI findings', async () => {
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
    expect(await reviewFindingCodes(fixture.reviewOutputDirectory))
      .toContain('MANIFEST_SHA256_MISMATCH');
  }, 60_000);

  it('accepts the exact contract through the public reviewer seam without host Git coupling', async () => {
    const fixture = await createFormalEvidenceFixture();
    const before = await treeDigest(fixture.evidenceDirectory);

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });

    expect(result).toMatchObject({
      reviewStatus: 'PASSED',
      producerProvenanceStatus: 'VERIFIED',
      reviewerContractStatus: 'EXACT',
      definitionDriftStatus: 'NONE',
      reviewerWorktreeStatus: 'CLEAN',
      failedCheckCount: 0,
    });
    expect(await treeDigest(fixture.evidenceDirectory)).toBe(before);
  });

  it('returns a stable cleanup code for a cleanup-failed v4 fixture', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/cleanup.json', (cleanup) => {
      cleanup['status'] = 'FAILED';
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_CLEANUP_STATUS_NOT_PASSED');
  });

  it('returns a stable code when terminal conclusion is missing', async () => {
    const fixture = await createFormalEvidenceFixture();
    await unlink(join(fixture.evidenceDirectory, 'runtime/terminal-conclusion.json'));
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture))
      .toContain('FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING');
  });

  it('accepts a complete synthetic 40-gate package and leaves every source byte unchanged', async () => {
    const fixture = await createFormalEvidenceFixture();
    const before = await treeDigest(fixture.evidenceDirectory);

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
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
      'provenance',
      'review-findings.json',
      'review-manifest.json',
      'review-manifest.sha256',
      'review.json',
      'review.sha256',
    ]);
    expect(findings.findings).toEqual([]);
  });

  it('fails when source evidence bytes change during review', async () => {
    const fixture = await createFormalEvidenceFixture();
    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
      async beforeFinalSourceIdentityCapture() {
        await writeFile(
          join(fixture.evidenceDirectory, 'concurrent-tamper.txt'),
          'changed during review\n',
          { flag: 'wx' },
        );
      },
    });
    const findings = JSON.parse(await readFile(
      join(fixture.reviewOutputDirectory, 'review-findings.json'),
      'utf8',
    )) as { readonly findings: readonly { readonly code: string }[] };

    expect(result.status).toBe('FAILED');
    expect(findings.findings.map((finding) => finding.code))
      .toContain('SOURCE_EVIDENCE_CHANGED_DURING_REVIEW');
  });
});

describe('formal ABG provenance and compatibility review', () => {
  it('verifies producer Git provenance before capturing reviewer definitions', async () => {
    const fixture = await createFormalEvidenceFixture();
    const events: string[] = [];
    const git = fixture.reviewerDependencies.git;
    const repository = fixture.reviewerDependencies.repository;

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        git: {
          ...git,
          async commitExists(repositoryRoot, commitSha) {
            events.push('producer-provenance');
            return git.commitExists(repositoryRoot, commitSha);
          },
        },
        repository: {
          async readState(repositoryRoot) {
            events.push('reviewer-manifest');
            return repository.readState(repositoryRoot);
          },
        },
      },
    });

    expect(result.reviewStatus).toBe('PASSED');
    expect(events[0]).toBe('producer-provenance');
    expect(events.indexOf('producer-provenance'))
      .toBeLessThan(events.indexOf('reviewer-manifest'));
  });

  it('distinguishes an unavailable producer commit from evidence tampering', async () => {
    const fixture = await createFormalEvidenceFixture();
    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        git: {
          ...fixture.reviewerDependencies.git,
          async commitExists() {
            return false;
          },
        },
      },
    });

    expect(result).toMatchObject({
      evidenceIntegrityStatus: 'PASSED',
      producerProvenanceStatus: 'UNVERIFIABLE',
      reviewStatus: 'FAILED',
    });
    expect(await reviewFindingCodes(fixture.reviewOutputDirectory))
      .toContain('PRODUCER_COMMIT_UNAVAILABLE');
  });

  it('rejects a resealed semantic authority fabrication that retains the producer entry byte digest', async () => {
    const fixture = await createFormalEvidenceFixture();
    let fabricatedSemanticDigest = '';
    await mutateJsonFile(
      fixture.evidenceDirectory,
      'runtime/runtime-authority-snapshot.json',
      (snapshot) => {
        const authority = record(snapshot['authority']);
        const host = record(authority['host']);
        host['memoryToleranceBytes'] = Number(host['memoryToleranceBytes']) + 1;
        fabricatedSemanticDigest = digestVerificationProvenanceJson(authority);
        snapshot['runtimeAuthoritySemanticDigest'] = fabricatedSemanticDigest;
      },
    );
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/preflight.json', (preflight) => {
      preflight['runtimeAuthoritySemanticDigest'] = fabricatedSemanticDigest;
      for (const check of recordArray(preflight['checks'])) {
        if (check['id'] === 'runtime-authority') {
          const observed = record(check['observed']);
          observed['runtimeAuthoritySemanticDigest'] = fabricatedSemanticDigest;
        }
        if (check['id'] === 'git-frozen-inputs-readable') {
          const inputs = record(record(check['observed'])['inputs']);
          inputs['runtimeAuthoritySemanticDigest'] = fabricatedSemanticDigest;
        }
      }
    });
    await mutateJsonFile(fixture.evidenceDirectory, 'abg-results.json', (summary) => {
      summary['runtimeAuthoritySemanticDigest'] = fabricatedSemanticDigest;
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture))
      .toContain('FORMAL_RUNTIME_AUTHORITY_PRODUCER_BINDING_MISMATCH');
  });

  it('reports a malformed producer commit SHA with its stable provenance code', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateProducerSourceManifest(fixture, (sourceManifest) => {
      sourceManifest['producerGitCommitSha'] = 'not-a-git-commit';
    });

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });

    expect(result).toMatchObject({
      producerProvenanceStatus: 'INVALID',
      reviewStatus: 'FAILED',
    });
    const codes = await reviewFindingCodes(fixture.reviewOutputDirectory);
    expect(codes).toContain('PRODUCER_COMMIT_INVALID');
    expect(codes).not.toContain('PRODUCER_SOURCE_MANIFEST_SCHEMA_UNSUPPORTED');
  });

  it('writes a failed review and reviewer manifest for a dirty reviewer worktree', async () => {
    const fixture = await createFormalEvidenceFixture();
    const repository = fixture.reviewerDependencies.repository;
    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        repository: {
          async readState(root) {
            return { ...await repository.readState(root), worktreeStatus: 'DIRTY' };
          },
        },
      },
    });

    expect(result).toMatchObject({
      evidenceIntegrityStatus: 'PASSED',
      reviewerWorktreeStatus: 'DIRTY',
      reviewStatus: 'FAILED',
    });
    expect(await reviewFindingCodes(fixture.reviewOutputDirectory))
      .toContain('REVIEWER_WORKTREE_DIRTY');
    expect(await readFile(
      join(fixture.reviewOutputDirectory, 'provenance/reviewer-source-manifest.json'),
      'utf8',
    )).toContain('"reviewerWorktreeState":"DIRTY"');
  });

  it('fails closed when the reviewer checkout changes during review', async () => {
    const fixture = await createFormalEvidenceFixture();
    const repository = fixture.reviewerDependencies.repository;
    let changed = false;

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        repository: {
          async readState(root) {
            const state = await repository.readState(root);
            return changed ? { ...state, worktreeStatus: 'DIRTY' as const } : state;
          },
        },
      },
      async beforeFinalSourceIdentityCapture() {
        changed = true;
      },
    });

    expect(result).toMatchObject({
      reviewerWorktreeStatus: 'DIRTY',
      reviewerContractStatus: 'EXACT',
      definitionDriftStatus: 'NONE',
      reviewStatus: 'FAILED',
    });
    const codes = await reviewFindingCodes(fixture.reviewOutputDirectory);
    expect(codes).toEqual(
      expect.arrayContaining([
        'REVIEWER_WORKTREE_DIRTY',
        'REVIEWER_REPOSITORY_STATE_CHANGED_DURING_REVIEW',
      ]),
    );
    expect(codes).not.toContain('REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH');
  });

  it('fails closed when reviewer source definitions change during review', async () => {
    const fixture = await createFormalEvidenceFixture();
    const builder = createSourceManifestBuilder(fixture.reviewerDependencies);
    let captureCount = 0;

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        sourceManifestBuilder: {
          buildProducer: (root) => builder.buildProducer(root),
          async buildReviewer(root) {
            const manifest = await builder.buildReviewer(root);
            captureCount += 1;
            if (captureCount === 1) return manifest;
            const sourceFiles = manifest.sourceFiles.map((entry) =>
              entry.role === 'REVIEWER'
                ? { ...entry, sha256: 'f'.repeat(64) }
                : entry
            );
            return {
              ...manifest,
              sourceFiles,
              sourceFilesDigest: digestVerificationProvenanceJson(sourceFiles),
            };
          },
        },
      },
    });

    expect(captureCount).toBe(2);
    expect(result).toMatchObject({
      reviewerWorktreeStatus: 'CLEAN',
      reviewerContractStatus: 'COMPATIBLE',
      definitionDriftStatus: 'UNRESOLVED',
      reviewStatus: 'FAILED',
    });
    const codes = await reviewFindingCodes(fixture.reviewOutputDirectory);
    expect(codes).toEqual(expect.arrayContaining([
      'REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH',
      'REVIEWER_TOOL_DEFINITION_DRIFT',
      'REVIEWER_CONTRACT_EXACT_MATCH_REQUIRED',
    ]));
    expect(codes).not.toContain('REVIEWER_REPOSITORY_STATE_CHANGED_DURING_REVIEW');
  });

  it('ignores generatedAt changes when reviewer definitions remain stable', async () => {
    const fixture = await createFormalEvidenceFixture();
    let tick = 0;

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        clock: () => new Date(Date.UTC(2026, 7, 30, 0, 0, tick++)).toISOString(),
      },
    });

    expect(result).toMatchObject({
      reviewerWorktreeStatus: 'CLEAN',
      definitionDriftStatus: 'NONE',
      reviewStatus: 'PASSED',
    });
  });

  it('captures the final reviewer state before creating review output', async () => {
    const fixture = await createFormalEvidenceFixture();
    const repository = fixture.reviewerDependencies.repository;

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        repository: {
          async readState(root) {
            const state = await repository.readState(root);
            return await directoryExists(fixture.reviewOutputDirectory)
              ? { ...state, worktreeStatus: 'DIRTY' as const }
              : state;
          },
        },
      },
    });

    expect(result).toMatchObject({
      reviewerWorktreeStatus: 'CLEAN',
      reviewStatus: 'PASSED',
    });
    expect(await directoryExists(fixture.reviewOutputDirectory)).toBe(true);
  });

  it('classifies parseable definition drift as compatible but never passed', async () => {
    const fixture = await createFormalEvidenceFixture();
    const workspace = fixture.reviewerDependencies.workspace;
    const repository = fixture.reviewerDependencies.repository;
    const git = fixture.reviewerDependencies.git;
    const reviewerCommit = '2'.repeat(40);
    const driftBytes = Buffer.from('reviewer-definition-drift', 'utf8');
    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        repository: {
          async readState(root) {
            return { ...await repository.readState(root), gitCommitSha: reviewerCommit };
          },
        },
        git: {
          async commitExists() {
            return true;
          },
          async readBlob(root, commitSha, path) {
            if (commitSha !== reviewerCommit) return git.readBlob(root, commitSha, path);
            const source = await workspace.readSourceFile(root, path);
            if (source.kind !== 'REGULAR' || source.bytes === undefined) return null;
            const bytes = path === 'tooling/verification/src/abg-coverage-matrix.ts'
              ? driftBytes
              : Buffer.from(source.bytes);
            return { mode: '100644', oid: gitBlobOid(bytes), bytes };
          },
        },
        workspace: {
          async readSourceFile(root, path) {
            const source = await workspace.readSourceFile(root, path);
            return path === 'tooling/verification/src/abg-coverage-matrix.ts'
              ? { kind: 'REGULAR', bytes: driftBytes }
              : source;
          },
        },
      },
    });

    expect(result).toMatchObject({
      evidenceIntegrityStatus: 'PASSED',
      reviewerContractStatus: 'COMPATIBLE',
      definitionDriftStatus: 'DRIFTED',
      reviewStatus: 'FAILED',
    });
    const codes = await reviewFindingCodes(fixture.reviewOutputDirectory);
    expect(codes).toContain('REVIEWER_DEFINITION_DRIFT');
    expect(codes).toContain('COVERAGE_MATRIX_DEFINITION_DRIFT');
    expect(codes).toContain('REVIEWER_CONTRACT_EXACT_MATCH_REQUIRED');
  });

  it('limits an unknown tuple to incompatible envelope review', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'abg-results.json', (summary) => {
      summary['schemaVersion'] = 'phase-01.abg-run.v999';
    });
    await rebuildManifest(fixture.evidenceDirectory);

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });

    expect(result).toMatchObject({
      reviewerContractStatus: 'INCOMPATIBLE',
      reviewStatus: 'FAILED',
    });
    const codes = await reviewFindingCodes(fixture.reviewOutputDirectory);
    expect(codes).toContain('REVIEWER_CONTRACT_VERSION_UNKNOWN');
    expect(codes).toContain('REVIEWER_CONTRACT_INCOMPATIBLE');
    expect(codes).toContain('REVIEWER_CONTRACT_EXACT_MATCH_REQUIRED');
    expect(codes).toContain('EVIDENCE_CONTRACT_TUPLE_INCONSISTENT');
    expect(codes).not.toContain('RUN_SUMMARY_SCHEMA_VERSION_INVALID');
    expect(result.evidenceIntegrityStatus).toBe('FAILED');
  });

  it('fails closed when the reviewer commit identity is invalid', async () => {
    const fixture = await createFormalEvidenceFixture();
    const repository = fixture.reviewerDependencies.repository;

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: {
        ...fixture.reviewerDependencies,
        repository: {
          async readState(root) {
            return { ...await repository.readState(root), gitCommitSha: 'not-a-commit' };
          },
        },
      },
    });

    expect(result).toMatchObject({
      reviewerGitCommitSha: null,
      reviewerWorktreeStatus: 'CLEAN',
      reviewStatus: 'FAILED',
    });
    expect(await reviewFindingCodes(fixture.reviewOutputDirectory))
      .toContain('REVIEWER_GIT_COMMIT_UNAVAILABLE');
  });

  it('classifies mixed producer evidence versions as evidence integrity failure', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateProducerEvidenceFile(fixture, 'fault', (evidence) => {
      evidence['schemaVersion'] = 'phase-01.producer-evidence.v999';
    });

    const result = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });

    expect(result).toMatchObject({
      evidenceIntegrityStatus: 'FAILED',
      reviewerContractStatus: 'INCOMPATIBLE',
      reviewStatus: 'FAILED',
    });
    expect(await reviewFindingCodes(fixture.reviewOutputDirectory))
      .toContain('REVIEWER_CONTRACT_VERSION_MIXED');
  });

  it('seals reviewer identity and findings in a deterministic review manifest', async () => {
    const fixture = await createFormalEvidenceFixture();
    await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });

    const reviewManifestBytes = await readFile(
      join(fixture.reviewOutputDirectory, 'review-manifest.json'),
    );
    const reviewManifest = record(JSON.parse(reviewManifestBytes.toString('utf8')) as unknown);
    const paths = recordArray(reviewManifest['files']).map((entry) => String(entry['path']));
    expect(paths).toEqual([...paths].sort());
    expect(paths).toEqual(expect.arrayContaining([
      'review.json',
      'review-findings.json',
      'provenance/reviewer-source-manifest.json',
      'provenance/reviewer-source-manifest.sha256',
    ]));
    expect(paths).not.toContain('review-manifest.json');
    expect(await readFile(
      join(fixture.reviewOutputDirectory, 'review-manifest.sha256'),
      'utf8',
    )).toBe(sha256(reviewManifestBytes) + '  review-manifest.json\n');
  });
});

describe('formal ABG terminal lifecycle review', () => {
  it.each([
    ['runtime/preflight.json', 'FORMAL_LIFECYCLE_PREFLIGHT_MISSING'],
    ['runtime/resources-started.json', 'FORMAL_LIFECYCLE_RESOURCES_STARTED_MISSING'],
    ['runtime/producer-evidence-snapshot.json', 'FORMAL_LIFECYCLE_PRODUCER_EVIDENCE_SNAPSHOT_MISSING'],
    ['runtime/failure-summary.json', 'FORMAL_LIFECYCLE_FAILURE_SUMMARY_MISSING'],
    ['runtime/resources-final.json', 'FORMAL_LIFECYCLE_RESOURCES_FINAL_MISSING'],
    ['runtime/cleanup.json', 'FORMAL_LIFECYCLE_CLEANUP_MISSING'],
    ['runtime/terminal-conclusion.json', 'FORMAL_LIFECYCLE_TERMINAL_CONCLUSION_MISSING'],
    ['runtime/final-outcome.json', 'FORMAL_LIFECYCLE_FINAL_OUTCOME_MISSING'],
  ] as const)('rejects a package missing %s', async (relativePath, expectedCode) => {
    const fixture = await createFormalEvidenceFixture();
    await unlink(join(fixture.evidenceDirectory, relativePath));
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain(expectedCode);
  });

  it('rejects cleanup FAILED even when abg-results still claims PASSED', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/cleanup.json', (cleanup) => {
      cleanup['status'] = 'FAILED';
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_CLEANUP_STATUS_NOT_PASSED');
  });

  it.each([
    ['runtime/cleanup.json', 'residualResources', 'FORMAL_CLEANUP_RESIDUAL_RESOURCES_INVALID'],
    ['runtime/cleanup.json', 'occupiedPorts', 'FORMAL_CLEANUP_OCCUPIED_PORTS_INVALID'],
    ['runtime/resources-final.json', 'resources', 'FORMAL_FINAL_RESOURCES_INVALID'],
    ['runtime/resources-final.json', 'ports', 'FORMAL_FINAL_PORTS_INVALID'],
  ] as const)('rejects a malformed lifecycle array at %s#/%s', async (relativePath, field, code) => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, relativePath, (recordValue) => {
      recordValue[field] = null;
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain(code);
  });

  it('binds the pre-cleanup producer snapshot to manifested producer bytes', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(
      fixture.evidenceDirectory,
      'runtime/producer-evidence-snapshot.json',
      (snapshot) => {
        recordArray(snapshot['producerProtocolEvidence'])[0]!['sha256'] = 'f'.repeat(64);
      },
    );
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture))
      .toContain('FORMAL_PRODUCER_SNAPSHOT_FILE_IDENTITY_MISMATCH');
  });

  it('binds summary Git identity to the frozen run plan', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      summary['gitCommitSha'] = 'f'.repeat(40);
    });

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_SUMMARY_GIT_COMMIT_MISMATCH');
  });

  it('requires runtimeNamespace to be canonically derived from run identity', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateSummary(fixture, (summary) => {
      summary['runtimeNamespace'] = 'hdi_phase01_abg_999_forgednamespace';
    });

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_RUNTIME_NAMESPACE_MISMATCH');
  });

  it.each([
    ['container', 'FORMAL_RESIDUAL_CONTAINER_PRESENT'],
    ['volume', 'FORMAL_RESIDUAL_VOLUME_PRESENT'],
    ['network', 'FORMAL_RESIDUAL_NETWORK_PRESENT'],
  ] as const)('rejects a residual %s', async (resourceType, expectedCode) => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/resources-final.json', (snapshot) => {
      snapshot['resources'] = [syntheticResidualResource(resourceType)];
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain(expectedCode);
  });

  it('rejects an occupied required port', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/resources-final.json', (snapshot) => {
      recordArray(snapshot['ports'])[0]!['occupied'] = true;
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_REQUIRED_PORT_OCCUPIED');
  });

  it('rejects a missing required port observation', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/resources-final.json', (snapshot) => {
      recordArray(snapshot['ports']).pop();
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_REQUIRED_PORT_OBSERVATION_MISSING');
  });

  it('rejects any prune invocation', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/cleanup.json', (cleanup) => {
      cleanup['pruneCommandsInvoked'] = true;
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain('FORMAL_PRUNE_COMMAND_INVOKED');
  });

  it.each([
    ['residualContainerCount', 1, 'FORMAL_TERMINAL_RESIDUAL_CONTAINER_PRESENT'],
    ['residualVolumeCount', 1, 'FORMAL_TERMINAL_RESIDUAL_VOLUME_PRESENT'],
    ['residualNetworkCount', 1, 'FORMAL_TERMINAL_RESIDUAL_NETWORK_PRESENT'],
    ['failureCodes', ['FORGED_TERMINAL_FAILURE'], 'FORMAL_TERMINAL_FAILURE_CODES_PRESENT'],
  ] as const)('rejects inconsistent terminal field %s', async (field, value, code) => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/terminal-conclusion.json', (terminal) => {
      terminal[field] = value;
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture)).toContain(code);
  });

  it('independently rederives both terminal assertion bodies', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/terminal-conclusion.json', (terminal) => {
      const assertions = record(terminal['assertions']);
      record(assertions['terminalLifecycle'])['actual'] = { cleanupStatus: 'FAILED' };
      record(assertions['sealEligibility'])['failureCodes'] = ['FORGED_SEAL_FAILURE'];
    });
    await rebuildManifest(fixture.evidenceDirectory);

    const codes = await reviewFailureCodes(fixture);
    expect(codes).toContain('FORMAL_TERMINAL_LIFECYCLE_ASSERTION_INCONSISTENT');
    expect(codes).toContain('FORMAL_TERMINAL_SEAL_ASSERTION_INCONSISTENT');
  });

  it('rejects final-outcome seal eligibility disagreement', async () => {
    const fixture = await createFormalEvidenceFixture();
    await mutateJsonFile(fixture.evidenceDirectory, 'runtime/final-outcome.json', (outcome) => {
      outcome['sealEligibilityStatus'] = 'FAILED';
    });
    await rebuildManifest(fixture.evidenceDirectory);

    expect(await reviewFailureCodes(fixture))
      .toContain('FORMAL_FINAL_OUTCOME_SEAL_STATUS_MISMATCH');
  });

  it('rejects ABG-40 references to the retired preliminary conclusion', async () => {
    const fixture = await createFormalEvidenceFixture();
    await writeFile(
      join(fixture.evidenceDirectory, 'formal-run/preliminary-conclusion.json'),
      '{"status":"PASSED"}\n',
      { flag: 'wx' },
    );
    await mutateProducerEvidenceFile(fixture, 'formal-run', (evidence) => {
      for (const scenario of Object.values(record(evidence['scenarios']))) {
        for (const assertion of Object.values(record(record(scenario)['assertions']))) {
          for (const item of recordArray(record(assertion)['evidenceItems'])) {
            item['relativePath'] = 'formal-run/preliminary-conclusion.json';
            item['jsonPointer'] = '/status';
          }
        }
      }
    });

    expect(await reviewFailureCodes(fixture)).toContain('ABG40_TERMINAL_EVIDENCE_REFERENCE_INVALID');
  });

  it('rejects ABG-40 without its seal assertion and a mismatched final outcome', async () => {
    const missingAssertion = await createFormalEvidenceFixture();
    await mutateProducerEvidenceFile(missingAssertion, 'formal-run', (evidence) => {
      for (const scenario of Object.values(record(evidence['scenarios']))) {
        delete record(record(scenario)['assertions'])['ABG-40:formal-evidence-seal-eligible'];
      }
    });
    expect(await reviewFailureCodes(missingAssertion)).toContain('ABG40_SEAL_ASSERTION_MISSING');

    const mismatchedOutcome = await createFormalEvidenceFixture();
    await mutateJsonFile(mismatchedOutcome.evidenceDirectory, 'runtime/final-outcome.json', (outcome) => {
      outcome['status'] = 'FAILED';
    });
    await rebuildManifest(mismatchedOutcome.evidenceDirectory);
    expect(await reviewFailureCodes(mismatchedOutcome)).toContain('FORMAL_FINAL_OUTCOME_STATUS_MISMATCH');
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
      dependencies: fixture.reviewerDependencies,
    })).rejects.toThrow('REVIEW_OUTPUT_ALREADY_EXISTS');
  });

  it('refuses to place review output inside the source evidence package', async () => {
    const fixture = await createFormalEvidenceFixture();
    const unsafeOutput = join(fixture.evidenceDirectory, 'review-output');
    const before = await treeDigest(fixture.evidenceDirectory);

    await expect(reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: unsafeOutput,
      dependencies: fixture.reviewerDependencies,
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
      dependencies: fixture.reviewerDependencies,
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
  readonly reviewerDependencies: ReviewFormalAbgEvidenceDependencies;
}

async function reviewFailureCodes(fixture: FormalEvidenceFixture): Promise<readonly string[]> {
  const result = await reviewFormalAbgEvidence({
    evidenceDirectory: fixture.evidenceDirectory,
    reviewOutputDirectory: fixture.reviewOutputDirectory,
    dependencies: fixture.reviewerDependencies,
  });
  expect(result.status).toBe('FAILED');
  const findings = JSON.parse(await readFile(
    join(fixture.reviewOutputDirectory, 'review-findings.json'),
    'utf8',
  )) as { readonly findings: readonly { readonly code: string }[] };
  expect(findings.findings.length).toBeGreaterThan(0);
  return findings.findings.map((finding) => finding.code);
}

async function reviewFindingCodes(reviewOutputDirectory: string): Promise<readonly string[]> {
  const findings = JSON.parse(await readFile(
    join(reviewOutputDirectory, 'review-findings.json'),
    'utf8',
  )) as { readonly findings: readonly { readonly code: string }[] };
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

async function mutateProducerSourceManifest(
  fixture: FormalEvidenceFixture,
  mutate: (sourceManifest: Record<string, unknown>) => void,
): Promise<void> {
  const relativePath = 'provenance/producer-source-manifest.json';
  const manifestPath = join(fixture.evidenceDirectory, relativePath);
  const sourceManifest = record(JSON.parse(await readFile(manifestPath, 'utf8')) as unknown);
  mutate(sourceManifest);
  const bytes = Buffer.from(JSON.stringify(sourceManifest) + '\n', 'utf8');
  await writeFile(manifestPath, bytes, { flag: 'w' });
  await writeFile(
    join(fixture.evidenceDirectory, 'provenance/producer-source-manifest.sha256'),
    sha256(bytes) + '  producer-source-manifest.json\n',
    { flag: 'w' },
  );
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
  const fixture = await buildValidEvidenceFixture({ rootDirectory: parent });
  return {
    evidenceDirectory: fixture.evidenceDirectory,
    reviewOutputDirectory: fixture.reviewOutputDirectory,
    reviewerDependencies: {
      ...fixture.reviewerDependencies,
      repositoryRoot: fixture.reviewerDependencies.repositoryRoot,
    },
  };
}

async function rebuildManifest(directory: string): Promise<void> {
  await rebuildFixtureManifest(directory);
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

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
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

function gitBlobOid(bytes: Uint8Array): string {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function syntheticResidualResource(resourceType: 'container' | 'volume' | 'network') {
  return {
    resourceType,
    id: `residual-${resourceType}`,
    name: `residual-${resourceType}`,
    labels: {},
    source: 'podman-inspect',
    present: true,
    active: true,
    state: 'PRESENT',
    imageReference: null,
    imageId: null,
    imageDigest: null,
    ports: [],
    startedAt: null,
    stoppedAt: null,
    exitStatus: null,
    metrics: null,
  };
}
