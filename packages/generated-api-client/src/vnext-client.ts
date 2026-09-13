import createClient from 'openapi-fetch';
import type { paths, operations } from './vnext-schema.generated.js';
export type VNextEntry = operations['getCatalogEntry']['responses'][200]['content']['application/json'];
export type VNextCommand = operations['catalogCommand']['requestBody']['content']['application/json'];
export type VNextOutcome = operations['catalogCommand']['responses'][200]['content']['application/json'];
export type VNextHistory = operations['catalogHistory']['responses'][200]['content']['application/json'];
export type VNextSourceImpact = operations['sourceChangeImpact']['responses'][200]['content']['application/json'];
export type VNextImportContract = operations['listImportContracts']['responses'][200]['content']['application/json']['items'][number];
export type VNextImportCommand = operations['importContractCommand']['requestBody']['content']['application/json'];
export type VNextParameterDefinition = operations['listParameterDefinitions']['responses'][200]['content']['application/json']['items'][number];
export type VNextParameterCommand = operations['parameterDefinitionCommand']['requestBody']['content']['application/json'];
export function createVNextCatalogClient(baseUrl:string,actor:string) {
  return createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
}
