import {assessImpact} from './impact.js';
import {createHmac} from 'node:crypto';
import {sql} from 'kysely';
import {applyCoordinator,type ApplyOwnerPort,type OwnerFact,canonicalPlan,planBinding,authenticateRegistrationEvidence,type KeyProviderPort} from '../../governance-catalog/index.js';
import {localTime,covered,subtract,intersect} from '../time.js';
import {CampusCommandSchema,InputSchema,Id,type CampusCommand,type CampusFacts} from './contracts.js';
import {campusInput,check,type Scope} from './input.js';
export * from './contracts.js';
export type {CampusEvent,CampusSnapshot,CampusReferencePort} from './reader.js';
import {createCampusReader,campusOperationAt,type CampusEvent,type CampusSnapshot} from './reader.js';
export * from './reference-contracts.js';
const stamp=(s:string)=>localTime(s.replace(' ','T'));
export function openCampus(connectionString:string,provider?:KeyProviderPort){
 const store=campusInput(connectionString,provider),{db,root,record,unseal}=store;
 const snapshot=async(scope:Scope,actor:string,id:string)=>(await sql<{r:CampusSnapshot}>`select organization_master.campus_snapshot(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r;
 const normalize=(raw:CampusCommand)=>{const c=structuredClone(raw);c.validFrom=localTime(c.validFrom);c.validTo=c.validTo===null?null:localTime(c.validTo);c.source.recordedAt=localTime(c.source.recordedAt.replace(/\+08:00$/u,''));if(c.validTo!==null&&c.validTo<=c.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');if(c.action==='SCHEDULE_OPENING'){c.plannedOpeningAt=localTime(c.plannedOpeningAt);if(c.plannedOpeningAt<c.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');}if('facts' in c&&c.facts.openingDate)localTime(c.facts.openingDate);if(['SUSPEND','RETIRE','RECORD_DISPOSITION','COMPLETE_DISPOSITION'].includes(c.action)&&c.validTo!==null)throw new Error('CLOSED_INPUT_REQUIRED');return c;};
 const span=(e:CampusEvent)=>({from:stamp(e.valid_from),to:e.valid_to&&stamp(e.valid_to)});
 const effectiveSpans=(e:CampusEvent,all:CampusEvent[])=>subtract(span(e),all.filter(x=>x.number>e.number).map(span));
 const admission=async(scope:Scope,actor:string,c:CampusCommand,s:CampusSnapshot|null)=>{
  const period={from:c.validFrom,to:c.validTo},deps:unknown[]=[];
  const retired=s?.events.find(e=>e.action==='RETIRE');
  if(retired&&!['RECORD_DISPOSITION','COMPLETE_DISPOSITION','CANCEL_OPENING'].includes(c.action)){
   const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
   if(!(c.action==='SUSPEND'&&c.validFrom<stamp(retired.valid_from)&&now<stamp(retired.valid_from))&&(c.action==='RETIRE'||stamp(retired.valid_from)<=now||intersect(span(retired),period).length))throw new Error('CAMPUS_RETIRED');
  }
  if('assessmentDigest' in c){
   const report=await assessImpact(scope,actor,{id:c.target.id,validFrom:c.validFrom,validTo:c.validTo});
   if(report.digest!==c.assessmentDigest)throw new Error('STALE_VALIDATION');
   if(c.action!=='RETIRE'&&(!retired||stamp(retired.valid_from)!==c.validFrom))throw new Error('BLOCKED_DEPENDENCY');
   if(report.completed)throw new Error('DISPOSITION_ALREADY_COMPLETE');
   if(c.action==='RETIRE'&&localTime(c.plan.dueAt)<c.validFrom)throw new Error('INVALID_BUSINESS_PERIOD');
   if(c.action==='COMPLETE_DISPOSITION'){
    if(report.dependencies.some(d=>d.outstanding))throw new Error('DISPOSITION_INCOMPLETE');
    for(const owner of report.unavailable){
     const disposition=report.dispositions.filter(d=>d.owner===owner).at(-1);
     if(!disposition||disposition.status!=='CLEAR'||disposition.dependencyDigest!==report.dependencyDigest)throw new Error('DISPOSITION_INCOMPLETE');
     const raw=unseal(await record(scope,actor,disposition.inputId,'READ_RESTRICTED'));
     const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select organization_master.evidence(${actor},${raw.command.evidence}::uuid,${raw.command.source.systemId}::uuid,${raw.command.source.versionId}::uuid,${s!.scope},${c.validFrom}::timestamp,${c.validTo}::timestamp) r`.execute(scope)).rows[0]!.r;
     const bytes=authenticateRegistrationEvidence(proof,provider);bytes.fill(0);
    }
    const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
    if(c.validFrom>now)throw new Error('DISPOSITION_INCOMPLETE');
   }
   deps.push(report);
  }
  const division=async(f:CampusFacts,from:string,to:string|null,required:boolean)=>{
   if(required&&(!f.campusAddress?.trim()||!f.adminDivision))throw new Error('BLOCKED_DEPENDENCY');
   if(f.adminDivision)deps.push((await sql<{r:unknown}>`select governance_catalog.campus_division(${actor},${JSON.stringify(f.adminDivision)}::jsonb,${from}::timestamp,${to}::timestamp) r`.execute(scope)).rows[0]!.r);
  };
  if('facts' in c){
   if(c.facts.openingDate){const today=(await sql<{today:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD') today`.execute(scope)).rows[0]!.today;if(c.facts.openingDate>today)throw new Error('CLOSED_INPUT_REQUIRED');}
   const running=s?.events.filter(e=>e.state==='RUNNING'||e.state==='TRIAL_RUNNING')??[];
   const operations=s?.events.filter(e=>e.state!==null)??[];
   const required=running.some(e=>effectiveSpans(e,operations).some(p=>intersect(p,period).length));
   await division(c.facts,c.validFrom,c.validTo,required);
  }
  if(c.action==='ACTIVATE'||c.action==='RESUME'){
   const versions=s!.events.filter(e=>e.facts!==null);const spans:Array<{from:string;to:string|null}>=[];
   for(const e of versions)for(const p of effectiveSpans(e,versions).flatMap(p=>intersect(p,period))){await division(e.facts!,p.from,p.to,true);spans.push(p);}
   if(!covered(spans,c.validFrom,c.validTo))throw new Error('BLOCKED_DEPENDENCY');
  }
  if(c.action==='ACTIVATE'||c.action==='SCHEDULE_OPENING'){
   const operations=s!.events.filter(e=>e.state!==null);
   const suspended=operations.filter(e=>e.state==='SUSPENDED');
   if(c.action==='ACTIVATE'&&suspended.length&&!covered(operations.filter(e=>e.action==='RESUME').map(span),c.validFrom,c.validTo))throw new Error('BLOCKED_DEPENDENCY');
   if(suspended.some(e=>effectiveSpans(e,operations).some(p=>intersect(p,period).length)))throw new Error('BLOCKED_DEPENDENCY');
  }
  if(c.action==='RESUME'){
   const operations=s!.events.filter(e=>e.state!==null);
   const stopped=operations.filter(e=>e.state==='SUSPENDED').flatMap(e=>effectiveSpans(e,operations));
   if(!covered(stopped,c.validFrom,c.validTo))throw new Error('BLOCKED_DEPENDENCY');
  }
  return deps;
 };

 const conflict=async(scope:Scope,c:CampusCommand)=>'facts' in c&&(await sql<{r:boolean}>`select organization_master.campus_conflict(${'target' in c?c.target.id:null}::uuid,${c.facts.campusCode}) r`.execute(scope)).rows[0]!.r;
 const port:ApplyOwnerPort={
  async authorize(scope,actor,input,permission){const r=await record(scope,actor,input.jobId,permission);if(permission==='REVIEW')await record(scope,actor,input.jobId,'READ_RESTRICTED');if(r.campus!==input.campus||r.revision!==input.revisionId||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');},
  async observe(scope,actor,input){
   const r=await record(scope,actor,input.jobId);if(r.withdrawn||r.currentRevision!==r.jobRevision||r.revision!==input.revisionId)throw new Error('STALE_VALIDATION');
   const raw=unseal(r);if(raw.profile==='FULL'||raw.dependencies?.length)throw new Error('BLOCKED_DEPENDENCY');const c=normalize(raw.command);
   const heads=r.target?await snapshot(scope,actor,r.target):null;
   let source=null;
   if(c.action!=='SUSPEND'&&c.action!=='RETIRE'&&c.action!=='CANCEL_OPENING'){
    const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select organization_master.evidence(${actor},${c.evidence}::uuid,${c.source.systemId}::uuid,${c.source.versionId}::uuid,${r.campus},${c.validFrom}::timestamp,${c.validTo}::timestamp) r`.execute(scope)).rows[0]!.r;
    const bytes=authenticateRegistrationEvidence(proof,provider);try{source={artifactId:c.evidence,contentDigest:planBinding(provider,'CAMPUS_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
   }
   const dependencies=await admission(scope,actor,c,heads);
   return {input,atomicRule:'CAMPUS_SINGLE_COMMAND_V1',basis:{contract:'ORG02-MANUAL-CORE-V1',inputDigest:r.digest,source,heads,dependencies,...(await conflict(scope,c)?{blockingIssues:['IDENTIFIER_CONFLICT']}:{})},commands:[{owner:'organization-master/campus',row:1,intent:c.action==='CREATE'?'CREATE':'REVISE',target:'target' in c?{owner:c.target.owner,id:c.target.id,version:c.target.expectedVersion}:null,aliases:[],value:{inputId:r.id,command:canonicalPlan(c),original:canonicalPlan(raw.command)}}],diff:[c]};
  },
  async validate(scope,actor,unit,stage){
   const c=JSON.parse(unit.commands[0]!.value['command']!) as CampusCommand;check(CampusCommandSchema,c);
   const r=await record(scope,actor,unit.input.jobId);const s=r.target?await snapshot(scope,actor,r.target):null;
   if('target' in c&&(c.target.id!==r.target||String(s?.events.at(-1)?.number)!==c.target.expectedVersion))throw new Error('STALE_VALIDATION');
   if(!c.source.approvalRef?.trim())throw new Error('APPROVAL_REQUIRED');if(c.source.recordStatus!=='PUBLISHED')throw new Error('BLOCKED_DEPENDENCY');
   if(await conflict(scope,c)&&stage!=='FREEZE')throw new Error('IDENTIFIER_CONFLICT');
   const at=c.validFrom;const current=campusOperationAt(s?.events??[],at)?.state??'NOT_ESTABLISHED';
   const expected=c.action==='CREATE'?'PLANNING':(c.action==='ACTIVATE'||c.action==='RESUME')?c.state:c.action==='SUSPEND'?'SUSPENDED':c.action==='RETIRE'?'RETIRED':current;
   if(c.sourceOperationStatus!==expected)throw new Error('BLOCKED_DEPENDENCY');
  },
  async apply(scope,actor,command,_resolved,approval){
   const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(scope)).rows[0]!.id;
   const c=JSON.parse(command.value['command']!) as CampusCommand;
   let lifecycle:unknown=null;
   if('assessmentDigest' in c){const {digest,dependencyDigest,...report}=await assessImpact(scope,actor,{id:c.target.id,validFrom:c.validFrom,validTo:c.validTo});if(digest!==c.assessmentDigest)throw new Error('STALE_VALIDATION');lifecycle={report,dependencyDigest,...(c.action==='RECORD_DISPOSITION'?{resolution:c.resolution}:{})};}
   const ticket=canonicalPlan({actor,inputId:command.value['inputId'],command:c,candidateId:approval.candidateId,digest:approval.digest,transaction,lifecycle});
   const key=Buffer.from(planBinding(provider,'CAMPUS_SQL_AUTHORITY_V1',{}),'hex');
   try{const signature=createHmac('sha256',key).update(ticket).digest('hex');return {ok:true,fact:(await sql<{r:OwnerFact}>`select organization_master.campus_write_approved(${ticket},${signature}) r`.execute(scope)).rows[0]!.r};}finally{key.fill(0);}
  },
  async exactRead(scope,actor,_input,fact){if(fact.owner!=='organization-master/campus')return null;const s=await snapshot(scope,actor,fact.id);return s.events.some(e=>String(e.number)===fact.version)?fact:null;}
 };
 const coordinator=applyCoordinator(db,provider,port);
 const references=createCampusReader(root,snapshot);

 return {
  assessCampusImpact:(actor:string,input:Parameters<typeof assessImpact>[2])=>root(scope=>assessImpact(scope,actor,input)),
  async inspectCommandInTransaction(scope:Scope,actor:string,raw:CampusCommand){check(CampusCommandSchema,raw);const c=normalize(raw),current='target' in c?await snapshot(scope,actor,c.target.id):null;if(await conflict(scope,c))throw new Error('IDENTIFIER_CONFLICT');return admission(scope,actor,c,current);},
  commandsInTransaction:(scope:Scope)=>({stage:async(actor:string,input:Parameters<typeof store.stage>[1])=>{check(CampusCommandSchema,input.command);normalize(input.command);return store.stageInTransaction(scope,actor,input);},port}),
  async stage(actor:string,input:Parameters<typeof store.stage>[1]){check(CampusCommandSchema,input.command);normalize(input.command);return store.stage(actor,input);},readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async plan(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);const r=await root(async scope=>{await record(scope,actor,input.inputId,'WRITE');return (await sql<{r:Awaited<ReturnType<typeof record>>}>`select organization_master.plan_input_for(${actor},${input.inputId}::uuid,${input.requestId}::uuid,'ORG02') r`.execute(scope)).rows[0]!.r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  async withdraw(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);return root(async scope=>{await record(scope,actor,input.inputId,'WRITE');return (await sql<{r:{inputId:string;status:'WITHDRAWN'}}>`select organization_master.withdraw_for(${actor},${input.inputId}::uuid,${input.requestId}::uuid,'ORG02') r`.execute(scope)).rows[0]!.r;});},
  async readRestrictedInput(actor:string,id:string){check(Id,id);return root(async scope=>unseal(await record(scope,actor,id,'READ_RESTRICTED')));},
  references,
  close:()=>db.destroy(),
 };
}
export type CampusOwner=ReturnType<typeof openCampus>;
