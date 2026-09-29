import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { LocalSyntheticKeyProvider, openCatalog } from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import { departmentFixture } from './p2-01-fixture.js';
import { openDepartment, openHierarchy, type HierarchyCandidateInput } from '../../apps/governance-api/src/modules/department-master/index.js';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import { peer } from './lineage.mjs';

const connection = process.env['VNEXT_VALIDATION_OWNER_URL'];
if (!connection) throw new Error('RECEIPT_BOUND_CONNECTION_REQUIRED');
const provider = new LocalSyntheticKeyProvider();
const hierarchy = openHierarchy(connection, provider);
const catalog = await openCatalog(connection, provider);
const department = openDepartment(connection, provider);
const receipt = JSON.parse(readFileSync(process.env['VNEXT_TEST_RECEIPT']!, 'utf8')) as { name: string };
const id = () => randomUUID();
let ownerDepartmentId: string;
let departmentId: string;
let departmentVersionId: string;
let sourceSystemId: string;
let finiteDepartmentId: string;
let finiteDepartmentVersionId: string;

describe('P2-02 vNext hierarchy owner', () => {
  let viewId: string;
  let secondViewId: string;
  beforeAll(async () => {
    const fixture = await departmentFixture(receipt, catalog, provider);
    const staged = await department.stage('maker', await fixture.input());
    await department.verify('reviewer', { requestId: id(), inputId: staged.inputId, inputDigest: staged.digest, rows: [{ row: 1, disposition: 'DEPARTMENT', historicalException: false, reason: 'P2-02 synthetic department reference', evidenceId: fixture.artifact.artifactId }] });
    const applyRequestId = id();
    const planned = await department.plan('maker', { inputId: staged.inputId, requestId: applyRequestId });
    await department.readApplyCandidate('reviewer', { candidateId: planned.candidateId });
    await department.approveApplyUnit('reviewer', planned);
    const applied = await department.applyUnit('maker', { candidateId: planned.candidateId, requestId: applyRequestId });
    if (applied.status !== 'COMMITTED') throw new Error('P2_02_DEPARTMENT_FIXTURE_NOT_COMMITTED');
    departmentId = applied.facts[0]!.id;
    sourceSystemId = fixture.source.id;
    departmentVersionId = (await department.exact('maker', { id: departmentId, version: '1' })).versionId;
    ownerDepartmentId = departmentId;
    const finiteEntry = fixture.entry();
    finiteEntry.row.valid_to = '2027-01-01T00:00:00';
    const finiteInput = await department.stage('maker', await fixture.input([finiteEntry]));
    await department.verify('reviewer', { requestId: id(), inputId: finiteInput.inputId, inputDigest: finiteInput.digest, rows: [{ row: 1, disposition: 'DEPARTMENT', historicalException: false, reason: 'Finite dependency regression', evidenceId: fixture.artifact.artifactId }] });
    const finiteRequest = id();
    const finitePlan = await department.plan('maker', { inputId: finiteInput.inputId, requestId: finiteRequest });
    await department.readApplyCandidate('reviewer', { candidateId: finitePlan.candidateId });
    await department.approveApplyUnit('reviewer', finitePlan);
    const finiteApplied = await department.applyUnit('maker', { candidateId: finitePlan.candidateId, requestId: finiteRequest });
    if (finiteApplied.status !== 'COMMITTED') throw new Error('FINITE_FIXTURE_NOT_COMMITTED');
    finiteDepartmentId = finiteApplied.facts[0]!.id;
    finiteDepartmentVersionId = (await department.exact('maker', { id: finiteDepartmentId, version: '1' })).versionId;
    viewId = (await hierarchy.createHierarchyView('maker', {
      requestId: id(), sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG05:1', sourceVersion: '1',
      validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000', approvalRef: 'SYNTHETIC-APPROVAL',
    })).viewId;
    secondViewId = (await hierarchy.createHierarchyView('maker', {
      requestId: id(), sourceClientKey: 'ORG05-SYNTHETIC-MEDICAL', viewCode: 'MEDICAL', viewName: '病案视图', viewType: 'MEDICAL_RECORD',
      purpose: '病案归档', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG05:2', sourceVersion: '1',
      validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000', approvalRef: 'SYNTHETIC-APPROVAL',
    })).viewId;
  });

  it('P2-02-AC-05 freezes the old snapshot after a renamed publication and replays the same result', async () => {
    const candidate: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG06:1', sourceVersion: '1',
      validFrom: '2026-09-01T00:00:00.123456', validTo: null, recordedAt: '2026-09-01T01:00:00.654321', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [{ nodeKey: 'clinical', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL', groupId: null, groupVersionId: null, displayName: '临床组', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    expect(staged.decision).toBe('PASS');
    if (!staged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    const candidateId = staged.candidateId;
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId, digest: staged.digest });
    const checked = await hierarchy.validateForest(candidate);
    const tampered = { ...candidate, viewName: '未授权改写', nodes: checked.nodes, validationDigest: checked.digest };
    const pool = new (await import('pg')).Pool({ connectionString: connection, options: '-c timezone=Asia/Shanghai' });
    try {
      await expect(pool.query('select department_master.hierarchy_publish($1,$2::uuid,$3,$4::jsonb)', ['maker', candidateId, staged.digest, JSON.stringify(tampered)])).rejects.toThrow('STALE_VALIDATION');
    } finally {
      await pool.end();
    }
    const published = await hierarchy.publishHierarchySnapshot('maker', { candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(published.nodes).toHaveLength(1);
    expect(published.validFrom).toBe('2026-09-01T00:00:00.123456');
    expect(published.sourceRecordedAt).toBe('2026-09-01T01:00:00.654321');
    expect(published.nodes[0]?.nodeKind).toBe('GROUP');
    expect(published.nodes[0]?.groupId).toMatch(/^[a-f0-9-]{36}$/);
    if (!published.nodes[0]?.groupId || !published.nodes[0]?.groupVersionId) throw new Error('P2_02_GROUP_REFERENCE_REQUIRED');
    const replay = await hierarchy.publishHierarchySnapshot('maker', { candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(replay.contentDigest).toBe(published.contentDigest);

    const renamed: HierarchyCandidateInput = {
      ...candidate,
      requestId: id(), sourceRecordId: 'ORG06:2', sourceVersion: '2', viewName: '行政视图改名',
      validFrom: '2027-09-01T00:00:00.000000', recordedAt: '2027-09-01T01:00:00.000000',
      nodes: [{
        nodeKey: 'clinical', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL',
        groupId: published.nodes[0]!.groupId, groupVersionId: published.nodes[0]!.groupVersionId,
        displayName: '临床组改名', relationName: '组织', sortOrder: 1, isPrimaryPath: true,
      }],
    };
    const renamedStaged = await hierarchy.importHierarchyCandidate('maker', renamed);
    if (!renamedStaged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: renamedStaged.candidateId, digest: renamedStaged.digest });
    const renamedPublished = await hierarchy.publishHierarchySnapshot('maker', { candidateId: renamedStaged.candidateId, requestId: renamed.requestId, digest: renamedStaged.digest });
    const oldSnapshot = await hierarchy.readHierarchySnapshot('maker', { viewId, version: published.view.version });
    expect(oldSnapshot).toEqual(published);
    expect(oldSnapshot?.contentDigest).toBe(published.contentDigest);
    expect(oldSnapshot?.view.viewName).toBe('行政视图');
    expect(oldSnapshot?.nodes[0]?.displayName).toBe('临床组');
    expect(renamedPublished.view.viewName).toBe('行政视图改名');
    expect(renamedPublished.nodes[0]?.displayName).toBe('临床组改名');
    expect(renamedPublished.contentDigest).not.toBe(published.contentDigest);
    const replayAfterRename = await hierarchy.publishHierarchySnapshot('maker', { candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(replayAfterRename).toEqual(published);
  });

  it('P2-02-AC-02 does not persist an invalid cycle candidate as a partial snapshot', async () => {
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId });
    const invalid: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG06:invalid', sourceVersion: 'invalid',
      validFrom: '2028-09-01T00:00:00.000000', validTo: null, recordedAt: '2028-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [
        { nodeKey: 'a', parentNodeKey: 'b', nodeKind: 'GROUP', groupCode: 'A', groupId: null, groupVersionId: null, displayName: 'A', relationName: '组织', sortOrder: 1, isPrimaryPath: true },
        { nodeKey: 'b', parentNodeKey: 'a', nodeKind: 'GROUP', groupCode: 'B', groupId: null, groupVersionId: null, displayName: 'B', relationName: '组织', sortOrder: 2, isPrimaryPath: true },
      ],
    };
    const rejected = await hierarchy.importHierarchyCandidate('maker', invalid);
    expect(rejected.decision).toBe('FAIL');
    expect(rejected.issues).toContainEqual(expect.objectContaining({ code: 'HIERARCHY_CYCLE' }));
    const after = await hierarchy.readHierarchySnapshot('maker', { viewId });
    expect(after?.contentDigest).toBe(before?.contentDigest);
  });

  it('P2-02-AC-01 publishes one real Department in two views but rejects same-view duplicate placement', async () => {
    const candidate = (view: string, sourceRecordId: string): HierarchyCandidateInput => ({
      requestId: id(), viewId: view, sourceClientKey: view === viewId ? 'ORG05-SYNTHETIC-ADMIN' : 'ORG05-SYNTHETIC-MEDICAL',
      viewCode: view === viewId ? 'ADMIN' : 'MEDICAL', viewName: view === viewId ? '行政视图' : '病案视图',
      viewType: view === viewId ? 'ADMINISTRATIVE' : 'MEDICAL_RECORD', parentCardinality: 'STRICT_TREE', purpose: '独立视角', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId,
      sourceRecordId, sourceVersion: '1', validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [{ nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId, departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    });
    const publish = async (value: HierarchyCandidateInput) => {
      const staged = await hierarchy.importHierarchyCandidate('maker', value);
      expect(staged.decision).toBe('PASS');
      if (!staged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
      await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: staged.candidateId, digest: staged.digest });
      return hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: value.requestId, digest: staged.digest });
    };
    const admin = await publish(candidate(viewId, 'AC01:ADMIN'));
    const medical = await publish(candidate(secondViewId, 'AC01:MEDICAL'));
    expect(admin.nodes[0]?.departmentId).toBe(departmentId);
    expect(medical.nodes[0]?.departmentId).toBe(departmentId);
    const duplicateBase = candidate(viewId, 'AC01:DUPLICATE');
    const duplicate: HierarchyCandidateInput = {
      ...duplicateBase,
      nodes: [
        { ...duplicateBase.nodes[0]!, nodeKey: 'a' },
        { ...duplicateBase.nodes[0]!, nodeKey: 'b', displayName: '同名科室 2' },
      ],
    };
    const rejected = await hierarchy.importHierarchyCandidate('maker', duplicate);
    expect(rejected).toMatchObject({ candidateId: null, decision: 'FAIL', issues: [expect.objectContaining({ code: 'DEPARTMENT_DUPLICATE' })] });
  });

  it('rejects an approved candidate whose code differs from the stable view', async () => {
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId });
    const candidate: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'WRONG', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId,
      sourceRecordId: 'ORG06:wrong-code', sourceVersion: '1', validFrom: '2026-09-01T00:00:00.000000', validTo: null,
      recordedAt: '2026-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [{ nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId, departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    if (!staged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: staged.candidateId, digest: staged.digest });
    await expect(hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: candidate.requestId, digest: staged.digest })).rejects.toThrow('VIEW_CODE_MISMATCH');
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId })).toEqual(before);
  });

  it.each(['owner', 'node'] as const)('rejects open-ended publication with a finite %s Department dependency', async dependency => {
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId });
    const candidate: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId: dependency === 'owner' ? finiteDepartmentId : ownerDepartmentId, sourceSystemId,
      sourceRecordId: 'ORG06:finite', sourceVersion: '1', validFrom: '2026-09-01T00:00:00.000000', validTo: null,
      recordedAt: '2026-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [{ nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId: dependency === 'node' ? finiteDepartmentId : departmentId, departmentVersionId: dependency === 'node' ? finiteDepartmentVersionId : departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    if (!staged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: staged.candidateId, digest: staged.digest });
    await expect(hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: candidate.requestId, digest: staged.digest })).rejects.toThrow('BLOCKED_DEPENDENCY');
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId })).toEqual(before);
    const bounded = { ...candidate, requestId: id(), validTo: '2027-01-01T00:00:00.000000' };
    const boundedStage = await hierarchy.importHierarchyCandidate('maker', bounded);
    if (!boundedStage.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: boundedStage.candidateId, digest: boundedStage.digest });
    const boundedSnapshot = await hierarchy.publishHierarchySnapshot('maker', { candidateId: boundedStage.candidateId, requestId: bounded.requestId, digest: boundedStage.digest });
    expect(boundedSnapshot.validTo).toBe('2027-01-01T00:00:00.000000');
  });

  it('rejects privileged mutation of published snapshot versions and nodes', async () => {
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId });
    if (!before) throw new Error('SNAPSHOT_REQUIRED');
    const versionWhere = `view_id='${viewId}'::uuid AND version_no=${before.view.version}`;
    const nodeWhere = `node_id='${before.nodes[0]!.nodeId}'::uuid`;
    for (const command of [
      `UPDATE department_master.hierarchy_view_version SET view_name='tampered' WHERE ${versionWhere}`,
      `DELETE FROM department_master.hierarchy_view_version WHERE ${versionWhere}`,
      `UPDATE department_master.hierarchy_node SET display_name='tampered' WHERE ${nodeWhere}`,
      `DELETE FROM department_master.hierarchy_node WHERE ${nodeWhere}`,
    ]) {
      expect(() => peer(receipt.name, `BEGIN; ${command}; ROLLBACK;`)).toThrow('IMMUTABLE');
    }
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId })).toEqual(before);
  });

  it('serves the typed snapshot read through the registered HTTP owner route', async () => {
    const app = await buildCatalogServer(undefined, 'CONTROL_PLANE', undefined, undefined, undefined, undefined, undefined, undefined, {
      owner: hierarchy,
      actor: request => String(request.headers['x-actor'] ?? ''),
    });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/vnext/hierarchy/snapshots/read', headers: { 'x-actor': 'maker' }, payload: { viewId } });
      expect(response.statusCode).toBe(200);
      expect(response.json().view.viewCode).toBe('ADMIN');
    } finally {
      await app.close();
    }
  });

  afterAll(async () => { await hierarchy.close(); await department.close(); await catalog.close(); });
});
