import type {
  AuditEventService,
  DepartmentAuditAggregateType,
  DepartmentAuditEventType,
  RecordedAuditEvent,
} from '../audit/index.js';
import { assertAuditLocalDateTime } from '../audit/index.js';
import type { RequestContext } from '../../platform/transaction/transaction-runner.js';

const AUTHORITY_SCOPE = 'DEPARTMENT_GOVERNANCE';

export interface DepartmentAssignmentAuditSnapshot {
  readonly assignmentId: string;
  readonly campusId: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
  readonly recordedTo: string | null;
}

export interface DepartmentGovernanceAudit {
  departmentCreated(input: { readonly governanceObjectId: string; readonly departmentId: string; readonly creator: string }): Promise<RecordedAuditEvent>;
  departmentVersionCreated(input: { readonly governanceObjectId: string; readonly departmentId: string; readonly departmentVersionId: string; readonly versionNo: string; readonly contentHash: Buffer }): Promise<RecordedAuditEvent>;
  departmentVersionUpdated(input: { readonly governanceObjectId: string; readonly departmentVersionId: string; readonly beforeContentHash: Buffer; readonly afterContentHash: Buffer }): Promise<RecordedAuditEvent>;
  departmentSubmitted(input: { readonly governanceObjectId: string; readonly departmentVersionId: string; readonly workflowInstanceId: string }): Promise<RecordedAuditEvent>;
  departmentReviewed(input: { readonly governanceObjectId: string; readonly departmentVersionId: string; readonly reviewResult: 'APPROVED' | 'REJECTED'; readonly reviewer: string; readonly reason: string }): Promise<RecordedAuditEvent>;
  departmentApproved(input: { readonly governanceObjectId: string; readonly departmentVersionId: string; readonly approver: string }): Promise<RecordedAuditEvent>;
  departmentPublished(input: { readonly governanceObjectId: string; readonly departmentVersionId: string; readonly releaseId: string; readonly publishedAt: string; readonly contentHash: Buffer }): Promise<RecordedAuditEvent>;
  hierarchyViewCreated(input: { readonly governanceObjectId: string; readonly viewId: string; readonly viewType: string }): Promise<RecordedAuditEvent>;
  hierarchyVersionCreated(input: { readonly governanceObjectId: string; readonly viewId: string; readonly viewVersionId: string; readonly contentHash: Buffer }): Promise<RecordedAuditEvent>;
  hierarchyPublished(input: { readonly governanceObjectId: string; readonly viewId: string; readonly viewVersionId: string; readonly releaseId: string; readonly contentHash: Buffer }): Promise<RecordedAuditEvent>;
  nodeMoved(input: { readonly governanceObjectId: string; readonly viewVersionId: string; readonly departmentId: string; readonly oldParentNodeId: string | null; readonly newParentNodeId: string | null; readonly hierarchyViewType: string }): Promise<RecordedAuditEvent>;
  sourceMappingCreated(input: { readonly governanceObjectId: string; readonly mappingId: string; readonly sourceSystem: string; readonly sourceCode: string; readonly departmentId: string }): Promise<RecordedAuditEvent>;
  sourceMappingConfirmed(input: { readonly governanceObjectId: string; readonly mappingId: string; readonly operator: string }): Promise<RecordedAuditEvent>;
  sourceMappingRejected(input: { readonly governanceObjectId: string; readonly mappingId: string; readonly reason: string }): Promise<RecordedAuditEvent>;
  campusAssigned(input: { readonly governanceObjectId: string; readonly assignmentId: string; readonly departmentId: string; readonly campusId: string; readonly contentHash: Buffer }): Promise<RecordedAuditEvent>;
  campusChanged(input: { readonly governanceObjectId: string; readonly assignmentId: string; readonly oldAssignment: DepartmentAssignmentAuditSnapshot; readonly newAssignment: DepartmentAssignmentAuditSnapshot; readonly contentHash: Buffer }): Promise<RecordedAuditEvent>;
}

