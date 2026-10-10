import {readScopedSource,deferNativeSourceReadAuthority,deferExactReadAuthority} from '../governance-catalog/index.js';
import {trackStagedWindow,diagnoseStagedWindows,checkStagedWindowRequest,type StagedWindowFailure,type StagedWindowRequest} from '../governance-catalog/index.js';
import {readScopedProtectedInput} from '../governance-catalog/index.js';
import {ownerSourceLocation,type OwnerWindowSourceRequest,type OwnerWindowSource} from '../governance-catalog/index.js';
import {withLifecycleLocationInputs,registerLifecycleLocationInputs,lifecycleLocationInput} from './lifecycle-location-inputs.js';
import type {LifecycleDependencyInput,LifecycleDependency} from '../care-organization/index.js';
import {createCipheriv,createDecipheriv,createHmac,randomBytes,randomUUID} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,fileIntake,boundedParse,recordOwnerFileValidation,type ApplyOwnerPort,type OwnerFact,type ImportJob,type ImportContractItem,type KeyProviderPort,type ParserResult,type ValidationEvaluation} from '../governance-catalog/index.js';
import {localTime,covered,intersect,type CampusReferencePort} from '../organization-master/index.js';
import {locationAt,locationPeriods,validateLocationTree} from './tree.js';
import {LocationId,LocationStoredStageSchema,LocationStageSchema,LocationInputSchema,LocationPlanSchema,LocationVerifySchema,LocationReceiveSchema,LocationHistorySchema,LocationReadSchema,LocationListSchema,LocationTreeSchema,LocationExactSchema,LocationWindowSchema,LocationDiffSchema,LocationRowSchema,ORG12_FIELDS,locationCheck,normalizeLocationRow,type LocationStage,type LocationStoredStage,type LocationVerification,type LocationReceive,type LocationEntry,type LocationHistory,type LocationVersion,type LocationFacts,type LocationWrite,type LocationIssue} from './contracts.js';

type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface InputRecord {id:string;revision:string;job_id:string;job_revision:string;identity_code:string;digest:string;campus_id:string;scope:'NORTH'|'SOUTH';envelope:Envelope;verification:null|{id:string;actor:string;identity_code:string;digest:string;envelope:Envelope}}
type Staged={inputId:string;revisionId:string;digest:string};

