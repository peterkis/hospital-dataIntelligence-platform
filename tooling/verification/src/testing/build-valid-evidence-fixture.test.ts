import { createHash } from 'node:crypto';
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
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
} from '../verification-contract-versions.js';
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
      dependencies: first.reviewerDependencies,
    });
    const reviewFindings = await readFile(
      join(first.reviewOutputDirectory, 'review-findings.json'),
      'utf8',
    );
    expect(review.status, reviewFindings).toBe('PASSED');
    expect(review.reviewStatus).toBe('PASSED');
    expect(review.evidenceIntegrityStatus).toBe('PASSED');
    expect(review.producerProvenanceStatus).toBe('VERIFIED');
    expect(review.reviewerContractStatus).toBe('EXACT');
    expect(review.definitionDriftStatus).toBe('NONE');
    expect(review.reviewerWorktreeStatus).toBe('CLEAN');
    expect(review.failedCheckCount).toBe(0);

    const metadata = JSON.parse(await readFile(
      join(first.evidenceDirectory, 'validator-test-fixture.json'),
      'utf8',
    )) as { readonly formalAcceptanceEligible: boolean; readonly servicesStarted: boolean };
    expect(metadata.formalAcceptanceEligible).toBe(false);
    expect(metadata.servicesStarted).toBe(false);
  }, 30_000);

  it('binds the synthetic package to one producer source manifest and contract tuple', async () => {
    const root = await createRoot();
    const fixture = await buildValidEvidenceFixture({ rootDirectory: root });
    const readJson = async (relativePath: string): Promise<Record<string, unknown>> =>
      JSON.parse(await readFile(join(fixture.evidenceDirectory, relativePath), 'utf8')) as Record<string, unknown>;

    const sourceManifestPath = 'provenance/producer-source-manifest.json';
    const sourceManifestBytes = await readFile(join(fixture.evidenceDirectory, sourceManifestPath));
    const sourceManifest = JSON.parse(sourceManifestBytes.toString('utf8')) as Record<string, unknown>;
    const sourceManifestSha256 = createHash('sha256').update(sourceManifestBytes).digest('hex');
    const digestFile = await readFile(
      join(fixture.evidenceDirectory, 'provenance/producer-source-manifest.sha256'),
      'utf8',
    );

    expect(sourceManifest).toMatchObject({
      schemaVersion: VERIFICATION_SOURCE_MANIFEST_SCHEMA_VERSION,
      manifestRole: 'PRODUCER',
      producerWorktreeState: 'CLEAN',
    });
    expect(sourceManifest['producerGitCommitSha']).toMatch(/^[0-9a-f]{40}$/u);
    expect(sourceManifest['contractIdentity']).toEqual(CURRENT_EVIDENCE_CONTRACT_IDENTITY);
    expect(sourceManifest['sourceFiles']).toBeInstanceOf(Array);
    expect(sourceManifest['sourceFileCount']).toBe(
      (sourceManifest['sourceFiles'] as readonly unknown[]).length,
    );
    expect(digestFile).toBe(`${sourceManifestSha256}  producer-source-manifest.json\n`);

    const runPlan = await readJson('run-plan.json');
    const terminalConclusion = await readJson('runtime/terminal-conclusion.json');
    const summary = await readJson('abg-results.json');
    const finalOutcome = await readJson('runtime/final-outcome.json');
    for (const artifact of [runPlan, terminalConclusion, summary, finalOutcome]) {
      expect(artifact['producerSourceManifestSha256']).toBe(sourceManifestSha256);
    }
    expect(runPlan).toMatchObject({
      producerSourceManifestPath: sourceManifestPath,
      producerGitCommitSha: sourceManifest['producerGitCommitSha'],
      contractIdentity: sourceManifest['contractIdentity'],
    });
    expect((runPlan['frozenInputs'] as Record<string, unknown>)['gitCommitSha'])
      .toBe(sourceManifest['producerGitCommitSha']);
    expect(terminalConclusion['producerSourceManifestStableAfterCleanup']).toBe(true);

    const evidenceManifest = await readJson('manifest.json');
    const listedPaths = (evidenceManifest['files'] as readonly { readonly path: string }[])
      .map((file) => file.path);
    expect(listedPaths).toContain(sourceManifestPath);
    expect(listedPaths).toContain('provenance/producer-source-manifest.sha256');
  }, 30_000);
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'hdi-ar06-fixture-'));
  roots.push(root);
  return root;
}
