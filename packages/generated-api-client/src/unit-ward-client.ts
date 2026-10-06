import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type UnitWardInput=operations['stageUnitWardInput']['requestBody']['content']['application/json'];
export function createUnitWardClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:UnitWardInput)=>client.POST('/api/vnext/unit-ward-relations/inputs',{body}),
  readInput:(body:operations['readUnitWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/inputs/read',{body}),
  verify:(body:operations['verifyUnitWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/verify',{body}),
  preview:(body:operations['previewUnitWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/preview',{body}),
  plan:(body:operations['planUnitWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/plan',{body}),
  withdraw:(body:operations['withdrawUnitWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/withdraw',{body}),
  review:(body:operations['reviewUnitWardCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/review',{body}),
  approve:(body:operations['approveUnitWardCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/approve',{body}),
  apply:(body:operations['applyUnitWardCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/apply',{body}),
  resume:(body:operations['resumeUnitWardOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/resume',{body}),
  reconcile:(body:operations['reconcileUnitWardOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/reconcile',{body}),
  query:(body:operations['getUnitWardAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/query',{body}),
  history:(body:operations['getUnitWardHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/history',{body}),
  exact:(body:operations['getUnitWardVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/exact',{body}),
  diff:(body:operations['diffUnitWardVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/diff',{body}),
  list:(body:operations['listUnitWardRelations']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/list',{body}),
  evaluate:(body:operations['evaluateUnitWardWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/evaluate',{body}),
  file:(body:operations['receiveUnitWardFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/unit-ward-relations/files',{body}),
 };
}
