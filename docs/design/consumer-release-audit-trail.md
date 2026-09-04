# Consumer Release Audit Trail — PV-005-C-03

START_HEAD: `b3c9ae58dbec4e3d2429c06763b1613065f7d570`.
Branch: `prototype/phase-02-department-master`. C-02 DONE was verified from its
issue, delivery report and commit. Opening index/worktree clean; tracking branch
behind/ahead 0/0; local origin/main 0/57. No fetch or push.

Synthetic, non-production, Asia/Shanghai validation. This adds durable evidence,
not formal acceptance, certification, SIEM, retention deletion or production readiness.

## Existing infrastructure and storage decision

Reuse `audit.audit_event`. Migration 0001 already provides INSERT chain checking,
a unique stream/sequence pair and a trigger rejecting UPDATE/DELETE. Migration
0014 adds minimal JSON evidence and database recording time; 0016 retains the
local-time policy. The audit module serializes appends and hashes payload, actor,
governance identity, request/correlation and time into the existing chain.

Release events and snapshot bytes remain immutable release-distribution facts.
Outbox delivery/state/attempt records describe delivery; they cannot establish
downstream application. `consumer_receipt` and `consumer_checkpoint` remain their
existing business authorities. Subscription versions and compatibility evidence
continue to freeze the exact projection support used by a delivery.

Migration `0019_consumer_release_audit_indexes.sql` adds two indexes to the
existing audit table: stream/release/sequence and stream/action/sequence. There
is no new table, time column, dependency or database-type change. Previous
migrations are unchanged. Existing append-only and hash-chain protections apply.

## Evidence semantics

| Event | Source and meaning |
|---|---|
| `CONSUMER_RELEASE_OBSERVED` | SDK received and validated release metadata |
| `CONSUMER_SNAPSHOT_VERIFIED` | SDK completed digest, schema, envelope and payload checks |
| `CONSUMER_SNAPSHOT_VERIFICATION_FAILED` | Verification failed with a bounded code |
| `CONSUMER_APPLY_SUCCEEDED` | Consumer reports its durable local business commit |
| `CONSUMER_APPLY_FAILED` | Callback failed, or its durable outcome could not be established |
| `CONSUMER_RECEIPT_ACCEPTED` | Platform accepted a receipt, including reuse of an existing APPLIED receipt |
| `CONSUMER_RECEIPT_REJECTED` | Platform rejected the receipt request; business transaction rolled back |
| `CONSUMER_REPLAY_REQUESTED` | One real SDK replay invocation started |
| `CONSUMER_REPLAY_COMPLETED` | SDK verified receipt/checkpoint and durable local closure |
| `CONSUMER_REPLAY_FAILED` | Invocation failed at its recorded step |

Consumer reports carry `source=CONSUMER_REPORTED`; receipt events carry
`source=PLATFORM`. A successful report is not a receipt. Receipt acceptance with
`receiptApplyResult=NOT_APPLIED` does not claim application. Audit queries never
drive subscription state, receipt creation or checkpoint advancement.

Evidence includes subscription ID, frozen subscription version ID/number, owning
service principal, governance object, projection type/schema version, release
and event IDs, result, stage, bounded failure code, original/replay mode, replay
operation/attempt IDs, observed checkpoint and receipt reference when applicable.
The actor may differ from the owner on a cross-subscription denial. Unknown or
unassigned releases retain the submitted reference with unresolved version and
projection fields null; no foreign release metadata is retrieved.

Stages are OBSERVE, VERIFY, APPLY, RECEIPT, CHECKPOINT, REPLAY, STATE and AUDIT.
Failures use the closed taxonomy in `modules/audit/consumer-events.ts`, including
DIGEST_MISMATCH, SCHEMA_DIGEST_MISMATCH, LIFECYCLE_BLOCKED, CROSS_SUBSCRIPTION,
PROCESSING_DIGEST_MISMATCH, APPLY_FAILED and APPLY_OUTCOME_UNKNOWN.
No exception messages, free-text details, payloads, patient data, credentials or
Authorization are accepted into this evidence shape. Only the expected snapshot
digest is retained. New legacy replay completion records retain a reason digest
for operation identity, not the free-text reason; old C-02 records are unchanged
and remain recognized on retries.

`occurredAt` and `recordedAt` describe platform observation/recording. The distinct
`consumerOccurredAt` describes the reported consumer event, including an earlier
local commit recovered after restart. All use offset-free Asia/Shanghai local
date-times. Native stream sequence remains ordering authority. The read contract
allows stage omission for earlier prototype evidence; every new record emits it.

UUID request/correlation IDs are preserved. Unvalidated free-text header values
are replaced by generated UUIDs before these audit records are appended. Headers
and arbitrary client metadata are never copied into evidence.

## Transaction and recovery boundaries

Receipt insertion, delivery-state append, checkpoint advancement and accepted
audit commit in the same existing subscription-locked transaction. A reused
receipt is read and audited in that transaction without changing its ID or time.
Audit errors return `CONSUMER_AUDIT_UNAVAILABLE`; no success response is fabricated.
Receipt rejection evidence commits in a separate transaction after rollback.
If rejection evidence also fails, the response explicitly reports audit failure.

