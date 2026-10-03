import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {vnextPool} from '../../../platform/database/vnext-pool.js';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Type} from 'typebox';
import type {DB} from '../../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,type ApplyOwnerPort,type OwnerFact,type ImportJob,type ImportContractItem,type KeyProviderPort} from '../../governance-catalog/index.js';
import {fileIntake,boundedParse,protectedArtifacts,recordOwnerFileValidation,type ParserResult,type ValidationEvaluation} from '../../governance-catalog/index.js';
import {localTime,covered} from '../../organization-master/index.js';
import {Id} from './contracts.js';
import {OrganizationIdentifierStageSchema,OrganizationIdentifierStoredStageSchema,OrganizationIdentifierVerifySchema,OrganizationIdentifierResolveSchema,OrganizationIdentifierReceiveSchema,ORG23_FIELDS,ORGANIZATION_IDENTIFIER_SCHEMES,identifierCheck,normalizeIdentifierEntry,validateORG23,type OrganizationIdentifierStageInput,type OrganizationIdentifierStoredStageInput,type OrganizationIdentifierVerifyInput,type OrganizationIdentifierResolveInput,type OrganizationIdentifierReceiveInput,type ORG23Row} from './organization-identifier-contracts.js';
import {createOrganizationMappingTargets,type OrganizationMappingTargetPort,type MappingTargetReference} from './organization-mapping-targets.js';

type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface Verification {id:string;actor:string;identity_code:string;digest:string;envelope:Envelope}
interface InputRecord {id:string;revision:string;job_id:string;job_revision:string;maker:string;identity_code:string;digest:string;campus:'NORTH'|'SOUTH';schemes:string[];envelope:Envelope;verification:Verification|null}
export interface IdentifierFacts {sourceVersion?:string;sourceRecordedAt?:string;sourceSystemId:string;contractVersionId?:string;verificationId?:string;target:MappingTargetReference;issuer:string;commandDigest?:string;origin?:string;originalRecordedAt?:string;sourcePins?:unknown[]}
export interface OrganizationIdentifierVersion {id:string;identifier_id:string;number:string;predecessor:string|null;action:'REGISTER'|'CORRECT'|'END'|'RETRACT';value:string;language:string;preferred:boolean;valid_from:string;valid_to:string|null;recorded_at:string;source_row:number;step:string;reason:string;facts:IdentifierFacts;content_digest:string}
export interface OrganizationIdentifierHistory {id:string;target_type:string;target_id:string;kind:string;scheme:string;reserved_value:string|null;versions:OrganizationIdentifierVersion[]}
export interface OrganizationIdentifierIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED';handoff?:{dataset:'ORG22';owner:'department-master/organization-mapping';requiredFields:string[]}}
const stamp=(s:string)=>localTime(s.replace(' ','T'));
const oneInput=Type.Object({inputId:Id},{additionalProperties:false});
const query=Type.Object({id:Id,businessAt:Type.String(),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false});
type Staged={inputId:string;revisionId:string;digest:string};

