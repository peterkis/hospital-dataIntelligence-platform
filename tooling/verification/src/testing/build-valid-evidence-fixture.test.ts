import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ABG_GATES } from '../abg-catalog.js';
import { ABG_PRODUCER_IDS } from '../abg-coverage-matrix.js';
import { validateProducerEvidence } from '../evidence/validate-producer-evidence.js';
import type { ProducerEvidence } from '../evidence/protocol.js';
import { validateFormalAbgSummary } from '../formal-summary-validator.js';
import { reviewFormalAbgEvidence } from '../review-formal-abg-evidence.js';
import {
  buildValidEvidenceFixture,
  fixtureTreeDigest,
} from './build-valid-evidence-fixture.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    expect(basename(root)).toMatch(/^hdi-ar06-fixture-/u);
    await rm(root, { recursive: true, force: true });
  }
});

describe('deterministic valid evidence fixture', () => {
  it('generates byte-identical, gate-specific evidence that all validation layers accept', async () => {
    const firstRoot = await createRoot();
    const secondRoot = await createRoot();
    const first = await buildValidEvidenceFixture({ rootDirectory: firstRoot });
    const second = await buildValidEvidenceFixture({ rootDirectory: secondRoot });

    expect(await fixtureTreeDigest(first.evidenceDirectory)).toBe(
      await fixtureTreeDigest(second.evidenceDirectory),
    );
    expect(first.summary.results).toHaveLength(40);
    expect(new Set(first.summary.results.map((result) => result.gateId))).toEqual(
      new Set(ABG_GATES.map((gate) => gate.gateId)),
    );
    expect(new Set(first.summary.results.map((result) =>
      result.proof.assertionIds.join('|'),
    )).size).toBe(40);

    for (const producerId of ABG_PRODUCER_IDS) {
      const relativePath = producerId === 'formal-run'
        ? 'formal-run/producer-evidence.json'
        : `shared/${producerId}/producer-evidence.json`;
      const evidence = JSON.parse(await readFile(
        join(first.evidenceDirectory, relativePath),
        'utf8',
      )) as ProducerEvidence;
      expect(() => validateProducerEvidence(evidence)).not.toThrow();
    }
    expect(() => validateFormalAbgSummary(
      first.summary,
      first.summaryValidationExpectations,
    )).not.toThrow();

    const review = await reviewFormalAbgEvidence({
      evidenceDirectory: first.evidenceDirectory,
      reviewOutputDirectory: first.reviewOutputDirectory,
    });
    expect(review.status).toBe('PASSED');
    expect(review.failedCheckCount).toBe(0);

    const metadata = JSON.parse(await readFile(
      join(first.evidenceDirectory, 'validator-test-fixture.json'),
      'utf8',
    )) as { readonly formalAcceptanceEligible: boolean };
    expect(metadata.formalAcceptanceEligible).toBe(false);
  }, 30_000);
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hdi-ar06-fixture-'));
  roots.push(root);
  return root;
}