export function createDepartmentGovernanceAudit(
  audit: AuditEventService,
  _context: RequestContext,
): DepartmentGovernanceAudit {
  assertAuditLocalDateTime(_context.occurredAt);
  const record = (
    eventType: DepartmentAuditEventType,
    aggregateType: DepartmentAuditAggregateType,
    aggregateId: string,
    governanceObjectId: string,
    payload: Readonly<Record<string, unknown>>,
    afterHash: Buffer | null = null,
  ) => audit.append({
    governanceObjectId,
    eventType,
    aggregateType,
    aggregateId,
    payload,
    afterHash,
    authorityScope: AUTHORITY_SCOPE,
  });

  return {
    departmentCreated: (input) => record('DEPARTMENT_CREATED', 'DEPARTMENT', input.departmentId, input.governanceObjectId, {
      departmentId: input.departmentId,
      governanceObjectId: input.governanceObjectId,
      creator: input.creator,
    }),
    departmentVersionCreated: (input) => record('DEPARTMENT_VERSION_CREATED', 'DEPARTMENT_VERSION', input.departmentVersionId, input.governanceObjectId, {
      departmentId: input.departmentId,
      departmentVersionId: input.departmentVersionId,
      versionNo: input.versionNo,
      contentHash: input.contentHash.toString('hex'),
    }, input.contentHash),
    departmentVersionUpdated: (input) => record('DEPARTMENT_VERSION_UPDATED', 'DEPARTMENT_VERSION', input.departmentVersionId, input.governanceObjectId, {
      beforeContentHash: input.beforeContentHash.toString('hex'),
      afterContentHash: input.afterContentHash.toString('hex'),
    }, input.afterContentHash),
    departmentSubmitted: (input) => record('DEPARTMENT_SUBMITTED', 'DEPARTMENT_VERSION', input.departmentVersionId, input.governanceObjectId, {
      departmentVersionId: input.departmentVersionId,
      workflowInstanceId: input.workflowInstanceId,
    }),
    departmentReviewed: (input) => record('DEPARTMENT_REVIEWED', 'DEPARTMENT_VERSION', input.departmentVersionId, input.governanceObjectId, {
      reviewResult: input.reviewResult,
      reviewer: input.reviewer,
      reason: input.reason,
    }),
    departmentApproved: (input) => record('DEPARTMENT_APPROVED', 'DEPARTMENT_VERSION', input.departmentVersionId, input.governanceObjectId, {
      approver: input.approver,
    }),
    departmentPublished: (input) => record('DEPARTMENT_PUBLISHED', 'DEPARTMENT_VERSION', input.departmentVersionId, input.governanceObjectId, {
      departmentVersionId: input.departmentVersionId,
      releaseId: input.releaseId,
      publishedAt: input.publishedAt,
    }, input.contentHash),
    hierarchyViewCreated: (input) => record('DEPARTMENT_HIERARCHY_VIEW_CREATED', 'DEPARTMENT_HIERARCHY_VIEW', input.viewId, input.governanceObjectId, {
      viewId: input.viewId,
      viewType: input.viewType,
    }),
    hierarchyVersionCreated: (input) => record('DEPARTMENT_HIERARCHY_VERSION_CREATED', 'DEPARTMENT_HIERARCHY_VIEW_VERSION', input.viewVersionId, input.governanceObjectId, {
      viewVersionId: input.viewVersionId,
      contentHash: input.contentHash.toString('hex'),
    }, input.contentHash),
    hierarchyPublished: (input) => record('DEPARTMENT_HIERARCHY_PUBLISHED', 'DEPARTMENT_HIERARCHY_VIEW_VERSION', input.viewVersionId, input.governanceObjectId, {
      viewVersionId: input.viewVersionId,
      releaseId: input.releaseId,
    }, input.contentHash),
    nodeMoved: (input) => record('DEPARTMENT_NODE_MOVED', 'DEPARTMENT_HIERARCHY_VIEW_VERSION', input.viewVersionId, input.governanceObjectId, {
      departmentId: input.departmentId,
      oldParentNodeId: input.oldParentNodeId,
      newParentNodeId: input.newParentNodeId,
      hierarchyViewType: input.hierarchyViewType,
    }),
    sourceMappingCreated: (input) => record('DEPARTMENT_SOURCE_MAPPING_CREATED', 'DEPARTMENT_SOURCE_MAPPING', input.mappingId, input.governanceObjectId, {
      sourceSystem: input.sourceSystem,
      sourceCode: input.sourceCode,
      departmentId: input.departmentId,
    }),
    sourceMappingConfirmed: (input) => record('DEPARTMENT_SOURCE_MAPPING_CONFIRMED', 'DEPARTMENT_SOURCE_MAPPING', input.mappingId, input.governanceObjectId, {
      mappingId: input.mappingId,
      operator: input.operator,
    }),
    sourceMappingRejected: (input) => record('DEPARTMENT_SOURCE_MAPPING_REJECTED', 'DEPARTMENT_SOURCE_MAPPING', input.mappingId, input.governanceObjectId, {
      mappingId: input.mappingId,
      reason: input.reason,
    }),
    campusAssigned: (input) => record('DEPARTMENT_CAMPUS_ASSIGNED', 'DEPARTMENT_CAMPUS_ASSIGNMENT', input.assignmentId, input.governanceObjectId, {
      departmentId: input.departmentId,
      campusId: input.campusId,
    }, input.contentHash),
    campusChanged: (input) => record('DEPARTMENT_CAMPUS_CHANGED', 'DEPARTMENT_CAMPUS_ASSIGNMENT', input.assignmentId, input.governanceObjectId, {
      oldAssignment: input.oldAssignment,
      newAssignment: input.newAssignment,
    }, input.contentHash),
  };
}