The SDK waits for observation and verification audit acknowledgements before
applying. `verifySnapshot()` therefore returns a Promise and callers must await it.
The consumer adapter atomically commits business effects plus its existing pending
marker, now including an apply-evidence outbox ID. SDK reloads that marker before
reporting apply success or sending a receipt. Resume resends the same durable
apply evidence before receipt closure; the platform deduplicates within the
subscription/action/evidence identity. Conflicting immutable input is rejected.

A consumer commit followed by audit/network failure leaves a pending marker and
returns a stable failure. A later explicit resume can append the missing evidence
without applying again. A callback that throws after committing is distinguished
by reloading the marker; successful local facts are not labelled a failed apply.
Unresolvable outcomes use APPLY_OUTCOME_UNKNOWN. This is a local outbox/recovery
boundary, not a distributed transaction or a claim of atomicity across a remote
platform and an external HIS database. Adapter single-writer/atomic-commit duties
remain required. The synthetic adapter keeps its existing local file mechanism.

Each actual replay invocation gets a fresh attempt ID, even when retrying the
same operation. Requested evidence precedes preflight/apply; successful and
handled failed invocations append their own terminal evidence. Dry-run uses only
read APIs and records no audit, following the existing ordinary-query policy.
Argument/configuration/lock failures before SDK invocation do not represent an
executed replay. Process death or complete network/database loss can leave a
requested attempt without a terminal event: this is unresolved evidence, never
synthetic completion. No background retry or timeout-based success is introduced.

The C-02 `CONSUMER_RELEASE_REPLAYED` record remains the receipt transaction's
operation-idempotence evidence. The new attempt events explain invocation outcome;
they do not replace that operation contract. B-03A lifecycle events remain in the
same existing stream and are not duplicated by C-03.

## Query and contract boundary

Two service-authorized consumer support paths are added:

- POST `/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-reports`
- GET `/v1/phase-01/consumer-subscriptions/{subscriptionId}/audit-events`

Only the exact subscription's active service identity can report/query. Inactive
subscriptions remain readable and can submit evidence of already completed or
failed work; this grants no consumption/receipt permission. Other service owners
are denied. The new endpoint cannot submit platform receipt events. Normal
Department Browser routes are unchanged.

Query defaults to 50 rows, allows 1–100, and uses exclusive `afterSequence` within
one stream. Optional release, projection, event-type and result filters are
closed and stable. Time filters must be paired, ordered, valid local date-times
and span at most 31 days. Cursor integers must fit PostgreSQL bigint. No unbounded
dump or audit mutation/delete route is provided.

TypeBox generates frozen OpenAPI and Generated Client. The C-03 delta guard allows
exactly these two new paths and zero changes to existing paths/components,
Department Browser APIs or canonical schemas. C-02's guard now checks its closed
commit; its historical allowlist is unchanged. SDK schemas are generated from
the frozen contract and the seven existing canonical digest pins.

## Validation

Run `npm run prototype:consumer:audit:validate` for the real Master/Hierarchy
audit/replay flow and `npm run contract:check-consumer-audit` for the API delta.
The flow exercises observed/verified/apply/receipt evidence, digest and apply
failure, cross-subscription denial, pagination/filter bounds, forged fields,
malicious correlation headers, deduplication/conflict, absent mutation routes,
database UPDATE/DELETE rejection, both transaction rollback directions, replay
terminals, inactive lifecycle refusal, chain verification and reopened-database
identity/hash persistence. Separate SDK tests cover lost audit acknowledgement,
durable recovery, receipt transport failure and repeated replay attempts.

Final command results, digest identity, resource closure and changed-file inventory
are recorded below after the candidate validation.


### Completed checks — 2026-09-04, Asia/Shanghai

The 17-command regression run in `.runtime/pv005-c03/validation-02` completed
with every exit code 0. A final four-command pass in `validation-03` rebuilt the
repository, reran typecheck and all repository gates, and reran the real C-03
Master/Hierarchy audit flow after the final module-input and sensitive-reason
checks. All four completed with exit 0. Per-command redacted logs and results
remain in those ignored directories; the earlier failing development run is
separate in `validation-01`.

| Check | Result |
|---|---|
| API, including Master/Hierarchy/SDK/Replay/Lifecycle/SLA/audit | 349/349, 24 files |
| SDK | 72/72 |
| Sim Consumer | 20/20 |
| CLI / independent-process recovery | 4/4 |
| Verification tooling | 714/714, 33 files |
| Seven-contract freeze/evolution | 20/20 |
| Build, complete typecheck, package/module/database authority, OpenAPI lint and delta gates | PASS |
| Prior migrations, Department sources, composition registry and canonical fixtures | 32 protected files unchanged |

The C-03 proof checks both rollback directions against PostgreSQL: failure after
audit INSERT rolls back receipt/checkpoint/delivery facts, and a subsequent
business rollback removes the new audit too. Actual UPDATE and DELETE attempts
are rejected by the existing database guard. REST mutation/delete routes are
absent. Consumer report deduplication preserves the original evidence; conflicting
time/identity is rejected. Cross-owner direct module calls cannot inject internal
denial/receipt fields. Stored audit rows, including legacy replay records, contain
neither the deliberately supplied sensitive reason nor malicious correlation text.

