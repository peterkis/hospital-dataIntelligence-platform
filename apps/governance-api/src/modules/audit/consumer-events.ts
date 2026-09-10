// Closed evidence taxonomy. Consumer reports never constitute a platform receipt.
export const CONSUMER_REPORT_EVENTS = [
  'CONSUMER_RELEASE_OBSERVED', 'CONSUMER_SNAPSHOT_VERIFIED', 'CONSUMER_SNAPSHOT_VERIFICATION_FAILED',
  'CONSUMER_APPLY_SUCCEEDED', 'CONSUMER_APPLY_FAILED',
  'CONSUMER_REPLAY_REQUESTED', 'CONSUMER_REPLAY_COMPLETED', 'CONSUMER_REPLAY_FAILED',
] as const;
export const CONSUMER_AUDIT_EVENTS = [...CONSUMER_REPORT_EVENTS,
  'CONSUMER_RECEIPT_ACCEPTED', 'CONSUMER_RECEIPT_REJECTED',
] as const;
export const CONSUMER_FAILURE_CODES = ['DIGEST_MISMATCH', 'SCHEMA_DIGEST_MISMATCH',
  'LIFECYCLE_BLOCKED', 'CROSS_SUBSCRIPTION', 'PROCESSING_DIGEST_MISMATCH', 'APPLY_FAILED',
  'APPLY_OUTCOME_UNKNOWN', 'AUDIT_UNAVAILABLE', 'TRANSPORT_FAILED', 'IDENTITY_MISMATCH',
  'PROJECTION_MISMATCH', 'SNAPSHOT_INVALID', 'CHECKPOINT_GAP', 'STATE_INVALID',
  'RELEASE_UNAVAILABLE', 'RECEIPT_INCOHERENT', 'REPLAY_CONFLICT', 'PROCESSING_FAILED'] as const;
export const CONSUMER_AUDIT_STAGES = ['OBSERVE', 'VERIFY', 'APPLY', 'RECEIPT', 'CHECKPOINT', 'REPLAY', 'STATE', 'AUDIT'] as const;
export type ConsumerAuditStage = (typeof CONSUMER_AUDIT_STAGES)[number];
export type ConsumerAuditEvent = (typeof CONSUMER_AUDIT_EVENTS)[number];
export type ConsumerFailureCode = (typeof CONSUMER_FAILURE_CODES)[number];
export interface ConsumerAuditReport {
  readonly evidenceId: string;
  readonly releaseId: string;
  readonly eventType: (typeof CONSUMER_REPORT_EVENTS)[number];
  readonly mode: 'ORIGINAL' | 'REPLAY';
  readonly operationId?: string;
  readonly attemptId?: string;
  readonly occurredAt: string;
  readonly failureCode?: ConsumerFailureCode;
  readonly failureStage?: ConsumerAuditStage;
}
export function consumerFailureCode(error: unknown): ConsumerFailureCode {
  const code = error instanceof Error ? error.message : '';
  const codes: Record<string, ConsumerFailureCode> = {
    CONSUMER_SUBSCRIPTION_NOT_ACTIVE: 'LIFECYCLE_BLOCKED', CONSUMER_SUBSCRIPTION_FORBIDDEN: 'CROSS_SUBSCRIPTION',
    CONSUMER_EVENT_NOT_AVAILABLE: 'RELEASE_UNAVAILABLE', CONSUMER_PROCESSING_DIGEST_MISMATCH: 'PROCESSING_DIGEST_MISMATCH',
    CONSUMER_RECEIPT_RESULT_INCOHERENT: 'RECEIPT_INCOHERENT', CONSUMER_CHECKPOINT_GAP: 'CHECKPOINT_GAP',
    REPLAY_OPERATION_CONFLICT: 'REPLAY_CONFLICT', CONSUMER_AUDIT_UNAVAILABLE: 'AUDIT_UNAVAILABLE',
  };
  return codes[code] ?? 'PROCESSING_FAILED';
}
