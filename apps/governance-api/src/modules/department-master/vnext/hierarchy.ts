import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, types } from 'pg';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import type { DB } from '../../../platform/database/vnext-types.generated.js';
import { localTime } from '../../organization-master/index.js';
import { canonicalPlan, planBinding, type KeyProviderPort } from '../../governance-catalog/index.js';

const closed = { additionalProperties: false } as const;
export const HierarchyId = Type.String({ pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' });
const text = (maxLength = 2000) => Type.String({ minLength: 1, maxLength, pattern: '\\S' });
const nullableId = Type.Union([HierarchyId, Type.Null()]);
const nullableText = (maxLength = 2000) => Type.Union([Type.String({ maxLength }), Type.Null()]);
export const HierarchyLocalTime = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,6})?$' });
export const HierarchyNullableLocalTime = Type.Union([HierarchyLocalTime, Type.Null()]);

const DepartmentNode = Type.Object({
  nodeKey: text(128),
  parentNodeKey: nullableText(128),
  nodeKind: Type.Literal('DEPARTMENT'),
  departmentId: HierarchyId,
  departmentVersionId: HierarchyId,
  displayName: text(256),
  relationName: text(128),
  sortOrder: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  isPrimaryPath: Type.Boolean(),
}, closed);

const GroupNode = Type.Object({
  nodeKey: text(128),
  parentNodeKey: nullableText(128),
  nodeKind: Type.Literal('GROUP'),
  groupCode: text(128),
  groupId: nullableId,
  groupVersionId: nullableId,
  displayName: text(256),
  relationName: text(128),
  sortOrder: Type.Integer({ minimum: 0, maximum: 2147483647 }),
  isPrimaryPath: Type.Boolean(),
}, closed);

export const HierarchyNodeSchema = Type.Union([DepartmentNode, GroupNode]);
export type HierarchyNodeInput = Static<typeof HierarchyNodeSchema>;

export const HierarchyCandidateSchema = Type.Object({
  requestId: HierarchyId,
  viewId: nullableId,
  sourceClientKey: text(128),
  viewCode: text(64),
  viewName: text(256),
  viewType: Type.Union([
    Type.Literal('ADMINISTRATIVE'), Type.Literal('OPERATIONAL'), Type.Literal('MEDICAL_RECORD'),
    Type.Literal('FINANCE'), Type.Literal('STATISTICAL'),
  ]),
  parentCardinality: Type.Literal('STRICT_TREE'),
  purpose: text(2000),
  aggregationRule: text(2000),
  ownerDepartmentId: nullableId,
  sourceSystemId: HierarchyId,
  sourceRecordId: text(256),
  sourceVersion: text(64),
  validFrom: HierarchyLocalTime,
  validTo: HierarchyNullableLocalTime,
  recordedAt: HierarchyLocalTime,
  recordStatus: Type.Literal('ACTIVE'),
  approvalRef: text(256),
  nodes: Type.Array(HierarchyNodeSchema, { minItems: 1, maxItems: 100 }),
}, closed);
export type HierarchyCandidateInput = Static<typeof HierarchyCandidateSchema>;

export const CreateHierarchyViewSchema = Type.Object({
  requestId: HierarchyId,
  sourceClientKey: text(128), viewCode: text(64), viewName: text(256),
  viewType: HierarchyCandidateSchema.properties.viewType,
  purpose: text(2000), aggregationRule: text(2000), ownerDepartmentId: nullableId,
  sourceSystemId: HierarchyId, sourceRecordId: text(256), sourceVersion: text(64),
  validFrom: HierarchyLocalTime, validTo: HierarchyNullableLocalTime, recordedAt: HierarchyLocalTime,
  approvalRef: text(256),
}, closed);
export type CreateHierarchyViewInput = Static<typeof CreateHierarchyViewSchema>;

