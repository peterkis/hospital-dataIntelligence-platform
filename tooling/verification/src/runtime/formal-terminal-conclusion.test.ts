import { describe, expect, it } from 'vitest';
import { FORMAL_RUNTIME_PORTS, type FormalRunIdentity } from './formal-runtime-contract.js';
import { buildFormalTerminalConclusion } from './formal-terminal-conclusion.js';
import type {
  FormalCleanupReport,
  RuntimeResourceRecord,
  RuntimeResourceSnapshot,
} from './formal-teardown.js';

const IDENTITY: FormalRunIdentity = {
  runId: 'terminal-test-run',
  runSequence: 17,
  runtimeNamespace: 'hdi_phase01_abg_17_terminaltest',
  gitCommitSha: 'a'.repeat(40),
};

describe('formal terminal conclusion', () => {
  it('derives a seal-eligible PASSED conclusion only from a complete cleanup terminal state', () => {
    const conclusion = buildFormalTerminalConclusion(validInput());

    expect(conclusion).toMatchObject({
      schemaVersion: 'phase-01.formal-terminal-conclusion.v1',
      status: 'PASSED',
      preflightStatus: 'PASSED',
      setupStatus: 'PASSED',
      nonFormalGateCount: 39,
      nonFormalPassedCount: 39,
      nonFormalFailedCount: 0,
      producerEvidencePersistedBeforeCleanup: true,
      cleanupStatus: 'PASSED',
      residualResourceCount: 0,
      residualContainerCount: 0,
      residualVolumeCount: 0,
      residualNetworkCount: 0,
      occupiedRequiredPorts: [],
      requiredPortsObserved: FORMAL_RUNTIME_PORTS,
      pruneCommandsInvoked: false,
      frozenInputsStableAfterCleanup: true,
      authorityIdentityStableAfterCleanup: true,
      outputDirectoryExclusive: true,
      failureCodes: [],
      sealEligible: true,
      assertions: {
        terminalLifecycle: { status: 'PASSED', failureCodes: [] },
        sealEligibility: { status: 'PASSED', failureCodes: [] },
      },
    });
  });

  it('fails cleanup and residual container terminal states closed', () => {
    const input = validInput();
    const residual = resource('container', 'residual-container');
    const conclusion = buildFormalTerminalConclusion({
      ...input,
      cleanup: {
        ...input.cleanup,
        status: 'FAILED',
        residualResources: [residual],
      },
      finalResources: {
        ...input.finalResources,
        resources: [residual],
      },
    });

    expect(conclusion.status).toBe('FAILED');
    expect(conclusion.sealEligible).toBe(false);
    expect(conclusion.residualContainerCount).toBe(1);
    expect(conclusion.assertions.terminalLifecycle.status).toBe('FAILED');
    expect(conclusion.failureCodes).toEqual(expect.arrayContaining([
      'FORMAL_TERMINAL_CLEANUP_NOT_PASSED',
      'FORMAL_TERMINAL_RESIDUAL_RESOURCES_PRESENT',
    ]));
  });

  it('fails when only 38 of the first 39 gates passed or a required port observation is missing', () => {
    const input = validInput();
    const conclusion = buildFormalTerminalConclusion({
      ...input,
      nonFormalGateResults: input.nonFormalGateResults.slice(0, 38),
      finalResources: {
        ...input.finalResources,
        ports: input.finalResources.ports.slice(0, -1),
      },
    });

    expect(conclusion.status).toBe('FAILED');
    expect(conclusion.sealEligible).toBe(false);
    expect(conclusion.failureCodes).toEqual(expect.arrayContaining([
      'FORMAL_TERMINAL_NON_FORMAL_GATES_INCOMPLETE',
      'FORMAL_TERMINAL_REQUIRED_PORT_OBSERVATION_MISSING',
    ]));
  });

  it.each([
    ['frozenInputsStableAfterCleanup', 'FORMAL_TERMINAL_FROZEN_INPUTS_DRIFT'],
    ['authorityIdentityStableAfterCleanup', 'FORMAL_TERMINAL_AUTHORITY_IDENTITY_DRIFT'],
    ['outputDirectoryExclusive', 'FORMAL_TERMINAL_OUTPUT_DIRECTORY_NOT_EXCLUSIVE'],
  ] as const)('fails seal eligibility when %s is false', (field, expectedCode) => {
    const conclusion = buildFormalTerminalConclusion({ ...validInput(), [field]: false });

    expect(conclusion.status).toBe('FAILED');
    expect(conclusion.sealEligible).toBe(false);
    expect(conclusion.assertions.sealEligibility.status).toBe('FAILED');
    expect(conclusion.failureCodes).toContain(expectedCode);
  });
});

function validInput() {
  const finalResources: RuntimeResourceSnapshot = {
    schemaVersion: 'phase-01.formal-runtime-resources.v1',
    runIdentity: IDENTITY,
    capturedAt: '2026-08-30T10:01:00',
    resources: [],
    ports: FORMAL_RUNTIME_PORTS.map((port) => ({ port, occupied: false, verificationError: null })),
  };
  const cleanup: FormalCleanupReport = {
    schemaVersion: 'phase-01.formal-cleanup.v1',
    runIdentity: IDENTITY,
    startedAt: '2026-08-30T10:00:30',
    completedAt: '2026-08-30T10:01:00',
    status: 'PASSED',
    actions: [],
    failedItems: [],
    residualResources: [],
    occupiedPorts: [],
    pruneCommandsInvoked: false,
  };
  return {
    runIdentity: IDENTITY,
    startedAt: '2026-08-30T10:00:00',
    completedAt: '2026-08-30T10:01:01',
    preflightStatus: 'PASSED' as const,
    setupStatus: 'PASSED' as const,
    nonFormalGateResults: Array.from({ length: 39 }, (_, index) => ({
      gateId: `ABG-${String(index + 1).padStart(2, '0')}`,
      status: 'PASSED' as const,
    })),
    producerEvidencePersistedBeforeCleanup: true,
    producerProtocolEvidenceCount: 7,
    cleanup,
    finalResources,
    frozenInputsStableAfterCleanup: true,
    authorityIdentityStableAfterCleanup: true,
    outputDirectoryExclusive: true,
    failureCodes: [] as readonly string[],
  };
}

function resource(
  resourceType: RuntimeResourceRecord['resourceType'],
  id: string,
): RuntimeResourceRecord {
  return {
    resourceType,
    id,
    name: id,
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
