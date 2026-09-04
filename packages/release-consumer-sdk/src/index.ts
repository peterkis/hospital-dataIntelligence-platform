import { createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import { Check } from 'typebox/schema';
import { contracts, eventsSchema, operationalSchema, receiptBodySchema, receiptResponseSchema, replayContextSchema } from './contracts.generated.js';
import { ReleaseConsumerError, type ReleaseConsumerErrorCode } from './errors.js';
import type {
  AppliedEventState, AppliedRelease, CanonicalSnapshot, ConsumerCheckpoint, ConsumerOperationalStatus,
  DownloadedSnapshot, ReceiptResult, ReleaseConsumer, ReleaseConsumerOptions, ReleaseConsumerState,
  ReleaseEvent, VerifiedSnapshot,
  ReplayContext, ReplayInspection, ReplayCommand, ReplayRecord, ReplayAdapter, ReplayResult,
} from './types.js';
export { ReleaseConsumerError } from './errors.js';
export type { ReleaseConsumerErrorCode } from './errors.js';
export type * from './types.js';

const serverCodes = new Set<ReleaseConsumerErrorCode>([
  'CONSUMER_SUBSCRIPTION_NOT_ACTIVE', 'CONSUMER_SUBSCRIPTION_FORBIDDEN', 'CONSUMER_SUBSCRIPTION_NOT_FOUND',
  'SNAPSHOT_NOT_AVAILABLE_TO_SUBSCRIPTION', 'CONSUMER_EVENT_NOT_AVAILABLE', 'CONSUMER_PROCESSING_DIGEST_MISMATCH',
  'CONSUMER_RECEIPT_RESULT_INCOHERENT', 'CONSUMER_CHECKPOINT_GAP', 'REQUEST_SCHEMA_INVALID',
  'SERVICE_TOKEN_UNAUTHENTICATED', 'PRINCIPAL_KIND_FORBIDDEN',
  'REPLAY_OPERATION_CONFLICT',
]);
const sequence = /^(?:0|[1-9]\d*)$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
function failure(code: ReleaseConsumerErrorCode, stage: string): never { throw new ReleaseConsumerError(code, stage); }
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function createReleaseConsumer(options: ReleaseConsumerOptions): ReleaseConsumer {
  // Capture configuration: a caller changing the options object cannot change
  // the identity under which previously verified handles were issued.
  const { client, subscriptionId, expectedGovernanceObjectId, state: store, apply: callback, now } = options;
  const supported = options.supportedProjections.map((entry) => ({ ...entry }));
  if (!uuid.test(subscriptionId) || (expectedGovernanceObjectId !== undefined && !uuid.test(expectedGovernanceObjectId))) {
    failure('IDENTITY_MISMATCH', 'configuration');
  }
  if (supported.length === 0 || supported.some((pair) => !contracts.some((c) =>
    c.projectionType === pair.projectionType && c.schemaVersion === pair.projectionSchemaVersion))) {
    failure('PROJECTION_VERSION_MISMATCH', 'configuration');
  }
  const ownedEvents = new WeakSet<ReleaseEvent>();
  const downloads = new WeakMap<DownloadedSnapshot, { bytes: Buffer; digestHeader: string | null }>();
  const verified = new WeakSet<VerifiedSnapshot>();
  const applications = new WeakMap<AppliedRelease, AppliedEventState | null>();
  let busy = false;

  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (busy) failure('CONCURRENT_CONSUMPTION', 'apply');
    busy = true;
    try { return await work(); } finally { busy = false; }
  }
  async function request<T>(stage: string, operation: () => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<{ data: T; response: Response }> {
    let result;
    try { result = await operation(); }
    catch { return failure('TRANSPORT_FAILED', stage); }
    if (!result.response.ok) {
      const code = record(result.error) ? result.error['code'] : undefined;
      if (code === 'CONSUMER_SUBSCRIPTION_NOT_ACTIVE' && stage !== 'operational') {
        // One bounded read to resolve the stable B-03A code to B-03B lifecycle.
        // A failed read never permits consumption or initiates a retry loop.
        let view: ConsumerOperationalStatus | undefined;
        try { view = await operational(); } catch { /* Preserve original denial. */ }
        if (view && view.lifecycleStatus !== 'ACTIVE') failure(view.lifecycleStatus, stage);
      }
      if (typeof code === 'string' && serverCodes.has(code as ReleaseConsumerErrorCode)) {
        failure(code as ReleaseConsumerErrorCode, stage);
      }
      failure('HTTP_FAILED', stage);
    }
    if (result.data === undefined) failure('RESPONSE_INVALID', stage);
    return { data: result.data, response: result.response };
  }
  async function operational(): Promise<ConsumerOperationalStatus> {
    const result = await request('operational', () => client.GET(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/operational-status',
      { params: { path: { subscriptionId } } },
    ));
    if (!Check(operationalSchema, result.data)) failure('RESPONSE_INVALID', 'operational');
    if (result.data.subscriptionId !== subscriptionId) failure('IDENTITY_MISMATCH', 'operational');
    return result.data;
  }
  function checkpoint(view: ConsumerOperationalStatus): ConsumerCheckpoint {
    return { appliedAggregateVersion: view.latestCheckpoint?.appliedReleaseNo ?? '0',
      recordedAt: view.latestCheckpoint?.recordedAt ?? null };
  }
  async function activeCheckpoint(): Promise<ConsumerCheckpoint> {
    const view = await operational();
    if (view.lifecycleStatus !== 'ACTIVE') failure(view.lifecycleStatus, 'checkpoint');
    return checkpoint(view);
  }
  function requireEvent(event: ReleaseEvent) {
    if (!ownedEvents.has(event)) failure('UNVERIFIED_INPUT', 'identity');
  }
  function projectionContract(event: ReleaseEvent) {
    if (!supported.some((p) => p.projectionType === event.projectionType)) failure('PROJECTION_TYPE_MISMATCH', 'projection');
    if (!supported.some((p) => p.projectionType === event.projectionType && p.projectionSchemaVersion === event.projectionSchemaVersion)) {
      failure('PROJECTION_VERSION_MISMATCH', 'projection');
    }
    const contract = contracts.find((c) => c.projectionType === event.projectionType && c.schemaVersion === event.projectionSchemaVersion)!;
    if (event.projectionSchemaDigest !== contract.schemaDigest) failure('SCHEMA_DIGEST_MISMATCH', 'schema-digest');
    return contract;
  }
  async function poll(afterAggregateVersion = '0'): Promise<readonly ReleaseEvent[]> {
    if (!sequence.test(afterAggregateVersion)) failure('STATE_INVALID', 'poll');
    const { data } = await request('poll', () => client.GET(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/events',
      { params: { path: { subscriptionId }, query: { afterAggregateVersion } } },
    ));
    if (!Check(eventsSchema, data)) failure('RESPONSE_INVALID', 'poll');
    let previous = BigInt(afterAggregateVersion);
    const ids = new Set<string>();
    const objects = new Set<string>();
    return data.events.filter((event) => BigInt(event.aggregateVersion) > previous).map((event) => {
      if (BigInt(event.aggregateVersion) <= previous || ids.has(event.eventId)) failure('EVENT_GAP', 'poll');
      previous = BigInt(event.aggregateVersion);
      ids.add(event.eventId);
      objects.add(event.governanceObjectId);
      if (objects.size > 1 || (expectedGovernanceObjectId !== undefined && event.governanceObjectId !== expectedGovernanceObjectId)) {
        failure('IDENTITY_MISMATCH', 'poll');
      }
      const value = freeze({ ...event });
      ownedEvents.add(value);
      return value;
    });
  }
  async function exact(identity: { readonly releaseId: string } | { readonly eventId: string }): Promise<ReleaseEvent> {
    const events = await poll('0');
    const matches = events.filter((event) => 'releaseId' in identity
      ? event.releaseId === identity.releaseId : event.eventId === identity.eventId);
    if (matches.length !== 1) failure('RELEASE_NOT_FOUND', 'exact');
    return matches[0]!;
  }
  async function replayContext(releaseId: string): Promise<ReplayContext> {
    if (!uuid.test(releaseId)) failure('IDENTITY_MISMATCH', 'replay');
    const { data } = await request('replay', () => client.GET(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/releases/{releaseId}/replay-context',
      { params: { path: { subscriptionId, releaseId } } },
    ));
    if (!Check(replayContextSchema, data)) failure('RESPONSE_INVALID', 'replay');
    if (data.subscriptionId !== subscriptionId || data.event.releaseId !== releaseId ||
        (expectedGovernanceObjectId !== undefined && data.event.governanceObjectId !== expectedGovernanceObjectId)) {
      failure('IDENTITY_MISMATCH', 'replay');
    }
    const version = data.subscriptionVersion;
    if (version.projectionType !== data.event.projectionType) failure('PROJECTION_TYPE_MISMATCH', 'replay');
    if (version.projectionSchemaVersion !== data.event.projectionSchemaVersion) failure('PROJECTION_VERSION_MISMATCH', 'replay');
    if (version.projectionSchemaDigest !== data.event.projectionSchemaDigest) failure('SCHEMA_DIGEST_MISMATCH', 'replay');
    if (data.processingDigestMismatch || (data.appliedReceipt &&
        data.appliedReceipt.processingDigest !== data.event.snapshotArtifactDigest)) failure('CONSUMER_PROCESSING_DIGEST_MISMATCH', 'replay');
    if (data.appliedReceipt && (data.appliedReceipt.applyResult !== 'APPLIED' || data.appliedReceipt.receiveResult !== 'ACCEPTED' ||
        data.appliedReceipt.validationResult !== 'VALID')) failure('RESPONSE_INVALID', 'replay');
    const current = BigInt(data.checkpoint.appliedAggregateVersion);
    if (current > 0n && BigInt(data.event.aggregateVersion) > current + 1n) failure('EVENT_GAP', 'replay');
    return freeze(data);
  }
  async function inspectReplay(identity: { readonly releaseId: string }): Promise<ReplayInspection> {
    const context = await replayContext(identity.releaseId);
    ownedEvents.add(context.event);
    const snapshot = verifySnapshot(await downloadSnapshot(context.event, identity.releaseId));
    return freeze({ context, snapshot });
  }
  async function replayExactRelease(command: ReplayCommand, adapter: ReplayAdapter): Promise<ReplayResult> {
    if (!uuid.test(command.operationId) || typeof command.reason !== 'string' || command.reason.trim().length === 0 ||
        command.reason.length > 256 || /[\u0000-\u001f\u007f<>]/u.test(command.reason)) failure('REPLAY_COMMAND_INVALID', 'replay');
    const { context: inspected, snapshot } = await inspectReplay(command);
    const context = await replayContext(command.releaseId); // Recheck lifecycle/identity immediately before repair.
    if (canonicalize(context.event) !== canonicalize(inspected.event) ||
        canonicalize(context.subscriptionVersion) !== canonicalize(inspected.subscriptionVersion) ||
        context.servicePrincipalId !== inspected.servicePrincipalId) failure('REPLAY_CONTEXT_CHANGED', 'replay');
    let saved: ReplayRecord | null;
    try { saved = await adapter.load(command.operationId); } catch { return failure('STATE_IO_FAILED', 'replay'); }
    const identity = { ...command, subscriptionId, servicePrincipalId: context.servicePrincipalId,
      subscriptionVersionId: context.subscriptionVersion.subscriptionVersionId, eventId: context.event.eventId,
      snapshotId: context.event.snapshotId, processingDigest: context.event.snapshotArtifactDigest };
    if (saved !== null) {
      const previous = saved;
      if (!record(saved) || Object.entries(identity).some(([key, value]) => previous[key as keyof ReplayRecord] !== value) ||
          !['APPLIED_PENDING_RECEIPT', 'CLOSED'].includes(saved.closure)) failure('REPLAY_OPERATION_CONFLICT', 'replay');
    }
    const businessApplied = saved === null;
    if (saved === null) {
      let processedAt: string;
      try { processedAt = now(); } catch { return failure('STATE_INVALID', 'time'); }
      saved = freeze({ ...identity, processedAt, closure: 'APPLIED_PENDING_RECEIPT' as const });
      if (!Check(receiptBodySchema, { eventId: saved.eventId, processingDigest: saved.processingDigest,
        processedAt, receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED' })) failure('STATE_INVALID', 'time');
      try {
        if (await adapter.commit(snapshot, saved) !== undefined) failure('APPLY_FAILED', 'replay');
      } catch { return failure('APPLY_FAILED', 'replay'); }
    }
    let durable: ReplayRecord | null;
    if (!Check(receiptBodySchema, { eventId: saved.eventId, processingDigest: saved.processingDigest, processedAt: saved.processedAt,
      receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED' })) failure('STATE_INVALID', 'replay');
    try { durable = await adapter.load(command.operationId); } catch { return failure('STATE_IO_FAILED', 'replay'); }
    if (canonicalize(durable) !== canonicalize(saved)) failure('APPLY_NOT_DURABLE', 'replay');
    const beforeReceipt = await replayContext(command.releaseId);
    if (canonicalize(beforeReceipt.event) !== canonicalize(context.event) ||
        canonicalize(beforeReceipt.subscriptionVersion) !== canonicalize(context.subscriptionVersion)) failure('REPLAY_CONTEXT_CHANGED', 'receipt');
    if (saved.closure !== 'CLOSED') {
      await postReceipt({ eventId: saved.eventId, processingDigest: saved.processingDigest, processedAt: saved.processedAt,
        receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED',
        replay: { ...command, subscriptionVersionId: saved.subscriptionVersionId } });
    }
    const after = await replayContext(command.releaseId);
    if (canonicalize(after.event) !== canonicalize(context.event) ||
        canonicalize(after.subscriptionVersion) !== canonicalize(context.subscriptionVersion)) failure('REPLAY_CONTEXT_CHANGED', 'replay');
    if (!after.appliedReceipt || BigInt(after.checkpoint.appliedAggregateVersion) < BigInt(context.event.aggregateVersion) ||
        BigInt(after.checkpoint.appliedAggregateVersion) < BigInt(context.checkpoint.appliedAggregateVersion) ||
        BigInt(after.checkpoint.appliedAggregateVersion) < BigInt(beforeReceipt.checkpoint.appliedAggregateVersion)) {
      failure('CHECKPOINT_NOT_ADVANCED', 'replay');
    }
    try { await adapter.close(freeze({ ...saved, closure: 'CLOSED' })); }
    catch { return failure('STATE_IO_FAILED', 'replay'); }
    try { durable = await adapter.load(command.operationId); } catch { return failure('STATE_IO_FAILED', 'replay'); }
    if (canonicalize(durable) !== canonicalize({ ...saved, closure: 'CLOSED' })) failure('APPLY_NOT_DURABLE', 'replay');
    return { context, checkpointBefore: context.checkpoint, checkpointAfter: after.checkpoint,
      alreadyApplied: Boolean(context.appliedReceipt), businessApplied, receiptReused: Boolean(beforeReceipt.appliedReceipt) };
  }
  async function downloadSnapshot(event: ReleaseEvent, replayReleaseId?: string): Promise<DownloadedSnapshot> {
    requireEvent(event);
    const { data, response } = await request('download', () => client.GET(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content',
      { params: { path: { subscriptionId, snapshotId: event.snapshotId }, ...(replayReleaseId ? { query: { replayReleaseId } } : {}) }, parseAs: 'arrayBuffer' },
    ));
    if (response.headers.get('x-snapshot-id') !== event.snapshotId) failure('IDENTITY_MISMATCH', 'download');
    const handle = freeze({ event }) as DownloadedSnapshot;
    downloads.set(handle, { bytes: Buffer.from(data), digestHeader: response.headers.get('digest') });
    return handle;
  }
  function verifySnapshot(download: DownloadedSnapshot): VerifiedSnapshot {
    const content = downloads.get(download);
    if (!content) return failure('UNVERIFIED_INPUT', 'verify');
    const { event } = download;
    const digest = hash(content.bytes);
    if (digest !== event.snapshotArtifactDigest) failure('SNAPSHOT_DIGEST_MISMATCH', 'digest');
    if (content.digestHeader !== `sha-256=:${Buffer.from(digest, 'hex').toString('base64')}:`) {
      failure('SNAPSHOT_DIGEST_HEADER_MISMATCH', 'digest');
    }
    const contract = projectionContract(event);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content.bytes)); }
    catch { return failure('ENVELOPE_INVALID', 'envelope'); }
    if (!Check(contract.envelope, value) || !record(value)) failure('ENVELOPE_INVALID', 'envelope');
    // Explicitly validate the payload separately to preserve actionable failures.
    const envelope = value as { release: Record<string, unknown>; projectionContract: Record<string, unknown>; payload: unknown };
    if (envelope.release['releaseId'] !== event.releaseId || envelope.release['releaseNo'] !== event.aggregateVersion ||
        envelope.release['governanceObjectId'] !== event.governanceObjectId) failure('IDENTITY_MISMATCH', 'envelope');
    if (envelope.projectionContract['schemaDigest'] !== contract.schemaDigest) failure('SCHEMA_DIGEST_MISMATCH', 'envelope');
    if (!Check(contract.payload, envelope.payload)) failure('PAYLOAD_INVALID', 'payload');
    if (hash(canonicalize(envelope.payload)) !== event.projectionPayloadDigest) failure('PAYLOAD_DIGEST_MISMATCH', 'payload');
    const handle = freeze({ event, snapshot: value as CanonicalSnapshot }) as VerifiedSnapshot;
    verified.add(handle);
    return handle;
  }
  async function load(): Promise<ReleaseConsumerState> {
    let state;
    try { state = await store.load(); } catch { return failure('STATE_IO_FAILED', 'state'); }
    if (state === null) return { schemaVersion: 1, subscriptionId, appliedAggregateVersion: '0', appliedEvents: {} };
    if (!record(state) || state.schemaVersion !== 1 || state.subscriptionId !== subscriptionId ||
        typeof state.appliedAggregateVersion !== 'string' || !sequence.test(state.appliedAggregateVersion) || !record(state.appliedEvents)) {
      return failure('STATE_INVALID', 'state');
    }
    const seen = new Set<string>();
    for (const [key, event] of Object.entries(state.appliedEvents)) {
      if (!record(event) || key !== event.eventId || !uuid.test(event.eventId) || !uuid.test(event.snapshotId) ||
          typeof event.aggregateVersion !== 'string' || !/^[1-9]\d*$/u.test(event.aggregateVersion) ||
          BigInt(event.aggregateVersion) > BigInt(state.appliedAggregateVersion) || seen.has(event.aggregateVersion) ||
          !['APPLIED_PENDING_RECEIPT', 'CLOSED'].includes(event.closure) ||
          !Check(receiptBodySchema, receiptBody(event))) failure('STATE_INVALID', 'state');
      seen.add(event.aggregateVersion);
    }
    const ordered = [...seen].map(BigInt).sort((a, b) => a < b ? -1 : 1);
    if ((ordered.at(-1) ?? 0n) !== BigInt(state.appliedAggregateVersion) ||
        ordered.some((value, index) => index > 0 && value !== ordered[index - 1]! + 1n)) failure('STATE_INVALID', 'state');
    return { schemaVersion: 1, subscriptionId, appliedAggregateVersion: state.appliedAggregateVersion,
      appliedEvents: state.appliedEvents };
  }
  async function save(state: ReleaseConsumerState): Promise<void> {
    try { await store.save(state); } catch { failure('STATE_IO_FAILED', 'state'); }
  }
  function receiptBody(event: AppliedEventState) {
    return { eventId: event.eventId, receiveResult: 'ACCEPTED' as const, validationResult: 'VALID' as const,
      applyResult: 'APPLIED' as const, processingDigest: event.snapshotDigest, processedAt: event.processedAt };
  }
  function matches(event: ReleaseEvent, saved: AppliedEventState) {
    projectionContract(event);
    if (event.eventId !== saved.eventId || event.aggregateVersion !== saved.aggregateVersion ||
        event.snapshotId !== saved.snapshotId || event.snapshotArtifactDigest !== saved.snapshotDigest) failure('IDENTITY_MISMATCH', 'recovery');
  }
  function application(event: ReleaseEvent, saved: AppliedEventState | null): AppliedRelease {
    const handle = freeze({ event }) as AppliedRelease;
    applications.set(handle, saved);
    return handle;
  }
  async function apply(snapshot: VerifiedSnapshot): Promise<AppliedRelease> {
    if (!verified.has(snapshot)) failure('UNVERIFIED_INPUT', 'apply');
    const { event } = snapshot;
    const state = await load();
    const saved = state.appliedEvents[event.eventId];
    if (saved) matches(event, saved);
    const remote = await activeCheckpoint();
    if (saved) return application(event, saved);
    if (BigInt(event.aggregateVersion) <= BigInt(remote.appliedAggregateVersion)) return application(event, null);
    const baseline = BigInt(state.appliedAggregateVersion) > BigInt(remote.appliedAggregateVersion)
      ? state.appliedAggregateVersion : remote.appliedAggregateVersion;
    if (baseline !== '0' && BigInt(event.aggregateVersion) !== BigInt(baseline) + 1n) failure('EVENT_GAP', 'apply');
    // Do not apply later work while an earlier local commit still needs closure.
    if (Object.values(state.appliedEvents).some((e) => e.closure === 'APPLIED_PENDING_RECEIPT')) failure('EVENT_GAP', 'apply');
    let processedAt: string;
    try { processedAt = now(); } catch { return failure('STATE_INVALID', 'time'); }
    const pending: AppliedEventState = { eventId: event.eventId, aggregateVersion: event.aggregateVersion,
      snapshotId: event.snapshotId, snapshotDigest: event.snapshotArtifactDigest, processedAt, closure: 'APPLIED_PENDING_RECEIPT' };
    if (!Check(receiptBodySchema, receiptBody(pending))) failure('STATE_INVALID', 'time');
    const nextState = freeze({ ...state, appliedAggregateVersion: event.aggregateVersion,
      appliedEvents: { ...state.appliedEvents, [event.eventId]: pending } });
    try {
      const outcome = await callback(snapshot, nextState);
      // Untyped adapters must not turn a resolved failure value into success.
      if (outcome !== undefined) failure('APPLY_FAILED', 'apply');
    } catch { return failure('APPLY_FAILED', 'apply'); }
    const persisted = await load();
    if (persisted.appliedAggregateVersion !== nextState.appliedAggregateVersion ||
        canonicalize(persisted.appliedEvents) !== canonicalize(nextState.appliedEvents)) failure('APPLY_NOT_DURABLE', 'apply');
    return application(event, pending);
  }
  async function postReceipt(body: (ReturnType<typeof receiptBody> & { replay?: ReplayCommand & { subscriptionVersionId: string } }) | {
    eventId: string; receiveResult: 'ACCEPTED' | 'REJECTED'; validationResult: 'VALID' | 'INVALID';
    applyResult: 'NOT_APPLIED'; processingDigest: string; processedAt: string;
  }): Promise<ReceiptResult> {
    if (!Check(receiptBodySchema, body)) failure('STATE_INVALID', 'receipt');
    const { data } = await request('receipt', () => client.POST(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts',
      { params: { path: { subscriptionId } }, body },
    ));
    if (!Check(receiptResponseSchema, data)) failure('RESPONSE_INVALID', 'receipt');
    return data;
  }
  async function ackApplied(release: AppliedRelease): Promise<ReceiptResult | null> {
    if (!applications.has(release)) failure('UNVERIFIED_INPUT', 'receipt');
    const saved = applications.get(release);
    if (saved) {
      const current = (await load()).appliedEvents[release.event.eventId];
      if (!current) failure('STATE_INVALID', 'receipt');
      matches(release.event, current);
    }
    const before = await activeCheckpoint();
    let result: ReceiptResult | null = null;
    if (BigInt(before.appliedAggregateVersion) < BigInt(release.event.aggregateVersion)) {
      if (!saved) failure('STATE_INVALID', 'receipt');
      result = await postReceipt(receiptBody(saved));
      const after = await activeCheckpoint();
      if (BigInt(after.appliedAggregateVersion) < BigInt(release.event.aggregateVersion)) failure('CHECKPOINT_NOT_ADVANCED', 'checkpoint');
    }
    if (saved) {
      const state = await load();
      const current = state.appliedEvents[release.event.eventId];
      if (!current) failure('STATE_INVALID', 'receipt');
      matches(release.event, current);
      await save({ ...state, appliedEvents: { ...state.appliedEvents, [current.eventId]: { ...current, closure: 'CLOSED' } } });
    }
    return result;
  }
  async function consume() {
    let state = await load();
    await activeCheckpoint();
    let applied = 0;
    let receiptsClosed = 0;
    for (const saved of Object.values(state.appliedEvents).filter((e) => e.closure === 'APPLIED_PENDING_RECEIPT')
      .sort((a, b) => BigInt(a.aggregateVersion) < BigInt(b.aggregateVersion) ? -1 : 1)) {
      const event = await exact({ eventId: saved.eventId });
      matches(event, saved);
      await ackApplied(application(event, saved));
      receiptsClosed += 1;
    }
    state = await load();
    const remote = await activeCheckpoint();
    if (Object.values(state.appliedEvents).some((e) => e.closure === 'CLOSED' &&
      BigInt(e.aggregateVersion) > BigInt(remote.appliedAggregateVersion))) failure('CHECKPOINT_NOT_ADVANCED', 'checkpoint');
    const after = BigInt(state.appliedAggregateVersion) > BigInt(remote.appliedAggregateVersion)
      ? state.appliedAggregateVersion : remote.appliedAggregateVersion;
    for (const event of await poll(after)) {
      const snapshot = verifySnapshot(await downloadSnapshot(event));
      const result = await apply(snapshot);
      if (applications.get(result)?.closure === 'APPLIED_PENDING_RECEIPT') applied += 1;
      await ackApplied(result);
      receiptsClosed += 1;
    }
    return { applied, receiptsClosed };
  }
  return {
    inspectReplay,
    replayExactRelease: (command, adapter) => exclusive(() => replayExactRelease({ releaseId: command.releaseId,
      operationId: command.operationId, reason: command.reason }, adapter)),
    subscriptionId, poll, fetchExactRelease: exact, downloadSnapshot, verifySnapshot,
    apply: (snapshot) => exclusive(() => apply(snapshot)),
    ackApplied: (release) => exclusive(() => ackApplied(release)),
    async submitProcessingReceipt(snapshot, result) {
      const content = downloads.get(snapshot);
      if (!content) return failure('UNVERIFIED_INPUT', 'receipt');
      // VALID processing is available only after full verification. No APPLIED
      // input is accepted here, even from untyped JavaScript callers.
      if (result.validationResult === 'VALID') verifySnapshot(snapshot);
      let processedAt: string;
      try { processedAt = now(); } catch { return failure('STATE_INVALID', 'time'); }
      return postReceipt({ eventId: snapshot.event.eventId, receiveResult: result.receiveResult,
        validationResult: result.validationResult, applyResult: 'NOT_APPLIED',
        processingDigest: hash(content.bytes), processedAt });
    },
    getOperationalStatus: operational,
    getCheckpoint: async () => checkpoint(await operational()),
    consume: () => exclusive(consume), resume: () => exclusive(consume),
  };
}
