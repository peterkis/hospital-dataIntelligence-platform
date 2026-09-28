import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { protectedArtifacts, type KeyProviderPort } from './protected-artifact.js';
import { fileIntake } from './file-intake.js';
import {validation} from './validation.js';
import {qualityIssues} from './quality-issues.js';
import {applyCoordinator} from './apply-coordinator.js';
import type {ApplyOwnerPort} from './apply-coordinator.js';
import {workbench} from './workbench.js';
export {WorkbenchSummarySchema,WorkbenchAccessSchema,WorkbenchAccessInputSchema} from './workbench.js';
export {textWorkbook} from './issue-workbook.js';
export {PlanOwnerUnitSchema,ApproveApplyUnitSchema,ApplyUnitSchema} from './apply-coordinator.js';
// In-process Owner composition seam; these capabilities are never serialized to clients.
export {applyCoordinator} from './apply-coordinator.js';
export type {ApplyOwnerPort,ObservedOwnerUnit,OwnerFact} from './apply-coordinator.js';
export {CatalogTransactionScope} from './transaction-scope.js';
export {canonicalPlan,planBinding} from './plan-binding.js';
export {authenticateRegistrationEvidence,sealProtectedPayload} from './protected-artifact.js';
export type {PlanOwnerUnitInput,ApplyUnitInput,UnitOutcome} from './apply-coordinator.js';
import {dryRun} from './dry-run.js';
export {BuildDryRunSchema,ApprovalCandidateSchema} from './dry-run.js';
export type {BuildDryRunInput,ApprovalCandidateInput} from './dry-run.js';
export type {ChangeIntent,ApplyUnitPlan,AliasGraph} from './dry-run-rules.js';
export {ValidateRevisionSchema,ExplainValidationSchema,CompareValidationSchema} from './validation.js';
export type {ValidationRun} from './validation.js';
export {EXECUTION_COVERAGE_VERSION} from './validation-rules.js';
export type {ExecutionCoverage,ExecutionCoverageCheck,ExecutionCoverageStatus,ValidationEvaluation} from './validation-rules.js';
export { ReceiveFileSchema, ParseFileSchema } from './file-intake.js';
export type { ReceiveFileInput, ParseFileInput } from './file-intake.js';
export {OpenIssueSchema,AssignIssueSchema,ProposeCorrectionSchema,ResolveWithEvidenceSchema,RejectBatchSchema,QualityIssueReadSchema,QualityIssueDetailSchema,QualityEligibilitySchema} from './quality-issues.js';
export type {OpenIssueInput,AssignIssueInput,ProposeCorrectionInput,ResolveWithEvidenceInput,RejectBatchInput,QualityIssueReadInput,QualityIssueDetailInput,QualityEligibilityInput,QualityIssueRecord,QualityIssueDetail,QualityIssueOpenResult,QualityIssueDispositionResult,QualityIssueListResult,QualityCorrectionResult,QualityEligibilityResult} from './quality-issues.js';
export type {QualityIssueCandidate} from './quality-candidates.js';
export type { CanonicalRow, RawCellProvenance, ParserResult } from './file-parser.js';
export { LocalSyntheticKeyProvider, ProtectedStoreSchema, ProtectedReadSchema } from './protected-artifact.js';
export type { KeyProviderPort, ProtectedStoreInput, ProtectedReadInput, ProtectedReference } from './protected-artifact.js';
import type { ImportJob, ImportJobOutcome } from './import-job.js';
import {ImportJobCommandSchema,ImportJobReadSchema,ImportMetadataSchema} from './import-job.js';
import {Check} from 'typebox/value';
import {selectImportAdapter} from './import-adapter.js';
export {ImportJobCommandSchema,ImportJobReadSchema} from './import-job.js';
export type {ImportJobCommand,ImportJob,ImportJobOutcome} from './import-job.js';
export {selectImportAdapter,assertJobLocalAlias,requireImportExecution} from './import-adapter.js';
export type {ImportStage,JobRevisionContext,JobLocalAlias} from './import-adapter.js';
import type { DB as VNextDB } from '../../platform/database/vnext-types.generated.js';
import type { ImportContractItem, ImportContractOutcome } from './contract-schema.js';
export { ContractCommandSchema,ContractItemSchema,ContractOutcomeSchema,ContractScopeSchema,ContractTimeSchema,contractInputSchemas } from './contract-schema.js';
import type {ParameterItem,ParameterOutcome} from './parameter-schema.js';
export {ParameterCommandSchema,ParameterItemSchema,ParameterOutcomeSchema} from './parameter-schema.js';

