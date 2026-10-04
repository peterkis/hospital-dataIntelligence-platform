import {Type,type Static} from 'typebox';
import {Id,Time,Source,InputSchema} from '../contracts.js';
export {Id,Time,InputSchema};
const closed={additionalProperties:false} as const;
const Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'});
export const Division=Type.Object({contractId:Id,contractVersionId:Id,codeSystem:Text,version:Text,code:Text,sourceVersionId:Id},closed);
export const Facts=Type.Object({campusCode:Type.String({minLength:1,maxLength:64,pattern:'^[^\\s]+$'}),campusName:Text,nodeRole:Type.Enum(['HEADQUARTERS','HIGH_TECH','CITY_CENTER']),nodeKind:Type.Literal('PHYSICAL'),campusAddress:Type.Union([Text,Type.Null()]),adminDivision:Type.Union([Division,Type.Null()]),publicPhone:Type.Union([Text,Type.Null()]),openingDate:Type.Union([Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}$'}),Type.Null()])},closed);
export const Target=Type.Object({owner:Type.Literal('organization-master/campus'),id:Id,expectedVersion:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
const CampusSource=Type.Object({...Source.properties,recordedAt:Type.Union([Time,Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?\\+08:00$'})])},closed);
const common={source:CampusSource,evidence:Id,sourceOperationStatus:Type.Enum(['PLANNING','TRIAL_RUNNING','RUNNING','SUSPENDED','RETIRED']),validFrom:Time,validTo:Type.Union([Time,Type.Null()])};
export const DispositionOwner=Type.Enum(['BUSINESS_UNIT','NURSING_UNIT','LOCATION','ASSIGNMENT','CONSUMPTION']);
const Digest=Type.String({pattern:'^[a-f0-9]{64}$'});
export const CampusImpactSchema=Type.Object({id:Id,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),asOf:Type.Optional(Time)},closed);
export const CampusImpactResultSchema=Type.Object({campusId:Id,campusHead:Type.String(),validFrom:Time,validTo:Type.Union([Time,Type.Null()]),dependencies:Type.Array(Type.Object({owner:Type.Enum(['RELATION','SCOPE','BUSINESS_UNIT','NURSING_UNIT']),id:Id,version:Type.String(),active:Type.Boolean(),outstanding:Type.Boolean()},closed)),unavailable:Type.Array(DispositionOwner),dispositions:Type.Array(Type.Object({eventId:Id,inputId:Id,owner:DispositionOwner,status:Type.Enum(['UNKNOWN','CLEAR']),dependencyDigest:Digest},closed)),completed:Type.Boolean(),digest:Digest,dependencyDigest:Digest},closed);
export type CampusImpact=Static<typeof CampusImpactResultSchema>;
export const CampusCommandSchema=Type.Union([
 Type.Object({...common,action:Type.Literal('CREATE'),facts:Facts},closed),
 Type.Object({...common,action:Type.Literal('REVISE'),target:Target,facts:Facts},closed),
 Type.Object({...common,action:Type.Literal('SCHEDULE_OPENING'),target:Target,plannedOpeningAt:Time},closed),
 Type.Object({...common,action:Type.Literal('CANCEL_OPENING'),target:Target,reason:Text},closed),
 Type.Object({...common,action:Type.Enum(['ACTIVATE','RESUME']),target:Target,state:Type.Enum(['TRIAL_RUNNING','RUNNING'])},closed),
 Type.Object({...common,action:Type.Literal('SUSPEND'),target:Target,reason:Text},closed),
 Type.Object({...common,action:Type.Literal('RETIRE'),target:Target,reason:Text,assessmentDigest:Digest,plan:Type.Object({responsibleOwner:Text,dueAt:Time,actions:Text},closed)},closed),
 Type.Object({...common,action:Type.Literal('RECORD_DISPOSITION'),target:Target,reason:Text,assessmentDigest:Digest,resolution:Type.Object({owner:DispositionOwner,status:Type.Enum(['UNKNOWN','CLEAR']),scope:Type.Literal('SYNTHETIC')},closed)},closed),
 Type.Object({...common,action:Type.Literal('COMPLETE_DISPOSITION'),target:Target,reason:Text,assessmentDigest:Digest},closed),
]);
export const CampusStageSchema=Type.Object({requestId:Id,jobId:Id,revisionId:Id,campus:Type.Enum(['NORTH','SOUTH']),purpose:Type.Literal('IDENTITY_VERIFY'),profile:Type.Optional(Type.Enum(['CORE','FULL'])),dependencies:Type.Optional(Type.Array(Type.Object({kind:Type.Enum(['CAMPUS_OPERATION','LOCATION']),id:Id},closed),{maxItems:20})),command:CampusCommandSchema},closed);
export type CampusCommand=Static<typeof CampusCommandSchema>;
export type CampusStage=Static<typeof CampusStageSchema>;
export type CampusFacts=Static<typeof Facts>;

export const CampusReadSchema=Type.Object({id:Id,businessAt:Type.Optional(Time),asOf:Type.Optional(Time)},closed);
export const CampusListSchema=Type.Object({after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),businessAt:Type.Optional(Time),asOf:Type.Optional(Time)},closed);
export const CampusVersionSchema=Type.Object({id:Id,version:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
export const CampusDiffSchema=Type.Object({id:Id,fromVersion:Type.String({pattern:'^[1-9][0-9]*$'}),toVersion:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
