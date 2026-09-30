import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Pool,types} from 'pg';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Type} from 'typebox';
import type {DB} from '../../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,type ApplyOwnerPort,type OwnerFact,type ImportJob,type ImportContractItem,type KeyProviderPort} from '../../governance-catalog/index.js';
import {fileIntake,boundedParse,protectedArtifacts,recordOwnerFileValidation,type ParserResult,type ValidationEvaluation} from '../../governance-catalog/index.js';
import {localTime,covered} from '../../organization-master/index.js';
import {Id} from './contracts.js';
import {OrganizationMappingStageSchema,OrganizationMappingStoredStageSchema,OrganizationMappingVerifySchema,OrganizationMappingResolveSchema,OrganizationMappingReceiveSchema,OrganizationMappingRowSchema,ORG22_FIELDS,mappingCheck,normalizeMappingEntry,validateORG22,type OrganizationMappingStageInput,type OrganizationMappingStoredStageInput,type OrganizationMappingVerifyInput,type OrganizationMappingResolveInput,type OrganizationMappingReceiveInput} from './organization-mapping-contracts.js';
import {createOrganizationMappingTargets,type OrganizationMappingTargetPort,type MappingTargetReference} from './organization-mapping-targets.js';

type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface Verification {id:string;actor:string;identity_code:string;digest:string;envelope:Envelope}
interface InputRecord {id:string;revision:string;job_id:string;job_revision:string;maker:string;identity_code:string;digest:string;campus:'NORTH'|'SOUTH';envelope:Envelope;verification:Verification|null}
interface MappingFacts {sourceName:string|null;sourceVersion:string;sourceRecordedAt:string;sourceSystemId:string;contractVersionId:string;verificationId:string;target:MappingTargetReference;sourcePins:unknown[];resolutionRule:string|null;commandDigest:string}
export interface OrganizationMappingVersion {id:string;mapping_id:string;number:string;predecessor:string|null;action:'REGISTER'|'CORRECT'|'RETRACT';target_type:string;target_id:string;valid_from:string;valid_to:string|null;recorded_at:string;source_row:number;reason:string;facts:MappingFacts;content_digest:string}
export interface OrganizationMappingHistory {id:string;from_system_id:string;entity_type:string;source_code:string;context:string;campus:'NORTH'|'SOUTH';versions:OrganizationMappingVersion[]}
export interface OrganizationMappingIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
const stamp=(s:string)=>localTime(s.replace(' ','T'));
const oneInput=Type.Object({inputId:Id},{additionalProperties:false});
const query=Type.Object({id:Id,businessAt:Type.String(),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false});
type Staged={inputId:string;revisionId:string;digest:string};

