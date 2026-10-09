import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type WardNursingInput=operations['stageWardNursingInput']['requestBody']['content']['application/json'];
export function createWardNursingCoverageClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  scopeDefinition:(body:operations['readWardNursingScopeDefinition']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/scope-definitions/read',{body}),
  scopeVersion:(body:operations['readWardNursingScopeVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/scope-definitions/exact',{body}),
  handoverReceipt:(body:operations['getWardNursingHandoverReceipt']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/handover-receipt',{body}),
  stage:(body:WardNursingInput)=>client.POST('/api/vnext/ward-nursing-coverages/inputs',{body}),
  readInput:(body:operations['readWardNursingInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/inputs/read',{body}),
  verify:(body:operations['verifyWardNursingInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/verify',{body}),
  preview:(body:operations['previewWardNursingInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/preview',{body}),
  plan:(body:operations['planWardNursingInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/plan',{body}),
  withdraw:(body:operations['withdrawWardNursingInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/withdraw',{body}),
  review:(body:operations['reviewWardNursingCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/review',{body}),
  approve:(body:operations['approveWardNursingCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/approve',{body}),
  apply:(body:operations['applyWardNursingCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/apply',{body}),
  resume:(body:operations['resumeWardNursingOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/resume',{body}),
  reconcile:(body:operations['reconcileWardNursingOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/reconcile',{body}),
  query:(body:operations['getWardNursingAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/query',{body}),
  history:(body:operations['getWardNursingHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/history',{body}),
  exact:(body:operations['getWardNursingVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/exact',{body}),
  diff:(body:operations['diffWardNursingVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/diff',{body}),
  list:(body:operations['listWardNursingRelations']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/list',{body}),
  evaluate:(body:operations['evaluateWardNursingWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/evaluate',{body}),
  evaluateEndpointImpacts:(body:operations['evaluateWardNursingEndpointImpacts']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/impacts',{body}),
  file:(body:operations['receiveWardNursingFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/ward-nursing-coverages/files',{body}),
 };
}
