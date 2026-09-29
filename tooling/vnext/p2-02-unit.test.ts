import { describe, expect, it } from 'vitest';
import { validateHierarchyForest, type HierarchyCandidateInput } from '../../apps/governance-api/src/modules/department-master/index.js';

const id = (last: string) => `00000000-0000-7000-8000-${last.padStart(12, '0')}`;
const base = (viewCode: string, nodes: HierarchyCandidateInput['nodes']): HierarchyCandidateInput => ({
  requestId: id('01'), viewId: null, sourceClientKey: `view-${viewCode}`, viewCode, viewName: viewCode,
  viewType: 'ADMINISTRATIVE', parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE',
  ownerDepartmentId: null, sourceSystemId: id('02'), sourceRecordId: `row-${viewCode}`, sourceVersion: '1',
  validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000',
  recordStatus: 'ACTIVE', approvalRef: 'synthetic-approval', nodes,
});
const evidence = (key: string) => ({ sourceClientKey: key, sourceVersion: '7', sourceSystemId: id('02'), sourceRecordId: `sheet:${key}`, validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.123456', recordStatus: 'ACTIVE' as const, approvalRef: 'EDGE_APPROVAL' });
const department = (nodeKey: string, parentNodeKey: string | null, departmentId: string, displayName = '同名科室') => ({
  sourceEvidence: evidence(nodeKey), nodeKey, parentNodeKey, nodeKind: 'DEPARTMENT' as const, departmentId, departmentVersionId: id(departmentId.slice(-1)),
  displayName, relationName: '行政隶属', sortOrder: 1, isPrimaryPath: true,
});

describe('P2-02 strict hierarchy domain', () => {
  it('rejects mixed ORG06 source periods before storing a complete snapshot', () => {
    const candidate = base('ADMIN', [department('root', null, id('10'))]);
    const input = { ...candidate, nodes: candidate.nodes.map(node => ({ ...node, sourceEvidence: {
      sourceClientKey: 'edge-1', sourceVersion: '7', sourceSystemId: id('02'), sourceRecordId: 'sheet:row:7',
      validFrom: '2026-10-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.123456',
      recordStatus: 'ACTIVE', approvalRef: 'EDGE_APPROVAL',
    } })) };
    expect(() => validateHierarchyForest(input)).toThrowError('MIXED_EDGE_PERIOD');
  });
  it('P2-02-AC-01 allows the same department in two independent views', () => {
    const dept = id('10');
    expect(() => validateHierarchyForest(base('ADMIN', [department('root', null, dept)]))).not.toThrow();
    expect(() => validateHierarchyForest(base('MEDICAL', [department('root', null, dept)]))).not.toThrow();
  });

  it('P2-02-AC-01 rejects two parents or duplicate placement in one view', () => {
    const dept = id('10');
    expect(() => validateHierarchyForest(base('ADMIN', [
      department('a', null, id('11')), department('b', null, id('12')), department('child', 'a', dept), department('child-2', 'b', dept),
    ]))).toThrowError('DEPARTMENT_DUPLICATE');
  });

  it('P2-02-AC-02 rejects a cycle even when the final row closes it', () => {
    expect(() => validateHierarchyForest(base('ADMIN', [
      department('a', 'b', id('11')), department('b', 'c', id('12')), department('c', 'a', id('13')),
    ]))).toThrowError('HIERARCHY_CYCLE');
  });

  it('keeps a GROUP out of department identity references and derives depth', () => {
    const result = validateHierarchyForest(base('ADMIN', [
      { sourceEvidence: evidence('group'), nodeKey: 'group', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL', groupId: null, groupVersionId: null, displayName: '临床组', relationName: '组织', sortOrder: 1, isPrimaryPath: true },
      department('child', 'group', id('11')),
    ]));
    expect(result.nodes.map(node => node.depth)).toEqual([0, 1]);
    expect(result.nodes[0]?.nodeKind).toBe('GROUP');
  });

  it('P2-02-AC-03 rejects a GROUP carrying a department foreign-key shape', () => {
    const invalid: unknown = {
      ...base('ADMIN', []),
      nodes: [{
      sourceEvidence: evidence('group'), nodeKey: 'group', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL', groupId: null, groupVersionId: null,
      departmentId: id('11'), displayName: '临床组', relationName: '组织', sortOrder: 1, isPrimaryPath: true,
      }],
    };
    expect(() => validateHierarchyForest(invalid)).toThrowError('CLOSED_INPUT_REQUIRED');
  });

  it('P2-02-AC-04 distinguishes same-name nodes by their stable IDs', () => {
    const result = validateHierarchyForest(base('ADMIN', [department('a', null, id('11')), department('b', null, id('12'))]));
    expect(result.nodes.map(node => node.nodeKey)).toEqual(['a', 'b']);
    expect(result.nodes.map(node => node.displayName)).toEqual(['同名科室', '同名科室']);
    expect(result.nodes.map(node => node.nodeKind === 'DEPARTMENT' ? node.departmentId : null)).toEqual([id('11'), id('12')]);
  });

  it('rejects source multi-parent policy instead of relaxing strict tree', () => {
    const invalid: unknown = { ...base('ADMIN', [department('a', null, id('11'))]), single_parent: false };
    expect(() => validateHierarchyForest(invalid)).toThrowError('CLOSED_INPUT_REQUIRED');
  });

  it('rejects registration-only view types from candidate import', () => {
    for (const viewType of ['FINANCE', 'STATISTICAL'] as const) {
      expect(() => validateHierarchyForest({ ...base(viewType, [department('a', null, id('11'))]), viewType })).toThrowError('VIEW_TYPE_NOT_OPERATIONAL');
    }
  });

  it('rejects offset-bearing source times and mixed periods', () => {
    expect(() => validateHierarchyForest({ ...base('ADMIN', [department('a', null, id('11'))]), validFrom: '2026-09-01T00:00:00+08:00' })).toThrowError('CLOSED_INPUT_REQUIRED');
  });
});
