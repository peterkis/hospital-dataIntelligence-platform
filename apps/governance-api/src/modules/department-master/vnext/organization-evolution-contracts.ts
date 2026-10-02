import {Type,type Static} from 'typebox';
import {Id,ReferenceSchema,EntrySchema} from './contracts.js';
import {ImportJobCommandSchema} from '../../governance-catalog/index.js';

const closed={additionalProperties:false} as const;
const text=(maxLength=2000)=>Type.String({maxLength});
const required=(maxLength=2000)=>Type.String({minLength:1,maxLength,pattern:'\\S'});
export const EvolutionEventRowSchema=Type.Object({
 org_event_id:required(64),change_type:required(64),effective_at:required(40),
 decision_ref:required(256),reason:required(),historical_reporting_rule:required(),
 migration_plan_ref:text(256),recorded_at:required(40),
},closed);
export const EvolutionRelationRowSchema=Type.Object({
 succession_id:required(64),org_event_id:required(64),from_target_type:text(64),from_target_id:text(64),
 to_target_type:text(64),to_target_id:text(64),transfer_scope:required(),context_rule:text(),recorded_at:required(40),
},closed);
export type ORG26Row=Static<typeof EvolutionEventRowSchema>;
export type ORG27Row=Static<typeof EvolutionRelationRowSchema>;
export const ORG26_FIELDS=Object.keys(EvolutionEventRowSchema.properties) as Array<keyof ORG26Row>;
export const ORG27_FIELDS=Object.keys(EvolutionRelationRowSchema.properties) as Array<keyof ORG27Row>;
const LEGACY_EVOLUTION_IMPACT_DOMAINS=['PERSONNEL','PATIENT','ACCOUNT','INVENTORY','FINANCE','SOURCE_MAPPING','HIERARCHY','CONSUMER'] as const;
export const EVOLUTION_IMPACT_DOMAINS=[...LEGACY_EVOLUTION_IMPACT_DOMAINS,'IDENTIFIER'] as const;
export const EvolutionImpactSchema=Type.Object({
 domain:Type.Enum(EVOLUTION_IMPACT_DOMAINS),determination:Type.Enum(['AFFECTED','UNAFFECTED','UNKNOWN']),
 ownerRole:required(160),ownerSignatory:required(160),ownerDecisionRef:required(256),requiredAction:text(),reason:required(),evidenceId:Id,
},closed);
const CompanionContracts=Type.Object({successionContractId:Id,successionContractVersionId:Id,departmentContractId:Id,departmentContractVersionId:Id},closed);
const fields={
 requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),
 event:EvolutionEventRowSchema,relations:Type.Array(EvolutionRelationRowSchema,{minItems:1,maxItems:100}),
 predecessors:Type.Array(ReferenceSchema,{minItems:1,maxItems:100}),
 successors:Type.Array(EntrySchema,{maxItems:100}),
 rename:Type.Union([Type.Object({name:required(160),shortName:text(160)},closed),Type.Null()]),
 contracts:CompanionContracts,sourceSystemId:Id,decisionEvidenceId:Id,
 migrationEvidenceId:Type.Union([Id,Type.Null()]),contextEvidenceId:Type.Union([Id,Type.Null()]),
 impacts:Type.Array(EvolutionImpactSchema,{minItems:9,maxItems:9}),
};
export const EvolutionStageSchema=Type.Object(fields,closed);
export const EvolutionStoredStageSchema=Type.Object({...fields,
 impacts:Type.Union([fields.impacts,Type.Array(Type.Object({...EvolutionImpactSchema.properties,domain:Type.Enum(LEGACY_EVOLUTION_IMPACT_DOMAINS)},closed),{minItems:8,maxItems:8})]),
 sourceArtifactId:Type.Optional(Id),
 sourceRows:Type.Object({event:Type.Integer({minimum:1,maximum:1048576}),relations:Type.Array(Type.Integer({minimum:1,maximum:1048576}),{maxItems:100}),successors:Type.Array(Type.Integer({minimum:1,maximum:1048576}),{maxItems:100})},closed),
},closed);
export type EvolutionStageInput=Static<typeof EvolutionStageSchema>;
export type EvolutionStoredStageInput=Static<typeof EvolutionStoredStageSchema>;
export const EvolutionReceiveSchema=Type.Object({
 ...Type.Omit(EvolutionStageSchema,['requestId','jobId','revisionId','profile','event','relations','successors']).properties,
 requestId:Id,fileRequestId:Id,job:ImportJobCommandSchema,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),
 successors:Type.Array(Type.Omit(EntrySchema,['row']),{maxItems:100}),
},closed);
export type EvolutionReceiveInput=Static<typeof EvolutionReceiveSchema>;
export const EvolutionTemplateSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),contractId:Id,contractVersionId:Id,contracts:CompanionContracts},closed);
export type EvolutionTemplateInput=Static<typeof EvolutionTemplateSchema>;
export const EvolutionVerifySchema=Type.Object({impactAssessment:Type.Optional(Type.Object({id:Id,digest:Type.String({pattern:'^[a-f0-9]{64}$'})},closed)),requestId:Id,inputId:Id,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),reason:required(),policyApproved:Type.Boolean(),materialsAccepted:Type.Boolean(),impactReviews:Type.Array(Type.Object({domain:Type.Enum(EVOLUTION_IMPACT_DOMAINS),ownerAttestationAccepted:Type.Boolean(),dispositionAccepted:Type.Boolean(),reason:required()},closed),{minItems:9,maxItems:9})},closed);
export const EvolutionStoredVerifySchema=Type.Object({...EvolutionVerifySchema.properties,
 impactReviews:Type.Union([EvolutionVerifySchema.properties.impactReviews,Type.Array(Type.Object({...EvolutionVerifySchema.properties.impactReviews.items.properties,domain:Type.Enum(LEGACY_EVOLUTION_IMPACT_DOMAINS)},closed),{minItems:8,maxItems:8})]),
},closed);
export type EvolutionVerifyInput=Static<typeof EvolutionVerifySchema>;

