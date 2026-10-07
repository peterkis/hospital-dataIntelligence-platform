import {Type,type Static} from 'typebox';
import {Check} from 'typebox/value';
import {ImportJobCommandSchema,type CatalogTransactionScope} from '../governance-catalog/index.js';
import {localTime} from '../organization-master/index.js';
import {parseStrictJson} from '../../platform/fastify/strict-json.js';

const closed={additionalProperties:false} as const;
export const WardNursingId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
export const WardNursingTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const WardNursingHead=Type.String({pattern:'^[1-9][0-9]{0,18}$',maxLength:19});
const End=Type.Union([WardNursingTime,Type.Null()]),Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),OptionalText=Type.Union([Type.String({maxLength:2000}),Type.Null()]),Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
const ref=<O extends string>(owner:O)=>Type.Object({owner:Type.Literal(owner),id:WardNursingId},closed);
export const CoverageScopeSchema=Type.Union([
 Type.Object({kind:Type.Literal('WHOLE_WARD')},closed),
 Type.Object({kind:Type.Literal('PARTITIONS'),scopeSetId:WardNursingId,version:WardNursingHead,partitionIds:Type.Array(WardNursingId,{minItems:1,maxItems:100,uniqueItems:true})},closed),
]);
export type CoverageScope=Static<typeof CoverageScopeSchema>;
export const WardNursingScopeSchema=Type.Object({ward:ref('care-organization/ward'),nursing:ref('care-organization/nursing'),campus:ref('organization-master/campus'),purpose:Type.Literal('NURSING_COVERAGE')},closed);
export type WardNursingScope=Static<typeof WardNursingScopeSchema>;
export const WardScopeAnchorSchema=Type.Omit(WardNursingScopeSchema,['nursing'],closed);
export type WardScopeAnchor=Static<typeof WardScopeAnchorSchema>;
export const WardNursingRuleSchema=Type.Union([
 Type.Object({kind:Type.Literal('NO_SHARING_REQUIRED')},closed),
 Type.Object({kind:Type.Literal('SHARED_BOUNDARY'),ruleReference:Text,ruleVersion:Text,evidenceId:WardNursingId,participants:Type.Array(WardNursingId,{minItems:2,maxItems:100,uniqueItems:true}),coverage:CoverageScopeSchema,validFrom:WardNursingTime,validTo:End},closed),
 Type.Object({kind:Type.Literal('UNKNOWN')},closed),
]);
export type WardNursingRule=Static<typeof WardNursingRuleSchema>;
export const WardNursingRowSchema=Type.Object({ward_nursing_rel_id:Type.String({minLength:1,maxLength:64,pattern:'\\S'}),ward_id:WardNursingId,nursing_unit_id:WardNursingId,coverage_scope:Text,is_primary:Type.Enum(['Y','N']),handover_rule_ref:OptionalText,version_no:Type.Union([Type.String({pattern:'^[1-9][0-9]{0,9}$'}),Type.Integer({minimum:1,maximum:2147483647})]),valid_from:WardNursingTime,valid_to:End,record_status:Type.Enum(['DRAFT','REVIEW','ACTIVE','SUSPENDED','RETIRED']),source_system_id:WardNursingId,source_record_id:Type.String({minLength:1,maxLength:256,pattern:'\\S'}),approval_ref:OptionalText,recorded_at:WardNursingTime},closed);
export const WardNursingDirectRowSchema=Type.Object({...WardNursingRowSchema.properties,version_no:Type.Integer({minimum:1,maximum:2147483647})},closed);
export type WardNursingRow=Static<typeof WardNursingRowSchema>;
export const ORG11_FIELDS=Object.keys(WardNursingRowSchema.properties) as Array<keyof WardNursingRow>;
export const WardNursingTargetSchema=Type.Object({owner:Type.Literal('care-organization/ward-nursing-coverage'),id:WardNursingId,expectedHead:WardNursingHead},closed);
const Common={row:WardNursingRowSchema,applicability:WardNursingScopeSchema,coverage:CoverageScopeSchema,rule:WardNursingRuleSchema,reason:Text,evidenceId:WardNursingId};
export const WardNursingEntrySchema=Type.Union([
 Type.Object({...Common,action:Type.Literal('CREATE')},closed),
 Type.Object({...Common,action:Type.Literal('REVISE'),target:WardNursingTargetSchema},closed),
 Type.Object({...Common,action:Type.Literal('END'),target:WardNursingTargetSchema,endAt:WardNursingTime},closed),
]);
export type WardNursingEntry=Static<typeof WardNursingEntrySchema>;
export const ScopeDefinitionSchema=Type.Object({sourceAlias:Type.String({minLength:1,maxLength:64}),applicability:WardScopeAnchorSchema,partitions:Type.Array(Type.Object({sourceAlias:Type.String({minLength:1,maxLength:64}),name:Text,boundary:Text},closed),{minItems:2,maxItems:100}),validFrom:WardNursingTime,validTo:End,sourceSystemId:WardNursingId,sourceRecordedAt:WardNursingTime,approvalReference:Text,evidenceId:WardNursingId,reason:Text},closed);
export type ScopeDefinition=Static<typeof ScopeDefinitionSchema>;
const StageCommon={requestId:WardNursingId,jobId:WardNursingId,revisionId:WardNursingId,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),timePolicy:Type.Literal('LOCAL')};
export const WardNursingStageSchema=Type.Union([
 Type.Object({...StageCommon,kind:Type.Literal('COVERAGE'),entries:Type.Array(WardNursingEntrySchema,{minItems:1,maxItems:100})},closed),
 Type.Object({...StageCommon,kind:Type.Literal('SCOPE_DEFINITION'),definition:ScopeDefinitionSchema},closed),
]);
export type WardNursingStage=Static<typeof WardNursingStageSchema>;
export const WardNursingDirectStageSchema=Type.Union([
 Type.Object({...StageCommon,kind:Type.Literal('COVERAGE'),entries:Type.Array(Type.Union(WardNursingEntrySchema.anyOf.map(s=>Type.Object({...s.properties,row:WardNursingDirectRowSchema},closed))),{minItems:1,maxItems:100})},closed),
 WardNursingStageSchema.anyOf[1],
]);
export const WardNursingStoredStageSchema=Type.Union(WardNursingStageSchema.anyOf.map(s=>Type.Object({...s.properties,sourceArtifactId:Type.Optional(WardNursingId),sourceRows:Type.Optional(Type.Array(Type.Integer({minimum:1,maximum:1048576}),{minItems:1,maxItems:100}))},closed)));
export type WardNursingStoredStage=WardNursingStage&{sourceArtifactId?:string;sourceRows?:number[]};
const Handover=Type.Union([
 Type.Object({kind:Type.Literal('NO_HANDOVER_REQUIRED'),confirmed:Type.Boolean()},closed),
 Type.Object({kind:Type.Literal('CONFIRMED_HANDOVER'),source:WardNursingTargetSchema,successorSourceAlias:Text,successorNursing:ref('care-organization/nursing'),coverage:CoverageScopeSchema,cutover:WardNursingTime,ruleReference:Text,ruleVersion:Text,evidenceId:WardNursingId,confirmed:Type.Boolean()},closed),
 Type.Object({kind:Type.Literal('UNKNOWN')},closed),
]);
export type NursingHandover=Static<typeof Handover>;
export const WardNursingVerifySchema=Type.Object({requestId:WardNursingId,inputId:WardNursingId,inputDigest:Digest,reason:Text,policyVersion:Type.Literal('ORG11_CORE_V1'),rows:Type.Array(Type.Object({row:Type.Integer({minimum:1,maximum:100}),evidenceId:WardNursingId,classificationAccepted:Type.Boolean(),scopeAccepted:Type.Boolean(),ruleConfirmed:Type.Boolean(),rule:WardNursingRuleSchema,coverage:CoverageScopeSchema,validFrom:WardNursingTime,validTo:End,handover:Handover},closed),{maxItems:100}),scopeDefinition:Type.Optional(Type.Object({completeAndDisjoint:Type.Boolean(),definitionDigest:Digest,evidenceId:WardNursingId},closed))},closed);
export type WardNursingVerification=Static<typeof WardNursingVerifySchema>;
export const WardNursingInputSchema=Type.Object({inputId:WardNursingId},closed);
export const WardNursingPlanSchema=Type.Object({inputId:WardNursingId,requestId:WardNursingId},closed);
export const WardNursingReadSchema=Type.Object({id:WardNursingId,businessAt:Type.Optional(WardNursingTime),recordAsOf:Type.Optional(WardNursingTime)},closed);
export const WardNursingHistorySchema=Type.Object({id:WardNursingId,recordAsOf:Type.Optional(WardNursingTime)},closed);
export const WardNursingExactSchema=Type.Object({...WardNursingHistorySchema.properties,version:WardNursingHead},closed);
export const WardNursingDiffSchema=Type.Object({id:WardNursingId,fromVersion:WardNursingHead,toVersion:WardNursingHead},closed);
export const WardNursingListSchema=Type.Object({campus:Type.Enum(['NORTH','SOUTH']),campusId:Type.Optional(WardNursingId),nursingId:Type.Optional(WardNursingId),wardId:Type.Optional(WardNursingId),after:Type.Optional(WardNursingId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(WardNursingTime),recordAsOf:Type.Optional(WardNursingTime)},closed);
export const WardNursingWindowSchema=Type.Object({applicability:Type.Object({...WardScopeAnchorSchema.properties,nursing:Type.Optional(WardNursingScopeSchema.properties.nursing)},closed),coverage:CoverageScopeSchema,validFrom:WardNursingTime,validTo:End,mode:Type.Enum(['CURRENT_ADMISSION','HISTORICAL']),recordAsOf:Type.Optional(WardNursingTime)},closed);
export type WardNursingWindow=Static<typeof WardNursingWindowSchema>;
export const WardNursingReceiveSchema=Type.Object({requestId:WardNursingId,fileRequestId:WardNursingId,job:ImportJobCommandSchema,campus:StageCommon.campus,timePolicy:StageCommon.timePolicy,retentionSeconds:Type.Integer({minimum:1,maximum:2592000}),operations:Type.Array(Type.Union([Type.Omit(WardNursingEntrySchema.anyOf[0],['row'],closed),Type.Omit(WardNursingEntrySchema.anyOf[1],['row'],closed),Type.Omit(WardNursingEntrySchema.anyOf[2],['row'],closed)]),{minItems:1,maxItems:100})},closed);
export type WardNursingReceive=Static<typeof WardNursingReceiveSchema>;
export interface ApprovedScopeSet {id:string;version:'1';scope:'NORTH'|'SOUTH';applicability:WardScopeAnchor;partitions:Array<{id:string;sourceAlias:string;name:string;boundary:string}>;validFrom:string;validTo:string|null;recordedAt:string;sourceAlias:string;verificationBasis:unknown;changeId:string}
export interface WardNursingFacts {coverageScope:CoverageScope;coverageSource:string;isPrimary:boolean;handoverRuleReference:string|null;rule:WardNursingRule;handover:NursingHandover;contractVersionId:string;verificationBasis:{id:string;version:string;digest:string};dependencies:unknown;source:{sourceAlias:string;sourceVersion:string;sourceSystemId:string;sourceRecordedAt:string;recordLocatorEvidence:{inputId:string;row:number};recordStatus:string;approvalReference:string}}
export interface WardNursingVersion {id:string;number:string;action:'CREATE'|'REVISE'|'END';validFrom:string;validTo:string|null;recordedAt:string;facts:WardNursingFacts;reason:string;changeId:string}
export interface WardNursingHistory {id:string;scope:'NORTH'|'SOUTH';applicability:WardNursingScope;versions:WardNursingVersion[]}
export interface WardNursingWrite {key:string;targetId:string|null;expectedHead:string|null;action:'CREATE'|'REVISE'|'END'|'REGISTER_SCOPE';validFrom:string;validTo:string|null;applicability:WardNursingScope|WardScopeAnchor;facts:WardNursingFacts|Record<string,unknown>;reason:string;sourceRow:number;scope:'NORTH'|'SOUTH'}
export interface WardNursingIssue {row:number;field:string;code:string;status:'FAIL'|'BLOCKED'}
export interface WardNursingUpstreamPorts {referenceAccess(s:CatalogTransactionScope,actor:string,scope:WardNursingScope|WardScopeAnchor):Promise<{scope:'NORTH'|'SOUTH'}>;boundaries(s:CatalogTransactionScope,actor:string,scope:WardNursingScope,from:string,to:string|null,r:string,rule:WardNursingRule):Promise<string[]>;admit(s:CatalogTransactionScope,actor:string,scope:WardNursingScope,from:string,to:string|null,r:string,rule:WardNursingRule):Promise<unknown>;admitWard(s:CatalogTransactionScope,actor:string,scope:WardScopeAnchor,from:string,to:string|null,r:string):Promise<unknown>}
export function wardNursingCheck(schema:unknown,value:unknown):void{if(!Check(schema as never,value))throw new Error('CLOSED_INPUT_REQUIRED');}
export function parseCoverageScope(text:string):CoverageScope {try{const value=parseStrictJson(text);wardNursingCheck(CoverageScopeSchema,value);return value as CoverageScope;}catch{throw new Error('UNKNOWN_COVERAGE_SCOPE');}}
export function normalizeWardNursingRow(value:unknown,_policy:'LOCAL'){wardNursingCheck(WardNursingRowSchema,value);const row=structuredClone(value) as WardNursingRow;if(BigInt(row.version_no)>2147483647n)throw new Error('CLOSED_INPUT_REQUIRED');const from=localTime(row.valid_from),to=row.valid_to===null?null:localTime(row.valid_to);if(to!==null&&to<=from)throw new Error('INVALID_BUSINESS_PERIOD');return {row,from,to,sourceRecordedAt:localTime(row.recorded_at),coverage:parseCoverageScope(row.coverage_scope)};}

export const WardNursingEndpointImpactSchema=Type.Object({kind:Type.Enum(['NURSING','WARD']),id:WardNursingId,validFrom:WardNursingTime,validTo:End,recordAsOf:Type.Optional(WardNursingTime)},closed);
