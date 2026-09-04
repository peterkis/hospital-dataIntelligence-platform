# Release Consumer SDK

Private Node.js ESM workspace: `@hospital-data-intelligence/release-consumer-sdk`.
PV-005-C-01 verification uses synthetic, non-production data and Asia/Shanghai
local date/time. This package does not claim a production adapter integration.

## Contract boundary

```text
Domain TypeBox → frozen OpenAPI → Generated Client → Consumer SDK → Consumer Adapter
```

The SDK accepts `createGovernanceApiClient(...)`. Every network operation uses
that client's typed GET/POST methods. It does not provision subscriptions, change
lifecycle/support declarations, access server modules, or connect to a database.
An authorized governance operator provisions the subscription first. The adapter
supplies its service credentials through the generated client, the subscription
ID, exact supported projection pairs, and optionally the expected governance
object ID. Snapshot handles are bound to the SDK instance and subscription.

`scripts/generate-contracts.mjs` derives validation schemas from frozen OpenAPI.
The existing B-03C seven-contract fixture supplies published canonical schema
digest pins, guarded by its existing whole-file SHA-256. Swagger removes `$id`
and normalizes `const` on legacy Charge/Price schemas, so the transformed OpenAPI
schema cannot be hashed as their original canonical TypeBox schema. The fixture
pins are immutable identity evidence, not a second editable schema registry.
Department schemas survive that transformation exactly. B-03C still verifies all
seven pins against domain-owned schemas and exact canonical artifact bytes.
The generated bundle is data only and has no runtime server imports.

Run `npm run contract:check-consumer-sdk` from the repository root to check
generation drift, package exports, dependency boundaries and import cycles.
Regeneration is `npm run contract:generate --workspace
@hospital-data-intelligence/release-consumer-sdk`; changing a published pin to
make a failure pass is forbidden. Build with root `npm run build`, which builds
Generated Client, SDK, then its consumer. Only the public `.` export is available.
Like Generated Client, the private workspace exposes source types for checks
before a build and runtime JavaScript from `dist`. Declarations are also emitted
deterministically. No npm publication is part of this task.

## Application and persistence

```ts
import { createGovernanceApiClient } from '@hospital-data-intelligence/generated-api-client';
import { createReleaseConsumer } from '@hospital-data-intelligence/release-consumer-sdk';

const consumer = createReleaseConsumer({
  client: createGovernanceApiClient({ baseUrl, accessToken }),
  subscriptionId,
  expectedGovernanceObjectId: governanceObjectId,
  supportedProjections: [
    { projectionType: 'hdi.department-master', projectionSchemaVersion: '1' },
  ],
  state: localStateStore,
  now: nowInAsiaShanghai,
  async apply(verified, nextState) {
    // Adapter-owned transaction: business writes AND nextState must commit
    // atomically. A thrown error must never be converted to apparent success.
    await localAdapter.commitAtomically(verified.snapshot.payload, nextState);
  },
});
await consumer.consume(); // One bounded pass; no background scheduler.
// A new process creates a new instance with the SAME durable state store:
await consumer.resume();
```

`localStateStore.load()` returns the durable SDK state or null only for a truly
absent state. `save()` atomically records receipt closure. `apply()` must commit
the application changes and supplied `nextState` together, including the
`APPLIED_PENDING_RECEIPT` marker. The SDK reloads that marker after callback
success and refuses APPLIED if it is absent or inconsistent. The callback resolves
with no value on success; an explicit failure return from JavaScript also fails
closed. An HTTP 200 response
from an adapter is not evidence of durable business application.

Use one writer per subscription and state store, including across processes.
The SDK rejects overlapping consume/apply/ack calls on the same instance; the
adapter owns cross-process exclusion and its database transaction. An adapter
unable to combine business writes and the marker must provide a durable,
idempotent application operation keyed by subscription/event before using this
boundary. The SDK cannot manufacture exactly-once side effects across systems.

The Sim Consumer implements this boundary with one atomic rename containing its
synthetic payload, apply counter and SDK state. It retains the previous version-1
state layout and pending receipt recovery. See
`apps/sim-consumer/src/consumer.ts` for the executable adapter.

## Public primitives

