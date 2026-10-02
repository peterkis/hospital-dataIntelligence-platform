import { createCipheriv, createDecipheriv, createHash, createHmac, createSecretKey, randomBytes, type KeyObject } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import type { DB } from '../../platform/database/vnext-types.generated.js';
import type { ImportJob } from './import-job.js';
import {CatalogTransactionScope} from './transaction-scope.js';
import {authorizeEvolutionProtectedRead} from './protected-evolution-access.js';

/** Local synthetic development only. No implicit key, no production key service. */
export interface KeyProviderPort {
  current(): { id: string; key: KeyObject };
  payload(id: string): KeyObject;
  lookup(): KeyObject;
}
/** Authenticate an existing P0-11 envelope supplied by the catalog's finite evidence port. */
export function authenticateRegistrationEvidence(value:{binding:unknown[];envelope:{keyId:string;nonce:string;tag:string;ciphertext:string}},provider?:KeyProviderPort):Buffer {
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 try{const e=value.envelope,d=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));d.setAAD(Buffer.from(JSON.stringify(value.binding)));d.setAuthTag(Buffer.from(e.tag,'hex'));return Buffer.concat([d.update(Buffer.from(e.ciphertext,'hex')),d.final()]);}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
}
export function sealProtectedPayload(raw:Uint8Array,binding:unknown[],provider?:KeyProviderPort){
 if(!provider)throw new Error('KEY_UNAVAILABLE');
 const {id,key}=provider.current(),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce);
 cipher.setAAD(Buffer.from(JSON.stringify(binding)));
 const ciphertext=Buffer.concat([cipher.update(raw),cipher.final()]);
 return {keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')};
}
export class LocalSyntheticKeyProvider implements KeyProviderPort {
  private readonly keys = new Map<string, KeyObject>();
  private active = '';
  private readonly lookupKey = createSecretKey(randomBytes(32));
  constructor() { this.rotate(); }
  rotate() { this.active = `LOCAL_${this.keys.size + 1}`; this.keys.set(this.active, createSecretKey(randomBytes(32))); }
  current() { return { id: this.active, key: this.payload(this.active) }; }
  payload(id: string) { const key = this.keys.get(id); if (!key) throw new Error('KEY_UNAVAILABLE'); return key; }
  lookup() { return this.lookupKey; }
}
const Id = Type.String({ pattern: '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' });
const Dimensions = {
  scope: Type.Literal('SYNTHETIC'), campus: Type.Union([Type.Literal('NORTH'), Type.Literal('SOUTH')]),
  purpose: Type.Union([Type.Literal('IDENTITY_VERIFY'), Type.Literal('CONTACT_VERIFY'), Type.Literal('HR_RESTRICTED')]),
};
const Base = { ...Dimensions, requestId: Id };
export const ProtectedStoreSchema = Type.Object({ ...Base, jobId: Id, revisionId: Id,
  kind: Type.Union([Type.Literal('RAW_FILE'), Type.Literal('RAW_CELL'), Type.Literal('ERROR_REPORT')]),
  retentionSeconds: Type.Integer({ minimum: 1, maximum: 2592000 }),
}, { additionalProperties: false });
export const ProtectedReadSchema = Type.Object({ ...Base, artifactId: Id }, { additionalProperties: false });
export type ProtectedStoreInput = Static<typeof ProtectedStoreSchema>;
export type ProtectedReadInput = Static<typeof ProtectedReadSchema>;
export interface ProtectedReference { artifactId: string; status: 'QUARANTINED'; masked: '[REDACTED]'; purged: boolean; expiresAt: string }
type Envelope = { keyId: string; nonce: string; tag: string; ciphertext: string };
type Result = ProtectedReference & { error?: string; envelope?: Envelope; binding?: string; evolutionScope?:unknown };
const publicDigestConflict = Symbol('verified-public-digest-conflict');
const safeCodes = new Set(['BATCH_REJECTED','ACCESS_DENIED','NOT_FOUND','REQUEST_CONFLICT','EXACT_CONTRACT_UNAVAILABLE','STALE_REVISION','RETENTION_NOT_EXPIRED','PAYLOAD_UNAVAILABLE','CLOSED_INPUT_REQUIRED']);
function safeError(error: unknown): Error { return new Error(error instanceof Error && safeCodes.has(error.message) ? error.message : 'PROTECTED_OPERATION_FAILED'); }

