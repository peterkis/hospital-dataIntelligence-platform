import type {VNextOperations} from '@hospital-data-intelligence/generated-api-client';
import {record} from './care-model.js';
export type UnitApprovalInput=VNextOperations['readBusinessUnitInput']['responses'][200]['content']['application/json'];
export type UnitApprovalVersion=VNextOperations['getBusinessUnitVersion']['responses'][200]['content']['application/json'];
export type UnitApprovalRead=VNextOperations['getBusinessUnitAsOf']['responses'][200]['content']['application/json'];
export type UnitVerificationRead=VNextOperations['readBusinessUnitVerification']['responses'][200]['content']['application/json'];
type Input=Pick<UnitApprovalInput,'campus'|'profile'|'timePolicy'|'entries'|'sourceRows'>;
export type UnitApprovalContext={input:Input;expectedHead:string;before:Pick<UnitApprovalVersion,'id'|'number'|'validFrom'|'validTo'|'facts'>;binding:NonNullable<UnitApprovalRead['binding']>['binding'];producer:Input;inputId:string};
function stable(value: unknown): unknown {if(Array.isArray(value))return value.map(stable);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,stable(item)]));return value;}
const same=(left:unknown,right:unknown)=>JSON.stringify(stable(left))===JSON.stringify(stable(right));
export function unitExpectedReceivingBasis(checked:UnitVerificationRead,context:UnitApprovalContext,inputDigest:string){
 const entry=context.input.entries[0],verification=checked?.verification;
 const time=(value:string)=>context.input.timePolicy==='SOURCE_PLUS08_TO_LOCAL'?value.replace(/\+08:00$/,''):value;
 if(!entry||entry.row.receiving_rule_ref||!checked||!verification||verification.inputId!==context.inputId||verification.inputDigest!==inputDigest||verification.policyVersion!=='ORG07_CORE_V1'||verification.rows.length!==1)throw new Error('独立核验与本次输入摘要或无限制修订范围不匹配，不能批准。');
 const source={kind:'NO_SPECIAL_RESTRICTION' as const,confirmed:true,validFrom:time(entry.row.valid_from),validTo:entry.row.valid_to?time(entry.row.valid_to):null},row=verification.rows[0];
 if(!row||row.row!==1||row.evidenceId!==entry.evidenceId||!row.classificationAccepted||!same(row.receiving,source))throw new Error('独立核验的材料、分类或准确收治期间不匹配，不能批准。');
 return {verificationId:checked.verificationId,verificationVersion:checked.verificationVersion,source,inputDigest};
}
export function assertUnitPropertyInput(context: UnitApprovalContext): void {
 const {input,producer,before}=context,entry=input.entries[0],locator=before.facts.source.recordLocatorEvidence;
 const index=producer.sourceRows?producer.sourceRows.indexOf(locator.row):locator.row-1,accepted=producer.entries[index];
 if(input.entries.length!==1||!entry||entry.action!=='REVISE'||!accepted||!['CREATE','REVISE'].includes(accepted.action)||entry.target.owner!=='care-organization/unit'||entry.target.expectedHead!==context.expectedHead||input.campus!==producer.campus||input.profile!==producer.profile||input.timePolicy!==producer.timePolicy)throw new Error('该申请不属于单记录属性修订，请在完整维护入口核对。');
 const immutable=(row: unknown)=>Object.fromEntries(Object.entries(record(row)).filter(([key])=>!['unit_name','public_phone','service_description'].includes(key)));
 if(!same(immutable(entry.row),immutable(accepted.row)))throw new Error('该申请包含编码、分类、归属、来源或期间变化，不能在属性修订页批准。');
}
export function assertFrozenUnitProperty(write: Record<string,unknown>,context: UnitApprovalContext,receivingBasis:ReturnType<typeof unitExpectedReceivingBasis>): void {
 assertUnitPropertyInput(context);
 const entry=context.input.entries[0],facts=record(write['facts']);
 if(!entry||entry.action!=='REVISE'||write['targetId']!==entry.target.id||write['action']!=='REVISE'||facts['unitName']!==entry.row.unit_name||facts['publicPhone']!==(entry.row.public_phone||null)||facts['serviceDescription']!==(entry.row.service_description||null))throw new Error('冻结字段与本次申请不匹配，不能批准。');
 const expected={...context.before.facts,unitName:entry.row.unit_name,publicPhone:entry.row.public_phone||null,serviceDescription:entry.row.service_description||null,
  source:{...context.before.facts.source,recordLocatorEvidence:{inputId:context.inputId,row:context.input.sourceRows?.[0]??1}},receivingBasis};
 if(!same(facts,expected)||write['key']!==entry.target.id||write['expectedHead']!==context.expectedHead||write['validFrom']!==context.before.validFrom||write['validTo']!==context.before.validTo||write['scope']!==context.input.campus||write['reason']!==entry.reason||write['sourceRow']!==(context.input.sourceRows?.[0]??1)||!same(write['binding'],context.binding)||!same(write['bindingChanges'],[])||write['lifecycleAdmission']!==undefined)throw new Error('冻结候选改变了未展示的身份、分类、归属、来源、期间或预期头，不能批准。');
}
export function unitActionLocation(kind:'VERIFY'|'PLAN'|'APPROVE'|'APPLY',requestId?:string):Record<string,string>{return {unitStage:kind,...(kind==='VERIFY'&&requestId?{verificationRequest:requestId}:{}),...(kind==='PLAN'&&requestId?{execution:requestId}:{})};}
