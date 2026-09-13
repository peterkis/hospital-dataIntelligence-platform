import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contractRetirement,updateContractCodeSet} from '../../apps/admin-web/src/vnext/contract-editor-state.js';
import type {VNextImportContract} from '../../packages/generated-api-client/src/vnext-client.js';

test('retirement uses the overall stream head with the accepted publication digest',()=>{
 assert.deepEqual(contractRetirement([{head:'3',status:'PUBLISHED',reviewDigest:'published'},{head:'4',status:'DRAFT',reviewDigest:'draft'}]),{expectedHead:'4',reviewDigest:'published'});
 assert.equal(contractRetirement([{head:'5',status:'RETIRED',reviewDigest:'retired'}]),null);
});
test('moving a code set moves its enum without mutating the persisted definition',()=>{
 const definition:VNextImportContract['definition']={ruleVersion:'R1',templateVersion:'T1',sourceVersionId:null,fields:[{code:'a',type:'text',privacy:'INTERNAL',required:'O',condition:'OPTIONAL',enumValues:['A']},{code:'b',type:'text',privacy:'INTERNAL',required:'O',condition:'OPTIONAL',enumValues:[]}],codeSets:[{field:'a',codeSystem:'SYNTHETIC_CODES',version:'V1',status:'CANDIDATE',codes:['A'],sourceVersionId:'source',validFrom:'2026-01-01T00:00:00',validTo:null}],rules:[],references:[]};
 const moved=updateContractCodeSet(definition,0,{field:'b'});
 assert.deepEqual(moved.fields.map(field=>field.enumValues),[[],['A']]);
 assert.deepEqual(definition.fields.map(field=>field.enumValues),[['A'],[]]);
 assert.equal(moved.codeSets[0]?.field,'b');
 assert.deepEqual(updateContractCodeSet(moved,0,{codes:['B']}).fields[1]?.enumValues,['B']);
});
