import {createHash,createHmac} from 'node:crypto';
import {sql} from 'kysely';
import {CatalogTransactionScope,canonicalPlan,planBinding,recordDepartmentImpact,type KeyProviderPort} from '../../governance-catalog/index.js';
import {localTime} from '../../organization-master/index.js';
import {check} from './contracts.js';
import {AssessDepartmentChangeSchema,type AssessDepartmentChangeInput,type DepartmentAssessment,type ImpactReference,type ImpactTarget,type StoredDepartmentAssessment} from './department-impact-contracts.js';
import type {EvolutionStoredStageInput} from './organization-evolution-contracts.js';
import {departmentImpactCases} from './department-impact-cases.js';
import {ImpactCaseListSchema,type ImpactCaseListInput,type ImpactCaseListResult} from './department-impact-contracts.js';
import {ReadDepartmentAssessmentSchema,ListDepartmentAssessmentsSchema,type ReadDepartmentAssessmentInput,type ListDepartmentAssessmentsInput,type ListDepartmentAssessmentsResult} from './department-impact-contracts.js';

export interface DepartmentImpactContext {inputId:string;inputDigest:string;profile:string;campus:'NORTH'|'SOUTH';departmentIds:string[];effectiveAt:string;changeType:DepartmentAssessment['changeType']}
export interface DepartmentImpactPorts {
 businessUnitsAvailable?:boolean;nursingUnitsAvailable?:boolean;wardsAvailable?:boolean;capabilitiesAvailable?:boolean;
 references(scope:CatalogTransactionScope,actor:string,departments:string[],campus:string):Promise<ImpactReference[]>;
 referenceAccess(scope:CatalogTransactionScope,actor:string,reference:ImpactReference,campus:string):Promise<void>;
 replacement(scope:CatalogTransactionScope,actor:string,departmentId:string):Promise<string|null>;
}
/** Finite Owner-owned reverse reader; no table discovery and no external-system scan. */
export const departmentImpactPorts:DepartmentImpactPorts={
 async references(scope,actor,departments,campus){return (await sql<{r:ImpactReference[]}>`select department_master.impact_references(${actor},${JSON.stringify(departments)}::jsonb,${campus}) r`.execute(scope)).rows[0]!.r;},
 async referenceAccess(scope,actor,reference,campus){await sql`select department_master.impact_reference_access(${actor},${JSON.stringify(reference)}::jsonb,${campus})`.execute(scope);},
 async replacement(scope,actor,departmentId){const row=(await sql<{r:{effective_at:string}|null}>`select department_master.replacement_read(${actor},${departmentId}::uuid,NULL) r`.execute(scope)).rows[0]!.r;return row?localTime(row.effective_at.replace(' ','T')):null;},
};
export function departmentImpacts(
 root:<T>(work:(scope:CatalogTransactionScope)=>Promise<T>)=>Promise<T>,
 load:(scope:CatalogTransactionScope,actor:string,target:ImpactTarget)=>Promise<DepartmentImpactContext>,
 ports:DepartmentImpactPorts,
 provider:KeyProviderPort|undefined,
 evidence:(scope:CatalogTransactionScope,actor:string,eventId:string,campus:'NORTH'|'SOUTH',evidenceId:string,admission:boolean)=>Promise<string>,
){
 const record=async<T>(scope:CatalogTransactionScope,actor:string,operation:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(scope)).rows[0]!.id;
  const ticket=canonicalPlan({...value,actor,operation,transaction}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  try{return await recordDepartmentImpact<T>(scope,ticket,createHmac('sha256',key).update(ticket).digest('hex'));}finally{key.fill(0);}
 };
 const observe=async(scope:CatalogTransactionScope,actor:string,target:ImpactTarget):Promise<DepartmentAssessment>=>{
  const context=await load(scope,actor,target);
  if(context.profile!=='CORE')throw new Error('BLOCKED_DEPENDENCY');
  const effectiveAt=localTime(context.effectiveAt);
  const references=await ports.references(scope,actor,context.departmentIds,context.campus);
  if(references.length>2000)throw Object.assign(new Error('PLAN_INPUT_LIMIT'),{budget:{kind:'REFERENCE_COUNT',observed:references.length,limit:2000}});
  const changeType=context.changeType;
  const exits=new Map<string,string|null>();
  for(const id of context.departmentIds)exits.set(id,await ports.replacement(scope,actor,id));
  for(const ref of references){
   projectImpactReference(ref,effectiveAt,changeType,exits.get(ref.departmentId)??null);
  }
  const coverage:DepartmentAssessment['coverage']=[
   ...(['SOURCE_MAPPING','IDENTIFIER','HIERARCHY','CAMPUS_RELATION'] as const).map(owner=>({owner,status:'EVALUATED' as const,reason:'OWNER_AVAILABLE' as const})),
   ...(ports.businessUnitsAvailable?[{owner:'BUSINESS_UNIT' as const,status:'EVALUATED' as const,reason:'OWNER_AVAILABLE' as const}]:[{owner:'BUSINESS_UNIT' as const,status:'NOT_EVALUABLE' as const,reason:'OWNER_NOT_IMPLEMENTED' as const}]),
   ...(ports.nursingUnitsAvailable?[{owner:'NURSING_UNIT' as const,status:'EVALUATED' as const,reason:'OWNER_AVAILABLE' as const}]:[{owner:'NURSING_UNIT' as const,status:'NOT_EVALUABLE' as const,reason:'OWNER_NOT_IMPLEMENTED' as const}]),
   ...(ports.wardsAvailable?[{owner:'WARD' as const,status:'EVALUATED' as const,reason:'OWNER_AVAILABLE' as const}]:[{owner:'WARD' as const,status:'NOT_EVALUABLE' as const,reason:'OWNER_NOT_IMPLEMENTED' as const}]),...(ports.capabilitiesAvailable?[{owner:'UNIT_CAPABILITY' as const,status:'EVALUATED' as const,reason:'OWNER_AVAILABLE' as const}]:[{owner:'UNIT_CAPABILITY' as const,status:'NOT_EVALUABLE' as const,reason:'OWNER_NOT_IMPLEMENTED' as const}]),
   ...(['PERSONNEL','PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER'] as const).map(owner=>({owner,status:'NOT_EVALUABLE' as const,reason:'OWNER_NOT_IMPLEMENTED' as const})),
  ];
  const basis:Omit<DepartmentAssessment,'dependencyDigest'>={target,departmentIds:[...context.departmentIds].sort(),inputId:context.inputId,inputDigest:context.inputDigest,campus:context.campus,changeType,effectiveAt,ruleVersion:'DEPARTMENT_IMPACT_V1' as const,coverage,references};
  const assessment={...basis,dependencyDigest:createHash('sha256').update(canonicalPlan(basis)).digest('hex')};
  // Match the canonical PostgreSQL JSONB representation used by the immutable
  // store CHECK, including its UTF-8 encoding and separator bytes.
  const {bytes}=(await sql<{bytes:number}>`select octet_length(${JSON.stringify(assessment)}::jsonb::text) bytes`.execute(scope)).rows[0]!;
  if(bytes>524288)throw Object.assign(new Error('PLAN_INPUT_LIMIT'),{budget:{kind:'ASSESSMENT_BYTES',observed:bytes,limit:524288}});
  return assessment;
 };
 const assessInTransaction=async(scope:CatalogTransactionScope,actor:string,input:AssessDepartmentChangeInput)=>{
  check(AssessDepartmentChangeSchema,input);
   const context=await load(scope,actor,input.target),requestDigest=planBinding(provider,'DEPARTMENT_ASSESS_REQUEST_V1',input);
   const prior=await record<StoredDepartmentAssessment|null>(scope,actor,'PRIOR_ASSESSMENT',{...input,campus:context.campus,requestDigest});
   if(prior){await authorizeFrozen(scope,actor,prior);return prior;}
   const assessment=await observe(scope,actor,input.target);
   const stored=await record<StoredDepartmentAssessment>(scope,actor,'ASSESS',{...input,campus:assessment.campus,assessment,requestDigest});
   await authorizeFrozen(scope,actor,stored);return stored;
 };
 const authorizeFrozen=async(scope:CatalogTransactionScope,actor:string,assessment:DepartmentAssessment)=>{for(const reference of assessment.references)await ports.referenceAccess(scope,actor,reference,assessment.campus);};
 const readAssessmentInTransaction=async(scope:CatalogTransactionScope,actor:string,input:ReadDepartmentAssessmentInput)=>{
  check(ReadDepartmentAssessmentSchema,input);const stored=await record<StoredDepartmentAssessment>(scope,actor,'READ_ASSESSMENT',input);
  await load(scope,actor,stored.target);await authorizeFrozen(scope,actor,stored);return stored;
 };
 return {...departmentImpactCases({root,record,observe,evidence}),observe,assessInTransaction,authorizeFrozen,readAssessmentInTransaction,
  async readDepartmentAssessment(actor:string,input:ReadDepartmentAssessmentInput){return root(scope=>readAssessmentInTransaction(scope,actor,input));},
  async listDepartmentAssessments(actor:string,input:ListDepartmentAssessmentsInput){check(ListDepartmentAssessmentsSchema,input);return root(async scope=>{
   const context=await load(scope,actor,input.target),result=await record<ListDepartmentAssessmentsResult>(scope,actor,'LIST_ASSESSMENTS',{...input,inputId:context.inputId,campus:context.campus});
   for(const assessment of result.items)await authorizeFrozen(scope,actor,assessment);return result;
  });},
  async assessDepartmentChange(actor:string,input:AssessDepartmentChangeInput){return root(scope=>assessInTransaction(scope,actor,input));},
  async listImpactCases(actor:string,input:ImpactCaseListInput){check(ImpactCaseListSchema,input);return root(async scope=>{
   await load(scope,actor,{kind:'EVENT',id:input.eventId,campus:input.campus});
   return record<ImpactCaseListResult>(scope,actor,'LIST_CASES',input);
  });},
 };
}

