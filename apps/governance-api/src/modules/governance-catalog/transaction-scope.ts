import type {Kysely,QueryExecutor} from 'kysely';
import type {DB} from '../../platform/database/vnext-types.generated.js';

/**
 * Internal transaction capability shared by sibling Owners. The concrete
 * Kysely transaction is created only at the composition root and is not part
 * of a capability seam.
 */
export class CatalogTransactionScope {
 readonly isTransaction=true;
 private constructor(private readonly executor:QueryExecutor){}
 static from(db:Kysely<DB>){return new CatalogTransactionScope(db.getExecutor());}
 getExecutor(){return this.executor;}
}
