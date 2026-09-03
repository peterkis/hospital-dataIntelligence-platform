import type {
  RequestContext,
  TransactionRunner,
} from '../../platform/transaction/transaction-runner.js';
import type { AuthorizationModule, ObjectPermissionCode } from '../authorization/index.js';
import type { WorkflowApplication, WorkflowModule } from '../workflow/index.js';
import {
  DepartmentContractError,
  assertDepartmentContentUnchanged,
  departmentDtoLocalDateTime,
  type ApproveDepartmentCommand,
  type ConfirmSourceMappingCommand,
  type CreateDepartmentDraftCommand,
  type DepartmentCommand,
  type DepartmentDetailDTO,
  type DepartmentGovernanceApplicationContract,
  type DepartmentGovernanceStatus,
  type DepartmentGovernanceStatusView,
  type DepartmentHierarchyDTO,
  type DepartmentHistoryDTO,
  type DepartmentQualityDTO,
  type DepartmentReviewQueueItem,
  type DepartmentSummaryDTO,
  type DepartmentVersionDifference,
  type GetDepartmentHierarchyQuery,
  type GetDepartmentHistoryQuery,
  type GetDepartmentQualityQuery,
  type GetDepartmentSourceMappingsQuery,
  type GetPublishedDepartmentQuery,
  type ListPublishedDepartmentsQuery,
  type PublishDepartmentCommand,
  type ReviewDepartmentCommand,
  type SubmitDepartmentGovernanceCommand,
} from './department-contracts.js';
import type { DepartmentMasterModule, DepartmentVersion } from './index.js';
import type {
  DepartmentPublishedReadModel,
  DepartmentQueryService,
  DepartmentSearchCriteria,
} from './read-model.js';

export interface DepartmentApplicationScope {
  readonly authorization: Pick<AuthorizationModule, 'requireObjectPermission'>;
  readonly departmentMaster: Pick<
    DepartmentMasterModule,
    | 'createDepartment'
    | 'getDepartmentIdentity'
    | 'getDepartmentVersion'
    | 'listDepartmentVersions'
    | 'recordDepartmentCampusAssignment'
    | 'listDepartmentCampusAssignments'
    | 'getPublishedDepartmentProjection'
    | 'listSourceMappings'
    | 'confirmSourceMapping'
  >;
  readonly workflow: Pick<
    WorkflowModule,
    'getChangeRequest' | 'findLatestChangeRequest' | 'findPendingChangeRequests'
  >;
}

export interface DepartmentApplicationQueryService {
  getPublishedDepartment(
    id: string,
    governanceObjectId?: string,
  ): ReturnType<DepartmentQueryService['getPublishedDepartment']>;
  findPublishedDepartments(
    criteria?: DepartmentSearchCriteria,
    governanceObjectId?: string,
  ): ReturnType<DepartmentQueryService['findPublishedDepartments']>;
  findDepartmentAsOf(
    id: string,
    localDateTime: string,
    governanceObjectId?: string,
  ): ReturnType<DepartmentQueryService['findDepartmentAsOf']>;
}

export interface CreateDepartmentGovernanceApplicationOptions<
  Scope extends DepartmentApplicationScope,
> {
  readonly context: RequestContext;
  readonly transactionRunner: TransactionRunner<Scope>;
  readonly workflowApplication: WorkflowApplication;
  readonly queryService: DepartmentApplicationQueryService;
}

