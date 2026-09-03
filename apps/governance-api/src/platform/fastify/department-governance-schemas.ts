import { Type } from '@fastify/type-provider-typebox';
import type { Static, TSchema } from 'typebox';

const UUID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const WHOLE_SECOND_LOCAL_DATE_TIME_PATTERN =
  '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$';
const TRIMMED_TEXT_PATTERN = '^\\S(?:[\\s\\S]*\\S)?$';

function readonlyArray<Items extends TSchema>(items: Items) {
  return Type.Unsafe<readonly Static<Items>[]>(Type.Array(items));
}

export const DepartmentUuidSchema = Type.String({ pattern: UUID_PATTERN });
export const DepartmentDigestSchema = Type.String({ pattern: DIGEST_PATTERN });
export const DepartmentLocalDateTimeSchema = Type.String({
  pattern: WHOLE_SECOND_LOCAL_DATE_TIME_PATTERN,
});

export const DepartmentTypeSchema = Type.Union([
  Type.Literal('CLINICAL'),
  Type.Literal('MEDICAL_TECHNOLOGY'),
  Type.Literal('AUXILIARY'),
  Type.Literal('ADMINISTRATIVE'),
]);

export const DepartmentSubjectMappingApplicabilitySchema = Type.Union([
  Type.Literal('REQUIRED_OUTPATIENT'),
  Type.Literal('REQUIRED_CLINICAL_SERVICE'),
  Type.Literal('EXEMPT_MEDICAL_TECHNOLOGY'),
  Type.Literal('EXEMPT_AUXILIARY'),
  Type.Literal('PENDING_DETERMINATION'),
]);

export const DepartmentLifecycleStatusSchema = Type.Union([
  Type.Literal('ACTIVE'),
  Type.Literal('SUSPENDED'),
  Type.Literal('DEPRECATED'),
  Type.Literal('SUPERSEDED'),
]);

export const DepartmentHierarchyViewTypeSchema = Type.Union([
  Type.Literal('ADMINISTRATIVE'),
  Type.Literal('OPERATIONAL'),
  Type.Literal('MEDICAL_RECORD'),
  Type.Literal('FINANCE'),
  Type.Literal('STATISTICAL'),
]);

export const DepartmentDraftContentSchema = Type.Object(
  {
    standardName: Type.String({
      minLength: 1,
      maxLength: 256,
      pattern: TRIMMED_TEXT_PATTERN,
    }),
    shortName: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
    departmentType: DepartmentTypeSchema,
    subjectMappingApplicability: DepartmentSubjectMappingApplicabilitySchema,
    lifecycleStatus: DepartmentLifecycleStatusSchema,
    businessValidFrom: DepartmentLocalDateTimeSchema,
    businessValidTo: Type.Union([DepartmentLocalDateTimeSchema, Type.Null()]),
    campusIds: Type.Array(DepartmentUuidSchema, { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const CreateDepartmentDraftBodySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    departmentCode: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: TRIMMED_TEXT_PATTERN,
    }),
    content: DepartmentDraftContentSchema,
  },
  { additionalProperties: false },
);

export const SubmitDepartmentBodySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    expectedContentHash: DepartmentDigestSchema,
    changeReason: Type.String({
      minLength: 1,
      maxLength: 1000,
      pattern: TRIMMED_TEXT_PATTERN,
    }),
  },
  { additionalProperties: false },
);

export const DepartmentDecisionBodySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    departmentId: DepartmentUuidSchema,
    departmentVersionId: DepartmentUuidSchema,
    seenContentHash: DepartmentDigestSchema,
    decision: Type.Union([Type.Literal('APPROVED'), Type.Literal('REJECTED')]),
    reason: Type.String({
      minLength: 1,
      maxLength: 1000,
      pattern: TRIMMED_TEXT_PATTERN,
    }),
  },
  { additionalProperties: false },
);

export const DepartmentPublicationConfirmationBodySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    departmentId: DepartmentUuidSchema,
    departmentVersionId: DepartmentUuidSchema,
    approvedContentHash: DepartmentDigestSchema,
  },
  { additionalProperties: false },
);

