import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type { EngagementEffectivePeriodContext } from './engagement-effective-period-contracts.js';
import type { DepartmentPlacementReference } from '../department-master/index.js';
import { assertClosedObject, assertPersonUuid } from './contracts.js';

export const ASSIGNMENT_POLICY = 'ASSIGNMENT_DEPARTMENT_CORE_V1' as const;
export interface AssignmentPlacement {
  readonly scope: 'DEPARTMENT';
  readonly departmentGovernanceObjectId: string;
  readonly departmentId: string;
}
export interface CreateAssignment {
  readonly governanceObjectId: string;
  readonly engagementId: string;
  readonly relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT';
  readonly placement: AssignmentPlacement;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}
export interface AssignmentReference {
  readonly governanceObjectId: string;
  readonly assignmentId: string;
}
export interface AssignmentVersionReference extends AssignmentReference {
  readonly assignmentVersionId: string;
}
export interface ReviseAssignment extends AssignmentReference {
  readonly expectedCurrentVersionId: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly reasonCode: 'VALIDITY_CORRECTION' | 'CONTINUATION_EXTENSION';
}
export interface Assignment extends AssignmentReference {
  readonly engagementId: string;
  readonly personId: string;
  readonly placement: AssignmentPlacement;
  readonly relationBasis: 'CONFIRMED_DISTINCT_PLACEMENT';
  readonly createdAt: string;
}
export interface AssignmentDependencyEvidence {
  readonly validationPolicyCode: typeof ASSIGNMENT_POLICY;
  readonly evaluationRecordAsOf: string;
  readonly engagement: EngagementEffectivePeriodContext;
  readonly department: DepartmentPlacementReference;
  readonly dependencyFingerprint: string;
}
export interface AssignmentVersion extends AssignmentVersionReference {
  readonly versionNo: string;
  readonly supersedesAssignmentVersionId: string | null;
  readonly reasonCode: ReviseAssignment['reasonCode'] | null;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly acceptanceEvidence: AssignmentDependencyEvidence;
}
export interface AssignmentDependencyAssessment {
  readonly evaluatedAssignmentVersionId: string;
  readonly assessedRecordAsOf: string;
  readonly isLatestAssignmentVersionAsOf: boolean;
  readonly referenceComparison: 'UNCHANGED' | 'CHANGED' | 'NOT_COMPARABLE';
  readonly constraintResult: 'SATISFIED' | 'REVIEW_REQUIRED' | 'NOT_SATISFIED' | 'UNKNOWN';
  readonly baselineEvidence: AssignmentDependencyEvidence;
  readonly observedEvidence: AssignmentDependencyEvidence | null;
  readonly reasons: readonly string[];
}
export interface AssignmentCoreApplication {
  createAssignment(command: CreateAssignment): Promise<AssignmentVersion>;
  reviseAssignment(command: ReviseAssignment): Promise<AssignmentVersion>;
  getAssignment(query: AssignmentReference): Promise<Assignment>;
  getAssignmentVersion(query: AssignmentVersionReference): Promise<AssignmentVersion>;
  listAssignmentVersions(query: AssignmentReference & { readonly afterVersionNo: string; readonly limit: number }): Promise<readonly AssignmentVersion[]>;
  assessAssignmentDependencies(query: AssignmentVersionReference & { readonly recordAsOf: string }): Promise<AssignmentDependencyAssessment>;
}

export function validateAssignmentCreate(command: CreateAssignment): void {
  assertClosedObject(command, ['governanceObjectId', 'engagementId', 'relationBasis', 'placement', 'businessValidFrom', 'businessValidTo']);
  assertPersonUuid(command.governanceObjectId); assertPersonUuid(command.engagementId);
  assertClosedObject(command.placement, ['scope', 'departmentGovernanceObjectId', 'departmentId']);
  assertPersonUuid(command.placement.departmentGovernanceObjectId); assertPersonUuid(command.placement.departmentId);
  if (command.placement.scope !== 'DEPARTMENT' || command.relationBasis !== 'CONFIRMED_DISTINCT_PLACEMENT') throw new Error('ASSIGNMENT_INPUT_INVALID');
  assignmentPeriodCovered(command.businessValidFrom, command.businessValidTo, command.businessValidFrom, command.businessValidTo);
}
export function validateAssignmentRevise(command: ReviseAssignment): void {
  assertClosedObject(command, ['governanceObjectId', 'assignmentId', 'expectedCurrentVersionId', 'businessValidFrom', 'businessValidTo', 'reasonCode']);
  assertPersonUuid(command.governanceObjectId); assertPersonUuid(command.assignmentId); assertPersonUuid(command.expectedCurrentVersionId);
  if (!['VALIDITY_CORRECTION', 'CONTINUATION_EXTENSION'].includes(command.reasonCode)) throw new Error('ASSIGNMENT_INPUT_INVALID');
  assignmentPeriodCovered(command.businessValidFrom, command.businessValidTo, command.businessValidFrom, command.businessValidTo);
}

function key(value: string): string {
  if (typeof value !== 'string' || value.startsWith('0000-')) throw new Error('ASSIGNMENT_TIME_INVALID');
  parseLocalDateTime(value);
  return `${value.slice(0, 19)}.${(value.split('.')[1] ?? '').padEnd(6, '0')}`;
}

export function assignmentEngagementConstraint(e: Pick<EngagementEffectivePeriodContext,
  'requestedFrom' | 'requestedTo' | 'authoritativeBusinessValidFrom' | 'authoritativeBusinessValidTo' | 'stateSegments'>): string | null {
  if (!assignmentPeriodCovered(e.authoritativeBusinessValidFrom, e.authoritativeBusinessValidTo, e.requestedFrom, e.requestedTo))
    return 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED';
  if (!e.stateSegments.length) return 'ASSIGNMENT_DEPENDENCY_UNKNOWN';
  if (e.stateSegments.some(s => s.businessState === 'SUSPENDED')) return 'ASSIGNMENT_ENGAGEMENT_SUSPENSION_REVIEW_REQUIRED';
  if (e.stateSegments.some(s => s.businessState !== 'ACTIVE')) return 'ASSIGNMENT_ENGAGEMENT_PERIOD_NOT_COVERED';
  return null;
}

/** Complete half-open containment, preserving PostgreSQL microsecond precision. */
export function assignmentPeriodCovered(parentFrom: string, parentTo: string | null,
  from: string, to: string | null): boolean {
  const start = key(from), end = to === null ? null : key(to);
  if (end !== null && end <= start) throw new Error('ASSIGNMENT_PERIOD_INVALID');
  return key(parentFrom) <= start &&
    (parentTo === null || (end !== null && end <= key(parentTo)));
}