export const HierarchyPublishSchema = Type.Object({
  candidateId: HierarchyId,
  requestId: HierarchyId,
  digest: Type.String({ pattern: '^[a-f0-9]{64}$' }),
}, closed);
export type HierarchyPublishInput = Static<typeof HierarchyPublishSchema>;

export type ValidatedHierarchyNode = HierarchyNodeInput & { readonly depth: number };
export interface ForestValidation { readonly nodes: readonly ValidatedHierarchyNode[]; readonly digest: string }
export interface HierarchyIssue { readonly code: string; readonly nodeKey?: string; readonly field?: string }
export interface HierarchyViewRecord {
  readonly ownerDepartmentVersionId: string | null; readonly sourceDefinitionVersionId: string | null;
  readonly id: string; readonly sourceClientKey: string; readonly viewCode: string; readonly viewName: string;
  readonly viewType: HierarchyCandidateInput['viewType']; readonly purpose: string; readonly aggregationRule: string;
  readonly ownerDepartmentId: string | null; readonly sourceSystemId: string; readonly sourceRecordId: string;
  readonly sourceVersion: string; readonly approvalRef: string; readonly status: 'PUBLISHED';
  readonly version: string; readonly contentDigest: string;
}
export interface HierarchySnapshot {
  readonly view: HierarchyViewRecord; readonly validFrom: string; readonly validTo: string | null;
  /** Source `recorded_at`, retained as the compatibility alias `recordedAt`. */
  readonly sourceRecordedAt: string; readonly recordedAt: string;
  /** Platform record time assigned by the hierarchy version row. */
  readonly recordedFrom: string;
  readonly nodes: readonly (ValidatedHierarchyNode & { readonly nodeId: string; readonly departmentId: string | null; readonly departmentVersionId: string | null; readonly groupId: string | null; readonly groupVersionId: string | null })[];
  readonly contentDigest: string;
}

function assertCandidate(value: unknown): asserts value is HierarchyCandidateInput {
  if (!Check(HierarchyCandidateSchema, value)) throw new Error('CLOSED_INPUT_REQUIRED');
}

function normalizeTime(value: string): string {
  return localTime(value);
}

function issue(code: string, nodeKey?: string, field?: string): never {
  const error = new Error(code) as Error & { nodeKey?: string; field?: string };
  if (nodeKey !== undefined) error.nodeKey = nodeKey;
  if (field !== undefined) error.field = field;
  throw error;
}

/** Pure, deterministic validation for one complete strict tree/forest. */
export function validateHierarchyForest(value: unknown): ForestValidation {
  assertCandidate(value);
  const from = normalizeTime(value.validFrom);
  const to = value.validTo === null ? null : normalizeTime(value.validTo);
  normalizeTime(value.recordedAt);
  if (to !== null && to <= from) issue('INVALID_BUSINESS_PERIOD', undefined, 'validTo');
  if (value.viewType === 'FINANCE' || value.viewType === 'STATISTICAL') issue('VIEW_TYPE_NOT_OPERATIONAL');

  const byKey = new Map<string, HierarchyNodeInput>();
  const departments = new Set<string>();
  const groups = new Set<string>();
  for (const node of value.nodes) {
    if (byKey.has(node.nodeKey)) issue('DUPLICATE_NODE_KEY', node.nodeKey);
    byKey.set(node.nodeKey, node);
    if (node.parentNodeKey === node.nodeKey) issue('SELF_PARENT', node.nodeKey, 'parentNodeKey');
    if (node.nodeKind === 'DEPARTMENT') {
      if (departments.has(node.departmentId)) issue('DEPARTMENT_DUPLICATE', node.nodeKey, 'departmentId');
      departments.add(node.departmentId);
    } else {
      if (groups.has(node.groupCode)) issue('GROUP_DUPLICATE', node.nodeKey, 'groupCode');
      groups.add(node.groupCode);
      if (node.groupId !== null && node.groupVersionId === null) issue('GROUP_VERSION_REQUIRED', node.nodeKey, 'groupVersionId');
      if (node.groupId === null && node.groupVersionId !== null) issue('GROUP_ID_REQUIRED', node.nodeKey, 'groupId');
    }
  }
  for (const node of value.nodes) {
    if (node.parentNodeKey !== null && !byKey.has(node.parentNodeKey)) issue('PARENT_NOT_FOUND', node.nodeKey, 'parentNodeKey');
  }
  const marks = new Map<string, number>();
  const depth = new Map<string, number>();
  const visit = (key: string): number => {
    const mark = marks.get(key) ?? 0;
    if (mark === 1) issue('HIERARCHY_CYCLE', key);
    if (mark === 2) return depth.get(key)!;
    marks.set(key, 1);
    const node = byKey.get(key)!;
    const d = node.parentNodeKey === null ? 0 : visit(node.parentNodeKey) + 1;
    depth.set(key, d);
    marks.set(key, 2);
    return d;
  };
  for (const node of value.nodes) visit(node.nodeKey);
  const normalized = value.nodes.map(node => ({ ...node, depth: depth.get(node.nodeKey)! }));
  const digest = createHash('sha256').update('HIERARCHY_VALIDATION_V1\0').update(canonicalPlan({ ...value, validFrom: from, validTo: to, nodes: normalized })).digest('hex');
  return { nodes: normalized, digest };
}

