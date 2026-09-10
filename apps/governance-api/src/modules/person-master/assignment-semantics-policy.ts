import { temporalKey } from './engagement-rule-segments.js';
import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { ASSIGNMENT_MODES, ASSIGNMENT_PURPOSES, type AssignmentSemanticCodes } from './assignment-semantics-contracts.js';

export const ASSIGNMENT_SEMANTIC_RULE = {
  policyCode: 'ASSIGNMENT_PRIMARY_DEPARTMENT_SCOPE_V1', policyVersion: 1,
  scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS',
  bucket: ['governanceObjectId','personId','engagementId','purposeCode','scopeCode'],
  latest: 'LATEST_COMPLETE_CORE_AT_R_THEN_EXACT_SEMANTICS',
  interval: 'HALF_OPEN_MICROSECONDS_NULL_INFINITY',
  primary: 'AT_MOST_ONE', unknown: 'CONFLICT_THEN_INCOMPLETE',
  maximumCandidates: 64, maximumIntersections: 128, maximumEvidenceBytes: 65536,
} as const;
export const ASSIGNMENT_SEMANTIC_POLICY = {
  policyCode: ASSIGNMENT_SEMANTIC_RULE.policyCode, policyVersion: ASSIGNMENT_SEMANTIC_RULE.policyVersion,
  policyDigest: canonicalSha256(ASSIGNMENT_SEMANTIC_RULE).toString('hex'),
  policyLabel: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY',
  classificationScope: 'STRUCTURAL_ASSIGNMENT_SEMANTICS_ONLY',
} as const;
export function validateAssignmentSemanticCodes(codes: AssignmentSemanticCodes): void {
  if (!ASSIGNMENT_PURPOSES.includes(codes.purposeCode)) throw new Error('ASSIGNMENT_UNKNOWN_PURPOSE');
  if (!ASSIGNMENT_MODES.some(mode => mode === codes.modeCode)) throw new Error('ASSIGNMENT_MODE_NOT_SUPPORTED_IN_SLICE');
}

export interface AssignmentSemanticCandidate {
  readonly assignmentId: string;
  readonly assignmentVersionId: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly purposeCode: string | null;
  readonly modeCode: string | null;
}

/** Candidates are exact latest complete versions from one Engagement at one R. */
export function evaluateAssignmentPrimary(candidate: {
  businessValidFrom: string; businessValidTo: string | null; purposeCode: string; modeCode: string;
}, others: readonly AssignmentSemanticCandidate[]) {
  if (others.length>64) throw new Error('ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT');
  const overlaps = others.filter(other =>
    (other.businessValidTo === null || temporalKey(candidate.businessValidFrom) < temporalKey(other.businessValidTo)) &&
    (candidate.businessValidTo === null || temporalKey(other.businessValidFrom) < temporalKey(candidate.businessValidTo)));
  const primary = overlaps.filter(other => other.purposeCode === candidate.purposeCode && other.modeCode === 'PRIMARY_AFFILIATION');
  const unclassifiedCandidateCount = overlaps.filter(other => other.purposeCode === null || other.modeCode === null).length;
  return { result: candidate.modeCode !== 'PRIMARY_AFFILIATION' ? 'NOT_APPLICABLE_NON_PRIMARY' :
    primary.length ? 'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT' :
    unclassifiedCandidateCount ? 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE' : 'SATISFIED',
    candidates: overlaps.map(other => ({ ...other,
      intersectionFrom: temporalKey(candidate.businessValidFrom)>temporalKey(other.businessValidFrom) ? candidate.businessValidFrom : other.businessValidFrom,
      intersectionTo: candidate.businessValidTo === null ? other.businessValidTo : other.businessValidTo === null ? candidate.businessValidTo :
        temporalKey(candidate.businessValidTo)<temporalKey(other.businessValidTo) ? candidate.businessValidTo : other.businessValidTo,
    })), confirmedPrimaryCount: primary.length, unclassifiedCandidateCount };
}
