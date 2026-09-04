# Department Release Distribution Consumer Contract

PV-005-B-02B completes the formal service-consumer contract for the existing Department Master V1 and Department Hierarchy V1 projections. It extends the existing Publication → Release → Outbox Event → Consumer Subscription → Compatibility Check → Canonical Snapshot → Service Consumer → Receipt chain. All validation uses synthetic data, PostgreSQL, and `Asia/Shanghai`; it is not a production or formal acceptance result.

## Audiences and entry points

Staff governance remains `browserSession → /v1/department-governance/* → Department Governance Application`. Subscription management and replay also remain PERSON browser actions and require `CONSUMER_SUBSCRIPTION_MANAGE` on the exact governance object. A SERVICE principal cannot perform them.

System consumption remains `serviceBearer → consumer subscription → event → canonical snapshot → receipt`. Events, snapshots, and receipts require a SERVICE RequestContext and ownership of that exact subscription. Browser users cannot call them, and one service cannot inspect another service's subscription.

No Department direct-query system API was added. In particular, there is no `/v1/master-data/departments`, `/v1/service/departments`, `/v1/departments`, or direct HIS/EMR call to `DepartmentQueryService` or `department_published_projection`. Browser governance DTOs serve the governance workbench and are not a system integration channel.

## Exact projection support

The formal subscription request is a closed discriminated union. These existing Price List pairs remain valid:

- `hdi.price-list @ 0`
- `hdi.price-list @ 1`
- `hdi.price-list @ 2`

The new pairs are exactly:

- `hdi.department-master @ 1`
- `hdi.department-hierarchy @ 1`

The module still retains its internal Charge Catalog contracts. HTTP does not expose arbitrary strings or the internal Charge subscription pair. An incorrect type/version pair fails at HTTP validation; all callers also pass through the registered-contract lookup.

`ReleaseDistributionModule` additionally verifies these type relationships before it writes a subscription or immutable subscription version:

| Projection type | Required governance object type |
|---|---|
| `hdi.charge-catalog` | `CHARGE_CATALOG` |
| `hdi.price-list` | `PRICE_LIST` |
| `hdi.department-master` | `DEPARTMENT_MASTER` |
| `hdi.department-hierarchy` | `DEPARTMENT_HIERARCHY` |

A mismatch fails with `CONSUMER_PROJECTION_GOVERNANCE_OBJECT_MISMATCH`. A new subscription also verifies that `servicePrincipalId` exists with `principal_kind=SERVICE` and `status=ACTIVE`; otherwise it fails with `CONSUMER_SERVICE_PRINCIPAL_INVALID`. Creating a new support declaration appends a subscription version and never updates earlier support rows. Its schema digest always comes from `PHASE_01_PROJECTION_CONTRACTS`.

Composition injects a transaction-scoped platform `ConsumerReferenceReader`, following the existing campus-reader pattern. Platform retains SQL ownership of its governance-object and principal tables; Release Distribution retains the subscription guard and error decisions.

## Compatibility, artifact, receipt, and checkpoint

Department publication uses the existing `registerPublication()` transaction. It validates the payload against the registered TypeBox schema, creates one Release, member, canonical snapshot, Outbox Event, and a compatibility result and delivery for every active subscription. Compatibility continues to compare the exact projection type, schema version, and schema digest. Supported declarations enter `SUPPORTED`; different digests enter `BLOCKED_INCOMPATIBLE`. Replay after an immutable support-version correction retains the original event and snapshot bytes.

The snapshot endpoint and media type remain:

`GET /v1/phase-01/consumer-subscriptions/{subscriptionId}/snapshots/{snapshotId}/content`

`application/vnd.hdi.canonical-snapshot+json`

The canonical envelope is built only by `buildCanonicalSnapshotArtifact()`. Both Department variants contain `envelopeContractVersion=phase-01.v1`; a release block with aggregate type, governance object, Release identity and number, `releaseKind`, business-valid interval; the exact projection type/version, SHA-256 schema digest; `serializationProfileVersion=canonical-json.v1`; and the registered V1 payload. The HTTP `Digest` header, SHA-256 of the returned bytes, and event `snapshotArtifactDigest` must match.