export function createDepartmentGovernanceApplication<Scope extends DepartmentApplicationScope>(
  options: CreateDepartmentGovernanceApplicationOptions<Scope>,
): DepartmentGovernanceApplicationContract {
  const { context, transactionRunner, workflowApplication, queryService } = options;
  departmentDtoLocalDateTime(context.occurredAt);

  const requirePermission = (governanceObjectId: string, permissionCode: ObjectPermissionCode) =>
    transactionRunner.run(context, async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId,
        permissionCode,
      });
    });

  const application: DepartmentGovernanceApplicationContract = {
    execute(command) {
      return mapDepartmentApplicationErrors(() => executeCommand(command));
    },

    listPublishedDepartments(query) {
      return mapDepartmentApplicationErrors(async () => {
        assertUuid(query.governanceObjectId);
        await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_DRAFT_READ');
        const models = await queryService.findPublishedDepartments(
          query.filter,
          query.governanceObjectId,
        );
        return models.map(toSummaryDto);
      });
    },

    getPublishedDepartment(query) {
      return mapDepartmentApplicationErrors(async () => {
        const model = await getPublishedModel(query);
        return toDetailDto(model);
      });
    },

    getDepartmentHistory(query) {
      return mapDepartmentApplicationErrors(async () => {
        assertUuid(query.governanceObjectId);
        assertUuid(query.departmentId);
        departmentDtoLocalDateTime(query.asOf);
        await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_DRAFT_READ');
        const model = await queryService.findDepartmentAsOf(
          query.departmentId,
          query.asOf,
          query.governanceObjectId,
        );
        if (!model) throw new DepartmentContractError('DEPARTMENT_NOT_FOUND');
        return toHistoryDto(query, model);
      });
    },

    getDepartmentHierarchy(query) {
      return mapDepartmentApplicationErrors(async () => {
        assertUuid(query.governanceObjectId);
        await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_DRAFT_READ');
        const models = await queryService.findPublishedDepartments(
          { hierarchyViewType: query.viewType },
          query.governanceObjectId,
        );
        return models.flatMap((model) =>
          model.hierarchyViews
            .filter((view) => view.viewType === query.viewType)
            .map((view) => toHierarchyDto(model.departmentId, view)),
        );
      });
    },

    getDepartmentSourceMappings(query) {
      return mapDepartmentApplicationErrors(async () => {
        const model = await getPublishedModel(query);
        return model.sourceMappings.map((mapping) => ({ ...mapping }));
      });
    },

    getDepartmentQuality(query) {
      return mapDepartmentApplicationErrors(async () => {
        const model = await getPublishedModel(query);
        return toQualityDto(model);
      });
    },

    getGovernanceStatus(query) {
      return mapDepartmentApplicationErrors(async () => {
        validateDepartmentReference(query);
        await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_DRAFT_READ');
        return transactionRunner.run(context, (modules) =>
          loadGovernanceStatus(modules, query.governanceObjectId, query.departmentId),
        );
      });
    },

    findPendingReviews(query) {
      return mapDepartmentApplicationErrors(async () => {
        assertUuid(query.governanceObjectId);
        await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_REVIEW');
        return transactionRunner.run(context, async (modules) => {
          const entries = await modules.workflow.findPendingChangeRequests({
            governanceObjectId: query.governanceObjectId,
            governedEntityType: 'DEPARTMENT_VERSION',
          });
          const items: DepartmentReviewQueueItem[] = [];
          for (const entry of entries) {
            const identity = await modules.departmentMaster.getDepartmentIdentity({
              governanceObjectId: query.governanceObjectId,
              departmentId: entry.request.stableEntityId,
            });
            const version = await modules.departmentMaster.getDepartmentVersion({
              governanceObjectId: query.governanceObjectId,
              departmentId: entry.request.stableEntityId,
              departmentVersionId: entry.request.entityVersionId,
            });
            items.push({
              governanceObjectId: query.governanceObjectId,
              governanceRequestId: entry.request.changeRequestId,
              departmentId: identity.id,
              departmentVersionId: version.id,
              departmentCode: identity.departmentCode,
              standardName: version.standardName,
              status: pendingStatus(entry.request.requestStatus),
              submittedAt: departmentDtoLocalDateTime(entry.submittedAt),
              contentHash: version.contentHash.toString('hex'),
            });
          }
          return items;
        });
      });
    },

    getVersionDifference(query) {
      return mapDepartmentApplicationErrors(async () => {
        validateDepartmentReference(query);
        await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_REVIEW');
        return transactionRunner.run(context, async (modules) => {
          const versions = await modules.departmentMaster.listDepartmentVersions({
            governanceObjectId: query.governanceObjectId,
            departmentId: query.departmentId,
          });
          const before =
            query.fromVersionNo === null
              ? null
              : versions.find((version) => version.versionNo === query.fromVersionNo);
          const after = versions.find((version) => version.versionNo === query.toVersionNo);
          if (query.fromVersionNo !== null && !before) {
            throw new DepartmentContractError('DEPARTMENT_VERSION_NOT_FOUND');
          }
          if (!after) throw new DepartmentContractError('DEPARTMENT_VERSION_NOT_FOUND');
          return createVersionDifference(query, before ?? null, after);
        });
      });
    },
  };

  return application;

  async function executeCommand(
    command: DepartmentCommand,
  ): Promise<DepartmentGovernanceStatusView> {
    switch (command.commandName) {
      case 'CreateDepartmentDraft':
        return createDraft(command);
      case 'SubmitDepartmentGovernance':
        return submit(command);
      case 'ReviewDepartment':
        return review(command);
      case 'ApproveDepartment':
        return approve(command);
      case 'PublishDepartment':
        return confirmPublishedPostcondition(command);
      case 'ConfirmSourceMapping':
        return confirmMapping(command);
    }
  }

  async function createDraft(
    command: CreateDepartmentDraftCommand,
  ): Promise<DepartmentGovernanceStatusView> {
    validateCreateCommand(command);
    return transactionRunner.run(context, async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId: command.governanceObjectId,
        permissionCode: 'DEPARTMENT_MASTER_DRAFT_WRITE',
      });
      const version = await modules.departmentMaster.createDepartment({
        governanceObjectId: command.governanceObjectId,
        departmentCode: command.departmentCode,
        standardName: command.content.standardName,
        shortName: command.content.shortName,
        departmentType: command.content.departmentType,
        clinicalFlag: command.content.departmentType === 'CLINICAL',
        managementFlag: command.content.departmentType === 'ADMINISTRATIVE',
        subjectMappingApplicability: command.content.subjectMappingApplicability,
        businessStatus: command.content.lifecycleStatus,
        description: null,
        businessValidFrom: command.content.businessValidFrom,
        businessValidTo: command.content.businessValidTo,
        recordedFrom: context.occurredAt,
        actorPrincipalId: context.actorPrincipalId,
      });
      for (const campusId of [...command.content.campusIds].sort()) {
        await modules.departmentMaster.recordDepartmentCampusAssignment({
          governanceObjectId: command.governanceObjectId,
          departmentId: version.departmentId,
          campusId,
          businessValidFrom: command.content.businessValidFrom,
          businessValidTo: command.content.businessValidTo,
          recordedFrom: context.occurredAt,
          actorPrincipalId: context.actorPrincipalId,
        });
      }
      return statusView(command.governanceObjectId, version, null, 'DRAFT');
    });
  }

  async function submit(
    command: SubmitDepartmentGovernanceCommand,
  ): Promise<DepartmentGovernanceStatusView> {
    validateDepartmentReference(command);
    assertUuid(command.departmentVersionId);
    assertDigest(command.expectedContentHash);
    assertReason(command.changeReason);
    const evidence = await transactionRunner.run(context, async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId: command.governanceObjectId,
        permissionCode: 'DEPARTMENT_MASTER_SUBMIT',
      });
      const identity = await modules.departmentMaster.getDepartmentIdentity({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
      });
      const version = await modules.departmentMaster.getDepartmentVersion({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
        departmentVersionId: command.departmentVersionId,
      });
      if (version.governanceStatus !== 'DRAFT') {
        throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
      }
      assertDepartmentContentUnchanged(
        command.expectedContentHash,
        version.contentHash.toString('hex'),
      );
      const assignments = await modules.departmentMaster.listDepartmentCampusAssignments({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
      });
      return {
        departmentCode: identity.departmentCode,
        contentHash: version.contentHash.toString('hex'),
        changeReason: command.changeReason,
        subjectMappingApplicability: version.subjectMappingApplicability,
        campusIds: assignments
          .filter((assignment) => assignment.recordedTo === null)
          .map((assignment) => assignment.campusId)
          .sort(),
      };
    });
    const request = await workflowApplication.submit(context, {
      governanceObjectId: command.governanceObjectId,
      entityType: 'DEPARTMENT_VERSION',
      stableEntityId: command.departmentId,
      entityVersionId: command.departmentVersionId,
      changeKind: 'INITIAL_PUBLICATION',
      riskClassification: 'NORMAL',
      submittedContentDigest: command.expectedContentHash,
      changeReason: command.changeReason,
      campusId: null,
      frozenEvidence: evidence,
    });
    const version = await loadVersion(command);
    return statusView(command.governanceObjectId, version, request.changeRequestId, 'SUBMITTED');
  }

  async function review(command: ReviewDepartmentCommand): Promise<DepartmentGovernanceStatusView> {
    validateWorkflowCommand(command);
    await preflightWorkflowTarget(command, 'DEPARTMENT_MASTER_REVIEW');
    const result = await workflowApplication.act(context, {
      changeRequestId: command.governanceRequestId,
      stageType: 'PROFESSIONAL_REVIEW',
      actionResult: command.decision,
      reason: command.reason,
      seenContentDigest: command.seenContentHash,
      campusId: null,
    });
    const version = await loadVersion(command);
    return statusView(
      command.governanceObjectId,
      version,
      result.request.changeRequestId,
      pendingOrTerminalStatus(result.request.requestStatus),
    );
  }

  async function approve(
    command: ApproveDepartmentCommand,
  ): Promise<DepartmentGovernanceStatusView> {
    validateWorkflowCommand(command);
    await preflightWorkflowTarget(command, 'DEPARTMENT_MASTER_APPROVE');
    const result = await workflowApplication.act(context, {
      changeRequestId: command.governanceRequestId,
      stageType: 'OWNER_FINAL_APPROVAL',
      actionResult: command.decision,
      reason: command.reason,
      seenContentDigest: command.seenContentHash,
      campusId: null,
    });
    if (command.decision === 'APPROVED') {
      if (!result.publication) {
        throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
      }
      return confirmPublishedPostcondition({
        commandName: 'PublishDepartment',
        governanceObjectId: command.governanceObjectId,
        governanceRequestId: command.governanceRequestId,
        departmentId: command.departmentId,
        departmentVersionId: command.departmentVersionId,
        approvedContentHash: command.seenContentHash,
      });
    }
    const version = await loadVersion(command);
    return statusView(
      command.governanceObjectId,
      version,
      result.request.changeRequestId,
      'REJECTED',
    );
  }

  async function confirmPublishedPostcondition(
    command: PublishDepartmentCommand,
  ): Promise<DepartmentGovernanceStatusView> {
    validateDepartmentReference(command);
    assertUuid(command.governanceRequestId);
    assertUuid(command.departmentVersionId);
    assertDigest(command.approvedContentHash);
    return transactionRunner.run(context, async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId: command.governanceObjectId,
        permissionCode: 'DEPARTMENT_MASTER_PUBLISH',
      });
      const request = await modules.workflow.getChangeRequest(command.governanceRequestId);
      if (!request) {
        throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
      }
      if (request.requestStatus !== 'APPROVED') {
        throw new DepartmentContractError('DEPARTMENT_APPROVAL_REQUIRED');
      }
      assertWorkflowTarget(request, command);
      const version = await modules.departmentMaster.getDepartmentVersion({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
        departmentVersionId: command.departmentVersionId,
      });
      const projection = await modules.departmentMaster.getPublishedDepartmentProjection({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
      });
      if (
        version.governanceStatus !== 'PUBLISHED' ||
        version.releaseId === null ||
        projection === null ||
        projection.departmentVersionId !== version.id ||
        projection.publishedReleaseId !== version.releaseId
      ) {
        throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
      }
      const versionHash = version.contentHash.toString('hex');
      assertDepartmentContentUnchanged(command.approvedContentHash, versionHash);
      assertDepartmentContentUnchanged(
        command.approvedContentHash,
        projection.contentHash.toString('hex'),
      );
      assertDepartmentContentUnchanged(
        command.approvedContentHash,
        request.submittedContentHash.toString('hex'),
      );
      return statusView(
        command.governanceObjectId,
        version,
        command.governanceRequestId,
        'PUBLISHED',
      );
    });
  }

  async function confirmMapping(
    command: ConfirmSourceMappingCommand,
  ): Promise<DepartmentGovernanceStatusView> {
    validateDepartmentReference(command);
    assertUuid(command.mappingId);
    return transactionRunner.run(context, async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId: command.governanceObjectId,
        permissionCode: 'DEPARTMENT_MASTER_REVIEW',
      });
      const mappings = await modules.departmentMaster.listSourceMappings({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
      });
      const mapping = mappings.find((candidate) => candidate.id === command.mappingId);
      if (!mapping || mapping.mappingStatus !== 'PENDING') {
        throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
      }
      await modules.departmentMaster.confirmSourceMapping({
        governanceObjectId: command.governanceObjectId,
        mappingId: command.mappingId,
      });
      return loadGovernanceStatus(modules, command.governanceObjectId, command.departmentId);
    });
  }

  async function getPublishedModel(
    query: GetPublishedDepartmentQuery,
  ): Promise<DepartmentPublishedReadModel> {
    validateDepartmentReference(query);
    await requirePermission(query.governanceObjectId, 'DEPARTMENT_MASTER_DRAFT_READ');
    const model = await queryService.getPublishedDepartment(
      query.departmentId,
      query.governanceObjectId,
    );
    if (!model) throw new DepartmentContractError('DEPARTMENT_NOT_FOUND');
    return model;
  }

  async function preflightWorkflowTarget(
    command: ReviewDepartmentCommand | ApproveDepartmentCommand,
    permissionCode: ObjectPermissionCode,
  ): Promise<void> {
    await transactionRunner.run(context, async (modules) => {
      await modules.authorization.requireObjectPermission({
        governanceObjectId: command.governanceObjectId,
        permissionCode,
      });
      const request = await modules.workflow.getChangeRequest(command.governanceRequestId);
      if (!request) throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
      assertWorkflowTarget(request, command);
    });
  }

  async function loadVersion(command: {
    readonly governanceObjectId: string;
    readonly departmentId: string;
    readonly departmentVersionId: string;
  }): Promise<DepartmentVersion> {
    return transactionRunner.run(context, (modules) =>
      modules.departmentMaster.getDepartmentVersion({
        governanceObjectId: command.governanceObjectId,
        departmentId: command.departmentId,
        departmentVersionId: command.departmentVersionId,
      }),
    );
  }
}