export function openOrganizationIdentifiers(connection:string,provider?:KeyProviderPort,targetPort?:OrganizationMappingTargetPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const targets=targetPort??createOrganizationMappingTargets(connection,provider);
 const root=<T>(work:(scope:Scope)=>Promise<T>)=>db.transaction().execute(async transaction=>{await sql`select pg_advisory_xact_lock(901002)`.execute(transaction);return work(CatalogTransactionScope.from(transaction));});
 const recoverable=async<T>(s:Scope,work:()=>Promise<T>):Promise<T>=>{
  await sql`savepoint organization_identifier_dependency`.execute(s);
  try{const value=await work();await sql`release savepoint organization_identifier_dependency`.execute(s);return value;}
  catch(error){await sql`rollback to savepoint organization_identifier_dependency`.execute(s);await sql`release savepoint organization_identifier_dependency`.execute(s);throw error;}
 };
 const record=async(s:Scope,actor:string,id:string,permission='READ_RESTRICTED')=>(await sql<{r:InputRecord}>`select department_master.identifier_input_read(${actor},${id}::uuid,${permission}) r`.execute(s)).rows[0]!.r;
 const snapshot=async(s:Scope,actor:string,id:string,campus:string)=>(await sql<{r:OrganizationIdentifierHistory|null}>`select department_master.identifier_snapshot(${actor},${id}::uuid,${campus}) r`.execute(s)).rows[0]!.r;
 const job=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:id})}::jsonb) r`.execute(s)).rows[0]!.r;
 const inputJob=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select department_master.identifier_job_read(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const authorize=async(s:Scope,actor:string,scheme:string,campus:string,permission:string)=>(await sql<{r:string}>`select department_master.identifier_authorize(${actor},${scheme},${campus},${permission}) r`.execute(s)).rows[0]!.r;
 const inputIdentity=(s:Scope,actor:string,r:InputRecord,permission:string)=>authorize(s,actor,r.schemes[0]!,r.campus,permission);
 const seal=(domain:string,value:unknown)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(domain+'\0'+digest));const bytes=Buffer.from(canonicalPlan(value));
  try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}
 };
 const unseal=<T>(domain:string,r:{digest:string;envelope:Envelope},schema:unknown):T=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value:unknown=JSON.parse(bytes.toString());identifierCheck(schema,value);if(planBinding(provider,domain,value)!==r.digest)throw new Error();return value as T;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const mutate=async<T>(s:Scope,actor:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select department_master.identifier_mutate(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const evidence=async(s:Scope,actor:string,id:string,e:ReturnType<typeof normalizeIdentifierEntry>,c:ImportContractItem,campus:string,mode:'ADMISSION'|'CLOSURE'='ADMISSION')=>{
  const proof=mode==='CLOSURE'
   ?(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${c.definition.sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r
   :(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select department_master.evidence(${actor},${id}::uuid,${e.row.source_system_id}::uuid,${c.definition.sourceVersionId}::uuid,${campus},${e.validFrom}::timestamp,${e.validTo}::timestamp) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);try{return {id,digest:planBinding(provider,'ORG_IDENTIFIER_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const referenceAccess=async(s:Scope,actor:string,e:{row:ORG23Row;validFrom:string;validTo:string|null},campus:string)=>{
  await sql`select department_master.mapping_source(${actor},${e.row.source_system_id}::uuid,${e.validFrom}::timestamp,${e.validTo}::timestamp,false)`.execute(s);
  if(['LEGAL','CAMPUS','ORG'].includes(e.row.target_type)){await sql`select department_master.mapping_target_authorize(${actor},${e.row.target_type},${e.row.target_id}::uuid,${campus})`.execute(s);await targets.authorize(s,actor,{type:e.row.target_type,id:e.row.target_id,validFrom:e.validFrom,validTo:e.validTo});}
 };
 const inputReferenceAccess=async(s:Scope,actor:string,entry:OrganizationIdentifierStoredStageInput['entries'][number],campus:string)=>{let validFrom='2000-01-01T00:00:00',validTo:string|null=null;try{const e=normalizeIdentifierEntry(entry);validFrom=e.validFrom;validTo=e.validTo;}catch{}await referenceAccess(s,actor,{row:entry.row,validFrom,validTo},campus);};
 const historyReferenceAccess=async(s:Scope,actor:string,h:OrganizationIdentifierHistory,v:OrganizationIdentifierVersion,campus:string)=>{
  await sql`select department_master.mapping_source(${actor},${v.facts.sourceSystemId}::uuid,${stamp(v.valid_from)}::timestamp,${v.valid_to===null?null:stamp(v.valid_to)}::timestamp,false)`.execute(s);
  await sql`select department_master.mapping_target_authorize(${actor},${h.target_type},${h.target_id}::uuid,${campus})`.execute(s);
  await targets.authorize(s,actor,{type:h.target_type,id:h.target_id,validFrom:stamp(v.valid_from),validTo:v.valid_to===null?null:stamp(v.valid_to)});
 };
 const inspectInput=async(s:Scope,actor:string,id:string)=>{
  const r=await record(s,actor,id),input=unseal<OrganizationIdentifierStoredStageInput>('ORG_IDENTIFIER_INPUT_V1',r,OrganizationIdentifierStoredStageSchema),j=await inputJob(s,actor,id),c=j.contract;
  if(j.currentRevisionId!==r.job_revision||j.status==='REJECTED')throw new Error('STALE_REVISION');
  const verification=r.verification?unseal<OrganizationIdentifierVerifyInput>('ORG_IDENTIFIER_VERIFICATION_V1',r.verification,OrganizationIdentifierVerifySchema):null;
  const issues:OrganizationIdentifierIssue[]=[],heads:OrganizationIdentifierHistory[]=[],materials:unknown[]=[],diff:unknown[]=[],commands:Array<{row:number;entry:ReturnType<typeof normalizeIdentifierEntry>;facts:IdentifierFacts;step:string}>=[];
  const issue=(row:number,field:string,code:string,status:OrganizationIdentifierIssue['status']='BLOCKED')=>issues.push({row,field,code,status});
  if(input.profile!=='CORE'||j.profile!=='CORE'||c.dataset!=='ORG23'||c.status!=='PUBLISHED'||c.definition.templateVersion!=='ORG23_CORE_V1'||c.definition.fields.length!==16||ORG23_FIELDS.some(f=>!c.definition.fields.some(x=>x.code===f)))issue(0,'profile','BLOCKED_DEPENDENCY');
  if(verification){await record(s,r.verification!.actor,id,'VERIFY');if(verification.inputDigest!==r.digest)throw new Error('STALE_VALIDATION');}
  for(const e of input.entries)await inputReferenceAccess(s,actor,e,r.campus);
  const aliases=new Set<string>(),changed=new Set<string>();let admission=false;
  const addHead=(h:OrganizationIdentifierHistory)=>{if(!heads.some(x=>x.id===h.id))heads.push({...h,versions:h.versions.slice(-1)});};
  for(const [index,raw] of input.entries.entries()){
   const row=index+1;let e:ReturnType<typeof normalizeIdentifierEntry>;
   try{e=normalizeIdentifierEntry(raw);}catch(error){issue(row,'',error instanceof Error?error.message:'CLOSED_INPUT_REQUIRED','FAIL');continue;}
   await authorize(s,actor,e.row.identifier_system,r.campus,'READ_RESTRICTED');
   if(aliases.has(e.row.org_identifier_id)||e.identifier&&changed.has(e.identifier.id))issue(row,'org_identifier_id','BATCH_CONFLICT','FAIL');aliases.add(e.row.org_identifier_id);if(e.identifier)changed.add(e.identifier.id);
   diff.push({row,action:e.action,identifier:e.identifier,targetType:e.row.target_type,targetId:e.row.target_id,kind:e.row.identifier_kind,scheme:e.row.identifier_system,value:e.row.identifier_value,language:e.row.language,preferred:e.row.is_preferred==='Y',validFrom:e.validFrom,validTo:e.validTo});
   let prior:OrganizationIdentifierVersion|undefined;
   if(e.identifier){const h=await snapshot(s,actor,e.identifier.id,r.campus);if(!h)issue(row,'identifier','BLOCKED_DEPENDENCY');else{
    addHead(h);prior=h.versions.at(-1);if(prior)await historyReferenceAccess(s,actor,h,prior,r.campus);
    if(h.target_type!==e.row.target_type||h.target_id!==e.row.target_id||h.kind!==e.row.identifier_kind||h.scheme!==e.row.identifier_system)issue(row,'identifier','IDENTIFIER_IDENTITY_IMMUTABLE','FAIL');
    if(prior?.number!==e.identifier.expectedHead)issue(row,'identifier','STALE_VALIDATION');if(prior?.action==='RETRACT'||prior?.action==='END'&&e.action!=='RETRACT')issue(row,'identifier','IDENTIFIER_CLOSED','FAIL');
   }}
   const closing=e.action==='END'||e.action==='RETRACT';if(!closing)admission=true;
   if(closing&&(!prior||e.row.identifier_value!==prior.value||e.row.language!==prior.language||(e.row.is_preferred==='Y')!==prior.preferred||e.validFrom!==stamp(prior.valid_from)||e.action==='RETRACT'&&e.validTo!==(prior.valid_to===null?null:stamp(prior.valid_to))||e.action==='END'&&(e.validTo===null||prior.valid_to!==null&&e.validTo>=stamp(prior.valid_to))))issue(row,'action','CLOSED_INPUT_REQUIRED','FAIL');
   if(e.row.identifier_kind==='SOURCE_CODE'){issues.push({row,field:'identifier_kind',code:'SOURCE_MAPPING_REQUIRED',status:'BLOCKED',handoff:{dataset:'ORG22',owner:'department-master/organization-mapping',requiredFields:['from_system_id','source_entity_type','source_code','source_context','target_type','target_id','valid_from','valid_to']}});continue;}
   if(!['LEGAL','CAMPUS','ORG'].includes(e.row.target_type))issue(row,'target_type','BLOCKED_DEPENDENCY');
   if(!['HOSPITAL_CODE','ALIAS','FORMER_NAME','SEARCH_CODE'].includes(e.row.identifier_kind))issue(row,'identifier_kind','ENUM_INVALID','FAIL');
   if(e.row.identifier_kind==='HOSPITAL_CODE'&&(e.row.target_type!=='ORG'||e.row.identifier_system!=='SYNTHETIC_DEPARTMENT_CODE'||e.row.language!==''||e.row.is_preferred!=='N'))issue(row,'identifier_kind','BLOCKED_DEPENDENCY');
   if(e.row.identifier_kind!=='HOSPITAL_CODE'&&e.row.identifier_system==='SYNTHETIC_DEPARTMENT_CODE')issue(row,'identifier_system','BLOCKED_DEPENDENCY');
   if(e.row.identifier_kind==='HOSPITAL_CODE'&&e.action==='CORRECT'||e.action==='CHANGE'&&e.row.identifier_kind!=='HOSPITAL_CODE')issue(row,'action','CLOSED_INPUT_REQUIRED','FAIL');
   if(e.row.record_status!=='ACTIVE'||!e.row.approval_ref)issue(row,'approval_ref','APPROVAL_REQUIRED');
   const review=verification?.rows.find(x=>x.row===row);if(!review?.policyApproved)issue(row,'identifier_system','LEGAL_REVIEW_REQUIRED');
   if(r.verification){if(await authorize(s,r.verification.actor,e.row.identifier_system,r.campus,'VERIFY')!==r.verification.identity_code)throw new Error('ACCESS_DENIED');await inputReferenceAccess(s,r.verification.actor,raw,r.campus);}
   let target:MappingTargetReference|undefined=closing?prior?.facts.target:undefined;const sourcePins:unknown[]=[];
   const scheme=c.definition.codeSets.find(x=>x.field==='identifier_system');
   if(!closing){
    const policy=ORGANIZATION_IDENTIFIER_SCHEMES[e.row.identifier_system];if(!policy||policy.kind!==e.row.identifier_kind||!policy.targets.includes(e.row.target_type)||scheme?.codeSystem!==policy.issuer)issue(row,'identifier_system','BLOCKED_DEPENDENCY');
    if(!covered([{from:c.validFrom,to:c.validTo}],e.validFrom,e.validTo))issue(row,'valid_from','BLOCKED_DEPENDENCY');
    for(const field of ['target_type','identifier_kind','identifier_system','is_preferred','record_status'] as const){const codes=c.definition.codeSets.find(x=>x.field===field);if(!codes||codes.status!=='SYNTHETIC_ADOPTED'||!codes.codes.includes(e.row[field])||!covered([{from:codes.validFrom,to:codes.validTo}],e.validFrom,e.validTo))issue(row,field,'BLOCKED_DEPENDENCY');}
    const materialCount=materials.length;
    try{await recoverable(s,async()=>{
     sourcePins.push((await sql<{r:unknown}>`select department_master.mapping_source(${actor},${e.row.source_system_id}::uuid,${e.validFrom}::timestamp,${e.validTo}::timestamp,true) r`.execute(s)).rows[0]!.r);
     materials.push(await evidence(s,actor,e.evidenceId,e,c,r.campus));if(review){materials.push(await evidence(s,actor,review.evidenceId,e,c,r.campus));await evidence(s,r.verification!.actor,review.evidenceId,e,c,r.campus);}
     target=await targets.read(s,actor,{type:e.row.target_type,id:e.row.target_id,validFrom:e.validFrom,validTo:e.validTo});
    });}catch(error){materials.length=materialCount;sourcePins.length=0;target=undefined;if(error instanceof Error&&['KEY_UNAVAILABLE','ACCESS_DENIED'].includes(error.message))throw error;issue(row,'target_id','BLOCKED_DEPENDENCY');}
   }else if(prior){
    const materialCount=materials.length;
    try{await recoverable(s,async()=>{materials.push(await evidence(s,actor,e.evidenceId,e,c,r.campus,'CLOSURE'));if(review){materials.push(await evidence(s,actor,review.evidenceId,e,c,r.campus,'CLOSURE'));await evidence(s,r.verification!.actor,review.evidenceId,e,c,r.campus,'CLOSURE');}});}
    catch(error){
     materials.length=materialCount;
     if(!(error instanceof Error)||!['PAYLOAD_UNAVAILABLE','BLOCKED_DEPENDENCY','NOT_FOUND','SOURCE_NOT_READY'].includes(error.message))throw error;
     issue(row,'evidenceId','BLOCKED_DEPENDENCY');continue;
    }
   }
   if(e.row.identifier_kind==='HOSPITAL_CODE'&&(e.action==='REGISTER'||e.action==='CHANGE')){const reserved=(await sql<{r:unknown}>`select department_master.identifier_code(${actor},${e.row.identifier_value},NULL) r`.execute(s)).rows[0]!.r;if(reserved)issue(row,'identifier_value','IDENTIFIER_CONFLICT','FAIL');}
   if(!target)continue;
   const facts:IdentifierFacts={sourceVersion:e.row.version_no,sourceRecordedAt:e.sourceRecordedAt,sourceSystemId:e.row.source_system_id,contractVersionId:c.versionId,verificationId:r.verification?.id??'',target,issuer:closing?prior!.facts.issuer:scheme?.codeSystem??'',sourcePins,commandDigest:planBinding(provider,'ORG_IDENTIFIER_COMMAND_V1',{entry:e,contractVersionId:c.versionId,verification:review??null,target,sourcePins})};
   if(e.action==='CHANGE'){
    if(!prior||e.validFrom<=stamp(prior.valid_from)||e.validTo!==(prior.valid_to===null?null:stamp(prior.valid_to)))issue(row,'valid_from','CLOSED_INPUT_REQUIRED','FAIL');
    else{
     const old={...e,action:'END' as const,row:{...e.row,identifier_value:prior.value,language:prior.language,is_preferred:prior.preferred?'Y' as const:'N' as const,valid_from:stamp(prior.valid_from),valid_to:e.validFrom},validFrom:stamp(prior.valid_from),validTo:e.validFrom};
     commands.push({row,entry:old,facts:{...facts,target:prior.facts.target,issuer:prior.facts.issuer},step:'CHANGE_END'});
     commands.push({row,entry:{...e,action:'REGISTER',identifier:null},facts,step:'CHANGE_REGISTER'});
    }
   }else commands.push({row,entry:e,facts,step:e.action});
  }
  // Bind only relevant current heads and validate the complete final timeline;
  // input ordering cannot reject a legal preferred-alias or code handover.
  const final=new Map<string,{h:OrganizationIdentifierHistory;v:Pick<OrganizationIdentifierVersion,'action'|'value'|'language'|'preferred'|'valid_from'|'valid_to'>}>();
  for(const {entry:e,row} of commands){
   if(e.row.identifier_kind!=='HOSPITAL_CODE'&&e.row.is_preferred!=='Y')continue;
   const peers=(await sql<{r:OrganizationIdentifierHistory[]}>`select department_master.identifier_peers(${actor},${e.row.target_type},${e.row.target_id}::uuid,${e.row.identifier_system},${e.row.identifier_kind},${r.campus}) r`.execute(s)).rows[0]!.r;
   for(const h of peers){
    const v=h.versions.at(-1);
    if(!v||v.action==='RETRACT'||e.row.identifier_kind!=='HOSPITAL_CODE'&&(!v.preferred||v.language!==e.row.language)||v.valid_to!==null&&stamp(v.valid_to)<=e.validFrom||e.validTo!==null&&e.validTo<=stamp(v.valid_from))continue;
    addHead(h);await historyReferenceAccess(s,actor,h,v,r.campus);final.set(h.id,{h,v});
   }
  }
  const newCodes=new Set<string>();for(const {entry:e,row} of commands)if(e.row.identifier_kind==='HOSPITAL_CODE'&&e.action==='REGISTER'){if(newCodes.has(e.row.identifier_value))issue(row,'identifier_value','BATCH_CONFLICT','FAIL');newCodes.add(e.row.identifier_value);}
  for(const [index,{entry:e}] of commands.entries())final.set(e.identifier?.id??'new:'+index,{h:{id:e.identifier?.id??'new:'+index,target_type:e.row.target_type,target_id:e.row.target_id,kind:e.row.identifier_kind,scheme:e.row.identifier_system,reserved_value:null,versions:[]},v:{action:e.action as OrganizationIdentifierVersion['action'],value:e.row.identifier_value,language:e.row.language,preferred:e.row.is_preferred==='Y',valid_from:e.validFrom,valid_to:e.validTo}});
  const values=[...final.values()];for(let a=0;a<values.length;a++)for(let b=a+1;b<values.length;b++){const x=values[a]!,y=values[b]!;if(x.v.action==='RETRACT'||y.v.action==='RETRACT'||x.h.target_type!==y.h.target_type||x.h.target_id!==y.h.target_id||x.h.scheme!==y.h.scheme||x.h.kind!==y.h.kind)continue;
   if((x.h.kind==='HOSPITAL_CODE'||x.v.preferred&&y.v.preferred&&x.v.language===y.v.language)&&(x.v.valid_to===null||stamp(y.v.valid_from)<stamp(x.v.valid_to))&&(y.v.valid_to===null||stamp(x.v.valid_from)<stamp(y.v.valid_to)))issue(0,'is_preferred','IDENTIFIER_CONFLICT','FAIL');
  }
  if(commands.length>100)issue(0,'entries','PLAN_INPUT_LIMIT','FAIL');
  if(admission){const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;const active=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:c.id,businessAt:now})}::jsonb) r`.execute(s)).rows[0]!.r;if(active[0]?.versionId!==c.versionId)issue(0,'contract','STALE_VALIDATION');}
  return {r,input,contract:c,verification,issues,heads,materials,commands,diff};
 };
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,action){const r=await record(s,actor,input.jobId,action);if(r.revision!==input.revisionId||r.campus!==input.campus||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');await record(s,actor,r.id,'READ_RESTRICTED');const raw=unseal<OrganizationIdentifierStoredStageInput>('ORG_IDENTIFIER_INPUT_V1',r,OrganizationIdentifierStoredStageSchema);for(const e of raw.entries)await inputReferenceAccess(s,actor,e,r.campus);},
  async authorizeApproval(s,actor,input){const r=await record(s,actor,input.jobId,'REVIEW');if(await inputIdentity(s,actor,r,'REVIEW')===r.identity_code)throw new Error('MAKER_CHECKER_REQUIRED');},
  async authorizeFrozen(s,actor,unit){const heads=unit.basis['heads'];if(!Array.isArray(heads))throw new Error('INVALID_PLAN_TOKEN');for(const h of heads as OrganizationIdentifierHistory[])for(const v of h.versions)await historyReferenceAccess(s,actor,h,v,unit.input.campus);},
  async observe(s,actor,input){const v=await inspectInput(s,actor,input.jobId);return {input,atomicRule:'ORG23_WHOLE_REVISION_V1',basis:{inputDigest:v.r.digest,entries:v.input.entries,contract:v.contract,verificationId:v.r.verification?.id??null,verificationDigest:v.r.verification?.digest??null,verification:v.verification,issues:v.issues,heads:v.heads,materials:v.materials},commands:v.commands.map(({row,entry,facts,step},commandIndex)=>({owner:'department-master/organization-identifier',row:commandIndex+1,intent:entry.action==='REGISTER'?'CREATE':'REVISE',target:entry.identifier?{owner:entry.identifier.owner,id:entry.identifier.id,version:entry.identifier.expectedHead}:null,aliases:[],value:{inputId:v.r.id,inputRow:String(row),sourceRow:String(entry.sourceRow??row),command:canonicalPlan(entry),facts:canonicalPlan(facts),step}})),diff:v.diff};},
  async validate(_s,_actor,unit,stage){const issues=unit.basis['issues'] as OrganizationIdentifierIssue[];if(stage==='FREEZE'&&issues.length&&issues.every(x=>['BLOCKED_DEPENDENCY','SOURCE_MAPPING_REQUIRED'].includes(x.code)))return;if(issues.length||!unit.commands.length)throw new Error(issues[0]?.code??'BATCH_REJECTED');},
  async apply(s,actor,command,_resolved,approval){const facts=JSON.parse(command.value['facts']!);return {ok:true,fact:await mutate<OwnerFact>(s,actor,{operation:'APPLY',inputId:command.value['inputId'],sourceRow:Number(command.value['sourceRow']),step:command.value['step'],command:JSON.parse(command.value['command']!),facts,contentDigest:planBinding(provider,'ORG_IDENTIFIER_FACTS_V1',facts),...approval})};},
  async exactRead(s,actor,input,fact){if(fact.owner!=='department-master/organization-identifier')return null;const h=await snapshot(s,actor,fact.id,input.campus);return h?.versions.some(v=>v.number===fact.version)?fact:null;},
  async beforeCommit(s){await sql`set constraints department_master.identifier_timeline immediate`.execute(s);},
 };
 const coordinator=applyCoordinator(db,provider,port);
 const files=fileIntake(db,provider);
 const stageIn=async(s:Scope,actor:string,input:OrganizationIdentifierStoredStageInput)=>mutate<Staged>(s,actor,{operation:'STAGE',...input,schemes:[...new Set(input.entries.map(x=>x.row.identifier_system))],...seal('ORG_IDENTIFIER_INPUT_V1',input)});
 const snapshotAt=async(s:Scope,actor:string,id:string,campus:string,recordAsOf?:string)=>{const h=await snapshot(s,actor,id,campus);if(!h)throw new Error('NOT_FOUND');const versions=h.versions.filter(v=>recordAsOf===undefined||stamp(v.recorded_at)<=localTime(recordAsOf));if(!versions.length)throw new Error('NOT_FOUND');return {...h,versions};};
 const historyIn=async(s:Scope,actor:string,id:string,campus:string,recordAsOf?:string)=>{const h=await snapshotAt(s,actor,id,campus,recordAsOf);for(const v of h.versions)await historyReferenceAccess(s,actor,h,v,campus);return h;};
 const selectedIn=async(s:Scope,actor:string,id:string,campus:string,recordAsOf?:string)=>{
  const h=(await sql<{r:OrganizationIdentifierHistory|null}>`select department_master.identifier_selected(${actor},${id}::uuid,${campus},${recordAsOf===undefined?null:localTime(recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;
  if(!h)throw new Error('NOT_FOUND');const v=h.versions[0]!;
  await targets.authorize(s,actor,{type:h.target_type,id:h.target_id,validFrom:stamp(v.valid_from),validTo:v.valid_to===null?null:stamp(v.valid_to)});return h;
 };
 const saveValidation=async(s:Scope,actor:string,j:ImportJob,campus:'NORTH'|'SOUTH',sourceArtifactId:string,parsed:ParserResult,issues:OrganizationIdentifierIssue[])=>{
  const decision=issues.some(i=>i.status==='FAIL')?'FAIL' as const:issues.length?'BLOCKED' as const:'PASS' as const;
  const evaluation:ValidationEvaluation={decision,issues:issues.map(i=>({rule:'ORG23_'+i.code,layer:2,row:parsed.cells.find(c=>c.row===i.row)?.sourceRow??i.row,field:i.field,status:i.status==='FAIL'?'FAIL':'UNKNOWN',code:i.code})),layers:[{layer:1,status:parsed.structuralStatus==='PARSED'?'PASS':'FAIL'},{layer:2,status:decision==='PASS'?'PASS':decision==='FAIL'?'FAIL':'UNKNOWN'}],evidenceRequirements:[],dependencies:[],interpretationPolicy:'EXACT_TEXT_V1'};
  return recordOwnerFileValidation(s,provider,actor,{jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId,campus,requestId:randomUUID(),parseRequestId:randomUUID(),outputRequestId:randomUUID(),contractVersionId:j.contract.versionId,ruleVersion:j.contract.definition.ruleVersion,parserPolicy:'STRICT_ORGANIZATION_IDENTIFIER_V1',structuralStatus:parsed.structuralStatus,parsed:{sourceArtifactId,result:parsed},evaluation});
 };
 const ReadQuery=Type.Object({id:Id,campus:Type.Enum(['NORTH','SOUTH']),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false});
 const visible=(v:OrganizationIdentifierVersion,at:string)=>v.action!=='RETRACT'&&stamp(v.valid_from)<=at&&(v.valid_to===null||at<stamp(v.valid_to));
 const stageInTransaction=async(s:Scope,actor:string,raw:OrganizationIdentifierStageInput)=>{identifierCheck(OrganizationIdentifierStageSchema,raw);const input:OrganizationIdentifierStoredStageInput={...structuredClone(raw),entries:raw.entries.map((e,i)=>({...e,sourceRow:i+1}))};const j=await job(s,actor,input.jobId);if(j.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');if(j.revisions.at(-1)?.input.kind!=='METADATA_ONLY')throw new Error('FILE_REVISION_REQUIRED');return stageIn(s,actor,input);};
 return {
  stage:(actor:string,raw:OrganizationIdentifierStageInput)=>root(scope=>stageInTransaction(scope,actor,raw)),
  commandsInTransaction:(scope:Scope)=>({stage:(actor:string,input:OrganizationIdentifierStageInput)=>stageInTransaction(scope,actor,input)}),
  async receiveFile(actor:string,raw:OrganizationIdentifierReceiveInput,bytes:Uint8Array){identifierCheck(OrganizationIdentifierReceiveSchema,raw);const input=structuredClone(raw);if(input.job.input.kind!=='FILE'||input.job.input.format!=='XLSX'||input.job.input.parserPolicy!=='STRICT_ORGANIZATION_IDENTIFIER_V1')throw new Error('CLOSED_INPUT_REQUIRED');const received=await files.receiveFile(actor,{job:input.job,fileRequestId:input.fileRequestId,extension:'.xlsx',campus:input.campus,purpose:'IDENTITY_VERIFY',retentionSeconds:input.retentionSeconds},bytes);
   return root(async s=>{const j=await job(s,actor,received.job.id),content=await protectedArtifacts(s,provider).authorizeSensitiveRead(actor,{scope:'SYNTHETIC',campus:input.campus,purpose:'IDENTITY_VERIFY',requestId:input.requestId,artifactId:received.artifact.artifactId},{jobId:j.id,revisionId:j.currentRevisionId,kind:'RAW_FILE'});try{
    const parsed=await boundedParse(content,'XLSX',j.contract.definition.fields,'STRICT_ORGANIZATION_IDENTIFIER_V1'),failures:OrganizationIdentifierIssue[]=parsed.issues.map(i=>({row:parsed.cells.find(c=>c.sourceRow===i.row)?.row??i.row,field:'',code:i.code,status:'FAIL'})),entries:OrganizationIdentifierStoredStageInput['entries']=[];
    if(parsed.rows.length!==input.entries.length)failures.push({row:0,field:'',code:'MANIFEST_ROW_MISMATCH',status:'FAIL'});
    for(const [i,row] of parsed.rows.entries()){try{const source=validateORG23(row),meta=input.entries[i];if(meta)entries.push({...meta,row:source,sourceRow:parsed.cells.find(c=>c.row===i+1)?.sourceRow??i+1});}catch{failures.push({row:i+1,field:'',code:'FIELD_INVALID',status:'FAIL'});}}
    let staged:Staged|null=null;if(parsed.structuralStatus==='PARSED'&&!failures.length){staged=await stageIn(s,actor,{requestId:input.requestId,jobId:j.id,revisionId:j.currentRevisionId,campus:input.campus,profile:j.profile,entries,sourceArtifactId:received.artifact.artifactId});await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,(await inspectInput(s,actor,staged.inputId)).issues);}else await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,failures);
    return {jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,issues:failures.map(f=>({code:f.code,row:parsed.cells.find(c=>c.row===f.row)?.sourceRow??f.row,column:0})),input:staged};
   }finally{content.fill(0);}});
  },
  async readInput(actor:string,input:{inputId:string}){identifierCheck(oneInput,input);return root(async s=>{const r=await record(s,actor,input.inputId),raw=unseal<OrganizationIdentifierStoredStageInput>('ORG_IDENTIFIER_INPUT_V1',r,OrganizationIdentifierStoredStageSchema);for(const e of raw.entries)await inputReferenceAccess(s,actor,e,r.campus);return raw;});},
  async preview(actor:string,input:{inputId:string}){identifierCheck(oneInput,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);return {entries:v.input.entries,verification:v.verification,heads:v.heads,issues:v.issues};});},
  async validate(actor:string,input:{inputId:string}){identifierCheck(oneInput,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);let validationRunId:string|null=null;if(v.input.sourceArtifactId){const j=await inputJob(s,actor,input.inputId),bytes=await protectedArtifacts(s,provider).authorizeSensitiveRead(actor,{scope:'SYNTHETIC',campus:v.r.campus,purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:v.input.sourceArtifactId},{jobId:j.id,revisionId:j.currentRevisionId,kind:'RAW_FILE'});try{const parsed=await boundedParse(bytes,'XLSX',j.contract.definition.fields,'STRICT_ORGANIZATION_IDENTIFIER_V1');validationRunId=(await saveValidation(s,actor,j,v.r.campus,v.input.sourceArtifactId,parsed,v.issues)).run.runId;}finally{bytes.fill(0);}}return {inputId:v.r.id,digest:v.r.digest,validationRunId,decision:v.issues.some(i=>i.status==='FAIL')?'FAIL' as const:v.issues.length?'BLOCKED' as const:'PASS' as const,issues:v.issues,commandCount:v.commands.length};});},
  async verify(actor:string,input:OrganizationIdentifierVerifyInput){identifierCheck(OrganizationIdentifierVerifySchema,input);return root(async s=>{const r=await record(s,actor,input.inputId,'VERIFY'),raw=unseal<OrganizationIdentifierStoredStageInput>('ORG_IDENTIFIER_INPUT_V1',r,OrganizationIdentifierStoredStageSchema);for(const e of raw.entries)await inputReferenceAccess(s,actor,e,r.campus);if(input.rows.length!==raw.entries.length||new Set(input.rows.map(x=>x.row)).size!==raw.entries.length||input.rows.some(x=>x.row>raw.entries.length))throw new Error('CLOSED_INPUT_REQUIRED');return mutate<{verificationId:string}>(s,actor,{operation:'VERIFY',...input,...seal('ORG_IDENTIFIER_VERIFICATION_V1',input)});});},
  async plan(actor:string,input:{inputId:string;requestId:string}){identifierCheck(Type.Object({inputId:Id,requestId:Id},{additionalProperties:false}),input);const r=await root(async s=>{const r=await record(s,actor,input.inputId,'WRITE');if(await inputIdentity(s,actor,r,'WRITE')!==r.identity_code)throw new Error('ACCESS_DENIED');return r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async history(actor:string,input:{id:string;campus:'NORTH'|'SOUTH';recordAsOf?:string}){identifierCheck(ReadQuery,input);return root(s=>historyIn(s,actor,input.id,input.campus,input.recordAsOf));},
  async read(actor:string,input:{id:string;campus:'NORTH'|'SOUTH';businessAt:string;recordAsOf?:string}){identifierCheck(Type.Object({...ReadQuery.properties,businessAt:Type.String()},{additionalProperties:false}),input);return root(async s=>{const h=await selectedIn(s,actor,input.id,input.campus,input.recordAsOf),v=h.versions.at(-1)!;return {id:h.id,version:visible(v,localTime(input.businessAt))?v:null};});},
  async list(actor:string,input:{campus:'NORTH'|'SOUTH';after?:string;limit?:number;recordAsOf?:string}){identifierCheck(Type.Object({campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false}),input);return root(async s=>(await sql<{r:string[]}>`select department_master.identifier_list(${actor},${input.campus},${input.after??null}::uuid,${input.limit??50},${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp,NULL,NULL) r`.execute(s)).rows[0]!.r);},
  async forTarget(actor:string,input:{type:string;id:string;campus:'NORTH'|'SOUTH';businessAt:string;recordAsOf?:string;after?:string;limit?:number}){identifierCheck(Type.Object({type:Type.Enum(['LEGAL','CAMPUS','ORG']),id:Id,campus:Type.Enum(['NORTH','SOUTH']),businessAt:Type.String(),recordAsOf:Type.Optional(Type.String()),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},{additionalProperties:false}),input);return root(async s=>{await targets.authorize(s,actor,{type:input.type,id:input.id,validFrom:localTime(input.businessAt),validTo:null});const ids=(await sql<{r:string[]}>`select department_master.identifier_list(${actor},${input.campus},${input.after??null}::uuid,${input.limit??50},${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp,${input.type},${input.id}::uuid) r`.execute(s)).rows[0]!.r,items=[];for(const id of ids){const h=await selectedIn(s,actor,id,input.campus,input.recordAsOf),v=h.versions.at(-1)!;if(visible(v,localTime(input.businessAt)))items.push({id:h.id,kind:h.kind,scheme:h.scheme,value:v.value,language:v.language,preferred:v.preferred,version:v});}return {items,next:ids.length===(input.limit??50)?ids.at(-1)!:null};});},
  async preferred(actor:string,input:{type:string;id:string;campus:'NORTH'|'SOUTH';scheme:string;kind:string;language:string;businessAt:string;recordAsOf?:string}){identifierCheck(Type.Object({type:Type.Enum(['LEGAL','CAMPUS','ORG']),id:Id,campus:Type.Enum(['NORTH','SOUTH']),scheme:Type.String({minLength:1,maxLength:256}),kind:Type.Enum(['ALIAS','FORMER_NAME','SEARCH_CODE']),language:Type.String({maxLength:64}),businessAt:Type.String(),recordAsOf:Type.Optional(Type.String())},{additionalProperties:false}),input);return root(async s=>{await authorize(s,actor,input.scheme,input.campus,'READ');await targets.authorize(s,actor,{type:input.type,id:input.id,validFrom:localTime(input.businessAt),validTo:null});let after:string|undefined;const matches=[];do{const ids=(await sql<{r:string[]}>`select department_master.identifier_list(${actor},${input.campus},${after??null}::uuid,100,${input.recordAsOf?localTime(input.recordAsOf):null}::timestamp,${input.type},${input.id}::uuid) r`.execute(s)).rows[0]!.r;for(const id of ids){const h=await snapshot(s,actor,id,input.campus);if(!h||h.scheme!==input.scheme||h.kind!==input.kind)continue;const v=h.versions.filter(v=>input.recordAsOf===undefined||stamp(v.recorded_at)<=localTime(input.recordAsOf)).at(-1);if(v&&v.language===input.language&&v.preferred&&visible(v,localTime(input.businessAt))){await historyReferenceAccess(s,actor,h,v,input.campus);matches.push({id:h.id,kind:h.kind,scheme:h.scheme,value:v.value,language:v.language,preferred:true,version:v});}}after=ids.length===100?ids.at(-1):undefined;}while(after);if(matches.length>1)throw new Error('IDENTIFIER_CONFLICT');return {alias:matches[0]??null};});},
  async resolve(actor:string,input:OrganizationIdentifierResolveInput){identifierCheck(OrganizationIdentifierResolveSchema,input);if(input.scheme!==input.scheme.trim()||input.value!==input.value.trim())throw new Error('CLOSED_INPUT_REQUIRED');return root(async s=>{await authorize(s,actor,input.scheme,input.campus,'READ');if(input.scheme!=='SYNTHETIC_DEPARTMENT_CODE')throw new Error('IDENTIFIER_RESOLUTION_FORBIDDEN');const m=(await sql<{r:{id:string}|null}>`select department_master.identifier_code(${actor},${input.value},NULL) r`.execute(s)).rows[0]!.r;if(!m)return {status:'NOT_FOUND' as const};let h;try{h=await selectedIn(s,actor,m.id,input.campus,input.recordAsOf);}catch(error){if(error instanceof Error&&error.message==='NOT_FOUND')return {status:'NOT_FOUND' as const};throw error;}const v=h.versions.at(-1)!;if(!visible(v,localTime(input.businessAt)))return {status:'NOT_FOUND' as const};return {status:'RESOLVED' as const,identifierId:h.id,version:v.number,versionId:v.id,targetType:h.target_type,targetId:h.target_id,assertion:'HISTORICAL_ASSERTION' as const,currentReview:'NOT_EVALUATED' as const};});},
  async diff(actor:string,input:{id:string;campus:'NORTH'|'SOUTH';fromVersion:string;toVersion:string}){identifierCheck(Type.Object({id:Id,campus:Type.Enum(['NORTH','SOUTH']),fromVersion:Type.String({pattern:'^[1-9][0-9]*$'}),toVersion:Type.String({pattern:'^[1-9][0-9]*$'})},{additionalProperties:false}),input);return root(async s=>{const h=await snapshotAt(s,actor,input.id,input.campus),before=h.versions.find(v=>v.number===input.fromVersion),after=h.versions.find(v=>v.number===input.toVersion);if(!before||!after)throw new Error('NOT_FOUND');await historyReferenceAccess(s,actor,h,before,input.campus);await historyReferenceAccess(s,actor,h,after,input.campus);return {before,after};});},
  async close(){await db.destroy();if(!targetPort)await targets.close();},
 };
}
