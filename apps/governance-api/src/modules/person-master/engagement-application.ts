import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import { safeEngagementError, type EngagementCoreApplication } from './engagement-contracts.js';
import type { EngagementCoreModule } from './engagement-repository.js';

export function createEngagementCoreApplication(
  runner: TransactionRunner<{ readonly engagements: EngagementCoreModule }>,
  context: RequestContext,
): EngagementCoreApplication {
  async function run<T>(work: (module: EngagementCoreModule) => Promise<T>): Promise<T> {
    try { return await runner.run(context, ({ engagements }) => work(engagements)); }
    catch (error) { throw safeEngagementError(error); }
  }

  return {
    async createEngagement(command) {
      const result = await run((module) => module.createEngagement(command));
      if (!result.ok) throw new Error(result.code);
      return result.version;
    },
    async reviseEngagement(command) {
      const result = await run((module) => module.reviseEngagement(command));
      if (!result.ok) throw new Error(result.code);
      return result.version;
    },
    getEngagement: (query) => run((module) => module.getEngagement(query)),
    getEngagementVersion: (query) => run((module) => module.getEngagementVersion(query)),
    listEngagementVersions: (query) => run((module) => module.listEngagementVersions(query)),
    listPersonEngagements: (query) => run((module) => module.listPersonEngagements(query)),
    findEngagementAsOf: (query) => run((module) => module.findEngagementAsOf(query)),
  };
}
