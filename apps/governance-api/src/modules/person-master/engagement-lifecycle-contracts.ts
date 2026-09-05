import { parseLocalDateTime } from '../../platform/local-datetime/local-datetime.js';
import { assertClosedObject } from './contracts.js';
import { assertEngagementUuid, type EngagementVersion } from './engagement-contracts.js';

export const ENGAGEMENT_BUSINESS_STATES = ['PLANNED', 'ACTIVE', 'SUSPENDED', 'ENDED'] as const;
export type EngagementBusinessState = (typeof ENGAGEMENT_BUSINESS_STATES)[number];
export type EngagementLifecycleEventType = 'SUSPENDED' | 'RESUMED';

export interface EngagementLifecycleReference {
  readonly governanceObjectId: string;
  readonly engagementId: string;
}

export interface EngagementBusinessStateQuery extends EngagementLifecycleReference {
  readonly businessAt: string;
  readonly recordAsOf: string;
}

export interface EngagementBusinessStateResult extends EngagementBusinessStateQuery {
  readonly businessState: EngagementBusinessState;
  readonly engagementVersionId: string;
  readonly lastApplicableLifecycleEventId: string | null;
  readonly lifecycleSequence: string;
}

export interface EngagementLifecycleMutation extends EngagementLifecycleReference {
  readonly businessEffectiveAt: string;
  readonly expectedLifecycleSequence: string;
  readonly reasonCode: string;
}

export type SuspendEngagement = EngagementLifecycleMutation;
export type ResumeEngagement = EngagementLifecycleMutation;

export interface EndEngagement extends EngagementLifecycleReference {
  readonly expectedCurrentEngagementVersionId: string;
  readonly businessEffectiveAt: string;
  readonly reasonCode: string;
}

export interface EngagementLifecycleEvent extends EngagementLifecycleReference {
  readonly engagementLifecycleEventId: string;
  readonly eventType: EngagementLifecycleEventType;
  readonly businessEffectiveAt: string;
  readonly recordedAt: string;
  readonly sequenceNo: string;
  readonly createdBy: string;
  readonly requestId: string;
  readonly reasonCode: string;
}

export interface EngagementLifecycleApplication {
  getEngagementBusinessStateAsOf(
    query: EngagementBusinessStateQuery,
  ): Promise<EngagementBusinessStateResult>;
  suspendEngagement(command: SuspendEngagement): Promise<EngagementLifecycleEvent>;
  resumeEngagement(command: ResumeEngagement): Promise<EngagementLifecycleEvent>;
  endEngagement(command: EndEngagement): Promise<EngagementVersion>;
}

export function validateEngagementBusinessStateQuery(query: EngagementBusinessStateQuery): void {
  assertClosedObject(query, ['governanceObjectId', 'engagementId', 'businessAt', 'recordAsOf']);
  validateReference(query);
  validateLifecycleTime(query.businessAt);
  validateLifecycleTime(query.recordAsOf);
}

export function validateSuspendEngagement(command: SuspendEngagement): void {
  validateLifecycleMutation(command);
}

export function validateResumeEngagement(command: ResumeEngagement): void {
  validateLifecycleMutation(command);
}

export function validateEndEngagement(command: EndEngagement): void {
  assertClosedObject(command, ['governanceObjectId', 'engagementId',
    'expectedCurrentEngagementVersionId', 'businessEffectiveAt', 'reasonCode']);
  validateReference(command);
  assertEngagementUuid(command.expectedCurrentEngagementVersionId,
    'ENGAGEMENT_EXPECTED_VERSION_INVALID');
  validateLifecycleTime(command.businessEffectiveAt);
  validateLifecycleReason(command.reasonCode);
}

