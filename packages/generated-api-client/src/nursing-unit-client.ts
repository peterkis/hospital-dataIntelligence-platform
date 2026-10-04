import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type NursingUnitInput=operations['stageNursingUnitInput']['requestBody']['content']['application/json'];
export function createNursingUnitClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:operations['stageNursingUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/inputs',{body}),
  readInput:(body:operations['readNursingUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/inputs/read',{body}),
  verify:(body:operations['verifyNursingUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/verify',{body}),
  preview:(body:operations['previewNursingUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/preview',{body}),
  plan:(body:operations['planNursingUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/plan',{body}),
  withdraw:(body:operations['withdrawNursingUnitInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/withdraw',{body}),
  review:(body:operations['reviewNursingUnitCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/review',{body}),
  approve:(body:operations['approveNursingUnitCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/approve',{body}),
  apply:(body:operations['applyNursingUnitCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/apply',{body}),
  resume:(body:operations['resumeNursingUnitOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/resume',{body}),
  reconcile:(body:operations['reconcileNursingUnitOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/reconcile',{body}),
  query:(body:operations['getNursingUnitAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/query',{body}),
  history:(body:operations['getNursingUnitHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/history',{body}),
  exact:(body:operations['getNursingUnitVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/exact',{body}),
  diff:(body:operations['diffNursingUnitVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/diff',{body}),
  list:(body:operations['listNursingUnits']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/list',{body}),
  coverage:(body:operations['getNursingUnitCoverage']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/coverage',{body}),
  evaluate:(body:operations['evaluateNursingUnitWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/evaluate',{body}),
  file:(body:operations['receiveNursingUnitFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/nursing-units/files',{body}),
 };
}
