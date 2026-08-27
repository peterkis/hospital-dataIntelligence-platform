import { describe, expect, it } from 'vitest';
import {
  ABG_COVERAGE_MATRIX,
  type AbgCoverageMatrixEntry,
  type AbgProducerId,
} from '../abg-coverage-matrix.js';
import {
  PRODUCER_EVIDENCE_SCHEMA_VERSION,
  type ProducerEvidence,
} from './protocol.js';
import { parseJsonPointer } from './schema.js';
import { validateProducerEvidence } from './validate-producer-evidence.js';

const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('producer evidence validation', () => {
  it('accepts a matrix-backed producer record with stable scenario and assertion identifiers', () => {
    const evidence = buildEvidence('ABG-01', 'static');
    expect(() => validateProducerEvidence(evidence)).not.toThrow();
  });

  it('rejects missing schema versions and duplicate scenario or assertion identifiers', () => {
    const withoutSchema = { ...buildEvidence('ABG-01', 'static'), schemaVersion: '' };
    expect(() => validateProducerEvidence(withoutSchema as ProducerEvidence)).toThrow(
      'PRODUCER_EVIDENCE_SCHEMA_VERSION_INVALID',
    );

    const duplicateScenarioBase = buildEvidence('ABG-01', 'static');
    const scenario = Object.values(duplicateScenarioBase.scenarios)[0]!;
    const duplicateScenario: ProducerEvidence = {
      ...duplicateScenarioBase,
      scenarios: {
        ...duplicateScenarioBase.scenarios,
      SECOND_SCENARIO_KEY: { ...scenario },
      },
    };
    expect(() => validateProducerEvidence(duplicateScenario)).toThrow(
      'PRODUCER_EVIDENCE_SCENARIO_DUPLICATE',
    );

    const duplicateAssertionBase = buildEvidence('ABG-07', 'integration');
    const firstScenario = Object.values(duplicateAssertionBase.scenarios)[0]!;
    const secondScenarioId = ABG_COVERAGE_MATRIX.find((entry) => entry.gateId === 'ABG-07')!
      .scenarioIds.find((id) => id !== firstScenario.scenarioId)!;
    const duplicateAssertion: ProducerEvidence = {
      ...duplicateAssertionBase,
      scenarios: {
        ...duplicateAssertionBase.scenarios,
        [secondScenarioId]: {
          ...firstScenario,
          scenarioId: secondScenarioId,
        },
      },
    };
    expect(() => validateProducerEvidence(duplicateAssertion)).toThrow(
      'PRODUCER_EVIDENCE_ASSERTION_DUPLICATE',
    );
  });

  it('rejects matrix gate and producer mismatches', () => {
    const wrongGateBase = buildEvidence('ABG-01', 'static');
    const scenario = Object.values(wrongGateBase.scenarios)[0]!;
    const assertion = Object.values(scenario.assertions)[0]!;
    const wrongGate: ProducerEvidence = {
      ...wrongGateBase,
      scenarios: {
        [scenario.scenarioId]: {
          ...scenario,
          assertions: {
            [assertion.assertionId]: {
              ...assertion,
              gateId: 'ABG-02',
            },
          },
        },
      },
    };
    expect(() => validateProducerEvidence(wrongGate)).toThrow(
      'PRODUCER_EVIDENCE_ASSERTION_GATE_MISMATCH',
    );

    const wrongProducerBase = buildEvidence('ABG-04', 'live');
    const liveScenario = Object.values(wrongProducerBase.scenarios)[0]!;
    const wrongProducer: ProducerEvidence = {
      ...wrongProducerBase,
      producerId: 'static',
      scenarios: {
        [liveScenario.scenarioId]: {
          ...liveScenario,
          producerId: 'static',
        },
      },
    };
    expect(() => validateProducerEvidence(wrongProducer)).toThrow(
      'PRODUCER_EVIDENCE_ASSERTION_PRODUCER_MISMATCH',
    );
  });

  it('rejects malformed pointers, digests, empty references, and placeholder references', () => {
    const pointerBase = buildEvidence('ABG-01', 'static');
    const pointerScenario = Object.values(pointerBase.scenarios)[0]!;
    const pointerAssertion = Object.values(pointerScenario.assertions)[0]!;
    const pointer: ProducerEvidence = {
      ...pointerBase,
      scenarios: {
        [pointerScenario.scenarioId]: {
          ...pointerScenario,
          assertions: {
            [pointerAssertion.assertionId]: {
              ...pointerAssertion,
              evidenceItems: [{ ...pointerAssertion.evidenceItems[0]!, jsonPointer: '/a/~2/b' }],
            },
          },
        },
      },
    };
    expect(() => validateProducerEvidence(pointer)).toThrow(
      'PRODUCER_EVIDENCE_ITEM_POINTER_INVALID',
    );

    const digestBase = buildEvidence('ABG-01', 'static');
    const digestScenario = Object.values(digestBase.scenarios)[0]!;
    const digestAssertion = Object.values(digestScenario.assertions)[0]!;
    const digest: ProducerEvidence = {
      ...digestBase,
      scenarios: {
        [digestScenario.scenarioId]: {
          ...digestScenario,
          assertions: {
            [digestAssertion.assertionId]: {
              ...digestAssertion,
              evidenceItems: [{ ...digestAssertion.evidenceItems[0]!, sha256: 'not-a-digest' }],
            },
          },
        },
      },
    };
    expect(() => validateProducerEvidence(digest)).toThrow(
      'PRODUCER_EVIDENCE_ITEM_SHA256_INVALID',
    );

    const emptyReferenceBase = buildEvidence('ABG-01', 'static');
    const emptyScenario = Object.values(emptyReferenceBase.scenarios)[0]!;
    const emptyReference: ProducerEvidence = {
      ...emptyReferenceBase,
      scenarios: {
        [emptyScenario.scenarioId]: { ...emptyScenario, requestIds: [''] },
      },
    };
    expect(() => validateProducerEvidence(emptyReference)).toThrow(
      'PRODUCER_EVIDENCE_REFERENCE_INVALID',
    );

    const placeholderReferenceBase = buildEvidence('ABG-01', 'static');
    const placeholderScenario = Object.values(placeholderReferenceBase.scenarios)[0]!;
    const placeholderReference: ProducerEvidence = {
      ...placeholderReferenceBase,
      scenarios: {
        [placeholderScenario.scenarioId]: { ...placeholderScenario, ruleVersions: ['TODO'] },
      },
    };
    expect(() => validateProducerEvidence(placeholderReference)).toThrow(
      'PRODUCER_EVIDENCE_REFERENCE_INVALID',
    );

    const sensitiveReferenceBase = buildEvidence('ABG-01', 'static');
    const sensitiveScenario = Object.values(sensitiveReferenceBase.scenarios)[0]!;
    const sensitiveReference: ProducerEvidence = {
      ...sensitiveReferenceBase,
      scenarios: {
        [sensitiveScenario.scenarioId]: {
          ...sensitiveScenario,
          requestIds: ['Bearer unredacted-token'],
        },
      },
    };
    expect(() => validateProducerEvidence(sensitiveReference)).toThrow(
      'PRODUCER_EVIDENCE_REFERENCE_SENSITIVE',
    );

    const sensitiveEnvironment: ProducerEvidence = {
      ...buildEvidence('ABG-01', 'static'),
      environmentRefs: { AUTHORIZATION: SHA256 },
    };
    expect(() => validateProducerEvidence(sensitiveEnvironment)).toThrow(
      'PRODUCER_EVIDENCE_ENVIRONMENT_SENSITIVE',
    );
  });

  it('requires every passed matrix assertion to carry its mandatory references and frozen inputs', () => {
    const missingReferencesBase = buildEvidence('ABG-04', 'live');
    const scenario = Object.values(missingReferencesBase.scenarios)[0]!;
    const missingReferences: ProducerEvidence = {
      ...missingReferencesBase,
      scenarios: {
        [scenario.scenarioId]: { ...scenario, principalIds: [] },
      },
    };
    expect(() => validateProducerEvidence(missingReferences)).toThrow(
      'PRODUCER_EVIDENCE_REFERENCE_REQUIRED',
    );

    const missingFrozenInputBase = buildEvidence('ABG-04', 'live');
    const { keycloakImage: ignoredKeycloakImage, ...remainingFrozenInputs } =
      missingFrozenInputBase.frozenInputRefs;
    const missingFrozenInput: ProducerEvidence = {
      ...missingFrozenInputBase,
      frozenInputRefs: remainingFrozenInputs,
    };
    expect(() => validateProducerEvidence(missingFrozenInput)).toThrow(
      'PRODUCER_EVIDENCE_FROZEN_INPUT_REQUIRED',
    );
  });

  it('keeps blocked records machine-readable while preventing them from becoming a passed assertion', () => {
    const blockedBase = buildEvidence('ABG-04', 'live');
    const scenario = Object.values(blockedBase.scenarios)[0]!;
    const assertion = Object.values(scenario.assertions)[0]!;
    const blocked: ProducerEvidence = {
      ...blockedBase,
      status: 'BLOCKED',
      scenarios: {
        [scenario.scenarioId]: {
          ...scenario,
          status: 'BLOCKED',
          principalIds: [],
          assertions: {
            [assertion.assertionId]: {
              ...assertion,
              status: 'BLOCKED',
              failureCode: 'PRINCIPAL_REFERENCE_NOT_AVAILABLE',
            },
          },
        },
      },
    };
    expect(() => validateProducerEvidence(blocked)).not.toThrow();
  });

  it('strictly parses JSON Pointer escaping', () => {
    expect(parseJsonPointer('/scenarios/one~1two/assertions/a~0b/status')).toEqual([
      'scenarios',
      'one/two',
      'assertions',
      'a~b',
      'status',
    ]);
    expect(() => parseJsonPointer('/scenarios/~2/status')).toThrow(
      'PRODUCER_EVIDENCE_JSON_POINTER_INVALID',
    );
  });
});