export function deriveEngagementBusinessState(input: {
  readonly businessAt: string;
  readonly businessValidFrom: string;
  readonly businessValidTo: string | null;
  readonly lastApplicableEventType: EngagementLifecycleEventType | null;
}): EngagementBusinessState {
  const businessAt = localDateTimeOrderKey(input.businessAt);
  const businessValidFrom = localDateTimeOrderKey(input.businessValidFrom);
  const businessValidTo = input.businessValidTo === null
    ? null : localDateTimeOrderKey(input.businessValidTo);
  if (businessAt < businessValidFrom) return 'PLANNED';
  if (businessValidTo !== null && businessAt >= businessValidTo) return 'ENDED';
  return input.lastApplicableEventType === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE';
}

export function validateLifecycleReason(reasonCode: unknown): asserts reasonCode is string {
  if (typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/u.test(reasonCode)) {
    throw new Error('ENGAGEMENT_LIFECYCLE_REASON_INVALID');
  }
}

export function validateLifecycleSequence(sequence: unknown): asserts sequence is string {
  if (typeof sequence !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(sequence)) {
    throw new Error('ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID');
  }
}

const SAFE_ERRORS = new Set([
  'ENGAGEMENT_SCOPE_INVALID', 'ENGAGEMENT_ID_INVALID', 'ENGAGEMENT_NOT_FOUND',
  'ENGAGEMENT_CONTEXT_INVALID',
  'ENGAGEMENT_NOT_KNOWN_AS_OF', 'ENGAGEMENT_EXPECTED_VERSION_INVALID',
  'ENGAGEMENT_STALE_VERSION', 'ENGAGEMENT_LIFECYCLE_TIME_INVALID',
  'ENGAGEMENT_LIFECYCLE_REASON_INVALID', 'ENGAGEMENT_LIFECYCLE_SEQUENCE_INVALID',
  'ENGAGEMENT_LIFECYCLE_STALE_SEQUENCE', 'ENGAGEMENT_LIFECYCLE_OPERATION_CONFLICT',
  'ENGAGEMENT_LIFECYCLE_END_CONFLICT',
  'ENGAGEMENT_NOT_STARTED', 'ENGAGEMENT_ALREADY_SUSPENDED', 'ENGAGEMENT_NOT_SUSPENDED',
  'ENGAGEMENT_ENDED', 'ENGAGEMENT_END_BEFORE_START', 'ENGAGEMENT_ENDED_REOPEN_FORBIDDEN',
  'PERSON_GOVERNANCE_SCOPE_INVALID', 'PERSON_HUMAN_ACTOR_REQUIRED', 'PERSON_INPUT_INVALID',
  'OBJECT_PERMISSION_FORBIDDEN',
]);

export function safeEngagementLifecycleError(error: unknown): Error {
  return new Error(error instanceof Error && SAFE_ERRORS.has(error.message)
    ? error.message : 'ENGAGEMENT_LIFECYCLE_OPERATION_FAILED');
}

function validateLifecycleMutation(command: EngagementLifecycleMutation): void {
  assertClosedObject(command, ['governanceObjectId', 'engagementId', 'businessEffectiveAt',
    'expectedLifecycleSequence', 'reasonCode']);
  validateReference(command);
  validateLifecycleTime(command.businessEffectiveAt);
  validateLifecycleSequence(command.expectedLifecycleSequence);
  validateLifecycleReason(command.reasonCode);
}

function validateReference(reference: EngagementLifecycleReference): void {
  assertEngagementUuid(reference.governanceObjectId, 'ENGAGEMENT_SCOPE_INVALID');
  assertEngagementUuid(reference.engagementId, 'ENGAGEMENT_ID_INVALID');
}

function validateLifecycleTime(value: unknown): asserts value is string {
  try {
    if (typeof value !== 'string' || value.startsWith('0000-')) throw new Error();
    parseLocalDateTime(value);
  } catch {
    throw new Error('ENGAGEMENT_LIFECYCLE_TIME_INVALID');
  }
}

function localDateTimeOrderKey(value: string): string {
  validateLifecycleTime(value);
  const [whole, fraction = ''] = value.split('.');
  return `${whole!.replace(/\D/gu, '')}${fraction.padEnd(6, '0')}`;
}
