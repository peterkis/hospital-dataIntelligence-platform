import {createDecipheriv} from 'node:crypto';
import {sql,type Kysely} from 'kysely';
import {Type} from 'typebox';
import {Check} from 'typebox/value';
import type {CatalogTransactionScope} from './transaction-scope.js';
import type {DB} from '../../platform/database/vnext-types.generated.js';
import type {KeyProviderPort} from './protected-artifact.js';
import {planBinding} from './plan-binding.js';

const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const Envelope=Type.Object({keyId:Type.String(),nonce:Type.String(),tag:Type.String(),ciphertext:Type.String()},{additionalProperties:false});
const Context=Type.Object({artifactId:Id,originalArtifactId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),input:Type.Union([Type.Object({digest:Type.String({pattern:'^[a-f0-9]{64}$'}),envelope:Envelope},{additionalProperties:false}),Type.Null()])},{additionalProperties:false});
// This is a private reference-access projection of the authenticated complete
// Owner input, not a second public business schema or caller-authored manifest.
const References=Type.Object({jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),sourceArtifactId:Id,sourceSystemId:Id,predecessors:Type.Array(Type.Object({owner:Type.Literal('department-master'),id:Id,expectedVersion:Type.String()},{additionalProperties:false})),successors:Type.Array(Type.Object({row:Type.Object({source_system_id:Id},{additionalProperties:true})},{additionalProperties:true}))},{additionalProperties:true});

export async function authorizeEvolutionProtectedRead(scope:CatalogTransactionScope|Kysely<DB>,actor:string,artifactId:string,value:unknown,provider:KeyProviderPort):Promise<void>{
 if(!Check(Context,value)||value.artifactId!==artifactId||!value.input)throw new Error('ACCESS_DENIED');
 const sealed=value.input,e=sealed.envelope;let bytes:Buffer;
 try{const decipher=createDecipheriv('aes-256-gcm',provider.payload(e.keyId),Buffer.from(e.nonce,'hex'));decipher.setAAD(Buffer.from('EVOLUTION_INPUT_V1\0'+sealed.digest));decipher.setAuthTag(Buffer.from(e.tag,'hex'));bytes=Buffer.concat([decipher.update(Buffer.from(e.ciphertext,'hex')),decipher.final()]);}catch{throw new Error('PAYLOAD_UNAVAILABLE');}
 try{
  const input:unknown=JSON.parse(bytes.toString());
  if(!Check(References,input)||planBinding(provider,'EVOLUTION_INPUT_V1',input)!==sealed.digest||input.jobId!==value.jobId||input.revisionId!==value.revisionId||input.campus!==value.campus||input.sourceArtifactId!==value.originalArtifactId)throw new Error('ACCESS_DENIED');
  const result=(await sql<{r:{error?:string}}>`select department_master.evolution_original_authorize(${actor},${artifactId}::uuid,${JSON.stringify(input)}::jsonb) r`.execute(scope)).rows[0]!.r;
  if(result.error)throw new Error(result.error);
 }finally{bytes.fill(0);}
}
