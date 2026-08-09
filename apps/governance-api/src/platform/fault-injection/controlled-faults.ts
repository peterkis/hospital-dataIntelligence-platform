export const CONTROLLED_PUBLICATION_FAULT_POINTS = [
  'WORKFLOW_DECISION_WRITTEN',
  'RELEASE_ENVELOPE_WRITTEN',
  'SNAPSHOT_ARTIFACT_WRITTEN',
  'RELEASE_MEMBER_WRITTEN',
  'OUTBOX_EVENT_WRITTEN',
  'COMPATIBILITY_PRECHECK_WRITTEN',
  'DELIVERY_REGISTERED',
  'DOMAIN_CANDIDATE_CONFIRMED',
  'AUDIT_EVENT_WRITTEN',
  'OUTBOX_AFTER_CLAIM',
  'OUTBOX_AFTER_NOTIFICATION',
  'OUTBOX_DROP_WAKE',
] as const;

export type ControlledPublicationFaultPoint =
  (typeof CONTROLLED_PUBLICATION_FAULT_POINTS)[number];

let activeFaultPoint: ControlledPublicationFaultPoint | null = null;

export function configureControlledPublicationFault(point: string | null): void {
  if (point === null) {
    activeFaultPoint = null;
    return;
  }
  if (process.env['NODE_ENV'] !== 'test') {
    throw new Error('CONTROLLED_FAULT_INJECTION_PRODUCTION_FORBIDDEN');
  }
  if (!CONTROLLED_PUBLICATION_FAULT_POINTS.includes(point as ControlledPublicationFaultPoint)) {
    throw new Error('CONTROLLED_FAULT_POINT_UNKNOWN');
  }
  activeFaultPoint = point as ControlledPublicationFaultPoint;
}

export function hitControlledPublicationFault(point: ControlledPublicationFaultPoint): void {
  if (activeFaultPoint === point) throw new Error(`CONTROLLED_PUBLICATION_FAULT:${point}`);
}

export function isControlledFaultActive(point: ControlledPublicationFaultPoint): boolean {
  return activeFaultPoint === point;
}

export function assertNoProductionFaultConfiguration(environment: NodeJS.ProcessEnv): void {
  if (environment['NODE_ENV'] !== 'test' && environment['HDI_PUBLICATION_FAULT_POINT']) {
    throw new Error('CONTROLLED_FAULT_INJECTION_PRODUCTION_FORBIDDEN');
  }
}
