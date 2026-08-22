export const PUBLICATION_FAULT_MATRIX = [
  'WORKFLOW_DECISION_WRITTEN',
  'RELEASE_ENVELOPE_WRITTEN',
  'SNAPSHOT_ARTIFACT_WRITTEN',
  'RELEASE_MEMBER_WRITTEN',
  'OUTBOX_EVENT_WRITTEN',
  'COMPATIBILITY_PRECHECK_WRITTEN',
  'DELIVERY_REGISTERED',
  'DOMAIN_CANDIDATE_CONFIRMED',
  'AUDIT_EVENT_WRITTEN',
] as const;

export const OUTBOX_RECOVERY_FAULT_MATRIX = [
  'OUTBOX_DROP_WAKE',
  'OUTBOX_AFTER_CLAIM',
  'OUTBOX_AFTER_NOTIFICATION',
] as const;

export interface FaultMatrixResult {
  readonly faultPoint: (typeof PUBLICATION_FAULT_MATRIX)[number];
  readonly terminalResult: 'PASSED' | 'FAILED';
  readonly releaseCountDelta: number;
  readonly snapshotCountDelta: number;
  readonly memberCountDelta: number;
  readonly outboxCountDelta: number;
  readonly compatibilityCountDelta: number;
  readonly deliveryCountDelta: number;
  readonly auditCountDelta: number;
  readonly checkpointCountDelta: number;
  readonly approvalActionCountDelta: number;
  readonly evidenceDigest: string;
}
