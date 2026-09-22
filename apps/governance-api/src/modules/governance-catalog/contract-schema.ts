import { Type, type Static } from 'typebox';

const values = <T extends string>(...items:T[]) => Type.Enum(items);
const Id=Type.String({format:'uuid'});
const Token=Type.String({pattern:'^[A-Z0-9_.-]{1,64}$'});
const Time=Type.String({pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?$'});
export const ContractTimeSchema=Time;
const End=Type.Union([Time,Type.Null()]);
export const ContractScopeSchema=values('BASELINE','SYNTHETIC');
export const ContractFieldSchema=Type.Object({code:Type.String(),type:values('id','text','date','datetime','integer','decimal','code'),required:values('R','C','O'),privacy:values('INTERNAL','RESTRICTED','HIGH_RESTRICTED'),condition:values('ALWAYS','OPTIONAL','UNRESOLVED','MANUAL_EVIDENCE','EVALUATED'),enumValues:Type.Array(Type.String({minLength:1,maxLength:256}),{uniqueItems:true})},{additionalProperties:false});
export const ContractDefinitionSchema=Type.Object({
  ruleVersion:Token,templateVersion:Token,sourceVersionId:Type.Union([Id,Type.Null()]),fields:Type.Array(ContractFieldSchema,{minItems:1,maxItems:100}),
  businessKey:Type.Optional(Type.Array(Type.String({minLength:1,maxLength:256}),{minItems:1,maxItems:8,uniqueItems:true})),
  codeSets:Type.Array(Type.Object({field:Type.String(),codeSystem:Token,version:Token,status:values('CANDIDATE','SYNTHETIC_ADOPTED'),codes:Type.Array(Type.String({minLength:1,maxLength:256}),{minItems:1,uniqueItems:true}),validFrom:Time,validTo:End,sourceVersionId:Id},{additionalProperties:false})),
  rules:Type.Array(Type.Object({id:Token,field:Type.String(),text:Type.String({minLength:1,maxLength:2000}),status:values('UNRESOLVED','MACHINE','MANUAL_EVIDENCE'),version:Token},{additionalProperties:false}),{maxItems:100}),
  references:Type.Array(Type.Union([
    Type.Object({field:Type.Literal('is_primary_operator'),target:Type.Literal('enum:yes_no'),status:Type.Literal('ADOPTED_CODESET')},{additionalProperties:false}),
    Type.Object({field:Type.String(),target:Type.String(),status:Type.Literal('BLOCKED_DEPENDENCY')},{additionalProperties:false}),
    Type.Object({field:Type.String(),target:Type.Literal('GOV09.config_id'),status:Type.Literal('DECLARED_PARAMETER'),parameterVersionId:Id,parameterDigest:Type.String({pattern:'^[a-f0-9]{64}$'})},{additionalProperties:false}),
  ])),
},{additionalProperties:false});
const Base={scope:ContractScopeSchema,requestId:Id,reason:Type.String({pattern:'^[A-Z0-9_]{1,64}$'})};
const Target={target:Id,expectedHead:Type.String({pattern:'^[0-9]+$'})};
const ContractWriteDefinitionSchema=Type.Object({...ContractDefinitionSchema.properties,businessKey:Type.Array(Type.String({minLength:1,maxLength:256}),{minItems:1,maxItems:8,uniqueItems:true})},{additionalProperties:false});
const Revision={definition:ContractWriteDefinitionSchema,validFrom:Time,validTo:End};
export const ContractCommandSchema=Type.Union([
  Type.Object({...Base,...Revision,action:Type.Literal('CREATE'),datasetVersionId:Id,profile:values('CORE','FULL')},{additionalProperties:false}),
  Type.Object({...Base,...Target,...Revision,action:Type.Literal('REVISE'),datasetVersionId:Type.Optional(Id)},{additionalProperties:false}),
  Type.Object({...Base,...Target,action:Type.Literal('VALIDATE'),reviewDigest:Type.Optional(Type.String())},{additionalProperties:false}),
  Type.Object({...Base,...Target,action:values('APPROVE','PUBLISH','RETIRE'),reviewDigest:Type.String({pattern:'^[a-f0-9]{64}$'}),impactDigest:Type.Optional(Type.String({pattern:'^[a-f0-9]{64}$'}))},{additionalProperties:false}),
]);
const Identity={id:Id,versionId:Id,version:Type.Integer(),datasetVersionId:Id,head:Type.String(),status:values('DRAFT','APPROVED','PUBLISHED','RETIRED'),recordedAt:Time,reviewDigest:Type.String(),adapterReadiness:Type.Literal('NOT_READY')};
export const ContractOutcomeSchema=Type.Object({...Identity,decision:values('ACCEPT','REVIEW'),blockers:Type.Array(Type.String())},{additionalProperties:false});
export const ContractItemSchema=Type.Object({...Identity,dataset:Type.String(),profile:values('CORE','FULL'),definition:ContractDefinitionSchema,schemas:Type.Record(Type.String(),Type.Unknown()),semanticsDigest:Type.String(),validFrom:Time,validTo:End,sourceDraftDigest:Type.String(),sourcePolicies:Type.Object({format:Type.Record(Type.String(),Type.Unknown()),time:Type.String(),identity:Type.String(),apply:Type.Record(Type.String(),Type.Unknown())})},{additionalProperties:false});
export type ImportContractDefinition=Static<typeof ContractDefinitionSchema>;
export type ImportContractCommand=Static<typeof ContractCommandSchema>;
export type ImportContractOutcome=Static<typeof ContractOutcomeSchema>;
export type ImportContractItem=Static<typeof ContractItemSchema>;

export function contractInputSchemas(item:ImportContractItem) {
  return { ...item.schemas, contractVersionId:item.versionId,reviewDigest:item.reviewDigest,sourceDraftDigest:item.sourceDraftDigest,semanticsDigest:item.semanticsDigest,adapterReadiness:'NOT_READY' };
}
