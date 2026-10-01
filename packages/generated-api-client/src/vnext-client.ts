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
  assessImpact:(body:operations['assessCampusImpact']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/campuses/impact',{body}),
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
  prepareCampusLifecycle:(body:operations['prepareCampusLifecycleSource']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-workspace/references/campus-lifecycle-source',{body}),
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

export type DepartmentInput=operations['stageDepartment']['requestBody']['content']['application/json'];
export type HierarchyInput=operations['importHierarchyCandidate']['requestBody']['content']['application/json'];
export function createHierarchyClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  createView:(body:operations['createHierarchyView']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/hierarchy/views',{body}),
  importCandidate:(body:HierarchyInput)=>client.POST('/api/vnext/hierarchy/candidates',{body}),
  approve:(body:operations['approveHierarchyCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/hierarchy/candidates/approve',{body}),
  publish:(body:operations['publishHierarchySnapshot']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/hierarchy/candidates/publish',{body}),
  read:(body:operations['readHierarchySnapshot']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/hierarchy/snapshots/read',{body}),
  prepareClosure:(body:operations['prepareHierarchyClosure']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/hierarchy/closures',{body}),
  close:(body:operations['closeHierarchyView']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/hierarchy/closures/apply',{body}),
 };
}
export function createDepartmentClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  preview:(body:operations['previewDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/preview',{body}),
  stage:(body:operations['stageDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/inputs',{body}),
  readInput:(body:operations['readDepartmentInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/inputs/read',{body}),
  validate:(body:operations['validateDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/validate',{body}),
  verify:(body:operations['verifyDepartmentEvidence']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/verify',{body}),
  plan:(body:operations['planDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/plan',{body}),
  review:(body:operations['reviewDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/review',{body}),
  approve:(body:operations['approveDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/approve',{body}),
  apply:(body:operations['applyDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/apply',{body}),
  resume:(body:operations['resumeDepartment']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/resume',{body}),
  list:(body:operations['listDepartments']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/list',{body}),
  read:(body:operations['getDepartmentAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/query',{body}),
  history:(body:operations['getDepartmentVersionHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/history',{body}),
  exact:(body:operations['getExactDepartmentReference']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/references/exact',{body}),
  coverage:(body:operations['getDepartmentCoverage']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/references/coverage',{body}),
  diff:(body:operations['compareDepartmentVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/diff',{body}),
  receiveFile:(body:operations['receiveDepartmentFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/departments/files',{body}),
 };
}

export type OrganizationMappingInput=operations['stageOrganizationMappings']['requestBody']['content']['application/json'];
export function createOrganizationMappingClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  stage:(body:OrganizationMappingInput)=>client.POST('/api/vnext/organization-mappings/inputs',{body}),
  readInput:(body:operations['readOrganizationMappingInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/inputs/read',{body}),
  preview:(body:operations['previewOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/preview',{body}),
  validate:(body:operations['validateOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/validate',{body}),
  verify:(body:operations['verifyOrganizationMappingEvidence']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/verify',{body}),
  plan:(body:operations['planOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/plan',{body}),
  review:(body:operations['reviewOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/review',{body}),
  approve:(body:operations['approveOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/approve',{body}),
  apply:(body:operations['applyOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/apply',{body}),
  resume:(body:operations['resumeOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/resume',{body}),
  list:(body:operations['listOrganizationMappings']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/list',{body}),
  history:(body:operations['getOrganizationMappingHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/history',{body}),
  read:(body:operations['getOrganizationMappingAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/query',{body}),
  resolve:(body:operations['resolveOrganizationSourceMapping']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/resolve',{body}),
  diff:(body:operations['compareOrganizationMappingVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/diff',{body}),
  receiveFile:(body:operations['receiveOrganizationMappingFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-mappings/files',{body}),
 };
}
export type OrganizationIdentifierInput=operations['stageOrganizationIdentifiers']['requestBody']['content']['application/json'];
export function createOrganizationIdentifierClient(baseUrl:string,actor:string){
 const client=createVNextCatalogClient(baseUrl,actor);
 return {
  stage:(body:OrganizationIdentifierInput)=>client.POST('/api/vnext/organization-identifiers/inputs',{body}),
  readInput:(body:operations['readOrganizationIdentifierInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/inputs/read',{body}),
  preview:(body:operations['previewOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/preview',{body}),
  validate:(body:operations['validateOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/validate',{body}),
  verify:(body:operations['verifyOrganizationIdentifierEvidence']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/verify',{body}),
  plan:(body:operations['planOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/plan',{body}),
  review:(body:operations['reviewOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/review',{body}),
  approve:(body:operations['approveOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/approve',{body}),
  apply:(body:operations['applyOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/apply',{body}),
  resume:(body:operations['resumeOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/resume',{body}),
  list:(body:operations['listOrganizationIdentifiers']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/list',{body}),
  history:(body:operations['getOrganizationIdentifierHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/history',{body}),
  read:(body:operations['getOrganizationIdentifierAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/query',{body}),
  resolve:(body:operations['resolveOrganizationIdentifier']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/resolve',{body}),
  forTarget:(body:operations['getOrganizationTargetAliases']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/targets',{body}),
  preferred:(body:operations['getPreferredOrganizationAlias']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/preferred',{body}),
  diff:(body:operations['compareOrganizationIdentifierVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/diff',{body}),
  receiveFile:(body:operations['receiveOrganizationIdentifierFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/organization-identifiers/files',{body}),
 };
}