export function mapDepartmentApplicationError(error: unknown): never {
  if (error instanceof DepartmentContractError) throw error;
  const message = error instanceof Error ? error.message : '';
  const code = departmentErrorMap[message];
  if (code) throw new DepartmentContractError(code);
  throw error;
}

async function mapDepartmentApplicationErrors<Result>(
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    return mapDepartmentApplicationError(error);
  }
}

const departmentErrorMap: Readonly<Record<string, DepartmentContractError['code']>> = {
  OBJECT_PERMISSION_FORBIDDEN: 'DEPARTMENT_PERMISSION_DENIED',
  APPROVAL_CONTENT_DRIFT: 'DEPARTMENT_CONTENT_CHANGED',
  DEPARTMENT_NOT_FOUND: 'DEPARTMENT_NOT_FOUND',
  DEPARTMENT_VERSION_NOT_FOUND: 'DEPARTMENT_VERSION_NOT_FOUND',
  CHANGE_REQUEST_NOT_FOUND: 'DEPARTMENT_STATUS_INVALID',
  APPROVAL_STAGE_ORDER_CONFLICT: 'DEPARTMENT_STATUS_INVALID',
  APPROVAL_STAGE_NOT_FOUND: 'DEPARTMENT_STATUS_INVALID',
  APPROVAL_REQUEST_TERMINAL: 'DEPARTMENT_STATUS_INVALID',
  APPROVAL_DUTY_SEPARATION_CONFLICT: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_VERSION_IMMUTABLE: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_PUBLICATION_STATE_CONFLICT: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_SOURCE_MAPPING_NOT_FOUND: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_SOURCE_MAPPING_TRANSITION_INVALID: 'DEPARTMENT_STATUS_INVALID',
  LOCAL_DATETIME_INVALID: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_STANDARD_NAME_INVALID: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_BUSINESS_PERIOD_INVALID: 'DEPARTMENT_STATUS_INVALID',
  CLINICAL_DEPARTMENT_CANNOT_BE_EXEMPT: 'DEPARTMENT_STATUS_INVALID',
  MEDICAL_TECHNOLOGY_EXEMPTION_REQUIRES_MEDICAL_TECHNOLOGY_TYPE: 'DEPARTMENT_STATUS_INVALID',
  AUXILIARY_EXEMPTION_REQUIRES_AUXILIARY_TYPE: 'DEPARTMENT_STATUS_INVALID',
  DEPARTMENT_EVOLUTION_RELATION_REQUIRED: 'DEPARTMENT_EVOLUTION_RELATION_REQUIRED',
};