export interface SuccessionEdge {from:string;to:string;scope:string;context:string}
export interface SuccessionGraphInput {changeType:string;predecessors:string[];successors:string[];edges:SuccessionEdge[];acceptedEdges?:Array<{from:string;to:string}>}
export interface EvolutionIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED';sheet?:string}

/** Count the actual domain writes hidden behind one whole-event Owner command. */
export function evolutionExpandedWriteCount(input:Pick<EvolutionStoredStageInput,'event'|'successors'|'relations'|'predecessors'>):number{
 return 1+input.successors.length*4+input.relations.length+(input.event.change_type==='RENAME'?1:input.predecessors.length);
}

/** Same-identity labels are event evidence and never identity succession edges. */
export function validateSuccessionGraph(input:SuccessionGraphInput):{edges:SuccessionEdge[];issues:EvolutionIssue[]}{
 if(input.changeType==='RENAME'&&input.predecessors.length===1&&input.successors.length===1&&input.predecessors[0]===input.successors[0]&&input.edges.length===1&&input.edges[0]!.from===input.predecessors[0]&&input.edges[0]!.to===input.successors[0])return {edges:[],issues:[]};
 if(input.changeType==='RENAME')return {edges:[],issues:[{row:0,field:'relations',code:'SUCCESSION_SHAPE',status:'FAIL'}]};
 const issues:EvolutionIssue[]=[];
 const fail=(field:string,code:string,row=0)=>issues.push({row,field,code,status:'FAIL'});
 if(input.changeType!=='SPLIT'&&input.changeType!=='MERGE')return {edges:[],issues:[{row:0,field:'change_type',code:'BLOCKED_DEPENDENCY',status:'BLOCKED'}]};
 const predecessors=new Set(input.predecessors),successors=new Set(input.successors);
 if(predecessors.size!==input.predecessors.length||successors.size!==input.successors.length||[...predecessors].some(id=>successors.has(id)))fail('target_id','BATCH_CONFLICT');
 if(input.changeType==='SPLIT'?(predecessors.size!==1||successors.size<2||input.edges.length!==successors.size):(predecessors.size<2||successors.size!==1||input.edges.length!==predecessors.size))fail('relations','SUCCESSION_SHAPE');
 const pairs=new Set<string>();
 for(const [index,edge] of input.edges.entries()){
  if(!predecessors.has(edge.from)||!successors.has(edge.to))fail('target_id','BLOCKED_DEPENDENCY',index+1);
  if(edge.from===edge.to)fail('target_id','SUCCESSION_SELF',index+1);
  const key=JSON.stringify([edge.from,edge.to]);if(pairs.has(key))fail('target_id','BATCH_CONFLICT',index+1);pairs.add(key);
  if(!edge.scope.trim()||input.changeType==='SPLIT'&&!edge.context.trim())fail('context_rule','CONTEXT_REQUIRED',index+1);
 }
 if([...successors].some(id=>!input.edges.some(e=>e.to===id)))fail('relations','SUCCESSION_SHAPE');
 if([...predecessors].some(id=>!input.edges.some(e=>e.from===id)))fail('relations','SUCCESSION_SHAPE');
 const adjacency=new Map<string,string[]>();for(const edge of [...(input.acceptedEdges??[]),...input.edges])adjacency.set(edge.from,[...(adjacency.get(edge.from)??[]),edge.to]);
 const visiting=new Set<string>(),visited=new Set<string>();
 const cycle=(id:string):boolean=>{if(visiting.has(id))return true;if(visited.has(id))return false;visiting.add(id);for(const next of adjacency.get(id)??[])if(cycle(next))return true;visiting.delete(id);visited.add(id);return false;};
 if([...adjacency.keys()].some(cycle))fail('relations','SUCCESSION_CYCLE');
 return {edges:issues.length?[]:structuredClone(input.edges),issues};
}
