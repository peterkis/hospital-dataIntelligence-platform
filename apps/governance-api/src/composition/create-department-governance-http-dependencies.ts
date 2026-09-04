import type { Kysely } from 'kysely';
import {
  createDepartmentGovernanceApplication,
  createDepartmentQueryService,
} from '../modules/department-master/index.js';
import type { WorkflowApplication } from '../modules/workflow/index.js';
import { createCampusReferenceReader } from '../platform/campus/campus-reference-reader.js';
import type { DB } from '../platform/database/database-types.generated.js';
import type { DepartmentGovernanceHttpDependencies } from '../platform/fastify/register-department-governance-routes.js';
import type { HttpRequestContextDependencies } from '../platform/fastify/request-context.js';
import type { TransactionRunner } from '../platform/transaction/transaction-runner.js';
import type { ScopedModules } from './create-scoped-modules.js';

export function createDepartmentGovernanceHttpDependencies(options: {
  readonly database: Kysely<DB>;
  readonly transactionRunner: TransactionRunner<ScopedModules>;
  readonly workflowApplication: WorkflowApplication;
  readonly resolvePrincipal: HttpRequestContextDependencies['resolvePrincipal'];
  readonly now: HttpRequestContextDependencies['now'];
}): DepartmentGovernanceHttpDependencies {
  const queryService = createDepartmentQueryService(
    options.database,
    createCampusReferenceReader(options.database),
  );
  return {
    resolvePrincipal: options.resolvePrincipal,
    now: options.now,
    createApplication: (context) => createDepartmentGovernanceApplication({
      context,
      transactionRunner: options.transactionRunner,
      workflowApplication: options.workflowApplication,
      queryService,
    }),
  };
}
