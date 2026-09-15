import {parseLocalDateTime} from '../../platform/local-datetime/local-datetime.js';
import type {ImportContractDefinition} from './contract-schema.js';
import {conditionMappings,sourceFieldLimits} from './validation-sources.generated.js';

export const INTERPRETATION_POLICY='EXACT_TEXT_V1';
export type RuleStatus='PASS'|'FAIL'|'UNKNOWN'|'NOT_EVALUATED';
export interface RuleResult {rule:string;layer:number;row:number;field:string;status:RuleStatus;code:string}
export interface Period {from:string;to:string|null}
export interface DependencyObservation {target:string;status:'NOT_READY'|'OBSERVED';scope:string;identity:string;version:string|null;periods:Period[]}
export interface EvidenceRequirement {rule:string;requirementId:string;row:number;field:string;status:'BLOCKED_DEPENDENCY';details?:{evidenceOwner:string;requiredEvidence:string;sourceDataset:string;sourceField:string;sourceText:string;sourceVersion:string;inputs:string[];dispositionReason:string;whenTrue:string;whenFalse:string;whenUnknown:string}}
export interface ValidationEvaluation {decision:'PASS'|'FAIL'|'BLOCKED';issues:RuleResult[];layers:Array<{layer:number;status:RuleStatus|'NOT_RUN'}>;evidenceRequirements:EvidenceRequirement[];dependencies:DependencyObservation[];interpretationPolicy:typeof INTERPRETATION_POLICY;deduplicationPolicy?:'EXACT_ROW_V1'|'DECLARED_KEY_V2';duplicates?:Array<{row:number;duplicateOf:number}>}
export function interpretText(type:string,value:unknown):string {
 if(typeof value!=='string'||value===''||value!==value.trim())throw new Error('TEXT_VALUE_REQUIRED');
 if(type==='integer'&&!/^-?(0|[1-9][0-9]*)$/.test(value))throw new Error('INTEGER_REQUIRED');
 if(type==='decimal'&&!/^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))throw new Error('DECIMAL_REQUIRED');
 if(type==='date') {if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('DATE_REQUIRED');parseLocalDateTime(value+'T00:00:00');}
 if(type==='datetime')parseLocalDateTime(value);
 if(!['id','text','code','date','datetime','integer','decimal'].includes(type))throw new Error('TYPE_NOT_SUPPORTED');
 return value;
}
export function evaluateCondition(id:string,row:Record<string,string>,adoptedCodes:readonly string[]):boolean|'UNKNOWN' {
 if(id!=='SRC-COND-061')return 'UNKNOWN';
 const kind=row['account_kind'];
 if(!kind||!adoptedCodes.includes(kind))return 'UNKNOWN';
 // Only these source-defined subject categories have known semantics.
 return kind==='HUMAN'?true:kind==='SERVICE'?false:'UNKNOWN';
}
const timeKey=(value:string)=>{parseLocalDateTime(value);return value.slice(0,19)+'.'+(value.split('.')[1]??'').padEnd(6,'0');};
export function segmentCoverage(window:Period,spans:readonly Period[]):Array<Period&{covered:boolean}> {
 if(spans.length>1000)throw new Error('DEPENDENCY_LIMIT');
 const from=timeKey(window.from),to=window.to===null?null:timeKey(window.to);
 if(to!==null&&from>=to)throw new Error('INVALID_PERIOD');
 const periods=spans.map(s=>({from:timeKey(s.from),to:s.to===null?null:timeKey(s.to)}));
 if(periods.some(s=>s.to!==null&&s.from>=s.to))throw new Error('INVALID_PERIOD');
 const points=new Set([from]);if(to!==null)points.add(to);
 for(const p of periods)for(const v of [p.from,p.to])if(v!==null&&v>from&&(to===null||v<to))points.add(v);
 const sorted=[...points].sort();const result:Array<Period&{covered:boolean}>=[];
 for(let i=0;i<sorted.length;i++){
  const start=sorted[i]!;if(start===to)break;
  result.push({from:start,to:sorted[i+1]??to,covered:periods.some(s=>s.from<=start&&(s.to===null||start<s.to))});
 }
 return result;
}
export function checkTypedReference(expected:{target:string;scope:string;identity:string;version:string|null;window:Period},observation:DependencyObservation):RuleStatus {
 if(observation.status==='NOT_READY')return 'NOT_EVALUATED';
 if(observation.target!==expected.target||observation.scope!==expected.scope||observation.identity!==expected.identity||!observation.version)return 'FAIL';
 if(!expected.version)return 'NOT_EVALUATED';
 if(observation.version!==expected.version)return 'FAIL';
 return segmentCoverage(expected.window,observation.periods).every(p=>p.covered)?'PASS':'FAIL';
}
/** Internal deterministic seam. Production dependency observations are assembled by the Owner. */
export function evaluateRuleSet(dataset:string,definition:ImportContractDefinition,rows:readonly Record<string,string>[],dependencies:DependencyObservation[]=[],contractWindow?:Period):ValidationEvaluation {
 if(!sourceFieldLimits[dataset])throw new Error('DATASET_OUTSIDE_SCOPE');
 if(rows.length<1||rows.length>1000||definition.fields.length>100||definition.rules.length>100||dependencies.length>1000)throw new Error('VALIDATION_LIMIT');
 const issues:RuleResult[]=[];const evidenceRequirements:ValidationEvaluation['evidenceRequirements']=[];
 const add=(rule:string,layer:number,row:number,field:string,status:RuleStatus,code:string)=>{
  if(issues.length>=10000)throw new Error('VALIDATION_RESULT_LIMIT');issues.push({rule,layer,row,field,status,code});
 };
 const businessKey=definition.businessKey;
 const configured=Array.isArray(businessKey)&&businessKey.length>0&&businessKey.length<=8&&new Set(businessKey).size===businessKey.length&&businessKey.every(key=>definition.fields.some(f=>f.code===key));
 if(!configured)add('BUSINESS_KEY',3,0,'','NOT_EVALUATED','BUSINESS_KEY_NOT_CONFIGURED');
 const keys=new Map<string,{row:number;content:string}>();
 const duplicates:Array<{row:number;duplicateOf:number}>=[];
 for(const [index,row] of rows.entries()){
  const n=index+1;
  if(Object.keys(row).length!==definition.fields.length||Object.keys(row).some(k=>!definition.fields.some(f=>f.code===k)))add('SCHEMA',1,n,'','FAIL','FIELD_SET_MISMATCH');
  if(configured&&businessKey.every(field=>typeof row[field]==='string'&&row[field]!=='')){
   const key=JSON.stringify(businessKey.map(field=>row[field])),content=JSON.stringify(Object.keys(row).sort().map(field=>[field,row[field]]));
   const previous=keys.get(key);
   if(previous?.content===content){duplicates.push({row:n,duplicateOf:previous.row});continue;}
   if(previous)add('BUSINESS_KEY',3,n,businessKey[0]!,'FAIL','CONFLICTING_SOURCE_ID');
   else keys.set(key,{row:n,content});
  }else if(configured)add('BUSINESS_KEY',3,n,businessKey.find(field=>!row[field])??'','UNKNOWN','BUSINESS_KEY_VALUE_REQUIRED');
  for(const f of definition.fields){
   const value=row[f.code];
   if(typeof value!=='string'){add('TYPE',2,n,f.code,'FAIL','TEXT_VALUE_REQUIRED');continue;}
   let required:boolean|'UNKNOWN'=f.required==='R';
   if(f.required==='C'){
    const rules=definition.rules.filter(r=>r.field===f.code);
    const mapping=conditionMappings.find(m=>m.dataset===dataset&&m.field===f.code);
    const rule=rules.find(r=>r.id===mapping?.id);
    if(!mapping||!rule||rule.status==='UNRESOLVED'){required='UNKNOWN';add(rule?.id??'CONDITION',2,n,f.code,'UNKNOWN','UNRESOLVED');}
    else if(mapping.handler==='MANUAL_EVIDENCE_V1'){
     required='UNKNOWN';
     evidenceRequirements.push({rule:mapping.id,requirementId:mapping.requirementId,row:n,field:f.code,status:'BLOCKED_DEPENDENCY',details:{evidenceOwner:mapping.evidenceOwner,requiredEvidence:mapping.evidenceClaim,sourceDataset:mapping.dataset,sourceField:mapping.field,sourceText:mapping.text,sourceVersion:mapping.version,inputs:[...mapping.inputs],dispositionReason:mapping.dispositionReason,whenTrue:mapping.whenTrue,whenFalse:mapping.whenFalse,whenUnknown:mapping.whenUnknown}});
     add(mapping.id,2,n,f.code,'NOT_EVALUATED','BLOCKED_DEPENDENCY');
    }else{
     const adoption=definition.codeSets.find(c=>c.field==='account_kind'&&c.status==='SYNTHETIC_ADOPTED');
     required=evaluateCondition(mapping.id,row,adoption?.codes??[]);
     if(required==='UNKNOWN')add(mapping.id,2,n,f.code,'UNKNOWN','CONDITION_INPUT_UNKNOWN');
    }
   }
   if(value===''){if(required===true)add('REQUIRED',2,n,f.code,'FAIL','VALUE_REQUIRED');continue;}
   try{interpretText(f.type,value);}catch{add('TYPE',2,n,f.code,'FAIL','INVALID_TYPED_TEXT');continue;}
   const limit=sourceFieldLimits[dataset]?.[f.code];
   if(!limit)add('SOURCE',2,n,f.code,'UNKNOWN','FIELD_SOURCE_UNRESOLVED');
   else if([...value].length>limit.maxLength)add('LENGTH',2,n,f.code,'FAIL','VALUE_TOO_LONG');
   if(limit?.precision!==null&&limit?.precision!==undefined&&limit.scale!==null){
    const [whole,fraction='']=value.replace(/^-/,'').split('.');
    if(whole!.length>limit.precision-limit.scale||fraction.length>limit.scale)add('DECIMAL',2,n,f.code,'FAIL','DECIMAL_PRECISION_INVALID');
   }
   if(limit?.int32&&f.type==='integer'&&(BigInt(value)<-2147483648n||BigInt(value)>2147483647n))add('INTEGER_RANGE',2,n,f.code,'FAIL','INTEGER_RANGE_INVALID');
   if(dataset==='ORG20'&&f.code==='weight'&&(value.startsWith('-')||!/^(0(?:\.[0-9]+)?|1(?:\.0+)?)$/.test(value)))add('WEIGHT_RANGE',2,n,f.code,'FAIL','WEIGHT_OUT_OF_RANGE');
   if(f.enumValues.length&&!f.enumValues.includes(value))add('ENUM',2,n,f.code,'FAIL','ENUM_VALUE_INVALID');
  }
  if(definition.fields.some(f=>f.code==='valid_from')&&definition.fields.some(f=>f.code==='valid_to')){
   try{segmentCoverage({from:row['valid_from']!,to:row['valid_to']===''?null:row['valid_to']!},[]);}catch{add('PERIOD',5,n,'valid_to','FAIL','INVALID_PERIOD');}
  }
  for(const [refIndex,ref] of definition.references.entries()){
   if(!row[ref.field])continue;
   const observation=dependencies[refIndex]??{target:ref.target,status:'NOT_READY' as const,scope:'SYNTHETIC',identity:'',version:null,periods:[]};
   const window=row['valid_from']?{from:row['valid_from'],to:row['valid_to']===''?null:row['valid_to']??null}:contractWindow;
   if(observation.status==='NOT_READY')add('REFERENCE',4,n,ref.field,'NOT_EVALUATED','BLOCKED_DEPENDENCY');
   else if(!window)add('REFERENCE',4,n,ref.field,'UNKNOWN','REFERENCE_WINDOW_REQUIRED');
   else {
    let status:RuleStatus;
    try{status=checkTypedReference({target:ref.target,scope:'SYNTHETIC',identity:row[ref.field]!,version:ref.status==='DECLARED_PARAMETER'?ref.parameterVersionId:null,window},observation);}catch{status='FAIL';}
    add('REFERENCE',4,n,ref.field,status,status==='PASS'?'REFERENCE_VALID':status==='NOT_EVALUATED'?'BLOCKED_DEPENDENCY':'TYPED_REFERENCE_INVALID');
   }
  }
 }
 for(const rule of definition.rules)if(!conditionMappings.some(m=>m.id===rule.id&&m.dataset===dataset&&m.field===rule.field))add(rule.id,2,0,rule.field,'UNKNOWN','RULE_SOURCE_UNRESOLVED');
 issues.sort((a,b)=>a.layer-b.layer||a.row-b.row||a.field.localeCompare(b.field,'en')||a.rule.localeCompare(b.rule,'en'));
 const layers:ValidationEvaluation['layers']=Array.from({length:11},(_,layer)=>{
  const statuses=issues.filter(i=>i.layer===layer).map(i=>i.status);
  const status=layer>=8?'NOT_RUN':layer===6?'NOT_EVALUATED':statuses.includes('FAIL')?'FAIL':statuses.includes('UNKNOWN')?'UNKNOWN':statuses.includes('NOT_EVALUATED')?'NOT_EVALUATED':'PASS';
  return {layer,status};
 });
 // Field checks cannot make the missing domain Owner ready.
 return {decision:issues.some(i=>i.status==='FAIL')?'FAIL':'BLOCKED',issues,layers,evidenceRequirements,dependencies,interpretationPolicy:INTERPRETATION_POLICY,deduplicationPolicy:'DECLARED_KEY_V2',duplicates};
}
