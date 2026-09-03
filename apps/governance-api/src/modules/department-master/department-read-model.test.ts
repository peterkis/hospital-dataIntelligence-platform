import { describe, expect, it, vi } from 'vitest';
import {
  DepartmentQueryService,
  DepartmentReadModelMapper,
  type DepartmentPublishedReadRepository,
  type DepartmentPublishedReadSource,
} from './read-model.js';

const departmentId = '72000000-0000-7000-8000-000000000001';
const contentHash = Buffer.from('7f'.repeat(32), 'hex');
const publishedSource: DepartmentPublishedReadSource = {
  sourceGovernanceStatus: 'PUBLISHED',
  projection: {
    departmentId,
    departmentCode: 'DEP-00001',
    standardName: '呼吸与危重症医学科',
    departmentType: 'CLINICAL',
    subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
    qualityScore: '98.50',
    publishedReleaseId: '75000000-0000-7000-8000-000000000001',
    publishedAt: '2026-09-03T16:00:00.123456',
    contentHash,
  },
  versionSnapshot: {
    shortName: '呼吸科',
    lifecycleStatus: 'ACTIVE',
  },
  campusSnapshot: [{
    campusId: '71000000-0000-7000-8000-000000000001',
    campusCode: 'MAIN',
    campusName: '总部院区',
  }],
  hierarchySnapshots: [{
    viewType: 'ADMINISTRATIVE',
    hierarchyPath: [
      { nodeId: '73000000-0000-7000-8000-000000000001', displayName: '内科系统' },
      { nodeId: '73000000-0000-7000-8000-000000000002', displayName: '呼吸与危重症医学科' },
    ],
  }],
  sourceMappings: [{
    sourceSystem: 'HIS',
    sourceCode: 'HIS-RESP',
    sourceName: '呼吸科',
    mappingStatus: 'CONFIRMED',
  }],
};