export function openOrganizationMappings(connection:string,provider?:KeyProviderPort,targetPort?:OrganizationMappingTargetPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:new Pool({connectionString:connection,max:4,options:'-c timezone=Asia/Shanghai',types:{getTypeParser:(oid,format)=>oid===1114?(v:string)=>v:types.getTypeParser(oid,format)}})})});
 const targets=targetPort??createOrganizationMappingTargets(connection,provider);
 const root=<T>(work:(scope:Scope)=>Promise<T>)=>db.transaction().execute(async transaction=>{await sql`select pg_advisory_xact_lock(901002)`.execute(transaction);return work(CatalogTransactionScope.from(transaction));});
 const recoverable=async<T>(s:Scope,work:()=>Promise<T>):Promise<T>=>{
  await sql`savepoint organization_mapping_dependency`.execute(s);
  try{const value=await work();await sql`release savepoint organization_mapping_dependency`.execute(s);return value;}
  catch(error){await sql`rollback to savepoint organization_mapping_dependency`.execute(s);await sql`release savepoint organization_mapping_dependency`.execute(s);throw error;}
 };
 const record=async(s:Scope,actor:string,id:string,permission='READ_RESTRICTED')=>(await sql<{r:InputRecord}>`select department_master.mapping_input_read(${actor},${id}::uuid,${permission}) r`.execute(s)).rows[0]!.r;
 const snapshot=async(s:Scope,actor:string,id:string)=>(await sql<{r:OrganizationMappingHistory}>`select department_master.mapping_snapshot(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const optionalSnapshot=async(s:Scope,actor:string,id:string)=>(await sql<{r:OrganizationMappingHistory|null}>`select department_master.mapping_snapshot_optional(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const job=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:id})}::jsonb) r`.execute(s)).rows[0]!.r;
 const inputJob=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select department_master.mapping_job_read(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const authorize=async(s:Scope,actor:string,row:{from_system_id:string;source_entity_type:string;source_context:string},campus:string,permission:string)=>(await sql<{r:string}>`select department_master.mapping_authorize(${actor},${row.from_system_id}::uuid,${row.source_entity_type},${row.source_context},${campus},${permission}) r`.execute(s)).rows[0]!.r;
 const seal=(domain:string,value:unknown)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(domain+'\0'+digest));const bytes=Buffer.from(canonicalPlan(value));
  try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}
 };
 const unseal=<T>(domain:string,r:{digest:string;envelope:Envelope},schema:unknown):T=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value:unknown=JSON.parse(bytes.toString());mappingCheck(schema,value);if(planBinding(provider,domain,value)!==r.digest)throw new Error();return value as T;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const mutate=async<T>(s:Scope,actor:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select department_master.mapping_mutate(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const evidence=async(s:Scope,actor:string,id:string,e:ReturnType<typeof normalizeMappingEntry>,c:ImportContractItem,campus:string,mode:'ADMISSION'|'CLOSURE'='ADMISSION')=>{
  const proof=mode==='CLOSURE'
   ?(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${c.definition.sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r
   :(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select department_master.evidence(${actor},${id}::uuid,${e.row.source_system_id}::uuid,${c.definition.sourceVersionId}::uuid,${campus},${e.validFrom}::timestamp,${e.validTo}::timestamp) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);try{return {id,digest:planBinding(provider,'ORG_MAPPING_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const currentReferenceAccess=async(s:Scope,actor:string,ref:{fromSystemId:string;sourceSystemId:string;targetType:string;targetId:string;validFrom:string;validTo:string|null},campus:string)=>{
  for(const source of new Set([ref.fromSystemId,ref.sourceSystemId]))await sql`select department_master.mapping_source(${actor},${source}::uuid,${ref.validFrom}::timestamp,${ref.validTo}::timestamp,false)`.execute(s);
  if(['LEGAL','CAMPUS','ORG'].includes(ref.targetType)){
   await sql`select department_master.mapping_target_authorize(${actor},${ref.targetType},${ref.targetId}::uuid,${campus})`.execute(s);
   await targets.authorize(s,actor,{type:ref.targetType,id:ref.targetId,validFrom:ref.validFrom,validTo:ref.validTo});
  }
 };
 const referenceAccess=(s:Scope,actor:string,e:ReturnType<typeof normalizeMappingEntry>,campus:string)=>currentReferenceAccess(s,actor,{fromSystemId:e.row.from_system_id,sourceSystemId:e.row.source_system_id,targetType:e.row.target_type,targetId:e.row.target_id,validFrom:e.validFrom,validTo:e.validTo},campus);
 const inputReferenceAccess=async(s:Scope,actor:string,entry:OrganizationMappingStoredStageInput['entries'][number],campus:string)=>{
  // An input may be staged for validation even when its dates are malformed. Current reference authorization does not re-qualify business coverage.
  let validFrom='2000-01-01T00:00:00',validTo:string|null=null;
  try{const normalized=normalizeMappingEntry(entry);validFrom=normalized.validFrom;validTo=normalized.validTo;}catch{}
  await currentReferenceAccess(s,actor,{fromSystemId:entry.row.from_system_id,sourceSystemId:entry.row.source_system_id,targetType:entry.row.target_type,targetId:entry.row.target_id,validFrom,validTo},campus);
 };
 const historyReferenceAccess=(s:Scope,actor:string,h:OrganizationMappingHistory,v:OrganizationMappingVersion)=>currentReferenceAccess(s,actor,{fromSystemId:h.from_system_id,sourceSystemId:v.facts.sourceSystemId,targetType:v.target_type,targetId:v.target_id,validFrom:stamp(v.valid_from),validTo:v.valid_to===null?null:stamp(v.valid_to)},h.campus);
 const inspectInput=async(s:Scope,actor:string,id:string)=>{
  const r=await record(s,actor,id),input=unseal<OrganizationMappingStoredStageInput>('ORG_MAPPING_INPUT_V1',r,OrganizationMappingStoredStageSchema),j=await inputJob(s,actor,id),c=j.contract;
  if(j.currentRevisionId!==r.job_revision||j.status==='REJECTED')throw new Error('STALE_REVISION');
  const verification=r.verification?unseal<OrganizationMappingVerifyInput>('ORG_MAPPING_VERIFICATION_V1',r.verification,OrganizationMappingVerifySchema):null;
  const issues:OrganizationMappingIssue[]=[],heads:OrganizationMappingHistory[]=[],materials:unknown[]=[],diff:unknown[]=[],commands:Array<{row:number;entry:ReturnType<typeof normalizeMappingEntry>;facts:MappingFacts}>=[];
  const issue=(row:number,field:string,code:string,status:OrganizationMappingIssue['status']='BLOCKED')=>issues.push({row,field,code,status});
  if(input.profile!=='CORE'||j.profile!=='CORE'||c.dataset!=='ORG22'||c.status!=='PUBLISHED'||c.definition.templateVersion!=='ORG22_CORE_V1'||c.definition.fields.length!==19||ORG22_FIELDS.some(f=>!c.definition.fields.some(x=>x.code===f)))issue(0,'profile','BLOCKED_DEPENDENCY');
  if(verification){await record(s,r.verification!.actor,id,'VERIFY');if(verification.inputDigest!==r.digest)throw new Error('STALE_VALIDATION');}
  for(const entry of input.entries)await inputReferenceAccess(s,actor,entry,r.campus);
  const aliases=new Set<string>(),identities=new Set<string>(),mappingIds=new Set<string>();let admission=false;
  const normalized=input.entries.flatMap(raw=>{try{return [normalizeMappingEntry(raw)];}catch{return [];}});
  for(const [index,raw] of input.entries.entries()){
   const row=index+1;let e:ReturnType<typeof normalizeMappingEntry>;
   try{e=normalizeMappingEntry(raw);}catch(error){issue(row,'',error instanceof Error?error.message:'CLOSED_INPUT_REQUIRED','FAIL');continue;}
   diff.push({row,action:e.action,mapping:e.mapping,targetType:e.row.target_type,targetId:e.row.target_id,validFrom:e.validFrom,validTo:e.validTo});
   await authorize(s,actor,e.row,r.campus,'READ_RESTRICTED');
   try{await recoverable(s,()=>referenceAccess(s,actor,e,r.campus));}catch(error){if(error instanceof Error&&['KEY_UNAVAILABLE','ACCESS_DENIED'].includes(error.message))throw error;issue(row,'target_id','BLOCKED_DEPENDENCY');}
   if(r.verification&&await authorize(s,r.verification.actor,e.row,r.campus,'VERIFY')!==r.verification.identity_code)throw new Error('ACCESS_DENIED');
   const identity=canonicalPlan([e.row.from_system_id,e.row.source_entity_type,e.row.source_code,e.row.source_context]);
   if(aliases.has(e.row.org_map_id)||identities.has(identity)||e.mapping&&mappingIds.has(e.mapping.id))issue(row,'org_map_id','BATCH_CONFLICT','FAIL');
   aliases.add(e.row.org_map_id);identities.add(identity);if(e.mapping)mappingIds.add(e.mapping.id);
   let prior:OrganizationMappingVersion|undefined;
   const h=(await sql<{r:OrganizationMappingHistory|null}>`select department_master.mapping_find(${actor},${e.row.from_system_id}::uuid,${e.row.source_entity_type},${e.row.source_code},${e.row.source_context},${r.campus}) r`.execute(s)).rows[0]!.r;
   if(e.action==='REGISTER'&&h)issue(row,'org_map_id','MAPPING_ALREADY_REGISTERED','FAIL');
   if(e.mapping){
    const actual=await optionalSnapshot(s,actor,e.mapping.id);
    if(!actual)issue(row,'mapping','BLOCKED_DEPENDENCY');
    else{
     prior=actual.versions.at(-1);
     if(prior)await historyReferenceAccess(s,actor,actual,prior);
     // Immutable older versions cannot change this approval; bind the head without growing the candidate with history.
     heads.push({...actual,versions:prior?[prior]:[]});
     if(actual.id!==h?.id||actual.campus!==r.campus)issue(row,'mapping','MAPPING_IDENTITY_IMMUTABLE','FAIL');
     if(prior?.number!==e.mapping.expectedHead)issue(row,'mapping','STALE_VALIDATION');
     if(prior?.action==='RETRACT')issue(row,'mapping','MAPPING_RETRACTED','FAIL');
    }
   }
   const unchangedTarget=prior?.target_type===e.row.target_type&&prior.target_id===e.row.target_id;
   const unchangedFacts=prior&&(e.row.source_name||null)===prior.facts.sourceName&&(e.row.resolution_rule||null)===prior.facts.resolutionRule&&e.row.source_system_id===prior.facts.sourceSystemId;
   const shrink=e.action==='CORRECT'&&prior&&unchangedTarget&&unchangedFacts&&e.validFrom>=stamp(prior.valid_from)&&(prior.valid_to===null||e.validTo!==null&&e.validTo<=stamp(prior.valid_to));
   const closing=e.action==='RETRACT'||Boolean(shrink);
   if(e.action==='RETRACT'&&(!prior||!unchangedTarget||e.validFrom!==stamp(prior.valid_from)||e.validTo!==(prior.valid_to===null?null:stamp(prior.valid_to))))issue(row,'action','CLOSED_INPUT_REQUIRED','FAIL');
   if(!closing)admission=true;
   for(const field of ['target_type','mapping_relation','record_status'] as const){const values=c.definition.fields.find(f=>f.code===field)?.enumValues;if(values?.length&&!values.includes(e.row[field]))issue(row,field,'ENUM_INVALID','FAIL');}
   if(!['LEGAL','CAMPUS','ORG'].includes(e.row.target_type))issue(row,'target_type','BLOCKED_DEPENDENCY');
   if(e.row.mapping_relation!=='EXACT')issue(row,'mapping_relation','BLOCKED_DEPENDENCY');
   if(e.row.record_status!=='ACTIVE'||!e.row.approval_ref)issue(row,'approval_ref','APPROVAL_REQUIRED');
   const review=verification?.rows.find(x=>x.row===row);
   if(!review||!review.contextApproved)issue(row,'source_context','LEGAL_REVIEW_REQUIRED');
   const sameCode=(other:ReturnType<typeof normalizeMappingEntry>)=>other.row.from_system_id===e.row.from_system_id&&other.row.source_entity_type===e.row.source_entity_type&&other.row.source_code===e.row.source_code;
   const concurrentTarget=normalized.some(other=>sameCode(other)&&other.row.source_context!==e.row.source_context&&(other.row.target_type!==e.row.target_type||other.row.target_id!==e.row.target_id)&&(other.validTo===null||e.validFrom<other.validTo)&&(e.validTo===null||other.validFrom<e.validTo));
   const persistedTarget=(await sql<{r:boolean}>`select department_master.mapping_resolution_required(${actor},${e.row.from_system_id}::uuid,${e.row.source_entity_type},${e.row.source_code},${e.row.source_context},${r.campus},${e.row.target_type},${e.row.target_id}::uuid,${e.validFrom}::timestamp,${e.validTo}::timestamp) r`.execute(s)).rows[0]!.r;
   if(!closing&&(concurrentTarget||persistedTarget)&&!e.row.resolution_rule)issue(row,'resolution_rule','LEGAL_REVIEW_REQUIRED');
   if(review?.sourceKeyReuse&&(e.action!=='REGISTER'||e.row.source_context==='DEFAULT'||!e.row.resolution_rule))issue(row,'resolution_rule','LEGAL_REVIEW_REQUIRED');
   const sourcePins:unknown[]=closing?structuredClone(prior?.facts.sourcePins??[]):[];let target=prior?.facts.target;
   if(closing){
    const materialCount=materials.length;
    try{await recoverable(s,async()=>{
     materials.push(await evidence(s,actor,e.evidenceId,e,c,r.campus,'CLOSURE'));
     if(review){materials.push(await evidence(s,actor,review.evidenceId,e,c,r.campus,'CLOSURE'));await evidence(s,r.verification!.actor,review.evidenceId,e,c,r.campus,'CLOSURE');}
    });}catch(error){materials.length=materialCount;if(error instanceof Error&&['KEY_UNAVAILABLE','ACCESS_DENIED'].includes(error.message))throw error;issue(row,'evidenceId','BLOCKED_DEPENDENCY');}
   }
   if(!closing&&['LEGAL','CAMPUS','ORG'].includes(e.row.target_type)){
    if(!covered([{from:c.validFrom,to:c.validTo}],e.validFrom,e.validTo))issue(row,'valid_from','BLOCKED_DEPENDENCY');
    for(const field of ['target_type','mapping_relation','record_status'] as const){const codes=c.definition.codeSets.find(v=>v.field===field);if(!codes||codes.status!=='SYNTHETIC_ADOPTED'||!codes.codes.includes(e.row[field])||!covered([{from:codes.validFrom,to:codes.validTo}],e.validFrom,e.validTo))issue(row,field,'BLOCKED_DEPENDENCY');}
    const materialCount=materials.length;
    try{await recoverable(s,async()=>{
     for(const source of new Set([e.row.from_system_id,e.row.source_system_id])){const pin=(await sql<{r:{sourceId:string;versionId:string|null}}>`select department_master.mapping_source(${actor},${source}::uuid,${e.validFrom}::timestamp,${e.validTo}::timestamp,true) r`.execute(s)).rows[0]!.r;if(!pin.versionId)issue(row,'from_system_id','BLOCKED_DEPENDENCY');else sourcePins.push(pin);}
     materials.push(await evidence(s,actor,e.evidenceId,e,c,r.campus));
     if(review){materials.push(await evidence(s,actor,review.evidenceId,e,c,r.campus));await evidence(s,r.verification!.actor,review.evidenceId,e,c,r.campus);}
     await sql`select department_master.mapping_target_authorize(${actor},${e.row.target_type},${e.row.target_id}::uuid,${r.campus})`.execute(s);
     target=await targets.read(s,actor,{type:e.row.target_type,id:e.row.target_id,validFrom:e.validFrom,validTo:e.validTo});
    });}catch(error){materials.length=materialCount;sourcePins.length=0;target=undefined;if(error instanceof Error&&['KEY_UNAVAILABLE','ACCESS_DENIED'].includes(error.message))throw error;issue(row,error instanceof Error&&error.message==='PAYLOAD_UNAVAILABLE'?'evidenceId':'target_id','BLOCKED_DEPENDENCY');}
   }
   if(!target)continue;
   const {sourceRow:_,...businessEntry}=e;
   const commandDigest=planBinding(provider,'ORG_MAPPING_COMMAND_V1',{entry:businessEntry,contractVersionId:c.versionId,verification:review??null,target,sourcePins,materials:materials.slice()});
   const facts:MappingFacts={sourceName:e.row.source_name||null,sourceVersion:e.row.version_no,sourceRecordedAt:e.sourceRecordedAt,sourceSystemId:e.row.source_system_id,contractVersionId:c.versionId,verificationId:r.verification?.id??'',target,sourcePins,resolutionRule:e.row.resolution_rule||null,commandDigest};
   commands.push({row,entry:e,facts});
  }
  if(admission){const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;const active=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:c.id,businessAt:now})}::jsonb) r`.execute(s)).rows[0]!.r;if(active[0]?.versionId!==c.versionId)issue(0,'contract','STALE_VALIDATION');}
  return {r,input,contract:c,verification,issues,heads,materials,commands,diff};
 };
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,action){const r=await record(s,actor,input.jobId,action);if(r.revision!==input.revisionId||r.campus!==input.campus||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');await record(s,actor,input.jobId,'READ_RESTRICTED');const raw=unseal<OrganizationMappingStoredStageInput>('ORG_MAPPING_INPUT_V1',r,OrganizationMappingStoredStageSchema);for(const e of raw.entries)await referenceAccess(s,actor,normalizeMappingEntry(e),r.campus);},
  async authorizeFrozen(s,actor,unit){const heads=unit.basis['heads'];if(!Array.isArray(heads))throw new Error('INVALID_PLAN_TOKEN');for(const h of heads as OrganizationMappingHistory[])for(const v of h.versions)await historyReferenceAccess(s,actor,h,v);},
  async observe(s,actor,input){const v=await inspectInput(s,actor,input.jobId);return {input,atomicRule:'ORG22_WHOLE_REVISION_V1',basis:{inputDigest:v.r.digest,entries:v.input.entries,contract:v.contract,verificationId:v.r.verification?.id??null,verificationDigest:v.r.verification?.digest??null,verification:v.verification,issues:v.issues,heads:v.heads,materials:v.materials},commands:v.commands.map(({row,entry,facts})=>({owner:'department-master/organization-mapping',row,intent:entry.action==='REGISTER'?'CREATE':'REVISE',target:entry.mapping?{owner:entry.mapping.owner,id:entry.mapping.id,version:entry.mapping.expectedHead}:null,aliases:[],value:{inputId:v.r.id,sourceRow:String(entry.sourceRow??row),command:canonicalPlan(entry),facts:canonicalPlan(facts)}})),diff:v.diff};},
  async validate(_s,_actor,unit,stage){const issues=unit.basis['issues'] as OrganizationMappingIssue[];const retained=issues.length>0&&issues.every(i=>i.code==='BLOCKED_DEPENDENCY'&&['profile','target_type','mapping_relation'].includes(i.field));if(stage==='FREEZE'&&retained)return;if(issues.length||unit.commands.length===0)throw new Error(issues[0]?.code??'BATCH_REJECTED');},
  async apply(s,actor,command,_resolved,approval){const facts=JSON.parse(command.value['facts']!);return {ok:true,fact:await mutate<OwnerFact>(s,actor,{operation:'APPLY',inputId:command.value['inputId'],sourceRow:Number(command.value['sourceRow']),command:JSON.parse(command.value['command']!),facts,contentDigest:planBinding(provider,'ORG_MAPPING_FACTS_V1',facts),...approval})};},
  async exactRead(s,actor,_input,fact){if(fact.owner!=='department-master/organization-mapping')return null;const h=await snapshot(s,actor,fact.id);return h.versions.some(v=>v.number===fact.version)?fact:null;},
 };
 const coordinator=applyCoordinator(db,provider,port);
 const files=fileIntake(db,provider);
 const saveValidation=async(s:Scope,actor:string,j:ImportJob,campus:'NORTH'|'SOUTH',sourceArtifactId:string,parsed:ParserResult,issues:OrganizationMappingIssue[])=>{
  const decision=issues.some(i=>i.status==='FAIL')?'FAIL' as const:issues.length?'BLOCKED' as const:'PASS' as const;
  const evaluation:ValidationEvaluation={decision,issues:issues.map(i=>({rule:'ORG22_'+i.code,layer:2,row:parsed.cells.find(c=>c.row===i.row)?.sourceRow??i.row,field:i.field,status:i.status==='FAIL'?'FAIL':'UNKNOWN',code:i.code})),layers:[{layer:1,status:parsed.structuralStatus==='PARSED'?'PASS':'FAIL'},{layer:2,status:decision==='PASS'?'PASS':decision==='FAIL'?'FAIL':'UNKNOWN'}],evidenceRequirements:[],dependencies:[],interpretationPolicy:'EXACT_TEXT_V1'};
  return recordOwnerFileValidation(s,provider,actor,{jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId,campus,requestId:randomUUID(),parseRequestId:randomUUID(),outputRequestId:randomUUID(),contractVersionId:j.contract.versionId,ruleVersion:j.contract.definition.ruleVersion,parserPolicy:'STRICT_ORGANIZATION_MAPPING_V1',structuralStatus:parsed.structuralStatus,parsed:{sourceArtifactId,result:parsed},evaluation});
 };
 const stageIn=async(s:Scope,actor:string,input:OrganizationMappingStoredStageInput)=>{const namespaces=input.entries.map(e=>({source:e.row.from_system_id,entity:e.row.source_entity_type,context:e.row.source_context}));return mutate<Staged>(s,actor,{operation:'STAGE',...input,namespaces,...seal('ORG_MAPPING_INPUT_V1',input)});};
 const historyInTransaction=async(s:Scope,actor:string,id:string,at:string|null)=>{const h=await snapshot(s,actor,id),versions=h.versions.filter(v=>at===null||stamp(v.recorded_at)<=at);if(!versions.length)throw new Error('NOT_FOUND');return {...h,versions};};
 const history=async(actor:string,id:string,recordAsOf?:string)=>{mappingCheck(Id,id);const at=recordAsOf?localTime(recordAsOf):null;return root(async s=>{const h=await historyInTransaction(s,actor,id,at);for(const v of h.versions)await historyReferenceAccess(s,actor,h,v);return h;});};
 return {
  async stage(actor:string,raw:OrganizationMappingStageInput){mappingCheck(OrganizationMappingStageSchema,raw);const input:OrganizationMappingStoredStageInput={...structuredClone(raw),entries:raw.entries.map((e,i)=>({...e,sourceRow:i+1}))};return root(async s=>{const j=await job(s,actor,input.jobId);if(j.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');if(j.revisions.at(-1)?.input.kind!=='METADATA_ONLY')throw new Error('FILE_REVISION_REQUIRED');return stageIn(s,actor,input);});},
  async receiveFile(actor:string,raw:OrganizationMappingReceiveInput,bytes:Uint8Array){
   mappingCheck(OrganizationMappingReceiveSchema,raw);const input=structuredClone(raw);
   if(input.job.input.kind!=='FILE'||input.job.input.format!=='XLSX'||input.job.input.parserPolicy!=='STRICT_ORGANIZATION_MAPPING_V1')throw new Error('CLOSED_INPUT_REQUIRED');
   const received=await files.receiveFile(actor,{job:input.job,fileRequestId:input.fileRequestId,extension:'.xlsx',campus:input.campus,purpose:'IDENTITY_VERIFY',retentionSeconds:input.retentionSeconds},bytes);
   return root(async s=>{
    const j=await job(s,actor,received.job.id),store=protectedArtifacts(s,provider),content=await store.authorizeSensitiveRead(actor,{scope:'SYNTHETIC',campus:input.campus,purpose:'IDENTITY_VERIFY',requestId:input.requestId,artifactId:received.artifact.artifactId},{jobId:j.id,revisionId:j.currentRevisionId,kind:'RAW_FILE'});
    try{
     const parsed=await boundedParse(content,'XLSX',j.contract.definition.fields,'STRICT_ORGANIZATION_MAPPING_V1');
     const failures:OrganizationMappingIssue[]=parsed.issues.map(i=>({row:parsed.cells.find(c=>c.sourceRow===i.row)?.row??i.row,field:'',code:i.code,status:'FAIL'}));
     const entries:OrganizationMappingStoredStageInput['entries']=[];
     if(parsed.rows.length!==input.entries.length)failures.push({row:0,field:'',code:'MANIFEST_ROW_MISMATCH',status:'FAIL'});
     for(const [index,row] of parsed.rows.entries()){
      const logical=index+1;
      for(const field of ORG22_FIELDS)try{mappingCheck(OrganizationMappingRowSchema.properties[field],row[field]);}catch{failures.push({row:logical,field,code:'FIELD_INVALID',status:'FAIL'});}
      try{const source=validateORG22(row),meta=input.entries[index];if(meta)entries.push({...meta,row:source,sourceRow:parsed.cells.find(c=>c.row===logical)?.sourceRow??logical});}catch{if(!failures.some(f=>f.row===logical))failures.push({row:logical,field:'',code:'FIELD_INVALID',status:'FAIL'});}
     }
     let staged:Staged|null=null;
     if(parsed.structuralStatus==='PARSED'&&failures.length===0){
      staged=await stageIn(s,actor,{requestId:input.requestId,jobId:j.id,revisionId:j.currentRevisionId,campus:input.campus,profile:j.profile,entries,sourceArtifactId:received.artifact.artifactId});
      const inspected=await inspectInput(s,actor,staged.inputId);await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,inspected.issues);
     }else await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,failures);
     return {jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,issues:failures.map(f=>({code:f.code,row:parsed.cells.find(c=>c.row===f.row)?.sourceRow??f.row,column:parsed.cells.find(c=>c.row===f.row&&c.field===f.field)?.column??0})),input:staged};
    }finally{content.fill(0);}
   });
  },
  async readInput(actor:string,input:{inputId:string}){mappingCheck(oneInput,input);return root(async s=>{const r=await record(s,actor,input.inputId),raw=unseal<OrganizationMappingStoredStageInput>('ORG_MAPPING_INPUT_V1',r,OrganizationMappingStoredStageSchema);for(const entry of raw.entries)await inputReferenceAccess(s,actor,entry,r.campus);return raw;});},
  async preview(actor:string,input:{inputId:string}){mappingCheck(oneInput,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);return {entries:v.input.entries,verification:v.verification,heads:v.heads,issues:v.issues};});},
  async validate(actor:string,input:{inputId:string}){mappingCheck(oneInput,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);let validationRunId:string|null=null;if(v.input.sourceArtifactId){const j=await inputJob(s,actor,input.inputId),content=await protectedArtifacts(s,provider).authorizeSensitiveRead(actor,{scope:'SYNTHETIC',campus:v.r.campus,purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:v.input.sourceArtifactId},{jobId:j.id,revisionId:j.currentRevisionId,kind:'RAW_FILE'});try{const parsed=await boundedParse(content,'XLSX',j.contract.definition.fields,'STRICT_ORGANIZATION_MAPPING_V1');validationRunId=(await saveValidation(s,actor,j,v.r.campus,v.input.sourceArtifactId,parsed,v.issues)).run.runId;}finally{content.fill(0);}}return {inputId:v.r.id,digest:v.r.digest,validationRunId,decision:v.issues.some(i=>i.status==='FAIL')?'FAIL' as const:v.issues.length?'BLOCKED' as const:'PASS' as const,issues:v.issues,commandCount:v.commands.length};});},
  async verify(actor:string,input:OrganizationMappingVerifyInput){mappingCheck(OrganizationMappingVerifySchema,input);return root(async s=>{const r=await record(s,actor,input.inputId,'VERIFY'),raw=unseal<OrganizationMappingStoredStageInput>('ORG_MAPPING_INPUT_V1',r,OrganizationMappingStoredStageSchema);if(input.rows.length!==raw.entries.length||new Set(input.rows.map(x=>x.row)).size!==raw.entries.length||input.rows.some(x=>x.row>raw.entries.length))throw new Error('CLOSED_INPUT_REQUIRED');return mutate<{verificationId:string}>(s,actor,{operation:'VERIFY',...input,...seal('ORG_MAPPING_VERIFICATION_V1',input)});});},
  async plan(actor:string,input:{inputId:string;requestId:string}){mappingCheck(Type.Object({inputId:Id,requestId:Id},{additionalProperties:false}),input);const r=await root(s=>record(s,actor,input.inputId,'WRITE'));return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  history,
  async read(actor:string,input:{id:string;businessAt:string;recordAsOf?:string}){mappingCheck(query,input);const at=localTime(input.businessAt),r=input.recordAsOf?localTime(input.recordAsOf):null;return root(async s=>{const h=await historyInTransaction(s,actor,input.id,r),v=h.versions.at(-1)!,visible=v.action!=='RETRACT'&&stamp(v.valid_from)<=at&&(v.valid_to===null||at<stamp(v.valid_to));if(visible)await historyReferenceAccess(s,actor,h,v);return {id:h.id,version:visible?v:null};});},
  async resolve(actor:string,input:OrganizationMappingResolveInput){
   mappingCheck(OrganizationMappingResolveSchema,input);if([input.sourceEntityType,input.sourceCode,input.sourceContext].some(v=>v!==v.trim()))throw new Error('CLOSED_INPUT_REQUIRED');
   const at=localTime(input.businessAt),r=input.recordAsOf?localTime(input.recordAsOf):null;
   return root(async s=>{
    const h=(await sql<{r:OrganizationMappingHistory|null}>`select department_master.mapping_find(${actor},${input.fromSystemId}::uuid,${input.sourceEntityType},${input.sourceCode},${input.sourceContext},${input.campus}) r`.execute(s)).rows[0]!.r;
    const v=h?.versions.filter(v=>r===null||stamp(v.recorded_at)<=r).at(-1);if(!h||!v||v.action==='RETRACT'||at<stamp(v.valid_from)||v.valid_to!==null&&at>=stamp(v.valid_to))return {status:'NOT_FOUND' as const};
    await sql`select department_master.mapping_target_authorize(${actor},${v.target_type},${v.target_id}::uuid,${input.campus})`.execute(s);
    for(const source of new Set([h.from_system_id,v.facts.sourceSystemId]))await sql`select department_master.mapping_source(${actor},${source}::uuid,${stamp(v.valid_from)}::timestamp,${v.valid_to===null?null:stamp(v.valid_to)}::timestamp,false)`.execute(s);
    // Current Owner permission is required even when replaying an accepted historical assertion.
    await targets.read(s,actor,{type:v.target_type,id:v.target_id,validFrom:stamp(v.valid_from),validTo:v.valid_to===null?null:stamp(v.valid_to),recordAsOf:stamp(v.recorded_at)});
    return {status:'RESOLVED' as const,mappingId:h.id,version:v.number,versionId:v.id,target:v.facts.target,assertion:'HISTORICAL_ASSERTION' as const,currentReview:'NOT_EVALUATED' as const};
   });
  },
  async diff(actor:string,input:{id:string;fromVersion:string;toVersion:string}){mappingCheck(Type.Object({id:Id,fromVersion:Type.String({pattern:'^[1-9][0-9]*$'}),toVersion:Type.String({pattern:'^[1-9][0-9]*$'})},{additionalProperties:false}),input);return root(async s=>{const h=await historyInTransaction(s,actor,input.id,null),a=h.versions.find(v=>v.number===input.fromVersion),b=h.versions.find(v=>v.number===input.toVersion);if(!a||!b)throw new Error('NOT_FOUND');await historyReferenceAccess(s,actor,h,a);if(a!==b)await historyReferenceAccess(s,actor,h,b);return {before:a,after:b};});},
  async list(actor:string,input:{campus:'NORTH'|'SOUTH';after?:string;limit?:number;recordAsOf?:string}){mappingCheck(Type.Object({campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false}),input);return root(async scope=>(await sql<{r:string[]}>`select department_master.mapping_list(${actor},${input.campus},${input.after??null}::uuid,${input.limit??50},${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp) r`.execute(scope)).rows[0]!.r);},
  async close(){await db.destroy();if(!targetPort)await targets.close();},
 };
}