async function loadGovernanceStatus(
  modules: DepartmentApplicationScope,
  governanceObjectId: string,
  departmentId: string,
): Promise<DepartmentGovernanceStatusView> {
  const versions = await modules.departmentMaster.listDepartmentVersions({
    governanceObjectId,
    departmentId,
  });
  const version = versions.at(-1);
  if (!version) throw new DepartmentContractError('DEPARTMENT_VERSION_NOT_FOUND');
  const request = await modules.workflow.findLatestChangeRequest({
    governanceObjectId,
    stableEntityId: departmentId,
    entityVersionId: version.id,
  });
  const status =
    version.governanceStatus === 'PUBLISHED'
      ? 'PUBLISHED'
      : request
        ? pendingOrTerminalStatus(request.requestStatus)
        : 'DRAFT';
  if (status === 'APPROVED') {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
  return statusView(governanceObjectId, version, request?.changeRequestId ?? null, status);
}

function statusView(
  governanceObjectId: string,
  version: DepartmentVersion,
  governanceRequestId: string | null,
  status: DepartmentGovernanceStatus,
): DepartmentGovernanceStatusView {
  return {
    governanceObjectId,
    departmentId: version.departmentId,
    departmentVersionId: version.id,
    governanceRequestId,
    status,
    contentHash: version.contentHash.toString('hex'),
  };
}

function assertWorkflowTarget(
  request: Awaited<ReturnType<WorkflowModule['getChangeRequest']>> & {},
  command: {
    readonly governanceObjectId: string;
    readonly departmentId: string;
    readonly departmentVersionId: string;
  },
): void {
  if (
    request.governanceObjectId !== command.governanceObjectId ||
    request.stableEntityId !== command.departmentId ||
    request.entityVersionId !== command.departmentVersionId ||
    request.frozenEvidence['entityType'] !== 'DEPARTMENT_VERSION'
  ) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
}

function pendingStatus(status: string): DepartmentReviewQueueItem['status'] {
  if (status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'AWAITING_FINAL') {
    return status;
  }
  throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
}

function pendingOrTerminalStatus(status: string): DepartmentGovernanceStatus {
  if (
    status === 'SUBMITTED' ||
    status === 'UNDER_REVIEW' ||
    status === 'AWAITING_FINAL' ||
    status === 'APPROVED' ||
    status === 'REJECTED' ||
    status === 'WITHDRAWN'
  ) {
    return status;
  }
  throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
}

function toSummaryDto(model: DepartmentPublishedReadModel): DepartmentSummaryDTO {
  return {
    departmentId: model.departmentId,
    departmentCode: model.departmentCode,
    standardName: model.standardName,
    shortName: model.shortName,
    departmentType: model.departmentType,
    lifecycleStatus: model.lifecycleStatus,
    campuses: model.campuses.map((campus) => ({ ...campus })),
    publishedAt: departmentDtoLocalDateTime(model.publishedAt),
  };
}

function toDetailDto(model: DepartmentPublishedReadModel): DepartmentDetailDTO {
  return {
    ...toSummaryDto(model),
    subjectMappingApplicability: model.subjectMappingApplicability,
    hierarchyViews: model.hierarchyViews.map((view) => toHierarchyDto(model.departmentId, view)),
    sourceMappings: model.sourceMappings.map((mapping) => ({ ...mapping })),
    quality: toQualityDto(model),
    publishedReleaseId: model.publishedReleaseId,
    contentHash: model.contentHash,
  };
}

function toHistoryDto(
  query: GetDepartmentHistoryQuery,
  model: DepartmentPublishedReadModel,
): DepartmentHistoryDTO {
  return {
    departmentId: model.departmentId,
    versionNo: model.versionNo,
    asOf: departmentDtoLocalDateTime(query.asOf),
    businessValidFrom: departmentDtoLocalDateTime(model.businessValidFrom),
    businessValidTo:
      model.businessValidTo === null ? null : departmentDtoLocalDateTime(model.businessValidTo),
    department: toDetailDto(model),
  };
}

function toHierarchyDto(
  departmentId: string,
  view: DepartmentPublishedReadModel['hierarchyViews'][number],
): DepartmentHierarchyDTO {
  return {
    departmentId,
    viewType: view.viewType,
    hierarchyPath: view.hierarchyPath.map((node) => ({ ...node })),
  };
}

function toQualityDto(model: DepartmentPublishedReadModel): DepartmentQualityDTO {
  return {
    departmentId: model.departmentId,
    qualityScore: model.qualityScore,
    completenessScore: model.completenessScore,
    uniquenessScore: model.uniquenessScore,
    standardizationScore: model.standardizationScore,
  };
}

function createVersionDifference(
  query: GetPublishedDepartmentQuery & {
    readonly fromVersionNo: string | null;
    readonly toVersionNo: string;
  },
  before: DepartmentVersion | null,
  after: DepartmentVersion,
): DepartmentVersionDifference {
  const fields = [
    ['standardName', before?.standardName ?? null, after.standardName],
    ['shortName', before?.shortName ?? null, after.shortName],
    ['departmentType', before?.departmentType ?? null, after.departmentType],
    [
      'subjectMappingApplicability',
      before?.subjectMappingApplicability ?? null,
      after.subjectMappingApplicability,
    ],
    ['lifecycleStatus', before?.businessStatus ?? null, after.businessStatus],
    ['businessValidFrom', before?.businessValidFrom ?? null, after.businessValidFrom],
    ['businessValidTo', before?.businessValidTo ?? null, after.businessValidTo],
  ] as const;
  return {
    governanceObjectId: query.governanceObjectId,
    departmentId: query.departmentId,
    fromVersionNo: query.fromVersionNo,
    toVersionNo: query.toVersionNo,
    differences: fields
      .filter(([, oldValue, newValue]) => oldValue !== newValue)
      .map(([field, oldValue, newValue]) => ({
        field,
        before: oldValue,
        after: newValue,
      })),
  };
}

function validateCreateCommand(command: CreateDepartmentDraftCommand): void {
  assertUuid(command.governanceObjectId);
  if (
    typeof command.departmentCode !== 'string' ||
    typeof command.content !== 'object' ||
    command.content === null ||
    Array.isArray(command.content) ||
    typeof command.content.standardName !== 'string' ||
    (command.content.shortName !== null && typeof command.content.shortName !== 'string') ||
    !departmentTypes.has(command.content.departmentType) ||
    !subjectMappingApplicabilities.has(command.content.subjectMappingApplicability) ||
    !departmentLifecycleStatuses.has(command.content.lifecycleStatus) ||
    typeof command.content.businessValidFrom !== 'string' ||
    (command.content.businessValidTo !== null &&
      typeof command.content.businessValidTo !== 'string') ||
    !Array.isArray(command.content.campusIds) ||
    command.content.campusIds.some((campusId) => typeof campusId !== 'string') ||
    command.departmentCode.length === 0 ||
    command.departmentCode.length > 64 ||
    command.departmentCode.trim() !== command.departmentCode
  ) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
  if (
    command.content.standardName.length === 0 ||
    command.content.standardName.length > 256 ||
    command.content.standardName.trim() !== command.content.standardName ||
    (command.content.shortName !== null && command.content.shortName.length > 128)
  ) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
  departmentDtoLocalDateTime(command.content.businessValidFrom);
  if (command.content.businessValidTo !== null) {
    departmentDtoLocalDateTime(command.content.businessValidTo);
    if (command.content.businessValidTo <= command.content.businessValidFrom) {
      throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
    }
  }
  const campuses = new Set<string>();
  for (const campusId of command.content.campusIds) {
    assertUuid(campusId);
    if (campuses.has(campusId)) {
      throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
    }
    campuses.add(campusId);
  }
}

const departmentTypes = new Set([
  'CLINICAL',
  'MEDICAL_TECHNOLOGY',
  'AUXILIARY',
  'ADMINISTRATIVE',
]);
const subjectMappingApplicabilities = new Set([
  'REQUIRED_OUTPATIENT',
  'REQUIRED_CLINICAL_SERVICE',
  'EXEMPT_MEDICAL_TECHNOLOGY',
  'EXEMPT_AUXILIARY',
  'PENDING_DETERMINATION',
]);
const departmentLifecycleStatuses = new Set([
  'ACTIVE',
  'SUSPENDED',
  'DEPRECATED',
  'SUPERSEDED',
]);

function validateWorkflowCommand(
  command: ReviewDepartmentCommand | ApproveDepartmentCommand,
): void {
  validateDepartmentReference(command);
  assertUuid(command.governanceRequestId);
  assertUuid(command.departmentVersionId);
  assertDigest(command.seenContentHash);
  assertReason(command.reason);
}

function validateDepartmentReference(command: {
  readonly governanceObjectId: string;
  readonly departmentId: string;
}): void {
  assertUuid(command.governanceObjectId);
  assertUuid(command.departmentId);
}

function assertUuid(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value)) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
}

function assertDigest(value: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
}

function assertReason(value: string): void {
  if (value.length === 0 || value.length > 1_000 || value.trim() !== value) {
    throw new DepartmentContractError('DEPARTMENT_STATUS_INVALID');
  }
}
