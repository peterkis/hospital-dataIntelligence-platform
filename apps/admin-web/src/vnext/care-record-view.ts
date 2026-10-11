import type {ReferenceChoices} from './department-form.js';
import {careNames,record,text,type CareKind} from './care-model.js';

const labels:Record<string,string>={ACTIVE:'有效',SUSPENDED:'已暂停',RETIRED:'永久结束',CLOSED:'永久结束',NOT_EFFECTIVE:'当前未生效',CREATE:'建立',REVISE:'修订',REBIND:'调整归属',SUSPEND:'暂停',RESUME:'恢复',CLOSE:'永久结束',END:'结束关系',GRANT:'登记许可',RECORD:'登记',OPD:'门诊',IPD:'住院',ED:'急诊',EXAM:'体检',LAB:'检验',PHARMACY:'药房',OR:'手术',OTHER:'其他',ADMISSION:'收治',MANAGEMENT:'管理',PRIMARY:'主要',SECONDARY:'协作',BUILDING:'楼栋',FLOOR:'楼层',ROOM:'房间',AREA:'区域',SITE:'场地',MAPPING:'科目映射',PERMISSION:'科目许可',NORTH:'北院区',SOUTH:'南院区'};
export const careDisplay=(value:unknown)=>labels[text(value)]??'状态暂不可识别';
export const careTime=(value:unknown)=>text(value).replace('T',' ')||'未填写';
export function referenceName(choices:ReferenceChoices,owner:string,id:unknown){
 const found=choices[owner]?.find(choice=>choice.value===id);
 return found?.label.split(' · ').slice(0,2).join(' · ')??'关联名称暂不可读取';
}
export function careRecordView(value:unknown,kind:CareKind,choices:ReferenceChoices){
 const row=record(value),version=record(row['version']),facts=record(version['facts']??row['facts']);
 const binding=record(record(row['binding'])['binding']),scope=record(row['applicability']??row['scope']??facts['applicability']);
 const ref=(key:string)=>record(binding[key]??scope[key]);
 const relations=[['department','逻辑科室','department-master'],['campus','院区','organization-master/campus'],['subject','运营主体','organization-master'],['unit','业务单元','care-organization/unit'],['ward','病区','care-organization/ward'],['nursing','护理单元','care-organization/nursing'],['location','物理地点','location-master']] as const;
 const related=relations.flatMap(([key,label,owner])=>{const id=ref(key)['id']??(key==='department'?row['departmentId']:key==='campus'?row['campusId']:undefined);return id?[{label,owner,id:text(id),name:referenceName(choices,owner,id)}]:[];});
 const name=text(facts['unitName']??facts['nursingName']??facts['wardName']??facts['locationName']);
 const rawType=text(facts['unitType']??facts['wardType']??facts['locationType']??row['kind']??scope['purpose']);
 return {id:text(row['id']),name:name||related.filter(r=>r.label!=='院区').map(r=>r.name).join(' → ')||careNames[kind],code:text(facts['unitCode']??facts['nursingCode']??facts['wardCode']??facts['locationCode']??record(facts['adoption'])['code']),type:labels[rawType]??careNames[kind],state:text(row['state']),stateLabel:careDisplay(row['state']),head:text(row['head']??version['number']),validFrom:text(version['validFrom']??row['validFrom']),validTo:text(version['validTo']??row['validTo']),recordedAt:text(version['recordedAt']??row['recordedAt']),sourceRecordedAt:text(record(facts['source'])['sourceRecordedAt']),description:text(facts['serviceDescription']??facts['addressDetail']),related,facts};
}

export const careUuid=(value:string|null|undefined)=>!!value&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
/** Validate calendar dates without converting date-only business values through a client timezone. */
export function careDate(value:string|null){if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return '';const [year,month,day]=value.split('-').map(Number);const date=new Date(Date.UTC(year!,month!-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()+1===month&&date.getUTCDate()===day?value:'';}
