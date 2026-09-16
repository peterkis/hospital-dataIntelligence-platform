import {test} from 'vitest';
import assert from 'node:assert/strict';
import {buildQualityIssueCandidates} from '../../apps/governance-api/src/modules/governance-catalog/quality-candidates.js';
import type {ValidationEvaluation} from '../../apps/governance-api/src/modules/governance-catalog/validation-rules.js';

test('P0-06 candidate classification keeps PASS out, merges manual evidence, and creates only the L6 job blocker',()=>{
 const evaluation:ValidationEvaluation={
  decision:'FAIL',
  issues:[
   {rule:'LENGTH',layer:2,row:1,field:'name',status:'FAIL',code:'VALUE_TOO_LONG'},
   {rule:'SRC-COND-001',layer:2,row:1,field:'name',status:'NOT_EVALUATED',code:'BLOCKED_DEPENDENCY'},
   {rule:'TYPE',layer:2,row:1,field:'name',status:'PASS',code:'TYPE_VALID'},
  ],
  layers:[...Array.from({length:6},(_,layer)=>({layer,status:layer===5?'PASS':'PASS' as const})),{layer:6,status:'NOT_EVALUATED'},...([7] as const).map(layer=>({layer,status:'PASS' as const})),{layer:8,status:'NOT_RUN'},{layer:9,status:'NOT_RUN'},{layer:10,status:'NOT_RUN'}],
  evidenceRequirements:[{rule:'SRC-COND-001',requirementId:'REQ-001',row:1,field:'name',status:'BLOCKED_DEPENDENCY',details:{evidenceOwner:'院办',requiredEvidence:'证据',sourceDataset:'ORG01',sourceField:'name',sourceText:'bounded',sourceVersion:'P0_05_SOURCE_V1',inputs:['name'],dispositionReason:'bounded',whenTrue:'ALLOW',whenFalse:'BLOCK',whenUnknown:'BLOCK'}}],
  dependencies:[],interpretationPolicy:'EXACT_TEXT_V1',executionCoverage:{version:'RULE_EXECUTION_V1',checks:[]},duplicates:[{row:2,duplicateOf:1}],deduplicationPolicy:'DECLARED_KEY_V2',
 };
 const candidates=buildQualityIssueCandidates(evaluation);
 assert.equal(candidates.some(candidate=>candidate.rule==='TYPE'),false);
 const manual=candidates.find(candidate=>candidate.rule==='SRC-COND-001')!;
 assert.equal(manual.requirementId,'REQ-001');assert.equal(manual.classification,'BLOCKED_DEPENDENCY');assert.equal(manual.ownerRef,'院办');
 assert.equal(candidates.filter(candidate=>candidate.sourceKind==='LAYER'&&candidate.rule==='L6').length,1);
 assert.equal(candidates.some(candidate=>candidate.rule==='L8'||candidate.rule==='L9'||candidate.rule==='L10'),false);
 assert.equal(candidates.some(candidate=>candidate.boundedCode==='VALUE_TOO_LONG'&&candidate.classification==='ERROR'),true);
});
