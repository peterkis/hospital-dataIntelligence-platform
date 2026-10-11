import {expect, test} from 'vitest';
import {editUnitDraft, mergeUnitDraftConflict, mergeUnitFields, unitEntry, unitFields, validateUnitFields, type UnitDraft} from '../../apps/admin-web/src/vnext/unit-maintenance-model.js';

const draft: UnitDraft = {kind:'UNIT',campus:'NORTH',profile:'CORE',requestId:'11111111-1111-4111-8111-111111111111',transport:{contractId:'22222222-2222-4222-8222-222222222222',contractVersionId:'33333333-3333-4333-8333-333333333333'},payload:{timePolicy:'LOCAL',entries:[{action:'REVISE',target:{owner:'care-organization/unit',id:'44444444-4444-4444-8444-444444444444',expectedHead:'12'},evidenceId:'55555555-5555-4555-8555-555555555555',reason:'before',row:{unit_name:'TEST name',unit_code:'00123',org_id:'66666666-6666-4666-8666-666666666666',valid_from:'2026-01-01T00:00:00.000001',valid_to:'',service_description:'before',source_record_id:'TEST original row4'}}]}};
test('property edit preserves the accepted target, precise period, immutable code and original protected provenance',()=>{
 const before=structuredClone(draft),edited=editUnitDraft(draft,{name:'TEST revised',phone:'',description:'TEST service revision',reason:'TEST explicit revision'});
 expect(draft).toEqual(before);expect(unitEntry(edited).target).toEqual(unitEntry(before).target);
 expect(edited.transport).toEqual(before.transport);expect(edited.requestId).toBe(before.requestId);
 expect(unitEntry(edited).row).toMatchObject({unit_code:'00123',org_id:unitEntry(before).row.org_id,valid_from:'2026-01-01T00:00:00.000001',source_record_id:'TEST original row4'});
 expect(unitEntry(edited).evidenceId).toBe(unitEntry(before).evidenceId);
});
test('explicit conflict merge retains edits to separate fields and the operator choice for an overlapping field',()=>{
 const base={name:'TEST',phone:'before',description:'before',reason:'before'},mine={...base,description:'mine',reason:'mine'},server={...base,phone:'server',description:'server'};
 expect(mergeUnitFields(base,mine,server)).toEqual({name:'TEST',phone:'server',description:'mine',reason:'mine'});
 expect(base.description).toBe('before');expect(server.description).toBe('server');
});
test('a partial draft cannot quietly become a multi-record or lifecycle command in the property editor',()=>{
 expect(()=>unitEntry({...draft,payload:{...draft.payload,entries:[...draft.payload.entries!,...draft.payload.entries!]}})).toThrow('一个既有业务单元');
 expect(()=>unitEntry({...draft,payload:{entries:[{action:'CLOSE'}]}})).toThrow('一个既有业务单元');
 expect(validateUnitFields({name:' ',phone:'',description:'TEST',reason:''})).toMatchObject({name:expect.any(String),reason:expect.any(String)});
});
test('409 explicit keep-mine retains uploaded material as well as text, without losing server changes',()=>{
 const mine=structuredClone(draft),server=structuredClone(draft),uploaded='77777777-7777-4777-8777-777777777777';
 unitEntry(mine).evidenceId=uploaded;unitEntry(server).row.public_phone='TEST server phone';server.expectedVersion='2';
 const fields={...unitFields(draft),description:'TEST my change'};
 const merged=mergeUnitDraftConflict(unitFields(draft),mine,fields,server,true,true);
 expect(unitEntry(merged.draft).evidenceId).toBe(uploaded);expect(merged.materialDirty).toBe(true);expect(merged.fields.description).toBe('TEST my change');expect(merged.fields.phone).toBe('TEST server phone');expect(merged.draft.expectedVersion).toBe('2');
 const adopted=mergeUnitDraftConflict(unitFields(draft),mine,fields,server,false,true);
 expect(unitEntry(adopted.draft).evidenceId).toBe(unitEntry(server).evidenceId);expect(adopted.materialDirty).toBe(false);expect(adopted.fields).toEqual(unitFields(server));
});
test('a conflict with a different record cannot repoint the property editor',()=>{
 const server=structuredClone(draft);unitEntry(server).target.id='88888888-8888-4888-8888-888888888888';
 expect(()=>mergeUnitDraftConflict(unitFields(draft),draft,unitFields(draft),server,true,true)).toThrow('目标身份');
});
