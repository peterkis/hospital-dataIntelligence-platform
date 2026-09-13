import {Type,type Static} from 'typebox';
const Id=Type.String({format:'uuid'});const Token=Type.String({pattern:'^[A-Z0-9_.-]{1,64}$'});
const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});const End=Type.Union([Time,Type.Null()]);
const Scope=Type.Union([Type.Literal('BASELINE'),Type.Literal('SYNTHETIC')]);
export const ParameterDefinitionSchema=Type.Object({kind:Type.Literal('VALUE_SCHEMA_V1'),valueType:Type.Union([Type.Literal('TEXT'),Type.Literal('INTEGER'),Type.Literal('DECIMAL'),Type.Literal('BOOLEAN')]),enumValues:Type.Array(Type.String({minLength:1,maxLength:256}),{maxItems:128,uniqueItems:true}),description:Type.String({minLength:1,maxLength:2000})},{additionalProperties:false});
const Base={scope:Scope,requestId:Id,reason:Type.String({pattern:'^[A-Z0-9_]{1,64}$'})};
const Revision={systemVersionId:Id,group:Token,campus:Type.Literal('SYNTHETIC_ALL'),definition:ParameterDefinitionSchema,validFrom:Time,validTo:End};
export const ParameterCommandSchema=Type.Union([
 Type.Object({...Base,...Revision,action:Type.Literal('CREATE'),parameterKey:Token},{additionalProperties:false}),
 Type.Object({...Base,...Revision,action:Type.Literal('REVISE'),target:Id,expectedCurrentVersion:Id},{additionalProperties:false}),
 Type.Object({...Base,action:Type.Literal('APPROVE'),target:Id,versionId:Id,reviewDigest:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false}),
]);
export const ParameterOutcomeSchema=Type.Object({id:Id,versionId:Id,version:Type.Integer(),status:Type.Union([Type.Literal('DRAFT'),Type.Literal('APPROVED')]),reviewDigest:Type.String(),recordedAt:Time,runtimeReadiness:Type.Literal('NOT_READY')},{additionalProperties:false});
export const ParameterItemSchema=Type.Object({...ParameterOutcomeSchema.properties,systemVersionId:Id,systemObjectId:Id,parameterKey:Token,group:Token,campus:Type.Literal('SYNTHETIC_ALL'),purpose:Type.Literal('GOV09_METADATA'),ownerRole:Type.String(),definition:ParameterDefinitionSchema,validFrom:Time,validTo:End},{additionalProperties:false});
export type ParameterItem=Static<typeof ParameterItemSchema>;
export type ParameterOutcome=Static<typeof ParameterOutcomeSchema>;
