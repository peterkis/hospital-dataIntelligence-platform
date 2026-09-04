import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, ReleaseConsumerError, type ReplayAdapter, type ReplayContext } from '@hospital-data-intelligence/release-consumer-sdk';
import { openSyntheticReplayAdapter } from './consumer-replay-store.js';

export interface ReplayArguments {
  readonly mode: 'DRY_RUN' | 'APPLY'; readonly subscriptionId: string; readonly releaseId: string;
  readonly operationId?: string; readonly reason?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const argumentError = () => new Error('REPLAY_ARGUMENT_INVALID');
export function parseReplayArguments(args: readonly string[]): ReplayArguments {
  const fields: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (Object.hasOwn(fields, key)) throw argumentError();
    if (key === '--apply' || key === '--dry-run') { fields[key] = 'true'; continue; }
    if (!['--subscription-id', '--release-id', '--operation-id', '--reason'].includes(key)) throw argumentError();
    const value = args[++i];
    if (!value || value.startsWith('--')) throw argumentError();
    fields[key] = value;
  }
  const subscriptionId = fields['--subscription-id']; const releaseId = fields['--release-id'];
  const operationId = fields['--operation-id']; const reason = fields['--reason'];
  if (!subscriptionId || !releaseId || !uuid.test(subscriptionId) || !uuid.test(releaseId) ||
      (operationId !== undefined && !uuid.test(operationId)) || (reason !== undefined &&
      (reason.trim().length === 0 || reason.length > 256 || /[\u0000-\u001f\u007f<>]/u.test(reason))) ||
      (fields['--apply'] && (fields['--dry-run'] || !operationId || !reason))) throw argumentError();
  return { mode: fields['--apply'] ? 'APPLY' : 'DRY_RUN', subscriptionId, releaseId,
    ...(operationId ? { operationId } : {}), ...(reason ? { reason } : {}) };
}

export async function runConsumerReplay(args: readonly string[], environment: NodeJS.ProcessEnv = process.env) {
  const command = parseReplayArguments(args);
  const baseUrl = environment['HDI_REPLAY_BASE_URL'];
  const accessToken = environment['HDI_REPLAY_ACCESS_TOKEN'];
  const statePath = environment['HDI_REPLAY_STATE_PATH'];
  let url: URL;
  try { url = new URL(baseUrl ?? ''); } catch { throw new Error('REPLAY_CONFIGURATION_INVALID'); }
  if (environment['NODE_ENV']?.toLowerCase() === 'production' || url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !accessToken ||
      (command.mode === 'APPLY' && !statePath)) throw new Error('REPLAY_CONFIGURATION_INVALID');
  const consumer = createReleaseConsumer({
    client: createGovernanceApiClient({ baseUrl: url.origin, accessToken }), subscriptionId: command.subscriptionId,
    supportedProjections: [{ projectionType: 'hdi.department-master', projectionSchemaVersion: '1' },
      { projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '1' }],
    now: nowShanghai,
    // Ordinary consumption is intentionally unavailable in this tool.
    state: { async load() { throw new Error('REPLAY_ONLY'); }, async save() { throw new Error('REPLAY_ONLY'); } },
    async apply() { throw new Error('REPLAY_ONLY'); },
  });
  const common = { status: 'PASSED', mode: command.mode, eligible: true, synthetic: true, production: false,
    timezone: 'Asia/Shanghai', subscriptionId: command.subscriptionId, releaseId: command.releaseId };
  const summary = (context: ReplayContext) => ({ servicePrincipalId: context.servicePrincipalId,
    subscriptionVersionId: context.subscriptionVersion.subscriptionVersionId, versionNo: context.subscriptionVersion.versionNo,
    projectionType: context.event.projectionType, projectionSchemaVersion: context.event.projectionSchemaVersion,
    schemaDigest: context.event.projectionSchemaDigest, processingDigest: context.event.snapshotArtifactDigest,
    eventId: context.event.eventId, releaseNo: context.event.aggregateVersion, snapshotId: context.event.snapshotId,
    receiptState: context.latestReceipt?.applyResult ?? 'NONE', appliedReceiptId: context.appliedReceipt?.receiptId ?? null });
  if (command.mode === 'DRY_RUN') {
    const { context } = await consumer.inspectReplay(command);
    return { ...common, ...summary(context), alreadyApplied: Boolean(context.appliedReceipt), businessApplied: false,
      checkpointBefore: context.checkpoint.appliedAggregateVersion, checkpointAfter: context.checkpoint.appliedAggregateVersion,
      checkpointChanged: false };
  }
  // All read-only checks precede even opening the local write lock.
  await consumer.inspectReplay(command);
  const store = await openSyntheticReplayAdapter(statePath!, command.subscriptionId);
  try {
    const result = await consumer.replayExactRelease({ releaseId: command.releaseId,
      operationId: command.operationId!, reason: command.reason! }, store.adapter satisfies ReplayAdapter);
    return { ...common, ...summary(result.context), operationId: command.operationId, alreadyApplied: result.alreadyApplied,
      businessApplied: result.businessApplied, receiptReused: result.receiptReused,
      checkpointBefore: result.checkpointBefore.appliedAggregateVersion, checkpointAfter: result.checkpointAfter.appliedAggregateVersion,
      checkpointChanged: result.checkpointBefore.appliedAggregateVersion !== result.checkpointAfter.appliedAggregateVersion };
  } finally { await store.close(); }
}

export function replayFailure(error: unknown) {
  const localCodes = ['REPLAY_ARGUMENT_INVALID', 'REPLAY_CONFIGURATION_INVALID', 'REPLAY_STATE_INVALID', 'REPLAY_STATE_IO_FAILED', 'REPLAY_LOCKED'];
  const errorCode = error instanceof ReleaseConsumerError ? error.code : error instanceof Error && localCodes.includes(error.message)
    ? error.message : 'REPLAY_FAILED';
  return { status: 'FAILED', eligible: false, errorCode };
}
function nowShanghai() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
}
