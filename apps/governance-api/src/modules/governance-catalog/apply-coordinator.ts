import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {sql,type Kysely} from 'kysely';
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import type {KeyProviderPort} from './protected-artifact.js';
import {CatalogTransactionScope} from './transaction-scope.js';
import {canonicalPlan,planBinding,equalBinding} from './plan-binding.js';

const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
export const PlanOwnerUnitSchema=Type.Object({requestId:Id,jobId:Id,revisionId:Id,scope:Type.Literal('SYNTHETIC'),campus:Type.Union([Type.Literal('NORTH'),Type.Literal('SOUTH')]),purpose:Type.Union([Type.Literal('IDENTITY_VERIFY'),Type.Literal('CONTACT_VERIFY'),Type.Literal('HR_RESTRICTED')])},{additionalProperties:false});
export const ApproveApplyUnitSchema=Type.Object({candidateId:Id,digest:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false});
export const ApplyUnitSchema=Type.Object({candidateId:Id,requestId:Id},{additionalProperties:false});
export type PlanOwnerUnitInput=Static<typeof PlanOwnerUnitSchema>;
export type ApplyUnitInput=Static<typeof ApplyUnitSchema>;
export interface OwnerFact {owner:string;id:string;version:string;source?:{dataset:string;row:number;step:string}}
export interface OwnerCommand {owner:string;row:number;intent:'CREATE'|'REVISE';target:OwnerFact|null;aliases:number[];value:Record<string,string>}
export interface ObservedOwnerUnit {
 input:PlanOwnerUnitInput;
 // The registered Owner reads these from its trusted source, never from caller-supplied rows.
 basis:Record<string,unknown>;
 atomicRule:string;
 commands:OwnerCommand[];
 diff:unknown[];
}
/** Internal composition port. No SQL, transaction root, test flag or registry in public commands. */
export interface ApplyOwnerPort {
 observe(scope:CatalogTransactionScope,actor:string,input:PlanOwnerUnitInput):Promise<ObservedOwnerUnit>;
 authorize(scope:CatalogTransactionScope,actor:string,input:PlanOwnerUnitInput,action:'READ'|'WRITE'|'REVIEW'):Promise<void>;
 authorizeApproval?(scope:CatalogTransactionScope,actor:string,input:PlanOwnerUnitInput):Promise<void>;
 authorizeFrozen?(scope:CatalogTransactionScope,actor:string,unit:ObservedOwnerUnit):Promise<void>;
 // FREEZE may retain an Owner-declared blocked observation for review. Omitted
 // means full admission; approval and apply never accept a freeze-only decision.
 validate(scope:CatalogTransactionScope,actor:string,unit:ObservedOwnerUnit,stage?:'FREEZE'):Promise<void>;
 apply(scope:CatalogTransactionScope,actor:string,command:OwnerCommand,resolved:ReadonlyMap<number,OwnerFact>,approval:{candidateId:string;digest:string}):Promise<{ok:true;fact:OwnerFact}|{ok:false}>;
 exactRead(scope:CatalogTransactionScope,actor:string,input:PlanOwnerUnitInput,fact:OwnerFact):Promise<OwnerFact|null>;
 beforeCommit?(scope:CatalogTransactionScope,actor:string,unit:ObservedOwnerUnit,approval:{candidateId:string;digest:string},facts:OwnerFact[]):Promise<void>;
}
interface Candidate {id:string;maker:string;makerIdentity:string;input:PlanOwnerUnitInput;digest:string;envelope:Envelope;approvedBy:string|null}
interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
export interface UnitOutcome {status:'COMMITTED';candidateId:string;requestId:string;facts:OwnerFact[];recordedAt:string}
const codes=new Set(['CAMPUS_RETIRED','CAMPUS_SUSPENDED','DISPOSITION_INCOMPLETE','DISPOSITION_ALREADY_COMPLETE','ACCESS_DENIED','NOT_FOUND','REQUEST_CONFLICT','STALE_VALIDATION','APPROVAL_REQUIRED','CANDIDATE_REVIEW_REQUIRED','MAKER_CHECKER_REQUIRED','BLOCKED_DEPENDENCY','KEY_UNAVAILABLE','CLOSED_INPUT_REQUIRED','PLAN_INPUT_LIMIT','INVALID_PLAN_TOKEN','OWNER_REJECTED','PAYLOAD_UNAVAILABLE','IDENTIFIER_CONFLICT','LICENSE_END_UNKNOWN','LICENSE_PERIOD_NOT_COVERED','LICENSE_ID_MISMATCH','PRIMARY_OPERATOR_CONFLICT','OPERATING_CLOSED','PAIR_PREAUTHORIZATION_REQUIRED','STALE_REVISION','BUNDLE_CONTEXT_REQUIRED','LEGAL_REVIEW_REQUIRED','BATCH_REJECTED','UNSUPPORTED_STATE_TRANSITION','PARENT_PERIOD_NOT_COVERED']);
function failure(error:unknown):Error {
 const mappingCodes=['MAPPING_ALREADY_REGISTERED','MAPPING_IDENTITY_IMMUTABLE','MAPPING_RETRACTED','BATCH_CONFLICT','IDENTIFIER_IDENTITY_IMMUTABLE','IDENTIFIER_CLOSED','SOURCE_MAPPING_REQUIRED','IDENTIFIER_RESOLUTION_FORBIDDEN','SUCCESSION_SHAPE','SUCCESSION_SELF','SUCCESSION_CYCLE','CONTEXT_REQUIRED','LOCAL_TIME_REQUIRED'];
 const code=typeof error==='object'&&error!==null&&'code' in error?error.code:null;
 const message=error instanceof Error?error.message:'';
 if((typeof code==='string'&&(/^08[A-Z0-9]{3}$/.test(code)||['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','57P01'].includes(code)))||
  ['Connection terminated unexpectedly','Connection terminated','Connection terminated due to connection timeout'].includes(message))return new Error('TRANSPORT_FAILED');
 return new Error(codes.has(message)||mappingCodes.includes(message)?message:'APPLY_FAILED');
}
function check<S>(schema:S,input:unknown):void {if(!Check(schema as never,input))throw new Error('CLOSED_INPUT_REQUIRED');}
function bound(unit:ObservedOwnerUnit):void {
 const blockedOrganizationRevision=['ORG22_WHOLE_REVISION_V1','ORG23_WHOLE_REVISION_V1','ORG_EVOLUTION_WHOLE_EVENT_V1'].includes(unit.atomicRule)&&Array.isArray(unit.basis['issues'])&&unit.basis['issues'].length>0;
 if(!unit.atomicRule||(unit.commands.length<1&&unit.atomicRule!=='ORG04_ROW_INDEPENDENT_V1'&&!blockedOrganizationRevision)||unit.commands.length>100||Buffer.byteLength(canonicalPlan(unit))>524288)throw new Error('PLAN_INPUT_LIMIT');
 const seen=new Set<number>();
 for(const c of unit.commands){
  // Owner declares the whole unit and an execution order; the Coordinator never splits or infers bundles.
  if(!Number.isInteger(c.row)||c.row<1||seen.has(c.row)||c.aliases.some(row=>!seen.has(row)))throw new Error('BLOCKED_DEPENDENCY');
  seen.add(c.row);
 }
}

