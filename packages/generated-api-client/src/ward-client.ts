import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type WardInput=operations['stageWardInput']['requestBody']['content']['application/json'];
export function createWardClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:operations['stageWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/inputs',{body}),
  readInput:(body:operations['readWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/inputs/read',{body}),
  verify:(body:operations['verifyWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/verify',{body}),
  preview:(body:operations['previewWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/preview',{body}),
  plan:(body:operations['planWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/plan',{body}),
  withdraw:(body:operations['withdrawWardInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/withdraw',{body}),
  review:(body:operations['reviewWardCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/review',{body}),
  approve:(body:operations['approveWardCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/approve',{body}),
  apply:(body:operations['applyWardCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/apply',{body}),
  resume:(body:operations['resumeWardOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/resume',{body}),
  reconcile:(body:operations['reconcileWardOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/reconcile',{body}),
  query:(body:operations['getWardAsOf']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/query',{body}),
  history:(body:operations['getWardHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/history',{body}),
  exact:(body:operations['getWardVersion']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/exact',{body}),
  diff:(body:operations['diffWardVersions']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/diff',{body}),
  list:(body:operations['listWards']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/list',{body}),
  coverage:(body:operations['getWardCoverage']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/coverage',{body}),
  evaluate:(body:operations['evaluateWardWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/evaluate',{body}),
  file:(body:operations['receiveWardFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/wards/files',{body}),
 };
}
