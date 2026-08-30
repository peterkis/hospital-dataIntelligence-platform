import { describe, expect, it } from 'vitest';
import {
  ABG_COVERAGE_MATRIX,
  ABG_FROZEN_INPUT_KINDS,
  ABG_PRODUCER_IDS,
  ABG_REFERENCE_KINDS,
  assertValidAbgGateEvidence,
  type AbgCoverageMatrixEntry,
  type AbgGateEvidenceEnvelope,
  validateAbgCoverageMatrix,
} from './abg-coverage-matrix.js';
import { ABG_GATES } from './abg-catalog.js';
import { renderAbgCoverageMarkdown } from './report-abg-coverage.js';

const SHA256 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ABG coverage matrix', () => {
  it('covers the catalog exactly once, in catalog order, with matching evidence classes', () => {
    validateAbgCoverageMatrix();
    expect(ABG_COVERAGE_MATRIX).toHaveLength(40);
    expect(ABG_GATES).toHaveLength(40);
    expect(ABG_COVERAGE_MATRIX.map((entry) => entry.gateId)).toEqual(
      ABG_GATES.map((gate) => gate.gateId),
    );
    expect(ABG_COVERAGE_MATRIX.map((entry) => entry.evidenceClass)).toEqual(
      ABG_GATES.map((gate) => gate.evidenceClass),
    );
    expect(ABG_COVERAGE_MATRIX.flatMap((entry) => entry.assertionIds)).toHaveLength(50);
  });

  it('binds ABG-40 to both post-cleanup terminal lifecycle assertions', () => {
    const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === 'ABG-40');

    expect(entry).toMatchObject({
      scenarioIds: ['RUN-FORMAL-TERMINAL-LIFECYCLE'],
      assertionIds: [
        'ABG-40:formal-terminal-lifecycle-complete',
        'ABG-40:formal-evidence-seal-eligible',
      ],
      producerIds: ['formal-run'],
    });
    expect(entry?.evidenceSelectors).toHaveLength(2);
  });

  it('has meaningful scenarios, gate-scoped assertions, controlled producers, and strict selectors', () => {
    const assertionOwners = new Map<string, string>();
    for (const entry of ABG_COVERAGE_MATRIX) {
      expect(entry.scenarioIds.length).toBeGreaterThan(0);
      expect(entry.assertionIds.length).toBeGreaterThan(0);
      expect(entry.producerIds.length).toBeGreaterThan(0);
      expect(entry.evidenceSelectors.length).toBeGreaterThan(0);
      for (const scenarioId of entry.scenarioIds) {
        expect(scenarioId).not.toMatch(/^PHASE0?1-ABG-\d+$/iu);
      }
      for (const assertionId of entry.assertionIds) {
        expect(assertionId.startsWith(entry.gateId + ':')).toBe(true);
        expect(assertionOwners.has(assertionId)).toBe(false);
        assertionOwners.set(assertionId, entry.gateId);
        const assertionSelectors = entry.evidenceSelectors.filter(
          (selector) => selector.assertionId === assertionId,
        );
        expect(assertionSelectors.length).toBeGreaterThan(0);
        expect(assertionSelectors.every((selector) => entry.producerIds.includes(selector.producerId)))
          .toBe(true);
      }
      for (const producerId of entry.producerIds) {
        expect(ABG_PRODUCER_IDS).toContain(producerId);
      }
      for (const referenceKind of entry.requiredReferenceKinds) {
        expect(ABG_REFERENCE_KINDS).toContain(referenceKind);
      }
      for (const frozenInput of entry.requiredFrozenInputs) {
        expect(ABG_FROZEN_INPUT_KINDS).toContain(frozenInput);
      }
      for (const selector of entry.evidenceSelectors) {
        expect(entry.scenarioIds).toContain(selector.scenarioId);
        expect(entry.assertionIds).toContain(selector.assertionId);
        expect(entry.producerIds).toContain(selector.producerId);
        expect(selector.jsonPointer).toMatch(/^\/.+\/status$/u);
        expect(selector.required).toBe(true);
        expect(selector.expectedStatus).toBe('PASSED');
      }
    }
  });

  it('permits shared business scenarios without allowing shared assertions', () => {
    const scenarioUseCounts = new Map<string, number>();
    for (const entry of ABG_COVERAGE_MATRIX) {
      for (const scenarioId of entry.scenarioIds) {
        scenarioUseCounts.set(scenarioId, (scenarioUseCounts.get(scenarioId) ?? 0) + 1);
      }
    }
    expect([...scenarioUseCounts.values()].some((count) => count > 1)).toBe(true);
    const assertions = ABG_COVERAGE_MATRIX.flatMap((entry) => entry.assertionIds);
    expect(new Set(assertions).size).toBe(assertions.length);
  });

  it('rejects unknown or duplicate gate coverage and malformed configuration', () => {
    const unknownGate = cloneMatrix();
    unknownGate[0] = { ...unknownGate[0]!, gateId: 'ABG-41' };
    expect(() => validateAbgCoverageMatrix(unknownGate)).toThrow(
      'ABG_COVERAGE_GATE_ORDER_OR_ID_MISMATCH',
    );

    const duplicateAssertion = cloneMatrix();
    duplicateAssertion[1] = {
      ...duplicateAssertion[1]!,
      assertionIds: [...duplicateAssertion[0]!.assertionIds],
    };
    expect(() => validateAbgCoverageMatrix(duplicateAssertion)).toThrow(
      'ABG_COVERAGE_ASSERTION_NOT_GATE_SCOPED',
    );

    const genericScenario = cloneMatrix();
    genericScenario[0] = {
      ...genericScenario[0]!,
      scenarioIds: ['PHASE01-ABG-01'],
    };
    expect(() => validateAbgCoverageMatrix(genericScenario)).toThrow(
      'ABG_COVERAGE_SCENARIO_ID_INVALID',
    );

    const wrongEvidenceClass = cloneMatrix();
    wrongEvidenceClass[0] = { ...wrongEvidenceClass[0]!, evidenceClass: 'API' };
    expect(() => validateAbgCoverageMatrix(wrongEvidenceClass)).toThrow(
      'ABG_COVERAGE_EVIDENCE_CLASS_MISMATCH',
    );

    const placeholderArtifact = cloneMatrix();
    const originalSelector = placeholderArtifact[0]!.evidenceSelectors[0]!;
    placeholderArtifact[0] = {
      ...placeholderArtifact[0]!,
      evidenceSelectors: [{ ...originalSelector, artifactId: 'TODO' }],
    };
    expect(() => validateAbgCoverageMatrix(placeholderArtifact)).toThrow(
      'ABG_COVERAGE_SELECTOR_ARTIFACT_INVALID',
    );
  });

  it('fails closed when any required evidence element is absent or non-semantic', () => {
    const entry = ABG_COVERAGE_MATRIX.find((candidate) => candidate.gateId === 'ABG-05')!;
    const valid = buildEvidence(entry);
    expect(() => assertValidAbgGateEvidence(valid)).not.toThrow();

    const missingScenario = { ...valid, scenarioResults: {} };
    expect(() => assertValidAbgGateEvidence(missingScenario)).toThrow(
      'ABG_EVIDENCE_SCENARIO_REQUIRED',
    );

    const missingAssertion = { ...valid, assertionResults: {} };
    expect(() => assertValidAbgGateEvidence(missingAssertion)).toThrow(
      'ABG_EVIDENCE_ASSERTION_REQUIRED',
    );

    const missingSelector = { ...valid, evidenceSelectors: [] };
    expect(() => assertValidAbgGateEvidence(missingSelector)).toThrow(
      'ABG_EVIDENCE_SELECTOR_REQUIRED',
    );

    for (const referenceKind of [
      'principalIds',
      'versionIds',
      'ruleVersions',
      'frozenInputDigests',
      'artifactDigests',
    ] as const) {
      const references = { ...valid.references };
      delete references[referenceKind];
      expect(() => assertValidAbgGateEvidence({ ...valid, references })).toThrow(
        'ABG_EVIDENCE_REFERENCE_REQUIRED',
      );
    }

    const frozenInputs = { ...valid.frozenInputs };
    delete frozenInputs[entry.requiredFrozenInputs[0]!];
    expect(() => assertValidAbgGateEvidence({ ...valid, frozenInputs })).toThrow(
      'ABG_EVIDENCE_FROZEN_INPUT_REQUIRED',
    );
  });

  it('renders a human-readable Markdown report from the TypeScript authority', () => {
    const report = renderAbgCoverageMarkdown();
    expect(report).toContain('# Phase 01 ABG Evidence Coverage');
    expect(report).toContain('### ABG-01');
    expect(report).toContain('### ABG-40');
    expect(report).toContain('Gate-scoped assertions');
  });
});