export const DepartmentSourceMappingConfirmationBodySchema = Type.Object(
  { governanceObjectId: DepartmentUuidSchema },
  { additionalProperties: false },
);

export const DepartmentVersionParamsSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    departmentVersionId: DepartmentUuidSchema,
  },
  { additionalProperties: false },
);

export const DepartmentGovernanceRequestParamsSchema = Type.Object(
  { governanceRequestId: DepartmentUuidSchema },
  { additionalProperties: false },
);

export const DepartmentSourceMappingParamsSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    mappingId: DepartmentUuidSchema,
  },
  { additionalProperties: false },
);

export const DepartmentParamsSchema = Type.Object(
  { departmentId: DepartmentUuidSchema },
  { additionalProperties: false },
);

export const DepartmentHierarchyParamsSchema = Type.Object(
  { viewType: DepartmentHierarchyViewTypeSchema },
  { additionalProperties: false },
);

export const DepartmentGovernanceObjectQuerySchema = Type.Object(
  { governanceObjectId: DepartmentUuidSchema },
  { additionalProperties: false },
);

export const DepartmentPublishedListQuerySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    departmentCode: Type.Optional(Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: TRIMMED_TEXT_PATTERN,
    })),
    standardName: Type.Optional(Type.String({
      minLength: 1,
      maxLength: 256,
      pattern: TRIMMED_TEXT_PATTERN,
    })),
    departmentType: Type.Optional(DepartmentTypeSchema),
    campusId: Type.Optional(DepartmentUuidSchema),
  },
  { additionalProperties: false },
);

export const DepartmentHistoryQuerySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    asOf: DepartmentLocalDateTimeSchema,
  },
  { additionalProperties: false },
);

export const DepartmentVersionDifferenceQuerySchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    fromVersionNo: Type.Optional(Type.String({ minLength: 1 })),
    toVersionNo: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const DepartmentCampusResponseSchema = Type.Object(
  {
    campusId: DepartmentUuidSchema,
    campusCode: Type.String(),
    campusName: Type.String(),
  },
  { additionalProperties: false },
);

const DepartmentHierarchyPathNodeResponseSchema = Type.Object(
  {
    nodeId: DepartmentUuidSchema,
    displayName: Type.String(),
  },
  { additionalProperties: false },
);

export const DepartmentHierarchyResponseSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    viewType: DepartmentHierarchyViewTypeSchema,
    hierarchyPath: readonlyArray(DepartmentHierarchyPathNodeResponseSchema),
  },
  { additionalProperties: false },
);

export const DepartmentSourceMappingResponseSchema = Type.Object(
  {
    sourceSystem: Type.String(),
    sourceCode: Type.String(),
    sourceName: Type.String(),
    mappingStatus: Type.Union([
      Type.Literal('PENDING'),
      Type.Literal('CONFIRMED'),
      Type.Literal('REJECTED'),
    ]),
  },
  { additionalProperties: false },
);

export const DepartmentQualityResponseSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    qualityScore: Type.Union([Type.String(), Type.Null()]),
    completenessScore: Type.Union([Type.String(), Type.Null()]),
    uniquenessScore: Type.Union([Type.String(), Type.Null()]),
    standardizationScore: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const DepartmentSummaryResponseSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    departmentCode: Type.String(),
    standardName: Type.String(),
    shortName: Type.Union([Type.String(), Type.Null()]),
    departmentType: DepartmentTypeSchema,
    lifecycleStatus: DepartmentLifecycleStatusSchema,
    campuses: readonlyArray(DepartmentCampusResponseSchema),
    publishedAt: DepartmentLocalDateTimeSchema,
  },
  { additionalProperties: false },
);

