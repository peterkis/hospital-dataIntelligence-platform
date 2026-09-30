import {test,expect} from 'vitest';
import {OrganizationMappingStageSchema,ORG22_FIELDS,validateORG22} from '../../apps/governance-api/src/modules/department-master/index.js';
import {Check} from 'typebox/value';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/index.js';

test('ORG22 retains all source fields and requires an exact nonempty context',()=>{
 const row={org_map_id:'SOURCE_ROW',from_system_id:'00000000-0000-0000-0000-000000000001',source_entity_type:'DEPARTMENT',source_code:'001',source_name:'Old name',source_context:'DEFAULT',target_type:'ORG',target_id:'00000000-0000-0000-0000-000000000002',mapping_relation:'EXACT',resolution_rule:'',verified_by:'DEMO_OWNER',version_no:'9',valid_from:'2026-01-01T00:00:00',valid_to:'',record_status:'ACTIVE',source_system_id:'00000000-0000-0000-0000-000000000001',source_record_id:'file/ORG22/2',approval_ref:'DEMO',recorded_at:'2026-01-02T00:00:00'};
 expect(ORG22_FIELDS).toHaveLength(19);
 expect(validateORG22(row)).toEqual(row);
 expect(()=>validateORG22({...row,source_context:''})).toThrow('CLOSED_INPUT_REQUIRED');
 expect(()=>validateORG22({...row,source_code:' 001'})).toThrow('CLOSED_INPUT_REQUIRED');
 expect(Check(OrganizationMappingStageSchema,{requestId:row.target_id,jobId:row.target_id,revisionId:row.target_id,campus:'NORTH',profile:'CORE',entries:[{action:'REGISTER',mapping:null,reason:'DEMO',evidenceId:row.target_id,row}]})).toBe(true);
});
test('ORG22 requires its explicit CORE parser contract and never downgrades FULL',()=>{
 expect(selectImportAdapter({dataset:'ORG22',profile:'CORE',contractVersion:1,templateVersion:'ORG22_CORE_V1',parserPolicy:'STRICT_ORGANIZATION_MAPPING_V1'})).toMatchObject({capability:'READY',owner:'department-master',allowedIntents:['REGISTER','CORRECT','RETRACT']});
 expect(selectImportAdapter({dataset:'ORG22',profile:'FULL',contractVersion:1,templateVersion:'ORG22_CORE_V1',parserPolicy:'STRICT_ORGANIZATION_MAPPING_V1'}).capability).toBe('NOT_READY');
});