function cloneMatrix(): AbgCoverageMatrixEntry[] {
  return structuredClone(ABG_COVERAGE_MATRIX) as AbgCoverageMatrixEntry[];
}

function buildEvidence(entry: AbgCoverageMatrixEntry): AbgGateEvidenceEnvelope {
  return {
    gateId: entry.gateId,
    scenarioResults: Object.fromEntries(entry.scenarioIds.map((scenarioId) => [scenarioId, 'PASSED'])),
    assertionResults: Object.fromEntries(
      entry.assertionIds.map((assertionId) => [assertionId, 'PASSED']),
    ),
    evidenceSelectors: entry.evidenceSelectors.map((selector) => ({
      producerId: selector.producerId,
      artifactId: selector.artifactId,
      scenarioId: selector.scenarioId,
      assertionId: selector.assertionId,
      jsonPointer: selector.jsonPointer,
      status: selector.expectedStatus,
      artifactDigest: SHA256,
    })),
    references: Object.fromEntries(
      entry.requiredReferenceKinds.map((referenceKind) => [
        referenceKind,
        referenceKind === 'frozenInputDigests' || referenceKind === 'artifactDigests'
          ? [SHA256]
          : ['reference-' + referenceKind],
      ]),
    ),
    frozenInputs: Object.fromEntries(
      entry.requiredFrozenInputs.map((frozenInput) => [frozenInput, 'frozen-' + frozenInput]),
    ),
  };
}
