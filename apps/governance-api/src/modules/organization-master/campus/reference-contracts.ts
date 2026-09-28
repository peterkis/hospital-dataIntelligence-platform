import {Type,type Static} from 'typebox';
import {Id,Time,Facts} from './contracts.js';
const closed={additionalProperties:false} as const;
const VersionNo=Type.String({pattern:'^[1-9][0-9]*$'});
export const CampusStableReferenceSchema=Type.Object({owner:Type.Literal('organization-master/campus'),id:Id},closed);
export const CampusPinnedReferenceSchema=Type.Object({...CampusStableReferenceSchema.properties,version:VersionNo,versionId:Id},closed);
export const CampusResolveSchema=Type.Object({references:Type.Array(CampusStableReferenceSchema,{maxItems:100}),businessAt:Type.Optional(Time),asOf:Type.Optional(Time)},closed);
export type CampusStableReference=Static<typeof CampusStableReferenceSchema>;
export type CampusResolveInput=Static<typeof CampusResolveSchema>;
export const CampusReferenceVersionSchema=CampusPinnedReferenceSchema;
export const CampusReferenceItemSchema=Type.Object({id:Id,reference:CampusStableReferenceSchema,head:Type.String(),facts:Type.Union([Facts,Type.Null()]),profileVersion:Type.Union([CampusReferenceVersionSchema,Type.Null()]),operationStatus:Type.Enum(['PLANNING','TRIAL_RUNNING','RUNNING','SUSPENDED','RETIRED','NOT_ESTABLISHED']),plannedOpeningAt:Type.Union([Time,Type.Null()]),operatingPermission:Type.Literal('NOT_EVALUABLE')},closed);
export const CampusResolveResultSchema=Type.Object({observedAt:Time,businessAt:Time,asOf:Time,items:Type.Array(CampusReferenceItemSchema)},closed);

export const CampusPinSchema=Type.Object({references:Type.Array(CampusPinnedReferenceSchema,{maxItems:100}),asOf:Type.Optional(Time)},closed);
export type CampusPinInput=Static<typeof CampusPinSchema>;
export const CampusPinItemSchema=Type.Object({reference:CampusReferenceVersionSchema,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),recordedAt:Time,facts:Facts},closed);
export const CampusPinResultSchema=Type.Object({observedAt:Time,asOf:Time,items:Type.Array(CampusPinItemSchema)},closed);

export const CampusCoverageSchema=Type.Object({references:Type.Array(CampusStableReferenceSchema,{maxItems:100}),validFrom:Time,validTo:Type.Union([Time,Type.Null()]),asOf:Type.Optional(Time)},closed);
export type CampusCoverageInput=Static<typeof CampusCoverageSchema>;
const Span=Type.Object({from:Time,to:Type.Union([Time,Type.Null()])},closed);
export const CampusCoverageResultSchema=Type.Object({observedAt:Time,asOf:Time,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),items:Type.Array(Type.Object({reference:CampusStableReferenceSchema,coverage:Type.Enum(['COVERED','NOT_COVERED']),segments:Type.Array(Type.Object({...Span.properties,profileVersion:CampusReferenceVersionSchema},closed)),gaps:Type.Array(Span),operatingPermission:Type.Literal('NOT_EVALUABLE')},closed))},closed);