| API | Behavior |
|---|---|
| `poll(afterAggregateVersion = '0')` | Read the subscription's assigned events; preserve order and filter entries at/below the supplied cursor. `consume` uses the durable/server checkpoint automatically. |
| `fetchExactRelease({releaseId})` / `({eventId})` | Resolve exactly one authorized event using the existing events operation with cursor 0, including delivered history. Missing/blocked events fail. The existing API returns the full assigned backlog; no exact server shortcut was added. |
| `downloadSnapshot(event)` | Download via Generated Client and bind the HTTP snapshot identity to that event. Raw bytes and transport details remain private. |
| `verifySnapshot(downloaded)` | Verify content and HTTP SHA-256, exact projection/version and published schema digest, closed envelope, canonical payload schema and payload digest. Return an immutable, opaque verified handle. |
| `apply(verified)` | Check sequence/checkpoint, invoke the adapter callback once, and require its durable pending marker. Return an opaque applied handle; already completed events skip business application. |
| `ackApplied(applied)` | Submit APPLIED from durable application evidence, confirm checkpoint progression, then persist closure. Return null when checkpoint already proves completion. |
| `submitProcessingReceipt(downloaded, result)` | Construct NOT_APPLIED processing evidence. VALID requires full verification. This API cannot assert APPLIED. |
| `getOperationalStatus()` | Read the existing SERVICE-authorized lifecycle/SLA metadata, including while inactive. |
| `getCheckpoint()` | Read the existing operational checkpoint; absent checkpoint is sequence 0. |
| `consume()` / `resume()` | Recover pending receipts first, then process newer events in order, stopping at the first failure. |

The HTTP identity check precedes digest verification. Schema selection and
payload interpretation occur after content verification. Envelope release
identity must also match the expected event before any application. No failure
in identity, digest, schema, envelope, payload or callback validation sends
APPLIED or advances the server checkpoint.

The exported `ReleaseEvent`, `CanonicalSnapshot`, `ProjectionSupport`,
`ConsumerOperationalStatus` and receipt result types derive from Generated
Client operations. `DownloadedSnapshot`, `VerifiedSnapshot`, `AppliedRelease`,
`ReleaseConsumerState`, `ReleaseConsumerStateStore`, `ReleaseConsumerOptions`,
`ConsumptionResult` and `ReleaseConsumerError` describe the application boundary.
Positive and negative compile tests use the public package export; runtime
capability checks also reject forged/cross-instance handles from JavaScript.

## Recovery and errors

| Interruption | Restart |
|---|---|
| Verified, before application | No marker and no receipt; download, verify and apply again. |
| Application committed, before receipt | Reload pending marker; resolve original event and send its receipt without reapplying. |
| Receipt accepted, response or local closure lost | Read server checkpoint and close local pending state without reapplying or resending an unnecessary receipt. |
| Receipt succeeded, checkpoint read failed | Preserve pending state; the outcome is uncertain until the next explicit resume. |
| Local state absent, server checkpoint exists | Filter older releases using that checkpoint. This does not reconstruct a lost business database; local data restore/rebuild is adapter responsibility. |

Server receipts are append-only attempts. Repeating a qualifying APPLIED receipt
is idempotent with respect to application/checkpoint progression, not receipt row
identity. The SDK checks checkpoint before sending and retains the original
processedAt/digest across recovery. The server's `hasAppliedReceipt` is an
internal release-wide query; the SDK uses the existing subscription-specific
checkpoint and does not pretend to expose a new receipt lookup endpoint.

`ReleaseConsumerError.code` is a closed stable union. Lifecycle refusal resolves
to `SUSPENDED`, `REVOKED` or `ARCHIVED` through at most one operational read;
if that read fails, the original `CONSUMER_SUBSCRIPTION_NOT_ACTIVE` denial is
preserved. No lifecycle error is treated as transient network jitter. Raw
exceptions, bodies, headers and causes are never attached or logged. Error codes
identify digest, schema, identity, callback, state, receipt and checkpoint failures.

SLA is metadata. The SDK has no timer, retry daemon, alerting, hospital policy,
subscription management, replay CLI or automatic lifecycle bypass. Exact-release
primitives are available for a separately authorized replay adapter.

## C-02 explicit Consumer Release Replay

`inspectReplay({releaseId})` performs a read-only, bounded exact-release lookup
and full snapshot verification without calling the events endpoint (which records
pull offers). Its context contains the delivery's frozen subscription version,
exact receipt facts and current checkpoint. `replayExactRelease({releaseId,
operationId, reason}, adapter)` explicitly repairs even a release older than the
checkpoint. Ordinary apply/consume/resume semantics do not change.

The `ReplayAdapter` atomically commits business repair and a `ReplayRecord` in
`APPLIED_PENDING_RECEIPT`, loads durable records by operation ID and persists
closure. Reuse one operation ID and unchanged inputs after a transport error;
an intentional new repair uses a new ID. Reuse preserves APPLIED receipt identity
and adds one idempotent, hash-chained server audit for the explicit operation.
Lifecycle and monotonic checkpoints remain fail-closed. The adapter still owns
cross-process single-writer control. The synthetic CLI, safe defaults, bounds,
configuration and recovery limitations are documented in
[`consumer-release-replay-cli.md`](../../docs/design/consumer-release-replay-cli.md).
