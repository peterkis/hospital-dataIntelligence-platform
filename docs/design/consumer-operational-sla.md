# Consumer Operational SLA Metadata — PV-005-B-03B

START_HEAD: `733072bc592b82c3ceb0bda4a7be16e2979c64e6` (`feat(api): add consumer subscription lifecycle`). Opening branch was `prototype/phase-02-department-master`, the worktree was clean, and B-03A was the unique commit after B-02B. Local `origin/main...HEAD` divergence was `0 53`. This is synthetic, non-production prototype verification, with Asia/Shanghai display. No push or B-03C work is authorized.

## Immutable operational contract

The existing `ConsumerSubscriptionVersion` gains optional `sla` input on subscription creation and version creation. Each command creates a complete immutable policy: omitted SLA or omitted fields use NORMAL criticality and unconfigured latency/retry. Creating a new version without SLA therefore explicitly resets to these defaults; it does not inherit a hidden prior policy. Historical versions can be read by exact version ID. There is no update policy endpoint or second configuration/version mechanism.

| Field | Contract |
|---|---|
| criticality | LOW, NORMAL, HIGH, CRITICAL; stable default NORMAL |
| expectedApplyWithinSeconds | Optional integer, 1–2147483647 |
| retryWindowSeconds | Optional integer, 1–2147483647; at least expectedApplyWithinSeconds when both supplied |

