import { describe, expect, it } from 'vitest';
import { CURRENT_EVIDENCE_CONTRACT_IDENTITY } from '../verification-contract-versions.js';
import {
  assessReviewerCompatibility,
  REVIEWER_COMPATIBILITY_REGISTRY,
} from './reviewer-compatibility.js';

const CURRENT_AR11_TUPLE = {
  runPlanSchemaVersion: 'phase-01.abg-run-plan.v4',
  runPlanAuthorityId: 'phase-01.repository-authoritative-plan.v3',
  producerEvidenceSchemaVersion: 'phase-01.producer-evidence.v2',
  producerEvidenceIndexSchemaVersion: 'phase-01.producer-evidence-index.v2',
  gateResultSchemaVersion: 'phase-01.abg-gate-result.v3',
  runSummarySchemaVersion: 'phase-01.abg-run.v5',
  terminalConclusionSchemaVersion: 'phase-01.formal-terminal-conclusion.v2',
  runtimeOutcomeSchemaVersion: 'phase-01.formal-runtime-outcome.v3',
  evidenceManifestSchemaVersion: 'phase-01.evidence-manifest.v1',
} as const;

describe('reviewer compatibility public seam', () => {
  it('requires the exact current AR-11 tuple and identical definitions for an exact review', () => {
    expect(CURRENT_EVIDENCE_CONTRACT_IDENTITY).toEqual(CURRENT_AR11_TUPLE);
    expect(assessReviewerCompatibility({
      evidenceContractIdentity: CURRENT_AR11_TUPLE,
      definitionsMatch: true,
    })).toMatchObject({
      compatibilityLevel: 'EXACT',
      parsingPolicy: 'FULL_SUPPORTED_SCHEMA_VALIDATION',
      semanticPolicy: 'CURRENT_DEFINITIONS_IDENTICAL',
    });
  });

  it('rejects the prior AR-10 runtime tuple as incompatible', () => {
    const priorAr10Tuple = {
      ...CURRENT_AR11_TUPLE,
      runPlanSchemaVersion: 'phase-01.abg-run-plan.v3',
      runPlanAuthorityId: 'phase-01.repository-authoritative-plan.v2',
      runSummarySchemaVersion: 'phase-01.abg-run.v4',
      terminalConclusionSchemaVersion: 'phase-01.formal-terminal-conclusion.v1',
      runtimeOutcomeSchemaVersion: 'phase-01.formal-runtime-outcome.v2',
    };

    expect(assessReviewerCompatibility({
      evidenceContractIdentity: priorAr10Tuple,
      definitionsMatch: true,
    })).toMatchObject({
      compatibilityLevel: 'INCOMPATIBLE',
      parsingPolicy: 'SAFE_ENVELOPE_ONLY',
      semanticPolicy: 'UNKNOWN_CONTRACT_REQUIRES_FAILURE',
    });
  });

  it('permits full read-only parsing but never formal passing when definitions drift', () => {
    expect(assessReviewerCompatibility({
      evidenceContractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
      definitionsMatch: false,
    })).toMatchObject({
      compatibilityLevel: 'COMPATIBLE',
      parsingPolicy: 'FULL_SUPPORTED_SCHEMA_VALIDATION',
      semanticPolicy: 'DEFINITION_DRIFT_REQUIRES_FAILURE',
    });
  });

  it('fails closed to safe envelope parsing for an unknown tuple', () => {
    const unknown = {
      ...CURRENT_EVIDENCE_CONTRACT_IDENTITY,
      runSummarySchemaVersion: 'phase-01.abg-run.v999',
    };

    expect(assessReviewerCompatibility({
      evidenceContractIdentity: unknown,
      definitionsMatch: true,
    })).toMatchObject({
      compatibilityLevel: 'INCOMPATIBLE',
      parsingPolicy: 'SAFE_ENVELOPE_ONLY',
      semanticPolicy: 'UNKNOWN_CONTRACT_REQUIRES_FAILURE',
    });
  });

  it('declares the accepted current tuple in a deterministic registry', () => {
    expect(REVIEWER_COMPATIBILITY_REGISTRY).toHaveLength(1);
    expect(REVIEWER_COMPATIBILITY_REGISTRY[0]).toMatchObject({
      contractId: expect.any(String),
      supportedTuple: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
      compatibilityLevel: 'EXACT',
    });
  });
});
