import {Type,type Static} from 'typebox';
export interface DepartmentUnitBindingInput {department:{owner:'department-master';id:string};campus:{owner:'organization-master/campus';id:string};subject:{owner:'organization-master';id:string};relation:{owner:'department-master/campus-relation';id:string;version:string;versionId:string};services:string[];validFrom:string;validTo:string|null;recordAsOf?:string}
import {Id,check} from './contracts.js';
import {EvolutionImpactSchema,EvolutionVerifySchema} from './organization-evolution-contracts.js';
const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export {check as lifecycleCheck};
const closed={additionalProperties:false} as const;
const Text=Type.String({minLength:1,maxLength:2000}),Version=Type.String({pattern:'^[1-9][0-9]*$'});
export const DepartmentLifecycleTargetSchema=Type.Object({owner:Type.Literal('department-master'),id:Id,expectedVersion:Version,expectedLifecycleHead:Type.String({pattern:'^[0-9]+$'})},closed);
const Endpoint=Type.Object({campus:Type.Object({owner:Type.Literal('organization-master/campus'),id:Id},closed),subject:Type.Object({owner:Type.Literal('organization-master'),id:Id},closed)},closed);
const RelationTarget=Type.Object({owner:Type.Literal('department-master/campus-relation'),id:Id,expectedVersion:Version},closed);
const Services=Type.Array(Type.String({minLength:1,maxLength:64}),{minItems:1,maxItems:100,uniqueItems:true});
const common={department:DepartmentLifecycleTargetSchema,reason:Text,evidenceId:Id};
export const DepartmentLifecycleCommandSchema=Type.Union([
 Type.Object({...common,action:Type.Enum(['SUSPEND','RESUME','DEPRECATE']),effectiveAt:Time},closed),
 Type.Object({...common,...Endpoint.properties,action:Type.Literal('ASSIGN'),services:Services,validFrom:Time,validTo:Type.Union([Time,Type.Null()])},closed),
 Type.Object({...common,action:Type.Enum(['REVISE','END']),relation:RelationTarget,services:Services,validFrom:Time,validTo:Type.Union([Time,Type.Null()])},closed),
 Type.Object({...common,action:Type.Literal('MOVE'),relation:RelationTarget,destination:Endpoint,services:Services,effectiveAt:Time},closed),
]);
export const DepartmentLifecycleStageSchema=Type.Object({requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),profile:Type.Enum(['CORE','FULL']),commands:Type.Array(DepartmentLifecycleCommandSchema,{minItems:1,maxItems:100}),impacts:Type.Array(EvolutionImpactSchema,{minItems:13,maxItems:13})},closed);
export const DepartmentLifecycleStoredStageSchema=Type.Object({...DepartmentLifecycleStageSchema.properties,impacts:Type.Array(EvolutionImpactSchema,{minItems:9,maxItems:13})},closed);
export type DepartmentLifecycleCommand=Static<typeof DepartmentLifecycleCommandSchema>;
export type DepartmentLifecycleStageInput=Static<typeof DepartmentLifecycleStageSchema>;
export const DepartmentLifecycleVerifySchema=Type.Object({requestId:Id,inputId:Id,inputDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),reason:Text,policyApproved:Type.Boolean(),materialsAccepted:Type.Boolean(),impactReviews:EvolutionVerifySchema.properties.impactReviews},closed);
export const DepartmentLifecycleStoredVerifySchema=Type.Object({...DepartmentLifecycleVerifySchema.properties,impactReviews:Type.Array(EvolutionVerifySchema.properties.impactReviews.items,{minItems:9,maxItems:13})},closed);
export type DepartmentLifecycleVerifyInput=Static<typeof DepartmentLifecycleVerifySchema>;
export const DepartmentAdmissionSchema=Type.Object({id:Id,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordAsOf:Type.Optional(Time)},closed);
export type DepartmentAdmissionInput=Static<typeof DepartmentAdmissionSchema>;
export const DepartmentLifecycleReadSchema=Type.Object({id:Id,businessAt:Time,recordAsOf:Type.Optional(Time)},closed);
export const DepartmentLifecycleHistorySchema=Type.Object({id:Id,recordAsOf:Type.Optional(Time)},closed);
export const DepartmentLifecycleInputSchema=Type.Object({inputId:Id},closed);
export const DepartmentLifecyclePlanSchema=Type.Object({inputId:Id,requestId:Id},closed);
export const DepartmentRelationListSchema=Type.Object({...DepartmentLifecycleReadSchema.properties,campusId:Type.Optional(Id),afterId:Type.Optional(Id),limit:Type.Integer({minimum:1,maximum:100})},closed);
export const DepartmentRelationDiffSchema=Type.Object({departmentId:Id,relationId:Id,fromVersion:Version,toVersion:Version},closed);
