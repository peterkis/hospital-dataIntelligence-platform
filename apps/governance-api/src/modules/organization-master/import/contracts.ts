import {Type,type Static} from 'typebox';
import {Id,Time} from '../contracts.js';
import {Division} from '../campus/contracts.js';
import {CatalogRef,LicenseRef,ScopeRef} from '../operating/contracts.js';
const closed={additionalProperties:false} as const;
const Text=Type.String({minLength:1,maxLength:2000,pattern:'\\S'});
const Version=Type.String({pattern:'^[1-9][0-9]*$'});
export const Dataset=Type.Enum(['ORG01','ORG02','ORG03']);
export const BundleReference=Type.Union([
 Type.Object({kind:Type.Literal('JOB_ALIAS'),dataset:Dataset,alias:Type.String({minLength:1,maxLength:64})},closed),
 Type.Object({kind:Type.Literal('PLATFORM_REF'),dataset:Dataset,id:Id,expectedVersion:Version},closed),
]);
const Target=Type.Object({owner:Type.Enum(['organization-master','organization-master/campus','organization-master/operating-relation']),id:Id,expectedVersion:Version},closed);
const Base={row:Type.Integer({minimum:2,maximum:1001}),intent:Type.Enum(['CREATE','REVISE']),target:Type.Optional(Target),governanceScope:Type.Enum(['NORTH','SOUTH']),sourceVersionId:Id};
const Registration=Type.Object({creditCodeStatus:Type.Enum(['HELD','NOT_APPLICABLE']),evidence:Id},closed);
const License=Type.Object({intent:Type.Enum(['CREATE','REVISE']),target:Type.Optional(LicenseRef),namespace:Text,authority:Text,evidence:Id,endKind:Type.Enum(['FINITE','VERIFIED_UNBOUNDED','UNKNOWN'])},closed);
export const BundleRow=Type.Union([
 Type.Object({...Base,dataset:Type.Literal('ORG01'),creditNamespace:Type.Optional(Text),institutionNamespace:Type.Optional(Text),license:Type.Optional(License),registration:Type.Optional(Registration)},closed),
 Type.Object({...Base,dataset:Type.Literal('ORG02'),nodeKind:Type.Literal('PHYSICAL'),evidence:Id,adminDivision:Type.Union([Division,Type.Null()])},closed),
 Type.Object({...Base,dataset:Type.Literal('ORG03'),subject:BundleReference,campus:BundleReference,role:Type.Enum(['OPERATOR','REGISTRANT','MANAGER','BILLING','OTHER']),catalog:CatalogRef,services:Type.Array(Text,{maxItems:100,uniqueItems:true}),scopes:Type.Array(Type.Union([
  Type.Object({kind:Type.Literal('EXISTING_SCOPE'),reference:ScopeRef},closed),
  Type.Object({kind:Type.Literal('VERIFY_SCOPE'),license:Type.Union([LicenseRef,Type.Object({kind:Type.Literal('ROW_LICENSE'),subject:BundleReference},closed)]),evidence:Id,validFrom:Time,validTo:Type.Union([Time,Type.Null()]),services:Type.Array(Text,{minItems:1,maxItems:100,uniqueItems:true})},closed),
 ]),{maxItems:100})},closed),
]);
export const BundleManifest=Type.Object({policy:Type.Literal('ORG_BUNDLE_V1'),rows:Type.Array(BundleRow,{minItems:1,maxItems:1000})},closed);
export const BundleContract=Type.Object({dataset:Dataset,contractId:Id,contractVersionId:Id},closed);
export const ReceiveOrganizationBundleSchema=Type.Object({
 requestId:Id,job:Type.Union([Type.Object({action:Type.Literal('CREATE')},closed),Type.Object({action:Type.Literal('REVISE'),jobId:Id,expectedCurrentRevision:Id},closed)]),
 campus:Type.Enum(['NORTH','SOUTH']),retentionSeconds:Type.Integer({minimum:60,maximum:3600}),
 contracts:Type.Array(BundleContract,{minItems:3,maxItems:3}),manifest:BundleManifest,
},closed);
export const BundleRevisionSchema=Type.Object({jobId:Id,revisionId:Id},closed);
export const BundlePlanSchema=Type.Object({...BundleRevisionSchema.properties,requestId:Id},closed);
export const BundlePreauthorizeSchema=Type.Object({...BundlePlanSchema.properties,grants:Type.Array(Type.Object({row:Type.Integer({minimum:2,maximum:1001}),actor:Text,permissions:Type.Array(Type.Enum(['READ','CREATE','REVISE','REVIEW']),{minItems:1,maxItems:4,uniqueItems:true}),allowed:Type.Optional(Type.Boolean())},closed),{minItems:1,maxItems:100})},closed);
export const BundleLegalSchema=Type.Object({...BundlePlanSchema.properties,digest:Type.String({pattern:'^[a-f0-9]{64}$'})},closed);
export type BundlePreauthorizeInput=Static<typeof BundlePreauthorizeSchema>;
export type BundleLegalInput=Static<typeof BundleLegalSchema>;
export type BundleManifestValue=Static<typeof BundleManifest>;
export type BundleRowValue=Static<typeof BundleRow>;
export type BundleReferenceValue=Static<typeof BundleReference>;
export type ReceiveOrganizationBundleInput=Static<typeof ReceiveOrganizationBundleSchema>;
export type BundleRevisionInput=Static<typeof BundleRevisionSchema>;
