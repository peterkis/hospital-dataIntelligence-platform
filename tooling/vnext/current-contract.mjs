import { canonicalPlan } from "../../apps/governance-api/src/modules/governance-catalog/plan-binding.ts";
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
