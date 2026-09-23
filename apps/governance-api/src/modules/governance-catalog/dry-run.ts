import {planBinding} from './plan-binding.js';
import {createHmac,randomUUID} from 'node:crypto';
import {sql,type Kysely} from 'kysely';
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {CatalogTransactionScope} from './transaction-scope.js';
import {createValidationEvidenceReader} from './validation.js';
import {QualityEligibilitySchema,qualityEligibilityInTransaction,type QualityIssueListResult,type QualityIssueDetail} from './quality-issues.js';
import {protectedArtifacts,type KeyProviderPort} from './protected-artifact.js';
import {parsedRowsForDataset,signaturesEqual} from './parse-provenance.js';
import {selectImportAdapter} from './import-adapter.js';
import type {ImportContractItem} from './contract-schema.js';
import {planDeclaredGraph,explainTargetImpact} from './dry-run-rules.js';

const Id=QualityEligibilitySchema.properties.jobId;
const planTokenLimit=1048576;
const Row=Type.Integer({minimum:1,maximum:1000});
const Target=Type.Object({dataset:Type.String({pattern:'^(ORG|PER)[0-9]{2}$'}),id:Id,expectedVersion:Type.String({pattern:'^[1-9][0-9]*$',maxLength:20})},{additionalProperties:false});
const Dependency=Type.Object({field:Type.String({minLength:1,maxLength:128}),alias:Type.Object({kind:Type.Literal('JOB_ALIAS'),row:Row},{additionalProperties:false})},{additionalProperties:false});
const Command=Type.Object({row:Row,intent:Type.Enum(['CREATE','REVISE','CORRECT','CLOSE','SPLIT','MERGE','TRANSFER']),target:Type.Optional(Target),dependencies:Type.Array(Dependency,{maxItems:100})},{additionalProperties:false});
export const BuildDryRunSchema=Type.Object({...QualityEligibilitySchema.properties,commands:Type.Array(Command,{minItems:1,maxItems:1000})},{additionalProperties:false,description:'Structural limits apply together with the aggregate 1 MiB signed-token budget. PLAN_INPUT_LIMIT rejects oversized serialized intent before any database observation.'});
export const ApprovalCandidateSchema=Type.Object({planToken:Type.String({minLength:1,maxLength:planTokenLimit})},{additionalProperties:false});
export type BuildDryRunInput=Static<typeof BuildDryRunSchema>;
export type ApprovalCandidateInput=Static<typeof ApprovalCandidateSchema>;
const transformation='DECLARED_INTENTS_V2';
interface ObservationToken {version:'P0_07_OBSERVATION_V1';actor:string;planId:string;observedAt:string;input:BuildDryRunInput;binding:string}
const safeCodes=new Set(['ACCESS_DENIED','NOT_FOUND','STALE_REVISION','EXACT_CONTRACT_UNAVAILABLE','KEY_UNAVAILABLE','PAYLOAD_UNAVAILABLE','PROTECTED_OPERATION_FAILED','PARSE_PROVENANCE_REQUIRED','VALIDATION_PROVENANCE_REQUIRED','VALIDATION_EVIDENCE_UNAVAILABLE','CLOSED_INPUT_REQUIRED','INVALID_PLAN_TOKEN','PLAN_EVIDENCE_LIMIT','PLAN_INPUT_LIMIT']);
async function safe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw new Error(error instanceof Error&&safeCodes.has(error.message)?error.message:'DRY_RUN_FAILED');}}

