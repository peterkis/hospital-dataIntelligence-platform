import {createHmac} from 'node:crypto';
import {sql,type Kysely} from 'kysely';
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {receiveFileInTransaction,type ReceiveFileInput} from './file-intake.js';
import {createValidationEvidenceReader,type VerifiedValidationEvidence} from './validation.js';
import {buildQualityIssueCandidates} from './quality-candidates.js';
import type {KeyProviderPort} from './protected-artifact.js';
import {qualityResolutionProof} from './quality-resolution-proof.js';
import {CatalogTransactionScope} from './transaction-scope.js';

const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const Scope=Type.Literal('SYNTHETIC');
const Campus=Type.Union([Type.Literal('NORTH'),Type.Literal('SOUTH')]);
const Purpose=Type.Union([Type.Literal('IDENTITY_VERIFY'),Type.Literal('CONTACT_VERIFY'),Type.Literal('HR_RESTRICTED')]);
const Reason=Type.String({pattern:'^[A-Z0-9_]{1,64}$'});
const Token=Type.String({pattern:'^[A-Za-z0-9_.-]{1,128}$'});
const Dimensions={scope:Scope,campus:Campus,purpose:Purpose};
const qualitySafeCodes=new Set([
 'ACCESS_DENIED','BATCH_ALREADY_REJECTED','BATCH_REJECTED','BLOCKED_DEPENDENCY','CLOSED_FILE_REQUIRED','CLOSED_INPUT_REQUIRED','EXACT_CONTRACT_UNAVAILABLE','FILE_RECEIVE_FAILED','FILE_REVISION_REQUIRED','ISSUE_ALREADY_RESOLVED','ISSUE_REFERENCE_INVALID','KEY_UNAVAILABLE','NOT_FOUND','PARSE_PROVENANCE_REQUIRED','PAYLOAD_UNAVAILABLE','POLICY_INCOMPATIBLE','PROTECTED_ARTIFACT_REQUIRED','PROTECTED_OPERATION_FAILED','PUBLIC_DIGEST_CONFLICT','REQUEST_CONFLICT','RESPONSIBILITY_NOT_READY','REVISION_LINEAGE_INVALID','REVISION_REFERENCE_INVALID','RUN_REFERENCE_INVALID','STALE_HEAD','STALE_REVISION','STRUCTURAL_REJECTED','TARGET_FIELD_UNAVAILABLE','UNMATCHED','VALIDATION_EVIDENCE_UNAVAILABLE','VALIDATION_NOT_PASSED','VALIDATION_PROVENANCE_REQUIRED','CORRECTION_RECEIPT_MISMATCH','QUALITY_CANDIDATE_INVALID','QUALITY_OPERATION_FAILED'
]);
function safeQualityError(error:unknown){return new Error(error instanceof Error&&qualitySafeCodes.has(error.message)?error.message:'QUALITY_OPERATION_FAILED');}
async function qualitySafe<T>(work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw safeQualityError(error);}}

