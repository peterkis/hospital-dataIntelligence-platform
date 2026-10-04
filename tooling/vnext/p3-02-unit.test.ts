import {test,expect} from 'vitest';
import {buildCatalogServer} from '../../apps/governance-api/src/composition/build-vnext-catalog.js';
import {normalizeWardRow,wardCheck,WardEntrySchema,type WardRow} from '../../apps/governance-api/src/modules/care-organization/index.js';
const id='00000000-0000-7000-8000-000000000001';
const row:WardRow={ward_id:'source-alias',ward_code:'TEST_W',ward_name:'TEST',managing_unit_id:id,campus_id:id,ward_type:'TEST mixed',admission_rule_ref:null,public_phone:null,version_no:'1',valid_from:'2026-01-01T00:00:00.123456',valid_to:null,record_status:'ACTIVE',source_system_id:id,source_record_id:'TEST/2',approval_ref:'TEST',recorded_at:'2026-01-02T00:00:00'};

test('Ward HTTP capability reports unavailable Owner explicitly',async()=>{
 const app=await buildCatalogServer();
 try{const address=await app.listen({host:'127.0.0.1',port:0});
  const response=await fetch(address+'/api/vnext/wards/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:'00000000-0000-7000-8000-000000000001'})});
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({code:'BLOCKED_DEPENDENCY'});
 }finally{await app.close();}
});
test('Ward source nulls and unbounded microsecond intervals are retained exactly',()=>{expect(normalizeWardRow(row,'LOCAL')).toMatchObject({from:'2026-01-01T00:00:00.123456',to:null,row});});
test('a source integer revision retains its native JSON value without becoming the platform head',()=>{expect(normalizeWardRow({...row,version_no:9},'LOCAL').row.version_no).toBe(9);});
test.each(['2026-02-30T00:00:00','2026-01-01T00:00:00Z','2026-01-01T00:00:00+08:00'])('Ward local API rejects invalid or offset date %s',valid_from=>{expect(()=>normalizeWardRow({...row,valid_from},'LOCAL')).toThrow('LOCAL_TIME_REQUIRED');});
test('explicit approved source conversion keeps original offsets and microseconds',()=>{const input={...row,valid_from:row.valid_from+'+08:00',recorded_at:row.recorded_at+'+08:00'};expect(normalizeWardRow(input,'SOURCE_PLUS08_TO_LOCAL')).toMatchObject({from:row.valid_from,row:input});});
test('Ward CREATE has no supplied target and normal REVISE cannot change management',()=>{const binding={unit:{owner:'care-organization/unit',id},campus:{owner:'organization-master/campus',id}},common={row,reason:'TEST',evidenceId:id},target={owner:'care-organization/ward',id,expectedHead:'1'};expect(()=>wardCheck(WardEntrySchema,{...common,action:'CREATE',binding,target})).toThrow('CLOSED_INPUT_REQUIRED');expect(()=>wardCheck(WardEntrySchema,{...common,action:'REVISE',target,binding})).toThrow('CLOSED_INPUT_REQUIRED');});
