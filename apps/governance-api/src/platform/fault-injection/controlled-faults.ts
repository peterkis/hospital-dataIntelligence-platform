export const PUBLICATION_TRANSACTION_FAULT_POINTS = [
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

export const OUTBOX_RECOVERY_FAULT_POINTS = [
  'OUTBOX_AFTER_CLAIM',
  'OUTBOX_AFTER_NOTIFICATION',
  'OUTBOX_DROP_WAKE',
] as const;

export const CONTROLLED_PUBLICATION_FAULT_POINTS = [
  ...PUBLICATION_TRANSACTION_FAULT_POINTS,
  ...OUTBOX_RECOVERY_FAULT_POINTS,
  'ASSIGNMENT_CLOSURE_VERSION_WRITTEN',
  'ASSIGNMENT_CLOSURE_EVIDENCE_WRITTEN',
  'ASSIGNMENT_CLOSURE_OUTCOME_WRITTEN',
  'ASSIGNMENT_TRANSFER_HEADER_WRITTEN',
  'ASSIGNMENT_TRANSFER_SOURCE_WRITTEN',
  'ASSIGNMENT_TRANSFER_TARGET_STABLE_WRITTEN',
  'ASSIGNMENT_TRANSFER_TARGET_VERSION_WRITTEN',
  'ASSIGNMENT_TRANSFER_TARGET_SEGMENTS_WRITTEN',
  'ASSIGNMENT_TRANSFER_TARGET_SEMANTICS_WRITTEN',
  'ASSIGNMENT_TRANSFER_OUTCOME_WRITTEN',
] as const;

export type ControlledPublicationFaultPoint =
  (typeof CONTROLLED_PUBLICATION_FAULT_POINTS)[number];

let activeFaultPoint: ControlledPublicationFaultPoint | null = null;
let remainingMatchingHits = 0;

export function configureControlledPublicationFault(
  point: string | null,
  hitsBeforeFailure = 0,
): void {
  if (point === null) {
    activeFaultPoint = null;
    remainingMatchingHits = 0;
    return;
  }
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('CONTROLLED_FAULT_INJECTION_PRODUCTION_FORBIDDEN');
  }
  if (!CONTROLLED_PUBLICATION_FAULT_POINTS.includes(point as ControlledPublicationFaultPoint)) {
    throw new Error('CONTROLLED_FAULT_POINT_UNKNOWN');
  }
  if (!Number.isSafeInteger(hitsBeforeFailure) || hitsBeforeFailure < 0) {
    throw new Error('CONTROLLED_FAULT_HIT_COUNT_INVALID');
  }
  activeFaultPoint = point as ControlledPublicationFaultPoint;
  remainingMatchingHits = hitsBeforeFailure;
}

export function hitControlledPublicationFault(point: ControlledPublicationFaultPoint): void {
  if (activeFaultPoint !== point) return;
  if (remainingMatchingHits > 0) {
    remainingMatchingHits -= 1;
    return;
  }
  throw new Error(`CONTROLLED_PUBLICATION_FAULT:${point}`);
}

export function isControlledFaultActive(point: ControlledPublicationFaultPoint): boolean {
  return activeFaultPoint === point;
}

export function assertNoProductionFaultConfiguration(environment: NodeJS.ProcessEnv): void {
  if (environment['NODE_ENV'] !== 'test' && environment['HDI_PUBLICATION_FAULT_POINT']) {
    throw new Error('CONTROLLED_FAULT_INJECTION_PRODUCTION_FORBIDDEN');
  }
}
