import {Type,type Static} from 'typebox';
import {Id} from './contracts.js';

const closed={additionalProperties:false} as const;
const Text=Type.String({maxLength:2000});
export const ImpactTargetSchema=Type.Union([
 Type.Object({kind:Type.Literal('INPUT'),id:Id},closed),
 Type.Object({kind:Type.Literal('EVENT'),id:Id,campus:Type.Enum(['NORTH','SOUTH'])},closed),
]);
export const AssessDepartmentChangeSchema=Type.Object({requestId:Id,reason:Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),target:ImpactTargetSchema},closed);
export type ImpactTarget=Static<typeof ImpactTargetSchema>;
export type AssessDepartmentChangeInput=Static<typeof AssessDepartmentChangeSchema>;
export const ImpactSpanSchema=Type.Object({from:Text,to:Type.Union([Text,Type.Null()])},closed);
export type ImpactSpan=Static<typeof ImpactSpanSchema>;
export const ImpactReferenceSchema=Type.Object({
 owner:Type.Enum(['SOURCE_MAPPING','IDENTIFIER','HIERARCHY']),id:Id,versionId:Id,version:Text,
 referenceRole:Type.Enum(['TARGET','NODE','OWNER']),sourceSystemIds:Type.Array(Id),
 departmentId:Id,departmentVersionId:Type.Union([Id,Type.Null()]),
 acceptedVersions:Type.Array(Type.Object({versionId:Id,version:Text,from:Text,to:Type.Union([Text,Type.Null()])},closed)),
 originalPeriod:ImpactSpanSchema,originalDigest:Text,frozenLabel:Type.Union([Text,Type.Null()]),
 currentVersionId:Id,currentPeriod:ImpactSpanSchema,currentAction:Text,currentTargetId:Id,
 current:Type.Boolean(),currentReferencesDepartment:Type.Boolean(),change:Type.Enum(['UNCHANGED','CHANGED','NOT_EVALUABLE']),
 constraint:Type.Enum(['SATISFIED','UNSATISFIED','NOT_EVALUABLE']),
 reason:Type.Enum(['LABEL_CHANGED','REFERENCE_EXITED','HISTORICAL_REFERENCE','REFERENCE_UNCHANGED']),
 affectedSpans:Type.Array(ImpactSpanSchema),
},closed);
export type ImpactReference=Static<typeof ImpactReferenceSchema>;
export const ImpactCoverageSchema=Type.Object({owner:Type.Enum(['SOURCE_MAPPING','IDENTIFIER','HIERARCHY','PERSONNEL','BUSINESS_UNIT','WARD','PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER']),status:Type.Enum(['EVALUATED','NOT_EVALUABLE']),reason:Type.Enum(['OWNER_AVAILABLE','OWNER_NOT_IMPLEMENTED'])},closed);
export const DepartmentAssessmentSchema=Type.Object({
 target:ImpactTargetSchema,departmentIds:Type.Array(Id,{minItems:1,maxItems:100}),inputId:Id,inputDigest:Text,campus:Type.Enum(['NORTH','SOUTH']),
 changeType:Type.Enum(['RENAME','SPLIT','MERGE']),effectiveAt:Text,ruleVersion:Type.Literal('DEPARTMENT_IMPACT_V1'),
 dependencyDigest:Text,coverage:Type.Array(ImpactCoverageSchema),references:Type.Array(ImpactReferenceSchema),
},closed);
export type DepartmentAssessment=Static<typeof DepartmentAssessmentSchema>;
export const StoredDepartmentAssessmentSchema=Type.Object({...DepartmentAssessmentSchema.properties,assessmentId:Id,recordedAt:Text},closed);
export type StoredDepartmentAssessment=Static<typeof StoredDepartmentAssessmentSchema>;
export const ImpactCaseListSchema=Type.Object({eventId:Id,campus:Type.Enum(['NORTH','SOUTH']),after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},closed);
export type ImpactCaseListInput=Static<typeof ImpactCaseListSchema>;
export const ImpactObligationSchema=Type.Union([
 Type.Object({kind:Type.Literal('REFERENCE'),owner:Type.Enum(['SOURCE_MAPPING','IDENTIFIER','HIERARCHY']),reference:ImpactReferenceSchema,affectedSpans:Type.Array(ImpactSpanSchema)},closed),
 Type.Object({kind:Type.Literal('EXTERNAL'),owner:Type.Enum(['PERSONNEL','PATIENT','ACCOUNT','INVENTORY','FINANCE','CONSUMER']),materialId:Id,ownerRole:Text,ownerSignatory:Text,decisionRef:Text,requiredAction:Text,affectedSpans:Type.Array(ImpactSpanSchema)},closed),
]);
export type ImpactObligation=Static<typeof ImpactObligationSchema>;
export const ImpactCaseSchema=Type.Object({id:Id,eventId:Id,assessmentId:Id,observationBasis:Type.Enum(['FROZEN_APPROVAL','LATER_OBSERVATION']),campus:Type.Enum(['NORTH','SOUTH']),obligation:ImpactObligationSchema,head:Type.String({pattern:'^(0|[1-9][0-9]*)$'}),status:Type.Enum(['OPEN','RESOLVED','SIMULATED_COMPLETED']),recordedAt:Text},closed);
export type ImpactCase=Static<typeof ImpactCaseSchema>;
export const ImpactCaseListResultSchema=Type.Object({items:Type.Array(ImpactCaseSchema),total:Type.Integer(),unresolved:Type.Integer(),simulatedCompleted:Type.Integer(),nextCursor:Type.Union([Id,Type.Null()])},closed);
export type ImpactCaseListResult=Static<typeof ImpactCaseListResultSchema>;
const Head=Type.String({pattern:'^(0|[1-9][0-9]*)$'}),Reason=Type.String({minLength:1,maxLength:2000,pattern:'\\S'}),Campus=Type.Enum(['NORTH','SOUTH']);
export const ImpactCaseReadSchema=Type.Object({caseId:Id,campus:Campus},closed);
const Command={...ImpactCaseReadSchema.properties,requestId:Id,reason:Reason,expectedHead:Head};
export const AssignImpactCaseSchema=Type.Object({...Command,responsibilityId:Id},closed);
export const ImpactResultReferenceSchema=Type.Object({owner:Type.Enum(['SOURCE_MAPPING','IDENTIFIER','HIERARCHY']),id:Id,versionId:Id,candidateId:Id,requestId:Id},closed);
export const ImpactDispositionSchema=Type.Union([
 Type.Object({kind:Type.Literal('KEEP_HISTORY'),evidenceId:Id},closed),
 Type.Object({kind:Type.Literal('CLOSE_RELATION'),evidenceId:Id,result:ImpactResultReferenceSchema},closed),
 Type.Object({kind:Type.Literal('NEW_RELATION'),evidenceId:Id,result:ImpactResultReferenceSchema,oldRelation:Type.Union([Type.Object({kind:Type.Literal('KEEP_HISTORY')},closed),Type.Object({kind:Type.Literal('CLOSE'),result:ImpactResultReferenceSchema},closed)])},closed),
 Type.Object({kind:Type.Literal('MIGRATE_EXTERNAL'),evidenceId:Id,consumers:Type.Array(Type.String({minLength:1,maxLength:128}),{minItems:1,maxItems:20,uniqueItems:true})},closed),
]);
export const RecordDispositionSchema=Type.Object({...Command,disposition:ImpactDispositionSchema},closed);
export const ApproveDispositionSchema=Type.Object({...Command,proposalEventId:Id},closed);
export const RecheckImpactSchema=Type.Object(Command,closed);
export const RecordMigrationReceiptSchema=Type.Object({...Command,proposalEventId:Id,consumerActor:Type.String({minLength:1,maxLength:128}),outcome:Type.Enum(['FAILED','PARTIAL','SIMULATED_COMPLETED']),receiptRef:Reason,simulated:Type.Literal(true)},closed);
export type AssignImpactCaseInput=Static<typeof AssignImpactCaseSchema>;
export type RecordDispositionInput=Static<typeof RecordDispositionSchema>;
export type ApproveDispositionInput=Static<typeof ApproveDispositionSchema>;
export type RecheckImpactInput=Static<typeof RecheckImpactSchema>;
export type RecordMigrationReceiptInput=Static<typeof RecordMigrationReceiptSchema>;
export type ImpactDisposition=Static<typeof ImpactDispositionSchema>;
export type ImpactResultReference=Static<typeof ImpactResultReferenceSchema>;
export type ImpactCaseReadInput=Static<typeof ImpactCaseReadSchema>;
export const ImpactCommandResultSchema=Type.Object({caseId:Id,eventId:Id,head:Head,kind:Type.Enum(['ASSIGN','PROPOSE','APPROVE','RECHECK','RECEIPT']),status:Type.Enum(['OPEN','RESOLVED','SIMULATED_COMPLETED']),remainingSpans:Type.Array(ImpactSpanSchema)},closed);
export type ImpactCommandResult=Static<typeof ImpactCommandResultSchema>;
export const ImpactResponsibilitySchema=Type.Object({id:Id,versionId:Id,role:Text},closed);
export const ImpactCaseEventSchema=Type.Object({
 ...ImpactCommandResultSchema.properties,actor:Text,identity:Text,reason:Text,recordedAt:Text,
 responsibility:Type.Optional(ImpactResponsibilitySchema),
 disposition:Type.Optional(ImpactDispositionSchema),evidenceDigest:Type.Optional(Text),proposalEventId:Type.Optional(Id),
 dependencyDigest:Type.Optional(Text),
 receipt:Type.Optional(Type.Object({consumerActor:Text,outcome:Type.Enum(['FAILED','PARTIAL','SIMULATED_COMPLETED']),receiptRef:Text,simulated:Type.Literal(true)},closed)),
 consumerBindings:Type.Optional(Type.Array(Type.Object({actor:Text,identity:Text},closed))),
},closed);
export type ImpactCaseEvent=Static<typeof ImpactCaseEventSchema>;
export const ImpactHandoffSchema=Type.Object({consumerActor:Text,proposalEventId:Id,status:Type.Enum(['PENDING','FAILED','PARTIAL','SIMULATED_COMPLETED']),simulated:Type.Literal(true)},closed);
export const ImpactCaseDetailSchema=Type.Object({item:ImpactCaseSchema,history:Type.Array(ImpactCaseEventSchema),handoffs:Type.Array(ImpactHandoffSchema)},closed);
export type ImpactCaseDetail=Static<typeof ImpactCaseDetailSchema>;
export const ServiceImpactHandoffSchema=Type.Object({...ImpactHandoffSchema.properties,caseId:Id,eventId:Id,head:Head},closed);
export type ServiceImpactHandoff=Static<typeof ServiceImpactHandoffSchema>;
export const ReadDepartmentAssessmentSchema=Type.Object({assessmentId:Id,campus:Campus},closed);
export type ReadDepartmentAssessmentInput=Static<typeof ReadDepartmentAssessmentSchema>;
export const ListDepartmentAssessmentsSchema=Type.Object({target:ImpactTargetSchema,after:Type.Optional(Id),limit:Type.Optional(Type.Integer({minimum:1,maximum:100}))},closed);
export type ListDepartmentAssessmentsInput=Static<typeof ListDepartmentAssessmentsSchema>;
export const ListDepartmentAssessmentsResultSchema=Type.Object({items:Type.Array(StoredDepartmentAssessmentSchema),nextCursor:Type.Union([Id,Type.Null()])},closed);
export type ListDepartmentAssessmentsResult=Static<typeof ListDepartmentAssessmentsResultSchema>;
