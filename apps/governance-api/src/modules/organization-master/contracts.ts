import {Type,type Static} from 'typebox';
const closed={additionalProperties:false} as const;
export const Id=Type.String({pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'});
const Text=Type.String({minLength:1,maxLength:2000});
export const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
const Boundary=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?)?$'});
const MaybeText=Type.Union([Text,Type.Null()]);
export const Reference=Type.Object({id:Id,version:Type.String({pattern:'^[1-9][0-9]*$'})},closed);
const Period={validFrom:Time,validTo:Type.Union([Time,Type.Null()])};
const Source=Type.Object({systemId:Id,versionId:Id,alias:Type.String({minLength:1,maxLength:64}),versionNo:Type.Integer({minimum:1}),recordLocator:Text,recordedAt:Time,recordStatus:Type.Union([Type.Literal('DRAFT'),Type.Literal('PUBLISHED')]),approvalRef:MaybeText},closed);
const Facts=Type.Object({legalName:Type.String({minLength:1,maxLength:160}),entityNature:Text,authority:MaybeText,legalAddress:MaybeText,registrationEvidence:Id},closed);
const Identifier=Type.Object({kind:Type.Union([Type.Literal('UNIFIED_CREDIT_CODE'),Type.Literal('INSTITUTION_CODE')]),namespace:Type.String({pattern:'^[A-Z][A-Z0-9_]{0,63}$'}),value:Text},closed);
const License=Type.Object({namespace:Type.String({pattern:'^[A-Z][A-Z0-9_]{0,63}$'}),number:Text,authority:Text,evidence:Id,validFrom:Boundary,validTo:Type.Union([Boundary,Type.Null()]),endKind:Type.Union([Type.Literal('FINITE'),Type.Literal('VERIFIED_UNBOUNDED'),Type.Literal('UNKNOWN')])},closed);
const Common={source:Source,...Period};
export const OrganizationCommandSchema=Type.Union([
 Type.Object({...Common,action:Type.Literal('CREATE'),facts:Facts,identifiers:Type.Array(Identifier,{maxItems:2})},closed),
 Type.Object({...Common,action:Type.Literal('REVISE'),target:Reference,facts:Facts,identifiers:Type.Array(Identifier,{maxItems:2})},closed),
 Type.Object({...Common,action:Type.Literal('ADD_LICENSE'),target:Reference,license:License},closed),
 Type.Object({...Common,action:Type.Literal('REVISE_LICENSE'),target:Reference,licenseTarget:Reference,license:License},closed),
 Type.Object({...Common,action:Type.Literal('VERIFY_REGISTRATION'),target:Reference,licenseTargets:Type.Array(Reference,{minItems:1,maxItems:20}),creditCodeStatus:Type.Union([Type.Literal('HELD'),Type.Literal('NOT_APPLICABLE')]),evidence:Id},closed),
 Type.Object({...Common,action:Type.Literal('REVOKE_LICENSE'),target:Reference,licenseTarget:Reference,reason:Type.String({pattern:'^[A-Z_]{1,64}$'})},closed),
]);
export const StageSchema=Type.Object({requestId:Id,jobId:Id,revisionId:Id,campus:Type.Union([Type.Literal('NORTH'),Type.Literal('SOUTH')]),purpose:Type.Literal('IDENTITY_VERIFY'),profile:Type.Optional(Type.Union([Type.Literal('CORE'),Type.Literal('FULL')])),dependencies:Type.Optional(Type.Array(Type.Object({kind:Type.Union([Type.Literal('CAMPUS_OPERATION'),Type.Literal('CLINICAL_PERMISSION')]),id:Id},closed),{maxItems:20})),command:OrganizationCommandSchema},closed);
export const InputSchema=Type.Object({inputId:Id,requestId:Id},closed);
export const ReadSchema=Type.Object({id:Type.Optional(Id),mode:Type.Union([Type.Literal('LIST'),Type.Literal('HISTORY'),Type.Literal('EFFECTIVE'),Type.Literal('EXACT')]),businessAt:Type.Optional(Time),asOf:Type.Optional(Time),version:Type.Optional(Type.String({pattern:'^[1-9][0-9]*$'})),afterVersion:Type.Optional(Type.String({pattern:'^[0-9]+$'})),limit:Type.Optional(Type.Integer({minimum:1,maximum:100})),after:Type.Optional(Id)},closed);
export const QualificationSchema=Type.Object({id:Id,...Period,asOf:Type.Optional(Time)},closed);
export const LicenseReadSchema=Type.Object({id:Id,licenseId:Type.Optional(Id),mode:Type.Union([Type.Literal('HISTORY'),Type.Literal('EFFECTIVE'),Type.Literal('EXACT')]),version:Type.Optional(Type.String({pattern:'^[1-9][0-9]*$'})),businessAt:Type.Optional(Time),asOf:Type.Optional(Time)},closed);
export type OrganizationCommand=Static<typeof OrganizationCommandSchema>;
export type StageInput=Static<typeof StageSchema>;
export type OrganizationRead=Static<typeof ReadSchema>;
export interface OrganizationFact {id:string;version:string;versionId:string;legalName:string;entityNature:string;authority:string|null;legalAddress:string|null;validFrom:string;validTo:string|null;recordedAt:string}
