import { describe, expect, it } from 'vitest';
import { ABG_FROZEN_INPUT_KINDS } from '../abg-coverage-matrix.js';
import {
  buildLiveProducerEvidence,
  buildMatrixProducerEvidence,
  buildObservedProducerEvidence,
  parseFrozenInputRefs,
} from './adapters.js';
import type { ProducerEvidenceItem } from './protocol.js';
import { validateProducerEvidence } from './validate-producer-evidence.js';

const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('producer evidence adapters', () => {
  it('requires assertion-scoped observations instead of converting a shared command success into all gate passes', () => {
    const evidence = buildMatrixProducerEvidence({
      producerId: 'static',
      runId: 'shared-run-0001',
      runSequence: 1,
      startedAt: '2026-08-27T10:00:00',
      completedAt: '2026-08-27T10:00:01',
      processStatus: 'PASSED',
      commandIdentity: commandIdentity(),
      environmentRefs: { CI: SHA256 },
      frozenInputRefs: frozenInputs('static'),
      defaultEvidenceItems: [item()],
      defaultReferences: staticReferences(),
      outcomes: {
        'ABG-01:repository-runtime-lockfile-topology': {
          status: 'PASSED',
          description: 'Runtime and topology commands passed.',
          expected: { status: 'PASSED' },
          actual: { status: 'PASSED' },
        },
      },
    });
    const statuses = Object.values(evidence.scenarios).flatMap((scenario) =>
      Object.values(scenario.assertions).map((assertion) => ({
        assertionId: assertion.assertionId,
        status: assertion.status,
      })),
    );
    expect(evidence.status).toBe('BLOCKED');
    expect(statuses).toContainEqual({
      assertionId: 'ABG-01:repository-runtime-lockfile-topology',
      status: 'PASSED',
    });
    expect(statuses.some((status) =>
      status.assertionId !== 'ABG-01:repository-runtime-lockfile-topology' &&
      status.status === 'BLOCKED',
    )).toBe(true);
    expect(() => validateProducerEvidence(evidence)).not.toThrow();
  });

  it('maps live observations to stable assertion identifiers and blocks missing allow-deny observations', () => {
    const evidence = buildLiveProducerEvidence({
      producerId: 'live',
      runId: 'live-run-0001',
      runSequence: 1,
      startedAt: '2026-08-27T10:00:00',
      completedAt: '2026-08-27T10:00:01',
      processStatus: 'PASSED',
      commandIdentity: commandIdentity(),
      environmentRefs: { GOVERNANCE_API_BASE_URL: SHA256 },
      frozenInputRefs: frozenInputs('live'),
      defaultEvidenceItems: [item()],
      verification: {
        status: 'PASSED',
        runId: 'live-run-0001',
        runtime: { timezone: 'Asia/Shanghai' },
        authentication: {
          authorizationCodeCallbackCompleted: true,
          principalKind: 'PERSON',
          principalId: 'principal-owner',
          serviceIdentityBindingsVerified: true,
        },
        subscriptionA: { subscriptionId: 'subscription-a' },
        subscriptionB: { subscriptionId: 'subscription-b' },
        replay: { replayId: 'replay-0001' },
        charge: { chargeItemVersionId: 'charge-version-0001' },
        price: { priceListReleaseId: 'price-version-0001' },
        resolution: { priceResolutionId: 'resolution-0001' },
        priceResolutionPathVerified: true,
        governanceObjectIds: ['governance-charge', 'governance-price'],
        openapiSha256: SHA256,
        consumption: {
          dualConsumerIsolationVerified: true,
          snapshotDownloadAndDigestVerified: true,
          receiptAndCheckpointVerified: true,
        },
        databaseVerification: {
          timezoneAwareColumnCount: 0,
          consumerBCompatibilityIssueStatus: 'RESOLVED',
        },
      },
    });
    const assertions = Object.values(evidence.scenarios).flatMap((scenario) =>
      Object.values(scenario.assertions),
    );
    expect(assertions.find((item) => item.gateId === 'ABG-04')?.status).toBe('PASSED');
    expect(assertions.find((item) => item.gateId === 'ABG-12')?.status).toBe('PASSED');
    expect(assertions.find((item) => item.gateId === 'ABG-24')?.status).toBe('PASSED');
    expect(assertions.find((item) => item.gateId === 'ABG-35')?.status).toBe('PASSED');
    expect(assertions.find((item) => item.gateId === 'ABG-36')?.status).toBe('PASSED');
    expect(assertions.find((item) => item.gateId === 'ABG-05')?.status).toBe('BLOCKED');
    expect(assertions.find((item) => item.gateId === 'ABG-06')?.status).toBe('BLOCKED');
    expect(() => validateProducerEvidence(evidence)).not.toThrow();
  });

  it('keeps only controlled frozen input kinds when parsing a formal-run snapshot', () => {
    expect(parseFrozenInputRefs({
      gitCommitSha: SHA256,
      nodeVersion: 'v24.18.0',
      unrecognized: 'value',
      KEYCLOAK_CLIENT_SECRET: 'never-recorded',
    })).toEqual({
      gitCommitSha: SHA256,
      nodeVersion: 'v24.18.0',
    });
    expect(ABG_FROZEN_INPUT_KINDS).toContain('gitCommitSha');
  });

  it('rejects an observation whose producer, scenario, and assertion do not match a matrix selector', () => {
    expect(() => buildObservedProducerEvidence({
      producerId: 'static',
      runId: 'shared-run-0002',
      runSequence: 1,
      startedAt: '2026-08-27T10:00:00',
      completedAt: '2026-08-27T10:00:01',
      processStatus: 'PASSED',
      commandIdentity: commandIdentity(),
      environmentRefs: { CI: SHA256 },
      frozenInputRefs: frozenInputs('static'),
      defaultEvidenceItems: [item()],
      defaultReferences: staticReferences(),
      observations: [{
        producerId: 'static',
        scenarioId: 'STATIC-REPOSITORY-RUNTIME-LOCKFILE-TOPOLOGY',
        assertionId: 'ABG-01:repository-runtime-lockfile-topology',
        gateId: 'ABG-02',
        description: 'Intentionally mismatched observation.',
        requestIds: ['command-run-0002'],
        principalIds: [],
        governanceObjectIds: [],
        versionIds: [],
        ruleVersions: ['phase-01.verification-toolchain.v2'],
      }],
    })).toThrow('PRODUCER_EVIDENCE_OBSERVATION_MATRIX_MISMATCH');
  });
});

