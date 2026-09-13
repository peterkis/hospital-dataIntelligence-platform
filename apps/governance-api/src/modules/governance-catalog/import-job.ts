import type { ImportContractItem } from './contract-schema.js';
import {Type,type Static} from 'typebox';
const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const Scope=Type.Union([Type.Literal('BASELINE'),Type.Literal('SYNTHETIC')]);
export const ImportMetadataSchema=Type.Object({kind:Type.Literal('METADATA_ONLY'),declaredSha256:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false});
const Base={scope:Scope,requestId:Id,reason:Type.String({pattern:'^[A-Z_]{1,64}$'}),input:ImportMetadataSchema};
export const ImportJobCommandSchema=Type.Union([
 Type.Object({...Base,action:Type.Literal('CREATE'),contractId:Id,contractVersionId:Id,profile:Type.Union([Type.Literal('CORE'),Type.Literal('FULL')])},{additionalProperties:false}),
 Type.Object({...Base,action:Type.Literal('REVISE'),jobId:Id,expectedCurrentRevision:Id},{additionalProperties:false}),
]);
export const ImportJobReadSchema=Type.Object({scope:Scope,jobId:Id},{additionalProperties:false});
export type ImportJobCommand=Static<typeof ImportJobCommandSchema>;

export interface ImportJobOutcome {
  id:string; revisionId:string; revision:string; status:'WAITING_INPUT';
  adapterReadiness:'NOT_READY'; digestStatus:'DECLARED';
}
export interface ImportJob {
  id:string; scope:'BASELINE'|'SYNTHETIC'; submitterIdentity:string;
  contract:ImportContractItem; profile:'CORE'|'FULL'; status:'WAITING_INPUT';
  adapterReadiness:'NOT_READY'; currentRevisionId:string;
  revisions:Array<{id:string;number:string;previousRevisionId:string|null;recordedAt:string;
    input:{kind:'METADATA_ONLY';declaredSha256:string};metadataDigest:string;digestStatus:'DECLARED';requestIdentity:string;requestId:string}>;
}
