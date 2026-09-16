import {createHmac,randomUUID} from 'node:crypto';
import {sql,type Kysely} from 'kysely';
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope} from './transaction-scope.js';
import {createValidationEvidenceReader} from './validation.js';
import {QualityEligibilitySchema,qualityEligibilityInTransaction,type QualityIssueListResult,type QualityIssueDetail} from './quality-issues.js';
import {protectedArtifacts,type KeyProviderPort} from './protected-artifact.js';
import {signaturesEqual} from './parse-provenance.js';
import {selectImportAdapter} from './import-adapter.js';
import type {ImportContractItem} from './contract-schema.js';
import {planApplyUnits,explainTargetImpact} from './dry-run-rules.js';

const Id=QualityEligibilitySchema.properties.jobId;
const Row=Type.Integer({minimum:1,maximum:1000});
const Target=Type.Object({dataset:Type.String({pattern:'^(ORG|PER)[0-9]{2}$'}),id:Id,expectedVersion:Type.String({pattern:'^[1-9][0-9]*$',maxLength:20})},{additionalProperties:false});
const Dependency=Type.Object({field:Type.String({minLength:1,maxLength:128}),alias:Type.Object({kind:Type.Literal('JOB_ALIAS'),row:Row},{additionalProperties:false})},{additionalProperties:false});
const Command=Type.Object({row:Row,intent:Type.Enum(['CREATE','REVISE','CORRECT','CLOSE','SPLIT','MERGE','TRANSFER']),target:Type.Optional(Target),dependencies:Type.Array(Dependency,{maxItems:100})},{additionalProperties:false});
export const BuildDryRunSchema=Type.Object({...QualityEligibilitySchema.properties,commands:Type.Array(Command,{minItems:1,maxItems:1000})},{additionalProperties:false});
export const ApprovalCandidateSchema=Type.Object({planToken:Type.String({minLength:1,maxLength:1048576})},{additionalProperties:false});
export type BuildDryRunInput=Static<typeof BuildDryRunSchema>;
export type ApprovalCandidateInput=Static<typeof ApprovalCandidateSchema>;
const transformation='DECLARED_INTENTS_V1';
interface ObservationToken {version:'P0_07_OBSERVATION_V1';actor:string;planId:string;observedAt:string;input:BuildDryRunInput;binding:string}
const safeCodes=new Set(['ACCESS_DENIED','NOT_FOUND','STALE_REVISION','EXACT_CONTRACT_UNAVAILABLE','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE','PROTECTED_OPERATION_FAILED','PARSE_PROVENANCE_REQUIRED','VALIDATION_PROVENANCE_REQUIRED','VALIDATION_EVIDENCE_UNAVAILABLE','CLOSED_INPUT_REQUIRED','INVALID_PLAN_TOKEN','PLAN_EVIDENCE_LIMIT']);
async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw new Error(error instanceof Error&&safeCodes.has(error.message)?error.message:'DRY_RUN_FAILED');}}

