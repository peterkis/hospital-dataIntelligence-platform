import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';

export type LocationUsageTypeCommand=operations['commandLocationUsageType']['requestBody']['content']['application/json'];
export type LocationUsageTypeItem=operations['readLocationUsageType']['responses'][200]['content']['application/json'];
export type LocationUsageTypePermissions=operations['permissionsLocationUsageTypes']['responses'][200]['content']['application/json'];
export function createLocationUsageTypeClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  command:(body:LocationUsageTypeCommand)=>client.POST('/api/vnext/location-usage-types/command',{body}),
  read:(body:operations['readLocationUsageType']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-usage-types/query',{body}),
  history:(body:operations['historyLocationUsageType']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-usage-types/history',{body}),
  list:(body:operations['listLocationUsageTypes']['requestBody']['content']['application/json']={})=>client.POST('/api/vnext/location-usage-types/list',{body}),
  permissions:()=>client.POST('/api/vnext/location-usage-types/permissions',{body:{}}),
  readMaterial:(body:operations['readLocationUsageTypeMaterial']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-usage-types/material',{body}),
 };
}

export type LocationUseInput=operations['stageLocationUseInput']['requestBody']['content']['application/json'];
export function createLocationUseClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:LocationUseInput)=>client.POST('/api/vnext/location-uses/inputs',{body}),
  readInput:(body:operations['readLocationUseInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/inputs/read',{body}),
  verify:(body:operations['verifyLocationUseInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/verify',{body}),
  preview:(body:operations['previewLocationUseInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/preview',{body}),
  plan:(body:operations['planLocationUseInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/plan',{body}),
  withdraw:(body:operations['withdrawLocationUseInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/withdraw',{body}),
  review:(body:operations['reviewLocationUseCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/review',{body}),
  approve:(body:operations['approveLocationUseCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/approve',{body}),
  apply:(body:operations['applyLocationUseCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/apply',{body}),
  resume:(body:operations['resumeLocationUseOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/resume',{body}),
  reconcile:(body:operations['reconcileLocationUseOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/reconcile',{body}),
  query:(body:operations['getLocationUseAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/query',{body}),
  history:(body:operations['getLocationUseHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/history',{body}),
  exact:(body:operations['getLocationUseVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/exact',{body}),
  diff:(body:operations['diffLocationUseVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/diff',{body}),
  list:(body:operations['listLocationUses']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/list',{body}),
  evaluate:(body:operations['evaluateLocationUseWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/evaluate',{body}),
  file:(body:operations['receiveLocationUseFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/location-uses/files',{body}),
 };
}
