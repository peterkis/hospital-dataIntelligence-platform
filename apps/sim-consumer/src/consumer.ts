import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';

interface AppliedEventState {
  readonly eventId: string;
  readonly aggregateVersion: string;
  readonly snapshotId: string;
  readonly snapshotDigest: string;
  readonly processedAt: string;
  readonly closure: 'APPLIED_PENDING_RECEIPT' | 'CLOSED';
}

interface ConsumerState {
  readonly schemaVersion: 1;
  readonly subscriptionId: string;
  readonly appliedAggregateVersion: string;
  readonly appliedEvents: Record<string, AppliedEventState>;
  readonly lastAppliedPayload: unknown;
}

export interface SimulatedConsumerOptions {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly subscriptionId: string;
  readonly statePath: string;
  now(): string;
}

export async function runSimulatedConsumerOnce(
  options: SimulatedConsumerOptions,
): Promise<{ readonly applied: number; readonly receiptsClosed: number }> {
  const client = createGovernanceApiClient({
    baseUrl: options.baseUrl,
    accessToken: options.accessToken,
  });
  let state = await readState(options.statePath, options.subscriptionId);
  let receiptsClosed = 0;

  for (const pending of Object.values(state.appliedEvents)
    .filter((event) => event.closure === 'APPLIED_PENDING_RECEIPT')
    .sort((left, right) => compareSequence(left.aggregateVersion, right.aggregateVersion))) {
    await sendReceipt(client, options.subscriptionId, pending);
    state = closeReceipt(state, pending.eventId);
    await writeStateAtomically(options.statePath, state);
    receiptsClosed += 1;
  }

  const eventResponse = await client.GET(
    '/v1/phase-01/consumer-subscriptions/{subscriptionId}/events',
    {
      params: {
        path: { subscriptionId: options.subscriptionId },
        query: { afterAggregateVersion: state.appliedAggregateVersion },
      },
    },
  );
  if (eventResponse.error) throw new Error('SIM_CONSUMER_EVENT_QUERY_FAILED');
  let applied = 0;

  for (const event of eventResponse.data.events) {
    const expectedVersion = (BigInt(state.appliedAggregateVersion) + 1n).toString();
    const hasEstablishedBaseline =
      state.appliedAggregateVersion !== '0' || Object.keys(state.appliedEvents).length > 0;
    if (hasEstablishedBaseline && event.aggregateVersion !== expectedVersion) {
      throw new Error('SIM_CONSUMER_EVENT_GAP');
    }
    const existing = state.appliedEvents[event.eventId];
    if (existing?.closure === 'CLOSED') continue;

    const snapshotResponse = await client.GET(
      '/v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content',
      {
        params: {
          path: {
            subscriptionId: options.subscriptionId,
            snapshotId: event.snapshotId,
          },
        },
        parseAs: 'arrayBuffer',
      },
    );
    if (snapshotResponse.error) throw new Error('SIM_CONSUMER_SNAPSHOT_DOWNLOAD_FAILED');
    const snapshotBytes = Buffer.from(snapshotResponse.data);
    const snapshotDigest = createHash('sha256').update(snapshotBytes).digest('hex');
    if (snapshotDigest !== event.snapshotArtifactDigest) {
      throw new Error('SIM_CONSUMER_SNAPSHOT_DIGEST_MISMATCH');
    }
    const artifact = parseSnapshot(snapshotBytes);
    const appliedEvent: AppliedEventState = {
      eventId: event.eventId,
      aggregateVersion: event.aggregateVersion,
      snapshotId: event.snapshotId,
      snapshotDigest,
      processedAt: options.now(),
      closure: 'APPLIED_PENDING_RECEIPT',
    };
    state = {
      ...state,
      appliedAggregateVersion: event.aggregateVersion,
      appliedEvents: { ...state.appliedEvents, [event.eventId]: appliedEvent },
      lastAppliedPayload: artifact.payload,
    };
    await writeStateAtomically(options.statePath, state);
    applied += 1;

    await sendReceipt(client, options.subscriptionId, appliedEvent);
    state = closeReceipt(state, event.eventId);
    await writeStateAtomically(options.statePath, state);
    receiptsClosed += 1;
  }

  return { applied, receiptsClosed };
}

function parseSnapshot(bytes: Buffer): { readonly payload: unknown } {
  const parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!isRecord(parsed) || !('payload' in parsed)) throw new Error('SIM_CONSUMER_SNAPSHOT_SCHEMA_INVALID');
  return { payload: parsed['payload'] };
}

async function sendReceipt(
  client: ReturnType<typeof createGovernanceApiClient>,
  subscriptionId: string,
  event: AppliedEventState,
): Promise<void> {
  const response = await client.POST(
    '/v1/phase-01/consumer-subscriptions/{subscriptionId}/receipts',
    {
      params: { path: { subscriptionId } },
      body: {
        eventId: event.eventId,
        receiveResult: 'ACCEPTED',
        validationResult: 'VALID',
        applyResult: 'APPLIED',
        processingDigest: event.snapshotDigest,
        processedAt: event.processedAt,
      },
    },
  );
  if (response.error) throw new Error('SIM_CONSUMER_RECEIPT_FAILED');
}

async function readState(path: string, subscriptionId: string): Promise<ConsumerState> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as ConsumerState;
    if (parsed.schemaVersion !== 1 || parsed.subscriptionId !== subscriptionId) {
      throw new Error('SIM_CONSUMER_STATE_IDENTITY_MISMATCH');
    }
    return parsed;
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        schemaVersion: 1,
        subscriptionId,
        appliedAggregateVersion: '0',
        appliedEvents: {},
        lastAppliedPayload: null,
      };
    }
    throw error;
  }
}

async function writeStateAtomically(path: string, state: ConsumerState): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

function closeReceipt(state: ConsumerState, eventId: string): ConsumerState {
  const event = state.appliedEvents[eventId];
  if (!event) throw new Error('SIM_CONSUMER_EVENT_STATE_MISSING');
  return {
    ...state,
    appliedEvents: {
      ...state.appliedEvents,
      [eventId]: { ...event, closure: 'CLOSED' },
    },
  };
}

function compareSequence(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
