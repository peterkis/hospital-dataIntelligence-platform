import { canonicalSha256 } from '../../platform/hashing/canonical-hash.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { assignmentPeriodCovered, type AssignmentAdmissionVersion, type AssignmentPlacement,
  type AssignmentVersion } from './assignment-contracts.js';
import type { AssignmentDeclaredPeriodContext } from './assignment-closure-contracts.js';
import type { AssignmentPurpose, AssignmentVersionSemantics, ClassifiedAssignmentSemantics } from './assignment-semantics-contracts.js';
import type { AssignmentSemanticCandidate } from './assignment-semantics-policy.js';
import type { DepartmentPlacementReference } from '../department-master/index.js';
import type { EngagementEffectivePeriodContext } from './engagement-effective-period-contracts.js';

export const ASSIGNMENT_TEMPORARY_POLICY = {
  policyCode: 'ASSIGNMENT_SOURCE_LINKED_SECONDMENT_V1', policyVersion: 1,
  policyLabel: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY',
  primaryRetention: 'PRESERVE_SOURCE', targetMode: 'SECONDMENT', sourceDepth: 1,
  period: 'FINITE_SUBSET', overlap: 'AT_MOST_ONE_PER_ENGAGEMENT_PURPOSE',
  scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS', expiry: 'DERIVED_NO_SOURCE_MUTATION',
  maximumCandidates: 64, maximumSegments: 128, maximumEvidenceBytes: 65536,
} as const;
export const ASSIGNMENT_TEMPORARY_POLICY_DIGEST = canonicalSha256(ASSIGNMENT_TEMPORARY_POLICY).toString('hex');

