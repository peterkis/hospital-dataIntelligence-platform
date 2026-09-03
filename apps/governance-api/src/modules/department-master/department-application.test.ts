import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowApplication } from '../workflow/index.js';
import type { TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import {
  createDepartmentGovernanceApplication,
  mapDepartmentApplicationError,
  type DepartmentApplicationQueryService,
  type DepartmentApplicationScope,
} from './application.js';
import { departmentDtoLocalDateTime } from './department-contracts.js';
import type { DepartmentPublishedReadModel } from './read-model.js';
import type { DepartmentVersion } from './index.js';

const governanceObjectId = '74000000-0000-7000-8000-000000000001';
const departmentId = '72000000-0000-7000-8000-000000000101';
const departmentVersionId = '72100000-0000-7000-8000-000000000101';
const governanceRequestId = '76000000-0000-7000-8000-000000000101';
const releaseId = '75000000-0000-7000-8000-000000000101';
const contentHash = 'ab'.repeat(32);
const localDateTime = departmentDtoLocalDateTime('2026-09-03T22:00:00');
const context = {
  actorPrincipalId: '70000000-0000-7000-8000-000000000001',
  requestId: 'PV005A4-UNIT-REQUEST',
  correlationId: 'PV005A4-UNIT',
  occurredAt: localDateTime,
};

const version: DepartmentVersion = {
  id: departmentVersionId,
  departmentId,
  versionNo: '1',
  standardName: 'PROTOTYPE SYNTHETIC UNIT DEPARTMENT',
  shortName: 'SYNTHETIC',
  departmentType: 'CLINICAL',
  clinicalFlag: true,
  managementFlag: false,
  subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
  businessStatus: 'ACTIVE',
  governanceStatus: 'DRAFT',
  description: null,
  businessValidFrom: localDateTime,
  businessValidTo: null,
  recordedFrom: localDateTime,
  recordedTo: null,
  releaseId: null,
  contentHash: Buffer.from(contentHash, 'hex'),
};

const request = {
  changeRequestId: governanceRequestId,
  governanceObjectId,
  stableEntityId: departmentId,
  entityVersionId: departmentVersionId,
  changeKind: 'INITIAL_PUBLICATION',
  riskClassification: 'NORMAL' as const,
  approvalTemplateVersionId: '00000000-0000-7000-8000-000000000061',
  submittedContentHash: Buffer.from(contentHash, 'hex'),
  submittedBy: context.actorPrincipalId,
  changeReason: 'PROTOTYPE SYNTHETIC UNIT CHANGE',
  frozenEvidence: { entityType: 'DEPARTMENT_VERSION' },
  requestStatus: 'SUBMITTED',
  requiredStageCount: 2,
  nextActionSequence: '1',
};

const publishedModel: DepartmentPublishedReadModel = {
  departmentId,
  departmentCode: 'PV005A4-UNIT',
  standardName: version.standardName,
  shortName: version.shortName,
  departmentType: version.departmentType,
  subjectMappingApplicability: version.subjectMappingApplicability,
  lifecycleStatus: version.businessStatus,
  campuses: [
    {
      campusId: '71000000-0000-7000-8000-000000000001',
      campusCode: 'SYNTHETIC',
      campusName: 'PROTOTYPE SYNTHETIC CAMPUS',
    },
  ],
  hierarchyViews: [
    {
      viewType: 'ADMINISTRATIVE',
      hierarchyPath: [
        {
          nodeId: '73000000-0000-7000-8000-000000000101',
          displayName: 'SYNTHETIC ROOT',
        },
      ],
    },
  ],
  sourceMappings: [
    {
      sourceSystem: 'HIS',
      sourceCode: 'SYNTHETIC-UNIT',
      sourceName: 'PROTOTYPE SYNTHETIC UNIT',
      mappingStatus: 'CONFIRMED',
    },
  ],
  qualityScore: '100.00',
  completenessScore: '100.00',
  uniquenessScore: '100.00',
  standardizationScore: '100.00',
  publishedReleaseId: releaseId,
  publishedAt: localDateTime,
  contentHash,
  versionNo: '1',
  businessValidFrom: localDateTime,
  businessValidTo: null,
};

describe('department application contract - controlled dependencies', () => {
  it('dispatches CreateDepartmentDraft and binds the trusted RequestContext', async () => {
    const harness = createHarness();
    const command = createDraftCommand();

    const result = await harness.application.execute(command);

    expect(result).toMatchObject({ status: 'DRAFT', contentHash });
    expect(command).not.toHaveProperty('actorId');
    expect(harness.scope.authorization.requireObjectPermission).toHaveBeenCalledWith({
      governanceObjectId,
      permissionCode: 'DEPARTMENT_MASTER_DRAFT_WRITE',
    });
    expect(harness.scope.departmentMaster.createDepartment).toHaveBeenCalledWith(
      expect.objectContaining({
        departmentCode: 'PV005A4-UNIT',
        actorPrincipalId: context.actorPrincipalId,
        recordedFrom: context.occurredAt,
        clinicalFlag: true,
        managementFlag: false,
      }),
    );
  });

  it('validates the complete CreateDepartmentDraft content at runtime', async () => {
    const harness = createHarness();
    const invalidDepartmentType = {
      ...createDraftCommand(),
      content: { ...createDraftCommand().content, departmentType: 'UNKNOWN' },
    };
    await expect(harness.application.execute(invalidDepartmentType as never))
      .rejects.toMatchObject({ code: 'DEPARTMENT_STATUS_INVALID' });

    const invalidLocalDateTime = {
      ...createDraftCommand(),
      content: { ...createDraftCommand().content, businessValidFrom: '2026-09-03T22:00:00Z' },
    };
    await expect(harness.application.execute(invalidLocalDateTime as never))
      .rejects.toMatchObject({ code: 'DEPARTMENT_STATUS_INVALID' });
    expect(harness.scope.departmentMaster.createDepartment).not.toHaveBeenCalled();
  });

  it('delegates Submit, Review, and Approve to WorkflowApplication', async () => {
    const harness = createHarness();
    const submitted = await harness.application.execute({
      commandName: 'SubmitDepartmentGovernance',
      governanceObjectId,
      departmentId,
      departmentVersionId,
      expectedContentHash: contentHash,
      changeReason: 'PROTOTYPE SYNTHETIC UNIT CHANGE',
    });
    expect(submitted.status).toBe('SUBMITTED');
    expect(harness.workflowApplication.submit).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        entityType: 'DEPARTMENT_VERSION',
        stableEntityId: departmentId,
        entityVersionId: departmentVersionId,
        submittedContentDigest: contentHash,
        frozenEvidence: expect.objectContaining({
          departmentCode: 'PV005A4-UNIT',
          contentHash,
          changeReason: 'PROTOTYPE SYNTHETIC UNIT CHANGE',
          subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
        }),
      }),
    );

    harness.workflowApplication.act.mockResolvedValueOnce({
      request: {
        ...request,
        requestStatus: 'AWAITING_FINAL',
        nextActionSequence: '2',
      },
      publication: null,
    });
    const reviewed = await harness.application.execute({
      commandName: 'ReviewDepartment',
      governanceObjectId,
      governanceRequestId,
      departmentId,
      departmentVersionId,
      seenContentHash: contentHash,
      decision: 'APPROVED',
      reason: 'PROTOTYPE SYNTHETIC UNIT REVIEW',
    });
    expect(reviewed.status).toBe('AWAITING_FINAL');
    expect(harness.workflowApplication.act).toHaveBeenLastCalledWith(
      context,
      expect.objectContaining({ stageType: 'PROFESSIONAL_REVIEW' }),
    );

    harness.workflowApplication.act.mockResolvedValueOnce({
      request: {
        ...request,
        requestStatus: 'REJECTED',
        nextActionSequence: '3',
      },
      publication: null,
    });
    const rejected = await harness.application.execute({
      commandName: 'ApproveDepartment',
      governanceObjectId,
      governanceRequestId,
      departmentId,
      departmentVersionId,
      seenContentHash: contentHash,
      decision: 'REJECTED',
      reason: 'PROTOTYPE SYNTHETIC UNIT OWNER REJECTION',
    });
    expect(rejected.status).toBe('REJECTED');
    expect(harness.workflowApplication.act).toHaveBeenLastCalledWith(
      context,
      expect.objectContaining({ stageType: 'OWNER_FINAL_APPROVAL' }),
    );
  });

  it('maps known internal errors and rethrows unknown errors', async () => {
    const harness = createHarness();
    harness.workflowApplication.act.mockRejectedValueOnce(new Error('APPROVAL_CONTENT_DRIFT'));
    await expect(
      harness.application.execute({
        commandName: 'ReviewDepartment',
        governanceObjectId,
        governanceRequestId,
        departmentId,
        departmentVersionId,
        seenContentHash: contentHash,
        decision: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC UNIT REVIEW',
      }),
    ).rejects.toMatchObject({ code: 'DEPARTMENT_CONTENT_CHANGED' });

    harness.workflowApplication.act.mockRejectedValueOnce(new Error('UNEXPECTED_INTERNAL_FAILURE'));
    await expect(
      harness.application.execute({
        commandName: 'ReviewDepartment',
        governanceObjectId,
        governanceRequestId,
        departmentId,
        departmentVersionId,
        seenContentHash: contentHash,
        decision: 'APPROVED',
        reason: 'PROTOTYPE SYNTHETIC UNIT REVIEW',
      }),
    ).rejects.toThrowError('UNEXPECTED_INTERNAL_FAILURE');

    const mappings = new Map([
      ['OBJECT_PERMISSION_FORBIDDEN', 'DEPARTMENT_PERMISSION_DENIED'],
      ['APPROVAL_CONTENT_DRIFT', 'DEPARTMENT_CONTENT_CHANGED'],
      ['DEPARTMENT_NOT_FOUND', 'DEPARTMENT_NOT_FOUND'],
      ['DEPARTMENT_VERSION_NOT_FOUND', 'DEPARTMENT_VERSION_NOT_FOUND'],
      ['CHANGE_REQUEST_NOT_FOUND', 'DEPARTMENT_STATUS_INVALID'],
      ['APPROVAL_STAGE_ORDER_CONFLICT', 'DEPARTMENT_STATUS_INVALID'],
      ['DEPARTMENT_EVOLUTION_RELATION_REQUIRED', 'DEPARTMENT_EVOLUTION_RELATION_REQUIRED'],
    ]);
    for (const [internal, contract] of mappings) {
      try {
        mapDepartmentApplicationError(new Error(internal));
        throw new Error('EXPECTED_DEPARTMENT_CONTRACT_ERROR');
      } catch (error) {
        expect(error).toMatchObject({ code: contract });
      }
    }
  });

  it('delegates all six published queries to DepartmentQueryService read models', async () => {
    const harness = createHarness();

    await expect(
      harness.application.listPublishedDepartments({ governanceObjectId }),
    ).resolves.toHaveLength(1);
    await expect(
      harness.application.getPublishedDepartment({
        governanceObjectId,
        departmentId,
      }),
    ).resolves.toMatchObject({ departmentId, publishedAt: localDateTime });
    await expect(
      harness.application.getDepartmentHistory({
        governanceObjectId,
        departmentId,
        asOf: localDateTime,
      }),
    ).resolves.toMatchObject({ departmentId, versionNo: '1' });
    await expect(
      harness.application.getDepartmentHierarchy({
        governanceObjectId,
        viewType: 'ADMINISTRATIVE',
      }),
    ).resolves.toHaveLength(1);
    await expect(
      harness.application.getDepartmentSourceMappings({
        governanceObjectId,
        departmentId,
      }),
    ).resolves.toEqual(publishedModel.sourceMappings);
    await expect(
      harness.application.getDepartmentQuality({
        governanceObjectId,
        departmentId,
      }),
    ).resolves.toMatchObject({ departmentId, qualityScore: '100.00' });

    expect(harness.queryService.findPublishedDepartments).toHaveBeenCalledWith(
      undefined,
      governanceObjectId,
    );
    expect(harness.queryService.getPublishedDepartment).toHaveBeenCalledWith(
      departmentId,
      governanceObjectId,
    );
    expect(
      JSON.stringify(
        await harness.application.getPublishedDepartment({
          governanceObjectId,
          departmentId,
        }),
      ),
    ).not.toMatch(/workflow|department_version|published_projection|DATABASE_URL|password/iu);
  });

  it('treats PublishDepartment as an idempotent postcondition read with no second workflow action', async () => {
    const harness = createHarness({ published: true });
    const command = {
      commandName: 'PublishDepartment' as const,
      governanceObjectId,
      governanceRequestId,
      departmentId,
      departmentVersionId,
      approvedContentHash: contentHash,
    };

    await expect(harness.application.execute(command)).resolves.toMatchObject({
      status: 'PUBLISHED',
    });
    await expect(harness.application.execute(command)).resolves.toMatchObject({
      status: 'PUBLISHED',
    });

    expect(harness.workflowApplication.act).not.toHaveBeenCalled();
    expect(harness.scope.departmentMaster.getPublishedDepartmentProjection).toHaveBeenCalledTimes(
      2,
    );
    expect(harness.scope.authorization.requireObjectPermission).toHaveBeenCalledWith({
      governanceObjectId,
      permissionCode: 'DEPARTMENT_MASTER_PUBLISH',
    });

    harness.scope.workflow.getChangeRequest.mockResolvedValueOnce(null);
    await expect(harness.application.execute({
      ...command,
      governanceRequestId: '76000000-0000-7000-8000-000000000999',
    })).rejects.toMatchObject({ code: 'DEPARTMENT_STATUS_INVALID' });
  });

  it('uses REVIEW to confirm a pending source mapping and rejects a terminal mapping', async () => {
    const harness = createHarness();
    const command = {
      commandName: 'ConfirmSourceMapping' as const,
      governanceObjectId,
      departmentId,
      mappingId: '72300000-0000-7000-8000-000000000101',
    };
    await expect(harness.application.execute(command)).resolves.toMatchObject({
      status: 'DRAFT',
    });
    expect(harness.scope.authorization.requireObjectPermission).toHaveBeenCalledWith({
      governanceObjectId,
      permissionCode: 'DEPARTMENT_MASTER_REVIEW',
    });

    harness.scope.departmentMaster.listSourceMappings.mockResolvedValueOnce([
      {
        id: command.mappingId,
        departmentId,
        sourceSystem: 'HIS',
        sourceDepartmentCode: 'SYNTHETIC-UNIT',
        sourceDepartmentName: 'PROTOTYPE SYNTHETIC UNIT',
        matchMethod: 'MANUAL',
        mappingStatus: 'CONFIRMED',
      },
    ]);
    await expect(harness.application.execute(command)).rejects.toMatchObject({
      code: 'DEPARTMENT_STATUS_INVALID',
    });
  });
});