export function openLocation(connection:string,provider:KeyProviderPort,campuses:CampusReferencePort){
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:Scope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const stamp=(v:string)=>localTime(v.replace(' ','T'));
 const currentReadRoot=root;
 const clock=async(s:Scope)=>s.recordAsOf??(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;
 const histories=async(s:Scope,actor:string,campusId:string)=>(await sql<{r:LocationHistory[]}>`select location_master.read(${actor},${campusId}::uuid) r`.execute(s)).rows[0]!.r;
 const snapshot=async(s:Scope,actor:string,id:string)=>(await sql<{r:LocationHistory}>`select location_master.snapshot(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;
 const record=async(s:Scope,actor:string,id:string,permission='READ_RESTRICTED')=>readScopedProtectedInput(s,permission,JSON.stringify(['LOCATION',actor,id]),async permission=>(await sql<{r:InputRecord}>`select location_master.input_read(${actor},${id}::uuid,${permission}) r`.execute(s)).rows[0]!.r,async r=>{await authorize(s,actor,r.campus_id,r.scope,'READ_RESTRICTED');},async()=>{await root(async current=>{await sql`select location_master.input_read(${actor},${id}::uuid,'READ_RESTRICTED')`.execute(current);});await root(current=>api(work=>work(current)).readInput(actor,{inputId:id}));});
 const job=async(s:Scope,actor:string,id:string)=>(await sql<{r:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:id})}::jsonb) r`.execute(s)).rows[0]!.r;
 const inputJob=async(s:Scope,actor:string,id:string)=>{if(!s.recordAsOf)return (await sql<{r:ImportJob}>`select location_master.job_read(${actor},${id}::uuid) r`.execute(s)).rows[0]!.r;const r=await record(s,actor,id);return (await sql<{r:ImportJob}>`select governance_catalog.import_job_context(${actor},${JSON.stringify({scope:'SYNTHETIC',jobId:r.job_id})}::jsonb) r`.execute(s)).rows[0]!.r;};
 const authorize=async(s:Scope,actor:string,campusId:string,campus:string,permission:string)=>(await sql<{r:string}>`select location_master.authorize(${actor},${campusId}::uuid,${campus},${permission}) r`.execute(s)).rows[0]!.r;
 const sealed=(domain:string,value:unknown)=>{
  const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(domain+'\0'+digest));const bytes=Buffer.from(canonicalPlan(value));
  try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}
 };
 const recoverable=async<T>(s:Scope,work:()=>Promise<T>):Promise<T>=>{
  await sql`savepoint location_dependency`.execute(s);
  try{const value=await work();await sql`release savepoint location_dependency`.execute(s);return value;}
  catch(error){await sql`rollback to savepoint location_dependency`.execute(s);await sql`release savepoint location_dependency`.execute(s);throw error;}
 };
 const unseal=<T>(domain:string,r:{digest:string;envelope:Envelope},schema:unknown):T=>{
  try{const e=r.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(domain+'\0'+r.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);try{const value:unknown=JSON.parse(bytes.toString());locationCheck(schema,value);if(planBinding(provider,domain,value)!==r.digest)throw new Error();return value as T;}finally{bytes.fill(0);}}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 const mutate=async<T>(s:Scope,actor:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{v:string}>`select pg_current_xact_id()::text v`.execute(s)).rows[0]!.v,ticket=canonicalPlan({...value,actor,transaction}),key=Buffer.from(planBinding(provider,'LOCATION_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select location_master.mutate(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const material=async(s:Scope,actor:string,id:string,contract:ImportContractItem,campus:string)=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${contract.definition.sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);try{return {id,digest:planBinding(provider,'LOCATION_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
 };
 const stageIn=async(s:Scope,actor:string,input:LocationStoredStage)=>mutate<Staged>(s,actor,{operation:'STAGE',requestId:input.requestId,jobId:input.jobId,revisionId:input.revisionId,campus:input.campus,campusId:input.campusId,...sealed('LOCATION_INPUT_V1',input)});
 const historicalAccess=async(s:Scope,actor:string,input:LocationStoredStage,contract:ImportContractItem,extraEvidenceIds:readonly string[]=[])=>{
  await campuses.inTransaction(s).history(actor,input.campusId);
  const rows=input.entries.flatMap(entry=>entry.action==='SPLIT'?[entry.row,...entry.successors.map(successor=>successor.row)]:[entry.row]);
  for(const sourceId of new Set(rows.map(row=>row.source_system_id)))await sql`select governance_catalog.location_source(${actor},${sourceId}::uuid,null::timestamp,null::timestamp,false,${contract.definition.sourceVersionId}::uuid)`.execute(s);
  const evidenceIds=input.entries.flatMap(entry=>entry.action==='SPLIT'?[entry.evidenceId,...entry.successors.map(successor=>successor.evidenceId)]:[entry.evidenceId]);
  for(const id of new Set([...evidenceIds,...(input.sourceArtifactId?[input.sourceArtifactId]:[]),...extraEvidenceIds]))await sql`select governance_catalog.registration_evidence_access(${actor},${id}::uuid,${contract.definition.sourceVersionId}::uuid,${input.campus})`.execute(s);
 };
 const inspectInput=async(s:Scope,actor:string,id:string)=>{
  const temporalFailures:StagedWindowFailure[]=[];
  const r=await record(s,actor,id),input=unseal<LocationStoredStage>('LOCATION_INPUT_V1',r,LocationStoredStageSchema),j=await inputJob(s,actor,r.id),c=j.contract;
  if(j.currentRevisionId!==r.job_revision||j.status==='REJECTED')throw new Error('STALE_REVISION');
  const original=await histories(s,actor,r.campus_id),proposed=structuredClone(original),issues:LocationIssue[]=[],writes:LocationWrite[]=[],materials:unknown[]=[],dependencies:unknown[]=[],targets=new Set<string>(),aliases=new Set<string>();
  const verification=r.verification?unseal<LocationVerification>('LOCATION_VERIFICATION_V1',r.verification,LocationVerifySchema):null;
  const issue=(row:number,field:string,code:string,status:LocationIssue['status']='FAIL')=>issues.push({row,field,code,status});
  if(input.profile!=='CORE'||j.profile!=='CORE'||c.dataset!=='ORG12'||c.definition.templateVersion!=='ORG12_CORE_V1'||c.definition.fields.length!==18||ORG12_FIELDS.some(f=>!c.definition.fields.some(x=>x.code===f)))issue(0,'profile','BLOCKED_DEPENDENCY','BLOCKED');
  if(input.timePolicy==='SOURCE_PLUS08_TO_LOCAL'&&!c.definition.rules.some(rule=>rule.id==='LOCATION_SOURCE_PLUS08_V1'&&rule.status==='MACHINE'))issue(0,'timePolicy','BLOCKED_DEPENDENCY','BLOCKED');
  if(!verification?.physicalFactsAccepted)issue(0,'verification','LEGAL_REVIEW_REQUIRED','BLOCKED');
  if(verification){if(verification.inputDigest!==r.digest)throw new Error('STALE_VALIDATION');if(await authorize(s,r.verification!.actor,r.campus_id,r.scope,'VERIFY')!==r.verification!.identity_code)throw new Error('ACCESS_DENIED');materials.push(await material(s,actor,verification.evidenceId,c,r.scope));}
  if(input.sourceArtifactId)materials.push(await material(s,actor,input.sourceArtifactId,c,r.scope));
  const now=await clock(s);
  const add=async(entry:Exclude<LocationEntry,{action:'SPLIT'}>,rowNumber:number,splitKey:string|null=null)=>{
   const target='target' in entry?entry.target:null;
   const e=normalizeLocationRow(entry.row,input.timePolicy),prior=target?original.find(h=>h.id===target.id):undefined,head=prior?.versions.at(-1);
   if(e.row.campus_id!==r.campus_id)throw new Error('LOCATION_CAMPUS_MISMATCH');
   if(target){if(targets.has(target.id))throw new Error('BATCH_CONFLICT');targets.add(target.id);if(!prior)throw new Error('NOT_FOUND');if(prior.campusId!==r.campus_id)throw new Error('LOCATION_CAMPUS_MISMATCH');if(head?.number!==target.expectedVersion)throw new Error('STALE_VALIDATION');if(prior.versions.some(v=>v.action==='CLOSE'))throw new Error('LOCATION_CLOSED');}
   const key=entry.action==='CREATE'?'alias:'+e.row.location_id:target!.id;
   if(entry.action==='CREATE'){if(aliases.has(key))throw new Error('BATCH_CONFLICT');aliases.add(key);}
   const boundary=prior?(locationAt(prior,e.from)??locationPeriods(prior).find(part=>part.to===e.from)?.version):undefined;
   let parentId=(entry.action==='CLOSE'?boundary:entry.action==='REVISE'?boundary??head:head)?.facts.parentId??null;
   if('parent' in entry){parentId=entry.parent===null?null:entry.parent.kind==='ALIAS'?'alias:'+entry.parent.clientKey:entry.parent.reference.id;if(e.row.parent_location_id!==(entry.parent===null?'':entry.parent.kind==='ALIAS'?entry.parent.clientKey:entry.parent.reference.id))throw new Error('REFERENCE_INVALID');}
   else if(e.row.parent_location_id!==(parentId??''))throw new Error('LOCATION_PARENT_IMMUTABLE');
   const facts:LocationFacts={locationCode:e.row.location_code,locationName:e.row.location_name,locationType:e.row.location_type as LocationFacts['locationType'],floorLabel:e.row.floor_label||null,roomNumber:e.row.room_number||null,addressDetail:e.row.address_detail||null,isAccessible:e.row.is_accessible as 'Y'|'N'||null,parentId,source:{sourceAlias:e.row.location_id,sourceVersion:e.row.version_no,sourceSystemId:e.row.source_system_id,sourceRecordedAt:e.sourceRecordedAt,recordLocatorEvidence:{inputId:r.id,row:input.sourceRows?.[rowNumber-1]??rowNumber},recordStatus:e.row.record_status,approvalReference:e.row.approval_ref},contractVersionId:c.versionId,dependencyEvidence:null};
   const closing=entry.action==='CLOSE';
   if(closing){
    if(e.row.record_status!=='RETIRED'||e.to!==null||!head||!locationPeriods(prior!).some(p=>p.from<=e.from&&(p.to===null||e.from<=p.to)))throw new Error('LOCATION_CLOSURE_EXPANSION');
    if(!boundary)throw new Error('LOCATION_CLOSURE_EXPANSION');
    for(const field of ['locationCode','locationName','locationType','floorLabel','roomNumber','addressDetail','isAccessible','parentId'] as const)if(facts[field]!==boundary.facts[field])throw new Error('LOCATION_CLOSURE_EXPANSION');
    facts.dependencyEvidence=boundary.facts.dependencyEvidence;
   }else if(entry.action==='REVISE'&&prior&&locationPeriods(prior).some(part=>intersect({from:part.from,to:part.to},{from:e.from,to:e.to}).length>0&&part.version.facts.parentId!==parentId)){
    throw new Error('LOCATION_PARENT_IMMUTABLE');
   }else{
    if(['DRAFT','REVIEW','SUSPENDED'].includes(e.row.record_status))issue(rowNumber,'record_status','BLOCKED_DEPENDENCY','BLOCKED');
    else if(e.row.record_status!=='ACTIVE')throw new Error('APPROVAL_REQUIRED');
    if(!e.row.approval_ref.trim())throw new Error('APPROVAL_REQUIRED');
    if(e.row.location_type==='OTHER')throw new Error('BLOCKED_DEPENDENCY');
    if(!covered([{from:c.validFrom,to:c.validTo}],e.from,e.to))throw new Error('BLOCKED_DEPENDENCY');
    for(const field of ['location_type','record_status',...(e.row.is_accessible?['is_accessible']:[])] as Array<keyof typeof e.row>){const codes=c.definition.codeSets.find(x=>x.field===field);if(!codes||codes.status!=='SYNTHETIC_ADOPTED'||!codes.codes.includes(e.row[field])||!covered([{from:codes.validFrom,to:codes.validTo}],e.from,e.to))throw new Error('BLOCKED_DEPENDENCY');}
    for(const id of ['SRC-COND-017','SRC-COND-018'])if(!c.definition.rules.some(rule=>rule.id===id&&rule.status==='MACHINE'))throw new Error('BLOCKED_DEPENDENCY');
    const context=await trackStagedWindow(temporalFailures,{row:rowNumber,field:'campus_id',from:e.from,to:e.to,boundaries:()=>recoverable(s,()=>campuses.inTransaction(s).readLocationCampusBoundaries(actor,{id:r.campus_id,validFrom:e.from,validTo:e.to,recordAsOf:now})),evaluate:piece=>recoverable(s,async()=>{const v=await campuses.inTransaction(s).readLocationCampusCoverage(actor,{id:r.campus_id,validFrom:piece.from,validTo:piece.to});if(v.scope!==r.scope)throw new Error('ACCESS_DENIED');if(!v.covered||v.retiredAt!==null&&(piece.to===null||v.retiredAt<piece.to))throw new Error('BLOCKED_DEPENDENCY');return v;})});
    const source=await trackStagedWindow(temporalFailures,{row:rowNumber,field:'source_system_id',from:e.from,to:e.to,boundaries:()=>recoverable(s,async()=>{const spans=(await readScopedSource(s,actor,{operation:'unit_ward_source_windows',id:e.row.source_system_id,validFrom:e.from,validTo:e.to,recordAsOf:now},currentReadRoot,scope=>sql<{r:Array<{from:string;to:string|null}>}>`select governance_catalog.unit_ward_source_windows(${actor},${e.row.source_system_id}::uuid,${e.from}::timestamp,${e.to}::timestamp,${now}::timestamp) r`.execute(scope))).rows[0]!.r;return spans.flatMap(p=>p.to===null?[p.from]:[p.from,p.to]).map(localTime);}),evaluate:piece=>recoverable(s,async()=>(await readScopedSource(s,actor,{operation:'location_source_at',id:e.row.source_system_id,validFrom:piece.from,validTo:piece.to,recordAsOf:now,expectedVersionId:c.definition.sourceVersionId},currentReadRoot,scope=>(s.recordAsOf?sql<{r:unknown}>`select governance_catalog.location_source_at(${actor},${e.row.source_system_id}::uuid,${piece.from}::timestamp,${piece.to}::timestamp,${c.definition.sourceVersionId}::uuid,${now}::timestamp) r`:sql<{r:unknown}>`select governance_catalog.location_source(${actor},${e.row.source_system_id}::uuid,${piece.from}::timestamp,${piece.to}::timestamp,true,${c.definition.sourceVersionId}::uuid) r`).execute(scope))).rows[0]!.r)});
    facts.dependencyEvidence={campus:context,source};dependencies.push(facts.dependencyEvidence);
   }
   materials.push(await material(s,actor,entry.evidenceId,c,r.scope));
   for(const h of original)if(h.id!==key&&h.codes.includes(e.row.location_code))throw new Error('LOCATION_CODE_CONFLICT');
   if(writes.some(w=>w.key!==key&&w.facts.locationCode===facts.locationCode))throw new Error('LOCATION_CODE_CONFLICT');
   const write:LocationWrite={key,targetId:target?.id??null,expectedVersion:target?.expectedVersion??null,action:entry.action,validFrom:e.from,validTo:e.to,facts,reason:entry.reason,sourceRow:input.sourceRows?.[rowNumber-1]??rowNumber,splitKey};writes.push(write);
   const version:LocationVersion={id:'proposed:'+writes.length,number:String(BigInt(head?.number??'0')+1n),action:write.action,validFrom:e.from,validTo:e.to,recordedAt:now,facts,reason:write.reason,changeId:null};
   const h=proposed.find(h=>h.id===key);if(h){h.versions.push(version);h.codes.push(facts.locationCode);}else proposed.push({id:key,campusId:r.campus_id,scope:r.scope,codes:[facts.locationCode],versions:[version]});
  };
  for(const [index,entry] of input.entries.entries()){
   try{await recoverable(s,async()=>{
    if(entry.action==='SPLIT'){
     const predecessor=original.find(h=>h.id===entry.target.id),normalized=normalizeLocationRow(entry.row,input.timePolicy),at=locationAt(predecessor??{id:'',campusId:'',scope:r.scope,codes:[],versions:[]},normalized.from);
     if(!at||!['ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE'].includes(at.facts.locationType))throw new Error('LOCATION_SPLIT_INVALID');
     await add({...entry,action:'CLOSE'},index+1);
     for(const successor of entry.successors){const e=normalizeLocationRow(successor.row,input.timePolicy);if(e.from!==normalized.from||!['ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE'].includes(e.row.location_type)||successor.parent===null||successor.parent.kind!=='EXISTING'||successor.parent.reference.id!==at.facts.parentId)throw new Error('LOCATION_SPLIT_INVALID');await add({action:'CREATE',parent:successor.parent,row:successor.row,evidenceId:successor.evidenceId,reason:entry.reason},index+1,entry.target.id);}
    }else await add(entry,index+1);
   });}catch(error){if(error instanceof Error&&['ACCESS_DENIED','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE'].includes(error.message))throw error;issue(index+1,'',error instanceof Error?error.message:'CLOSED_INPUT_REQUIRED');}
  }
  if(writes.length>100)issue(0,'entries','PLAN_INPUT_LIMIT');
  if(!issues.some(i=>i.status==='FAIL'))try{const points=proposed.flatMap(h=>h.versions.flatMap(v=>v.validTo===null?[v.validFrom]:[v.validFrom,v.validTo]));await trackStagedWindow(temporalFailures,{row:0,field:'parent_location_id',from:points.sort()[0]??now,to:null,boundaries:async()=>points,evaluate:async piece=>validateLocationTree(proposed,undefined,piece)});}catch(error){issue(0,'parent_location_id',error instanceof Error?error.message:'BATCH_REJECTED');}
  if(writes.some(w=>w.action!=='CLOSE')){const active=(await sql<{r:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:'SYNTHETIC',mode:'EFFECTIVE',target:c.id,businessAt:now})}::jsonb) r`.execute(s)).rows[0]!.r;if(active[0]?.versionId!==c.versionId)issue(0,'contract','STALE_VALIDATION','BLOCKED');}
  return {r,input,contract:c,verification,original,issues,writes,materials,dependencies,temporalFailures};
 };
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,permission){const r=await record(s,actor,input.jobId,permission);if(r.revision!==input.revisionId||r.scope!==input.campus||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');await authorize(s,actor,r.campus_id,r.scope,'READ_RESTRICTED');},
  async authorizeApproval(s,actor,input){const r=await record(s,actor,input.jobId,'REVIEW');if(await authorize(s,actor,r.campus_id,r.scope,'REVIEW')===r.identity_code)throw new Error('MAKER_CHECKER_REQUIRED');},
  async authorizeFrozen(s,actor,unit){const input=unit.basis['input'];locationCheck(LocationStoredStageSchema,input);const materials=unit.basis['materials'];if(!Array.isArray(materials))throw new Error('INVALID_PLAN_TOKEN');const ids=materials.map(material=>{if(typeof material!=='object'||material===null||!('id' in material))throw new Error('INVALID_PLAN_TOKEN');locationCheck(LocationId,material.id);return material.id as string;});const context=await inputJob(s,actor,unit.input.jobId);await historicalAccess(s,actor,input as LocationStoredStage,context.contract,ids);},
  async observe(s,actor,input){const v=await inspectInput(s,actor,input.jobId);return {input,atomicRule:'ORG12_WHOLE_TREE_REVISION_V1',basis:{inputDigest:v.r.digest,input:v.input,contract:v.contract,verificationId:v.r.verification?.id??null,verificationDigest:v.r.verification?.digest??null,issues:v.issues,heads:v.original,materials:v.materials,dependencies:v.dependencies},commands:v.writes.map((w,index)=>({owner:'location-master',row:index+1,intent:w.action==='CREATE'?'CREATE' as const:'REVISE' as const,target:w.targetId?{owner:'location-master',id:w.targetId,version:w.expectedVersion!}:null,aliases:[],value:{inputId:v.r.id,...(index===0?{writes:canonicalPlan(v.writes)}:{}),writeIndex:String(index+1),writesDigest:planBinding(provider,'LOCATION_WRITES_V1',v.writes)}})),diff:v.writes.map(w=>({action:w.action,targetId:w.targetId,name:w.facts.locationName,from:w.validFrom,to:w.validTo}))};},
  async validate(_s,_actor,unit,stage){const issues=unit.basis['issues'] as LocationIssue[];if(stage==='FREEZE'&&issues.length&&issues.every(i=>i.code==='BLOCKED_DEPENDENCY'&&['profile','record_status'].includes(i.field)))return;if(issues.length||!unit.commands.length)throw new Error(issues[0]?.code??'BATCH_REJECTED');},
  async afterFreeze(s,actor,unit,candidate){const value=unit.commands[0]?.value;if(!value)throw new Error('BATCH_REJECTED');await mutate(s,actor,{operation:'FREEZE',inputId:value['inputId'],writes:JSON.parse(value['writes']!),writesDigest:value['writesDigest'],...candidate});},
  async apply(s,actor,command,_resolved,approval){return {ok:true,fact:await mutate<OwnerFact>(s,actor,{operation:'APPLY',inputId:command.value['inputId'],writes:JSON.parse(command.value['writes']??'[]'),writeIndex:Number(command.value['writeIndex']),writesDigest:command.value['writesDigest'],...approval})};},
  async exactRead(s,actor,_input,fact){if(fact.owner!=='location-master')return null;return (await snapshot(s,actor,fact.id)).versions.some(v=>v.number===fact.version)?fact:null;},
 };
 const coordinator=applyCoordinator(db,provider,port),files=fileIntake(db,provider);
 const historyIn=async(s:Scope,actor:string,id:string,recordAsOf?:string)=>{const h=await snapshot(s,actor,id);if(recordAsOf){h.versions=h.versions.filter(v=>v.recordedAt<=localTime(recordAsOf));h.codes=[...new Set(h.versions.map(v=>v.facts.locationCode))];}if(!h.versions.length)throw new Error('NOT_FOUND');return h;};
 const candidateHistoriesIn=async(s:Scope,actor:string,inputId:string)=>{
   const v=await inspectInput(s,actor,inputId);if(v.issues.length)throw new Error(v.issues[0]!.code);
   return Promise.all(v.writes.map(async w=>{const h:LocationHistory=w.targetId?await historyIn(s,actor,w.targetId,s.recordAsOf):{id:w.key,campusId:v.input.campusId,scope:v.r.scope,versions:[],codes:[]};
    if(w.targetId&&h.versions.at(-1)?.number!==w.expectedVersion)throw new Error('STALE_VALIDATION');
    const projected:LocationHistory={...h,versions:[...h.versions,{id:'candidate:'+inputId,number:String(BigInt(h.versions.at(-1)?.number??'0')+1n),action:w.action,validFrom:w.validFrom,validTo:w.validTo,recordedAt:s.recordAsOf??await clock(s),facts:w.facts,reason:w.reason,changeId:'candidate'}]};
    return projected;}));
 };
 const candidateHistoryIn=async(s:Scope,actor:string,id:string,r?:string)=>{for(const inputId of s.readCareCandidateInputIds('LOCATION')){const h=(await candidateHistoriesIn(s,actor,inputId)).find(h=>h.id===id);if(h)return h;}return historyIn(s,actor,id,r);};
 const candidateUseViewIn=async(s:Scope,actor:string,input:{id:string;campusId:string;validFrom:string;validTo:string|null;recordAsOf:string})=>{
  const ids=s.readCareCandidateInputIds('LOCATION');if(!ids.length)return null;
  const r=localTime(input.recordAsOf),from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo),all=(await histories(s,actor,input.campusId)).map(h=>({...h,versions:h.versions.filter(v=>v.recordedAt<=r)})),candidateInputs=[];
  for(const inputId of ids){const proposed=await candidateHistoriesIn(s,actor,inputId);for(const h of proposed){if(h.campusId!==input.campusId)continue;const index=all.findIndex(existing=>existing.id===h.id);if(index<0)all.push(h);else all[index]=h;}candidateInputs.push(await api(root).lifecycleReferenceInTransaction(s,actor,inputId));}
  const target=all.find(h=>h.id===input.id);if(!target)throw new Error('NOT_FOUND');if(target.campusId!==input.campusId)throw new Error('LOCATION_CAMPUS_MISMATCH');
  const points=[from,...all.flatMap(h=>h.versions.flatMap(v=>[v.validFrom,...(v.validTo?[v.validTo]:[])])),...await campuses.inTransaction(s).readLocationCampusBoundaries(actor,{id:input.campusId,validFrom:from,validTo:to,recordAsOf:r})],sources=new Map<string,{id:string;from:string;to:string|null}>();
  const starts=[...new Set(points.map(localTime).filter(point=>point>=from&&(to===null||point<to)))].sort();
  for(const[index,start]of starts.entries()){let id:string|null=input.id;const visited=new Set<string>();while(id!==null){if(visited.has(id))throw new Error('LOCATION_CYCLE');visited.add(id);const h=all.find(h=>h.id===id),v=h?locationAt(h,start,r):null;if(!v)break;const source={id:v.facts.source.sourceSystemId,from:start,to:starts[index+1]??to};sources.set(canonicalPlan(source),source);id=v.facts.parentId;}}
  for(const source of sources.values()){const spans=(await readScopedSource(s,actor,{operation:'use_source_windows',id:source.id,validFrom:source.from,validTo:source.to,recordAsOf:r},currentReadRoot,scope=>sql<{r:Array<{from:string;to:string|null}>}>`select governance_catalog.use_source_windows(${actor},${source.id}::uuid,${source.from}::timestamp,${source.to}::timestamp,${r}::timestamp) r`.execute(scope))).rows[0]!.r;points.push(...spans.flatMap(span=>[span.from,...(span.to?[span.to]:[])]));}
  return {all,from,to,r,candidateInputs,points:[...new Set(points.map(localTime).filter(point=>point>=from&&(to===null||point<to)))].sort()};
 };
 const candidateUseWindowIn=async(s:Scope,actor:string,input:Parameters<typeof candidateUseViewIn>[2])=>{
  const view=await candidateUseViewIn(s,actor,input);if(!view)return null;const parts=[];
  const campus=await campuses.inTransaction(s).readLocationCampusCoverage(actor,{id:input.campusId,validFrom:view.from,validTo:view.to});if(!campus.covered||campus.retiredAt!==null&&(view.to===null||campus.retiredAt<view.to))throw new Error('BLOCKED_DEPENDENCY');
  for(const[index,from]of view.points.entries()){const to=view.points[index+1]??view.to,graph=[],chain=[];let id:string|null=input.id;const visited=new Set<string>();
   while(id!==null){if(visited.has(id))throw new Error('LOCATION_CYCLE');visited.add(id);const h=view.all.find(h=>h.id===id);if(!h||h.campusId!==input.campusId)throw new Error('LOCATION_CAMPUS_MISMATCH');const v=locationAt(h,from,view.r);if(!v)throw new Error('LOCATION_WINDOW_NOT_COVERED');if(id===input.id&&!['ROOM','CLINIC_ROOM','OPERATING_ROOM','WAREHOUSE','DISPENSING_WINDOW'].includes(v.facts.locationType))throw new Error('LOCATION_TYPE_INVALID');chain.push(h);const source=(await readScopedSource(s,actor,{operation:'use_source_coverage',id:v.facts.source.sourceSystemId,validFrom:from,validTo:to,recordAsOf:view.r},currentReadRoot,scope=>sql<{r:unknown}>`select governance_catalog.use_source_coverage(${actor},${v.facts.source.sourceSystemId}::uuid,${from}::timestamp,${to}::timestamp,${view.r}::timestamp) r`.execute(scope))).rows[0]!.r;graph.push({id:h.id,versionId:v.id,version:v.number,type:v.facts.locationType,parentId:v.facts.parentId,source});id=v.facts.parentId;}
   validateLocationTree(chain,view.r,{from,to});parts.push({from,to,graph});
  }
  if(!covered(parts,view.from,view.to))throw new Error('LOCATION_WINDOW_NOT_COVERED');return {id:input.id,campusId:input.campusId,parts,campus,candidateInputs:view.candidateInputs};
 };
 type Root=typeof root;
 const api=(root:Root)=>({
  async diagnoseStagedWindowInTransaction(s:Scope,actor:string,input:StagedWindowRequest){checkStagedWindowRequest(input);if(!s.recordAsOf)throw new Error('READ_CONTEXT_REQUIRED');const v=await inspectInput(s,actor,input.inputId);if(v.r.revision!==input.revisionId||v.r.digest!==input.digest||v.contract.versionId!==input.contractVersionId)throw new Error('STALE_VALIDATION');return diagnoseStagedWindows(v.temporalFailures,v.issues,{from:localTime(input.validFrom),to:input.validTo===null?null:localTime(input.validTo)});},
  lifecyclePort:port,
  async candidatePeriodsInTransaction(s:Scope,actor:string,inputId:string){
   return (await candidateHistoriesIn(s,actor,inputId)).map(h=>({parts:locationPeriods(h).map(p=>({from:p.from,to:p.to}))}));
  },
  lifecycleWithInputsInTransaction:withLifecycleLocationInputs,
  lifecycleRegisterInputsInTransaction:registerLifecycleLocationInputs,
  async lifecycleStateInTransaction(s:Scope,actor:string,input:{id:string;businessAt?:string;recordAsOf?:string}){const h=await historyIn(s,actor,input.id,input.recordAsOf),at=input.businessAt?localTime(input.businessAt):await clock(s);return {id:h.id,head:h.versions.at(-1)!.number,state:locationAt(h,at)?'ACTIVE':h.versions.some(v=>v.action==='CLOSE'&&v.validFrom<=at)?'CLOSED':'NOT_EFFECTIVE'};},
  async readLifecycleDependenciesInTransaction(s:Scope,actor:string,input:LifecycleDependencyInput){return (await sql<{r:LifecycleDependency[]}>`select location_master.lifecycle_dependencies(${actor},${input.kind},${input.id}::uuid,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;},
  async lifecycleReferenceInTransaction(s:Scope,actor:string,inputId:string){const r=await record(s,actor,inputId);const j=await inputJob(s,actor,inputId);return {inputId:r.id,revisionId:r.revision,digest:r.digest,contractVersionId:j.contract.versionId,makerIdentity:r.identity_code,campus:r.scope};},
  async authorizeUseReferenceInTransaction(s:Scope,actor:string,input:{id:string;campusId:string}){const h=await snapshot(s,actor,input.id);return {scope:h.scope};},
  async evaluateUseWindowInTransaction(s:Scope,actor:string,input:{id:string;campusId:string;validFrom:string;validTo:string|null;recordAsOf:string}){const candidate=await candidateUseWindowIn(s,actor,input);if(candidate)return candidate;const accepted=(await sql<{r:unknown}>`select location_master.use_location_window(${actor},${input.id}::uuid,${input.campusId}::uuid,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;deferNativeSourceReadAuthority(s,actor,accepted,'LOCATION',currentReadRoot);return lifecycleLocationInput(s,input,accepted)??accepted;},
  async readUseBoundariesInTransaction(s:Scope,actor:string,input:{id:string;campusId:string;validFrom:string;validTo:string|null;recordAsOf:string}){const candidate=await candidateUseViewIn(s,actor,input);if(candidate)return candidate.points;const points=(await sql<{r:string[]}>`select location_master.use_location_boundaries(${actor},${input.id}::uuid,${input.campusId}::uuid,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;if(s.recordAsOf){const references=(await sql<{r:unknown}>`select location_master.care_boundary_source_references(${actor},${input.id}::uuid,${input.campusId}::uuid,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;deferExactReadAuthority(s,actor,references,currentReadRoot);}return points;},
  async stage(actor:string,input:LocationStage){locationCheck(LocationStageSchema,input);input=structuredClone(input);return root(s=>stageIn(s,actor,input));},
  async readInput(actor:string,input:{inputId:string}){locationCheck(LocationInputSchema,input);return root(async s=>{const value=unseal<LocationStoredStage>('LOCATION_INPUT_V1',await record(s,actor,input.inputId),LocationStoredStageSchema),context=await inputJob(s,actor,input.inputId);await historicalAccess(s,actor,value,context.contract);return value;});},
  async verify(actor:string,input:LocationVerification){locationCheck(LocationVerifySchema,input);input=structuredClone(input);return root(async s=>{const r=await record(s,actor,input.inputId,'VERIFY'),j=await inputJob(s,actor,r.id);await material(s,actor,input.evidenceId,j.contract,r.scope);return mutate<{verificationId:string}>(s,actor,{operation:'VERIFY',inputId:input.inputId,inputDigest:input.inputDigest,requestId:input.requestId,...sealed('LOCATION_VERIFICATION_V1',input)});});},
  async preview(actor:string,input:{inputId:string}){locationCheck(LocationInputSchema,input);return root(async s=>{const v=await inspectInput(s,actor,input.inputId);return {decision:v.issues.length?'BLOCKED' as const:'PASS' as const,issues:v.issues,changes:v.writes.map(w=>({action:w.action,targetId:w.targetId,name:w.facts.locationName,validFrom:w.validFrom,validTo:w.validTo}))};});},
  async plan(actor:string,input:{inputId:string;requestId:string}){locationCheck(LocationPlanSchema,input);const r=await root(async s=>{const r=await record(s,actor,input.inputId,'WRITE');if(await authorize(s,actor,r.campus_id,r.scope,'WRITE')!==r.identity_code)throw new Error('ACCESS_DENIED');return r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.scope,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async receiveFile(actor:string,input:LocationReceive,bytes:Uint8Array){
   locationCheck(LocationReceiveSchema,input);input=structuredClone(input);if(input.job.input.kind!=='FILE'||input.job.input.parserPolicy!=='STRICT_LOCATION_V1')throw new Error('CLOSED_FILE_REQUIRED');
   if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>1048576)throw new Error('CLOSED_FILE_REQUIRED');
   const snapshotBytes=Buffer.from(bytes);bytes=snapshotBytes;
   try{
   await root(s=>authorize(s,actor,input.campusId,input.campus,'WRITE'));
   const received=await files.receiveFile(actor,{job:input.job,fileRequestId:input.fileRequestId,extension:input.job.input.format==='CSV'?'.csv':input.job.input.format==='JSON'?'.json':'.xlsx',campus:input.campus,purpose:'IDENTITY_VERIFY',retentionSeconds:input.retentionSeconds},bytes);
   return await root(async s=>{
    const j=await job(s,actor,received.job.id),parsed=await boundedParse(bytes,input.job.input.kind==='FILE'?input.job.input.format:'JSON',j.contract.definition.fields,'STRICT_LOCATION_V1');
    const issues:LocationIssue[]=parsed.issues.map(i=>({row:i.row,field:ORG12_FIELDS[i.column-1]??'',code:i.code,status:'FAIL'}));let staged:Staged|null=null;
    if(parsed.structuralStatus==='PARSED'&&parsed.rows.length===input.operations.length&&!issues.length){
     try{const entries=input.operations.map((operation,index)=>({...operation,row:parsed.rows[index]!}));const value={requestId:input.requestId,jobId:j.id,revisionId:j.currentRevisionId,campus:input.campus,campusId:input.campusId,profile:j.profile,timePolicy:input.timePolicy,entries,sourceArtifactId:received.artifact.artifactId,sourceRows:parsed.rows.map((_,index)=>parsed.cells.find(c=>c.row===index+1)?.sourceRow??index+2)};locationCheck(LocationStoredStageSchema,value);staged=await recoverable(s,()=>stageIn(s,actor,value as LocationStoredStage));}catch(error){issues.push({row:0,field:'',code:error instanceof Error?error.message:'CLOSED_INPUT_REQUIRED',status:'FAIL'});}
    }else if(parsed.rows.length!==input.operations.length)issues.push({row:0,field:'operations',code:'BATCH_CONFLICT',status:'FAIL'});
    const evaluation:ValidationEvaluation={decision:issues.length?'FAIL':'BLOCKED',issues:issues.length?issues.map(i=>({rule:'ORG12_'+i.code,layer:2,row:i.row,field:i.field,status:'FAIL',code:i.code})):[{rule:'ORG12_PHYSICAL_REVIEW',layer:7,row:0,field:'',status:'UNKNOWN',code:'LEGAL_REVIEW_REQUIRED'}],layers:[{layer:1,status:parsed.structuralStatus==='PARSED'?'PASS':'FAIL'},{layer:2,status:issues.length?'FAIL':'UNKNOWN'}],evidenceRequirements:[],dependencies:[],interpretationPolicy:'EXACT_TEXT_V1'};
    const validation=await recordOwnerFileValidation(s,provider,actor,{jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId:received.artifact.artifactId,campus:input.campus,requestId:randomUUID(),parseRequestId:randomUUID(),outputRequestId:randomUUID(),contractVersionId:j.contract.versionId,ruleVersion:j.contract.definition.ruleVersion,parserPolicy:'STRICT_LOCATION_V1',structuralStatus:parsed.structuralStatus,parsed:{sourceArtifactId:received.artifact.artifactId,result:parsed},evaluation});
    return {jobId:j.id,revisionId:j.currentRevisionId,sourceArtifactId:received.artifact.artifactId,structuralStatus:parsed.structuralStatus,input:staged,issues,validation};
   });
   }finally{snapshotBytes.fill(0);}
  },
  async history(actor:string,input:{id:string;recordAsOf?:string}){locationCheck(LocationHistorySchema,input);return root(s=>historyIn(s,actor,input.id,input.recordAsOf));},
  async read(actor:string,input:{id:string;businessAt?:string;recordAsOf?:string}){locationCheck(LocationReadSchema,input);return root(async s=>{const h=await historyIn(s,actor,input.id,input.recordAsOf),at=input.businessAt?localTime(input.businessAt):await clock(s);return {id:h.id,campusId:h.campusId,head:h.versions.at(-1)!.number,state:locationAt(h,at)?'ACTIVE' as const:h.versions.some(v=>v.action==='CLOSE'&&v.validFrom<=at)?'CLOSED' as const:'NOT_EFFECTIVE' as const,version:locationAt(h,at)};});},
  async exact(actor:string,input:{id:string;version:string;recordAsOf?:string}){locationCheck(LocationExactSchema,input);return root(async s=>{const h=await historyIn(s,actor,input.id,input.recordAsOf),v=h.versions.find(v=>v.number===input.version);if(!v)throw new Error('NOT_FOUND');return v;});},
  async diff(actor:string,input:{id:string;fromVersion:string;toVersion:string}){locationCheck(LocationDiffSchema,input);return root(async s=>{const h=await historyIn(s,actor,input.id),before=h.versions.find(v=>v.number===input.fromVersion),after=h.versions.find(v=>v.number===input.toVersion);if(!before||!after)throw new Error('NOT_FOUND');return {id:h.id,before,after};});},
  async list(actor:string,input:{campusId:string;after?:string;limit?:number;businessAt?:string;recordAsOf?:string}){locationCheck(LocationListSchema,input);return root(async s=>{const at=input.businessAt?localTime(input.businessAt):await clock(s),all=(await histories(s,actor,input.campusId)).filter(h=>(!input.after||h.id>input.after)&&(!input.recordAsOf||h.versions.some(v=>v.recordedAt<=localTime(input.recordAsOf!)))),page=all.slice(0,input.limit??50);return {items:page.map(h=>({id:h.id,campusId:h.campusId,version:locationAt(h,at,input.recordAsOf)})),nextAfterId:all.length>page.length?page.at(-1)!.id:null};});},
  async tree(actor:string,input:{campusId:string;businessAt?:string;recordAsOf?:string}){locationCheck(LocationTreeSchema,input);return root(async s=>{const hs=await histories(s,actor,input.campusId),at=input.businessAt?localTime(input.businessAt):await clock(s);validateLocationTree(hs,input.recordAsOf);return {campusId:input.campusId,businessAt:at,items:hs.flatMap(h=>{const v=locationAt(h,at,input.recordAsOf);return v?[{id:h.id,version:v}]:[];})};});},
  async coverage(actor:string,input:{id:string;validFrom:string;validTo:string|null;recordAsOf?:string}){locationCheck(LocationWindowSchema,input);const from=localTime(input.validFrom),to=input.validTo===null?null:localTime(input.validTo);if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return root(async s=>{const h=await candidateHistoryIn(s,actor,input.id,input.recordAsOf),parts=locationPeriods(h).flatMap(p=>intersect(p,{from,to}).map(span=>({...span,version:p.version.number,versionId:p.version.id})));return {id:h.id,covered:covered(parts,from,to),parts};});},
  async readChange(actor:string,input:{id:string}){locationCheck(LocationHistorySchema,input);return root(async s=>(await sql<{r:{id:string;results:OwnerFact[];splits:Array<{predecessorId:string;predecessorVersion:string;predecessorVersionId:string;predecessorHeadVersion:string;successorId:string;effectiveAt:string;sourceRow:number}>;recordedAt:string}}>`select location_master.read_change(${actor},${input.id}::uuid) r`.execute(s)).rows[0]!.r);},
  async close(){await db.destroy();},
 });
 return {...api(root),async readValidationSourcesInTransaction(s:Scope,actor:string,input:OwnerWindowSourceRequest):Promise<OwnerWindowSource[]>{const h=await candidateHistoryIn(s,actor,input.id,input.recordAsOf),window={from:localTime(input.validFrom),to:input.validTo===null?null:localTime(input.validTo)};return locationPeriods(h).flatMap(p=>intersect(p,window).map(part=>({...part,versionId:p.version.id,version:p.version.number,...p.version.facts.source.recordLocatorEvidence})));},async sourceLocationInTransaction(s:Scope,actor:string,input:{inputId:string;row:number|null;physical?:boolean}){const value=await api(work=>work(s)).readInput(actor,{inputId:input.inputId});return ownerSourceLocation(value,await inputJob(s,actor,input.inputId),input.row,'ORG12',input.physical);},inTransaction(s:Scope){const scoped=api(work=>work(s));return {stage:(...args:Parameters<typeof scoped.stage>)=>{if(s.recordAsOf)throw new Error('READ_CONTEXT_WRITE_FORBIDDEN');return scoped.stage(...args);},readInput:scoped.readInput,preview:scoped.preview,history:scoped.history,read:scoped.read,list:scoped.list,coverage:scoped.coverage,exact:scoped.exact,diff:scoped.diff,tree:scoped.tree};}};
}
