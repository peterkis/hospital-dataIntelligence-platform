import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { assertClosedObject, assertPersonPeriod, assertPersonUuid } from './contracts.js';

export const ENGAGEMENT_CATEGORY_CODES = [
  'LABOR_OR_HR',
  'DISPATCH_OR_SERVICE',
  'EXTERNAL_PROFESSIONAL',
  'TRAINING_OR_LEARNING',
] as const;

export type EngagementCategoryCode = (typeof ENGAGEMENT_CATEGORY_CODES)[number];
export type EngagementOverlapDecision = 'ALLOW' | 'FORBID' | 'REVIEW_REQUIRED';

export interface AppendEngagementTypeVersion {
  readonly governanceObjectId: string;
  readonly typeCode: string;
  readonly expectedCurrentVersionId: string | null;
  readonly categoryCode: EngagementCategoryCode;
  readonly displayName: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}

export interface EngagementTypeVersion {
  readonly engagementTypeId: string;
  readonly engagementTypeVersionId: string;
  readonly governanceObjectId: string;
  readonly typeCode: string;
  readonly versionNo: string;
  readonly supersedesEngagementTypeVersionId: string | null;
  readonly categoryCode: EngagementCategoryCode;
  readonly displayName: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
}

export interface EngagementTypeHistoryQuery {
  readonly governanceObjectId: string;
  readonly typeCode: string;
}

export interface AppendEngagementOverlapRuleVersion {
  readonly governanceObjectId: string;
  readonly leftEngagementTypeCode: string;
  readonly rightEngagementTypeCode: string;
  readonly expectedCurrentVersionId: string | null;
  readonly decision: EngagementOverlapDecision;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
}

export interface EngagementOverlapRuleVersion {
  readonly engagementOverlapRuleId: string;
  readonly engagementOverlapRuleVersionId: string;
  readonly governanceObjectId: string;
  readonly leftEngagementTypeCode: string;
  readonly rightEngagementTypeCode: string;
  readonly versionNo: string;
  readonly supersedesEngagementOverlapRuleVersionId: string | null;
  readonly decision: EngagementOverlapDecision;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly recordedFrom: string;
}

export interface EngagementOverlapRuleHistoryQuery {
  readonly governanceObjectId: string;
  readonly leftEngagementTypeCode: string;
  readonly rightEngagementTypeCode: string;
}

export interface EngagementOverlapRuleAsOfQuery extends EngagementOverlapRuleHistoryQuery {
  readonly businessAt: string;
  readonly recordAsOf: string;
}

export interface EngagementPolicyApplication {
  appendEngagementTypeVersion(command: AppendEngagementTypeVersion): Promise<EngagementTypeVersion>;
  listEngagementTypeVersions(query: EngagementTypeHistoryQuery): Promise<readonly EngagementTypeVersion[]>;
  appendEngagementOverlapRuleVersion(
    command: AppendEngagementOverlapRuleVersion,
  ): Promise<EngagementOverlapRuleVersion>;
  listEngagementOverlapRuleVersions(
    query: EngagementOverlapRuleHistoryQuery,
  ): Promise<readonly EngagementOverlapRuleVersion[]>;
  findEngagementOverlapRuleAsOf(
    query: EngagementOverlapRuleAsOfQuery,
  ): Promise<EngagementOverlapRuleVersion | null>;
}

