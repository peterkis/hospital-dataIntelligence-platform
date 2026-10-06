import {openDepartmentLifecycle} from './department-lifecycle.js';
import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {vnextPool} from '../../../platform/database/vnext-pool.js';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Type} from 'typebox';
import type {DB} from '../../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,type ApplyOwnerPort,type OwnerFact,type KeyProviderPort,type ImportJob,type ImportContractItem} from '../../governance-catalog/index.js';
import {fileIntake,protectedArtifacts,parseEvolutionWorkbookBounded,recordOwnerFileValidation,textSheetsWorkbook,type EvolutionWorkbookResult,type EvolutionSheet,type ParserField,type ValidationEvaluation} from '../../governance-catalog/index.js';
import {localTime,covered} from '../../organization-master/index.js';
import {Id,check,ORG04_FIELDS,normalizeEntry,validateORG04,MAX_EXPECTED_VERSION} from './contracts.js';
import {EvolutionStageSchema,EvolutionStoredStageSchema,EvolutionVerifySchema,EvolutionStoredVerifySchema,EvolutionReceiveSchema,EvolutionTemplateSchema,EvolutionEventRowSchema,EvolutionRelationRowSchema,ORG26_FIELDS,ORG27_FIELDS,EVOLUTION_IMPACT_DOMAINS,validateSuccessionGraph,evolutionExpandedWriteCount,type EvolutionStageInput,type EvolutionStoredStageInput,type EvolutionVerifyInput,type EvolutionReceiveInput,type EvolutionTemplateInput,type EvolutionIssue} from './organization-evolution-contracts.js';
import {departmentImpacts,departmentImpactPorts,type DepartmentImpactPorts} from './department-impact.js';
import {DepartmentAssessmentSchema,type DepartmentAssessment} from './department-impact-contracts.js';
import type {DepartmentHistory} from './index.js';

type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface Verification {id:string;actor:string;identity_code:string;digest:string;envelope:Envelope}
interface InputRecord {id:string;revision:string;job_id:string;job_revision:string;maker:string;identity_code:string;digest:string;campus:'NORTH'|'SOUTH';source_system_id:string;envelope:Envelope;verification:Verification|null}
interface StoredRelation {id:string;source_client_key:string;source_to_alias:string;relation_kind:'SAME_ID_VERSION'|'SUCCESSION';from_department_id:string;from_version_id:string;to_department_id:string;to_version_id:string;fromVersion:string;toVersion:string;toSourceRow:number;transfer_scope:string;context_rule:string;source_row:number;source_recorded_at:string;recorded_at:string}
export interface EvolutionSnapshot {id:string;input_id:string;change_type:'RENAME'|'SPLIT'|'MERGE';effective_at:string;recorded_at:string;campus:'NORTH'|'SOUTH';source_system_id:string;source_client_key:string;source_row:number;facts:Record<string,unknown>;content_digest:string;relations:StoredRelation[]}
const oneInput=Type.Object({inputId:Id},{additionalProperties:false});
const querySchema=Type.Object({id:Id,campus:Type.Enum(['NORTH','SOUTH']),businessAt:Type.String(),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false});
const stamp=(value:string)=>localTime(value.replace(' ','T'));
const objectRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);

/** Re-bind the frozen ORG04 rows, exact evidence digests and source pins immediately before SQL signing. */
export function assertEvolutionApplyBinding(provider:KeyProviderPort|undefined,input:EvolutionStoredStageInput,value:unknown,expandedCount:unknown):void{
 const stale=():never=>{throw new Error('STALE_VALIDATION');};
 if(!objectRecord(value))throw new Error('STALE_VALIDATION');
 const materials=value['materials'],frozenSuccessors=value['successorFacts'];
 if(!Array.isArray(materials)||!Array.isArray(frozenSuccessors))throw new Error('STALE_VALIDATION');
 if(expandedCount!==String(evolutionExpandedWriteCount(input))||frozenSuccessors.length!==input.successors.length)stale();
 const byAlias=new Map<string,Record<string,unknown>>();
 for(const candidate of frozenSuccessors){
  if(!objectRecord(candidate))stale();
  const alias=candidate['alias'];
  if(typeof alias!=='string'||byAlias.has(alias))stale();
  byAlias.set(alias,candidate);
 }
 const verificationId=typeof value['verificationId']==='string'?value['verificationId']:'';
 for(const raw of input.successors){
  const entry=normalizeEntry(raw,'LOCAL'),prepared=byAlias.get(entry.row.org_id);
  if(!prepared)throw new Error('STALE_VALIDATION');
  const contentDigest=prepared['contentDigest'],successorFacts=prepared['facts'];
  if(typeof contentDigest!=='string'||!objectRecord(successorFacts))throw new Error('STALE_VALIDATION');
  const pin=successorFacts['sourcePin'];
  if(!objectRecord(pin)||pin['sourceId']!==entry.row.source_system_id)stale();
  const material=materials.find((candidate:unknown)=>objectRecord(candidate)&&candidate['id']===entry.evidenceId);
  if(!objectRecord(material)||typeof material['digest']!=='string')stale();
  const {sourceRow:_,...normalized}=entry,policy=input.contracts.departmentContractVersionId;
  const commandDigest=planBinding(provider,'EVOLUTION_DEPARTMENT_COMMAND_V1',{entry:normalized,policy,proof:{pin,material}});
  const expected={name:entry.row.org_name,shortName:entry.row.org_short_name||null,orgType:entry.row.org_type,establishedOn:entry.row.established_on,description:entry.row.description||null,virtual:entry.row.is_virtual==='Y',historicalException:false,sourceVersion:entry.row.version_no,sourceRecordedAt:entry.recordedAt,sourceSystemId:entry.row.source_system_id,policyVersionId:policy,verificationId,commandDigest,sourcePin:pin};
  if(canonicalPlan(successorFacts)!==canonicalPlan(expected)||contentDigest!==planBinding(provider,'DEPARTMENT_FACTS_V1',expected))stale();
 }
 if(byAlias.size!==input.successors.length)stale();
}

