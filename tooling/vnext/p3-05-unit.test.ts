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
 test('duplicate native version keys are rejected before the unavailable Owner',async()=>{
  const id=randomUUID(),coverage={kind:'WHOLE_WARD'},value={kind:'COVERAGE',requestId:id,jobId:id,revisionId:id,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{action:'CREATE',applicability:{ward:{owner:'care-organization/ward',id},nursing:{owner:'care-organization/nursing',id},campus:{owner:'organization-master/campus',id},purpose:'NURSING_COVERAGE'},coverage,rule:{kind:'NO_SHARING_REQUIRED'},reason:'TEST strict HTTP',evidenceId:id,row:{ward_nursing_rel_id:id,ward_id:id,nursing_unit_id:id,coverage_scope:JSON.stringify(coverage),is_primary:'Y',handover_rule_ref:null,version_no:9,valid_from:'2026-01-01T00:00:00',valid_to:null,record_status:'ACTIVE',source_system_id:id,source_record_id:'TEST/ORG11',approval_ref:'TEST',recorded_at:'2026-01-02T00:00:00'}}]},body=JSON.stringify(value),send=(text:string)=>fetch(url+'/api/vnext/ward-nursing-coverages/inputs',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:text});
  expect((await send(body)).status).toBe(503);
  expect((await send(body.replace('"version_no":9','"version_no":"9"'))).status).toBe(400);
  for(const key of ['version_no','version_\\u006eo'])expect((await send(body.replace('"version_no":9',`"version_no":"INVALID","${key}":9`))).status).toBe(400);
 });
});
test('FULL and unapproved Nursing coverage contracts stay unavailable',()=>{
 for(const profile of ['CORE','FULL'] as const)expect(selectImportAdapter({dataset:'ORG11',profile,contractVersion:1,templateVersion:'ORG11_UNAPPROVED',parserPolicy:'STRICT_WARD_NURSING_V1'}).capability).toBe('NOT_READY');
});
