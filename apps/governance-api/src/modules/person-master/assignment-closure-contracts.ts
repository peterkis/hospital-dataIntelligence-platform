import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import type { AssignmentReference, AssignmentVersionReference } from './assignment-contracts.js';

export const ASSIGNMENT_CLOSURE_REASONS = ['PLACEMENT_ENDED', 'HISTORICAL_END_RECORDED', 'ADMINISTRATIVE_CLOSURE'] as const;
export const ASSIGNMENT_CLOSURE_POLICY = {
  policyCode: 'ASSIGNMENT_NON_EXPANSIVE_CLOSURE_V1', policyVersion: 1,
  proofKind: 'NON_EXPANSIVE_CLOSURE',
  policyLabel: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY',
} as const;
export const ASSIGNMENT_CLOSURE_POLICY_DIGEST = canonicalSha256(ASSIGNMENT_CLOSURE_POLICY).toString('hex');

export interface EndAssignment extends AssignmentReference {
  readonly expectedCurrentVersionId: string;
  readonly endedAt: string;
  readonly reasonCode: typeof ASSIGNMENT_CLOSURE_REASONS[number];
}
export interface AssignmentClosureEvidence {
  readonly closureVersionId: string;
  readonly assignmentId: string;
  readonly governanceObjectId: string;
  readonly previousAssignmentVersionId: string;
  readonly previousVersionNo: string;
  readonly previousBusinessValidFrom: string;
  readonly previousBusinessValidTo: string | null;
  readonly endedAt: string;
  readonly closureRecordedFrom: string;
  readonly reasonCode: EndAssignment['reasonCode'];
  readonly policyCode: typeof ASSIGNMENT_CLOSURE_POLICY.policyCode;
  readonly policyVersion: 1;
  readonly policyDigest: string;
  readonly proofKind: 'NON_EXPANSIVE_CLOSURE';
  readonly isPeriodPreservingEndConfirmation: boolean;
  readonly sourceAcceptanceVersionId: string;
  readonly sourceAcceptanceDependencyFingerprint: string;
  readonly sourceSemanticsVersionId: string | null;
  readonly sourceSemanticFingerprint: string | null;
  readonly semanticInheritance: 'CLASSIFIED' | 'UNCLASSIFIED';
  readonly createdBy: string;
  readonly requestId: string;
  readonly operationHash: string;
  readonly closureEvidenceFingerprint: string;
}
export interface AssignmentClosureVersion extends AssignmentVersionReference {
  readonly recordKind: 'CLOSURE';
  readonly versionNo: string;
  readonly supersedesAssignmentVersionId: string;
  readonly reasonCode: 'LIFECYCLE_END';
  readonly businessValidFrom: string;
  readonly businessValidTo: string;
  readonly recordedFrom: string;
  readonly closureEvidence: AssignmentClosureEvidence;
}
export interface AssignmentDeclaredPeriodContext extends AssignmentReference {
  readonly semanticRole: 'ASSIGNMENT_DECLARED_PERIOD_CONTEXT';
  readonly selectedAssignmentVersionId: string;
  readonly versionNo: string;
  readonly businessAt: string;
  readonly recordAsOf: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly isWithinDeclaredPeriod: boolean;
  readonly endBoundaryReached: boolean;
  readonly explicitClosureKnownAsOf: boolean;
  readonly closureVersionId: string | null;
}
export interface AssignmentClosureApplication {
  endAssignment(command: EndAssignment): Promise<AssignmentClosureVersion>;
  getAssignmentClosure(query: AssignmentReference & { readonly closureVersionId: string }): Promise<AssignmentClosureVersion>;
  getAssignmentDeclaredPeriodAsOf(query: AssignmentReference & { readonly businessAt: string; readonly recordAsOf: string }): Promise<AssignmentDeclaredPeriodContext>;
}

export function validateAssignmentEnd(command: EndAssignment): void {
  assertClosedObject(command, ['governanceObjectId', 'assignmentId', 'expectedCurrentVersionId', 'endedAt', 'reasonCode']);
  assertPersonUuid(command.governanceObjectId); assertPersonUuid(command.assignmentId); assertPersonUuid(command.expectedCurrentVersionId);
  if (!ASSIGNMENT_CLOSURE_REASONS.includes(command.reasonCode)) throw new Error('ASSIGNMENT_INPUT_INVALID');
  if (typeof command.endedAt !== 'string' || command.endedAt.startsWith('0000-')) throw new Error('ASSIGNMENT_TIME_INVALID');
  temporalKey(command.endedAt);
}

/** Pure non-expansion proof, with no upstream admission or wall-clock dependency. */
export function assignmentEndConstraint(from: string, to: string | null, endedAt: string): string | null {
  const end = temporalKey(endedAt);
  if (end <= temporalKey(from)) return 'ASSIGNMENT_CLOSURE_PERIOD_INVALID';
  if (to !== null && end > temporalKey(to)) return 'ASSIGNMENT_CLOSURE_EXPANSION_FORBIDDEN';
  return null;
}