Container-based Phase-01 vertical-slice/fault/capacity and formal ABG acceptance
remain outside this prototype validation. No production or hospital integration
was attempted. Development failures were corrected: missing runtime-schema error
mapping, an old test counting the entire shared stream as lifecycle events, and
local runner invocation/encoding prerequisites. The lifecycle gate still requires
exactly five lifecycle events and validates the complete shared hash chain.

### Digests and persisted evidence

| Artifact | SHA-256 |
|---|---|
| openapi | `f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035` |
| migration0019 | `e412f39a25b4812bbc004260cc70bd504a88c1f6810cd37b37655eb13694edb9` |
| canonicalFixture | `04367946e70e95bed4c1898576b33827e3fa906610bc1826fbe1e5e65e3a17e9` |
| hdi.department-master | `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc` |
| hdi.department-hierarchy | `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372` |

The OpenAPI delta is two new paths, zero existing-path changes, zero component
changes, zero Department Browser changes and zero canonical schema changes.
Database authority reports migration count 19, forbidden timezone types 0 and
schema fingerprint `5ff1cb8dffdd8e17ebfd7c7b4362c204482dfcf91094b44acc2e441307e22d13`.
No external dependency or lockfile change.

| Final persisted stream | Consumer events | Requested / completed / failed | Checkpoint | Last audit hash |
|---|---:|---|---:|---|
| Master `01a06b9b-8841-7944-9f56-2014278ac6a8` | 39 | 7 / 3 / 4 | 275 | `a659c00a9a01fbd42e75a65690b65d3f214301d572b6bab4767d1affc7770857` |
| Hierarchy `01a06b9b-8864-7a4c-9f1c-ce96b616222e` | 39 | 7 / 3 / 4 | 116 | `d02bf0ff2e36e531f32c6288474e5a630038d7cba05cad399bb80ada6af9150a` |

Application shutdown and a separate reopened database connection confirmed all
listed event IDs/hashes and checkpoints. Application DB sessions were 0 and the
verification pool closed. Temporary consumer business-state files were removed
by the scenario cleanup; immutable synthetic PostgreSQL evidence and ignored logs
are retained. PostgreSQL was then stopped: service inactive, listener 55434 absent,
Linux keepalive PID 139 stopped, Windows launcher PID 20840
exited, task Node process count 0. Codex host tools were preserved.

### Delivery boundary and changed files (35)

Delivery is exactly one local commit, `feat(audit): add consumer release audit trail`.
Final commit SHA is reported in the task response. Before commit, branch/head were
rechecked against START_HEAD. After commit expected local tracking divergence is
behind 0 / ahead 1; local origin/main behind 0 / ahead 58. No fetch/push, tag,
subsequent ticket, external audit store or retention deletion is included.

- `.scratch/consumer-release-audit/issues/01-consumer-release-audit.md`
- `.scratch/consumer-release-audit/spec.md`
- `apps/governance-api/scripts/check-consumer-audit-openapi-diff.ts`
- `apps/governance-api/scripts/check-consumer-replay-openapi-diff.ts`
- `apps/governance-api/src/modules/audit/consumer-events.ts`
- `apps/governance-api/src/modules/audit/index.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-audit.integration.test.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-audit.ts`
- `apps/governance-api/src/modules/release-distribution/index.ts`
- `apps/governance-api/src/platform/fastify/consumer-audit-schemas.ts`
- `apps/governance-api/src/platform/fastify/map-http-error.ts`
- `apps/governance-api/src/platform/fastify/register-phase-01-routes.ts`
- `apps/sim-consumer/src/consumer.test.ts`
- `contracts/openapi/phase-01.openapi.json`
- `contracts/openapi/phase-01.openapi.sha256`
- `db/migrations/0019_consumer_release_audit_indexes.sql`
- `docs/design/consumer-release-audit-trail.md`
- `package.json`
- `packages/generated-api-client/src/schema.generated.ts`
- `packages/release-consumer-sdk/README.md`
- `packages/release-consumer-sdk/scripts/generate-contracts.mjs`
- `packages/release-consumer-sdk/src/consumer.compile-test.ts`
- `packages/release-consumer-sdk/src/consumer.test.ts`
- `packages/release-consumer-sdk/src/contracts.generated.ts`
- `packages/release-consumer-sdk/src/errors.ts`
- `packages/release-consumer-sdk/src/index.ts`
- `packages/release-consumer-sdk/src/replay.test.ts`
- `packages/release-consumer-sdk/src/types.ts`
- `tooling/prototype/check-consumer-audit-flow.ts`
- `tooling/prototype/check-consumer-lifecycle-flow.ts`
- `tooling/prototype/check-release-consumer-sdk-flow.ts`
- `tooling/prototype/consumer-replay-command.ts`
- `tooling/prototype/consumer-replay.test.ts`
- `tooling/prototype/run-department-consumer-flow.ts`
- `tooling/prototype/validate-department-consumer-flow.ts`
