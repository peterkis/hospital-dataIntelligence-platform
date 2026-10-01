import {test,expect} from 'vitest';
import {ORG23_FIELDS,validateORG23} from '../../apps/governance-api/src/modules/department-master/index.js';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/index.js';

test('ORG23 preserves text codes and all 16 source fields without silent normalization',()=>{
 const row={org_identifier_id:'source-row',target_type:'ORG',target_id:'00000000-0000-0000-0000-000000000001',identifier_kind:'HOSPITAL_CODE',identifier_system:'SYNTHETIC_DEPARTMENT_CODE',identifier_value:'0012',language:'',is_preferred:'N',version_no:'9',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:'00000000-0000-0000-0000-000000000002',source_record_id:'file/ORG23/2',approval_ref:'DEMO',recorded_at:'2026-01-02T00:00:00'};
 expect(ORG23_FIELDS).toHaveLength(16);expect(validateORG23(row)).toEqual(row);
 expect(()=>validateORG23({...row,identifier_value:' 0012'})).toThrow('CLOSED_INPUT_REQUIRED');
 expect(()=>validateORG23({...row,identifier_value:12})).toThrow('CLOSED_INPUT_REQUIRED');
});
test('ORG23 requires its independent CORE adapter and never downgrades FULL',()=>{
 expect(selectImportAdapter({dataset:'ORG23',profile:'CORE',contractVersion:1,templateVersion:'ORG23_CORE_V1',parserPolicy:'STRICT_ORGANIZATION_IDENTIFIER_V1'})).toMatchObject({capability:'READY',owner:'department-master'});
 expect(selectImportAdapter({dataset:'ORG23',profile:'FULL',contractVersion:1,templateVersion:'ORG23_CORE_V1',parserPolicy:'STRICT_ORGANIZATION_IDENTIFIER_V1'}).capability).toBe('NOT_READY');
});