An accepted, valid, applied receipt must carry the snapshot artifact digest. It makes `hasAppliedReceipt(releaseId)` true and advances the subscription/object checkpoint without gaps. A wrong processing digest is rejected and does not create or advance a checkpoint. Querying after the applied aggregate version does not return the old event.

## Department V1 payloads

Department Master V1 includes stable Department and version IDs, Department code, version number, names, Department type, clinical and management flags, subject-mapping applicability, business status and interval, description, recorded-from time, and content hash.

Department Hierarchy V1 includes stable hierarchy view and version IDs, view code and type, version number, business and recorded time, content hash, and frozen nodes. Each node includes its stable node and parent IDs, kind, one frozen Department/version or Group/version reference, display name, and sort order. Administrative consumer validation creates a new version of the existing stable administrative hierarchy view and consumes its frozen nodes; it does not rebuild the snapshot from the current tree.

V1 does not carry the richer browser read model's campus display snapshot, quality dimensions, aliases, source mappings, or current-name supplements. Those are explicit V1 contract limitations. This task did not add them or create V2 because changing the canonical V1 schema without a governed schema version would silently change the schema digest.

## Compatibility gates and generated client

The pre-change and post-change canonical schema digests are identical:

| Contract | Before | After |
|---|---|---|
| Department Master V1 | `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc` | `a9ef826fee8da8888f1bb4df0613c4f768fbdcf2b89b6e7dd4884365c23b86fc` |
| Department Hierarchy V1 | `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372` | `72a7910058121c35b7402cf834a9585c95d17fc98c99937adaa431fdef303372` |

The byte-stability gate reconstructs deterministic artifacts for all seven registered contracts, including all three Price List versions, and compares exact bytes and SHA-256 against the frozen `80ed445c` baseline. Department canonical schemas are inlined in the transport schema without adding `$id` or OpenAPI metadata, so the release contract digest does not drift.

OpenAPI changed from `0a6f4916188d592993dc2bdfa6c8e42c8832ab112a4447f7cd211d7fb228879c` to `afc8cded75fc662758a172cc41efe5df263746f33f90a42dab7310c383cf71fb`. Paths added and removed are both zero. Only `createPhase01ConsumerSubscription`, `createPhase01ConsumerSubscriptionVersion`, and `downloadPhase01CanonicalSnapshot` changed. The last operation also corrects the prior snapshot description by including real `releaseKind`, exact projection types, and the already registered Charge V2 and Price V2 envelopes. All 15 Browser Department operations and all components remain byte-equivalent to the B-02A baseline.

The generated client is regenerated from that OpenAPI document. Its compile test exercises both Department pairs for subscription creation and new immutable versions, and uses `@ts-expect-error` to prove that Department types cannot be paired with Price List schema versions. The Sim Consumer still uses this one generated client; its minimal extension checks optional expected event metadata, the HTTP Digest header, all canonical envelope sections, and event-to-envelope release and projection identities before persisting state and sending a receipt. Full Department payload checking stays in prototype/integration tooling and imports the canonical schemas rather than copying them into the consumer.

## Synthetic PostgreSQL validation boundary

`npm run prototype:department:consumer:validate` runs real Fastify handlers, real PostgreSQL transactions, the generated client, and the Sim Consumer with an integration-only PERSON/SERVICE principal resolver. The database contains fixed synthetic SERVICE fixture `PROTOTYPE-SYNTHETIC-DEPARTMENT-CONSUMER`; the resolver does not change production Keycloak behavior or grant browser governance permissions to that service.

The flow covers both Department pairs, the existing Price and Charge module pairs, projection/object mismatch, PERSON/disabled/missing service owner rejection, invalid HTTP pair rejection, audience separation, cross-subscription isolation, supported and blocked compatibility, replay, canonical bytes and payload schemas, receipt, checkpoint, persistence after application and pool shutdown, 16 migrations, and zero forbidden timezone types. It does not prove a real HIS/EMR integration, Keycloak deployment, Formal ABG, AR-07, production infrastructure, performance, capacity, or production readiness.

## Validation record (2026-09-04, Asia/Shanghai)

Opening gate, recorded before edits (empty stdout is stated explicitly):

