import {createBusinessUnitClient, type CareWorkspaceDraft} from '@hospital-data-intelligence/generated-api-client';
import {departmentValue} from './department-request.js';
import {record, text} from './care-model.js';

export type UnitFields = {name: string; phone: string; description: string; reason: string};
export const unitFieldLabels: Record<keyof UnitFields, string> = {name: '业务单元名称', phone: '公开电话', description: '服务说明', reason: '修订理由'};
export type UnitDraft = Extract<CareWorkspaceDraft, {kind: 'UNIT'}>;
type DraftEntry = NonNullable<UnitDraft['payload']['entries']>[number];
export type RevisionEntry = DraftEntry & {action: 'REVISE'; row: NonNullable<DraftEntry['row']>; target: {owner: 'care-organization/unit'; id: string; expectedHead: string}};

export function unitEntry(draft: UnitDraft): RevisionEntry {
  const entries = draft.payload.entries;
  if (!entries || entries.length !== 1 || entries[0]?.action !== 'REVISE' || !entries[0].target || !entries[0].row) {
    throw new Error('此入口只处理一个既有业务单元的属性修订，请返回原维护入口。');
  }
  return entries[0] as RevisionEntry;
}
export function unitFields(draft: UnitDraft): UnitFields {
  const entry = unitEntry(draft);
  return {name: entry.row.unit_name ?? '', phone: entry.row.public_phone ?? '', description: entry.row.service_description ?? '', reason: entry.reason ?? ''};
}
export function editUnitDraft(draft: UnitDraft, fields: UnitFields): UnitDraft {
  const entry = unitEntry(draft);
  return {...draft, payload: {...draft.payload, entries: [{...entry, reason: fields.reason, row: {...entry.row,
    unit_name: fields.name, public_phone: fields.phone, service_description: fields.description}}]}};
}
export function mergeUnitFields(base: UnitFields, mine: UnitFields, server: UnitFields): UnitFields {
  return Object.fromEntries((Object.keys(base) as (keyof UnitFields)[]).map(field => [field, mine[field] !== base[field] ? mine[field] : server[field]])) as UnitFields;
}
export function mergeUnitDraftConflict(base:UnitFields,mine:UnitDraft,fields:UnitFields,server:UnitDraft,keepMine:boolean,materialChanged:boolean):{draft:UnitDraft;fields:UnitFields;materialDirty:boolean}{
 const local=unitEntry(mine),remote=unitEntry(server);
 if(local.target.id!==remote.target.id||local.target.owner!==remote.target.owner)throw new Error('服务器草稿改变了目标身份，请在完整维护入口核对。');
 const evidenceId=keepMine&&materialChanged?local.evidenceId:remote.evidenceId;
 const entry={...remote};if(evidenceId===undefined)delete entry.evidenceId;else entry.evidenceId=evidenceId;
 return {draft:{...server,payload:{...server.payload,entries:[entry]}},fields:keepMine?mergeUnitFields(base,fields,unitFields(server)):unitFields(server),materialDirty:evidenceId!==remote.evidenceId};
}
export function validateUnitFields(fields: UnitFields): Partial<Record<keyof UnitFields, string>> {
  const errors: Partial<Record<keyof UnitFields, string>> = {};
  if (!fields.name.trim()) errors.name = '请填写业务单元名称。';
  if (fields.name.length > 160) errors.name = '名称最多160个字符。';
  if (fields.phone.length > 256) errors.phone = '公开电话最多256个字符。';
  if (fields.description.length > 2000) errors.description = '服务说明最多2000个字符。';
  if (!fields.reason.trim()) errors.reason = '请说明本次修订理由。';
  if (fields.reason.length > 2000) errors.reason = '修订理由最多2000个字符。';
  return errors;
}
/** Read both the latest accepted head and the protected producer row before editing. */
export async function prepareUnitDraft(actor: string, id: string): Promise<{draft: UnitDraft; sourceInputId: string; contractVersionId: string}> {
  const client = createBusinessUnitClient(location.origin, actor), history = await departmentValue(client.history({id}));
  if (!history.versions.length) throw new Error('缺少已接受的业务单元版本。');
  const latest = history.versions.reduce((head, version) => BigInt(version.number) > BigInt(head.number) ? version : head);
  if (latest.action === 'CLOSE') throw new Error('业务单元已永久结束，不能修订属性。');
  const declaration = history.versions.filter(version => ['CREATE', 'REVISE'].includes(version.action)).at(-1);
  if (!declaration) throw new Error('缺少可读取的原属性版本。');
  const locator = declaration.facts.source.recordLocatorEvidence, original = await departmentValue(client.readInput({inputId: locator.inputId}));
  const index = original.sourceRows ? original.sourceRows.indexOf(locator.row) : locator.row - 1, entry = original.entries[index];
  if (!entry) throw new Error('原来源行定位不匹配，不能准备修订。');
  const unitType = (['OPD', 'IPD', 'ED', 'EXAM', 'LAB', 'PHARMACY', 'OR', 'OTHER'] as const).find(value => value === entry.row.unit_type);
  const status = (['DRAFT', 'REVIEW', 'ACTIVE', 'SUSPENDED', 'RETIRED'] as const).find(value => value === entry.row.record_status);
  if (!unitType || !status) throw new Error('原来源分类或状态不属于当前已采用的直接维护词汇，请核对准确契约。');
  const draft: UnitDraft = {kind: 'UNIT', campus: original.campus, profile: original.profile, requestId: crypto.randomUUID(),
    payload: {timePolicy: original.timePolicy, entries: [{action: 'REVISE', target: {owner: 'care-organization/unit', id, expectedHead: latest.number},
      row: {...entry.row, unit_type: unitType, record_status: status}, evidenceId: entry.evidenceId, reason: ''}]}};
  return {draft, sourceInputId: locator.inputId, contractVersionId: declaration.facts.contractVersionId};
}
export function unitBusinessError(error: unknown): string {
  const code = text(record(error)['code']);
  if (code === 'ACCESS_DENIED') return '当前权限已变化，服务器拒绝了操作。请重新核对权限。';
  if (code === 'PAYLOAD_UNAVAILABLE') return '依据内容当前不可读取，请补齐当前可读取的合成依据。';
  if (code === 'STALE_HEAD') return '服务器已有较新版本。你的输入已保留，请读取并比较最新内容。';
  if (code === 'SELF_APPROVAL_FORBIDDEN' || code === 'SELF_REVIEW_FORBIDDEN') return '提交人与核验或审批人必须是不同主体。';
  return error instanceof Error ? error.message : '请求未完成，请核对原请求结果。';
}
