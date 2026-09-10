import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer, type ReleaseConsumerState, type ProjectionSupport } from '@hospital-data-intelligence/release-consumer-sdk';

let state: ReleaseConsumerState | null = null;
const master: ProjectionSupport = { projectionType: 'hdi.department-master', projectionSchemaVersion: '1' };
const hierarchy: ProjectionSupport = { projectionType: 'hdi.department-hierarchy', projectionSchemaVersion: '1' };
// @ts-expect-error An undeclared Department version must not compile.
const unsupported: ProjectionSupport = { projectionType: 'hdi.department-master', projectionSchemaVersion: '2' };
void unsupported;
const consumer = createReleaseConsumer({
  client: createGovernanceApiClient({ baseUrl: 'http://127.0.0.1' }), subscriptionId: 'synthetic',
  supportedProjections: [master, hierarchy], now: () => '2026-09-04T10:00:00',
  state: { async load() { return state; }, async save(next) { state = next; } },
  async apply(snapshot, next) { void snapshot.snapshot.payload; state = next; },
});
async function contract() {
  const event = await consumer.fetchExactRelease({ releaseId: 'synthetic' });
  const downloaded = await consumer.downloadSnapshot(event);
  const verified = await consumer.verifySnapshot(downloaded);
  await consumer.ackApplied(await consumer.apply(verified));
  await consumer.submitProcessingReceipt(downloaded, { receiveResult: 'ACCEPTED', validationResult: 'VALID' });
  await consumer.getCheckpoint(); await consumer.resume();
  await consumer.inspectReplay({ releaseId: 'synthetic' });
  const replayAdapter = { async load() { return null; }, async commit() {}, async close() {} };
  await consumer.replayExactRelease({ releaseId: 'synthetic', operationId: 'synthetic', reason: 'Synthetic repair' }, replayAdapter);
  // @ts-expect-error A replay needs an explicit operation identity and reason.
  await consumer.replayExactRelease({ releaseId: 'synthetic' }, replayAdapter);
  // @ts-expect-error No force bypass of lifecycle governance.
  await consumer.replayExactRelease({ releaseId: 'synthetic', operationId: 'synthetic', reason: 'Repair', force: true }, replayAdapter);
  // @ts-expect-error Raw events cannot bypass verification.
  await consumer.apply(event);
  // @ts-expect-error Verified bytes do not prove callback commit.
  await consumer.ackApplied(verified);
  // @ts-expect-error No consumer self-service provisioning.
  consumer.subscribe();
  // @ts-expect-error Processing receipt cannot assert APPLIED.
  await consumer.submitProcessingReceipt(downloaded, { receiveResult: 'ACCEPTED', validationResult: 'VALID', applyResult: 'APPLIED' });
}
void contract;