describe('department application contract - real PostgreSQL production composition', () => {
  it('runs the complete external PostgreSQL application probe', () => {
    const npmCli = process.env['npm_execpath'];
    expect(npmCli).toBeTruthy();
    const root = resolve(import.meta.dirname, '../../../../..');
    const result = spawnSync(
      process.execPath,
      [npmCli!, 'run', 'prototype:department:application'],
      { cwd: root, encoding: 'utf8', timeout: 120_000 },
    );
    const output = `${result.stdout}${result.stderr}`;

    expect(output).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL=|password=/iu);
    expect(result.status, output).toBe(0);
    expect(output).toContain('"scenario":"PV-005-A.4-R1"');
    expect(output).toContain('"completeSuccessChain":true');
    expect(output).toContain('"missingPublishRollsBackApproval":true');
    expect(output).toContain('"projectionFailureRollsBackAll":true');
    expect(output).toContain('"auditFailureRollsBackAll":true');
  }, 130_000);
});

function createHarness(options: { readonly published?: boolean } = {}) {
  const currentVersion = options.published
    ? { ...version, governanceStatus: 'PUBLISHED' as const, releaseId }
    : version;
  const currentRequest = options.published
    ? { ...request, requestStatus: 'APPROVED', nextActionSequence: '3' }
    : request;
  const scope = {
    authorization: {
      requireObjectPermission: vi.fn().mockResolvedValue(undefined),
    },
    departmentMaster: {
      createDepartment: vi.fn().mockResolvedValue(version),
      getDepartmentIdentity: vi.fn().mockResolvedValue({
        id: departmentId,
        governanceObjectId,
        departmentCode: 'PV005A4-UNIT',
      }),
      getDepartmentVersion: vi.fn().mockResolvedValue(currentVersion),
      listDepartmentVersions: vi.fn().mockResolvedValue([currentVersion]),
      recordDepartmentCampusAssignment: vi.fn().mockResolvedValue({
        id: '72500000-0000-7000-8000-000000000101',
        departmentId,
        campusId: '71000000-0000-7000-8000-000000000001',
        businessValidFrom: localDateTime,
        businessValidTo: null,
        recordedFrom: localDateTime,
        recordedTo: null,
        contentHash: Buffer.from('cd'.repeat(32), 'hex'),
      }),
      listDepartmentCampusAssignments: vi.fn().mockResolvedValue([
        {
          id: '72500000-0000-7000-8000-000000000101',
          departmentId,
          campusId: '71000000-0000-7000-8000-000000000001',
          businessValidFrom: localDateTime,
          businessValidTo: null,
          recordedFrom: localDateTime,
          recordedTo: null,
          contentHash: Buffer.from('cd'.repeat(32), 'hex'),
        },
      ]),
      getPublishedDepartmentProjection: vi.fn().mockResolvedValue(
        options.published
          ? {
              id: '72600000-0000-7000-8000-000000000101',
              departmentId,
              departmentVersionId,
              departmentCode: 'PV005A4-UNIT',
              standardName: version.standardName,
              departmentType: version.departmentType,
              subjectMappingApplicability: version.subjectMappingApplicability,
              campuses: [],
              hierarchies: {},
              qualityScore: null,
              publishedReleaseId: releaseId,
              publishedAt: localDateTime,
              supersededAt: null,
              contentHash: Buffer.from(contentHash, 'hex'),
              createdAt: localDateTime,
            }
          : null,
      ),
      listSourceMappings: vi.fn().mockResolvedValue([
        {
          id: '72300000-0000-7000-8000-000000000101',
          departmentId,
          sourceSystem: 'HIS',
          sourceDepartmentCode: 'SYNTHETIC-UNIT',
          sourceDepartmentName: 'PROTOTYPE SYNTHETIC UNIT',
          matchMethod: 'MANUAL',
          mappingStatus: 'PENDING',
        },
      ]),
      confirmSourceMapping: vi.fn().mockResolvedValue({
        id: '72300000-0000-7000-8000-000000000101',
        departmentId,
        sourceSystem: 'HIS',
        sourceDepartmentCode: 'SYNTHETIC-UNIT',
        sourceDepartmentName: 'PROTOTYPE SYNTHETIC UNIT',
        matchMethod: 'MANUAL',
        mappingStatus: 'CONFIRMED',
      }),
    },
    workflow: {
      getChangeRequest: vi.fn().mockResolvedValue(currentRequest),
      findLatestChangeRequest: vi.fn().mockResolvedValue(options.published ? currentRequest : null),
      findPendingChangeRequests: vi.fn().mockResolvedValue([]),
    },
  } satisfies DepartmentApplicationScope;
  const transactionRunner: TransactionRunner<DepartmentApplicationScope> = {
    run(_requestContext, work) {
      return work(scope);
    },
  };
  const workflowApplication = {
    submit: vi.fn().mockResolvedValue(request),
    get: vi.fn().mockResolvedValue({ request, actions: [] }),
    act: vi.fn().mockResolvedValue({
      request: {
        ...request,
        requestStatus: 'AWAITING_FINAL',
        nextActionSequence: '2',
      },
      publication: null,
    }),
    withdraw: vi.fn().mockResolvedValue({ ...request, requestStatus: 'WITHDRAWN' }),
  } satisfies WorkflowApplication;
  const queryService = {
    getPublishedDepartment: vi.fn().mockResolvedValue(publishedModel),
    findPublishedDepartments: vi.fn().mockResolvedValue([publishedModel]),
    findDepartmentAsOf: vi.fn().mockResolvedValue(publishedModel),
  } satisfies DepartmentApplicationQueryService;
  return {
    scope,
    workflowApplication,
    queryService,
    application: createDepartmentGovernanceApplication({
      context,
      transactionRunner,
      workflowApplication,
      queryService,
    }),
  };
}

function createDraftCommand() {
  return {
    commandName: 'CreateDepartmentDraft' as const,
    governanceObjectId,
    departmentCode: 'PV005A4-UNIT',
    content: {
      standardName: version.standardName,
      shortName: version.shortName,
      departmentType: version.departmentType,
      subjectMappingApplicability: version.subjectMappingApplicability,
      lifecycleStatus: version.businessStatus,
      businessValidFrom: localDateTime,
      businessValidTo: null,
      campusIds: ['71000000-0000-7000-8000-000000000001'],
    },
  };
}