The upper bound is PostgreSQL signed integer capacity, not a hospital business policy. Retry-only metadata is allowed, but without expected latency the SLA status is NOT_CONFIGURED. Read responses normalize absent seconds to null. Closed TypeBox objects reject extra properties; the module additionally enforces the cross-field relationship, and database CHECK constraints repeat the invariant. TypeBox bounds and optional-property behavior were checked against [its primary documentation](https://github.com/sinclairzx81/typebox).

Migration `0018_consumer_operational_sla.sql` adds only the three version columns and constraints. Existing versions obtain NORMAL/null/null without changing identity, projection support or stored timestamps. The existing append-only trigger protects all historical fields. The live database remains the Kysely type generation authority.

## Ownership and read boundary

The existing `consumer_subscription.service_principal_id` relation resolves the operational service owner through the platform-owned reference reader. It returns only that principal's ID and bounded code; no ownerName, ownerEmail, new person identity or arbitrary principal lookup is introduced. This identifies the accountable service, not a newly inferred human contact. PERSON, disabled, missing or wrong service principals remain rejected by the relevant create/consumption boundaries.

`GET /v1/phase-01/consumer-subscriptions/{subscriptionId}/operational-status` is SERVICE-only with serviceBearer authentication. The transaction module repeats the owning-principal check. A valid owning service may inspect suspended/revoked/archived status without being allowed to consume. Optional `subscriptionVersionId` is restricted to that subscription; omission chooses the highest version number. Supplying a historical version evaluates current facts against that historical policy; it is not an as-of query. Browser management commands still use PERSON, CSRF and object permissions. No Department API is added.

The response is one closed, bounded object: policy/version, owner, lifecycle, status, applyOverdue, evaluatedAt, timezone, and nullable latestRelease, oldestPendingRelease, lastSuccessfulApply, latestCheckpoint. It exposes no history arrays, SQL, storage details or secrets. Queries use single-row limits and the subscription lock already shared by lifecycle, publication registration, version creation and receipts, preventing mixed observations during those transactions.

## Derived semantics

| Condition | Status |
|---|---|
| SUSPENDED / REVOKED / ARCHIVED | Same lifecycle status; precedence over SLA |
| ACTIVE with no expected latency | NOT_CONFIGURED, even with pending releases |
| ACTIVE with latency but no successful apply | NEVER_APPLIED; applyOverdue separately indicates an overdue pending release |
| ACTIVE with prior successful apply and overdue pending release | LATE |
| ACTIVE with prior successful apply and no overdue pending release | HEALTHY |

Assigned Outbox deliveries determine relevant releases, including incompatibility-blocked work. Latest release and oldest pending release are selected by aggregate sequence, not timestamp. Pending means newer than the subscription checkpoint. Lateness uses the oldest pending publication's server creation instant; new publications, new SLA versions, retries and resume do not restart that clock. Exactly at the deadline is healthy; one microsecond later is overdue. An already caught-up consumer remains healthy during an idle period. A never-applied consumer with no assigned release remains NEVER_APPLIED with applyOverdue false.

The latest successful release is the checkpoint release with an ACCEPTED/VALID/APPLIED receipt whose processing digest matches the event's artifact digest. Its success time is the server creation time of that event's first qualifying receipt by receipt sequence. Duplicate or old-event receipts do not refresh it. The client can supply only the existing processedAt receipt evidence; that value cannot set SLA success or checkpoint time. Checkpoint insertion and real advancement use platform server time; old-event replay changes neither checkpoint nor its time. Existing historical checkpoint times are preserved. There is no materialized last_success_at, cache, worker, monitoring, notification or alerting.

All elapsed-time arithmetic uses exact absolute Unix microseconds. SQL explicitly interprets stored values using IANA Asia/Shanghai before extraction; it never subtracts naive datetimes or relies on the host/session timezone. Storage and display continue ADR-0074; no timezone-typed columns are added. [ADR-0112](../adr/0112-evaluate-consumer-sla-on-absolute-instants.md) records the narrow boundary and historical local-time limits.

## Contract and canonical stability

OpenAPI changes from `5c32b5bedf0cbd67171e31bd8a8b0aa5ca46dfd06b7dadf1bfa2b19b410831bb` to `fb57428dd58ca5c72c4bee5f3827f9930746df88dbc5608259dac9d2a21fb607`. The independent B-03B guard permits one new operational read and only optional SLA properties on the two existing command bodies. All 15 Department Browser paths, all unrelated operations and all components remain identical. The B-03A guard now verifies its closed committed result, preserving its original allowlist. Client types are regenerated with positive/negative SLA compilation cases.

Department Master schema digest remains `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`; Hierarchy remains `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`. The seven-contract canonical fixture guard compares exact artifact bytes. No Department source/schema/payload or canonical packaging is changed.

## Verification

The SLA unit cases cover enum/number/extra-field/default validation, retry relationship, exact microsecond deadline, never-applied behavior, absent latency, lifecycle precedence and process-timezone independence. The real HTTP/PostgreSQL flow covers immutable versions, database rejection, owner isolation, failure receipts, digest mismatch, first apply, repeated and old-event APPLIED replay, event filtering, oldest pending release, session-timezone independence, lifecycle overrides and reopen persistence. Validators close applications, temporary consumer state and database pools. The inherited Department, Release Distribution, Sim Consumer, lifecycle, canonical, generated-client and OpenAPI regressions remain required.

This task does not claim formal ABG acceptance, a real consumer integration, hospital SLA policy approval, capacity or production readiness. Final command results and resource closure are recorded below after verification.

## Final validation record (2026-09-04, Asia/Shanghai)

All 24 commands below completed with exit 0. The ignored local environment was injected per process; connection values were never printed.

| Command | Exit |
|---|---|
| `npm run typecheck` | 0 |
| `npm run build` | 0 |
| `npm run test --workspace @hospital-data-intelligence/governance-api -- --exclude=**/phase-01-vertical-slice.integration.test.ts` | 0 |
| `npm run test --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| `npm run prototype:db:check` | 0 |
| `npm run prototype:db:migrate` | 0 |
| `npm run prototype:db:seed` | 0 |
| `npm run prototype:department:seed` | 0 |
| `npm run prototype:department:validate` | 0 |
| `npm run prototype:http:validate` | 0 |
| `npm run prototype:department:http:validate` | 0 |
| `npm run check:database-authority` | 0 |
| `npm run check:repo:layout` | 0 |
| `npm run check:module-boundaries` | 0 |
| `npm run contract:generate` | 0 |
| `npm run contract:lint` | 0 |
| `npm run contract:generate-client` | 0 |
| `npm run build --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| `npm run typecheck --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| `node apps/governance-api/scripts/check-department-consumer-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-consumer-lifecycle-openapi-diff.ts` | 0 |
| `node apps/governance-api/scripts/check-consumer-sla-openapi-diff.ts` | 0 |
| `node --import tsx tooling/prototype/check-department-consumer-canonical.ts` | 0 |
| `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --sla` | 0 |

The API regression suite passed 346/346 across 21 files, including Department, Release Distribution, lifecycle and the new SLA cases (28 pure unit cases plus the real HTTP/PostgreSQL flow). Sim Consumer passed 20/20. The inherited container-based phase-01-vertical-slice integration file was excluded; no formal/container acceptance claim is made. Generated-client positive and negative compilation checks passed. OpenAPI lint reported zero errors and warnings. Database authority passed with 18 migrations and zero forbidden timezone types; repeat migration execution was idempotent. All 184 pre-migration subscription versions retained NORMAL/null/null. All seven canonical artifacts were byte-identical.

Independent read-only Standards and Spec reviews each returned 0 findings and 0 blocking findings on candidate tree be1fda4dc1a908decc6f7b76cc09338278173d9a. Only this validation record was appended after that review; implementation bytes remain unchanged. Final staged diff whitespace validation also passed (exit 0).

Resolved development diagnostics: a test used the wrong transaction-runner callback signature; the append-only negative assertion initially expected P0001 instead of the existing 55000; the browser-without-bearer negative initially expected 403 instead of request-schema 400, and a real PERSON bearer case separately verifies 403. Each correction was followed by a passing final regression. No implementation gate was weakened.

Resource closure: application database sessions 0; verification pool closed; validators closed applications, released ports and removed temporary consumer state. PostgreSQL service inactive; no listener on 55434. Task keepalive Linux PID 140 and Windows launcher PID 20160 exited, and the PID record was removed. Workspace Node process count 0. Synthetic persisted receipt/release/version facts remain for provenance; ignored validation logs are retained under .runtime/pv005-b03b. No push occurred. Opening upstream origin/prototype/phase-02-department-master divergence was 0/0; the sole local commit will be one ahead of that unchanged local remote-tracking ref.

## Changed files

- `CONTEXT.md`
- `apps/governance-api/scripts/check-consumer-lifecycle-openapi-diff.ts`
- `apps/governance-api/scripts/check-consumer-sla-openapi-diff.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-operational-view.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-sla.test.ts`
- `apps/governance-api/src/modules/release-distribution/consumer-sla.ts`
- `apps/governance-api/src/modules/release-distribution/department-consumer.integration.test.ts`
- `apps/governance-api/src/modules/release-distribution/index.ts`
- `apps/governance-api/src/platform/database/database-types.generated.ts`
- `apps/governance-api/src/platform/fastify/map-http-error.ts`
- `apps/governance-api/src/platform/fastify/register-phase-01-routes.ts`
- `apps/governance-api/src/platform/fastify/release-consumer-schemas.ts`
- `apps/governance-api/src/platform/release-consumer/consumer-reference-reader.ts`
- `contracts/openapi/phase-01.openapi.json`
- `contracts/openapi/phase-01.openapi.sha256`
- `db/migrations/0018_consumer_operational_sla.sql`
- `db/migrations/README.md`
- `docs/adr/0112-evaluate-consumer-sla-on-absolute-instants.md`
- `docs/design/consumer-operational-sla.md`
- `packages/generated-api-client/src/consumer-sla.compile-test.ts`
- `packages/generated-api-client/src/schema.generated.ts`
- `tooling/prototype/check-consumer-sla-flow.ts`
- `tooling/prototype/run-department-consumer-flow.ts`
- `tooling/prototype/validate-department-consumer-flow.ts`
