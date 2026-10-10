import type {CatalogTransactionScope} from './transaction-scope.js';

/** Native Owners supply their own finite authority and audit callbacks. The
 * helper knows no table, SQL name, domain scope, or caller-supplied permission. */
export async function readScopedProtectedInput<T>(scope:CatalogTransactionScope,permission:string,key:string,read:(permission:string)=>Promise<T>,authorizeRestricted:(record:T)=>Promise<void>,auditCurrent:()=>Promise<void>):Promise<T>{
 if(!scope.recordAsOf||permission!=='READ_RESTRICTED'){const result=await read(permission);if(permission==='READ_RESTRICTED')await scope.protectedReadCompleted();return result;}
 const record=await read('READ');
 await authorizeRestricted(record);
 scope.deferCurrentReadAudit(key,auditCurrent);
 return record;
}
