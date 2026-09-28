import {test,expect} from 'vitest';
import {MAX_EXPECTED_VERSION,normalizeEntry,validateORG04} from '../../apps/governance-api/src/modules/department-master/vnext/contracts.js';
import {DEPARTMENT_ACCESS,DEPARTMENT_FUNCTIONS} from './department-provisioning.mjs';

const validEntry={
 intent:'REVISE' as const,
 target:{owner:'department-master' as const,id:'00000000-0000-4000-8000-000000000001',expectedVersion:String(MAX_EXPECTED_VERSION)},
 origin:'NEW' as const,evidenceId:'00000000-0000-4000-8000-000000000002',sourceRow:1,
 row:{org_id:'00000000-0000-4000-8000-000000000003',org_code:'DEMO_BOUNDARY',org_name:'DEMO boundary',org_short_name:'',org_type:'CLINICAL',established_on:'2026-01-01',abolished_on:'',establishment_doc:'DEMO_DOC',description:'DEMO',is_virtual:'N' as const,version_no:'1',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE' as const,source_system_id:'00000000-0000-4000-8000-000000000004',source_record_id:'DEMO/BOUNDARY',approval_ref:'DEMO_APPROVAL',recorded_at:'2026-01-02T00:00:00'},
};

test('closed ORG04 input rejects campus and parent instead of dropping fields',()=>{
 expect(()=>validateORG04({campus:'NORTH',parent:'ROOT'})).toThrow('CLOSED_INPUT_REQUIRED');
});
test('revision expectedVersion leaves one bigint value for the SQL matcher increment',()=>{
 expect(normalizeEntry(validEntry,'LOCAL').target?.expectedVersion).toBe(String(MAX_EXPECTED_VERSION));
 expect(()=>normalizeEntry({...validEntry,target:{...validEntry.target,expectedVersion:'9223372036854775807'}},'LOCAL')).toThrow('CLOSED_INPUT_REQUIRED');
});
test('Department startup requirements mirror the controlled deployment surface',()=>{
 expect(DEPARTMENT_FUNCTIONS).toHaveLength(9);
 expect(DEPARTMENT_FUNCTIONS).toContain('input_read(text,uuid,text)');
 expect(DEPARTMENT_FUNCTIONS).toContain('committed_row(text,uuid,integer,text,uuid,bigint,text,timestamp,timestamp,jsonb)');
 expect(DEPARTMENT_ACCESS).toHaveLength(10);
 expect(DEPARTMENT_ACCESS).toContainEqual(['reviewer','HOSPITAL','REVIEW']);
 expect(DEPARTMENT_ACCESS).toContainEqual(['reviewer','HOSPITAL','VERIFY']);
});