export interface CatalogField { original: { code: string; label: string; type: string; required: string; ref: string; definition: string; privacy: string; conditional_requirement: string; source_trace: string; max_length_or_format: string }; pointer: string; routing: Record<string,string> }
export interface CatalogPayload {
  fields?: CatalogField[]; adopted?: { name: string; explanation: string }; original?: Record<string,string>;
  domain?: string; dependencies?: Array<Record<string,unknown>>; model?: Record<string,unknown>;
  name?: string; readiness?: string; adapter?: string; dataset?: string; authorityScope?: string; fieldGroup?: string; role?: string; assigneeRole?: string;
  environment?: string; sourceKind?: string; deploymentScope?: string; sourceEvidence?: string; businessOwnerRole?:string;
}
export interface CatalogItem { id:string; kind:'DATASET'|'SOURCE'|'RESPONSIBILITY'; code:string; scope:'BASELINE'|'SYNTHETIC'; version:number; versionId:string; head:string; status:'DRAFT'|'REVIEW'|'PUBLISHED'|'RETIRED'; payload:CatalogPayload; validFrom:string; validTo:string|null; recordedAt:string }
export interface CatalogResult { items:CatalogItem[]; domains:Array<{code:string;name:string;datasets:string[]}> }
export interface Command {
  action:'CREATE'|'REVISE'|'SUBMIT'|'PUBLISH'|'REJECT'|'RETIRE'; scope:'BASELINE'|'SYNTHETIC'; requestId:string; reason:string;
  target?:string; expectedHead?:string; kind?:'DATASET'|'SOURCE'|'RESPONSIBILITY'; code?:string;
  impactDigest?:string; values?:Record<string,string>; validFrom?:string; validTo?:string|null; reviewDigest?:string;
}
export interface Outcome { id:string; head:string; version:number; versionId:string; status:CatalogItem['status']; reviewDigest:string; recordedAt:string }
export interface HistoryRow { head:string; status:CatalogItem['status']; version:number; payload:CatalogPayload; validFrom:string; validTo:string|null; recordedAt:string }

export interface SourceImpact {impactDigest:string;effectiveMode:'ON_COMMIT';target:string;head:string;action:'PUBLISH'|'RETIRE';asOf:string;catalogHead:string;candidateVersionId:string;definitionVersionId:string|null;definitionDigest:string|null;targetDefinitions:Array<Record<string,unknown>>;current:Array<Record<string,unknown>>;history:Array<Record<string,unknown>>;opening:Array<Record<string,unknown>>;closing:Array<Record<string,unknown>>}

export interface SourceImpact {contractCurrent:Array<Record<string,unknown>>;contractHistory:Array<Record<string,unknown>>;contractOpening:Array<Record<string,unknown>>;contractClosing:Array<Record<string,unknown>>;contractHead:string}

