/** Finite plan rules. Inputs here are internal observations, never permission evidence. */
export type ChangeIntent='CREATE'|'REVISE'|'CORRECT'|'CLOSE'|'SPLIT'|'MERGE'|'TRANSFER';
export interface PlanNode {
 row:number;
 intent:ChangeIntent;
 dependencies:number[];
 target?:{dataset:string;id:string;expectedVersion:string};
}
export interface ApplyUnitPlan {unit:number;rows:number[];dependsOn:number[]}
export interface AliasGraph {status:'PLANNED'|'BLOCKED';order:number[];units:ApplyUnitPlan[];blockers:string[]}

/** No business bundles are declared by the current contracts. A cycle has no executable prefix. */
export function planApplyUnits(nodes:readonly PlanNode[]):AliasGraph {
 const byRow=new Map<number,PlanNode>();
 const targets=new Set<string>();
 const blockers=new Set<string>();
 for(const node of nodes){
  if(byRow.has(node.row))blockers.add('AMBIGUOUS_ALIAS');
  byRow.set(node.row,node);
  if(node.intent==='CREATE'&&node.target)blockers.add('CREATE_TARGET_FORBIDDEN');
  if(node.intent!=='CREATE'&&!node.target)blockers.add('EXPLICIT_TARGET_REQUIRED');
  if(['SPLIT','MERGE','TRANSFER'].includes(node.intent))blockers.add('BUSINESS_BUNDLE_REQUIRED');
  if(node.target){
   const identity=JSON.stringify([node.target.dataset,node.target.id]);
   if(targets.has(identity))blockers.add('AMBIGUOUS_TARGET');
   targets.add(identity);
  }
 }
 for(const node of nodes)for(const dependency of node.dependencies)if(!byRow.has(dependency))blockers.add('UNKNOWN_ALIAS');
 if(blockers.size)return {status:'BLOCKED',order:[],units:[],blockers:[...blockers].sort()};
 const remaining=new Set(byRow.keys());const order:number[]=[];
 while(remaining.size){
  const ready=[...remaining].filter(row=>byRow.get(row)!.dependencies.every(dep=>order.includes(dep))).sort((a,b)=>a-b);
  if(!ready.length){blockers.add('UNDECLARED_BUNDLE_CYCLE');break;}
  for(const row of ready){remaining.delete(row);order.push(row);}
 }
 if(blockers.size)return {status:'BLOCKED',order:[],units:[],blockers:[...blockers].sort()};
 const positions=new Map(order.map((row,index)=>[row,index+1]));
 return {status:'PLANNED',order,units:order.map(row=>({unit:positions.get(row)!,rows:[row],dependsOn:[...new Set(byRow.get(row)!.dependencies.map(dep=>positions.get(dep)!))].sort((a,b)=>a-b)})),blockers:[]};
}

export function expectedVersionStatus(expected:string,current:string|null):'CURRENT'|'STALE'|'NOT_EVALUABLE' {
 return current===null?'NOT_EVALUABLE':expected===current?'CURRENT':'STALE';
}

export interface TargetObservation {dataset:string;id:string;version:string;affectedRelationshipCount:number}
/** An internal Owner observation is separate from the caller's expected version. */
export function explainTargetImpact(node:PlanNode,observations:readonly TargetObservation[]){
 const matches=node.target?observations.filter(item=>item.dataset===node.target!.dataset&&item.id===node.target!.id):[];
 const current=matches.length===1?matches[0]!:null;
 return {currentTargetVersion:current?.version??null,targetStatus:expectedVersionStatus(node.target?.expectedVersion??'1',current?.version??null),affectedRelationshipCount:current?.affectedRelationshipCount??null};
}
