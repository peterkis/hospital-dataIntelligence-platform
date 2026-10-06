import {afterAll,beforeAll,describe,expect,test} from 'vitest';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';
import {randomUUID} from 'node:crypto';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';

describe('UnitWard raw JSON over real HTTP',()=>{
 let app:Awaited<ReturnType<typeof buildCatalogServer>>|undefined;
 let url:string;
 // Full Catalog schema compilation/listen has its own finite startup budget.
 // Each request test keeps Vitest's default 5-second assertion budget.
 beforeAll(async()=>{
  app=await buildCatalogServer();
  url=await app.listen({host:'127.0.0.1',port:0});
 },30_000);
 afterAll(async()=>{await app?.close();},10_000);

 for(const key of ['version_no','version_\\u006eo'])test(`astra review F5: real HTTP rejects decoded duplicate ${key} before the Owner boundary`,async()=>{
  const id=randomUUID(),body=JSON.stringify({requestId:id,jobId:id,revisionId:id,campus:'NORTH',profile:'CORE',timePolicy:'LOCAL',entries:[{action:'CREATE',applicability:{unit:{owner:'care-organization/unit',id},ward:{owner:'care-organization/ward',id},campus:{owner:'organization-master/campus',id},purpose:'ADMISSION'},rule:{kind:'NO_SHARING_REQUIRED'},reason:'TEST strict HTTP',evidenceId:id,row:{unit_ward_rel_id:id,unit_id:id,ward_id:id,relation_type:'收治',is_primary:'N',sharing_rule:null,version_no:9,valid_from:'2026-01-01T00:00:00',valid_to:null,record_status:'ACTIVE',source_system_id:id,source_record_id:'TEST/ORG10',approval_ref:'TEST',recorded_at:'2026-01-02T00:00:00'}}]});
  const send=(value:string)=>fetch(url+'/api/vnext/unit-ward-relations/inputs',{method:'POST',headers:{'content-type':'application/json',connection:'close'},body:value});
  expect((await send(body)).status).toBe(503);
  expect((await send(body.replace('"version_no":9','"version_no":"INVALID"'))).status).toBe(400);
  const reply=await send(body.replace('"version_no":9',`"version_no":"INVALID","${key}":9`));
  expect(reply.status).toBe(400);
  expect(await reply.json()).toMatchObject({code:'CLOSED_INPUT_REQUIRED'});
 });
});

test('the independently adopted ORG10 CORE selects the care-organization relation owner',()=>{
 expect(selectImportAdapter({dataset:'ORG10',profile:'CORE',contractVersion:1,templateVersion:'ORG10_CORE_V1',parserPolicy:'STRICT_UNIT_WARD_V1'})).toMatchObject({owner:'care-organization',capability:'READY',allowedIntents:['CREATE','REVISE','END']});
});
