/** Finite form vocabulary derived from the current closed public contract. */
function careDefinition(api){
 const prefixes=['/api/vnext/business-units/','/api/vnext/nursing-units/','/api/vnext/wards/','/api/vnext/unit-ward-relations/','/api/vnext/ward-nursing-coverages/','/api/vnext/unit-capabilities/','/api/vnext/subject-permissions/','/api/vnext/locations/','/api/vnext/location-uses/','/api/vnext/care-location-lifecycle/','/api/vnext/care-organization/','/api/vnext/care-workspace/','/api/vnext/parameter-values/','/api/vnext/subject-codes/'];
 const resolve=node=>{if(!node||typeof node!=='object')return node;if(node.$ref){let value=api;for(const part of node.$ref.slice(2).split('/'))value=value[part];return resolve(value);}return Object.fromEntries(Object.entries(node).map(([key,value])=>[key,Array.isArray(value)?value.map(resolve):resolve(value)]));};
 const referenceOperations=new Set(['getDepartmentLifecycleHistory','readOrganizationLicenses','listLocationUsageTypes']);
 const operations={};for(const [path,methods] of Object.entries(api.paths))for(const [method,operation] of Object.entries(methods))if(method==='post'&&operation.requestBody&&(prefixes.some(prefix=>path.startsWith(prefix))||path==='/api/vnext/workbench/template'||referenceOperations.has(operation.operationId)))operations[operation.operationId]={path,schema:resolve(operation.requestBody.content['application/json'].schema)};
 const saved=operations.saveCareWorkspaceDraft?.schema;if(!saved)throw new Error('CARE_UI_CONTRACT_REQUIRED');
 const drafts=Object.fromEntries((saved.anyOf??saved.oneOf??[]).map(branch=>{const kind=branch.properties.kind.const??branch.properties.kind.enum?.[0];if(!kind)throw new Error('CARE_UI_KIND_REQUIRED');return [kind,branch.properties.payload];}));
 if(Object.keys(drafts).length!==10)throw new Error('CARE_UI_KIND_COVERAGE_REQUIRED');
 return {operations,drafts};
}
export function careUiContract(api){return '// Generated from current public OpenAPI. Run vnext:contract:generate.\nexport const careForms = '+JSON.stringify(careDefinition(api),null,2)+' as const;\n';}
/** Generated dispatch keeps every wire path and body bound to the generated SDK. */
export function careOperationClient(api){
 const {operations}=careDefinition(api);
 const names=Object.keys(operations),union=names.map(name=>JSON.stringify(name)).join('|');
 return '// Generated from current public OpenAPI. Run vnext:contract:generate.\nimport type {operations} from "./vnext-schema.generated.js";\nimport {createVNextCatalogClient} from "./vnext-client.js";\nexport type CareOperation='+union+';\nexport type CareOperationInput<K extends CareOperation>=operations[K]["requestBody"]["content"]["application/json"];\nexport type CareOperationResponse<K extends CareOperation>=operations[K]["responses"][200]["content"]["application/json"];\nexport type CareOperationResult<K extends CareOperation>={data?:CareOperationResponse<K>;error?:{code:string;message:string;field?:string};response:Response};\nexport function createCareOperationClient(baseUrl:string,actor:string){const client=createVNextCatalogClient(baseUrl,actor);return {call<K extends CareOperation>(operation:K,body:CareOperationInput<K>):Promise<CareOperationResult<K>>{switch(operation){\n'+names.map(name=>'case '+JSON.stringify(name)+':return client.POST('+JSON.stringify(operations[name].path)+',{body:body as CareOperationInput<'+JSON.stringify(name)+'>}) as Promise<CareOperationResult<K>>;').join('\n')+'\ndefault:throw new Error("CLOSED_OPERATION_REQUIRED");}}};}\n';
}
