# Consumer Subscription Lifecycle — PV-005-B-03A

This task extends Release Distribution on `prototype/phase-02-department-master` from START_HEAD `dce23903b0147910d7b0f90e6d431a30627d6fcc`. Opening branch and HEAD matched, worktree was clean, and the local origin divergence was `0 0`. Validation is synthetic, non-production, and uses Asia/Shanghai local date/time.

## Domain contract

Subscription creation remains ACTIVE without a lifecycle input. The subscription owns lifecycle independently of immutable projection support versions and service-principal validity.

| Current | Allowed different targets |
|---|---|
| ACTIVE | SUSPENDED, REVOKED |
| SUSPENDED | ACTIVE, REVOKED |
| REVOKED | ARCHIVED |
| ARCHIVED | none |

Same-state requests return the stored status and change time without a lifecycle update or another lifecycle audit event, including ARCHIVED → ARCHIVED. All other transitions fail with `CONSUMER_SUBSCRIPTION_LIFECYCLE_INVALID_TRANSITION` (409). Per-request authorization decision evidence remains governed by the existing authorization module.

Only ACTIVE permits consumer events, snapshot downloads, processing/APPLIED receipts, checkpoint advancement, compatibility replay, and notification dispatch. Inactive consumption and terminal version creation fail with `CONSUMER_SUBSCRIPTION_NOT_ACTIVE` (403), matching the existing forbidden-consumption response surface. SUSPENDED permits new immutable support versions and retains pending deliveries, including publications registered during suspension. Resumption exposes that backlog in its original order. REVOKED and ARCHIVED receive no new publication delivery records. Neither can create support versions or resume; ARCHIVED is retained for governance history only.

## Command and transaction boundary

`POST /v1/phase-01/consumer-subscriptions/{subscriptionId}/lifecycle-transitions` is the only new HTTP operation. Its closed body contains `governanceObjectId`, `targetStatus`, and optional `reason`. The response contains `subscriptionId`, `lifecycleStatus`, and `lifecycleChangedAt`. It requires PERSON browser authentication, CSRF, and existing `CONSUMER_SUBSCRIPTION_MANAGE` permission on the exact object. The module repeats actor and object authorization, so direct calls cannot bypass it. A mismatched subscription/object fails with the existing 404; unsupported status/reason values fail with stable 400 codes in the module and schema validation at HTTP.

Reason is single-line plain text, 1–256 characters when supplied; control characters and markup delimiters are rejected. Callers must never put tokens, secrets, credentials, or patient data in it. It is only a minimal fact in the existing audit payload. Operator, request, correlation, time and hash-chain evidence use the existing audit framework, without duplicate actor/reason columns.

Lifecycle, support-version creation, replay, consumer reads that record attempts, receipts, checkpoints, publication delivery registration, and dispatch all lock the subscription row before deciding eligibility. The transaction-scoped module serializes lifecycle with consumption. Lifecycle update and `CONSUMER_SUBSCRIPTION_LIFECYCLE_CHANGED` audit append commit or roll back together. Audit sequence, rather than timestamp ordering, remains authoritative.

Every service consumption boundary also verifies the owning principal still exists, is SERVICE and ACTIVE. The raw snapshot query is reserved for authorized PERSON governance reads; consumer reads go through the subscription-bound snapshot method. `getSubscriptionHistory` preserves versions and exact projection declarations, release/snapshot references, receipt identities/results, and checkpoints under the same existing management permission; it adds no HTTP query surface.

Dispatch keeps ADR-0080's separate claim, network, and result transactions. It checks eligibility at claim and again before sending, and skips all outcome mutations if subscription/principal became inactive. A notification already in flight can finish after a transition; it grants no snapshot/receipt/checkpoint permission. The previous lease remains recoverable after suspension, and terminal subscriptions never reclaim it. No network call occurs while holding the lifecycle transaction lock.

## Storage and compatibility

Migration `0017_consumer_subscription_lifecycle.sql` adds `varchar(16)` with a CHECK and `timestamp without time zone`; no PostgreSQL enum is introduced. Existing rows become ACTIVE with their original `created_at` as lifecycle change time. Identity fields and deletion are guarded; legal transitions have a database guard. Existing 16 migrations, subscription versions, support declarations, releases, snapshots, receipts and checkpoints are retained.

The five HTTP projection pairs remain Department Master @1, Department Hierarchy @1, and Price List @0/@1/@2. No Department payload, projection schema, browser operation, or direct-query API is added or changed.

OpenAPI SHA changes from `afc8cded75fc662758a172cc41efe5df263746f33f90a42dab7310c383cf71fb` to `5c32b5bedf0cbd67171e31bd8a8b0aa5ca46dfd06b7dadf1bfa2b19b410831bb`: 1 path added, 0 removed, 0 existing paths modified, 0 components changed. The B-03A delta guard compares live output to START_HEAD and permits only the lifecycle command. B-02B's original allowlist remains unchanged and its guard now checks its closed result at START_HEAD. Generated client output comes from the existing generator, with positive and `@ts-expect-error` negative lifecycle compile checks.