```text
$ git status --short
(empty)
$ git branch --show-current
prototype/phase-02-department-master
$ git rev-parse HEAD
80ed445c7710deb72db5560acc49be3652d8fbdc
$ git log -8 --oneline
80ed445 feat(api): freeze department governance browser contract
a81aa31 feat(prototype): add department governance REST adapter
4733dfc feat(prototype): verify department application contract boundary
d6a586b docs(prototype): freeze department api contract boundary
5d62f96 feat(prototype): add department published read model boundary
c73b969 feat(prototype): add department published projection boundary
a2eb71b feat(prototype): add department governance audit events
291de4c fix(prototype): harden department master lifecycle boundaries
$ git fetch origin
(empty; exit 0)
$ git rev-list --left-right --count origin/prototype/phase-02-department-master...HEAD
0	0
$ git diff --check
(empty; exit 0)
```

The three required commits were confirmed as ancestors (each ancestry check exit 0). The final serial acceptance pass returned these actual results:

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

Department tests: 6 files / 51 tests. Release Distribution: 2 files / 21 tests, including the real PostgreSQL consumer test. Consumer schema tests: 20. Sim Consumer: 20, including malformed metadata, expected-pair mismatch, Digest header rejection, atomic pending-state recovery, and receipt retry. Both existing HTTP validators passed, including their application/database shutdown and persistence assertions. Seed reruns reported idempotence. The same lint command produced 2 unused-component warnings for the frozen B-02A document and 0 for B-02B.

Before this final pass, diagnostics exposed and resolved: PostgreSQL was initially stopped (Department test exit 1, then 0 after starting the existing WSL service); a test imported tooling outside the API TypeScript root (typecheck exit 1, corrected to a subprocess gate); old probes counted all hierarchy versions instead of their fixed seed versions and assumed no persisted administrative publication (prototype validation exit 1, then 0 after fixture scoping and local chronology correction); direct platform SQL inside the module violated database ownership (authority exit 1, then 0 with the injected platform reader); and a trailing blank line failed diff-check (then corrected). No checker or domain rule was relaxed.

The hierarchy consumer fixture injects a single Asia/Shanghai local instant into draft creation and its workflow sequence to match the existing recorded-period publication boundary and avoid dependence on crossing a wall-clock second. This is a synthetic integration fixture, not proof of a long-running human hierarchy approval session. The projection regression probe retains its original time intervals in a rollback-only transaction on a local date after the latest persisted administrative version. Counts for original seed nodes are scoped to their three fixed version IDs so subsequent valid publications do not invalidate the seed tests.

Independent read-only Standards and Spec reviews each returned zero findings and zero blocking findings. They reviewed the staged candidate before the local commit, including the platform-reader correction. Production Department/Workflow/Keycloak behavior, Browser paths, migrations, canonical schemas, serialization, and Sequence 10–13 were not changed.

Modified files in this task:

```text
apps/governance-api/scripts/check-department-consumer-openapi-diff.ts
apps/governance-api/src/composition/create-scoped-modules.ts
apps/governance-api/src/modules/release-distribution/department-consumer-contract.test.ts
apps/governance-api/src/modules/release-distribution/department-consumer.integration.test.ts
apps/governance-api/src/modules/release-distribution/index.ts
apps/governance-api/src/platform/fastify/map-http-error.ts
apps/governance-api/src/platform/fastify/register-phase-01-routes.ts
apps/governance-api/src/platform/fastify/release-consumer-schemas.ts
apps/governance-api/src/platform/release-consumer/consumer-reference-reader.ts
apps/governance-api/src/prototype-fixture.ts
apps/sim-consumer/package.json
apps/sim-consumer/src/consumer.test.ts
apps/sim-consumer/src/consumer.ts
apps/sim-consumer/tsconfig.build.json
contracts/openapi/phase-01.openapi.json
contracts/openapi/phase-01.openapi.sha256
docs/design/department-governance-http-contract.md
docs/design/department-release-distribution-consumer-contract.md
package.json
packages/generated-api-client/src/department-consumer.compile-test.ts
packages/generated-api-client/src/schema.generated.ts
tooling/prototype/check-department-consumer-canonical.ts
tooling/prototype/department-constraint-probe.ts
tooling/prototype/department-projection-probe.ts
tooling/prototype/fixtures/department-consumer-baseline.json
tooling/prototype/run-department-consumer-flow.ts
tooling/prototype/seed-department-demo.ts
tooling/prototype/seed-prototype.ts
tooling/prototype/validate-department-consumer-flow.ts
```
