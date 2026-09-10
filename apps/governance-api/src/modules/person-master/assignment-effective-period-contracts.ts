import { assertClosedObject, assertPersonUuid } from './contracts.js';
import { assignmentPeriodCovered, type AssignmentPlacement, type AssignmentReference } from './assignment-contracts.js';
import { temporalKey } from './engagement-rule-segments.js';
import type { AssignmentPurpose, AssignmentMode } from './assignment-semantics-contracts.js';
import type { EngagementStateSegment } from './engagement-effective-period-contracts.js';

export interface AssignmentEffectivePeriodQuery extends AssignmentReference {
  readonly requestedFrom: string;
  readonly requestedTo: string | null;
  readonly recordAsOf: string;
}
export interface AssignmentHalfOpenPeriod { readonly from: string; readonly to: string | null }
export type AssignmentDeclaredCoverage = 'FULL' | 'PARTIAL' | 'NONE';
export type AssignmentWindowResult = 'SATISFIED' | 'NOT_SATISFIED' | 'REVIEW_REQUIRED' | 'UNKNOWN';
export type AssignmentWindowComponent = 'engagement' | 'targetDepartment' | 'sourceDeclaration' |
  'sourcePrimary' | 'sourceDepartment' | 'temporaryOverlap';
export const ASSIGNMENT_WINDOW_REASONS = [
  'REQUEST_OUTSIDE_DECLARED_PERIOD', 'ENGAGEMENT_NOT_FOUND', 'ENGAGEMENT_NOT_KNOWN_AS_OF',
  'ASSIGNMENT_NOT_FOUND', 'ASSIGNMENT_NOT_KNOWN_AS_OF', 'ASSIGNMENT_TERM_NOT_APPLICABLE',
  'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED', 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED',
  'ASSIGNMENT_DEPENDENCY_UNKNOWN', 'ASSIGNMENT_DEPENDENCY_EVALUATION_LIMIT',
  'ASSIGNMENT_PLACEMENT_NOT_FOUND', 'ASSIGNMENT_PLACEMENT_UNPUBLISHED', 'ASSIGNMENT_PLACEMENT_TEMPORAL_SCOPE_UNSUPPORTED',
  'ASSIGNMENT_PLACEMENT_NOT_ACTIVE', 'ASSIGNMENT_PLACEMENT_PERIOD_NOT_COVERED', 'ASSIGNMENT_SEMANTIC_EVALUATION_LIMIT',
  'ASSIGNMENT_TEMPORARY_SOURCE_DECLARATION_NOT_SATISFIED', 'ASSIGNMENT_TEMPORARY_SOURCE_SEMANTICS_UNKNOWN',
  'ASSIGNMENT_PRIMARY_AFFILIATION_CONFLICT', 'ASSIGNMENT_PRIMARY_CLASSIFICATION_INCOMPLETE',
  'ASSIGNMENT_TEMPORARY_OVERLAP_CONFLICT', 'ASSIGNMENT_TEMPORARY_SOURCE_DEPARTMENT_NOT_SATISFIED',
] as const;
export type AssignmentWindowReason = typeof ASSIGNMENT_WINDOW_REASONS[number];
export function assignmentWindowReasons(values: readonly string[]): readonly AssignmentWindowReason[] {
  return [...new Set(values)].sort().map(value => {
    const known = ASSIGNMENT_WINDOW_REASONS.find(reason => reason === value);
    if (!known) throw new Error('ASSIGNMENT_EFFECTIVE_PERIOD_REASON_INVALID');
    return known;
  });
}
export interface AssignmentSemanticsReference {
  readonly classification: 'CLASSIFIED' | 'UNCLASSIFIED';
  readonly assignmentVersionId: string;
  readonly semanticRole: 'FROZEN_ADMISSION' | 'INHERITED_FOR_CLOSURE' | 'UNCLASSIFIED';
  readonly purposeCode: AssignmentPurpose | null;
  readonly modeCode: AssignmentMode | null;
  readonly purposeTermVersionId: string | null;
  readonly modeTermVersionId: string | null;
  readonly semanticVersionId: string | null;
  readonly semanticFingerprint: string | null;
}
export interface OriginalAssignmentEvidenceReferences {
  readonly admissionVersionId: string;
  readonly admissionDependencyFingerprint: string;
  readonly semanticVersionId: string | null;
  readonly semanticFingerprint: string | null;
  readonly closureVersionId: string | null;
  readonly closureFingerprint: string | null;
  readonly temporaryTargetAdmissionVersionId: string | null;
  readonly temporarySourceLinkFingerprint: string | null;
  readonly sourceAssignmentId: string | null;
  readonly sourceAssignmentVersionId: string | null;
  readonly sourceSemanticVersionId: string | null;
  readonly sourceSemanticFingerprint: string | null;
  readonly sourceAcceptanceDependencyFingerprint: string | null;
}
export interface AssignmentObservedDepartmentReference {
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly publicationProjectionId: string;
  readonly releaseId: string;
  readonly contentHash: string;
}
export interface AssignmentObservedEvidenceReferences {
  readonly engagementVersionId: string | null;
  readonly lifecycleSequence: string | null;
  readonly lifecycleEventIds: readonly string[];
  readonly targetDepartment: AssignmentObservedDepartmentReference | null;
  readonly sourceDepartment: AssignmentObservedDepartmentReference | null;
  readonly sourceAssignmentVersionId: string | null;
  readonly sourceSemanticFingerprint: string | null;
  readonly candidateVersions: readonly { readonly assignmentId: string; readonly assignmentVersionId: string }[];
}
export interface AssignmentWindowDependencyObservation {
  readonly result: AssignmentWindowResult | 'NOT_EVALUATED';
  readonly components: readonly { readonly component: AssignmentWindowComponent; readonly result: AssignmentWindowResult }[];
  readonly engagementSegments: readonly EngagementStateSegment[];
  readonly boundedReasons: readonly AssignmentWindowReason[];
}
export interface AssignmentEffectivePeriodContext extends AssignmentEffectivePeriodQuery {
  readonly semanticRole: 'ASSIGNMENT_EFFECTIVE_PERIOD_CONTEXT';
  readonly contractVersion: 1;
  readonly observationScope: 'STRUCTURAL_DEPENDENCIES_ONLY';
  readonly personId: string;
  readonly engagementId: string;
  readonly placement: AssignmentPlacement;
  readonly selectedAssignmentVersionId: string;
  readonly selectedVersionNo: string;
  readonly selectedRecordedFrom: string;
  readonly selectedRecordKind: 'ADMISSION' | 'CLOSURE';
  readonly declaredPeriod: AssignmentHalfOpenPeriod;
  readonly declaredCoverage: AssignmentDeclaredCoverage;
  readonly uncoveredPeriods: readonly AssignmentHalfOpenPeriod[];
  readonly explicitClosureKnown: boolean;
  readonly assignmentSemantics: AssignmentSemanticsReference;
  readonly originalEvidenceRefs: OriginalAssignmentEvidenceReferences;
  readonly structuralDependencies: AssignmentWindowDependencyObservation;
  readonly observedEvidenceRefs: AssignmentObservedEvidenceReferences;
  readonly contextFingerprint: string;
}
/** One structural observation; never a grant or a mutation/fence interface. */
export interface AssignmentEffectivePeriodReader {
  getAssignmentEffectivePeriodAsOf(query: AssignmentEffectivePeriodQuery): Promise<AssignmentEffectivePeriodContext>;
}
export function validateAssignmentEffectivePeriodQuery(query: AssignmentEffectivePeriodQuery): AssignmentEffectivePeriodQuery {
  assertClosedObject(query, ['governanceObjectId', 'assignmentId', 'requestedFrom', 'requestedTo', 'recordAsOf']);
  assertPersonUuid(query.governanceObjectId); assertPersonUuid(query.assignmentId);
  assignmentPeriodCovered(query.requestedFrom, query.requestedTo, query.requestedFrom, query.requestedTo);
  if (typeof query.recordAsOf !== 'string' || query.recordAsOf.startsWith('0000-')) throw new Error('ASSIGNMENT_TIME_INVALID');
  return { ...query, requestedFrom: temporalKey(query.requestedFrom),
    requestedTo: query.requestedTo === null ? null : temporalKey(query.requestedTo), recordAsOf: temporalKey(query.recordAsOf) };
}
/** Exact half-open difference, including an unbounded tail without a sentinel. */
export function assignmentDeclaredCoverage(declared: AssignmentHalfOpenPeriod, requested: AssignmentHalfOpenPeriod): {
  declaredCoverage: AssignmentDeclaredCoverage; uncoveredPeriods: readonly AssignmentHalfOpenPeriod[];
} {
  const d = { from: temporalKey(declared.from), to: declared.to === null ? null : temporalKey(declared.to) };
  const w = { from: temporalKey(requested.from), to: requested.to === null ? null : temporalKey(requested.to) };
  if (assignmentPeriodCovered(d.from, d.to, w.from, w.to)) return { declaredCoverage: 'FULL', uncoveredPeriods: [] };
  if ((d.to !== null && w.from >= d.to) || (w.to !== null && w.to <= d.from))
    return { declaredCoverage: 'NONE', uncoveredPeriods: [w] };
  const uncoveredPeriods: AssignmentHalfOpenPeriod[] = [];
  if (w.from < d.from) uncoveredPeriods.push({ from: w.from, to: d.from });
  if (d.to !== null && (w.to === null || d.to < w.to)) uncoveredPeriods.push({ from: d.to, to: w.to });
  return { declaredCoverage: 'PARTIAL', uncoveredPeriods };
}
