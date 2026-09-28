import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Pool,types} from 'pg';
import {Kysely,PostgresDialect,sql} from 'kysely';
import type {DB} from '../../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,type ApplyOwnerPort,type OwnerFact,type KeyProviderPort,type ImportContractItem} from '../../governance-catalog/index.js';
import type {ImportJob} from '../../governance-catalog/index.js';
import {localTime,covered,subtract} from '../../organization-master/index.js';
import {StageSchema,StoredStageSchema,VerifySchema,PlanSchema,ReadSchema,CoverageSchema,ReceiveSchema,RowSchema,Id,check,normalizeEntry,validateORG04,ORG04_FIELDS,type StageInput,type StoredStageInput,type VerifyInput,type ReceiveInput} from './contracts.js';
import {fileIntake,boundedParse} from '../../governance-catalog/index.js';
import {protectedArtifacts} from '../../governance-catalog/index.js';
import {recordOwnerFileValidation} from '../../governance-catalog/index.js';
import type {ParserResult} from '../../governance-catalog/index.js';
import type {ValidationEvaluation} from '../../governance-catalog/index.js';
export * from './contracts.js';
type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface Verification {id:string;actor:string;identity_code:string;digest:string;envelope:Envelope}
interface InputRecord {id:string;revision:string;job_id:string;job_revision:string;maker:string;identity_code:string;digest:string;campus:'NORTH'|'SOUTH';envelope:Envelope;verification:Verification|null}
type PreparedDepartmentCommand={row:number;entry:ReturnType<typeof normalizeEntry>};
export interface DepartmentFacts {name:string;shortName:string|null;orgType:string;establishedOn:string|null;description:string|null;virtual:boolean;historicalException:boolean;sourceVersion:string;sourceRecordedAt:string;sourceSystemId:string;policyVersionId:string;verificationId:string}
export interface DepartmentVersion {id:string;department_id:string;number:string;valid_from:string;valid_to:string|null;recorded_at:string;source_row:number;facts:DepartmentFacts;content_digest:string}
export interface DepartmentHistory {id:string;code:string;versions:DepartmentVersion[]}
export interface DepartmentIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED';sourceRow?:number}
const stamp=(s:string)=>localTime(s.replace(' ','T'));
const span=(v:DepartmentVersion)=>({from:stamp(v.valid_from),to:v.valid_to===null?null:stamp(v.valid_to)});