describe('department published read model contract', () => {
  it('maps a published projection and its frozen snapshots to the public read model', () => {
    const model = new DepartmentReadModelMapper().toReadModel(publishedSource);

    expect(model).toEqual({
      departmentId,
      departmentCode: 'DEP-00001',
      standardName: '呼吸与危重症医学科',
      shortName: '呼吸科',
      departmentType: 'CLINICAL',
      subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
      lifecycleStatus: 'ACTIVE',
      campuses: [{ campusId: '71000000-0000-7000-8000-000000000001', campusCode: 'MAIN', campusName: '总部院区' }],
      hierarchyViews: [{
        viewType: 'ADMINISTRATIVE',
        hierarchyPath: [
          { nodeId: '73000000-0000-7000-8000-000000000001', displayName: '内科系统' },
          { nodeId: '73000000-0000-7000-8000-000000000002', displayName: '呼吸与危重症医学科' },
        ],
      }],
      sourceMappings: [{ sourceSystem: 'HIS', sourceCode: 'HIS-RESP', sourceName: '呼吸科', mappingStatus: 'CONFIRMED' }],
      qualityScore: '98.50',
      publishedReleaseId: '75000000-0000-7000-8000-000000000001',
      publishedAt: '2026-09-03T16:00:00.123456',
      contentHash: '7f'.repeat(32),
    });
  });

  it('does not create a read model for a draft source', () => {
    expect(new DepartmentReadModelMapper().toReadModel({
      ...publishedSource,
      sourceGovernanceStatus: 'DRAFT',
    })).toBeNull();
  });

  it('reflects projection content changes in a different read model without mutating the projection', () => {
    const mapper = new DepartmentReadModelMapper();
    const first = mapper.toReadModel(publishedSource);
    const changedHash = Buffer.from('8a'.repeat(32), 'hex');
    const changed = mapper.toReadModel({
      ...publishedSource,
      projection: {
        ...publishedSource.projection,
        standardName: '呼吸医学中心',
        contentHash: changedHash,
      },
    });

    expect(changed).not.toEqual(first);
    expect(changed?.contentHash).toBe('8a'.repeat(32));
    expect(publishedSource.projection.standardName).toBe('呼吸与危重症医学科');
    expect(publishedSource.projection.contentHash).toBe(contentHash);
  });

  it('uses the supplied hierarchy snapshot and never asks the repository for a current tree', async () => {
    const repository = repositoryWith({ getPublishedDepartment: vi.fn().mockResolvedValue(publishedSource) });
    const model = await new DepartmentQueryService(repository).getPublishedDepartment(departmentId);

    expect(model?.hierarchyViews).toEqual(publishedSource.hierarchySnapshots);
    expect(Object.keys(repository)).not.toContain('getCurrentHierarchy');
  });

  it('uses the supplied campus snapshot and never asks the repository for current assignments', async () => {
    const repository = repositoryWith({ getPublishedDepartment: vi.fn().mockResolvedValue(publishedSource) });
    const model = await new DepartmentQueryService(repository).getPublishedDepartment(departmentId);

    expect(model?.campuses).toEqual(publishedSource.campusSnapshot);
    expect(Object.keys(repository)).not.toContain('getCurrentCampusAssignments');
  });

  it('returns the version valid in both business and record time for a historical query', async () => {
    const historical = {
      ...publishedSource,
      projection: {
        ...publishedSource.projection,
        standardName: '历史呼吸科',
        publishedAt: '2025-01-01T00:00:00',
      },
    } satisfies DepartmentPublishedReadSource;
    const findDepartmentAsOf = vi.fn().mockResolvedValue(historical);
    const service = new DepartmentQueryService(repositoryWith({ findDepartmentAsOf }));

    const model = await service.findDepartmentAsOf(departmentId, '2025-01-01T12:30:00');

    expect(model?.standardName).toBe('历史呼吸科');
    expect(findDepartmentAsOf).toHaveBeenCalledWith(departmentId, {
      businessAt: '2025-01-01T12:30:00',
      recordAsOf: '2025-01-01T12:30:00',
    });
  });

  it('rejects timezone-bearing timestamps and exposes only timezone-free local date-times', async () => {
    const service = new DepartmentQueryService(repositoryWith());
    const model = new DepartmentReadModelMapper().toReadModel(publishedSource);

    expect(model?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/u);
    await expect(service.findDepartmentAsOf(departmentId, '2025-01-01T12:30:00Z'))
      .rejects.toThrowError('LOCAL_DATETIME_INVALID');
    await expect(service.findDepartmentAsOf(departmentId, '2025-01-01T12:30:00+08:00'))
      .rejects.toThrowError('LOCAL_DATETIME_INVALID');
  });

  it('does not expose secrets, workflow internals, or database table names', () => {
    const serialized = JSON.stringify(new DepartmentReadModelMapper().toReadModel(publishedSource));

    for (const forbidden of [
      'password',
      'token',
      'DATABASE_URL',
      'workflowInstanceId',
      'department_version',
      'department_published_projection',
      'department_hierarchy_node',
      'department_source_mapping',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('supports application-level published department filters', async () => {
    const another = {
      ...publishedSource,
      projection: {
        ...publishedSource.projection,
        departmentId: '72000000-0000-7000-8000-000000000002',
        departmentCode: 'DEP-00002',
        standardName: '医学检验科',
        departmentType: 'MEDICAL_TECHNOLOGY',
      },
      campusSnapshot: [],
      hierarchySnapshots: [{ viewType: 'OPERATIONAL', hierarchyPath: [] }],
    } satisfies DepartmentPublishedReadSource;
    const service = new DepartmentQueryService(repositoryWith({
      findPublishedDepartments: vi.fn().mockResolvedValue([publishedSource, another]),
    }));

    await expect(service.findPublishedDepartments({ departmentCode: 'DEP-00001' }))
      .resolves.toHaveLength(1);
    await expect(service.findPublishedDepartments({ standardName: '呼吸' }))
      .resolves.toHaveLength(1);
    await expect(service.findPublishedDepartments({ departmentType: 'CLINICAL' }))
      .resolves.toHaveLength(1);
    await expect(service.findPublishedDepartments({ campusId: '71000000-0000-7000-8000-000000000001' }))
      .resolves.toHaveLength(1);
    await expect(service.findPublishedDepartments({ hierarchyViewType: 'OPERATIONAL' }))
      .resolves.toEqual([expect.objectContaining({ departmentCode: 'DEP-00002' })]);
  });
});

function repositoryWith(
  overrides: Partial<DepartmentPublishedReadRepository> = {},
): DepartmentPublishedReadRepository {
  return {
    getPublishedDepartment: vi.fn().mockResolvedValue(null),
    findPublishedDepartments: vi.fn().mockResolvedValue([]),
    findDepartmentAsOf: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}
