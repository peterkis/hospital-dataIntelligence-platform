import {wardNursingHandoverEnd} from './ward-nursing-timeline.js';
import {withLifecycleCareInputs,registerLifecycleCareInputs} from './lifecycle-care-inputs.js';
import {withLifecycleScopeProposals,withLifecycleMembers} from './lifecycle-planning.js';
import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {Kysely,PostgresDialect,sql} from 'kysely';
import {Check} from 'typebox/value';
import {vnextPool} from '../../platform/database/vnext-pool.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope,applyCoordinator,canonicalPlan,planBinding,type ApplyOwnerPort,type ObservedOwnerUnit,type PlanOwnerUnitInput,type KeyProviderPort,type OwnerFact} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
import type {WardNursingWrite,WardNursingFacts,WardNursingHistory,ScopeRevisionProjection} from './ward-nursing-contracts.js';
import {LifecycleStageSchema,LifecycleInputSchema,LifecycleHistorySchema,LifecyclePlanSchema,LifecycleVerifySchema,LifecycleAssessmentSchema,type LifecycleAssessment,type LifecycleDependency,type LifecycleDependencyInput,type LifecycleStage,type LifecycleVerification,type LifecyclePorts,type LifecycleReference,type LifecycleOwner,type LifecycleMemberPort} from './lifecycle-contracts.js';