export function openOrganizationEvolutions(connection:string,provider?:KeyProviderPort,impactPorts:DepartmentImpactPorts=departmentImpactPorts){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:Scope)=>Promise<T>)=>db.transaction().execute(async transaction=>{await sql`select pg_advisory_xact_lock(901002)`.execute(transaction);return work(CatalogTransactionScope.from(transaction));});
 const authorize=async(s:Scope,actor:string,campus:string,permission:string)=>(await sql<{r:string}>`select department_master.evolution_authorize(${actor},${campus},${permission}) r`.execute(s)).rows[0]!.r;
 const record=async(s:Scope,actor:string,id:string,permission='READ_RESTRICTED')=>(await sql<{r:InputRecord}>`select department_master.evolution_input_read(${actor},${id}::uuid,${permission}) r`.execute(s)).rows[0]!.r;
 const job=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:id})}::jsonb) r`.execute(s)).rows[0]!.r;
 const inputJob=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select department_master.evolution_job_read(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const snapshot=async(s:Scope,actor:string,id:string,campus:string)=>(await sql<{r:EvolutionSnapshot}>`select department_master.evolution_snapshot(${actor},${id}::uuid,${campus}) r`.execute(s)).rows[0]!.r;
 const seal=(domain:string,value:unknown)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(domain+'\0'+digest));const bytes=Buffer.from(canonicalPlan(value));
  try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}
 };
 const unseal=<T>(domain:string,r:{digest:string;envelope:Envelope},schema:unknown):T=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));
  const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value:unknown=JSON.parse(bytes.toString());check(schema,value);if(planBinding(provider,domain,value)!==r.digest)throw new Error('PAYLOAD_UNAVAILABLE');return value as T;}finally{bytes.fill(0);}
 };
 const mutate=async<T>(s:Scope,actor:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select department_master.evolution_mutate(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const recoverable=async<T>(s:Scope,work:()=>Promise<T>):Promise<T>=>{
  await sql`savepoint evolution_dependency`.execute(s);try{const value=await work();await sql`release savepoint evolution_dependency`.execute(s);return value;}catch(error){await sql`rollback to savepoint evolution_dependency`.execute(s);await sql`release savepoint evolution_dependency`.execute(s);throw error;}
 };
 const evidence=async(s:Scope,actor:string,id:string,sourceVersionId:string,campus:string)=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);try{return {id,digest:planBinding(provider,'EVOLUTION_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const evidenceAccess=(s:Scope,actor:string,id:string,sourceVersionId:string,campus:string)=>sql`select governance_catalog.registration_evidence_access(${actor},${id}::uuid,${sourceVersionId}::uuid,${campus})`.execute(s);
 const currentContract=async(s:Scope,actor:string,id:string,versionId:string,now:string)=>{
  const c=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:id,businessAt:now})}::jsonb) r`.execute(s)).rows[0]!.r[0];
  if(!c||c.versionId!==versionId)throw new Error('STALE_VALIDATION');return c;
 };
 const assertContract=(c:ImportContractItem,dataset:string,template:string,fields:string[])=>c.status==='PUBLISHED'&&c.profile==='CORE'&&c.dataset===dataset&&c.definition.templateVersion===template&&c.definition.fields.length===fields.length&&fields.every(field=>c.definition.fields.some(f=>f.code===field));
 const workbookFields=(policies:ImportContractItem[]):Record<EvolutionSheet,ParserField[]>=>({ORG26:policies[0]!.definition.fields,ORG27:policies[1]!.definition.fields,ORG04:policies[2]!.definition.fields});
 const readFile=async(s:Scope,actor:string,r:InputRecord,input:EvolutionStoredStageInput,policies:ImportContractItem[])=>{
  if(!input.sourceArtifactId)return null;
  const sourceVersion=policies[0]?.definition.sourceVersionId;if(!sourceVersion)throw new Error('BLOCKED_DEPENDENCY');
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${input.sourceArtifactId}::uuid,${sourceVersion}::uuid,${r.campus}) r`.execute(s)).rows[0]!.r;
  if(proof.binding[0]!==r.job_id||proof.binding[1]!==r.job_revision||proof.binding[2]!=='RAW_FILE')throw new Error('ACCESS_DENIED');
  const bytes=authenticateRegistrationEvidence(proof,provider);
  try{return {binding:{id:input.sourceArtifactId,digest:planBinding(provider,'EVOLUTION_FILE_V1',Buffer.from(bytes).toString('base64'))},parsed:await parseEvolutionWorkbookBounded(bytes,workbookFields(policies))};}finally{bytes.fill(0);}
 };
 const authorizeInputSources=async(s:Scope,actor:string,input:EvolutionStoredStageInput,allowMissingPredecessor=false)=>{
  if(input.compensatesEvent)await snapshot(s,actor,input.compensatesEvent.id,input.campus);
  if(input.campusChanges?.length)await lifecycle().authorizeEvolutionCampusChangesInTransaction(s,actor,input);
  const sources=new Set([input.sourceSystemId,...input.successors.map(entry=>entry.row.source_system_id)]);
  for(const reference of input.predecessors){
   try{const h=await recoverable(s,async()=>(await sql<{r:DepartmentHistory}>`select department_master.snapshot(${actor},${reference.id}::uuid) r`.execute(s)).rows[0]!.r);for(const version of h.versions)sources.add(version.facts.sourceSystemId);}
   catch(error){if(!(allowMissingPredecessor&&error instanceof Error&&error.message==='NOT_FOUND'))throw error;}
  }
  for(const source of sources)await sql`select department_master.evolution_source_authorize(${actor},${source}::uuid)`.execute(s);
 };
 const authenticateBoundEvidence=async(s:Scope,actor:string,id:string,sourceId:string,sourceVersionId:string,campus:string,from:string,to:string|null,point=false)=>{
  const proof=point
   ?(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select department_master.evidence(${actor},${id}::uuid,${sourceId}::uuid,${sourceVersionId}::uuid,${campus},${from}::timestamp,${from}::timestamp+interval '1 microsecond') r`.execute(s)).rows[0]!.r
   :(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select department_master.evidence(${actor},${id}::uuid,${sourceId}::uuid,${sourceVersionId}::uuid,${campus},${from}::timestamp,${to}::timestamp) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);bytes.fill(0);
 };
 const exactPolicies=async(s:Scope,actor:string,j:ImportJob,input:EvolutionStoredStageInput)=>{
  const now=(await sql<{r:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') r`.execute(s)).rows[0]!.r;
  const policies=[await currentContract(s,actor,j.contract.id,j.contract.versionId,now),await currentContract(s,actor,input.contracts.successionContractId,input.contracts.successionContractVersionId,now),await currentContract(s,actor,input.contracts.departmentContractId,input.contracts.departmentContractVersionId,now)];
  if(!assertContract(policies[0]!,'ORG26','ORG_EVOLUTION_CORE_V1',ORG26_FIELDS)||!assertContract(policies[1]!,'ORG27','ORG_SUCCESSION_CORE_V1',ORG27_FIELDS)||!assertContract(policies[2]!,'ORG04','ORG04_CORE_V1',ORG04_FIELDS))throw new Error('BLOCKED_DEPENDENCY');
  return policies;
 };
 const saveValidation=async(s:Scope,actor:string,j:ImportJob,campus:'NORTH'|'SOUTH',sourceArtifactId:string,parsed:EvolutionWorkbookResult,issues:EvolutionIssue[])=>{
  const decision=issues.some(issue=>issue.status==='FAIL')?'FAIL':issues.length?'BLOCKED':'PASS';
  const evaluation:ValidationEvaluation={decision,issues:issues.map(issue=>({rule:(issue.sheet??'ORG_EVOLUTION')+'_'+issue.code,layer:2,row:issue.row,field:issue.field,status:issue.status==='FAIL'?'FAIL':'UNKNOWN',code:issue.code})),layers:[{layer:1,status:parsed.structuralStatus==='PARSED'?'PASS':'FAIL'},{layer:2,status:decision==='PASS'?'PASS':decision==='FAIL'?'FAIL':'UNKNOWN'}],evidenceRequirements:[],dependencies:[],interpretationPolicy:'EXACT_TEXT_V1'};
  return recordOwnerFileValidation(s,provider,actor,{jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId,campus,requestId:randomUUID(),parseRequestId:randomUUID(),outputRequestId:randomUUID(),contractVersionId:j.contract.versionId,ruleVersion:j.contract.definition.ruleVersion,parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1',structuralStatus:parsed.structuralStatus,parsed:{sourceArtifactId,result:parsed},evaluation});
 };
 const inspectInput=async(s:Scope,actor:string,id:string)=>{
  const r=await record(s,actor,id),input=unseal<EvolutionStoredStageInput>('EVOLUTION_INPUT_V1',r,EvolutionStoredStageSchema),j=await inputJob(s,actor,id),c=j.contract;
  await authorizeInputSources(s,actor,input,true);
  if(j.currentRevisionId!==r.job_revision||j.status==='REJECTED')throw new Error('STALE_REVISION');
  const verification=r.verification?unseal<EvolutionVerifyInput>('EVOLUTION_VERIFICATION_V1',r.verification,EvolutionStoredVerifySchema):null;
  const issues:EvolutionIssue[]=[],heads:DepartmentHistory[]=[],lifecycleHeads:unknown[]=[],materials:Array<{id:string;digest:string}>=[],policies:ImportContractItem[]=[],successorFacts:Array<{alias:string;facts:Record<string,unknown>;contentDigest:string}>=[];
  const issue=(field:string,code:string,status:EvolutionIssue['status']='BLOCKED',row=0)=>issues.push({row,field,code,status});
  const now=(await sql<{r:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') r`.execute(s)).rows[0]!.r;
  if(input.profile!=='CORE'||j.profile!=='CORE'||!assertContract(c,'ORG26','ORG_EVOLUTION_CORE_V1',ORG26_FIELDS))issue('profile','BLOCKED_DEPENDENCY');
  for(const [cid,vid,dataset,template,fields] of [
   [c.id,c.versionId,'ORG26','ORG_EVOLUTION_CORE_V1',ORG26_FIELDS],
   [input.contracts.successionContractId,input.contracts.successionContractVersionId,'ORG27','ORG_SUCCESSION_CORE_V1',ORG27_FIELDS],
   [input.contracts.departmentContractId,input.contracts.departmentContractVersionId,'ORG04','ORG04_CORE_V1',ORG04_FIELDS],
  ] as const){const p=await currentContract(s,actor,cid,vid,now);policies.push(p);if(!assertContract(p,dataset,template,fields))issue('contracts','BLOCKED_DEPENDENCY');}
  const file=await readFile(s,actor,r,input,policies);
  if(file){
   issues.push(...file.parsed.issues.map(item=>({row:item.row,field:'',code:item.code,status:'FAIL' as const,...(item.sheet?{sheet:item.sheet}:{})})));
   if(file.parsed.structuralStatus==='PARSED'&&(canonicalPlan(file.parsed.sheets.ORG26.rows)!==canonicalPlan([input.event])||canonicalPlan(file.parsed.sheets.ORG27.rows)!==canonicalPlan(input.relations)||canonicalPlan(file.parsed.sheets.ORG04.rows)!==canonicalPlan(input.successors.map(entry=>entry.row))))issue('sourceArtifactId','PAYLOAD_UNAVAILABLE','FAIL');
  }
  let effectiveAt:string|undefined;
  try{effectiveAt=localTime(input.event.effective_at);localTime(input.event.recorded_at);for(const rel of input.relations)localTime(rel.recorded_at);}catch{issue('effective_at','LOCAL_TIME_REQUIRED','FAIL');}
  if(!['RENAME','SPLIT','MERGE'].includes(input.event.change_type))issue('change_type','BLOCKED_DEPENDENCY');
  for(const [field,value] of Object.entries(input.event))if(value!==value.trim())issue(field,'CLOSED_INPUT_REQUIRED','FAIL');
  if(new Set(input.impacts.map(x=>x.domain)).size!==EVOLUTION_IMPACT_DOMAINS.length||EVOLUTION_IMPACT_DOMAINS.some(domain=>!input.impacts.some(x=>x.domain===domain)))issue('impacts','CLOSED_INPUT_REQUIRED','FAIL');
  if(input.impacts.some(x=>x.determination==='UNKNOWN'))issue('impacts','BLOCKED_DEPENDENCY');
  if(input.impacts.some(impact=>impact.determination==='AFFECTED'&&!impact.requiredAction.trim()))issue('impacts','DISPOSITION_INCOMPLETE');
  const migrationRequired=input.impacts.some(x=>x.determination==='AFFECTED'&&['PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER','SOURCE_MAPPING'].includes(x.domain));
  if(migrationRequired&&(!input.event.migration_plan_ref||!input.migrationEvidenceId)||Boolean(input.event.migration_plan_ref)!==Boolean(input.migrationEvidenceId))issue('migration_plan_ref','BLOCKED_DEPENDENCY');
  if(input.event.change_type==='SPLIT'&&!input.contextEvidenceId)issue('context_rule','BLOCKED_DEPENDENCY');
  const graph=validateSuccessionGraph({changeType:input.event.change_type,predecessors:input.predecessors.map(x=>x.id),successors:input.event.change_type==='RENAME'?input.predecessors.map(x=>x.id):input.successors.map(x=>x.row.org_id),edges:input.relations.map(x=>({from:x.from_target_id,to:x.to_target_id,scope:x.transfer_scope,context:x.context_rule}))});issues.push(...graph.issues);
  const keys=new Set<string>();for(const [i,rel] of input.relations.entries()){
   if(rel.org_event_id!==input.event.org_event_id||keys.has(rel.succession_id))issue('org_event_id','BATCH_CONFLICT','FAIL',i+1);keys.add(rel.succession_id);
   if(rel.from_target_type!=='ORG'||rel.to_target_type!=='ORG')issue('target_type','BLOCKED_DEPENDENCY','BLOCKED',i+1);
  }
  for(const ref of input.predecessors){
   let h:DepartmentHistory;
   try{h=await recoverable(s,async()=>(await sql<{r:DepartmentHistory}>`select department_master.snapshot(${actor},${ref.id}::uuid) r`.execute(s)).rows[0]!.r);}
   catch(error){if(!(error instanceof Error&&error.message==='NOT_FOUND'))throw error;issue('predecessors','BLOCKED_DEPENDENCY');continue;}
   const head=h.versions.at(-1),effective=effectiveAt?h.versions.filter(version=>stamp(version.valid_from)<=effectiveAt!&&(version.valid_to===null||stamp(version.valid_to)>effectiveAt!)).at(-1):undefined;
   const relevant=h.versions.filter(version=>version.id===head?.id||version.id===effective?.id);heads.push({...h,versions:relevant});
   for(const version of relevant)await sql`select department_master.evolution_source_authorize(${actor},${version.facts.sourceSystemId}::uuid)`.execute(s);
   if(BigInt(ref.expectedVersion)>MAX_EXPECTED_VERSION)issue('predecessors','CLOSED_INPUT_REQUIRED','FAIL');
   if(!head||head.number!==ref.expectedVersion)issue('predecessors','STALE_VALIDATION');
   if(effectiveAt&&!effective)issue('predecessors','BLOCKED_DEPENDENCY');
   if(effectiveAt&&h.versions.some(version=>stamp(version.valid_from)>effectiveAt))issue('predecessors','STALE_VALIDATION');
   const replaced=(await sql<{r:{effective_at:string}|null}>`select department_master.replacement_read(${actor},${ref.id}::uuid,NULL) r`.execute(s)).rows[0]!.r;if(replaced&&(input.event.change_type!=='RENAME'||!effectiveAt||stamp(replaced.effective_at)<=effectiveAt))issue('predecessors','UNSUPPORTED_STATE_TRANSITION','FAIL');
   if(effectiveAt){const lifecycle=(await sql<{r:{lifecycle:unknown[]}}> `select department_master.lifecycle_snapshot(${actor},${ref.id}::uuid,NULL) r`.execute(s)).rows[0]!.r.lifecycle;lifecycleHeads.push({departmentId:ref.id,lifecycle,replacement:replaced});const admissible=(await sql<{r:boolean}>`select department_master.lifecycle_state_admission(${actor},${ref.id}::uuid,${effectiveAt}::timestamp,${effectiveAt}::timestamp+interval '1 microsecond') r`.execute(s)).rows[0]!.r;if(!admissible)issue('predecessors','UNSUPPORTED_STATE_TRANSITION','FAIL');}
  }
  if(input.event.change_type==='RENAME'&&(!input.rename||input.successors.length))issue('rename','CLOSED_INPUT_REQUIRED','FAIL');
  if(['SPLIT','MERGE'].includes(input.event.change_type)&&input.rename!==null)issue('rename','CLOSED_INPUT_REQUIRED','FAIL');
  if(verification){if(verification.inputDigest!==r.digest)throw new Error('STALE_VALIDATION');if(await authorize(s,r.verification!.actor,r.campus,'VERIFY')!==r.verification!.identity_code)throw new Error('ACCESS_DENIED');if(!verification.materialsAccepted||!verification.policyApproved)issue('verification','LEGAL_REVIEW_REQUIRED');if(new Set(verification.impactReviews.map(review=>review.domain)).size!==EVOLUTION_IMPACT_DOMAINS.length||EVOLUTION_IMPACT_DOMAINS.some(domain=>!verification.impactReviews.some(review=>review.domain===domain&&review.ownerAttestationAccepted&&review.dispositionAccepted)))issue('impacts','LEGAL_REVIEW_REQUIRED');}
  else issue('verification','LEGAL_REVIEW_REQUIRED');
  let sourcePin:unknown=null;
  if(effectiveAt){
   const coversEvent=(from:string,to:string|null)=>from<=effectiveAt!&&(to===null||effectiveAt!<to);
   if(!coversEvent(c.validFrom,c.validTo))issue('effective_at','BLOCKED_DEPENDENCY');
   const changeCodes=c.definition.codeSets.find(x=>x.field==='change_type');if(!changeCodes||changeCodes.status!=='SYNTHETIC_ADOPTED'||!changeCodes.codes.includes(input.event.change_type)||!coversEvent(changeCodes.validFrom,changeCodes.validTo))issue('change_type','BLOCKED_DEPENDENCY');
   const successionPolicy=policies[1]!;if(!coversEvent(successionPolicy.validFrom,successionPolicy.validTo))issue('relations','BLOCKED_DEPENDENCY');
   for(const field of ['from_target_type','to_target_type'] as const){const codes=successionPolicy.definition.codeSets.find(set=>set.field===field);if(!codes||codes.status!=='SYNTHETIC_ADOPTED'||!coversEvent(codes.validFrom,codes.validTo)||input.relations.some(relation=>!codes.codes.includes(relation[field])))issue(field,'BLOCKED_DEPENDENCY');}
   const ids=new Set([input.decisionEvidenceId,...input.impacts.map(x=>x.evidenceId),...(input.migrationEvidenceId?[input.migrationEvidenceId]:[]),...(input.contextEvidenceId?[input.contextEvidenceId]:[])]);
   try{sourcePin=await recoverable(s,async()=>(await sql<{r:{sourceId:string;versionId:string|null}}>`select department_master.mapping_source(${actor},${input.sourceSystemId}::uuid,${effectiveAt}::timestamp,${effectiveAt}::timestamp+interval '1 microsecond',true) r`.execute(s)).rows[0]!.r);if((sourcePin as {versionId:string|null}).versionId!==c.definition.sourceVersionId)issue('sourceSystemId','BLOCKED_DEPENDENCY');}catch(error){if(error instanceof Error&&error.message==='ACCESS_DENIED')throw error;issue('sourceSystemId','BLOCKED_DEPENDENCY');}
   if(!c.definition.sourceVersionId)issue('sourceSystemId','BLOCKED_DEPENDENCY');else for(const eid of ids)try{
    const material=await recoverable(s,()=>evidence(s,actor,eid,c.definition.sourceVersionId!,r.campus));
    if(r.verification)await recoverable(s,()=>evidence(s,r.verification!.actor,eid,c.definition.sourceVersionId!,r.campus));materials.push(material);
   }catch(error){if(error instanceof Error&&['ACCESS_DENIED','KEY_UNAVAILABLE'].includes(error.message))throw error;issue('evidenceId','BLOCKED_DEPENDENCY');}
   const departmentPolicy=policies[2]!;
   for(const [index,raw] of input.successors.entries()){
    try{
     const entry=normalizeEntry(raw,'LOCAL');
     if(entry.intent!=='CREATE'||entry.target!==null||entry.origin!=='NEW'||entry.validFrom!==effectiveAt||entry.row.record_status!=='ACTIVE'||entry.row.abolished_on||!entry.row.established_on||!entry.row.establishment_doc||!entry.row.approval_ref)throw new Error('CLOSED_INPUT_REQUIRED');
     if(!covered([{from:departmentPolicy.validFrom,to:departmentPolicy.validTo}],entry.validFrom,entry.validTo))throw new Error('BLOCKED_DEPENDENCY');
     for(const field of ['org_type','is_virtual','record_status'] as const){const codes=departmentPolicy.definition.codeSets.find(x=>x.field===field);if(!codes||codes.status!=='SYNTHETIC_ADOPTED'||!codes.codes.includes(entry.row[field])||!covered([{from:codes.validFrom,to:codes.validTo}],entry.validFrom,entry.validTo))throw new Error('BLOCKED_DEPENDENCY');}
     if((await sql<{r:boolean}>`select department_master.code_conflict(${actor},${entry.row.org_code},NULL) r`.execute(s)).rows[0]!.r)issue('org_code','IDENTIFIER_CONFLICT','FAIL',index+1);
     const proof=await recoverable(s,async()=>{
      const pin=(await sql<{r:unknown}>`select department_master.mapping_source(${actor},${entry.row.source_system_id}::uuid,${entry.validFrom}::timestamp,${entry.validTo}::timestamp,true) r`.execute(s)).rows[0]!.r;
      const authorizedProof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select department_master.evidence(${actor},${entry.evidenceId}::uuid,${entry.row.source_system_id}::uuid,${departmentPolicy.definition.sourceVersionId}::uuid,${r.campus},${entry.validFrom}::timestamp,${entry.validTo}::timestamp) r`.execute(s)).rows[0]!.r;
      const authenticated=authenticateRegistrationEvidence(authorizedProof,provider);authenticated.fill(0);
      const material=await evidence(s,actor,entry.evidenceId,departmentPolicy.definition.sourceVersionId!,r.campus);
      if(r.verification)await evidence(s,r.verification.actor,entry.evidenceId,departmentPolicy.definition.sourceVersionId!,r.campus);return {pin,material};
     });materials.push(proof.material);
     const {sourceRow:_,...normalized}=entry;
  const facts={name:entry.row.org_name,shortName:entry.row.org_short_name||null,orgType:entry.row.org_type,establishedOn:entry.row.established_on,description:entry.row.description||null,virtual:entry.row.is_virtual==='Y',historicalException:false,sourceVersion:entry.row.version_no,sourceRecordedAt:entry.recordedAt,sourceSystemId:entry.row.source_system_id,policyVersionId:departmentPolicy.versionId,verificationId:r.verification?.id??'',commandDigest:planBinding(provider,'EVOLUTION_DEPARTMENT_COMMAND_V1',{entry:normalized,policy:departmentPolicy.versionId,proof}),sourcePin:proof.pin};
     successorFacts.push({alias:entry.row.org_id,facts,contentDigest:planBinding(provider,'DEPARTMENT_FACTS_V1',facts)});
    }catch(error){if(error instanceof Error&&['ACCESS_DENIED','KEY_UNAVAILABLE'].includes(error.message))throw error;issue('successors',error instanceof Error&&['CLOSED_INPUT_REQUIRED','LOCAL_TIME_REQUIRED'].includes(error.message)?error.message:'BLOCKED_DEPENDENCY','BLOCKED',index+1);}
   }
  }
  // A new Department produces identity, version, permanent code reservation
  // and its code assertion. Count all four domain writes in the shared budget.
  if(input.compensatesEvent){const original=await snapshot(s,actor,input.compensatesEvent.id,input.campus);if(localTime(input.event.effective_at)<=stamp(original.effective_at)||input.predecessors.some(ref=>!original.relations.some(r=>r.to_department_id===ref.id)))issue('compensatesEvent','UNSUPPORTED_STATE_TRANSITION');}
  const expandedCount=evolutionExpandedWriteCount(input);
  if(expandedCount>100)issue('event','PLAN_INPUT_LIMIT','FAIL');
  const assessment=issues.every(item=>item.code==='LEGAL_REVIEW_REQUIRED')?await impacts.observe(s,actor,{kind:'INPUT',id:r.id}):null;
  for(const domain of ['SOURCE_MAPPING','IDENTIFIER','HIERARCHY','WARD','UNIT_WARD_RELATION'] as const){
   if(assessment?.references.some(ref=>ref.owner===domain&&ref.constraint==='UNSATISFIED')&&input.impacts.find(impact=>impact.domain===domain)?.determination!=='AFFECTED')issue('impacts','IMPACT_DECLARATION_CONFLICT');
  }
  if(verification&&!verification.impactAssessment)issue('impacts','IMPACT_ASSESSMENT_REQUIRED');
  if(assessment&&verification&&verification.impactAssessment?.digest!==assessment.dependencyDigest)issue('impacts','STALE_VALIDATION');
  let campusChanges:unknown[]|undefined;
  if(input.campusChanges?.length)try{campusChanges=await recoverable(s,()=>lifecycle().inspectEvolutionCampusChangesInTransaction(s,actor,input));if(r.verification)await lifecycle().authorizeEvolutionCampusChangesInTransaction(s,r.verification.actor,input);}catch(error){if(error instanceof Error&&error.message==='ACCESS_DENIED')throw error;issue('campusChanges',error instanceof Error?error.message:'BLOCKED_DEPENDENCY');}
  const facts={...(campusChanges?{campusChanges}:{}),...(input.compensatesEvent?{compensatesEvent:input.compensatesEvent}:{}),impactAssessment:verification?.impactAssessment??null,event:input.event,sourceSystemId:input.sourceSystemId,contractVersionId:c.versionId,companionVersions:input.contracts,verificationId:r.verification?.id??null,impacts:input.impacts,materials,sourcePin,sourceArtifact:file?.binding??null,successorFacts};
  return {r,input,j,verification,policies,heads,lifecycleHeads,materials,sourcePin,file,issues,expandedCount,facts,graph,assessment};
 };
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,action){const r=await record(s,actor,input.jobId,action);if(r.revision!==input.revisionId||r.campus!==input.campus||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');await record(s,actor,r.id,'READ_RESTRICTED');},
  async authorizeApproval(s,actor,input){const r=await record(s,actor,input.jobId,'REVIEW');if(await authorize(s,actor,r.campus,'REVIEW')===r.identity_code)throw new Error('MAKER_CHECKER_REQUIRED');},
  async authorizeFrozen(s,actor,unit){
   const input=unit.basis['entries'] as EvolutionStoredStageInput;check(EvolutionStoredStageSchema,input);
   if(input.campusChanges?.length)await lifecycle().authorizeEvolutionCampusChangesInTransaction(s,actor,input);
   const policies=unit.basis['policies'] as ImportContractItem[],eventSource=policies[0]?.definition.sourceVersionId,departmentSource=policies[2]?.definition.sourceVersionId;
   if(!eventSource||!departmentSource)throw new Error('BLOCKED_DEPENDENCY');
   const heads=unit.basis['heads'] as DepartmentHistory[];
   for(const sourceId of new Set([input.sourceSystemId,...input.successors.map(entry=>entry.row.source_system_id),...heads.flatMap(head=>head.versions.map(version=>version.facts.sourceSystemId))]))await sql`select department_master.evolution_source_authorize(${actor},${sourceId}::uuid)`.execute(s);
   for(const id of new Set([input.decisionEvidenceId,...input.impacts.map(impact=>impact.evidenceId),...(input.migrationEvidenceId?[input.migrationEvidenceId]:[]),...(input.contextEvidenceId?[input.contextEvidenceId]:[])]))await evidenceAccess(s,actor,id,eventSource,input.campus);
   for(const entry of input.successors)await evidenceAccess(s,actor,entry.evidenceId,departmentSource,input.campus);
   if(input.sourceArtifactId)await evidenceAccess(s,actor,input.sourceArtifactId,eventSource,input.campus);
   if(unit.basis['assessment']){check(DepartmentAssessmentSchema,unit.basis['assessment']);await impacts.authorizeFrozen(s,actor,unit.basis['assessment'] as DepartmentAssessment);}
  },
  async observe(s,actor,input){const v=await inspectInput(s,actor,input.jobId);return {input,atomicRule:'ORG_EVOLUTION_WHOLE_EVENT_V1',basis:{assessment:v.assessment,inputDigest:v.r.digest,entries:v.input,verification:v.verification,verificationDigest:v.r.verification?.digest??null,policies:v.policies,heads:v.heads,lifecycleHeads:v.lifecycleHeads,materials:v.materials,sourcePin:v.sourcePin,issues:v.issues,expandedCount:v.expandedCount},commands:v.issues.length?[]:[{owner:'department-master/organization-evolution',row:1,intent:'CREATE',target:null,aliases:[],value:{inputId:v.r.id,command:canonicalPlan(v.input),facts:canonicalPlan(v.facts),expandedCount:String(v.expandedCount)}}],diff:[{changeType:v.input.event.change_type,effectiveAt:v.input.event.effective_at,predecessors:v.heads,successors:v.input.successors,rename:v.input.rename,impacts:v.input.impacts}]};},
  async validate(_s,_actor,unit,stage){if(stage==='FREEZE')return;const issues=unit.basis['issues'] as EvolutionIssue[];if(issues.length)throw new Error(issues[0]!.code);if(unit.commands.length!==1)throw new Error('BATCH_REJECTED');},
  async apply(s,actor,command,_resolved,approval){const input:unknown=JSON.parse(command.value['command']!),facts:unknown=JSON.parse(command.value['facts']!);check(EvolutionStoredStageSchema,input);assertEvolutionApplyBinding(provider,input as EvolutionStoredStageInput,facts,command.value['expandedCount']);return {ok:true,fact:await mutate<OwnerFact>(s,actor,{operation:'APPLY',inputId:command.value['inputId'],command:input,facts,contentDigest:planBinding(provider,'EVOLUTION_FACTS_V1',facts),...approval})};},
  async exactRead(s,actor,input,fact){if(fact.owner!=='department-master/organization-evolution'||fact.version!=='1')return null;await snapshot(s,actor,fact.id,input.campus);return fact;},
 };
 let lifecycleOwner:ReturnType<typeof openDepartmentLifecycle>|undefined;
 const lifecycle=()=>lifecycleOwner??=openDepartmentLifecycle(connection,provider,impactPorts);
 const impacts=departmentImpacts(root,async(s,actor,target)=>{
  const context=(await sql<{r:{owner:string;input_id:string}}>`select department_master.impact_change_context(${actor},${target.id}::uuid,${target.kind},${target.kind==='EVENT'?target.campus:null}) r`.execute(s)).rows[0]!.r;
  if(context.owner==='department-master/lifecycle')return lifecycle().impactContextInTransaction(s,actor,context.input_id);
  const id=target.kind==='INPUT'?target.id:(await snapshot(s,actor,target.id,target.campus)).input_id;
  const r=await record(s,actor,id),input=unseal<EvolutionStoredStageInput>('EVOLUTION_INPUT_V1',r,EvolutionStoredStageSchema);
  await authorizeInputSources(s,actor,input);
  const changeType=input.event.change_type;if(changeType!=='RENAME'&&changeType!=='SPLIT'&&changeType!=='MERGE')throw new Error('BLOCKED_DEPENDENCY');return {inputId:r.id,inputDigest:r.digest,profile:input.profile,campus:input.campus,departmentIds:input.predecessors.map(r=>r.id),effectiveAt:input.event.effective_at,changeType};
 },impactPorts,provider,async(s,actor,eventId,campus,evidenceId,admission)=>{
  const context=(await sql<{r:{owner:string;input_id:string}}>`select department_master.impact_change_context(${actor},${eventId}::uuid,'EVENT',${campus}) r`.execute(s)).rows[0]!.r;
  if(context.owner==='department-master/lifecycle')return lifecycle().impactEvidenceInTransaction(s,actor,context.input_id,evidenceId,admission);
  const event=await snapshot(s,actor,eventId,campus),r=await record(s,actor,event.input_id),raw=unseal<EvolutionStoredStageInput>('EVOLUTION_INPUT_V1',r,EvolutionStoredStageSchema),j=await inputJob(s,actor,r.id),sourceVersion=j.contract.definition.sourceVersionId;
  // Dispositions belong to an accepted event, not to today's import contracts.
  // Reauthorize its exact companion versions without requiring current admission.
  if(j.contract.versionId!==event.facts['contractVersionId'])throw new Error('PAYLOAD_UNAVAILABLE');
  for(const [id,versionId] of [[raw.contracts.successionContractId,raw.contracts.successionContractVersionId],[raw.contracts.departmentContractId,raw.contracts.departmentContractVersionId]]){
   const accepted=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'HISTORY',target:id,versionId})}::jsonb) r`.execute(s)).rows[0]!.r;
   if(!accepted.some(contract=>contract.versionId===versionId))throw new Error('BLOCKED_DEPENDENCY');
  }
  if(!sourceVersion)throw new Error('BLOCKED_DEPENDENCY');
  if(!admission){await evidenceAccess(s,actor,evidenceId,sourceVersion,campus);return '';}
  await authenticateBoundEvidence(s,actor,evidenceId,raw.sourceSystemId,sourceVersion,campus,localTime(raw.event.effective_at),null,true);
  return (await evidence(s,actor,evidenceId,sourceVersion,campus)).digest;
 });
 const coordinator=applyCoordinator(db,provider,port);
 const files=fileIntake(db,provider);
 const stageIn=(s:Scope,actor:string,input:EvolutionStoredStageInput)=>{
  if(new Set(input.impacts.map(x=>x.domain)).size!==EVOLUTION_IMPACT_DOMAINS.length||EVOLUTION_IMPACT_DOMAINS.some(domain=>!input.impacts.some(x=>x.domain===domain)))throw new Error('CLOSED_INPUT_REQUIRED');
  return mutate<{inputId:string;revisionId:string;digest:string}>(s,actor,{operation:'STAGE',...input,...seal('EVOLUTION_INPUT_V1',input)});
 };
 const queryIn=async(s:Scope,actor:string,input:{id:string;campus:'NORTH'|'SOUTH';businessAt:string;recordAsOf?:string})=>{
  const businessAt=localTime(input.businessAt),recordAsOf=input.recordAsOf===undefined?null:localTime(input.recordAsOf),e=await snapshot(s,actor,input.id,input.campus);
  if(recordAsOf!==null&&stamp(e.recorded_at)>recordAsOf)throw new Error('NOT_FOUND');
  const predecessors=[...new Map(e.relations.map(relation=>[relation.from_department_id,{id:relation.from_department_id,version:relation.fromVersion,versionId:relation.from_version_id}])).values()];
  const successors=[...new Map(e.relations.map(relation=>[relation.to_department_id,{id:relation.to_department_id,version:relation.toVersion,versionId:relation.to_version_id}])).values()];
  const aliasMap=[{dataset:'ORG26' as const,sourceClientKey:e.source_client_key,id:e.id,version:'1',sourceRow:e.source_row},...e.relations.map(relation=>({dataset:'ORG27' as const,sourceClientKey:relation.source_client_key,id:relation.id,version:'1',sourceRow:relation.source_row})),...[...new Map(e.relations.filter(relation=>relation.relation_kind==='SUCCESSION').map(relation=>[relation.to_department_id,{dataset:'ORG04' as const,sourceClientKey:relation.source_to_alias,id:relation.to_department_id,version:relation.toVersion,sourceRow:relation.toSourceRow}])).values()]];
  return {id:e.id,changeType:e.change_type,effectiveAt:stamp(e.effective_at),recordedAt:stamp(e.recorded_at),effective:stamp(e.effective_at)<=businessAt,sourceClientKey:e.source_client_key,aliasMap,facts:e.facts,predecessors,successors,relations:e.relations.map(relation=>({...relation,source_recorded_at:stamp(relation.source_recorded_at),recorded_at:stamp(relation.recorded_at)})),edges:e.relations.filter(relation=>relation.relation_kind==='SUCCESSION').map(relation=>({id:relation.id,from:relation.from_department_id,to:relation.to_department_id,transferScope:relation.transfer_scope,contextRule:relation.context_rule})),handoff:'NOT_EXECUTED' as const};
 };
const stageInTransaction=async(s:Scope,actor:string,raw:EvolutionStageInput)=>{check(EvolutionStageSchema,raw);const input:EvolutionStoredStageInput={...structuredClone(raw),sourceRows:{event:1,relations:raw.relations.map((_,i)=>i+1),successors:raw.successors.map((_,i)=>i+1)}};const j=await job(s,actor,input.jobId);if(j.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');if(j.revisions.at(-1)?.input.kind!=='METADATA_ONLY')throw new Error('FILE_REVISION_REQUIRED');await authorizeInputSources(s,actor,input,true);return stageIn(s,actor,input);};
const stage=(actor:string,raw:EvolutionStageInput)=>root(scope=>stageInTransaction(scope,actor,raw));
 return {
  commandsInTransaction:(scope:Scope)=>({stage:(actor:string,input:EvolutionStageInput)=>stageInTransaction(scope,actor,input),recordDisposition:(actor:string,input:import('./department-impact-contracts.js').RecordDispositionInput)=>impacts.recordDispositionInTransaction(scope,actor,input),authorizeCandidateAccess:(actor:string,input:{candidateId:string})=>coordinator.authorizeCandidateAccessInTransaction(scope,actor,input)}),
  async compensateEvolution(actor:string,input:EvolutionStageInput){if(!input.compensatesEvent)throw new Error('CLOSED_INPUT_REQUIRED');return stage(actor,input);},
  readDepartmentAssessment:impacts.readDepartmentAssessment,listDepartmentAssessments:impacts.listDepartmentAssessments,assessDepartmentChange:impacts.assessDepartmentChange,listImpactCases:impacts.listImpactCases,
  recordMigrationReceipt:impacts.recordMigrationReceipt,readMigrationHandoff:impacts.readMigrationHandoff,readImpactCase:impacts.readImpactCase,assignImpactCase:impacts.assignImpactCase,recordDisposition:impacts.recordDisposition,approveDisposition:impacts.approveDisposition,recheckImpact:impacts.recheckImpact,
  stage,
  async template(actor:string,input:EvolutionTemplateInput){
   check(EvolutionTemplateSchema,input);return root(async s=>{
    await authorize(s,actor,input.campus,'READ');const now=(await sql<{r:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') r`.execute(s)).rows[0]!.r;
    const policies=await Promise.all([currentContract(s,actor,input.contractId,input.contractVersionId,now),currentContract(s,actor,input.contracts.successionContractId,input.contracts.successionContractVersionId,now),currentContract(s,actor,input.contracts.departmentContractId,input.contracts.departmentContractVersionId,now)]);
    if(!assertContract(policies[0]!,'ORG26','ORG_EVOLUTION_CORE_V1',ORG26_FIELDS)||!assertContract(policies[1]!,'ORG27','ORG_SUCCESSION_CORE_V1',ORG27_FIELDS)||!assertContract(policies[2]!,'ORG04','ORG04_CORE_V1',ORG04_FIELDS))throw new Error('BLOCKED_DEPENDENCY');
    const bytes=textSheetsWorkbook({ORG26:[policies[0]!.definition.fields.map(field=>field.code)],ORG27:[policies[1]!.definition.fields.map(field=>field.code)],ORG04:[policies[2]!.definition.fields.map(field=>field.code)]});
    try{return {filename:'organization-evolution-core-v1.xlsx',bytesBase64:bytes.toString('base64'),parserPolicy:'STRICT_ORGANIZATION_EVOLUTION_V1' as const,contractVersions:policies.map(policy=>({dataset:policy.dataset,contractId:policy.id,versionId:policy.versionId}))};}finally{bytes.fill(0);}
   });
  },
  async receiveFile(actor:string,raw:EvolutionReceiveInput,bytes:Uint8Array){
   check(EvolutionReceiveSchema,raw);const input=structuredClone(raw);
   if(input.job.scope!=='SYNTHETIC'||input.job.input.kind!=='FILE'||input.job.input.format!=='XLSX'||input.job.input.parserPolicy!=='STRICT_ORGANIZATION_EVOLUTION_V1')throw new Error('CLOSED_INPUT_REQUIRED');
   await root(async s=>{await authorize(s,actor,input.campus,'WRITE');await sql`select department_master.evolution_source_authorize(${actor},${input.sourceSystemId}::uuid)`.execute(s);});
   const received=await files.receiveFile(actor,{job:input.job,fileRequestId:input.fileRequestId,extension:'.xlsx',campus:input.campus,purpose:'IDENTITY_VERIFY',retentionSeconds:input.retentionSeconds},bytes);
   return root(async s=>{
    const j=await job(s,actor,received.job.id),now=(await sql<{r:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') r`.execute(s)).rows[0]!.r;
    const policies=[j.contract,await currentContract(s,actor,input.contracts.successionContractId,input.contracts.successionContractVersionId,now),await currentContract(s,actor,input.contracts.departmentContractId,input.contracts.departmentContractVersionId,now)];
    // The Owner inspects quarantined bytes internally before there is a bound
    // input. Generic byte release requires that authenticated input afterwards.
    const sourceVersion=j.contract.definition.sourceVersionId;if(!sourceVersion)throw new Error('BLOCKED_DEPENDENCY');
    const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${received.artifact.artifactId}::uuid,${sourceVersion}::uuid,${input.campus}) r`.execute(s)).rows[0]!.r;
    if(proof.binding[0]!==j.id||proof.binding[1]!==received.job.revisionId||proof.binding[2]!=='RAW_FILE')throw new Error('ACCESS_DENIED');
    const content=authenticateRegistrationEvidence(proof,provider);
    try{
     const parsed=await parseEvolutionWorkbookBounded(content,workbookFields(policies)),issues:EvolutionIssue[]=parsed.issues.map(item=>({row:item.row,field:'',code:item.code,status:'FAIL',...(item.sheet?{sheet:item.sheet}:{})}));
     if(parsed.structuralStatus==='PARSED'){
      if(parsed.sheets.ORG26.rows.length!==1||parsed.sheets.ORG27.rows.length<1||parsed.sheets.ORG27.rows.length>100||parsed.sheets.ORG04.rows.length!==input.successors.length)issues.push({row:0,field:'event',code:'SUCCESSION_SHAPE',status:'FAIL'});
      for(const row of parsed.sheets.ORG26.rows)try{check(EvolutionEventRowSchema,row);}catch{issues.push({row:2,field:'',code:'CLOSED_INPUT_REQUIRED',status:'FAIL',sheet:'ORG26'});}
      for(const [index,row] of parsed.sheets.ORG27.rows.entries())try{check(EvolutionRelationRowSchema,row);}catch{issues.push({row:index+2,field:'',code:'CLOSED_INPUT_REQUIRED',status:'FAIL',sheet:'ORG27'});}
      for(const [index,row] of parsed.sheets.ORG04.rows.entries())try{validateORG04(row);}catch{issues.push({row:index+2,field:'',code:'CLOSED_INPUT_REQUIRED',status:'FAIL',sheet:'ORG04'});}
     }
     const base={jobId:j.id,revisionId:received.job.revisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,issues};
     if(issues.length){await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,issues);return {...base,input:null};}
     const {job:_,fileRequestId:__,retentionSeconds:___,successors,...control}=input;
     const staged:EvolutionStoredStageInput={...control,jobId:j.id,revisionId:received.job.revisionId,profile:j.profile,event:parsed.sheets.ORG26.rows[0] as EvolutionStoredStageInput['event'],relations:parsed.sheets.ORG27.rows as EvolutionStoredStageInput['relations'],successors:parsed.sheets.ORG04.rows.map((row,index)=>({...successors[index]!,row:validateORG04(row)})),sourceArtifactId:received.artifact.artifactId,sourceRows:{event:parsed.sheets.ORG26.cells[0]!.sourceRow,relations:parsed.sheets.ORG27.rows.map((_,index)=>parsed.sheets.ORG27.cells.find(cell=>cell.row===index+1)!.sourceRow),successors:parsed.sheets.ORG04.rows.map((_,index)=>parsed.sheets.ORG04.cells.find(cell=>cell.row===index+1)!.sourceRow)}};
     check(EvolutionStoredStageSchema,staged);await authorizeInputSources(s,actor,staged,true);const result=await stageIn(s,actor,staged);return {...base,input:result};
    }finally{content.fill(0);}
   });
  },
  async readInput(actor:string,input:{inputId:string}){
   check(oneInput,input);return root(async s=>{
    const stored=unseal<EvolutionStoredStageInput>('EVOLUTION_INPUT_V1',await record(s,actor,input.inputId),EvolutionStoredStageSchema);
    // Raw rows still require current source READ; material references need
    // not resolve merely to inspect an incomplete candidate for correction.
    await authorizeInputSources(s,actor,stored,true);
    return stored;
   });
  },
  async preview(actor:string,input:{inputId:string}){check(oneInput,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);return {input:v.input,heads:v.heads,verification:v.verification,issues:v.issues};});},
  async validate(actor:string,input:{inputId:string}){check(oneInput,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId),validationRunId=v.file?(await saveValidation(s,actor,v.j,v.r.campus,v.file.binding.id,v.file.parsed,v.issues)).run.runId:null;return {inputId:v.r.id,digest:v.r.digest,decision:v.issues.some(i=>i.status==='FAIL')?'FAIL' as const:v.issues.length?'BLOCKED' as const:'PASS' as const,issues:v.issues,expandedCount:v.expandedCount,validationRunId};});},
  async verify(actor:string,input:EvolutionVerifyInput){check(EvolutionVerifySchema,input);return root(async s=>{
   const r=await record(s,actor,input.inputId,'VERIFY'),raw=unseal<EvolutionStoredStageInput>('EVOLUTION_INPUT_V1',r,EvolutionStoredStageSchema),j=await inputJob(s,actor,r.id),policies=await exactPolicies(s,actor,j,raw);
   const eventSource=policies[0]!.definition.sourceVersionId,departmentSource=policies[2]!.definition.sourceVersionId;if(!eventSource||!departmentSource)throw new Error('BLOCKED_DEPENDENCY');
   await authorizeInputSources(s,actor,raw);
   const file=await readFile(s,actor,r,raw,policies);
   if(file&&(file.parsed.structuralStatus!=='PARSED'||canonicalPlan(file.parsed.sheets.ORG26.rows)!==canonicalPlan([raw.event])||canonicalPlan(file.parsed.sheets.ORG27.rows)!==canonicalPlan(raw.relations)||canonicalPlan(file.parsed.sheets.ORG04.rows)!==canonicalPlan(raw.successors.map(entry=>entry.row))))throw new Error('PAYLOAD_UNAVAILABLE');
   const eventAt=localTime(raw.event.effective_at);
   for(const id of new Set([raw.decisionEvidenceId,...raw.impacts.map(x=>x.evidenceId),...(raw.migrationEvidenceId?[raw.migrationEvidenceId]:[]),...(raw.contextEvidenceId?[raw.contextEvidenceId]:[])]))await authenticateBoundEvidence(s,actor,id,raw.sourceSystemId,eventSource,r.campus,eventAt,null,true);
   for(const successor of raw.successors){const entry=normalizeEntry(successor,'LOCAL');await authenticateBoundEvidence(s,actor,entry.evidenceId,entry.row.source_system_id,departmentSource,r.campus,entry.validFrom,entry.validTo);}
   const assessment=input.impactAssessment?await impacts.readAssessmentInTransaction(s,actor,{assessmentId:input.impactAssessment.id,campus:r.campus}):await impacts.assessInTransaction(s,actor,{requestId:input.requestId,reason:input.reason,target:{kind:'INPUT',id:r.id}});
   const current=await impacts.observe(s,actor,{kind:'INPUT',id:r.id});
   if(new Set(raw.impacts.map(x=>x.domain)).size!==EVOLUTION_IMPACT_DOMAINS.length||EVOLUTION_IMPACT_DOMAINS.some(domain=>!raw.impacts.some(x=>x.domain===domain)))throw new Error('CLOSED_INPUT_REQUIRED');
   // A complete negative review must still be recorded so it invalidates any
   // earlier approval. inspectInput prevents it from authorizing application.
   if(new Set(input.impactReviews.map(x=>x.domain)).size!==EVOLUTION_IMPACT_DOMAINS.length||EVOLUTION_IMPACT_DOMAINS.some(domain=>!input.impactReviews.some(x=>x.domain===domain)))throw new Error('LEGAL_REVIEW_REQUIRED');
   if(current.references.some(ref=>['SOURCE_MAPPING','IDENTIFIER','HIERARCHY','WARD','UNIT_WARD_RELATION'].includes(ref.owner)&&ref.constraint==='UNSATISFIED'&&raw.impacts.find(impact=>impact.domain===ref.owner)?.determination!=='AFFECTED'))throw new Error('IMPACT_DECLARATION_CONFLICT');
   if(current.dependencyDigest!==assessment.dependencyDigest||input.impactAssessment&&(input.impactAssessment.id!==assessment.assessmentId||input.impactAssessment.digest!==assessment.dependencyDigest))throw new Error('STALE_VALIDATION');
   const verified={...input,impactAssessment:{id:assessment.assessmentId,digest:assessment.dependencyDigest}};
   return mutate<{verificationId:string}>(s,actor,{operation:'VERIFY',...verified,...seal('EVOLUTION_VERIFICATION_V1',verified)});
  });},
  async plan(actor:string,input:{inputId:string;requestId:string}){check(Type.Object({inputId:Id,requestId:Id},{additionalProperties:false}),input);const r=await root(async s=>{const r=await record(s,actor,input.inputId,'WRITE');if(await authorize(s,actor,r.campus,'WRITE')!==r.identity_code)throw new Error('ACCESS_DENIED');return r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async query(actor:string,input:{id:string;campus:'NORTH'|'SOUTH';businessAt:string;recordAsOf?:string}){check(querySchema,input);return root(s=>queryIn(s,actor,input));},
  async graph(actor:string,input:{id:string;campus:'NORTH'|'SOUTH';businessAt:string;recordAsOf?:string}){check(querySchema,input);return root(async s=>{const event=await queryIn(s,actor,input);return {eventId:event.id,effectiveAt:event.effectiveAt,recordedAt:event.recordedAt,effective:event.effective,nodes:[...event.predecessors.map(reference=>({...reference,role:'PREDECESSOR' as const})),...event.successors.map(reference=>({...reference,role:'SUCCESSOR' as const}))],edges:event.edges};});},
  async history(actor:string,input:{id:string;campus:'NORTH'|'SOUTH';businessAt:string;recordAsOf?:string;after?:string;limit?:number}){
   check(Type.Object({...querySchema.properties,after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},{additionalProperties:false}),input);
   return root(async s=>{const ids=(await sql<{r:string[]}>`select department_master.evolution_history(${actor},${input.id}::uuid,${input.campus},${input.after??null}::uuid,${input.limit??50},${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp) r`.execute(s)).rows[0]!.r;const events=[];for(const id of ids)events.push(await queryIn(s,actor,{id,campus:input.campus,businessAt:input.businessAt,...(input.recordAsOf?{recordAsOf:input.recordAsOf}:{})}));return {departmentId:input.id,events,nextCursor:ids.length===(input.limit??50)?ids.at(-1)!:null};});
  },
  async list(actor:string,input:{campus:'NORTH'|'SOUTH';after?:string;limit?:number;recordAsOf?:string}){check(Type.Object({campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false}),input);return root(async s=>(await sql<{r:string[]}>`select department_master.evolution_list(${actor},${input.campus},${input.after??null}::uuid,${input.limit??50},${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp) r`.execute(s)).rows[0]!.r);},
  close:async()=>{await lifecycleOwner?.close();await db.destroy();},
 };
}
