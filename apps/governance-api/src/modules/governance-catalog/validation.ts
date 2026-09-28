import {randomUUID,createHmac} from 'node:crypto';
import {sql,type Kysely} from 'kysely';
import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import {ParseFileSchema,type ParseFileInput} from './file-intake.js';
import {ProtectedReadSchema,protectedArtifacts,type KeyProviderPort} from './protected-artifact.js';
import type {ImportJob} from './import-job.js';
import type {ParameterItem} from './parameter-schema.js';
import type {OrganizationWorkbookResult,ParserResult} from './file-parser.js';
import {parseSignature,signaturesEqual,verifyOrganizationBundlePayload,verifyParsedPayload} from './parse-provenance.js';
import {evaluateRuleSet,type ValidationEvaluation} from './validation-rules.js';
import {buildQualityIssueCandidates,qualityCandidateDigest,qualityEligibilityDigest} from './quality-candidates.js';
import {qualityResolutionProof,qualityResolutionDigest} from './quality-resolution-proof.js';
import {CatalogTransactionScope} from './transaction-scope.js';
export const ValidateRevisionSchema=ParseFileSchema;
const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const ReadDimensions={scope:ProtectedReadSchema.properties.scope,campus:ProtectedReadSchema.properties.campus,purpose:ProtectedReadSchema.properties.purpose};
export const ExplainValidationSchema=Type.Object({...ReadDimensions,runId:Id},{additionalProperties:false});
export const CompareValidationSchema=Type.Object({...ReadDimensions,leftRunId:Id,rightRunId:Id},{additionalProperties:false});
export interface ValidationRun {runId:string;jobId:string;revisionId:string;parseArtifactId:string;sourceArtifactId:string;parserPolicy:string;contractVersionId:string;ruleVersion:string;interpretationPolicy:string;decision:'PASS'|'FAIL'|'BLOCKED';issueCount:number;resultArtifactId:string;recordedAt:string;adapterReadiness:'NOT_READY'|'READY';securityScan:'NOT_RUN';qualityCandidateDigest?:string|null;qualityEligibilityDigest?:string|null;qualityResolutionDigest?:string|null}
type SignedRun=ValidationRun&{signature:string};
interface Provenance {artifact_id:string;source_artifact_id:string;job_id:string;revision_id:string;contract_version_id:string;policy:'STRICT_V1'|'STRICT_V2'|'STRICT_ORG_BUNDLE_V1'|'STRICT_DEPARTMENT_V1';structural_status:'PARSED'|'REJECTED';signature:string}

export interface VerifiedValidationEvidence {run:ValidationRun;job:ImportJob;evaluation:ValidationEvaluation;parsed?:ParserResult;organizationBundle?:OrganizationWorkbookResult}
function validationSignature(provider:KeyProviderPort|undefined,run:ValidationRun,bytes:Uint8Array){
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 const binding=[run.runId,run.jobId,run.revisionId,run.parseArtifactId,run.sourceArtifactId,run.parserPolicy,run.contractVersionId,run.ruleVersion,run.interpretationPolicy,run.decision,run.issueCount,run.resultArtifactId,run.recordedAt,run.adapterReadiness,run.securityScan];
  const signedBinding=run.qualityCandidateDigest&&run.qualityEligibilityDigest?[...binding,run.qualityCandidateDigest,run.qualityEligibilityDigest]:binding;
  return createHmac('sha256',provider.lookup()).update(JSON.stringify(['P0_05_VALIDATION_V1',...signedBinding,...(run.qualityResolutionDigest?[run.qualityResolutionDigest]:[])])).update(bytes).digest('hex');
}

