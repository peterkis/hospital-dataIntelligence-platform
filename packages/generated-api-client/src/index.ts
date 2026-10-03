import createClient from 'openapi-fetch';
import type { paths } from './schema.generated.js';
export { createVNextCatalogClient } from './vnext-client.js';
export type { VNextEntry, VNextCommand, VNextOutcome, VNextHistory, VNextSourceImpact, VNextImportContract, VNextImportCommand, VNextParameterDefinition, VNextParameterCommand } from './vnext-client.js';
export type { operations as GovernanceApiOperations } from './schema.generated.js';

export type GovernanceApiPaths = paths;

export function createGovernanceApiClient(options: {
  readonly baseUrl: string;
  readonly accessToken?: string;
  readonly csrfToken?: string;
  readonly fetch?: typeof globalThis.fetch;
}) {
  const headers: Record<string, string> = {};
  if (options.accessToken) headers['authorization'] = `Bearer ${options.accessToken}`;
  if (options.csrfToken) headers['x-csrf-token'] = options.csrfToken;
  return createClient<paths>({
    baseUrl: options.baseUrl,
    credentials: 'include',
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}

export type {operations as VNextOperations} from './vnext-schema.generated.js';

export {createCampusClient,type CampusInput} from './vnext-client.js';

export {createOperatingRelationClient,createLicenseScopeClient} from './vnext-client.js';
export {createOrganizationClient,createOrganizationBundleClient,createOrganizationWorkspaceClient} from './vnext-client.js';

export {createDepartmentClient,type DepartmentInput} from './vnext-client.js';
export {createHierarchyClient,type HierarchyInput} from './vnext-client.js';
export {createOrganizationMappingClient,type OrganizationMappingInput} from './vnext-client.js';
export {createOrganizationIdentifierClient,type OrganizationIdentifierInput} from './vnext-client.js';
export {createOrganizationEvolutionClient,type OrganizationEvolutionInput} from './vnext-client.js';

export {createDepartmentImpactClient} from './vnext-client.js';

export {createDepartmentLifecycleClient} from './vnext-client.js';
