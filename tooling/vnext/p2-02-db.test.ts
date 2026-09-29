import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { LocalSyntheticKeyProvider } from '../../apps/governance-api/src/modules/governance-catalog/protected-artifact.js';
import { openHierarchy, type HierarchyCandidateInput } from '../../apps/governance-api/src/modules/department-master/vnext/hierarchy.js';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.js';

const connection = process.env['VNEXT_VALIDATION_OWNER_URL'];
if (!connection) throw new Error('RECEIPT_BOUND_CONNECTION_REQUIRED');
const hierarchy = openHierarchy(connection, new LocalSyntheticKeyProvider());
const id = () => randomUUID();

describe('P2-02 vNext hierarchy owner', () => {
  let viewId: string;
  beforeAll(async () => {
    viewId = (await hierarchy.createHierarchyView('maker', {
      requestId: id(), sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId: null, sourceSystemId: id(), sourceRecordId: 'ORG05:1', sourceVersion: '1',
      validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000', approvalRef: 'SYNTHETIC-APPROVAL',
    })).viewId;
  });

  it('validates, approves and publishes one complete forest atomically', async () => {
    const candidate: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId: null, sourceSystemId: id(), sourceRecordId: 'ORG06:1', sourceVersion: '1',
      validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [{ nodeKey: 'clinical', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL', groupId: null, groupVersionId: null, displayName: '临床组', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    expect(staged.decision).toBe('PASS');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: staged.candidateId, digest: staged.digest });
    const published = await hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(published.nodes).toHaveLength(1);
    expect(published.nodes[0]?.nodeKind).toBe('GROUP');
    expect(published.nodes[0]?.groupId).toMatch(/^[a-f0-9-]{36}$/);
    const replay = await hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: candidate.requestId, digest: staged.digest });
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
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: renamedStaged.candidateId, digest: renamedStaged.digest });
    const renamedPublished = await hierarchy.publishHierarchySnapshot('maker', { candidateId: renamedStaged.candidateId, requestId: renamed.requestId, digest: renamedStaged.digest });
    const oldSnapshot = await hierarchy.readHierarchySnapshot('maker', { viewId, version: published.view.version });
    expect(oldSnapshot?.contentDigest).toBe(published.contentDigest);
    expect(oldSnapshot?.view.viewName).toBe('行政视图');
    expect(oldSnapshot?.nodes[0]?.displayName).toBe('临床组');
    expect(renamedPublished.view.viewName).toBe('行政视图改名');
    expect(renamedPublished.nodes[0]?.displayName).toBe('临床组改名');
    expect(renamedPublished.contentDigest).not.toBe(published.contentDigest);
  });

  it('does not persist an invalid cycle candidate as a partial snapshot', async () => {
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId });
    const invalid: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId: null, sourceSystemId: id(), sourceRecordId: 'ORG06:invalid', sourceVersion: 'invalid',
      validFrom: '2028-09-01T00:00:00.000000', validTo: null, recordedAt: '2028-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [
        { nodeKey: 'a', parentNodeKey: 'b', nodeKind: 'GROUP', groupCode: 'A', groupId: null, groupVersionId: null, displayName: 'A', relationName: '组织', sortOrder: 1, isPrimaryPath: true },
        { nodeKey: 'b', parentNodeKey: 'a', nodeKind: 'GROUP', groupCode: 'B', groupId: null, groupVersionId: null, displayName: 'B', relationName: '组织', sortOrder: 2, isPrimaryPath: true },
      ],
    };
    await expect(hierarchy.importHierarchyCandidate('maker', invalid)).rejects.toThrowError('HIERARCHY_CYCLE');
    const after = await hierarchy.readHierarchySnapshot('maker', { viewId });
    expect(after?.contentDigest).toBe(before?.contentDigest);
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

  afterAll(async () => { await hierarchy.close(); });
});
