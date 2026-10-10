import type {operations} from './vnext-schema.generated.js';
import {createVNextCatalogClient} from './vnext-client.js';
export type CareWorkspaceDraft=operations['saveCareWorkspaceDraft']['requestBody']['content']['application/json'];
export function createCareWorkspaceClient(baseUrl:string,actor:string){const client=createVNextCatalogClient(baseUrl,actor);return {
 save:(body:CareWorkspaceDraft)=>client.POST('/api/vnext/care-workspace/drafts/save',{body}),
 read:(id:string)=>client.POST('/api/vnext/care-workspace/drafts/read',{body:{id}}),
 recover:(requestId:string)=>client.POST('/api/vnext/care-workspace/drafts/recover',{body:{requestId}}),
 list:(body:operations['listCareWorkspaceDrafts']['requestBody']['content']['application/json']={})=>client.POST('/api/vnext/care-workspace/drafts/list',{body}),
 discard:(body:operations['discardCareWorkspaceDraft']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/drafts/discard',{body}),
 submit:(body:operations['submitCareWorkspaceDraft']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/drafts/submit',{body}),
 receiveFile:(body:operations['receiveCareWorkspaceDraftFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/files/receive',{body}),
 fileReceipt:(body:operations['readCareWorkspaceFileReceipt']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/files/receipt',{body}),
 savedFile:(body:operations['readCareWorkspaceSavedFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/files/saved',{body}),
 applications:(body:operations['listCareWorkspaceApplications']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/applications/list',{body}),
 permissions:(body:operations['careWorkspacePermissions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/permissions',{body}),
 executions:(body:operations['listCareWorkspaceExecutions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/applications/executions',{body}),
 applicationReference:(body:operations['readCareWorkspaceApplicationReference']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-workspace/applications/reference',{body}),
};}
export function createCareValidationClient(baseUrl:string,actor:string){const client=createVNextCatalogClient(baseUrl,actor);return {
 validateCareOrganizationBundle:(body:operations['validateCareOrganizationBundle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-organization/validate-bundle',{body}),
 assessUnitImpact:(body:operations['assessUnitImpact']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-organization/assess-unit-impact',{body}),
};}