type Scope=CatalogTransactionScope;
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface RecordInput {targets:Array<{kind:LifecycleDependencyInput['kind'];id:string}>;recordedAt:string;id:string;revision:string;identity:string;digest:string;campus:'NORTH'|'SOUTH';envelope:Envelope;members:Array<LifecycleReference&{owner:LifecycleOwner}>;observationDigest:string;verification:null|{recordedAt:string;id:string;digest:string;observationDigest:string;actor:string;identity:string;envelope:Envelope|null}}
interface Member {owner:LifecycleOwner;reference:LifecycleReference;unit:ObservedOwnerUnit}
const check=(schema:unknown,value:unknown)=>{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');};
const nativeInput=(r:LifecycleReference,requestId:string):PlanOwnerUnitInput=>({jobId:r.inputId,revisionId:r.revisionId,requestId,campus:r.campus,scope:'SYNTHETIC',purpose:'IDENTITY_VERIFY'});

/** Limited lifecycle coordination. Each injected Owner retains its own authority and writer. */
export function openCareLocationLifecycle(connection:string,provider:KeyProviderPort,ports:LifecyclePorts){
 const memberPort=(owner:LifecycleOwner):LifecycleMemberPort=>{const port=ports[owner];if(!port)throw new Error('BLOCKED_DEPENDENCY');return port;};
 const db=new Kysely<DB>({dialect:new PostgresDialect({pool:vnextPool(connection)})});
 const root=<T>(work:(s:Scope)=>Promise<T>)=>db.transaction().execute(async trx=>{await sql`select pg_advisory_xact_lock(901002)`.execute(trx);return work(CatalogTransactionScope.from(trx));});
 const record=async<T>(s:Scope,actor:string,operation:string,value:Record<string,unknown>):Promise<T>=>{
  const transaction=(await sql<{id:string}>`select pg_current_xact_id()::text id`.execute(s)).rows[0]!.id,ticket=canonicalPlan({...value,actor,operation,transaction}),key=Buffer.from(planBinding(provider,'UNIT_SQL_AUTHORITY_V1',{}),'hex');
  try{return (await sql<{r:T}>`select care_organization.lifecycle_record(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
 };
 const read=(s:Scope,actor:string,id:string,permission='READ')=>record<RecordInput>(s,actor,'READ',{inputId:id,permission});
 const seal=(value:unknown,domain='CARE_LIFECYCLE_INPUT_V1')=>{const digest=planBinding(provider,domain,value),{id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(Buffer.from(digest));const bytes=Buffer.from(canonicalPlan(value));try{const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);return {digest,envelope:{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')}};}finally{bytes.fill(0);}};
 const unseal=<T=LifecycleStage>(r:{envelope:Envelope;digest:string},domain='CARE_LIFECYCLE_INPUT_V1',schema:unknown=LifecycleStageSchema):T=>{const d=createDecipheriv('aes-256-gcm',provider.payload(r.envelope.keyId),Buffer.from(r.envelope.nonce,'hex'));d.setAAD(Buffer.from(r.digest));d.setAuthTag(Buffer.from(r.envelope.tag,'hex'));const bytes=Buffer.concat([d.update(Buffer.from(r.envelope.ciphertext,'hex')),d.final()]);try{const value:unknown=JSON.parse(bytes.toString());check(schema,value);if(planBinding(provider,domain,value)!==r.digest)throw new Error('INVALID_PLAN_TOKEN');return value as T;}finally{bytes.fill(0);}};
 const targetLinks=(items:Member[])=>{
  const links=new Map<string,{kind:LifecycleDependencyInput['kind'];id:string}>();
  const add=(kind:LifecycleDependencyInput['kind'],id:string)=>{check(LifecycleAssessmentSchema.properties.target,{kind,id});links.set(kind+'/'+id,{kind,id});};
  const refs={'care-organization/unit':'UNIT','care-organization/nursing':'NURSING','care-organization/ward':'WARD','location-master':'LOCATION'} as const;
  for(const m of items)for(const c of m.unit.commands.filter(c=>c.value['writes']))for(const w of JSON.parse(c.value['writes']!) as Array<{targetId:string|null;applicability?:Record<string,{owner?:string;id?:string}>}>){
   if(w.targetId&&(m.owner==='UNIT'||m.owner==='NURSING'||m.owner==='WARD'||m.owner==='LOCATION'))add(m.owner,w.targetId);
   for(const value of Object.values(w.applicability??{}))if(value&&typeof value==='object'&&value.owner&&value.id&&Object.hasOwn(refs,value.owner))add(refs[value.owner as keyof typeof refs],value.id);
  }return [...links.values()];
 };
 const dependencyReport=async(s:Scope,actor:string,input:LifecycleDependencyInput)=>{
  const care=input.kind==='LOCATION'?[]:(await sql<{r:LifecycleDependency[]}>`select care_organization.lifecycle_dependencies(${actor},${input.kind},${input.id}::uuid,${localTime(input.validFrom)}::timestamp,${input.validTo===null?null:localTime(input.validTo)}::timestamp,${localTime(input.recordAsOf)}::timestamp) r`.execute(s)).rows[0]!.r;
  const locationPort=ports.LOCATION?.readLifecycleDependenciesInTransaction,location=locationPort?await locationPort(s,actor,input):[];
  if(input.kind==='LOCATION'&&!locationPort)throw new Error('BLOCKED_DEPENDENCY');
  return {items:[...care,...location],unavailable:[...(!locationPort?['LOCATION_REFERENCES']:[]),'PERSONNEL_ASSIGNMENT','BED_RESOURCE','BED_SNAPSHOT','PATIENT_BUSINESS','EXTERNAL_CONSUMERS'].map(owner=>({owner,status:'NOT_EVALUABLE' as const}))};
 };
 const affected=async(s:Scope,actor:string,value:LifecycleStage,items:Member[])=>{
  if(value.kind==='MOVE'&&!ports.LOCATION?.readLifecycleDependenciesInTransaction)throw new Error('BLOCKED_DEPENDENCY');
  const point=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v,targets=new Map<string,{kind:LifecycleDependencyInput['kind'];id:string;validFrom:string;validTo:string|null}>();
  for(const m of items)if(m.owner==='UNIT'||m.owner==='WARD'||m.owner==='NURSING'||m.owner==='LOCATION')for(const command of m.unit.commands)if(command.target)targets.set(m.owner+'/'+command.target.id,{kind:m.owner,id:command.target.id,validFrom:value.cutover,validTo:null});
   for(const m of items.filter(m=>m.owner==='LOCATION'))for(const command of m.unit.commands.filter(c=>c.value['writes']))for(const w of JSON.parse(command.value['writes']!) as Array<{targetId:string;action:string;validFrom:string;validTo:string|null}>){if(w.targetId)targets.set('LOCATION/'+w.targetId,{kind:'LOCATION',id:w.targetId,validFrom:w.validFrom,validTo:w.validTo});}
  const reports=[];
  for(const target of targets.values()){const report=await dependencyReport(s,actor,{...target,recordAsOf:point});
   const included=report.items.map(dep=>({...dep,included:items.some(m=>m.owner===dep.owner&&m.unit.commands.some(c=>c.target?.id===dep.id&&c.target.version===dep.head))}));
   const moved=items.filter(m=>m.owner===target.kind).flatMap(m=>m.unit.commands.filter(c=>c.value['writes']).flatMap(c=>JSON.parse(c.value['writes']!) as Array<{targetId:string;action:string;bindingChanges?:Array<{id:string|null;binding:{campus:{id:string}}}>}>)).some(w=>w.targetId===target.id&&(w.action==='MOVE_CONTAINMENT'||w.action==='REBIND'&&w.bindingChanges?.some(b=>b.id!==null&&w.bindingChanges!.some(next=>next.id===null&&next.binding.campus.id!==b.binding.campus.id))));
   if(value.kind==='MOVE'&&moved&&included.some(dep=>!dep.included))throw new Error('LIFECYCLE_DISPOSITION_INCOMPLETE');
   reports.push({target:{kind:target.kind,id:target.id},validFrom:target.validFrom,validTo:target.validTo,...report,items:included});
  }
  return reports;
 };
 const verifyMoveDisposition=async(s:Scope,actor:string,unit:ObservedOwnerUnit,recordAt:string)=>{
  const input=unit.basis['input'] as LifecycleStage;if(input.kind!=='MOVE')return;
  const reports=unit.basis['dependencies'] as Array<{target:LifecycleDependencyInput;validFrom:string;validTo:string|null;items:LifecycleDependency[]}>;
  for(const m of frozenMembers(unit))if(m.owner==='LOCATION')for(const c of m.unit.commands.filter(c=>c.value['writes']))for(const w of JSON.parse(c.value['writes']!) as Array<{targetId:string;action:string;validFrom:string;validTo:string|null}>){if(w.action!=='MOVE_CONTAINMENT')continue;const old=reports.find(r=>r.target.kind==='LOCATION'&&r.target.id===w.targetId)?.items??[],current=await dependencyReport(s,actor,{kind:'LOCATION',id:w.targetId,validFrom:w.validFrom,validTo:w.validTo,recordAsOf:recordAt});if(old.some(d=>current.items.some(next=>next.owner===d.owner&&next.id===d.id&&next.referenceId===d.referenceId&&(d.owner!=='LOCATION'||next.referenceVersionId===d.referenceVersionId))))throw new Error('LIFECYCLE_DISPOSITION_INCOMPLETE');}
  for(const m of frozenMembers(unit))if(m.owner==='UNIT'||m.owner==='WARD'||m.owner==='NURSING')for(const c of m.unit.commands.filter(c=>c.value['writes']))for(const w of JSON.parse(c.value['writes']!) as Array<{targetId:string;action:string;binding:{campus:{id:string}};bindingChanges:Array<{id:string|null;binding:{campus:{id:string}}}>}>){
   if(w.action!=='REBIND'||!w.bindingChanges.some(b=>b.id!==null&&b.binding.campus.id!==w.binding.campus.id))continue;
   const old=reports.find(r=>r.target.kind===m.owner&&r.target.id===w.targetId)?.items.filter(d=>d.campusId!==w.binding.campus.id)??[],current=await dependencyReport(s,actor,{kind:m.owner,id:w.targetId,validFrom:input.cutover,validTo:null,recordAsOf:recordAt});
   if(old.some(d=>current.items.some(next=>next.owner===d.owner&&next.id===d.id&&next.referenceId===d.referenceId&&next.campusId===d.campusId)))throw new Error('LIFECYCLE_DISPOSITION_INCOMPLETE');
  }
 };
 const members=async(s:Scope,actor:string,value:LifecycleStage):Promise<Member[]>=>{
  return withLifecycleMembers(s,value.members.map(m=>m.inputId),async()=>{
  const proposals:ScopeRevisionProjection[]=[];for(const m of value.members){const p=await memberPort(m.owner).lifecycleScopeProjectionInTransaction?.(s,actor,m.inputId);if(p)proposals.push(p);}
  const withLocation=ports.LOCATION?.lifecycleWithInputsInTransaction??(async<T>(_s:Scope,work:()=>Promise<T>)=>work());
   return withLocation(s,()=>withLifecycleScopeProposals(s,proposals,()=>withLifecycleCareInputs(s,async()=>{
  const result:Member[]=[],seen=new Set<string>();
  for(const member of [...value.members].sort((a,b)=>(['UNIT','NURSING','WARD'].indexOf(a.owner)>=0?['UNIT','NURSING','WARD'].indexOf(a.owner):proposals.some(p=>p.basis.inputId===a.inputId)?3:a.owner==='LOCATION'?4:5)-(['UNIT','NURSING','WARD'].indexOf(b.owner)>=0?['UNIT','NURSING','WARD'].indexOf(b.owner):proposals.some(p=>p.basis.inputId===b.inputId)?3:b.owner==='LOCATION'?4:5))){const key=member.owner+'/'+member.inputId;if(seen.has(key))throw new Error('BATCH_CONFLICT');seen.add(key);const owner=memberPort(member.owner),reference=await owner.lifecycleReferenceInTransaction(s,actor,member.inputId);
   for(const field of ['inputId','revisionId','digest','contractVersionId'] as const)if(reference[field]!==member[field])throw new Error('STALE_VALIDATION');
   const input=nativeInput(reference,value.requestId);await owner.lifecyclePort.authorize(s,actor,input,'READ');const unit=await owner.lifecyclePort.observe(s,actor,input);await owner.lifecyclePort.validate(s,actor,unit);result.push({owner:member.owner,reference,unit});if(member.owner==='LOCATION')owner.lifecycleRegisterInputsInTransaction?.(s,reference,unit);if(member.owner==='UNIT'||member.owner==='NURSING'||member.owner==='WARD')registerLifecycleCareInputs(s,member.owner,reference,unit.commands);
  }
  for(const item of result){
   const first=item.unit.commands.find(c=>c.value['writes']);const writes:Array<{action:string;validFrom:string}>=first?JSON.parse(first.value['writes']!):[];
   const allowed=value.kind==='RESUME'?(item.owner==='UNIT'||item.owner==='WARD'||item.owner==='NURSING'?['RESUME']:[]):value.kind==='CLOSE'?(item.owner==='UNIT'||item.owner==='WARD'||item.owner==='NURSING'?['CLOSE','SUSPEND']:item.owner==='PERMISSION'?['RETIRE']:item.owner==='LOCATION'?['CLOSE']:['END']):value.kind==='HANDOVER'?(item.owner==='WARD_NURSING'?['END','CREATE']:[]):value.kind==='REPARTITION'?(item.owner==='WARD_NURSING'?['END','CREATE','REVISE_SCOPE']:[]):item.owner==='WARD_NURSING'?['END','CREATE','REVISE_SCOPE']:item.owner==='LOCATION'?['MOVE_CONTAINMENT','CLOSE']:item.owner==='CAPABILITY'?['END','GRANT']:item.owner==='PERMISSION'?['RETIRE','RECORD']:item.owner==='UNIT'||item.owner==='NURSING'||item.owner==='WARD'?['REBIND']:['END','CREATE','RETIRE'];
   if(!writes.length||writes.some(w=>!allowed.includes(w.action)||(localTime(w.validFrom)!==localTime(value.cutover)&&((value.kind!=='REPARTITION'&&(value.kind!=='MOVE'||['UNIT','NURSING','WARD','LOCATION'].includes(item.owner)))||localTime(w.validFrom)<localTime(value.cutover)))))throw new Error('UNSUPPORTED_STATE_TRANSITION');
  }
     if(value.kind==='HANDOVER'){
    const native=result.filter(m=>m.owner==='WARD_NURSING'),writes=native.flatMap(m=>m.unit.commands.filter(c=>c.value['writes']).flatMap(c=>JSON.parse(c.value['writes']!) as WardNursingWrite[])),ends=writes.filter(w=>w.action==='END'),creates=writes.filter(w=>w.action==='CREATE');
    if(!ends.length||!creates.length)throw new Error('HANDOVER_NOT_CONFIRMED');
    const prior=native.flatMap(m=>m.unit.basis['heads'] as WardNursingHistory[]);
    for(const end of ends){const source=prior.find(h=>h.id===end.targetId),declaration=source?.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1),successors=creates.filter(w=>{const h=(w.facts as WardNursingFacts).handover;return h.kind==='CONFIRMED_HANDOVER'&&h.confirmed&&h.source.id===end.targetId&&h.source.expectedHead===end.expectedHead&&localTime(h.cutover)===localTime(end.validFrom);});
     if(!declaration||!successors.length||successors.some(w=>localTime(w.validFrom)!==localTime(end.validFrom)||w.validTo!==wardNursingHandoverEnd(source!,end.validFrom)))throw new Error('HANDOVER_NOT_CONFIRMED');
     if(successors.some(w=>(w.facts as WardNursingFacts).isPrimary!==declaration.facts.isPrimary))throw new Error('HANDOVER_PRIMARY_DISCONTINUITY');
    }
    if(creates.some(w=>{const h=(w.facts as WardNursingFacts).handover;return h.kind!=='CONFIRMED_HANDOVER'||!h.confirmed||!ends.some(e=>e.targetId===h.source.id&&e.expectedHead===h.source.expectedHead);}))throw new Error('HANDOVER_NOT_CONFIRMED');
   }
// Count expanded native writes and subordinate binding commands, not only root member rows.
  const expanded=result.reduce((n,m)=>n+m.unit.commands.reduce((count,c)=>{if(!c.value['writes'])return count;const writes:unknown=JSON.parse(c.value['writes']);if(!Array.isArray(writes))throw new Error('INVALID_PLAN_TOKEN');return count+writes.reduce((total,w)=>total+1+(Array.isArray(w.bindingChanges)?w.bindingChanges.length:0),0);},0),0);
  if(expanded>100||Buffer.byteLength(canonicalPlan(result))>524288)throw new Error('PLAN_INPUT_LIMIT');if(proposals.length){if(value.kind!=='REPARTITION'&&value.kind!=='MOVE')throw new Error('SCOPE_REPARTITION_REQUIRES_LIFECYCLE');
   const allWrites:WardNursingWrite[]=result.filter(m=>m.owner==='WARD_NURSING').flatMap(m=>m.unit.commands.filter(c=>c.value['writes']).flatMap(c=>JSON.parse(c.value['writes']!) as WardNursingWrite[]));
   for(const proposal of proposals)for(const h of proposal.affected){const d=h.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1)!;const ending=d.validFrom>localTime(value.cutover)?d.validFrom:localTime(value.cutover);
    if(allWrites.filter(w=>w.action==='END'&&w.targetId===h.id&&w.expectedHead===h.versions.at(-1)!.number&&localTime(w.validFrom)===ending).length!==1)throw new Error('SCOPE_AFFECTED_COVERAGE_OMITTED');
    const source=d.facts.coverageScope,expected=proposal.basis.partitions.filter(p=>source.kind==='WHOLE_WARD'||proposal.mapping.some(m=>m.version===source.version&&m.partitionId&&source.partitionIds.includes(m.partitionId)&&m.toAliases.includes(p.sourceAlias))).map(p=>p.id);
    const successors=allWrites.filter(w=>w.action==='CREATE'&&(w.facts as WardNursingFacts).handover.kind==='CONFIRMED_HANDOVER'&&((w.facts as WardNursingFacts).handover as Extract<WardNursingFacts['handover'],{kind:'CONFIRMED_HANDOVER'}>).source.id===h.id);
    if(!successors.length||successors.some(w=>localTime(w.validFrom)!==ending||w.validTo!==wardNursingHandoverEnd(h,ending)))throw new Error('HANDOVER_NOT_CONFIRMED');
    if(successors.some(w=>(w.facts as WardNursingFacts).isPrimary!==d.facts.isPrimary))throw new Error('HANDOVER_PRIMARY_DISCONTINUITY');
    const actual=successors.flatMap(w=>{const c=(w.facts as WardNursingFacts).coverageScope;if(c.kind!=='PARTITIONS'||c.scopeSetId!==proposal.basis.scopeSetId||c.version!==proposal.basis.version)throw new Error('SCOPE_BASIS_MISMATCH');return c.partitionIds;});
    if(new Set(actual).size!==actual.length||expected.length!==actual.length||expected.some(id=>!actual.includes(id)))throw new Error('HANDOVER_NOT_CONFIRMED');
   }
  }const targets=new Set<string>();for(const m of result)for(const c of m.unit.commands)if(c.target){const key=c.target.owner+'/'+c.target.id;if(targets.has(key))throw new Error('BATCH_CONFLICT');targets.add(key);}return result;
  })));
  });
 };
 const authorizeMembers=async(s:Scope,actor:string,value:LifecycleStage,permission:'READ'|'WRITE'|'REVIEW',approval=false)=>{
  for(const member of value.members){const owner=memberPort(member.owner),r=await owner.lifecycleReferenceInTransaction(s,actor,member.inputId),input=nativeInput(r,value.requestId);await owner.lifecyclePort.authorize(s,actor,input,permission);if(approval)await owner.lifecyclePort.authorizeApproval?.(s,actor,input);}
 };
 const observedDigest=(items:Member[],dependencies:unknown)=>planBinding(provider,'CARE_LIFECYCLE_MEMBERS_V1',{items,dependencies});
 const context=async(s:Scope,actor:string,candidate:{candidateId:string;digest:string},member:Member,phase:'FREEZE'|'APPLY',recordAt:string|null)=>{
  await record(s,actor,'CONTEXT',{...candidate,owner:member.owner,inputId:member.reference.inputId,phase,recordAt});
 };
 const observe=async(s:Scope,actor:string,input:PlanOwnerUnitInput)=>{const r=await read(s,actor,input.jobId),value=unseal(r);let items:Member[],dependencies:Awaited<ReturnType<typeof affected>>;try{items=await members(s,actor,value);dependencies=await affected(s,actor,value,items);}catch(error){if(error instanceof Error&&['ACCESS_DENIED','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE'].includes(error.message))throw error;throw new Error('STALE_VALIDATION');}if(observedDigest(items,dependencies)!==r.observationDigest)throw new Error('STALE_VALIDATION');return {r,value,items,dependencies};};
 const frozenMembers=(unit:ObservedOwnerUnit)=>unit.basis['members'] as Member[];
 const endingMember=(m:Member)=>{const writes=m.unit.commands.find(c=>c.value['writes'])?.value['writes'];if(!writes)return false;const values:Array<{action:string}>=JSON.parse(writes);return values.length>0&&values.every(w=>w.action==='END'||w.action==='RETIRE');};
 const port:ApplyOwnerPort={
  async authorize(s,actor,input,p){const r=await read(s,actor,input.jobId,p);if(r.revision!==input.revisionId||r.campus!==input.campus)throw new Error('STALE_REVISION');await authorizeMembers(s,actor,unseal(r),p);},
  async authorizeApproval(s,actor,input){const r=await read(s,actor,input.jobId,'REVIEW');await authorizeMembers(s,actor,unseal(r),'REVIEW',true);},
  async authorizeFrozen(s,actor,unit){for(const m of frozenMembers(unit))await memberPort(m.owner).lifecyclePort.authorizeFrozen?.(s,actor,m.unit);},
  async observe(s,actor,input){const {r,value,items,dependencies}=await observe(s,actor,input),commands:ObservedOwnerUnit['commands']=[];for(const {index,m} of items.map((m,index)=>({m,index})).sort((a,b)=>Number(!endingMember(a.m))-Number(!endingMember(b.m))))for(const command of m.unit.commands)commands.push({...command,row:commands.length+1,aliases:[],value:{member:String(index),nativeRow:String(command.row)}});return {input,atomicRule:'CARE_LOCATION_LIFECYCLE_V1',basis:{input:value,inputDigest:r.digest,verification:r.verification,members:items,dependencies},commands,diff:items.flatMap(m=>m.unit.diff.map(change=>({owner:m.owner,change})))};},
  async validate(s,actor,unit){const r=await read(s,actor,unit.input.jobId);if(!r.verification||r.verification.observationDigest!==r.observationDigest)throw new Error('LEGAL_REVIEW_REQUIRED');await record(s,actor,'CHECK_VERIFICATION',{inputId:r.id});await authorizeMembers(s,r.verification.actor,unseal(r),'REVIEW',true);for(const m of frozenMembers(unit))await memberPort(m.owner).lifecyclePort.validate(s,actor,m.unit);},
  async afterFreeze(s,actor,unit,c){await record(s,actor,'BIND',{inputId:unit.input.jobId,...c});for(const m of frozenMembers(unit)){await context(s,actor,c,m,'FREEZE',null);await memberPort(m.owner).lifecyclePort.afterFreeze?.(s,actor,m.unit,c);}},
  async apply(s,actor,command,_resolved,c){const cached=applyUnits.get(s);if(!cached)throw new Error('INVALID_PLAN_TOKEN');const m=cached.items[Number(command.value['member'])];if(!m)throw new Error('INVALID_PLAN_TOKEN');const native=m.unit.commands.find(v=>String(v.row)===command.value['nativeRow']);if(!native)throw new Error('INVALID_PLAN_TOKEN');await context(s,actor,c,m,'APPLY',cached.recordAt);const p=memberPort(m.owner);return p.lifecycleApplyAtInTransaction?p.lifecycleApplyAtInTransaction(s,actor,native,new Map(),c,cached.recordAt):p.lifecyclePort.apply(s,actor,native,new Map(),c);},
  async exactRead(s,actor,input,fact){const r=await read(s,actor,input.jobId);for(const member of unseal(r).members){const owner=memberPort(member.owner),reference=await owner.lifecycleReferenceInTransaction(s,actor,member.inputId),found=await owner.lifecyclePort.exactRead(s,actor,nativeInput(reference,input.requestId),fact);if(found)return found;}return null;},
  async beforeCommit(s,actor,unit,c,facts){const recordAt=applyUnits.get(s)?.recordAt;if(!recordAt)throw new Error('INVALID_PLAN_TOKEN');await verifyMoveDisposition(s,actor,unit,recordAt);await record(s,actor,'COMMIT_CHECK',{inputId:unit.input.jobId,...c,facts,recordAt});},
 };
 const applyUnits=new WeakMap<Scope,{items:Member[];recordAt:string}>();
 const originalObserve=port.observe;
 port.observe=async(s,actor,input)=>{const unit=await originalObserve(s,actor,input);const point=(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;applyUnits.set(s,{items:frozenMembers(unit),recordAt:point});return unit;};
 const coordinator=applyCoordinator(db,provider,port);
 const stageIn=async(s:Scope,actor:string,input:LifecycleStage)=>{if(s.recordAsOf)throw new Error('READ_CONTEXT_WRITE_FORBIDDEN');check(LifecycleStageSchema,input);input=structuredClone(input);localTime(input.cutover);await authorizeMembers(s,actor,input,'WRITE');const prior=await record<{inputId:string;revisionId:string;digest:string}|null>(s,actor,'LOOKUP_STAGE',{requestId:input.requestId,inputDigest:planBinding(provider,'CARE_LIFECYCLE_INPUT_V1',input)});if(prior)return prior;const items=await members(s,actor,input),dependencies=await affected(s,actor,input,items);return record<{inputId:string;revisionId:string;digest:string}>(s,actor,'STAGE',{requestId:input.requestId,campus:input.campus,...seal(input),members:items.map(m=>({...m.reference,owner:m.owner})),observationDigest:observedDigest(items,dependencies),targets:targetLinks(items)});};
 const stage=(actor:string,input:LifecycleStage)=>root(s=>stageIn(s,actor,input));
 const assessIn=async(s:Scope,actor:string,input:LifecycleAssessment)=>{check(LifecycleAssessmentSchema,input);if(input.validTo!==null&&localTime(input.validTo)<=localTime(input.validFrom))throw new Error('INVALID_BUSINESS_PERIOD');const point=input.recordAsOf?localTime(input.recordAsOf):(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;const report=await dependencyReport(s,actor,{...input.target,validFrom:input.validFrom,validTo:input.validTo,recordAsOf:point});return {target:input.target,recordAsOf:point,...report,dispositionStatus:report.items.length?'OPEN' as const:'NO_IMPLEMENTED_REFERENCE' as const,clinicalReadiness:'NOT_READY' as const};};
 return {
  stage,
  stageInTransaction:stageIn,
  assessSpaceMoveInTransaction:assessIn,
  async assessSpaceMove(actor:string,input:LifecycleAssessment){return root(s=>assessIn(s,actor,input));},
  async verify(actor:string,input:LifecycleVerification){check(LifecycleVerifySchema,input);return root(async s=>{const r=await read(s,actor,input.inputId,'REVIEW');if(r.digest!==input.inputDigest)throw new Error('STALE_VALIDATION');const value=unseal(r);await authorizeMembers(s,actor,value,'REVIEW',true);const items=await members(s,actor,value);const dependencies=await affected(s,actor,value,items);if(observedDigest(items,dependencies)!==r.observationDigest)throw new Error('STALE_VALIDATION');return record<{verificationId:string}>(s,actor,'VERIFY',{...input,...seal(input,'CARE_LIFECYCLE_VERIFY_V1'),observationDigest:r.observationDigest});});},
  async preview(actor:string,input:{inputId:string}){check(LifecycleInputSchema,input);return root(async s=>{const r=await read(s,actor,input.inputId),value=unseal(r),items=await members(s,actor,value),dependencies=await affected(s,actor,value,items);return {dependencies,decision:observedDigest(items,dependencies)===r.observationDigest?'PASS' as const:'STALE' as const,changes:items.flatMap(m=>m.unit.diff.map(change=>({owner:m.owner,change}))),policy:'TEST_POLICY_ONLY' as const,clinicalReadiness:'NOT_READY' as const};});},
  async plan(actor:string,input:{inputId:string;requestId:string}){check(LifecyclePlanSchema,input);const r=await root(s=>read(s,actor,input.inputId,'WRITE'));return coordinator.planOwnerUnit(actor,{jobId:r.id,revisionId:r.revision,requestId:input.requestId,scope:'SYNTHETIC',campus:r.campus,purpose:'IDENTITY_VERIFY'});},
  readApplyCandidate:coordinator.readApplyCandidate,approveApplyUnit:coordinator.approveApplyUnit,applyUnit:coordinator.applyUnit,resumeOutcome:coordinator.resumeOutcome,reconcileCommittedUnit:coordinator.reconcileCommittedUnit,
  async history(actor:string,input:{inputId:string;businessAt?:string;recordAsOf?:string}){check(LifecycleHistorySchema,input);return root(async s=>{
   const r=await read(s,actor,input.inputId),value=unseal(r);await authorizeMembers(s,actor,value,'READ');const point=input.recordAsOf?localTime(input.recordAsOf):(await sql<{v:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') v`.execute(s)).rows[0]!.v;if(point<r.recordedAt)throw new Error('NOT_FOUND');const at=input.businessAt?localTime(input.businessAt):value.cutover,current=[];
   for(const target of r.targets){const report=await dependencyReport(s,actor,{...target,validFrom:at,validTo:null,recordAsOf:point}),port=ports[target.kind],lifecycle=port?.lifecycleStateInTransaction?await port.lifecycleStateInTransaction(s,actor,{id:target.id,businessAt:at,recordAsOf:point}):{id:target.id,state:'NOT_EVALUABLE',head:null};current.push({target,lifecycle,...report,dispositionStatus:report.items.length?'OPEN':'IMPLEMENTED_REFERENCES_CLOSED',overallDisposition:'NOT_EVALUABLE'});}
   const v=r.verification&&r.verification.recordedAt<=point?r.verification:null,verification=v?{id:v.id,recordedAt:v.recordedAt,actor:v.actor,identity:v.identity,digest:v.digest,observationDigest:v.observationDigest,basis:v.envelope?unseal<LifecycleVerification>({digest:v.digest,envelope:v.envelope},'CARE_LIFECYCLE_VERIFY_V1',LifecycleVerifySchema):null}:null;
   return {input:value,originalAcceptedBasis:{inputDigest:r.digest,observationDigest:r.observationDigest,verification},currentDependencyReview:{businessAt:at,recordAsOf:point,items:current},policy:'TEST_POLICY_ONLY' as const,clinicalReadiness:'NOT_READY' as const};
  });},
  async close(){await db.destroy();},
 };
}
export type CareLocationLifecycleOwner=ReturnType<typeof openCareLocationLifecycle>;
