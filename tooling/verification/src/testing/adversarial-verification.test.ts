import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reviewFormalAbgEvidence } from '../review-formal-abg-evidence.js';
import {
  buildValidEvidenceFixture,
  type ValidEvidenceFixture,
} from './build-valid-evidence-fixture.js';
import {
  ADVERSARIAL_MUTATION_CASES,
  executeEvidenceMutation,
  type MutationExecutionResult,
} from './mutate-evidence-fixture.js';

const repositoryRoot = resolve(import.meta.dirname, '../../../..');
let rootDirectory: string;
let fixture: ValidEvidenceFixture;
const results = new Map<string, MutationExecutionResult>();

beforeAll(async () => {
  rootDirectory = await mkdtemp(join(tmpdir(), 'hdi-ar06-adversarial-'));
  fixture = await buildValidEvidenceFixture({ rootDirectory });
}, 30_000);

afterAll(async () => {
  const ordered = ADVERSARIAL_MUTATION_CASES.map((mutation) =>
    results.get(mutation.mutationId) ?? {
      mutationId: mutation.mutationId,
      detectionLayer: mutation.detectionLayer,
      expectedErrorCode: mutation.expectedErrorCode,
      actualErrorCode: null,
      detected: false,
    },
  );
  const summary = {
    schemaVersion: 'phase-01.verification-adversarial-summary.v1',
    fixtureFormalAcceptanceEligible: false,
    mutationCount: ordered.length,
    detectedCount: ordered.filter((result) => result.detected).length,
    survivedCount: ordered.filter((result) => !result.detected).length,
    mutations: ordered,
  };
  const outputDirectory = join(repositoryRoot, '.runtime', 'test-results');
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, 'verification-adversarial-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    { flag: 'w' },
  );
  if (rootDirectory !== undefined) {
    expect(basename(rootDirectory)).toMatch(/^hdi-ar06-adversarial-/u);
    await rm(rootDirectory, { recursive: true, force: true });
  }
  expect(summary.mutationCount).toBeGreaterThanOrEqual(110);
  expect(summary.detectedCount).toBe(summary.mutationCount);
  expect(summary.survivedCount).toBe(0);
}, 30_000);

describe('AR-06 adversarial verification', () => {
  it('retains the 80 lifecycle mutations and declares all 30 AR-10 provenance mutations', () => {
    expect(ADVERSARIAL_MUTATION_CASES).toHaveLength(110);
    expect(new Set(ADVERSARIAL_MUTATION_CASES.map((mutation) => mutation.mutationId)).size).toBe(110);
    expect(Object.fromEntries(ADVERSARIAL_MUTATION_CASES.map((mutation) => [
      mutation.mutationId,
      mutation.expectedErrorCode,
    ]))).toMatchObject({
      PRODUCER_SOURCE_MANIFEST_MISSING: 'PRODUCER_SOURCE_MANIFEST_MISSING',
      PRODUCER_SOURCE_MANIFEST_DIGEST_TAMPERED: 'PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH',
      PRODUCER_SOURCE_MANIFEST_SHA_FILE_TAMPERED: 'PRODUCER_SOURCE_MANIFEST_SHA256_MISMATCH',
      PRODUCER_SOURCE_MANIFEST_DUPLICATE_PATH: 'PRODUCER_SOURCE_MANIFEST_ENTRY_DUPLICATE',
      PRODUCER_SOURCE_MANIFEST_UNSORTED: 'PRODUCER_SOURCE_MANIFEST_ORDER_INVALID',
      PRODUCER_SOURCE_MANIFEST_PATH_TRAVERSAL: 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE',
      PRODUCER_SOURCE_MANIFEST_ABSOLUTE_PATH: 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE',
      PRODUCER_SOURCE_MANIFEST_SYMLINK: 'PRODUCER_SOURCE_MANIFEST_PATH_UNSAFE',
      PRODUCER_COMMIT_UNAVAILABLE: 'PRODUCER_COMMIT_UNAVAILABLE',
      PRODUCER_SOURCE_BLOB_MISMATCH: 'PRODUCER_SOURCE_BLOB_ID_MISMATCH',
      PRODUCER_SOURCE_SHA_MISMATCH: 'PRODUCER_SOURCE_SHA256_MISMATCH',
      PRODUCER_SOURCE_FILE_MISSING_AT_COMMIT: 'PRODUCER_SOURCE_PATH_MISSING_AT_COMMIT',
      RUN_PLAN_SOURCE_MANIFEST_DIGEST_MISMATCH: 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
      TERMINAL_SOURCE_MANIFEST_DIGEST_MISMATCH: 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
      SUMMARY_SOURCE_MANIFEST_DIGEST_MISMATCH: 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
      FINAL_OUTCOME_SOURCE_MANIFEST_DIGEST_MISMATCH: 'PRODUCER_SOURCE_MANIFEST_CROSS_FILE_MISMATCH',
      MIXED_PRODUCER_EVIDENCE_SCHEMA_VERSIONS: 'REVIEWER_CONTRACT_VERSION_MIXED',
      MIXED_GATE_RESULT_SCHEMA_VERSIONS: 'REVIEWER_CONTRACT_VERSION_MIXED',
      UNKNOWN_RUN_SUMMARY_SCHEMA_VERSION: 'REVIEWER_CONTRACT_VERSION_UNKNOWN',
      UNKNOWN_TERMINAL_CONCLUSION_SCHEMA_VERSION: 'REVIEWER_CONTRACT_VERSION_UNKNOWN',
      REVIEWER_CONTRACT_INCOMPATIBLE: 'REVIEWER_CONTRACT_INCOMPATIBLE',
      REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED: 'REVIEWER_CONTRACT_COMPATIBLE_BUT_DRIFTED',
      REVIEWER_WORKTREE_DIRTY: 'REVIEWER_WORKTREE_DIRTY',
      COVERAGE_MATRIX_DEFINITION_DRIFT: 'COVERAGE_MATRIX_DEFINITION_DRIFT',
      PRODUCER_PROTOCOL_DEFINITION_DRIFT: 'PRODUCER_PROTOCOL_DEFINITION_DRIFT',
      GATE_PROOF_DEFINITION_DRIFT: 'GATE_PROOF_DEFINITION_DRIFT',
      TERMINAL_CONTRACT_DEFINITION_DRIFT: 'TERMINAL_CONTRACT_DEFINITION_DRIFT',
      REVIEWER_SOURCE_MANIFEST_TAMPERED: 'REVIEWER_SOURCE_MANIFEST_SHA256_MISMATCH',
      REVIEW_OUTPUT_DIRECTORY_EXISTS: 'REVIEW_OUTPUT_ALREADY_EXISTS',
      EVIDENCE_EMBEDDED_SCRIPT_NOT_EXECUTED: 'MANIFEST_UNLISTED_FILE',
    });
  });

  it('accepts the valid fixture before applying any mutation', async () => {
    const review = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
      dependencies: fixture.reviewerDependencies,
    });
    expect(review.status).toBe('PASSED');
    expect(review.failedCheckCount).toBe(0);
  }, 30_000);

  it.each(ADVERSARIAL_MUTATION_CASES)(
    '$mutationId fails closed at $detectionLayer with $expectedErrorCode',
    async (mutation) => {
      const result = await executeEvidenceMutation(mutation, {
        fixture,
        mutationRootDirectory: join(rootDirectory, 'mutations'),
      });
      results.set(mutation.mutationId, result);
      expect(result.actualErrorCode).toBe(mutation.expectedErrorCode);
      expect(result.detected).toBe(true);
    },
    30_000,
  );
});