interface Envelope { keyId: string; nonce: string; tag: string; ciphertext: string }
interface StoredCandidate { id: string; digest: string; maker: string; makerIdentity: string; requestId: string; status: string; envelope: Envelope; approvedBy: string | null; payload: HierarchyCandidateInput }

function seal(value: unknown, provider?: KeyProviderPort): { digest: string; envelope: Envelope } {
  if (!provider) throw new Error('KEY_UNAVAILABLE');
  const digest = planBinding(provider, 'HIERARCHY_CANDIDATE_V1', value);
  const current = provider.current();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', current.key, nonce);
  cipher.setAAD(Buffer.from(`HIERARCHY_CANDIDATE_V1\\0${digest}`));
  const bytes = Buffer.from(canonicalPlan(value));
  try {
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return { digest, envelope: { keyId: current.id, nonce: nonce.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') } };
  } finally { bytes.fill(0); }
}

function unseal<T>(candidate: StoredCandidate, provider: KeyProviderPort | undefined): T {
  if (!provider) throw new Error('KEY_UNAVAILABLE');
  try {
    const d = createDecipheriv('aes-256-gcm', provider.payload(candidate.envelope.keyId), Buffer.from(candidate.envelope.nonce, 'hex'));
    d.setAAD(Buffer.from(`HIERARCHY_CANDIDATE_V1\\0${candidate.digest}`));
    d.setAuthTag(Buffer.from(candidate.envelope.tag, 'hex'));
    const bytes = Buffer.concat([d.update(Buffer.from(candidate.envelope.ciphertext, 'hex')), d.final()]);
    try {
      const value = JSON.parse(bytes.toString()) as T;
      if (planBinding(provider, 'HIERARCHY_CANDIDATE_V1', value) !== candidate.digest) throw new Error('PAYLOAD_UNAVAILABLE');
      return value;
    } finally { bytes.fill(0); }
  } catch { throw new Error('PAYLOAD_UNAVAILABLE'); }
}

function mapNode(row: Record<string, unknown>): SnapshotNode {
  return {
    ...(row['node_kind'] === 'GROUP' ? { groupCode: String(row['group_code']) } : {}),
    nodeKey: String(row['node_key']), parentNodeKey: row['parent_node_key'] === null ? null : String(row['parent_node_key']),
    nodeKind: row['node_kind'] as 'DEPARTMENT' | 'GROUP', displayName: String(row['display_name']),
    relationName: String(row['relation_name']), sortOrder: Number(row['sort_order']), isPrimaryPath: Boolean(row['is_primary_path']),
    depth: Number(row['depth']), nodeId: String(row['node_id']), departmentId: row['department_id'] === null ? null : String(row['department_id']),
    departmentVersionId: row['department_version_id'] === null ? null : String(row['department_version_id']),
    groupId: row['group_id'] === null ? null : String(row['group_id']), groupVersionId: row['group_version_id'] === null ? null : String(row['group_version_id']),
  } as SnapshotNode;
}
type SnapshotNode = ValidatedHierarchyNode & { nodeId: string; departmentId: string | null; departmentVersionId: string | null; groupId: string | null; groupVersionId: string | null };

function formatLocalDbTime(value: unknown): string {
  if (typeof value !== 'string') throw new Error('LOCAL_TIME_REQUIRED');
  return localTime(value.replace(' ', 'T'));
}

/** vNext database owner for ORG05/ORG06. All writes use complete candidates. */
export function openHierarchy(connection: string, provider?: KeyProviderPort) {
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: connection, max: 4, options: '-c timezone=Asia/Shanghai', types: { getTypeParser: (oid, format) => oid === 1114 ? (value: string) => value : types.getTypeParser(oid, format) } }) }) });
  const root = <T>(work: (trx: Kysely<DB>) => Promise<T>) => db.transaction().execute(async trx => { await sql`select pg_advisory_xact_lock(901002)`.execute(trx); return work(trx); });
  const authorize = async (trx: Kysely<DB>, actor: string, permission: 'READ' | 'WRITE' | 'REVIEW') => (await sql<{ r: string }>`select department_master.authorize(${actor},'HOSPITAL',${permission}) r`.execute(trx)).rows[0]!.r;
  const readCandidate = async (trx: Kysely<DB>, actor: string, id: string): Promise<StoredCandidate> => {
    await authorize(trx, actor, 'READ');
    const row = (await sql<StoredCandidate>`select id,digest,maker,maker_identity as "makerIdentity",request_id as "requestId",status,envelope,approved_by as "approvedBy",payload from department_master.hierarchy_candidate where id=${id}::uuid`.execute(trx)).rows[0];
    if (!row) throw new Error('NOT_FOUND');
    return row;
  };
  const snapshot = async (trx: Kysely<DB>, actor: string, viewId: string, version?: string): Promise<HierarchySnapshot | null> => {
    await authorize(trx, actor, 'READ');
    const v = (await sql<Record<string, unknown>>`select v.id,v.view_id,v.version_no,h.source_client_key,v.view_name,v.view_code,v.view_type,v.purpose,v.aggregation_rule,v.owner_department_id,v.owner_department_version_id,v.source_definition_version_id,v.source_system_id,v.source_record_id,v.source_version,v.valid_from,v.valid_to,v.recorded_at,v.approval_ref,v.status,v.created_at,v.content_digest from department_master.hierarchy_view_version v join department_master.hierarchy_view h on h.id=v.view_id where v.view_id=${viewId}::uuid and v.status='PUBLISHED' and (${version ?? null}::bigint is null or v.version_no=${version ?? null}::bigint) order by v.version_no desc limit 1`.execute(trx)).rows[0];
    if (!v) return null;
    const rows = (await sql<Record<string, unknown>>`select node_id,node_key,parent_node_key,node_kind,group_code,department_id,department_version_id,group_id,group_version_id,display_name,relation_name,sort_order,is_primary_path,depth from department_master.hierarchy_node where view_version_id=${String(v['id'])}::uuid order by depth,sort_order,node_key`.execute(trx)).rows;
    const sourceRecordedAt = formatLocalDbTime(v['recorded_at']);
    return {
      view: {
        ownerDepartmentVersionId: v['owner_department_version_id'] === null ? null : String(v['owner_department_version_id']),
        sourceDefinitionVersionId: v['source_definition_version_id'] === null ? null : String(v['source_definition_version_id']),
        id: String(v['view_id']), sourceClientKey: String(v['source_client_key']), viewCode: String(v['view_code']), viewName: String(v['view_name']),
        viewType: v['view_type'] as HierarchyCandidateInput['viewType'], purpose: String(v['purpose']), aggregationRule: String(v['aggregation_rule']),
        ownerDepartmentId: v['owner_department_id'] === null ? null : String(v['owner_department_id']), sourceSystemId: String(v['source_system_id']),
        sourceRecordId: String(v['source_record_id']), sourceVersion: String(v['source_version']), approvalRef: String(v['approval_ref']),
        status: v['status'] as 'PUBLISHED', version: String(v['version_no']), contentDigest: String(v['content_digest']),
      },
      validFrom: formatLocalDbTime(v['valid_from']), validTo: v['valid_to'] === null ? null : formatLocalDbTime(v['valid_to']),
      sourceRecordedAt, recordedAt: sourceRecordedAt, recordedFrom: formatLocalDbTime(v['created_at']),
      nodes: rows.map(mapNode), contentDigest: String(v['content_digest']),
    };
  };
  return {
    async validateForest(value: unknown) { return validateHierarchyForest(value); },
    async createHierarchyView(actor: string, input: CreateHierarchyViewInput): Promise<{ viewId: string; sourceClientKey: string; viewCode: string }> {
      if (!Check(CreateHierarchyViewSchema, input)) throw new Error('CLOSED_INPUT_REQUIRED');
      const validFrom = normalizeTime(input.validFrom); const validTo = input.validTo === null ? null : normalizeTime(input.validTo); normalizeTime(input.recordedAt);
      if (validTo !== null && validTo <= validFrom) throw new Error('INVALID_BUSINESS_PERIOD');
      return root(async trx => {
        const result = (await sql<{ result: { viewId: string } }>`select department_master.hierarchy_create_view(${actor},${JSON.stringify({ ...input, validFrom, validTo, viewDigest: planBinding(provider,'HIERARCHY_VIEW_V1',input) })}::jsonb) result`.execute(trx)).rows[0]!.result;
        return { viewId: result.viewId, sourceClientKey: input.sourceClientKey, viewCode: input.viewCode };
      });
    },
    async importHierarchyCandidate(actor: string, value: HierarchyCandidateInput): Promise<{ candidateId: string | null; digest: string; decision: 'PASS' | 'FAIL'; issues: readonly HierarchyIssue[] }> {
      assertCandidate(value);
      const sealed = seal(value, provider);
      let validated: ForestValidation;
      try {
        validated = validateHierarchyForest(value);
      } catch (error) {
        const detail = error as Error & { nodeKey?: string; field?: string };
        return {
          candidateId: null,
          digest: sealed.digest,
          decision: 'FAIL',
          issues: [{ code: detail.message, ...(detail.nodeKey ? { nodeKey: detail.nodeKey } : {}), ...(detail.field ? { field: detail.field } : {}) }],
        };
      }
      return root(async trx => {
        const makerIdentity = await authorize(trx, actor, 'WRITE');
        if (value.viewId === null) {
          const row = (await sql<{ id: string }>`select id from department_master.hierarchy_view where source_client_key=${value.sourceClientKey}`.execute(trx)).rows[0];
          if (!row) throw new Error('BLOCKED_DEPENDENCY');
        }
        const existing = (await sql<{ id: string; digest: string; status: string }>`select id,digest,status from department_master.hierarchy_candidate where request_id=${value.requestId}::uuid`.execute(trx)).rows[0];
        if (existing) { if (existing.digest !== sealed.digest) throw new Error('REQUEST_CONFLICT'); return { candidateId: existing.id, digest: existing.digest, decision: existing.status === 'REJECTED' ? 'FAIL' : 'PASS', issues: [] }; }
        const stored = (await sql<{ result: { candidateId: string } }>`select department_master.hierarchy_store_candidate(${actor},${JSON.stringify({ ...value, nodes: validated.nodes, validationDigest: validated.digest, digest: sealed.digest, envelope: sealed.envelope, payloadDigest: createHash('sha256').update(canonicalPlan(value)).digest('hex'), makerIdentity })}::jsonb) result`.execute(trx)).rows[0]!.result;
        const id = stored.candidateId;
        return { candidateId: id, digest: sealed.digest, decision: 'PASS' as const, issues: [] };
      });
    },
    async approveHierarchyCandidate(actor: string, input: { candidateId: string; digest: string }): Promise<{ candidateId: string; approvedBy: string }> {
      if (!Check(HierarchyPublishSchema, { candidateId: input.candidateId, requestId: randomUUID(), digest: input.digest })) throw new Error('CLOSED_INPUT_REQUIRED');
      return root(async trx => {
        const candidate = await readCandidate(trx, actor, input.candidateId); if (candidate.digest !== input.digest) throw new Error('STALE_VALIDATION');
        const identity = await authorize(trx, actor, 'REVIEW'); if (identity === candidate.makerIdentity) throw new Error('MAKER_CHECKER_REQUIRED');
        if (candidate.status === 'APPLIED') throw new Error('ALREADY_COMMITTED');
        await sql`select department_master.hierarchy_approve(${actor},${input.candidateId}::uuid,${input.digest})`.execute(trx);
        return { candidateId: input.candidateId, approvedBy: actor };
      });
    },
    async publishHierarchySnapshot(actor: string, input: HierarchyPublishInput): Promise<HierarchySnapshot> {
      if (!Check(HierarchyPublishSchema, input)) throw new Error('CLOSED_INPUT_REQUIRED');
      return root(async trx => {
        const candidate = await readCandidate(trx, actor, input.candidateId); if (candidate.digest !== input.digest) throw new Error('STALE_VALIDATION');
        if (candidate.status === 'APPLIED') {
          const value = unseal<HierarchyCandidateInput>(candidate, provider);
          const checked = validateHierarchyForest(value);
          const versions = (await sql<{ viewId: string; version: string }>`
            select v.view_id as "viewId", v.version_no::text as version
            from department_master.hierarchy_view_version v
            join department_master.hierarchy_view h on h.id=v.view_id
            where h.source_client_key=${value.sourceClientKey}
              and v.content_digest=${checked.digest} and v.status='PUBLISHED'
          `.execute(trx)).rows;
          if (versions.length !== 1) throw new Error('STALE_VALIDATION');
          const published = versions[0]!;
          const existing = await snapshot(trx, actor, published.viewId, published.version);
          if (!existing) throw new Error('NOT_FOUND');
          return existing;
        }
        if (candidate.status !== 'APPROVED' || candidate.approvedBy === null) throw new Error('APPROVAL_REQUIRED');
        const approverIdentity = await authorize(trx, candidate.approvedBy, 'REVIEW'); if (approverIdentity === candidate.makerIdentity) throw new Error('MAKER_CHECKER_REQUIRED');
        const value = unseal<HierarchyCandidateInput>(candidate, provider); const checked = validateHierarchyForest(value);
        const result = (await sql<{ result: { viewId: string; version: string } }>`select department_master.hierarchy_publish(${actor},${candidate.id}::uuid,${input.digest},${JSON.stringify({ ...value, nodes: checked.nodes, validationDigest: checked.digest })}::jsonb) result`.execute(trx)).rows[0]!.result;
        const published = await snapshot(trx, actor, result.viewId, result.version); if (!published) throw new Error('APPLY_FAILED'); return published;
      });
    },
    async readHierarchySnapshot(actor: string, input: { viewId: string; version?: string }) { return root(trx => snapshot(trx, actor, input.viewId, input.version)); },
    async close() { await db.destroy(); },
  };
}
