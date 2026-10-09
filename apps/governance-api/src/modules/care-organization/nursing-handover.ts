import {wardNursingHandoverEnd} from './ward-nursing-timeline.js';
import {createDecipheriv,createHmac} from 'node:crypto';
import {sql} from 'kysely';
import {authenticateRegistrationEvidence,canonicalPlan,planBinding,type CatalogTransactionScope,type ImportJob,type KeyProviderPort} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
import {nursingCheck} from './nursing-contracts.js';
import {WardNursingStoredStageSchema,type WardNursingHistory,type WardNursingStoredStage} from './ward-nursing-contracts.js';
import {validateScopeRepartition} from './scope-repartition.js';
import {sameCoverage,wardNursingEnd,partialHandover} from './ward-nursing-timeline.js';
import {NursingHandoverBindingSchema,NursingHandoverConfirmSchema,NursingHandoverConfirmationBasisSchema,type NursingHandoverBinding,type NursingHandoverConfirm,type NursingHandoverConfirmation,type NursingHandoverConfirmationBasis,type NursingHandoverConfirmedBasis} from './nursing-handover-contracts.js';

interface Envelope {keyId:string;nonce:string;tag:string;ciphertext:string}
interface InputRecord {digest:string;scope:'NORTH'|'SOUTH';identity_code:string;withdrawn?:boolean;envelope:Envelope}
interface ConfirmationRead {confirmationId:string;digest:string;recordedAt:string;materialDigest:string;sourceVersionId:string;campus:'NORTH'|'SOUTH';evidenceId:string}
const binding=(input:NursingHandoverBinding):NursingHandoverBinding=>({inputId:input.inputId,inputDigest:input.inputDigest,row:input.row,handover:{...structuredClone(input.handover),cutover:localTime(input.handover.cutover),coverage:input.handover.coverage.kind==='PARTITIONS'?{...input.handover.coverage,partitionIds:[...input.handover.coverage.partitionIds].sort()}:input.handover.coverage}});