export function protectedArtifacts(db: Kysely<DB>|CatalogTransactionScope, provider?: KeyProviderPort) {
  const transaction = <T>(work: (trx: Kysely<DB>|CatalogTransactionScope) => Promise<T>): Promise<T> => db instanceof CatalogTransactionScope || db.isTransaction ? work(db) : db.transaction().execute(work);
  const keyProvider = () => { if (!provider) throw new Error('KEY_UNAVAILABLE'); return provider; };
  const call = async (actor: string, action: string, input: unknown, envelope: Envelope | null = null, digest: string | null = null): Promise<Result> => {
    try {
      const result = (await sql<{result: Result}>`select governance_catalog.protected_command(${actor},${action},${JSON.stringify(input)}::jsonb,${JSON.stringify(envelope)}::jsonb,${digest}) as result`.execute(db)).rows[0]!.result;
      if (result.error) throw new Error(result.error);
      return result;
    } catch (error) { throw safeError(error); }
  };
  return {
    async storeProtectedArtifact(actor: string, input: ProtectedStoreInput, bytes: Uint8Array): Promise<ProtectedReference> {
      if (!Check(ProtectedStoreSchema, input) || !(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > 1048576) throw new Error('CLOSED_INPUT_REQUIRED');
      // Copy before asynchronous work: callers cannot mutate authenticated metadata or bytes in flight.
      input={...input};
      const raw = Buffer.from(bytes);
      try {
        const keys = keyProvider();
        const binding = [input.jobId,input.revisionId,input.kind,input.campus,input.purpose,input.requestId];
        // Domain-separated keyed digest; raw/low-entropy SHA never enters outcome or audit.
        const digest = createHmac('sha256',keys.lookup()).update('PROTECTED_STORE_V1\0').update(JSON.stringify([
          input.scope,input.campus,input.purpose,input.requestId,input.jobId,input.revisionId,input.kind,input.retentionSeconds,
        ])).update(raw).digest('hex');
        const envelope=sealProtectedPayload(raw,binding,keys);
        const result=await transaction(async trx=>{
          const result=(await sql<{result:Result}>`select governance_catalog.protected_command(${actor},'STORE',${JSON.stringify(input)}::jsonb,${JSON.stringify(envelope)}::jsonb,${digest}) as result`.execute(trx)).rows[0]!.result;
          // A normal SQL denial must commit its minimal audit before the caller receives the error.
          if(result.error)return result;
          // Both owner calls retain 901002 until commit: revision changes cannot race this check.
          const job=(await sql<{result:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:input.scope,jobId:input.jobId})}::jsonb) as result`.execute(trx)).rows[0]!.result;
          // Compare only in memory. Never persist/log the low-entropy hash or rewrite old metadata.
          const publicDigest=createHash('sha256').update(raw).digest('hex');
          if(job.revisions.some(revision=>revision.input.kind==='METADATA_ONLY' && revision.input.declaredSha256===publicDigest))throw publicDigestConflict;
          return result;
        });
        if(result.error)throw new Error(result.error);
        return result;
      } catch (error) {
        if(error===publicDigestConflict) {
          // The receive root owns rollback and its separate bounded failure audit.
          if(db instanceof CatalogTransactionScope||db.isTransaction)throw new Error('PUBLIC_DIGEST_CONFLICT');
          // The payload transaction has rolled back. Commit a distinct minimal denial
          // without the bytes, their ordinary SHA, or a false accepted outcome.
          const denial={scope:input.scope,campus:input.campus,purpose:input.purpose,jobId:input.jobId,revisionId:input.revisionId,requestId:input.requestId};
          try {await sql`select governance_catalog.protected_digest_denial(${actor},${JSON.stringify(denial)}::jsonb)`.execute(db);}
          catch {throw new Error('PROTECTED_OPERATION_FAILED');}
          throw new Error('PUBLIC_DIGEST_CONFLICT');
        }
        throw safeError(error);
      } finally { raw.fill(0); }
    },
    async readMasked(actor: string, input: ProtectedReadInput): Promise<ProtectedReference> {
      if (!Check(ProtectedReadSchema,input)) throw new Error('CLOSED_INPUT_REQUIRED');
      return call(actor,'MASKED',input);
    },
    /** Authorization is consumed by this read, never returned as a reusable bearer token. */
    async authorizeSensitiveRead(actor: string, input: ProtectedReadInput, expected?: {jobId:string;revisionId:string;kind:ProtectedStoreInput['kind']}): Promise<Uint8Array> {
      if (!Check(ProtectedReadSchema,input)) throw new Error('CLOSED_INPUT_REQUIRED');
      try {
        return await transaction(async trx => {
          const result = (await sql<{result: Result}>`select governance_catalog.protected_command(${actor},'READ',${JSON.stringify(input)}::jsonb,'null'::jsonb,null) as result`.execute(trx)).rows[0]!.result;
          if(trx instanceof CatalogTransactionScope)await trx.protectedReadCompleted();
          // Commit the non-sensitive denial/request ledger even if crypto cannot release bytes.
          if (result.error) return new Error(result.error);
          // Older prefixes lack the reference-access protocol. They may serve
          // their original non-evolution artifacts, never an unbound evolution file.
          if(result.evolutionScope===undefined){
            const binding:unknown=JSON.parse(result.binding!);
            if(!Array.isArray(binding)||typeof binding[0]!=='string'||typeof binding[1]!=='string')return new Error('ACCESS_DENIED');
            const job=(await sql<{result:ImportJob}>`select governance_catalog.import_job_read(${actor},${JSON.stringify({scope:input.scope,jobId:binding[0]})}::jsonb) result`.execute(trx)).rows[0]!.result;
            const revision=job.revisions.find(revision=>revision.id===binding[1]);
            if(!revision||revision.input.kind==='FILE'&&revision.input.parserPolicy==='STRICT_ORGANIZATION_EVOLUTION_V1')return new Error('ACCESS_DENIED');
          }
          if(result.evolutionScope){
            try{await authorizeEvolutionProtectedRead(trx,actor,input.artifactId,result.evolutionScope,keyProvider());}
            catch(error){return safeError(error);}
          }
          try {
            if (expected) {
              const binding: unknown[] = JSON.parse(result.binding!);
              if (binding[0] !== expected.jobId || binding[1] !== expected.revisionId || binding[2] !== expected.kind) return new Error('ACCESS_DENIED');
            }
            const e = result.envelope!; const decipher = createDecipheriv('aes-256-gcm',keyProvider().payload(e.keyId),Buffer.from(e.nonce,'hex'));
            decipher.setAAD(Buffer.from(JSON.stringify(JSON.parse(result.binding!)))); decipher.setAuthTag(Buffer.from(e.tag,'hex'));
            return Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'hex')),decipher.final()]);
          } catch { return new Error('PROTECTED_OPERATION_FAILED'); }
        }).then(result => { if (result instanceof Error) throw result; return result; });
      } catch(error) { throw safeError(error); }
    },
    async purgeOwnedExpiredArtifact(actor: string, input: ProtectedReadInput): Promise<ProtectedReference> {
      if (!Check(ProtectedReadSchema,input)) throw new Error('CLOSED_INPUT_REQUIRED');
      return call(actor,'PURGE',input);
    },
  };
}
