# Consumer Operational Metrics — PV-005-C-04

START_HEAD: `6c8b4e43cc6daf8aa5c52a8258b875fd3317b4b7`.
Branch: `prototype/phase-02-department-master`. C-01/C-02/C-03 DONE and clean
index/worktree verified. Opening local tracking behind/ahead 0/0, origin/main
0/58. Synthetic/non-production only; Asia/Shanghai. No real HIS/EMR.

## Existing facilities and transaction boundary

Search covered apps, packages, tooling, docs, local specifications and dependency
manifests for metrics, telemetry, observability, Prometheus, OpenTelemetry,
/metrics and logging instrumentation. Existing dashboard counts and verification
container-stat fields are not an application metric registry. No existing metric
naming convention, collector or exporter was found. This change adds a small
closed text renderer and reuses the committed Release/Receipt/Audit facts.
No dependency, migration, worker or monitoring server is added.

Release registration writes the release, canonical snapshot, members, Outbox and
compatibility/delivery facts inside the caller's publication transaction. Audit
and domain confirmation are in that same transaction. Outbox notification and
retry are later transactions (ADRs 0080/0086/0093). The release counter reads only
committed release/snapshot/event triples, once per release. There is no increment
before COMMIT, post-commit crash window or callback-based counter. Sequence gaps
from rollback are not counted. Notification retries cannot create a release.

