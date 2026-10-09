import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type CareLocationLifecycleInput=operations['stageCareLocationLifecycle']['requestBody']['content']['application/json'];
export function createCareLocationLifecycleClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  assessSpaceMove:(body:operations['assessSpaceMove']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/assess-space-move',{body}),
  stage:(body:operations['stageCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/inputs',{body}),
  scheduleUnitMove:(body:operations['scheduleUnitMove']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/schedule-unit-move',{body}),
  closeCareRelation:(body:operations['closeCareRelation']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/close-care-relation',{body}),
  reopenSuspendedUnit:(body:operations['reopenSuspendedUnit']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/reopen-suspended-unit',{body}),
  verify:(body:operations['verifyCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/verify',{body}),
  preview:(body:operations['previewCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/preview',{body}),
  plan:(body:operations['planCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/plan',{body}),
  review:(body:operations['reviewCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/review',{body}),
  approve:(body:operations['approveCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/approve',{body}),
  apply:(body:operations['applyCareLocationLifecycle']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/apply',{body}),
  resume:(body:operations['resumeCareLocationLifecycleOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/resume',{body}),
  reconcile:(body:operations['reconcileCareLocationLifecycleOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/reconcile',{body}),
  history:(body:operations['getCareLocationLifecycleHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/care-location-lifecycle/history',{body}),
 };
}
