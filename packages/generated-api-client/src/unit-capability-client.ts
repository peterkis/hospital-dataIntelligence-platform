import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type UnitCapabilityInput=operations['stageUnitCapabilityInput']['requestBody']['content']['application/json'];
export function createUnitCapabilityClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:UnitCapabilityInput)=>client.POST('/api/vnext/unit-capabilities/inputs',{body}),
  readInput:(body:operations['readUnitCapabilityInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/inputs/read',{body}),
  verify:(body:operations['verifyUnitCapabilityInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/verify',{body}),
  preview:(body:operations['previewUnitCapabilityInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/preview',{body}),
  plan:(body:operations['planUnitCapabilityInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/plan',{body}),
  withdraw:(body:operations['withdrawUnitCapabilityInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/withdraw',{body}),
  review:(body:operations['reviewUnitCapabilityCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/review',{body}),
  approve:(body:operations['approveUnitCapabilityCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/approve',{body}),
  apply:(body:operations['applyUnitCapabilityCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/apply',{body}),
  resume:(body:operations['resumeUnitCapabilityOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/resume',{body}),
  reconcile:(body:operations['reconcileUnitCapabilityOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/reconcile',{body}),
  query:(body:operations['getUnitCapabilityAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/query',{body}),
  history:(body:operations['getUnitCapabilityHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/history',{body}),
  exact:(body:operations['getUnitCapabilityVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/exact',{body}),
  diff:(body:operations['diffUnitCapabilityVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/diff',{body}),
  list:(body:operations['listUnitCapabilities']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/list',{body}),
  evaluate:(body:operations['evaluateUnitCapabilityWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/evaluate',{body}),
  file:(body:operations['receiveUnitCapabilityFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-capabilities/files',{body}),
 };
}
