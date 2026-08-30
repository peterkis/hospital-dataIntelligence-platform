import { describe, expect, it } from 'vitest';
import { ABG_GATES } from './abg-catalog.js';
import { ABG_COVERAGE_MATRIX } from './abg-coverage-matrix.js';
import {
  getAbgCoverageMatrixDigest,
  getAbgProducerProtocolIdentityDigest,
} from './abg-gate-proof.js';
import { canonicalJson, sha256 } from './evidence/recorder.js';
import { formalRuntimeAuthority } from './runtime/formal-runtime-contract.js';
import {
  validateFormalAbgSummary,
  type FormalAbgSummaryValidationExpectations,
} from './formal-summary-validator.js';

const RUN_ID = 'validator-test-run-0001';
const RUN_SEQUENCE = 17;
const DIGEST = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SOURCE_MANIFEST_DIGEST = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

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

  it.each([
    ['cleanupStatus', 'CLEANUP_STATUS_NOT_PASSED'],
    ['terminalConclusionStatus', 'TERMINAL_CONCLUSION_STATUS_NOT_PASSED'],
    ['sealEligibilityStatus', 'SEAL_ELIGIBILITY_STATUS_NOT_PASSED'],
  ] as const)('rejects PASSED when %s is FAILED', (field, code) => {
    const summary = validSummary();
    summary[field] = 'FAILED';

    expect(() => validateFormalAbgSummary(summary, expectations())).toThrowError(
      new RegExp(`^${code}$`, 'u'),
    );
  });

  it.each([
    ['residualContainerCount', 'RESIDUAL_CONTAINER_PRESENT'],
    ['residualVolumeCount', 'RESIDUAL_VOLUME_PRESENT'],
    ['residualNetworkCount', 'RESIDUAL_NETWORK_PRESENT'],
  ] as const)('rejects PASSED when %s is nonzero', (field, code) => {
    const summary = validSummary();
    summary[field] = 1;

    expect(() => validateFormalAbgSummary(summary, expectations())).toThrowError(
      new RegExp(`^${code}$`, 'u'),
    );
  });

  it('rejects a summary whose producer source manifest digest differs from the frozen plan', () => {
    const summary = validSummary();
    summary.producerSourceManifestSha256 = 'f'.repeat(64);

    expect(() => validateFormalAbgSummary(summary, expectations())).toThrowError(
      /^PRODUCER_SOURCE_MANIFEST_DIGEST_MISMATCH$/u,
    );
  });

  it('rejects PASSED when the producer source manifest was not stable after cleanup', () => {
    const summary = validSummary();
    summary.producerSourceManifestStableAfterCleanup = false;

    expect(() => validateFormalAbgSummary(summary, expectations())).toThrowError(
      /^PRODUCER_SOURCE_MANIFEST_NOT_STABLE$/u,
    );
  });

  it('rejects a frozen-input source manifest digest that disagrees with the top-level provenance', () => {
    const summary = validSummary();
    const inconsistentFrozenInputs = {
      ...summary.frozenInputs,
      producerSourceManifestSha256: 'e'.repeat(64),
    };
    summary.frozenInputs = inconsistentFrozenInputs;
    summary.frozenInputsDigest = sha256(Buffer.from(canonicalJson(inconsistentFrozenInputs), 'utf8'));
    const expected = {
      ...expectations(),
      frozenInputs: inconsistentFrozenInputs,
      frozenInputsDigest: summary.frozenInputsDigest,
    };

    expect(() => validateFormalAbgSummary(summary, expected)).toThrowError(
      /^FROZEN_INPUTS_SOURCE_MANIFEST_DIGEST_MISMATCH$/u,
    );
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
    runtimeAuthoritySha256: DIGEST,
    runtimeAuthoritySemanticDigest: DIGEST,
    nodeVersion: 'v24.18.0',
    podmanVersion: '4.9.4-rhel',
    podmanSocketPath: '/run/podman/podman.sock',
    podmanStorageDriver: 'overlay',
    podmanGraphRoot: '/var/lib/containers/storage',
    podmanOciRuntime: 'runc',
    podmanNetworkBackend: 'cni',
    podmanLogDriver: 'k8s-file',
    podmanRestartPolicy: 'no',
    postgresImage: 'postgres:18.4',
    keycloakImage: 'quay.io/keycloak/keycloak:26.7.0',
    browserVersion: '1.61.0',
    producerSourceManifestSha256: SOURCE_MANIFEST_DIGEST,
  };
  return {
    runtimeAuthority: formalRuntimeAuthority().authority,
    runSequence: RUN_SEQUENCE,
    planDigest: DIGEST,
    frozenInputs,
    frozenInputsDigest: sha256(Buffer.from(canonicalJson(frozenInputs), 'utf8')),
    coverageMatrixDigest: getAbgCoverageMatrixDigest(),
    producerProtocolIdentityDigest: getAbgProducerProtocolIdentityDigest(),
    producerSourceManifestSha256: SOURCE_MANIFEST_DIGEST,
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
    schemaVersion: 'phase-01.abg-run.v5',
    runId: RUN_ID,
    runSequence: RUN_SEQUENCE,
    planDigest: expected.planDigest,
    frozenInputs: expected.frozenInputs,
    frozenInputsDigest: expected.frozenInputsDigest,
    runtimeAuthoritySha256: DIGEST,
    runtimeAuthoritySemanticDigest: DIGEST,
    coverageMatrixDigest: expected.coverageMatrixDigest,
    producerProtocolIdentityDigest: expected.producerProtocolIdentityDigest,
    preflightStatus: 'PASSED',
    setupStatus: 'PASSED',
    nonFormalGateStatus: 'PASSED',
    producerEvidenceStatus: 'PASSED',
    producerEvidencePersistedBeforeCleanup: true,
    producerProtocolEvidenceCount: 7,
    cleanupStatus: 'PASSED',
    residualResourceCount: 0,
    residualContainerCount: 0,
    residualVolumeCount: 0,
    residualNetworkCount: 0,
    occupiedRequiredPorts: [],
    requiredPortsObserved: [55432, 55433, 18080, 19000, 3000, 4101, 4102],
    pruneCommandsInvoked: false,
    frozenInputsStableAfterCleanup: true,
    authorityIdentityStableAfterCleanup: true,
    runtimeAuthorityStableAfterCleanup: true,
    producerSourceManifestSha256: SOURCE_MANIFEST_DIGEST,
    producerSourceManifestStableAfterCleanup: true,
    outputDirectoryExclusive: true,
    terminalConclusionStatus: 'PASSED',
    sealEligibilityStatus: 'PASSED',
    lifecycleStatus: 'PASSED',
    selectorSetsDistinct: true,
    failureCodes: [],
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
