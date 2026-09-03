export const PROTOTYPE_JOURNEY_STORAGE_KEY = 'hdi.prototype.journey.v1';

export const PROTOTYPE_ROLE_CODES = [
  'prototype-owner',
  'prototype-reviewer',
  'prototype-final-owner',
] as const;

export type PrototypeRoleCode = (typeof PROTOTYPE_ROLE_CODES)[number];
export type JourneyStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface WorkflowActionState {
  readonly actionResult: string;
  readonly actionSequence: string;
  readonly actorPrincipalId: string;
  readonly occurredAt: string;
  readonly reason: string;
  readonly stageType: string;
}

export interface WorkflowState {
  readonly changeRequestId: string;
  readonly requestStatus: string;
  readonly nextActionSequence: string;
  readonly submittedBy: string;
  readonly submittedAt: string;
  readonly actions: readonly WorkflowActionState[];
}

export interface ChargeItemJourneyState {
  readonly chargeItemId: string;
  readonly chargeItemVersionId: string;
  readonly internalCode: string;
  readonly formalName: string;
  readonly versionNo: string;
  readonly governanceStatus: string;
  readonly businessValidFrom: string;
  readonly contentDigest: string;
  readonly releaseId: string | null;
  readonly recordedFrom: string;
}

export interface PriceListJourneyState {
  readonly priceListId: string;
  readonly priceListReleaseId: string;
  readonly displayName: string;
  readonly releaseNo: string;
  readonly governanceStatus: string;
  readonly businessValidFrom: string;
  readonly contentDigest: string;
  readonly governanceReleaseId: string | null;
  readonly recordedFrom: string;
  readonly entryCount: number;
}

export interface ResolutionStepState {
  readonly stepNo: string;
  readonly scopeChecked: 'CAMPUS' | 'HOSPITAL';
  readonly encounterModeChecked: 'SPECIFIC' | 'GENERAL';
  readonly candidateCount: number;
  readonly decision: 'MATCHED' | 'NO_CANDIDATE' | 'CONFLICT' | 'SUSPENDED';
  readonly explanationCode: string;
}

export interface ResolutionJourneyState {
  readonly priceResolutionId: string;
  readonly status: string;
  readonly quantity: string;
  readonly unitPrice: string;
  readonly finalAmount: string | null;
  readonly currencyCode: string | null;
  readonly serviceOccurredAt: string;
  readonly recordAsOf: string;
  readonly resultDigest: string | null;
  readonly steps: readonly ResolutionStepState[];
}

export interface AuditEventState {
  readonly auditEventId: string;
  readonly auditSequence: string;
  readonly action: string;
  readonly entityType: string;
  readonly occurredAt: string;
  readonly actorPrincipalId: string;
}

export interface PrototypeJourneyState {
  readonly schemaVersion: 1;
  readonly currentRole: PrototypeRoleCode | null;
  readonly currentStep: JourneyStep;
  readonly syntheticCode: string;
  readonly chargeItem?: ChargeItemJourneyState;
  readonly chargeWorkflow?: WorkflowState;
  readonly priceList?: PriceListJourneyState;
  readonly priceWorkflow?: WorkflowState;
  readonly resolution?: ResolutionJourneyState;
  readonly chargeHistory?: readonly ChargeItemJourneyState[];
  readonly auditEvents?: readonly AuditEventState[];
}

export function createInitialJourneyState(syntheticCode = createSyntheticCode()): PrototypeJourneyState {
  return {
    schemaVersion: 1,
    currentRole: null,
    currentStep: 1,
    syntheticCode,
  };
}

export function loadPrototypeJourneyState(storage: Pick<Storage, 'getItem'>): PrototypeJourneyState {
  const serialized = storage.getItem(PROTOTYPE_JOURNEY_STORAGE_KEY);
  if (!serialized) return createInitialJourneyState();
  try {
    const candidate = JSON.parse(serialized) as unknown;
    return isJourneyState(candidate) ? candidate : createInitialJourneyState();
  } catch {
    return createInitialJourneyState();
  }
}

export function savePrototypeJourneyState(
  storage: Pick<Storage, 'setItem'>,
  state: PrototypeJourneyState,
): void {
  storage.setItem(PROTOTYPE_JOURNEY_STORAGE_KEY, JSON.stringify(state));
}

export function resetPrototypeJourney(storage: Pick<Storage, 'removeItem'>): void {
  storage.removeItem(PROTOTYPE_JOURNEY_STORAGE_KEY);
}

export function nextJourneyStep(step: JourneyStep): JourneyStep {
  return Math.min(8, step + 1) as JourneyStep;
}

export function roleCanPerform(
  role: PrototypeRoleCode | null,
  requiredRole: PrototypeRoleCode,
): boolean {
  return role === requiredRole;
}

export function buildResolutionTimes(priceList: Pick<PriceListJourneyState, 'businessValidFrom' | 'recordedFrom'>): {
  readonly serviceOccurredAt: string;
  readonly recordAsOf: string;
} {
  return {
    serviceOccurredAt: priceList.businessValidFrom,
    recordAsOf: priceList.recordedFrom,
  };
}

function createSyntheticCode(): string {
  return `PV003-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
}

function isJourneyState(value: unknown): value is PrototypeJourneyState {
  if (!isRecord(value)) return false;
  const role = value['currentRole'];
  return value['schemaVersion'] === 1 &&
    Number.isInteger(value['currentStep']) &&
    Number(value['currentStep']) >= 1 &&
    Number(value['currentStep']) <= 8 &&
    typeof value['syntheticCode'] === 'string' &&
    (role === null || PROTOTYPE_ROLE_CODES.includes(role as PrototypeRoleCode));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