export const DepartmentDetailResponseSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    departmentCode: Type.String(),
    standardName: Type.String(),
    shortName: Type.Union([Type.String(), Type.Null()]),
    departmentType: DepartmentTypeSchema,
    subjectMappingApplicability: DepartmentSubjectMappingApplicabilitySchema,
    lifecycleStatus: DepartmentLifecycleStatusSchema,
    campuses: readonlyArray(DepartmentCampusResponseSchema),
    hierarchyViews: readonlyArray(DepartmentHierarchyResponseSchema),
    sourceMappings: readonlyArray(DepartmentSourceMappingResponseSchema),
    quality: DepartmentQualityResponseSchema,
    publishedReleaseId: DepartmentUuidSchema,
    publishedAt: DepartmentLocalDateTimeSchema,
    contentHash: DepartmentDigestSchema,
  },
  { additionalProperties: false },
);

export const DepartmentHistoryResponseSchema = Type.Object(
  {
    departmentId: DepartmentUuidSchema,
    versionNo: Type.String(),
    asOf: DepartmentLocalDateTimeSchema,
    businessValidFrom: DepartmentLocalDateTimeSchema,
    businessValidTo: Type.Union([DepartmentLocalDateTimeSchema, Type.Null()]),
    department: DepartmentDetailResponseSchema,
  },
  { additionalProperties: false },
);

export const DepartmentGovernanceStatusResponseSchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    departmentId: DepartmentUuidSchema,
    departmentVersionId: DepartmentUuidSchema,
    governanceRequestId: Type.Union([DepartmentUuidSchema, Type.Null()]),
    status: Type.Union([
      Type.Literal('DRAFT'),
      Type.Literal('SUBMITTED'),
      Type.Literal('UNDER_REVIEW'),
      Type.Literal('AWAITING_FINAL'),
      Type.Literal('APPROVED'),
      Type.Literal('PUBLISHED'),
      Type.Literal('REJECTED'),
      Type.Literal('WITHDRAWN'),
    ]),
    contentHash: DepartmentDigestSchema,
  },
  { additionalProperties: false },
);

export const DepartmentReviewQueueResponseSchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    governanceRequestId: DepartmentUuidSchema,
    departmentId: DepartmentUuidSchema,
    departmentVersionId: DepartmentUuidSchema,
    departmentCode: Type.String(),
    standardName: Type.String(),
    status: Type.Union([
      Type.Literal('SUBMITTED'),
      Type.Literal('UNDER_REVIEW'),
      Type.Literal('AWAITING_FINAL'),
    ]),
    submittedAt: DepartmentLocalDateTimeSchema,
    contentHash: DepartmentDigestSchema,
  },
  { additionalProperties: false },
);

const DepartmentComparableFieldSchema = Type.Union([
  Type.Literal('standardName'),
  Type.Literal('shortName'),
  Type.Literal('departmentType'),
  Type.Literal('subjectMappingApplicability'),
  Type.Literal('lifecycleStatus'),
  Type.Literal('businessValidFrom'),
  Type.Literal('businessValidTo'),
]);

const DepartmentFieldDifferenceResponseSchema = Type.Object(
  {
    field: DepartmentComparableFieldSchema,
    before: Type.Union([Type.String(), Type.Null()]),
    after: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export const DepartmentVersionDifferenceResponseSchema = Type.Object(
  {
    governanceObjectId: DepartmentUuidSchema,
    departmentId: DepartmentUuidSchema,
    fromVersionNo: Type.Union([Type.String(), Type.Null()]),
    toVersionNo: Type.String(),
    differences: readonlyArray(DepartmentFieldDifferenceResponseSchema),
  },
  { additionalProperties: false },
);

export const DepartmentErrorResponseSchema = Type.Object(
  {
    code: Type.String(),
    requestId: Type.String(),
  },
  { additionalProperties: false },
);

export const DepartmentSummaryListResponseSchema = readonlyArray(
  DepartmentSummaryResponseSchema,
);
export const DepartmentHierarchyListResponseSchema = readonlyArray(
  DepartmentHierarchyResponseSchema,
);
export const DepartmentSourceMappingListResponseSchema = readonlyArray(
  DepartmentSourceMappingResponseSchema,
);
export const DepartmentReviewQueueListResponseSchema = readonlyArray(
  DepartmentReviewQueueResponseSchema,
);
