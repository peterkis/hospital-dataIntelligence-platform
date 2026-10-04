import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type BusinessUnitInput=operations['stageBusinessUnitInput']['requestBody']['content']['application/json'];
export function createBusinessUnitClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:operations['stageBusinessUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/inputs',{body}),
  readInput:(body:operations['readBusinessUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/inputs/read',{body}),
  verify:(body:operations['verifyBusinessUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/verify',{body}),
  preview:(body:operations['previewBusinessUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/preview',{body}),
  plan:(body:operations['planBusinessUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/plan',{body}),
  withdraw:(body:operations['withdrawBusinessUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/withdraw',{body}),
  review:(body:operations['reviewBusinessUnitCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/review',{body}),
  approve:(body:operations['approveBusinessUnitCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/approve',{body}),
  apply:(body:operations['applyBusinessUnitCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/apply',{body}),
  resume:(body:operations['resumeBusinessUnitOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/resume',{body}),
  reconcile:(body:operations['reconcileBusinessUnitOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/reconcile',{body}),
  query:(body:operations['getBusinessUnitAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/query',{body}),
  history:(body:operations['getBusinessUnitHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/history',{body}),
  exact:(body:operations['getBusinessUnitVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/exact',{body}),
  diff:(body:operations['diffBusinessUnitVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/diff',{body}),
  list:(body:operations['listBusinessUnits']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/list',{body}),
  coverage:(body:operations['getBusinessUnitCoverage']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/coverage',{body}),
  evaluate:(body:operations['evaluateBusinessUnitWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/evaluate',{body}),
  file:(body:operations['receiveBusinessUnitFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/business-units/files',{body}),
 };
}
