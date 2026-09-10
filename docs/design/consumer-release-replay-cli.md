# Consumer Release Replay CLI — PV-005-C-02

START_HEAD: `3dcd9e018b6ffe2ca1c0c73cb4aada709de434f8`.
Branch: `prototype/phase-02-department-master`. C-01 DONE, clean opening
index/worktree, one C-01 commit over `666f0260c7ef67374e725ea07ed2d55948690b59`.
Opening local upstream behind/ahead: 0/0; local origin/main: 0/56. No fetch/push.

Synthetic, non-production validation only. Date/time is Asia/Shanghai. This
command repairs the independent Sim Consumer's local business store. It does
not connect to real HIS/EMR or imply formal acceptance or production readiness.

## Operator contract

Prepare the existing workspace with `npm run build`. Supply credentials through
the process environment, never argv or terminal output:

| Environment key | Meaning |
|---|---|
| `HDI_REPLAY_BASE_URL` | Existing API origin, restricted to `http://127.0.0.1:<port>`; no credentials, query or fragment |
| `HDI_REPLAY_ACCESS_TOKEN` | Service credential owning the exact subscription |
| `HDI_REPLAY_STATE_PATH` | Absolute `.json` path of that Sim Consumer's business/recovery store; parent directory already exists; required only for apply |

Run from the repository root. The direct Node entry works in PowerShell without
shell-specific npm argument forwarding. `npm run --silent consumer:replay -- ...`
is the equivalent npm-script entry.

```text
node --import tsx tooling/prototype/consumer-replay.ts --subscription-id <uuid> --release-id <uuid>
node --import tsx tooling/prototype/consumer-replay.ts --subscription-id <uuid> --release-id <uuid> --dry-run
node --import tsx tooling/prototype/consumer-replay.ts --subscription-id <uuid> --release-id <uuid> --apply --operation-id <uuid> --reason "Synthetic downstream repair"
```

No `--apply` means no business apply, receipt, audit, checkpoint or local file
write. Dry-run does not even create a lock file. Unknown/duplicate arguments,
mixed dry-run/apply, invalid IDs, missing apply reason/operation ID and force/bulk
options fail closed. Each invocation addresses exactly one release and has a
30-second process deadline. It does not poll/retry/schedule work automatically.

An operation ID identifies one intentional repair. Retry with the same ID,
release, reason and durable state file; the existing pending/closed marker
prevents another business application. A separate intentional repair requires a
new explicit operation ID. Never delete local markers to manufacture a retry.
Reasons are bounded, single-line, 1–256 characters; no credentials or patient
data. Neither reasons, tokens, URLs, paths, raw responses nor payloads are echoed.

The ordinary Sim Consumer must be stopped while repairing its state. This
retains C-01's adapter-owned single-writer requirement; replay invocations also
exclude one another with an exclusive lock. A stale lock after an OS kill or
power loss fails closed, without automatic stealing or a force switch. Release
of an abandoned local lock requires an operator to verify the original writer
has stopped. Graceful errors close the lock and permit another explicit retry.
No claim of power-loss atomicity across the server and local filesystem is made.

## Boundaries and invariants

The new service-authorized GET
`/v1/phase-01/consumer-subscriptions/{subscriptionId}/releases/{releaseId}/replay-context`
reads one assigned release, its latest delivery's frozen compatibility version,
the matching projection support, first qualifying APPLIED receipt, latest
receipt, mismatching APPLIED-digest flag and checkpoint. It never resolves the
current subscription version in place of the frozen version. Missing, foreign,
future/unassigned and incompatible releases share `CONSUMER_EVENT_NOT_AVAILABLE`;
there is no lookup of a foreign subscription to distinguish them.

The old events GET appends OFFERED_BY_PULL attempts, so replay never calls it.
The existing snapshot GET accepts an optional exact `replayReleaseId`; it checks
that the authorized release references the requested snapshot. This permits a
SUPPORTED delivery in ATTENTION_REQUIRED to be inspected/repaired, without
changing ordinary snapshot/poll behavior. BLOCKED_INCOMPATIBLE still needs the
existing PERSON-governed compatibility replay and is never bypassed here.

SDK `inspectReplay()` owns metadata validation, download and existing content
SHA-256/header, projection pair, schema digest, envelope identity, payload schema
and payload digest verification. Historical `bytea` bytes are downloaded through
Generated Client; CLI never generates an artifact or implements HTTP/digest/
parser/receipt/checkpoint protocols. CLI supports the frozen Department Master
V1 and Hierarchy V1 pairs only; the SDK retains its other C-01 pairs unchanged.

SDK `replayExactRelease()` is separate from ordinary `apply/consume/resume`.
It rechecks lifecycle/identity, then atomically commits the business repair and
pending operation marker through `ReplayAdapter`. It reloads durable evidence
before APPLIED, records/reuses the receipt, re-reads the exact receipt/checkpoint,
closes the marker and verifies closure was persisted. The operation may repair
an older release; all observed checkpoints must remain monotonic. A future gap
still fails, following the existing server checkpoint protocol.

