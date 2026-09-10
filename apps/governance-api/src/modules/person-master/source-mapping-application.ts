import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import { safeSourceMappingError, type PersonSourceMappingApplication } from './source-mapping-contracts.js';
import type { PersonSourceMappingModule } from './source-mapping-repository.js';

export function createPersonSourceMappingApplication(
  runner: TransactionRunner<{ readonly sourceMappings: PersonSourceMappingModule }>,
  context: RequestContext,
): PersonSourceMappingApplication {
  async function run<T>(work: (module: PersonSourceMappingModule) => Promise<T>): Promise<T> {
    try { return await runner.run(context, ({ sourceMappings }) => work(sourceMappings)); }
    catch (error) { throw safeSourceMappingError(error); }
  }
  return {
    async registerPersonSourceMapping(command) {
      const result = await run((module) => module.registerPersonSourceMapping(command));
      if (!result.ok) throw new Error(result.code);
      return result.version;
    },
    async correctPersonSourceMapping(command) {
      const result = await run((module) => module.correctPersonSourceMapping(command));
      if (!result.ok) throw new Error(result.code);
      return result.version;
    },
    async retractPersonSourceMapping(command) {
      const result = await run((module) => module.retractPersonSourceMapping(command));
      if (!result.ok) throw new Error(result.code);
      return result.version;
    },
    getPersonSourceMapping: (query) => run((module) => module.getPersonSourceMapping(query)),
    getPersonSourceMappingVersion: (query) => run((module) => module.getPersonSourceMappingVersion(query)),
    listPersonSourceMappingVersions: (query) => run((module) => module.listPersonSourceMappingVersions(query)),
    findPersonSourceMappingAsOf: (query) => run((module) => module.findPersonSourceMappingAsOf(query)),
    findPersonBySourceRecord: (query) => run((module) => module.findPersonBySourceRecord(query)),
  };
}
