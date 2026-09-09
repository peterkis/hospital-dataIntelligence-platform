import { assignmentPeriodCovered, type AssignmentPlacement, type AssignmentVersion } from './assignment-contracts.js';
import type { AssignmentDependencies } from './assignment-repository.js';

/** Owner-private observation: immutable version and explicit window remain separate. */
export async function evaluateOrdinaryAssignmentWindow(dependencies: Pick<AssignmentDependencies, 'engagement' | 'department'>,
  selected: AssignmentVersion, engagementId: string, placement: AssignmentPlacement,
  window: { readonly from: string; readonly to: string | null }, recordAsOf: string,
  onMissing?: (error: unknown) => void) {
  if (!assignmentPeriodCovered(selected.businessValidFrom, selected.businessValidTo, window.from, window.to))
    throw new Error('REQUEST_OUTSIDE_DECLARED_PERIOD');
  async function read<T>(work: () => Promise<T>): Promise<T | null> {
    try { return await work(); } catch (error) {
      if (!onMissing) throw error;
      onMissing(error); return null;
    }
  }
  const engagement = await read(() => dependencies.engagement.getEngagementEffectivePeriodAsOf({ governanceObjectId: selected.governanceObjectId,
    engagementId, requestedFrom: window.from, requestedTo: window.to, recordAsOf }));
  const department = await read(() => dependencies.department.getDepartmentPlacementReferenceAsOf({
    departmentGovernanceObjectId: placement.departmentGovernanceObjectId, departmentId: placement.departmentId, recordAsOf }));
  return { engagement, department };
}
