import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import {
  safeEngagementPolicyError,
  type EngagementPolicyApplication,
} from './engagement-policy-contracts.js';
import type { EngagementPolicyModule } from './engagement-policy-repository.js';

export function createEngagementPolicyCoreApplication(
  runner: TransactionRunner<{ readonly policy: EngagementPolicyModule }>,
  context: RequestContext,
): EngagementPolicyApplication {
  async function run<T>(work: (module: EngagementPolicyModule) => Promise<T>): Promise<T> {
    try { return await runner.run(context, ({ policy }) => work(policy)); }
    catch (error) { throw safeEngagementPolicyError(error); }
  }

  return {
    async appendEngagementTypeVersion(command) {
      const result = await run((module) => module.appendEngagementTypeVersion(command));
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
    listEngagementTypeVersions: (query) =>
      run((module) => module.listEngagementTypeVersions(query)),
    async appendEngagementOverlapRuleVersion(command) {
      const result = await run((module) => module.appendEngagementOverlapRuleVersion(command));
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
    listEngagementOverlapRuleVersions: (query) =>
      run((module) => module.listEngagementOverlapRuleVersions(query)),
    findEngagementOverlapRuleAsOf: (query) =>
      run((module) => module.findEngagementOverlapRuleAsOf(query)),
  };
}