The existing receipt POST accepts optional closed replay metadata containing
operation ID, reason, release ID and frozen subscription version ID. Lifecycle,
service ownership, assigned release, version and processing digest are checked
inside the same subscription-locked transaction. A qualifying receipt is reused
with its original ID and sequence; it is never deleted or recreated. New APPLIED
receipts use the existing protocol. Normal receipt behavior remains unchanged.

Successful replay adds `CONSUMER_RELEASE_REPLAYED` through the existing audit
module, with service actor, request/correlation, local time and hash chain.
Operation identity/reason/digest are immutable; a conflicting reuse fails with
`REPLAY_OPERATION_CONFLICT`. Retries reuse the same audit event. Audit and a new
receipt/checkpoint commit or roll back together. A reused APPLIED receipt still
permits a new explicit repair audit, without refreshing original success time.

ACTIVE only: SUSPENDED, REVOKED and ARCHIVED are denied, including already closed
operations. Lifecycle may change between requests; each service request checks
again. A concurrent suspension after a local commit can leave a durable pending
operation, never a fabricated success or unauthorized receipt.

The synthetic adapter uses one fsynced temporary file and atomic rename to commit
payload plus marker, preserving ordinary checkpoint/events and prior replay
records. State is bounded to 32 MiB and 1,000 operations, failing instead of
evicting history. Canonical artifacts retain their existing 16 MiB POC guardrail.

## Output and errors

Stdout is one bounded JSON object, exit 0 for verified success, exit 1 for failure.
No payload or stack is printed. Success includes mode, eligibility, immutable
identities/digests, current receipt state, checkpoint before/after, whether the
receipt existed, whether this invocation applied business changes and whether
the receipt was reused. Failure returns an allowlisted stable error code. A
transport/deadline failure may have a pending local commit; retry the same
operation instead of inventing success or deleting state.

`receiptState`, `appliedReceiptId` and `alreadyApplied` describe the preflight
receipt facts. `checkpointAfter`, `businessApplied` and `receiptReused` describe
the outcome. Thus an initially failed receipt can be reported alongside a
successful repair; it is not silently overwritten in history.

## Validation

The test seams are the user-requested public CLI, SDK and PostgreSQL/Fastify
consumer contract. TDD first demonstrated the missing inspect/apply APIs, then
added implementation and refusal/recovery cases. Context7 was used to confirm
Kysely query/transaction usage; no dependency was installed or upgraded.

The real Master/Hierarchy flow checks unchanged receipt/checkpoint/version/
delivery facts during dry-run, failed-apply receipt recovery, a newer subscription
version that does not alter frozen replay version, exact apply, separate-process
idempotence, old-release monotonicity, immutable snapshot bytes, opaque foreign
release rejection, all inactive lifecycle states and persisted facts after app
and pool closure. SDK tests inject corrupt digests/schemas/pairs/envelopes/payloads,
processing mismatch, identity/gaps, callback/durable-marker failures and receipt
transport interruption. Actual CLI processes test zero files on dry-run, safe
output, correct exits and restart after receipt acceptance with response loss.

The dedicated OpenAPI delta gate permits exactly 1 new read path and 2 optional
replay additions; components, 15 Department browser paths and canonical envelope/
payload schemas are unchanged. The B-03B gate now checks its closed C-01 candidate
instead of widening its historical allowlist. Migrations, Department domain,
composition registry and seven frozen canonical fixtures remain protected.

Final command counts, retained proofs and cleanup are recorded below after the
candidate validation. Container-based Phase-01 integration/fault/capacity, formal
ABG, browser acceptance and production integrations remain excluded.

### Final candidate results — 2026-09-04, Asia/Shanghai

All 14 commands in `.runtime/pv005-c02/validation-02/results.json` completed with
exit 0. The directory retains redacted, per-command logs, with the last command's
full bounded JSON replay proof in `gate-14.log`. Earlier development/preliminary
results remain separate in `validation-01`; they are not the final candidate.

| Check | Result |
|---|---|
| Repository build and typecheck (including public SDK compile contracts) | PASS |
| SDK | 65/65 |
| CLI / file-store / independent-process recovery | 4/4 |
| Existing Sim Consumer | 20/20 |
| Non-container API, including real Master/Hierarchy replay | 348/348, 23 files |
| Verification tooling | 714/714, 33 files |
| Seven-contract freeze/evolution | 20/20 |
| `npm run check`, OpenAPI lint, C-02 and inherited contract delta guards | PASS |
| Protected Department/domain/composition/fixture/migration source files | 32 unchanged |