export const OpenIssueSchema=Type.Object({...Dimensions,requestId:Id,reason:Reason,runId:Id},{additionalProperties:false});
export const AssignIssueSchema=Type.Object({...Dimensions,requestId:Id,reason:Reason,issueId:Id,expectedHead:Type.String({pattern:'^(0|[1-9][0-9]*)$'}),responsibilityId:Id},{additionalProperties:false});
export const ProposeCorrectionSchema=Type.Object({...Dimensions,requestId:Id,receiveRequestId:Id,reason:Reason,issueId:Id,jobId:Id,sourceRunId:Id,expectedCurrentRevision:Id,format:Type.Union([Type.Literal('CSV'),Type.Literal('JSON'),Type.Literal('XLSX')]),parserPolicy:Type.Union([Type.Literal('STRICT_V1'),Type.Literal('STRICT_V2')]),retentionSeconds:Type.Integer({minimum:1,maximum:2592000})},{additionalProperties:false});
const CandidateSchema=Type.Object({row:Type.Integer({minimum:1,maximum:1000}),field:Token},{additionalProperties:false});
export const ResolveWithEvidenceSchema=Type.Object({...Dimensions,requestId:Id,reason:Reason,issueId:Id,expectedHead:Type.String({pattern:'^(0|[1-9][0-9]*)$'}),newRunId:Id,newRevisionId:Id,candidate:Type.Optional(CandidateSchema)},{additionalProperties:false});
export const RejectBatchSchema=Type.Object({...Dimensions,requestId:Id,reason:Reason,jobId:Id,expectedHead:Type.String({pattern:'^(0|[1-9][0-9]*)$'}),},{additionalProperties:false});
export const QualityIssueReadSchema=Type.Object({...Dimensions,jobId:Id,pageSize:Type.Optional(Type.Integer({minimum:1,maximum:100})),offset:Type.Optional(Type.Integer({minimum:0,maximum:100000}))},{additionalProperties:false});
export const QualityIssueDetailSchema=Type.Object({...Dimensions,issueId:Id},{additionalProperties:false});
export const QualityEligibilitySchema=Type.Object({...Dimensions,jobId:Id,revisionId:Id,runId:Id},{additionalProperties:false});

export type OpenIssueInput=Static<typeof OpenIssueSchema>;
export type AssignIssueInput=Static<typeof AssignIssueSchema>;
export type ProposeCorrectionInput=Static<typeof ProposeCorrectionSchema>;
export type ResolveWithEvidenceInput=Static<typeof ResolveWithEvidenceSchema>;
export type RejectBatchInput=Static<typeof RejectBatchSchema>;
export type QualityIssueReadInput=Static<typeof QualityIssueReadSchema>;
export type QualityIssueDetailInput=Static<typeof QualityIssueDetailSchema>;
export type QualityEligibilityInput=Static<typeof QualityEligibilitySchema>;

export interface QualityIssueRecord {id:string;sequence:number;jobId:string;revisionId:string;runId:string;dataset:string;campus:'NORTH'|'SOUTH';purpose:'IDENTITY_VERIFY'|'CONTACT_VERIFY'|'HR_RESTRICTED';format:'CSV'|'JSON'|'XLSX';sheet:string|null;sourceKind:'RULE'|'LAYER';sourceStatus:string;classification:'ERROR'|'REVIEW'|'BLOCKED_DEPENDENCY';layer:number;rule:string;requirementId:string|null;row:number;field:string|null;status:'OPEN'|'RESOLVED';ownerRef:string|null;relatedRefs:string[];boundedCode:string}
export interface QualityIssueDetail {issue:QualityIssueRecord;jobStatus:'WAITING_INPUT'|'REJECTED';history:Array<Record<string,unknown>>;evidenceAvailable:boolean;evidenceStatus:'AVAILABLE'|'NOT_RECOVERABLE'}
export interface QualityIssueOpenResult {jobId:string;runId:string;issueIds:string[];inserted:number;replayed:number;total:number}
export interface QualityIssueDispositionResult {jobId:string;issueId?:string;head:string;eventId:string;kind:string;revisionId?:string;newRunId?:string;newRevisionId?:string;targetRow?:number;targetField?:string;ownerRef?:string;status?:string;artifactId?:string;storageStatus?:string}
export interface QualityIssueListResult {jobId:string;jobStatus:'WAITING_INPUT'|'REJECTED';items:QualityIssueRecord[];total:number;pageSize:number;offset:number}
export interface QualityCorrectionResult extends QualityIssueDispositionResult {revisionId:string;artifactId:string}
export interface QualityEligibilityResult {jobId:string;currentRevisionId:string;currentRunId:string;jobStatus:'WAITING_INPUT'|'REJECTED';expectedIssueCount:number;ingestedIssueCount:number;missingIssueCount:number;unresolvedIssueCount:number;manualEvidenceBlocked:number;domainDependencyBlocked:number;notRunLayers:number[];currentEvidenceAvailable:boolean;isolationBlocked:true;applyImplemented:false;eligible:boolean}

