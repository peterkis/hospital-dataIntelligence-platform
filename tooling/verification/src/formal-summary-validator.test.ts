import { describe, expect, it } from 'vitest';
import { ABG_GATES } from './abg-catalog.js';
import { ABG_COVERAGE_MATRIX } from './abg-coverage-matrix.js';
import {
  getAbgCoverageMatrixDigest,
  getAbgProducerProtocolIdentityDigest,
} from './abg-gate-proof.js';
import { canonicalJson, sha256 } from './evidence/recorder.js';
import {
  validateFormalAbgSummary,
  type FormalAbgSummaryValidationExpectations,
} from './formal-summary-validator.js';

const RUN_ID = 'validator-test-run-0001';
const RUN_SEQUENCE = 17;
const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('formal ABG summary validator', () => {
  it('accepts a complete gate-specific 40-gate summary', () => {
    expect(() => validateFormalAbgSummary(validSummary(), expectations())).not.toThrow();
  });

  it('fails closed with a stable code when ABG-01 is missing', () => {
    const summary = validSummary();
    summary.results.shift();

    expect(() => validateFormalAbgSummary(summary, expectations())).toThrowError(
      /^GATE_RESULT_COUNT_INVALID$/u,
    );
  });

  it('allows reference kinds that the gate matrix does not require to remain empty', () => {
    const summary = validSummary();
    const proof = summary.results[0]!.proof;
    proof.principalIds = [];
    proof.governanceObjectIds = [];
    proof.versionIds = [];

    expect(() => validateFormalAbgSummary(summary, expectations())).not.toThrow();
  });
});

function expectations(): FormalAbgSummaryValidationExpectations {
  const frozenInputs = {
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
  };
  return {
    runSequence: RUN_SEQUENCE,
    planDigest: DIGEST,
    frozenInputs,
    frozenInputsDigest: sha256(Buffer.from(canonicalJson(frozenInputs), 'utf8')),
    coverageMatrixDigest: getAbgCoverageMatrixDigest(),
    producerProtocolIdentityDigest: getAbgProducerProtocolIdentityDigest(),
    setupCommandDigests: [DIGEST],
  };
}

function validSummary() {
  const expected = expectations();
  const results = ABG_GATES.map((gate, index) => {
    const entry = ABG_COVERAGE_MATRIX[index]!;
    return {
      ...gate,
      ordinal: index + 1,
      runId: RUN_ID,
      status: 'PASSED',
      producerExitCode: 0,
      producerCommandDigest: DIGEST,
      elapsedMilliseconds: 1,
      proofPath: `gates/${gate.gateId}/producer/result.json`,
      proof: {
        schemaVersion: 'phase-01.abg-gate-result.v3',
        gateId: gate.gateId,
        runId: RUN_ID,
        runSequence: RUN_SEQUENCE,
        status: 'PASSED',
        scenarioIds: [...entry.scenarioIds],
        assertionIds: [...entry.assertionIds],
        requestIds: [`request-${gate.gateId}`],
        principalIds: [`principal-${gate.gateId}`],
        governanceObjectIds: [`object-${gate.gateId}`],
        versionIds: [`version-${gate.gateId}`],
        ruleVersions: [`rule-${gate.gateId}`],
        frozenInputDigests: [DIGEST],
        artifactDigests: [DIGEST],
        frozenInputs: { gitCommitSha: DIGEST },
        evidenceRefs: entry.evidenceSelectors.map((selector, selectorIndex) => ({
          artifactId: `artifact-${gate.gateId}-${selectorIndex + 1}`,
          relativePath: `raw/${gate.gateId}-${selectorIndex + 1}.json`,
          mediaType: 'application/json',
          byteLength: 1,
          sha256: DIGEST,
          producerId: selector.producerId,
          scenarioId: selector.scenarioId,
          assertionId: selector.assertionId,
          jsonPointer: '/status',
          selectedClaimDigest: DIGEST,
        })),
        coverageMatrixDigest: expected.coverageMatrixDigest,
        producerEvidenceIndexPath: 'shared/producer-evidence-index.json',
        producerEvidenceIndexDigest: DIGEST,
      },
    };
  });
  return {
    schemaVersion: 'phase-01.abg-run.v3',
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    planDigest: expected.planDigest,
    frozenInputs: expected.frozenInputs,
    frozenInputsDigest: expected.frozenInputsDigest,
    coverageMatrixDigest: expected.coverageMatrixDigest,
    producerProtocolIdentityDigest: expected.producerProtocolIdentityDigest,
    frozenInputsStable: true,
    authorityIdentityStable: true,
    selectorSetsDistinct: true,
    status: 'PASSED',
    startedAt: '2026-08-28T10:00:00',
    completedAt: '2026-08-28T10:01:00',
    timezone: 'Asia/Shanghai',
    setupResults: [{
      ordinal: 1,
      commandDigest: DIGEST,
      exitCode: 0,
      elapsedMilliseconds: 1,
    }],
    gateCount: 40,
    passedCount: 40,
    failedCount: 0,
    conclusionScope: 'Phase 01 POC executable architecture baseline only; not full POC or production readiness.',
    results,
  };
}
