import createClient from 'openapi-fetch';
import type {paths,operations} from './vnext-schema.generated.js';
export function createSubjectCodeClient(baseUrl:string,actor:string){
 const client=createClient<paths>({baseUrl,headers:{'x-catalog-actor':actor}});
 return {command:(body:operations['commandSubjectCodeSnapshot']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-codes/command',{body}),read:(body:operations['querySubjectCodeSnapshots']['requestBody']['content']['application/json'])=>client.POST('/api/vnext/subject-codes/query',{body})};
}