export function openDepartment(connection:string,provider?:KeyProviderPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:new Pool({connectionString:connection,max:4,options:'-c timezone=Asia/Shanghai',types:{getTypeParser:(oid,format)=>oid===1114?(v:string)=>v:types.getTypeParser(oid,format)}})})});
 const root=<T>(work:(s:Scope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const authorize=async(s:Scope,actor:string,scope:string,permission:string)=>(await sql<{r:string}>`select department_master.authorize(${actor},${scope},${permission}) r`.execute(s)).rows[0]!.r;
 const record=async(s:Scope,actor:string,id:string,permission='READ_RESTRICTED')=>(await sql<{r:InputRecord}>`select department_master.input_read(${actor},${id}::uuid,${permission}) r`.execute(s)).rows[0]!.r;
 const job=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:id})}::jsonb) r`.execute(s)).rows[0]!.r;
 const inputJob=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select department_master.job_read(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const snapshot=async(s:Scope,actor:string,id:string)=>(await sql<{r:DepartmentHistory}>`select department_master.snapshot(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const seal=(domain:string,value:unknown)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(domain+'\0'+digest));const bytes=Buffer.from(canonicalPlan(value));
  try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}
 };
 const unseal=<T>(domain:string,r:{digest:string;envelope:Envelope},schema:unknown):T=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value:unknown=JSON.parse(bytes.toString());check(schema,value);if(planBinding(provider,domain,value)!==r.digest)throw new Error();return value as T;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const mutate=async<T>(s:Scope,actor:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select department_master.mutate(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const evidence=async(s:Scope,actor:string,id:string,entry:ReturnType<typeof normalizeEntry>,contract:ImportContractItem,campus:string)=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select department_master.evidence(${actor},${id}::uuid,${entry.row.source_system_id}::uuid,${contract.definition.sourceVersionId}::uuid,${campus},${entry.validFrom}::timestamp,${entry.validTo}::timestamp) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);try{return {id,digest:planBinding(provider,'DEPARTMENT_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const policy=async(s:Scope,actor:string,input:StageInput,j:ImportJob)=>{
  const c=j.contract;
  if(input.profile!=='CORE'||j.profile!=='CORE'||c.dataset!=='ORG04'||c.status!=='PUBLISHED'||c.definition.templateVersion!=='ORG04_CORE_V1'||c.definition.fields.length!==18||ORG04_FIELDS.some(f=>!c.definition.fields.some(x=>x.code===f)))throw new Error('BLOCKED_DEPENDENCY');
  const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;
  const active=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:c.id,businessAt:now})}::jsonb) r`.execute(s)).rows[0]!.r;
  if(active[0]?.versionId!==c.versionId)throw new Error('STALE_VALIDATION');
  return c;
 };
 const factsFor=(e:ReturnType<typeof normalizeEntry>,contract:ImportContractItem,record:InputRecord,review:VerifyInput['rows'][number]|undefined):DepartmentFacts=>({name:e.row.org_name,shortName:e.row.org_short_name||null,orgType:e.row.org_type,establishedOn:e.row.established_on||null,description:e.row.description||null,virtual:e.row.is_virtual==='Y',historicalException:review?.historicalException??false,sourceVersion:e.row.version_no,sourceRecordedAt:e.recordedAt,sourceSystemId:e.row.source_system_id,policyVersionId:contract.versionId,verificationId:record.verification?.id??''});
 const inspectInput=async(s:Scope,actor:string,id:string)=>{
  const r=await record(s,actor,id),input=unseal<StoredStageInput>('DEPARTMENT_INPUT_V1',r,StoredStageSchema),j=await inputJob(s,actor,id);
  if(j.currentRevisionId!==r.job_revision||j.status==='REJECTED')throw new Error('STALE_REVISION');
  const c=await policy(s,actor,input,j),verification=r.verification?unseal<VerifyInput>('DEPARTMENT_VERIFICATION_V1',r.verification,VerifySchema):null;
  const issues:DepartmentIssue[]=[],commands:PreparedDepartmentCommand[]=[],heads:DepartmentHistory[]=[],materials:unknown[]=[],completedRows=new Set<number>(),ignoredRows=new Set<number>();
  const issue=(row:number,field:string,code:string,status:DepartmentIssue['status']='BLOCKED')=>issues.push({row,field,code,status});
  const businessContent=(e:ReturnType<typeof normalizeEntry>)=>{const {sourceRow:_,...content}=e;return canonicalPlan(content);};
  if(verification){await authorize(s,r.verification!.actor,'HOSPITAL','VERIFY');if(verification.inputDigest!==r.digest)throw new Error('STALE_VALIDATION');}
  const aliases=new Map<string,number[]>(),codes=new Map<string,number[]>(),targets=new Map<string,number[]>(),preparedByRow=new Map<number,PreparedDepartmentCommand>();
  for(const [index,entry] of input.entries.entries()){
   const row=index+1;let e:ReturnType<typeof normalizeEntry>;try{e=normalizeEntry(entry,input.timePolicy);}catch(error){issue(row,'',error instanceof Error?error.message:'CLOSED_INPUT_REQUIRED','FAIL');continue;}commands.push({row,entry:e});
   preparedByRow.set(row,{row,entry:e});
   aliases.set(e.row.org_id,[...(aliases.get(e.row.org_id)??[]),row]);codes.set(e.row.org_code,[...(codes.get(e.row.org_code)??[]),row]);if(e.target)targets.set(e.target.id,[...(targets.get(e.target.id)??[]),row]);
   if(e.row.abolished_on||['SUSPENDED','RETIRED'].includes(e.row.record_status))issue(row,'record_status','BLOCKED_DEPENDENCY');
   else if(e.row.record_status!=='ACTIVE')issue(row,'record_status','APPROVAL_REQUIRED');
   if(!e.row.approval_ref.trim())issue(row,'approval_ref','APPROVAL_REQUIRED');
   if(!covered([{from:c.validFrom,to:c.validTo}],e.validFrom,e.validTo))issue(row,'valid_from','BLOCKED_DEPENDENCY');
   for(const field of ['org_type','is_virtual','record_status'] as const){const code=c.definition.codeSets.find(x=>x.field===field);if(!code||code.status!=='SYNTHETIC_ADOPTED'||!code.codes.includes(e.row[field])||!covered([{from:code.validFrom,to:code.validTo}],e.validFrom,e.validTo))issue(row,field,'BLOCKED_DEPENDENCY');}
   const review=verification?.rows.find(x=>x.row===row);
   if(!review||review.disposition!=='DEPARTMENT')issue(row,'is_virtual','LEGAL_REVIEW_REQUIRED');
   const missing=!e.row.established_on||!e.row.establishment_doc.trim();
   if(missing&&(e.origin!=='HISTORICAL'||!review?.historicalException))issue(row,!e.row.established_on?'established_on':'establishment_doc','LEGAL_REVIEW_REQUIRED');
   if(review?.historicalException&&(!missing||e.origin!=='HISTORICAL'))issue(row,'established_on','CLOSED_INPUT_REQUIRED','FAIL');
   if(e.target){const h=await snapshot(s,actor,e.target.id);heads.push(h);if(String(h.versions.at(-1)?.number)!==e.target.expectedVersion)issue(row,'target','STALE_VALIDATION');if(h.code!==e.row.org_code)issue(row,'org_code','BLOCKED_DEPENDENCY');}
   const facts=factsFor(e,c,r,review);
   const completed=(await sql<{r:boolean}>`select department_master.committed_row(${actor},${r.job_id}::uuid,${Number(e.sourceRow??row)},${JSON.stringify(facts)}::jsonb) r`.execute(s)).rows[0]!.r;
   if(completed)completedRows.add(row);
   else if(!e.target&&(await sql<{r:boolean}>`select department_master.code_conflict(${actor},${e.row.org_code},NULL) r`.execute(s)).rows[0]!.r)issue(row,'org_code','IDENTIFIER_CONFLICT');
   try{materials.push(await evidence(s,actor,e.evidenceId,e,c,input.campus));if(review){materials.push(await evidence(s,actor,review.evidenceId,e,c,input.campus));await evidence(s,r.verification!.actor,review.evidenceId,e,c,input.campus);}if(index===0&&input.sourceArtifactId)materials.push(await evidence(s,actor,input.sourceArtifactId,e,c,input.campus));}catch(error){if(error instanceof Error&&['ACCESS_DENIED','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE'].includes(error.message))throw error;issue(row,'source_system_id','BLOCKED_DEPENDENCY');}
  }
  const conflictRows=new Set<number>();
  const markConflicts=(groups:Map<string,number[]>,field:string)=>{for(const rows of groups.values())if(rows.length>1){const first=preparedByRow.get(rows[0]!);const exact=first!==undefined&&rows.slice(1).every(row=>{const candidate=preparedByRow.get(row);return candidate!==undefined&&businessContent(candidate.entry)===businessContent(first.entry);});if(exact)for(const row of rows.slice(1))ignoredRows.add(row);else{for(const row of rows){conflictRows.add(row);if(!issues.some(existing=>existing.row===row&&existing.field===field&&existing.code==='BATCH_CONFLICT'))issue(row,field,'BATCH_CONFLICT','FAIL');}}}};
  markConflicts(aliases,'org_id');markConflicts(codes,'org_code');markConflicts(targets,'target');
  for(const row of conflictRows)ignoredRows.delete(row);
  for(let index=issues.length-1;index>=0;index--)if(ignoredRows.has(issues[index]!.row))issues.splice(index,1);
  return {r,input,contract:c,verification,commands,heads,materials,issues,completedRows,ignoredRows};
 };
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,action){const r=await record(s,actor,input.jobId,action);if(r.revision!==input.revisionId||r.campus!==input.campus||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');if(action!=='READ')await authorize(s,actor,r.campus,'READ_RESTRICTED');},
   async observe(s,actor,input){const v=await inspectInput(s,actor,input.jobId),blockedRows=new Set(v.issues.filter(issue=>issue.row>0).map(issue=>issue.row)),skippedRows=new Set([...v.completedRows,...v.ignoredRows]),hasGlobalIssue=v.issues.some(issue=>issue.row===0),executable=hasGlobalIssue?[]:v.commands.filter(command=>!blockedRows.has(command.row)&&!skippedRows.has(command.row));return {input,atomicRule:'ORG04_ROW_INDEPENDENT_V1',basis:{inputDigest:v.r.digest,policy:v.contract,verification:v.verification,verificationId:v.r.verification?.id??null,verificationDigest:v.r.verification?.digest??null,heads:v.heads,materials:v.materials,issues:v.issues,completedRows:[...v.completedRows],ignoredRows:[...v.ignoredRows]},commands:executable.map(({row,entry:e})=>({owner:'department-master',row,intent:e.intent,target:e.target?{owner:e.target.owner,id:e.target.id,version:e.target.expectedVersion}:null,aliases:[],value:{inputId:v.r.id,sourceRow:String(e.sourceRow??row),command:canonicalPlan(e),facts:canonicalPlan(factsFor(e,v.contract,v.r,v.verification?.rows.find(x=>x.row===row)))}})),diff:executable.map(({row,entry:e})=>({row,intent:e.intent,target:e.target,name:e.row.org_name,validFrom:e.validFrom,validTo:e.validTo}))};},
   async validate(_s,_actor,unit){const issues=unit.basis['issues'] as DepartmentIssue[],completedRows=unit.basis['completedRows'];if(unit.commands.length===0&&(!Array.isArray(completedRows)||completedRows.length===0))throw new Error(issues[0]?.code??'BATCH_REJECTED');},
  async apply(s,actor,command,_resolved,approval){return {ok:true,fact:await mutate<OwnerFact>(s,actor,{operation:'APPLY',inputId:command.value['inputId'],row:command.row,sourceRow:Number(command.value['sourceRow']??command.row),command:JSON.parse(command.value['command']!),facts:JSON.parse(command.value['facts']!),contentDigest:planBinding(provider,'DEPARTMENT_FACTS_V1',JSON.parse(command.value['facts']!)),...approval})};},
  async exactRead(s,actor,_input,fact){if(fact.owner!=='department-master')return null;const h=await snapshot(s,actor,fact.id);return h.versions.some(v=>String(v.number)===fact.version)?fact:null;},
 };
 const coordinator=applyCoordinator(db,provider,port);
 const files=fileIntake(db,provider);
 const saveValidation=async(s:Scope,actor:string,j:ImportJob,campus:'NORTH'|'SOUTH',sourceArtifactId:string,parsed:ParserResult,issues:DepartmentIssue[],sourceRows?:ReadonlyMap<number,number>,requestId=randomUUID())=>{
  const decision=issues.some(i=>i.status==='FAIL')?'FAIL':issues.length?'BLOCKED':'PASS';
  const evaluation:ValidationEvaluation={decision,issues:issues.map(i=>({rule:'ORG04_'+i.code,layer:2,row:i.sourceRow??sourceRows?.get(i.row)??parsed.cells.find(c=>c.row===i.row)?.sourceRow??i.row,field:i.field,status:i.status==='FAIL'?'FAIL':'UNKNOWN',code:i.code})),layers:[{layer:1,status:parsed.structuralStatus==='PARSED'?'PASS':'FAIL'},{layer:2,status:decision==='PASS'?'PASS':decision==='FAIL'?'FAIL':'UNKNOWN'}],evidenceRequirements:[],dependencies:[],interpretationPolicy:'EXACT_TEXT_V1'};
  return recordOwnerFileValidation(s,provider,actor,{jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId,campus,requestId,parseRequestId:randomUUID(),outputRequestId:randomUUID(),contractVersionId:j.contract.versionId,ruleVersion:j.contract.definition.ruleVersion,parserPolicy:'STRICT_DEPARTMENT_V1',structuralStatus:parsed.structuralStatus,parsed:{sourceArtifactId,result:parsed},evaluation});
 };
 const stage=async(actor:string,raw:StageInput)=>{check(StageSchema,raw);const input:StoredStageInput={...structuredClone(raw),entries:raw.entries.map((entry,index)=>({...entry,sourceRow:index+1}))};return root(async s=>{const j=await job(s,actor,input.jobId);if(j.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');if(input.sourceArtifactId||j.revisions.at(-1)?.input.kind!=='METADATA_ONLY')throw new Error('FILE_REVISION_REQUIRED');return mutate<{inputId:string;revisionId:string;digest:string}>(s,actor,{operation:'STAGE',...input,...seal('DEPARTMENT_INPUT_V1',input)});});};
 const history=async(actor:string,id:string,recordAsOf?:string)=>{check(Id,id);const at=recordAsOf===undefined?null:localTime(recordAsOf);return root(async s=>{const h=await snapshot(s,actor,id),versions=h.versions.filter(v=>at===null||stamp(v.recorded_at)<=at);if(versions.length===0)throw new Error('NOT_FOUND');return {...h,versions};});};
 return {
  stage,
  async receiveFile(actor:string,raw:ReceiveInput,bytes:Uint8Array){
   check(ReceiveSchema,raw);const input=structuredClone(raw);
   if(input.job.input.kind!=='FILE'||input.job.input.format!=='XLSX'||input.job.input.parserPolicy!=='STRICT_DEPARTMENT_V1')throw new Error('CLOSED_INPUT_REQUIRED');
   const format=input.job.input.format;
   await root(s=>authorize(s,actor,input.campus,'WRITE'));
   const received=await files.receiveFile(actor,{job:input.job,fileRequestId:input.fileRequestId,extension:format==='XLSX'?'.xlsx':'.json',campus:input.campus,purpose:'IDENTITY_VERIFY',retentionSeconds:input.retentionSeconds},bytes);
   return root(async s=>{
    const j=await job(s,actor,received.job.id),store=protectedArtifacts(s,provider);
    const content=await store.authorizeSensitiveRead(actor,{scope:'SYNTHETIC',campus:input.campus,purpose:'IDENTITY_VERIFY',requestId:input.requestId,artifactId:received.artifact.artifactId},{jobId:j.id,revisionId:received.job.revisionId,kind:'RAW_FILE'});
    try{
     const parsed=await boundedParse(content,format,j.contract.definition.fields,'STRICT_DEPARTMENT_V1');
     if(parsed.structuralStatus==='REJECTED'){await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,parsed.issues.map(i=>({row:i.row,field:'',code:i.code,status:'FAIL'})));return {jobId:j.id,revisionId:received.job.revisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,issues:parsed.issues,input:null};}
     const failures:DepartmentIssue[]=[];
     const parserIssuesByRow=new Map<number,DepartmentIssue[]>();
     for(const parsedIssue of parsed.issues){
      const cell=parsed.cells.find(candidate=>candidate.sourceRow===parsedIssue.row&&(!parsedIssue.column||candidate.column===parsedIssue.column));
      const failure:DepartmentIssue={row:cell?.row??0,field:cell?.field??'',code:parsedIssue.code,status:'FAIL'};
      if(failure.row===0)failures.push(failure);else parserIssuesByRow.set(failure.row,[...(parserIssuesByRow.get(failure.row)??[]),failure]);
     }
     if(parsed.rows.length!==input.entries.length)failures.push({row:0,field:'',code:'MANIFEST_ROW_MISMATCH',status:'FAIL'});
     const validEntries:StoredStageInput['entries'] = [];
     for(const [i,row] of parsed.rows.entries()){
      const logicalRow=i+1,rowFailures:DepartmentIssue[]=[...(parserIssuesByRow.get(logicalRow)??[])];
      for(const field of ORG04_FIELDS){try{check(RowSchema.properties[field],row[field]);}catch{rowFailures.push({row:logicalRow,field,code:'FIELD_INVALID',status:'FAIL'});}}
      try{validateORG04(row);}catch{if(rowFailures.length===0)rowFailures.push({row:logicalRow,field:'',code:'CLOSED_INPUT_REQUIRED',status:'FAIL'});}
      failures.push(...rowFailures);
      if(rowFailures.length===0){
       const meta=input.entries[i];
       if(meta)validEntries.push({...meta,sourceRow:parsed.cells.find(cell=>cell.row===logicalRow)?.sourceRow??logicalRow,row:validateORG04(row)});
      }
     }
     if(failures.length)await saveValidation(s,actor,j,input.campus,received.artifact.artifactId,parsed,failures);
     if(validEntries.length===0||failures.some(f=>f.row===0))return {jobId:j.id,revisionId:received.job.revisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,issues:failures.map(f=>{const cell=parsed.cells.find(c=>c.row===f.row&&(!f.field||c.field===f.field));return {code:f.code,row:cell?.sourceRow??f.row,column:cell?.column??0};}),input:null};
     const staged:StoredStageInput={requestId:input.requestId,jobId:j.id,revisionId:received.job.revisionId,campus:input.campus,profile:j.profile,timePolicy:'LOCAL',entries:validEntries,sourceArtifactId:received.artifact.artifactId};
     const result=await mutate<{inputId:string;revisionId:string;digest:string}>(s,actor,{operation:'STAGE',...staged,...seal('DEPARTMENT_INPUT_V1',staged)});
     return {jobId:j.id,revisionId:received.job.revisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,issues:failures.map(f=>{const cell=parsed.cells.find(c=>c.row===f.row&&(!f.field||c.field===f.field));return {code:f.code,row:cell?.sourceRow??f.row,column:cell?.column??0};}),input:result};
    }finally{content.fill(0);}
   });
  },
  async readInput(actor:string,input:{inputId:string}){check(Id,input.inputId);return root(async s=>unseal<StoredStageInput>('DEPARTMENT_INPUT_V1',await record(s,actor,input.inputId),StoredStageSchema));},
  async preview(actor:string,input:{inputId:string}){check(Id,input.inputId);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);return {entries:v.input.entries,heads:v.heads,verification:v.verification,issues:v.issues};});},
  async validate(actor:string,input:{inputId:string}){check(Id,input.inputId);return root(async s=>{
   const v=await inspectInput(s,actor,input.inputId);let validationRunId:string|null=null,validationIssues=v.issues;
   if(v.input.sourceArtifactId&&await authorize(s,actor,v.r.campus,'READ')===v.r.identity_code){
    const j=await job(s,actor,v.r.job_id),store=protectedArtifacts(s,provider),bytes=await store.authorizeSensitiveRead(actor,{scope:'SYNTHETIC',campus:v.r.campus,purpose:'IDENTITY_VERIFY',requestId:randomUUID(),artifactId:v.input.sourceArtifactId},{jobId:j.id,revisionId:v.r.job_revision,kind:'RAW_FILE'});
    try{
     const meta=j.revisions.at(-1)!.input;if(meta.kind!=='FILE')throw new Error('FILE_REVISION_REQUIRED');
     const parsed=await boundedParse(bytes,meta.format,v.contract.definition.fields,'STRICT_DEPARTMENT_V1');
     const parserIssues:DepartmentIssue[]=parsed.issues.map(parsedIssue=>{const cell=parsed.cells.find(candidate=>candidate.sourceRow===parsedIssue.row&&(!parsedIssue.column||candidate.column===parsedIssue.column));return {row:cell?.row??parsedIssue.row,field:cell?.field??'',code:parsedIssue.code,status:'FAIL',sourceRow:parsedIssue.row};});
     validationIssues=[...v.issues,...parserIssues];
     validationRunId=(await saveValidation(s,actor,j,v.r.campus,v.input.sourceArtifactId,parsed,validationIssues,new Map(v.input.entries.map((entry,index)=>[index+1,entry.sourceRow])))).run.runId;
    }finally{bytes.fill(0);}
   }
   const decision=validationIssues.some(i=>i.status==='FAIL')?'FAIL' as const:validationIssues.length?'BLOCKED' as const:'PASS' as const;
   return {inputId:v.r.id,digest:v.r.digest,validationRunId,commandCount:v.commands.length,decision,issues:validationIssues.map(({sourceRow:_,...issue})=>issue)};
  });},
  async verify(actor:string,input:VerifyInput){check(VerifySchema,input);return root(async s=>{const r=await record(s,actor,input.inputId,'VERIFY'),raw=unseal<StoredStageInput>('DEPARTMENT_INPUT_V1',r,StoredStageSchema),j=await inputJob(s,actor,r.id),normalizable=new Map<number,ReturnType<typeof normalizeEntry>>();for(const [index,entry] of raw.entries.entries()){try{normalizable.set(index+1,normalizeEntry(entry,raw.timePolicy));}catch{}}if(input.rows.length!==normalizable.size||new Set(input.rows.map(x=>x.row)).size!==input.rows.length||input.rows.some(x=>!normalizable.has(x.row)))throw new Error('CLOSED_INPUT_REQUIRED');for(const row of input.rows){const e=normalizable.get(row.row)!;if(row.historicalException&&(e.origin!=='HISTORICAL'||e.row.established_on&&e.row.establishment_doc.trim()))throw new Error('CLOSED_INPUT_REQUIRED');await evidence(s,actor,row.evidenceId,e,j.contract,r.campus);}return mutate<{verificationId:string}>(s,actor,{operation:'VERIFY',...input,...seal('DEPARTMENT_VERIFICATION_V1',input)});});},
  async plan(actor:string,input:{inputId:string;requestId:string}){check(PlanSchema,input);const r=await root(async s=>{const r=await record(s,actor,input.inputId,'WRITE');if(await authorize(s,actor,r.campus,'WRITE')!==r.identity_code)throw new Error('ACCESS_DENIED');return r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  history,
  async diff(actor:string,input:{id:string;fromVersion:string;toVersion:string}){if(Object.keys(input).some(k=>!['id','fromVersion','toVersion'].includes(k))||![input.fromVersion,input.toVersion].every(v=>/^[1-9][0-9]*$/.test(v)))throw new Error('CLOSED_INPUT_REQUIRED');const h=await history(actor,input.id),before=h.versions.find(v=>String(v.number)===input.fromVersion),after=h.versions.find(v=>String(v.number)===input.toVersion);if(!before||!after)throw new Error('NOT_FOUND');const a={...before.facts,validFrom:stamp(before.valid_from),validTo:before.valid_to&&stamp(before.valid_to)},b={...after.facts,validFrom:stamp(after.valid_from),validTo:after.valid_to&&stamp(after.valid_to)};return {changes:(Object.keys(a) as Array<keyof typeof a>).filter(k=>a[k]!==b[k]).map(field=>({field,before:a[field],after:b[field]}))};},
  async list(actor:string,input:{after?:string;limit?:number;recordAsOf?:string}){if(Object.keys(input).some(k=>!['after','limit','recordAsOf'].includes(k)))throw new Error('CLOSED_INPUT_REQUIRED');if(input.after)check(Id,input.after);const limit=input.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)throw new Error('CLOSED_INPUT_REQUIRED');const at=input.recordAsOf===undefined?null:localTime(input.recordAsOf);return root(async s=>(await sql<{r:string[]}>`select department_master.list(${actor},${input.after??null}::uuid,${limit},${at}::timestamp) r`.execute(s)).rows[0]!.r);},
  async read(actor:string,input:{id:string;businessAt:string;recordAsOf?:string}){check(ReadSchema,input);const at=localTime(input.businessAt),h=await history(actor,input.id,input.recordAsOf),v=h.versions.filter(v=>span(v).from<=at&&(span(v).to===null||span(v).to!>at)).at(-1);return {id:h.id,code:h.code,version:v??null};},
  async coverage(actor:string,input:{id:string;validFrom:string;validTo:string|null;recordAsOf?:string}){check(CoverageSchema,input);const h=await history(actor,input.id,input.recordAsOf),parts=h.versions.flatMap((v,i)=>subtract(span(v),h.versions.slice(i+1).map(span)).map(p=>({...p,versionId:v.id,version:String(v.number)})));return {owner:'department-master' as const,id:h.id,covered:covered(parts,input.validFrom,input.validTo),parts};},
  async exact(actor:string,input:{id:string;version:string;recordAsOf?:string}){if(Object.keys(input).some(k=>!['id','version','recordAsOf'].includes(k))||!/^\d+$/.test(input.version))throw new Error('CLOSED_INPUT_REQUIRED');const h=await history(actor,input.id,input.recordAsOf),v=h.versions.find(v=>String(v.number)===input.version);if(!v)throw new Error('NOT_FOUND');return {owner:'department-master' as const,id:h.id,version:input.version,versionId:v.id,contentDigest:v.content_digest,validFrom:stamp(v.valid_from),validTo:v.valid_to&&stamp(v.valid_to),recordedAt:stamp(v.recorded_at)};},
  close:()=>db.destroy(),
 };
}
