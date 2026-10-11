import {CareForm} from './care-form.js';
import {careForms} from './care-forms.generated.js';
import {record, text} from './care-model.js';
import type {FormSchema, ReferenceChoices} from './department-form.js';
import type {CareWorkspaceDraft} from '@hospital-data-intelligence/generated-api-client';
import {Input} from '../components/ui/input.js';
import {careEnumLabels} from './care-form-adapter.js';

const entrySchema: FormSchema = careForms.drafts.UNIT.properties.entries.items.anyOf[0];
const rowSchema = entrySchema.properties!['row']!;
export function newUnitCreatePayload(): Extract<CareWorkspaceDraft,{kind:'UNIT'}>['payload'] {
  return {timePolicy: 'LOCAL', entries: [{action: 'CREATE', row: {}, binding: {}}]};
}
function fields(schema: FormSchema, names: readonly string[]): FormSchema {
  return {...schema, properties: Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([key])=>names.includes(key)))};
}
/** A presentation adapter over the existing single-row CREATE contract. */
export function UnitCreateForm({value,onChange,choices,disabled}: {value: unknown; onChange: (value: unknown)=>void; choices: ReferenceChoices; disabled: boolean}) {
  const payload=record(value),entry=record((payload['entries'] as unknown[]|undefined)?.[0]),row=record(entry['row']);
  const changeEntry=(patch: Record<string,unknown>)=>onChange({...payload, entries:[{...entry,...patch,action:'CREATE'}]});
  const changeRow=(field: string,next: string)=>changeEntry({row:{...row,[field]:next}});
  const rowGroup=(names: readonly string[]) => <CareForm schema={fields(rowSchema,names)} value={row} onChange={next=>changeEntry({row:{...row,...record(next)}})} choices={choices} disabled={disabled}/>;
  return <div className="unit-create-form">
    <section><h3>基本资料</h3><div className="workspace-form"><label>业务单元名称<Input value={text(row['unit_name'])} onChange={event=>changeRow('unit_name',event.target.value)} disabled={disabled} maxLength={160}/></label><label>业务单元代码<Input value={text(row['unit_code'])} onChange={event=>changeRow('unit_code',event.target.value)} disabled={disabled} maxLength={256}/></label><label>业务单元类型<select aria-label="业务单元类型" value={text(row['unit_type'])} onChange={event=>changeRow('unit_type',event.target.value)} disabled={disabled}><option value="">请选择业务类型</option>{rowSchema.properties!['unit_type']!.enum!.map(value=><option key={String(value)} value={String(value)}>{careEnumLabels[String(value)]??String(value)}</option>)}</select></label><label>公开电话<Input value={text(row['public_phone'])} onChange={event=>changeRow('public_phone',event.target.value)} disabled={disabled} maxLength={256}/></label><label>服务说明<textarea value={text(row['service_description'])} onChange={event=>changeRow('service_description',event.target.value)} disabled={disabled} maxLength={2000}/></label></div></section>
    <section><h3>组织归属</h3><p className="muted">按可读名称选择关联记录；科室、院区、运营主体和已接受关系分别核对。</p>{rowGroup(['org_id','campus_id','legal_entity_id'])}<CareForm schema={fields(entrySchema,['binding'])} value={entry} onChange={next=>changeEntry(record(next))} choices={choices} disabled={disabled}/></section>
    <section><h3>业务期间与理由</h3>{rowGroup(['valid_from','valid_to'])}<CareForm schema={fields(entrySchema,['reason'])} value={entry} onChange={next=>changeEntry(record(next))} choices={choices} disabled={disabled}/></section>
    <section><h3>来源与依据</h3><p className="muted">填写实际合成材料中的来源信息，上传依据后由服务器绑定材料。草稿允许暂不完整。</p>{rowGroup(['unit_id','source_record_id','version_no','recorded_at','record_status','approval_ref','receiving_rule_ref','business_owner_id'])}<p role="status">{text(entry['evidenceId'])?'已绑定受保护材料。':'尚未上传并绑定依据材料。'}</p></section>
    <details><summary>准确来源和时间解释</summary><CareForm schema={fields(careForms.drafts.UNIT,['timePolicy'])} value={payload} onChange={next=>onChange({...payload,...record(next)})} choices={choices} disabled={disabled}/>{rowGroup(['source_system_id'])}</details>
  </div>;
}
