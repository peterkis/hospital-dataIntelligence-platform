import { createCipheriv, createDecipheriv, createHmac, createSecretKey, randomBytes, type KeyObject } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import { Type, type Static } from 'typebox';
import { Check } from 'typebox/value';
import type { DB } from '../../platform/database/vnext-types.generated.js';

/** Local synthetic development only. No implicit key, no production key service. */
export interface KeyProviderPort {
  current(): { id: string; key: KeyObject };
  payload(id: string): KeyObject;
  lookup(): KeyObject;
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
type Result = ProtectedReference & { error?: string; envelope?: Envelope; binding?: string };
const safeCodes = new Set(['ACCESS_DENIED','NOT_FOUND','REQUEST_CONFLICT','EXACT_CONTRACT_UNAVAILABLE','STALE_REVISION','RETENTION_NOT_EXPIRED','PAYLOAD_UNAVAILABLE','CLOSED_INPUT_REQUIRED']);
function safeError(error: unknown): Error { return new Error(error instanceof Error && safeCodes.has(error.message) ? error.message : 'PROTECTED_OPERATION_FAILED'); }

export function protectedArtifacts(db: Kysely<DB>, provider?: KeyProviderPort) {
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
      // Copy before asynchronous work: callers cannot mutate the authenticated payload in flight.
      const raw = Buffer.from(bytes);
      try {
        const keys = keyProvider(); const {id, key} = keys.current();
        const binding = JSON.stringify([input.jobId,input.revisionId,input.kind,input.campus,input.purpose,input.requestId]);
        const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm',key,nonce);
        cipher.setAAD(Buffer.from(binding));
        const ciphertext = Buffer.concat([cipher.update(raw),cipher.final()]);
        // Domain-separated keyed digest; raw/low-entropy SHA never enters outcome or audit.
        const digest = createHmac('sha256',keys.lookup()).update('PROTECTED_STORE_V1\0').update(JSON.stringify([
          input.scope,input.campus,input.purpose,input.requestId,input.jobId,input.revisionId,input.kind,input.retentionSeconds,
        ])).update(raw).digest('hex');
        return await call(actor,'STORE',input,{keyId:id,nonce:nonce.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:ciphertext.toString('hex')},digest);
      } catch (error) { throw safeError(error); } finally { raw.fill(0); }
    },
    async readMasked(actor: string, input: ProtectedReadInput): Promise<ProtectedReference> {
      if (!Check(ProtectedReadSchema,input)) throw new Error('CLOSED_INPUT_REQUIRED');
      return call(actor,'MASKED',input);
    },
    /** Authorization is consumed by this read, never returned as a reusable bearer token. */
    async authorizeSensitiveRead(actor: string, input: ProtectedReadInput): Promise<Uint8Array> {
      if (!Check(ProtectedReadSchema,input)) throw new Error('CLOSED_INPUT_REQUIRED');
      try {
        return await db.transaction().execute(async trx => {
          const result = (await sql<{result: Result}>`select governance_catalog.protected_command(${actor},'READ',${JSON.stringify(input)}::jsonb,'null'::jsonb,null) as result`.execute(trx)).rows[0]!.result;
          // Commit the non-sensitive denial/request ledger even if crypto cannot release bytes.
          if (result.error) return new Error(result.error);
          try {
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
