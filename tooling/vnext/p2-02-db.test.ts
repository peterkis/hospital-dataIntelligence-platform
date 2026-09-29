import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { LocalSyntheticKeyProvider, openCatalog, type Outcome } from '../../apps/governance-api/src/modules/governance-catalog/index.js';
import { departmentFixture } from './p2-01-fixture.js';
import { openDepartment, openHierarchy, type HierarchyCandidateInput } from '../../apps/governance-api/src/modules/department-master/index.js';
import { buildCatalogServer } from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import { peer } from './lineage.mjs';
import { createHierarchyClient } from '../../packages/generated-api-client/src/index.js';

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
let sourceDefinitionVersionId: string;
let finiteDepartmentId: string;
let finiteDepartmentVersionId: string;
let temporalSource: Outcome;

const edgeEvidence = (key: string, validFrom = '2026-09-01T00:00:00.000000', validTo: string | null = null) => ({ sourceClientKey: key, sourceVersion: '7', sourceSystemId, sourceRecordId: `ORG06:sheet:${key}`, validFrom, validTo, recordedAt: '2026-09-01T01:00:00.123456', recordStatus: 'ACTIVE' as const, approvalRef: 'EDGE_APPROVAL' });
async function withoutViewPermission(actor:'maker'|'reviewer',view:string,permission:'READ'|'WRITE'|'REVIEW',work:()=>Promise<void>) {
  peer(receipt.name,`DELETE FROM department_master.hierarchy_grant WHERE actor_code='${actor}' AND object_id='${view}'::uuid AND permission='${permission}';`);
  try { await work(); }
  finally { peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) VALUES('${actor}','${view}'::uuid,'${permission}');`); }
}

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
    sourceDefinitionVersionId = fixture.source.versionId;
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
    peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer',v::uuid,p FROM unnest(ARRAY['${viewId}','${secondViewId}']) v CROSS JOIN unnest(ARRAY['READ','REVIEW']) p;`);
  });

  it('hospital READ does not grant access to an independently governed view', async () => {
    const restricted = await hierarchy.createHierarchyView('maker', {
      requestId:id(),sourceClientKey:'PRIVATE_VIEW',viewCode:'PRIVATE',viewName:'Private view',viewType:'ADMINISTRATIVE',
      purpose:'View authorization',aggregationRule:'NO_DUPLICATE',ownerDepartmentId,sourceSystemId,sourceRecordId:'PRIVATE',sourceVersion:'1',
      validFrom:'2026-09-01T00:00:00.000000',validTo:null,recordedAt:'2026-09-01T01:00:00.000000',approvalRef:'PRIVATE_APPROVAL',
    });
    expect(await hierarchy.readHierarchySnapshot('maker',{viewId:restricted.viewId})).toBeNull();
    await expect(hierarchy.readHierarchySnapshot('reviewer',{viewId:restricted.viewId})).rejects.toThrow('ACCESS_DENIED');
  });

  it('P2-02-AC-05 freezes the old snapshot after a renamed publication and replays the same result', async () => {
    const candidate: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG06:1', sourceVersion: '1',
      validFrom: '2026-09-01T00:00:00.123456', validTo: null, recordedAt: '2026-09-01T01:00:00.654321', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [
        { sourceEvidence: edgeEvidence('clinical', '2026-09-01T00:00:00.123456'), nodeKey: 'clinical', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL', groupId: null, groupVersionId: null, displayName: '临床组', relationName: '组织', sortOrder: 1, isPrimaryPath: true },
        { sourceEvidence: { ...edgeEvidence('child', '2026-09-01T00:00:00.123456'), sourceVersion: '9', approvalRef: 'CHILD_APPROVAL' }, nodeKey: 'child', parentNodeKey: 'clinical', nodeKind: 'DEPARTMENT', departmentId, departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true },
      ],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    expect(staged.decision).toBe('PASS');
    if (!staged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    const candidateId = staged.candidateId;
    await withoutViewPermission('reviewer',viewId,'REVIEW',async()=>{
      await expect(hierarchy.approveHierarchyCandidate('reviewer',{candidateId,digest:staged.digest})).rejects.toThrow('ACCESS_DENIED');
      const direct = new Pool({connectionString:connection});
      try { await expect(direct.query('select department_master.hierarchy_approve($1,$2::uuid,$3)',['reviewer',candidateId,staged.digest])).rejects.toThrow('ACCESS_DENIED'); }
      finally { await direct.end(); }
    });
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId, digest: staged.digest });
    await withoutViewPermission('reviewer',viewId,'REVIEW',async()=>{
      await expect(hierarchy.publishHierarchySnapshot('maker',{candidateId,requestId:candidate.requestId,digest:staged.digest})).rejects.toThrow('ACCESS_DENIED');
    });
    const checked = await hierarchy.validateForest(candidate);
    const tampered = { ...candidate, viewName: '未授权改写', nodes: checked.nodes, validationDigest: checked.digest };
    const pool = new (await import('pg')).Pool({ connectionString: connection, options: '-c timezone=Asia/Shanghai' });
    try {
      await expect(pool.query('select department_master.hierarchy_publish($1,$2::uuid,$3,$4::jsonb)', ['maker', candidateId, staged.digest, JSON.stringify(tampered)])).rejects.toThrow('STALE_VALIDATION');
    } finally {
      await pool.end();
    }
    await expect(hierarchy.publishHierarchySnapshot('maker',{candidateId,requestId:id(),digest:staged.digest})).rejects.toThrow('REQUEST_CONFLICT');
    const published = await hierarchy.publishHierarchySnapshot('maker', { candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(published.nodes).toHaveLength(2);
    expect(published.view).toHaveProperty('ownerDepartmentVersionId', departmentVersionId);
    expect(published.view).toHaveProperty('sourceDefinitionVersionId', sourceDefinitionVersionId);
    expect(published.validFrom).toBe('2026-09-01T00:00:00.123456');
    expect(published.sourceRecordedAt).toBe('2026-09-01T01:00:00.654321');
    expect(published.nodes[0]?.nodeKind).toBe('GROUP');
    expect(published.nodes[0]?.sourceEvidence).toEqual(candidate.nodes[0]!.sourceEvidence);
    expect(published.nodes[1]?.sourceEvidence).toEqual(candidate.nodes[1]!.sourceEvidence);
    expect(published.nodes[0]?.sourceDefinitionVersionId).toBe(sourceDefinitionVersionId);
    expect(published.nodes[0]).toHaveProperty('groupCode', 'CLINICAL');
    expect(published.nodes[0]?.groupId).toMatch(/^[a-f0-9-]{36}$/);
    if (!published.nodes[0]?.groupId || !published.nodes[0]?.groupVersionId) throw new Error('P2_02_GROUP_REFERENCE_REQUIRED');
    const replay = await hierarchy.publishHierarchySnapshot('maker', { candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(replay.contentDigest).toBe(published.contentDigest);
    await expect(hierarchy.publishHierarchySnapshot('maker',{candidateId,requestId:id(),digest:staged.digest})).rejects.toThrow('REQUEST_CONFLICT');
    await withoutViewPermission('maker',viewId,'WRITE',async()=>{
      await expect(hierarchy.importHierarchyCandidate('maker',candidate)).rejects.toThrow('ACCESS_DENIED');
      await expect(hierarchy.publishHierarchySnapshot('maker',{candidateId,requestId:candidate.requestId,digest:staged.digest})).rejects.toThrow('ACCESS_DENIED');
      await expect(hierarchy.prepareHierarchyClosure('maker',{requestId:id(),viewId,expectedVersion:published.view.version,action:'CLOSE',reason:'DENIED'})).rejects.toThrow('ACCESS_DENIED');
      const direct = new Pool({connectionString:connection});
      try {
        await expect(direct.query('select department_master.hierarchy_publish($1,$2::uuid,$3,$4::jsonb)',['maker',candidateId,staged.digest,JSON.stringify({...candidate,nodes:checked.nodes,validationDigest:checked.digest})])).rejects.toThrow('ACCESS_DENIED');
      } finally { await direct.end(); }
      expect(await hierarchy.readHierarchySnapshot('maker',{viewId})).toEqual(published);
    });
    await withoutViewPermission('maker',viewId,'READ',async()=>{
      await expect(hierarchy.readHierarchySnapshot('maker',{viewId,version:published.view.version})).rejects.toThrow('ACCESS_DENIED');
      expect(await hierarchy.readHierarchySnapshot('maker',{viewId:secondViewId})).toBeNull();
      expect(await hierarchy.readHierarchySnapshot('reviewer',{viewId})).toEqual(published);
    });

    const renamed: HierarchyCandidateInput = {
      ...candidate,
      requestId: id(), sourceRecordId: 'ORG06:2', sourceVersion: '2', viewName: '行政视图改名',
      validFrom: '2027-09-01T00:00:00.000000', recordedAt: '2027-09-01T01:00:00.000000',
      nodes: [{
        sourceEvidence: edgeEvidence('clinical', '2027-09-01T00:00:00.000000'), nodeKey: 'clinical', parentNodeKey: null, nodeKind: 'GROUP', groupCode: 'CLINICAL',
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
    expect(renamedPublished.nodes[0]?.groupId).toBe(published.nodes[0]?.groupId);
    expect(renamedPublished.nodes[0]?.groupVersionId).not.toBe(published.nodes[0]?.groupVersionId);
    expect(renamedPublished.contentDigest).not.toBe(published.contentDigest);
    const replayAfterRename = await hierarchy.publishHierarchySnapshot('maker', { candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(replayAfterRename).toEqual(published);
    const foreign: HierarchyCandidateInput = { ...renamed, requestId: id(), viewId: secondViewId, sourceClientKey: 'ORG05-SYNTHETIC-MEDICAL', viewCode: 'MEDICAL', viewType: 'MEDICAL_RECORD' };
    const foreignStage = await hierarchy.importHierarchyCandidate('maker', foreign);
    if (!foreignStage.candidateId) throw new Error('CANDIDATE_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: foreignStage.candidateId, digest: foreignStage.digest });
    await expect(hierarchy.publishHierarchySnapshot('maker', { candidateId: foreignStage.candidateId, requestId: foreign.requestId, digest: foreignStage.digest })).rejects.toThrow('GROUP_REFERENCE_INVALID');
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId: secondViewId })).toBeNull();
  });

  it.each(['extra-field','duplicate-group'] as const)('SQL publication rejects %s without changing history', async defect => {
    const before = await hierarchy.readHierarchySnapshot('maker',{viewId});
    const group = before?.nodes[0];
    if (!group?.groupId || !group.groupVersionId) throw new Error('GROUP_REQUIRED');
    const node = {sourceEvidence:edgeEvidence('g1'),nodeKey:'g1',parentNodeKey:null,nodeKind:'GROUP',groupId:group.groupId,groupVersionId:group.groupVersionId,groupCode:'CLINICAL',displayName:group.displayName,relationName:'组织',sortOrder:1,isPrimaryPath:true,depth:0};
    const payload = {requestId:id(),viewId,sourceClientKey:'ORG05-SYNTHETIC-ADMIN',viewCode:'ADMIN',viewName:'SQL boundary',viewType:'ADMINISTRATIVE',parentCardinality:'STRICT_TREE',purpose:'SQL regression',aggregationRule:'NO_DUPLICATE',ownerDepartmentId,sourceSystemId,sourceRecordId:'SQL',sourceVersion:'1',validFrom:'2026-09-01T00:00:00.000000',validTo:null,recordedAt:'2026-09-01T01:00:00.000000',recordStatus:'ACTIVE',approvalRef:'SQL_APPROVAL',validationDigest:'a'.repeat(64),nodes:defect==='extra-field'?[{...node,unknownApprovedField:'must not disappear'}]:[node,{...node,nodeKey:'g2',sourceEvidence:edgeEvidence('g2')}]};
    const digest = id().replaceAll('-','')+id().replaceAll('-','');
    const pool = new Pool({connectionString:connection});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const stored = await client.query<{r:{candidateId:string}}>('select department_master.hierarchy_store_candidate($1,$2::jsonb) r',['maker',JSON.stringify({...payload,digest,payloadDigest:digest,envelope:{}})]);
      const candidateId = stored.rows[0]!.r.candidateId;
      await client.query('select department_master.hierarchy_approve($1,$2::uuid,$3)',['reviewer',candidateId,digest]);
      await expect(client.query('select department_master.hierarchy_publish($1,$2::uuid,$3,$4::jsonb)',['maker',candidateId,digest,JSON.stringify(payload)])).rejects.toThrow(defect==='extra-field'?'CLOSED_INPUT_REQUIRED':'GROUP_DUPLICATE');
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
    expect(await hierarchy.readHierarchySnapshot('maker',{viewId})).toEqual(before);
  });

  it('P2-02-AC-02 does not persist an invalid cycle candidate as a partial snapshot', async () => {
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId });
    const invalid: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG06:invalid', sourceVersion: 'invalid',
      validFrom: '2028-09-01T00:00:00.000000', validTo: null, recordedAt: '2028-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [
        { sourceEvidence: edgeEvidence('a', '2028-09-01T00:00:00.000000'), nodeKey: 'a', parentNodeKey: 'b', nodeKind: 'GROUP', groupCode: 'A', groupId: null, groupVersionId: null, displayName: 'A', relationName: '组织', sortOrder: 1, isPrimaryPath: true },
        { sourceEvidence: edgeEvidence('b', '2028-09-01T00:00:00.000000'), nodeKey: 'b', parentNodeKey: 'a', nodeKind: 'GROUP', groupCode: 'B', groupId: null, groupVersionId: null, displayName: 'B', relationName: '组织', sortOrder: 2, isPrimaryPath: true },
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
      nodes: [{ sourceEvidence: edgeEvidence('department'), nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId, departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
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
        { ...duplicateBase.nodes[0]!, nodeKey: 'b', sourceEvidence: edgeEvidence('department-b'), displayName: '同名科室 2' },
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
      nodes: [{ sourceEvidence: edgeEvidence('department'), nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId, departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
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
      nodes: [{ sourceEvidence: edgeEvidence('department'), nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId: dependency === 'node' ? finiteDepartmentId : departmentId, departmentVersionId: dependency === 'node' ? finiteDepartmentVersionId : departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    if (!staged.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: staged.candidateId, digest: staged.digest });
    await expect(hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: candidate.requestId, digest: staged.digest })).rejects.toThrow('BLOCKED_DEPENDENCY');
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId })).toEqual(before);
    const bounded = { ...candidate, requestId: id(), validTo: '2027-01-01T00:00:00.000000', nodes: candidate.nodes.map(node => ({ ...node, sourceEvidence: { ...node.sourceEvidence, validTo: '2027-01-01T00:00:00.000000' } })) };
    const boundedStage = await hierarchy.importHierarchyCandidate('maker', bounded);
    if (!boundedStage.candidateId) throw new Error('P2_02_CANDIDATE_ID_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: boundedStage.candidateId, digest: boundedStage.digest });
    const boundedSnapshot = await hierarchy.publishHierarchySnapshot('maker', { candidateId: boundedStage.candidateId, requestId: bounded.requestId, digest: boundedStage.digest });
    expect(boundedSnapshot.validTo).toBe('2027-01-01T00:00:00.000000');
  });

  it('resolves and freezes the historical SOURCE version despite a future published revision', async () => {
    const common = () => ({ scope: 'SYNTHETIC' as const, requestId: id(), reason: 'HIERARCHY_SOURCE_PERIOD' });
    let source = await catalog.command('maker', { ...common(), action: 'CREATE', kind: 'SOURCE', code: 'HIERARCHY_TEMPORAL_SOURCE', values: { name: 'Synthetic temporal source', environment: 'SYNTHETIC', sourceKind: 'MANUAL', deploymentScope: 'SYNTHETIC_ALL', businessOwnerRole: 'TEST', technicalRole: 'TEST', sourceEvidence: sourceSystemId }, validFrom: '2026-01-01T00:00:00', validTo: '2028-01-01T00:00:00' });
    source = await catalog.command('maker', { ...common(), action: 'SUBMIT', target: source.id, expectedHead: source.head });
    source = await catalog.command('reviewer', { ...common(), action: 'PUBLISH', target: source.id, expectedHead: source.head, reviewDigest: source.reviewDigest });
    const historicalVersion = source.versionId;
    source = await catalog.command('maker', { ...common(), action: 'REVISE', target: source.id, expectedHead: source.head, values: { name: 'Future source revision' }, validFrom: '2027-01-01T00:00:00', validTo: null });
    source = await catalog.command('maker', { ...common(), action: 'SUBMIT', target: source.id, expectedHead: source.head });
    source = await catalog.command('reviewer', { ...common(), action: 'PUBLISH', target: source.id, expectedHead: source.head, reviewDigest: source.reviewDigest, impactDigest: (await catalog.sourceImpact('reviewer', 'SYNTHETIC', source.id, 'PUBLISH')).impactDigest });
    temporalSource = source;
    const candidate: HierarchyCandidateInput = {
      requestId: id(), viewId, sourceClientKey: 'ORG05-SYNTHETIC-ADMIN', viewCode: 'ADMIN', viewName: '行政视图', viewType: 'ADMINISTRATIVE',
      parentCardinality: 'STRICT_TREE', purpose: '行政管理', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId: source.id,
      sourceRecordId: 'ORG06:historical-source', sourceVersion: '1', validFrom: '2026-09-01T00:00:00.000000', validTo: '2027-01-01T00:00:00.000000',
      recordedAt: '2026-09-01T01:00:00.000000', recordStatus: 'ACTIVE', approvalRef: 'SYNTHETIC-APPROVAL',
      nodes: [{ sourceEvidence: { ...edgeEvidence('department', '2026-09-01T00:00:00.000000', '2027-01-01T00:00:00.000000'), sourceSystemId: source.id }, nodeKey: 'department', parentNodeKey: null, nodeKind: 'DEPARTMENT', departmentId, departmentVersionId, displayName: '同名科室', relationName: '组织', sortOrder: 1, isPrimaryPath: true }],
    };
    const staged = await hierarchy.importHierarchyCandidate('maker', candidate);
    if (!staged.candidateId) throw new Error('CANDIDATE_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer', { candidateId: staged.candidateId, digest: staged.digest });
    const snapshot = await hierarchy.publishHierarchySnapshot('maker', { candidateId: staged.candidateId, requestId: candidate.requestId, digest: staged.digest });
    expect(snapshot.view.sourceDefinitionVersionId).toBe(historicalVersion);
    expect(snapshot.view.sourceDefinitionVersionId).not.toBe(source.versionId);
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

  it('publishes and reads frozen edge evidence over real HTTP with the generated client', async () => {
    const app = await buildCatalogServer(undefined, 'CONTROL_PLANE', undefined, undefined, undefined, undefined, undefined, undefined, {
      owner: hierarchy,
      actor: request => String(request.headers['x-catalog-actor'] ?? ''),
    });
    try {
      const address = await app.listen({ host: '127.0.0.1', port: 0 });
      const maker = createHierarchyClient(address, 'maker');
      const reviewer = createHierarchyClient(address, 'reviewer');
      const response = await maker.read({ viewId });
      expect(response.response.status).toBe(200);
      expect(response.data?.view.viewCode).toBe('ADMIN');
      const historical = await maker.read({ viewId, version: '2' });
      expect(historical.response.status).toBe(200);
      expect(historical.data?.nodes[0]?.groupCode).toBe('CLINICAL');
      expect(historical.data?.nodes[1]?.sourceEvidence?.approvalRef).toBe('CHILD_APPROVAL');
      const header = { requestId: id(), sourceClientKey: 'HTTP_VIEW', viewCode: 'HTTP', viewName: 'HTTP view', viewType: 'ADMINISTRATIVE' as const,
        purpose: 'API regression', aggregationRule: 'NO_DUPLICATE', ownerDepartmentId, sourceSystemId, sourceRecordId: 'ORG05:HTTP', sourceVersion: '1',
        validFrom: '2026-09-01T00:00:00.000000', validTo: null, recordedAt: '2026-09-01T01:00:00.000000', approvalRef: 'HTTP_APPROVAL' };
      const view = await maker.createView(header);
      expect(view.response.status).toBe(200);
      if (!view.data) throw new Error('HTTP_VIEW_REQUIRED');
      peer(receipt.name,`INSERT INTO department_master.hierarchy_grant(actor_code,object_id,permission) SELECT 'reviewer','${view.data.viewId}'::uuid,p FROM unnest(ARRAY['READ','REVIEW']) p;`);
      const candidate = { ...header, requestId: id(), viewId: view.data.viewId, parentCardinality: 'STRICT_TREE' as const, recordStatus: 'ACTIVE' as const,
        nodes: [{ sourceEvidence: edgeEvidence('http'), nodeKey: 'http', parentNodeKey: null, nodeKind: 'DEPARTMENT' as const, departmentId, departmentVersionId, displayName: 'HTTP department', relationName: '组织', sortOrder: 1, isPrimaryPath: true }] };
      const invalid = await maker.importCandidate({ ...candidate, requestId: id(), nodes: [{ ...candidate.nodes[0]!, parentNodeKey: '' }] });
      expect(invalid.data?.decision).toBe('FAIL');
      expect(invalid.data?.issues[0]?.code).toBe('PARENT_NOT_FOUND');
      const staged = await maker.importCandidate(candidate);
      expect(staged.response.status).toBe(200);
      expect(staged.data?.issues).toEqual([]);
      expect(staged.data?.decision).toBe('PASS');
      if (!staged.data?.candidateId) throw new Error('HTTP_CANDIDATE_REQUIRED');
      const approval = { candidateId: staged.data.candidateId, digest: staged.data.digest };
      expect((await maker.approve(approval)).response.status).not.toBe(200);
      expect((await reviewer.approve(approval)).response.status).toBe(200);
      const published = await maker.publish({ ...approval, requestId: candidate.requestId });
      expect(published.response.status).toBe(200);
      expect(published.data?.nodes[0]?.sourceEvidence).toEqual(candidate.nodes[0]!.sourceEvidence);
      const read = await maker.read({ viewId: view.data.viewId, version: published.data!.view.version });
      expect(read.data).toEqual(published.data);
      const closureRequest = id();
      const closure = await maker.prepareClosure({requestId:closureRequest,viewId:view.data.viewId,expectedVersion:published.data!.view.version,action:'REVOKE',reason:'HTTP_REVOKE'});
      expect(closure.response.status).toBe(200);
      if (!closure.data) throw new Error('HTTP_CLOSURE_REQUIRED');
      expect((await reviewer.approve(closure.data)).response.status).toBe(200);
      const revoked = await maker.close({...closure.data,requestId:closureRequest});
      expect(revoked.response.status).toBe(200);
      expect(revoked.data?.status).toBe('REVOKED');
      expect((await maker.read({viewId:view.data.viewId})).data).toBeNull();
    } finally {
      await app.close();
    }
  });

  it.each(['CLOSE','REVOKE'] as const)('%s remains non-expanding and preserves exact historical reads', async action => {
    const targetView = action === 'CLOSE' ? viewId : secondViewId;
    const before = await hierarchy.readHierarchySnapshot('maker', { viewId: targetView });
    if (!before) throw new Error('SNAPSHOT_REQUIRED');
    const input = { requestId: id(), viewId: targetView, expectedVersion: before.view.version, action, reason: 'SYNTHETIC_CLOSURE' };
    await expect(hierarchy.prepareHierarchyClosure('maker',{...input,expectedVersion:'999999'})).rejects.toThrow('STALE_VALIDATION');
    const staged = await hierarchy.prepareHierarchyClosure('maker', input);
    await expect(hierarchy.approveHierarchyCandidate('maker', staged)).rejects.toThrow('ACCESS_DENIED');
    await hierarchy.approveHierarchyCandidate('reviewer', staged);
    await withoutViewPermission('maker',targetView,'WRITE',async()=>{
      await expect(hierarchy.closeHierarchyView('maker',{...staged,requestId:input.requestId})).rejects.toThrow('ACCESS_DENIED');
    });
    await withoutViewPermission('reviewer',targetView,'REVIEW',async()=>{
      await expect(hierarchy.closeHierarchyView('maker',{...staged,requestId:input.requestId})).rejects.toThrow('ACCESS_DENIED');
    });
    if (action === 'CLOSE') {
      await catalog.command('reviewer', { action:'RETIRE', scope:'SYNTHETIC', requestId:id(), reason:'CLOSURE_UPSTREAM_REGRESSION', target:temporalSource.id, expectedHead:temporalSource.head, reviewDigest:temporalSource.reviewDigest, impactDigest:(await catalog.sourceImpact('reviewer','SYNTHETIC',temporalSource.id,'RETIRE')).impactDigest });
      await expect(catalog.resolveSource('maker','SYNTHETIC',temporalSource.id,'2026-09-01T00:00:00')).rejects.toThrow('SOURCE_NOT_READY');
    }
    const closed = await hierarchy.closeHierarchyView('maker', { ...staged, requestId: input.requestId });
    expect(closed.status).toBe(action === 'CLOSE' ? 'CLOSED' : 'REVOKED');
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId: targetView })).toBeNull();
    expect(await hierarchy.readHierarchySnapshot('maker', { viewId: targetView, version: before.view.version })).toEqual(before);
    expect(await hierarchy.closeHierarchyView('maker', { ...staged, requestId: input.requestId })).toEqual(closed);
    await expect(hierarchy.closeHierarchyView('maker',{...staged,requestId:id()})).rejects.toThrow('REQUEST_CONFLICT');
    await expect(hierarchy.prepareHierarchyClosure('maker',{...input,requestId:id()})).rejects.toThrow('HIERARCHY_CLOSED');
    const candidate: HierarchyCandidateInput = {
      requestId:id(),viewId:targetView,sourceClientKey:before.view.sourceClientKey,viewCode:before.view.viewCode,viewName:before.view.viewName,viewType:before.view.viewType,
      parentCardinality:'STRICT_TREE',purpose:'Lifecycle test',aggregationRule:'NO_DUPLICATE',ownerDepartmentId,sourceSystemId,sourceRecordId:'REOPEN',sourceVersion:'1',
      validFrom:'2026-09-01T00:00:00.000000',validTo:null,recordedAt:'2026-09-01T01:00:00.000000',recordStatus:'ACTIVE',approvalRef:'REOPEN',
      nodes:[{sourceEvidence:edgeEvidence('reopen'),nodeKey:'reopen',parentNodeKey:null,nodeKind:'DEPARTMENT',departmentId,departmentVersionId,displayName:'Reopen',relationName:'组织',sortOrder:1,isPrimaryPath:true}],
    };
    const expansion = await hierarchy.importHierarchyCandidate('maker',candidate);
    if (!expansion.candidateId) throw new Error('CANDIDATE_REQUIRED');
    await hierarchy.approveHierarchyCandidate('reviewer',{candidateId:expansion.candidateId,digest:expansion.digest});
    await expect(hierarchy.publishHierarchySnapshot('maker',{candidateId:expansion.candidateId,digest:expansion.digest,requestId:candidate.requestId})).rejects.toThrow('HIERARCHY_CLOSED');
  });

  afterAll(async () => { await hierarchy.close(); await department.close(); await catalog.close(); });
});
