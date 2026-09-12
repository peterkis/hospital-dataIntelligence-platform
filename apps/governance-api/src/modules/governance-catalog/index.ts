import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DB as VNextDB } from '../../platform/database/vnext-types.generated.js';

export interface CatalogField { original: { code: string; label: string; type: string; required: string; ref: string; definition: string; privacy: string; conditional_requirement: string; source_trace: string; max_length_or_format: string }; pointer: string; routing: Record<string,string> }
export interface CatalogPayload {
  fields?: CatalogField[]; adopted?: { name: string; explanation: string }; original?: Record<string,string>;
  domain?: string; dependencies?: Array<Record<string,unknown>>; model?: Record<string,unknown>;
  name?: string; readiness?: string; adapter?: string; dataset?: string; authorityScope?: string; fieldGroup?: string; role?: string; assigneeRole?: string;
  environment?: string; sourceKind?: string; deploymentScope?: string; sourceEvidence?: string;
}
export interface CatalogItem { id:string; kind:'DATASET'|'SOURCE'|'RESPONSIBILITY'; code:string; scope:'BASELINE'|'SYNTHETIC'; version:number; versionId:string; head:string; status:'DRAFT'|'REVIEW'|'PUBLISHED'|'RETIRED'; payload:CatalogPayload; validFrom:string; validTo:string|null; recordedAt:string }
export interface CatalogResult { items:CatalogItem[]; domains:Array<{code:string;name:string;datasets:string[]}> }
export interface Command {
  action:'CREATE'|'REVISE'|'SUBMIT'|'PUBLISH'|'REJECT'|'RETIRE'; scope:'BASELINE'|'SYNTHETIC'; requestId:string; reason:string;
  target?:string; expectedHead?:string; kind?:'DATASET'|'SOURCE'|'RESPONSIBILITY'; code?:string;
  values?:Record<string,string>; validFrom?:string; validTo?:string|null; reviewDigest?:string;
}
export interface Outcome { id:string; head:string; version:number; versionId:string; status:CatalogItem['status']; reviewDigest:string; recordedAt:string }
export interface HistoryRow { head:string; status:CatalogItem['status']; version:number; payload:CatalogPayload; validFrom:string; validTo:string|null; recordedAt:string }

export async function openCatalog(connectionString = process.env['VNEXT_DATABASE_URL']) {
  if (!connectionString) throw new Error('RECEIPT_BOUND_CONNECTION_REQUIRED');
  const db = new Kysely<VNextDB>({dialect:new PostgresDialect({pool:new Pool({connectionString,max:4,application_name:'hdi-vnext-catalog',options:'-c timezone=Asia/Shanghai'})})});
  return {
    async read(actor:string, query:{scope:'BASELINE'|'SYNTHETIC';asOf?:string}):Promise<CatalogResult> {
      const response=await sql<{result:CatalogResult}>`select governance_catalog.read_catalog(${actor},${query.scope},${query.asOf??null}) as result`.execute(db);
      return response.rows[0]!.result;
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
