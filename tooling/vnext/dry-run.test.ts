import {test} from 'vitest';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {planApplyUnits,planDeclaredGraph,explainTargetImpact,aliasReferenceBlockers,type PlanNode} from '../../apps/governance-api/src/modules/governance-catalog/dry-run-rules.js';

test('PR9 P2: matching field names cannot make parameter or foreign-dataset references into local aliases',()=>{
 assert.deepEqual(aliasReferenceBlockers('PER01',[{field:'parent',target:'GOV09.config_id',status:'DECLARED_PARAMETER',parameterVersionId:'fixture',parameterDigest:'a'.repeat(64)}],['parent']),['INCOMPATIBLE_ALIAS_TARGET']);
 assert.deepEqual(aliasReferenceBlockers('PER01',[{field:'parent',target:'ORG01.org_id',status:'BLOCKED_DEPENDENCY'}],['parent']),['INCOMPATIBLE_ALIAS_TARGET']);
 assert.deepEqual(aliasReferenceBlockers('PER01',[{field:'parent',target:'PER01.person_id',status:'BLOCKED_DEPENDENCY'}],['parent']),[]);
});

test('PR9 R2: a scalar reference field can occur only once per command',()=>{
 assert.deepEqual(aliasReferenceBlockers('PER01',[{field:'parent',target:'PER01.person_id',status:'BLOCKED_DEPENDENCY'}],['parent','parent']),['AMBIGUOUS_ALIAS_FIELD']);
 const ambiguous=planDeclaredGraph('PER01',[{field:'parent',target:'PER01.person_id',status:'BLOCKED_DEPENDENCY'}],[{row:1,intent:'CREATE',dependencies:[]},{row:2,intent:'CREATE',dependencies:[]},{row:3,intent:'CREATE',dependencies:[{field:'parent',alias:{kind:'JOB_ALIAS',row:1}},{field:'parent',alias:{kind:'JOB_ALIAS',row:2}}]}],3);
 assert.equal(ambiguous.status,'BLOCKED');assert.deepEqual(ambiguous.units,[]);
 const separateCommands=planDeclaredGraph('PER01',[{field:'parent',target:'PER01.person_id',status:'BLOCKED_DEPENDENCY'}],[{row:1,intent:'CREATE',dependencies:[]},{row:2,intent:'CREATE',dependencies:[{field:'parent',alias:{kind:'JOB_ALIAS',row:1}}]},{row:3,intent:'CREATE',dependencies:[{field:'parent',alias:{kind:'JOB_ALIAS',row:2}}]}],3);
 assert.equal(separateCommands.status,'PLANNED');assert.deepEqual(separateCommands.order,[1,2,3]);
});

test('PR9 R2: bounded adversarial graph does not block the event loop for seconds',()=>{
 const nodes=Array.from({length:1000},(_,index):PlanNode=>({row:index+1,intent:'CREATE',dependencies:index<100?Array.from({length:index},(_,n)=>n+1):[...Array.from({length:99},(_,n)=>n+1),index]}));
 const started=performance.now();const result=planApplyUnits(nodes);const duration=performance.now()-started;
 console.info(JSON.stringify({gate:'P0_07_GRAPH_LIMIT',nodes:nodes.length,milliseconds:Math.round(duration)}));
 assert.equal(result.status,'PLANNED');assert.equal(result.order.length,1000);
 assert.ok(duration<1000,`planning took ${Math.round(duration)}ms for the bounded graph`);
});