export function dryRun(db:Kysely<DB>,provider?:KeyProviderPort){
 const reader=createValidationEvidenceReader(provider);
 // This root has no business writes. Preserve already-recorded access audits even if
 // crypto or a later SQL statement fails, without opening another pool/snapshot.
 const readTransaction=async<T>(work:(scope:CatalogTransactionScope)=>Promise<T>):Promise<T>=>{
  const outcome=await db.transaction().execute(async trx=>{
   const checkpoint=async()=>{await sql`savepoint p0_07_read_audit`.execute(trx);};
   await checkpoint();
   const scope=CatalogTransactionScope.from(trx,checkpoint);
   try{return {ok:true as const,value:await work(scope)};}
   catch(error){
    await sql`rollback to savepoint p0_07_read_audit`.execute(trx);
    return {ok:false as const,error};
   }
  });
  if(!outcome.ok)throw outcome.error;
  return outcome.value;
 };
 const mac=(domain:string,value:string|Uint8Array)=>{
  if(!provider)throw new Error('KEY_UNAVAILABLE');
  return createHmac('sha256',provider.lookup()).update(domain+'\0').update(value).digest('hex');
 };
 const token=(observation:ObservationToken)=>{
  // Contains technical references and explicit user intent only; never cells, business keys or issue details.
  const body=Buffer.from(JSON.stringify(observation)).toString('base64url');
  if(body.length+65>planTokenLimit)throw new Error('PLAN_EVIDENCE_LIMIT');
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
  const revision=job.revisions.find(r=>r.id===run.revisionId);
  const adapter=selectImportAdapter({dataset:job.contract.dataset,profile:job.profile,contractVersion:job.contract.version,templateVersion:job.contract.definition.templateVersion,...(revision?.input.kind==='FILE'?{parserPolicy:revision.input.parserPolicy}:{})});
  const verifiedParsed=evidence.organizationBundle??evidence.parsed;
  const parsedRows=parsedRowsForDataset(verifiedParsed,job.contract.dataset);
  const graph=planDeclaredGraph(job.contract.dataset,job.contract.definition.references,input.commands,parsedRows.length);
  const blockers=new Set(graph.blockers);
  // Adapter declarations do not provide a domain reader, field transformation or atomic business bundle.
  blockers.add('BLOCKED_DEPENDENCY');blockers.add('INTENT_MAPPING_UNAVAILABLE');
  if(quality.missingIssueCount||quality.unresolvedIssueCount||quality.manualEvidenceBlocked)blockers.add('QUALITY_BLOCKED');
  if(job.status==='REJECTED')blockers.add('BATCH_REJECTED');
  if(evidence.evaluation.layers.some(layer=>layer.layer<8&&layer.status!=='PASS'))blockers.add('PREREQUISITE_VALIDATION_BLOCKED');
  const diff=input.commands.map(command=>({row:command.row,intent:command.intent,alias:{kind:'JOB_ALIAS' as const,jobId:job.id,revisionId:run.revisionId,row:command.row},target:command.target??null,...explainTargetImpact({...command,dependencies:command.dependencies.map(dependency=>dependency.alias.row)},[]),effect:'NOT_EVALUABLE' as const,dependencies:command.dependencies}));
  const basis={jobId:job.id,revisionId:run.revisionId,runId:run.runId,sourceArtifactId:run.sourceArtifactId,parseArtifactId:run.parseArtifactId,resultArtifactId:run.resultArtifactId,contractVersionId:run.contractVersionId,ruleVersion:run.ruleVersion,parserPolicy:run.parserPolicy,interpretationPolicy:run.interpretationPolicy,transformation,profile:job.profile,validationRecordedAt:run.recordedAt};
  const orderedBlockers=[...blockers].sort();
  const binding=planBinding(provider,'P0_07_COMPLETE_BASIS_V1',{actor,input,sourceBinding,basis,job,contracts,run,parsed:verifiedParsed??null,evaluation:evidence.evaluation,issues,quality,adapter,graph,diff,blockers:orderedBlockers});
  const observedAt=(await sql<{time:string}>`select to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') as time`.execute(scope)).rows[0]!.time;
  const qualityReferences=issues.map(detail=>({issueId:detail.issue.id,sequence:detail.issue.sequence,dispositionHeads:detail.history.map(event=>event.head)}));
  const currentContractReferences=contracts.map(contract=>({id:contract.id,versionId:contract.versionId,head:contract.head,status:contract.status}));
  const prerequisites={quality:quality.jobStatus==='WAITING_INPUT'&&quality.missingIssueCount===0&&quality.unresolvedIssueCount===0&&quality.manualEvidenceBlocked===0&&evidence.evaluation.layers.filter(layer=>layer.layer<6).every(layer=>layer.status==='PASS'),evidence:true as const,domain:false as const,graph:graph.status==='PLANNED'};
  return {basis,observedAt,binding,graph,diff,quality,qualityReferences,currentContractReferences,prerequisites,blockers:orderedBlockers,analysisAvailable:true as const,prerequisitesMet:false as const,candidateFreezable:false as const,applyImplemented:false as const,certificate:{status:'BLOCKED' as const},domainWriteCount:0 as const,permanentBusinessIdsAllocated:0 as const};
 };
 const buildDryRun=async(actor:string,input:BuildDryRunInput)=>{
  if(!Check(BuildDryRunSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input=structuredClone(input);
  // Admission includes aggregate UTF-8/base64 capacity, not only per-array shape.
  // Reserve more than the DB local timestamp's length; ID/signature lengths are fixed.
  // Do not touch the provider here: genuine protected-read/key failures must retain their audit.
  const budget:ObservationToken={version:'P0_07_OBSERVATION_V1',actor,planId:'0'.repeat(36),observedAt:'0'.repeat(64),input,binding:'0'.repeat(64)};
  if(Math.ceil(Buffer.byteLength(JSON.stringify(budget),'utf8')*4/3)+65>planTokenLimit)throw new Error('PLAN_INPUT_LIMIT');
  return safe(()=>readTransaction(async scope=>{
   const preview=await observe(scope,actor,input);
   const planId=randomUUID();
   return {...preview,planRef:{kind:'CHANGE_PLAN' as const,id:planId},planToken:token({version:'P0_07_OBSERVATION_V1',actor,planId,observedAt:preview.observedAt,input,binding:preview.binding})};
  }));
 };
 const freezeApprovalCandidate=async(actor:string,input:ApprovalCandidateInput)=>safe(async()=>{
  const original=readToken(actor,input);
  try{
   return await readTransaction(async scope=>{
    const current=await observe(scope,actor,original.input);
    return {planRef:{kind:'CHANGE_PLAN' as const,id:original.planId},originalObservedAt:original.observedAt,recheckedAt:current.observedAt,status:original.binding!==current.binding?'STALE' as const:'BLOCKED' as const,candidate:null,approvalGranted:false as const,applyImplemented:false as const,blockers:current.blockers};
   });
  }catch(error){
   // Map only known re-evaluation failures after audit commit; authorization failures stay failures.
   const code=error instanceof Error?error.message:'';
   if(!['STALE_REVISION','EXACT_CONTRACT_UNAVAILABLE','PAYLOAD_UNAVAILABLE','VALIDATION_EVIDENCE_UNAVAILABLE','PARSE_PROVENANCE_REQUIRED'].includes(code))throw error;
   return {planRef:{kind:'CHANGE_PLAN' as const,id:original.planId},originalObservedAt:original.observedAt,recheckedAt:null,status:code==='STALE_REVISION'||code==='EXACT_CONTRACT_UNAVAILABLE'?'STALE' as const:'BLOCKED' as const,candidate:null,approvalGranted:false as const,applyImplemented:false as const,blockers:[code]};
  }
 });
 const previewFileCreates=async(actor:string,input:Static<typeof QualityEligibilitySchema>)=>{
  if(!Check(QualityEligibilitySchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input=structuredClone(input);
  return safe(()=>readTransaction(async scope=>{
   const evidence=await createValidationEvidenceReader(provider).readInTransaction(scope,actor,input,input.runId,true);
   if(evidence.job.id!==input.jobId||evidence.run.revisionId!==input.revisionId||evidence.job.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');
   const commands=parsedRowsForDataset(evidence.organizationBundle??evidence.parsed,evidence.job.contract.dataset).map((_row,index)=>({row:index+1,intent:'CREATE' as const,dependencies:[]}));
   if(!commands.length)throw new Error('PLAN_INPUT_LIMIT');
   const preview=await observe(scope,actor,{...input,commands});
   return {...preview,previewIntent:'ALL_FILE_ROWS_CREATE' as const,rowCount:commands.length};
  }));
 };
 return {buildDryRun,previewFileCreates,planApplyUnits:buildDryRun,explainImpact:buildDryRun,freezeApprovalCandidate};
}
