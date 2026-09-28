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
  history:(id:string,asOf?:string)=>client.POST('/api/vnext/campuses/history',{body:{id,...(asOf?{asOf}:{})}}),
  diff:(body:operations['compareCampusVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/diff',{body}),
  restrictedInput:(id:string)=>client.POST('/api/vnext/campuses/restricted-input',{body:{id}}),
 };
}

export function createOperatingRelationClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  stage:(body:operations['stageOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/inputs',{body}),
  plan:(body:operations['planOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/plan',{body}),
  review:(body:operations['reviewOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/review',{body}),
  approve:(body:operations['approveOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/approve',{body}),
  apply:(body:operations['applyOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/apply',{body}),
  resume:(body:operations['resumeOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/resume',{body}),
  withdraw:(body:operations['withdrawOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/withdraw',{body}),
  read:(body:operations['readOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/query',{body}),
  restrictedInput:(body:operations['restrictedOperatingRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/restricted-input',{body}),
  evaluateOperatingWindow:(body:operations['evaluateOperatingWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/operating-relations/evaluate',{body}),
 };
}

export function createLicenseScopeClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  stage:(body:operations['stageLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/inputs',{body}),
  plan:(body:operations['planLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/plan',{body}),
  review:(body:operations['reviewLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/review',{body}),
  approve:(body:operations['approveLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/approve',{body}),
  apply:(body:operations['applyLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/apply',{body}),
  resume:(body:operations['resumeLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/resume',{body}),
  withdraw:(body:operations['withdrawLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/withdraw',{body}),
  read:(body:operations['readLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/query',{body}),
  restrictedInput:(body:operations['restrictedLicenseScope']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/license-scope-evidence/restricted-input',{body}),
 };
}

export function createOrganizationBundleClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  receive:(body:operations['receiveOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/receive',{body}),
  revision:(body:operations['readOrganizationBundleRevision']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/revision',{body}),
  validate:(body:operations['validateOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/validate/bundle',{body}),
  validateORG01:(body:operations['validateORG01']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/validate/ORG01',{body}),
  validateORG02:(body:operations['validateORG02']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/validate/ORG02',{body}),
  validateORG03:(body:operations['validateORG03']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/validate/ORG03',{body}),
  preauthorize:(body:operations['preauthorizeOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/preauthorize',{body}),
  legalReview:(body:operations['readOrganizationBundleLegalReview']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/legal-review',{body}),
  verify:(body:operations['verifyOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/verify',{body}),
  plan:(body:operations['planOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/plan',{body}),
  review:(body:operations['reviewOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/review',{body}),
  approve:(body:operations['approveOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/approve',{body}),
  apply:(body:operations['applyOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/apply',{body}),
  resume:(body:operations['resumeOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/import/organization-bundles/resume',{body}),
 };
}

export function createOrganizationWorkspaceClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  listBundles:(body:operations['listWorkspaceOrganizationBundles']['requestBody']['content']['application/json']={})=>client.POST('/api/vnext/organization-workspace/bundles/list',{body}),
  preflight:(body:operations['preflightOrganizationApplication']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/applications/preflight',{body}),
  objectContext:(body:operations['organizationObjectContext']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/references/context',{body}),
  prepareRevision:(body:operations['prepareOrganizationRevision']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/references/revision-source',{body}),
  reviewMaterials:(body:operations['readOrganizationCandidateMaterials']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/applications/materials',{body}),
  listApplications:(body:operations['listOrganizationApplications']['requestBody']['content']['application/json']={})=>client.POST('/api/vnext/organization-workspace/applications/list',{body}),
  applicationCapabilities:(inputId:string)=>client.POST('/api/vnext/organization-workspace/applications/access',{body:{inputId}}),
  submitDraft:(body:operations['submitOrganizationDraft']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/drafts/submit',{body}),
  previewWorkbook:(body:operations['previewOrganizationWorkbook']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/workbook/preview',{body}),
  capabilities:(body:operations['organizationWorkspaceCapabilities']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/capabilities',{body}),
  saveDraft:(body:operations['saveOrganizationDraft']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/drafts/save',{body}),
  readDraft:(id:string)=>client.POST('/api/vnext/organization-workspace/drafts/read',{body:{id}}),
  listDrafts:()=>client.POST('/api/vnext/organization-workspace/drafts/list',{body:{}}),
  discardDraft:(body:operations['discardOrganizationDraft']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/drafts/discard',{body}),
 };
}