test('P0-07-AC-01 and AC-02: local aliases topologically preview without permanent IDs',()=>{
 const nodes:PlanNode[]=[{row:3,intent:'CREATE',dependencies:[2]},{row:1,intent:'CREATE',dependencies:[]},{row:2,intent:'CREATE',dependencies:[1]}];
 const original=structuredClone(nodes);
 const plan=planApplyUnits(nodes);
 assert.deepEqual(plan.order,[1,2,3]);
 assert.deepEqual(plan.units,[{unit:1,rows:[1],dependsOn:[]},{unit:2,rows:[2],dependsOn:[1]},{unit:3,rows:[3],dependsOn:[2]}]);
 assert.deepEqual(nodes,original);
 assert.ok(!JSON.stringify(plan).includes('personId'));
});
test('undeclared cycles discard even the acyclic prefix; ambiguous and missing aliases fail',()=>{
 const cycle=planApplyUnits([{row:1,intent:'CREATE',dependencies:[]},{row:2,intent:'CREATE',dependencies:[3]},{row:3,intent:'CREATE',dependencies:[2]}]);
 assert.deepEqual(cycle.order,[]);assert.deepEqual(cycle.units,[]);assert.ok(cycle.blockers.includes('UNDECLARED_BUNDLE_CYCLE'));
 assert.ok(planApplyUnits([{row:1,intent:'CREATE',dependencies:[]},{row:1,intent:'CREATE',dependencies:[]}]).blockers.includes('AMBIGUOUS_ALIAS'));
 assert.ok(planApplyUnits([{row:1,intent:'CREATE',dependencies:[2]}]).blockers.includes('UNKNOWN_ALIAS'));
 const target={dataset:'PER01',id:'one-person',expectedVersion:'1'};
 const ambiguous=planApplyUnits([{row:1,intent:'REVISE',dependencies:[],target},{row:2,intent:'CLOSE',dependencies:[],target}]);
 assert.ok(ambiguous.blockers.includes('AMBIGUOUS_TARGET'));assert.deepEqual(ambiguous.units,[]);
});
test('P0-07-AC-03: expected version drift is STALE, absent Owner is NOT_EVALUABLE',()=>{
 const node:PlanNode={row:1,intent:'REVISE',dependencies:[],target:{dataset:'PER01',id:'known-person',expectedVersion:'9007199254740993'}};
 const original=structuredClone(node);
 assert.deepEqual(explainTargetImpact(node,[{dataset:'PER01',id:'known-person',version:'9007199254740994',affectedRelationshipCount:3}]),{currentTargetVersion:'9007199254740994',targetStatus:'STALE',affectedRelationshipCount:3});
 assert.deepEqual(explainTargetImpact(node,[{dataset:'ORG01',id:'known-person',version:'9007199254740993',affectedRelationshipCount:7}]),{currentTargetVersion:null,targetStatus:'NOT_EVALUABLE',affectedRelationshipCount:null});
 assert.deepEqual(node,original);
});
test('topological units obey all edges independently of declaration order',()=>{
 for(let length=2;length<=12;length++){
  const nodes=Array.from({length},(_,index):PlanNode=>({row:index+1,intent:'CREATE',dependencies:Array.from({length:index},(_,parent)=>parent+1)})).reverse();
  const result=planApplyUnits(nodes);
  assert.equal(result.status,'PLANNED');assert.equal(new Set(result.order).size,length);
  for(const node of nodes)for(const dependency of node.dependencies)assert.ok(result.order.indexOf(dependency)<result.order.indexOf(node.row));
 }
});
test('all non-create intents require explicit typed targets; CREATE cannot preallocate identity',()=>{
 for(const intent of ['REVISE','CORRECT','CLOSE','SPLIT','MERGE','TRANSFER'] as const){
  assert.ok(planApplyUnits([{row:1,intent,dependencies:[]}]).blockers.includes('EXPLICIT_TARGET_REQUIRED'));
  const plan=planApplyUnits([{row:1,intent,dependencies:[],target:{dataset:'PER01',id:'existing',expectedVersion:'1'}}]);
  if(['SPLIT','MERGE','TRANSFER'].includes(intent)){assert.ok(plan.blockers.includes('BUSINESS_BUNDLE_REQUIRED'));assert.deepEqual(plan.units,[]);}
  else assert.equal(plan.status,'PLANNED');
 }
 assert.ok(planApplyUnits([{row:1,intent:'CREATE',dependencies:[],target:{dataset:'PER01',id:'allocated',expectedVersion:'1'}}]).blockers.includes('CREATE_TARGET_FORBIDDEN'));
});
