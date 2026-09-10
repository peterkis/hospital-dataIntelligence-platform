import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_COMMANDS,
  DepartmentContractError,
  assertDepartmentCommandStatus,
  assertDepartmentContentUnchanged,
  assertDepartmentPermission,
  departmentDtoLocalDateTime,
  requiredDepartmentPermission,
  type DepartmentDetailDTO,
  type DepartmentHistoryDTO,
  type DepartmentPermissionBinding,
} from './department-contracts.js';

const governanceObjectId = '74000000-0000-7000-8000-000000000001';
const departmentId = '72000000-0000-7000-8000-000000000001';

describe('department governance application contract', () => {
  it('does not expose database fields or workflow details through published DTOs', () => {
    const serialized = JSON.stringify(detailDto());

    for (const forbidden of [
      'created_at',
      'recorded_to',
      'internal_version_id',
      'workflowInstanceId',
      'governanceRequestId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('accepts only whole-second Asia/Shanghai local date-times in DTOs', () => {
    expect(departmentDtoLocalDateTime('2026-09-03T16:00:00'))
      .toBe('2026-09-03T16:00:00');
    for (const invalid of [
      '2026-09-03T16:00:00.123456',
      '2026-09-03T08:00:00Z',
      '2026-09-03T16:00:00+08:00',
      '2026-02-30T16:00:00',
    ]) {
      expect(() => departmentDtoLocalDateTime(invalid)).toThrowError('LOCAL_DATETIME_INVALID');
    }
  });

  it('represents a historical version at the requested business time', () => {
    const detail = detailDto();
    const history: DepartmentHistoryDTO = {
      departmentId,
      versionNo: '2',
      asOf: departmentDtoLocalDateTime('2025-01-01T12:00:00'),
      businessValidFrom: departmentDtoLocalDateTime('2025-01-01T00:00:00'),
      businessValidTo: departmentDtoLocalDateTime('2026-01-01T00:00:00'),
      department: { ...detail, standardName: '历史呼吸科' },
    };

    expect(history).toMatchObject({
      departmentId,
      versionNo: '2',
      asOf: '2025-01-01T12:00:00',
      department: { standardName: '历史呼吸科' },
    });
  });

  it('fails closed when permission is absent or bound to another governance object', () => {
    const binding: DepartmentPermissionBinding = {
      governanceObjectId,
      permissions: new Set(['READ']),
    };

    expectContractError(
      () => assertDepartmentPermission(binding, governanceObjectId, 'APPROVE'),
      'DEPARTMENT_PERMISSION_DENIED',
    );
    expectContractError(
      () => assertDepartmentPermission(binding, '74000000-0000-7000-8000-000000000099', 'READ'),
      'DEPARTMENT_PERMISSION_DENIED',
    );
  });

  it('fails closed when a command is not legal in the current status', () => {
    expectContractError(
      () => assertDepartmentCommandStatus('ReviewDepartment', 'DRAFT'),
      'DEPARTMENT_STATUS_INVALID',
    );
    expect(() => assertDepartmentCommandStatus('ReviewDepartment', 'SUBMITTED')).not.toThrow();
  });

  it('fails closed when reviewed content has drifted', () => {
    expectContractError(
      () => assertDepartmentContentUnchanged('aa'.repeat(32), 'bb'.repeat(32)),
      'DEPARTMENT_CONTENT_CHANGED',
    );
    expect(() => assertDepartmentContentUnchanged('aa'.repeat(32), 'aa'.repeat(32)))
      .not.toThrow();
  });

  it('freezes the command allowlist and its permission mapping', () => {
    expect(DEPARTMENT_COMMANDS).toEqual([
      'CreateDepartmentDraft',
      'SubmitDepartmentGovernance',
      'ReviewDepartment',
      'ApproveDepartment',
      'PublishDepartment',
      'ConfirmSourceMapping',
    ]);
    expect(DEPARTMENT_COMMANDS.map(requiredDepartmentPermission)).toEqual([
      'DRAFT_WRITE',
      'SUBMIT',
      'REVIEW',
      'APPROVE',
      'PUBLISH',
      'REVIEW',
    ]);
  });
});

function detailDto(): DepartmentDetailDTO {
  return {
    departmentId,
    departmentCode: 'DEP-00001',
    standardName: '呼吸与危重症医学科',
    shortName: '呼吸科',
    departmentType: 'CLINICAL',
    subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
    lifecycleStatus: 'ACTIVE',
    campuses: [{
      campusId: '71000000-0000-7000-8000-000000000001',
      campusCode: 'MAIN',
      campusName: '总部院区',
    }],
    hierarchyViews: [{
      departmentId,
      viewType: 'ADMINISTRATIVE',
      hierarchyPath: [
        { nodeId: '73000000-0000-7000-8000-000000000001', displayName: '医疗系统' },
        { nodeId: '73000000-0000-7000-8000-000000000002', displayName: '内科' },
        { nodeId: '73000000-0000-7000-8000-000000000003', displayName: '呼吸与危重症医学科' },
      ],
    }],
    sourceMappings: [{
      sourceSystem: 'HIS',
      sourceCode: 'HIS-RESP',
      sourceName: '呼吸科',
      mappingStatus: 'CONFIRMED',
    }],
    quality: {
      departmentId,
      qualityScore: '98.50',
      completenessScore: '100.00',
      uniquenessScore: '95.00',
      standardizationScore: '99.50',
    },
    publishedReleaseId: '75000000-0000-7000-8000-000000000001',
    publishedAt: departmentDtoLocalDateTime('2026-09-03T16:00:00'),
    contentHash: '7f'.repeat(32),
  };
}

function expectContractError(
  action: () => void,
  expectedCode: DepartmentContractError['code'],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DepartmentContractError);
    expect((error as DepartmentContractError).code).toBe(expectedCode);
    return;
  }
  throw new Error(`EXPECTED_DEPARTMENT_CONTRACT_ERROR:${expectedCode}`);
}
