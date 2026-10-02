import {sql} from 'kysely';
import type {CatalogTransactionScope} from './transaction-scope.js';

/** Control-plane persistence accepts only transaction-bound Department authority tickets. */
export async function recordDepartmentImpact<T>(scope:CatalogTransactionScope,ticket:string,signature:string):Promise<T>{
 return (await sql<{r:T}>`select governance_catalog.department_impact_record(${ticket},${signature}) r`.execute(scope)).rows[0]!.r;
}
