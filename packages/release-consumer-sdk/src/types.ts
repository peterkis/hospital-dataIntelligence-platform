import type { createGovernanceApiClient, GovernanceApiOperations } from '@hospital-data-intelligence/generated-api-client';

export type ReleaseConsumerClient = ReturnType<typeof createGovernanceApiClient>;
export type ReleaseEvent = Readonly<GovernanceApiOperations['listPhase01ConsumerEvents']['responses'][200]['content']['application/json']['events'][number]>;
export type ConsumerOperationalStatus = GovernanceApiOperations['getPhase01ConsumerOperationalStatus']['responses'][200]['content']['application/json'];
export type ReceiptResult = GovernanceApiOperations['recordPhase01ConsumerReceipt']['responses'][201]['content']['application/json'];
export type CanonicalSnapshot = GovernanceApiOperations['downloadPhase01CanonicalSnapshot']['responses'][200]['content']['application/vnd.hdi.canonical-snapshot+json'];
export type ProjectionSupport = CanonicalSnapshot extends infer Envelope
  ? Envelope extends { projectionContract: { projectionType: infer P; schemaVersion: infer V } }
    ? { readonly projectionType: P; readonly projectionSchemaVersion: V } : never : never;

declare const downloaded: unique symbol;
declare const verified: unique symbol;
declare const applied: unique symbol;
export interface DownloadedSnapshot { readonly [downloaded]: true; readonly event: ReleaseEvent }
export interface VerifiedSnapshot {
  readonly [verified]: true;
  readonly event: ReleaseEvent;
  readonly snapshot: CanonicalSnapshot;
}
export interface AppliedRelease { readonly [applied]: true; readonly event: ReleaseEvent }

export interface AppliedEventState {
  readonly eventId: string;
  readonly aggregateVersion: string;
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly processedAt: string;
  readonly closure: 'APPLIED_PENDING_RECEIPT' | 'CLOSED';
}
export interface ReleaseConsumerState {
  readonly schemaVersion: 1;
  readonly subscriptionId: string;
  readonly appliedAggregateVersion: string;
  readonly appliedEvents: Readonly<Record<string, AppliedEventState>>;
}
export interface ReleaseConsumerStateStore {
  /** Return null only when no state exists. Throw for corruption or read failure. */
  load(): Promise<ReleaseConsumerState | null>;
  /** Atomically persist receipt closure after the server checkpoint is confirmed. */
  save(state: ReleaseConsumerState): Promise<void>;
}
export interface ReleaseConsumerOptions {
  readonly client: ReleaseConsumerClient;
  readonly subscriptionId: string;
  readonly expectedGovernanceObjectId?: string;
  readonly supportedProjections: readonly ProjectionSupport[];
  readonly state: ReleaseConsumerStateStore;
  /** Commit business application AND nextState in ONE local transaction. On
   * ambiguous commit outcome, reload before retrying; never blindly reapply.
   * Single writer per subscription/store, including across processes. */
  apply(snapshot: VerifiedSnapshot, nextState: ReleaseConsumerState): Promise<void>;
  now(): string;
}
export interface ConsumerCheckpoint {
  readonly appliedAggregateVersion: string;
  readonly recordedAt: string | null;
}
export interface ConsumptionResult { readonly applied: number; readonly receiptsClosed: number }
export interface ProcessingResult {
  readonly receiveResult: 'ACCEPTED' | 'REJECTED';
  readonly validationResult: 'VALID' | 'INVALID';
}
export interface ReleaseConsumer {
  readonly subscriptionId: string;
  poll(afterAggregateVersion?: string): Promise<readonly ReleaseEvent[]>;
  fetchExactRelease(identity: { readonly releaseId: string } | { readonly eventId: string }): Promise<ReleaseEvent>;
  downloadSnapshot(event: ReleaseEvent): Promise<DownloadedSnapshot>;
  verifySnapshot(snapshot: DownloadedSnapshot): VerifiedSnapshot;
  apply(snapshot: VerifiedSnapshot): Promise<AppliedRelease>;
  ackApplied(release: AppliedRelease): Promise<ReceiptResult | null>;
  submitProcessingReceipt(snapshot: DownloadedSnapshot, result: ProcessingResult): Promise<ReceiptResult>;
  getOperationalStatus(): Promise<ConsumerOperationalStatus>;
  getCheckpoint(): Promise<ConsumerCheckpoint>;
  consume(): Promise<ConsumptionResult>;
  resume(): Promise<ConsumptionResult>;
}