export function applyCoordinator(db:Kysely<DB>,provider?:KeyProviderPort,owner?:ApplyOwnerPort){
 const port=()=>{if(!owner)throw new Error('BLOCKED_DEPENDENCY');return owner;};
 const root=async<T>(work:(scope:CatalogTransactionScope)=>Promise<T>):Promise<T>=>{
  // Readiness precedes even acquiring a connection: persistent deployments may still be at 0037.
  port();
  return db.transaction().execute(async trx=>{
  // Same serialization lock as current authorization/catalog/source changes. No movable read savepoint.
  await sql`select pg_advisory_xact_lock(901002)`.execute(trx);
  return work(CatalogTransactionScope.from(trx));
  });
 };
 const record=async<T>(scope:CatalogTransactionScope,actor:string,action:string,input:unknown):Promise<T>=>
  (await sql<{result:T}>`select governance_catalog.apply_record(${actor},${action},${JSON.stringify(input)}::jsonb) as result`.execute(scope)).rows[0]!.result;
 const seal=(unit:ObservedOwnerUnit,digest:string):Envelope=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  const {id,key}=provider.current();const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,nonce);
  cipher.setAAD(Buffer.from(digest));
  const bytes=Buffer.from(canonicalPlan(unit));
  try{return {keyId:id,nonce:nonce.toString('base64'),...(()=>{
   const ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]);
   return {tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
  })()};}finally{bytes.fill(0);}
 };
 const unseal=(candidate:Candidate):ObservedOwnerUnit=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  const e=candidate.envelope;const decipher=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'base64'));
  decipher.setAAD(Buffer.from(candidate.digest));decipher.setAuthTag(Buffer.from(e.tag,'base64'));
  const bytes=Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'base64')),decipher.final()]);
  try{const unit=JSON.parse(bytes.toString()) as ObservedOwnerUnit;bound(unit);
   if(!equalBinding(planBinding(provider,'APPROVED_OWNER_UNIT_V1',unit),candidate.digest))throw new Error('INVALID_PLAN_TOKEN');
   return unit;
  }finally{bytes.fill(0);}
 };
 const candidate=async(scope:CatalogTransactionScope,actor:string,id:string,permission:'READ'|'WRITE'|'REVIEW')=>{
  const c=await record<Candidate>(scope,actor,'READ_CANDIDATE',{candidateId:id});
  await port().authorize(scope,actor,c.input,'READ');
  if(permission!=='READ')await port().authorize(scope,actor,c.input,permission);
  if(port().authorizeFrozen)await port().authorizeFrozen!(scope,actor,unseal(c));
  return c;
 };
 const recheck=async(scope:CatalogTransactionScope,actor:string,c:Candidate)=>{
  const current=await port().observe(scope,actor,c.input);bound(current);
  if(!equalBinding(c.digest,planBinding(provider,'APPROVED_OWNER_UNIT_V1',current)))throw new Error('STALE_VALIDATION');
  await port().validate(scope,actor,current);
  return current;
 };
 return {
  // Routing hints are authenticated metadata only; the selected Owner must authorize the candidate.
  async candidateRoutingInTransaction(scope:CatalogTransactionScope,actor:string,input:{candidateId:string}){
   check(Type.Object({candidateId:Id},{additionalProperties:false}),input);
   const c=await record<Candidate>(scope,actor,'READ_CANDIDATE',input),unit=unseal(c);
   return {atomicRule:unit.atomicRule,owners:[...new Set(unit.commands.map(command=>command.owner))]};
  },
  async authorizeCandidateAccessInTransaction(scope:CatalogTransactionScope,actor:string,input:{candidateId:string}){
   check(Type.Object({candidateId:Id},{additionalProperties:false}),input);
   try{await candidate(scope,actor,input.candidateId,'READ');}catch(error){throw failure(error);}
  },
  async readApplyCandidateAccess(actor:string,input:{candidateId:string}){
   check(Type.Object({candidateId:Id},{additionalProperties:false}),input);input=structuredClone(input);
   try{
    await root(scope=>candidate(scope,actor,input.candidateId,'READ'));
    // Each advisory permission probe owns its rollback; a SQL denial cannot poison the next probe.
    const allowed=async(action:'WRITE'|'REVIEW')=>{try{return await root(async scope=>{await candidate(scope,actor,input.candidateId,action);return true;});}catch(error){if(error instanceof Error&&error.message==='ACCESS_DENIED')return false;throw error;}};
    return {candidateId:input.candidateId,canReview:await allowed('REVIEW'),canExecute:await allowed('WRITE')};
   }catch(error){throw failure(error);}
  },
  async previewOwnerUnit(actor:string,input:PlanOwnerUnitInput){
   check(PlanOwnerUnitSchema,input);input=structuredClone(input);
   try{return await root(async scope=>{
    await port().authorize(scope,actor,input,'READ');
    const unit=await port().observe(scope,actor,input);bound(unit);await port().validate(scope,actor,unit);
    return {status:'OBSERVED' as const,unit};
   });}catch(error){throw failure(error);}
  },
  async planOwnerUnit(actor:string,input:PlanOwnerUnitInput){
   check(PlanOwnerUnitSchema,input);input=structuredClone(input);
   try{return await root(async scope=>{
    await port().authorize(scope,actor,input,'WRITE');
    await port().authorize(scope,actor,input,'READ');
    // Recovery returns the immutable observation, never implicitly replans changed evidence.
    const prior=await record<{candidateId:string;digest:string}|null>(scope,actor,'FROZEN_PRIOR',{input});
    if(prior){await candidate(scope,actor,prior.candidateId,'WRITE');return prior;}
    const unit=await port().observe(scope,actor,input);bound(unit);await port().validate(scope,actor,unit,'FREEZE');
    const digest=planBinding(provider,'APPROVED_OWNER_UNIT_V1',unit);
    return record<{candidateId:string;digest:string}>(scope,actor,'FREEZE',{input,digest,envelope:seal(unit,digest)});
   });}catch(error){throw failure(error);}
  },
  async readApplyCandidate(actor:string,input:{candidateId:string}){
   check(Type.Object({candidateId:Id},{additionalProperties:false}),input);input=structuredClone(input);
   try{
    // This root only authorizes and audits a candidate read. Commit that audit before
    // releasing sensitive content; it is never used by the Apply write transaction.
    const c=await root(async scope=>{
     const c=await candidate(scope,actor,input.candidateId,'REVIEW');
     await record(scope,actor,'READ_SENSITIVE',{candidateId:c.id});
     return c;
    });
    const unit=unseal(c);
    // A committed access attempt alone is not proof that decryption succeeded.
    // Record readiness under fresh authorization before returning the reviewed contents.
    await root(async scope=>{
     await candidate(scope,actor,c.id,'REVIEW');
     await record(scope,actor,'READ_READY',{candidateId:c.id});
    });
    return {candidateId:c.id,digest:c.digest,unit,approvedBy:c.approvedBy};
   }catch(error){throw failure(error);}
  },
  async approveApplyUnit(actor:string,input:Static<typeof ApproveApplyUnitSchema>){
   check(ApproveApplyUnitSchema,input);input=structuredClone(input);
   try{return await root(async scope=>{
    const c=await candidate(scope,actor,input.candidateId,'REVIEW');
    if(!equalBinding(c.digest,input.digest))throw new Error('STALE_VALIDATION');
    await port().authorizeApproval?.(scope,actor,c.input);
    const approvedUnit=unseal(c);await recheck(scope,actor,c);if(approvedUnit.commands.length===0)throw new Error('BATCH_REJECTED');
    return record<{candidateId:string;approvedBy:string}>(scope,actor,'APPROVE',input);
   });}catch(error){throw failure(error);}
  },
  async applyUnit(actor:string,input:ApplyUnitInput,afterCommit?:(outcome:UnitOutcome)=>Promise<void>){
   check(ApplyUnitSchema,input);input=structuredClone(input);
   let outcome:UnitOutcome;let attemptedCommit=false;
   try{outcome=await root(async scope=>{
    const c=await candidate(scope,actor,input.candidateId,'READ');
    if(input.requestId!==c.input.requestId)throw new Error('REQUEST_CONFLICT');
    const prior=await record<UnitOutcome|null>(scope,actor,'RESUME',input);
    if(prior){attemptedCommit=true;return prior;}
    await port().authorize(scope,actor,c.input,'WRITE');
    if(!c.approvedBy)throw new Error('APPROVAL_REQUIRED');
    // Both executor and original approver must retain current permissions until this commit.
    await port().authorize(scope,c.approvedBy,c.input,'REVIEW');
    await port().authorizeApproval?.(scope,c.approvedBy,c.input);
    await record(scope,c.approvedBy,'CHECK_APPROVAL',{candidateId:c.id});
    // Admission belongs to approval/apply, never to reading immutable history.
    // Recheck the approver's source/material permissions in this same write root.
    await recheck(scope,c.approvedBy,c);
    const unit=unseal(c);await recheck(scope,actor,c);if(unit.commands.length===0)throw new Error('BATCH_REJECTED');
    const resolved=new Map<number,OwnerFact>();
    for(const command of unit.commands){
     const result=await port().apply(scope,actor,command,resolved,{candidateId:c.id,digest:c.digest});
     if(!result.ok)throw new Error('OWNER_REJECTED');
     resolved.set(command.row,result.fact);
    }
    await port().beforeCommit?.(scope,actor,unit,{candidateId:c.id,digest:c.digest},[...resolved.values()]);
    const result=await record<UnitOutcome>(scope,actor,'COMMIT',{...input,facts:[...resolved.values()]});
    attemptedCommit=true;
    return result;
   });}catch(error){
    // SQL/domain errors before COMMIT are definite rollback. An ACK failure is not proof of rollback.
    if(attemptedCommit)return {status:'COMMIT_UNKNOWN' as const,candidateId:input.candidateId,requestId:input.requestId};
    throw failure(error);
   }
   if(afterCommit){try{await afterCommit(outcome);}catch{return {...outcome,responseStatus:'POST_COMMIT_FAILED' as const};}}
   return {...outcome,responseStatus:'DELIVERED' as const};
  },
  async resumeOutcome(actor:string,input:ApplyUnitInput){
   check(ApplyUnitSchema,input);input=structuredClone(input);
   try{return await root(async scope=>{
    await candidate(scope,actor,input.candidateId,'READ');
    return record<UnitOutcome|null>(scope,actor,'RESUME',input);
   });}catch(error){throw failure(error);}
  },
  async reconcileCommittedUnit(actor:string,input:ApplyUnitInput){
   check(ApplyUnitSchema,input);input=structuredClone(input);
   try{return await root(async scope=>{
    const c=await candidate(scope,actor,input.candidateId,'READ');
    const outcome=await record<UnitOutcome|null>(scope,actor,'RESUME',input);
    if(!outcome)throw new Error('NOT_FOUND');
    const observed=await Promise.all(outcome.facts.map(fact=>port().exactRead(scope,actor,c.input,fact)));
    const matched=canonicalPlan(observed)===canonicalPlan(outcome.facts);
    return record<{status:'MATCHED'|'MISMATCH';receiptId:string}>(scope,actor,'RECONCILE',{...input,matched});
   });}catch(error){throw failure(error);}
  }
 };
}
