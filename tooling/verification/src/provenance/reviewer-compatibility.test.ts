import { describe, expect, it } from 'vitest';
import { CURRENT_EVIDENCE_CONTRACT_IDENTITY } from '../verification-contract-versions.js';
import {
  assessReviewerCompatibility,
  REVIEWER_COMPATIBILITY_REGISTRY,
} from './reviewer-compatibility.js';

describe('reviewer compatibility public seam', () => {
  it('requires the current tuple and identical definitions for an exact review', () => {
    expect(assessReviewerCompatibility({
      evidenceContractIdentity: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
      definitionsMatch: true,
    })).toMatchObject({
      compatibilityLevel: 'EXACT',
      parsingPolicy: 'FULL_SUPPORTED_SCHEMA_VALIDATION',
      semanticPolicy: 'CURRENT_DEFINITIONS_IDENTICAL',
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