export function dryRun(db:Kysely<DB>,provider?:KeyProviderPort){
 const reader=createValidationEvidenceReader(provider);
 const mac=(domain:string,value:string|Uint8Array)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  return createHmac('sha256',provider.lookup()).update(domain+'\0').update(value).digest('hex');
 };
 const token=(observation:ObservationToken)=>{
  // Contains technical references and explicit user intent only; never cells, business keys or issue details.
  const body=Buffer.from(JSON.stringify(observation)).toString('base64url');
  if(body.length+65>1048576)throw new Error('PLAN_EVIDENCE_LIMIT');
  return body+'.'+mac('P0_07_TOKEN_V1',body);
 };
 const readToken=(actor:string,input:ApprovalCandidateInput):ObservationToken=>{
  if(!Check(ApprovalCandidateSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
  const parts=input.planToken.split('.');
  if(parts.length!==2||!signaturesEqual(mac('P0_07_TOKEN_V1',parts[0]!),parts[1]!))throw new Error('INVALID_PLAN_TOKEN');
  const observation:ObservationToken=JSON.parse(Buffer.from(parts[0]!,'base64url').toString('utf8'));
  if(observation.version!=='P0_07_OBSERVATION_V1'||observation.actor!==actor||!Check(BuildDryRunSchema,observation.input))throw new Error('INVALID_PLAN_TOKEN');
  return observation;
 };
 const observe=async(scope:CatalogTransactionScope,actor:string,input:BuildDryRunInput)=>{
  const evidence=await reader.readInTransaction(scope,actor,{scope:input.scope,campus:input.campus,purpose:input.purpose,runId:input.runId},input.runId,true);
  const dimensions={scope:input.scope,campus:input.campus,purpose:input.purpose};
  const qualityInput={...dimensions,jobId:input.jobId,revisionId:input.revisionId,runId:input.runId};
  const quality=await qualityEligibilityInTransaction(scope,actor,qualityInput,evidence);
  const {job,run}=evidence;
  const raw=await protectedArtifacts(scope,provider).authorizeSensitiveRead(actor,{...dimensions,requestId:randomUUID(),artifactId:run.sourceArtifactId},{jobId:job.id,revisionId:run.revisionId,kind:'RAW_FILE'});
  let sourceBinding:string;
  try{sourceBinding=mac('P0_07_SOURCE_V1',raw);}finally{raw.fill(0);}
  // Read the existing Owner's ledger rather than inventing a second issue-count query.
  const issues:QualityIssueDetail[]=[];
  for(let offset=0;;offset+=100){
   const page=(await sql<{result:QualityIssueListResult}>`select governance_catalog.quality_issue_read(${actor},${JSON.stringify({...dimensions,jobId:job.id,pageSize:100,offset})}::jsonb) as result`.execute(scope)).rows[0]!.result;
   if(page.total>1000)throw new Error('PLAN_EVIDENCE_LIMIT');
   for(const item of page.items)issues.push((await sql<{result:QualityIssueDetail}>`select governance_catalog.quality_issue_detail(${actor},${JSON.stringify({...dimensions,issueId:item.id})}::jsonb) as result`.execute(scope)).rows[0]!.result);
   if(offset+page.items.length>=page.total)break;
  }
  const contracts=(await sql<{result:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify({scope:input.scope,mode:'CURRENT',target:job.contract.id})}::jsonb) as result`.execute(scope)).rows[0]!.result;
  const adapter=selectImportAdapter({dataset:job.contract.dataset,profile:job.profile,contractVersion:job.contract.version});
  const graph=planApplyUnits(input.commands.map(command=>({...command,dependencies:command.dependencies.map(dependency=>dependency.alias.row)})));
  const blockers=new Set(graph.blockers);
  // Adapter declarations do not provide a domain reader, field transformation or atomic business bundle.
  blockers.add('BLOCKED_DEPENDENCY');blockers.add('INTENT_MAPPING_UNAVAILABLE');
  if(quality.missingIssueCount||quality.unresolvedIssueCount||quality.manualEvidenceBlocked)blockers.add('QUALITY_BLOCKED');
  if(job.status==='REJECTED')blockers.add('BATCH_REJECTED');
  if(evidence.evaluation.layers.some(layer=>layer.layer<8&&layer.status!=='PASS'))blockers.add('PREREQUISITE_VALIDATION_BLOCKED');
  for(const command of input.commands){
   if(!evidence.parsed?.rows[command.row-1])blockers.add('ROW_REFERENCE_INVALID');
   if(command.target&&command.target.dataset!==job.contract.dataset)blockers.add('TARGET_DATASET_MISMATCH');
   for(const dependency of command.dependencies){
    if(!job.contract.definition.references.some(reference=>reference.field===dependency.field))blockers.add('UNDECLARED_RELATION');
   }
  }
  const diff=input.commands.map(command=>({row:command.row,intent:command.intent,alias:{kind:'JOB_ALIAS' as const,jobId:job.id,revisionId:run.revisionId,row:command.row},target:command.target??null,...explainTargetImpact({...command,dependencies:command.dependencies.map(dependency=>dependency.alias.row)},[]),effect:'NOT_EVALUABLE' as const,dependencies:command.dependencies}));
  const basis={jobId:job.id,revisionId:run.revisionId,runId:run.runId,sourceArtifactId:run.sourceArtifactId,parseArtifactId:run.parseArtifactId,resultArtifactId:run.resultArtifactId,contractVersionId:run.contractVersionId,ruleVersion:run.ruleVersion,parserPolicy:run.parserPolicy,interpretationPolicy:run.interpretationPolicy,transformation,profile:job.profile,validationRecordedAt:run.recordedAt};
  const orderedBlockers=[...blockers].sort();
  const binding=mac('P0_07_COMPLETE_BASIS_V1',JSON.stringify({actor,input,sourceBinding,basis,job,contracts,run,parsed:evidence.parsed,evaluation:evidence.evaluation,issues,quality,adapter,graph,diff,blockers:orderedBlockers}));
  const observedAt=(await sql<{time:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') as time`.execute(scope)).rows[0]!.time;
  const qualityReferences=issues.map(detail=>({issueId:detail.issue.id,sequence:detail.issue.sequence,dispositionHeads:detail.history.map(event=>event.head)}));
  const currentContractReferences=contracts.map(contract=>({id:contract.id,versionId:contract.versionId,head:contract.head,status:contract.status}));
  const prerequisites={quality:quality.jobStatus==='WAITING_INPUT'&&quality.missingIssueCount===0&&quality.unresolvedIssueCount===0&&quality.manualEvidenceBlocked===0&&evidence.evaluation.layers.filter(layer=>layer.layer<6).every(layer=>layer.status==='PASS'),evidence:true as const,domain:false as const,graph:graph.status==='PLANNED'};
  return {basis,observedAt,binding,graph,diff,quality,qualityReferences,currentContractReferences,prerequisites,blockers:orderedBlockers,analysisAvailable:true as const,prerequisitesMet:false as const,candidateFreezable:false as const,applyImplemented:false as const,certificate:{status:'BLOCKED' as const},domainWriteCount:0 as const,permanentBusinessIdsAllocated:0 as const};
 };
 const buildDryRun=async(actor:string,input:BuildDryRunInput)=>{
  if(!Check(BuildDryRunSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input=structuredClone(input);
  return safe(()=>db.transaction().execute(async trx=>{
   const preview=await observe(CatalogTransactionScope.from(trx),actor,input);
   const planId=randomUUID();
   return {...preview,planRef:{kind:'CHANGE_PLAN' as const,id:planId},planToken:token({version:'P0_07_OBSERVATION_V1',actor,planId,observedAt:preview.observedAt,input,binding:preview.binding})};
  }));
 };
 const freezeApprovalCandidate=async(actor:string,input:ApprovalCandidateInput)=>safe(async()=>{
  const original=readToken(actor,input);
  try{
   return await db.transaction().execute(async trx=>{
    const current=await observe(CatalogTransactionScope.from(trx),actor,original.input);
    return {planRef:{kind:'CHANGE_PLAN' as const,id:original.planId},originalObservedAt:original.observedAt,recheckedAt:current.observedAt,status:original.binding!==current.binding?'STALE' as const:'BLOCKED' as const,candidate:null,approvalGranted:false as const,applyImplemented:false as const,blockers:current.blockers};
   });
  }catch(error){
   // Map only known re-evaluation failures after rollback; authorization failures stay failures.
   const code=error instanceof Error?error.message:'';
   if(!['STALE_REVISION','EXACT_CONTRACT_UNAVAILABLE','PAYLOAD_UNAVAILABLE','VALIDATION_EVIDENCE_UNAVAILABLE','PARSE_PROVENANCE_REQUIRED'].includes(code))throw error;
   return {planRef:{kind:'CHANGE_PLAN' as const,id:original.planId},originalObservedAt:original.observedAt,recheckedAt:null,status:code==='STALE_REVISION'||code==='EXACT_CONTRACT_UNAVAILABLE'?'STALE' as const:'BLOCKED' as const,candidate:null,approvalGranted:false as const,applyImplemented:false as const,blockers:[code]};
  }
 });
 return {buildDryRun,planApplyUnits:buildDryRun,explainImpact:buildDryRun,freezeApprovalCandidate};
}
