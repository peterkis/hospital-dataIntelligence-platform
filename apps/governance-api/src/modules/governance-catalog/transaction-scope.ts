import type {Kysely,QueryExecutor} from 'kysely';
import type {DB} from '../../platform/database/vnext-types.generated.js';
export type CareCandidateOwner='UNIT'|'NURSING'|'WARD'|'UNIT_WARD'|'WARD_NURSING'|'CAPABILITY'|'PERMISSION'|'LOCATION'|'LOCATION_USE';
interface CareReadCapability {inputIds:(owner:CareCandidateOwner)=>readonly string[];peerWrites:(owner:CareCandidateOwner,inputId:string)=>readonly string[]}
interface CareReadState {reader?:CareReadCapability}

/**
 * Internal transaction capability shared by sibling Owners. The concrete
 * Kysely transaction is created only at the composition root and is not part
 * of a capability seam.
 */
export class CatalogTransactionScope {
 readonly isTransaction=true;
 private constructor(private readonly executor:QueryExecutor,private readonly afterProtectedRead?:()=>Promise<void>,readonly recordAsOf?:string,private readonly currentReadAudits=new Map<string,()=>Promise<void>>(),private readonly careReads:CareReadState={}){}
 static from(db:Kysely<DB>,afterProtectedRead?:()=>Promise<void>){return new CatalogTransactionScope(db.getExecutor(),afterProtectedRead);}
 /** Explicit read context: the executor and MVCC snapshot remain identical. */
 atRecordTime(recordAsOf:string){return new CatalogTransactionScope(this.executor,this.afterProtectedRead,recordAsOf,this.currentReadAudits,this.careReads);}
 /** The care Owner owns the sealed graph. Sibling Owners receive only its
  * finite transaction-local input lookup, without importing its whole module. */
 bindCareCandidateReader(reader:CareReadCapability){const previous=this.careReads.reader;this.careReads.reader=reader;return ()=>{if(previous)this.careReads.reader=previous;else delete this.careReads.reader;};}
 readCareCandidateInputIds(owner:CareCandidateOwner){return this.careReads.reader?.inputIds(owner)??[];}
 readCareCandidatePeerWrites(owner:CareCandidateOwner,inputId:string){return this.careReads.reader?.peerWrites(owner,inputId)??[];}
 /** Facts stay in this snapshot. Audits must append against the current chain
  * after it closes, and recheck current native authority before byte release. */
 deferCurrentReadAudit(key:string,audit:()=>Promise<void>){if(!this.recordAsOf)throw new Error('READ_CONTEXT_REQUIRED');this.currentReadAudits.set(key,audit);}
 async completeCurrentReadAudits(){let failed=false,failure:unknown;for(const audit of this.currentReadAudits.values())try{await audit();}catch(error){if(!failed){failed=true;failure=error;}}this.currentReadAudits.clear();if(failed)throw failure;}
 /** Read-only roots may checkpoint the audit before byte release or a bounded denial. */
 async protectedReadCompleted(){await this.afterProtectedRead?.();}
 getExecutor(){return this.executor;}
}
