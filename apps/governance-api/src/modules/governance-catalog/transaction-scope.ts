import type {Kysely,QueryExecutor} from 'kysely';
import type {DB} from '../../platform/database/vnext-types.generated.js';

/**
 * Internal transaction capability shared by sibling Owners. The concrete
 * Kysely transaction is created only at the composition root and is not part
 * of a capability seam.
 */
export class CatalogTransactionScope {
 readonly isTransaction=true;
 private constructor(private readonly executor:QueryExecutor,private readonly afterProtectedRead?:()=>Promise<void>){}
 static from(db:Kysely<DB>,afterProtectedRead?:()=>Promise<void>){return new CatalogTransactionScope(db.getExecutor(),afterProtectedRead);}
 /** Read-only roots may checkpoint the audit before byte release or a bounded denial. */
 async protectedReadCompleted(){await this.afterProtectedRead?.();}
 getExecutor(){return this.executor;}
}
