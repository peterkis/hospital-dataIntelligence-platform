import {createHash,createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {Pool,types} from 'pg';
import {Kysely,PostgresDialect,sql} from 'kysely';
import type {DB} from '../../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,type ApplyOwnerPort,type OwnerFact,type ImportJob,type ImportContractItem,type KeyProviderPort} from '../../governance-catalog/index.js';
import {openOperatingRelations,openCampus,localTime,covered,intersect,subtract} from '../../organization-master/index.js';
import {projectImpactReference,type DepartmentImpactContext} from './department-impact.js';
import type {DepartmentAssessment,ImpactReference} from './department-impact-contracts.js';
import {EVOLUTION_IMPACT_DOMAINS} from './organization-evolution-contracts.js';
import type {DepartmentHistory,DepartmentReplacement} from './index.js';
import type {EvolutionStoredStageInput} from './organization-evolution-contracts.js';
import {DepartmentLifecycleStageSchema,DepartmentLifecycleVerifySchema,DepartmentAdmissionSchema,DepartmentLifecycleReadSchema,DepartmentLifecycleHistorySchema,DepartmentLifecycleInputSchema,DepartmentLifecyclePlanSchema,DepartmentRelationListSchema,DepartmentRelationDiffSchema,lifecycleCheck,type DepartmentLifecycleStageInput,type DepartmentLifecycleVerifyInput,type DepartmentAdmissionInput} from './department-lifecycle-contracts.js';

type Scope=CatalogTransactionScope;
type Span={from:string;to:string|null};
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface Verification {id:string;actor:string;identity_code:string;digest:string;envelope:Envelope}
interface InputRecord {id:string;revision:string;job_id:string;job_revision:string;maker:string;identity_code:string;digest:string;campus:'NORTH'|'SOUTH';department_ids:string[];envelope:Envelope;verification:Verification|null}
interface LifecycleVersion {id:string;department_id:string;number:string;action:'SUSPEND'|'RESUME'|'DEPRECATE';effective_at:string;recorded_at:string;operation_id:string}
interface RelationVersion {id:string;relation_id:string;number:string;action:string;services:string[];valid_from:string;valid_to:string|null;recorded_at:string;operation_id:string;dependencies:unknown}
interface Relation {id:string;department_id:string;campus_id:string;subject_id:string;governance_scope:'NORTH'|'SOUTH';versions:RelationVersion[]}
interface Snapshot {department:DepartmentHistory;lifecycle:LifecycleVersion[];relations:Relation[];replacement:DepartmentReplacement|null}
interface RelationWrite {kind:'RELATION';departmentId:string;campusId:string;subjectId:string;relationId:string|null;expectedVersion:string|null;action:'ASSIGN'|'REVISE'|'END'|'MOVE_SOURCE'|'MOVE_TARGET';services:string[];validFrom:string;validTo:string|null;dependencies:unknown}
interface LifecycleWrite {kind:'LIFECYCLE';departmentId:string;action:'SUSPEND'|'RESUME'|'DEPRECATE';effectiveAt:string}
type Write=RelationWrite|LifecycleWrite;
const stamp=(value:string)=>localTime(value.replace(' ','T'));
const span=(value:RelationVersion):Span=>({from:stamp(value.valid_from),to:value.valid_to===null?null:stamp(value.valid_to)});
const cleanSnapshot=(value:Snapshot):Snapshot=>({...value,lifecycle:value.lifecycle.map(v=>({...v,number:String(v.number),effective_at:stamp(v.effective_at),recorded_at:stamp(v.recorded_at)})),relations:value.relations.map(r=>({...r,versions:r.versions.map(v=>({...v,number:String(v.number),valid_from:stamp(v.valid_from),valid_to:v.valid_to===null?null:stamp(v.valid_to),recorded_at:stamp(v.recorded_at)}))}))});

export function openDepartmentLifecycle(connection:string,provider?:KeyProviderPort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:new Pool({connectionString:connection,max:4,options:'-c timezone=Asia/Shanghai',types:{getTypeParser:(oid,format)=>oid===1114?(v:string)=>v:types.getTypeParser(oid,format)}})})});
 const operating=openOperatingRelations(connection,provider),campuses=openCampus(connection,provider);
 const root=<T>(work:(s:Scope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const record=async(s:Scope,actor:string,id:string,permission='READ')=>(await sql<{r:InputRecord}>`select department_master.lifecycle_input_read(${actor},${id}::uuid,${permission}) r`.execute(s)).rows[0]!.r;
 const snapshot=async(s:Scope,actor:string,id:string,asOf?:string)=>{
  const state=cleanSnapshot((await sql<{r:Snapshot}>`select department_master.lifecycle_snapshot(${actor},${id}::uuid,${asOf??null}::timestamp) r`.execute(s)).rows[0]!.r);
  if(asOf)state.department.versions=state.department.versions.filter(v=>stamp(v.recorded_at)<=asOf);
  if(asOf&&state.department.versions.length===0)throw new Error('NOT_FOUND');
  for(const relation of state.relations){await authorize(s,actor,relation.governance_scope,'READ');await campuses.references.inTransaction(s).resolveCampusReference(actor,{references:[{owner:'organization-master/campus',id:relation.campus_id}]});await sql`select organization_master.operating_pair(${actor},${relation.subject_id}::uuid,${relation.campus_id}::uuid,'RELATION')`.execute(s);}
  return state;
 };
 const authorize=async(s:Scope,actor:string,campus:string,permission:string)=>(await sql<{r:string}>`select department_master.lifecycle_authorize(${actor},${campus},${permission}) r`.execute(s)).rows[0]!.r;
 const seal=(domain:string,value:unknown)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(domain+'\0'+digest));const bytes=Buffer.from(canonicalPlan(value));
  try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}
 };
 // Authentication covers both the immutable raw command and its independent review.
 const protect=seal;
 const unseal=<T>(domain:string,value:{digest:string;envelope:Envelope},schema:unknown):T=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');try{const e=value.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+value.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const result:unknown=JSON.parse(bytes.toString());lifecycleCheck(schema,result);if(planBinding(provider,domain,result)!==value.digest)throw new Error();return result as T;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const mutate=async<T>(s:Scope,actor:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select department_master.lifecycle_mutate(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const readAdmission=async(s:Scope,actor:string,input:DepartmentAdmissionInput)=>{
  lifecycleCheck(DepartmentAdmissionSchema,input);const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo),asOf=input.recordAsOf===undefined?null:localTime(input.recordAsOf);
  return (await sql<{r:{owner:'department-master';id:string;covered:boolean;parts:Span[]}}>`select department_master.lifecycle_admission(${actor},${input.id}::uuid,${from}::timestamp,${to}::timestamp,${asOf}::timestamp) r`.execute(s)).rows[0]!.r;
 };
 const referenceAccess=async(s:Scope,actor:string,input:DepartmentLifecycleStageInput)=>{
  await authorize(s,actor,input.campus,'READ_RESTRICTED');
  for(const c of input.commands){
   await snapshot(s,actor,c.department.id);
   const endpoints=c.action==='ASSIGN'?[{campus:c.campus,subject:c.subject}]:c.action==='MOVE'?[c.destination]:[];
   if('relation' in c){const state=await snapshot(s,actor,c.department.id),r=state.relations.find(r=>r.id===c.relation.id);if(!r||r.governance_scope!==input.campus)throw new Error('ACCESS_DENIED');endpoints.push({campus:{owner:'organization-master/campus',id:r.campus_id},subject:{owner:'organization-master',id:r.subject_id}});}
   for(const endpoint of endpoints){await campuses.references.inTransaction(s).resolveCampusReference(actor,{references:[endpoint.campus]});await sql`select organization_master.operating_pair(${actor},${endpoint.subject.id}::uuid,${endpoint.campus.id}::uuid,'RELATION')`.execute(s);}
  }
 };
 const material=async(s:Scope,actor:string,id:string,job:ImportJob,campus:string)=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${job.contract.definition.sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);try{return {id,digest:planBinding(provider,'DEPARTMENT_LIFECYCLE_MATERIAL_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const impactContext=async(s:Scope,actor:string,id:string):Promise<DepartmentImpactContext>=>{
  const r=await record(s,actor,id),input=unseal<DepartmentLifecycleStageInput>('DEPARTMENT_LIFECYCLE_INPUT_V1',r,DepartmentLifecycleStageSchema);await referenceAccess(s,actor,input);
  const first=input.commands[0]!;
  const changeType:DepartmentAssessment['changeType']=first.action==='SUSPEND'||first.action==='RESUME'||first.action==='DEPRECATE'?first.action:first.action==='MOVE'?'MOVE_SCOPE':'CAMPUS_RELATION';
  const effectiveAt=localTime(first.action==='END'?first.validTo!:'effectiveAt' in first?first.effectiveAt:first.validFrom);
  return {inputId:r.id,inputDigest:r.digest,profile:input.profile,campus:r.campus,departmentIds:r.department_ids,effectiveAt,changeType};
 };
 const inspect=async(s:Scope,actor:string,id:string)=>{
  const r=await record(s,actor,id),input=unseal<DepartmentLifecycleStageInput>('DEPARTMENT_LIFECYCLE_INPUT_V1',r,DepartmentLifecycleStageSchema);
  await referenceAccess(s,actor,input);
  const job=(await sql<{r:ImportJob}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:r.job_id})}::jsonb) r`.execute(s)).rows[0]!.r;
  if(job.currentRevisionId!==r.job_revision||job.profile!=='CORE'||input.profile!=='CORE')throw new Error('BLOCKED_DEPENDENCY');
  const verification=r.verification?unseal<DepartmentLifecycleVerifyInput>('DEPARTMENT_LIFECYCLE_VERIFICATION_V1',r.verification,DepartmentLifecycleVerifySchema):null;
  if(!verification?.policyApproved||!verification.materialsAccepted)throw new Error('LEGAL_REVIEW_REQUIRED');
  if(verification.inputDigest!==r.digest)throw new Error('STALE_VALIDATION');
  if(await authorize(s,r.verification!.actor,r.campus,'VERIFY')!==r.verification!.identity_code)throw new Error('ACCESS_DENIED');
  await referenceAccess(s,r.verification!.actor,input);
  const states=new Map<string,Snapshot>(),materials:unknown[]=[],writes:Write[]=[],dependencies:unknown[]=[];
  for(const id of r.department_ids)states.set(id,await snapshot(s,actor,id));
  const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;
  const policy=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:job.contract.id,businessAt:now})}::jsonb) r`.execute(s)).rows[0]!.r[0];
  if(!policy||policy.versionId!==job.contract.versionId)throw new Error('STALE_VALIDATION');
  if(policy.status!=='PUBLISHED'||policy.dataset!=='ORG04'||policy.profile!=='CORE'||policy.definition.templateVersion!=='ORG04_CORE_V1')throw new Error('BLOCKED_DEPENDENCY');
  const points=input.commands.map(c=>localTime(c.action==='END'?c.validTo!:'effectiveAt' in c?c.effectiveAt:c.validFrom));
  const kinds=input.commands.map(c=>['SUSPEND','RESUME','DEPRECATE'].includes(c.action)?c.action:c.action==='MOVE'?'MOVE_SCOPE':'CAMPUS_RELATION');
  if(new Set(points).size!==1||new Set(kinds).size!==1)throw new Error('BATCH_CONFLICT');
  if(policy.validFrom>points[0]!||policy.validTo!==null&&points[0]!>=policy.validTo)throw new Error('BLOCKED_DEPENDENCY');
  const requireOperating=async(subjectId:string,campusId:string,services:string[],period:Span)=>{
   const observation=await operating.evaluateOperatingWindowInTransaction(s,actor,{subject:{owner:'organization-master',id:subjectId},campus:{owner:'organization-master/campus',id:campusId},services,validFrom:period.from,validTo:period.to});
   const {observedAt:_,asOf:__,...basis}=observation;if(observation.status!=='SATISFIED')throw new Error('LICENSE_PERIOD_NOT_COVERED');dependencies.push(basis);return basis;
  };
  const requireDepartment=async(id:string,period:Span)=>{if(!(await readAdmission(s,actor,{id,validFrom:period.from,validTo:period.to})).covered)throw new Error('UNSUPPORTED_STATE_TRANSITION');};
  const touched=new Set<string>();
  for(const rawCommand of input.commands){
   const c=structuredClone(rawCommand);
   const state=states.get(c.department.id)!,head=String(state.department.versions.at(-1)?.number??0),life=state.lifecycle.at(-1);
   if(head!==c.department.expectedVersion||String(life?.number??0)!==c.department.expectedLifecycleHead)throw new Error('STALE_VALIDATION');
   materials.push(await material(s,actor,c.evidenceId,job,r.campus));await material(s,r.verification!.actor,c.evidenceId,job,r.campus);
   if('effectiveAt' in c)c.effectiveAt=localTime(c.effectiveAt);if('validFrom' in c){c.validFrom=localTime(c.validFrom);c.validTo=c.validTo===null?null:localTime(c.validTo);if(c.validTo!==null&&c.validTo<=c.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');}
   if(c.action==='SUSPEND'||c.action==='RESUME'||c.action==='DEPRECATE'){
    if(touched.has('L:'+c.department.id))throw new Error('BATCH_CONFLICT');touched.add('L:'+c.department.id);
    const terminal=state.replacement?stamp(state.replacement.effective_at):state.lifecycle.find(v=>v.action==='DEPRECATE')?.effective_at;
    if(terminal&&(terminal<=now||c.effectiveAt>=terminal))throw new Error('UNSUPPORTED_STATE_TRANSITION');
    const at=state.lifecycle.filter(v=>v.effective_at<=c.effectiveAt).at(-1);
    if(c.action==='RESUME'){
     if(at?.action!=='SUSPEND')throw new Error('UNSUPPORTED_STATE_TRANSITION');
     for(const rel of state.relations){const v=rel.versions.at(-1)!;for(const part of intersect(span(v),{from:c.effectiveAt,to:terminal??null}))await requireOperating(rel.subject_id,rel.campus_id,v.services,part);}
    }else if(c.action==='SUSPEND'&&at?.action==='SUSPEND')throw new Error('UNSUPPORTED_STATE_TRANSITION');
    writes.push({kind:'LIFECYCLE',departmentId:c.department.id,action:c.action,effectiveAt:c.effectiveAt});continue;
   }
   if(c.action==='ASSIGN'){
    await requireDepartment(c.department.id,{from:c.validFrom,to:c.validTo});
    const basis=await requireOperating(c.subject.id,c.campus.id,c.services,{from:c.validFrom,to:c.validTo});
    writes.push({kind:'RELATION',departmentId:c.department.id,campusId:c.campus.id,subjectId:c.subject.id,relationId:null,expectedVersion:null,action:'ASSIGN',services:c.services,validFrom:c.validFrom,validTo:c.validTo,dependencies:basis});continue;
   }
   if(!('relation' in c))throw new Error('CLOSED_INPUT_REQUIRED');
   if(touched.has(c.relation.id))throw new Error('BATCH_CONFLICT');touched.add(c.relation.id);
   const rel=state.relations.find(r=>r.id===c.relation.id)!,prior=rel.versions.at(-1)!;
   if(prior.number!==c.relation.expectedVersion)throw new Error('STALE_VALIDATION');
   if(['END','MOVE_SOURCE'].includes(prior.action))throw new Error('OPERATING_CLOSED');
   const base={kind:'RELATION' as const,departmentId:c.department.id,campusId:rel.campus_id,subjectId:rel.subject_id,relationId:rel.id,expectedVersion:prior.number,dependencies:prior.dependencies};
   if(c.action==='MOVE'){
    if(c.destination.campus.id===rel.campus_id||c.services.some(x=>!prior.services.includes(x))||c.effectiveAt<=prior.valid_from||prior.valid_to!==null&&c.effectiveAt>=prior.valid_to)throw new Error('CLOSED_INPUT_REQUIRED');
    await requireDepartment(c.department.id,{from:c.effectiveAt,to:prior.valid_to});
    const targetBasis=await requireOperating(c.destination.subject.id,c.destination.campus.id,c.services,{from:c.effectiveAt,to:prior.valid_to});
    writes.push({...base,action:'MOVE_SOURCE',services:prior.services,validFrom:prior.valid_from,validTo:c.effectiveAt});
    const remaining=prior.services.filter(x=>!c.services.includes(x));if(remaining.length)writes.push({...base,relationId:null,expectedVersion:null,action:'ASSIGN',services:remaining,validFrom:c.effectiveAt,validTo:prior.valid_to});
    writes.push({...base,campusId:c.destination.campus.id,subjectId:c.destination.subject.id,relationId:null,expectedVersion:null,action:'MOVE_TARGET',services:c.services,validFrom:c.effectiveAt,validTo:prior.valid_to,dependencies:targetBasis});continue;
   }
   const shrinking=c.services.every(x=>prior.services.includes(x))&&c.validFrom>=prior.valid_from&&(prior.valid_to===null||c.validTo!==null&&c.validTo<=prior.valid_to);
   if(c.action==='END'&&(!shrinking||c.validFrom!==prior.valid_from||canonicalPlan(c.services)!==canonicalPlan(prior.services)||c.validTo===null||prior.valid_to!==null&&c.validTo>=prior.valid_to))throw new Error('CLOSED_INPUT_REQUIRED');
   if(!shrinking){await requireDepartment(c.department.id,{from:c.validFrom,to:c.validTo});base.dependencies=await requireOperating(rel.subject_id,rel.campus_id,c.services,{from:c.validFrom,to:c.validTo});}
   writes.push({...base,action:c.action,services:c.services,validFrom:c.validFrom,validTo:c.validTo});
  }
  for(const write of writes)if(write.kind==='RELATION'){const versions=states.get(write.departmentId)!.department.versions;const departmentParts=versions.flatMap((v,i)=>subtract({from:stamp(v.valid_from),to:v.valid_to===null?null:stamp(v.valid_to)},versions.slice(i+1).map(x=>({from:stamp(x.valid_from),to:x.valid_to===null?null:stamp(x.valid_to)}))).flatMap(p=>intersect(p,{from:write.validFrom,to:write.validTo})).map(p=>({...p,versionId:v.id,version:String(v.number)})));const prior=write.dependencies as {operating?:unknown};write.dependencies={operating:prior?.operating??write.dependencies,departmentParts};}
  if(writes.length>100)throw new Error('PLAN_INPUT_LIMIT');
  // Only implemented Owner references are evaluated. Unavailable domains remain explicit.
  const references=(await sql<{r:ImpactReference[]}>`select department_master.impact_references(${actor},${JSON.stringify(r.department_ids)}::jsonb,${r.campus}) r`.execute(s)).rows[0]!.r;
  if(references.length>2000)throw new Error('PLAN_INPUT_LIMIT');
  const context=await impactContext(s,actor,id);
  for(const ref of references)projectImpactReference(ref,context.effectiveAt,context.changeType,states.get(ref.departmentId)?.replacement?stamp(states.get(ref.departmentId)!.replacement!.effective_at):null);
  if(new Set(input.impacts.map(i=>i.domain)).size!==9||new Set(verification.impactReviews.map(i=>i.domain)).size!==9||input.impacts.some(i=>i.determination==='UNKNOWN'||i.determination==='AFFECTED'&&!i.requiredAction.trim())||verification.impactReviews.some(i=>!i.ownerAttestationAccepted||!i.dispositionAccepted))throw new Error('BLOCKED_DEPENDENCY');
  for(const impact of input.impacts){materials.push(await material(s,actor,impact.evidenceId,job,r.campus));await material(s,r.verification!.actor,impact.evidenceId,job,r.campus);}
  if(references.some(ref=>ref.owner!=='CAMPUS_RELATION'&&ref.constraint==='UNSATISFIED'&&!input.impacts.some(i=>i.domain===ref.owner&&i.determination==='AFFECTED')))throw new Error('IMPACT_DECLARATION_CONFLICT');
  const contentBase={target:{kind:'INPUT' as const,id:r.id},departmentIds:[...r.department_ids].sort(),inputId:r.id,inputDigest:r.digest,campus:r.campus,changeType:context.changeType,effectiveAt:context.effectiveAt,ruleVersion:'DEPARTMENT_IMPACT_V1' as const,coverage:[...(['SOURCE_MAPPING','IDENTIFIER','HIERARCHY','CAMPUS_RELATION'] as const).map(owner=>({owner,status:'EVALUATED' as const,reason:'OWNER_AVAILABLE' as const})),...(['PERSONNEL','BUSINESS_UNIT','WARD','PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER'] as const).map(owner=>({owner,status:'NOT_EVALUABLE' as const,reason:'OWNER_NOT_IMPLEMENTED' as const}))],references};
  const content={...contentBase,dependencyDigest:createHash('sha256').update(canonicalPlan(contentBase)).digest('hex')};
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({actor,transaction,operation:'LIFECYCLE_ASSESS',campus:r.campus,assessment:content}),key=Buffer.from(planBinding(provider,'DEPARTMENT_SQL_AUTHORITY_V1',{}),'hex');
  let reference:{id:string;digest:string};try{reference=(await sql<{r:{id:string;digest:string}}>`select governance_catalog.department_lifecycle_assessment(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
  const assessment={reference,content,binding:{contractVersionId:job.contract.versionId,sourceVersionId:job.contract.definition.sourceVersionId,impacts:input.impacts,materials}};
  return {r,input,verification,states:[...states.values()],materials,writes,dependencies,assessment};
 };
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,permission){const r=await record(s,actor,input.jobId,permission);if(r.revision!==input.revisionId||r.campus!==input.campus)throw new Error('ACCESS_DENIED');},
  async authorizeApproval(s,actor,input){const r=await record(s,actor,input.jobId,'REVIEW');if(await authorize(s,actor,r.campus,'REVIEW')===r.identity_code)throw new Error('MAKER_CHECKER_REQUIRED');},
  async authorizeFrozen(s,actor,unit){const input=unit.basis['rawInput'] as DepartmentLifecycleStageInput;await referenceAccess(s,actor,input);const r=await record(s,actor,unit.input.jobId);const job=(await sql<{r:ImportJob}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:r.job_id})}::jsonb) r`.execute(s)).rows[0]!.r;for(const id of new Set([...input.commands.map(c=>c.evidenceId),...input.impacts.map(i=>i.evidenceId)]))await sql`select governance_catalog.registration_evidence_access(${actor},${id}::uuid,${job.contract.definition.sourceVersionId}::uuid,${r.campus})`.execute(s);const assessment=unit.basis['assessment'] as {content:DepartmentAssessment}|undefined;for(const reference of assessment?.content.references??[])await sql`select department_master.impact_reference_access(${actor},${JSON.stringify(reference)}::jsonb,${r.campus})`.execute(s);},
  async observe(s,actor,input){
   await sql`savepoint lifecycle_observation`.execute(s);
   try{const v=await inspect(s,actor,input.jobId);await sql`release savepoint lifecycle_observation`.execute(s);return {input,atomicRule:'DEPARTMENT_LIFECYCLE_WHOLE_UNIT_V1',basis:{rawInput:v.input,inputDigest:v.r.digest,verificationId:v.r.verification!.id,verification:v.verification,states:v.states,materials:v.materials,dependencies:v.dependencies,assessment:v.assessment,issues:[]},commands:[{owner:'department-master/lifecycle',row:1,intent:'REVISE' as const,target:null,aliases:[],value:{inputId:v.r.id,writes:canonicalPlan(v.writes),assessment:canonicalPlan(v.assessment)}}],diff:v.writes};}
   catch(error){await sql`rollback to savepoint lifecycle_observation`.execute(s);await sql`release savepoint lifecycle_observation`.execute(s);if(!(error instanceof Error)||!['LICENSE_PERIOD_NOT_COVERED','UNSUPPORTED_STATE_TRANSITION','BLOCKED_DEPENDENCY','LEGAL_REVIEW_REQUIRED','STALE_VALIDATION','IMPACT_DECLARATION_CONFLICT'].includes(error.message))throw error;
    const r=await record(s,actor,input.jobId),raw=unseal<DepartmentLifecycleStageInput>('DEPARTMENT_LIFECYCLE_INPUT_V1',r,DepartmentLifecycleStageSchema);await referenceAccess(s,actor,raw);
    return {input,atomicRule:'DEPARTMENT_LIFECYCLE_WHOLE_UNIT_V1',basis:{rawInput:raw,inputDigest:r.digest,issues:[{code:error.message}]},commands:[{owner:'department-master/lifecycle',row:1,intent:'REVISE' as const,target:null,aliases:[],value:{inputId:r.id,writes:'[]',assessment:'{}'}}],diff:[]};
   }
  },
  async validate(_s,_actor,unit,stage){if(stage==='FREEZE')return;const issues=unit.basis['issues'] as Array<{code:string}>;if(issues.length)throw new Error(issues[0]!.code);},
  async apply(s,actor,command,_resolved,approval){const writes=JSON.parse(command.value['writes']!),assessment=JSON.parse(command.value['assessment']!);return {ok:true,fact:await mutate<OwnerFact>(s,actor,{operation:'APPLY',inputId:command.value['inputId'],writes,assessment,contentDigest:planBinding(provider,'DEPARTMENT_LIFECYCLE_RESULT_V1',{writes,assessment}),...approval})};},
  async exactRead(s,actor,input,fact){await record(s,actor,input.jobId);const result=(await sql<{r:boolean}>`select department_master.lifecycle_result_exists(${actor},${fact.id}::uuid) r`.execute(s)).rows[0]!.r;return result?fact:null;},
 };
 const coordinator=applyCoordinator(db,provider,port);
 const evolutionCampusAccess=async(s:Scope,actor:string,input:EvolutionStoredStageInput)=>{
  for(const c of input.campusChanges??[]){
   if(c.action==='END'){const state=await snapshot(s,actor,c.departmentId);if(!state.relations.some(r=>r.id===c.relation.id&&r.governance_scope===input.campus))throw new Error('ACCESS_DENIED');}
   else {await campuses.references.inTransaction(s).resolveCampusReference(actor,{references:[c.campus]});await sql`select organization_master.operating_pair(${actor},${c.subject.id}::uuid,${c.campus.id}::uuid,'RELATION')`.execute(s);if(c.department.owner==='department-master')await snapshot(s,actor,c.department.id);}
  }
 };
 return {
  authorizeEvolutionCampusChangesInTransaction:evolutionCampusAccess,
  async inspectEvolutionCampusChangesInTransaction(s:Scope,actor:string,input:EvolutionStoredStageInput){
   await evolutionCampusAccess(s,actor,input);const at=localTime(input.event.effective_at),writes:unknown[]=[],seen=new Set<string>();
   for(const c of input.campusChanges??[]){
    if(c.action==='END'){
     if(!input.predecessors.some(p=>p.id===c.departmentId)||seen.has(c.relation.id))throw new Error('BATCH_CONFLICT');seen.add(c.relation.id);
     const state=await snapshot(s,actor,c.departmentId),relation=state.relations.find(r=>r.id===c.relation.id)!,prior=relation.versions.at(-1)!;
     if(prior.number!==c.relation.expectedVersion)throw new Error('STALE_VALIDATION');
     if(['END','MOVE_SOURCE'].includes(prior.action)||at<=prior.valid_from||prior.valid_to!==null&&at>=prior.valid_to)throw new Error('CLOSED_INPUT_REQUIRED');
     writes.push({kind:'RELATION',departmentId:c.departmentId,departmentAlias:null,relationId:relation.id,expectedVersion:prior.number,campusId:relation.campus_id,subjectId:relation.subject_id,action:'END',services:prior.services,validFrom:prior.valid_from,validTo:at,dependencies:prior.dependencies});
    }else{
     const validTo=c.validTo===null?null:localTime(c.validTo);if(validTo!==null&&validTo<=at)throw new Error('CLOSED_INPUT_REQUIRED');
     let departmentId:string|null=null,departmentAlias:string|null=null,parts:unknown[]=[];
     if(c.department.owner==='department-master/evolution-successor'){
      departmentAlias=c.department.alias;const successor=input.successors.find(e=>e.row.org_id===departmentAlias);if(!successor||!covered([{from:localTime(successor.row.valid_from),to:successor.row.valid_to?localTime(successor.row.valid_to):null}],at,validTo))throw new Error('BLOCKED_DEPENDENCY');
     }else{
      departmentId=c.department.id;if(input.event.change_type!=='RENAME'||!input.predecessors.some(p=>p.id===departmentId))throw new Error('UNSUPPORTED_STATE_TRANSITION');await readAdmission(s,actor,{id:departmentId,validFrom:at,validTo});if(!(await readAdmission(s,actor,{id:departmentId,validFrom:at,validTo})).covered)throw new Error('UNSUPPORTED_STATE_TRANSITION');
     }
     const observation=await operating.evaluateOperatingWindowInTransaction(s,actor,{subject:c.subject,campus:c.campus,services:c.services,validFrom:at,validTo});if(observation.status!=='SATISFIED')throw new Error('LICENSE_PERIOD_NOT_COVERED');const {observedAt:_,asOf:__,...operatingBasis}=observation;
     writes.push({kind:'RELATION',departmentId,departmentAlias,relationId:null,expectedVersion:null,campusId:c.campus.id,subjectId:c.subject.id,action:'ASSIGN',services:c.services,validFrom:at,validTo,dependencies:{operating:operatingBasis,departmentParts:parts}});
    }
   }return writes;
  },
  async stage(actor:string,input:DepartmentLifecycleStageInput){lifecycleCheck(DepartmentLifecycleStageSchema,input);input=structuredClone(input);return root(async s=>{await authorize(s,actor,input.campus,'WRITE');await referenceAccess(s,actor,input);if(input.profile!=='CORE')throw new Error('BLOCKED_DEPENDENCY');return mutate<{inputId:string;revisionId:string;digest:string}>(s,actor,{operation:'STAGE',...input,departmentIds:[...new Set(input.commands.map(c=>c.department.id))],...protect('DEPARTMENT_LIFECYCLE_INPUT_V1',input)});});},
  async verify(actor:string,input:DepartmentLifecycleVerifyInput){lifecycleCheck(DepartmentLifecycleVerifySchema,input);input=structuredClone(input);return root(async s=>{const r=await record(s,actor,input.inputId,'VERIFY'),raw=unseal<DepartmentLifecycleStageInput>('DEPARTMENT_LIFECYCLE_INPUT_V1',r,DepartmentLifecycleStageSchema);await referenceAccess(s,actor,raw);const job=(await sql<{r:ImportJob}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:r.job_id})}::jsonb) r`.execute(s)).rows[0]!.r;for(const c of raw.commands)await material(s,actor,c.evidenceId,job,r.campus);return mutate<{verificationId:string}>(s,actor,{operation:'VERIFY',...input,...protect('DEPARTMENT_LIFECYCLE_VERIFICATION_V1',input)});});},
  async plan(actor:string,input:{inputId:string;requestId:string}){lifecycleCheck(DepartmentLifecyclePlanSchema,input);const r=await root(async s=>{const r=await record(s,actor,input.inputId,'WRITE');if(await authorize(s,actor,r.campus,'WRITE')!==r.identity_code)throw new Error('MAKER_CHECKER_REQUIRED');return r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  async readInput(actor:string,input:{inputId:string}){lifecycleCheck(DepartmentLifecycleInputSchema,input);return root(async s=>{const r=await record(s,actor,input.inputId),raw=unseal<DepartmentLifecycleStageInput>('DEPARTMENT_LIFECYCLE_INPUT_V1',r,DepartmentLifecycleStageSchema);await referenceAccess(s,actor,raw);const job=(await sql<{r:ImportJob}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:r.job_id})}::jsonb) r`.execute(s)).rows[0]!.r;for(const id of new Set([...raw.commands.map(c=>c.evidenceId),...raw.impacts.map(i=>i.evidenceId)]))await sql`select governance_catalog.registration_evidence_access(${actor},${id}::uuid,${job.contract.definition.sourceVersionId}::uuid,${r.campus})`.execute(s);return raw;});},
  async history(actor:string,input:{id:string;recordAsOf?:string}){lifecycleCheck(DepartmentLifecycleHistorySchema,input);return root(s=>snapshot(s,actor,input.id,input.recordAsOf===undefined?undefined:localTime(input.recordAsOf)));},
  async read(actor:string,input:{id:string;businessAt:string;recordAsOf?:string}){lifecycleCheck(DepartmentLifecycleReadSchema,input);const at=localTime(input.businessAt),state=await root(s=>snapshot(s,actor,input.id,input.recordAsOf===undefined?undefined:localTime(input.recordAsOf))),v=state.lifecycle.filter(v=>v.effective_at<=at).at(-1),terminal=state.lifecycle.find(v=>v.action==='DEPRECATE'&&v.effective_at<=at);return {...state,businessState:state.replacement&&stamp(state.replacement.effective_at)<=at?'SUPERSEDED' as const:terminal?'DEPRECATED' as const:v?.action==='SUSPEND'?'SUSPENDED' as const:!state.department.versions.some(v=>stamp(v.valid_from)<=at&&(v.valid_to===null||at<stamp(v.valid_to)))?'NOT_EFFECTIVE' as const:'ACTIVE' as const};},
  async listRelations(actor:string,input:{id:string;businessAt:string;recordAsOf?:string;campusId?:string;afterId?:string;limit:number}){lifecycleCheck(DepartmentRelationListSchema,input);const at=localTime(input.businessAt),state=await root(s=>snapshot(s,actor,input.id,input.recordAsOf===undefined?undefined:localTime(input.recordAsOf)));const items=state.relations.filter(r=>{const v=r.versions.at(-1)!;return (!input.campusId||r.campus_id===input.campusId)&&(!input.afterId||r.id>input.afterId)&&v.valid_from<=at&&(v.valid_to===null||at<v.valid_to);}).sort((a,b)=>a.id.localeCompare(b.id));return {items:items.slice(0,input.limit),nextAfterId:items.length>input.limit?items[input.limit-1]!.id:null};},
  async diffRelation(actor:string,input:{departmentId:string;relationId:string;fromVersion:string;toVersion:string}){lifecycleCheck(DepartmentRelationDiffSchema,input);const state=await root(s=>snapshot(s,actor,input.departmentId)),relation=state.relations.find(r=>r.id===input.relationId);if(!relation)throw new Error('NOT_FOUND');const before=relation.versions.find(v=>v.number===input.fromVersion),after=relation.versions.find(v=>v.number===input.toVersion);if(!before||!after)throw new Error('NOT_FOUND');return {relation,before,after};},
  readAdmissionWindow:(actor:string,input:DepartmentAdmissionInput)=>root(s=>readAdmission(s,actor,input)),
  readAdmissionWindowInTransaction:readAdmission,
  impactContextInTransaction:impactContext,
  async impactEvidenceInTransaction(s:Scope,actor:string,id:string,evidenceId:string,admission:boolean){const r=await record(s,actor,id),job=(await sql<{r:ImportJob}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:r.job_id})}::jsonb) r`.execute(s)).rows[0]!.r;if(!admission){await sql`select governance_catalog.registration_evidence_access(${actor},${evidenceId}::uuid,${job.contract.definition.sourceVersionId}::uuid,${r.campus})`.execute(s);return '';}return (await material(s,actor,evidenceId,job,r.campus)).digest;},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async close(){await operating.close();await campuses.close();await db.destroy();},
 };
}
