import { Worker } from 'node:worker_threads';
import { sql, type Kysely } from 'kysely';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import type { DB } from '../../platform/database/vnext-types.generated.js';
import { ImportJobCommandSchema, type ImportJob, type ImportJobOutcome } from './import-job.js';
import { protectedArtifacts, ProtectedReadSchema, type KeyProviderPort } from './protected-artifact.js';
import type { ParserField, ParserResult, FileFormat } from './file-parser.js';
import { issueWorkbook } from './issue-workbook.js';
import {parseSignature} from './parse-provenance.js';

const Id = Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const Protection = {campus:Type.Union([Type.Literal('NORTH'),Type.Literal('SOUTH')]),purpose:Type.Union([Type.Literal('IDENTITY_VERIFY'),Type.Literal('CONTACT_VERIFY'),Type.Literal('HR_RESTRICTED')]),retentionSeconds:Type.Integer({minimum:1,maximum:2592000})};
export const ReceiveFileSchema = Type.Object({...Protection,job:ImportJobCommandSchema,fileRequestId:Id,extension:Type.Union([Type.Literal('.csv'),Type.Literal('.json'),Type.Literal('.xlsx')])},{additionalProperties:false});
export const ParseFileSchema = Type.Object({...ProtectedReadSchema.properties,jobId:Id,revisionId:Id,outputRequestId:Id,retentionSeconds:Protection.retentionSeconds},{additionalProperties:false});
export type ReceiveFileInput = Static<typeof ReceiveFileSchema>;
export type ParseFileInput = Static<typeof ParseFileSchema>;
let activeWorkers = 0;
async function boundedParse(bytes: Uint8Array, format: FileFormat, fields: ParserField[],policy:ParserResult['policy']): Promise<ParserResult> {
  if (activeWorkers >= 2) throw new Error('PARSER_BUSY');
  activeWorkers++;
  try {
    return await new Promise<ParserResult>((resolve,reject)=> {
      const worker = new Worker(new URL(import.meta.url.endsWith('.ts') ? './file-parser.ts' : './file-parser.js',import.meta.url),{
        workerData:{bytes,format,fields,policy},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:2},
      });
      let settled = false;
      const finish = (value?:ParserResult) => {
        if (settled) return; settled = true; clearTimeout(timer);
        void worker.terminate().then(()=> { if(value) resolve(value); else reject(new Error('PARSER_LIMIT')); });
      };
      const timer = setTimeout(()=>finish(),2000);
      worker.once('message',(value:ParserResult|null)=>finish(value??undefined));
      worker.once('error',()=>finish()); worker.once('exit',()=>finish());
    });
  } finally { activeWorkers--; }
}

