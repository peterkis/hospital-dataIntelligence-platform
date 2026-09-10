import type { LocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import type {
  DepartmentBusinessStatus,
  DepartmentHierarchyViewType,
  DepartmentSourceMappingStatus,
  DepartmentType,
  SubjectMappingApplicability,
} from './index.js';

declare const departmentDtoLocalDateTimeBrand: unique symbol;

export type DepartmentDtoLocalDateTime = LocalDateTime & {
  readonly [departmentDtoLocalDateTimeBrand]: true;
};

export type DepartmentPermission =
  | 'READ'
  | 'DRAFT_WRITE'
  | 'SUBMIT'
  | 'REVIEW'
  | 'APPROVE'
  | 'PUBLISH';

export type DepartmentErrorCode =
  | 'DEPARTMENT_NOT_FOUND'
  | 'DEPARTMENT_VERSION_NOT_FOUND'
  | 'DEPARTMENT_STATUS_INVALID'
  | 'DEPARTMENT_APPROVAL_REQUIRED'
  | 'DEPARTMENT_PERMISSION_DENIED'
  | 'DEPARTMENT_CONTENT_CHANGED'
  | 'DEPARTMENT_EVOLUTION_RELATION_REQUIRED';

export const DEPARTMENT_CONSUMER_ROLES = [
  'GOVERNANCE_ADMINISTRATOR',
  'BUSINESS_REVIEWER',
  'SYSTEM_CONSUMER',
  'DATA_ANALYST',
] as const;

export type DepartmentConsumerRole = typeof DEPARTMENT_CONSUMER_ROLES[number];

export const DEPARTMENT_QUERY_SCENARIOS = [
  'LIST_PUBLISHED_DEPARTMENTS',
  'GET_PUBLISHED_DEPARTMENT',
  'GET_DEPARTMENT_HISTORY',
  'GET_DEPARTMENT_HIERARCHY',
  'GET_DEPARTMENT_SOURCE_MAPPINGS',
  'GET_DEPARTMENT_QUALITY',
] as const;

export type DepartmentQueryScenario = typeof DEPARTMENT_QUERY_SCENARIOS[number];

export const DEPARTMENT_COMMANDS = [
  'CreateDepartmentDraft',
  'SubmitDepartmentGovernance',
  'ReviewDepartment',
  'ApproveDepartment',
  'PublishDepartment',
  'ConfirmSourceMapping',
] as const;

export type DepartmentCommandName = typeof DEPARTMENT_COMMANDS[number];

export interface DepartmentCampusDTO {
  readonly campusId: string;
  readonly campusCode: string;
  readonly campusName: string;
}

export interface DepartmentHierarchyPathNodeDTO {
  readonly nodeId: string;
  readonly displayName: string;
}

export interface DepartmentSummaryDTO {
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly standardName: string;
  readonly shortName: string | null;
  readonly departmentType: DepartmentType;
  readonly lifecycleStatus: DepartmentBusinessStatus;
  readonly campuses: readonly DepartmentCampusDTO[];
  readonly publishedAt: DepartmentDtoLocalDateTime;
}

export interface DepartmentDetailDTO {
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly standardName: string;
  readonly shortName: string | null;
  readonly departmentType: DepartmentType;
  readonly subjectMappingApplicability: SubjectMappingApplicability;
  readonly lifecycleStatus: DepartmentBusinessStatus;
  readonly campuses: readonly DepartmentCampusDTO[];
  readonly hierarchyViews: readonly DepartmentHierarchyDTO[];
  readonly sourceMappings: readonly DepartmentSourceMappingDTO[];
  readonly quality: DepartmentQualityDTO;
  readonly publishedReleaseId: string;
  readonly publishedAt: DepartmentDtoLocalDateTime;
  readonly contentHash: string;
}

export interface DepartmentHistoryDTO {
  readonly departmentId: string;
  readonly versionNo: string;
  readonly asOf: DepartmentDtoLocalDateTime;
  readonly businessValidFrom: DepartmentDtoLocalDateTime;
  readonly businessValidTo: DepartmentDtoLocalDateTime | null;
  readonly department: DepartmentDetailDTO;
}

export interface DepartmentHierarchyDTO {
  readonly departmentId: string;
  readonly viewType: DepartmentHierarchyViewType;
  readonly hierarchyPath: readonly DepartmentHierarchyPathNodeDTO[];
}

export interface DepartmentSourceMappingDTO {
  readonly sourceSystem: string;
  readonly sourceCode: string;
  readonly sourceName: string;
  readonly mappingStatus: DepartmentSourceMappingStatus;
}

export interface DepartmentQualityDTO {
  readonly departmentId: string;
  readonly qualityScore: string | null;
  readonly completenessScore: string | null;
  readonly uniquenessScore: string | null;
  readonly standardizationScore: string | null;
}

export interface DepartmentPublishedListFilter {
  readonly departmentCode?: string;
  readonly standardName?: string;
  readonly departmentType?: DepartmentType;
  readonly campusId?: string;
}

export interface ListPublishedDepartmentsQuery {
  readonly governanceObjectId: string;
  readonly filter?: DepartmentPublishedListFilter;
}

export interface GetPublishedDepartmentQuery {
  readonly governanceObjectId: string;
  readonly departmentId: string;
}

export interface GetDepartmentHistoryQuery extends GetPublishedDepartmentQuery {
  readonly asOf: DepartmentDtoLocalDateTime;
}

export interface GetDepartmentHierarchyQuery {
  readonly governanceObjectId: string;
  readonly viewType: DepartmentHierarchyViewType;
}

export interface GetDepartmentSourceMappingsQuery extends GetPublishedDepartmentQuery {}

export interface GetDepartmentQualityQuery extends GetPublishedDepartmentQuery {}

export type DepartmentGovernanceStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'AWAITING_FINAL'
  | 'APPROVED'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'WITHDRAWN';

export interface DepartmentGovernanceStatusView {
  readonly governanceObjectId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly governanceRequestId: string | null;
  readonly status: DepartmentGovernanceStatus;
  readonly contentHash: string;
}

export interface DepartmentReviewQueueItem {
  readonly governanceObjectId: string;
  readonly governanceRequestId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly departmentCode: string;
  readonly standardName: string;
  readonly status: 'SUBMITTED' | 'UNDER_REVIEW' | 'AWAITING_FINAL';
  readonly submittedAt: DepartmentDtoLocalDateTime;
  readonly contentHash: string;
}

export type DepartmentComparableField =
  | 'standardName'
  | 'shortName'
  | 'departmentType'
  | 'subjectMappingApplicability'
  | 'lifecycleStatus'
  | 'businessValidFrom'
  | 'businessValidTo';

export interface DepartmentFieldDifference {
  readonly field: DepartmentComparableField;
  readonly before: string | null;
  readonly after: string | null;
}

export interface DepartmentVersionDifference {
  readonly governanceObjectId: string;
  readonly departmentId: string;
  readonly fromVersionNo: string | null;
  readonly toVersionNo: string;
  readonly differences: readonly DepartmentFieldDifference[];
}

export interface DepartmentGovernanceQueryContract {
  listPublishedDepartments(
    query: ListPublishedDepartmentsQuery,
  ): Promise<readonly DepartmentSummaryDTO[]>;
  getPublishedDepartment(
    query: GetPublishedDepartmentQuery,
  ): Promise<DepartmentDetailDTO>;
  getDepartmentHistory(
    query: GetDepartmentHistoryQuery,
  ): Promise<DepartmentHistoryDTO>;
  getDepartmentHierarchy(
    query: GetDepartmentHierarchyQuery,
  ): Promise<readonly DepartmentHierarchyDTO[]>;
  getDepartmentSourceMappings(
    query: GetDepartmentSourceMappingsQuery,
  ): Promise<readonly DepartmentSourceMappingDTO[]>;
  getDepartmentQuality(
    query: GetDepartmentQualityQuery,
  ): Promise<DepartmentQualityDTO>;
  getGovernanceStatus(
    query: GetPublishedDepartmentQuery,
  ): Promise<DepartmentGovernanceStatusView>;
  findPendingReviews(
    query: { readonly governanceObjectId: string },
  ): Promise<readonly DepartmentReviewQueueItem[]>;
  getVersionDifference(
    query: GetPublishedDepartmentQuery & {
      readonly fromVersionNo: string | null;
      readonly toVersionNo: string;
    },
  ): Promise<DepartmentVersionDifference>;
}

export interface DepartmentDraftContent {
  readonly standardName: string;
  readonly shortName: string | null;
  readonly departmentType: DepartmentType;
  readonly subjectMappingApplicability: SubjectMappingApplicability;
  readonly lifecycleStatus: DepartmentBusinessStatus;
  readonly businessValidFrom: DepartmentDtoLocalDateTime;
  readonly businessValidTo: DepartmentDtoLocalDateTime | null;
  readonly campusIds: readonly string[];
}

export interface CreateDepartmentDraftCommand {
  readonly commandName: 'CreateDepartmentDraft';
  readonly governanceObjectId: string;
  readonly departmentCode: string;
  readonly content: DepartmentDraftContent;
}

export interface SubmitDepartmentGovernanceCommand {
  readonly commandName: 'SubmitDepartmentGovernance';
  readonly governanceObjectId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly expectedContentHash: string;
  readonly changeReason: string;
}

export interface ReviewDepartmentCommand {
  readonly commandName: 'ReviewDepartment';
  readonly governanceObjectId: string;
  readonly governanceRequestId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly seenContentHash: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reason: string;
}

export interface ApproveDepartmentCommand {
  readonly commandName: 'ApproveDepartment';
  readonly governanceObjectId: string;
  readonly governanceRequestId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly seenContentHash: string;
  readonly decision: 'APPROVED' | 'REJECTED';
  readonly reason: string;
}

export interface PublishDepartmentCommand {
  readonly commandName: 'PublishDepartment';
  readonly governanceObjectId: string;
  readonly governanceRequestId: string;
  readonly departmentId: string;
  readonly departmentVersionId: string;
  readonly approvedContentHash: string;
}

export interface ConfirmSourceMappingCommand {
  readonly commandName: 'ConfirmSourceMapping';
  readonly governanceObjectId: string;
  readonly departmentId: string;
  readonly mappingId: string;
}

export type DepartmentCommand =
  | CreateDepartmentDraftCommand
  | SubmitDepartmentGovernanceCommand
  | ReviewDepartmentCommand
  | ApproveDepartmentCommand
  | PublishDepartmentCommand
  | ConfirmSourceMappingCommand;

export interface DepartmentGovernanceCommandContract {
  execute(command: DepartmentCommand): Promise<DepartmentGovernanceStatusView>;
}

export interface DepartmentGovernanceApplicationContract
  extends DepartmentGovernanceQueryContract, DepartmentGovernanceCommandContract {}

export interface DepartmentPermissionBinding {
  readonly governanceObjectId: string;
  readonly permissions: ReadonlySet<DepartmentPermission>;
}

export class DepartmentContractError extends Error {
  constructor(readonly code: DepartmentErrorCode) {
    super(code);
    this.name = 'DepartmentContractError';
  }
}

export function departmentDtoLocalDateTime(value: string): DepartmentDtoLocalDateTime {
  parseLocalDateTime(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(value)) {
    throw new Error('LOCAL_DATETIME_INVALID');
  }
  return value as DepartmentDtoLocalDateTime;
}

export function assertDepartmentPermission(
  binding: DepartmentPermissionBinding,
  governanceObjectId: string,
  permission: DepartmentPermission,
): void {
  if (
    binding.governanceObjectId !== governanceObjectId
    || !binding.permissions.has(permission)
  ) {
    throw new DepartmentContractError('DEPARTMENT_PERMISSION_DENIED');
  }
}

type StatusCheckedCommand = Exclude<DepartmentCommandName, 'CreateDepartmentDraft'>;

const allowedCommandStatuses: Readonly<Record<StatusCheckedCommand, readonly string[]>> = {
  SubmitDepartmentGovernance: ['DRAFT'],
  ReviewDepartment: ['SUBMITTED', 'UNDER_REVIEW'],
  ApproveDepartment: ['AWAITING_FINAL'],
  PublishDepartment: ['APPROVED'],
  ConfirmSourceMapping: ['PENDING'],
};

export function assertDepartmentCommandStatus(
  commandName: StatusCheckedCommand,
  currentStatus: DepartmentGovernanceStatus | DepartmentSourceMappingStatus,
): void {
  if (!allowedCommandStatuses[commandName].includes(currentStatus)) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
}

export function assertDepartmentApprovalForPublication(
  currentStatus: DepartmentGovernanceStatus,
): void {
  if (currentStatus !== 'APPROVED') {
    throw new DepartmentContractError('DEPARTMENT_APPROVAL_REQUIRED');
  }
}

export function assertDepartmentContentUnchanged(
  expectedContentHash: string,
  actualContentHash: string,
): void {
  if (expectedContentHash !== actualContentHash) {
    throw new DepartmentContractError('DEPARTMENT_CONTENT_CHANGED');
  }
}

export function requiredDepartmentPermission(
  commandName: DepartmentCommandName,
): DepartmentPermission {
  switch (commandName) {
    case 'CreateDepartmentDraft': return 'DRAFT_WRITE';
    case 'SubmitDepartmentGovernance': return 'SUBMIT';
    case 'ReviewDepartment': return 'REVIEW';
    case 'ApproveDepartment': return 'APPROVE';
    case 'PublishDepartment': return 'PUBLISH';
    case 'ConfirmSourceMapping': return 'REVIEW';
  }
}
