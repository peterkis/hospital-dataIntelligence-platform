import type { AssignmentAdmissionVersion, AssignmentReference, AssignmentVersion, AssignmentVersionReference, CreateAssignment, ReviseAssignment } from './assignment-contracts.js';

export const ASSIGNMENT_PURPOSES = ['ORGANIZATIONAL_AFFILIATION', 'CLINICAL_PRACTICE', 'TRAINING_LEARNING'] as const;
export const ASSIGNMENT_MODES = ['PRIMARY_AFFILIATION', 'STANDING_CONCURRENT'] as const;
export type AssignmentPurpose = typeof ASSIGNMENT_PURPOSES[number];
export type AssignmentMode = typeof ASSIGNMENT_MODES[number];
export type AssignmentSemanticDimension = 'PURPOSE' | 'MODE';
export type AssignmentSemanticOperation = 'CLASSIFIED_CREATE' | 'SEMANTIC_ADOPT' | 'CLASSIFIED_PERIOD_REVISE' | 'SEMANTIC_CORRECT';
export interface AssignmentSemanticCodes { readonly purposeCode: AssignmentPurpose; readonly modeCode: AssignmentMode }
export interface RegisterAssignmentSemanticTerm {
  readonly governanceObjectId: string;
  readonly dimension: AssignmentSemanticDimension;
  readonly code: AssignmentPurpose | AssignmentMode;
  readonly label: string;
  readonly definitionState: 'ENABLED' | 'RETIRED';
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}
export interface AppendAssignmentSemanticTermVersion extends Omit<RegisterAssignmentSemanticTerm, 'dimension' | 'code'> {
  readonly termId: string;
  readonly expectedCurrentVersionId: string;
  readonly reasonCode: 'LABEL_CORRECTION' | 'APPLICABILITY_CORRECTION' | 'RETIREMENT';
}
export interface AssignmentSemanticTermVersion extends RegisterAssignmentSemanticTerm {
  readonly termId: string;
  readonly termVersionId: string;
  readonly versionNo: string;
  readonly recordedFrom: string;
  readonly supersedesTermVersionId: string | null;
}
export type CreateClassifiedAssignment = CreateAssignment & AssignmentSemanticCodes;
export type AdoptAssignmentSemantics = AssignmentReference & AssignmentSemanticCodes & { readonly expectedCurrentVersionId: string };
export type CorrectAssignmentSemantics = AdoptAssignmentSemantics & { readonly reasonCode: 'PURPOSE_CORRECTION' | 'MODE_CORRECTION' | 'PURPOSE_AND_MODE_CORRECTION' };
export type ReviseClassifiedAssignmentPeriod = ReviseAssignment;
export interface AssignmentPrimaryBucket {
  readonly governanceObjectId: string;
  readonly personId: string;
  readonly engagementId: string;
  readonly purposeCode: AssignmentPurpose;
  readonly scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS';
}
export interface AssignmentSemanticEvaluation {
  readonly bucket: AssignmentPrimaryBucket;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly evaluationRecordAsOf: string;
  readonly purposeTermVersionId: string;
  readonly modeTermVersionId: string;
  readonly dependencyFingerprint: string;
  readonly confirmedPrimaryCount: number;
  readonly unclassifiedCandidateCount: number;
  readonly result: 'SATISFIED' | 'NOT_APPLICABLE_NON_PRIMARY';
  readonly candidates: readonly {
    readonly assignmentId: string; readonly assignmentVersionId: string;
    readonly purposeCode: string | null; readonly modeCode: string | null;
    readonly businessValidFrom: string; readonly businessValidTo: string | null;
    readonly intersectionFrom: string; readonly intersectionTo: string | null;
  }[];
}
export interface ClassifiedAssignmentSemantics {
  readonly semanticRole?: 'EVALUATED_ADMISSION';
  readonly classification: 'CLASSIFIED';
  readonly assignmentVersionId: string;
  readonly purpose: AssignmentSemanticTermVersion;
  readonly mode: AssignmentSemanticTermVersion;
  readonly scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS';
  readonly semanticOperationKind: AssignmentSemanticOperation;
  readonly semanticRecordedFrom: string;
  readonly policyCode: 'ASSIGNMENT_PRIMARY_DEPARTMENT_SCOPE_V1';
  readonly policyVersion: 1;
  readonly policyDigest: string;
  readonly policyLabel: 'SYNTHETIC / NON_PRODUCTION / TEST POLICY ONLY';
  readonly classificationScope: 'STRUCTURAL_ASSIGNMENT_SEMANTICS_ONLY';
  readonly evaluation: AssignmentSemanticEvaluation;
  readonly semanticFingerprint: string;
}
export interface InheritedAssignmentClosureSemantics {
  readonly classification: 'CLASSIFIED';
  readonly semanticRole: 'INHERITED_FOR_CLOSURE';
  readonly assignmentVersionId: string;
  readonly sourceAssignmentVersionId: string;
  readonly sourceSemanticRecordedFrom: string;
  readonly closureKnownFrom: string;
  readonly purpose: AssignmentSemanticTermVersion;
  readonly mode: AssignmentSemanticTermVersion;
  readonly scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS';
  readonly sourceSemanticFingerprint: string;
  readonly primaryEvaluation: 'NOT_REEVALUATED_NON_EXPANSIVE';
}
export type AssignmentAdmissionSemantics = ClassifiedAssignmentSemantics | { readonly classification: 'UNCLASSIFIED'; readonly assignmentVersionId: string };
export type AssignmentVersionSemantics = AssignmentAdmissionSemantics | InheritedAssignmentClosureSemantics;
export interface ClassifiedAssignmentResult { readonly coreVersion: AssignmentAdmissionVersion; readonly semantics: ClassifiedAssignmentSemantics }
export interface AssignmentPrimaryResolution {
  readonly semanticRole: 'SCOPED_PRIMARY_AFFILIATION_ASSERTION';
  readonly bucket: AssignmentPrimaryBucket;
  readonly businessAt: string;
  readonly recordAsOf: string;
  readonly resolution: 'UNIQUE' | 'NONE' | 'UNKNOWN' | 'CONFLICT';
  readonly knownPrimaryAssignmentVersionRefs: readonly { readonly assignmentId: string; readonly assignmentVersionId: string }[];
  readonly unclassifiedCandidateCount: number;
  readonly selectedAssignmentVersionId: string | null;
  readonly policyCode: 'ASSIGNMENT_PRIMARY_DEPARTMENT_SCOPE_V1';
  readonly policyVersion: 1;
  readonly policyDigest: string;
}
export interface AssignmentSemanticsApplication {
  registerAssignmentSemanticTerm(command: RegisterAssignmentSemanticTerm): Promise<AssignmentSemanticTermVersion>;
  appendAssignmentSemanticTermVersion(command: AppendAssignmentSemanticTermVersion): Promise<AssignmentSemanticTermVersion>;
  getAssignmentSemanticTermVersion(query: { governanceObjectId: string; termVersionId: string }): Promise<AssignmentSemanticTermVersion>;
  findAssignmentSemanticTermAsOf(query: { governanceObjectId: string; dimension: AssignmentSemanticDimension; code: string; recordAsOf: string }): Promise<AssignmentSemanticTermVersion | null>;
  createClassifiedAssignment(command: CreateClassifiedAssignment): Promise<ClassifiedAssignmentResult>;
  adoptAssignmentSemantics(command: AdoptAssignmentSemantics): Promise<ClassifiedAssignmentResult>;
  reviseClassifiedAssignmentPeriod(command: ReviseClassifiedAssignmentPeriod): Promise<ClassifiedAssignmentResult>;
  correctAssignmentSemantics(command: CorrectAssignmentSemantics): Promise<ClassifiedAssignmentResult>;
  getAssignmentVersionSemantics(query: AssignmentVersionReference): Promise<AssignmentVersionSemantics>;
  getAssignmentSemanticsAsOf(query: AssignmentReference & { businessAt: string; recordAsOf: string }): Promise<{
    readonly coreVersion: AssignmentVersion; readonly businessPeriodContainsPoint: boolean; readonly semantics: AssignmentVersionSemantics;
  }>;
  resolvePrimaryAffiliation(query: { governanceObjectId: string; engagementId: string; purposeCode: AssignmentPurpose;
    scopeCode: 'HOSPITAL_DEPARTMENT_PLACEMENTS'; businessAt: string; recordAsOf: string }): Promise<AssignmentPrimaryResolution>;
}
