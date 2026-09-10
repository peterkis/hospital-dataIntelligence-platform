import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import { safeIdentifierError, type PersonIdentifierApplication } from './identifier-contracts.js';
import type { PersonIdentifierModule } from './identifier-repository.js';

export function createPersonIdentifierApplication(
  runner: TransactionRunner<{ readonly identifiers: PersonIdentifierModule }>, context: RequestContext,
): PersonIdentifierApplication {
  async function run<T>(work: (module: PersonIdentifierModule) => Promise<T>): Promise<T> {
    try { return await runner.run(context, ({ identifiers }) => work(identifiers)); }
    catch (error) { throw safeIdentifierError(error); }
  }
  return {
    async registerPersonIdentifier(command) {
      const result = await run((module) => module.registerPersonIdentifier(command));
      // Rejection evidence commits, then the public command fails closed.
      if (!result.ok) throw new Error(result.code);
      return result.version;
    },
    createPersonIdentifierVersion: (command) => run((module) => module.createPersonIdentifierVersion(command)),
    getPersonIdentifier: (query) => run((module) => module.getPersonIdentifier(query)),
    listPersonIdentifiers: (query) => run((module) => module.listPersonIdentifiers(query)),
    listPersonIdentifierVersions: (query) => run((module) => module.listPersonIdentifierVersions(query)),
    findPersonIdentifierAsOf: (query) => run((module) => module.findPersonIdentifierAsOf(query)),
    findPersonByIdentifier: (query) => run((module) => module.findPersonByIdentifier(query)),
  };
}