export interface CreateSourceLinkedTemporaryAssignment {
  readonly governanceObjectId: string;
  readonly sourceAssignmentId: string;
  readonly expectedSourceVersionId: string;
  readonly targetPlacement: AssignmentPlacement;
  readonly businessValidFrom: string;
  readonly businessValidTo: string;
  readonly reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT';
}
export interface TemporaryAssignmentReference {
  readonly governanceObjectId: string;
  readonly targetAssignmentId: string;
}
export interface TemporarySourceWindowEvidence {
  readonly semanticRole: 'TEMPORARY_SOURCE_WINDOW_VALIDATION';
  readonly requestedFrom: string;
  readonly requestedTo: string;
  readonly recordAsOf: string;
  readonly sourceDepartment: DepartmentPlacementReference;
  // The target's immutable admission and segments retain the SAME Engagement
  // owner observation; source-window evidence does not invent a second axis.
  readonly targetAdmissionDependencyFingerprint: string;
  readonly constraintResult: 'SATISFIED';
}
export interface TemporaryCandidateEvidence {
  readonly scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS';
  readonly purposeCode: AssignmentPurpose;
  readonly businessValidFrom: string;
  readonly businessValidTo: string;
  readonly recordAsOf: string;
  readonly candidates: readonly AssignmentSemanticCandidate[];
  readonly result: 'SATISFIED';
}
export interface TemporaryAssignmentSourceLink {
  readonly targetAssignmentId: string;
  readonly targetAdmissionVersionId: string;
  readonly sourceAssignmentId: string;
  readonly sourceAssignmentVersionId: string;
  readonly personId: string;
  readonly engagementId: string;
  readonly governanceObjectId: string;
  readonly sourcePlacement: AssignmentPlacement;
  readonly targetPlacement: AssignmentPlacement;
  readonly preservedPurposeCode: AssignmentPurpose;
  readonly temporaryModeCode: 'SECONDMENT';
  readonly sourceSemanticVersionId: string;
  readonly sourceSemanticFingerprint: string;
  readonly sourceAcceptanceDependencyFingerprint: string;
  readonly sourceDeclaredFrom: string;
  readonly sourceDeclaredTo: string | null;
  readonly temporaryFrom: string;
  readonly temporaryTo: string;
  readonly evaluationRecordAsOf: string;
  readonly recordedFrom: string;
  readonly sourceWindowValidationEvidence: TemporarySourceWindowEvidence;
  readonly sourcePrimaryEvaluationEvidence: TemporaryCandidateEvidence;
  readonly temporaryOverlapEvaluationEvidence: TemporaryCandidateEvidence;
  readonly targetAdmissionDependencyFingerprint: string;
  readonly policyCode: typeof ASSIGNMENT_TEMPORARY_POLICY.policyCode;
  readonly policyVersion: 1;
  readonly policyDigest: string;
  readonly requestId: string;
  readonly createdBy: string;
  readonly operationHash: string;
  readonly reasonCode: 'TEMPORARY_SECONDMENT_PLACEMENT';
  readonly sourceLinkFingerprint: string;
}
export interface TemporaryAssignmentResult {
  readonly semanticRole: 'SOURCE_LINKED_TEMPORARY_ASSIGNMENT_RESULT';
  readonly targetAssignmentId: string;
  readonly targetAdmissionVersionId: string;
  readonly targetAdmission: AssignmentAdmissionVersion;
  readonly targetSemantics: ClassifiedAssignmentSemantics;
  readonly sourceLink: TemporaryAssignmentSourceLink;
}
export interface TemporaryAssignmentAsOf {
  readonly semanticRole: 'SOURCE_LINKED_TEMPORARY_ASSIGNMENT_DECLARATION';
  readonly declaration: AssignmentDeclaredPeriodContext;
  readonly selectedVersion: AssignmentVersion;
  readonly semantics: AssignmentVersionSemantics;
  readonly sourceLink: TemporaryAssignmentSourceLink;
}
export type TemporaryConstraintResult = 'SATISFIED' | 'NOT_SATISFIED' | 'REVIEW_REQUIRED' | 'UNKNOWN';
export interface TemporarySourceObservation {
  readonly sourceVersion: AssignmentVersion | null;
  readonly sourceSemantics: AssignmentVersionSemantics | null;
  readonly engagement: EngagementEffectivePeriodContext | null;
  readonly sourceDepartment: DepartmentPlacementReference | null;
  readonly targetDepartment: DepartmentPlacementReference | null;
  readonly candidates: readonly AssignmentSemanticCandidate[] | null;
}
export interface TemporaryAssignmentAssessment {
  readonly semanticRole: 'SOURCE_LINKED_TEMPORARY_ASSIGNMENT_ASSESSMENT';
  readonly evaluatedAssignmentVersionId: string;
  readonly assessedRecordAsOf: string;
  readonly isLatestAssignmentVersionAsOf: boolean;
  readonly referenceComparison: 'UNCHANGED' | 'CHANGED' | 'NOT_COMPARABLE';
  readonly constraintResult: TemporaryConstraintResult;
  readonly componentResults: Readonly<Record<'sourceDeclaration' | 'sourcePrimary' | 'engagement' |
    'sourceDepartment' | 'targetDepartment' | 'temporaryOverlap', TemporaryConstraintResult>>;
  readonly baselineSourceEvidence: TemporaryAssignmentSourceLink;
  readonly observedSourceEvidence: TemporarySourceObservation;
  readonly reasons: readonly string[];
}
export interface TemporaryAssignmentApplication {
  createSourceLinkedTemporaryAssignment(command: CreateSourceLinkedTemporaryAssignment): Promise<TemporaryAssignmentResult>;
  getTemporaryAssignment(query: TemporaryAssignmentReference): Promise<TemporaryAssignmentResult>;
  getTemporaryAssignmentAsOf(query: TemporaryAssignmentReference & { readonly businessAt: string; readonly recordAsOf: string }): Promise<TemporaryAssignmentAsOf>;
  assessTemporaryAssignmentDependencies(query: TemporaryAssignmentReference & {
    readonly assignmentVersionId: string; readonly recordAsOf: string }): Promise<TemporaryAssignmentAssessment>;
}
export function validateTemporaryAssignmentCreate(command: CreateSourceLinkedTemporaryAssignment): void {
  assertClosedObject(command, ['governanceObjectId', 'sourceAssignmentId', 'expectedSourceVersionId',
    'targetPlacement', 'businessValidFrom', 'businessValidTo', 'reasonCode']);
  for (const id of [command.governanceObjectId, command.sourceAssignmentId, command.expectedSourceVersionId]) assertPersonUuid(id);
  assertClosedObject(command.targetPlacement, ['scope', 'departmentGovernanceObjectId', 'departmentId']);
  assertPersonUuid(command.targetPlacement.departmentGovernanceObjectId); assertPersonUuid(command.targetPlacement.departmentId);
  if (command.targetPlacement.scope !== 'DEPARTMENT' || command.reasonCode !== 'TEMPORARY_SECONDMENT_PLACEMENT')
    throw new Error('ASSIGNMENT_INPUT_INVALID');
  if (typeof command.businessValidTo !== 'string') throw new Error('ASSIGNMENT_TEMPORARY_FINITE_PERIOD_REQUIRED');
  // 9999-12-31 is intentionally not accepted as a disguised infinite end.
  if (command.businessValidTo.startsWith('9999-')) throw new Error('ASSIGNMENT_TEMPORARY_FINITE_PERIOD_REQUIRED');
  assignmentPeriodCovered(command.businessValidFrom, command.businessValidTo, command.businessValidFrom, command.businessValidTo);
}