Final OpenAPI SHA-256:
`b238b8da6fc664ff5788959df396d2e77a63d629a3d5be990e33eee11c7a3be4`.
Its controlled delta is 1 new read path, 2 modified existing paths, 0 component
changes, 0 Department browser changes and 0 canonical snapshot schema changes.
All 18 migrations and both Department V1 schema digest identities are unchanged.
No dependency or lockfile change.

| Final real PostgreSQL proof | Master | Hierarchy |
|---|---|---|
| Dry-run, zero mutation | PASS at checkpoint 220 | PASS at checkpoint 81 |
| New exact release repair | 220 → 221 | 81 → 82 |
| Historical release explicitly repaired | release 220 | release 81 |
| Checkpoint after historical replay | 221 → 221 | 82 → 82 |
| Repeat operation in another CLI process | businessApplied=false | businessApplied=false |
| Qualifying receipt for old release | Same original ID, one row | Same original ID, one row |
| Hash-chain replay audits | 2 distinct operations, no retry duplicate | 2 distinct operations, no retry duplicate |

The final flow also recovered a NOT_APPLIED receipt without deleting it, kept
the publication's frozen subscription version despite a subsequently appended
version, denied SUSPENDED/REVOKED/ARCHIVED and returned the same stable missing
release error for a foreign release. SDK/CLI refusal tests covered snapshot,
schema and payload digests, projection type/version, malformed envelope/payload,
processing mismatch, future gap, identity mismatch, operation conflict and missing
durable state. Unexpected receipt-state text is rejected, never echoed.

The post-run connection in `.runtime/pv005-c02/resource-closure.json` independently
confirmed checkpoints 221/82, original old-receipt identity/digest and two persisted
replay audits per subscription after application shutdown. Application sessions
were 0 and the verification pool closed. Application ports and task Node processes
were absent. PostgreSQL service was then stopped (inactive), listener 55434 was
absent, Linux keepalive PID 144 stopped and its Windows launcher PID 35492 exited.

The validators removed normal temporary consumer files. Four directories from
interrupted preliminary test launchers were identified by exact paths, creation
times and synthetic identities, then cleaned without a recursive/broad delete;
two contained temporary synthetic state JSON files. They have no backup, but are
regeneratable test data. PostgreSQL immutable release/receipt/audit/checkpoint
evidence and ignored validation logs remain retained. Host tools were preserved.

Development diagnostics are not claimed as passes: expected initial TDD failures,
a synthetic test regex error, a literal-union type mismatch, and two incomplete
API launcher attempts (PowerShell/npm forwarding and missing npm_execpath). The
final runner uses explicit process argument arrays, command-scoped ignored env
loading, serial API files and captures actual exit statuses. No existing failure
expectation, canonical pin or governance rule was weakened.

Delivery is restricted to one local commit with message
`feat(tooling): add consumer release replay cli`. Final commit SHA is reported in
the task response (a commit cannot contain its own SHA). No push, subsequent
ticket, real integration, bulk/scheduled replay, checkpoint rewind or force mode.

## Changed files (31)

- `.scratch/consumer-release-replay/spec.md`
- `.scratch/consumer-release-replay/issues/01-consumer-release-replay.md`
- `apps/governance-api/scripts/check-consumer-replay-openapi-diff.ts`
- `apps/governance-api/scripts/check-consumer-sla-openapi-diff.ts`
- `apps/governance-api/src/modules/audit/index.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-replay-view.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-replay.integration.test.ts`
- `apps/governance-api/src/modules/release-distribution/index.ts`
- `apps/governance-api/src/platform/fastify/map-http-error.ts`
- `apps/governance-api/src/platform/fastify/register-phase-01-routes.ts`
- `apps/sim-consumer/src/consumer.ts`
- `contracts/openapi/phase-01.openapi.json`
- `contracts/openapi/phase-01.openapi.sha256`
- `docs/design/consumer-release-replay-cli.md`
- `package.json`
- `packages/generated-api-client/src/schema.generated.ts`
- `packages/release-consumer-sdk/README.md`
- `packages/release-consumer-sdk/scripts/generate-contracts.mjs`
- `packages/release-consumer-sdk/src/consumer.compile-test.ts`
- `packages/release-consumer-sdk/src/contracts.generated.ts`
- `packages/release-consumer-sdk/src/errors.ts`
- `packages/release-consumer-sdk/src/index.ts`
- `packages/release-consumer-sdk/src/replay.test.ts`
- `packages/release-consumer-sdk/src/types.ts`
- `tooling/prototype/check-consumer-replay-flow.ts`
- `tooling/prototype/consumer-replay-command.ts`
- `tooling/prototype/consumer-replay-store.ts`
- `tooling/prototype/consumer-replay.test.ts`
- `tooling/prototype/consumer-replay.ts`
- `tooling/prototype/run-department-consumer-flow.ts`
- `tooling/prototype/validate-department-consumer-flow.ts`