/** Internal verified-read seam for sibling governance-catalog capabilities. */
export function createValidationEvidenceReader(provider?:KeyProviderPort){
 const readEvaluation=async(trx:CatalogTransactionScope,actor:string,input:Static<typeof ExplainValidationSchema>,run:SignedRun)=>{
  const bytes=await protectedArtifacts(trx,provider).authorizeSensitiveRead(actor,{...ReadDimensionsInput(input),requestId:randomUUID(),artifactId:run.resultArtifactId},{jobId:run.jobId,revisionId:run.revisionId,kind:'ERROR_REPORT'});
  try{
   if(!signaturesEqual(validationSignature(provider,run,bytes),run.signature))throw new Error('VALIDATION_PROVENANCE_REQUIRED');
   const evaluation:ValidationEvaluation=JSON.parse(Buffer.from(bytes).toString('utf8'));
   if(evaluation.decision!==run.decision||evaluation.issues.length!==run.issueCount||evaluation.interpretationPolicy!==run.interpretationPolicy)throw new Error('VALIDATION_PROVENANCE_REQUIRED');
   return evaluation;
  }finally{bytes.fill(0);}
 };
 const readParsed=async(trx:CatalogTransactionScope,actor:string,input:Static<typeof ExplainValidationSchema>,run:SignedRun,job:ImportJob)=>{
  const p=(await sql<{result:Provenance|null}>`select governance_catalog.read_parse(${actor},${run.jobId}::uuid,${run.parseArtifactId}::uuid) as result`.execute(trx)).rows[0]!.result;
  const metadata=job.revisions.find(revision=>revision.id===run.revisionId)?.input;
  if(!p||!metadata||metadata.kind!=='FILE'||p.job_id!==job.id||p.revision_id!==run.revisionId||p.contract_version_id!==job.contract.versionId||p.policy!==metadata.parserPolicy||p.structural_status!=='PARSED')throw new Error('PARSE_PROVENANCE_REQUIRED');
  const bytes=await protectedArtifacts(trx,provider).authorizeSensitiveRead(actor,{...ReadDimensionsInput(input),requestId:randomUUID(),artifactId:p.artifact_id},{jobId:run.jobId,revisionId:run.revisionId,kind:'RAW_CELL'});
  try{
   if(!signaturesEqual(parseSignature(provider,p.artifact_id,job.id,run.revisionId,job.contract.versionId,bytes),p.signature))throw new Error('PARSE_PROVENANCE_REQUIRED');
   if(metadata.parserPolicy==='STRICT_ORG_BUNDLE_V1')return verifyOrganizationBundlePayload(bytes,{sourceArtifactId:p.source_artifact_id,status:p.structural_status,manifestDigest:metadata.manifestDigest,contractsDigest:metadata.contractsDigest});
   return verifyParsedPayload(bytes,{sourceArtifactId:p.source_artifact_id,policy:metadata.parserPolicy,format:metadata.format,status:p.structural_status},job.contract.definition.fields);
  }finally{bytes.fill(0);}
 };
 return {
   async readInTransaction(trx:CatalogTransactionScope,actor:string,input:Static<typeof ExplainValidationSchema>,runId:string,includeParsed=false):Promise<VerifiedValidationEvidence>{
   await sql`select pg_advisory_xact_lock(901002)`.execute(trx);
   const run=(await sql<{result:SignedRun}>`select governance_catalog.read_validation(${actor},${runId}::uuid) as result`.execute(trx)).rows[0]!.result;
   if(!run)throw new Error('NOT_FOUND');
   const job=(await sql<{result:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:input.scope,jobId:run.jobId})}::jsonb) as result`.execute(trx)).rows[0]!.result;
   const evaluation=await readEvaluation(trx,actor,input,run);
   if(!includeParsed)return {run,evaluation,job};
   const parsed=await readParsed(trx,actor,input,run,job);
   return parsed.policy==='STRICT_ORG_BUNDLE_V1'?{run,evaluation,job,organizationBundle:parsed}:{run,evaluation,job,parsed};
  },
  readEvaluation,
 };
}

export function validation(db:Kysely<DB>,provider?:KeyProviderPort){
 const evidenceReader=createValidationEvidenceReader(provider);
 const explainIn=async(trx:Kysely<DB>,actor:string,input:Static<typeof ExplainValidationSchema>)=>{
   if(!Check(ExplainValidationSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input={...input};
     const evidence=await evidenceReader.readInTransaction(CatalogTransactionScope.from(trx),actor,input,input.runId);
    const {run,job,evaluation}=evidence;
   return {runId:run.runId,revisionId:run.revisionId,contractVersionId:run.contractVersionId,ruleVersion:run.ruleVersion,parserPolicy:run.parserPolicy,interpretationPolicy:run.interpretationPolicy,historical:true as const,isCurrentRevision:job.currentRevisionId===run.revisionId,evaluation};
 };
 const explain=(actor:string,input:Static<typeof ExplainValidationSchema>)=>db.transaction().execute(trx=>explainIn(trx,actor,input));
 return {
  async validateRevision(actor:string,input:ParseFileInput):Promise<ValidationRun>{
   if(!Check(ValidateRevisionSchema,input)||input.requestId===input.outputRequestId)throw new Error('CLOSED_INPUT_REQUIRED');input={...input};
   return db.transaction().execute(async trx=>{
    // Shared authorization lock covers the bounded calculation and final rechecks.
    await sql`select pg_advisory_xact_lock(901002)`.execute(trx);
    const job=(await sql<{result:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:input.scope,jobId:input.jobId})}::jsonb) as result`.execute(trx)).rows[0]!.result;
    const store=protectedArtifacts(trx,provider);
       const prior=(await sql<{result:SignedRun|null}>`select governance_catalog.validation_prior(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(trx)).rows[0]!.result;
      if(prior){
       await evidenceReader.readEvaluation(CatalogTransactionScope.from(trx),actor,{...ReadDimensionsInput(input),runId:prior.runId},prior);
      const {signature,...run}=prior;return run;
     }
    const acceptance=(await sql<{allowed:boolean}>`select bool_or(has_function_privilege(current_user,p.oid,'EXECUTE')) as allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='governance_catalog' and p.proname='accept_validation'`.execute(trx)).rows[0]?.allowed;
    if(!acceptance)throw new Error('VALIDATION_OWNER_REQUIRED');
     if(job.status==='REJECTED')throw new Error('BATCH_REJECTED');
    if(job.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');
    const metadata=job.revisions.at(-1)!.input;
    if(metadata.kind!=='FILE')throw new Error('FILE_REVISION_REQUIRED');
    const p=(await sql<{result:Provenance|null}>`select governance_catalog.read_parse(${actor},${input.jobId}::uuid,${input.artifactId}::uuid) as result`.execute(trx)).rows[0]!.result;
    if(!p||p.job_id!==job.id||p.revision_id!==input.revisionId||p.contract_version_id!==job.contract.versionId||p.policy!==metadata.parserPolicy)throw new Error('PARSE_PROVENANCE_REQUIRED');
    const source=await store.authorizeSensitiveRead(actor,{...ReadDimensionsInput(input),requestId:randomUUID(),artifactId:p.source_artifact_id},{jobId:job.id,revisionId:input.revisionId,kind:'RAW_FILE'});source.fill(0);
    const bytes=await store.authorizeSensitiveRead(actor,{...ReadDimensionsInput(input),requestId:randomUUID(),artifactId:p.artifact_id},{jobId:job.id,revisionId:input.revisionId,kind:'RAW_CELL'});
    let evaluation:ValidationEvaluation;let resolutionProof:string;
    try{
     if(!signaturesEqual(parseSignature(provider,p.artifact_id,job.id,input.revisionId,job.contract.versionId,bytes),p.signature))throw new Error('PARSE_PROVENANCE_REQUIRED');
     if(metadata.parserPolicy==='STRICT_ORG_BUNDLE_V1')throw new Error('BUNDLE_CONTEXT_REQUIRED');
     const parsed=verifyParsedPayload(bytes,{sourceArtifactId:p.source_artifact_id,policy:metadata.parserPolicy,format:metadata.format,status:p.structural_status},job.contract.definition.fields);
     if(parsed.structuralStatus!=='PARSED')throw new Error('STRUCTURAL_REJECTED');
     const dependencies:ValidationEvaluation['dependencies']=[];
     for(const ref of job.contract.definition.references){
      if(ref.status==='DECLARED_PARAMETER'){
       const observed=(await sql<{result:ParameterItem[]}>`select governance_catalog.parameter_read(${actor},${JSON.stringify({scope:input.scope,mode:'APPROVED',versionId:ref.parameterVersionId})}::jsonb) as result`.execute(trx)).rows[0]!.result.find(item=>item.versionId===ref.parameterVersionId&&item.reviewDigest===ref.parameterDigest);
       dependencies.push(observed?{target:'GOV09.config_id',scope:input.scope,status:'OBSERVED',identity:observed.id,version:observed.versionId,periods:[{from:observed.validFrom,to:observed.validTo}]}:{target:ref.target,scope:input.scope,status:'NOT_READY',identity:'',version:null,periods:[]});
      }else dependencies.push({target:ref.target,status:'NOT_READY',scope:input.scope,identity:'',version:null,periods:[]});
     }
     evaluation=evaluateRuleSet(job.contract.dataset,job.contract.definition,parsed.rows,dependencies,{from:job.contract.validFrom,to:job.contract.validTo});
     resolutionProof=qualityResolutionProof(provider,job,parsed,evaluation,input);
    }finally{bytes.fill(0);}
    const payload=Buffer.from(JSON.stringify(evaluation));
    try{
     if(payload.length>1048576)throw new Error('VALIDATION_RESULT_LIMIT');
     const artifact=await store.storeProtectedArtifact(actor,{...ReadDimensionsInput(input),requestId:input.outputRequestId,retentionSeconds:input.retentionSeconds,jobId:job.id,revisionId:input.revisionId,kind:'ERROR_REPORT'},payload);
     const stamp=(await sql<{id:string;time:string}>`select uuidv7()::text as id,to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') as time`.execute(trx)).rows[0]!;
       const candidates=buildQualityIssueCandidates(evaluation);
       const notRunLayers=evaluation.layers.filter(layer=>layer.status==='NOT_RUN').map(layer=>layer.layer);
       const dimensions={campus:input.campus,purpose:input.purpose};
       const candidateDigest=qualityCandidateDigest(candidates,dimensions);
       const eligibilityDigest=qualityEligibilityDigest(candidates,notRunLayers,dimensions);
       const run:ValidationRun={runId:stamp.id,jobId:job.id,revisionId:input.revisionId,parseArtifactId:p.artifact_id,sourceArtifactId:p.source_artifact_id,parserPolicy:p.policy,contractVersionId:job.contract.versionId,ruleVersion:job.contract.definition.ruleVersion,interpretationPolicy:evaluation.interpretationPolicy,decision:evaluation.decision==='FAIL'?'FAIL':'BLOCKED',issueCount:evaluation.issues.length,resultArtifactId:artifact.artifactId,recordedAt:stamp.time,adapterReadiness:'NOT_READY',securityScan:'NOT_RUN',qualityCandidateDigest:candidateDigest,qualityEligibilityDigest:eligibilityDigest,qualityResolutionDigest:qualityResolutionDigest(resolutionProof)};
       const resolutionFunction=(await sql<{name:string|null}>`select to_regprocedure('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text,text)')::text as name`.execute(trx)).rows[0]!.name;
       if(!resolutionFunction)delete run.qualityResolutionDigest;
       const signature=validationSignature(provider,run,payload);
       const acceptFunction=(await sql<{name:string|null}>`select to_regprocedure('governance_catalog.accept_validation(text,jsonb,uuid,text,integer,uuid,text,text,text,text)')::text as name`.execute(trx)).rows[0]!.name;
      let saved:SignedRun;
      if(resolutionFunction){
       saved=(await sql<{result:SignedRun}>`select governance_catalog.accept_validation(${actor},${JSON.stringify(input)}::jsonb,${artifact.artifactId}::uuid,${run.decision},${run.issueCount},${run.runId}::uuid,${run.recordedAt},${signature},${candidateDigest},${eligibilityDigest},${run.qualityResolutionDigest!}) as result`.execute(trx)).rows[0]!.result;
      }else if(acceptFunction){
       saved=(await sql<{result:SignedRun}>`select governance_catalog.accept_validation(${actor},${JSON.stringify(input)}::jsonb,${artifact.artifactId}::uuid,${run.decision},${run.issueCount},${run.runId}::uuid,${run.recordedAt},${signature},${candidateDigest},${eligibilityDigest}) as result`.execute(trx)).rows[0]!.result;
       }else{
        const {qualityCandidateDigest:_legacyCandidateDigest,qualityEligibilityDigest:_legacyEligibilityDigest,...legacyRun}=run;
       const legacySignature=validationSignature(provider,legacyRun,payload);
       saved=(await sql<{result:SignedRun}>`select governance_catalog.accept_validation(${actor},${JSON.stringify(input)}::jsonb,${artifact.artifactId}::uuid,${run.decision},${run.issueCount},${run.runId}::uuid,${run.recordedAt},${legacySignature}) as result`.execute(trx)).rows[0]!.result;
      }
     if(!signaturesEqual(validationSignature(provider,saved,payload),saved.signature))throw new Error('VALIDATION_PROVENANCE_REQUIRED');
     const {signature:removed,...output}=saved;return output;
    }finally{payload.fill(0);}
   });
  },
  explainIssue:explain,
  async compareValidationRuns(actor:string,input:Static<typeof CompareValidationSchema>){
   if(!Check(CompareValidationSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input={...input};
   return db.transaction().execute(async trx=>{
    const left=await explainIn(trx,actor,{...ReadDimensionsInput(input),runId:input.leftRunId});
    const right=await explainIn(trx,actor,{...ReadDimensionsInput(input),runId:input.rightRunId});
    return {leftRunId:left.runId,rightRunId:right.runId,sameConclusion:left.evaluation.decision===right.evaluation.decision,sameEvaluation:JSON.stringify(left.evaluation)===JSON.stringify(right.evaluation),sameContractVersion:left.contractVersionId===right.contractVersionId,sameRuleVersion:left.ruleVersion===right.ruleVersion,sameParserPolicy:left.parserPolicy===right.parserPolicy,sameInterpretationPolicy:left.interpretationPolicy===right.interpretationPolicy,historical:true as const};
   });
  },
 };
}
function ReadDimensionsInput(input:{scope:'SYNTHETIC';campus:'NORTH'|'SOUTH';purpose:'IDENTITY_VERIFY'|'CONTACT_VERIFY'|'HR_RESTRICTED'}){return {scope:input.scope,campus:input.campus,purpose:input.purpose};}

