import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export type SubjectPermissionInput=operations['stageSubjectPermissionInput']['requestBody']['content']['application/json'];
export function createSubjectPermissionClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  stage:(body:SubjectPermissionInput)=>client.POST('/api/vnext/subject-permissions/inputs',{body}),
  readInput:(body:operations['readSubjectPermissionInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/inputs/read',{body}),
  verify:(body:operations['verifySubjectPermissionInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/verify',{body}),
  preview:(body:operations['previewSubjectPermissionInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/preview',{body}),
  plan:(body:operations['planSubjectPermissionInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/plan',{body}),
  withdraw:(body:operations['withdrawSubjectPermissionInput']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/withdraw',{body}),
  review:(body:operations['reviewSubjectPermissionCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/review',{body}),
  approve:(body:operations['approveSubjectPermissionCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/approve',{body}),
  apply:(body:operations['applySubjectPermissionCandidate']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/apply',{body}),
  resume:(body:operations['resumeSubjectPermissionOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/resume',{body}),
  reconcile:(body:operations['reconcileSubjectPermissionOutcome']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/reconcile',{body}),
  query:(body:operations['querySubjectPermission']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/query',{body}),
  history:(body:operations['historySubjectPermission']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/history',{body}),
  exact:(body:operations['exactSubjectPermission']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/exact',{body}),
  recheck:(body:operations['recheckSubjectPermission']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/recheck',{body}),
  evaluate:(body:operations['evaluateSubjectPermissionWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/evaluate',{body}),
  file:(body:operations['receiveSubjectPermissionFile']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-permissions/files',{body}),
 };
}
