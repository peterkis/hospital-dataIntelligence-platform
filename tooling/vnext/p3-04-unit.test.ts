import {expect,test} from 'vitest';
import {selectImportAdapter} from '../../apps/governance-api/src/modules/governance-catalog/import-adapter.js';

test('the independently adopted ORG10 CORE selects the care-organization relation owner',()=>{
 expect(selectImportAdapter({dataset:'ORG10',profile:'CORE',contractVersion:1,templateVersion:'ORG10_CORE_V1',parserPolicy:'STRICT_UNIT_WARD_V1'})).toMatchObject({owner:'care-organization',capability:'READY',allowedIntents:['CREATE','REVISE','END']});
});