/** Owner-produced file evidence uses the existing protected parser and validation ledger. */
export async function recordOwnerFileValidation(scope:CatalogTransactionScope,provider:KeyProviderPort|undefined,actor:string,input:{jobId:string;revisionId:string;sourceArtifactId:string;campus:'NORTH'|'SOUTH';requestId:string;parseRequestId:string;outputRequestId:string;contractVersionId:string;ruleVersion:string;parserPolicy:string;structuralStatus:'PARSED'|'REJECTED';parsed:unknown;evaluation:ValidationEvaluation}){
 const dimensions={scope:'SYNTHETIC' as const,campus:input.campus,purpose:'IDENTITY_VERIFY' as const};
 const store=protectedArtifacts(scope,provider),parsedBytes=Buffer.from(JSON.stringify(input.parsed));
 let parsedId:string;
 try{
  const saved=await store.storeProtectedArtifact(actor,{...dimensions,requestId:input.parseRequestId,jobId:input.jobId,revisionId:input.revisionId,kind:'RAW_CELL',retentionSeconds:3600},parsedBytes);parsedId=saved.artifactId;
  await sql`select governance_catalog.register_parse(${actor},${parsedId}::uuid,${input.sourceArtifactId}::uuid,${parseSignature(provider,parsedId,input.jobId,input.revisionId,input.contractVersionId,parsedBytes)},${input.structuralStatus})`.execute(scope);
 }finally{parsedBytes.fill(0);}
 const request={...dimensions,requestId:input.requestId,outputRequestId:input.outputRequestId,retentionSeconds:3600,jobId:input.jobId,revisionId:input.revisionId,artifactId:parsedId};
 const prior=(await sql<{r:SignedRun|null}>`select governance_catalog.validation_prior(${actor},${JSON.stringify(request)}::jsonb) r`.execute(scope)).rows[0]!.r;
 if(prior){const evaluation=await createValidationEvidenceReader(provider).readEvaluation(scope,actor,{...dimensions,runId:prior.runId},prior);const {signature:_,...run}=prior;return {run,evaluation};}
 const payload=Buffer.from(JSON.stringify(input.evaluation));
 try{
  if(payload.length>1048576)throw new Error('VALIDATION_RESULT_LIMIT');
  const outputRequestId=input.outputRequestId,saved=await store.storeProtectedArtifact(actor,{...dimensions,requestId:outputRequestId,jobId:input.jobId,revisionId:input.revisionId,kind:'ERROR_REPORT',retentionSeconds:3600},payload);
  const stamp=(await sql<{id:string;time:string}>`select uuidv7()::text id,to_char(timezone('Asia/Shanghai',clock_timestamp()),'YYYY-MM-DD"T"HH24:MI:SS.US') time`.execute(scope)).rows[0]!;
  const candidates=buildQualityIssueCandidates(input.evaluation),candidateDigest=qualityCandidateDigest(candidates,dimensions),eligibilityDigest=qualityEligibilityDigest(candidates,input.evaluation.layers.filter(l=>l.status==='NOT_RUN').map(l=>l.layer),dimensions);
  const run:ValidationRun={runId:stamp.id,jobId:input.jobId,revisionId:input.revisionId,parseArtifactId:parsedId,sourceArtifactId:input.sourceArtifactId,parserPolicy:input.parserPolicy,contractVersionId:input.contractVersionId,ruleVersion:input.ruleVersion,interpretationPolicy:input.evaluation.interpretationPolicy,decision:input.evaluation.decision,issueCount:input.evaluation.issues.length,resultArtifactId:saved.artifactId,recordedAt:stamp.time,adapterReadiness:['STRICT_ORG_BUNDLE_V1','STRICT_DEPARTMENT_V1'].includes(input.parserPolicy)?'READY':'NOT_READY',securityScan:'NOT_RUN',qualityCandidateDigest:candidateDigest,qualityEligibilityDigest:eligibilityDigest};
  const accepted=(await sql<{r:SignedRun}>`select governance_catalog.accept_validation(${actor},${JSON.stringify(request)}::jsonb,${saved.artifactId}::uuid,${run.decision},${run.issueCount},${run.runId}::uuid,${run.recordedAt},${validationSignature(provider,run,payload)},${candidateDigest},${eligibilityDigest},NULL) r`.execute(scope)).rows[0]!.r;
  if(!signaturesEqual(validationSignature(provider,accepted,payload),accepted.signature))throw new Error('VALIDATION_PROVENANCE_REQUIRED');
  const {signature:_,...runResult}=accepted;return {run:runResult,evaluation:input.evaluation};
 }finally{payload.fill(0);}
}