export async function openCatalog(connectionString = process.env['VNEXT_DATABASE_URL'], keyProvider?: KeyProviderPort, applyOwner?:ApplyOwnerPort) {
  if (!connectionString) throw new Error('RECEIPT_BOUND_CONNECTION_REQUIRED');
  const db = new Kysely<VNextDB>({dialect:new PostgresDialect({pool:new Pool({connectionString,max:4,application_name:'hdi-vnext-catalog',options:'-c timezone=Asia/Shanghai'})})});
  const readImportJob=async(actor:string,input:{scope:'BASELINE'|'SYNTHETIC';jobId:string}):Promise<ImportJob>=>{
    if(!Check(ImportJobReadSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
    return (await sql<{result:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result;
  };
  return {
    ...fileIntake(db,keyProvider),
    ...validation(db,keyProvider),
    ...qualityIssues(db,keyProvider),
    ...dryRun(db,keyProvider),
    ...applyCoordinator(db,keyProvider,applyOwner),
    ...workbench(db),
    ...protectedArtifacts(db,keyProvider),
    async importJobCommand(actor:string,input:unknown):Promise<ImportJobOutcome> {
      if(input===null||typeof input!=='object'||Array.isArray(input)||!('input' in input))throw new Error('CLOSED_INPUT_REQUIRED');
      if(!Check(ImportMetadataSchema,input['input']))throw new Error('CLOSED_METADATA_REQUIRED');
      if(!Check(ImportJobCommandSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');
      if(input.input.kind==='FILE')throw new Error('FILE_RECEIVE_REQUIRED');
      return (await sql<{result:ImportJobOutcome}>`select governance_catalog.import_job_command(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result;
    },
    importJobRead:readImportJob,
    async importJobAdapter(actor:string,input:{scope:'BASELINE'|'SYNTHETIC';jobId:string}) {
      const job=await readImportJob(actor,input);
      const revision=job.revisions.find(r=>r.id===job.currentRevisionId);
      return selectImportAdapter({dataset:job.contract.dataset,profile:job.profile,contractVersion:job.contract.version,templateVersion:job.contract.definition.templateVersion,...(revision?.input.kind==='FILE'?{parserPolicy:revision.input.parserPolicy}:{})});
    },
    async parameterCommand(actor:string,input:Record<string,unknown>):Promise<ParameterOutcome> {
      return (await sql<{result:ParameterOutcome}>`select governance_catalog.parameter_command(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result;
    },
    async parameterRead(actor:string,input:{scope:'BASELINE'|'SYNTHETIC';target?:string;versionId?:string;asOf?:string;mode?:'CURRENT'|'APPROVED'}):Promise<ParameterItem[]> {
      return (await sql<{result:ParameterItem[]}>`select governance_catalog.parameter_read(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result;
    },
    async contractImpact(actor:string,scope:string,id:string,action:'PUBLISH'|'RETIRE'):Promise<{impactDigest:string;closing:Array<Record<string,unknown>>;contractVersionId:string;contractId:string;action:string}> {
      return (await sql<{result:{impactDigest:string;closing:Array<Record<string,unknown>>;contractVersionId:string;contractId:string;action:string}}>`select governance_catalog.contract_change_impact(${actor},${scope},${id}::uuid,${action}) as result`.execute(db)).rows[0]!.result;
    },
    async contractImpactCases(actor:string,scope:string,id:string):Promise<Array<Record<string,unknown>>> {
      return (await sql<{result:Array<Record<string,unknown>>}>`select governance_catalog.contract_impact_cases(${actor},${scope},${id}::uuid) as result`.execute(db)).rows[0]!.result;
    },
    async contractRead(actor:string,input:{scope:'BASELINE'|'SYNTHETIC';mode:'CURRENT'|'HISTORY'|'EFFECTIVE';target?:string;versionId?:string;asOf?:string;businessAt?:string}):Promise<ImportContractItem[]> {
      return (await sql<{result:ImportContractItem[]}>`select governance_catalog.contract_read(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result;
    },
    async contractCommand(actor:string,input:Record<string,unknown>):Promise<ImportContractOutcome> {
      const allowed=['action','scope','requestId','reason','datasetVersionId','profile','definition','validFrom','validTo','target','expectedHead','reviewDigest','impactDigest'];
      if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('CLOSED_INPUT_REQUIRED');
      return (await sql<{result:ImportContractOutcome}>`select governance_catalog.contract_command(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db)).rows[0]!.result;
    },
    async read(actor:string, query:{scope:'BASELINE'|'SYNTHETIC';asOf?:string}):Promise<CatalogResult> {
      const response=await sql<{result:CatalogResult}>`select governance_catalog.read_catalog(${actor},${query.scope},${query.asOf??null}) as result`.execute(db);
      return response.rows[0]!.result;
    },
    async sourceImpact(actor:string,scope:string,id:string,action:'PUBLISH'|'RETIRE'):Promise<SourceImpact> {
      return (await sql<{result:SourceImpact}>`select governance_catalog.change_impact(${actor},${scope},${id}::uuid,${action}) as result`.execute(db)).rows[0]!.result;
    },
    async impactCases(actor:string,scope:string,id:string):Promise<Array<Record<string,unknown>>> {
      return (await sql<{result:Array<Record<string,unknown>>}>`select governance_catalog.impact_cases(${actor},${scope},${id}::uuid) as result`.execute(db)).rows[0]!.result;
    },
    async readEffective(actor:string,query:{scope:'BASELINE'|'SYNTHETIC';businessAt:string;asOf?:string}):Promise<CatalogResult> {
      return (await sql<{result:CatalogResult}>`select governance_catalog.read_effective(${actor},${query.scope},${query.businessAt},${query.asOf??null}) as result`.execute(db)).rows[0]!.result;
    },
    async command(actor:string,input:Command):Promise<Outcome> {
      const response=await sql<{result:Outcome}>`select governance_catalog.command(${actor},${JSON.stringify(input)}::jsonb) as result`.execute(db);
      return response.rows[0]!.result;
    },
    async history(actor:string,scope:string,id:string):Promise<HistoryRow[]> {
      return (await sql<{result:HistoryRow[]}>`select governance_catalog.history(${actor},${scope},${id}::uuid) as result`.execute(db)).rows[0]!.result;
    },
    async resolveSource(actor:string,scope:string,id:string,businessAt:string):Promise<Record<string,string>> {
      return (await sql<{result:Record<string,string>}>`select governance_catalog.resolve_source(${actor},${scope},${id}::uuid,${businessAt}) as result`.execute(db)).rows[0]!.result;
    },
    async verifyAudit(actor:string,checkpoint?:{auditSequence:string;currentHash:string}):Promise<{status:string;auditStreamId:string;auditSequence:string;currentHash:string;eventCount:string;legacyCount:string;legacyProtection:string}> {
      return (await sql<{result:{status:string;auditStreamId:string;auditSequence:string;currentHash:string;eventCount:string;legacyCount:string;legacyProtection:string}}>`select vnext_control.verify_audit(${actor},${checkpoint?.auditSequence??null}::bigint,${checkpoint?.currentHash??null}) as result`.execute(db)).rows[0]!.result;
    },
    async close(){await db.destroy();},
  };
}
export type Catalog = Awaited<ReturnType<typeof openCatalog>>;

export {receiveFileInTransaction,parseOrganizationWorkbookBounded} from './file-intake.js';
export type {OrganizationWorkbookResult,OrganizationSheet,ParserField} from './file-parser.js';

export {protectedArtifacts} from './protected-artifact.js';

export type {ImportContractItem} from './contract-schema.js';

export {evaluateRuleSet} from './validation-rules.js';
export {recordOwnerFileValidation} from './validation.js';

export {fileIntake,boundedParse} from './file-intake.js';
