import type { DepartmentGovernanceHttpDependencies } from '../platform/fastify/register-department-governance-routes.js';

// Schema registration only. No database, authentication runtime or synthetic identity.
export function createDepartmentGovernanceContractDependencies(): DepartmentGovernanceHttpDependencies {
  const unavailable = (): never => {
    throw new Error('CONTRACT_RUNTIME_NOT_AVAILABLE');
  };
  return {
    resolvePrincipal: unavailable,
    now: unavailable,
    createApplication: unavailable,
  };
}
