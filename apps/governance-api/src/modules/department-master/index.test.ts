import { describe, expect, it } from 'vitest';
import {
  assertEvolutionSupported,
  assertSourceMappingTransition,
  departmentSemanticHash,
  validateDepartmentVersionContent,
  validateHierarchyNodeInput,
  type DepartmentVersionContent,
} from './index.js';

const content: DepartmentVersionContent = {
  standardName: '呼吸与危重症医学科',
  shortName: '呼吸科',
  departmentType: 'CLINICAL',
  clinicalFlag: true,
  managementFlag: false,
  subjectMappingApplicability: 'REQUIRED_CLINICAL_SERVICE',
  businessStatus: 'ACTIVE',
  description: null,
  businessValidFrom: '2026-09-01T00:00:00',
  businessValidTo: null,
};
const identity = {
  departmentId: '72000000-0000-7000-8000-000000000001',
  departmentVersionId: '72100000-0000-7000-8000-000000000001',
  versionNo: '1',
  recordedFrom: '2026-09-03T09:00:00',
};

describe('department master domain contract', () => {
  it('excludes governance status and release id from the semantic hash', () => {
    const draftInput = { ...content, ...identity, governanceStatus: 'DRAFT', releaseId: null };
    const publishedInput = { ...content, ...identity, governanceStatus: 'PUBLISHED', releaseId: 'ignored' };
    const left = departmentSemanticHash(draftInput);
    const right = departmentSemanticHash(publishedInput);
    expect(left.equals(right)).toBe(true);
  });

  it('changes the hash when semantic content changes', () => {
    expect(departmentSemanticHash({ ...content, ...identity }).equals(
      departmentSemanticHash({ ...content, ...identity, standardName: '呼吸医学科' }),
    )).toBe(false);
  });

  it('rejects exemptions for clinical and mixed-duty departments', () => {
    expect(() => validateDepartmentVersionContent({
      ...content,
      departmentType: 'MEDICAL_TECHNOLOGY',
      subjectMappingApplicability: 'EXEMPT_MEDICAL_TECHNOLOGY',
    })).toThrowError('CLINICAL_DEPARTMENT_CANNOT_BE_EXEMPT');
  });

  it('requires auxiliary type for auxiliary exemption', () => {
    expect(() => validateDepartmentVersionContent({
      ...content,
      clinicalFlag: false,
      subjectMappingApplicability: 'EXEMPT_AUXILIARY',
    })).toThrowError('AUXILIARY_EXEMPTION_REQUIRES_AUXILIARY_TYPE');
  });

  it('fails closed for superseded without an evolution relation', () => {
    expect(() => assertEvolutionSupported('SUPERSEDED')).toThrowError(
      'DEPARTMENT_EVOLUTION_RELATION_REQUIRED',
    );
  });

  it('allows only pending source mappings to enter a terminal state', () => {
    expect(() => assertSourceMappingTransition('PENDING', 'CONFIRMED')).not.toThrow();
    expect(() => assertSourceMappingTransition('PENDING', 'REJECTED')).not.toThrow();
    expect(() => assertSourceMappingTransition('CONFIRMED', 'REJECTED')).toThrowError(
      'DEPARTMENT_SOURCE_MAPPING_TRANSITION_INVALID',
    );
  });

  it('rejects duplicate departments and groups in hierarchy input', () => {
    const department = { nodeKey: 'a', parentNodeKey: null, nodeKind: 'DEPARTMENT' as const, departmentId: 'd', departmentVersionId: 'v', displayName: 'A', sortOrder: 1 };
    expect(() => validateHierarchyNodeInput([department, { ...department, nodeKey: 'b' }])).toThrowError('DEPARTMENT_HIERARCHY_DEPARTMENT_DUPLICATE');
  });

  it('rejects hierarchy cycles before persistence', () => {
    expect(() => validateHierarchyNodeInput([
      { nodeKey: 'a', parentNodeKey: 'b', nodeKind: 'GROUP', groupId: 'ga', groupVersionId: 'gav', displayName: 'A', sortOrder: 1 },
      { nodeKey: 'b', parentNodeKey: 'a', nodeKind: 'GROUP', groupId: 'gb', groupVersionId: 'gbv', displayName: 'B', sortOrder: 2 },
    ])).toThrowError('DEPARTMENT_HIERARCHY_CYCLE');
  });
});
