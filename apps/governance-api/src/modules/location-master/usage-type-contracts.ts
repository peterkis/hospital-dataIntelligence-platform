import {Type,type Static} from 'typebox';
export const UseClosed={additionalProperties:false} as const;
export const UseId=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
export const UseTime=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const UseEnd=Type.Union([UseTime,Type.Null()]),UseHead=Type.String({pattern:'^[1-9][0-9]{0,18}$'}),UseDigest=Type.String({pattern:'^[a-f0-9]{64}$'}),UseText=Type.String({minLength:1,maxLength:2000,pattern:'\\S'});
const Body={code:Type.String({pattern:'^[A-Z][A-Z0-9_]{0,63}$'}),name:UseText,meaning:UseText,description:Type.Union([Type.String({maxLength:2000}),Type.Null()]),validFrom:UseTime,validTo:UseEnd,sourceId:UseId,sourceVersionId:UseId,evidenceId:UseId};
const Common={requestId:UseId,reason:UseText},Target={target:UseId,expectedHead:UseHead};
export const UsageTypeCommandSchema=Type.Union([
 Type.Object({...Common,...Body,action:Type.Literal('CREATE')},UseClosed),
 Type.Object({...Common,...Body,...Target,action:Type.Literal('REVISE')},UseClosed),
 Type.Object({...Common,...Target,action:Type.Literal('VERIFY'),versionId:UseId,reviewDigest:UseDigest,evidenceId:UseId,meaningAccepted:Type.Boolean()},UseClosed),
 Type.Object({...Common,...Target,action:Type.Literal('APPROVE'),versionId:UseId,reviewDigest:UseDigest},UseClosed),
 Type.Object({...Common,...Target,action:Type.Enum(['ENABLE','DISABLE'])},UseClosed),
]);
export type UsageTypeCommand=Static<typeof UsageTypeCommandSchema>;
export const UsageTypeReadSchema=Type.Object({id:UseId,versionId:Type.Optional(UseId),businessAt:Type.Optional(UseTime),recordAsOf:Type.Optional(UseTime)},UseClosed);
export const UsageTypeListSchema=Type.Object({after:Type.Optional(UseId),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(UseTime),recordAsOf:Type.Optional(UseTime)},UseClosed);
export const UsageTypeEventSchema=Type.Object({id:UseId,sequence:UseHead,action:Type.Enum(['ENABLE','DISABLE']),actor:Type.String(),identity:Type.String(),recordedAt:UseTime,reason:UseText,requestId:UseId},UseClosed);
export const UsageTypeItemSchema=Type.Object({...Body,id:UseId,versionId:UseId,version:UseHead,head:UseHead,status:Type.Enum(['DRAFT','REVIEW','APPROVED']),enabled:Type.Boolean(),applicableAtBusinessTime:Type.Union([Type.Boolean(),Type.Null()]),reviewDigest:UseDigest,recordedAt:UseTime,approvedAt:Type.Union([UseTime,Type.Null()]),verification:Type.Union([Type.Object({id:UseId,actor:Type.String(),identity:Type.String(),evidenceId:UseId,meaningAccepted:Type.Boolean(),recordedAt:UseTime},UseClosed),Type.Null()]),events:Type.Array(UsageTypeEventSchema)},UseClosed);
export type UsageTypeItem=Static<typeof UsageTypeItemSchema>;
export const UsageTypeReferenceSchema=Type.Object({owner:Type.Literal('location-master/usage-type'),id:UseId,versionId:UseId,version:UseHead},UseClosed);
export type UsageTypeReference=Static<typeof UsageTypeReferenceSchema>;
export const UsageTypePermissionsSchema=Type.Object({read:Type.Boolean(),write:Type.Boolean(),verify:Type.Boolean(),review:Type.Boolean(),human:Type.Boolean()},UseClosed);
export type UsageTypePermissions=Static<typeof UsageTypePermissionsSchema>;
export const UsageTypeMaterialReadSchema=Type.Object({id:UseId,sourceVersionId:UseId},UseClosed);
export const UsageTypeMaterialSchema=Type.Object({id:UseId,bytesBase64:Type.String()},UseClosed);
export interface UsageTypeWindow {id:string;versionId:string;version:string;code:string;meaning:string;parts:Array<{from:string;to:string|null;versionId:string;version:string}>}
