import {beforeAll,afterAll,describe,expect,test} from 'vitest';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';
import {parseCoverageScope} from '../../apps/governance-api/src/modules/care-organization/ward-nursing-contracts.js';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {randomUUID} from 'node:crypto';

test('the independently adopted ORG11 CORE selects the Nursing coverage Owner',()=>{
 expect(selectImportAdapter({dataset:'ORG11',profile:'CORE',contractVersion:1,templateVersion:'ORG11_CORE_V1',parserPolicy:'STRICT_WARD_NURSING_V1'})).toMatchObject({owner:'care-organization',capability:'READY',allowedIntents:['CREATE','REVISE','END']});
});
test('controlled Nursing scopes reject free text, decoded duplicate keys, unknown properties and repeated partitions',()=>{
 expect(parseCoverageScope('{"kind":"WHOLE_WARD"}')).toEqual({kind:'WHOLE_WARD'});
 const id=randomUUID();
 for(const text of ['1-5床','{"kind":"WHOLE_WARD","kind":"PARTITIONS"}','{"kind":"WHOLE_WARD","k\\u0069nd":"WHOLE_WARD"}','{"kind":"WHOLE_WARD","bedNumber":1}',JSON.stringify({kind:'PARTITIONS',scopeSetId:id,version:'1',partitionIds:[id,id]})])expect(()=>parseCoverageScope(text)).toThrow('UNKNOWN_COVERAGE_SCOPE');
});
describe('Nursing coverage strict raw JSON over real HTTP',()=>{
 let app:Awaited<ReturnType<typeof buildCatalogServer>>|undefined,url:string;
 beforeAll(async()=>{app=await buildCatalogServer();url=await app.listen({host:'127.0.0.1',port:0});},30_000);
 afterAll(async()=>{await app?.close();},10_000);
 const post=(path:string,body:unknown)=>fetch(url+'/api/vnext/ward-nursing-coverages/'+path,{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:JSON.stringify(body)});
 test('duplicate native version keys are rejected before the unavailable Owner',async()=>{
  const id=randomUUID(),coverage={kind:'WHOLE_WARD'},value={kind:'COVERAGE',requestId:id,jobId:id,revisionId:id,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{action:'CREATE',applicability:{ward:{owner:'care-organization/ward',id},nursing:{owner:'care-organization/nursing',id},campus:{owner:'organization-master/campus',id},purpose:'NURSING_COVERAGE'},coverage,rule:{kind:'NO_SHARING_REQUIRED'},reason:'TEST strict HTTP',evidenceId:id,row:{ward_nursing_rel_id:id,ward_id:id,nursing_unit_id:id,coverage_scope:JSON.stringify(coverage),is_primary:'Y',handover_rule_ref:null,version_no:9,valid_from:'2026-01-01T00:00:00',valid_to:null,record_status:'ACTIVE',source_system_id:id,source_record_id:'TEST/ORG11',approval_ref:'TEST',recorded_at:'2026-01-02T00:00:00'}}]},body=JSON.stringify(value),send=(text:string)=>fetch(url+'/api/vnext/ward-nursing-coverages/inputs',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:text});
  expect((await send(body)).status).toBe(503);
  expect((await send(body.replace('"version_no":9','"version_no":"9"'))).status).toBe(400);
  for(const key of ['version_no','version_\\u006eo'])expect((await send(body.replace('"version_no":9',`"version_no":"INVALID","${key}":9`))).status).toBe(400);
 });
 test('scope registration rejects unknown applicability properties before the unavailable Owner',async()=>{
  const id=randomUUID(),applicability={ward:{owner:'care-organization/ward',id},campus:{owner:'organization-master/campus',id},purpose:'NURSING_COVERAGE'},definition={sourceAlias:'TEST_SCOPE',applicability,partitions:[{sourceAlias:'A',name:'TEST A',boundary:'TEST disjoint A'},{sourceAlias:'B',name:'TEST B',boundary:'TEST disjoint B'}],validFrom:'2026-01-01T00:00:00',validTo:null,sourceSystemId:id,sourceRecordedAt:'2026-01-02T00:00:00',approvalReference:'TEST_POLICY_ONLY',evidenceId:id,reason:'TEST scope review'},body={kind:'SCOPE_DEFINITION',requestId:id,jobId:id,revisionId:id,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',definition};
  expect((await post('inputs',body)).status).toBe(503);
  const response=await post('inputs',{...body,definition:{...definition,applicability:{...applicability,unreviewedProperty:true}}});
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'CLOSED_INPUT_REQUIRED'});
 });
 test.each(['CREATE','REVISE','END'])('file %s operations reject unknown properties before the unavailable Owner',async action=>{
  const id=randomUUID(),operation={action,applicability:{ward:{owner:'care-organization/ward',id},nursing:{owner:'care-organization/nursing',id},campus:{owner:'organization-master/campus',id},purpose:'NURSING_COVERAGE'},coverage:{kind:'WHOLE_WARD'},rule:{kind:'NO_SHARING_REQUIRED'},reason:'TEST closed file operation',evidenceId:id,...(action==='CREATE'?{}:{target:{owner:'care-organization/ward-nursing-coverage',id,expectedHead:'1'}}),...(action==='END'?{endAt:'2026-03-01T00:00:00'}:{})},input={requestId:id,fileRequestId:id,job:{action:'CREATE',scope:'SYNTHETIC',requestId:id,reason:'TEST_WARD_NURSING_FILE',profile:'CORE',contractId:id,contractVersionId:id,input:{kind:'FILE',format:'JSON',parserPolicy:'STRICT_WARD_NURSING_V1'}},campus:'NORTH',timePolicy:'LOCAL',retentionSeconds:7200,operations:[operation]},body={input,contentBase64:Buffer.from('[]').toString('base64')};
  expect((await post('files',body)).status).toBe(503);
  const response=await post('files',{...body,input:{...input,operations:[{...operation,unreviewedProperty:true}]}});
  expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:'CLOSED_INPUT_REQUIRED'});
 });
 test('oversized Nursing coverage HTTP requests return the declared 413 error',async()=>{
  const response=await post('inputs/read',{inputId:randomUUID(),padding:'x'.repeat(300_000)});
  expect(response.status).toBe(413);expect(await response.json()).toMatchObject({code:'FST_ERR_CTP_BODY_TOO_LARGE'});
  expect(app!.swagger().paths?.['/api/vnext/ward-nursing-coverages/inputs/read']?.post?.responses).toHaveProperty('413');
 });
 test('Nursing coverage contract declares shared-handler 413 and 500 responses on every public route',()=>{
  const paths=Object.entries(app!.swagger().paths??{}).filter(([path])=>path.startsWith('/api/vnext/ward-nursing-coverages/'));
  expect(paths.length).toBeGreaterThan(0);
  for(const [,item] of paths){expect(item.post?.responses).toHaveProperty('413');expect(item.post?.responses).toHaveProperty('500');}
 });
 test('published scope definition responses declare closed applicability',()=>{
  expect(app!.swagger().paths?.['/api/vnext/ward-nursing-coverages/scope-definitions/read']?.post?.responses?.['200']).toMatchObject({content:{'application/json':{schema:{properties:{applicability:{additionalProperties:false}}}}}});
 });
});
test('FULL and unapproved Nursing coverage contracts stay unavailable',()=>{
 for(const profile of ['CORE','FULL'] as const)expect(selectImportAdapter({dataset:'ORG11',profile,contractVersion:1,templateVersion:'ORG11_UNAPPROVED',parserPolicy:'STRICT_WARD_NURSING_V1'}).capability).toBe('NOT_READY');
});
