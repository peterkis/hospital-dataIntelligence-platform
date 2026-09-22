import {evaluateRuleSet} from '../../governance-catalog/index.js';
import {licensedServices} from '../operating/service-policy.js';
import {Check} from 'typebox/value';
import {CampusCommandSchema} from '../campus/contracts.js';
import type {OrganizationWorkbookResult,OrganizationSheet,ImportContractItem} from '../../governance-catalog/index.js';
import {localTime,licenseEnd,intersect,covered,type Span} from '../time.js';
import type {BundleManifestValue,BundleRowValue,BundleReferenceValue} from './contracts.js';
export interface BundleIssue {dataset:OrganizationSheet|null;row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface BundleStep {key:string;dataset:OrganizationSheet;row:number;governanceScope:'NORTH'|'SOUTH';dependencies:string[];command:Record<string,unknown>}
export interface BundleProgram {steps:BundleStep[];issues:BundleIssue[];aliases:Array<{dataset:OrganizationSheet;alias:string;step:string}>}
type SourceRow=Record<string,string>;
const aliasField={ORG01:'legal_entity_id',ORG02:'campus_id',ORG03:'legal_campus_rel_id'} as const;
const owners={ORG01:'organization-master',ORG02:'organization-master/campus',ORG03:'organization-master/operating-relation'} as const;
const time=(s:string)=>localTime(s.replace(/\+08:00$/u,''));
const symbol=(step:string,field:'id'|'version'|'versionId')=>({bundleReference:{step,field}});
const key=(sheet:string,row:number,part='main')=>`${sheet}/${row}/${part}`;
const aliasKey=(sheet:string,alias:string)=>JSON.stringify([sheet,alias]);
/** Compiles verified source cells, never arbitrary caller-supplied Owner commands. */
export function compileOrganizationBundle(parsed:OrganizationWorkbookResult,manifest:BundleManifestValue,contracts:ImportContractItem[]):BundleProgram{
 const result:BundleProgram={steps:[],issues:[],aliases:[]};
 const add=(dataset:OrganizationSheet|null,row:number,field:string,code:string,status:'FAIL'|'BLOCKED'='FAIL')=>result.issues.push({dataset,row,field,code,status});
 if(parsed.structuralStatus!=='PARSED'){for(const issue of parsed.issues)add((['ORG01','ORG02','ORG03'].includes(issue.sheet??'')?issue.sheet:null) as OrganizationSheet|null,issue.row,String(issue.column),issue.code);return result;}
 for(const contract of contracts){
  const dataset=contract.dataset as OrganizationSheet,rows=parsed.sheets[dataset].rows;if(!rows.length)continue;
  const canonical=rows.map(row=>Object.fromEntries(Object.entries(row).map(([field,value])=>[field,contract.definition.fields.find(f=>f.code===field)?.type==='datetime'?value.replace(/\+08:00$/u,''):value])));
  const fields=evaluateRuleSet(dataset,contract.definition,canonical);
  for(const issue of fields.issues)if(issue.status==='FAIL')add(dataset,issue.row?issue.row+1:0,issue.field,issue.code);
 }
 const fieldIssueCount=result.issues.length;
 const campusCodes=new Set<string>(),primaryWindows=new Map<string,Span[]>();
 const entries=new Map<string,{meta:BundleRowValue;raw:SourceRow}>(),aliases=new Map<string,string>(),targets=new Set<string>();
 for(const meta of manifest.rows){
  const coordinate=key(meta.dataset,meta.row),raw=parsed.sheets[meta.dataset].rows[meta.row-2];
  if(!raw){add(meta.dataset,meta.row,'','ROW_REFERENCE_INVALID');continue;}
  if(entries.has(coordinate)){add(meta.dataset,meta.row,'','DUPLICATE_MANIFEST_ROW');continue;}entries.set(coordinate,{meta,raw});
  if(meta.intent==='CREATE'&&meta.target||meta.intent==='REVISE'&&!meta.target){add(meta.dataset,meta.row,'target','EXPLICIT_TARGET_REQUIRED');continue;}
  if(meta.target){if(meta.target.owner!==owners[meta.dataset])add(meta.dataset,meta.row,'target','TARGET_DATASET_MISMATCH');const id=JSON.stringify([meta.target.owner,meta.target.id]);if(targets.has(id))add(meta.dataset,meta.row,'target','AMBIGUOUS_TARGET');targets.add(id);}
  const alias=raw[aliasField[meta.dataset]]!;if(!alias||alias.length>64){add(meta.dataset,meta.row,aliasField[meta.dataset],'INVALID_CLIENT_KEY');continue;}
  const identity=aliasKey(meta.dataset,alias);if(aliases.has(identity))add(meta.dataset,meta.row,aliasField[meta.dataset],'AMBIGUOUS_ALIAS');else aliases.set(identity,coordinate);
  result.aliases.push({dataset:meta.dataset,alias,step:coordinate});
 }
 for(const dataset of ['ORG01','ORG02','ORG03'] as const)for(let n=0;n<parsed.sheets[dataset].rows.length;n++)if(!entries.has(key(dataset,n+2)))add(dataset,n+2,'','UNMAPPED_ROW');
 if(result.issues.length>fieldIssueCount)return result;
 const reference=(ref:BundleReferenceValue,dataset:'ORG01'|'ORG02',raw:string|undefined,dependencies:string[])=>{
  if(ref.dataset!==dataset)throw new Error('TARGET_DATASET_MISMATCH');
  if(ref.kind==='PLATFORM_REF'){if(raw!==undefined&&raw!==ref.id)throw new Error('SOURCE_REFERENCE_MISMATCH');if(targets.has(JSON.stringify([owners[dataset],ref.id])))throw new Error('BATCH_REFERENCE_REQUIRED');return {id:ref.id,version:ref.expectedVersion};}
  if(raw!==undefined&&raw!==ref.alias)throw new Error('SOURCE_REFERENCE_MISMATCH');const k=aliases.get(aliasKey(dataset,ref.alias));if(!k)throw new Error('UNKNOWN_ALIAS');dependencies.push(k);return {id:symbol(k,'id'),version:symbol(k,'version')};
 };
 for(const [coordinate,{meta,raw}] of entries){
  try{
   const contract=contracts.find(c=>c.dataset===meta.dataset)!;
   for(const field of contract.definition.fields){const value=raw[field.code]!;if(field.required==='R'&&!value)add(meta.dataset,meta.row,field.code,'FIELD_REQUIRED');if(value&&field.type==='date'){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new Error('DATE_REQUIRED');localTime(value);}if(value&&field.type==='integer'&&(!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>2147483647))throw new Error('INTEGER_RANGE_INVALID');}
   const period={validFrom:time(raw['valid_from']!),validTo:raw['valid_to']?time(raw['valid_to']):null};if(period.validTo!==null&&period.validTo<=period.validFrom)throw new Error('INVALID_BUSINESS_PERIOD');
   const source={systemId:raw['source_system_id'],versionId:meta.sourceVersionId,alias:raw[aliasField[meta.dataset]],versionNo:Number(raw['version_no']),recordLocator:raw['source_record_id'],recordedAt:time(raw['recorded_at']!),recordStatus:raw['record_status'],approvalRef:raw['approval_ref']||null};
   if(source.versionNo<1)throw new Error('INTEGER_RANGE_INVALID');if(source.recordStatus!=='PUBLISHED'||!source.approvalRef)add(meta.dataset,meta.row,'approval_ref','SOURCE_INTENT_REQUIRED','BLOCKED');
   const base={...period,source},dependencies:string[]=[];
   const step=(part:string,command:Record<string,unknown>,deps:string[]=dependencies)=>{const k=key(meta.dataset,meta.row,part);result.steps.push({key:k,dataset:meta.dataset,row:meta.row,governanceScope:meta.governanceScope,dependencies:[...new Set(deps)],command});return k;};
   if(meta.dataset==='ORG01'){
    const identifiers=[];for(const [field,kind,namespace] of [['unified_credit_code','UNIFIED_CREDIT_CODE',meta.creditNamespace],['institution_code','INSTITUTION_CODE',meta.institutionNamespace]] as const)if(raw[field]){if(!namespace)throw new Error('IDENTIFIER_NAMESPACE_REQUIRED');identifiers.push({kind,namespace,value:raw[field]});}
    const main=step('main',{...base,action:meta.intent==='CREATE'?'CREATE':'REVISE',...(meta.target?{target:{id:meta.target.id,version:meta.target.expectedVersion}}:{}),facts:{legalName:raw['legal_name'],entityNature:raw['entity_nature'],authority:raw['authority']||null,legalAddress:raw['legal_address']||null,registrationEvidence:raw['registration_evidence']},identifiers});
    const subject={id:symbol(main,'id'),version:symbol(main,'version')};
    if(meta.license){
     const l=meta.license;if(!raw['license_number']||!raw['license_valid_from'])throw new Error('LICENSE_REQUIRED');if((l.intent==='REVISE')!==!!l.target)throw new Error('EXPLICIT_TARGET_REQUIRED');
     const end=licenseEnd(raw['license_valid_to']||null,l.endKind);if(l.endKind==='UNKNOWN')add(meta.dataset,meta.row,'license_valid_to','LICENSE_END_UNKNOWN','BLOCKED');
     const license=step('license',{...base,action:l.intent==='CREATE'?'ADD_LICENSE':'REVISE_LICENSE',target:subject,...(l.target?{licenseTarget:{id:l.target.id,version:l.target.version}}:{}),license:{namespace:l.namespace,number:raw['license_number'],authority:l.authority,evidence:l.evidence,validFrom:raw['license_valid_from'],validTo:raw['license_valid_to']||null,endKind:l.endKind}},[main]);
     if(!meta.registration)add(meta.dataset,meta.row,'registration_evidence','REGISTRATION_REQUIRED','BLOCKED');
     else{
      if(meta.registration.evidence!==raw['registration_evidence'])throw new Error('SOURCE_MANIFEST_CONFLICT');
      if(!raw['institution_code']||(meta.registration.creditCodeStatus==='HELD'&&!raw['unified_credit_code']))add(meta.dataset,meta.row,'registration_evidence','REGISTRATION_IDENTIFIER_REQUIRED','BLOCKED');
      const overlap=intersect({from:period.validFrom,to:period.validTo},{from:time(raw['license_valid_from']!),to:end});if(!overlap.length)throw new Error('LICENSE_PERIOD_NOT_COVERED');
      step('registration',{...base,validFrom:overlap[0]!.from,validTo:overlap[0]!.to,action:'VERIFY_REGISTRATION',target:subject,licenseTargets:[{id:symbol(license,'id'),version:symbol(license,'version')}],creditCodeStatus:meta.registration.creditCodeStatus,evidence:meta.registration.evidence},[main,license]);
     }
    }else if(raw['license_number']||raw['license_valid_from']||raw['license_valid_to']||meta.registration)throw new Error('LICENSE_MANIFEST_REQUIRED');
   }else if(meta.dataset==='ORG02'){
    if(campusCodes.has(raw['campus_code']!))add(meta.dataset,meta.row,'campus_code','IDENTIFIER_CONFLICT','BLOCKED');campusCodes.add(raw['campus_code']!);
    if((raw['admin_division_code']||null)!==(meta.adminDivision?.code??null))throw new Error('SOURCE_MANIFEST_CONFLICT');
    if(meta.intent==='CREATE'&&raw['operation_status']!=='PLANNING')add(meta.dataset,meta.row,'operation_status','UNSUPPORTED_STATE_TRANSITION','BLOCKED');
    const command={...base,action:meta.intent==='CREATE'?'CREATE':'REVISE',...(meta.target?{target:meta.target}:{}),evidence:meta.evidence,sourceOperationStatus:raw['operation_status'],facts:{campusCode:raw['campus_code'],campusName:raw['campus_name'],nodeRole:raw['node_role'],nodeKind:meta.nodeKind,campusAddress:raw['campus_address']||null,adminDivision:meta.adminDivision,publicPhone:raw['public_phone']||null,openingDate:raw['opening_date']||null}};
    if(!Check(CampusCommandSchema,command))add(meta.dataset,meta.row,'','CLOSED_DOMAIN_INPUT_REQUIRED');step('main',command);
   }else{
    if(meta.role==='OPERATOR'){
     if(!meta.services.length||meta.services.some(s=>!licensedServices.includes(s))||!raw['license_scope']?.trim())add(meta.dataset,meta.row,'license_scope','UNSUPPORTED_SERVICE','BLOCKED');
     if(meta.scopes.every(s=>s.kind==='VERIFY_SCOPE')&&meta.services.some(service=>!covered(meta.scopes.flatMap(s=>s.kind==='VERIFY_SCOPE'&&s.services.includes(service)?[{from:s.validFrom,to:s.validTo}]:[]),period.validFrom,period.validTo)))add(meta.dataset,meta.row,'license_scope','LICENSE_PERIOD_NOT_COVERED','BLOCKED');
    }else{
     if(meta.services.length||meta.scopes.length||raw['license_scope'])add(meta.dataset,meta.row,'license_scope','UNSUPPORTED_SERVICE','BLOCKED');
     if(raw['is_primary_operator']==='Y')add(meta.dataset,meta.row,'is_primary_operator','INVALID_PRIMARY_ROLE','BLOCKED');
    }
    const subject=reference(meta.subject,'ORG01',raw['legal_entity_id'],dependencies),campus=reference(meta.campus,'ORG02',raw['campus_id'],dependencies);
    if(raw['is_primary_operator']==='Y'){
     const id=JSON.stringify(campus.id),span={from:period.validFrom,to:period.validTo},prior=primaryWindows.get(id)??[];
     if(prior.some(p=>intersect(p,span).length))add(meta.dataset,meta.row,'is_primary_operator','PRIMARY_OPERATOR_CONFLICT','BLOCKED');primaryWindows.set(id,[...prior,span]);
    }
    const declaredParents=[meta.subject,meta.campus].map(ref=>ref.kind==='JOB_ALIAS'?entries.get(aliases.get(aliasKey(ref.dataset,ref.alias))!):undefined);
    for(const parent of declaredParents)if(parent?.meta.intent==='CREATE'&&!covered([{from:time(parent.raw['valid_from']!),to:parent.raw['valid_to']?time(parent.raw['valid_to']):null}],period.validFrom,period.validTo))throw new Error('PARENT_PERIOD_NOT_COVERED');
    const endpoints={subject:{owner:'organization-master',id:subject.id},campus:{owner:'organization-master/campus',id:campus.id}},scopes=[];
    for(const [i,scope] of meta.scopes.entries()){
     if(scope.kind==='EXISTING_SCOPE'){if(declaredParents.some(parent=>parent?.meta.intent==='CREATE'))throw new Error('SCOPE_ENDPOINT_MISMATCH');scopes.push(scope.reference);continue;}
     if(!scope.services.length||scope.services.some(service=>!licensedServices.includes(service)))add(meta.dataset,meta.row,'license_scope','UNSUPPORTED_SERVICE','BLOCKED');
     for(const parent of declaredParents)if(parent?.meta.intent==='CREATE'&&!covered([{from:time(parent.raw['valid_from']!),to:parent.raw['valid_to']?time(parent.raw['valid_to']):null}],scope.validFrom,scope.validTo))throw new Error('PARENT_PERIOD_NOT_COVERED');
     if(!('kind' in scope.license)&&declaredParents[0]?.meta.intent==='CREATE')throw new Error('LICENSE_ID_MISMATCH');
     let license:unknown=scope.license;const deps=[...dependencies];
     if('kind' in scope.license){
      const ref=scope.license.subject;if(ref.kind!=='JOB_ALIAS'||ref.dataset!=='ORG01')throw new Error('LICENSE_MANIFEST_REQUIRED');
      if(meta.subject.kind!=='JOB_ALIAS'||ref.dataset!==meta.subject.dataset||ref.alias!==meta.subject.alias)throw new Error('LICENSE_ID_MISMATCH');
      const parent=aliases.get(aliasKey('ORG01',ref.alias)),entry=parent&&entries.get(parent);if(!entry||entry.meta.dataset!=='ORG01'||!entry.meta.license||!entry.meta.registration)throw new Error('REGISTRATION_REQUIRED');
      const licenseStep=key('ORG01',entry.meta.row,'license');deps.push(key('ORG01',entry.meta.row,'registration'));license={owner:'organization-master/license',id:symbol(licenseStep,'id'),version:symbol(licenseStep,'version'),versionId:symbol(licenseStep,'versionId')};
      const end=licenseEnd(entry.raw['license_valid_to']||null,entry.meta.license.endKind,true),registration=intersect({from:time(entry.raw['valid_from']!),to:entry.raw['valid_to']?time(entry.raw['valid_to']):null},{from:time(entry.raw['license_valid_from']!),to:end});if(!covered(registration,scope.validFrom,scope.validTo))throw new Error('LICENSE_PERIOD_NOT_COVERED');
     }
     const k=step('scope'+i,{...base,...endpoints,validFrom:scope.validFrom,validTo:scope.validTo,action:'VERIFY_SCOPE',evidence:scope.evidence,facts:{license,catalog:meta.catalog,services:scope.services,licenseScopeText:raw['license_scope']}},deps);
     dependencies.push(k);scopes.push({owner:'organization-master/license-scope',id:symbol(k,'id'),version:symbol(k,'version'),versionId:symbol(k,'versionId')});
    }
    if(meta.role==='OTHER'||!['Y','N'].includes(raw['is_primary_operator']!))add(meta.dataset,meta.row,'relation_type','UNSUPPORTED_RELATION_ROLE','BLOCKED');
    step('main',{...base,...endpoints,action:meta.intent==='CREATE'?'ESTABLISH':'REVISE_RELATION',...(meta.target?{target:meta.target}:{}),evidence:raw['evidence_ref'],facts:{role:meta.role,relationTypeText:raw['relation_type'],primary:raw['is_primary_operator'],catalog:meta.catalog,services:meta.services,licenseScopeText:raw['license_scope']||null,scopeTargets:scopes}});
   }
  }catch(error){add(meta.dataset,meta.row,'',error instanceof Error?error.message:'ROW_INVALID');}
 }
 if(result.steps.length>100)add(null,0,'','PLAN_INPUT_LIMIT');
 const pending=new Map(result.steps.map(step=>[step.key,step])),done=new Set<string>(),sorted:BundleStep[]=[];
 while(pending.size){const ready=[...pending.values()].filter(step=>step.dependencies.every(dep=>done.has(dep))).sort((a,b)=>a.key.localeCompare(b.key));if(!ready.length){add(null,0,'','UNKNOWN_ALIAS_OR_CYCLE');break;}for(const step of ready){pending.delete(step.key);done.add(step.key);sorted.push(step);}}
 result.steps=sorted;return result;
}
