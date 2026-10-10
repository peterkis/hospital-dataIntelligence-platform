import {createHmac} from 'node:crypto';
import {Type} from 'typebox';
import {licensedServices as medical} from './service-policy.js';
import {sql} from 'kysely';
import {applyCoordinator,canonicalPlan,planBinding,authenticateRegistrationEvidence,type ApplyOwnerPort,type OwnerFact,type KeyProviderPort} from '../../governance-catalog/index.js';
import {createCampusReader,type CampusSnapshot} from '../campus/reader.js';
import {check} from '../campus/input.js';
import {createRegistrationReader,registrationSpan,registrationStamp} from '../registration.js';
import {localTime,subtract,intersect,covered,type Span} from '../time.js';
import {InputSchema,Id,Time} from '../contracts.js';
import {operatingInput,type Scope} from './input.js';
import {OperatingStageSchema,OperatingCommandSchema,OperatingReadSchema,EvaluateOperatingSchema,kindOf,ownerOf,isClosing,type OperatingCommand,type OperatingRead,type EvaluateOperatingInput,type ScopeFactsValue,type RelationFactsValue,type CatalogReference} from './contracts.js';
export * from './contracts.js';
const ProfileBoundariesSchema=Type.Object({subject:EvaluateOperatingSchema.properties.subject,campus:EvaluateOperatingSchema.properties.campus,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordAsOf:Time},{additionalProperties:false});
interface Version {id:string;number:number;action:OperatingCommand['action'];valid_from:string;valid_to:string|null;recorded_at:string;facts:ScopeFactsValue|RelationFactsValue|null;basis:Basis;reviewer:string}
interface Snapshot {id:string;kind:'RELATION'|'SCOPE';subject_id:string;campus_id:string;scope:string;versions:Version[]}
export interface ScopeDependency {reference:{owner:'organization-master/license-scope';id:string;version:string;versionId:string};license:ScopeFactsValue['license'];catalog:CatalogReference}
interface Basis {scopeDependencies:ScopeDependency[];catalog?:unknown;evidence?:{artifactId:string;digest:string};parents?:unknown}
const stamp=registrationStamp,span=registrationSpan;
const known=(s:Snapshot,asOf:string)=>s.versions.filter(v=>stamp(v.recorded_at)<=asOf);
const effective=(versions:Version[],v:Version)=>subtract(span(v),versions.filter(x=>x.number>v.number).map(span));
const scopeFacts=(v:Version)=>{if(!v.facts||!('license' in v.facts))throw new Error('BLOCKED_DEPENDENCY');return v.facts;};
const relationFacts=(v:Version)=>{if(!v.facts||!('role' in v.facts))throw new Error('BLOCKED_DEPENDENCY');return v.facts;};
export function openOperatingRelations(connectionString:string,provider?:KeyProviderPort){
 const store=operatingInput(connectionString,provider),{db,root,record,unseal}=store;
 const campuses=createCampusReader(root,async(scope,actor,id)=>(await sql<{r:CampusSnapshot}>`select organization_master.campus_snapshot(${actor},${id}::uuid) r`.execute(scope)).rows[0]!.r);
 const registration=createRegistrationReader(root);
 const snapshot=async(scope:Scope,actor:string,id:string,kind:'RELATION'|'SCOPE')=>(await sql<{r:Snapshot}>`select organization_master.operating_snapshot(${actor},${id}::uuid,${kind}) r`.execute(scope)).rows[0]!.r;
 const pair=async(scope:Scope,actor:string,subjectId:string,campusId:string,kind:'RELATION'|'SCOPE')=>(await sql<{r:Snapshot[]}>`select organization_master.operating_pair(${actor},${subjectId}::uuid,${campusId}::uuid,${kind}) r`.execute(scope)).rows[0]!.r;
 const clock=async(scope:Scope)=>(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(scope)).rows[0]!.v;
 const catalog=async(scope:Scope,actor:string,ref:CatalogReference,p:Span,asOf?:string)=>{const result=(await sql<{r:unknown}>`select governance_catalog.operating_catalog(${actor},${JSON.stringify(ref)}::jsonb,${p.from}::timestamp,${p.to}::timestamp,${asOf??null}::timestamp) r`.execute(scope)).rows[0]!.r;if(result===null)throw new Error('BLOCKED_DEPENDENCY');return result;};
 const normalize=(raw:OperatingCommand)=>{const c=structuredClone(raw);c.validFrom=localTime(c.validFrom.replace(/\+08:00$/u,''));c.validTo=c.validTo===null?null:localTime(c.validTo.replace(/\+08:00$/u,''));c.source.recordedAt=localTime(c.source.recordedAt.replace(/\+08:00$/u,''));if(c.validTo!==null&&c.validTo<=c.validFrom)throw new Error('INVALID_BUSINESS_PERIOD');if(isClosing(c)&&c.validTo!==null)throw new Error('CLOSED_INPUT_REQUIRED');if('target' in c&&c.target.owner!==ownerOf(kindOf(c.action)))throw new Error('ACCESS_DENIED');return c;};
 const conflict=async(scope:Scope,actor:string,c:OperatingCommand)=>'facts' in c&&'primary' in c.facts&&c.facts.primary==='Y'&&(await sql<{r:boolean}>`select organization_master.operating_primary_conflict(${actor},${c.campus.id}::uuid,${'target' in c?c.target.id:null}::uuid,${c.validFrom}::timestamp,${c.validTo}::timestamp) r`.execute(scope)).rows[0]!.r;
 const validateLicense=async(scope:Scope,actor:string,subjectId:string,f:Pick<ScopeFactsValue,'license'|'catalog'>,p:Span,asOf:string)=>{
  const reg=await registration.inTransaction(scope).read(actor,{id:subjectId,asOf});
  const license=reg.licenses.find(l=>l.license_id===f.license.id&&l.id===f.license.versionId&&String(l.number)===f.license.version);
  if(!license||license.revoked||license.end_kind==='UNKNOWN')throw new Error('BLOCKED_DEPENDENCY');
  if(!covered(reg.qualified.filter(q=>q.licenseVersionId===license.id),p.from,p.to))throw new Error('BLOCKED_DEPENDENCY');
  await catalog(scope,actor,f.catalog,p,asOf);
  return {license,qualified:reg.qualified.filter(q=>q.licenseVersionId===license.id)};
 };
 const validateScope=(scope:Scope,actor:string,subjectId:string,_campusId:string,v:Version,p:Span,asOf:string)=>validateLicense(scope,actor,subjectId,scopeFacts(v),p,asOf);
 const scopeCoverage=async(scope:Scope,actor:string,subjectId:string,campusId:string,references:RelationFactsValue['scopeTargets'],expectedCatalog:CatalogReference,services:string[],p:Span,asOf:string,cuts:Span[]=[])=>{
  if(new Set(references.map(ref=>ref.id+'/'+ref.versionId)).size!==references.length)throw new Error('CLOSED_INPUT_REQUIRED');
  const spans:Record<string,Span[]>={},dependencies:ScopeDependency[]=[];for(const service of services)spans[service]=[];
  for(const ref of references){
   const snapshotValue=await snapshot(scope,actor,ref.id,'SCOPE');if(snapshotValue.subject_id!==subjectId||snapshotValue.campus_id!==campusId)throw new Error('BLOCKED_DEPENDENCY');
   const versions=known(snapshotValue,asOf),v=versions.find(x=>x.id===ref.versionId&&String(x.number)===ref.version);if(!v?.facts)throw new Error('BLOCKED_DEPENDENCY');
   const facts=scopeFacts(v);if(canonicalPlan(facts.catalog)!==canonicalPlan(expectedCatalog))throw new Error('BLOCKED_DEPENDENCY');
   const original=effective(versions,v).flatMap(q=>intersect(q,p));if(!original.length)throw new Error('BLOCKED_DEPENDENCY');
   const parts=original.flatMap(part=>subtract(part,cuts));
   for(const part of parts){await validateScope(scope,actor,subjectId,campusId,v,part,asOf);for(const code of facts.services)spans[code]?.push(part);}
   dependencies.push({reference:{owner:'organization-master/license-scope',id:snapshotValue.id,version:String(v.number),versionId:v.id},license:facts.license,catalog:facts.catalog});
  }
  return {spans,dependencies};
 };
 const admission=async(scope:Scope,actor:string,c:OperatingCommand,current:Snapshot|null,asOf:string)=>{
  const basis:Basis={scopeDependencies:[]},blockers:string[]=[];if(isClosing(c))return {basis,blockers};
  const p={from:c.validFrom,to:c.validTo};await sql`select organization_master.campus_admission(${actor},${c.campus.id}::uuid,${p.from}::timestamp,${p.to}::timestamp)`.execute(scope);const reg=await registration.inTransaction(scope).read(actor,{id:c.subject.id,asOf});
  const campus=await campuses.inTransaction(scope).readCampusReferenceCoverage(actor,{references:[c.campus],validFrom:p.from,validTo:p.to,asOf});
  if(!covered(reg.profiles,p.from,p.to)||campus.items[0]?.coverage!=='COVERED')throw new Error('BLOCKED_DEPENDENCY');
  basis.parents={subjectProfiles:reg.profiles,campusProfiles:campus.items[0].segments};
  if(!('facts' in c))throw new Error('CLOSED_INPUT_REQUIRED');
  const f=c.facts;basis.catalog=await catalog(scope,actor,f.catalog,p,asOf);
  if('license' in f){
   if(!f.services.length||f.services.some(code=>!medical.includes(code)))blockers.push('UNSUPPORTED_SERVICE');
   const fake:Version={id:'',number:0,action:c.action,valid_from:p.from,valid_to:p.to,recorded_at:asOf,facts:f,basis,reviewer:actor};
   const proof=await validateScope(scope,actor,c.subject.id,c.campus.id,fake,p,asOf);
   basis.parents={...basis.parents as object,qualified:proof.qualified,license:proof.license};
  }else{
   if(f.role==='OTHER')blockers.push('UNSUPPORTED_RELATION_ROLE');
   if(f.primary==='Y'&&f.role!=='OPERATOR')blockers.push('INVALID_PRIMARY_ROLE');
   if(f.role!=='OPERATOR'){if(f.services.length||f.scopeTargets.length||f.licenseScopeText!==null)blockers.push('UNSUPPORTED_SERVICE');}
   else{
    if(!f.services.length||f.services.some(code=>!medical.includes(code))||!f.licenseScopeText?.trim())blockers.push('UNSUPPORTED_SERVICE');
    if(new Set(f.scopeTargets.map(x=>x.id+'/'+x.versionId)).size!==f.scopeTargets.length)throw new Error('CLOSED_INPUT_REQUIRED');
    const coverage=await scopeCoverage(scope,actor,c.subject.id,c.campus.id,f.scopeTargets,f.catalog,f.services,p,asOf);
    basis.scopeDependencies.push(...coverage.dependencies);
    if(!blockers.includes('UNSUPPORTED_SERVICE')&&f.services.some(code=>!covered(coverage.spans[code]??[],p.from,p.to)))throw new Error('LICENSE_PERIOD_NOT_COVERED');
   }
   if(c.action==='REVALIDATE'&&current){
    const versions=known(current,asOf),active=versions.filter(v=>v.facts&&effective(versions,v).some(q=>intersect(q,p).length));
    if(!covered(active.flatMap(v=>effective(versions,v)),p.from,p.to)||active.some(v=>{const old=relationFacts(v);return canonicalPlan([old.role,old.primary,old.services,old.relationTypeText,old.licenseScopeText])!==canonicalPlan([f.role,f.primary,f.services,f.relationTypeText,f.licenseScopeText]);}))throw new Error('BLOCKED_DEPENDENCY');
   }
  }
  return {basis,blockers};
 };
 const port:ApplyOwnerPort={
  async authorize(scope,actor,input,permission){const r=await record(scope,actor,input.jobId,permission);if(permission==='REVIEW')await record(scope,actor,input.jobId,'READ_RESTRICTED');if(r.campus!==input.campus||r.revision!==input.revisionId||input.purpose!=='IDENTITY_VERIFY')throw new Error('ACCESS_DENIED');},
  async observe(scope,actor,input){
   const r=await record(scope,actor,input.jobId);if(r.withdrawn||r.currentRevision!==r.jobRevision||r.revision!==input.revisionId)throw new Error('STALE_VALIDATION');
   const raw=unseal(r);if(raw.profile!=='CORE'||raw.dependencies?.length)throw new Error('BLOCKED_DEPENDENCY');const c=normalize(raw.command);
   if(c.subject.id!==r.subjectId||c.campus.id!==r.campusId||kindOf(c.action)!==r.kind||c.action!==r.action)throw new Error('ACCESS_DENIED');
   const current=r.target?await snapshot(scope,actor,r.target,r.kind):null,asOf=await clock(scope);
   const {basis,blockers}=await admission(scope,actor,c,current,asOf);
   if(!isClosing(c)){
    if(!c.evidence)throw new Error('BLOCKED_DEPENDENCY');
    const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select organization_master.evidence(${actor},${c.evidence}::uuid,${c.source.systemId}::uuid,${c.source.versionId}::uuid,${r.campus},${c.validFrom}::timestamp,${c.validTo}::timestamp) r`.execute(scope)).rows[0]!.r;
    const bytes=authenticateRegistrationEvidence(proof,provider);try{basis.evidence={artifactId:c.evidence,digest:planBinding(provider,'OPERATING_EVIDENCE_V1',bytes.toString('base64'))};}finally{bytes.fill(0);}
   }
   if(await conflict(scope,actor,c))blockers.push('PRIMARY_OPERATOR_CONFLICT');
   return {input,atomicRule:'OPERATING_SINGLE_COMMAND_V1',basis:{inputDigest:r.digest,current,basis,blockingIssues:blockers},commands:[{owner:ownerOf(r.kind),row:1,intent:r.target?'REVISE' as const:'CREATE' as const,target:'target' in c?{owner:c.target.owner,id:c.target.id,version:c.target.expectedVersion}:null,aliases:[],value:{inputId:r.id,command:canonicalPlan(c),original:canonicalPlan(raw.command),basis:canonicalPlan(basis)}}],diff:[c]};
  },
  async validate(scope,actor,unit,stage){
   const c=JSON.parse(unit.commands[0]!.value['command']!) as OperatingCommand;check(OperatingCommandSchema,c);
   const r=await record(scope,actor,unit.input.jobId);if(c.source.recordStatus!=='PUBLISHED'||!c.source.approvalRef?.trim())throw new Error('APPROVAL_REQUIRED');
   if('target' in c){const s=await snapshot(scope,actor,c.target.id,kindOf(c.action));if(s.subject_id!==c.subject.id||s.campus_id!==c.campus.id||r.target!==s.id||String(s.versions.at(-1)?.number)!==c.target.expectedVersion)throw new Error('STALE_VALIDATION');if(s.versions.some(v=>v.action==='CLOSE'||v.action==='REVOKE_SCOPE'))throw new Error('OPERATING_CLOSED');}
   const blockers=unit.basis['blockingIssues'] as string[];if(stage!=='FREEZE'&&blockers.length)throw new Error(blockers.includes('PRIMARY_OPERATOR_CONFLICT')?'PRIMARY_OPERATOR_CONFLICT':'BLOCKED_DEPENDENCY');
  },
  async apply(scope,actor,command,_resolved,approval){
   const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(scope)).rows[0]!.id;
   const ticket=canonicalPlan({domain:'ORG03_WRITE_V1',actor,inputId:command.value['inputId'],command:JSON.parse(command.value['command']!),basis:JSON.parse(command.value['basis']!),candidateId:approval.candidateId,digest:approval.digest,transaction});
   const key=Buffer.from(planBinding(provider,'OPERATING_SQL_AUTHORITY_V1',{}),'hex');try{const signature=createHmac('sha256',key).update(ticket).digest('hex');return {ok:true,fact:(await sql<{r:OwnerFact}>`select organization_master.operating_write(${ticket},${signature}) r`.execute(scope)).rows[0]!.r};}finally{key.fill(0);}
  },
  async exactRead(scope,actor,_input,fact){const kind=fact.owner==='organization-master/license-scope'?'SCOPE':fact.owner==='organization-master/operating-relation'?'RELATION':null;if(!kind)return null;return (await snapshot(scope,actor,fact.id,kind)).versions.some(v=>String(v.number)===fact.version)?fact:null;}
 };
 const coordinator=applyCoordinator(db,provider,port);
 const publicVersion=(s:Snapshot,v:Version)=>({id:s.id,kind:s.kind,head:String(s.versions.at(-1)!.number),subject:{owner:'organization-master' as const,id:s.subject_id},campus:{owner:'organization-master/campus' as const,id:s.campus_id},version:String(v.number),versionId:v.id,action:v.action,validFrom:stamp(v.valid_from),validTo:v.valid_to===null?null:stamp(v.valid_to),recordedAt:stamp(v.recorded_at),facts:v.facts,scopeDependencies:v.basis.scopeDependencies,reviewer:v.reviewer});
 const read=async(actor:string,input:OperatingRead)=>{
  check(OperatingReadSchema,input);input=structuredClone(input);
  if(input.mode==='LIST'?(!input.subjectId||!input.campusId):!input.id||input.mode==='EXACT'&&!input.version)throw new Error('CLOSED_INPUT_REQUIRED');
  return root(async scope=>{
   const now=await clock(scope),asOf=localTime(input.asOf??now),businessAt=localTime(input.businessAt??now);
   const objects=input.mode==='LIST'?await pair(scope,actor,input.subjectId!,input.campusId!,input.kind):[await snapshot(scope,actor,input.id!,input.kind)];
   return objects.flatMap(s=>{const rows=known(s,asOf);s={...s,versions:rows};if(!rows.length){if(input.mode!=='LIST')throw new Error('NOT_FOUND');return [];}
    if(input.mode==='HISTORY')return rows.map(v=>publicVersion(s,v));
    if(input.mode==='EXACT'){const v=rows.find(v=>String(v.number)===input.version);if(!v)throw new Error('NOT_FOUND');return [publicVersion(s,v)];}
    const v=rows.filter(v=>stamp(v.valid_from)<=businessAt&&(v.valid_to===null||businessAt<stamp(v.valid_to))).at(-1);return v?[publicVersion(s,v)]:[];
   });
  });
 };
 const evaluateOperatingWindowInTransaction=async(scope:Scope,actor:string,input:EvaluateOperatingInput)=>{
  check(EvaluateOperatingSchema,input);input=structuredClone(input);const requested={from:localTime(input.validFrom),to:input.validTo===null?null:localTime(input.validTo)};
  if(requested.to!==null&&requested.to<=requested.from)throw new Error('INVALID_BUSINESS_PERIOD');
  return (async()=>{
   const observedAt=await clock(scope),asOf=localTime(input.asOf??observedAt),relations=await pair(scope,actor,input.subject.id,input.campus.id,'RELATION');
   const reg=await registration.inTransaction(scope).read(actor,{id:input.subject.id,asOf});
   const cr=campuses.inTransaction(scope),profiles=await cr.readCampusReferenceCoverage(actor,{references:[input.campus],validFrom:requested.from,validTo:requested.to,asOf});
   const operations=(await cr.history(actor,input.campus.id)).operations.filter(v=>v.recordedAt<=asOf);
   const opSpan=(v:typeof operations[number])=>({from:v.validFrom,to:v.validTo});
   const running=operations.filter(v=>v.state==='RUNNING'||v.state==='TRIAL_RUNNING').flatMap(v=>subtract(opSpan(v),operations.filter(x=>BigInt(x.version)>BigInt(v.version)).map(opSpan)));
   const intersectAll=(initial:Span[],withSpans:Span[])=>initial.flatMap(a=>withSpans.flatMap(b=>intersect(a,b)));
   const services=[];
   for(const code of input.services){
    const segments:Array<{from:string;to:string|null;relation:{owner:'organization-master/operating-relation';id:string;version:string;versionId:string};scope:{owner:'organization-master/license-scope';id:string;version:string;versionId:string};license:ScopeFactsValue['license']}>=[];
    const review:Span[]=[],reasons=new Set<string>();
    if(!covered(reg.profiles,requested.from,requested.to))reasons.add('SUBJECT_PROFILE_GAP');
    if(profiles.items[0]?.coverage!=='COVERED')reasons.add('CAMPUS_PROFILE_GAP');
    if(!covered(running,requested.from,requested.to))reasons.add('CAMPUS_NOT_RUNNING');
    if(!medical.includes(code))reasons.add('UNSUPPORTED_SERVICE');
    else for(const relation of relations){
     const versions=known(relation,asOf);
     for(const v of versions){if(!v.facts||!('role' in v.facts)||v.facts.role!=='OPERATOR'||!v.facts.services.includes(code))continue;
      const f=v.facts;
      for(const part of effective(versions,v).flatMap(q=>intersect(q,requested))){
       try{await catalog(scope,actor,f.catalog,part,asOf);}catch(error){if(error instanceof Error&&error.message==='BLOCKED_DEPENDENCY'){review.push(part);reasons.add('SERVICE_CATALOG_CHANGED');continue;}throw error;}
       for(const ref of f.scopeTargets){
        const sc=await snapshot(scope,actor,ref.id,'SCOPE');if(sc.subject_id!==input.subject.id||sc.campus_id!==input.campus.id)throw new Error('BLOCKED_DEPENDENCY');
        const scopeVersions=known(sc,asOf),sv=scopeVersions.find(x=>x.id===ref.versionId&&String(x.number)===ref.version);
        if(!sv?.facts||!('license' in sv.facts)){review.push(part);reasons.add('SCOPE_EVIDENCE_CHANGED');continue;}
        const sf=sv.facts;if(!sf.services.includes(code))continue;
        const relevant=intersect(span(sv),part);if(!relevant.length)continue;
        const active=intersectAll(effective(scopeVersions,sv),[part]);
        const removed=relevant.flatMap(q=>subtract(q,active));if(removed.length){review.push(...removed);reasons.add('SCOPE_EVIDENCE_CHANGED');}
        const license=reg.licenses.find(l=>l.id===sf.license.versionId&&l.license_id===sf.license.id&&String(l.number)===sf.license.version);
        if(!license){review.push(...relevant);reasons.add('LICENSE_CHANGED');continue;}
        const licenseSpans=license.revoked||license.end_kind==='UNKNOWN'?[]:subtract(span(license),reg.licenses.filter(l=>l.license_id===license.license_id&&l.number>license.number).map(span));
        const licenseLost=relevant.flatMap(q=>subtract(q,licenseSpans));if(licenseLost.length){review.push(...licenseLost);reasons.add('LICENSE_CHANGED');}
        try{for(const p of active)await catalog(scope,actor,sf.catalog,p,asOf);}catch(error){if(error instanceof Error&&error.message==='BLOCKED_DEPENDENCY'){review.push(...active);reasons.add('SERVICE_CATALOG_CHANGED');continue;}throw error;}
        if(active.some(p=>!covered(reg.qualified.filter(q=>q.licenseVersionId===license.id),p.from,p.to)))reasons.add('REGISTRATION_NOT_COVERED');
        let spans=intersectAll(active,licenseSpans);spans=intersectAll(spans,reg.qualified.filter(q=>q.licenseVersionId===license.id));spans=intersectAll(spans,reg.profiles);spans=intersectAll(spans,profiles.items[0]?.segments??[]);spans=intersectAll(spans,running);
        for(const p of spans)segments.push({...p,relation:{owner:'organization-master/operating-relation',id:relation.id,version:String(v.number),versionId:v.id},scope:ref,license:sf.license});
       }
      }
     }
    }
    segments.sort((a,b)=>a.from.localeCompare(b.from)||a.relation.id.localeCompare(b.relation.id));
    const gaps=subtract(requested,segments);
    const status=!medical.includes(code)?'NOT_EVALUABLE' as const:review.length?'REVIEW_REQUIRED' as const:gaps.length?'NOT_SATISFIED' as const:'SATISFIED' as const;
    if(gaps.length&&!review.length&&medical.includes(code))reasons.add('OPERATING_WINDOW_NOT_COVERED');
    services.push({code,status,segments,gaps,reviewRequired:review,reasons:[...reasons]});
   }
   const status=services.some(s=>s.status==='NOT_EVALUABLE')?'NOT_EVALUABLE' as const:services.some(s=>s.status==='REVIEW_REQUIRED')?'REVIEW_REQUIRED' as const:services.some(s=>s.status==='NOT_SATISFIED')?'NOT_SATISFIED' as const:'SATISFIED' as const;
   return {policy:'ORG03_SYNTHETIC_V1' as const,status,observedAt,asOf,subject:input.subject,campus:input.campus,validFrom:requested.from,validTo:requested.to,services};
  })();
 };
 const evaluateOperatingWindow=(actor:string,input:EvaluateOperatingInput)=>root(scope=>evaluateOperatingWindowInTransaction(scope,actor,input));
 return {evaluateOperatingWindowInTransaction,
  async readSubjectProfileBoundariesInTransaction(scope:Scope,actor:string,input:{subject:EvaluateOperatingInput['subject'];campus:EvaluateOperatingInput['campus'];validFrom:string;validTo:string|null;recordAsOf:string}){check(ProfileBoundariesSchema,input);return (await sql<{r:string[]}>`select organization_master.subject_profile_boundaries(${actor},${JSON.stringify({subject:input.subject,campus:input.campus})}::jsonb,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(scope)).rows[0]!.r;},
  commandsInTransaction:(scope:Scope)=>({stage:async(actor:string,input:Parameters<typeof store.stage>[1])=>{check(OperatingStageSchema,input);normalize(input.command);return store.stageInTransaction(scope,actor,input);},port}),stage:async(actor:string,input:Parameters<typeof store.stage>[1])=>{check(OperatingStageSchema,input);normalize(input.command);return store.stage(actor,input);},
  async plan(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);const r=await root(async scope=>(await sql<{r:Awaited<ReturnType<typeof record>>}>`select organization_master.operating_plan(${actor},${input.inputId}::uuid,${input.requestId}::uuid) r`.execute(scope)).rows[0]!.r);return coordinator.planOwnerUnit(actor,{requestId:input.requestId,jobId:r.id,revisionId:r.revision,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  async withdraw(actor:string,input:{inputId:string;requestId:string}){check(InputSchema,input);return root(async scope=>(await sql<{r:{inputId:string;status:'WITHDRAWN'}}>`select organization_master.operating_withdraw(${actor},${input.inputId}::uuid,${input.requestId}::uuid) r`.execute(scope)).rows[0]!.r);},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async requireInputKind(actor:string,id:string,kind:'RELATION'|'SCOPE'){check(Id,id);await root(async scope=>{if((await record(scope,actor,id)).kind!==kind)throw new Error('ACCESS_DENIED');});},
  async requireCandidateKind(actor:string,id:string,kind:'RELATION'|'SCOPE'){check(Id,id);await root(async scope=>{const c=(await sql<{r:{input:{jobId:string}}}>`select governance_catalog.apply_record(${actor},'READ_CANDIDATE',${JSON.stringify({candidateId:id})}::jsonb) r`.execute(scope)).rows[0]!.r;if((await record(scope,actor,c.input.jobId)).kind!==kind)throw new Error('ACCESS_DENIED');});},
  async licenseCoverageInTransaction(scope:Scope,actor:string,input:{subjectId:string;license:ScopeFactsValue['license'];catalog:CatalogReference;period:Span}){const proof=await validateLicense(scope,actor,input.subjectId,input,input.period,await clock(scope));return proof.qualified.map(({from,to})=>({from,to}));},
  async scopeCoverageInTransaction(scope:Scope,actor:string,input:{subjectId:string;campusId:string;references:RelationFactsValue['scopeTargets'];catalog:CatalogReference;services:string[];period:Span;subjectRevisionCuts:Span[]}){return scopeCoverage(scope,actor,input.subjectId,input.campusId,input.references,input.catalog,input.services,input.period,await clock(scope),input.subjectRevisionCuts);},
  async inspectCommandInTransaction(scope:Scope,actor:string,raw:OperatingCommand):Promise<unknown>{
   check(OperatingCommandSchema,raw);const c=normalize(raw),current='target' in c?await snapshot(scope,actor,c.target.id,kindOf(c.action)):null;
   if(c.source.recordStatus!=='PUBLISHED'||!c.source.approvalRef?.trim())throw new Error('APPROVAL_REQUIRED');
   if('target' in c){if(!current||current.subject_id!==c.subject.id||current.campus_id!==c.campus.id||String(current.versions.at(-1)?.number)!==c.target.expectedVersion)throw new Error('STALE_VALIDATION');if(current.versions.some(v=>v.action==='CLOSE'||v.action==='REVOKE_SCOPE'))throw new Error('OPERATING_CLOSED');}
   const checked=await admission(scope,actor,c,current,await clock(scope));
   if(await conflict(scope,actor,c))throw new Error('PRIMARY_OPERATOR_CONFLICT');if(checked.blockers.length)throw new Error('BLOCKED_DEPENDENCY');return checked.basis;
  },
  read,evaluateOperatingWindow,async readRestrictedInput(actor:string,id:string){check(Id,id);return root(async scope=>unseal(await record(scope,actor,id,'READ_RESTRICTED')));},
  close:()=>db.destroy()
 };
}
export type OperatingOwner=ReturnType<typeof openOperatingRelations>;
