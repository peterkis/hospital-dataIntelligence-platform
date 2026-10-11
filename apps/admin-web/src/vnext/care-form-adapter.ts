import type {FormSchema,ReferenceChoices} from './department-form.js';

/** Display labels only. The finite contract values are sent unchanged. */
export const careEnumLabels:Readonly<Record<string,string>>={
 CORE:'核心维护',FULL:'完整依赖维护',SOURCE_PLUS08_TO_LOCAL:'来源东八区时间',
 OPD:'门诊单元',IPD:'住院单元',ED:'急诊单元',EXAM:'检查单元',LAB:'检验单元',PHARMACY:'药房',OR:'手术单元',OTHER:'其他',
 UNIT:'业务单元',WARD:'病区',NURSING:'护理单元',LOCATION:'物理地点',UNIT_WARD:'科室病区关系',WARD_NURSING:'护理覆盖',LOCATION_USE:'地点使用',CAPABILITY:'业务能力',PERMISSION:'科目许可',
 BUILDING:'楼栋',FLOOR:'楼层',ROOM:'房间',CLINIC_ROOM:'诊室',OPERATING_ROOM:'手术室',DISPENSING_WINDOW:'发药窗口',WAREHOUSE:'库房',
 REBIND:'变更归属',GRANT:'授予许可',ACTIVATE:'启用',RECORD:'记录',RETIRE:'永久退出',MOVE_CONTAINMENT:'调整物理父地点',
 ADMISSION:'收治',MANAGEMENT:'管理',NURSING_COVERAGE:'护理覆盖',NO_SHARING_REQUIRED:'无需共享',SHARED_BOUNDARY:'已明确共享边界',
 COVERAGE:'护理覆盖',WHOLE_WARD:'整个病区',PARTITIONS:'指定护理分区',SCOPE_DEFINITION:'新建分区定义',SCOPE_REVISION:'修订分区定义',
 NO_ADDITIONAL_RULE:'无附加规则',BOOLEAN_GATE_V1:'已批准的开关规则',MAPPING:'科目映射',NO_ADDITIONAL_LIMITS:'无附加限制',SERVICES_ONLY:'限定服务范围',UNRESOLVED:'尚未核实',
 ALIAS:'本次申请内的地点',EXISTING:'已登记地点',SHARED:'共享使用',EXCLUSIVE:'独占使用',HANDOVER:'交接',REPARTITION:'重新划分护理分区',
 'capability_type:REGISTER':'挂号','capabilityType:REGISTER':'挂号',ORDER:'开立医嘱',EXECUTE:'执行',CONSULT:'会诊',ADMIT:'收治',DISPENSE:'发药',REPORT:'出具报告',
 OUTPATIENT:'门诊',INPATIENT:'住院',EMERGENCY:'急诊',EXAMINATION:'检查',DAYCARE:'日间诊疗',INTERNET:'互联网诊疗',
 EQUIVALENT:'等同',NARROWER:'范围更窄',BROADER:'范围更广',RELATED:'相关',TEAM:'团队',COST:'成本中心',BED:'床位',
 'care-organization/unit':'业务单元','care-organization/nursing':'护理单元','care-organization/ward':'病区',
 'department-master':'逻辑科室','organization-master/campus':'院区','organization-master':'机构主体','department-master/campus-relation':'科室院区关系',
 'care-organization/unit-ward-relation':'科室病区关系','care-organization/ward-nursing-coverage':'护理覆盖','care-organization/unit-capability':'业务能力',
 'care-organization/subject-permission':'科目许可','care-organization/subject-mapping':'科目映射','organization-master/license':'机构许可',
 'location-master':'物理地点','location-master/usage-type':'地点用途','location-master/location-use':'地点使用',
 'governance-catalog/parameter-value':'参数值','governance-catalog/subject-code':'诊疗科目',
};

const referenceMetadata=new Set(['version','versionId','expectedVersion','expectedHead','parameterId','definitionVersionId','definitionDigest','valueDigest']);

/** Only metadata already matching one selected reference is folded. No values are inferred or updated here. */
export function careBoundFields(schema:FormSchema,value:Readonly<Record<string,unknown>>,choices:ReferenceChoices):readonly string[]{
 if(!schema.properties)return [];
 const bound=new Set<string>();
 const retain=(fields:Readonly<Record<string,unknown>>)=>{
  for(const [key,content] of Object.entries(fields)){
   if(referenceMetadata.has(key)&&key in schema.properties!&&content!==undefined&&content!==''&&value[key]===content)bound.add(key);
  }
 };
 if(typeof value['owner']==='string'&&typeof value['id']==='string'){
  const options=(choices[value['owner']]??[]).filter(option=>option.value===value['id']);
  const exact=options.findLast(option=>
   (value['versionId']===undefined||option.versionId===value['versionId'])&&
   (value['version']===undefined||option.version===value['version'])&&
   (value['expectedHead']===undefined||option.version===value['expectedHead'])&&
   (value['expectedVersion']===undefined||option.version===value['expectedVersion']));
  if(exact)retain({version:exact.version,versionId:exact.versionId,expectedVersion:exact.version,expectedHead:exact.version});
 }
 for(const field of ['systemId','valueId','scopeSetId','definitionVersionId']){
  if(!(field in schema.properties)||typeof value[field]!=='string')continue;
  const option=(choices[field]??[]).find(item=>item.value===value[field]);
  if(!option||!('fields' in option)||!option.fields||typeof option.fields!=='object')continue;
  const fields=option.fields as Readonly<Record<string,unknown>>;
  // A restored draft may point at an older accepted version. Keep mismatches visible.
  const exact=Object.entries(fields).filter(([key])=>referenceMetadata.has(key)&&key in schema.properties!).every(([key,content])=>value[key]===content);
  if(exact)retain(Object.fromEntries(Object.entries(fields).filter(([key])=>key!==field)));
 }
 return [...bound];
}
