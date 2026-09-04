import type { RequestContext, TransactionRunner } from '../../platform/transaction/transaction-runner.js';
import type { PersonCoreApplication } from './contracts.js';
import type { PersonMasterModule } from './repository.js';

export function createPersonCoreApplication(
  runner: TransactionRunner<{ readonly personMaster: PersonMasterModule }>,
  context: RequestContext,
): PersonCoreApplication {
  return {
    createPersonSubject: (command) => runner.run(context, ({ personMaster }) => personMaster.createPersonSubject(command)),
    createPersonSubjectVersion: (command) => runner.run(context, ({ personMaster }) => personMaster.createPersonSubjectVersion(command)),
    getPersonSubject: (query) => runner.run(context, ({ personMaster }) => personMaster.getPersonSubject(query)),
    getPersonSubjectVersion: (query) => runner.run(context, ({ personMaster }) => personMaster.getPersonSubjectVersion(query)),
    listPersonSubjectVersions: (query) => runner.run(context, ({ personMaster }) => personMaster.listPersonSubjectVersions(query)),
    findPersonSubjectAsOf: (query) => runner.run(context, ({ personMaster }) => personMaster.findPersonSubjectAsOf(query)),
  };
}