export function validateAppendEngagementTypeVersion(command: AppendEngagementTypeVersion): void {
  assertClosedObject(command, ['governanceObjectId', 'typeCode', 'expectedCurrentVersionId',
    'categoryCode', 'displayName', 'businessValidFrom', 'businessValidTo']);
  requireUuid(command.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  assertEngagementTypeCode(command.typeCode);
  validateExpectedVersion(command.expectedCurrentVersionId);
  if (!ENGAGEMENT_CATEGORY_CODES.includes(command.categoryCode)) {
    throw new Error('ENGAGEMENT_CATEGORY_CODE_INVALID');
  }
  if (typeof command.displayName !== 'string' || command.displayName !== command.displayName.trim() ||
    command.displayName.length === 0 || [...command.displayName].length > 256 || /\p{Cc}/u.test(command.displayName)) {
    throw new Error('ENGAGEMENT_TYPE_DISPLAY_NAME_INVALID');
  }
  validatePolicyPeriod(command);
}

export function validateAppendEngagementOverlapRuleVersion(
  command: AppendEngagementOverlapRuleVersion,
): void {
  assertClosedObject(command, ['governanceObjectId', 'leftEngagementTypeCode',
    'rightEngagementTypeCode', 'expectedCurrentVersionId', 'decision',
    'businessValidFrom', 'businessValidTo']);
  requireUuid(command.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  canonicalizeEngagementTypePair(command.leftEngagementTypeCode, command.rightEngagementTypeCode);
  validateExpectedVersion(command.expectedCurrentVersionId);
  if (!['ALLOW', 'FORBID', 'REVIEW_REQUIRED'].includes(command.decision)) {
    throw new Error('ENGAGEMENT_OVERLAP_DECISION_INVALID');
  }
  validatePolicyPeriod(command);
}

export function validateEngagementTypeHistoryQuery(query: EngagementTypeHistoryQuery): void {
  assertClosedObject(query, ['governanceObjectId', 'typeCode']);
  requireUuid(query.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  assertEngagementTypeCode(query.typeCode);
}

export function validateEngagementOverlapRuleHistoryQuery(
  query: EngagementOverlapRuleHistoryQuery,
): void {
  assertClosedObject(query, ['governanceObjectId', 'leftEngagementTypeCode', 'rightEngagementTypeCode']);
  requireUuid(query.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  canonicalizeEngagementTypePair(query.leftEngagementTypeCode, query.rightEngagementTypeCode);
}

export function validateEngagementOverlapRuleAsOfQuery(query: EngagementOverlapRuleAsOfQuery): void {
  assertClosedObject(query, ['governanceObjectId', 'leftEngagementTypeCode',
    'rightEngagementTypeCode', 'businessAt', 'recordAsOf']);
  requireUuid(query.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  canonicalizeEngagementTypePair(query.leftEngagementTypeCode, query.rightEngagementTypeCode);
  validatePolicyInstant(query.businessAt);
  validatePolicyInstant(query.recordAsOf);
}

export function canonicalizeEngagementTypePair(left: string, right: string): readonly [string, string] {
  assertEngagementTypeCode(left);
  assertEngagementTypeCode(right);
  return left <= right ? [left, right] : [right, left];
}

export function assertEngagementTypeCode(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(value)) {
    throw new Error('ENGAGEMENT_TYPE_CODE_INVALID');
  }
}

const SAFE_POLICY_ERRORS = new Set([
  'ENGAGEMENT_SCOPE_INVALID', 'ENGAGEMENT_TYPE_CODE_INVALID', 'ENGAGEMENT_CATEGORY_CODE_INVALID',
  'ENGAGEMENT_TYPE_DISPLAY_NAME_INVALID', 'ENGAGEMENT_EXPECTED_VERSION_INVALID',
  'ENGAGEMENT_OVERLAP_DECISION_INVALID', 'ENGAGEMENT_TIME_INVALID', 'ENGAGEMENT_CONTEXT_INVALID',
  'ENGAGEMENT_TYPE_NOT_FOUND', 'ENGAGEMENT_OVERLAP_RULE_NOT_FOUND',
  'ENGAGEMENT_POLICY_OPERATION_CONFLICT', 'ENGAGEMENT_POLICY_STALE_VERSION',
  'PERSON_GOVERNANCE_SCOPE_INVALID', 'PERSON_HUMAN_ACTOR_REQUIRED', 'PERSON_INPUT_INVALID',
  'OBJECT_PERMISSION_FORBIDDEN',
]);

export function safeEngagementPolicyError(error: unknown): Error {
  return new Error(error instanceof Error && SAFE_POLICY_ERRORS.has(error.message)
    ? error.message : 'ENGAGEMENT_POLICY_OPERATION_FAILED');
}

function validateExpectedVersion(value: unknown): void {
  if (value === null) return;
  requireUuid(value, 'ENGAGEMENT_EXPECTED_VERSION_INVALID');
}

function validatePolicyPeriod(input: { readonly businessValidFrom: string; readonly businessValidTo: string | null }) {
  try {
    if (typeof input.businessValidFrom !== 'string' ||
      (input.businessValidTo !== null && typeof input.businessValidTo !== 'string')) throw new Error();
    assertPersonPeriod(input.businessValidFrom, input.businessValidTo);
  } catch { throw new Error('ENGAGEMENT_TIME_INVALID'); }
}

function validatePolicyInstant(value: unknown): void {
  try {
    if (typeof value !== 'string' || value.startsWith('0000-')) throw new Error();
    parseLocalDateTime(value);
  } catch { throw new Error('ENGAGEMENT_TIME_INVALID'); }
}

function requireUuid(value: unknown, code: string): asserts value is string {
  try { assertPersonUuid(value); }
  catch { throw new Error(code); }
}