All counters are reconstructed from durable facts in a read-only REPEATABLE READ
transaction, with a 5-second per-statement timeout. Audit owns its aggregate SQL;
release-distribution owns release/operational SQL; the composition root joins
their bounded results. Individual IDs never leave either metric query seam.
Kysely's transaction behavior was checked against its
[PostgreSQL driver](https://github.com/kysely-org/kysely/blob/master/src/dialect/postgres/postgres-driver.ts).

## Contract

Every family has `projection_type` and `projection_schema_version`. Only pairs
from the composition root's frozen seven-contract registry are emitted, plus one
fixed `unknown@unknown` bucket for failures without a resolved assigned release.
No projection label is copied unchecked from a request or audit payload.

| Metric | Type | Additional labels | Set/increment meaning | Must NOT mean |
|---|---|---|---|---|
| `release_publish_total` | counter | none | Count committed canonical releases across retained history | A publication attempt, sequence allocation, rollback, notification or Outbox retry |
| `consumer_apply_total` | counter | `mode=normal\|replay`, `result=success\|failed` | Success: distinct platform-accepted APPLIED closure by subscription/release in normal mode, by subscription/release/replay operation in replay mode. Failure: committed `CONSUMER_APPLY_FAILED` evidence, once per evidence ID | Snapshot verified, callback-success report alone, HTTP 2xx, receipt merely sent, or proof of a real HIS transaction |
| `consumer_digest_failure_total` | counter | `mode=normal\|replay`, `bounded_reason=content_digest_mismatch\|schema_digest_mismatch\|processing_digest_mismatch` | Primary snapshot-verification or platform receipt-rejection evidence | Every echoed failure stage; replay terminal evidence is not counted again as a digest failure |
| `consumer_replay_total` | counter | `mode=replay`, `result=success\|failed` | Terminal real replay attempts, deduplicated by subscription/release/attempt/result | Distinct business applications; an explicit retry/recovery attempt may finish successfully without reapplying |
| `consumer_checkpoint_lag_seconds` | gauge | `criticality=LOW\|NORMAL\|HIGH\|CRITICAL` | Maximum eligible publication-time gap in seconds within the label group | Sequence-number difference, age since last poll, wall time since checkpoint update, or proof that a zero-lag consumer applied |
| `consumer_sla_breached` | gauge | `criticality=LOW\|NORMAL\|HIGH\|CRITICAL` | Count currently overdue ACTIVE subscriptions with latency configured | A cumulative event counter, penalty, or number of scrapes |

`consumer_sla_breach_total` is deliberately represented as `consumer_sla_breached`
because the existing SLA is a derived current state. Scraping performs no writes.
An overdue NEVER_APPLIED subscription contributes, matching `applyOverdue` in the
operational API. HEALTHY, unconfigured latency, SUSPENDED, REVOKED and ARCHIVED do
not contribute. Retry-only policy is NOT_CONFIGURED. Lifecycle overrides are
evaluated on every collection; historical counters remain unchanged.

Consumer counters cover **retained C-03 audit evidence**, including evidence
written before this C-04 deployment. No consumer failure/replay history is
invented for the pre-C-03 period. Publication totals cover retained release
history. A full database replacement/reset resets this history; an API/collector
restart does not. These are database-global totals: do not sum identical exports
from multiple replicas of the same database. No production scrape topology is
introduced here.

## APPLIED, checkpoint, lag and replay

Platform `CONSUMER_RECEIPT_ACCEPTED` with `receiptApplyResult=APPLIED` is written
only after the existing ACCEPTED/VALID/processing-digest checks and checkpoint
handling succeed in the receipt transaction. This is the success authority.
Consumer-reported APPLY_SUCCEEDED is useful audit evidence but is insufficient
for the success metric. Failed callbacks remain separate failures; a later
successful recovery can add a success. Unknown callback outcome uses C-03's
bounded failure taxonomy and does not certify a rollback of downstream effects.

Checkpoint is the platform's confirmed applied stream sequence. Only its release
with a valid APPLIED receipt and matching processing digest establishes an
applied lag endpoint. Stream sequence chooses latest/first releases; absolute
Unix microseconds obtained by explicitly interpreting stored timestamps as
Asia/Shanghai determine duration, exactly as ADR-0112 requires.

For ACTIVE subscriptions with expected latency configured:

`lag = max(0, latest assigned release publication instant - checkpoint release publication instant)`.

Without any qualifying applied checkpoint, use the first assigned publication
as the baseline. No assigned release contributes zero. This measures the span
of unapplied publication history, not its age: one never-applied release may
have lag zero while its SLA is overdue. Timestamp reversal clamps to zero;
sequence remains ordering authority. Assigned history includes incompatibility
blocking, consistent with the existing operational API. Aggregate by the latest
assigned release's projection pair and current immutable SLA version criticality.
Do not use individual subscriptions as labels; detailed checkpoint/release,
owner and failure investigation stays in operational-status and audit queries.

SLA lateness delegates to the existing `evaluateConsumerSla`: the oldest pending
assigned publication, an exact absolute duration and the current version's
configured threshold. Exactly at the deadline remains healthy. New releases,
retries and policy reads do not restart the pending clock. An idle caught-up
consumer stays healthy. Replay of an older release cannot move checkpoint/time
backward; repeated same-operation APPLIED acknowledgements do not add success
business volume. Different explicit replay operations are counted independently.
Dry-run produces no real replay terminal or apply metric, including verification
failures encountered only by dry-run. There is no synthetic dry-run success.

## Cardinality and endpoint

Six families, 23 possible samples per pair, eight pairs including unknown:
**184 maximum emitted series** with the current registry. Zero samples are
emitted deterministically. Runtime validation rejects any unexpected label key,
enum value, unsafe count or malformed registry token. Arbitrary projection
values collapse into the same fixed unknown bucket. No subscriptionId,
releaseId, governanceObjectId, servicePrincipalId, requestId, correlationId,
departmentId or raw exception is a label, HELP field or returned detail.

`GET /prototype/observability/metrics` is a platform observability route, hidden
from formal OpenAPI and Generated Client. It is wired only into the existing
prototype entry point and synthetic validation composition. Registration rejects
production mode, disabled prototype mode and non-127.0.0.1 binding. Requests must
come from a loopback socket and resolve to an existing prototype PERSON; service
tokens and forwarded-header spoofing do not grant access. This retains the
prototype's existing synthetic authentication posture, without inventing a
production metrics role or public network deployment.

Response is Prometheus text format 0.0.4 with `Cache-Control: no-store` and a
permanent synthetic/non-production/Asia-Shanghai comment. One collection per
application may run at a time; overlapping collection returns static 503.
Failures return only a static code, never SQL, secrets, IDs or raw errors.
There is no cached partial-success response. Query cost still grows with retained
history: this is a minimal prototype collector, not a tested production capacity
or availability claim.

## Validation and delivery

The C-04 validator executes both Department projections through publication,
SDK verification/application/recovery, receipts, checkpoint, SLA, replay, audit
and metrics. Publication fault injection fails after Outbox insertion. Receipt
rollback, repeat receipt/audit/replay requests, all three digest reasons and
callback failure are checked against metric deltas and checkpoint absence.
Both projection chains include real CLI processes; a new collector process
verifies identical exported bytes after closing the HTTP application and pool.
Inherited lifecycle, SLA, schema freeze, SDK, replay and audit suites remain gates.

Final acceptance command results, protected artifact hashes, independent reviews,
file inventory and resource closure are recorded in the C-04 delivery report.
No Grafana, Prometheus deployment, notifications, SLA penalties, real consumer,
Person Master or subsequent phase is included. One local commit; no push; stop.


## Completed validation — 2026-09-04, Asia/Shanghai

C-04 implementation and local validation DONE. Final results: API 375/375 in
28 files; SDK 72/72; Sim Consumer 20/20; replay CLI 4/4; verification tooling
714/714 in 33 files; schema freeze/evolution 20/20. Metrics adds 26 cases
(25 unit/network/label cases and one real dual-projection E2E). Department,
Release Distribution, lifecycle, SLA, SDK, Replay and Audit suites passed.
The container-based phase-01-vertical-slice integration file remains excluded.

Master and Hierarchy each passed publication rollback/retry, SDK snapshot
verification, callback application, APPLIED receipt, checkpoint, SLA state,
replay, hash-chained audit and metrics. Invalid pair/object, PERSON owner,
disabled service principal, cross-subscription access, content/schema/processing
digest, SUSPENDED/REVOKED consumption and ARCHIVED mutation negatives passed.
The final Metrics E2E also verified identical exports in a separate restarted
collector process. Synthetic persisted history was retained.

All 30 distinct acceptance commands below finished with final exit 0. Complete
redacted attempt logs are retained under .runtime/pv005-c04/validation-01 through
validation-04. Earlier diagnostics were resolved without changing gates: the SQL
ownership scanner needed parenthesized EXTRACT operands; raw module query exports
were replaced after Standards review; the narrow AuditEventService contract was
preserved for existing callers. One final API rerun was interrupted during
Windows standby (Kernel-Power 506/507); the subsequent verbose run passed 375/375.
Standalone direct-node database checking also required the documented npm context.

| Acceptance command | Final exit |
|---|---:|
| `npm run prototype:db:check` | 0 |
| `npm run prototype:db:migrate` | 0 |
| `npm run prototype:db:seed` | 0 |
| `npm run prototype:department:seed` | 0 |
| `npm run build` | 0 |
| `npm run typecheck` | 0 |
| `npm run test --workspace @hospital-data-intelligence/release-consumer-sdk` | 0 |
| `npm run test:consumer-replay` | 0 |
| `npm run test --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| `npm run test --workspace @hospital-data-intelligence/governance-api -- --exclude=**/phase-01-vertical-slice.integration.test.ts --fileParallelism=false --reporter=verbose` | 0 |
| `npm run test:verification` | 0 |
| `npm run prototype:department:validate` | 0 |
| `npm run prototype:http:validate` | 0 |
| `npm run prototype:department:http:validate` | 0 |
| `npm run contract:generate` | 0 |
| `npm run contract:generate-client` | 0 |
| `npm run typecheck --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| `npm run check` | 0 |
| `npm run contract:lint` | 0 |
| `node --import tsx apps/governance-api/scripts/check-consumer-replay-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-department-consumer-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-consumer-lifecycle-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-consumer-sla-openapi-diff.ts` | 0 |
| `node --import tsx tooling/prototype/check-department-consumer-canonical.ts` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --lifecycle` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --sla` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --sdk` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --audit` | 0 |
| `npm run prototype:consumer:metrics:validate` | 0 |
| `git diff --check` | 0 |

OpenAPI lint: 0 errors, 0 warnings. No standalone repository source-lint command
is configured; build, typecheck and repository boundary checks passed. Git CRLF
normalization notices are not lint findings. Generated Client regeneration and
compilation passed with source bytes unchanged. Seventy-eight protected source
files were verified unchanged, including Department domain sources, registry,
migrations, OpenAPI, client, SDK and canonical fixture.

Master V1 before = after:
`a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`.
Hierarchy V1 before = after:
`72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`.
OpenAPI before = after:
`f64db5c2c0688c0128a942d0705a0d91809e1fd795dedbd95f588067e91d8035`.
Formal paths: 56 total; added/removed/modified 0/0/0. All 15 Department Browser
paths unchanged. Runtime platform prototype path added: 1
(GET /prototype/observability/metrics); no Department direct-query API.

Seven deterministic canonical artifacts were regenerated and compared byte for
byte. Their before/after artifact SHA-256 values are identical:

| Contract | Artifact SHA-256 before and after | Bytes |
|---|---|---|
| hdi.charge-catalog@1 | `123da65b13ec1f956bfdf4f92c849e1bd9a53dad7fae3609056ba37d5033c9b4` | identical |
| hdi.charge-catalog@2 | `b00eea7e470158df42967431e2fd08f38ce788a4863821f85998eae1331bc155` | identical |
| hdi.price-list@0 | `b46c77524a9492f2f07016d6ec4a795b418da9e0b4b6e1d3da328d0ae0e9bbe7` | identical |
| hdi.price-list@1 | `3babe64dc137d3127c5c953bae725ab2518c092b6803e14e05f0f23e986f4266` | identical |
| hdi.price-list@2 | `be8b7ccc640df775efbd8558f15c1cfd5f9e0ba98435ac9487e0f6818dd1d04a` | identical |
| hdi.department-master@1 | `336ab62f8d2230eb5eeb7fa4ac41f8ae12ad0a63a4e6cc937bee416a902b9f26` | identical |
| hdi.department-hierarchy@1 | `fb71ec35bf39f9ea508b764beb56a386df48922d0015d54662b8a334feae2cf4` | identical |

Migration count: 19 before/after; added 0. Forbidden timezone types: 0, checked
against the live catalog. No campus, alias, quality, source mapping or new domain.

Independent Standards and Spec reviews both returned APPROVED with 0 findings
on implementation tree 4019efadad4cb5a0f7d5b8a3a29b77712c875ba3. The earlier
Standards P2 is resolved. Final documentation-only tree confirmation and the
single commit SHA are recorded in the task response. Commit message is exactly
`feat(observability): add release consumer metrics`.

Resource closure: Fastify closed and ports released; application DB sessions 0;
verification pool closed; PostgreSQL service inactive and listener 55434 absent;
task Linux keepalive PID 139 stopped, Windows launcher
PID 33840 exited; task Node processes 0. SDK/CLI/collector
children closed. Codex host tools preserved. Immutable synthetic database facts
and ignored logs retained; temporary consumer state removed by validators.

Formal ABG executed: NO. AR-07: NO. Keycloak: NO. Containers: NO.
Browser acceptance: NO. Real HIS/EMR connected: NO. Push performed: NO.
No Person Master, other master-data domain or next phase started.

Changed files (21):

- `.scratch/consumer-operational-metrics/issues/01-consumer-operational-metrics.md`
- `.scratch/consumer-operational-metrics/spec.md`
- `apps/governance-api/src/composition/create-consumer-metrics.ts`
- `apps/governance-api/src/modules/audit/consumer-metric-facts.ts`
- `apps/governance-api/src/modules/audit/index.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-metric-facts.test.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-metric-facts.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-metrics.integration.test.ts`
- `apps/governance-api/src/modules/release-distribution/index.ts`
- `apps/governance-api/src/platform/fastify/register-consumer-metrics.test.ts`
- `apps/governance-api/src/platform/fastify/register-consumer-metrics.ts`
- `apps/governance-api/src/platform/observability/consumer-metrics.test.ts`
- `apps/governance-api/src/platform/observability/consumer-metrics.ts`
- `apps/governance-api/src/prototype-main.ts`
- `docs/design/consumer-operational-metrics.md`
- `package.json`
- `tooling/prototype/check-consumer-metrics-flow.ts`
- `tooling/prototype/check-consumer-replay-flow.ts`
- `tooling/prototype/consumer-metrics-worker.ts`
- `tooling/prototype/run-department-consumer-flow.ts`
- `tooling/prototype/validate-department-consumer-flow.ts`
