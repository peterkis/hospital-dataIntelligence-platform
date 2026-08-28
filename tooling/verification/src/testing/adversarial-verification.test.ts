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
  expect(summary.mutationCount).toBeGreaterThanOrEqual(55);
  expect(summary.detectedCount).toBe(summary.mutationCount);
  expect(summary.survivedCount).toBe(0);
}, 30_000);

describe('AR-06 adversarial verification', () => {
  it('accepts the valid fixture before applying any mutation', async () => {
    const review = await reviewFormalAbgEvidence({
      evidenceDirectory: fixture.evidenceDirectory,
      reviewOutputDirectory: fixture.reviewOutputDirectory,
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
