import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export function createParameterValueClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {
  command:(body:operations['commandParameterValue']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/parameter-values/commands',{body}),
  query:(body:operations['getParameterValue']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/parameter-values/query',{body}),
  history:(body:operations['getParameterValueHistory']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/parameter-values/history',{body}),
  evaluate:(body:operations['evaluateParameterValueWindow']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/parameter-values/evaluate',{body}),
 };
}