/** Project a full half-open obligation without changing accepted evidence. */
export function projectImpactReference(ref:ImpactReference,effectiveAt:string,changeType:DepartmentAssessment['changeType'],replacementAt:string|null):void{
   const exitAt=['SPLIT','MERGE','SUSPEND','DEPRECATE'].includes(changeType)?effectiveAt:replacementAt;
   const boundary=exitAt??effectiveAt;
   const from=ref.currentPeriod.from>boundary?ref.currentPeriod.from:boundary,to=ref.currentPeriod.to;
   const active=ref.current&&ref.currentReferencesDepartment&&!['RETRACT','CLOSED','REVOKED'].includes(ref.currentAction)&&ref.currentTargetId===ref.departmentId&&(to===null||to>from);
   ref.change=active||ref.versionId!==ref.currentVersionId?'CHANGED':'UNCHANGED';ref.constraint='SATISFIED';ref.affectedSpans=[];
   ref.reason=!active?'HISTORICAL_REFERENCE':exitAt?'REFERENCE_EXITED':'LABEL_CHANGED';
   if((ref.owner==='WARD'||ref.owner==='UNIT_CAPABILITY'))ref.current=active;
   if(active&&exitAt){ref.constraint='UNSATISFIED';ref.affectedSpans=[{from,to}];}
}