export function fileIntake(db:Kysely<DB>,provider?:KeyProviderPort) {
  const protectedStore = protectedArtifacts(db,provider);
  const jobRead = async(actor:string,input:ParseFileInput):Promise<ImportJob> => {
    const job=(await sql<{result:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:input.scope,jobId:input.jobId})}::jsonb) as result`.execute(db)).rows[0]!.result;
    if(job.currentRevisionId!==input.revisionId)throw new Error('STALE_REVISION');
    if(job.revisions.at(-1)?.input.kind!=='FILE')throw new Error('FILE_REVISION_REQUIRED');
    return job;
  };
  const readInput = (input:ParseFileInput)=>({scope:input.scope,campus:input.campus,purpose:input.purpose,requestId:input.requestId,artifactId:input.artifactId});
  const storeInput = (input:ParseFileInput,kind:'RAW_CELL'|'ERROR_REPORT')=>({scope:input.scope,campus:input.campus,purpose:input.purpose,requestId:input.outputRequestId,jobId:input.jobId,revisionId:input.revisionId,retentionSeconds:input.retentionSeconds,kind});
  const parseFile=async(actor:string,input:ParseFileInput)=> {
      if(!Check(ParseFileSchema,input))throw new Error('CLOSED_INPUT_REQUIRED'); input={...input};
      const job=await jobRead(actor,input);const metadata=job.revisions.at(-1)!.input;
      if(metadata.kind!=='FILE')throw new Error('FILE_REVISION_REQUIRED');
      const raw=await protectedStore.authorizeSensitiveRead(actor,readInput(input),{jobId:input.jobId,revisionId:input.revisionId,kind:'RAW_FILE'});
      try {
        const result=await boundedParse(raw,metadata.format,job.contract.definition.fields,metadata.parserPolicy);
        // All values, hidden names and detailed issues remain in P0-11; only status/ref escape.
        const payload=Buffer.from(JSON.stringify({sourceArtifactId:input.artifactId,result}));
        if(payload.length>1048576)throw new Error('RESULT_LIMIT');
        try {
          const artifact=await db.transaction().execute(async trx=>{
            const store=protectedArtifacts(trx,provider);
            const source=await store.authorizeSensitiveRead(actor,readInput(input),{jobId:input.jobId,revisionId:input.revisionId,kind:'RAW_FILE'});
            source.fill(0);
            const saved=await store.storeProtectedArtifact(actor,storeInput(input,'RAW_CELL'),payload);
            const signature=parseSignature(provider,saved.artifactId,input.jobId,input.revisionId,job.contract.versionId,payload);
            await sql`select governance_catalog.register_parse(${actor},${saved.artifactId}::uuid,${input.artifactId}::uuid,${signature},${result.structuralStatus})`.execute(trx);
            return saved;
          });
          return {artifact,structuralStatus:result.structuralStatus,fieldValidation:'NOT_RUN' as const,securityScan:'NOT_RUN' as const,adapterReadiness:'NOT_READY' as const};
        } finally {payload.fill(0);}
      } finally {raw.fill(0);}
  };
  return {
    async receiveFile(actor:string,input:ReceiveFileInput,bytes:Uint8Array) {
      if(!Check(ReceiveFileSchema,input)||input.job.scope!=='SYNTHETIC'||input.job.input.kind!=='FILE'||input.extension!==`.${input.job.input.format.toLowerCase()}`||!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>1048576)throw new Error('CLOSED_FILE_REQUIRED');
      input=structuredClone(input);const raw=Buffer.from(bytes);
      try {
        return await db.transaction().execute(async trx=> {
          const job=(await sql<{result:ImportJobOutcome}>`select governance_catalog.import_job_command(${actor},${JSON.stringify(input.job)}::jsonb) as result`.execute(trx)).rows[0]!.result;
          const artifact=await protectedArtifacts(trx,provider).storeProtectedArtifact(actor,{scope:'SYNTHETIC',campus:input.campus,purpose:input.purpose,requestId:input.fileRequestId,jobId:job.id,revisionId:job.revisionId,kind:'RAW_FILE',retentionSeconds:input.retentionSeconds},raw);
          return {job,artifact,storageStatus:'QUARANTINED' as const,structuralStatus:'NOT_INSPECTED' as const,fieldValidation:'NOT_RUN' as const,securityScan:'NOT_RUN' as const};
        });
      } catch(error) {
        const denial={scope:'SYNTHETIC',campus:input.campus,purpose:input.purpose,requestId:input.fileRequestId,targetId:input.job.action==='CREATE'?input.job.requestId:input.job.jobId};
        try { await sql`select governance_catalog.file_receive_denial(${actor},${JSON.stringify(denial)}::jsonb)`.execute(db); }
        catch {throw new Error('FILE_RECEIVE_FAILED');}
        const code=error instanceof Error?error.message:'';
        throw new Error(['ACCESS_DENIED','REQUEST_CONFLICT','EXACT_CONTRACT_UNAVAILABLE','STALE_REVISION','PROTECTED_OPERATION_FAILED','PUBLIC_DIGEST_CONFLICT'].includes(code)?code:'FILE_RECEIVE_FAILED');
      } finally {raw.fill(0);}
    },
    // Both commands close over the same authorized parser, independent of the receiver.
    inspectEnvelope:parseFile,
    parseFile,
    async exportIssueWorkbook(actor:string,input:ParseFileInput) {
      if(!Check(ParseFileSchema,input))throw new Error('CLOSED_INPUT_REQUIRED');input={...input};await jobRead(actor,input);
      const raw=await protectedStore.authorizeSensitiveRead(actor,readInput(input),{jobId:input.jobId,revisionId:input.revisionId,kind:'RAW_CELL'});
      try {
        let payload:Buffer;
        try { const parsed:{result:ParserResult}=JSON.parse(Buffer.from(raw).toString('utf8'));payload=issueWorkbook(parsed.result); }
        catch {throw new Error('PARSER_RESULT_REQUIRED');}
        try{return await protectedStore.storeProtectedArtifact(actor,storeInput(input,'ERROR_REPORT'),payload);}
        finally{payload.fill(0);}
      } finally {raw.fill(0);}
    },
  };
}
