/** Finite plan rules. Inputs here are internal observations, never permission evidence. */
import type {ImportContractDefinition} from './contract-schema.js';

export function aliasReferenceBlockers(dataset:string,references:ImportContractDefinition['references'],fields:readonly string[]):string[]{
 const blockers=new Set<string>();
 if(new Set(fields).size!==fields.length)blockers.add('AMBIGUOUS_ALIAS_FIELD');
 for(const field of fields){
  const matches=references.filter(reference=>reference.field===field);
  if(matches.length!==1){blockers.add('UNDECLARED_RELATION');continue;}
  const reference=matches[0]!;
  const [targetDataset,targetField,...extra]=reference.target.split('.');
  if(reference.status!=='BLOCKED_DEPENDENCY'||targetDataset!==dataset||!targetField||extra.length)blockers.add('INCOMPATIBLE_ALIAS_TARGET');
 }
 return [...blockers].sort();
}
export type ChangeIntent='CREATE'|'REVISE'|'CORRECT'|'CLOSE'|'SPLIT'|'MERGE'|'TRANSFER';
export interface PlanNode {
 row:number;
 intent:ChangeIntent;
 dependencies:number[];
 target?:{dataset:string;id:string;expectedVersion:string};
}
export interface ApplyUnitPlan {unit:number;rows:number[];dependsOn:number[]}
export interface AliasGraph {status:'PLANNED'|'BLOCKED';order:number[];units:ApplyUnitPlan[];blockers:string[]}

interface DeclaredPlanCommand extends Omit<PlanNode,'dependencies'> {
 dependencies:ReadonlyArray<{field:string;alias:{kind:'JOB_ALIAS';row:number}}>;
}
/** All graph validity checks consume verified row availability and declared typed references. */
export function planDeclaredGraph(dataset:string,references:ImportContractDefinition['references'],commands:readonly DeclaredPlanCommand[],parsedRowCount:number):AliasGraph{
 const graph=planApplyUnits(commands.map(command=>({...command,dependencies:command.dependencies.map(dependency=>dependency.alias.row)})));
 const blockers=new Set(graph.blockers);
 for(const command of commands){
  if(command.row>parsedRowCount||command.row<1)blockers.add('ROW_REFERENCE_INVALID');
  if(command.target&&command.target.dataset!==dataset)blockers.add('TARGET_DATASET_MISMATCH');
  for(const code of aliasReferenceBlockers(dataset,references,command.dependencies.map(dependency=>dependency.field)))blockers.add(code);
 }
 return blockers.size?{status:'BLOCKED',order:[],units:[],blockers:[...blockers].sort()}:graph;
}

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
 // Sort once for deterministic ties, then visit each node/unique edge once.
 const rows=[...byRow.keys()].sort((a,b)=>a-b);
 const indegree=new Map<number,number>();const dependents=new Map<number,number[]>();
 for(const row of rows){
  const dependencies=new Set(byRow.get(row)!.dependencies);indegree.set(row,dependencies.size);
  for(const dependency of dependencies){const next=dependents.get(dependency)??[];next.push(row);dependents.set(dependency,next);}
 }
 const order=rows.filter(row=>indegree.get(row)===0);
 for(let cursor=0;cursor<order.length;cursor++){
  for(const dependent of dependents.get(order[cursor]!)??[]){
   const remaining=indegree.get(dependent)!-1;indegree.set(dependent,remaining);
   if(remaining===0)order.push(dependent);
  }
 }
 if(order.length!==byRow.size)blockers.add('UNDECLARED_BUNDLE_CYCLE');
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
