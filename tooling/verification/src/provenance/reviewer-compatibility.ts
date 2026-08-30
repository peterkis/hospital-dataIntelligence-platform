import {
  CURRENT_EVIDENCE_CONTRACT_IDENTITY,
  REVIEWER_COMPATIBILITY_POLICY_VERSION,
  type EvidenceContractIdentity,
} from '../verification-contract-versions.js';

export type ReviewerCompatibilityLevel = 'EXACT' | 'COMPATIBLE' | 'INCOMPATIBLE';

export type EvidenceContractTuple = Readonly<Record<keyof EvidenceContractIdentity, string>>;

export interface ReviewerCompatibilityDefinition {
  readonly compatibilityPolicyVersion: typeof REVIEWER_COMPATIBILITY_POLICY_VERSION;
  readonly contractId: string;
  readonly supportedTuple: EvidenceContractIdentity;
  readonly compatibilityLevel: 'EXACT';
  readonly parsingPolicy: 'FULL_SUPPORTED_SCHEMA_VALIDATION';
  readonly semanticPolicy: 'CURRENT_DEFINITIONS_IDENTICAL';
}

export interface ReviewerCompatibilityAssessment {
  readonly compatibilityPolicyVersion: typeof REVIEWER_COMPATIBILITY_POLICY_VERSION;
  readonly contractId: string | null;
  readonly supportedTuple: EvidenceContractIdentity;
  readonly compatibilityLevel: ReviewerCompatibilityLevel;
  readonly parsingPolicy: 'FULL_SUPPORTED_SCHEMA_VALIDATION' | 'SAFE_ENVELOPE_ONLY';
  readonly semanticPolicy:
    | 'CURRENT_DEFINITIONS_IDENTICAL'
    | 'DEFINITION_DRIFT_REQUIRES_FAILURE'
    | 'UNKNOWN_CONTRACT_REQUIRES_FAILURE';
}

const CURRENT_CONTRACT_ID = 'phase-01.formal-abg-evidence-contract.current';

export const REVIEWER_COMPATIBILITY_REGISTRY = Object.freeze([
  Object.freeze({
    compatibilityPolicyVersion: REVIEWER_COMPATIBILITY_POLICY_VERSION,
    contractId: CURRENT_CONTRACT_ID,
    supportedTuple: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
    compatibilityLevel: 'EXACT',
    parsingPolicy: 'FULL_SUPPORTED_SCHEMA_VALIDATION',
    semanticPolicy: 'CURRENT_DEFINITIONS_IDENTICAL',
  }),
] as const satisfies readonly ReviewerCompatibilityDefinition[]);

export function assessReviewerCompatibility(input: {
  readonly evidenceContractIdentity: EvidenceContractTuple;
  readonly definitionsMatch: boolean;
}): ReviewerCompatibilityAssessment {
  const definition = REVIEWER_COMPATIBILITY_REGISTRY.find((candidate) =>
    contractTuplesEqual(candidate.supportedTuple, input.evidenceContractIdentity)
  );
  if (definition === undefined) {
    return {
      compatibilityPolicyVersion: REVIEWER_COMPATIBILITY_POLICY_VERSION,
      contractId: null,
      supportedTuple: CURRENT_EVIDENCE_CONTRACT_IDENTITY,
      compatibilityLevel: 'INCOMPATIBLE',
      parsingPolicy: 'SAFE_ENVELOPE_ONLY',
      semanticPolicy: 'UNKNOWN_CONTRACT_REQUIRES_FAILURE',
    };
  }
  if (!input.definitionsMatch) {
    return {
      ...definition,
      compatibilityLevel: 'COMPATIBLE',
      semanticPolicy: 'DEFINITION_DRIFT_REQUIRES_FAILURE',
    };
  }
  return definition;
}

function contractTuplesEqual(
  left: EvidenceContractTuple,
  right: EvidenceContractTuple,
): boolean {
  return Object.keys(CURRENT_EVIDENCE_CONTRACT_IDENTITY).every((field) => {
    const key = field as keyof EvidenceContractIdentity;
    return left[key] === right[key];
  });
}
