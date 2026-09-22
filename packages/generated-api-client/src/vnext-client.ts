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
export type OrganizationInput=operations['stageOrganizationCommand']['requestBody']['content']['application/json'];
export type OrganizationRead=operations['readOrganizations']['requestBody']['content']['application/json'];
/** Uses the same loopback synthetic actor context as the current vNext catalog. */
export function createOrganizationClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  stage:(body:OrganizationInput)=>client.POST('/api/vnext/organizations/inputs',{body}),
  plan:(body:operations['planOrganizationCommand']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organizations/plan',{body}),
  read:(body:OrganizationRead)=>client.POST('/api/vnext/organizations/query',{body}),
  review:(candidateId:string)=>client.POST('/api/vnext/organizations/review',{body:{candidateId}}),
  approve:(body:operations['approveOrganizationCommand']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organizations/approve',{body}),
  apply:(body:operations['applyOrganizationCommand']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organizations/apply',{body}),
  resume:(body:operations['resumeOrganizationOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organizations/resume',{body}),
 };
}

export type CampusInput=operations['stageCampusCommand']['requestBody']['content']['application/json'];
export function createCampusClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  stage:(body:CampusInput)=>client.POST('/api/vnext/campuses/inputs',{body}),
  plan:(body:operations['planCampusCommand']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/plan',{body}),
  review:(candidateId:string)=>client.POST('/api/vnext/campuses/review',{body:{candidateId}}),
  approve:(body:operations['approveCampusCommand']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/approve',{body}),
  apply:(body:operations['applyCampusCommand']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/apply',{body}),
  resume:(body:operations['resumeCampusOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/resume',{body}),
  withdraw:(body:operations['withdrawCampusInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/withdraw',{body}),
  resolveCampusReference:(body:operations['resolveCampusReference']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/references/resolve',{body}),
  pinCampusVersion:(body:operations['pinCampusVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/references/pin',{body}),
  readCampusReferenceCoverage:(body:operations['readCampusReferenceCoverage']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/references/coverage',{body}),
  getCampusAsOf:(body:operations['getCampusAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/query',{body}),
  list:(body:operations['listCampuses']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/list',{body}),
  version:(body:operations['getCampusVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/versions/query',{body}),
  history:(id:string)=>client.POST('/api/vnext/campuses/history',{body:{id}}),
  diff:(body:operations['compareCampusVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/diff',{body}),
  restrictedInput:(id:string)=>client.POST('/api/vnext/campuses/restricted-input',{body:{id}}),
 };
}
