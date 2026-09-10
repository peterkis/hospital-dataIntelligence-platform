import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, ReleaseConsumerError,
  type ProjectionSupport, type ReleaseConsumerState, type ReplayRecord } from '@hospital-data-intelligence/release-consumer-sdk';

interface SyntheticState extends ReleaseConsumerState { readonly lastAppliedPayload: unknown; readonly applyCount: number;
  readonly replays?: Record<string, ReplayRecord>; readonly replayApplyCount?: number }
export interface SimulatedConsumerOptions {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly subscriptionId: string;
  readonly statePath: string;
  readonly expectedProjectionType?: string;
  readonly expectedProjectionSchemaVersion?: string;
  /** Synthetic failure injection; never part of the SDK application contract. */
  readonly failurePoint?: 'BEFORE_APPLY' | 'AFTER_APPLY';
  readonly fetch?: typeof globalThis.fetch;
  now(): string;
}
const supported: readonly ProjectionSupport[] = [
  { projectionType: 'hdi.charge-catalog', projectionSchemaVersion: '1' },
  { projectionType: 'hdi.charge-catalog', projectionSchemaVersion: '2' },
  { projectionType: 'hdi.price-list', projectionSchemaVersion: '0' },
  { projectionType: 'hdi.price-list', projectionSchemaVersion: '1' },
  { projectionType: 'hdi.price-list', projectionSchemaVersion: '2' },
  { projectionType: 'hdi.department-master', projectionSchemaVersion: '1' },
  { projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '1' },
];

export async function runSimulatedConsumerOnce(options: SimulatedConsumerOptions) {
  let lastAppliedPayload: unknown = null;
  let applyCount = 0;
  let replayMetadata: Pick<SyntheticState, 'replays' | 'replayApplyCount'> = {};
  const consumer = createReleaseConsumer({
    client: createGovernanceApiClient({ baseUrl: options.baseUrl, accessToken: options.accessToken,
      ...(options.fetch ? { fetch: options.fetch } : {}) }),
    subscriptionId: options.subscriptionId,
    supportedProjections: supported.filter((pair) =>
      (options.expectedProjectionType === undefined || pair.projectionType === options.expectedProjectionType) &&
      (options.expectedProjectionSchemaVersion === undefined || pair.projectionSchemaVersion === options.expectedProjectionSchemaVersion)),
    now: options.now,
    state: {
      async load() {
        try {
          const state = JSON.parse(await readFile(options.statePath, 'utf8')) as SyntheticState;
          lastAppliedPayload = state.lastAppliedPayload;
          applyCount = state.applyCount ?? Object.keys(state.appliedEvents).length;
          replayMetadata = { ...(state.replays ? { replays: state.replays } : {}),
            ...(state.replayApplyCount !== undefined ? { replayApplyCount: state.replayApplyCount } : {}) };
          return state;
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
          throw new ReleaseConsumerError('STATE_IO_FAILED', 'state');
        }
      },
      async save(state) { await writeStateAtomically(options.statePath, { ...state, ...replayMetadata, lastAppliedPayload, applyCount }); },
    },
    async apply(snapshot, nextState) {
      if (options.failurePoint === 'BEFORE_APPLY') throw new Error('SYNTHETIC_BEFORE_APPLY');
      // One atomic replacement commits both synthetic business state and the
      // recovery marker. The SDK owns no consumer database transaction.
      lastAppliedPayload = snapshot.snapshot.payload;
      applyCount += 1;
      await writeStateAtomically(options.statePath, { ...nextState, ...replayMetadata, lastAppliedPayload, applyCount });
      if (options.failurePoint === 'AFTER_APPLY') throw new Error('SYNTHETIC_AFTER_APPLY');
    },
  });
  return consumer.consume();
}

async function writeStateAtomically(path: string, state: SyntheticState): Promise<void> {
  const temporaryPath = `${path}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}
