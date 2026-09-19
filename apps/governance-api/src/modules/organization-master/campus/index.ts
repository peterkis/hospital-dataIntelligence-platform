import {sql} from 'kysely';
import {applyCoordinator,type ApplyOwnerPort,type OwnerFact,canonicalPlan,planBinding,authenticateRegistrationEvidence,type KeyProviderPort} from '../../governance-catalog/index.js';
import {localTime,covered,subtract,intersect} from '../time.js';
import {CampusCommandSchema,CampusReadSchema,CampusListSchema,CampusVersionSchema,CampusDiffSchema,InputSchema,Id,type CampusCommand,type CampusFacts} from './contracts.js';
import {campusInput,check,type Scope} from './input.js';
export * from './contracts.js';
export interface CampusEvent {id:string;number:number;action:CampusCommand['action'];valid_from:string;valid_to:string|null;recorded_at:string;input_id:string;facts:CampusFacts|null;state:'PLANNING'|'TRIAL_RUNNING'|'RUNNING'|'SUSPENDED'|null;planned_opening_at:string|null}
export interface CampusSnapshot {id:string;scope:string;events:CampusEvent[]}
const stamp=(s:string)=>localTime(s.replace(' ','T'));
export function openCampus(connectionString:string,provider?:KeyProviderPort){
 const store=campusInput(connectionString,provider),{db,root,record,unseal}=store;
 const snapshot=async(scope:Scope,actor:string,id:string)=>(await sql<{r:CampusSnapshot}>`select organization_master.campus_snapshot(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r;
 const normalize=(raw:CampusCommand)=>{const c=structuredClone(raw);c.validFrom=localTime(c.validFrom);c.validTo=c.validTo===null?null:localTime(c.validTo);c.source.recordedAt=localTime(c.source.recordedAt.replace(/\+08:00$/u,''));if(c.validTo!==null&&c.validTo<=c.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');if(c.action==='SCHEDULE_OPENING'){c.plannedOpeningAt=localTime(c.plannedOpeningAt);if(c.plannedOpeningAt<c.validFrom)throw new Error('CLOSED_INPUT_REQUIRED');}if('facts' in c&&c.facts.openingDate)localTime(c.facts.openingDate);if(c.action==='SUSPEND'&&c.validTo!==null)throw new Error('CLOSED_INPUT_REQUIRED');return c;};
 const span=(e:CampusEvent)=>({from:stamp(e.valid_from),to:e.valid_to&&stamp(e.valid_to)});
 const effectiveSpans=(e:CampusEvent,all:CampusEvent[])=>subtract(span(e),all.filter(x=>x.number>e.number).map(span));
 const admission=async(scope:Scope,actor:string,c:CampusCommand,s:CampusSnapshot|null)=>{
  const period={from:c.validFrom,to:c.validTo},deps:unknown[]=[];
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
  if(c.action==='ACTIVATE'){
   const versions=s!.events.filter(e=>e.facts!==null);const spans:Array<{from:string;to:string|null}>=[];
   for(const e of versions)for(const p of effectiveSpans(e,versions).flatMap(p=>intersect(p,period))){await division(e.facts!,p.from,p.to,true);spans.push(p);}
   if(!covered(spans,c.validFrom,c.validTo))throw new Error('BLOCKED_DEPENDENCY');
  }
  if(c.action==='ACTIVATE'||c.action==='SCHEDULE_OPENING'){
   if(s!.events.some(e=>e.state==='SUSPENDED'&&intersect(span(e),period).length))throw new Error('BLOCKED_DEPENDENCY');
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
   if(c.action!=='SUSPEND'&&c.action!=='CANCEL_OPENING'){
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
   const at=c.validFrom;const current=s?.events.filter(e=>e.state!==null&&stamp(e.valid_from)<=at&&(e.valid_to===null||at<stamp(e.valid_to))).at(-1)?.state??'NOT_ESTABLISHED';
   const expected=c.action==='CREATE'?'PLANNING':c.action==='ACTIVATE'?c.state:c.action==='SUSPEND'?'SUSPENDED':current;
   if(c.sourceOperationStatus!==expected)throw new Error('BLOCKED_DEPENDENCY');
  },
  async apply(scope,actor,command){return {ok:true,fact:(await sql<{r:OwnerFact}>`select organization_master.campus_write(${actor},${command.value['inputId']}::uuid,${command.value['command']}::jsonb) r`.execute(scope)).rows[0]!.r};},
  async exactRead(scope,actor,_input,fact){if(fact.owner!=='organization-master/campus')return null;const s=await snapshot(scope,actor,fact.id);return s.events.some(e=>String(e.number)===fact.version)?fact:null;}
 };
 const coordinator=applyCoordinator(db,provider,port);
 const publicEvent=(e:CampusEvent)=>({version:String(e.number),versionId:e.id,action:e.action,validFrom:stamp(e.valid_from),validTo:e.valid_to&&stamp(e.valid_to),recordedAt:stamp(e.recorded_at)});
 const history=async(actor:string,id:string)=>{check(Id,id);const s=await root(scope=>snapshot(scope,actor,id));return {id:s.id,head:String(s.events.at(-1)!.number),versions:s.events.filter(e=>e.facts!==null).map(e=>({...publicEvent(e),facts:e.facts!})),plans:s.events.filter(e=>['SCHEDULE_OPENING','CANCEL_OPENING'].includes(e.action)).map(e=>({...publicEvent(e),plannedOpeningAt:e.planned_opening_at&&stamp(e.planned_opening_at)})),operations:s.events.filter(e=>e.state!==null).map(e=>({...publicEvent(e),state:e.state!}))};};

 const read=async(actor:string,input:{id:string;businessAt?:string;asOf?:string})=>{
  check(CampusReadSchema,input);
  return root(async scope=>{
   const s=await snapshot(scope,actor,input.id);const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
   const at=localTime(input.businessAt??now),asOf=localTime(input.asOf??now),known=s.events.filter(e=>stamp(e.recorded_at)<=asOf);
   const effective=(rows:CampusEvent[])=>rows.filter(e=>stamp(e.valid_from)<=at&&(e.valid_to===null||at<stamp(e.valid_to))).at(-1);
   const v=effective(known.filter(e=>e.facts!==null)),p=effective(known.filter(e=>['SCHEDULE_OPENING','CANCEL_OPENING'].includes(e.action))),o=effective(known.filter(e=>e.state!==null));
   return {id:s.id,head:String(known.at(-1)?.number??0),facts:v?.facts??null,operationStatus:o?.state??'NOT_ESTABLISHED',plannedOpeningAt:p?.planned_opening_at?stamp(p.planned_opening_at):null,operatingPermission:'NOT_EVALUABLE' as const};
  });
 };
 const exact=async(actor:string,input:{id:string;version:string})=>{check(CampusVersionSchema,input);const v=(await history(actor,input.id)).versions.find(v=>v.version===input.version);if(!v)throw new Error('NOT_FOUND');return v;};

 return {
  async stage(actor:string,input:Parameters<typeof store.stage>[1]){check(CampusCommandSchema,input.command);normalize(input.command);return store.stage(actor,input);},readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async plan(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);const r=await root(async scope=>{await record(scope,actor,input.inputId,'WRITE');return (await sql<{r:Awaited<ReturnType<typeof record>>}>`select organization_master.plan_input_for(${actor},${input.inputId}::uuid,${input.requestId}::uuid,'ORG02') r`.execute(scope)).rows[0]!.r;});return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  async withdraw(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);return root(async scope=>{await record(scope,actor,input.inputId,'WRITE');return (await sql<{r:{inputId:string;status:'WITHDRAWN'}}>`select organization_master.withdraw_for(${actor},${input.inputId}::uuid,${input.requestId}::uuid,'ORG02') r`.execute(scope)).rows[0]!.r;});},
  async readRestrictedInput(actor:string,id:string){check(Id,id);return root(async scope=>unseal(await record(scope,actor,id,'READ_RESTRICTED')));},
  history,
  read,exact,
  async list(actor:string,input:{after?:string;limit?:number;businessAt?:string;asOf?:string}){
   check(CampusListSchema,input);
   const page=await root(async scope=>{
    const now=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
    const businessAt=localTime(input.businessAt??now),asOf=localTime(input.asOf??now);
    const ids=(await sql<{r:string[]}>`select organization_master.campus_list(${actor},${input.after??null}::uuid,${input.limit??100},${asOf}::timestamp) r`.execute(scope)).rows[0]!.r;
    return {ids,businessAt,asOf};
   });
   return Promise.all(page.ids.map(id=>read(actor,{id,businessAt:page.businessAt,asOf:page.asOf})));
  },
  async diff(actor:string,input:{id:string;fromVersion:string;toVersion:string}){
   check(CampusDiffSchema,input);const a=await exact(actor,{id:input.id,version:input.fromVersion}),b=await exact(actor,{id:input.id,version:input.toVersion});
   const before={...a.facts,validFrom:a.validFrom,validTo:a.validTo},after={...b.facts,validFrom:b.validFrom,validTo:b.validTo};
   const render=(v:unknown)=>v===null?null:typeof v==='string'?v:canonicalPlan(v);const changes=[];
   for(const field of Object.keys(before) as Array<keyof typeof before>)if(canonicalPlan(before[field])!==canonicalPlan(after[field]))changes.push({field,before:render(before[field]),after:render(after[field])});
   return {...input,changes};
  },
  close:()=>db.destroy(),
 };
}
export type CampusOwner=ReturnType<typeof openCampus>;