function detailInput(input:ResolveWithEvidenceInput):QualityIssueDetailInput{return {scope:input.scope,campus:input.campus,purpose:input.purpose,issueId:input.issueId};}
function expectedDimensions(input:{scope:'SYNTHETIC';campus:'NORTH'|'SOUTH';purpose:'IDENTITY_VERIFY'|'CONTACT_VERIFY'|'HR_RESTRICTED'},runId:string){return {scope:input.scope,campus:input.campus,purpose:input.purpose,runId};}

function exactKey(row:Record<string,string>,fields:string[]):string|null{
 const values=fields.map(field=>row[field]);
 return values.every(value=>typeof value==='string'&&value.length>0)?JSON.stringify(values):null;
}
function derivedReceiveJobRequestId(provider:KeyProviderPort,requestId:string){
 const hex=createHmac('sha256',provider.lookup()).update('P0_06_RECEIVE_JOB_V1\0').update(requestId).digest('hex').slice(0,32);
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function requireMatchedRow(oldEvidence:VerifiedValidationEvidence,newEvidence:VerifiedValidationEvidence,issue:QualityIssueRecord,input:ResolveWithEvidenceInput){
 if(issue.sourceKind==='LAYER'||issue.classification==='BLOCKED_DEPENDENCY')throw new Error('BLOCKED_DEPENDENCY');
 const businessKey=oldEvidence.job.contract.definition.businessKey;
 if(!businessKey||businessKey.length<1)throw new Error('UNMATCHED');
 const oldRows=oldEvidence.parsed?.rows??[];const targetOld=oldRows[issue.row-1];if(!targetOld)throw new Error('UNMATCHED');
 const oldKey=exactKey(targetOld,businessKey);if(!oldKey)throw new Error('UNMATCHED');
 const oldIgnored=new Set((oldEvidence.evaluation.duplicates??[]).map(entry=>entry.row));
 const newIgnored=new Set((newEvidence.evaluation.duplicates??[]).map(entry=>entry.row));
 const oldMatches=oldRows.map((row,index)=>({row,index:index+1,key:exactKey(row,businessKey)})).filter(entry=>entry.key===oldKey&&!oldIgnored.has(entry.index));if(oldMatches.length!==1)throw new Error('UNMATCHED');
 const newRows=newEvidence.parsed?.rows??[];const newMatches=newRows.map((row,index)=>({row,index:index+1,key:exactKey(row,businessKey)})).filter(entry=>entry.key===oldKey&&!newIgnored.has(entry.index));if(newMatches.length!==1)throw new Error('UNMATCHED');
 const targetRow=newMatches[0]!.index+0;const targetField=issue.field??'';
 if(!targetField||!newEvidence.job.contract.definition.fields.some(field=>field.code===targetField))throw new Error('TARGET_FIELD_UNAVAILABLE');
 if(input.candidate&& (input.candidate.row!==targetRow||input.candidate.field!==targetField))throw new Error('UNMATCHED');
 const coverage=newEvidence.evaluation.executionCoverage;
 if(!coverage||coverage.version!=='RULE_EXECUTION_V1')throw new Error('VALIDATION_EVIDENCE_UNAVAILABLE');
 const proved=coverage.checks.some(check=>check.rule===issue.rule&&check.field===targetField&&check.status==='PASS'&&check.rows.includes(targetRow));
 if(!proved)throw new Error('VALIDATION_NOT_PASSED');
 return {targetRow,targetField};
}

export function qualityIssues(db:Kysely<DB>,provider?:KeyProviderPort){
 const evidenceReader=createValidationEvidenceReader(provider);
 return {
  async openIssue(actor:string,input:OpenIssueInput){
   if(!Check(OpenIssueSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input=structuredClone(input);
    return qualitySafe(()=>db.transaction().execute(async trx=>{
     const scope=CatalogTransactionScope.from(trx);
     const prior=(await sql<{result:QualityIssueOpenResult|null}>`select governance_catalog.quality_issue_open_prior(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(scope)).rows[0]!.result;
     if(prior)return prior;
     const evidence=await evidenceReader.readInTransaction(scope,actor,input,input.runId,false);
    const candidates=buildQualityIssueCandidates(evidence.evaluation);
     return (await sql<{result:QualityIssueOpenResult}>`select governance_catalog.quality_issue_ingest(${actor},${JSON.stringify(input)}::jsonb,${JSON.stringify(candidates)}::jsonb) as result`.execute(scope)).rows[0]!.result;
   }));
  },
  async assignIssue(actor:string,input:AssignIssueInput){
   if(!Check(AssignIssueSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
   return qualitySafe(async()=> (await sql<{result:QualityIssueDispositionResult}>`select governance_catalog.quality_issue_assign(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result);
  },
  async proposeCorrection(actor:string,input:ProposeCorrectionInput,bytes:Uint8Array):Promise<QualityCorrectionResult>{
   if(!Check(ProposeCorrectionSchema,input)||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>1048576)throw new Error('CLOSED_FILE_REQUIRED');
   if(!provider)throw new Error('KEY_UNAVAILABLE');input=structuredClone(input);
   const raw=Buffer.from(bytes);
   try{
   const fileDigest=createHmac('sha256',provider.lookup()).update('P0_06_FILE_REQUEST_V1\0').update(raw).digest('hex');
   const internal={...input,fileDigest};
    return await qualitySafe(()=>db.transaction().execute(async trx=>{
     const scope=CatalogTransactionScope.from(trx);
     const prior=(await sql<{result:QualityCorrectionResult|null}>`select governance_catalog.quality_correction_prior(${actor},${JSON.stringify(internal)}::jsonb) as result`.execute(scope)).rows[0]!.result;
    if(prior)return prior;
    const receiveInput:ReceiveFileInput={campus:input.campus,purpose:input.purpose,retentionSeconds:input.retentionSeconds,fileRequestId:input.receiveRequestId,extension:`.${input.format.toLowerCase()}` as '.csv'|'.json'|'.xlsx',job:{action:'REVISE',scope:'SYNTHETIC',requestId:derivedReceiveJobRequestId(provider,input.receiveRequestId),reason:'QUALITY_CORRECTION',jobId:input.jobId,expectedCurrentRevision:input.expectedCurrentRevision,input:{kind:'FILE',format:input.format,parserPolicy:input.parserPolicy}}};
     const received=await receiveFileInTransaction(scope,provider,actor,receiveInput,raw);
     const correction=(await sql<{result:QualityCorrectionResult}>`select governance_catalog.quality_issue_record_correction(${actor},${JSON.stringify(internal)}::jsonb,${received.job.revisionId}::uuid,${received.artifact.artifactId}::uuid) as result`.execute(scope)).rows[0]!.result;
    return correction;
   }));
   }finally{raw.fill(0);}
  },
  async resolveWithEvidence(actor:string,input:ResolveWithEvidenceInput){
   if(!Check(ResolveWithEvidenceSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input=structuredClone(input);
    return qualitySafe(()=>db.transaction().execute(async trx=>{
     const scope=CatalogTransactionScope.from(trx);
     const prior=(await sql<{result:QualityIssueDispositionResult|'LEGACY_EVIDENCE_REQUIRED'|null}>`select governance_catalog.quality_resolution_prior(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(scope)).rows[0]!.result;
     if(prior&&prior!=='LEGACY_EVIDENCE_REQUIRED')return prior;
     const detail=(await sql<{result:QualityIssueDetail}>`select governance_catalog.quality_issue_detail(${actor},${JSON.stringify(detailInput(input))}::jsonb) as result`.execute(scope)).rows[0]!.result;
    const issue=detail.issue;
     const oldEvidence=await evidenceReader.readInTransaction(scope,actor,expectedDimensions(input,issue.runId),issue.runId,true);
     const newEvidence=await evidenceReader.readInTransaction(scope,actor,expectedDimensions(input,input.newRunId),input.newRunId,true);
    if(input.newRevisionId!==newEvidence.run.revisionId)throw new Error('REVISION_REFERENCE_INVALID');
    if(!oldEvidence.run.qualityCandidateDigest||!newEvidence.run.qualityCandidateDigest)throw new Error('VALIDATION_PROVENANCE_REQUIRED');
    if(oldEvidence.job.id!==newEvidence.job.id||oldEvidence.run.contractVersionId!==newEvidence.run.contractVersionId||oldEvidence.run.ruleVersion!==newEvidence.run.ruleVersion||oldEvidence.run.parserPolicy!==newEvidence.run.parserPolicy||oldEvidence.run.interpretationPolicy!==newEvidence.run.interpretationPolicy)throw new Error('POLICY_INCOMPATIBLE');
    const current=newEvidence.job.revisions.find(revision=>revision.id===newEvidence.run.revisionId);if(!current||(prior!=='LEGACY_EVIDENCE_REQUIRED'&&newEvidence.job.currentRevisionId!==newEvidence.run.revisionId)||current.input.kind!=='FILE')throw new Error('STALE_REVISION');
    let cursor=current;let linked=false;const seen=new Set<string>();while(cursor.previousRevisionId&&!seen.has(cursor.id)){seen.add(cursor.id);if(cursor.previousRevisionId===oldEvidence.run.revisionId){linked=true;break;}const previous=newEvidence.job.revisions.find(revision=>revision.id===cursor.previousRevisionId);if(!previous)break;cursor=previous;}
    if(!linked)throw new Error('REVISION_LINEAGE_INVALID');
    const {targetRow,targetField}=requireMatchedRow(oldEvidence,newEvidence,issue,input);
    const normalized={...input,newRevisionId:newEvidence.run.revisionId,targetRow,targetField,matchStatus:'MATCHED',oldProof:qualityResolutionProof(provider,oldEvidence.job,oldEvidence.parsed!,oldEvidence.evaluation,input),newProof:qualityResolutionProof(provider,newEvidence.job,newEvidence.parsed!,newEvidence.evaluation,input)};
     return (await sql<{result:QualityIssueDispositionResult}>`select governance_catalog.quality_issue_resolve(${actor},${JSON.stringify(normalized)}::jsonb) as result`.execute(scope)).rows[0]!.result;
   }));
  },
  async rejectBatch(actor:string,input:RejectBatchInput){
   if(!Check(RejectBatchSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
   return qualitySafe(async()=> (await sql<{result:QualityIssueDispositionResult}>`select governance_catalog.quality_batch_reject(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result);
  },
  async qualityIssueRead(actor:string,input:QualityIssueReadInput){
   if(!Check(QualityIssueReadSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
   return qualitySafe(async()=> (await sql<{result:QualityIssueListResult}>`select governance_catalog.quality_issue_read(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result);
  },
  async qualityIssueDetail(actor:string,input:QualityIssueDetailInput){
   if(!Check(QualityIssueDetailSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
   return qualitySafe(async()=> (await sql<{result:QualityIssueDetail}>`select governance_catalog.quality_issue_detail(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result);
  },
  async qualityEligibilityRead(actor:string,input:QualityEligibilityInput){
   if(!Check(QualityEligibilitySchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input=structuredClone(input);
    return qualitySafe(()=>db.transaction().execute(async trx=>{
     const scope=CatalogTransactionScope.from(trx);
     const evidence=await evidenceReader.readInTransaction(scope,actor,expectedDimensions(input,input.runId),input.runId,false);
    if(evidence.job.id!==input.jobId||evidence.run.revisionId!==input.revisionId||evidence.job.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');
    const candidates=buildQualityIssueCandidates(evidence.evaluation);
    const notRun=evidence.evaluation.layers.filter(layer=>layer.status==='NOT_RUN').map(layer=>layer.layer);
     return (await sql<{result:QualityEligibilityResult}>`select governance_catalog.quality_eligibility(${actor},${JSON.stringify(input)}::jsonb,${JSON.stringify(candidates)}::jsonb,${JSON.stringify(notRun)}::jsonb) as result`.execute(scope)).rows[0]!.result;
   }));
  },
 };
}