function buildEvidence(gateId: string, producerId: AbgProducerId): ProducerEvidence {
  const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === gateId)!;
  const selector = entry.evidenceSelectors.find((candidate) => candidate.producerId === producerId)!;
  return {
    schemaVersion: PRODUCER_EVIDENCE_SCHEMA_VERSION,
    producerId,
    runId: 'verification-run-0001',
    runSequence: 1,
    status: 'PASSED',
    startedAt: '2026-08-27T10:00:00',
    completedAt: '2026-08-27T10:00:01',
    commandIdentity: {
      executable: 'node',
      arguments: ['tooling/verification/src/example.ts'],
      workingDirectory: 'repository-root',
      commandDigest: SHA256,
    },
    environmentRefs: { CI: SHA256 },
    frozenInputRefs: frozenInputs(entry),
    scenarios: {
      [selector.scenarioId]: {
        scenarioId: selector.scenarioId,
        title: 'Stable validation scenario',
        producerId,
        status: 'PASSED',
        requestIds: ['request-0001'],
        principalIds: ['principal-0001'],
        governanceObjectIds: ['governance-object-0001'],
        versionIds: ['version-0001'],
        ruleVersions: ['rule-version-0001'],
        artifactDigests: [SHA256],
        assertions: Object.fromEntries(entry.assertionIds.map((assertionId) => [
          assertionId,
          {
            assertionId,
            gateId,
            status: 'PASSED',
            description: 'Stable gate assertion',
            expected: { status: 'PASSED' },
            actual: { status: 'PASSED' },
            failureCode: null,
            evidenceItems: [{
              artifactId: 'producer-command-summary',
              relativePath: 'raw/command-summary.json',
              mediaType: 'application/json',
              byteLength: 42,
              sha256: SHA256,
              jsonPointer: '/commands/example/status',
              claimDigest: SHA256,
            }],
          },
        ])),
      },
    },
  };
}

function frozenInputs(entry: AbgCoverageMatrixEntry): ProducerEvidence['frozenInputRefs'] {
  return Object.fromEntries(entry.requiredFrozenInputs.map((kind) => [
    kind,
    kind === 'nodeVersion' ? 'v24.18.0' : SHA256,
  ]));
}
