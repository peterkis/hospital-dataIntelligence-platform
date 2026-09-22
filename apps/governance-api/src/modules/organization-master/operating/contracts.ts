import {Type,type Static} from 'typebox';
import {Id,Time,Source} from '../contracts.js';
const closed={additionalProperties:false} as const;
const Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'});
const Version=Type.String({pattern:'^[1-9][0-9]*$'});
export const OperatingKind=Type.Enum(['RELATION','SCOPE']);
export const SubjectRef=Type.Object({owner:Type.Literal('organization-master'),id:Id},closed);
export const CampusRef=Type.Object({owner:Type.Literal('organization-master/campus'),id:Id},closed);
export const CatalogRef=Type.Object({contractId:Id,contractVersionId:Id,codeSystem:Type.Literal('SYNTHETIC_OPERATING_SERVICE'),version:Text,sourceVersionId:Id},closed);
export const LicenseRef=Type.Object({owner:Type.Literal('organization-master/license'),id:Id,version:Version,versionId:Id},closed);
export const ScopeRef=Type.Object({owner:Type.Literal('organization-master/license-scope'),id:Id,version:Version,versionId:Id},closed);
const Services=Type.Array(Text,{maxItems:100,uniqueItems:true});
export const ScopeFacts=Type.Object({license:LicenseRef,catalog:CatalogRef,services:Services,licenseScopeText:Text},closed);
export const RelationFacts=Type.Object({role:Type.Enum(['OPERATOR','REGISTRANT','MANAGER','BILLING','OTHER']),relationTypeText:Text,primary:Type.Enum(['Y','N']),catalog:CatalogRef,services:Services,licenseScopeText:Type.Union([Text,Type.Null()]),scopeTargets:Type.Array(ScopeRef,{maxItems:100})},closed);
export const OperatingTarget=Type.Object({owner:Type.Enum(['organization-master/operating-relation','organization-master/license-scope']),id:Id,expectedVersion:Version},closed);
const SourceTime=Type.Union([Time,Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?\\+08:00$'})]);
const OperatingSource=Type.Object({...Source.properties,recordedAt:SourceTime},closed);
const Common={subject:SubjectRef,campus:CampusRef,source:OperatingSource,evidence:Type.Union([Id,Type.Null()]),validFrom:SourceTime,validTo:Type.Union([SourceTime,Type.Null()])};
export const OperatingCommandSchema=Type.Union([
 Type.Object({...Common,action:Type.Literal('VERIFY_SCOPE'),facts:ScopeFacts},closed),
 Type.Object({...Common,action:Type.Literal('REVISE_SCOPE'),target:OperatingTarget,facts:ScopeFacts},closed),
 Type.Object({...Common,action:Type.Literal('REVOKE_SCOPE'),target:OperatingTarget,reason:Text},closed),
 Type.Object({...Common,action:Type.Literal('ESTABLISH'),facts:RelationFacts},closed),
 Type.Object({...Common,action:Type.Enum(['REVISE_RELATION','REVALIDATE']),target:OperatingTarget,facts:RelationFacts},closed),
 Type.Object({...Common,action:Type.Literal('CLOSE'),target:OperatingTarget,reason:Text},closed)
]);
export const OperatingStageSchema=Type.Object({requestId:Id,jobId:Id,revisionId:Id,profile:Type.Enum(['CORE','FULL']),dependencies:Type.Optional(Type.Array(Type.Object({kind:Text,id:Id},closed),{maxItems:20})),command:OperatingCommandSchema},closed);
export type OperatingCommand=Static<typeof OperatingCommandSchema>;
export type OperatingStage=Static<typeof OperatingStageSchema>;
export type ScopeFactsValue=Static<typeof ScopeFacts>;
export type RelationFactsValue=Static<typeof RelationFacts>;
export type CatalogReference=Static<typeof CatalogRef>;
export const OperatingReadSchema=Type.Object({kind:OperatingKind,id:Type.Optional(Id),subjectId:Type.Optional(Id),campusId:Type.Optional(Id),mode:Type.Enum(['LIST','HISTORY','EXACT','EFFECTIVE']),version:Type.Optional(Version),businessAt:Type.Optional(Time),asOf:Type.Optional(Time)},closed);
export type OperatingRead=Static<typeof OperatingReadSchema>;
export const EvaluateOperatingSchema=Type.Object({subject:SubjectRef,campus:CampusRef,services:Type.Array(Text,{minItems:1,maxItems:100,uniqueItems:true}),validFrom:Time,validTo:Type.Union([Time,Type.Null()]),asOf:Type.Optional(Time)},closed);
export type EvaluateOperatingInput=Static<typeof EvaluateOperatingSchema>;
export const kindOf=(action:OperatingCommand['action'])=>['VERIFY_SCOPE','REVISE_SCOPE','REVOKE_SCOPE'].includes(action)?'SCOPE' as const:'RELATION' as const;
export const ownerOf=(kind:'RELATION'|'SCOPE')=>kind==='RELATION'?'organization-master/operating-relation' as const:'organization-master/license-scope' as const;
export const isClosing=(c:OperatingCommand)=>c.action==='CLOSE'||c.action==='REVOKE_SCOPE';
