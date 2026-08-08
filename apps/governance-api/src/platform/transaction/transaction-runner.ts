import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../database/database-types.generated.js';

export interface RequestContext {
  readonly actorPrincipalId: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly occurredAt: string;
}

export interface TransactionRunner<ScopedModules> {
  run<Result>(
    context: RequestContext,
    work: (modules: ScopedModules) => Promise<Result>,
  ): Promise<Result>;
}

export type ScopedModuleFactory<ScopedModules> = (
  transaction: Transaction<DB>,
  context: RequestContext,
) => ScopedModules;

export function createTransactionRunner<ScopedModules>(
  database: Kysely<DB>,
  createModules: ScopedModuleFactory<ScopedModules>,
): TransactionRunner<ScopedModules> {
  return {
    run(context, work) {
      return database.transaction().execute(async (transaction) =>
        work(createModules(transaction, context)),
      );
    },
  };
}
