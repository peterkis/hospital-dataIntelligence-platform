import {createHash} from 'node:crypto';
import {sql} from 'kysely';
import {canonicalPlan,type CatalogTransactionScope} from '../../governance-catalog/index.js';
import {intersect,subtract} from '../../organization-master/index.js';
import {check} from './contracts.js';
import {ImpactCaseReadSchema,AssignImpactCaseSchema,RecordDispositionSchema,ApproveDispositionSchema,RecheckImpactSchema,RecordMigrationReceiptSchema,
 type ImpactCaseReadInput,type AssignImpactCaseInput,type RecordDispositionInput,type ApproveDispositionInput,type RecheckImpactInput,
 type ImpactCaseDetail,type ImpactCommandResult,type ImpactDisposition,type ImpactResultReference,type DepartmentAssessment,type ImpactSpan,type RecordMigrationReceiptInput,type ServiceImpactHandoff,
} from './department-impact-contracts.js';

interface CasePorts {
 root<T>(work:(scope:CatalogTransactionScope)=>Promise<T>):Promise<T>;
 record<T>(scope:CatalogTransactionScope,actor:string,operation:string,value:Record<string,unknown>):Promise<T>;
 observe(scope:CatalogTransactionScope,actor:string,target:{kind:'EVENT';id:string;campus:'NORTH'|'SOUTH'}):Promise<DepartmentAssessment>;
 evidence(scope:CatalogTransactionScope,actor:string,eventId:string,campus:'NORTH'|'SOUTH',evidenceId:string,admission:boolean):Promise<string>;
}
export function departmentImpactCases(ports:CasePorts){
 const read=async(scope:CatalogTransactionScope,actor:string,input:ImpactCaseReadInput)=>{
  const detail=await ports.record<ImpactCaseDetail>(scope,actor,'READ_CASE',input);
  await ports.observe(scope,actor,{kind:'EVENT',id:detail.item.eventId,campus:input.campus});
  for(const event of detail.history)if(event.disposition)await ports.evidence(scope,actor,detail.item.eventId,input.campus,event.disposition.evidenceId,false);
  return detail;
 };
 const prior=(scope:CatalogTransactionScope,actor:string,operation:string,input:Record<string,unknown>)=>ports.record<ImpactCommandResult|null>(scope,actor,'PRIOR_COMMAND',{...input,commandOperation:operation,requestDigest:digest({operation,input})});
 const append=(scope:CatalogTransactionScope,actor:string,operation:string,input:Record<string,unknown>,derived:Record<string,unknown>={})=>ports.record<ImpactCommandResult>(scope,actor,operation,{...input,...derived,requestDigest:digest({operation,input})});
 const result=async(scope:CatalogTransactionScope,actor:string,campus:string,ref:ImpactResultReference)=>
  (await sql<{r:{owner:string;id:string;versionId:string;departmentIds:string[];period:ImpactSpan;action:string;safeShrink:boolean}}>`select department_master.impact_result(${actor},${JSON.stringify(ref)}::jsonb,${campus}) r`.execute(scope)).rows[0]!.r;
 const closes=(proof:Awaited<ReturnType<typeof result>>,original:{owner:string;id:string;departmentId:string})=>proof.owner===original.owner&&proof.id===original.id&&(
  ['RETRACT','END','CLOSED','REVOKED'].includes(proof.action)||['CORRECT','PUBLISHED'].includes(proof.action)&&proof.safeShrink&&proof.departmentIds.includes(original.departmentId)
 );
 const validateDisposition=async(scope:CatalogTransactionScope,actor:string,detail:ImpactCaseDetail,disposition:ImpactDisposition)=>{
  const {item}=detail;
  if(disposition.kind==='MIGRATE_EXTERNAL'){if(item.obligation.kind!=='EXTERNAL')throw new Error('DISPOSITION_INCOMPLETE');return;}
  if(item.obligation.kind!=='REFERENCE')throw new Error('DISPOSITION_INCOMPLETE');
  const original=item.obligation.reference;
  if(disposition.kind==='KEEP_HISTORY')return;
  const proof=await result(scope,actor,item.campus,disposition.result);
  if(proof.owner!==original.owner)throw new Error('IMPACT_RESULT_MISMATCH');
  if(disposition.kind==='CLOSE_RELATION'){
   if(!closes(proof,original))throw new Error('IMPACT_RESULT_MISMATCH');
  }else{
   const targets=(await sql<{r:string[]}>`select department_master.impact_successors(${actor},${item.eventId}::uuid,${item.campus}) r`.execute(scope)).rows[0]!.r;
   if(!proof.departmentIds.some(id=>targets.includes(id))||['RETRACT','END','CLOSED','REVOKED'].includes(proof.action))throw new Error('IMPACT_RESULT_MISMATCH');
   if(disposition.oldRelation.kind==='CLOSE'){
    const closed=await result(scope,actor,item.campus,disposition.oldRelation.result);
    if(!closes(closed,original))throw new Error('IMPACT_RESULT_MISMATCH');
   }
  }
 };
 return {
  async recordMigrationReceipt(actor:string,input:RecordMigrationReceiptInput){check(RecordMigrationReceiptSchema,input);return ports.root(scope=>append(scope,actor,'RECEIPT',input));},
  async readMigrationHandoff(actor:string,input:ImpactCaseReadInput){check(ImpactCaseReadSchema,input);return ports.root(scope=>ports.record<ServiceImpactHandoff>(scope,actor,'READ_HANDOFF',input));},
  async readImpactCase(actor:string,input:ImpactCaseReadInput){check(ImpactCaseReadSchema,input);return ports.root(scope=>read(scope,actor,input));},
  async assignImpactCase(actor:string,input:AssignImpactCaseInput){check(AssignImpactCaseSchema,input);return ports.root(async scope=>{await read(scope,actor,input);return append(scope,actor,'ASSIGN',input);});},
  async recordDisposition(actor:string,input:RecordDispositionInput){check(RecordDispositionSchema,input);return ports.root(async scope=>{
   const detail=await read(scope,actor,input),existing=await prior(scope,actor,'PROPOSE',input);if(existing)return existing;
   await validateDisposition(scope,actor,detail,input.disposition);
   const evidenceDigest=await ports.evidence(scope,actor,detail.item.eventId,input.campus,input.disposition.evidenceId,true);
   return append(scope,actor,'PROPOSE',input,{evidenceDigest});
  });},
  async approveDisposition(actor:string,input:ApproveDispositionInput){check(ApproveDispositionSchema,input);return ports.root(async scope=>{
   const detail=await read(scope,actor,input),existing=await prior(scope,actor,'APPROVE',input);if(existing)return existing;
   const proposal=detail.history.find(event=>event.eventId===input.proposalEventId&&event.kind==='PROPOSE');
   if(!proposal?.disposition)throw new Error('APPROVAL_REQUIRED');
   await validateDisposition(scope,actor,detail,proposal.disposition);
   const evidenceDigest=await ports.evidence(scope,actor,detail.item.eventId,input.campus,proposal.disposition.evidenceId,true);
   if(evidenceDigest!==proposal.evidenceDigest)throw new Error('STALE_VALIDATION');
   return append(scope,actor,'APPROVE',input);
  });},
  async recheckImpact(actor:string,input:RecheckImpactInput){check(RecheckImpactSchema,input);return ports.root(async scope=>{
   const detail=await read(scope,actor,input),existing=await prior(scope,actor,'RECHECK',input);if(existing)return existing;
   const proposal=detail.history.filter(e=>e.kind==='PROPOSE').at(-1),approved=detail.history.filter(e=>e.kind==='APPROVE').at(-1);
   if(!proposal?.disposition||approved?.proposalEventId!==proposal.eventId)throw new Error('APPROVAL_REQUIRED');
   await validateDisposition(scope,actor,detail,proposal.disposition);
   const current=await ports.observe(scope,actor,{kind:'EVENT',id:detail.item.eventId,campus:input.campus});
   let remainingSpans:ImpactSpan[]=[];
   if(detail.item.obligation.kind==='REFERENCE'){
    const original=detail.item.obligation.reference;
    const reference=current.references.find(ref=>ref.owner===original.owner&&ref.id===original.id&&ref.versionId===original.versionId&&ref.departmentId===original.departmentId&&ref.referenceRole===original.referenceRole);
    if(!reference)throw new Error('BLOCKED_DEPENDENCY');
    if(reference.currentReferencesDepartment&&!['RETRACT','CLOSED','REVOKED'].includes(reference.currentAction)&&reference.currentTargetId===original.departmentId){
     remainingSpans=detail.item.obligation.affectedSpans.flatMap(span=>intersect(span,reference.currentPeriod));
    }
    if(proposal.disposition.kind==='NEW_RELATION'){
     const replacement=await result(scope,actor,input.campus,proposal.disposition.result);
     const uncovered=detail.item.obligation.affectedSpans.flatMap(span=>subtract(span,[replacement.period]));
     for(const span of uncovered)remainingSpans.push(...subtract(span,remainingSpans));
     remainingSpans.sort((a,b)=>a.from.localeCompare(b.from));
    }
   }else remainingSpans=detail.item.obligation.affectedSpans;
   return append(scope,actor,'RECHECK',input,{remainingSpans,dependencyDigest:current.dependencyDigest,proposalEventId:proposal.eventId});
  });},
 };
}
function digest(value:unknown){return createHash('sha256').update(canonicalPlan(value)).digest('hex');}