/** Nursing owns this confirmation; Ward/Nursing coverage consumes its immutable exact basis. */
export function nursingHandover(provider:KeyProviderPort){
 const material=async(s:CatalogTransactionScope,actor:string,id:string,sourceVersionId:string,campus:string)=>{
  const proof=(await sql<{r:Parameters<typeof authenticateRegistrationEvidence>[0]}>`select governance_catalog.registration_evidence(${actor},${id}::uuid,${sourceVersionId}::uuid,${campus}) r`.execute(s)).rows[0]!.r;
  const bytes=authenticateRegistrationEvidence(proof,provider);
  try{return planBinding(provider,'NURSING_HANDOVER_MATERIAL_V1',bytes.toString('base64'));}finally{bytes.fill(0);}
 };
 const unseal=(record:InputRecord):WardNursingStoredStage=>{
  try{
   const e=record.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));
   d.setAAD(Buffer.from('WARD_NURSING_INPUT_V1\0'+record.digest));d.setAuthTag(Buffer.from(e.tag,'hex'));
   const bytes=Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);
   try{const value:unknown=JSON.parse(bytes.toString());nursingCheck(WardNursingStoredStageSchema,value);if(planBinding(provider,'WARD_NURSING_INPUT_V1',value)!==record.digest)throw new Error();return value as WardNursingStoredStage;}finally{bytes.fill(0);}
  }catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 };
 return {
  async confirm(s:CatalogTransactionScope,actor:string,input:NursingHandoverConfirm):Promise<NursingHandoverConfirmation>{
   nursingCheck(NursingHandoverConfirmSchema,input);input=structuredClone(input);const expected=binding(input),handover=expected.handover;
   const record=(await sql<{r:InputRecord}>`select care_organization.ward_nursing_input_read(${actor},${input.inputId}::uuid,'READ_RESTRICTED') r`.execute(s)).rows[0]!.r;
   if(record.withdrawn)throw new Error('INPUT_WITHDRAWN');if(record.digest!==input.inputDigest)throw new Error('STALE_VALIDATION');
   const value=unseal(record);if(value.kind!=='COVERAGE')throw new Error('HANDOVER_NOT_CONFIRMED');
   const entry=value.entries[input.row-1];
   const source=(await sql<{r:WardNursingHistory}>`select care_organization.ward_nursing_snapshot(${actor},${handover.source.id}::uuid) r`.execute(s)).rows[0]!.r;
   const head=source.versions.at(-1),declaration=source.versions.filter(v=>v.action==='CREATE'||v.action==='REVISE').at(-1);
   if(!head||head.number!==handover.source.expectedHead||!declaration)throw new Error('STALE_HEAD');
   let targetCampus=source.applicability.campus.id;
   if(handover.partitionPlan?.repartition){const ref=handover.partitionPlan.repartition,producer=(await sql<{r:InputRecord&{revision:string;job_revision:string;id:string}}>`select care_organization.ward_nursing_input_read(${actor},${ref.inputId}::uuid,'READ_RESTRICTED') r`.execute(s)).rows[0]!.r;
    const request=unseal(producer),job=(await sql<{r:ImportJob}>`select care_organization.ward_nursing_job_read(${actor},${ref.inputId}::uuid) r`.execute(s)).rows[0]!.r;
    if(request.kind!=='SCOPE_REVISION'||producer.withdrawn||producer.digest!==ref.digest||producer.revision!==ref.revisionId||job.contract.versionId!==ref.contractVersionId||job.currentRevisionId!==producer.job_revision)throw new Error('STALE_VALIDATION');
    if(request.definition.applicability.ward.id!==source.applicability.ward.id||request.definition.applicability.purpose!==source.applicability.purpose)throw new Error('HANDOVER_NOT_CONFIRMED');
    targetCampus=request.definition.applicability.campus.id;
    const slots=(await sql<{r:{scopeSetId:string;version:string;partitions:Array<{id:string;sourceAlias:string}>}}>`select care_organization.ward_nursing_scope_proposal_read(${actor},${ref.inputId}::uuid) r`.execute(s)).rows[0]!.r;
    await validateScopeRepartition(s,actor,handover,declaration.facts.coverageScope,{basis:{scopeSetId:slots.scopeSetId,version:slots.version,inputId:producer.id,inputDigest:producer.digest,partitions:request.definition.partitions.map(p=>({...p,id:slots.partitions.find(q=>q.sourceAlias===p.sourceAlias)!.id})),validFrom:localTime(request.definition.validFrom),validTo:request.definition.validTo===null?null:localTime(request.definition.validTo)},mapping:request.mapping,applicability:request.definition.applicability,affected:[]});
   }
   const partial=partialHandover(handover,declaration.facts.coverageScope);
   if(entry?.action==='CREATE'){if((entry.row.is_primary==='Y')!==declaration.facts.isPrimary)throw new Error('HANDOVER_PRIMARY_DISCONTINUITY');if((entry.row.valid_to===null?null:localTime(entry.row.valid_to))!==wardNursingHandoverEnd(source,handover.cutover))throw new Error('HANDOVER_NOT_CONFIRMED');}
   if(partial)for(const successor of handover.partitionPlan!.successors){const matches=value.entries.filter(e=>e.action==='CREATE'&&e.row.ward_nursing_rel_id===successor.sourceAlias&&e.applicability.nursing.id===successor.nursing.id&&sameCoverage(e.coverage,successor.coverage));if(matches.length===1&&(matches[0]!.row.is_primary==='Y')!==declaration.facts.isPrimary)throw new Error('HANDOVER_PRIMARY_DISCONTINUITY');if(matches.length!==1||localTime(matches[0]!.row.valid_from)!==handover.cutover||(matches[0]!.row.valid_to===null?null:localTime(matches[0]!.row.valid_to))!==wardNursingHandoverEnd(source,handover.cutover))throw new Error('HANDOVER_NOT_CONFIRMED');}
   const terminal=wardNursingEnd(source);
   if(handover.cutover<localTime(declaration.validFrom)||(declaration.validTo!==null&&handover.cutover>localTime(declaration.validTo))||(terminal!==null&&handover.cutover>localTime(terminal)))throw new Error('HANDOVER_NOT_CONFIRMED');
   if(!entry||entry.action!=='CREATE'||entry.row.ward_nursing_rel_id!==handover.successorSourceAlias||entry.applicability.nursing.id!==handover.successorNursing.id||entry.row.nursing_unit_id!==handover.successorNursing.id
    ||entry.applicability.ward.id!==source.applicability.ward.id||entry.row.ward_id!==source.applicability.ward.id||entry.applicability.campus.id!==targetCampus||entry.applicability.purpose!==source.applicability.purpose
    ||(!partial&&source.applicability.nursing.id===entry.applicability.nursing.id)||localTime(entry.row.valid_from)!==handover.cutover||entry.row.handover_rule_ref!==handover.ruleReference
    ||!sameCoverage(entry.coverage,handover.coverage)||(!partial&&!sameCoverage(declaration.facts.coverageScope,handover.coverage))
    ||!value.entries.some(e=>e.action==='END'&&e.target.id===handover.source.id&&e.target.expectedHead===handover.source.expectedHead&&localTime(e.endAt)===handover.cutover))throw new Error('HANDOVER_NOT_CONFIRMED');
   const identity=(await sql<{r:string}>`select care_organization.nursing_authorize(${actor},${source.applicability.campus.id}::uuid,'REVIEW') r`.execute(s)).rows[0]!.r;
   const targetIdentity=(await sql<{r:string}>`select care_organization.nursing_authorize(${actor},${targetCampus}::uuid,'REVIEW') r`.execute(s)).rows[0]!.r;
   if(identity!==targetIdentity)throw new Error('STALE_VALIDATION');
   if(identity===record.identity_code)throw new Error('MAKER_CHECKER_REQUIRED');
   await sql`select care_organization.nursing_snapshot(${actor},${source.applicability.nursing.id}::uuid)`.execute(s);
   await sql`select care_organization.nursing_snapshot(${actor},${handover.successorNursing.id}::uuid)`.execute(s);
   const job=(await sql<{r:ImportJob}>`select care_organization.ward_nursing_job_read(${actor},${input.inputId}::uuid) r`.execute(s)).rows[0]!.r;
   const sourceVersionId=job.contract.definition.sourceVersionId;if(!sourceVersionId)throw new Error('BLOCKED_DEPENDENCY');
   const materialDigest=await material(s,actor,handover.evidenceId,sourceVersionId,record.scope);
   const digest=planBinding(provider,'NURSING_HANDOVER_CONFIRMATION_V1',{binding:expected,materialDigest,identity,reason:input.reason});
   const transaction=(await sql<{v:string}>`select pg_current_xact_id()::text v`.execute(s)).rows[0]!.v;
   const ticket=canonicalPlan({operation:'CONFIRM_COVERAGE_HANDOVER',actor,transaction,requestId:input.requestId,binding:expected,reason:input.reason,digest,materialDigest});
   const key=Buffer.from(planBinding(provider,'NURSING_SQL_AUTHORITY_V1',{}),'hex');
   try{return (await sql<{r:NursingHandoverConfirmation}>`select care_organization.nursing_handover_confirm(${ticket},${createHmac('sha256',key).update(ticket).digest('hex')}) r`.execute(s)).rows[0]!.r;}finally{key.fill(0);}
  },
  async read(s:CatalogTransactionScope,actor:string,basis:NursingHandoverConfirmationBasis,expected:NursingHandoverBinding):Promise<NursingHandoverConfirmedBasis>{
   nursingCheck(NursingHandoverConfirmationBasisSchema,basis);nursingCheck(NursingHandoverBindingSchema,expected);
   const proof=(await sql<{r:ConfirmationRead}>`select care_organization.nursing_handover_confirmation_read(${actor},${basis.id}::uuid,${basis.digest},${JSON.stringify(binding(expected))}::jsonb) r`.execute(s)).rows[0]!.r;
   if(await material(s,actor,proof.evidenceId,proof.sourceVersionId,proof.campus)!==proof.materialDigest)throw new Error('STALE_VALIDATION');
   return {id:proof.confirmationId,digest:proof.digest,recordedAt:proof.recordedAt,materialDigest:proof.materialDigest};
  },
 };
}
