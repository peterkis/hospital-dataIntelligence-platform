import { lstat, open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { ReplayAdapter, ReplayRecord, ReleaseConsumerState } from '@hospital-data-intelligence/release-consumer-sdk';

interface SyntheticReplayState extends ReleaseConsumerState {
  lastAppliedPayload: unknown; applyCount: number; replayApplyCount: number;
  replays: Record<string, ReplayRecord>;
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isMissing = (error: unknown) => error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** The existing synthetic consumer file is the business store, not an export.
 * Parent directory must already exist. A stale lock fails closed: no force or
 * automatic lock stealing is provided. Ordinary consumer must be stopped. */
export async function openSyntheticReplayAdapter(path: string, subscriptionId: string) {
  if (!isAbsolute(path) || !path.endsWith('.json')) throw new Error('REPLAY_CONFIGURATION_INVALID');
  const statePath = resolve(path); const lockPath = `${statePath}.replay.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('REPLAY_LOCKED'); }
  async function load(): Promise<SyntheticReplayState> {
    try {
      const stat = await lstat(statePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 33_554_432) throw new Error('REPLAY_STATE_INVALID');
      const state: unknown = JSON.parse(await readFile(statePath, 'utf8'));
      if (!record(state) || state['schemaVersion'] !== 1 || state['subscriptionId'] !== subscriptionId ||
          typeof state['appliedAggregateVersion'] !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(state['appliedAggregateVersion']) ||
          !record(state['appliedEvents']) || !Number.isSafeInteger(state['applyCount']) || Number(state['applyCount']) < 0 ||
          (state['replayApplyCount'] !== undefined && (!Number.isSafeInteger(state['replayApplyCount']) || Number(state['replayApplyCount']) < 0)) ||
          (state['replays'] !== undefined && !record(state['replays']))) throw new Error('REPLAY_STATE_INVALID');
      return { ...state, replays: state['replays'] ?? {}, replayApplyCount: state['replayApplyCount'] ?? 0 } as SyntheticReplayState;
    } catch (error) {
      if (isMissing(error)) return { schemaVersion: 1, subscriptionId, appliedAggregateVersion: '0', appliedEvents: {},
        lastAppliedPayload: null, applyCount: 0, replayApplyCount: 0, replays: {} };
      throw new Error('REPLAY_STATE_INVALID');
    }
  }
  async function save(state: SyntheticReplayState) {
    const bytes = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(bytes) > 33_554_432 || Object.keys(state.replays).length > 1000) throw new Error('REPLAY_STATE_INVALID');
    const temporary = `${statePath}.replay.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try {
      try { await file.writeFile(bytes, 'utf8'); await file.sync(); } finally { await file.close(); }
      await rename(temporary, statePath);
    } catch {
      await unlink(temporary).catch(() => {}); // Only the temporary file just created by this writer.
      throw new Error('REPLAY_STATE_IO_FAILED');
    }
  }
  const adapter: ReplayAdapter = {
    async load(operationId) { return (await load()).replays[operationId] ?? null; },
    async commit(snapshot, marker) {
      const state = await load();
      if (state.replays[marker.operationId]) throw new Error('REPLAY_STATE_INVALID');
      await save({ ...state, lastAppliedPayload: snapshot.snapshot.payload, replayApplyCount: state.replayApplyCount + 1,
        replays: { ...state.replays, [marker.operationId]: marker } });
    },
    async close(marker) {
      const state = await load();
      if (!state.replays[marker.operationId]) throw new Error('REPLAY_STATE_INVALID');
      await save({ ...state, replays: { ...state.replays, [marker.operationId]: marker } });
    },
  };
  return { adapter, async close() { await lock.close(); await unlink(lockPath); } };
}