function commandIdentity() {
  return {
    executable: 'node',
    arguments: ['tooling/verification/src/run-shared-abg-verification.ts'],
    workingDirectory: 'repository-root',
    commandDigest: SHA256,
  };
}

function item(): ProducerEvidenceItem {
  return {
    artifactId: 'producer-command-summary',
    relativePath: 'raw/producer-command-summary.json',
    mediaType: 'application/json',
    byteLength: 64,
    sha256: SHA256,
    jsonPointer: '/commands/verification/status',
    claimDigest: SHA256,
  };
}

function staticReferences() {
  return {
    requestIds: ['command-run-0001'],
    ruleVersions: ['phase-01.verification-toolchain.v2'],
    artifactDigests: [SHA256],
  };
}

function frozenInputs(producerId: 'static' | 'live') {
  return producerId === 'static'
    ? {
      gitCommitSha: SHA256,
      lockfileSha256: SHA256,
      runtimeAuthoritySha256: SHA256,
      runtimeAuthoritySemanticDigest: SHA256,
      nodeVersion: 'v24.18.0',
    }
    : {
      gitCommitSha: SHA256,
      lockfileSha256: SHA256,
      openapiSha256: SHA256,
      migrationManifestSha256: SHA256,
      fixtureIdentity: SHA256,
      runtimeAuthoritySha256: SHA256,
      runtimeAuthoritySemanticDigest: SHA256,
      nodeVersion: 'v24.18.0',
      postgresImage: 'postgres@sha256:' + SHA256,
      keycloakImage: 'keycloak@sha256:' + SHA256,
    };
}
