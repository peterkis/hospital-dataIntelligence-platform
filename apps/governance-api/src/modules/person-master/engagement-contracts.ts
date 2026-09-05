import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { assertClosedObject, assertPersonPeriod, assertPersonUuid } from './contracts.js';
import { assertEngagementTypeCode, type EngagementCategoryCode } from './engagement-policy-contracts.js';

export type EngagementRevisionReasonCode =
  | 'FACT_CORRECTION'
  | 'VALIDITY_CORRECTION'
  | 'CONTINUATION_EXTENSION';

export interface EngagementReference {
  readonly governanceObjectId: string;
  readonly engagementId: string;
}

export interface EngagementVersionReference extends EngagementReference {
  readonly engagementVersionId: string;
}

export interface EngagementValidity {
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}

export interface CreateEngagement extends EngagementValidity {
  readonly governanceObjectId: string;
  readonly personId: string;
  readonly engagementTypeCode: string;
  readonly relationBasis: 'CONFIRMED_DISTINCT_RELATION_BASIS';
}

export interface ReviseEngagement extends EngagementReference, EngagementValidity {
  readonly expectedCurrentVersionId: string;
  readonly reasonCode: EngagementRevisionReasonCode;
}

export interface Engagement {
  readonly engagementId: string;
  readonly governanceObjectId: string;
  readonly personId: string;
  readonly engagementTypeCode: string;
  readonly engagementCategoryCode: EngagementCategoryCode;
  readonly engagementTypeVersionId: string;
  readonly engagementTypeVersionNo: string;
  readonly classificationRecordedAt: string;
  readonly createdAt: string;
}

export interface EngagementVersion extends EngagementReference, EngagementValidity {
  readonly engagementVersionId: string;
  readonly personId: string;
  readonly engagementTypeCode: string | null;
  readonly engagementCategoryCode: EngagementCategoryCode | null;
  readonly engagementTypeVersionId: string | null;
  readonly engagementTypeVersionNo: string | null;
  readonly classificationRecordedAt: string | null;
  readonly versionNo: string;
  readonly supersedesEngagementVersionId: string | null;
  readonly reasonCode: EngagementRevisionReasonCode | null;
  readonly recordedFrom: string;
}

export interface EngagementAsOfQuery extends EngagementReference {
  readonly businessAt: string;
  readonly recordAsOf: string;
}

export interface PersonEngagementsQuery {
  readonly governanceObjectId: string;
  readonly personId: string;
}

export interface EngagementCoreApplication {
  createEngagement(command: CreateEngagement): Promise<EngagementVersion>;
  reviseEngagement(command: ReviseEngagement): Promise<EngagementVersion>;
  getEngagement(query: EngagementReference): Promise<Engagement>;
  getEngagementVersion(query: EngagementVersionReference): Promise<EngagementVersion>;
  listEngagementVersions(query: EngagementReference): Promise<readonly EngagementVersion[]>;
  listPersonEngagements(query: PersonEngagementsQuery): Promise<readonly Engagement[]>;
  findEngagementAsOf(query: EngagementAsOfQuery): Promise<EngagementVersion | null>;
}

export function validateEngagementCreation(command: CreateEngagement): void {
  assertClosedObject(command, ['governanceObjectId', 'personId', 'engagementTypeCode', 'relationBasis',
    'businessValidFrom', 'businessValidTo']);
  requireUuid(command.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  requireUuid(command.personId, 'ENGAGEMENT_PERSON_INVALID');
  assertEngagementTypeCode(command.engagementTypeCode);
  if (command.relationBasis !== 'CONFIRMED_DISTINCT_RELATION_BASIS') {
    throw new Error('ENGAGEMENT_RELATION_BASIS_REQUIRED');
  }
  validateEngagementPeriod(command);
}

export function validateEngagementRevision(command: ReviseEngagement): void {
  assertClosedObject(command, ['governanceObjectId', 'engagementId', 'expectedCurrentVersionId',
    'businessValidFrom', 'businessValidTo', 'reasonCode']);
  requireUuid(command.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  requireUuid(command.engagementId, 'ENGAGEMENT_ID_INVALID');
  requireUuid(command.expectedCurrentVersionId, 'ENGAGEMENT_EXPECTED_VERSION_INVALID');
  validateEngagementReason(command.reasonCode);
  validateEngagementPeriod(command);
}

export function validateEngagementPeriod(input: EngagementValidity): void {
  try {
    if (typeof input.businessValidFrom !== 'string' ||
      (input.businessValidTo !== null && typeof input.businessValidTo !== 'string')) throw new Error();
    assertPersonPeriod(input.businessValidFrom, input.businessValidTo);
  } catch { throw new Error('ENGAGEMENT_TIME_INVALID'); }
}

export function validateEngagementTimes(input: { readonly businessAt: string; readonly recordAsOf: string }): void {
  try {
    for (const time of [input.businessAt, input.recordAsOf]) {
      if (typeof time !== 'string' || time.startsWith('0000-')) throw new Error();
      parseLocalDateTime(time);
    }
  } catch { throw new Error('ENGAGEMENT_TIME_INVALID'); }
}

export function validateEngagementReason(reason: unknown): asserts reason is EngagementRevisionReasonCode {
  if (!['FACT_CORRECTION', 'VALIDITY_CORRECTION', 'CONTINUATION_EXTENSION'].includes(String(reason))) {
    throw new Error('ENGAGEMENT_REASON_INVALID');
  }
}

const SAFE_ERRORS = new Set([
  'ENGAGEMENT_SCOPE_INVALID', 'ENGAGEMENT_PERSON_INVALID', 'ENGAGEMENT_RELATION_BASIS_REQUIRED',
  'ENGAGEMENT_TYPE_CODE_INVALID', 'ENGAGEMENT_TYPE_VERSION_NOT_FOUND',
  'ENGAGEMENT_OVERLAP_RULE_MISSING', 'ENGAGEMENT_OVERLAP_FORBIDDEN',
  'ENGAGEMENT_OVERLAP_REVIEW_REQUIRED',
  'ENGAGEMENT_TIME_INVALID', 'ENGAGEMENT_ID_INVALID', 'ENGAGEMENT_VERSION_ID_INVALID', 'ENGAGEMENT_EXPECTED_VERSION_INVALID',
  'ENGAGEMENT_REASON_INVALID', 'ENGAGEMENT_NOT_FOUND', 'ENGAGEMENT_VERSION_NOT_FOUND',
  'ENGAGEMENT_OPERATION_CONFLICT', 'ENGAGEMENT_STALE_VERSION', 'ENGAGEMENT_CONTEXT_INVALID',
  'PERSON_GOVERNANCE_SCOPE_INVALID', 'PERSON_HUMAN_ACTOR_REQUIRED', 'PERSON_INPUT_INVALID',
  'OBJECT_PERMISSION_FORBIDDEN',
]);

export function safeEngagementError(error: unknown): Error {
  return new Error(error instanceof Error && SAFE_ERRORS.has(error.message)
    ? error.message : 'ENGAGEMENT_OPERATION_FAILED');
}

export function assertEngagementUuid(value: unknown, code: string): asserts value is string {
  try { assertPersonUuid(value); }
  catch { throw new Error(code); }
}

function requireUuid(value: unknown, code: string): asserts value is string {
  assertEngagementUuid(value, code);
}
