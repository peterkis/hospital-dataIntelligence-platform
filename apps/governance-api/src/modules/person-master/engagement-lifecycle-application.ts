import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import {
  safeEngagementLifecycleError,
  type EngagementLifecycleApplication,
} from './engagement-lifecycle-contracts.js';
import type { EngagementLifecycleModule } from './engagement-lifecycle-repository.js';

export function createEngagementLifecycleCoreApplication(
  runner: TransactionRunner<{ readonly lifecycle: EngagementLifecycleModule }>,
  context: RequestContext,
): EngagementLifecycleApplication {
  async function run<T>(work: (module: EngagementLifecycleModule) => Promise<T>): Promise<T> {
    try { return await runner.run(context, ({ lifecycle }) => work(lifecycle)); }
    catch (error) { throw safeEngagementLifecycleError(error); }
  }

  return {
    getEngagementBusinessStateAsOf: (query) =>
      run((module) => module.getEngagementBusinessStateAsOf(query)),
    async suspendEngagement(command) {
      const result = await run((module) => module.suspendEngagement(command));
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
    async resumeEngagement(command) {
      const result = await run((module) => module.resumeEngagement(command));
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
    async endEngagement(command) {
      const result = await run((module) => module.endEngagement(command));
      if (!result.ok) throw new Error(result.code);
      return result.value;
    },
  };
}