Canonical schema digests before and after:

- Master V1: `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc`.
- Hierarchy V1: `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372`.

The existing seven-artifact byte comparison remains mandatory. The new lifecycle verifier exercises real HTTP, direct module calls, PostgreSQL transactions, concurrent transition/receipt serialization, pending backlog retention, terminal publication and dispatch blocking, immutable history, and reopen/persistence after app and pool closure. Live migration verification confirmed existing subscriptions became ACTIVE and their change time exactly matched their original creation time. Repeated migration execution must leave the registered chain at 17 entries.

## Scope

No campus, alias, quality, source mapping, HIS/EMR fields or integrations, new master-data domain, Keycloak changes, Formal ABG, AR-07, containers, browser acceptance, generic workflow engine, consumer SDK, replay CLI, SLA, or metrics. No push, pull/rebase, merge, tag, PR, or B-03B work.

## Final validation record (2026-09-04, Asia/Shanghai)

All 29 inherited acceptance commands and 3 additional lifecycle/non-container gates completed successfully. The ignored local prototype environment was injected per process; connection values were not printed.

| # | Command | Exit |
|---:|---|---:|
| 1 | `npm run typecheck` | 0 |
| 2 | `npm run build` | 0 |
| 3 | `npm run test -- department-master` | 0 |
| 4 | `npm run test --workspace @hospital-data-intelligence/governance-api -- release-distribution` | 0 |
| 5 | `npm run test --workspace @hospital-data-intelligence/governance-api -- department-consumer-contract` | 0 |
| 6 | `npm run test --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| 7 | `npm run build --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| 8 | `npm run typecheck --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| 9 | `npm run prototype:db:check` | 0 |
| 10 | `npm run prototype:db:migrate` | 0 |
| 11 | `npm run prototype:db:seed` | 0 |
| 12 | `npm run prototype:department:seed` | 0 |
| 13 | `npm run prototype:department:validate` | 0 |
| 14 | `npm run prototype:http:validate` | 0 |
| 15 | `npm run prototype:department:http:validate` | 0 |
| 16 | `npm run prototype:department:consumer:validate` | 0 |
| 17 | `npm run check:database-authority` | 0 |
| 18 | `npm run check:repo:layout` | 0 |
| 19 | `npm run check:module-boundaries` | 0 |
| 20 | `npm run contract:generate` | 0 |
| 21 | `npm run contract:lint` | 0 |
| 22 | `npm run contract:generate-client` | 0 |
| 23 | `npm run build --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| 24 | `npm run typecheck --workspace @hospital-data-intelligence/generated-api-client` | 0 |
| 25 | `npm run build --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| 26 | `npm run typecheck --workspace @hospital-data-intelligence/sim-consumer` | 0 |
| 27 | `node apps/governance-api/scripts/check-department-consumer-openapi-diff.ts` | 0 |
| 28 | `node --import tsx tooling/prototype/check-department-consumer-canonical.ts` | 0 |
| 29 | `git diff --check` | 0 |
| 30 | `node apps/governance-api/scripts/check-consumer-lifecycle-openapi-diff.ts` | 0 |
| 31 | `node --import tsx tooling/prototype/validate-department-consumer-flow.ts --lifecycle` | 0 |
| 32 | `npm run test --workspace @hospital-data-intelligence/governance-api -- --exclude=**/phase-01-vertical-slice.integration.test.ts` | 0 |

Department: 51/51. Release Distribution: 57/57 (including 35 lifecycle unit cases and real PostgreSQL B-02B/B-03A flows). Sim Consumer: 20/20. The complete API suite excluding the explicitly out-of-scope container integration file passed 317/317 across 20 files. Generated-client build and typecheck passed, including positive and negative lifecycle compile checks. Contract lint returned 0 errors and 0 warnings; this repository has no separate source-lint script. Database authority reported 17 migrations and 0 forbidden timezone types. All seven canonical artifacts remained byte-identical.

Independent read-only Standards and Spec reviews each returned 0 findings and 0 blocking findings on the staged START_HEAD candidate; neither reviewer executed tests or changed files/database state.

Development diagnostics were resolved before the final pass: codegen required direct process environment injection; the new migration's registry insertion was added and completed from the authoritative SQL after its initial DDL execution; a cross-object negative fixture used an object on which the actor already had permission; old migration-count assertions now compare against migration files; the old B-02A snapshot assertion now reflects the frozen B-02B consumer contract. An optional disposable-database probe was denied CREATE DATABASE permission, created no database, and was removed without granting privileges. Live migration replay, backfill checks, generated database types and persistence gates passed; no fresh-database migration claim is made.

Resource closure verified after the final pass: application database sessions 0; verification pool closed; prototype validators reported app/process shutdown and released ports; PostgreSQL service inactive and port 55434 has no listener; task keepalive Linux PID 140 and Windows launcher PID 38400 exited; workspace Node process count 0. The temporary PID record was removed. No push performed.
