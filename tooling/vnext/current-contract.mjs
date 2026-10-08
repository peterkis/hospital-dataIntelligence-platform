import { canonicalPlan } from "../../apps/governance-api/src/modules/governance-catalog/plan-binding.ts";
/** Caller inventory is descriptive authority; source builds still prove typing. */
export function verifyVNextCallerRegistration(currentApi,registry,pathExists){
 const registration=registry.vNextCurrentCallers;
 if(!registration||!Array.isArray(registration.callers)||registration.callers.length===0)throw new Error('CURRENT_CALLER_REGISTRATION_REQUIRED');
 const operationIds=new Set(Object.values(currentApi.paths??{}).flatMap(path=>Object.values(path).filter(operation=>typeof operation==='object'&&operation!==null&&'operationId' in operation).map(operation=>operation.operationId)));
 const paths=new Set();
 for(const caller of registration.callers){
  if(typeof caller.path!=='string'||!Array.isArray(caller.operations)||paths.has(caller.path)||!pathExists(caller.path))throw new Error('CURRENT_CALLER_PATH_INVALID');
  paths.add(caller.path);
  if(new Set(caller.operations).size!==caller.operations.length||caller.operations.some(id=>typeof id!=='string'||!operationIds.has(id)))throw new Error('CURRENT_CALLER_OPERATION_INVALID');
 }
 return {status:'PASS',ticket:registration.ticket,callers:paths.size};
}
/** Public artifact gate: compare current server and freshly generated client. */
export function verifyCurrentContract(
  currentApi,
  committedApi,
  currentClient,
  committedClient,
) {
  if (canonicalPlan(currentApi) !== canonicalPlan(committedApi))
    throw new Error("CURRENT_API_CONTRACT_DRIFT");
  if (currentClient !== committedClient)
    throw new Error("CURRENT_CLIENT_CONTRACT_DRIFT");
  return { status: "PASS", currentApi: true, currentClient: true };
}
