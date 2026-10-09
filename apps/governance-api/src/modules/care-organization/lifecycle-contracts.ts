import {Type,type Static} from 'typebox';
import type {ApplyOwnerPort,ObservedOwnerUnit,CatalogTransactionScope} from '../governance-catalog/index.js';
import {UnitTime} from './contracts.js';
import type {ScopeRevisionProjection} from './ward-nursing-contracts.js';
const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'}),Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
export const LifecycleOwnerSchema=Type.Union([Type.Literal('UNIT'),Type.Literal('NURSING'),Type.Literal('WARD'),Type.Literal('UNIT_WARD'),Type.Literal('WARD_NURSING'),Type.Literal('CAPABILITY'),Type.Literal('PERMISSION'),Type.Literal('LOCATION'),Type.Literal('LOCATION_USE')]);
export type LifecycleOwner=Static<typeof LifecycleOwnerSchema>;
export const LifecycleMemberSchema=Type.Object({owner:LifecycleOwnerSchema,inputId:Id,revisionId:Id,digest:Digest,contractVersionId:Id},{additionalProperties:false});
export const LifecycleStageSchema=Type.Object({requestId:Id,campus:Type.Union([Type.Literal('NORTH'),Type.Literal('SOUTH')]),policy:Type.Literal('TEST_POLICY_ONLY'),kind:Type.Union([Type.Literal('MOVE'),Type.Literal('CLOSE'),Type.Literal('RESUME'),Type.Literal('HANDOVER'),Type.Literal('REPARTITION')]),cutover:UnitTime,reason:Type.String({minLength:1,maxLength:2000}),members:Type.Array(LifecycleMemberSchema,{minItems:1,maxItems:100})},{additionalProperties:false});
export const LifecycleInputSchema=Type.Object({inputId:Id},{additionalProperties:false});
export const LifecycleHistorySchema=Type.Object({inputId:Id,businessAt:Type.Optional(UnitTime),recordAsOf:Type.Optional(UnitTime)},{additionalProperties:false});
export const LifecyclePlanSchema=Type.Object({inputId:Id,requestId:Id},{additionalProperties:false});
export const LifecycleVerifySchema=Type.Object({inputId:Id,inputDigest:Digest,requestId:Id,reason:Type.String({minLength:1,maxLength:2000}),policy:Type.Literal('TEST_POLICY_ONLY')},{additionalProperties:false});
export type LifecycleStage=Static<typeof LifecycleStageSchema>;
export type LifecycleVerification=Static<typeof LifecycleVerifySchema>;
export const LifecycleTargetSchema=Type.Object({kind:Type.Enum(['UNIT','NURSING','WARD','LOCATION']),id:Id},{additionalProperties:false});
export const LifecycleAssessmentSchema=Type.Object({target:LifecycleTargetSchema,validFrom:UnitTime,validTo:Type.Union([UnitTime,Type.Null()]),recordAsOf:Type.Optional(UnitTime)},{additionalProperties:false});
export type LifecycleAssessment=Static<typeof LifecycleAssessmentSchema>;
export interface LifecycleDependencyInput {kind:'UNIT'|'NURSING'|'WARD'|'LOCATION';id:string;validFrom:string;validTo:string|null;recordAsOf:string}
export interface LifecycleDependency {owner:LifecycleOwner;id:string;head:string;referenceId:string;referenceVersionId:string;from:string;to:string|null;campusId:string;disposition:'OPEN'}
export interface LifecycleReference {inputId:string;revisionId:string;digest:string;contractVersionId:string;makerIdentity:string;campus:'NORTH'|'SOUTH'}
/** Composition-only finite ports; no SQL names, caller fields, or public registry. */
export interface LifecycleMemberPort {
 lifecyclePort:ApplyOwnerPort;
 lifecycleWithInputsInTransaction?<T>(scope:CatalogTransactionScope,work:()=>Promise<T>):Promise<T>;
 lifecycleRegisterInputsInTransaction?(scope:CatalogTransactionScope,reference:LifecycleReference,unit:ObservedOwnerUnit):void;
 lifecycleReferenceInTransaction(scope:CatalogTransactionScope,actor:string,inputId:string):Promise<LifecycleReference>;
 lifecycleScopeProjectionInTransaction?(scope:CatalogTransactionScope,actor:string,inputId:string):Promise<ScopeRevisionProjection|null>;
 lifecycleStateInTransaction?(scope:CatalogTransactionScope,actor:string,input:{id:string;businessAt?:string;recordAsOf?:string}):Promise<{id:string;state:string;head:string}>;
 lifecycleApplyAtInTransaction?(scope:CatalogTransactionScope,actor:string,command:Parameters<ApplyOwnerPort['apply']>[2],resolved:Parameters<ApplyOwnerPort['apply']>[3],approval:Parameters<ApplyOwnerPort['apply']>[4],recordAt:string):ReturnType<ApplyOwnerPort['apply']>;
 readLifecycleDependenciesInTransaction?(scope:CatalogTransactionScope,actor:string,input:LifecycleDependencyInput):Promise<LifecycleDependency[]>;
}
export type LifecyclePorts=Partial<Record<LifecycleOwner,LifecycleMemberPort>>;
